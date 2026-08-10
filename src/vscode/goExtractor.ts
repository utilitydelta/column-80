/**
 * Product Go extraction transport: reuse the user's already-running gopls (the
 * engine behind the golang.go extension) through the vscode command API — the
 * csExtractor / pyExtractor analog. No rival LS is spawned. Converts vscode
 * CompletionItem / Hover / Location / CodeAction shapes into the core data
 * types through the Go-shaped pure helpers (goExtraction), so this transport
 * and the headless goLspExtractor render byte-identical member shapes (the
 * parity bar).
 *
 * gopls carries the signature ON the completion item (`detail`) and fills
 * documentSymbol `detail` too, so unlike the TS/Python transports there is no
 * resolve round-trip and no hover fan-out anywhere here. membersOfType is the
 * receiver-sibling join: gopls names methods as top-level `(*Stripe).Enroll`
 * symbols, and the join parses the receiver out of the name prefix.
 *
 * This module never imports vscode — not even for the dispatch. Only the
 * injected runner (built in extractors.ts) touches
 * vscode.commands.executeCommand, so the whole class bundles headless and the
 * contract suites prove the mapping against a fake runner.
 *
 * Every primitive swallows a throwing runner into its degrade shape EXCEPT
 * completeMembers, which REJECTS: `[]` is load-bearing for the member-site
 * output gate ("definitively no members"), so a dead LS must surface as a
 * rejection, never a false empty (the same rule as the TS/C#/Python
 * transports).
 */

import {
  CompletionMember,
  DefinitionLocation,
  HoverSurface,
  QualifyEdit,
  ReferenceLocation,
  ReferenceQuery,
  SourceCursor,
  SurfaceExtractor,
  TypeNameHint,
  VSCODE_TEXT_KIND,
  capReferences,
  dropDeclaration,
  vscodeReferenceLocations,
} from "../core/extraction";
import {
  goMemberFromCompletionItem,
  goMembersFromDocumentSymbols,
  goVscodeCompletionKind,
  goVscodeSymbolRole,
  parseGoHover,
  resolveGoTypeCursorWithHint,
  type GoSymbolCandidate,
} from "../core/goExtraction";

/** Dispatches an extraction command for a cursor and yields the raw
 *  vscode-shaped result; same shape as the TS/C#/Python runners so the product
 *  wiring is one factory. `opts.resolveCount` fills edit-carrying code actions
 *  (completion needs none: gopls's signature rides the item's `detail`);
 *  `opts.endCursor` turns the call into a Range (code actions). */
export type GoCommandRunner = (
  command: string,
  cursor: SourceCursor,
  opts?: { resolveCount?: number; endCursor?: SourceCursor },
) => Promise<unknown>;

/** Reads the current text of an open document, for completeMembers' member-site
 *  gate and qualifyImport's identifier-widening. Optional: an absent reader
 *  trusts the caller (the gate proceeds, the code action is requested at the
 *  bare cursor). */
export type GoTextReader = (uri: string) => string | undefined;

/** Dispatches a workspace-symbol QUERY (not a cursor) and yields the raw
 *  vscode-shaped SymbolInformation[]; the by-name resolution leg's transport
 *  (session-v40 item 2's anchor leg), the CsSymbolRunner sibling. Optional on
 *  the extractor: an absent runner means no workspace-symbol fallback
 *  (resolveTypeCursorByName then resolves nothing). */
export type GoSymbolRunner = (query: string) => Promise<unknown>;

const COMPLETION_COMMAND = "vscode.executeCompletionItemProvider";
const HOVER_COMMAND = "vscode.executeHoverProvider";
const DEFINITION_COMMAND = "vscode.executeDefinitionProvider";
const CODE_ACTION_COMMAND = "vscode.executeCodeActionProvider";
const DOCUMENT_SYMBOL_COMMAND = "vscode.executeDocumentSymbolProvider";
const REFERENCE_COMMAND = "vscode.executeReferenceProvider";

const ACTION_RESOLVE_CAP = 12;

// The gopls Add-import quickfix, recognized by title (the title carries the
// package path, so two competing paths are two DISTINCT actions). The headless
// transport spells the same recognizer inline; the product transport runs
// whatever gopls the golang.go extension installs, so both key on the stable
// title prefix rather than a data payload the command layer strips.
const ADD_IMPORT_TITLE = /^Add import\b/i;

// vscode CompletionItem.label is a string or a { label } object.
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

