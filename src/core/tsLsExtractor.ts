/**
 * Headless TypeScript surface extractor, the test transport: owns an in-process
 * language service built from the PROJECT'S OWN typescript package (walk-up
 * resolution from projectRoot, exactly like tsOracle resolves its tsc; opts.ts
 * injects a module directly; no resolvable typescript is a named rejection,
 * never a bundled fallback - version honesty).
 *
 * NOT the product path: the product reuses the user's running TS server through
 * the vscode command API (src/vscode/tsExtractor.ts). Do not wire this into the
 * extension. Lives in src/core because it imports no vscode; the purity gate
 * forbids vscode, not the compiler API (this transport only - the CHECK oracle
 * spawns its compiler; in-process is permitted here).
 */

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
import type * as tsTypes from "typescript";
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
  TypeNameHint,
  WorkspaceSymbolCandidate,
  capReferences,
  selectSoleTypeCursor,
} from "./extraction";
import { toTsCompletionMember, tsElementMemberKind } from "./tsExtraction";

type TsModule = typeof tsTypes;

// Detail resolution is one language-service call per entry; a wide receiver
// (an Express req has 105 members) must not turn one completion into hundreds
// of checker queries. Entries past the cap stay members, signature-less.
const DETAIL_RESOLVE_CAP = 32;

// The unresolved-name diagnostic codes qualifyImport keys on: TS2304 "Cannot
// find name", TS2552 "Cannot find name, did you mean". The did-you-mean
// member variants (TS2662/TS2663) are excluded: their code-fix path assumes an
// enclosing class and crashes typescript 5.9 outside one.
const UNRESOLVED_NAME_CODES = new Set([2304, 2552]);

// navto ranks fuzzily and returns everything it can match, so the by-name leg
// asks for a bounded page rather than the whole index. Wide enough that the
// exact-name hits are never crowded out by camelCase matches: the filter keeps
// only `matchKind === "exact"`, and navto orders exact matches first.
const NAVTO_MAX_RESULTS = 256;

// The ScriptElementKind strings navto reports for a declaration that can be a
// TYPE. A same-named function, variable or property is not a construction
// surface and is not a candidate.
const TS_TYPE_ELEMENT_KINDS = new Set(["class", "interface", "enum", "type"]);

/** The project's own typescript module, resolved by walking up from the
 *  project root so hoisted monorepo installs (node_modules at the repo root)
 *  resolve - the same walk tsOracle uses for its tsc. */
function resolveProjectTs(projectRoot: string): TsModule | undefined {
  let dir = path.resolve(projectRoot);
  for (;;) {
    const pkg = path.join(dir, "node_modules", "typescript");
    if (fs.existsSync(path.join(pkg, "package.json"))) {
      // createRequire anchors resolution at the package itself, so the load
      // honors the package's own main entry regardless of how THIS module was
      // bundled (esbuild rewrites bare require; an anchored one stays live).
      return createRequire(path.join(pkg, "package.json"))(pkg) as TsModule;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** The named start-time rejection for a tsconfig that exists but cannot be
 *  read or parsed - the same named-error pattern as the missing-typescript
 *  case (TsResolveError), so callers can tell a broken config from a broken
 *  install by name. */
function tsConfigError(ts: TsModule, configPath: string, diags: readonly tsTypes.Diagnostic[]): Error {
  const detail = diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "; ")).join("; ");
  const err = new Error(`tsconfig at ${configPath} failed to read/parse: ${detail}`);
  err.name = "TsConfigError";
  return err;
}

function positionAt(text: string, offset: number): { line: number; character: number } {
  const bounded = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < bounded; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: bounded - lineStart };
}

export class TsLsExtractor implements SurfaceExtractor {
  private readonly service: tsTypes.LanguageService;
  // In-memory buffers over the disk state (unsaved editors). Keyed by resolved
  // fs path; the version bump is what invalidates the service's program.
  private readonly overlays = new Map<string, { text: string; version: number }>();
  private disposed = false;

