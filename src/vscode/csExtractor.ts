/**
 * Product C# extraction transport: reuse the user's already-running Roslyn LS
 * (the engine behind the C# extension) through the vscode command API — the
 * raExtractor / tsExtractor analog. No rival LS is spawned. Converts vscode
 * CompletionItem / Hover / Location / CodeAction shapes into the core data types
 * through the C#-shaped pure helpers (csExtraction).
 *
 * membersOfType here is a documentSymbol descent. Roslyn populates `detail` with
 * the member's signature, so unlike the TypeScript and Python transports this
 * one gets its argument lists from the descent itself and never pays for the
 * hover backfill; the headless csLspExtractor reaches them through
 * completion-resolve.
 *
 * This module never imports vscode — not even for the dispatch. Only the
 * injected runner (built in extractors.ts) touches
 * vscode.commands.executeCommand, so the whole class bundles headless and the
 * blind contract suite proves the mapping against a fake runner.
 *
 * Every primitive swallows a throwing runner into its degrade shape EXCEPT
 * completeMembers, which REJECTS: `[]` is load-bearing for the member-site
 * output gate ("definitively no members"), so a dead LS must surface as a
 * rejection, never a false empty (the same rule as the TS transport).
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
  resolutionReachedWrongTree,
  membersFromDocumentSymbols,
  capReferences,
  dropDeclaration,
  vscodeReferenceLocations,
} from "../core/extraction";
import {
  csVscodeMemberKind,
  csVscodeSymbolRole,
  isCsAddImportAction,
  isCsFullyQualifyTitle,
  parseCsHover,
  resolveCsTypeCursorWithHint,
  toCsCompletionMember,
  toCsSymbolMember,
} from "../core/csExtraction";

/** Dispatches an extraction command for a cursor and yields the raw
 *  vscode-shaped result; same shape as the TS/Rust runners so the product
 *  wiring is one factory. `opts.resolveCount` fills lazily-resolved completion
 *  `documentation` (where the C# signature rides) and edit-carrying code
 *  actions; `opts.endCursor` turns the call into a Range (code actions). */
export type CsCommandRunner = (
  command: string,
  cursor: SourceCursor,
  opts?: { resolveCount?: number; endCursor?: SourceCursor },
) => Promise<unknown>;

/** Reads the current text of an open document, for completeMembers' member-site
 *  gate and qualifyImport's identifier-widening. Optional: an absent reader
 *  trusts the caller (the gate proceeds, the code action is requested at the
 *  bare cursor). */
export type CsTextReader = (uri: string) => string | undefined;

/** Dispatches a workspace-symbol QUERY (not a cursor) and yields the raw
 *  vscode-shaped SymbolInformation[]; the by-name resolution leg's transport.
 *  Optional on the extractor: an absent runner means no workspace-symbol
 *  fallback (resolveTypeCursorByName then resolves nothing). */
export type CsSymbolRunner = (query: string) => Promise<unknown>;

const COMPLETION_COMMAND = "vscode.executeCompletionItemProvider";
const HOVER_COMMAND = "vscode.executeHoverProvider";
const DEFINITION_COMMAND = "vscode.executeDefinitionProvider";
const CODE_ACTION_COMMAND = "vscode.executeCodeActionProvider";
const DOCUMENT_SYMBOL_COMMAND = "vscode.executeDocumentSymbolProvider";
const REFERENCE_COMMAND = "vscode.executeReferenceProvider";

// Roslyn defers the completion signature to completionItem/resolve (it rides
// `documentation`), so a member LIST resolves the first N for breadth.
//
// PER-TRANSPORT CARVE-OUT, the same one the Python transport carries: the vscode
// command resolves the first N items of the SERVER's list and this transport does
// not choose that order, so an `object` member sitting ahead of a real property
// takes its resolve slot whatever the filter does. What the filter can do here is
// spend nothing on the noise it CAN see without a resolve: a signature the item
// already carries (preResolveDetail) costs no slot and answers the declaring-type
// question outright. The headless transport, which resolves item by item, filters
// strictly before the budget. The enforcement gate is unaffected either way — it
// keys on member NAMES, which arrive resolved or not.
const MEMBER_RESOLVE_CAP = 32;
const ACTION_RESOLVE_CAP = 12;
// The chain-surface warm's resolve count: past the whole provider order at the
// measured receivers (115 headless, 123 in the live capture at a List<Tile>
// `.` site), so the LINQ tail Roslyn parks after position 100 resolves too.
// Background-only; never on the keystroke/deadline path. Exported so the
// warm's evidence line can say `capped at 160 of N` when a surface outgrows
// it (triage-p3 finding 8's widening trigger).
export const CHAIN_WARM_RESOLVE_CAP = 160;

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