export class GoCommandExtractor implements SurfaceExtractor {
  constructor(
    private readonly run: GoCommandRunner,
    private readonly readText?: GoTextReader,
    private readonly runSymbol?: GoSymbolRunner,
  ) {}

  async completeMembers(cursor: SourceCursor): Promise<CompletionMember[]> {
    // A THROWING runner REJECTS here — the only primitive that propagates. `[]`
    // is load-bearing for the member-site output gate ("definitively no
    // members"); swallowing a dead LS's error into `[]` makes real ghosts
    // disappear. Empty ANSWERS still return `[]` — empty is not an error.
    //
    // Member-site gate: vscode's completion command carries no member flag, so
    // at a non-member site it returns the in-scope WORLD. The transport's own
    // readText is the gate — proceed only when the text before the cursor is an
    // identifier-dot shape (Go member access is `.`-only, and Go identifiers
    // are unicode). A type assertion `x.(T)` fails the shape and returns []
    // without a dispatch — upstream, goMemberSite already keeps that site
    // ungated. An absent reader PROCEEDS (trust the caller).
    const text = this.readText?.(cursor.uri);
    if (text !== undefined) {
      const before = (text.split("\n")[cursor.line] ?? "").slice(0, cursor.character);
      if (!/\.[\p{L}\p{Nd}_]*$/u.test(before)) {
        return [];
      }
    }
    const result = await this.run(COMPLETION_COMMAND, cursor);
    const items = Array.isArray(result) ? result : ((result as { items?: unknown[] })?.items ?? []);
    const members: CompletionMember[] = [];
    const fallback: CompletionMember[] = [];
    for (const raw of items) {
      const item = raw as { label?: unknown; kind?: unknown; detail?: unknown };
      // The editor's word-based fallback (kind Text) is intercepted BEFORE the
      // two-rule filter: the headless transport never sees Text items (gopls
      // emits none), so the filter has no rule for them, and letting one
      // through here would present an editor guess as a member.
      if (item.kind === VSCODE_TEXT_KIND) {
        fallback.push({ name: labelText(item.label), kind: "text" });
        continue;
      }
      const mapped = goMemberFromCompletionItem({
        label: labelText(item.label),
        kind: goVscodeCompletionKind(item.kind),
        detail: typeof item.detail === "string" ? item.detail : undefined,
      });
      if (mapped) {
        members.push(mapped);
      }
    }
    // An answer made ENTIRELY of the editor's word-based fallback is not an
    // empty answer: it is the server having bound nothing at all. Carried as
    // evidence (no signature, dropped by semanticMembers), never as surface.
    return members.length > 0 ? members : fallback;
  }

  async hoverSurface(cursor: SourceCursor): Promise<HoverSurface | undefined> {
    try {
      const hover = firstOf<{ contents?: unknown }>(await this.run(HOVER_COMMAND, cursor));
      if (!hover) {
        return undefined;
      }
      return parseGoHover(hoverMarkdown(hover.contents));
    } catch {
      return undefined;
    }
  }

  async definition(cursor: SourceCursor): Promise<DefinitionLocation | undefined> {
    type VscodeRange = { start: { line: number; character: number }; end: { line: number; character: number } };
    try {
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
      // A LocationLink's targetRange spans the whole declaration; the SELECTION
      // range is the name token. Prefer selection so a follow-up lands on the
      // name — the same LocationLink lesson every prior transport fixed.
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
    } catch {
      return undefined;
    }
  }

  /** Where the workspace uses the symbol under the cursor, through the user's own
   *  gopls. `vscode.executeReferenceProvider` carries no reference context, so
   *  `includeDeclaration: false` is enforced HERE against the definition
   *  provider's answer for the same cursor, exactly as RaCommandExtractor
   *  documents at length. Never throws; every degrade is `[]` or one window fewer. */
  async references(cursor: SourceCursor, query?: ReferenceQuery): Promise<ReferenceLocation[]> {
    try {
      const hits = vscodeReferenceLocations(await this.run(REFERENCE_COMMAND, cursor));
      const declaration =
        query?.includeDeclaration === true
          ? undefined
          : await this.definition(cursor).catch(() => undefined);
      return capReferences(dropDeclaration(hits, declaration), query?.maxResults);
    } catch {
      return [];
    }
  }

  // Always dark for Go (the locked C#/TS resolution — Go serves signatures,
  // never a scraped example): resolves undefined WITHOUT dispatching ANY
  // command — the contract pins zero runner calls.
  async example(_cursor: SourceCursor, _prefer?: string): Promise<string | undefined> {
    return undefined;
  }

