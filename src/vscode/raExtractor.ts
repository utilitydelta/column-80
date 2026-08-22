/**
 * Product extraction transport: reuse the user's already-running rust-analyzer
 * through the vscode command API. No rival rust-analyzer is spawned (a product
 * invariant). Converts vscode CompletionItem / Hover / Location
 * into the core data types and delegates all rendering to the pure helpers, so
 * the surface findings live in one place and both transports render identically.
 *
 * The injected `run` closes over vscode.commands.executeCommand in the product
 * (createRaCommandRunner) and over a fixture-returning fake in the blind adapter
 * test, so the mapping is provable headless. The class itself never touches the
 * vscode module, only the injected runner does.
 */

import * as vscode from "vscode";
import {
  CompletionMember,
  DefinitionLocation,
  HoverSurface,
  MemberKind,
  QualifyEdit,
  ReferenceLocation,
  ReferenceQuery,
  SourceCursor,
  SurfaceExtractor,
  SymbolRole,
  capReferences,
  dropDeclaration,
  extractExample,
  membersFromDocumentSymbols,
  isRaBlanketImpl,
  parseHover,
  parseMemberLabel,
  raEagerDetail,
  raSortTextTier,
  rankExampleCandidates,
  stripRustGenericDefaults,
  VSCODE_TEXT_KIND,
  toCompletionMember,
  vscodeReferenceLocations,
} from "../core/extraction";

/** Dispatches an extraction command for a cursor and yields the raw vscode-shaped
 *  result. The command string is one of the executeXProvider ids. `opts` carries
 *  the extra arguments completion-with-resolve and code-action need; the frozen
 *  blind adapter fake ignores them, so the three original methods are unchanged. */
export type RaCommandRunner = (
  command: string,
  cursor: SourceCursor,
  opts?: { resolveCount?: number; endCursor?: SourceCursor },
) => Promise<unknown>;

/** Reads the current text of an open document, for the example() re-target that
 *  needs to find a crate `::` on the cursor's line. Optional: absent means the
 *  wrong-item re-target is skipped (the honest degrade). */
export type RaTextReader = (uri: string) => string | undefined;

const COMPLETION_COMMAND = "vscode.executeCompletionItemProvider";
const HOVER_COMMAND = "vscode.executeHoverProvider";
const DEFINITION_COMMAND = "vscode.executeDefinitionProvider";
const CODE_ACTION_COMMAND = "vscode.executeCodeActionProvider";
const DOCUMENT_SYMBOL_COMMAND = "vscode.executeDocumentSymbolProvider";
const REFERENCE_COMMAND = "vscode.executeReferenceProvider";

// vscode.SymbolKind (0-indexed) -> the documentSymbol role membersOfType needs.
// Distinct from CompletionItemKind: Struct=22, Enum=9, Method=5, Field=7,
// Function=11. impl blocks carry no dedicated kind and are matched by name in
// membersFromDocumentSymbols, not here.
function vscodeSymbolRole(kind: unknown): SymbolRole {
  switch (kind) {
    case 22: // Struct
    case 9: // Enum
      return "container";
    case 5: // Method
      return "method";
    case 11: // Function
      return "function";
    case 7: // Field
      return "field";
    default:
      return "other";
  }
}

// vscode CompletionItemKind.Constructor: the builder/ctor entry whose docs carry
// the construction example. Ranking hygiene lives in the pure
// rankExampleCandidates; this transport only maps items into its candidate shape.
const VSCODE_CONSTRUCTOR_KIND = 3;
const EXAMPLE_RESOLVE_CAP = 12;
// completeMembers reads each item's `detail` (the rendered fn signature). Like
// documentation, rust-analyzer defers `detail` to completionItem/resolve, so a
// bare executeCompletionItemProvider returns items WITHOUT detail and every
// member renders to nothing. Requesting resolution of the first N items fills
// their detail. Larger than the example cap because a member LIST wants breadth,
// not a single ranked example.
const MEMBER_RESOLVE_CAP = 32;

// vscode CompletionItem.documentation / MarkdownString value, as a string.
function docText(doc: unknown): string {
  if (typeof doc === "string") {
    return doc;
  }
  if (doc && typeof doc === "object" && typeof (doc as { value?: unknown }).value === "string") {
    return (doc as { value: string }).value;
  }
  return "";
}

