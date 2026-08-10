/**
 * Headless rust-analyzer LSP client, the oracle's transport. Drives a
 * rust-analyzer process over stdio (Content-Length framing, background reader,
 * readiness polling); ports the scout's rust-analyzer selection probe. It exists
 * so the live oracle can prove real extraction without an extension host.
 *
 * NOT the product path: the product reuses the user's running rust-analyzer
 * through the vscode command API (src/vscode/raExtractor.ts). This spawns its own
 * process, which is fine for a test but a rival in the extension. Do not wire it
 * into the extension.
 *
 * Lives in src/core because it bundles headless and imports no vscode; the purity
 * gate forbids vscode, not child_process (compilerOracle.ts spawns cargo too).
 */

import { ChildProcessWithoutNullStreams, spawn } from "child_process";
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
  extractExample,
  isRaBlanketImpl,
  membersFromDocumentSymbols,
  parseHover,
  parseMemberLabel,
  raEagerDetail,
  raSortTextTier,
  rankExampleCandidates,
  stripRustGenericDefaults,
  toCompletionMember,
  toReferenceLocations,
} from "./extraction";

// LSP wire CompletionItemKind (1-based; NOT the vscode enum). Method/Function/
// Field are the crate-API members; keyword/snippet/text are never members.
const MEMBER_KIND_BY_LSP = new Map<number, MemberKind>([
  [2, "method"],
  [3, "function"],
  [4, "function"], // Constructor
  [5, "field"],
]);
const NON_MEMBER_LSP_KINDS = new Set<number>([1, 14, 15]); // Text, Keyword, Snippet

// LSP wire CompletionItemKind.Constructor: the builder/ctor entry whose docs carry
// the construction example. Ranking hygiene (std/blanket-trait filtering, the
// builder tier) lives in the pure rankExampleCandidates; this transport only maps
// items into its candidate shape, identically to RaCommandExtractor.
const LSP_CONSTRUCTOR_KIND = 4;
const EXAMPLE_RESOLVE_CAP = 12;

// LSP documentation is a string or MarkupContent { value }.
function documentationText(doc: unknown): string {
  if (typeof doc === "string") {
    return doc;
  }
  if (doc && typeof doc === "object" && typeof (doc as { value?: unknown }).value === "string") {
    return (doc as { value: string }).value;
  }
  return "";
}

function lspMemberKind(kind: unknown): MemberKind | undefined {
  if (typeof kind !== "number") {
    return "other";
  }
  if (NON_MEMBER_LSP_KINDS.has(kind)) {
    return undefined;
  }
  return MEMBER_KIND_BY_LSP.get(kind) ?? "other";
}

// LSP SymbolKind (1-indexed) -> the documentSymbol role membersOfType needs.
// DISTINCT from the vscode enum the product transport uses (which is 0-indexed):
// LSP Struct=23, Enum=10, Method=6, Field=8, Function=12. impl blocks carry no
// dedicated kind and are matched by name in membersFromDocumentSymbols.
/** Exported for the measurement rig only (session-v47): the rig translates a
 *  raw LSP symbol tree into the vscode shape `resolvePrefill` expects, and
 *  CHECKS its translation against this table rather than trusting it. */