  async qualifyImport(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    try {
      const line = this.readText?.(cursor.uri)?.split("\n")[cursor.line] ?? "";
      const isWord = (c: string) => /[\p{L}\p{Nd}_]/u.test(c);
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
        { endCursor: { ...cursor, character: end }, resolveCount: ACTION_RESOLVE_CAP },
      )) as Array<{ title?: string; edit?: unknown }>;
      if (!Array.isArray(actions)) {
        return undefined;
      }
      // Single-candidate only: two competing import paths is an ambiguity the
      // model must never resolve — honest-dark instead (the headless
      // transport's rule; each Add-import title carries its package path, so
      // counting actions IS counting candidates). The edit lands at the
      // imports region (out-of-span) — the broadened QualifyEdit contract the
      // TS/Python auto-imports already ride.
      const imports = actions.filter((a) => typeof a.title === "string" && ADD_IMPORT_TITLE.test(a.title));
      if (imports.length !== 1) {
        return undefined;
      }
      return sameFileSingleEdit(imports[0].edit, cursor.uri);
    } catch {
      return undefined;
    }
  }

  async membersOfType(defCursor: SourceCursor): Promise<CompletionMember[]> {
    // The receiver-sibling join over the definition file's documentSymbols,
    // through the vscode-numbered role mapper (vscode renumbers the SymbolKind
    // enum one below LSP). gopls fills `detail` on fields and methods alike,
    // so no hover fan-out and no budget parameter — the C# property.
    try {
      const symbols = await this.run(DOCUMENT_SYMBOL_COMMAND, defCursor);
      return goMembersFromDocumentSymbols(symbols, defCursor, goVscodeSymbolRole);
    } catch {
      return [];
    }
  }

  // The workspace-symbol resolution leg: a bare type NAME -> the cursor at its
  // definition's name token, via vscode.executeWorkspaceSymbolProvider —
  // session-v40 item 2, the CsCommandExtractor sibling. gopls's containerName
  // is a real Go import PATH (proven live against the headless transport, same
  // gopls engine), so resolveGoTypeCursorWithHint disambiguates by direct
  // comparison, never a hover fan-out. An absent runSymbol degrades to
  // undefined without dispatching anything.
  async resolveTypeCursorByName(name: string, hint?: TypeNameHint): Promise<SourceCursor | undefined> {
    if (!this.runSymbol) {
      return undefined;
    }
    try {
      const raw = await this.runSymbol(name);
      const symbols = (Array.isArray(raw) ? raw : []) as Array<{
        name?: unknown;
        kind?: unknown;
        containerName?: unknown;
        location?: { uri?: { toString(): string }; range?: { start?: { line?: unknown; character?: unknown } } };
      }>;
      const candidates: GoSymbolCandidate[] = symbols.flatMap((s) => {
        const uri = s.location?.uri;
        const start = s.location?.range?.start;
        if (
          typeof s.name !== "string" ||
          !uri ||
          typeof start?.line !== "number" ||
          typeof start?.character !== "number"
        ) {
          return [];
        }
        const containerName = typeof s.containerName === "string" ? s.containerName : "";
        return [{ name: s.name, role: goVscodeSymbolRole(s.kind), containerName, uri: uri.toString(), line: start.line, character: start.character }];
      });
      return resolveGoTypeCursorWithHint(candidates, name, hint);
    } catch {
      return undefined;
    }
  }
}

// The Add-import workspace edit must touch exactly ONE file — the cursor's own —
// with exactly ONE text edit. Like the Python auto-import (and unlike the C#
// in-span fully-qualify), the edit lands OUT of span at the imports region; the
// range simply carries the imports-region position (the broadened QualifyEdit
// contract).
function sameFileSingleEdit(edit: unknown, uri: string): QualifyEdit | undefined {
  const entries = (edit as { entries?: () => Array<[unknown, Array<{ range?: unknown; newText?: unknown }>]> })
    ?.entries;
  if (typeof entries !== "function") {
    return undefined;
  }
  const pairs = entries.call(edit);
  if (!Array.isArray(pairs) || pairs.length !== 1) {
    return undefined;
  }
  const [editUri, edits] = pairs[0];
  if (String(editUri) !== uri || !Array.isArray(edits) || edits.length !== 1) {
    return undefined;
  }
  const te = edits[0] as {
    range?: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText?: unknown;
  };
  if (!te?.range || typeof te.newText !== "string") {
    return undefined;
  }
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
