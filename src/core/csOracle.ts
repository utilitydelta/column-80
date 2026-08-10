/**
 * The C# compiler-oracle strategy. Checks with the project's own
 * `dotnet` SDK on PATH, never a network round-trip: `dotnet build --no-restore`
 * emits Roslyn diagnostics as SARIF v2.1.0 into an out-of-band ErrorLog file,
 * which the parse reads back. Console scraping is refused — .NET 9+ made the
 * terminal logger the default and the console format a moving target; the
 * SARIF ruleId + absolute file URIs are the stable contract.
 *
 * The seam is the SAME shape as RustOracle/TsOracle: a third language needs no
 * interface change. The one wrinkle C# forces —
 * diagnostics arriving in a FILE, not stdout — is dissolved WITHOUT touching
 * the interface: buildCheckCommand chooses a deterministic SARIF path keyed by
 * crateRoot, and parseCheckOutput recomputes that same path (a pure function of
 * crateRoot, no instance state, no temporal coupling), reads + parses + unlinks
 * it. The orchestrator's per-(language, root) serialization keeps a
 * per-root path from racing itself.
 *
 * Contract: docs/architecture/compiler-oracle.md.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import type { CheckCommand, CompilerOracle, Diagnostic, DiagnosticSpan } from "./compilerOracle";
import { LogFn } from "./completionService";

/** Injection seams so detection tests need no real projects on disk and parse
 *  byte-offset tests need no real files. readFile feeds the line/col-to-byte
 *  conversion (undefined = unreadable -> the -1 sentinel); readSarif +
 *  unlinkSarif are the out-of-band ErrorLog round-trip; readDir finds the
 *  *.csproj (any name) and any gating global.json. */
export interface CsOracleDeps {
  fileExists?: (p: string) => boolean;
  readFile?: (p: string) => string | undefined;
  readDir?: (dir: string) => string[];
  statMtimeMs?: (p: string) => number | undefined;
  /** Reads the out-of-band SARIF; undefined when the file is absent (a
   *  NETSDK1004 or a crash writes none) — the missing-sarif -> [] path. */
  readSarif?: (p: string) => string | undefined;
  /** Removes the consumed SARIF; swallows a missing/locked file (the parse is
   *  still honest without the delete). */
  unlinkSarif?: (p: string) => void;
  log?: LogFn;
}

/** The lowest SDK major the coverage probe (`dotnet msbuild -getItem`) exists
 *  on: below MSBuild 17.8 / SDK 8 there is no probe, and fail-closed with no
 *  probe is no oracle — so a global.json pinning older is named
 *  inapplicability for the whole C# oracle (a deliberate scope decision). */
const SDK_FLOOR_MAJOR = 8;

export class CsOracle implements CompilerOracle {
  readonly language = "csharp";
  readonly checkLabel = "dotnet build";

  private readonly fileExists: (p: string) => boolean;
  private readonly readFile: (p: string) => string | undefined;
  private readonly readDir: (dir: string) => string[];
  private readonly statMtimeMs: (p: string) => number | undefined;
  private readonly readSarif: (p: string) => string | undefined;
  private readonly unlinkSarif: (p: string) => void;
  private readonly log?: LogFn;

