/**
 * Headless Python surface extractor, the test transport: spawns
 * `pyright-langserver --stdio` from the npm dep (resolved the SAME way PyOracle
 * resolves its pyright CLI, so there is zero version skew between checker and
 * resolver) and drives it via raw LSP — the csLspExtractor / tsLsExtractor analog.
 * This is the signature-bearing transport the live oracle drives (real member
 * sets on a broken buffer, real completionItem/resolve signatures, the real
 * doctest example, the real Any-receiver darkness), the falsification the
 * fake-runner unit suite cannot reach.
 *
 * NOT the product path: the product reuses the user's running Pylance through the
 * vscode command API (src/vscode/pyExtractor.ts). This spawns its own process,
 * fine for a test but a rival in the extension. Do not wire it into extractorFor.
 *
 * Lives in src/core because it bundles headless and imports no vscode; the purity
 * gate forbids vscode, not child_process. All member/kind rendering delegates to
 * the Python-shaped pure helpers (pyExtraction) so both transports render
 * byte-identically (the parity bar).
 *
 * pyright mechanics honored (verified against the live server):
 *  - NO project/open ceremony — pyright needs no manifest and no custom protocol;
 *  - answer server->client workspace/configuration pulls for `python`,
 *    `python.analysis`, `pyright` (config-pull `pythonPath` feeds the interpreter;
 *    the deterministic core resolves local source + typeshed + `json` with a
 *    venv-less answer);
 *  - readiness has no projectInitializationComplete: wait on the first
 *    publishDiagnostics for the opened doc, then bounded completion retries absorb
 *    the cold-index race;
 *  - the completion signature rides `documentation` (a ```python fence), filled on
 *    completionItem/resolve; dunders are filtered PRE-resolve so the budget is
 *    spent on real members.
 */

import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
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
  MemberSurfaceOptions,
  membersWithHoverSignatures,
  hoverBackfillOptions,
  selectSoleTypeCursor,
  toReferenceLocations,
  workspaceSymbolCandidates,
} from "./extraction";
import {
  isDunder,
  isPyAutoImportTitle,
  parsePyHover,
  pyLspMemberKind,
  pyLspSymbolRole,
  toPyCompletionMember,
  toPySymbolMember,
} from "./pyExtraction";

// A backstop against a wedged LS: a request that never gets a reply rejects
// instead of hanging the caller (and the test process) forever.
const REQUEST_TIMEOUT_MS = 60_000;

// pyright defers the completion signature to completionItem/resolve (it rides
// `documentation`), so a member LIST resolves the first N for breadth. pyright
// resolves at ~2ms/item, so full signatures fit the race.
const MEMBER_RESOLVE_CAP = 32;
// A freshly-indexed doc can lag completion by a few hundred ms; bounded retries
// on an empty member-site result absorb the race without masking a genuinely
// empty (Any-receiver) set.
const COMPLETION_RETRIES = 6;
// Bounded poll for the first publishDiagnostics on a doc, the coarse readiness
// gate (pyright emits no projectInitializationComplete).
const READY_POLLS = 60;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface LspTextEdit {
  range: LspRange;
  newText: string;
}

interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<{ edits?: LspTextEdit[] }>;
}

interface LspMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface PyLspStartOptions {
  projectRoot: string;
  // The pyright-langserver entry. `serverPath`/`server` are accepted (the blind
  // suite passes both to the same value); default resolves the npm dep beside
  // this module the way PyOracle resolves its CLI.
  serverPath?: string;
  server?: string;
  // The interpreter fed as `python.pythonPath` in the config-pull answer. When
  // absent, a venv beside the root is resolved; when neither, pyright falls back
  // to system python (the deterministic core needs no venv).
  pythonPath?: string;
  // `openFilesOnly` (default) serves member/hover/definition without the
  // workspace-mode cost; `workspace` lights rung-1 auto-import in tests.
  diagnosticMode?: "openFilesOnly" | "workspace";
}

