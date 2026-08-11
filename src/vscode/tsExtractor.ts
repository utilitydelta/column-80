/**
 * Product TS extraction transport: reuse the user's already-running TypeScript
 * server through the vscode command API - the raExtractor analog. No rival TS
 * server is spawned. Converts vscode CompletionItem / Hover / Location shapes
 * into the core data types through the TS-shaped pure helpers (tsExtraction).
 * The transports do NOT render identically everywhere: membersOfType here is a
 * document-symbol descent, and tsserver leaves `detail` empty on every node it
 * returns. That is per-server, not a rule of the command API (Roslyn and
 * rust-analyzer both populate it), so this transport recovers the argument
 * lists with a capped hover fan-out per member rather than shipping bare names.
 * The headless transport reaches the same surface through the checker.
 *
 * This module never imports vscode - not even for the dispatch. Only the
 * injected runner (built in extractors.ts) touches
 * vscode.commands.executeCommand, so the whole class bundles headless and the
 * blind contract suite proves the mapping against a fake runner.
 *
 * Unlike the Rust transport (whose consumers wrap it in safe()), every
 * primitive here swallows a throwing runner into its degrade shape EXCEPT
 * completeMembers, which REJECTS: `[]` is load-bearing for the member-site
 * output gate ("definitively no members"), so a dead TS server must surface
 * as a rejection, never a false empty.
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
  VSCODE_TEXT_KIND,
  MemberSurfaceOptions,
  membersWithHoverSignatures,
  hoverBackfillOptions,
  capReferences,
  dropDeclaration,
  vscodeReferenceLocations,
} from "../core/extraction";
import {
  parseTsHover, toTsCompletionMember, tsSymbolMember, tsVscodeMemberKind, tsVscodeSymbolRole,
} from "../core/tsExtraction";

/** Dispatches an extraction command for a cursor and yields the raw
 *  vscode-shaped result; same shape as RaCommandRunner so the product wiring
 *  is one factory. `opts.resolveCount` fills lazily-resolved completion
 *  `detail`; `opts.endCursor` turns the call into a Range (code actions). */
export type TsCommandRunner = (
  command: string,
  cursor: SourceCursor,
  opts?: { resolveCount?: number; endCursor?: SourceCursor },
) => Promise<unknown>;

/** Reads the current text of an open document, for qualifyImport's
 *  identifier-widening. Optional: absent means the code action is requested at
 *  the bare cursor, which may miss (the honest degrade). */
export type TsTextReader = (uri: string) => string | undefined;

const COMPLETION_COMMAND = "vscode.executeCompletionItemProvider";
const HOVER_COMMAND = "vscode.executeHoverProvider";
const DEFINITION_COMMAND = "vscode.executeDefinitionProvider";
const CODE_ACTION_COMMAND = "vscode.executeCodeActionProvider";
const DOCUMENT_SYMBOL_COMMAND = "vscode.executeDocumentSymbolProvider";
const REFERENCE_COMMAND = "vscode.executeReferenceProvider";

// The TS server defers completion `detail` (the signature source) to resolve,
// like rust-analyzer; a member LIST wants breadth, so this mirrors the Rust
// transport's member cap rather than the example cap.
const MEMBER_RESOLVE_CAP = 32;
const ACTION_RESOLVE_CAP = 12;

// The deterministic auto-import fix, matched by title: inserting a new import
// or augmenting an existing one. More than one match is two candidate
// modules - ambiguous, so no edit is reported.
const AUTO_IMPORT_TITLE = /^(?:Add|Update) import from\b/;

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

export class TsCommandExtractor implements SurfaceExtractor {
  constructor(
    private readonly run: TsCommandRunner,
    private readonly readText?: TsTextReader,
  ) {}

