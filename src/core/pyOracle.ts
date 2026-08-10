/**
 * The Python compiler-oracle strategy. Checks with the extension's own
 * bundled pyright (an npm dependency shipped in the .vsix), never a global or
 * networked one: `pyright --outputjson --pythonpath <interpreter> <file>` runs
 * pyright headless and its structured JSON is the input of record.
 *
 * The clean win pyright gives over the tsc/dotnet strategies: single-file
 * invocation. `pyright <file>` analyzes ONLY that file (filesAnalyzed 1), so a
 * pre-existing error in a sibling never contaminates the generation's repair
 * signal, and no config file is ever written — `--pythonpath <FILE>` is a
 * first-class CLI flag, so the exclude-REPLACES-defaults footgun never arises.
 * Coverage folds into checkSuccess (filesAnalyzed 0 is the unearned-green tell),
 * so there is no separate coverage probe pair.
 *
 * The symmetric COST, named not hidden (the RustOracle --all-targets note is the
 * precedent for recording such a trade): single-file scope is strictly narrower
 * than the whole-unit Rust/TS/C# checks. When the generation edits THIS file's
 * own signature and breaks a caller in a SIBLING file, `pyright <file>` stays
 * green (filesAnalyzed 1, errorCount 0) — an OUTBOUND break reads as a clean
 * generation. Rust/TS/C# surface it as a clean-out-of-span diagnostic; here it is
 * honest-dark. The dark-site evidence line is what keeps it honest;
 * broadening to a whole-program check is rejected because it reintroduces the
 * sibling-contamination this scope exists to avoid.
 *
 * The seam is the SAME shape as the other three oracles. The one thing pyright
 * needs that the interface did not carry — the specific target file, for
 * single-file scope — is an additive optional 3rd param on buildCheckCommand
 * that Rust/Ts/Cs ignore.
 *
 * Contract: docs/architecture/compiler-oracle.md.
 */

import * as fs from "fs";
import * as path from "path";
import type { CheckCommand, CompilerOracle, Diagnostic, DiagnosticSpan, OracleCheckResult } from "./compilerOracle";
import { LogFn } from "./completionService";

/** Injection seams so detection tests need no real projects on disk and parse
 *  byte-offset tests need no real files. readFile feeds the line/col-to-byte
 *  conversion (undefined = unreadable -> the -1 sentinel); readDir walks a
 *  venv's site-packages for the steering catalog; statMtimeMs is the autosave
 *  guard. workspaceFolders is the headless bare-root fallback (pyright needs no
 *  manifest, so a workspace folder that contains the file is a valid root).
 *  pyrightEntry overrides the bundled-pyright resolution (the product/test
 *  seam; the default walks node_modules beside the module). */
export interface PyOracleDeps {
  fileExists?: (p: string) => boolean;
  readFile?: (p: string) => string | undefined;
  readDir?: (dir: string) => string[];
  statMtimeMs?: (p: string) => number | undefined;
  workspaceFolders?: string[];
  pyrightEntry?: string;
  log?: LogFn;
}

/** The project markers that name a Python root, checked nearest-first. pyright
 *  itself needs none of these to run, so the bare workspace-folder fallback in
 *  detectCrateRoot handles a marker-less tree. */
const ROOT_MARKERS = ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "pyrightconfig.json"];

/**
 * The project's own interpreter: the venv beside `root`, POSIX layouts first
 * then the Windows `Scripts` variant. undefined when no venv is there.
 *
 * The check feeds it to `--pythonpath`; the TDD rung (`tddPy.ts`) spawns it to
 * PROVE a generated import resolves and then to run pytest. Exported so the two
 * cannot drift onto different interpreters and disagree about what is installed.
 */
export function resolvePythonInterpreter(root: string, fileExists: (p: string) => boolean): string | undefined {
  return [
    path.join(root, ".venv", "bin", "python"),
    path.join(root, "venv", "bin", "python"),
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, "venv", "Scripts", "python.exe"),
  ].find((c) => fileExists(c));
}

