/**
 * Product Python extraction transport: reuse the user's already-running Pylance
 * (the engine behind the Python extension) through the vscode command API — the
 * csExtractor / tsExtractor analog. No rival LS is spawned. Converts vscode
 * CompletionItem / Hover / Location / CodeAction shapes into the core data types
 * through the Python-shaped pure helpers (pyExtraction).
 *
 * As with the TS product transport, membersOfType here is a documentSymbol
 * descent, and Pylance leaves `detail` empty on every node it returns. That is
 * per-server rather than a rule of the command API, so this transport recovers
 * the argument lists with a capped hover fan-out per member; the headless
 * pyLspExtractor reaches them through completion-resolve.
 *
 * This module never imports vscode — not even for the dispatch. Only the injected
 * runner (built in extractors.ts) touches vscode.commands.executeCommand, so the
 * whole class bundles headless and the blind contract suite proves the mapping
 * against a fake runner.
 *
 * Every primitive swallows a throwing runner into its degrade shape EXCEPT
 * completeMembers, which REJECTS: `[]` is load-bearing for the member-site output
 * gate ("definitively no members"), so a dead LS must surface as a rejection,
 * never a false empty (the same rule as the TS/C# transports).
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
  membersWithHoverSignatures,
  capReferences,
  dropDeclaration,
  vscodeReferenceLocations,
} from "../core/extraction";
import {
  isDunder,
  isPyAutoImportTitle,
  parsePyHover,
  pyVscodeMemberKind,
  pyVscodeSymbolRole,
  toPyCompletionMember,
  toPySymbolMember,
} from "../core/pyExtraction";

/** Dispatches an extraction command for a cursor and yields the raw vscode-shaped
 *  result; same shape as the TS/C# runners so the product wiring is one factory.
 *  `opts.resolveCount` fills lazily-resolved completion `documentation` (where the
 *  Python signature rides) and edit-carrying code actions; `opts.endCursor` turns
 *  the call into a Range (code actions). */
export type PyCommandRunner = (
  command: string,
  cursor: SourceCursor,
  opts?: { resolveCount?: number; endCursor?: SourceCursor },
) => Promise<unknown>;

/** Reads the current text of an open document, for completeMembers' member-site
 *  gate and qualifyImport's identifier-widening. Optional: an absent reader trusts
 *  the caller (the gate proceeds, the code action is requested at the bare
 *  cursor). */
export type PyTextReader = (uri: string) => string | undefined;

const COMPLETION_COMMAND = "vscode.executeCompletionItemProvider";
const HOVER_COMMAND = "vscode.executeHoverProvider";
const DEFINITION_COMMAND = "vscode.executeDefinitionProvider";
const CODE_ACTION_COMMAND = "vscode.executeCodeActionProvider";
const DOCUMENT_SYMBOL_COMMAND = "vscode.executeDocumentSymbolProvider";
const REFERENCE_COMMAND = "vscode.executeReferenceProvider";

// Pylance defers the completion signature to resolve (it rides `documentation`),
// so a member LIST resolves the first N for breadth (pyright is ~2ms/item).
const MEMBER_RESOLVE_CAP = 32;
const ACTION_RESOLVE_CAP = 12;

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

export class PyCommandExtractor implements SurfaceExtractor {
  constructor(
    private readonly run: PyCommandRunner,
    private readonly readText?: PyTextReader,
  ) {}

