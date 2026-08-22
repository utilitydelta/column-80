/**
 * Headless gopls LSP client: the Go test transport (never wired into the
 * extension; the product rides the user's golang.go gopls through the
 * vscode command API). Drives `gopls serve` over stdio with Content-Length
 * framing — the raLspClient shape with gopls semantics:
 *
 * - Signatures ride the completion item's `detail` eagerly (0-1ms warm, no
 *   resolve round trip) and documentSymbol `detail` is always filled, so
 *   there is no hover fan-out and no budgetMs spend (the C# property).
 * - completeMembers returns the set ALREADY through the two-rule filter
 *   (goExtraction): the headless transport advertises snippetSupport so it
 *   sees the same postfix/deep-completion contamination the product does,
 *   and proves the filter against it.
 * - example() is dark by decision (the locked C#/TS resolution).
 * - qualifyImport returns gopls's Add-import quickfix ONLY when exactly one
 *   candidate exists; its edit lands in the imports region, so the consumer
 *   routes it through the out-of-span consent gate, never an in-span splice.
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import type {
  CompletionMember,
  DefinitionLocation,
  HoverSurface,
  QualifyEdit,
  ReferenceLocation,
  ReferenceQuery,
  SourceCursor,
  SurfaceExtractor,
  TypeNameHint,
} from "./extraction";
import { toReferenceLocations } from "./extraction";
import {
  goLspSymbolRole,
  goMemberFromCompletionItem,
  goMembersFromDocumentSymbols,
  parseGoHover,
  resolveGoTypeCursorWithHint,
  type GoSymbolCandidate,
} from "./goExtraction";

const REQUEST_TIMEOUT_MS = 30_000;
/** How long start-to-ready may assume gopls still has setup progress coming.
 *  A tiny module can finish setup before the client even asks; past this
 *  quiet window with nothing in flight, ready is the honest answer. */
const READY_QUIET_MS = 2_000;

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

interface LspMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface LspWorkspaceEdit {
  changes?: Record<string, Array<{ range: LspRange; newText: string }>>;
  documentChanges?: Array<{
    textDocument?: { uri?: string };
    edits?: Array<{ range: LspRange; newText: string }>;
  }>;
}

export interface GoLspStartOptions {
  projectRoot: string;
  /** The gopls binary; default resolves on PATH. Tests pass ~/go/bin/gopls
   *  so the proven v0.23.0 is the one the evidence lines name. */
  goplsPath?: string;
}

export class GoLspExtractor implements SurfaceExtractor {
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private readonly versions = new Map<string, number>();
  private readonly texts = new Map<string, string>();
  /** Latest published diagnostics per uri: the codeAction context gopls
   *  resolves its quickfixes against. */
  private readonly diagnostics = new Map<string, unknown[]>();
  private readonly activeProgress = new Set<string | number>();
  private sawProgress = false;
  private readonly startedAt = Date.now();
  private dead: Error | undefined;

  private constructor(private readonly proc: ChildProcessWithoutNullStreams) {
    proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    proc.stderr.on("data", () => {}); // gopls logs to stderr; not the surface's concern
    proc.on("error", (err) => this.failAll(new Error(`gopls process error: ${err.message}`)));
    proc.on("exit", (code, signal) =>
      this.failAll(new Error(`gopls exited before replying (code=${code}, signal=${signal})`)),
    );
  }

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