export class PyOracle implements CompilerOracle {
  readonly language = "python";
  readonly checkLabel = "pyright";

  private readonly fileExists: (p: string) => boolean;
  private readonly readFile: (p: string) => string | undefined;
  private readonly readDir: (dir: string) => string[];
  private readonly statMtimeMs: (p: string) => number | undefined;
  private readonly workspaceFolders: string[];
  private readonly pyrightEntryOverride?: string;
  private readonly log?: LogFn;

  constructor(deps?: PyOracleDeps) {
    this.fileExists = deps?.fileExists ?? ((p) => fs.existsSync(p));
    // The source reader for the byte conversion. Strips a leading BOM (pyright's
    // LSP offsets and the editor buffer the repair scope encodes against both
    // count from the first real character); an unreadable file is undefined ->
    // the -1 sentinel, the safe direction over a confidently-wrong offset.
    this.readFile =
      deps?.readFile ??
      ((p) => {
        try {
          return fs.readFileSync(p, "utf8");
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
    this.workspaceFolders = deps?.workspaceFolders ?? [];
    this.pyrightEntryOverride = deps?.pyrightEntry;
    this.log = deps?.log;
  }

  appliesTo(languageId: string): boolean {
    return languageId === "python";
  }

  detectCrateRoot(filePath: string): string | undefined {
    // Nearest marker wins, parent-ward: in a monorepo that scopes the check to
    // the touched package, the Cargo.toml/tsconfig discipline.
    let dir = path.dirname(filePath);
    for (;;) {
      for (const marker of ROOT_MARKERS) {
        if (this.fileExists(path.join(dir, marker))) {
          return dir;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    // Bare-folder fallback: pyright needs no manifest, so a workspace folder
    // that contains the file is a valid root. The NEAREST (longest) containing
    // folder wins, mirroring the nearest-marker rule.
    return this.nearestWorkspaceFolder(filePath);
  }

  // The most specific injected workspace folder that is an ancestor of (or
  // equals) the file's directory, or undefined when none contains it.
  private nearestWorkspaceFolder(filePath: string): string | undefined {
    const fileDir = path.resolve(path.dirname(filePath));
    let best: string | undefined;
    for (const folder of this.workspaceFolders) {
      const resolved = path.resolve(folder);
      const contains = fileDir === resolved || fileDir.startsWith(resolved + path.sep);
      if (contains && (best === undefined || resolved.length > best.length)) {
        best = resolved;
      }
    }
    return best;
  }

  // The interpreter beside the crate root, POSIX venv layouts first then the
  // Windows Scripts variant. Feeds --pythonpath; undefined -> the flag is
  // omitted and pyright falls back to system python (the missing-imports storm
  // gate then names the environment honestly).
  private resolveInterpreter(crateRoot: string): string | undefined {
    return resolvePythonInterpreter(crateRoot, this.fileExists);
  }

  // The bundled pyright CLI entry (pyright/index.js), resolved by walking
  // node_modules from THIS module's location — the extension ships pyright as a
  // runtime dependency, so it sits at <ext>/node_modules/pyright regardless of
  // the user's project. A filesystem walk (not require.resolve) keeps the
  // bundler out of it. The deterministic fallback exists so a direct caller
  // gets a failing spawn instead of a throw when pyright cannot be located.
  private resolvePyrightEntry(): string {
    if (this.pyrightEntryOverride !== undefined) {
      return this.pyrightEntryOverride;
    }
    let dir = __dirname;
    for (;;) {
      const candidate = path.join(dir, "node_modules", "pyright", "index.js");
      if (this.fileExists(candidate)) {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return path.join(__dirname, "node_modules", "pyright", "index.js");
      }
      dir = parent;
    }
  }

  // filePath is the additive 3rd param (Rust/Ts/Cs ignore it). pyright REQUIRES
  // the target file for single-file scope; absent, it degrades to checking the
  // crate root (never a crash). Spawned through the HOST'S OWN node
  // (process.execPath as node via ELECTRON_RUN_AS_NODE, inert under plain node),
  // never the .bin shim: GUI-launched editors have no node on PATH and the
  // Windows .bin shim is a .cmd that cannot be spawned plainly — the tsc
  // strategy's rule.
  buildCheckCommand(crateRoot: string, _project?: string, filePath?: string): CheckCommand {
    const target = filePath ?? crateRoot;
    const args = [this.resolvePyrightEntry(), "--outputjson"];
    const interpreter = this.resolveInterpreter(crateRoot);
    if (interpreter !== undefined) {
      args.push("--pythonpath", interpreter);
    }
    args.push(target);
    return {
      command: process.execPath,
      args,
      cwd: crateRoot,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }

  parseCheckOutput(stdout: string, _crateRoot?: string, checkStartMs?: number): Diagnostic[] {
    let doc: unknown;
    try {
      doc = JSON.parse(stdout);
    } catch {
      return []; // garbage / truncated JSON -> [], never a throw
    }
    const generalDiagnostics = (doc as { generalDiagnostics?: unknown } | null)?.generalDiagnostics;
    if (!Array.isArray(generalDiagnostics)) {
      return []; // a shape without the array is not a check result
    }

    const out: Diagnostic[] = [];
    // One read per distinct source file per parse: several diagnostics in one
    // file convert against the same content + one autosave stat. pyright's
    // `file` is already absolute, so it is the read key directly.
    const cache = new Map<string, { content?: string; changed: boolean }>();
    const read = (abs: string): { content?: string; changed: boolean } => {
      const cached = cache.get(abs);
      if (cached !== undefined) {
        return cached;
      }
      let content = this.readFile(abs);
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

    for (const item of generalDiagnostics) {
      const diagnostic = this.mapDiagnostic(item, read);
      if (diagnostic !== undefined) {
        out.push(diagnostic);
      }
    }
    return out;
  }

  // One pyright generalDiagnostics item to at most one Diagnostic. "information"
  // (and any non error/warning) is dropped: Diagnostic.level is error|warning
  // only, the RustOracle two-severities rule. A malformed range yields fewer
  // fields, never a throw.
  private mapDiagnostic(
    item: unknown,
    read: (abs: string) => { content?: string; changed: boolean },
  ): Diagnostic | undefined {
    if (typeof item !== "object" || item === null) {
      return undefined;
    }
    const r = item as Record<string, unknown>;
    const severity = r.severity;
    if (severity !== "error" && severity !== "warning") {
      return undefined;
    }
    const level = severity;
    const diagnostic: Diagnostic = {
      kind: level === "error" ? "compile-error" : "compile-warning",
      level,
      message: typeof r.message === "string" ? r.message : "",
      spans: [],
      suggestions: [],
    };
    if (typeof r.rule === "string") {
      diagnostic.code = r.rule;
    }
    const span = this.mapSpan(r.file, r.range, read);
    if (span !== undefined) {
      diagnostic.spans.push(span);
    }
    return diagnostic;
  }

  // A pyright 0-based LSP range to a 1-based DiagnosticSpan. line+1/character+1
  // move to the rustc-shaped 1-based coordinate; byte offsets convert the LSP
  // UTF-16 character to a UTF-8 byte by reading the named absolute file. A
  // changed (autosave) or unreadable file pins the offsets to the -1 sentinel;
  // a non-string file or malformed range drops the span, never throws.
  private mapSpan(
    file: unknown,
    range: unknown,
    read: (abs: string) => { content?: string; changed: boolean },
  ): DiagnosticSpan | undefined {
    if (typeof file !== "string" || typeof range !== "object" || range === null) {
      return undefined;
    }
    const start = (range as { start?: unknown }).start;
    const end = (range as { end?: unknown }).end;
    const s = this.lspPos(start);
    const e = this.lspPos(end);
    if (s === undefined || e === undefined) {
      return undefined;
    }

    let byteStart = -1;
    let byteEnd = -1;
    const { content, changed } = read(file);
    if (changed) {
      // Autosave-guarded to the -1 sentinel, already logged once per file.
    } else if (content === undefined) {
      this.log?.(`[oracle] parse skipped byte offsets: unreadable ${file}`);
    } else {
      byteStart = byteOffset(content, s.line + 1, s.character + 1);
      byteEnd = byteOffset(content, e.line + 1, e.character + 1);
      if (byteStart === -1 || byteEnd === -1) {
        this.log?.(`[oracle] parse skipped byte offsets: range past EOF in ${file}`);
      }
    }

    return {
      fileName: file,
      byteStart,
      byteEnd,
      lineStart: s.line + 1,
      lineEnd: e.line + 1,
      columnStart: s.character + 1,
      columnEnd: e.character + 1,
      isPrimary: true,
    };
  }

  // A 0-based LSP {line, character}, or undefined when either field is not a
  // finite number (a shape that would become a NaN range downstream).
  private lspPos(pos: unknown): { line: number; character: number } | undefined {
    if (typeof pos !== "object" || pos === null) {
      return undefined;
    }
    const p = pos as Record<string, unknown>;
    if (typeof p.line !== "number" || typeof p.character !== "number") {
      return undefined;
    }
    if (!Number.isFinite(p.line) || !Number.isFinite(p.character)) {
      return undefined;
    }
    return { line: p.line, character: p.character };
  }

  checkSuccess(stdout: string, _exitCode: number): boolean {
    // The --outputjson summary is authoritative, NOT the exit code (pyright
    // exits non-zero on errors, but the summary is the verdict of record).
    // success = errorCount 0 AND filesAnalyzed > 0: filesAnalyzed 0 with 0
    // errors is the unearned green (an excluded/unreadable file) — fail CLOSED.
    // Warnings leave success true. Garbage summary -> no earned green (false).
    let doc: unknown;
    try {
      doc = JSON.parse(stdout);
    } catch {
      return false;
    }
    const summary = (doc as { summary?: unknown } | null)?.summary;
    if (typeof summary !== "object" || summary === null) {
      return false;
    }
    const sm = summary as Record<string, unknown>;
    const errorCount = sm.errorCount;
    const filesAnalyzed = sm.filesAnalyzed;
    if (typeof errorCount !== "number" || typeof filesAnalyzed !== "number") {
      return false;
    }
    return errorCount === 0 && filesAnalyzed > 0;
  }

  resolveDiagnosticPath(_crateRoot: string, fileName: string): string {
    // pyright reports absolute paths in its JSON, so no crateRoot anchoring —
    // that was a rustc relative-path behavior.
    return fileName;
  }

  isAssertionShaped(diagnostic: Diagnostic): boolean {
    // Kind tag only. pyright emits compile-style diagnostics, never runtime
    // assertion text, so no text family exists: a pyright message that happens
    // to read like a rustc assertion stays eligible for repair. Runtime
    // assertion text belongs to a future pytest rung, not this oracle.
    return diagnostic.kind === "assertion-failure";
  }

  /** The missing-imports storm classifier over parsed diagnostics. A repo whose
   *  interpreter/venv resolves no third-party packages darkens ALL import
   *  surface, so reportMissingImports dominates — that is an ENVIRONMENT
   *  problem, never the generation hallucinating. The threshold: reportMissing-
   *  Imports is a STRICT MAJORITY of the error-level diagnostics AND there are
   *  at least two of them. A lone unresolved import stays a normal diagnostic
   *  (it is as likely a single uninstalled dep or a typo as a broken env); two-
   *  or-more dominating is the environment collapsing. Pure and testable; the
   *  gesture layer (src/vscode/fnGen.ts) consumes it to mark the Python gesture
   *  inapplicable.
   *
   *  CONTRACT: the sole legal input is a check of the untouched PRE-generation
   *  BASELINE. On post-generation output the same two-reportMissingImports stream
   *  can be a real hallucination (the model invented two module names), and
   *  gating THAT as environment-broken would excuse it — the exact confidently-
   *  wrong the golden rule forbids. Consumers MUST call this only on the baseline
   *  check; the BaselineCheck newtype below is the enforcement. */
  isMissingImportsStorm(diagnostics: Diagnostic[]): boolean {
    const errorCodes = diagnostics.filter((d) => d.level === "error").map((d) => d.code);
    return isStormCodes(errorCodes);
  }

  /** The one-line environment reason for the explicit-gesture surface when a
   *  check's stdout is a missing-imports storm: name the interpreter/venv, never
   *  a generation error. undefined when the stdout is not a storm (or is
   *  unparseable) — nothing to explain on the environment channel.
   *
   *  Same baseline-only CONTRACT as isMissingImportsStorm: legal ONLY on a check
   *  of the untouched pre-generation baseline. Called on post-generation output it
   *  would name the environment for what may be a genuine two-import hallucination. */
  describeEnvironment(stdout: string): string | undefined {
    let doc: unknown;
    try {
      doc = JSON.parse(stdout);
    } catch {
      return undefined;
    }
    const generalDiagnostics = (doc as { generalDiagnostics?: unknown } | null)?.generalDiagnostics;
    if (!Array.isArray(generalDiagnostics)) {
      return undefined;
    }
    const errorCodes = generalDiagnostics
      .filter((d) => (d as { severity?: unknown } | null)?.severity === "error")
      .map((d) => (d as { rule?: unknown }).rule)
      .filter((r): r is string => typeof r === "string");
    if (!isStormCodes(errorCodes)) {
      return undefined;
    }
    const missing = errorCodes.filter((c) => c === "reportMissingImports").length;
    return stormEnvironmentReason(missing);
  }

  /** The one-line reason detectCrateRoot resolved undefined, for the explicit-
   *  gesture surface. undefined when a root actually resolves. */
  describeMissingRoot(filePath: string): string | undefined {
    if (this.detectCrateRoot(filePath) !== undefined) {
      return undefined;
    }
    return `no Python project marker (${ROOT_MARKERS.join(", ")}) and no workspace folder places ${filePath}`;
  }

  /** The evidence line for the explicit-gesture surface: the check ran and
   *  crashed (spawn rejection, or a non-zero exit with zero parseable
   *  diagnostics). Carries the same first-stderr-line evidence as the channel's
   *  failed-with-no-diagnostics line. */
  describeCheckFailure(exitCode: number, evidence?: string): string {
    if (exitCode < 0) {
      return `pyright could not be spawned${evidence ? `: ${evidence}` : ""}`;
    }
    return `pyright crashed (exit ${exitCode})${evidence ? `: ${evidence}` : ""}`;
  }

  /** The installed-distributions catalog for steering an unresolved-import
   *  hallucination to a real package (the `cargo metadata` / `dotnet list
   *  package` analog). Reads the resolved venv's site-packages OFFLINE, no
   *  spawn. Two signals: the top-level importable names (the
   *  package directories and single-module `*.py` files) and the distribution
   *  names from `*.dist-info` / `*.egg-info` (version stripped). Deduped by the
   *  PEP 503 normalized key so a distribution and its top-level collapse, and
   *  the IMPORTABLE form wins when both exist — the catalog steers `import`
   *  statements, and `import typing_extensions` is what code writes, never the
   *  `typing-extensions` PyPI name. A distribution with no same-named top-level
   *  rides on its distribution name as the fallback hint. Sorted, unique. []
   *  when no venv resolves beside the root or its site-packages is unreadable.
   *  Consumed by the repair layer (src/vscode/oracleSurface.ts), unioned with
   *  PY_STDLIB_MODULES as the rung-2 module universe. */
  catalog(crateRoot: string): string[] {
    const sitePackages = this.resolveSitePackages(crateRoot);
    if (sitePackages === undefined) {
      return [];
    }
    // normalized key -> { name, isImport }. First writer wins, EXCEPT an
    // importable name displaces a distribution-only name under the same key.
    const chosen = new Map<string, { name: string; isImport: boolean }>();
    const consider = (name: string, isImport: boolean) => {
      const key = name.toLowerCase().replace(/[._-]+/g, "-");
      const existing = chosen.get(key);
      if (existing === undefined || (isImport && !existing.isImport)) {
        chosen.set(key, { name, isImport });
      }
    };
    for (const entry of this.readDir(sitePackages)) {
      if (entry.startsWith("_") || entry.startsWith(".")) {
        continue; // __pycache__, _distutils_hack, dotfiles: never importable steering
      }
      const distMatch = /^(.+?)-[0-9].*\.(dist-info|egg-info)$/.exec(entry);
      if (distMatch) {
        consider(distMatch[1], false); // the distribution name (a fallback hint)
        continue;
      }
      if (entry.endsWith(".dist-info") || entry.endsWith(".egg-info")) {
        continue; // a metadata dir we could not version-strip: not a package name
      }
      if (entry.endsWith(".py")) {
        consider(entry.slice(0, -3), true); // a single-module distribution (e.g. six.py)
        continue;
      }
      if (entry.includes(".")) {
        continue; // pth/txt/cfg and any other dotted non-package file
      }
      consider(entry, true); // a top-level package directory: an import name
    }
    return [...chosen.values()].map((v) => v.name).sort();
  }

  // The venv's site-packages beside the crate root. POSIX venvs put it at
  // `<venv>/lib/python*/site-packages`; Windows at `<venv>/Lib/site-packages`.
  // undefined when no venv dir or no site-packages resolves.
  private resolveSitePackages(crateRoot: string): string | undefined {
    for (const venv of [".venv", "venv"]) {
      const venvDir = path.join(crateRoot, venv);
      const windows = path.join(venvDir, "Lib", "site-packages");
      if (this.fileExists(windows)) {
        return windows;
      }
      const lib = path.join(venvDir, "lib");
      for (const sub of this.readDir(lib)) {
        if (sub.startsWith("python")) {
          const posix = path.join(lib, sub, "site-packages");
          if (this.fileExists(posix)) {
            return posix;
          }
        }
      }
    }
    return undefined;
  }
}

// The storm test over error-level diagnostic codes: reportMissingImports is a
// strict majority AND there are at least two of them. See isMissingImportsStorm.
function isStormCodes(errorCodes: (string | undefined)[]): boolean {
  const total = errorCodes.length;
  const missing = errorCodes.filter((c) => c === "reportMissingImports").length;
  return missing >= 2 && missing * 2 > total;
}

// ===========================================================================
// The storm classifier's BASELINE-ONLY enforcement. The
// danger is exact — a generation that emits TWO hallucinated imports produces
// missing=2/total=2, which isStormCodes reads as environment-broken and would
// EXCUSE the hallucination as "select an interpreter." So the storm classifier
// must be consumable ONLY on an untouched PRE-generation baseline, never on a
// post-accept OracleCheckResult. The enforcement is a typed newtype the type
// system demands and only the pre-generation mint can produce.
// ===========================================================================

/** A branded pre-generation baseline check. The ONLY mint is `baselineCheck`,
 *  which the pre-generation applicability gate calls on the untouched buffer's
 *  check BEFORE any generation ran. The storm classifiers below demand this type,
 *  so a post-accept `OracleCheckResult` cannot be passed at the type level. The
 *  brand is a RUNTIME field (not a compile-time-only phantom), so a caller passing
 *  a raw result is refused at runtime too. */
export interface BaselineCheck {
  readonly __baseline: true;
  readonly result: OracleCheckResult;
}

/** Mint a BaselineCheck from a PRE-generation check. Callers MUST only pass a
 *  check of the untouched pre-generation baseline (the fn-gen applicability gate);
 *  the type system forbids passing a post-accept result to the classifiers, and
 *  this mint is the sole producer. */
export function baselineCheck(result: OracleCheckResult): BaselineCheck {
  return { __baseline: true, result };
}

/** The missing-imports storm classifier, BASELINE-ONLY. A repo whose
 *  interpreter/venv resolves no third-party packages darkens ALL import surface,
 *  so reportMissingImports dominates — an ENVIRONMENT problem, never the
 *  generation hallucinating. Consumes a `BaselineCheck` so a post-accept
 *  OracleCheckResult (where two missing imports may be a real hallucination)
 *  cannot reach it. A raw un-branded object is refused at runtime (false), so a
 *  2-import hallucination can never be excused as a broken env. */
export function isMissingImportsStorm(baseline: BaselineCheck): boolean {
  if (baseline?.__baseline !== true || !Array.isArray(baseline.result?.diagnostics)) {
    return false; // not a minted pre-generation baseline: never a storm
  }
  const errorCodes = baseline.result.diagnostics.filter((d) => d.level === "error").map((d) => d.code);
  return isStormCodes(errorCodes);
}

/** The one-line environment reason for a baseline storm: name the interpreter/
 *  venv, never a generation error. undefined when the baseline is not a storm (or
 *  is not a minted BaselineCheck). BASELINE-ONLY, same contract as
 *  isMissingImportsStorm. */
export function describeEnvironment(baseline: BaselineCheck): string | undefined {
  if (!isMissingImportsStorm(baseline)) {
    return undefined;
  }
  const missing = baseline.result.diagnostics.filter(
    (d) => d.level === "error" && d.code === "reportMissingImports",
  ).length;
  return stormEnvironmentReason(missing);
}

// The shared reason text for a missing-imports storm, used by both the module
// baseline-only classifier and the PyOracle.describeEnvironment stdout method.
function stormEnvironmentReason(missing: number): string {
  return (
    `${missing} imports could not be resolved (a reportMissingImports storm): ` +
    `the Python interpreter resolves none of this project's third-party packages — ` +
    `select an interpreter or create a .venv beside the project root, then re-check`
  );
}

// UTF-8 byte offset of a 1-based (line, col) into content, where col counts
// UTF-16 code units (the LSP unit pyright reports, +1'd to 1-based). Slice the
// UTF-16 prefix, then encode to bytes — the same rule vscode's byteScope uses,
// so the two sides cannot disagree. -1 when the line runs past EOF (a position
// that can never test inside a repair scope: refuse, the safe direction).
function byteOffset(content: string, line: number, col: number): number {
  let lineStart = 0;
  for (let l = 1; l < line; l++) {
    const next = content.indexOf("\n", lineStart);
    if (next === -1) {
      return -1;
    }
    lineStart = next + 1;
  }
  // A column past this line's end must refuse too, the symmetric twin of the
  // line-past-EOF guard: on the autosave race (disk shorter than what pyright
  // analyzed, and the same-ms mtime guard misses it) an out-of-range column
  // would otherwise slice into the NEXT line and hand out a confidently-wrong
  // offset. The line end is the newline (or EOF); a col landing AT it is a
  // valid range end, so only a col strictly past it is refused.
  const nl = content.indexOf("\n", lineStart);
  const lineEnd = nl === -1 ? content.length : nl;
  const target = lineStart + col - 1;
  if (target > lineEnd) {
    return -1;
  }
  return Buffer.byteLength(content.slice(0, target), "utf8");
}
