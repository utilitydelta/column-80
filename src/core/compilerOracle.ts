/**
 * Compiler oracle: run the language's checker against the project a
 * generation touched and parse its output into a common Diagnostic shape.
 * The checker's own structured output is the input of record; the VS Code
 * diagnostics API is display-only and never feeds this module (stale
 * flycheck against unsaved buffers, lossy flattening). Strategies construct
 * through oracleFor, the one registry; a new language is a new strategy,
 * not a rewrite.
 *
 * Contract: docs/architecture/compiler-oracle.md.
 */

import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { LogFn } from "./completionService";
import { TsOracle } from "./tsOracle";
import { CsOracle } from "./csOracle";
import { PyOracle } from "./pyOracle";
import { GoOracle } from "./goOracle";

// The TS strategy lives in its own module (type-only imports back this way,
// so no runtime cycle) and re-exports here, where every oracle consumer and
// the frozen contract oracles already import from.
export { TsOracle } from "./tsOracle";
export type { TsOracleDeps } from "./tsOracle";
// The C# strategy rides the same seam unchanged.
export { CsOracle } from "./csOracle";
export type { CsOracleDeps } from "./csOracle";
// The Python strategy rides the same seam; its one addition is
// buildCheckCommand's optional filePath param (below).
export { PyOracle } from "./pyOracle";
export type { PyOracleDeps } from "./pyOracle";
// The Go strategy rides the same seam; its one addition is CheckCommand's
// diagnosticsOnStderr flag (below).
export { GoOracle } from "./goOracle";
export type { GoOracleDeps } from "./goOracle";

/** Where a diagnostic came from. `cargo check` can only ever produce the
 *  compile kinds; panic/assertion-failure exist so repair eligibility is
 *  total over everything a future test-running oracle could feed it, and so
 *  bar 4's refuse-assertion case is expressible as data. */
export type DiagnosticKind = "compile-error" | "compile-warning" | "panic" | "assertion-failure";

/** One rustc span, field-for-field from the JSON (camelCased). Byte offsets
 *  are rustc's: bytes into the named file, not UTF-16 code units. */
export interface DiagnosticSpan {
  /** As rustc reports it: relative to the directory the check ran in. */
  fileName: string;
  byteStart: number;
  byteEnd: number;
  /** 1-based, inclusive. */
  lineStart: number;
  lineEnd: number;
  /** 1-based character columns. */
  columnStart: number;
  columnEnd: number;
  isPrimary: boolean;
  /** The expected/found text, e.g. "expected `i32`, found `&str`". */
  label?: string;
}

/** A fix rustc proposed: hoisted from child (help-level) spans that carry
 *  `suggested_replacement`, because that is where rustc puts them, never on
 *  the parent error's own spans. */
export interface DiagnosticSuggestion {
  /** The child help message, e.g. "consider changing this to be mutable". */
  message: string;
  span: DiagnosticSpan;
  replacement: string;
  /** rustc's confidence tag, e.g. "MachineApplicable", "MaybeIncorrect". */
  applicability?: string;
}

export interface Diagnostic {
  kind: DiagnosticKind;
  level: "error" | "warning";
  /** "E0308" for errors, lint name for warnings. Absent on some notes. */
  code?: string;
  message: string;
  /** Parent spans only; at most one has isPrimary per rustc's own output. */
  spans: DiagnosticSpan[];
  suggestions: DiagnosticSuggestion[];
  /** rustc's human-rendered text: the display surface and the repair prompt
   *  both want the exact text a human would have seen. */
  rendered?: string;
}

export interface CheckCommand {
  command: string;
  args: string[];
  cwd: string;
  /** Merged over process.env at spawn. Lets a strategy run the host's own
   *  node as node (ELECTRON_RUN_AS_NODE) without touching the global env. */
  env?: Record<string, string>;
  /** This toolchain's diagnostics arrive on STDERR (`go build`), not stdout
   *  like cargo/tsc/dotnet/pyright. When set, the spawn keeps stderr whole
   *  (no evidence cap) and the orchestrator parses stdout+stderr as one
   *  text. Absent everywhere else, so no existing strategy changes shape. */
  diagnosticsOnStderr?: boolean;
}

export interface OracleCheckResult {
  /** The strategy's checkSuccess verdict, not "diagnostics empty":
   *  warnings leave success true. */
  success: boolean;
  diagnostics: Diagnostic[];
  durationMs: number;
  crateRoot: string;
}

/**
 * Language strategy. Pure decisions only: where the crate root is, what
 * command to run, how to parse what came back. Process spawning lives in
 * runOracleCheck so strategies stay trivially testable.
 */
export interface CompilerOracle {
  readonly language: string;
  /** The human-facing name of the check on the edit-site verdict line,
   *  e.g. "cargo check". Display only; never parsed. */
  readonly checkLabel: string;
  appliesTo(languageId: string): boolean;
  /** Nearest enclosing project manifest dir, or undefined when the file is
   *  outside any project this oracle understands (oracle silently
   *  inapplicable, never an error). */
  detectCrateRoot(filePath: string): string | undefined;
  /** `project` is a coverage-fallback winner (a manifest path the toolchain's
   *  -p equivalent understands); absent means the nearest project. Strategies
   *  without a coverage fallback ignore it. `filePath` is the file the check is
   *  for: single-file-scoped checkers (pyright) target it directly; the others
   *  ignore this additive optional param. */
  buildCheckCommand(crateRoot: string, project?: string, filePath?: string): CheckCommand;
  /** stdout of the check command in, Diagnostics out. Must never throw on
   *  garbage lines: unparseable output yields fewer diagnostics, not a
   *  crashed oracle. crateRoot rides along for strategies whose parse must
   *  resolve the toolchain's relative paths (tsc line/col-to-byte
   *  conversion reads the named files); strategies that never touch disk
   *  ignore it. checkStartMs is when the check spawned: a strategy that
   *  reads disk uses it as the autosave guard (a file changed since then
   *  gets sentinel offsets, never a stale-content conversion). */
  parseCheckOutput(stdout: string, crateRoot?: string, checkStartMs?: number): Diagnostic[];
  /** The run verdict from the check's raw stdout and exit code. Warnings
   *  still succeed; each toolchain encodes its verdict differently (cargo's
   *  build-finished line, tsc's exit code). */
  checkSuccess(stdout: string, exitCode: number): boolean;
  /** Absolute path for a span's possibly-relative fileName, resolved the way
   *  THIS language's toolchain reports paths. */
  resolveDiagnosticPath(
    crateRoot: string,
    fileName: string,
    fileExists?: (p: string) => boolean,
    readManifest?: (p: string) => string | undefined,
  ): string;
  /** Bar 4's refuse-assertion classifier over this language's diagnostic
   *  text. The kind tag is producer-assigned and refused upstream of this. */
  isAssertionShaped(diagnostic: Diagnostic): boolean;
  /** The post-accept test rung. Both absent when the language has none;
   *  runTestOracle skips honestly instead of guessing a command. */
  buildTestCommand?(crateRoot: string, filter: string | string[], opts?: TestCommandOptions): CheckCommand;
  parseTestOutput?(stdout: string): LibtestParse;
  /** The coverage probe: does the project's check actually LOAD this file?
   *  Both absent when the checker's verdict already covers every file the
   *  oracle applies to (cargo). Present where a green can be unearned —
   *  `tsc -p` exits 0 without reading a file its tsconfig excludes — so the
   *  orchestrator asks before trusting the first check of a file. */
  buildCoverageCommand?(crateRoot: string, project?: string): CheckCommand;
  fileCovered?(stdout: string, crateRoot: string, filePath: string): boolean;
  /** The coverage fallback: candidate projects to probe, in order, when
   *  the nearest project's probe answered not-covered - referenced projects
   *  first, then sibling manifests. Absent means not-covered goes straight
   *  to the honest-dark skip. */
  coverageFallbackProjects?(crateRoot: string): string[];
  /** One-line env reasons for the explicit-gesture verdict surface.
   *  Strategies without them keep every skip channel-only. */
  describeNotCovered?(crateRoot: string, filePath: string, probedFallbacks: string[]): string;
  describeMissingRoot?(filePath: string): string | undefined;
  /** The check itself crashed (spawn rejection, or non-zero exit with zero
   *  parseable diagnostics). evidence is the first stderr line when one
   *  exists. */
  describeCheckFailure?(exitCode: number, evidence?: string): string;
  /** The installed-top-level-module catalog for the language's owned-import rung
   *  (the Python `import numpy` steer, resolved from the venv site-packages
   *  offline). Absent for rust/ts/cs — the same optional-method pattern as
   *  buildTestCommand?/buildCoverageCommand?; only PyOracle implements it. */
  catalog?(root: string): string[];
}