// vscode CompletionItemKind enum values (NOT the LSP wire enum, which numbers
// these differently). Method/Function/Field are the crate-API members; keyword,
// snippet, and plain text are never members and drop out before mapping.
const MEMBER_KIND_BY_VSCODE = new Map<number, MemberKind>([
  [1, "method"],
  [2, "function"],
  [3, "function"], // Constructor
  [4, "field"],
]);
const NON_MEMBER_KINDS = new Set<number>([0, 13, 14]); // Text, Keyword, Snippet
// Keyword and Snippet. Not API members, but they ARE the site's other legal
// spellings, so they ride back as `keyword` members: never rendered, never
// counted as a member surface, only ever widening the output gate's legal list.
const LEGAL_ONLY_KINDS = new Set<number>([13, 14]);

/** Map a vscode CompletionItemKind to a MemberKind, or undefined for a kind that
 *  is not an API member (keyword/snippet/text) and must be dropped. Unknown
 *  kinds fall through to "other" and are kept; a member with no fn detail is
 *  then dropped at render time, so keeping it costs nothing. */
function memberKind(kind: unknown): MemberKind | undefined {
  if (typeof kind !== "number") {
    return "other";
  }
  if (NON_MEMBER_KINDS.has(kind)) {
    return undefined;
  }
  return MEMBER_KIND_BY_VSCODE.get(kind) ?? "other";
}

// The blanket-impl drop (into/try_into/type_id) lives in core as
// isRaBlanketImpl, shared with the headless raLspClient mapping so the two
// transports keep producing the same members (triage-p3 finding 4).

// vscode CompletionItem.label is a string or a { label } object; RA puts the
// member name in it and the signature in .detail.
function labelText(label: unknown): string {
  if (typeof label === "string") {
    return label;
  }
  if (label && typeof label === "object" && typeof (label as { label?: unknown }).label === "string") {
    return (label as { label: string }).label;
  }
  return "";
}

// vscode Hover.contents is a MarkdownString/MarkedString or an array of them.
// Collect the markdown text of each into one blob for parseHover.
function hoverMarkdown(contents: unknown): string {
  const parts = Array.isArray(contents) ? contents : [contents];
  return parts
    .map((c) => (typeof c === "string" ? c : (c as { value?: unknown })?.value))
    .filter((v): v is string => typeof v === "string")
    .join("\n\n");
}

function firstOf<T>(result: unknown): T | undefined {
  if (Array.isArray(result)) {
    return result.length > 0 ? (result[0] as T) : undefined;
  }
  return (result as T) ?? undefined;
}

export class RaCommandExtractor implements SurfaceExtractor {
  constructor(
    private readonly run: RaCommandRunner,
    private readonly readText?: RaTextReader,
  ) {}

  async completeMembers(cursor: SourceCursor): Promise<CompletionMember[]> {
    const result = await this.run(COMPLETION_COMMAND, cursor, { resolveCount: MEMBER_RESOLVE_CAP });
    const items = Array.isArray(result)
      ? result
      : ((result as { items?: unknown[] })?.items ?? []);
    const members: CompletionMember[] = [];
    const legalOnly: CompletionMember[] = [];
    const fallback: CompletionMember[] = [];
    for (const raw of items) {
      const item = raw as { label?: unknown; detail?: unknown; labelDetails?: unknown; kind?: unknown; sortText?: unknown };
      const kind = memberKind(item.kind);
      if (kind === undefined) {
        if (item.kind === VSCODE_TEXT_KIND) {
          fallback.push({ name: labelText(item.label), kind: "text" });
        } else if (typeof item.kind === "number" && LEGAL_ONLY_KINDS.has(item.kind)) {
          legalOnly.push({ name: parseMemberLabel(labelText(item.label)).name, kind: "keyword" });
        }
        continue; // keyword/snippet/text: not an API member
      }
      const rawDetail = raEagerDetail(item);
      const detail = rawDetail === undefined ? undefined : stripRustGenericDefaults(rawDetail);
      const member = toCompletionMember(labelText(item.label), detail, kind);
      if (isRaBlanketImpl(member.name, rawDetail)) {
        continue;
      }
      member.tier = raSortTextTier(item.sortText);
      if (typeof item.sortText === "string") {
        member.sortText = item.sortText; // raw ranking evidence, never a classifier
      }
      members.push(member);
    }
    // An answer made ENTIRELY of the editor's word-based fallback is not an
    // empty answer: it is the server having bound nothing at all. Carried as
    // evidence (no signature, dropped by semanticMembers), never as surface.
    //
    // The keyword/postfix tail rides ONLY behind a real member surface. Alone
    // it would say a receiver that bound nothing had bound something, and the
    // dark-site reason line would then name the wrong cause; and nothing wants
    // it there, because the gate it exists for never arms on an empty surface.
    // Appended, so the semantic members keep their order for every consumer.
    return members.length > 0 ? [...members, ...legalOnly] : fallback;
  }