  private constructor(
    private readonly ts: TsModule,
    projectRoot: string,
  ) {
    const configPath = path.join(projectRoot, "tsconfig.json");
    // A MISSING tsconfig runs under default options (the surface's contract).
    // A tsconfig that EXISTS but cannot be read or parsed is a named
    // start-time rejection: silently answering under options the project did
    // not choose (paths, jsx, strict all lost) would make every later surface
    // differ from the project's truth.
    const configExists = ts.sys.fileExists(configPath);
    const config = configExists ? ts.readConfigFile(configPath, ts.sys.readFile) : { config: {} };
    if (config.error) {
      throw tsConfigError(ts, configPath, [config.error]);
    }
    const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, projectRoot);
    if (configExists) {
      // Config-level failures (circular extends, bad option values) land in
      // parsed.errors. TS18003 "no inputs were found" is a project SHAPE (an
      // overlay-only project is legitimate), not a broken config - never a
      // rejection.
      const broken = parsed.errors.filter((e) => e.code !== 18003);
      if (broken.length > 0) {
        throw tsConfigError(ts, configPath, broken);
      }
    }
    const host: tsTypes.LanguageServiceHost = {
      getScriptFileNames: () => [...new Set([...parsed.fileNames.map((f) => path.resolve(f)), ...this.overlays.keys()])],
      getScriptVersion: (f) => String(this.overlays.get(path.resolve(f))?.version ?? 1),
      getScriptSnapshot: (f) => {
        const text = this.fileText(path.resolve(f));
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => projectRoot,
      getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (f) => this.overlays.has(path.resolve(f)) || ts.sys.fileExists(f),
      readFile: (f) => this.fileText(path.resolve(f)),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };
    this.service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  static async start(opts: { projectRoot: string; ts?: unknown }): Promise<TsLsExtractor> {
    const ts = (opts.ts as TsModule | undefined) ?? resolveProjectTs(opts.projectRoot);
    if (!ts || typeof ts.createLanguageService !== "function") {
      const err = new Error(
        `no typescript package resolvable walking up from ${opts.projectRoot} and none injected; ` +
          `refusing a bundled fallback (version honesty)`,
      );
      err.name = "TsResolveError";
      throw err;
    }
    const extractor = new TsLsExtractor(ts, path.resolve(opts.projectRoot));
    // Prime the program so the first primitive is not the one paying for the
    // full type graph. Purely the perf warm-up: a broken tsconfig never
    // reaches here - the constructor rejects it by name (TsConfigError).
    extractor.service.getProgram();
    return extractor;
  }

  openDocument(uri: string, text: string): void {
    const file = path.resolve(fileURLToPath(uri));
    const version = (this.overlays.get(file)?.version ?? 1) + 1;
    this.overlays.set(file, { text, version });
  }

  applyEdit(uri: string, newText: string): void {
    this.openDocument(uri, newText);
  }

  async whenReady(): Promise<void> {
    // Parity with the LSP transport's readiness gate; the in-process service
    // has no async indexing, so priming the program is the whole wait.
    if (!this.disposed) {
      this.service.getProgram();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    try {
      this.service.dispose();
    } catch {
      // a double-disposed registry must not make dispose itself throw
    }
  }

  async completeMembers(cursor: SourceCursor): Promise<CompletionMember[]> {
    if (this.disposed) {
      return [];
    }
    try {
      const loc = this.locate(cursor);
      if (!loc) {
        return [];
      }
      const completions = this.service.getCompletionsAtPosition(loc.file, loc.offset, {});
      // The member-set contract holds at member-access sites only; a fresh
      // position returns the in-scope world (1000+ entries), which is not a
      // member surface. The service's own flag is the gate.
      if (!completions || completions.isMemberCompletion !== true) {
        return [];
      }
      const members: CompletionMember[] = [];
      let resolved = 0;
      for (const entry of completions.entries) {
        const kind = tsElementMemberKind(entry.kind);
        if (kind === undefined) {
          continue; // loose inferred suggestion or keyword: never a member
        }
        let display: string | undefined;
        if (resolved < DETAIL_RESOLVE_CAP) {
          resolved++;
          try {
            const details = this.service.getCompletionEntryDetails(
              loc.file,
              loc.offset,
              entry.name,
              undefined,
              entry.source,
              undefined,
              entry.data,
            );
            if (details) {
              display = this.ts.displayPartsToString(details.displayParts);
            }
          } catch {
            // detail is best-effort; the member stays, signature-less
          }
        }
        members.push(toTsCompletionMember(entry.name, display, kind));
      }
      return members;
    } catch {
      return [];
    }
  }

  async hoverSurface(cursor: SourceCursor): Promise<HoverSurface | undefined> {
    if (this.disposed) {
      return undefined;
    }
    try {
      const loc = this.locate(cursor);
      if (!loc) {
        return undefined;
      }
      const info = this.service.getQuickInfoAtPosition(loc.file, loc.offset);
      if (!info) {
        return undefined;
      }
      // The signature is the quickinfo display text VERBATIM (contract), not a
      // re-render; doc is the documentation text. example never (signatures-only).
      const signature = this.ts.displayPartsToString(info.displayParts).trim();
      if (signature.length === 0) {
        return undefined;
      }
      const surface: HoverSurface = { signature };
      const doc = this.ts.displayPartsToString(info.documentation).trim();
      if (doc.length > 0) {
        surface.doc = doc;
      }
      return surface;
    } catch {
      return undefined;
    }
  }

  async definition(cursor: SourceCursor): Promise<DefinitionLocation | undefined> {
    if (this.disposed) {
      return undefined;
    }
    try {
      const loc = this.locate(cursor);
      if (!loc) {
        return undefined;
      }
      // getDefinitionAndBoundSpan's textSpan is already the declaration NAME
      // span (never the doc comment or body), which is what a follow-up
      // hoverSurface/membersOfType at the returned cursor needs.
      const def = this.service.getDefinitionAndBoundSpan(loc.file, loc.offset)?.definitions?.[0];
      if (!def) {
        return undefined;
      }
      const text = this.fileText(path.resolve(def.fileName));
      if (text === undefined) {
        return undefined;
      }
      const start = positionAt(text, def.textSpan.start);
      const end = positionAt(text, def.textSpan.start + def.textSpan.length);
      return {
        uri: pathToFileURL(def.fileName).href,
        range: {
          startLine: start.line,
          startCharacter: start.character,
          endLine: end.line,
          endCharacter: end.character,
        },
      };
    } catch {
      return undefined;
    }
  }

  /** Where the PROGRAM uses the symbol under the cursor. Program, not
   *  workspace: the language service only ever sees the files this tsconfig
   *  includes plus what they import, so a call site in a sibling project of a
   *  monorepo is invisible here and a caller wanting it must build the extractor
   *  at a root whose tsconfig reaches it.
   *
   *  `findReferences` rather than `getReferencesAtPosition`, which is the
   *  shorter call: the service has no includeDeclaration flag of its own (it
   *  always returns the declaration among the hits), so the flag is the
   *  transport's to honor or it does not exist at all, and only the grouped form
   *  says WHICH hit is the declaration. Not via the entry's `isDefinition`,
   *  which typescript 5.9 leaves undefined on every entry of a search started
   *  from a use site (measured): the group's own `definition` span is what
   *  carries it, and a search that spans an interface and its implementers
   *  returns one group per declaration.
   *
   *  Matching each entry against its OWN group's definition is not enough,
   *  though, and that is the shape this leg got wrong first. An overload set and
   *  a merged interface both put SEVERAL declarations in ONE group, so a
   *  per-group match drops one of them and hands the other back as a usage. What
   *  the caller then shows the model is a signature line offered as an example
   *  of how the repo CALLS the symbol, which is the opposite of this leg's
   *  purpose. So the declaration set is every group's definition span plus
   *  whatever `getDefinitionAtPosition` names at the cursor, which is the only
   *  thing that sees the second overload. */
  async references(cursor: SourceCursor, query?: ReferenceQuery): Promise<ReferenceLocation[]> {
    if (this.disposed) {
      return [];
    }
    try {
      const loc = this.locate(cursor);
      if (!loc) {
        return [];
      }
      const groups = this.service.findReferences(loc.file, loc.offset) ?? [];
      // Every declaration this symbol has, from both sources, keyed by
      // (resolved file, span start). `getDefinitionAtPosition` is what covers
      // the overload set and the merged interface; the group definitions cover
      // the interface-and-implementers spread.
      const declarations = new Set<string>();
      const declKey = (file: string, start: number): string => `${path.resolve(file)}\u0000${start}`;
      for (const group of groups) {
        if (group.definition !== undefined) {
          declarations.add(declKey(group.definition.fileName, group.definition.textSpan.start));
        }
      }
      // Guarded, because this is the one call here that a partial language
      // service may not implement, and losing the overload case is a smaller
      // failure than losing the whole answer.
      const atCursor =
        typeof this.service.getDefinitionAtPosition === "function"
          ? (this.service.getDefinitionAtPosition(loc.file, loc.offset) ?? [])
          : [];
      for (const def of atCursor) {
        declarations.add(declKey(def.fileName, def.textSpan.start));
      }
      // The span offsets are per FILE, so each hit file is read once and its
      // text held for the whole answer: a symbol with 200 call sites in 3 files
      // would otherwise pay 200 reads to convert 200 offsets.
      const texts = new Map<string, string | undefined>();
      const out: ReferenceLocation[] = [];
      for (const group of groups) {
        for (const entry of group.references) {
          const isDeclaration =
            entry.isDefinition === true || declarations.has(declKey(entry.fileName, entry.textSpan.start));
          if (isDeclaration && query?.includeDeclaration !== true) {
            continue;
          }
          const file = path.resolve(entry.fileName);
          if (!texts.has(file)) {
            texts.set(file, this.fileText(file));
          }
          const text = texts.get(file);
          if (text === undefined) {
            continue; // a hit in a file that vanished under us: drop it, never guess a position
          }
          const start = positionAt(text, entry.textSpan.start);
          const end = positionAt(text, entry.textSpan.start + entry.textSpan.length);
          out.push({
            uri: pathToFileURL(entry.fileName).href,
            line: start.line,
            character: start.character,
            endLine: end.line,
            endCharacter: end.character,
          });
        }
      }
      return capReferences(out, query?.maxResults);
    } catch {
      return [];
    }
  }

  // Always dark for TS: signatures-only injection is a locked scope decision,
  // not a missing feature. prefer is deliberately ignored.
  async example(_cursor: SourceCursor, _prefer?: string): Promise<string | undefined> {
    return undefined;
  }

  async qualifyImport(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    if (this.disposed) {
      return undefined;
    }
    try {
      const loc = this.locate(cursor);
      if (!loc) {
        return undefined;
      }
      const text = this.fileText(loc.file);
      if (text === undefined) {
        return undefined;
      }
      // Only a REAL unresolved-name diagnostic under the identifier qualifies:
      // getCodeFixesAtPosition trusts the caller's error codes and happily
      // offers import fixes for a name that already resolves, so the
      // diagnostic check is what makes "already resolves -> undefined" hold.
      const word = this.identifierSpan(text, loc.offset);
      const diag = this.service
        .getSemanticDiagnostics(loc.file)
        .find(
          (d) =>
            UNRESOLVED_NAME_CODES.has(d.code) &&
            d.start !== undefined &&
            d.length !== undefined &&
            d.start < word.end &&
            d.start + d.length > word.start,
        );
      if (!diag || diag.start === undefined || diag.length === undefined) {
        return undefined;
      }
      const fixes = this.service.getCodeFixesAtPosition(
        loc.file,
        diag.start,
        diag.start + diag.length,
        [diag.code],
        this.ts.getDefaultFormatCodeSettings("\n"),
        {},
      );
      // Deterministic means UNAMBIGUOUS: one candidate module, one file, one
      // edit. The service repeats an identical fix per triggering code, so
      // ambiguity is counted over distinct descriptions, not raw fixes.
      const importFixes = fixes.filter((f) => f.fixName === "import");
      if (new Set(importFixes.map((f) => f.description)).size !== 1) {
        return undefined;
      }
      const changes = importFixes[0].changes;
      if (changes.length !== 1 || path.resolve(changes[0].fileName) !== loc.file || changes[0].textChanges.length !== 1) {
        return undefined;
      }
      const edit = changes[0].textChanges[0];
      const start = positionAt(text, edit.span.start);
      const end = positionAt(text, edit.span.start + edit.span.length);
      return {
        range: {
          startLine: start.line,
          startCharacter: start.character,
          endLine: end.line,
          endCharacter: end.character,
        },
        newText: edit.newText,
      };
    } catch {
      return undefined;
    }
  }

  async membersOfType(defCursor: SourceCursor): Promise<CompletionMember[]> {
    if (this.disposed) {
      return [];
    }
    try {
      const loc = this.locate(defCursor);
      if (!loc) {
        return [];
      }
      const program = this.service.getProgram();
      const sourceFile = program?.getSourceFile(loc.file);
      if (!program || !sourceFile) {
        return [];
      }
      const decl = this.enclosingTypeDeclaration(sourceFile, loc.offset);
      if (!decl || !decl.name) {
        return [];
      }
      const checker = program.getTypeChecker();
      const symbol = checker.getSymbolAtLocation(decl.name);
      if (!symbol) {
        return [];
      }
      // Type-scoped via the checker (contract): getPropertiesOfType resolves
      // the APPARENT member set, so extends chains contribute inherited
      // members that a syntactic documentSymbol descent would miss. EXCEPT
      // enums: an enum symbol's declared type is the union of its member
      // literal types, whose apparent properties are Number.prototype
      // (toFixed, ...), not the variants - the enum's own members are the
      // EXPORTS of the enum symbol, so they take their own path.
      const props = this.ts.isEnumDeclaration(decl)
        ? Array.from(symbol.exports?.values() ?? [])
        : checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol));
      const members: CompletionMember[] = [];
      for (const prop of props) {
        if (this.isNonPublic(prop)) {
          continue;
        }
        const kind = this.symbolMemberKind(prop);
        const propDecl = prop.declarations?.[0] ?? prop.valueDeclaration;
        const propType = checker.getTypeOfSymbolAtLocation(prop, propDecl ?? decl.name);
        let signature: string | undefined;
        if (kind === "method" || kind === "function") {
          const call = propType.getCallSignatures()[0];
          signature = call ? `${prop.name}${checker.signatureToString(call)}` : undefined;
        } else {
          signature = `${prop.name}: ${checker.typeToString(propType)}`;
        }
        const member: CompletionMember = { name: prop.name, kind };
        if (signature !== undefined) {
          member.signature = signature;
        }
        members.push(member);
      }
      return members;
    } catch {
      return [];
    }
  }