  static async start(opts: GoLspStartOptions): Promise<GoLspExtractor> {
    const proc = spawn(opts.goplsPath ?? "gopls", ["serve"], {
      cwd: opts.projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      // The offline invariant: gopls spawns `go` itself, and a cold import
      // must refuse loudly, never fetch. A caller that has already set
      // GOPROXY keeps its own regime.
      env: { ...process.env, GOPROXY: process.env.GOPROXY ?? "off" },
    });
    const client = new GoLspExtractor(proc);
    const rootUri = pathToUri(opts.projectRoot);
    await client.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "extraction" }],
      capabilities: {
        window: { workDoneProgress: true },
        textDocument: {
          completion: {
            completionItem: {
              // snippetSupport ON deliberately: the product transport sees
              // postfix snippets, so the headless one must too — the
              // two-rule filter is proven against real contamination, not a
              // sanitized list.
              snippetSupport: true,
              documentationFormat: ["markdown", "plaintext"],
              resolveSupport: { properties: ["documentation"] },
            },
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: {},
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          codeAction: {
            codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } },
            resolveSupport: { properties: ["edit"] },
          },
          publishDiagnostics: {},
        },
      },
      initializationOptions: {},
    });
    client.notify("initialized", {});
    return client;
  }

  openDocument(uri: string, text: string): void {
    this.versions.set(uri, 1);
    this.texts.set(uri, text);
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "go", version: 1, text },
    });
  }

  applyEdit(uri: string, text: string): void {
    const version = (this.versions.get(uri) ?? 1) + 1;
    this.versions.set(uri, version);
    this.texts.set(uri, text);
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  async whenReady(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.dead) {
        throw this.dead;
      }
      const quiet = this.activeProgress.size === 0;
      // Ready when gopls's setup progress has drained — or when a tiny
      // module produced no trackable progress inside the quiet window.
      if (quiet && (this.sawProgress || Date.now() - this.startedAt > READY_QUIET_MS)) {
        await delay(300);
        if (this.activeProgress.size === 0) {
          return;
        }
      }
      if (Date.now() > deadline) {
        throw new Error("gopls did not become ready before the timeout");
      }
      await delay(100);
    }
  }

  async completeMembers(cursor: SourceCursor): Promise<CompletionMember[]> {
    // A freshly-opened overlay can lag gopls's type-check by a few ms; retry
    // a bounded number of times on empty so indexing lag never reads as a
    // genuinely unresolved receiver (the raLspClient discipline).
    for (let attempt = 0; attempt < 8; attempt++) {
      const raw = await this.request("textDocument/completion", {
        textDocument: { uri: cursor.uri },
        position: { line: cursor.line, character: cursor.character },
      });
      const items = (Array.isArray(raw) ? raw : ((raw as { items?: unknown[] })?.items ?? [])) as Array<{
        label?: unknown;
        kind?: unknown;
        detail?: unknown;
      }>;
      const members: CompletionMember[] = [];
      for (const item of items) {
        const mapped = goMemberFromCompletionItem({
          label: typeof item.label === "string" ? item.label : "",
          kind: typeof item.kind === "number" ? item.kind : undefined,
          detail: typeof item.detail === "string" ? item.detail : undefined,
        });
        if (mapped) {
          members.push(mapped);
        }
      }
      // items may be all-snippet (a slice receiver): that filters to empty
      // and IS the answer — only a fully empty reply retries.
      if (members.length > 0 || items.length > 0 || attempt === 7) {
        return members;
      }
      await delay(150);
    }
    return [];
  }

  async hoverSurface(cursor: SourceCursor): Promise<HoverSurface | undefined> {
    const result = (await this.request("textDocument/hover", {
      textDocument: { uri: cursor.uri },
      position: { line: cursor.line, character: cursor.character },
    })) as { contents?: unknown } | null;
    if (!result || result.contents === undefined || result.contents === null) {
      return undefined;
    }
    const markdown = hoverMarkdown(result.contents);
    const parsed = parseGoHover(markdown);
    if (!parsed) {
      return undefined;
    }
    return parsed.doc !== undefined ? { signature: parsed.signature, doc: parsed.doc } : { signature: parsed.signature };
  }

  async definition(cursor: SourceCursor): Promise<DefinitionLocation | undefined> {
    const result = await this.request("textDocument/definition", {
      textDocument: { uri: cursor.uri },
      position: { line: cursor.line, character: cursor.character },
    });
    const loc = (Array.isArray(result) ? result[0] : result) as
      | { uri?: string; range?: LspRange; targetUri?: string; targetRange?: LspRange }
      | undefined;
    if (!loc) {
      return undefined;
    }
    const uri = loc.uri ?? loc.targetUri;
    const range = loc.range ?? loc.targetRange;
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

  /** Dark by decision: the locked C#/TS resolution — Go serves signatures,
   *  never a scraped example. `Example_*` test functions are a possible
   *  future surface precisely because the module cache holds real source. */
  async example(): Promise<string | undefined> {
    return undefined;
  }

  async qualifyImport(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    const range = this.identifierRange(cursor);
    // gopls resolves its import quickfix against the DIAGNOSTIC at the name
    // (`undefined: uuid` / `undeclared name`), so the request must carry it —
    // an empty context yields no actions (proven by the scout's probe). The
    // publish is async after didOpen; poll briefly rather than read whatever
    // happens to have landed.
    let overlapping: unknown[] = [];
    const deadline = Date.now() + 5_000;
    for (;;) {
      const published = this.diagnostics.get(cursor.uri) ?? [];
      overlapping = published.filter((d) => {
        const r = (d as { range?: LspRange }).range;
        return r !== undefined && rangesTouch(r, range);
      });
      if (overlapping.length > 0 || Date.now() > deadline || this.dead) {
        break;
      }
      await delay(100);
    }
    const diagRange = (overlapping[0] as { range?: LspRange } | undefined)?.range;
    const raw = await this.request("textDocument/codeAction", {
      textDocument: { uri: cursor.uri },
      range: diagRange ?? range,
      context: { diagnostics: overlapping, triggerKind: 1 },
    });
    const actions = (Array.isArray(raw) ? raw : []) as Array<{
      title?: string;
      edit?: LspWorkspaceEdit;
      data?: unknown;
    }>;
    const addImports = actions.filter((a) => typeof a.title === "string" && /^Add import\b/i.test(a.title));
    // Single-candidate only: two competing import paths is an ambiguity the
    // model must never resolve — honest-dark instead.
    if (addImports.length !== 1) {
      return undefined;
    }
    let action = addImports[0];
    if (!action.edit && action.data !== undefined) {
      try {
        action = (await this.request("codeAction/resolve", action)) as typeof action;
      } catch {
        return undefined;
      }
    }
    return firstEditOf(action.edit);
  }

  /** Where the workspace uses the symbol under the cursor. gopls scopes the
   *  answer to the packages its view already loaded, so a symbol used only from
   *  a package outside the module root reads as unused here — the module is the
   *  boundary, not the filesystem. */
  async references(cursor: SourceCursor, query?: ReferenceQuery): Promise<ReferenceLocation[]> {
    try {
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

  /** The raw document-symbol tree for a file, for a HEADLESS CALLER that has to
   *  build a `ResolvedFunction` by hand. The Python transport's twin, added in
   *  the same change and for the same reason: in the editor the span is resolved
   *  OUT of this tree so `ResolvedFunction.symbols` already carries it, and a rig
   *  assembling records from a manifest has no tree, so the pre-fill's receiver
   *  leg degrades to "no tree" and reports an empty surface as a product answer.
   *
   *  Go's own rows were never measured with the receiver leg lit, so this is a
   *  capability rather than a fix to a measured number: whether it moves a Go
   *  arm is unmeasured and must not be assumed.
   *
   *  KIND NUMBERING IS THE LSP'S, not vscode's. */
  async documentSymbolsForTest(uri: string): Promise<unknown> {
    return this.request("textDocument/documentSymbol", { textDocument: { uri } });
  }

  async membersOfType(defCursor: SourceCursor): Promise<CompletionMember[]> {
    const symbols = await this.request("textDocument/documentSymbol", {
      textDocument: { uri: defCursor.uri },
    });
    return goMembersFromDocumentSymbols(symbols, defCursor);
  }

  // The workspace-symbol resolution leg: a bare type NAME -> the cursor at its
  // definition's name token. Proven live against gopls (querying "Command" over
  // the cobra corpus returns the struct at command.go:53, kind 23, first of 100
  // fuzzy hits — the same shape Roslyn's workspace/symbol returns for C#).
  // location.range is the NAME token, so the returned cursor feeds
  // membersOfType / resolveCrossFileShape directly.
  // Narrowing lives in goExtraction's resolveGoTypeCursorWithHint, which reads
  // containerName as the real Go import PATH gopls reports it as — unlike
  // Roslyn's display-string containerName, that never needs a hover to
  // disambiguate.
  async resolveTypeCursorByName(name: string, hint?: TypeNameHint): Promise<SourceCursor | undefined> {
    const raw = await this.request("workspace/symbol", { query: name });
    const symbols = (Array.isArray(raw) ? raw : []) as Array<{
      name?: unknown;
      kind?: unknown;
      containerName?: unknown;
      location?: { uri?: unknown; range?: LspRange };
    }>;
    const candidates: GoSymbolCandidate[] = symbols.flatMap((s) => {
      const uri = s.location?.uri;
      const start = s.location?.range?.start;
      if (typeof s.name !== "string" || typeof uri !== "string" || !start) {
        return [];
      }
      const containerName = typeof s.containerName === "string" ? s.containerName : "";
      return [{ name: s.name, role: goLspSymbolRole(s.kind), containerName, uri, line: start.line, character: start.character }];
    });
    return resolveGoTypeCursorWithHint(candidates, name, hint);
  }

  dispose(): void {
    this.proc.kill();
  }

  private identifierRange(cursor: SourceCursor): LspRange {
    const line = this.texts.get(cursor.uri)?.split("\n")[cursor.line] ?? "";
    const isWord = (c: string) => /[\p{L}\p{Nd}_]/u.test(c);
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
          reject(new Error(`gopls request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method}`));
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
          waiting.reject(new Error(`gopls error for ${String(message.id)}: ${JSON.stringify(message.error)}`));
        } else {
          waiting.resolve(message.result);
        }
      }
      return;
    }
    if (message.id !== undefined && message.method !== undefined) {
      // Server-to-client request. Must reply or gopls can stall: null per
      // item for a configuration pull (gopls defaults), null otherwise.
      const result =
        message.method === "workspace/configuration"
          ? ((message.params as { items?: unknown[] })?.items ?? []).map(() => null)
          : null;
      this.send({ jsonrpc: "2.0", id: message.id, result });
      return;
    }
    if (message.method === "$/progress") {
      const params = message.params as { token?: string | number; value?: { kind?: string } };
      if (params?.token === undefined) {
        return;
      }
      this.sawProgress = true;
      if (params.value?.kind === "end") {
        this.activeProgress.delete(params.token);
      } else if (params.value?.kind === "begin") {
        this.activeProgress.add(params.token);
      }
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri?: string; diagnostics?: unknown[] };
      if (typeof params?.uri === "string") {
        this.diagnostics.set(params.uri, params.diagnostics ?? []);
      }
    }
  }
}