/** Injection seams so project-root detection tests need no real projects on
 *  disk and parser tests need no toolchain run. `log` carries parse-skip
 *  evidence; absent means silent skips (the parse result is identical). */
export interface OracleDeps {
  fileExists?: (path: string) => boolean;
  /** Manifest text for Rust's workspace anchor. Injected ALONGSIDE fileExists,
   *  never instead of it: a caller with a virtual filesystem that supplies only
   *  the predicate would have the anchor read a different world's manifests and
   *  silently invert. */
  readManifest?: (path: string) => string | undefined;
  log?: LogFn;
}

export type RustOracleDeps = OracleDeps;

/**
 * The one construction point: the strategy for a VS Code languageId, or
 * undefined when no registered oracle applies (the gesture stays dark —
 * honest inapplicability, never a guess). Call sites hold a CompilerOracle,
 * never a concrete strategy class.
 */
export function oracleFor(languageId: string, deps?: OracleDeps): CompilerOracle | undefined {
  for (const oracle of [new RustOracle(deps), new TsOracle(deps), new CsOracle(deps), new PyOracle(deps), new GoOracle(deps)]) {
    if (oracle.appliesTo(languageId)) {
      return oracle;
    }
  }
  return undefined;
}

/**
 * The rustc runtime-assertion text family: first non-whitespace starts
 * "assertion" and "failed" appears (covers `assertion `left == right` failed`
 * and `assertion failed: ...`). `cargo check` const-evaluates, so the same
 * family also arrives behind rustc's E0080 "evaluation panicked: " prefix
 * (captured live on this box); the prefix is stripped before the test so
 * const asserts are refused too. A custom panic message ("evaluation
 * panicked: limit must be one") is NOT assertion-shaped and stays eligible:
 * an accepted residual, the honest limit of a text seatbelt.
 */
export function rustcAssertionMessage(diagnostic: Diagnostic): boolean {
  let message = diagnostic.message.trimStart();
  if (message.startsWith("evaluation panicked:")) {
    message = message.slice("evaluation panicked:".length).trimStart();
  }
  return message.startsWith("assertion") && message.includes("failed");
}

export class RustOracle implements CompilerOracle {
  readonly language = "rust";
  readonly checkLabel = "cargo check";

  private readonly fileExists: (p: string) => boolean;
  private readonly readManifest: (p: string) => string | undefined;
  private readonly log?: LogFn;

  constructor(deps?: OracleDeps) {
    this.fileExists = deps?.fileExists ?? ((p) => fs.existsSync(p));
    this.readManifest = deps?.readManifest ?? defaultReadManifest;
    this.log = deps?.log;
  }

  appliesTo(languageId: string): boolean {
    return languageId === "rust";
  }