export function lspSymbolRole(kind: unknown): SymbolRole {
  switch (kind) {
    case 23: // Struct
    case 10: // Enum
      return "container";
    case 6: // Method
      return "method";
    case 12: // Function
      return "function";
    case 8: // Field
      return "field";
    default:
      return "other";
  }
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// A backstop against a wedged rust-analyzer: a request that never gets a reply
// rejects instead of hanging the caller (and the test process) forever. Warm
// queries are single-digit ms; the first post-index query can take a second or
// two. This is a hang guard, not an SLA.
const REQUEST_TIMEOUT_MS = 60_000;

export class RaLspExtractor implements SurfaceExtractor {
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private readonly versions = new Map<string, number>();
  // Last text sent for each uri, so example() can inspect the line under a
  // cursor and re-target a `crate::` path when the cursor sits at the crate name.
  private readonly texts = new Map<string, string>();

  // Readiness: rust-analyzer serves empty completions until its semantic index
  // primes. We track work-done progress tokens; the workspace is ready once the
  // cache has primed and no progress is outstanding (the queue has drained).
  private readonly activeProgress = new Set<string | number>();
  private sawCachePriming = false;
  // Set once the process dies or errors; every pending and future request then
  // rejects with it instead of hanging.
  private dead: Error | undefined;

  private constructor(private readonly proc: ChildProcessWithoutNullStreams) {
    proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    proc.stderr.on("data", () => {}); // RA logs to stderr; not the oracle's concern
    proc.on("error", (err) => this.failAll(new Error(`rust-analyzer process error: ${err.message}`)));
    proc.on("exit", (code, signal) =>
      this.failAll(new Error(`rust-analyzer exited before replying (code=${code}, signal=${signal})`)),
    );
  }

  // Reject every in-flight request with the terminal error and refuse new ones.
  // Turns a dead/absent rust-analyzer into a fast, named failure rather than a
  // forever-pending promise.
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
    workspaceRoot: string;
    /** Override the LSP initializationOptions. Headless callers only (the
     *  measurement harness and witnesses). The SHIPPING Rust path does not come
     *  through here at all: `raExtractor.ts` asks VS Code for a hover via
     *  `vscode.executeHoverProvider`, so rust-analyzer's config there is the
     *  USER's settings and not ours to set. */
    initializationOptions?: unknown;
  }): Promise<RaLspExtractor> {
    const proc = spawn("rust-analyzer", [], {
      cwd: opts.workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CARGO_NET_OFFLINE: process.env.CARGO_NET_OFFLINE ?? "true" },
    });
    const client = new RaLspExtractor(proc);
    const rootUri = pathToUri(opts.workspaceRoot);
    await client.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "extraction" }],
      capabilities: {
        window: { workDoneProgress: true },
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: false,
              documentationFormat: ["markdown", "plaintext"],
              // Advertise ONLY documentation as lazily-resolvable. rust-analyzer
              // defers a field to completionItem/resolve exactly when the client
              // lists it here, so listing `detail` made RA omit the `fn(..)`
              // signature from the initial completion - completeMembers reads
              // detail off that response, so renderMemberSignatures then rendered
              // nothing. Keeping only `documentation` lazy lets RA send detail
              // eagerly, which is what the product transport RaCommandExtractor
              // already gets from the vscode command path, so this makes the
              // oracle transport a faithful stand-in. example() still resolves
              // documentation lazily and is unaffected.
              resolveSupport: { properties: ["documentation"] },
            },
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: {},
          references: {},
          // Flip documentSymbol to the hierarchical, detail-carrying form:
          // WITHOUT this RA returns flat SymbolInformation with detail=undefined,
          // so membersOfType would come back empty and transport parity with the
          // product path would break. A separate capability key; it does not
          // touch completion/hover/codeAction.
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          codeAction: {
            codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } },
            resolveSupport: { properties: ["edit"] },
          },
        },
      },
      initializationOptions:
        opts.initializationOptions ?? { cargo: { buildScripts: { enable: true } }, procMacro: { enable: true } },
    });
    client.notify("initialized", {});
    return client;
  }

  openDocument(uri: string, text: string): void {
    this.versions.set(uri, 1);
    this.texts.set(uri, text);
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "rust", version: 1, text },
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
    // Ready when cache priming has happened and the progress queue has drained.
    // A short settle absorbs the gap between rust-analyzer's paired priming
    // passes so we do not resolve on the first of two.
    for (;;) {
      if (this.dead) {
        throw this.dead;
      }
      if (this.sawCachePriming && this.activeProgress.size === 0) {
        await delay(300);
        if (this.sawCachePriming && this.activeProgress.size === 0) {
          return;
        }
      }
      if (Date.now() > deadline) {
        throw new Error("rust-analyzer did not become ready before the timeout");
      }
      await delay(100);
    }
  }

  async completeMembers(cursor: SourceCursor): Promise<CompletionMember[]> {
    // A freshly-applied edit can lag the index by a few ms; retry a bounded
    // number of times on an empty result so indexing lag does not read as a
    // genuinely unresolved receiver. Product transport does not need this; the
    // oracle client absorbs the mid-edit race the test drives.
    for (let attempt = 0; attempt < 8; attempt++) {
      const members = this.mapCompletion(await this.completionRequest(cursor));
      if (members.length > 0 || attempt === 7) {
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
    return parseHover(hoverMarkdown(result.contents));
  }

  async example(cursor: SourceCursor, prefer?: string): Promise<string | undefined> {
    // The usage example lives in a constructor's (or type's) documentation, which
    // rust-analyzer only fills in on completionItem/resolve. Complete at the
    // cursor and resolve candidates for the first Examples block.
    const atCursor = await this.exampleAt(cursor, prefer);
    if (atCursor) {
      return atCursor;
    }
    // A wrong-item cursor (E0432) sits at the crate NAME in a `use crate::Item`
    // path, where completion offers crate roots, not the crate's items. Re-target
    // to just after the crate's `::` so completion returns the real items whose
    // docs carry the example.
    const retarget = this.afterCratePath(cursor);
    if (retarget) {
      return this.exampleAt(retarget, prefer);
    }
    return undefined;
  }

  // The position just after the first `::` on the cursor's line at or after the
  // cursor column, or undefined when there is none (already a member site).
  private afterCratePath(cursor: SourceCursor): SourceCursor | undefined {
    const text = this.texts.get(cursor.uri);
    if (!text) {
      return undefined;
    }
    const line = text.split("\n")[cursor.line];
    if (line === undefined) {
      return undefined;
    }
    const sep = line.indexOf("::", cursor.character);
    if (sep < 0) {
      return undefined;
    }
    return { uri: cursor.uri, line: cursor.line, character: sep + 2 };
  }

  private async exampleAt(cursor: SourceCursor, prefer?: string): Promise<string | undefined> {
    const raw = await this.completionRequest(cursor);
    const items = (Array.isArray(raw) ? raw : ((raw as { items?: unknown[] })?.items ?? [])) as Array<{
      kind?: number;
      label?: unknown;
      documentation?: unknown;
    }>;
    // Map each LSP item into the pure candidate shape (name + trait provenance +
    // constructor kind) and rank it there, so std/blanket-trait noise is dropped
    // and a builder constructor wins the example slot over clone's std example.
    // Identical hygiene to RaCommandExtractor; both transports rank the same way.
    const candidates = items.map((item) => {
      const { name, viaTrait } = parseMemberLabel(typeof item.label === "string" ? item.label : "");
      return { name, viaTrait, isConstructor: item.kind === LSP_CONSTRUCTOR_KIND, item };
    });
    const ranked = rankExampleCandidates(candidates, prefer);
    let resolved = 0;
    for (const { item } of ranked) {
      if (resolved >= EXAMPLE_RESOLVE_CAP) {
        break;
      }
      resolved++;
      let full = item;
      try {
        full = (await this.request("completionItem/resolve", item)) as typeof item;
      } catch {
        // resolve failed: fall back to the unresolved item's own documentation
      }
      const example = extractExample(documentationText(full?.documentation));
      if (example) {
        return example;
      }
    }
    return undefined;
  }

  async qualifyImport(cursor: SourceCursor): Promise<QualifyEdit | undefined> {
    // Ask rust-analyzer for the quickfixes at the identifier under the cursor,
    // and take the "Qualify as `path`" assist: it rewrites the bare name to its
    // full path in place. We prefer it over "Import `path`" precisely because
    // the import action writes a `use` above the function (out of span); qualify
    // stays inside the span.
    const range = this.identifierRange(cursor);
    const raw = await this.request("textDocument/codeAction", {
      textDocument: { uri: cursor.uri },
      range,
      context: { diagnostics: [], only: ["quickfix"] },
    });
    const actions = (Array.isArray(raw) ? raw : []) as Array<{
      title?: string;
      edit?: LspWorkspaceEdit;
      data?: unknown;
    }>;
    const qualify = actions.find((a) => typeof a.title === "string" && /^Qualify as\b/.test(a.title));
    if (!qualify) {
      return undefined;
    }
    let full = qualify;
    if (!full.edit && full.data !== undefined) {
      try {
        full = (await this.request("codeAction/resolve", qualify)) as typeof qualify;
      } catch {
        return undefined;
      }
    }
    return firstEditOf(full.edit);
  }

  // The identifier word around the cursor, from the stored buffer text. RA
  // resolves a codeAction over a range; a range that spans the whole identifier
  // is the reliable trigger.
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

  // Where the workspace uses the symbol under the cursor. rust-analyzer honors
  // `includeDeclaration` itself, so nothing is filtered client-side.
  //
  // NO empty-result retry, unlike completeMembers. There, an empty set could
  // only be an index race and the retry bought a real answer; here `[]` is also
  // the truthful answer for a symbol nobody calls, so a retry loop would spend
  // over a second of the caller's window on every first-use symbol to learn
  // nothing. Indexing lag is whenReady's job, and a caller that skipped it gets
  // the honest empty.
  async references(cursor: SourceCursor, query?: ReferenceQuery): Promise<ReferenceLocation[]> {
    try {
      const reply = await this.request("textDocument/references", {
        textDocument: { uri: cursor.uri },
        position: { line: cursor.line, character: cursor.character },
        context: { includeDeclaration: query?.includeDeclaration === true },
      });
      return toReferenceLocations(reply, query?.maxResults);
    } catch {
      return []; // a dead or wedged RA degrades; the caller keeps the surface it had
    }
  }

  async membersOfType(defCursor: SourceCursor): Promise<CompletionMember[]> {
    // documentSymbol is AST-syntactic (available once the file is open), so no
    // index-lag retry like completeMembers. With hierarchicalDocumentSymbolSupport
    // advertised, RA returns the same hierarchical DocumentSymbol[] the product
    // transport gets, so the shared descent + mapping renders identically.
    const symbols = await this.request("textDocument/documentSymbol", {
      textDocument: { uri: defCursor.uri },
    });
    return membersFromDocumentSymbols(symbols, defCursor, lspSymbolRole);
  }


  /** The raw hierarchical documentSymbol tree for a file. ORACLE/RIG ONLY and
   *  deliberately not on the `SurfaceExtractor` contract - no product code reads
   *  a symbol tree off an extractor, it gets one from
   *  `vscode.executeDocumentSymbolProvider`.
   *
   *  It exists because the measurement rig has no vscode command API, and
   *  `resolvePrefill`'s RECEIVER leg reads `resolved.symbols` and degrades to
   *  nothing without it - which is how every arm this project has run measured a
   *  dark receiver leg while the channel said nothing (session-v47).
   *
   *  KIND NUMBERING IS THE LSP'S, not vscode's; the two differ by one. */
  async documentSymbolsForTest(uri: string): Promise<unknown> {
    return this.request("textDocument/documentSymbol", { textDocument: { uri } });
  }

  dispose(): void {
    this.proc.kill();
  }

  private completionRequest(cursor: SourceCursor): Promise<unknown> {
    return this.request("textDocument/completion", {
      textDocument: { uri: cursor.uri },
      position: { line: cursor.line, character: cursor.character },
    });
  }

  private mapCompletion(result: unknown): CompletionMember[] {
    const items = Array.isArray(result)
      ? result
      : ((result as { items?: unknown[] })?.items ?? []);
    const members: CompletionMember[] = [];
    for (const raw of items) {
      const item = raw as { label?: unknown; detail?: unknown; labelDetails?: unknown; kind?: unknown; sortText?: unknown };
      const kind = lspMemberKind(item.kind);
      if (kind === undefined) {
        continue;
      }
      const label = typeof item.label === "string" ? item.label : "";
      // Shared with the product transport, all four rules: the eager-signature
      // fallback (raEagerDetail), the printed-defaults strip
      // (stripRustGenericDefaults), the blanket-impl drop (isRaBlanketImpl,
      // on the RAW detail as the product does it), and the tier stamp
      // (raSortTextTier). Same wire item, same member, both transports — the
      // raExtractor.ts parity claim.
      const rawDetail = raEagerDetail(item);
      const detail = rawDetail === undefined ? undefined : stripRustGenericDefaults(rawDetail);
      const member = toCompletionMember(label, detail, kind);
      if (isRaBlanketImpl(member.name, rawDetail)) {
        continue;
      }
      member.tier = raSortTextTier(item.sortText);
      if (typeof item.sortText === "string") {
        member.sortText = item.sortText; // raw ranking evidence, never a classifier
      }
      members.push(member);
    }
    return members;
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
          reject(new Error(`rust-analyzer request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method}`));
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
        // An error reply rejects the caller; resolving message.result (undefined
        // on an error) would look identical to a legitimate degrade and let
        // start() proceed on a half-dead client.
        if (message.error !== undefined) {
          waiting.reject(new Error(`rust-analyzer error for ${String(message.id)}: ${JSON.stringify(message.error)}`));
        } else {
          waiting.resolve(message.result);
        }
      }
      return;
    }
    if (message.id !== undefined && message.method !== undefined) {
      // Server-to-client request. Must reply or rust-analyzer can stall: reply
      // an array for a configuration pull, null for everything else.
      const result =
        message.method === "workspace/configuration"
          ? ((message.params as { items?: unknown[] })?.items ?? []).map(() => null)
          : null;
      this.send({ jsonrpc: "2.0", id: message.id, result });
      return;
    }
    if (message.method === "$/progress") {
      this.onProgress(message.params as ProgressParams);
    }
  }

  private onProgress(params: ProgressParams): void {
    const value = params?.value;
    if (!value?.kind) {
      return;
    }
    if (value.kind === "begin") {
      this.activeProgress.add(params.token);
      if (String(params.token).includes("cachePriming")) {
        this.sawCachePriming = true;
      }
    } else if (value.kind === "end") {
      this.activeProgress.delete(params.token);
    }
  }
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

// The first text edit in a workspace edit, as a transport-neutral QualifyEdit.
// The qualify assist carries exactly one edit; this pulls it from either the
// documentChanges or the changes form.
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

interface LspMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface ProgressParams {
  token: string | number;
  value?: { kind?: "begin" | "report" | "end" };
}

// rust-analyzer hover contents is MarkupContent { value } or a MarkedString/
// string, or an array of them. Collect the markdown for parseHover.
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