  /** The by-name resolution leg: a bare type NAME -> the cursor at its
   *  declaration's name token. The product transport's headless sibling, and it
   *  answers from `getNavigateToItems` - the same source the TypeScript
   *  extension's own workspace-symbol provider uses, so the two transports see
   *  the same hit list.
   *
   *  navto is fuzzy by design: a query for "Tile" also returns TileSite and
   *  tileFromMorton, under `matchKind` "prefix"/"substring"/"camelCase". Only an
   *  exact case-sensitive match is a candidate, and only a TYPE kind - a
   *  same-named function is not the thing a construction surface was asked for.
   *
   *  A `.d.ts` hit is kept but ranked BELOW real source, the analogue of the C#
   *  leg preferring a workspace location over decompiled metadata: a project
   *  that emits declarations otherwise reports its own class twice and refuses
   *  itself. When only the declaration exists (an ambient or packaged type) it
   *  is still the answer. */
  async resolveTypeCursorByName(name: string, hint?: TypeNameHint): Promise<SourceCursor | undefined> {
    if (this.disposed) {
      return undefined;
    }
    try {
      const hits = this.service
        .getNavigateToItems(name, NAVTO_MAX_RESULTS)
        .filter((i) => i.name === name && i.matchKind === "exact" && TS_TYPE_ELEMENT_KINDS.has(i.kind));
      const source = hits.filter((i) => !i.fileName.endsWith(".d.ts"));
      const candidates: WorkspaceSymbolCandidate[] = [];
      for (const hit of source.length > 0 ? source : hits) {
        const text = this.fileText(path.resolve(hit.fileName));
        if (text === undefined) {
          continue;
        }
        const at = positionAt(text, hit.textSpan.start);
        candidates.push({
          name: hit.name,
          role: "container",
          containerName: hit.containerName ?? "",
          uri: pathToFileURL(hit.fileName).href,
          line: at.line,
          character: at.character,
        });
      }
      return selectSoleTypeCursor(candidates, name, hint);
    } catch {
      return undefined;
    }
  }