  detectCrateRoot(filePath: string): string | undefined {
    // Nearest manifest wins: in a workspace that scopes the check to the
    // touched member, not the whole workspace.
    let dir = path.dirname(filePath);
    for (;;) {
      if (this.fileExists(path.join(dir, "Cargo.toml"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return undefined;
      }
      dir = parent;
    }
  }

  buildCheckCommand(crateRoot: string): CheckCommand {
    // No --all-targets: the oracle checks what `cargo check` checks, so
    // #[cfg(test)] bodies are outside its sight (named trade in the surface).
    return { command: "cargo", args: ["check", "--message-format=json"], cwd: crateRoot };
  }

  parseCheckOutput(stdout: string): Diagnostic[] {
    const out: Diagnostic[] = [];
    // Cargo re-emits identical diagnostics when a crate compiles for several
    // targets; identical rendered text (both present) collapses to the first.
    const seenRendered = new Set<string>();
    for (const line of stdout.split("\n")) {
      let diagnostic: Diagnostic | undefined;
      try {
        diagnostic = parseCompilerMessageLine(line, this.log);
      } catch (err) {
        if (err instanceof MalformedSpanError) {
          // Drop, never poison: a diagnostic whose own span fields are not
          // finite numbers would put NaN into ranges downstream. The skip
          // is logged so a lying toolchain is visible, not silent.
          this.log?.(`[oracle] parse skipped: malformed span code=${err.code ?? "-"}`);
          continue;
        }
        continue; // garbage tolerance: fewer diagnostics, never a thrown parser
      }
      if (!diagnostic) {
        continue;
      }
      if (diagnostic.rendered !== undefined) {
        if (seenRendered.has(diagnostic.rendered)) {
          continue;
        }
        seenRendered.add(diagnostic.rendered);
      }
      out.push(diagnostic);
    }
    return out;
  }

  checkSuccess(stdout: string, exitCode: number): boolean {
    // cargo's own verdict when it got to say one; exit code otherwise
    // (killed mid-stream leaves no build-finished line).
    return buildFinishedSuccess(stdout) ?? exitCode === 0;
  }

  resolveDiagnosticPath(
    crateRoot: string,
    fileName: string,
    fileExists?: (p: string) => boolean,
    readManifest?: (p: string) => string | undefined,
  ): string {
    // Both seams or neither. Forwarding only `fileExists` let a caller with a
    // virtual filesystem read manifests off the REAL disk, which silently
    // inverts the anchor: the predicate says a workspace root is there and the
    // reader, looking at a different world, says it is not.
    return resolveDiagnosticPath(crateRoot, fileName, fileExists ?? this.fileExists, readManifest ?? this.readManifest);
  }

  isAssertionShaped(diagnostic: Diagnostic): boolean {
    return diagnostic.kind === "assertion-failure" || rustcAssertionMessage(diagnostic);
  }

  buildTestCommand(crateRoot: string, filter: string | string[], opts?: TestCommandOptions): CheckCommand {
    return buildTestCommand(crateRoot, filter, opts);
  }

  parseTestOutput(stdout: string): LibtestParse {
    return parseLibtestOutput(stdout);
  }
}

class MalformedSpanError extends Error {
  constructor(readonly code: string | undefined) {
    super("malformed span");
  }
}

function defaultReadManifest(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Does this Cargo.toml declare a workspace? Read as TOML, not as text, because
 * both cheap answers are wrong on real manifests.
 *
 * A bare `includes("[workspace]")` counts one sitting in a comment or inside a
 * string. A line-anchored regex for `[workspace]` alone misses
 * `[workspace.dependencies]` and `[workspace.package]`, which is how a real
 * workspace root usually declares itself, and it is still fooled by a
 * `[workspace]` at the start of a line INSIDE a multi-line string.
 *
 * So: track multi-line string state, drop comments outside strings, then match
 * the table header.
 */
function declaresWorkspace(toml: string | undefined): boolean {
  if (toml === undefined) {
    // Callers only ask after `fileExists` said yes, so undefined means the
    // manifest is there and could not be READ (permissions, a directory named
    // Cargo.toml). Unknowable, and the two ways to be wrong are not equal: the
    // pre-Q6 code stat'd only and anchored on any manifest, so answering false
    // here would REGRESS a real workspace whose root manifest is unreadable
    // back into the P4-F12 collision, where a foreign root error becomes
    // eligible and a member's function goes to the model. Answering true keeps
    // that case exactly as it shipped.
    return true;
  }
  let inMultiline: string | undefined;
  for (const raw of toml.split(/\r?\n/)) {
    let line = raw;
    if (inMultiline !== undefined) {
      const close = line.indexOf(inMultiline);
      if (close === -1) {
        continue;
      }
      line = line.slice(close + 3);
      inMultiline = undefined;
    }
    // One pass, tracking quotes, so a `#` inside a string is not a comment and
    // a `[workspace]` inside one is not a table header.
    let code = "";
    let quote: string | undefined;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote === undefined && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
        const delim = line.startsWith('"""', i) ? '"""' : "'''";
        const rest = line.slice(i + 3);
        const close = rest.indexOf(delim);
        if (close === -1) {
          inMultiline = delim;
          break;
        }
        i += 3 + close + 2;
        continue;
      }
      if (quote === undefined && (ch === '"' || ch === "'")) {
        quote = ch;
        continue;
      }
      if (quote !== undefined) {
        if (ch === "\\" && quote === '"') {
          i++;
        } else if (ch === quote) {
          quote = undefined;
        }
        continue;
      }
      if (ch === "#") {
        break;
      }
      code += ch;
    }
    if (/^\s*\[\s*["\u0027]?workspace["\u0027]?\s*(\]|\.)/.test(code)) {
      return true;
    }
  }
  return false;
}

/**
 * Absolute path for a span's fileName. rustc reports paths relative to the
 * directory CARGO ran rustc from: the workspace root when the crate is a
 * member (even when the check command's cwd is the member dir), the crate
 * root when standalone. So: absolute passes through; otherwise resolve
 * against the ANCHOR — the outermost ancestor whose Cargo.toml DECLARES A
 * WORKSPACE, or crateRoot itself when no ancestor declares one.
 * The anchor rule kills a path collision: under a workspace, a
 * root-relative "src/lib.rs" belongs to the workspace root crate, never
 * to a member that happens to own the same relative path, because a
 * member's own files always arrive member-prefixed. A nearest-existing
 * join from crateRoot upward remains as fallback for shapes the anchor
 * cannot place; the deterministic crateRoot join is the last resort.
 */
export function resolveDiagnosticPath(
  crateRoot: string,
  fileName: string,
  fileExists: (p: string) => boolean = (p) => fs.existsSync(p),
  readManifest: (p: string) => string | undefined = defaultReadManifest,
): string {
  if (path.isAbsolute(fileName)) {
    return fileName;
  }
  let anchor = crateRoot;
  for (let dir = path.dirname(crateRoot); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "Cargo.toml");
    // A manifest is not a workspace. Queue Q6: this used to keep the outermost
    // manifest of ANY kind, so a crate nested under an unrelated `[package]`
    // anchored there. Measured against cargo 1.96 that is not a miss - the
    // ancestor owns `src/lib.rs` too, `fileExists` says yes, and the diagnostic
    // is attributed to a DIFFERENT REAL FILE that repair can then rewrite. A
    // miss would have been the safe outcome.
    //
    // NEAREST workspace, not outermost, and that is measured too. With nested
    // workspaces cargo runs relative to the INNER one:
    //
    //   $ cd nest/inner/member && cargo check --message-format=short
    //   member/src/lib.rs:1:21: error[E0308]     <- relative to nest/inner
    //
    // An outermost rule lands on nest/member/src/lib.rs, a real file the crate
    // does not own, which is the same class of wrongness this entry fixed.
    if (fileExists(manifest) && declaresWorkspace(readManifest(manifest))) {
      anchor = dir;
      break;
    }
    if (path.dirname(dir) === dir) {
      break;
    }
  }
  const anchored = path.join(anchor, fileName);
  if (fileExists(anchored)) {
    return anchored;
  }
  let dir = crateRoot;
  for (;;) {
    const candidate = path.join(dir, fileName);
    if (fileExists(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.join(crateRoot, fileName);
    }
    dir = parent;
  }
}

// One line of cargo JSON to at most one Diagnostic. Throws
// MalformedSpanError when the diagnostic's own spans carry non-numeric
// offsets; the caller logs and skips (any other throw skips silently).
function parseCompilerMessageLine(line: string, log?: LogFn): Diagnostic | undefined {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof obj !== "object" || obj === null) {
    return undefined;
  }
  const record = obj as Record<string, unknown>;
  if (record.reason !== "compiler-message" || typeof record.message !== "object" || record.message === null) {
    return undefined;
  }
  const msg = record.message as Record<string, unknown>;
  // failure-note is noise and note/help only exist as children: only the two
  // top-level severities become Diagnostics.
  const level = msg.level;
  if (level !== "error" && level !== "warning") {
    return undefined;
  }
  const code = (msg.code as Record<string, unknown> | null | undefined)?.code;
  const codeText = code != null ? String(code) : undefined;
  const spans: DiagnosticSpan[] = [];
  for (const raw of Array.isArray(msg.spans) ? msg.spans : []) {
    const span = mapSpan(raw);
    if (!span) {
      throw new MalformedSpanError(codeText);
    }
    spans.push(span);
  }
  const diagnostic: Diagnostic = {
    kind: level === "error" ? "compile-error" : "compile-warning",
    level,
    message: String(msg.message ?? ""),
    spans,
    suggestions: hoistSuggestions(msg.children, codeText, log),
  };
  if (codeText !== undefined) {
    diagnostic.code = codeText;
  }
  if (msg.rendered != null) {
    diagnostic.rendered = String(msg.rendered);
  }
  return diagnostic;
}

// Only the documented fields ride through; rustc's `expansion` object (and
// anything else) stays behind so macro spans arrive exactly as reported.
// undefined = malformed: non-string file name or a non-finite offset, the
// shapes that would become NaN ranges downstream.
function mapSpan(raw: unknown): DiagnosticSpan | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const numbers = [r.byte_start, r.byte_end, r.line_start, r.line_end, r.column_start, r.column_end];
  if (typeof r.file_name !== "string" || !numbers.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return undefined;
  }
  const span: DiagnosticSpan = {
    fileName: r.file_name,
    byteStart: r.byte_start as number,
    byteEnd: r.byte_end as number,
    lineStart: r.line_start as number,
    lineEnd: r.line_end as number,
    columnStart: r.column_start as number,
    columnEnd: r.column_end as number,
    isPrimary: r.is_primary === true,
  };
  if (r.label != null) {
    span.label = String(r.label);
  }
  return span;
}