export class PyLspExtractor implements SurfaceExtractor {
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private readonly versions = new Map<string, number>();
  // Last text sent for each uri, so the member-site gate can read the line under
  // the cursor and incremental didChange can diff against the prior buffer.
  private readonly texts = new Map<string, string>();
  // Uris that have received at least one publishDiagnostics (the readiness gate).
  private readonly diagsReceived = new Set<string>();
  private readonly settled = new Set<string>();
  private initialized = false;
  private dead: Error | undefined;
  private readonly pythonPath?: string;
  private readonly diagnosticMode: "openFilesOnly" | "workspace";

  private constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    pythonPath: string | undefined,
    diagnosticMode: "openFilesOnly" | "workspace",
  ) {
    this.pythonPath = pythonPath;
    this.diagnosticMode = diagnosticMode;
    proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    proc.stderr.on("data", () => {}); // pyright logs to stderr; not the oracle's concern
    proc.on("error", (err) => this.failAll(new Error(`pyright LS process error: ${err.message}`)));
    proc.on("exit", (code, signal) =>
      this.failAll(new Error(`pyright LS exited before replying (code=${code}, signal=${signal})`)),
    );
  }

  // Reject every in-flight request with the terminal error and refuse new ones.
  private failAll(err: Error): void {
    if (!this.dead) {
      this.dead = err;
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(this.dead);
    }
    this.pending.clear();
  }

  static async start(opts: PyLspStartOptions): Promise<PyLspExtractor> {
    // An explicit serverPath is an EXECUTABLE and is spawned as one, which is
    // what the blind suite's fake-server shims rely on. The default is a .js
    // entry, so it goes through the host's own node the way PyOracle runs the
    // pyright CLI: process.execPath under ELECTRON_RUN_AS_NODE, inert when the
    // host is plain node.
    const override = opts.serverPath ?? opts.server;
    const proc =
      override !== undefined
        ? spawn(override, ["--stdio"], {
            cwd: opts.projectRoot,
            stdio: ["pipe", "pipe", "pipe"],
          })
        : spawn(process.execPath, [resolveServerEntry(), "--stdio"], {
            cwd: opts.projectRoot,
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          });
    const pythonPath = opts.pythonPath ?? resolveInterpreter(opts.projectRoot);
    const diagnosticMode = opts.diagnosticMode ?? "openFilesOnly";
    const client = new PyLspExtractor(proc, pythonPath, diagnosticMode);
    const rootUri = pathToUri(opts.projectRoot);
    await client.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "py-extraction" }],
      capabilities: {
        window: { workDoneProgress: true },
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: true,
              // The signature rides `documentation` as a ```python fence
              // (captured live). Advertise markdown so pyright fences it and the
              // pure helper parses the fence body; detail stays undefined.
              documentationFormat: ["markdown", "plaintext"],
              resolveSupport: { properties: ["documentation", "detail"] },
            },
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          definition: { linkSupport: true },
          references: {},
          codeAction: {
            codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } },
            resolveSupport: { properties: ["edit"] },
          },
        },
      },
    });
    client.notify("initialized", {});
    // Push the settings once so they land before the first query, in addition
    // to answering the server's configuration pulls.
    client.notify("workspace/didChangeConfiguration", {
      settings: {
        python: { analysis: { useLibraryCodeForTypes: true, diagnosticMode } },
      },
    });
    client.initialized = true;
    return client;
  }

  openDocument(uri: string, text: string): void {
    this.versions.set(uri, 1);
    this.texts.set(uri, text);
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "python", version: 1, text },
    });
  }

  applyEdit(uri: string, newText: string): void {
    const old = this.texts.get(uri);
    if (old === undefined) {
      this.openDocument(uri, newText);
      return;
    }
    const version = (this.versions.get(uri) ?? 1) + 1;
    this.versions.set(uri, version);
    this.texts.set(uri, newText);
    // Incremental sync: send a single ranged change spanning the differing
    // middle (copied from csLspExtractor; pyright accepts incremental).
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [incrementalChange(old, newText)],
    });
  }

  // Lazily open a document from disk the first time it is queried, so a caller
  // that only named the root (never pushed a buffer) still gets served.
  private ensureOpen(uri: string): void {
    if (this.versions.has(uri)) {
      return;
    }
    let text: string;
    try {
      text = fs.readFileSync(fileURLToPath(uri), "utf8");
    } catch {
      return; // not on disk and not pushed: the request degrades honestly
    }
    this.openDocument(uri, text);
  }

  // Open the doc and wait for pyright to index it (the first publishDiagnostics),
  // then a small settle so the first query is not racing the cold index.
  private async ready(uri: string): Promise<void> {
    this.ensureOpen(uri);
    for (let i = 0; i < READY_POLLS; i++) {
      if (this.dead || this.diagsReceived.has(uri)) {
        break;
      }
      await delay(150);
    }
    if (!this.settled.has(uri)) {
      await delay(300);
      this.settled.add(uri);
    }
  }

  async whenReady(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.dead) {
        throw this.dead;
      }
      if (this.initialized) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error("pyright LS did not initialize before the timeout");
      }
      await delay(100);
    }
  }

  async completeMembers(cursor: SourceCursor): Promise<CompletionMember[]> {
    this.ensureOpen(cursor.uri);
    // Member-site gate (the csLspExtractor pattern): the LS returns the in-scope
    // world at a non-member position, so proceed only when the text before the
    // cursor is an identifier-dot shape. `[]` is the honest "no members" AND a
    // dead server REJECTS (via request), never a false empty (load-bearing).
    const line = (this.texts.get(cursor.uri)?.split("\n")[cursor.line] ?? "").slice(0, cursor.character);
    if (!/\.[A-Za-z0-9_$]*$/.test(line)) {
      return [];
    }
    await this.ready(cursor.uri);
    const triggerChar = line.endsWith(".") ? "." : undefined;
    for (let attempt = 0; attempt <= COMPLETION_RETRIES; attempt++) {
      const members = await this.completeOnce(cursor, triggerChar);
      if (members.length > 0 || attempt === COMPLETION_RETRIES) {
        return members;
      }
      await delay(150);
    }
    return [];
  }

  private async completeOnce(cursor: SourceCursor, triggerChar: string | undefined): Promise<CompletionMember[]> {
    const raw = await this.request("textDocument/completion", {
      textDocument: { uri: cursor.uri },
      position: { line: cursor.line, character: cursor.character },
      context: triggerChar ? { triggerKind: 2, triggerCharacter: triggerChar } : { triggerKind: 1 },
    });
    const items = (Array.isArray(raw) ? raw : ((raw as { items?: unknown[] })?.items ?? [])) as Array<{
      label?: unknown;
      kind?: unknown;
      documentation?: unknown;
    }>;
    const members: CompletionMember[] = [];
    let resolved = 0;
    for (const item of items) {
      const kind = pyLspMemberKind(item.kind);
      if (kind === undefined) {
        continue; // keyword/snippet/text: never a member
      }
      const label = typeof item.label === "string" ? item.label : "";
      // Dunder filter BEFORE resolve: the ~25 dunders of a wide set must not
      // eat the resolve budget, so drop them by name first.
      if (isDunder(label)) {
        continue;
      }
      let documentation = item.documentation;
      if (documentation === undefined && resolved < MEMBER_RESOLVE_CAP) {
        resolved++;
        try {
          const full = (await this.request("completionItem/resolve", item)) as { documentation?: unknown };
          documentation = full?.documentation;
        } catch {
          // resolve failed: the member stays, signature-less
        }
      }
      members.push(toPyCompletionMember(label, documentation, kind));
    }
    return members;
  }

  async hoverSurface(cursor: SourceCursor): Promise<HoverSurface | undefined> {
    await this.ready(cursor.uri);
    const result = (await this.request("textDocument/hover", {
      textDocument: { uri: cursor.uri },
      position: { line: cursor.line, character: cursor.character },
    })) as { contents?: unknown } | null;
    if (!result || result.contents === undefined || result.contents === null) {
      return undefined;
    }
    return parsePyHover(hoverMarkdown(result.contents));
  }

  async definition(cursor: SourceCursor): Promise<DefinitionLocation | undefined> {
    await this.ready(cursor.uri);
    const result = await this.request("textDocument/definition", {
      textDocument: { uri: cursor.uri },
      position: { line: cursor.line, character: cursor.character },
    });
    const loc = (Array.isArray(result) ? result[0] : result) as
      | { uri?: string; range?: LspRange; targetUri?: string; targetRange?: LspRange; targetSelectionRange?: LspRange }
      | undefined;
    if (!loc) {
      return undefined;
    }
    const uri = loc.uri ?? loc.targetUri;
    // Prefer the selection range (the name) over the full range (the whole stub
    // symbol span) — the LocationLink lesson shared with the product transports.
    const range = loc.range ?? loc.targetSelectionRange ?? loc.targetRange;
    if (!uri || !range) {
      return undefined;
    }
    return {
      uri,
      range: {
        startLine: range.start.line,
        startCharacter: range.start.character,
        endLine: range.end.line,
        endCharacter: range.end.character,
      },
    };
  }

  // Where the workspace uses the symbol under the cursor. pyright honors
  // `includeDeclaration` itself, so nothing is filtered here.
  //
  // The answer spans the WORKSPACE and not just the open files, measured under
  // the default `openFilesOnly` mode: that setting bounds which files pyright
  // reports diagnostics for, not which files it will search. The first query
  // pays for the search (~600ms on the dogfood tree), every later one is ~1ms,
  // so the cost sits on whoever asks first rather than on a start-up index.
  async references(cursor: SourceCursor, query?: ReferenceQuery): Promise<ReferenceLocation[]> {
    try {
      await this.ready(cursor.uri);
      const reply = await this.request("textDocument/references", {
        textDocument: { uri: cursor.uri },
        position: { line: cursor.line, character: cursor.character },
        context: { includeDeclaration: query?.includeDeclaration === true },
      });
      return toReferenceLocations(reply, query?.maxResults);
    } catch {
      return [];
    }
  }

  // Conditionally LIT: dispatch hover at the cursor and return the doctest IFF
  // the payload carried a `>>>` fence. No source-kind
  // guess — the literal presence of the doctest is the condition, so
  // site-packages/source doctests light and stdlib (typeshed, no docstring) stays
  // dark by the same code path.
  async example(cursor: SourceCursor, _prefer?: string): Promise<string | undefined> {
    const surface = await this.hoverSurface(cursor);
    return surface?.example;
  }

  async qualifyImport(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    await this.ready(cursor.uri);
    // Rung 1 — workspace-mode auto-import: a completion candidate for the
    // undefined name carrying an imports-region additionalTextEdit. Single
    // unambiguous hit only; dark otherwise. (Rung 2, the owned inserter, lives in
    // the repair layer; rung 3 is the pyright code action below.)
    const rung1 = await this.autoImportFromCompletion(cursor);
    if (rung1 !== undefined) {
      return rung1;
    }
    return this.autoImportFromCodeAction(cursor);
  }

  private async autoImportFromCompletion(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    const name = this.wordAt(cursor);
    if (name.length === 0) {
      return undefined;
    }
    let raw: unknown;
    try {
      raw = await this.request("textDocument/completion", {
        textDocument: { uri: cursor.uri },
        position: { line: cursor.line, character: cursor.character },
        context: { triggerKind: 1 },
      });
    } catch {
      return undefined;
    }
    const items = (Array.isArray(raw) ? raw : ((raw as { items?: unknown[] })?.items ?? [])) as Array<{
      label?: unknown;
      additionalTextEdits?: LspTextEdit[];
      data?: unknown;
    }>;
    const edits = new Map<string, QualifyEdit>();
    for (const item of items) {
      if (item.label !== name || !Array.isArray(item.additionalTextEdits) || item.additionalTextEdits.length === 0) {
        continue;
      }
      const te = item.additionalTextEdits[0];
      const edit = toQualifyEdit(te);
      if (edit) {
        edits.set(te.newText.trim(), edit); // dedupe re-exports resolving identically
      }
    }
    return edits.size === 1 ? [...edits.values()][0] : undefined;
  }

  private async autoImportFromCodeAction(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    const range = this.identifierRange(cursor);
    let raw: unknown;
    try {
      raw = await this.request("textDocument/codeAction", {
        textDocument: { uri: cursor.uri },
        range,
        context: { diagnostics: [], only: ["quickfix"] },
      });
    } catch {
      return undefined;
    }
    const actions = (Array.isArray(raw) ? raw : []) as Array<{ title?: string; edit?: LspWorkspaceEdit; data?: unknown }>;
    // Ambiguity counts DISTINCT titles (each carries the module), so two modules
    // resolving the name yield nothing rather than an arbitrary pick.
    const imports = actions.filter((a) => typeof a.title === "string" && isPyAutoImportTitle(a.title));
    if (new Set(imports.map((a) => a.title)).size !== 1) {
      return undefined;
    }
    let chosen = imports[0];
    if (!chosen.edit && chosen.data !== undefined) {
      try {
        chosen = (await this.request("codeAction/resolve", chosen)) as typeof chosen;
      } catch {
        return undefined;
      }
    }
    return firstEditOf(chosen.edit);
  }

  /** The raw document-symbol tree for a file, for a HEADLESS CALLER that has to
   *  build a `ResolvedFunction` by hand.
   *
   *  Not part of `SurfaceExtractor` and not used by the product: in the editor
   *  the span is resolved OUT of this tree, so `ResolvedFunction.symbols`
   *  already carries it and the pre-fill's receiver leg reads it there. A rig
   *  that assembles records from a manifest has no such tree, and the field's
   *  own contract is that absent means "no tree" and the readers degrade. So the
   *  leg goes dark silently, and the rig reports an empty surface as if the
   *  product had produced one.
   *
   *  Measured on the session-v51 Python corpus: 71 of 80 product-source rows sit
   *  inside a class, against 2 whose signature names a corpus type. The receiver
   *  is the leg that carries Python, and it was the leg no Python row could
   *  exercise. Same three lines as the C# and TypeScript transports carry, added
   *  for the same reason and after the same symptom.
   *
   *  KIND NUMBERING IS THE LSP'S, not vscode's; the two differ by one, and every
   *  transport's accessor answers in the LSP's so one translation in the rig
   *  serves all of them. */
  async documentSymbolsForTest(uri: string): Promise<unknown> {
    await this.ready(uri);
    return this.request("textDocument/documentSymbol", { textDocument: { uri } });
  }

  async membersOfType(
    defCursor: SourceCursor,
    budgetMs?: number,
    opts?: MemberSurfaceOptions,
  ): Promise<CompletionMember[]> {
    await this.ready(defCursor.uri);
    // documentSymbol is AST-syntactic (available once the file is open). The
    // Python role table keeps class-body Variables (attributes) and treats a
    // function as a non-container, so a method's body-locals are structurally
    // excluded from the class's member set (the locals filter).
    const symbols = await this.request("textDocument/documentSymbol", {
      textDocument: { uri: defCursor.uri },
    });
    // THE HOVER BACKFILL, and it is what makes this transport the product's.
    //
    // Pyright fills `detail` on NOTHING - not fields, not methods - so a bare
    // documentSymbol descent returns a member set in which every member has a
    // name and no signature, and `renderMemberSignatures` drops every one. The
    // type resolves and its surface is empty.
    //
    // Measured, live, on `mcp-graph-engine` while taking the session-v49 phase 0
    // baseline: membersOfType(GraphEngine) answered 38 members and the walk
    // rendered 0, on 7 of 7 real classes. That is not a Python fact - the
    // PRODUCT transport (src/vscode/pyExtractor.ts) has always backfilled
    // through this same helper, against Pylance's identical empty `detail`.
    // This class had the comment "the headless transport owns its own signature
    // path" written about it and owned no such path.
    //
    // It matters because this transport is the instrument every headless Python
    // measurement runs on, and an instrument that renders nothing measures a leg
    // the product does not have (`harness-must-use-the-product-mapping`). Same
    // helper, same caps, same budget as the product: no new dependency, and no
    // second answer to "what are this type's members" that could disagree.
    return await membersWithHoverSignatures(
      symbols,
      defCursor,
      pyLspSymbolRole,
      toPySymbolMember,
      async (at) => (await this.hoverSurface(at))?.signature,
      hoverBackfillOptions(budgetMs, opts),
    );
  }

  /** The by-name resolution leg: a bare type NAME -> the cursor at its
   *  definition's name token. The product transport's headless sibling, over
   *  pyright's `workspace/symbol`, whose SymbolInformation.location.range is
   *  the NAME token - so the cursor feeds membersOfType directly.
   *
   *  The hit list is fuzzy, so `selectSoleTypeCursor` narrows to the exact-name
   *  CLASS and refuses two distinct declaration sites rather than guessing.
   *  Pyright answers a stub and its implementation at the same position often
   *  enough that the selection collapses identical positions first; two
   *  genuinely different classes stay ambiguous, and ambiguous means nothing
   *  resolves.
   *
   *  MEASURED LIVE against a real pyright-langserver, and one property of it is
   *  a rig fact worth stating: pyright answers `workspace/symbol` with `[]`
   *  until some file in the project has been opened, and answers the full fuzzy
   *  list immediately after. Every other primitive here opens its own file
   *  first; this one has no uri to open, so a resolution asked before anything
   *  else resolves nothing. That is invisible in the editor, where the user's
   *  buffer is open by definition, and it is exactly the shape that makes a
   *  headless measurement read as "the leg is dark" when the instrument simply
   *  never armed it. Once open, `location.range` IS the name token and the hit
   *  list carries the enclosing scope in `containerName` (`Tile`,
   *  `Fim.TileSite`), empty for a top-level class. */
  async resolveTypeCursorByName(name: string, hint?: TypeNameHint): Promise<SourceCursor | undefined> {
    try {
      const candidates = workspaceSymbolCandidates(
        await this.request("workspace/symbol", { query: name }),
        pyLspSymbolRole,
      );
      return selectSoleTypeCursor(candidates, name, hint);
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    this.proc.kill();
  }

  // The identifier word around the cursor, from the stored buffer text.
  private wordAt(cursor: SourceCursor): string {
    const line = this.texts.get(cursor.uri)?.split("\n")[cursor.line] ?? "";
    const { start, end } = wordBounds(line, cursor.character);
    return line.slice(start, end);
  }

  private identifierRange(cursor: SourceCursor): LspRange {
    const line = this.texts.get(cursor.uri)?.split("\n")[cursor.line] ?? "";
    const { start, end } = wordBounds(line, cursor.character);
    return { start: { line: cursor.line, character: start }, end: { line: cursor.line, character: end } };
  }

  // ---- LSP transport ----

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.dead) {
      return Promise.reject(this.dead);
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`pyright LS request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method}`));
        }
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message));
    this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.proc.stdin.write(body);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const sep = this.buffer.indexOf("\r\n\r\n");
      if (sep < 0) {
        return;
      }
      const header = this.buffer.subarray(0, sep).toString("ascii");
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(sep + 4);
        continue;
      }
      const length = Number(match[1]);
      if (this.buffer.length < sep + 4 + length) {
        return; // wait for the rest of the body
      }
      const body = this.buffer.subarray(sep + 4, sep + 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(sep + 4 + length);
      this.dispatch(JSON.parse(body));
    }
  }

  private dispatch(message: LspMessage): void {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const waiting = this.pending.get(message.id as number);
      if (waiting) {
        this.pending.delete(message.id as number);
        clearTimeout(waiting.timer);
        if (message.error !== undefined) {
          waiting.reject(new Error(`pyright LS error for ${String(message.id)}: ${JSON.stringify(message.error)}`));
        } else {
          waiting.resolve(message.result);
        }
      }
      return;
    }
    if (message.id !== undefined && message.method !== undefined) {
      // Server-to-client request. Answer the configuration pull with the Python
      // settings pyright wants (config-pull pythonPath feeds the interpreter);
      // everything else (registerCapability, refresh requests) gets null.
      const result =
        message.method === "workspace/configuration"
          ? this.configAnswer(message.params)
          : null;
      this.send({ jsonrpc: "2.0", id: message.id, result });
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const uri = (message.params as { uri?: string })?.uri;
      if (typeof uri === "string") {
        this.diagsReceived.add(uri);
      }
    }
  }

  // Answer each requested section: pyright pulls `python`, `python.analysis`, and
  // `pyright`. The analysis block enables auto-import completions and library-code
  // types; `python` carries the interpreter (config-pull pythonPath).
  private configAnswer(params: unknown): unknown[] {
    const items = ((params as { items?: Array<{ section?: string }> })?.items ?? []);
    const analysis = {
      autoImportCompletions: true,
      diagnosticMode: this.diagnosticMode,
      useLibraryCodeForTypes: true,
    };
    return items.map((it) => {
      if (it.section === "python.analysis") {
        return analysis;
      }
      if (it.section === "python") {
        return this.pythonPath !== undefined ? { pythonPath: this.pythonPath, analysis } : { analysis };
      }
      return {}; // `pyright` and any other section: defaults
    });
  }
}