  async completeMembers(cursor: SourceCursor): Promise<CompletionMember[]> {
    // A THROWING runner REJECTS here — the only primitive that propagates. `[]`
    // is load-bearing for the member-site output gate ("definitively no
    // members"); swallowing a dead LS's error into `[]` makes real ghosts
    // disappear. Empty ANSWERS still return `[]` — empty is not an error.
    //
    // Member-site gate: vscode's completion command carries no member flag, so at
    // a non-member site it returns the in-scope WORLD. The transport's own
    // readText is the gate — proceed only when the text before the cursor is an
    // identifier-dot shape (Python member access is `.`-only). An absent reader
    // PROCEEDS (trust the caller).
    const text = this.readText?.(cursor.uri);
    if (text !== undefined) {
      const before = (text.split("\n")[cursor.line] ?? "").slice(0, cursor.character);
      if (!/\.[A-Za-z0-9_$]*$/.test(before)) {
        return [];
      }
    }
    // PER-TRANSPORT CARVE-OUT: vscode
    // resolves the RAW top-`resolveCount` items BEFORE the isDunder filter below
    // runs, so a dunder-heavy receiver spends resolve slots on dunders and this
    // transport renders FEWER real-member signatures than the headless path,
    // which filters dunders BEFORE its resolve budget. The safety gate is
    // unaffected (it keys on member NAMES, which come through regardless of
    // resolve); only the signature-hint richness diverges. REASONED only — real
    // Pylance resolve ordering is unverifiable headless, so resolveCount is NOT
    // tuned here (a blind guess against unknown ordering); tune on dogfood.
    const result = await this.run(COMPLETION_COMMAND, cursor, { resolveCount: MEMBER_RESOLVE_CAP });
    const items = Array.isArray(result) ? result : ((result as { items?: unknown[] })?.items ?? []);
    const members: CompletionMember[] = [];
    const fallback: CompletionMember[] = [];
    for (const raw of items) {
      const item = raw as { label?: unknown; documentation?: unknown; kind?: unknown };
      const kind = pyVscodeMemberKind(item.kind);
      if (kind === undefined) {
        if (item.kind === VSCODE_TEXT_KIND) {
          fallback.push({ name: labelText(item.label), kind: "text" });
        }
        continue; // keyword/snippet/text: never a member
      }
      const label = labelText(item.label);
      // Dunders filtered by name: the ~64 dunders of a wide receiver
      // must not flood the set; single-underscore privates are KEPT.
      if (isDunder(label)) {
        continue;
      }
      members.push(toPyCompletionMember(label, item.documentation, kind));
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
      return parsePyHover(hoverMarkdown(hover.contents));
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
      // A LocationLink's targetRange spans the whole stub symbol; the SELECTION
      // range is the name token. Prefer selection so a follow-up lands on the
      // name — the same LocationLink lesson the Rust/TS/C# transports fixed.
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
   *  Pylance. `vscode.executeReferenceProvider` carries no reference context, so
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

  // Conditionally LIT (unlike the always-dark TS/C# example paths): dispatch
  // hover at the cursor and return the doctest IFF the payload carried a `>>>`
  // fence. No source-kind guess — the literal doctest is the condition, so
  // site-packages/source doctests light and stdlib stays dark by the same path.
  async example(cursor: SourceCursor, _prefer?: string): Promise<string | undefined> {
    try {
      const hover = firstOf<{ contents?: unknown }>(await this.run(HOVER_COMMAND, cursor));
      if (!hover) {
        return undefined;
      }
      return parsePyHover(hoverMarkdown(hover.contents))?.example;
    } catch {
      return undefined;
    }
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
      // Rung 3 — the Pylance auto-import code action (enrichment only). Ambiguity
      // counts DISTINCT titles (each carries the module), so two modules resolving
      // the name yield no edit rather than an arbitrary pick (the C# rule). The
      // edit lands at the imports region (out-of-span) — the broadened
      // QualifyEdit contract.
      const imports = actions.filter((a) => typeof a.title === "string" && isPyAutoImportTitle(a.title));
      if (new Set(imports.map((a) => a.title)).size !== 1) {
        return undefined;
      }
      return sameFileSingleEdit(imports[0].edit, cursor.uri);
    } catch {
      return undefined;
    }
  }

  async membersOfType(defCursor: SourceCursor, budgetMs?: number): Promise<CompletionMember[]> {
    // documentSymbol descent of the enclosing class (the product transport's
    // contract; the headless transport owns its own signature path). The Python
    // role table keeps class-body attributes (Variable) and treats a function as
    // a non-container, so a method's body-locals are structurally excluded from
    // the class's member set (the locals filter).
    //
    // Pylance answers documentSymbol with `detail: ""` on every member, the same
    // gap tsserver has and measured the same way. `__init__` is the member that
    // carries construction arity, so a bare-name descent is exactly the dark
    // case; the argument lists come from a capped hover fan-out per member.
    try {
      const symbols = await this.run(DOCUMENT_SYMBOL_COMMAND, defCursor);
      return await membersWithHoverSignatures(
        symbols,
        defCursor,
        pyVscodeSymbolRole,
        toPySymbolMember,
        async (at) => (await this.hoverSurface(at))?.signature,
        budgetMs === undefined ? {} : { budgetMs },
      );
    } catch {
      return [];
    }
  }
}

// The auto-import workspace edit must touch exactly ONE file — the cursor's own —
// with exactly ONE text edit. Unlike the C# in-span fully-qualify, the Python
// edit lands OUT of span (the imports region), but the same-file single-edit
// shape is identical; the range simply carries the imports-region position (the
// broadened QualifyEdit contract).
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