// rustc puts fixes on child (help-level) diagnostics' spans, never on the
// parent error's own; flatten them in emitted order, one suggestion per
// child span carrying a suggested_replacement. A malformed child span
// drops only its suggestion (logged): the parent diagnostic is still
// honest without the fix hint.
function hoistSuggestions(children: unknown, code: string | undefined, log?: LogFn): DiagnosticSuggestion[] {
  const out: DiagnosticSuggestion[] = [];
  for (const child of Array.isArray(children) ? children : []) {
    if (typeof child !== "object" || child === null) {
      continue;
    }
    const c = child as Record<string, unknown>;
    for (const rawSpan of Array.isArray(c.spans) ? c.spans : []) {
      if (typeof rawSpan !== "object" || rawSpan === null) {
        continue;
      }
      const s = rawSpan as Record<string, unknown>;
      if (s.suggested_replacement == null) {
        continue;
      }
      const span = mapSpan(s);
      if (!span) {
        log?.(`[oracle] parse skipped: malformed suggestion span code=${code ?? "-"}`);
        continue;
      }
      const suggestion: DiagnosticSuggestion = {
        message: String(c.message ?? ""),
        span,
        replacement: String(s.suggested_replacement),
      };
      if (s.suggestion_applicability != null) {
        suggestion.applicability = String(s.suggestion_applicability);
      }
      out.push(suggestion);
    }
  }
  return out;
}

export interface RunCommandResult {
  stdout: string;
  exitCode: number;
  /** Bounded stderr head, kept ONLY so a failed check with zero parseable
   *  diagnostics can log its reason (a node MODULE_NOT_FOUND stack lands on
   *  stderr with an empty stdout). Never parsed into diagnostics. */
  stderr?: string;
}

export type RunCommandFn = (cmd: CheckCommand, signal?: AbortSignal) => Promise<RunCommandResult>;

export interface RunOracleCheckOptions {
  /** Default: real child-process spawn. Injected for headless tests. */
  runCommand?: RunCommandFn;
  log?: LogFn;
  signal?: AbortSignal;
  /** Receives the strategy-described one-line reason when
   *  the check cannot run (or crashed) for an ENVIRONMENT reason. Fires only
   *  where the strategy carries a describe* method - the channel log lines
   *  are unconditional and unchanged either way. */
  envReason?: (reason: string) => void;
}

// The real spawn behind the injectable seam. stderr is drained (cargo's
// human progress noise lives there, the output of record on stdout) keeping
// only a bounded head for the failed-with-no-diagnostics evidence line.
const STDERR_EVIDENCE_CAP = 500;
const spawnRunCommand: RunCommandFn = (cmd, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, {
      cwd: cmd.cwd,
      signal,
      env: cmd.env ? { ...process.env, ...cmd.env } : undefined,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      // A diagnostics-on-stderr toolchain gets its whole stderr: capping it
      // would truncate the output of record, not progress noise.
      if (cmd.diagnosticsOnStderr) {
        stderr += d;
      } else if (stderr.length < STDERR_EVIDENCE_CAP) {
        stderr = (stderr + d).slice(0, STDERR_EVIDENCE_CAP);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, exitCode: code ?? -1, stderr }));
  });

// The single evidence line for a failed-with-no-diagnostics check. Prefers
// stderr (where a spawn/node crash lands — cargo and tsc put their failure
// reason there, so this stays byte-for-byte their old behavior). Falls back to
// stdout ONLY when stderr is empty: `dotnet build` writes NETSDK1004 and every
// build-infra error to STDOUT with an empty stderr (captured live), so
// without this the C# "restore first" reason could never fire. The stdout
// fallback prefers the first line naming an error over a header line.
function failureEvidence(stderr: string | undefined, stdout: string): string | undefined {
  const fromStderr = firstNonEmptyLine(stderr);
  if (fromStderr !== undefined) {
    return fromStderr;
  }
  const lines = (stdout ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.find((l) => /error/i.test(l)) ?? lines[0];
}

function firstNonEmptyLine(text: string | undefined): string | undefined {
  return text
    ?.split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
}

// cargo's own verdict when it got to say one; exit code otherwise (killed
// mid-stream leaves no build-finished line).
function buildFinishedSuccess(stdout: string): boolean | undefined {
  for (const line of stdout.split("\n")) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown> | null;
      if (obj && obj.reason === "build-finished") {
        return obj.success === true;
      }
    } catch {
      // not JSON: cannot be the build-finished line
    }
  }
  return undefined;
}

/**
 * The one orchestrator: detect root, run the command, parse, emit [oracle]
 * evidence. Resolves undefined when the file sits outside any crate; rejects
 * only when the checker itself could not run (cargo missing, spawn failure).
 * A non-zero exit with parseable diagnostics is a NORMAL result: failing
 * code is what this oracle exists to report.
 */
// Positive coverage answers from ANSWERED probes (exit 0), remembered for
// the extension's lifetime so repeated accepts (and a session's repair
// re-checks) probe once per (root, file). The value is the WINNING project:
// undefined for the nearest project itself, a fallback manifest path when
// the coverage fallback resolved coverage through a referenced/sibling
// project - the repeat check then targets the winner with no new probes.
// Positives only: a file newly added to the project becomes covered on its
// next accept UNLESS an answered-dark entry already holds it (see
// coverageDark below - that staleness is the same accepted trade, healed by
// restart), and a failed-open assumption is never cached (it re-probes
// next accept). The accepted cost runs the other way: a file EXCLUDED after
// an answered positive keeps its stale entry until restart, so its checks
// resurrect the unearned green the probe exists to kill. Weighed against
// re-probing every accept (a full tsc program load) and accepted; tsconfig
// edits mid-session are rare and a restart heals it.
const coverageWinner = new Map<string, string | undefined>();

// The winners' answered-dark twin: (root, file) pairs where the nearest probe
// AND every fallback probe answered (exit 0) and none covers the file. Without
// it the dark path re-spawns nearest + ALL fallback probes on every accept,
// forever, for a file that stays dark (measured: 13 spawns per accept at 12
// siblings). Same staleness trade the positive cache accepted on record: a
// project edited mid-session to cover the file stays dark until restart, and
// a restart heals it. A dark verdict with ANY unanswered probe (crash or
// non-zero exit) is never cached - it must re-probe next accept, the same
// rule that keeps a failed-open assumption out of coverageWinner. The value
// is the probed fallback list, so a repeat accept surfaces the same
// evidence-bearing reason without spawning anything.
const coverageDark = new Map<string, string[]>();