  // ---- internals ----

  private fileText(file: string): string | undefined {
    return this.overlays.get(file)?.text ?? this.ts.sys.readFile(file);
  }

  /** The hierarchical symbol tree for a file, in the LSP DocumentSymbol shape.
   *  ORACLE/RIG ONLY, the sibling of the C# and Rust transports' accessor: the
   *  measurement rig has no vscode command API, and `resolvePrefill`'s RECEIVER
   *  leg reads `resolved.symbols` and degrades to nothing without it.
   *
   *  Built from `getNavigationTree`, the same source the TypeScript extension's
   *  own symbol provider uses, so the rig sees what the product sees.
   *
   *  KIND NUMBERING IS THE LSP'S, not vscode's - every transport's accessor
   *  answers in the LSP's so one translation in the rig serves all three. */
  async documentSymbolsForTest(uri: string): Promise<unknown> {
    const file = path.resolve(fileURLToPath(uri));
    const sourceFile = this.service.getProgram()?.getSourceFile(file);
    if (!sourceFile) {
      return [];
    }
    const at = (pos: number) => {
      const lc = sourceFile.getLineAndCharacterOfPosition(pos);
      return { line: lc.line, character: lc.character };
    };
    // ScriptElementKind is a STRING enum; only the kinds a container walk can
    // act on are mapped, and anything else answers Variable rather than a
    // guessed container - naming a non-container as one would put a module's
    // name where a type's belongs.
    const LSP_KIND: Record<string, number> = {
      class: 5, interface: 11, enum: 10, "enum member": 22, type: 26,
      method: 6, function: 12, property: 7, getter: 7, setter: 7,
      constructor: 9, module: 2, var: 13, let: 13, const: 14, parameter: 13,
    };
    const walk = (node: tsTypes.NavigationTree): unknown => {
      const span = node.spans[0] ?? { start: 0, length: 0 };
      const nameSpan = node.nameSpan ?? span;
      return {
        name: node.text,
        kind: LSP_KIND[node.kind] ?? 13,
        range: { start: at(span.start), end: at(span.start + span.length) },
        selectionRange: { start: at(nameSpan.start), end: at(nameSpan.start + nameSpan.length) },
        children: (node.childItems ?? []).map(walk),
      };
    };
    const root = this.service.getNavigationTree(file);
    // The root node is the SOURCE FILE itself; the product's provider returns
    // its children, so returning the root would wrap every real symbol in a
    // container enclosing the whole document.
    return (root?.childItems ?? []).map(walk);
  }