  async hoverSurface(cursor: SourceCursor): Promise<HoverSurface | undefined> {
    const hover = firstOf<{ contents?: unknown }>(await this.run(HOVER_COMMAND, cursor));
    if (!hover) {
      return undefined;
    }
    return parseHover(hoverMarkdown(hover.contents));
  }

  async example(cursor: SourceCursor, prefer?: string): Promise<string | undefined> {
    // executeCompletionItemProvider resolves the first N items' documentation
    // (where rust-analyzer puts the example) when given a resolve count. Try the
    // cursor, then re-target past a crate `::` for the wrong-item case, mirroring
    // the LSP transport.
    const atCursor = await this.exampleAt(cursor, prefer);
    if (atCursor) {
      return atCursor;
    }
    const line = this.readText?.(cursor.uri)?.split("\n")[cursor.line];
    if (line) {
      const sep = line.indexOf("::", cursor.character);
      if (sep >= 0) {
        return this.exampleAt({ ...cursor, character: sep + 2 }, prefer);
      }
    }
    return undefined;
  }

  private async exampleAt(cursor: SourceCursor, prefer?: string): Promise<string | undefined> {
    const result = await this.run(COMPLETION_COMMAND, cursor, { resolveCount: EXAMPLE_RESOLVE_CAP });
    const items = (Array.isArray(result) ? result : ((result as { items?: unknown[] })?.items ?? [])) as Array<{
      kind?: number;
      label?: unknown;
      documentation?: unknown;
    }>;
    // Map each vscode item into the pure candidate shape (name + trait provenance
    // + constructor kind) and rank it there, so std/blanket-trait noise is dropped
    // and a builder constructor wins the example slot over clone's std example.
    const candidates = items.map((item) => {
      const { name, viaTrait } = parseMemberLabel(labelText(item.label));
      return { name, viaTrait, isConstructor: item.kind === VSCODE_CONSTRUCTOR_KIND, item };
    });
    const ranked = rankExampleCandidates(candidates, prefer).slice(0, EXAMPLE_RESOLVE_CAP);
    for (const { item } of ranked) {
      const example = extractExample(docText(item.documentation));
      if (example) {
        return example;
      }
    }
    return undefined;
  }

  async qualifyImport(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    // executeCodeActionProvider over the identifier returns the quickfixes,
    // including "Qualify as `path`" - the in-span rewrite we want over "Import"
    // (which writes a `use` above the function). Resolve so the edit is present.
    const line = this.readText?.(cursor.uri)?.split("\n")[cursor.line] ?? "";
    const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
    let start = cursor.character;
    while (start > 0 && isWord(line[start - 1])) {
      start--;
    }
    let end = cursor.character;
    while (end < line.length && isWord(line[end])) {
      end++;
    }
    const actions = (await this.run(
      CODE_ACTION_COMMAND,
      { ...cursor, character: start },
      { endCursor: { ...cursor, character: end }, resolveCount: 12 },
    )) as Array<{ title?: string; edit?: unknown }>;
    if (!Array.isArray(actions)) {
      return undefined;
    }
    const qualify = actions.find((a) => typeof a.title === "string" && /^Qualify as\b/.test(a.title));
    return qualify ? vscodeWorkspaceEditToQualify(qualify.edit) : undefined;
  }

  async definition(cursor: SourceCursor): Promise<DefinitionLocation | undefined> {
    type VscodeRange = { start: { line: number; character: number }; end: { line: number; character: number } };
    const loc = firstOf<{
      uri?: { toString(): string };
      range?: VscodeRange;
      targetUri?: { toString(): string };
      targetRange?: VscodeRange;
      targetSelectionRange?: VscodeRange;
    }>(await this.run(DEFINITION_COMMAND, cursor));
    if (!loc) {
      return undefined;
    }
    // A plain Location carries uri/range; a LocationLink carries targetUri plus
    // BOTH targetRange (the whole item — for a doc-commented or attributed type it
    // starts on the `///`/`#[...]` line, NOT the name) and targetSelectionRange
    // (the identifier token). rust-analyzer returns a LocationLink whenever the
    // client advertises definition linkSupport — which VS Code does — so this
    // transport MUST prefer the selection range. The consumer (resolveCrossFileShape)
    // hovers at range.start to read a struct's fields; landing on the doc comment
    // yields an empty hover and drops every field (the 2026-07-15 fields=0 bug). The
    // LSP transport dodges this by not advertising linkSupport (plain Location =
    // identifier already), so the bug is command-transport-only.
    const uri = loc.uri ?? loc.targetUri;
    const range = loc.range ?? loc.targetSelectionRange ?? loc.targetRange;
    if (!uri || !range) {
      return undefined;
    }
    return {
      uri: uri.toString(),
      range: {
        startLine: range.start.line,
        startCharacter: range.start.character,
        endLine: range.end.line,
        endCharacter: range.end.character,
      },
    };
  }