export async function runOracleCheck(
  oracle: CompilerOracle,
  filePath: string,
  opts?: RunOracleCheckOptions,
): Promise<OracleCheckResult | undefined> {
  const log = opts?.log;
  const crateRoot = oracle.detectCrateRoot(filePath);
  if (crateRoot === undefined) {
    log?.(`[oracle] check skipped: no crate root for ${filePath}`);
    return undefined;
  }

  const runCommand = opts?.runCommand ?? spawnRunCommand;

  // A green must be earned: where the strategy carries a coverage probe,
  // the first check of a (root, file) confirms the project actually loads
  // the file. Probe failure fails OPEN with evidence — never worse than
  // trusting the check alone.
  let checkProject: string | undefined;
  if (oracle.buildCoverageCommand && oracle.fileCovered) {
    const key = `${crateRoot}\u0000${filePath}`;
    const cachedDark = coverageDark.get(key);
    if (cachedDark !== undefined) {
      // An answered dark verdict, remembered: zero probes on the repeat
      // accept, the same honest-dark skip and reason as the first.
      log?.(`[oracle] check skipped: ${filePath} is not an input of ${crateRoot} (cached)`);
      if (oracle.describeNotCovered) {
        opts?.envReason?.(oracle.describeNotCovered(crateRoot, filePath, cachedDark));
      }
      return undefined;
    }
    if (coverageWinner.has(key)) {
      checkProject = coverageWinner.get(key);
    } else {
      let covered = true;
      let answered = false;
      try {
        const probe = await runCommand(oracle.buildCoverageCommand(crateRoot), opts?.signal);
        // Only a probe that RAN (exit 0) gets to say "not covered": a
        // node-level crash exits non-zero with an empty stdout, and reading
        // that as absence would silently suppress every future check behind
        // a false "not an input" line. Fail open, with the reason.
        if (probe.exitCode === 0) {
          answered = true;
          covered = oracle.fileCovered(probe.stdout, crateRoot, filePath);
        } else {
          log?.(`[oracle] coverage probe failed (exit ${probe.exitCode}), assuming covered`);
        }
      } catch (err) {
        log?.(`[oracle] coverage probe failed, assuming covered: ${String(err)}`);
      }
      // Coverage fallback: an ANSWERED not-covered probes (a) the nearest
      // manifest's referenced projects and (b) its sibling manifests before
      // going dark; the first covering project wins the check. Runs only on
      // the rare not-covered path, so the hot path spawns nothing new.
      let fallbacks: string[] = [];
      let fallbacksAnswered = true;
      if (answered && !covered && oracle.coverageFallbackProjects) {
        fallbacks = oracle.coverageFallbackProjects(crateRoot);
        for (const candidate of fallbacks) {
          try {
            const probe = await runCommand(oracle.buildCoverageCommand(crateRoot, candidate), opts?.signal);
            // A candidate's probe ANSWERS only on exit 0: a crashed sibling
            // printing `error TS...` to stdout must never fake coverage
            // through fileCovered's old-tsc fail-open branch.
            if (probe.exitCode === 0 && oracle.fileCovered(probe.stdout, crateRoot, filePath)) {
              covered = true;
              checkProject = candidate;
              log?.(`[oracle] coverage fallback: ${filePath} covered by ${candidate}`);
              break;
            }
            if (probe.exitCode !== 0) {
              fallbacksAnswered = false;
            }
          } catch (err) {
            fallbacksAnswered = false;
            log?.(`[oracle] coverage fallback probe failed for ${candidate}: ${String(err)}`);
          }
        }
      }
      if (!covered) {
        log?.(`[oracle] check skipped: ${filePath} is not an input of ${crateRoot}`);
        if (oracle.describeNotCovered) {
          opts?.envReason?.(oracle.describeNotCovered(crateRoot, filePath, fallbacks));
        }
        // The dark twin of the winner entry below, under the same rule: only
        // a FULLY answered dark verdict (nearest + every fallback probe exit
        // 0) is remembered. Any unanswered probe re-probes next accept.
        if (answered && fallbacksAnswered) {
          coverageDark.set(key, fallbacks);
        }
        return undefined;
      }
      // Only an ANSWERED probe earns the cache entry. A failed-open
      // assumption re-probes on the next accept: caching it would let a
      // crashed-then-healed toolchain green an excluded file forever, and
      // a failing probe is the cheap case (no program load behind it).
      if (answered) {
        coverageWinner.set(key, checkProject);
      }
    }
  }

  log?.(`[oracle] check crate=${crateRoot} file=${filePath}${checkProject !== undefined ? ` project=${checkProject}` : ""}`);
  const started = Date.now();
  const checkCmd = oracle.buildCheckCommand(crateRoot, checkProject, filePath);
  let run: RunCommandResult;
  try {
    run = await runCommand(checkCmd, opts?.signal);
  } catch (err) {
    log?.(`[oracle] check failed: ${String(err)}`);
    if (oracle.describeCheckFailure) {
      opts?.envReason?.(oracle.describeCheckFailure(-1, String(err)));
    }
    throw err;
  }

  // For a diagnostics-on-stderr toolchain the output of record is both
  // streams; injected runCommand fakes that only fill stdout still work.
  const output = checkCmd.diagnosticsOnStderr
    ? [run.stdout, run.stderr ?? ""].filter((s) => s.length > 0).join("\n")
    : run.stdout;
  const diagnostics = oracle.parseCheckOutput(output, crateRoot, started);
  const durationMs = Date.now() - started;
  const success = oracle.checkSuccess(output, run.exitCode);
  const errors = diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.filter((d) => d.level === "warning").length;
  log?.(`[oracle] check done ms=${Math.round(durationMs)} errors=${errors} warnings=${warnings} success=${success}`);
  // A failed verdict with nothing parseable is otherwise evidence-free; the
  // reason goes to the channel only, never into diagnostics (one-way invariant).
  if (!success && diagnostics.length === 0) {
    const reason = failureEvidence(run.stderr, run.stdout);
    if (reason) {
      log?.(`[oracle] check failed with no diagnostics: ${reason}`);
    }
    // A failed check that reported NOTHING is a crashed
    // toolchain, not failing code. Strategies that describe it get the
    // explicit-gesture surface line, carrying the same evidence.
    if (oracle.describeCheckFailure) {
      opts?.envReason?.(oracle.describeCheckFailure(run.exitCode, reason));
    }
  }
  return { success, diagnostics, durationMs, crateRoot };
}

// ===========================================================================
// The test rung. A post-accept oracle one rung above the check — it
// EXECUTES code, so it is compile/link-bound and never a keystroke path. For
// Rust the oracle of record is the process exit code plus STABLE libtest text
// lines (never nightly/experimental JSON). Per-language via the optional
// buildTestCommand/parseTestOutput strategy methods; a language without them
// has no rung and runTestOracle skips honestly.
// ===========================================================================

export type TestOutcome = "pass" | "fail" | "ignored";
export interface TestCaseResult {
  name: string;
  outcome: TestOutcome;
}
export interface TestFailureDetail {
  name: string;
  message: string;
}
export interface LibtestParse {
  ran: boolean;
  cases: TestCaseResult[];
  failures: TestFailureDetail[];
  passed: number;
  failed: number;
  ignored: number;
}