  private locate(cursor: SourceCursor): { file: string; offset: number } | undefined {
    const file = path.resolve(fileURLToPath(cursor.uri));
    const text = this.fileText(file);
    if (text === undefined) {
      return undefined;
    }
    const lines = text.split("\n");
    if (cursor.line < 0 || cursor.line >= lines.length) {
      return undefined;
    }
    let offset = 0;
    for (let l = 0; l < cursor.line; l++) {
      offset += lines[l].length + 1;
    }
    return { file, offset: offset + Math.min(Math.max(cursor.character, 0), lines[cursor.line].length) };
  }

  private identifierSpan(text: string, offset: number): { start: number; end: number } {
    const isWord = (c: string) => /[A-Za-z0-9_$]/.test(c);
    let start = offset;
    while (start > 0 && isWord(text[start - 1])) {
      start--;
    }
    let end = offset;
    while (end < text.length && isWord(text[end])) {
      end++;
    }
    return { start, end };
  }

  /** The innermost class/interface/enum/type-alias declaration whose span
   *  contains the offset; undefined when the cursor is not within a type
   *  declaration (a function, a blank line) - the honest degrade. */
  private enclosingTypeDeclaration(
    sourceFile: tsTypes.SourceFile,
    offset: number,
  ): (tsTypes.Declaration & { name?: tsTypes.Identifier }) | undefined {
    const ts = this.ts;
    let deepest: tsTypes.Node = sourceFile;
    const visit = (node: tsTypes.Node): void => {
      if (node.getStart(sourceFile) <= offset && offset < node.end) {
        deepest = node;
        ts.forEachChild(node, visit);
      }
    };
    ts.forEachChild(sourceFile, visit);
    let node: tsTypes.Node | undefined = deepest;
    while (node) {
      if (
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)
      ) {
        return node as tsTypes.Declaration & { name?: tsTypes.Identifier };
      }
      node = node.parent;
    }
    return undefined;
  }

  /** Public visibility per the checker's modifier flags; #private names carry
   *  no modifier but mangle to __#, so both spellings are excluded. The
   *  checker also escapes symbol-keyed and computed members to internal names
   *  (`__@iterator@12`, and exactly `__computed`) - those are not spellable
   *  member names (`x.__@iterator@12()` is not TypeScript), so emitting them
   *  would fabricate a member; same filter family. `__computed` matches
   *  EXACTLY: a legitimate member the user named `__computedTotal` must
   *  surface. */
  private isNonPublic(symbol: tsTypes.Symbol): boolean {
    if (
      symbol.name.startsWith("__#") ||
      symbol.name.startsWith("#") ||
      symbol.name.startsWith("__@") ||
      symbol.name === "__computed"
    ) {
      return true;
    }
    const nonPublic = this.ts.ModifierFlags.Private | this.ts.ModifierFlags.Protected;
    return (symbol.declarations ?? []).some(
      (d) => (this.ts.getCombinedModifierFlags(d) & nonPublic) !== 0,
    );
  }

  private symbolMemberKind(symbol: tsTypes.Symbol): MemberKind {
    const flags = symbol.flags;
    const ts = this.ts;
    if (flags & ts.SymbolFlags.Method) {
      return "method";
    }
    if (flags & (ts.SymbolFlags.Property | ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor | ts.SymbolFlags.EnumMember)) {
      return "field";
    }
    if (flags & ts.SymbolFlags.Function) {
      return "function";
    }
    return "other";
  }
}
