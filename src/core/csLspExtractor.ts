/**
 * Headless C# surface extractor, the test transport: spawns the user's installed
 * Roslyn LS (Microsoft.CodeAnalysis.LanguageServer.dll) over `dotnet ... --stdio`
 * and drives it via raw LSP — the raLspClient / tsLsExtractor analog. This is
 * the signature-bearing transport the live oracle drives (real member sets on a
 * broken buffer, real completionItem/resolve signatures, the real fully-qualify
 * action), the falsification the fake-runner unit suite cannot reach.
 *
 * NOT the product path: the product reuses the user's running LS through the
 * vscode command API (src/vscode/csExtractor.ts). This spawns its own process,
 * fine for a test but a rival in the extension. Do not wire it into extractorFor.
 *
 * Lives in src/core because it bundles headless and imports no vscode; the purity
 * gate forbids vscode, not child_process. All member/kind rendering delegates to
 * the C#-shaped pure helpers (csExtraction) so both transports render identically.
 *
 * Roslyn mechanics honored (proven against a live Roslyn server probe):
 *  - after initialize/initialized, `project/open` with the csproj file:// URI
 *    (the custom Roslyn protocol; --autoLoadProjects alone does nothing);
 *  - incremental didChange sync is MANDATORY (full-text replacement corrupts the
 *    server's view), so applyEdit sends a single ranged change;
 *  - server->client workspace/configuration is answered with an array of nulls,
 *    every other server->client request with null;
 *  - readiness is the workspace/projectInitializationComplete notification.
 */

import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
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
  resolutionReachedWrongTree,
  membersFromDocumentSymbols,
  toReferenceLocations,
} from "./extraction";
import {
  csLspMemberKind,
  csLspSymbolRole,
  isCsAddImportAction,
  isCsFullyQualifyTitle,
  parseCsHover,
  resolveCsTypeCursorWithHint,
  csPreResolveSignature,
  isCsObjectDeclaredMember,
  toCsCompletionMember,
  toCsSymbolMember,
} from "./csExtraction";

// A backstop against a wedged LS: a request that never gets a reply rejects
// instead of hanging the caller (and the test process) forever. Cold init can
// take ~12s; a warm query is single-digit ms. This is a hang guard, not an SLA.
const REQUEST_TIMEOUT_MS = 60_000;

// Roslyn defers the completion signature to completionItem/resolve (it rides
// `documentation`), so a member LIST resolves the first N for breadth.
const MEMBER_RESOLVE_CAP = 32;
// A freshly-loaded project can lag completion by a few ms; bounded retries on an
// empty member-site result absorb the race without masking a genuinely empty set.
const COMPLETION_RETRIES = 6;

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

export class CsLspExtractor implements SurfaceExtractor {
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private readonly versions = new Map<string, number>();
  // Last text sent for each uri, so the member-site gate can read the line under
  // the cursor and incremental didChange can diff against the prior buffer.
  private readonly texts = new Map<string, string>();
  private projectInitialized = false;
  // Set once the process dies or errors; every pending and future request then
  // rejects with it instead of hanging.
  private dead: Error | undefined;
  private readonly logDir: string;