// Strip libtest's ANSI colour: SGR sequences (`\x1b[32m`, `\x1b[0m`, `\x1b[m`)
// and the charset-designate reset (`\x1b(B`) it emits around `ok`/`FAILED`.
const ANSI_ESCAPE = /\x1b\[[0-9;]*m|\x1b\(B/g;

/**
 * Parse the STABLE libtest human text into a structured result. Reads the
 * per-test `test <name> ... <ok|FAILED|ignored>` lines, the authoritative
 * `test result:` summary, and the `---- <name> stdout ----` panic blocks.
 * Tolerant of ANSI colour and CRLF; never throws (garbage → an empty,
 * did-not-run result).
 */
export function parseLibtestOutput(stdout: string): LibtestParse {
  const lines = (stdout ?? "").replace(ANSI_ESCAPE, "").split(/\r?\n/);
  let ran = false;
  const cases: TestCaseResult[] = [];
  const failures: TestFailureDetail[] = [];
  // The FAILED test names, from the `... FAILED` lines that always precede the
  // detail blocks. A `---- NAME stdout ----` line is only a real block boundary
  // when NAME is one of these — so a panic MESSAGE that itself contains a
  // `---- x stdout ----` line neither terminates the block early nor fabricates a
  // phantom failure.
  const failedNames = new Set<string>();
  let sumPassed: number | undefined;
  let sumFailed: number | undefined;
  let sumIgnored: number | undefined;

  const isFailedBlockHead = (l: string): string | undefined => {
    const m = /^---- (.+?) stdout ----$/.exec(l);
    return m && failedNames.has(m[1]) ? m[1] : undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^running \d+ tests?\b/.test(line)) {
      ran = true;
      continue;
    }
    const caseM = /^test (.+?) \.\.\. (ok|FAILED|ignored)\b/.exec(line);
    if (caseM) {
      const outcome: TestOutcome = caseM[2] === "ok" ? "pass" : caseM[2] === "FAILED" ? "fail" : "ignored";
      cases.push({ name: caseM[1], outcome });
      if (outcome === "fail") {
        failedNames.add(caseM[1]);
      }
      continue;
    }
    const resM = /^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/.exec(line);
    if (resM) {
      ran = true;
      sumPassed = Number(resM[1]);
      sumFailed = Number(resM[2]);
      sumIgnored = Number(resM[3]);
      continue;
    }
    // A real `---- <failed-name> stdout ----` block: capture the panic/assertion
    // text up to the NEXT failed-name block, the `failures:` name-list, or the
    // `test result:` line. A `----`/`failures:`/`test result:`-shaped line inside
    // the panic text is not a boundary unless it names a known failed test.
    const headName = isFailedBlockHead(line);
    if (headName !== undefined) {
      const msg: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (isFailedBlockHead(lines[j]) !== undefined || /^failures:\s*$/.test(lines[j]) || /^test result:/.test(lines[j])) {
          break;
        }
        msg.push(lines[j]);
      }
      failures.push({ name: headName, message: msg.join("\n").replace(/^\n+/, "").replace(/\s+$/, "") });
      i = j - 1;
      continue;
    }
  }

  // The summary line is authoritative when present; otherwise tally the cases.
  const passed = sumPassed ?? cases.filter((c) => c.outcome === "pass").length;
  const failed = sumFailed ?? cases.filter((c) => c.outcome === "fail").length;
  const ignored = sumIgnored ?? cases.filter((c) => c.outcome === "ignored").length;
  return { ran, cases, failures, passed, failed, ignored };
}

export interface TestCommandOptions {
  noRun?: boolean;
  /** The package/directory argument the toolchain needs, relative to the run
   *  root (Go's `./internal/foo`). Absent for every toolchain that scopes by
   *  cwd alone, which is why cargo's builder ignores it. */
  packageArg?: string;
}

/**
 * `cargo test --lib [--no-run] [-- --exact filter…]` scoped to the library
 * target (where the in-file `#[cfg(test)] mod tests` lives). noRun builds the
 * test binary without running it (the off-critical-path prewarm). Default human
 * output: the parser reads stable libtest text, never the nightly/experimental
 * JSON.
 *
 * Filters go AFTER the `--` separator. Measured against real cargo 1.96, not
 * reasoned about (queue Q3).
 *
 * `cargo test` takes exactly ONE `[TESTNAME]` positional (`cargo test --help`
 * gives the grammar as `cargo test [OPTIONS] [TESTNAME] [-- [ARGS]...]`). So
 * the ARRAY path this function has always advertised never OR-ed anything: it
 * produced `error: unexpected argument 'tests::other' found` and ran no tests
 * at all. Production hits that on every function with two or more generated
 * tests, and `reportNoRun` renders it as "the tests did not compile", which is
 * a lie about code that compiles fine. Past `--`, libtest takes as many filters
 * as it is given and OR-s them, which is what the doc always claimed.
 *
 * What this does NOT fix, deliberately: the filters are still SUBSTRING
 * matches, so a rung scoped to `add` still runs `add_more`. `--exact` is the
 * obvious answer and it is wrong here, which is worth writing down because it
 * looks right: `--exact` matches libtest's FULL path (`tests::add`), and
 * `generatedTestNames` returns bare `fn` names. Measured, the pair runs zero
 * tests, which turns a working red into silence. Prefixing `tests::` is not the
 * fix either: `findCfgTestModule` matches any `mod <name>`, so extending an
 * existing module inherits the developer's own name. Exactness needs the
 * enclosing module resolved and threaded to here, and that is queue Q3b.
 */
export function buildTestCommand(
  crateRoot: string,
  filter: string | string[],
  opts?: TestCommandOptions,
): CheckCommand {
  const args = ["test", "--lib"];
  if (opts?.noRun) {
    args.push("--no-run");
  }
  const filters = (Array.isArray(filter) ? filter : [filter]).filter((f) => f.length > 0);
  if (filters.length > 0) {
    args.push("--", ...filters);
  }
  return { command: "cargo", args, cwd: crateRoot };
}

export interface TestOracleResult {
  ran: boolean;
  success: boolean;
  cases: TestCaseResult[];
  failures: TestFailureDetail[];
  passed: number;
  failed: number;
  ignored: number;
  buildError?: string;
  durationMs: number;
  crateRoot: string;
  /** The runner SAID the filter selected zero tests. Set only when the parse
   *  read a positive tell (Go's `no tests to run`, C#'s `Zero tests ran`,
   *  pytest's `no match in any of`). NOT a compile error, so `buildError` stays
   *  absent and the human must not be told the tests failed to build. */
  filterMatchedNothing?: boolean;
  /** The runner could not start at all: a missing runtime, an unresolvable
   *  import. Also not a compile error and also not a test failure. */
  environmentError?: string;
  /** False when `cases` is KNOWN incomplete (C# never enumerates passing
   *  tests). Absent when the rung did not say, which is every language whose
   *  parse predates the framework seam. */
  casesComplete?: boolean;
  /** ADDED phase 6. What the runner actually SAID, on each stream, verbatim.
   *
   *  It exists for the fourth no-run outcome and only for it. When a run produced
   *  no result and named no reason — not a build error, not an environment error,
   *  not a filter miss — the honest report is "the runner produced no result, and
   *  here is what it said". Phase 2 established the precedent the hard way: a leg
   *  reading one stream reports a failure with no message at all, so BOTH are
   *  carried. Never rendered on a run that classified itself. */
  stdout?: string;
  stderr?: string;
}

/** A test command that writes its structured report to a FILE instead of stdout.
 *  pytest's `--junit-xml` is the case: the XML lands at a path and nothing
 *  parseable reaches stdout, which is the whole reason the format is trustworthy
 *  (a printing test can forge stdout; it cannot write that file).
 *
 *  `tddLang.TestRunCommand` is structurally assignable to this. Unset for cargo,
 *  `go test`, vitest and jest, which all report on stdout and are untouched. */
export interface RungCommand extends CheckCommand {
  /** Always a SYSTEM TEMP path. This product does not write into the human's
   *  repo, and the runner DELETES this path before the spawn. */
  outputFile?: string;
}