  /**
   * Where the workspace uses the symbol under the cursor, through the user's own
   * rust-analyzer. The product half of the reference leg, and the one place the
   * five command transports diverge from their headless siblings in a way that
   * matters:
   *
   * `vscode.executeReferenceProvider` takes a uri and a position and NOTHING
   * else. There is no reference context on it, so the `includeDeclaration: false`
   * every headless transport passes down the wire is never asked here, and the
   * declaration comes back with the call sites. The seam's contract says the flag
   * is the transport's to honor where the server ignores it, so the drop happens
   * on this side, against the definition provider's own answer for the same
   * cursor. That is a second dispatch, paid only when the caller asked for
   * usage-without-declaration, and it is affordable because every consumer of
   * this leg sits in a seconds-scale gesture rather than behind the FIM bar.
   *
   * Never throws, like every leg on this seam: a wedged server, an absent
   * provider or a definition lookup that fails all degrade to what is left,
   * because a caller adds usage to a prompt when it has some and keeps the
   * surface it already had when it does not.
   */
  async references(cursor: SourceCursor, query?: ReferenceQuery): Promise<ReferenceLocation[]> {
    try {
      const hits = vscodeReferenceLocations(await this.run(REFERENCE_COMMAND, cursor));
      const declaration =
        query?.includeDeclaration === true
          ? undefined
          : await this.definition(cursor).catch(() => undefined);
      // Cap LAST: a cap applied before the declaration drop would spend a slot
      // on the one hit the caller asked not to have.
      return capReferences(dropDeclaration(hits, declaration), query?.maxResults);
    } catch {
      return [];
    }
  }

  async membersOfType(defCursor: SourceCursor): Promise<CompletionMember[]> {
    // executeDocumentSymbolProvider returns the file's hierarchical
    // DocumentSymbol[] with `detail` for free (vscode advertises full client
    // capabilities). The pure descent finds the struct/enum enclosing defCursor
    // plus its sibling impl blocks and maps their members. Never throws: an
    // absent provider (undefined) or empty list degrades to [].
    const symbols = await this.run(DOCUMENT_SYMBOL_COMMAND, defCursor);
    return membersFromDocumentSymbols(symbols, defCursor, vscodeSymbolRole);
  }
}

// A vscode.WorkspaceEdit exposes entries() as [Uri, TextEdit[]][]; take the
// first text edit as the in-span qualify rewrite.
function vscodeWorkspaceEditToQualify(edit: unknown): QualifyEdit | undefined {
  const entries = (edit as { entries?: () => Array<[unknown, Array<{ range?: unknown; newText?: unknown }>]> })?.entries;
  if (typeof entries !== "function") {
    return undefined;
  }
  for (const [, edits] of entries.call(edit)) {
    const te = edits[0] as
      | { range?: { start: { line: number; character: number }; end: { line: number; character: number } }; newText?: unknown }
      | undefined;
    if (te?.range && typeof te.newText === "string") {
      return {
        range: {
          startLine: te.range.start.line,
          startCharacter: te.range.start.character,
          endLine: te.range.end.line,
          endCharacter: te.range.end.character,
        },
        newText: te.newText,
      };
    }
  }
  return undefined;
}

/** The product runner: dispatch an extraction command against the user's running
 *  rust-analyzer via the vscode command API. This is the only vscode-touching
 *  code in the transport; the mapping in RaCommandExtractor is proven headless
 *  against a fake runner. A code-action call passes a Range (cursor..endCursor);
 *  completion/hover/definition pass a Position. The resolve count reaches
 *  documentation-carrying completion items and edit-carrying code actions. */
export function createRaCommandRunner(): RaCommandRunner {
  return (command, cursor, opts) => {
    const uri = vscode.Uri.parse(cursor.uri);
    const target = opts?.endCursor
      ? new vscode.Range(
          new vscode.Position(cursor.line, cursor.character),
          new vscode.Position(opts.endCursor.line, opts.endCursor.character),
        )
      : new vscode.Position(cursor.line, cursor.character);
    return Promise.resolve(
      vscode.commands.executeCommand(command, uri, target, undefined, opts?.resolveCount),
    );
  };
}

/** Reads an open document's text for the example() re-target. Returns undefined
 *  when the document is not open (the re-target is then skipped). */
export function createRaTextReader(): RaTextReader {
  return (uri) => vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)?.getText();
}