function rangesTouch(a: LspRange, b: LspRange): boolean {
  const before = (x: LspRange, y: LspRange) =>
    x.end.line < y.start.line || (x.end.line === y.start.line && x.end.character < y.start.character);
  return !before(a, b) && !before(b, a);
}

function firstEditOf(edit: LspWorkspaceEdit | undefined): QualifyEdit | undefined {
  if (!edit) {
    return undefined;
  }
  if (edit.changes) {
    for (const edits of Object.values(edit.changes)) {
      if (edits && edits.length > 0) {
        return toQualifyEdit(edits[0]);
      }
    }
  }
  for (const change of edit.documentChanges ?? []) {
    if (change.edits && change.edits.length > 0) {
      return toQualifyEdit(change.edits[0]);
    }
  }
  return undefined;
}

function toQualifyEdit(edit: { range: LspRange; newText: string }): QualifyEdit {
  return {
    range: {
      startLine: edit.range.start.line,
      startCharacter: edit.range.start.character,
      endLine: edit.range.end.line,
      endCharacter: edit.range.end.character,
    },
    newText: edit.newText,
  };
}

function hoverMarkdown(contents: unknown): string {
  if (typeof contents === "string") {
    return contents;
  }
  if (Array.isArray(contents)) {
    return contents.map((c) => (typeof c === "string" ? c : ((c as { value?: string })?.value ?? ""))).join("\n");
  }
  return (contents as { value?: string })?.value ?? "";
}

function pathToUri(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  return `file://${normalized.startsWith("/") ? "" : "/"}${encodeURI(normalized).replace(/#/g, "%23")}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