  async completeMembers(cursor: SourceCursor): Promise<CompletionMember[]> {
    // A THROWING runner REJECTS here - the only primitive that
    // propagates. [] became load-bearing once the member-site output gate read
    // it as "definitively no members"; swallowing a dead TS server's error
    // into [] made real ghosts disappear. Empty ANSWERS still return [] -
    // empty is not an error. Consumers own the catch (the FIM closure's
    // rejection becomes no-resolution => no gate; repair legs try/catch).
    //
    // Member-site gate: vscode's completion command carries no
    // isMemberCompletion flag, so at a non-member site it returns the
    // in-scope WORLD (variables, classes, keywords), not a member surface.
    // The transport's own readText is the gate: proceed only when the text
    // before the cursor is an identifier-dot shape - a `.` (`?.` ends in one)
    // followed by at most a partial member name. An absent reader or an
    // unreadable document PROCEEDS (trust the caller): the live FIM path
    // gates on fimMemberSite before calling.
    const text = this.readText?.(cursor.uri);
    if (text !== undefined) {
      const before = (text.split("\n")[cursor.line] ?? "").slice(0, cursor.character);
      if (!/\.[A-Za-z0-9_$]*$/.test(before)) {
        return [];
      }
    }
    const result = await this.run(COMPLETION_COMMAND, cursor, { resolveCount: MEMBER_RESOLVE_CAP });
    // CompletionList { items } is the contractual shape; a bare array is
    // accepted as a courtesy.
    const items = Array.isArray(result) ? result : ((result as { items?: unknown[] })?.items ?? []);
    const members: CompletionMember[] = [];
    const fallback: CompletionMember[] = [];
    for (const raw of items) {
      const item = raw as { label?: unknown; detail?: unknown; kind?: unknown };
      const kind = tsVscodeMemberKind(item.kind);
      if (kind === undefined) {
        if (item.kind === VSCODE_TEXT_KIND) {
          fallback.push({ name: labelText(item.label), kind: "text" });
        }
        continue; // keyword/snippet/text: never a member
      }
      const detail = typeof item.detail === "string" ? item.detail : undefined;
      members.push(toTsCompletionMember(labelText(item.label), detail, kind));
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
      return parseTsHover(hoverMarkdown(hover.contents));
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
      // A LocationLink's targetRange starts at a leading doc comment; the
      // SELECTION range is the identifier. Same hazard the Rust command
      // transport fixed (the fields=0 doc-comment landing) - prefer selection.
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
   *  TS server. `vscode.executeReferenceProvider` carries no reference context, so
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

  // Always dark for TS (the TS surface is signatures-only): resolves undefined
  // without dispatching ANY command - the contract pins zero runner calls.
  async example(_cursor: SourceCursor, _prefer?: string): Promise<string | undefined> {
    return undefined;
  }

  async qualifyImport(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    try {
      const line = this.readText?.(cursor.uri)?.split("\n")[cursor.line] ?? "";
      const isWord = (c: string) => /[A-Za-z0-9_$]/.test(c);
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
      const imports = actions.filter((a) => typeof a.title === "string" && AUTO_IMPORT_TITLE.test(a.title));
      // The service repeats an IDENTICAL fix once per triggering diagnostic
      // (the sole-provider shape), so ambiguity counts DISTINCT fix
      // identities - the title carries the module - never raw actions. The
      // headless transport's distinct-description gate is the same rule.
      if (new Set(imports.map((a) => a.title)).size !== 1) {
        return undefined; // zero fixes, or several candidate modules: not deterministic
      }
      return sameFileSingleEdit(imports[0].edit, cursor.uri);
    } catch {
      return undefined;
    }
  }

  async membersOfType(
    defCursor: SourceCursor,
    budgetMs?: number,
    opts?: MemberSurfaceOptions,
  ): Promise<CompletionMember[]> {
    // Document-symbol descent of the enclosing declaration (the product
    // transport's contract; the headless transport owns the checker-scoped,
    // inheritance-aware path). The shared skeleton skips nested containers;
    // its Rust impl-sibling matching is inert here (no TS symbol is named
    // `impl ...`).
    //
    // tsserver answers documentSymbol with `detail: ""` on every node, measured
    // over a real editor on `Tile`: structure on all 8 members, a signature on
    // none, constructor included. Descending further does not help - the field
    // is empty at every depth - so the argument lists come from a hover per
    // member, fanned out and capped (see withHoverSignatures).
    try {
      const symbols = await this.run(DOCUMENT_SYMBOL_COMMAND, defCursor);
      const members = await membersWithHoverSignatures(
        symbols,
        defCursor,
        tsVscodeSymbolRole,
        tsSymbolMember,
        async (at) => (await this.hoverSurface(at))?.signature,
        // Document symbols carry no visibility. The one non-public shape that
        // is textually detectable is a `#`-private name; the `private`-keyword
        // residual is invisible here and stays a known per-transport
        // limitation. The constructor is deliberately NOT filtered: it is the
        // only member carrying the type's construction arity, which is the
        // whole reason a caller asks for a type's members.
        hoverBackfillOptions(budgetMs, opts, { keep: (m) => !m.name.startsWith("#") }),
      );
      return members;
    } catch {
      return [];
    }
  }
}

// The auto-import workspace edit must touch exactly ONE file - the cursor's
// own - with exactly ONE text edit; anything wider (a barrel re-export fixup,
// a multi-edit organize) is not the deterministic single-edit contract.
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