export type TestRunCommandFn = (
  cmd: RungCommand,
  signal?: AbortSignal,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface RunTestOracleOptions {
  runCommand?: TestRunCommandFn;
  noRun?: boolean;
  log?: LogFn;
  signal?: AbortSignal;
}

// The real spawn behind the injectable seam. Unlike the check runner, BOTH
// streams are captured: cargo puts compile errors on stderr (the reason a test
// binary did not run), and the libtest results on stdout.
//
// `env` is merged exactly as the CHECK spawn merges it. It used to be dropped,
// which made TestRunCommand.env inert: Go's rung pins GOPROXY/GOWORK/GOENV the
// same way GoOracle's check does, and a rung spawned without them can disagree
// with the check about GOFLAGS and about whether the network is reachable.
const spawnTestRunCommand: TestRunCommandFn = (cmd, signal) =>
  new Promise((resolve, reject) => {
    // The report path is DELETED before the process starts. Measured: pytest
    // leaves a previous report byte-identical on disk when it fails to start, so
    // a stale file would be read as this run's result — a green from a run that
    // never happened, which is worse than the missing plumbing this replaces.
    // Deleting belongs to the real spawn: an injected runner substitutes the
    // whole process, including the file the process would have written, and a
    // caller that fakes the one owns the other. Cleaning up AFTER the run is
    // runRung's, and it landed in phase 6 (scraps.md D8, now closed).
    if (cmd.outputFile !== undefined) {
      try {
        fs.rmSync(cmd.outputFile, { force: true });
      } catch {
        // Best effort, and the residual is stated rather than hidden: a path
        // that will not delete leaves the stale report in place, so the run
        // proceeds and may parse it. Refusing to run at all over a temp file
        // would be a worse trade.
      }
    }
    const child = spawn(cmd.command, cmd.args, {
      cwd: cmd.cwd,
      signal,
      env: cmd.env ? { ...process.env, ...cmd.env } : undefined,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
  });

/** WHERE the test command runs, resolved by the caller rather than derived from
 *  a source file. The rung's root is not the check's root: C# runs from the peer
 *  test project and Go runs from the module root with a package argument, so
 *  neither is `detectCrateRoot(sourceFile)`. `TestPlacement` (src/core/tddLang.ts)
 *  is structurally assignable to this, which is how the seam feeds the rung
 *  without this file depending on the seam. */
export interface TestRunTarget {
  runRoot: string;
  packageArg?: string;
}

/**
 * Run the test rung against the project a file belongs to and surface
 * exactly which tests ran and which failed. Resolves undefined when the file is
 * outside any crate (mirrors runOracleCheck). A non-zero exit with parseable
 * libtest output is a NORMAL result (failing tests are what this reports);
 * rejects only when the spawn itself fails. When the test binary never ran (a
 * compile/link failure — no libtest lines), `buildError` carries the stderr.
 *
 * DELIBERATE (session-v31 phase 1): the goal permitted either keeping this
 * file-path shape or replacing it with a placement-taking one. Both ship. This
 * signature is unchanged and every shipped call site is untouched — it resolves
 * the root the way it always did and hands off to runTestOracleAt, which is the
 * single implementation. Languages whose run root is not the source file's
 * project call runTestOracleAt directly. Two entry points, one body, so the Rust
 * command stays byte-identical.
 */
export async function runTestOracle(
  oracle: CompilerOracle,
  filePath: string,
  filter: string | string[],
  opts?: RunTestOracleOptions,
): Promise<TestOracleResult | undefined> {
  const log = opts?.log;
  if (!oracle.buildTestCommand || !oracle.parseTestOutput) {
    log?.(`[oracle] test skipped: no test rung for ${oracle.language}`);
    return undefined;
  }
  const crateRoot = oracle.detectCrateRoot(filePath);
  if (crateRoot === undefined) {
    log?.(`[oracle] test skipped: no crate root for ${filePath}`);
    return undefined;
  }
  return runTestOracleAt(oracle, { runRoot: crateRoot }, filter, opts);
}

/**
 * The rung against an ALREADY-RESOLVED run root. Same result shape, same green
 * rule, same evidence lines as runTestOracle; the only difference is that the
 * caller says where to run instead of the oracle deriving it from a file path.
 */
export async function runTestOracleAt(
  oracle: CompilerOracle,
  target: TestRunTarget,
  filter: string | string[],
  opts?: RunTestOracleOptions,
): Promise<TestOracleResult | undefined> {
  const log = opts?.log;
  if (!oracle.buildTestCommand || !oracle.parseTestOutput) {
    log?.(`[oracle] test skipped: no test rung for ${oracle.language}`);
    return undefined;
  }
  const crateRoot = target.runRoot;
  const cmd = oracle.buildTestCommand(crateRoot, filter, { noRun: opts?.noRun, packageArg: target.packageArg });
  const filterLabel = (Array.isArray(filter) ? filter.join(",") : filter) || "-";
  const pkgLabel = target.packageArg === undefined ? "" : ` pkg=${target.packageArg}`;
  const parseTestOutput = oracle.parseTestOutput;
  return runRung(
    {
      cmd,
      crateRoot,
      startLog: `[oracle] test crate=${crateRoot}${pkgLabel} filter=${filterLabel}${opts?.noRun ? " (no-run prewarm)" : ""}`,
      parse: (stdout) => parseTestOutput(stdout),
    },
    opts,
  );
}

/** The rung half of `tddLang.TestFramework`, spelled STRUCTURALLY so this file
 *  never imports the seam (the seam already imports this one, and a cycle
 *  between them would be a worse price than a mirrored shape). A real
 *  TestFramework is assignable to this. */
export interface FrameworkRung<P extends TestRunTarget> {
  readonly id: string;
  buildCommand(placement: P, testNames: string[]): RungCommand;
  parseOutput(stdout: string, stderr: string, exitCode: number): RungParse;
}

/** What a rung's parse may say beyond libtest's six values. Every field is
 *  optional here because `CompilerOracle.parseTestOutput` predates them and
 *  says none of them; `tddLang.TestRunParse` is assignable to this. */
export interface RungParse extends LibtestParse {
  filterMatchedNothing?: boolean;
  casesComplete?: boolean;
  environmentError?: string;
  /** The compile error when the PARSE can see it and stderr cannot: `go test
   *  -json` puts it on stdout as `build-output` events and leaves stderr empty.
   *  Absent means stderr is the compile error, which is Rust's shape and stays
   *  byte-frozen. */
  buildError?: string;
}

/**
 * The rung driven by a per-FRAMEWORK strategy rather than a per-LANGUAGE one,
 * for the languages whose assertion idiom and output shape differ within the
 * language (C# has three frameworks, TypeScript two).
 *
 * Same body as runTestOracleAt: one spawn, one green rule, one result object.
 * The framework path exists because `TestFramework.parseOutput` sees stderr and
 * the EXIT CODE, which `CompilerOracle.parseTestOutput(stdout)` never could —
 * and the exit code is the only tell for a C# MTP filter miss (8) and a pytest
 * one (4).
 *
 * Empty `testNames` is refused HERE rather than passed to a builder: a filter
 * that selects nothing is the false green this whole design guards against, and
 * the honest answer is to not run.
 */
export async function runFrameworkTestsAt<P extends TestRunTarget>(
  framework: FrameworkRung<P>,
  placement: P,
  testNames: string[],
  opts?: RunTestOracleOptions,
): Promise<TestOracleResult | undefined> {
  const log = opts?.log;
  if (testNames.length === 0) {
    log?.(`[oracle] test skipped: no test names to run for framework=${framework.id}`);
    return undefined;
  }
  // No prewarm here. `TestFramework.buildCommand` takes no no-run flag, so the
  // command is a REAL test run — and the prewarm verdict is "exit 0 is a warm
  // cache", which on a real run turns a filter that matched nothing into a green.
  const runOpts = opts?.noRun === true ? { ...opts, noRun: false } : opts;
  if (opts?.noRun === true) {
    log?.(`[oracle] test prewarm ignored: framework=${framework.id} builds a real run`);
  }
  const cmd = framework.buildCommand(placement, testNames);
  const pkgLabel = placement.packageArg === undefined ? "" : ` pkg=${placement.packageArg}`;
  return runRung(
    {
      cmd,
      crateRoot: placement.runRoot,
      startLog: `[oracle] test framework=${framework.id} crate=${placement.runRoot}${pkgLabel} filter=${testNames.join(",")}`,
      parse: (stdout, stderr, exitCode) => framework.parseOutput(stdout, stderr, exitCode),
    },
    runOpts,
  );
}

interface RungSpec {
  cmd: RungCommand;
  crateRoot: string;
  startLog: string;
  parse(stdout: string, stderr: string, exitCode: number): RungParse;
}

/** What the parse reads: the report FILE when the command declared one and the
 *  file EXISTS, and the process's real stdout otherwise.
 *
 *  Gated strictly on `outputFile`, so cargo, `go test`, vitest, jest and the
 *  whole `CompilerOracle` path are byte-for-byte what they were.
 *
 *  THE FALLBACK IS AMENDMENT 8c AND IT IS NOT TIDINESS. It used to hand the
 *  parse an empty string. MEASURED on the real C# corpus: a compile failure
 *  writes NO TRX, puts its MSBuild errors on STDOUT, and leaves STDERR EMPTY —
 *  so a leg whose report is missing received nothing on either stream and could
 *  only report a failure with no message at all. That is the same hole phase 2
 *  had to close for `go test -json`, arriving through a different door. The rule
 *  the seam now states: stderr is always the real stderr, and stdout falls back
 *  to the real stdout when no report was written.
 *
 *  Python is unaffected in behaviour: `parsePytestJunitXml` refuses any document
 *  that does not BEGIN as a junit report, so real pytest console text lands on
 *  the same honest did-not-run an empty string did. */
function reportOrStdout(cmd: RungCommand, stdout: string): string {
  if (cmd.outputFile === undefined) {
    return stdout;
  }
  try {
    return fs.readFileSync(cmd.outputFile, "utf8");
  } catch {
    return stdout;
  }
}

// The single rung body both entry points share: spawn, parse, green rule,
// result object, evidence lines. Kept as one function so the executed>0 guard
// cannot be forgotten by the next language's path.
async function runRung(spec: RungSpec, opts?: RunTestOracleOptions): Promise<TestOracleResult> {
  const log = opts?.log;
  log?.(spec.startLog);

  const runCommand = opts?.runCommand ?? spawnTestRunCommand;
  const started = Date.now();
  let run: { stdout: string; stderr: string; exitCode: number };
  try {
    run = await runCommand(spec.cmd, opts?.signal);
  } catch (err) {
    log?.(`[oracle] test failed: ${String(err)}`);
    throw err;
  }
  const durationMs = Date.now() - started;
  const parse = spec.parse(reportOrStdout(spec.cmd, run.stdout), run.stderr, run.exitCode);
  // scraps D8, the half phase 4 left open. The spawner deletes this path BEFORE
  // the process starts, so a stale report is never read as a live one; nothing
  // cleaned it up AFTER, and the path is per target file, so reports accumulated
  // in the temp directory without bound in the number of files a human ran the
  // gesture on. Deleted here rather than in the spawner so the injected-runCommand
  // path cleans up too, and after the parse rather than before it, because the
  // parse is the only reader.
  if (spec.cmd.outputFile !== undefined) {
    try {
      fs.rmSync(spec.cmd.outputFile, { force: true });
    } catch {
      // A report that cannot be removed is temp-directory litter, never a failed
      // test run. The verdict below does not depend on it.
    }
  }

  let success: boolean;
  let buildError: string | undefined;
  if (opts?.noRun) {
    // The prewarm builds the test binary and does not run it, so there are no
    // libtest lines (ran stays false). Its verdict is purely the BUILD: exit 0 is
    // a warm cache, not a failure. Only a non-zero exit carries a real error.
    success = run.exitCode === 0;
    buildError = run.exitCode === 0 ? undefined : run.stderr;
  } else {
    // Green requires that tests actually EXECUTED. A filter that matches nothing
    // yields `0 passed; 0 failed` with exit 0 — reporting that as success would
    // make green a completion proxy again, so it is refused. A
    // build/link failure (never ran) surfaces its stderr as the reason.
    const executed = parse.passed + parse.failed;
    success = parse.ran && parse.failed === 0 && run.exitCode === 0 && executed > 0;
    // A run with no test lines is a build failure ONLY when the parse named no
    // better reason. A filter that matched nothing and a runner that could not
    // start are both `ran: false` and neither is a compile error; reporting
    // their stderr as `buildError` is how the human gets told "the tests did
    // not compile" about a run that compiled fine.
    // The message itself comes from the parse when the parse can see it and
    // stderr cannot: `go test -json` carries the compile error on stdout as
    // `build-output` events with stderr EMPTY, so stderr alone would report a
    // build failure with no message. Rust's parse says nothing here and keeps
    // stderr, byte for byte.
    buildError =
      parse.ran || parse.filterMatchedNothing === true || parse.environmentError !== undefined
        ? undefined
        : (parse.buildError ?? run.stderr);
  }

  const result: TestOracleResult = {
    ran: parse.ran,
    success,
    cases: parse.cases,
    failures: parse.failures,
    passed: parse.passed,
    failed: parse.failed,
    ignored: parse.ignored,
    durationMs,
    crateRoot: spec.crateRoot,
  };
  if (buildError !== undefined) {
    result.buildError = buildError;
  }
  if (parse.filterMatchedNothing === true) {
    result.filterMatchedNothing = true;
  }
  if (parse.environmentError !== undefined) {
    result.environmentError = parse.environmentError;
  }
  if (parse.casesComplete !== undefined) {
    result.casesComplete = parse.casesComplete;
  }
  // Only when the PARSE named no reason of its own: the consumer's fourth
  // sentence needs both streams verbatim, and every other outcome already
  // carries its own message. Keyed on `parse.buildError` rather than on the
  // computed `buildError`, because the computed one falls back to stderr and a
  // fallback is not a classification. Rust's parse never fills it, so a Rust
  // compile failure carries these too and its consumer branch ignores them —
  // `TestFramework.classifiesBuildError` is what tells the two apart.
  if (!parse.ran && !opts?.noRun && parse.buildError === undefined && result.filterMatchedNothing !== true && result.environmentError === undefined) {
    result.stdout = run.stdout;
    result.stderr = run.stderr;
  }
  const whyNot = result.filterMatchedNothing === true ? " filter-matched-nothing" : result.environmentError !== undefined ? " environment-error" : "";
  log?.(
    `[oracle] test done ms=${Math.round(durationMs)} ran=${parse.ran} passed=${parse.passed} failed=${parse.failed} ignored=${parse.ignored} success=${success}${whyNot}`,
  );
  return result;
}