// The word bounds around an offset in a line, over the identifier alphabet.
function wordBounds(line: string, character: number): { start: number; end: number } {
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  let start = character;
  while (start > 0 && isWord(line[start - 1])) {
    start--;
  }
  let end = character;
  while (end < line.length && isWord(line[end])) {
    end++;
  }
  return { start, end };
}

// The minimal single-range incremental change turning `oldText` into `newText`.
function incrementalChange(oldText: string, newText: string): { range: LspRange; text: string } {
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText[start] === newText[start]) {
    start++;
  }
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return {
    range: { start: positionAt(oldText, start), end: positionAt(oldText, oldEnd) },
    text: newText.slice(start, newEnd),
  };
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

function toQualifyEdit(te: LspTextEdit): QualifyEdit | undefined {
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

// The first text edit in a workspace edit, as a transport-neutral QualifyEdit.
function firstEditOf(edit: LspWorkspaceEdit | undefined): QualifyEdit | undefined {
  if (!edit) {
    return undefined;
  }
  let te: LspTextEdit | undefined;
  if (edit.documentChanges) {
    te = edit.documentChanges.flatMap((c) => c.edits ?? [])[0];
  } else if (edit.changes) {
    te = Object.values(edit.changes).flat()[0];
  }
  return te ? toQualifyEdit(te) : undefined;
}

// hover contents is MarkupContent { value } or a MarkedString/string, or an array
// of them. Collect the markdown for parsePyHover.
function hoverMarkdown(contents: unknown): string {
  const parts = Array.isArray(contents) ? contents : [contents];
  return parts
    .map((c) => (typeof c === "string" ? c : (c as { value?: unknown })?.value))
    .filter((v): v is string => typeof v === "string")
    .join("\n\n");
}

function pathToUri(fsPath: string): string {
  return "file://" + fsPath.split("/").map(encodeURIComponent).join("/");
}

// The bundled pyright-langserver entry, resolved by walking node_modules from
// this module's location — pyright ships as a runtime dependency, so it sits at
// <ext>/node_modules/pyright regardless of the user's project. The same
// resolution PyOracle uses for its CLI (zero version skew), for the langserver
// entry instead of index.js.
//
// `pyright/langserver.index.js`, NOT `.bin/pyright-langserver`. The .bin entry
// is what this resolved until packaging proved it cannot work in a shipped
// extension, and PyOracle already carried all three reasons in its own comment:
// npm writes .bin as a SYMLINK and vsce does not put symlinks in the vsix, so
// the path simply is not there; on Windows it is a .cmd that cannot be spawned
// plainly; and a GUI-launched editor has no node on PATH for the shebang to
// find. It worked under F5 because a dev checkout has the whole .bin directory.
function resolveServerEntry(): string {
  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, "node_modules", "pyright", "langserver.index.js");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.join(__dirname, "node_modules", "pyright", "langserver.index.js");
    }
    dir = parent;
  }
}

// The interpreter beside the root, POSIX venv layouts first then Windows. Feeds
// `python.pythonPath` in the config-pull answer; undefined -> pyright falls back
// to system python (the deterministic core needs no venv).
function resolveInterpreter(root: string): string | undefined {
  const candidates = [
    path.join(root, ".venv", "bin", "python"),
    path.join(root, "venv", "bin", "python"),
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, "venv", "Scripts", "python.exe"),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