  private constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    logDir: string,
  ) {
    this.logDir = logDir;
    proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    proc.stderr.on("data", () => {}); // Roslyn logs to stderr; not the oracle's concern
    proc.on("error", (err) => this.failAll(new Error(`roslyn LS process error: ${err.message}`)));
    proc.on("exit", (code, signal) =>
      this.failAll(new Error(`roslyn LS exited before replying (code=${code}, signal=${signal})`)),
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

  static async start(opts: {
    projectRoot: string;
    // One project file:// URI, or several — a cross-project fixture (a caller
    // referencing a type defined in a sibling project) needs BOTH loaded, since
    // workspace/symbol only indexes the projects that were opened.
    csproj: string | string[];
    serverDll: string;
  }): Promise<CsLspExtractor> {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-lsp-log-"));
    const proc = spawn(
      "dotnet",
      [opts.serverDll, "--stdio", "--logLevel", "Warning", "--extensionLogDirectory", logDir],
      { cwd: opts.projectRoot, stdio: ["pipe", "pipe", "pipe"] },
    );
    const client = new CsLspExtractor(proc, logDir);
    const rootUri = pathToUri(opts.projectRoot);
    await client.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "cs-extraction" }],
      capabilities: {
        window: { workDoneProgress: true },
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: false,
              // PLAINTEXT only. The signature rides `documentation`, whose
              // FIRST LINE is the signature — but only in the plaintext form
              // Roslyn returns when markdown is not offered.
              // Advertising markdown makes Roslyn fence the documentation
              // (```csharp\n<sig>\n```\n<prose>), which buries the signature
              // behind the fence line; plaintext keeps it on line one, matching
              // the captured contract and the product (vscode-command) path.
              documentationFormat: ["plaintext"],
              // The signature/doc are filled on completionItem/resolve; advertise
              // both fields as resolvable so Roslyn defers them lazily.
              resolveSupport: { properties: ["documentation", "detail"] },
            },
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          // No linkSupport: Roslyn then returns a plain Location whose range is
          // the type-name span already (the definition primitive still handles a
          // LocationLink defensively).
          definition: {},
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          codeAction: {
            codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } },
            resolveSupport: { properties: ["edit"] },
          },
        },
      },
    });
    client.notify("initialized", {});
    // The custom Roslyn protocol: tell the server which projects to load. A
    // cross-project fixture passes several so the referenced project is indexed
    // for workspace/symbol too, not just the entry project.
    const projects = Array.isArray(opts.csproj) ? opts.csproj : [opts.csproj];
    client.notify("project/open", { projects });
    return client;
  }

  /** Push `text` as this document's buffer, opening it if it is not open yet.
   *
   *  IDEMPOTENT, AND THAT IS NOT TIDINESS. A second `didOpen` for a document
   *  Roslyn already holds is not ignored and is not a degrade: Roslyn asserts on
   *  it (`didOpen received for … which is already open`, LspWorkspaceManager.cs
   *  line 109) and the process dies on SIGABRT. Measured live while taking a C#
   *  baseline — the server aborted mid-run and every subsequent row recorded
   *  "nothing resolved" in 0ms, which reads as a very fast product and is a
   *  corpse (`server-death-looks-like-a-product-answer`).
   *
   *  The collision is structural rather than careless. `ensureOpen` opens a
   *  document LAZILY the first time any request touches it, so a caller keeping
   *  its own opened-set cannot know which files this class already opened on its
   *  behalf — and a cross-file walk makes exactly that happen, since the walk
   *  opens def files it discovers while the transport is opening them too. So
   *  the guard belongs here, where `versions` is the one authority on what is
   *  open, and not in every caller.
   *
   *  An already-open document takes the `didChange` path instead, which is the
   *  same incremental sync `applyEdit` uses and which Roslyn requires (a
   *  full-text replacement corrupts its view). Re-pushing identical text is then
   *  a no-op change rather than a crash. */
  openDocument(uri: string, text: string): void {
    // Keyed on `texts`, not `versions`, and the two are always set together:
    // `applyEdit` falls BACK to this method when it has no stored text, so
    // keying on the map it reads is what makes the pair provably non-recursive
    // rather than non-recursive by an invariant a later edit could break.
    if (this.texts.has(uri)) {
      this.applyEdit(uri, text);
      return;
    }
    this.versions.set(uri, 1);
    this.texts.set(uri, text);
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "csharp", version: 1, text },
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
    // Incremental sync is MANDATORY — a full-text replacement corrupts Roslyn's
    // view. Send a single ranged change spanning exactly the differing middle.
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [incrementalChange(old, newText)],
    });
  }

  // Lazily open a document from disk the first time it is queried, so a caller
  // that only loaded the project (never pushed a buffer) still gets served —
  // Roslyn needs the file open before it answers textDocument/* on it.
  private ensureOpen(uri: string): void {
    if (this.versions.has(uri)) {
      return;
    }
    let text: string;
    try {
      text = fs.readFileSync(fileURLToPath(uri), "utf8");
    } catch {
      return; // not on disk and not pushed: the request will degrade honestly
    }
    this.openDocument(uri, text);
  }

  async whenReady(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.dead) {
        throw this.dead;
      }
      if (this.projectInitialized) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error("roslyn LS did not finish project initialization before the timeout");
      }
      await delay(150);
    }
  }

  async completeMembers(cursor: SourceCursor): Promise<CompletionMember[]> {
    this.ensureOpen(cursor.uri);
    // Member-site gate (the tsExtractor pattern): the LS returns the in-scope
    // world at a non-member position, so proceed only when the text before the
    // cursor is an identifier-dot shape. `[]` is the honest "no members". NOTE:
    // the regex is not itself string/comment/float-safe (a `.` inside a string,
    // a `1.` float), so it leans on the upstream fimMemberSite gate and on the
    // LS returning empty inside strings/comments; a standalone hardening is
    // deferred.
    const line = (this.texts.get(cursor.uri)?.split("\n")[cursor.line] ?? "").slice(0, cursor.character);
    if (!/\.[A-Za-z0-9_$]*$/.test(line)) {
      return [];
    }
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
      detail?: unknown;
      labelDetails?: { description?: unknown };
      documentation?: unknown;
      data?: unknown;
    }>;
    const members: CompletionMember[] = [];
    let resolved = 0;
    for (const item of items) {
      const kind = csLspMemberKind(item.kind);
      if (kind === undefined) {
        continue; // keyword/snippet/text: never a member
      }
      const label = typeof item.label === "string" ? item.label : "";
      const detail =
        typeof item.detail === "string"
          ? item.detail
          : typeof item.labelDetails?.description === "string"
            ? item.labelDetails.description
            : undefined;
      // The `object` filter runs BEFORE the budget, not after it: a member that
      // misses the resolve has no signature and is dropped at render, so a
      // budget spent on the four universal members and the project's blanket
      // `object` extensions costs real properties their lines. Filtering after
      // the resolve buys back nothing.
      if (isCsObjectDeclaredMember(csPreResolveSignature(label, detail))) {
        members.push(toCsCompletionMember(label, undefined, kind));
        continue;
      }
      let documentation = documentationText(item.documentation);
      if (documentation === undefined && resolved < MEMBER_RESOLVE_CAP) {
        resolved++;
        try {
          const full = (await this.request("completionItem/resolve", item)) as { documentation?: unknown };
          documentation = documentationText(full?.documentation);
        } catch {
          // resolve failed: the member stays, signature-less
        }
      }
      members.push(toCsCompletionMember(label, documentation, kind, detail));
    }
    return members;
  }

  async hoverSurface(cursor: SourceCursor): Promise<HoverSurface | undefined> {
    this.ensureOpen(cursor.uri);
    const result = (await this.request("textDocument/hover", {
      textDocument: { uri: cursor.uri },
      position: { line: cursor.line, character: cursor.character },
    })) as { contents?: unknown } | null;
    if (!result || result.contents === undefined || result.contents === null) {
      return undefined;
    }
    return parseCsHover(hoverMarkdown(result.contents));
  }

  async definition(cursor: SourceCursor): Promise<DefinitionLocation | undefined> {
    this.ensureOpen(cursor.uri);
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
    // Prefer the selection range (the name) over the full range (which spans the
    // decompiled type incl. its leading doc/attributes) — same LocationLink
    // lesson as the product transports.
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

  // Where the workspace uses the symbol under the cursor. Roslyn only searches
  // the projects `project/open` loaded, so a caller that opened one project of a
  // solution gets that project's call sites and no others — the same
  // single-project blindness that makes a cross-project surface resolve empty,
  // and the same fix (open both).
  //
  // THE COST IS A FLOOR, NOT A SIZE. Measured warm on a loaded server: a query
  // that finds NOTHING answers in ~1ms, and a query that finds anything answers
  // in ~503ms whether it found 4 locations or 26, with hover at the same cursor
  // still at ~1ms. That is Roslyn batching its streaming find-references flush,
  // not work proportional to the answer, and no request parameter shortens it.
  // A caller inside a sub-200ms budget therefore cannot spend this leg on C#
  // synchronously at all; it has to be resolved off the keystroke path or not at
  // all. The other four languages are single-digit ms warm.
  //
  // Roslyn honors `includeDeclaration` itself, so nothing is filtered here.
  async references(cursor: SourceCursor, query?: ReferenceQuery): Promise<ReferenceLocation[]> {
    try {
      // Inside the guard, not above it. `ensureOpen` reads a file and writes to
      // a child's stdin, and neither throws today, but "this leg never throws"
      // should rest on the leg rather than on a helper staying well behaved.
      this.ensureOpen(cursor.uri);
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

  // Always dark for C# (metadata-as-source carries no example): resolves
  // undefined WITHOUT sending any LSP request.
  async example(_cursor: SourceCursor, _prefer?: string): Promise<string | undefined> {
    return undefined;
  }

  async qualifyImport(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    this.ensureOpen(cursor.uri);
    const actions = await this.codeActionsAt(cursor);
    // Prefer the fully-qualify action (the in-span rewrite) over the "using"
    // auto-import; ambiguity counts DISTINCT titles (the namespace), so two
    // namespaces resolving the name yield nothing rather than an arbitrary pick.
    const qualify = actions.filter((a) => typeof a.title === "string" && isCsFullyQualifyTitle(a.title));
    if (new Set(qualify.map((a) => a.title)).size !== 1) {
      return undefined;
    }
    let chosen = qualify[0];
    if (!chosen.edit && chosen.data !== undefined) {
      try {
        chosen = (await this.request("codeAction/resolve", chosen)) as typeof chosen;
      } catch {
        return undefined;
      }
    }
    return firstEditOf(chosen.edit);
  }

  // The out-of-span auto-import leg: Roslyn's AddImport `using X;` action for an
  // unimported-but-reachable type. Its title carries a space+semicolon, so
  // isCsFullyQualifyTitle rejects it (that path owns the in-span fully-qualify);
  // the SEPARATE recognizer isCsAddImportAction keys on the structured AddImport
  // CustomTag. The resolved edit inserts the using at the top of the file (line
  // 0), OUTSIDE the function span — the caller routes it through
  // offerOutOfSpanImport. Ambiguity (two namespaces' using actions) counts
  // DISTINCT titles and yields nothing rather than an arbitrary pick.
  async importAction(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    this.ensureOpen(cursor.uri);
    const actions = await this.codeActionsAt(cursor);
    const imports = actions.filter((a) => isCsAddImportAction(a));
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

  // The raw quickfix list at the identifier around `cursor`. Shared by
  // importAction and exposed for the live recognizer oracle (this is the test
  // transport; rawCodeActionsForTest lets the blind suite prove
  // isCsAddImportAction over the REAL action shapes, never a hand-built fake).
  private async codeActionsAt(
    cursor: SourceCursor,
  ): Promise<Array<{ title?: string; edit?: LspWorkspaceEdit; data?: unknown }>> {
    const range = this.identifierRange(cursor);
    const raw = await this.request("textDocument/codeAction", {
      textDocument: { uri: cursor.uri },
      range,
      context: { diagnostics: [], only: ["quickfix"] },
    });
    return (Array.isArray(raw) ? raw : []) as Array<{ title?: string; edit?: LspWorkspaceEdit; data?: unknown }>;
  }

  /** TEST ONLY: the raw quickfix action list at a cursor, so the live blind
   *  oracle can assert isCsAddImportAction's discrimination over real Roslyn
   *  shapes. Not part of the SurfaceExtractor contract. */
  async rawCodeActionsForTest(cursor: SourceCursor): Promise<Array<{ title?: string; data?: unknown }>> {
    this.ensureOpen(cursor.uri);
    return this.codeActionsAt(cursor);
  }

  async membersOfType(defCursor: SourceCursor): Promise<CompletionMember[]> {
    this.ensureOpen(defCursor.uri);
    // documentSymbol is AST-syntactic (available once the file is open). With
    // hierarchicalDocumentSymbolSupport advertised Roslyn returns the nested
    // DocumentSymbol[] the shared descent needs; the C# builder reduces the
    // " : Type"-suffixed names to bare identifiers. NO object-statics filter:
    // documentSymbol is declared-only, so a name filter would only delete the
    // developer's OWN ToString/Equals/GetHashCode overrides.
    const symbols = await this.request("textDocument/documentSymbol", {
      textDocument: { uri: defCursor.uri },
    });
    // The wrong-tree refusal, the product transport's sibling. A definition
    // answer at the REFERENCE's own position lands inside the body of the
    // method the reference was written in; the descent would then hand back the
    // ENCLOSING class as if it were the named type. Refuse instead. A member
    // site sits on no identifier and is not refused.
    const lineText = this.texts.get(defCursor.uri)?.split("\n")[defCursor.line];
    if (resolutionReachedWrongTree(symbols, defCursor, csLspSymbolRole, lineText)) {
      return [];
    }
    return membersFromDocumentSymbols(symbols, defCursor, csLspSymbolRole, toCsSymbolMember);
  }


  /** The raw hierarchical documentSymbol tree for a file. ORACLE/RIG ONLY and
   *  deliberately not on the `SurfaceExtractor` contract - no product code reads
   *  a symbol tree off an extractor, it gets one from
   *  `vscode.executeDocumentSymbolProvider`.
   *
   *  It exists because the measurement rig has no vscode command API, and
   *  `resolvePrefill`'s RECEIVER leg reads `resolved.symbols` and degrades to
   *  nothing without it - which is how every arm this project has run measured a
   *  dark receiver leg while the channel said nothing.
   *
   *  KIND NUMBERING IS THE LSP'S, not vscode's; the two differ by one. */
  async documentSymbolsForTest(uri: string): Promise<unknown> {
    this.ensureOpen(uri);
    return this.request("textDocument/documentSymbol", { textDocument: { uri } });
  }

  // The workspace-symbol resolution leg: a bare type NAME -> the cursor at its
  // definition's name token. Roslyn's workspace/symbol location.range is the
  // NAME token (proven against the live LS), so the returned cursor feeds
  // membersOfType / resolveCrossFileShape directly (identifierAt lands on the
  // type name). The fuzzy hit list is narrowed by selectCsTypeCursor to the
  // exact-name TYPE, preferring a workspace location.
  async resolveTypeCursorByName(name: string, hint?: TypeNameHint): Promise<SourceCursor | undefined> {
    const raw = await this.request("workspace/symbol", { query: name });
    const symbols = (Array.isArray(raw) ? raw : []) as Array<{
      name?: unknown;
      kind?: unknown;
      containerName?: unknown;
      location?: { uri?: unknown; range?: LspRange };
    }>;
    const candidates = symbols.flatMap((s) => {
      const uri = s.location?.uri;
      const start = s.location?.range?.start;
      if (typeof s.name !== "string" || typeof uri !== "string" || !start) {
        return [];
      }
      const containerName = typeof s.containerName === "string" ? s.containerName : "";
      return [{ name: s.name, role: csLspSymbolRole(s.kind), containerName, uri, line: start.line, character: start.character }];
    });
    // The hint is spent only on an ambiguity: an unambiguous name resolves
    // through the same selection, at the same cost, without hovering anything.
    return resolveCsTypeCursorWithHint(candidates, name, hint, async (cursor) => {
      try {
        return (await this.hoverSurface(cursor))?.signature;
      } catch {
        return undefined;
      }
    });
  }

  dispose(): void {
    this.proc.kill();
    try {
      fs.rmSync(this.logDir, { recursive: true, force: true });
    } catch {
      // best-effort log cleanup
    }
  }

  // The identifier word around the cursor, from the stored buffer text.
  private identifierRange(cursor: SourceCursor): LspRange {
    const line = this.texts.get(cursor.uri)?.split("\n")[cursor.line] ?? "";
    const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
    let start = cursor.character;
    while (start > 0 && isWord(line[start - 1])) {
      start--;
    }
    let end = cursor.character;
    while (end < line.length && isWord(line[end])) {
      end++;
    }
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
          reject(new Error(`roslyn LS request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method}`));
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
          waiting.reject(new Error(`roslyn LS error for ${String(message.id)}: ${JSON.stringify(message.error)}`));
        } else {
          waiting.resolve(message.result);
        }
      }
      return;
    }
    if (message.id !== undefined && message.method !== undefined) {
      // Server-to-client request. Must reply or Roslyn can stall: an array of
      // nulls for a configuration pull, null for everything else (register-
      // Capability, the refresh requests).
      const result =
        message.method === "workspace/configuration"
          ? ((message.params as { items?: unknown[] })?.items ?? []).map(() => null)
          : null;
      this.send({ jsonrpc: "2.0", id: message.id, result });
      return;
    }
    if (message.method === "workspace/projectInitializationComplete") {
      this.projectInitialized = true;
    }
  }
}

