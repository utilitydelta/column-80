/**
 * Go compiler-oracle strategy (v23). Checker is `go build -o /dev/null ./...`
 * at the nearest go.mod: bare `go build ./...` drops a binary into the tree
 * when the pattern resolves to one main package, and `-o <dir>` silently
 * skips every non-main package (golang/go#37378) — an unearned green across
 * all library code. `-o /dev/null` compiles both, writes nothing.
 *
 * Verdict is the exit code; diagnostics are parsed from output LINES, never
 * from gopls (`gopls check` exits 0 with errors present) and never from
 * `go vet` (halts at the first failing package, and its analyzer findings
 * share the `path:line:col:` shape a line parser would misread).
 *
 * Restore-first honesty: the cold-state messages (`no required module
 * provides`, `missing go.sum entry`, `inconsistent vendoring`) surface with
 * their remediation verbatim; the oracle never fetches. The spawn env pins
 * every knob the offline invariant relies on, because `go env -w` user
 * config leaks into every spawned go command.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  CheckCommand,
  CompilerOracle,
  Diagnostic,
  DiagnosticSpan,
  OracleDeps,
} from "./compilerOracle";
import { LogFn } from "./completionService";

export interface GoOracleDeps extends OracleDeps {
  /** Source reader for the line/col-to-byte conversion; undefined means an
   *  unreadable file and the -1 sentinel (never in-scope, the safe
   *  direction). */
  readFile?: (p: string) => string | undefined;
  /** mtime for the autosave guard: a file changed since the check spawned
   *  gets sentinel offsets, never a stale-content conversion. */
  statMtimeMs?: (p: string) => number | undefined;
  /** Physical-path canonicalizer for the coverage probe: node spawns with a
   *  LOGICAL cwd but `go list` prints PHYSICAL Dir, so a symlinked module
   *  root would otherwise never match and the module would darken —
   *  permanently, because the dark verdict is cached (P1 review F5). */
  realpath?: (p: string) => string;
}

/** The offline pins for every go spawn (check and coverage probe alike).
 *  GOPROXY=off: no network, ever — a go.sum-present cold cache refuses
 *  instead of silently fetching. GOWORK=off: detectCrateRoot already refused
 *  workspace mode; the pin keeps a go.work that lands mid-session from
 *  silently re-scoping resolution under a check already in flight.
 *  GOENV=off: `go env -w` writes a user config file that leaks into every
 *  spawned go command (GOFLAGS, GOPRIVATE, GONOPROXY, GOTOOLCHAIN — the
 *  last two can reopen the network or swap the toolchain under the check);
 *  disabling the file is the one documented switch that closes the whole
 *  channel (P1 review F2). A shell-exported env var still wins over the
 *  file for the user knowingly running one — the goal's offline promise
 *  covers what the spawn pins.
 *
 *  Exported so the TDD test rung (src/core/tddGo.ts) spawns `go test` with the
 *  SAME pins as the check. A rung that disagreed with the check about GOFLAGS
 *  or about network reach would report a red the check cannot reproduce. */
export const GO_SPAWN_ENV: Record<string, string> = {
  GOPROXY: "off",
  GOWORK: "off",
  GOENV: "off",
};

/** `path.go:line:col: message` (column optional: some module-level errors
 *  print `path.go:line: message`). Path must end .go so `# pkg` headers and
 *  prose never half-match. */
const DIAG_LINE = /^(.+\.go):(\d+)(?::(\d+))?: (.+)$/;

/** Module-level lines the go command prints while (not) working. These are
 *  progress, not failures; everything else `go: `-prefixed is a verdict —
 *  including `go: updates to go.mod needed` (exit 1, remediation `go mod
 *  tidy`), which an earlier draft wrongly filtered as progress (P1 review
 *  F4). */
const GO_INFO_LINE = /^go: (downloading|finding|extracting)/;

export class GoOracle implements CompilerOracle {
  readonly language = "go";
  readonly checkLabel = "go build";

  private readonly fileExists: (p: string) => boolean;
  private readonly readFile: (p: string) => string | undefined;
  private readonly statMtimeMs: (p: string) => number | undefined;
  private readonly realpath: (p: string) => string;
  private readonly log?: LogFn;
  private envDivergenceLogged = false;