  constructor(deps?: CsOracleDeps) {
    this.fileExists = deps?.fileExists ?? ((p) => fs.existsSync(p));
    // Source reader for the byte conversion. Decodes by BOM the same way tsc's
    // does: a UTF-16LE source decodes, a UTF-16BE one (no native decode) pins
    // to undefined -> the -1 sentinel, the safe direction over a confidently
    // wrong offset.
    this.readFile =
      deps?.readFile ??
      ((p) => {
        try {
          const buf = fs.readFileSync(p);
          if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
            return buf.toString("utf16le");
          }
          if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
            return undefined;
          }
          return buf.toString("utf8");
        } catch {
          return undefined;
        }
      });
    this.readDir =
      deps?.readDir ??
      ((dir) => {
        try {
          return fs.readdirSync(dir);
        } catch {
          return [];
        }
      });
    this.statMtimeMs =
      deps?.statMtimeMs ??
      ((p) => {
        try {
          return fs.statSync(p).mtimeMs;
        } catch {
          return undefined;
        }
      });
    this.readSarif =
      deps?.readSarif ??
      ((p) => {
        try {
          return fs.readFileSync(p, "utf8");
        } catch {
          return undefined; // absent SARIF -> [] (garbage tolerance)
        }
      });
    this.unlinkSarif =
      deps?.unlinkSarif ??
      ((p) => {
        try {
          fs.unlinkSync(p);
        } catch {
          // A missing or locked file is not the parse's problem: the diagnostics
          // were already read. The next check overwrites it regardless.
        }
      });
    this.log = deps?.log;
  }

  appliesTo(languageId: string): boolean {
    return languageId === "csharp";
  }

  detectCrateRoot(filePath: string): string | undefined {
    // Nearest *.csproj wins: in a solution that scopes the check to the touched
    // project, the Cargo.toml/tsconfig discipline. The manifest is a NAME
    // PATTERN (any `*.csproj`), never a fixed filename, so this reads each dir.
    let dir = path.dirname(filePath);
    for (;;) {
      if (this.findCsproj(dir) !== undefined) {
        // SDK floor: a global.json pinning below 8 has no coverage probe, so
        // the whole oracle is honestly inapplicable rather than fail-closed.
        if (this.sdkFloorBlocked(filePath)) {
          this.log?.(`[oracle] cs skipped: global.json pins an SDK below ${SDK_FLOOR_MAJOR} at ${dir}`);
          return undefined;
        }
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return undefined;
      }
      dir = parent;
    }
  }

  // The actual *.csproj path inside a dir (any name — `S.csproj`, `MyApp.csproj`).
  // Sorted so a dir holding several resolves deterministically. undefined when
  // the dir carries none (or cannot be listed).
  private findCsproj(dir: string): string | undefined {
    const names = this.readDir(dir)
      .filter((n) => n.toLowerCase().endsWith(".csproj"))
      .sort();
    return names.length > 0 ? path.join(dir, names[0]) : undefined;
  }

  // The nearest global.json above the file decides the SDK floor (standard
  // dotnet resolution). A version below the floor blocks; an unparseable or
  // version-less global.json does not (fail open — applicable, the check will
  // speak for itself). No global.json anywhere: not blocked.
  private sdkFloorBlocked(filePath: string): boolean {
    let dir = path.dirname(filePath);
    for (;;) {
      const gj = path.join(dir, "global.json");
      if (this.fileExists(gj)) {
        const raw = this.readFile(gj);
        const major = raw !== undefined ? sdkMajor(raw) : undefined;
        return major !== undefined && major < SDK_FLOOR_MAJOR;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return false;
      }
      dir = parent;
    }
  }

  // The deterministic out-of-band SARIF path: a pure function of crateRoot, so
  // buildCheckCommand and parseCheckOutput compute the SAME path with no shared
  // state. Hashed (not the raw path) so it is a single flat tmp filename, and
  // per-root so two projects' checks never collide.
  private sarifPath(crateRoot: string): string {
    const hash = crypto.createHash("sha1").update(crateRoot).digest("hex").slice(0, 16);
    return path.join(os.tmpdir(), `column80-cs-${hash}.sarif`);
  }

  buildCheckCommand(crateRoot: string): CheckCommand {
    const csproj = this.findCsproj(crateRoot) ?? crateRoot;
    // The comma between the ErrorLog path and `version=2` is %2c-ESCAPED: as a
    // single argv token MSBuild splits a RAW comma into two properties (a bogus
    // `version=2` and SARIF v1.0.0). %2c keeps it part of the ErrorLog value
    // and yields v2.1.0. PROVEN via a real spawn.
    const errorLog = `/p:ErrorLog=${this.sarifPath(crateRoot)}%2cversion=2`;
    return {
      command: "dotnet",
      // --no-restore is the offline invariant: `dotnet build` implicitly
      // restores (network) otherwise, and an unrestored project surfaces as the
      // NETSDK1004 "restore first" reason, never a silent network call.
      args: ["build", csproj, "--no-restore", errorLog],
      cwd: crateRoot,
      env: dotnetEnv(),
    };
  }

  buildCoverageCommand(crateRoot: string): CheckCommand {
    const csproj = this.findCsproj(crateRoot) ?? crateRoot;
    // `-getItem:Compile` prints the evaluated Compile item set as JSON in
    // ~0.25s — the probe for the unearned green (a <Compile Remove> broken file
    // builds clean because it is not an input). SDK 8+ only (gated upstream).
    const args = ["msbuild", csproj, "-getItem:Compile"];
    // Multi-TFM pin: the OUTER evaluation of a <TargetFrameworks> project
    // returns an EMPTY Compile set — the items live in each inner per-TFM
    // build. Probing unpinned would blind coverage on every multi-target
    // project (measured on a net8+net10 project), switching the safety
    // mechanism off silently. Pin the first TFM so the inner build's real
    // Compile set comes back. A cheap csproj read, no extra spawn; the pinned
    // probe stays offline (a `-getItem` does not implicit-restore, PROVEN via
    // a real spawn). The empty-set fail-open below is the backstop for
    // any multi-TFM shape this static read cannot see (TFMs from props).
    const first = this.firstMultiTargetFramework(csproj);
    if (first !== undefined) {
      args.push(`-p:TargetFramework=${first}`);
    }
    return { command: "dotnet", args, cwd: crateRoot, env: dotnetEnv() };
  }

  // The first framework of a project's <TargetFrameworks> (PLURAL) as written
  // in the csproj, or undefined when the project is single-target (no pin
  // needed — the outer eval already carries the Compile set) or when the value
  // is an unresolved MSBuild expression / unreadable. A static XML read, not a
  // spawn.
  private firstMultiTargetFramework(csprojPath: string): string | undefined {
    const raw = this.readFile(csprojPath);
    if (raw === undefined) {
      return undefined;
    }
    const m = /<TargetFrameworks>([^<]*)<\/TargetFrameworks>/i.exec(raw);
    if (!m) {
      return undefined;
    }
    const first = m[1].split(";").map((t) => t.trim()).find((t) => t.length > 0);
    // A `$(...)` value comes from a property we cannot resolve statically;
    // pinning it literally would be wrong, so leave it unpinned and let the
    // empty-set backstop fail open.
    return first !== undefined && !first.includes("$(") ? first : undefined;
  }

  fileCovered(stdout: string, _crateRoot: string, filePath: string): boolean {
    // Fail OPEN on a probe that did not answer cleanly (unparseable, or no
    // Compile item set): never worse than trusting the check alone. Only a
    // clean answer whose FullPath set omits the file reports not-covered.
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return true;
    }
    const compile = (parsed as { Items?: { Compile?: unknown } } | null)?.Items?.Compile;
    // An EMPTY Compile set is never a legitimate "definitely excluded" answer —
    // it is the multi-TFM outer-eval shape (or a degenerate project). The
    // SAFETY BACKSTOP: fail open on it, so an unforeseen shape degrades to
    // trusting the check, never to a false-dark that hides a real broken file.
    if (!Array.isArray(compile) || compile.length === 0) {
      return true;
    }
    const target = path.resolve(filePath);
    return compile.some((item) => {
      const full = (item as { FullPath?: unknown } | null)?.FullPath;
      return typeof full === "string" && path.resolve(full) === target;
    });
  }

  parseCheckOutput(_stdout: string, crateRoot?: string, checkStartMs?: number): Diagnostic[] {
    // Diagnostics ride the out-of-band SARIF, not stdout. Recompute the same
    // deterministic path buildCheckCommand wrote to, read + parse + unlink it.
    // Every failure mode — no crateRoot, absent file, invalid JSON, a malformed
    // region — degrades to fewer diagnostics (or []), never a throw.
    if (crateRoot === undefined) {
      return [];
    }
    const sarifFile = this.sarifPath(crateRoot);
    const raw = this.readSarif(sarifFile);
    if (raw === undefined) {
      return []; // NETSDK1004 / crash / clean-with-no-log wrote nothing
    }
    let doc: unknown;
    try {
      doc = JSON.parse(raw);
    } catch {
      this.unlinkSarif(sarifFile);
      return []; // truncated / invalid SARIF -> [], the garbage-tolerance rule
    }
    this.unlinkSarif(sarifFile);

    const out: Diagnostic[] = [];
    // One read per distinct source file per parse: several diagnostics in one
    // file convert against the same content + one autosave stat.
    const cache = new Map<string, { content?: string; changed: boolean }>();
    const read = (abs: string): { content?: string; changed: boolean } => {
      const cached = cache.get(abs);
      if (cached !== undefined) {
        return cached;
      }
      let content = this.readFile(abs);
      // Roslyn strips a BOM before counting columns and the editor buffer the
      // repair scope encodes against never carries one; drop it so all three
      // share one coordinate system.
      if (content !== undefined && content.charCodeAt(0) === 0xfeff) {
        content = content.slice(1);
      }
      // Autosave guard: the check read disk as it stood at check start; a file
      // saved SINCE then makes the line/col-to-byte conversion lie. Floored
      // because mtimeMs carries sub-ms precision while checkStartMs is integer.
      let changed = false;
      if (content !== undefined && checkStartMs !== undefined) {
        const mtime = this.statMtimeMs(abs);
        if (mtime !== undefined && Math.floor(mtime) > checkStartMs) {
          changed = true;
          this.log?.(`[oracle] ${abs}: content changed since check; offsets skipped`);
        }
      }
      const entry = { content, changed };
      cache.set(abs, entry);
      return entry;
    };

    for (const run of asArray((doc as { runs?: unknown } | null)?.runs)) {
      for (const result of asArray((run as { results?: unknown } | null)?.results)) {
        const diagnostic = this.mapResult(result, read);
        if (diagnostic !== undefined) {
          out.push(diagnostic);
        }
      }
    }
    return out;
  }

  // One SARIF result to at most one Diagnostic. note-level (and any non
  // error/warning) is dropped: Diagnostic.level is error|warning only, the
  // RustOracle two-severities rule. A missing message/region yields fewer
  // fields, never a throw.
  private mapResult(
    result: unknown,
    read: (abs: string) => { content?: string; changed: boolean },
  ): Diagnostic | undefined {
    if (typeof result !== "object" || result === null) {
      return undefined;
    }
    const r = result as Record<string, unknown>;
    const level = r.level;
    if (level !== "error" && level !== "warning") {
      return undefined;
    }
    const message = (r.message as { text?: unknown } | null | undefined)?.text;
    const spans: DiagnosticSpan[] = [];
    for (const loc of asArray(r.locations)) {
      const span = this.mapLocation(loc, read);
      if (span !== undefined) {
        spans.push(span);
      }
    }
    const diagnostic: Diagnostic = {
      kind: level === "error" ? "compile-error" : "compile-warning",
      level,
      message: typeof message === "string" ? message : "",
      spans,
      suggestions: [],
    };
    if (typeof r.ruleId === "string") {
      diagnostic.code = r.ruleId;
    }
    return diagnostic;
  }

  // One SARIF physicalLocation to a span. The file:// URI is decoded to an
  // absolute filesystem path (percent-encoding, unicode); columns are UTF-16
  // code units (columnKind utf16CodeUnits) converted to UTF-8 byte offsets the
  // same prefix-slice-then-encode way tsOracle does. A malformed region or an
  // undecodable URI drops the span (fewer spans), never throws.
  private mapLocation(
    loc: unknown,
    read: (abs: string) => { content?: string; changed: boolean },
  ): DiagnosticSpan | undefined {
    const phys = (loc as { physicalLocation?: unknown } | null)?.physicalLocation;
    if (typeof phys !== "object" || phys === null) {
      return undefined;
    }
    const p = phys as Record<string, unknown>;
    const uri = (p.artifactLocation as { uri?: unknown } | null | undefined)?.uri;
    const region = p.region;
    if (typeof uri !== "string" || typeof region !== "object" || region === null) {
      return undefined;
    }
    const fileName = decodeFileUri(uri);
    if (fileName === undefined) {
      return undefined;
    }
    const reg = region as Record<string, unknown>;
    const nums = [reg.startLine, reg.startColumn, reg.endLine, reg.endColumn];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return undefined;
    }
    const startLine = reg.startLine as number;
    const startColumn = reg.startColumn as number;
    const endLine = reg.endLine as number;
    const endColumn = reg.endColumn as number;

    let byteStart = -1;
    let byteEnd = -1;
    const { content, changed } = read(fileName);
    if (changed) {
      // Autosave-guarded to the -1 sentinel, already logged once per file.
    } else if (content === undefined) {
      this.log?.(`[oracle] parse skipped byte offsets: unreadable ${fileName}`);
    } else {
      byteStart = byteOffset(content, startLine, startColumn);
      byteEnd = byteOffset(content, endLine, endColumn);
      if (byteStart === -1 || byteEnd === -1) {
        this.log?.(`[oracle] parse skipped byte offsets: region past EOF in ${fileName}`);
      }
    }

    return {
      fileName,
      byteStart,
      byteEnd,
      lineStart: startLine,
      lineEnd: endLine,
      columnStart: startColumn,
      columnEnd: endColumn,
      isPrimary: true,
    };
  }

  checkSuccess(_stdout: string, exitCode: number): boolean {
    // Exit 0 is the whole verdict (warnings still succeed — they live in the
    // SARIF, never on the exit code). A NETSDK1004 exits non-zero and reads as
    // failure here; the not-restored DISTINCTION is drawn by describeCheckFailure.
    return exitCode === 0;
  }

  resolveDiagnosticPath(_crateRoot: string, fileName: string): string {
    // C# SARIF paths are already absolute (decoded from file:// URIs), so no
    // crateRoot anchoring — that was a rustc relative-path behavior.
    return fileName;
  }

  isAssertionShaped(diagnostic: Diagnostic): boolean {
    // Kind tag only. The check produces compile diagnostics, never runtime
    // assertion text, so no text family exists: a CS#### message that happens
    // to read like a rustc assertion stays eligible for repair.
    return diagnostic.kind === "assertion-failure";
  }

  /** The not-restored evidence line for the explicit-gesture surface.
   *  NETSDK1004 (an MSBuild error, never a Roslyn diagnostic — it is absent
   *  from the SARIF) is the not-restored inapplicability: name the fix
   *  (restore), NEVER an auto-restore (the offline invariant). */
  describeCheckFailure(exitCode: number, evidence?: string): string {
    if (evidence && /NETSDK1004/.test(evidence)) {
      return `project is not restored — run \`dotnet restore\` first (the oracle never restores: offline invariant)`;
    }
    if (exitCode < 0) {
      return `dotnet could not be spawned${evidence ? `: ${evidence}` : ""}`;
    }
    return `dotnet build crashed (exit ${exitCode})${evidence ? `: ${evidence}` : ""}`;
  }

  /** The one-line reason detectCrateRoot resolved undefined, for the
   *  explicit-gesture surface. undefined when a root actually resolves. */
  describeMissingRoot(filePath: string): string | undefined {
    let dir = path.dirname(filePath);
    for (;;) {
      if (this.findCsproj(dir) !== undefined) {
        if (this.sdkFloorBlocked(filePath)) {
          return `a global.json above ${filePath} pins an SDK below ${SDK_FLOOR_MAJOR} (no coverage probe below MSBuild 17.8)`;
        }
        return undefined;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return `no .csproj above ${filePath}`;
      }
      dir = parent;
    }
  }
}