// The minimal single-range incremental change turning `oldText` into `newText`:
// the differing middle, in oldText coordinates. A common prefix and suffix are
// stripped so a one-line edit sends a one-line change, not a whole-file replace.
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

// LSP documentation is a string or MarkupContent { value }; undefined when
// absent (an unresolved item), which csSignatureFromDocumentation reads as "no
// signature yet".
function documentationText(doc: unknown): string | undefined {
  if (typeof doc === "string") {
    return doc;
  }
  if (doc && typeof doc === "object" && typeof (doc as { value?: unknown }).value === "string") {
    return (doc as { value: string }).value;
  }
  return undefined;
}

// Roslyn hover contents is MarkupContent { value } or a MarkedString/string, or
// an array of them. Collect the markdown for parseCsHover.
function hoverMarkdown(contents: unknown): string {
  const parts = Array.isArray(contents) ? contents : [contents];
  return parts
    .map((c) => (typeof c === "string" ? c : (c as { value?: unknown })?.value))
    .filter((v): v is string => typeof v === "string")
    .join("\n\n");
}

// The first text edit in a workspace edit, as a transport-neutral QualifyEdit.
// The fully-qualify action carries exactly one in-span edit; pull it from either
// the documentChanges or the changes form.
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
  if (!te) {
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

function pathToUri(fsPath: string): string {
  return "file://" + fsPath.split("/").map(encodeURIComponent).join("/");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