  constructor(deps?: GoOracleDeps) {
    this.fileExists = deps?.fileExists ?? ((p) => fs.existsSync(p));
    this.readFile =
      deps?.readFile ??
      ((p) => {
        try {
          return fs.readFileSync(p, "utf8");
        } catch {
          return undefined;
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
    this.realpath =
      deps?.realpath ??
      ((p) => {
        try {
          return fs.realpathSync(p);
        } catch {
          return p;
        }
      });
    this.log = deps?.log;
  }

  appliesTo(languageId: string): boolean {
    return languageId === "go";
  }

  detectCrateRoot(filePath: string): string | undefined {
    const moduleRoot = this.nearestGoMod(filePath);
    if (moduleRoot === undefined) {
      return undefined;
    }
    // Workspace refusal: go.work auto-applies and silently changes module
    // resolution under the oracle, so doing nothing is not honest-dark; and
    // checking WITH GOWORK=off pinned would fail a workspace user's sibling
    // modules with a `go get` remediation that is wrong (the fix is the
    // workspace, not a fetch). Refuse plainly; describeMissingRoot carries
    // the reason. The surface path is unaffected — gopls honors workspaces.
    if (this.workspaceSource(moduleRoot) !== undefined) {
      return undefined;
    }
    return moduleRoot;
  }

  buildCheckCommand(crateRoot: string): CheckCommand {
    this.logEnvDivergenceOnce();
    return {
      command: "go",
      // os.devNull IS "/dev/null" here (the measured spelling); it keeps the
      // no-binary-dropped property on the one platform where the literal
      // would instead create a file named "/dev/null" (P1 review F10).
      args: ["build", "-o", os.devNull, "./..."],
      cwd: crateRoot,
      env: { ...GO_SPAWN_ENV },
      diagnosticsOnStderr: true,
    };
  }

  /** GOENV=off makes the check ignore the user's `go env -w` file, so a user
   *  who set GOFLAGS/-tags there can see this oracle green where their own
   *  `go build` is red — and gopls (which reads the file) serving members
   *  the check rejects. The full re-pin is a delegated design call (triage
   *  F14); until then the divergence is at least SAID, once per session,
   *  never silent. */
  private logEnvDivergenceOnce(): void {
    if (this.envDivergenceLogged) {
      return;
    }
    this.envDivergenceLogged = true;
    const goenv = process.env.GOENV;
    if (goenv === "off") {
      return;
    }
    const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
    const file = goenv !== undefined && goenv !== "" ? goenv : path.join(configHome, "go", "env");
    const content = this.readFile(file);
    if (content === undefined) {
      return;
    }
    const divergent = ["GOFLAGS", "GOTOOLCHAIN", "GOOS", "GOARCH"].filter((k) =>
      new RegExp(`^${k}=.+`, "m").test(content),
    );
    if (divergent.length > 0) {
      this.log?.(
        `[oracle] user go env file sets ${divergent.join(", ")}; the check pins GOENV=off and can disagree with your own go build (and with gopls)`,
      );
    }
  }

  parseCheckOutput(stdout: string, crateRoot?: string, checkStartMs?: number): Diagnostic[] {
    const out: Diagnostic[] = [];
    for (const line of stdout.split("\n")) {
      if (line.length === 0 || line.startsWith("# ")) {
        continue;
      }
      // A continuation line (go indents remediation under its verdict, e.g.
      // `\tgo get example.com/x`) folds into the diagnostic it explains, so
      // the surfaced message carries the remediation verbatim.
      if ((line.startsWith("\t") || line.startsWith("    ")) && out.length > 0) {
        const prev = out[out.length - 1];
        prev.message = `${prev.message} ${line.trim()}`;
        prev.rendered = `${prev.rendered}\n${line}`;
        continue;
      }
      const m = DIAG_LINE.exec(line);
      if (m) {
        out.push({
          kind: "compile-error",
          level: "error",
          message: m[4],
          spans: [
            this.makeSpan(m[1], Number(m[2]), m[3] !== undefined ? Number(m[3]) : 1, crateRoot, checkStartMs),
          ],
          suggestions: [],
          rendered: line,
        });
        continue;
      }
      // Module-level verdicts (`go: inconsistent vendoring ...`) carry no
      // file position but ARE the failure; a span-less diagnostic keeps them
      // on the record instead of buried in a crash line.
      if (line.startsWith("go: ") && !GO_INFO_LINE.test(line)) {
        out.push({
          kind: "compile-error",
          level: "error",
          message: line.slice("go: ".length),
          spans: [],
          suggestions: [],
          rendered: line,
        });
      }
      // Anything else is noise; fewer diagnostics, never a crashed oracle.
    }
    return out;
  }

  checkSuccess(_stdout: string, exitCode: number): boolean {
    return exitCode === 0;
  }

  /** go reports line/col only, but repair's scope intersection speaks UTF-8
   *  bytes — a -1 sentinel on every span would refuse every repair (P1
   *  review F1, the goal-breaker). Convert by reading the named file; go's
   *  column is a BYTE count into the line (go/token, verified on multibyte
   *  source this session: `é` line reports col 16 where the char col is
   *  15), so the offset is bytes-to-line-start + (col-1) — no UTF-16 step
   *  like tsc's. Unreadable file or a file changed since the check spawned
   *  (the autosave guard): keep line/col, bytes stay -1, never in-scope. */
  private makeSpan(
    fileName: string,
    line: number,
    col: number,
    crateRoot: string | undefined,
    checkStartMs: number | undefined,
  ): DiagnosticSpan {
    let byteOffset = -1;
    if (crateRoot !== undefined) {
      const resolved = this.resolveDiagnosticPath(crateRoot, fileName);
      const mtime = this.statMtimeMs(resolved);
      // Floored like tsOracle's guard: sub-ms filesystem timestamps would
      // false-fire against a whole-ms checkStartMs on the same tick.
      if (checkStartMs !== undefined && mtime !== undefined && Math.floor(mtime) > checkStartMs) {
        this.log?.(`[oracle] parse skipped byte offsets: ${fileName} changed since the check spawned`);
      } else {
        const content = this.readFile(resolved);
        if (content === undefined) {
          this.log?.(`[oracle] parse skipped byte offsets: unreadable ${resolved}`);
        } else {
          let lineStart = 0;
          let found = true;
          for (let l = 1; l < line; l++) {
            const next = content.indexOf("\n", lineStart);
            if (next === -1) {
              found = false;
              break;
            }
            lineStart = next + 1;
          }
          const nl = content.indexOf("\n", lineStart);
          const lineText = content.slice(lineStart, nl === -1 ? content.length : nl);
          // col-1 bytes into this line; a col past the line's byte length is
          // the autosave race's symmetric twin — refuse, never slice onward.
          if (found && col - 1 <= Buffer.byteLength(lineText, "utf8")) {
            byteOffset = Buffer.byteLength(content.slice(0, lineStart), "utf8") + (col - 1);
          } else {
            this.log?.(`[oracle] parse skipped byte offsets: ${fileName}:${line}:${col} past EOF`);
          }
        }
      }
    }
    return {
      fileName,
      byteStart: byteOffset,
      byteEnd: byteOffset,
      lineStart: line,
      lineEnd: line,
      columnStart: col,
      columnEnd: col,
      isPrimary: true,
    };
  }

  resolveDiagnosticPath(crateRoot: string, fileName: string, fileExists?: (p: string) => boolean): string {
    if (path.isAbsolute(fileName)) {
      return fileName;
    }
    // go build runs at the module root and prints ./-relative paths, so the
    // crateRoot join IS the path's meaning; the exists-check fallback covers
    // the odd toolchain line that names a file relative to somewhere else.
    const joined = path.resolve(crateRoot, fileName);
    const exists = fileExists ?? this.fileExists;
    if (!exists(joined)) {
      const asPrinted = path.resolve(fileName);
      if (exists(asPrinted)) {
        return asPrinted;
      }
    }
    return joined;
  }

  isAssertionShaped(diagnostic: Diagnostic): boolean {
    // go build emits compile errors only; the kind tag (a future test rung's
    // panic/assert) is the whole family, the tsOracle/csOracle shape.
    return diagnostic.kind === "assertion-failure";
  }

  /** The coverage probe. More load-bearing than C#'s: `go build` ignores
   *  build-tag-excluded files (`//go:build ignore`), `_`-prefixed files,
   *  wrong-GOOS suffixes, AND every `_test.go` — a broken test file builds
   *  green. `go list -json` names each package's loaded and ignored files. */
  buildCoverageCommand(crateRoot: string): CheckCommand {
    return {
      command: "go",
      args: ["list", "-json", "./..."],
      cwd: crateRoot,
      env: { ...GO_SPAWN_ENV },
    };
  }

  fileCovered(stdout: string, crateRoot: string, filePath: string): boolean {
    // Both sides canonicalized: go list prints PHYSICAL Dir while the
    // editor/crateRoot side can be a symlinked (logical) path, and a miss
    // here is cached as a permanent false dark (P1 review F5). DIRNAME only:
    // a symlinked .go FILE is listed by go under its own basename in the
    // physical Dir, so resolving the file's link would un-match it (F15).
    const resolvedTarget = path.resolve(crateRoot, filePath);
    const target = path.join(this.realpath(path.dirname(resolvedTarget)), path.basename(resolvedTarget));
    for (const pkg of concatenatedJsonObjects(stdout)) {
      const dir = typeof pkg.Dir === "string" ? pkg.Dir : undefined;
      if (dir === undefined) {
        continue;
      }
      const physicalDir = this.realpath(dir);
      const inList = (field: string): boolean => {
        const files = pkg[field];
        return Array.isArray(files) && files.some((f) => typeof f === "string" && path.resolve(physicalDir, f) === target);
      };
      if (inList("GoFiles")) {
        return true;
      }
      // Named but not built: build tags, `_` prefix, OS/arch suffix land in
      // IgnoredGoFiles; test files are never go build inputs at all.
      if (inList("IgnoredGoFiles") || inList("TestGoFiles") || inList("XTestGoFiles")) {
        return false;
      }
    }
    return false;
  }

  describeNotCovered(_crateRoot: string, filePath: string): string {
    return `go build does not load ${filePath} (build-tag excluded, \`_\`-prefixed, or a _test.go — go build ignores test files); the check cannot see it`;
  }

  describeMissingRoot(filePath: string): string | undefined {
    const moduleRoot = this.nearestGoMod(filePath);
    if (moduleRoot === undefined) {
      return `no go.mod above ${filePath}`;
    }
    const source = this.workspaceSource(moduleRoot);
    if (source !== undefined) {
      return `workspace mode, not supported yet (${source} governs this module's resolution)`;
    }
    return undefined;
  }

  describeCheckFailure(exitCode: number, evidence?: string): string {
    if (exitCode < 0) {
      return `go could not be spawned${evidence ? `: ${evidence}` : ""}`;
    }
    return `go build failed with nothing parseable (exit ${exitCode})${evidence ? `: ${evidence}` : ""}`;
  }

  private nearestGoMod(filePath: string): string | undefined {
    let dir = path.dirname(filePath);
    for (;;) {
      if (this.fileExists(path.join(dir, "go.mod"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return undefined;
      }
      dir = parent;
    }
  }

  /** The workspace that would govern this module, or undefined outside one.
   *  Mirrors the go command's own resolution: GOWORK env wins (`off`
   *  disables, a path selects), else the parent-ward go.work walk from the
   *  module root. Env is read at call time — the user can flip GOWORK
   *  between gestures and the verdict must follow. */
  private workspaceSource(moduleRoot: string): string | undefined {
    const gowork = process.env.GOWORK;
    if (gowork !== undefined && gowork !== "") {
      return gowork === "off" ? undefined : gowork;
    }
    let dir = moduleRoot;
    for (;;) {
      const candidate = path.join(dir, "go.work");
      if (this.fileExists(candidate)) {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return undefined;
      }
      dir = parent;
    }
  }
}

/** `go list -json ./...` streams one JSON object per package with no
 *  wrapper. Split on brace depth (string-aware) and parse each; a garbled
 *  object yields fewer packages, never a crashed probe. */
function concatenatedJsonObjects(text: string): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          objects.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // fewer packages, never a crash
        }
        start = -1;
      }
    }
  }
  return objects;
}