// vscode CompletionItem.documentation / MarkdownString value, as a string. For
// C# the resolved documentation is plaintext, delivered as a plain string.
function docText(doc: unknown): string | undefined {
  if (typeof doc === "string") {
    return doc;
  }
  if (doc && typeof doc === "object" && typeof (doc as { value?: unknown }).value === "string") {
    return (doc as { value: string }).value;
  }
  return undefined;
}

// Whatever signature text a completion item carries before it is resolved.
// `detail` first, then `labelDetails.description` — Roslyn fills at most one and
// often neither. This is what lets the `object` filter run without a resolve
// slot, and what spares a member from needing one at all.
function preResolveDetail(item: { detail?: unknown; labelDetails?: unknown }): string | undefined {
  if (typeof item.detail === "string" && item.detail.length > 0) {
    return item.detail;
  }
  const description = (item.labelDetails as { description?: unknown } | undefined)?.description;
  return typeof description === "string" && description.length > 0 ? description : undefined;
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

export class CsCommandExtractor implements SurfaceExtractor {
  constructor(
    private readonly run: CsCommandRunner,
    private readonly readText?: CsTextReader,
    private readonly runSymbol?: CsSymbolRunner,
  ) {}

  async completeMembers(cursor: SourceCursor): Promise<CompletionMember[]> {
    // A THROWING runner REJECTS here — the only primitive that propagates.
    // `[]` became load-bearing once the member-site output gate read it as
    // "definitively no members"; swallowing a dead LS's error into `[]` made
    // real ghosts disappear. Empty ANSWERS still return `[]` — empty is not an
    // error. Consumers own the catch.
    //
    // Member-site gate: vscode's completion command carries no member flag, so
    // at a non-member site it returns the in-scope WORLD (locals, types,
    // keywords), not a member surface. The transport's own readText is the
    // gate — proceed only when the text before the cursor is an identifier-dot
    // shape. An absent reader or unreadable document PROCEEDS (trust the
    // caller). NOTE: the regex is not itself string/comment/float-safe (a `.`
    // inside a string, a `1.` float literal), so it leans on the upstream
    // fimMemberSite gate and on the LS returning empty inside strings/comments;
    // a standalone hardening is deferred.
    const text = this.readText?.(cursor.uri);
    if (text !== undefined) {
      const before = (text.split("\n")[cursor.line] ?? "").slice(0, cursor.character);
      if (!/\.[A-Za-z0-9_$]*$/.test(before)) {
        return [];
      }
    }
    const result = await this.run(COMPLETION_COMMAND, cursor, { resolveCount: MEMBER_RESOLVE_CAP });
    const { members, fallback } = this.mapMembers(result);
    // An answer made ENTIRELY of the editor's word-based fallback is not an
    // empty answer, and reporting it as one is what left "your file does not
    // parse" indistinguishable from "this receiver has no members". The
    // fallback items travel as evidence, never as surface: they carry no
    // signature, so nothing renders them, and semanticMembers drops them
    // wherever the set stands for the receiver's legal names.
    return members.length > 0 ? members : fallback;
  }

  /** The chain-surface warm: completeMembers' mapping at a resolve count wide
   *  enough to cover the provider's WHOLE order, so the LINQ verbs Roslyn
   *  parks at the tail (Where<> at position 113 of 115, measure-chains.md)
   *  come back with their resolved signatures. Fire-and-forget background use
   *  only — errors degrade to [], a warm has nobody to tell.
   *
   *  LANDMINE, noted for whoever ports this off the command API: a raw-LSP
   *  Roslyn completionItem/resolve sent WITHOUT itemDefaults.data merged into
   *  the item does not error — it KILLS the whole server process
   *  (Contract.Fail in CompletionResolveHandler, reproduced twice in the
   *  measure-chains spike). The vscode command path used here merges the
   *  defaults internally, which is the only reason this transport may resolve
   *  wide without that risk. */
  async resolveAllMembers(cursor: SourceCursor): Promise<CompletionMember[]> {
    try {
      const result = await this.run(COMPLETION_COMMAND, cursor, { resolveCount: CHAIN_WARM_RESOLVE_CAP });
      return this.mapMembers(result).members;
    } catch {
      return [];
    }
  }

  // The one mapping from a raw completion answer to core members, shared by
  // the per-keystroke path and the warm so the two can never drift.
  private mapMembers(result: unknown): { members: CompletionMember[]; fallback: CompletionMember[] } {
    const items = Array.isArray(result) ? result : ((result as { items?: unknown[] })?.items ?? []);
    const members: CompletionMember[] = [];
    const fallback: CompletionMember[] = [];
    for (const raw of items) {
      const item = raw as {
        label?: unknown;
        documentation?: unknown;
        detail?: unknown;
        labelDetails?: unknown;
        kind?: unknown;
      };
      const kind = csVscodeMemberKind(item.kind);
      if (kind === undefined) {
        if (item.kind === VSCODE_TEXT_KIND) {
          fallback.push({ name: labelText(item.label), kind: "text" });
        }
        continue; // keyword/snippet/text: never a member
      }
      members.push(
        toCsCompletionMember(labelText(item.label), docText(item.documentation), kind, preResolveDetail(item)),
      );
    }
    return { members, fallback };
  }

  async hoverSurface(cursor: SourceCursor): Promise<HoverSurface | undefined> {
    try {
      const hover = firstOf<{ contents?: unknown }>(await this.run(HOVER_COMMAND, cursor));
      if (!hover) {
        return undefined;
      }
      return parseCsHover(hoverMarkdown(hover.contents));
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
      // A LocationLink's targetRange spans the whole decompiled type (its leading
      // doc/attributes); the SELECTION range is the type-name token. Prefer
      // selection so a follow-up hover/membersOfType lands on the name, not the
      // doc comment — the same hazard the Rust/TS transports fixed.
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

  /** Where the workspace uses the symbol under the cursor, through the user's
   *  own Roslyn language server. `vscode.executeReferenceProvider` carries no
   *  reference context, so `includeDeclaration: false` is enforced HERE against
   *  the definition provider's answer for the same cursor, exactly as
   *  RaCommandExtractor documents at length. Never throws; every degrade is `[]`
   *  or one window fewer.
   *
   *  C# alone charges a FLOOR of about 500ms per answering query, warm, and it
   *  is not proportional to the answer (measure: 0 hits 1ms, 4 hits 503ms, 26
   *  hits 503ms) - Roslyn batching its streaming flush, which no request
   *  parameter shortens. No caller inside the 200ms FIM bar can spend this leg
   *  on C# synchronously. */
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

  // Always dark for C# (metadata-as-source carries no example): resolves
  // undefined WITHOUT dispatching ANY command — the contract pins zero runner
  // calls.
  async example(_cursor: SourceCursor, _prefer?: string): Promise<string | undefined> {
    return undefined;
  }

  async qualifyImport(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    try {
      const actions = await this.codeActionsAround(cursor);
      if (!actions) {
        return undefined;
      }
      // Prefer the fully-qualify action (the in-span rewrite) over the "using"
      // auto-import (which writes out of span). Ambiguity counts DISTINCT fix
      // identities — the title carries the namespace — so two namespaces
      // resolving the name yield no edit rather than an arbitrary pick.
      const qualify = actions.filter((a) => typeof a.title === "string" && isCsFullyQualifyTitle(a.title));
      if (new Set(qualify.map((a) => a.title)).size !== 1) {
        return undefined;
      }
      return sameFileSingleEdit(qualify[0].edit, cursor.uri);
    } catch {
      return undefined;
    }
  }

  // The out-of-span auto-import leg: Roslyn's AddImport `using X;` for an
  // unimported-but-reachable type, recognized by isCsAddImportAction. The vscode
  // command transport STRIPS the raw LSP `data`, so on this path the recognizer
  // keys on the `using ...;` title alone (the in-span fully-qualify title
  // "Atlas.Stripe" and "Generate type 'X'"/"Fix typo 'X'" all fail it). The
  // action's edit is an imports-region insertion (top of file), OUTSIDE the
  // function span — the caller routes it through offerOutOfSpanImport. Ambiguity
  // (two namespaces' using actions) counts DISTINCT titles and yields nothing.
  async importAction(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    try {
      const actions = await this.codeActionsAround(cursor);
      if (!actions) {
        return undefined;
      }
      const imports = actions.filter((a) => isCsAddImportAction(a));
      if (new Set(imports.map((a) => a.title)).size !== 1) {
        return undefined;
      }
      return sameFileSingleEdit(imports[0].edit, cursor.uri);
    } catch {
      return undefined;
    }
  }

  // The raw quickfix actions at the identifier WORD around `cursor` (widened via
  // the transport's own text reader), edits eagerly resolved for the first N.
  // undefined when the command did not return an array. Shared by qualifyImport
  // and importAction — the in-span fully-qualify and the out-of-span using come
  // from the SAME code-action request.
  private async codeActionsAround(
    cursor: SourceCursor,
  ): Promise<Array<{ title?: unknown; edit?: unknown; data?: unknown }> | undefined> {
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
    const actions = await this.run(
      CODE_ACTION_COMMAND,
      { ...cursor, character: start },
      { endCursor: { ...cursor, character: end }, resolveCount: ACTION_RESOLVE_CAP },
    );
    return Array.isArray(actions) ? (actions as Array<{ title?: unknown; edit?: unknown; data?: unknown }>) : undefined;
  }

  async membersOfType(defCursor: SourceCursor): Promise<CompletionMember[]> {
    // documentSymbol descent of the enclosing declaration (the product
    // transport's contract; the headless transport owns the resolve-scoped
    // signature-bearing path). The shared skeleton skips nested containers; its
    // Rust impl-sibling matching is inert here (no C# symbol is named
    // `impl ...`). Members build through the C# builder, which reduces the
    // Roslyn " : Type"-suffixed names to bare identifiers. NO object-statics
    // filter: documentSymbol is syntactic (declared members only), so a name
    // filter would only ever delete the developer's OWN ToString/Equals/
    // GetHashCode overrides — the declared surface is returned as-is.
    try {
      const symbols = await this.run(DOCUMENT_SYMBOL_COMMAND, defCursor);
      // The wrong-tree refusal. Roslyn answers a definition request for a type
      // reference with the reference's OWN position often enough that it is the
      // shape to defend against: the cursor then sits wherever the reference
      // was written - a method body, or a declaration HEAD (a base list, a
      // primary constructor parameter, a constraint, an attribute) - the
      // descent finds the ENCLOSING class, and its members render under
      // `to build a <the other type>:`. Refuse instead. A wrong surface is
      // worse than none.
      //
      // A member site (`stripe.|`) is NOT this shape and is not refused - it
      // sits on no identifier, which is the first fact the guard needs. Nor is
      // a C# syntax word, which is what a server answering a whole-declaration
      // span lands on. An absent text reader means no evidence and no refusal.
      const lineText = this.readText?.(defCursor.uri)?.split("\n")[defCursor.line];
      if (resolutionReachedWrongTree(symbols, defCursor, csVscodeSymbolRole, lineText)) {
        return [];
      }
      return membersFromDocumentSymbols(symbols, defCursor, csVscodeSymbolRole, toCsSymbolMember);
    } catch {
      return [];
    }
  }

  // The workspace-symbol resolution leg: a bare type NAME -> the cursor at its
  // definition's name token, via vscode.executeWorkspaceSymbolProvider. Roslyn's
  // workspace/symbol is fuzzy and returns SymbolInformation whose location.range
  // is the name token; selectCsTypeCursor narrows the hits to the exact-name TYPE
  // (preferring a workspace location), identical to the headless transport. A
  // throwing/absent symbol runner degrades to undefined (no fallback), never a
  // guess — the parity rule with the headless leg is the SELECTION, not the
  // transport error shape.
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
      const candidates = symbols.flatMap((s) => {
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
        return [{ name: s.name, role: csVscodeSymbolRole(s.kind), containerName, uri: uri.toString(), line: start.line, character: start.character }];
      });
      // The hint is spent only on an ambiguity: an unambiguous name resolves
      // through the same selection, at the same cost, without hovering anything.
      return await resolveCsTypeCursorWithHint(candidates, name, hint, async (cursor) => {
        try {
          return (await this.hoverSurface(cursor))?.signature;
        } catch {
          return undefined;
        }
      });
    } catch {
      return undefined;
    }
  }
}

// The fully-qualify workspace edit must touch exactly ONE file — the cursor's
// own — with exactly ONE text edit; anything wider is not the deterministic
// in-span single-edit contract.
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