// The child env for every dotnet invocation. Non-negotiable for a local-first
// product: the CLI phones home by default, and the logo banner pollutes stdout.
//
// Exported in phase 5 so the TDD rung's `dotnet test` spawns with the SAME
// environment the check's `dotnet build` does. What is NOT here is as
// load-bearing as what is: `DOTNET_ROLL_FORWARD` is absent deliberately, because
// setting it would run the human's tests on a runtime their own `dotnet test`
// refuses and let the rung report GREEN where their own command hard-fails.
export function dotnetEnv(): Record<string, string> {
  return { DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// A file:// URI to an absolute filesystem path, percent-decoded (spaces,
// unicode). undefined on an undecodable/non-file URI — the span is dropped
// rather than pointing the byte conversion at a bogus path.
function decodeFileUri(uri: string): string | undefined {
  try {
    return uri.startsWith("file:") ? fileURLToPath(uri) : decodeURIComponent(uri);
  } catch {
    return undefined;
  }
}

// The single 1-based SDK major of a global.json's sdk.version ("8.0.100" -> 8),
// or undefined when absent/unparseable. global.json is plain JSON in the wild.
function sdkMajor(raw: string): number | undefined {
  try {
    const version = (JSON.parse(raw) as { sdk?: { version?: unknown } } | null)?.sdk?.version;
    if (typeof version !== "string") {
      return undefined;
    }
    const major = Number.parseInt(version.split(".")[0], 10);
    return Number.isFinite(major) ? major : undefined;
  } catch {
    return undefined;
  }
}

// UTF-8 byte offset of a 1-based (line, col) into content, where col counts
// UTF-16 code units (the SARIF columnKind). Slice the UTF-16 prefix, then
// encode to bytes — the same rule vscode's byteScope uses, so the two sides
// cannot disagree. -1 when the line runs past EOF (a position that can never
// test inside a repair scope: refuse, the safe direction).
function byteOffset(content: string, line: number, col: number): number {
  let lineStart = 0;
  for (let l = 1; l < line; l++) {
    const next = content.indexOf("\n", lineStart);
    if (next === -1) {
      return -1;
    }
    lineStart = next + 1;
  }
  // A column past this line's end refuses too, the symmetric twin of the
  // line-past-EOF guard: on the autosave race (disk shorter than what the
  // checker analyzed) an out-of-range column would otherwise slice into the
  // NEXT line. A col landing AT the line end (the newline) is a valid range
  // end, so only a col strictly past it is refused.
  const nl = content.indexOf("\n", lineStart);
  const lineEnd = nl === -1 ? content.length : nl;
  const target = lineStart + col - 1;
  if (target > lineEnd) {
    return -1;
  }
  return Buffer.byteLength(content.slice(0, target), "utf8");
}
