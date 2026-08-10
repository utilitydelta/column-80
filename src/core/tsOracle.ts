/**
 * The TypeScript compiler-oracle strategy. Checks with the PROJECT'S OWN
 * typescript, never a bundled or global one: the wild carries real version
 * spread (5.x and 6.x observed on this box) and a foreign tsc would skew
 * diagnostics and module resolution by version. No npx, ever — it can reach
 * the network, and the offline invariant forbids that.
 *
 * Contract: docs/architecture/compiler-oracle.md.
 */

import * as fs from "fs";
import * as path from "path";
import type { CheckCommand, CompilerOracle, Diagnostic, DiagnosticSpan } from "./compilerOracle";
import { LogFn } from "./completionService";

/** Injection seams so detection tests need no real projects on disk and
 *  parser byte-offset tests need no real files. readFile feeds the
 *  line/col-to-byte conversion; undefined means the file was unreadable. */
export interface TsOracleDeps {
  fileExists?: (p: string) => boolean;
  readFile?: (p: string) => string | undefined;
  /** Directory listing for the sibling-tsconfig coverage fallback; undefined
   *  entries impossible, an unlistable dir yields []. */
  readDir?: (dir: string) => string[];
  /** mtime (ms) for the autosave guard; undefined when the file cannot be
   *  statted (the guard then stays quiet - offsets already degrade on read). */
  statMtimeMs?: (p: string) => number | undefined;
  log?: LogFn;
}

// One located diagnostic header: `src/app.ts(12,5): error TS2322: message`.
// tsc --pretty false is line-oriented and stable; --pretty output (colors,
// codeframes) is never parsed.
const HEADER = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;
// A config/global diagnostic carries no file prefix: `error TS18003: ...`.
const GLOBAL = /^(error|warning) (TS\d+): (.*)$/;

export class TsOracle implements CompilerOracle {
  readonly language = "typescript";
  readonly checkLabel = "tsc check";

  private readonly fileExists: (p: string) => boolean;
  private readonly readFile: (p: string) => string | undefined;
  private readonly readDir: (dir: string) => string[];
  private readonly statMtimeMs: (p: string) => number | undefined;
  private readonly log?: LogFn;

  constructor(deps?: TsOracleDeps) {
    this.fileExists = deps?.fileExists ?? ((p) => fs.existsSync(p));
    // The disk reader decodes by BOM: tsc reads UTF-16 sources happily, and
    // decoding one as UTF-8 here would produce confidently WRONG byte
    // offsets (worse than none). UTF-16BE has no native decode — undefined
    // pins the span to the -1 sentinel, the safe direction.
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
    this.log = deps?.log;
  }

  appliesTo(languageId: string): boolean {
    return (
      languageId === "typescript" ||
      languageId === "typescriptreact" ||
      languageId === "javascript" ||
      languageId === "javascriptreact"
    );
  }

  detectCrateRoot(filePath: string): string | undefined {
    // Nearest tsconfig wins: in a monorepo that scopes the check to the
    // touched package, the Cargo.toml discipline. An extends-only shell
    // still marks the root; resolving the chain is tsc's job at check time.
    let dir = path.dirname(filePath);
    for (;;) {
      if (this.fileExists(path.join(dir, "tsconfig.json"))) {
        // Version honesty: without the project's own typescript the oracle
        // cannot check honestly, so it does not understand the project.
        if (this.resolveTscPath(dir) === undefined) {
          this.log?.(`[oracle] ts skipped: tsconfig without a project typescript at ${dir}`);
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

  // The project's own tsc entry script, walking up from the project root so
  // hoisted monorepo installs (node_modules at the repo root) resolve.
  private resolveTscPath(fromDir: string): string | undefined {
    let dir = fromDir;
    for (;;) {
      const candidate = path.join(dir, "node_modules", "typescript", "bin", "tsc");
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

  // `project` is the coverage fallback's winner (a tsconfig path); absent
  // means the nearest project itself. cwd stays crateRoot either way, so tsc
  // reports paths relative to crateRoot and resolveDiagnosticPath + the parse
  // byte conversion stay consistent with whatever -p actually ran (offsets
  // must land).
  buildCheckCommand(crateRoot: string, project?: string): CheckCommand {
    return this.tscCommand(crateRoot, ["--noEmit", "--pretty", "false", "-p", project ?? crateRoot]);
  }

  // Spawned through the HOST'S OWN node (process.execPath as node via
  // ELECTRON_RUN_AS_NODE, inert under plain node), never "node" from PATH:
  // nvm/fnm users and GUI-launched editors have no node on the extension
  // host's PATH, and the shell shim (.cmd on Windows) cannot be spawned
  // plainly. detectCrateRoot guaranteed the tsc resolution; the join
  // fallback only exists so a direct caller gets a failing spawn instead
  // of a throw.
  private tscCommand(crateRoot: string, args: string[]): CheckCommand {
    const tsc =
      this.resolveTscPath(crateRoot) ?? path.join(crateRoot, "node_modules", "typescript", "bin", "tsc");
    return {
      command: process.execPath,
      args: [tsc, ...args],
      cwd: crateRoot,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }

  buildCoverageCommand(crateRoot: string, project?: string): CheckCommand {
    return this.tscCommand(crateRoot, ["--listFilesOnly", "-p", project ?? crateRoot]);
  }

  /** The coverage-fallback candidates, probed IN ORDER when the nearest
   *  tsconfig's probe answered not-covered: (a) projects in its `references`
   *  (the vite solution-shell shape), then (b) sibling tsconfig.*.json files
   *  in the same directory (the tsconfig.server.json shape). Deduped, existing
   *  files only; each entry is a tsconfig path `-p` understands. */
  coverageFallbackProjects(crateRoot: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([path.resolve(crateRoot, "tsconfig.json")]);
    const add = (candidate: string) => {
      const resolved = path.resolve(candidate);
      if (!seen.has(resolved) && this.fileExists(resolved)) {
        seen.add(resolved);
        out.push(resolved);
      }
    };
    for (const ref of this.referencedProjects(crateRoot)) {
      const abs = path.resolve(crateRoot, ref);
      // A reference names a tsconfig file or a directory holding one.
      if (abs.endsWith(".json")) {
        add(abs);
      } else {
        add(path.join(abs, "tsconfig.json"));
      }
    }
    for (const entry of this.readDir(crateRoot)) {
      if (/^tsconfig\..+\.json$/.test(entry)) {
        add(path.join(crateRoot, entry));
      }
    }
    return out;
  }

  // The `references` paths of the nearest tsconfig. tsconfig.json is JSONC in
  // the wild, so comments and trailing commas are stripped before the parse;
  // an unparseable config yields no references, never a thrown fallback.
  private referencedProjects(crateRoot: string): string[] {
    const raw = this.readFile(path.join(crateRoot, "tsconfig.json"));
    if (raw === undefined) {
      return [];
    }
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1");
    try {
      const parsed = JSON.parse(stripped) as { references?: Array<{ path?: unknown }> };
      if (!Array.isArray(parsed.references)) {
        return [];
      }
      return parsed.references
        .map((r) => (typeof r?.path === "string" ? r.path : undefined))
        .filter((p): p is string => p !== undefined);
    } catch {
      return [];
    }
  }

  describeNotCovered(crateRoot: string, filePath: string, probedFallbacks: string[]): string {
    const probed = [path.join(crateRoot, "tsconfig.json"), ...probedFallbacks];
    return `${filePath} is not an input of any probed project (${probed.join(", ")})`;
  }

  /** The one-line env reason detectCrateRoot resolved undefined, for the
   *  explicit-gesture verdict surface. undefined when the
   *  root actually resolves (nothing to explain). */
  describeMissingRoot(filePath: string): string | undefined {
    let dir = path.dirname(filePath);
    for (;;) {
      if (this.fileExists(path.join(dir, "tsconfig.json"))) {
        if (this.resolveTscPath(dir) === undefined) {
          return `no typescript resolvable for the project at ${dir} (walked ${dir} and its ancestors for node_modules/typescript)`;
        }
        return undefined;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return `no tsconfig.json above ${filePath}`;
      }
      dir = parent;
    }
  }

  /** The evidence line for the explicit-gesture surface: the check ran
   *  and crashed (spawn rejection, or a non-zero exit with zero parseable
   *  diagnostics). Carries the same first-stderr-line evidence as the
   *  channel's failed-with-no-diagnostics line. */
  describeCheckFailure(exitCode: number, evidence?: string): string {
    // A negative code is the orchestrator's spawn-rejection sentinel: no
    // process ever exited, so there is no exit code to report - rendering
    // one ("exit -1") would be invented evidence.
    if (exitCode < 0) {
      return `project tsc could not be spawned${evidence ? `: ${evidence}` : ""}`;
    }
    return `project tsc crashed (exit ${exitCode})${evidence ? `: ${evidence}` : ""}`;
  }

  fileCovered(stdout: string, crateRoot: string, filePath: string): boolean {
    // A probe that answered with a diagnostic instead of a file list (an
    // old tsc without --listFilesOnly) fails OPEN: never worse than
    // trusting the check alone.
    if (/(^|\s)error TS\d+:/m.test(stdout)) {
      return true;
    }
    const target = path.resolve(filePath);
    return stdout
      .split(/\r?\n/)
      .some((line) => line.trim().length > 0 && path.resolve(crateRoot, line.trim()) === target);
  }

  parseCheckOutput(stdout: string, crateRoot?: string, checkStartMs?: number): Diagnostic[] {
    const out: Diagnostic[] = [];
    // One read per distinct file per parse: several diagnostics in one file
    // convert against the same content. tsc prints paths relative to the
    // check's cwd (the project root), so the crateRoot join is the meaning
    // of the path and reads FIRST — the process cwd could coincidentally
    // hold a same-named file, and converting against that one would produce
    // wrong-file offsets silently (the unsafe direction). As-printed is the
    // fallback for absolute paths and rootless direct calls.
    const cache = new Map<string, { content?: string; changed: boolean }>();
    const read = (p: string): { content?: string; changed: boolean } => {
      const cached = cache.get(p);
      if (cached !== undefined) {
        return cached;
      }
      let resolvedPath = p;
      let content: string | undefined;
      if (crateRoot !== undefined && !path.isAbsolute(p)) {
        resolvedPath = path.join(crateRoot, p);
        content = this.readFile(resolvedPath);
      }
      if (content === undefined) {
        resolvedPath = p;
        content = this.readFile(p);
      }
      // tsc strips a BOM before counting columns, and the editor buffer
      // the repair scope encodes against never carries one; dropping it
      // keeps all three in one coordinate system.
      if (content !== undefined && content.charCodeAt(0) === 0xfeff) {
        content = content.slice(1);
      }
      // Autosave guard: the check read disk as it stood at check start; a
      // file saved SINCE then makes the line/col-to-byte conversion lie
      // (offsets into content tsc never saw). Bytes go to the -1 sentinel
      // (never inside any repair scope - the safe direction); line/col stay.
      let changed = false;
      if (content !== undefined && checkStartMs !== undefined) {
        const mtime = this.statMtimeMs(resolvedPath);
        // Floored: mtimeMs carries sub-ms precision while the check-start
        // clock is integer ms, so a file written in the same millisecond the
        // check started must not read as "newer" (the false-fire direction).
        // Two saves stay UNDETECTED by design: one landing in that same
        // integer millisecond after the check started, and a backdated /
        // mtime-preserving write (older mtime, different content). Content
        // hashing would catch both and is refused as out of scope; both are
        // bounded by the presenter's document-version guards downstream.
        if (mtime !== undefined && Math.floor(mtime) > checkStartMs) {
          changed = true;
          this.log?.(`[oracle] ${p}: content changed since check; offsets skipped`);
        }
      }
      const entry = { content, changed };
      cache.set(p, entry);
      return entry;
    };

    let current: Diagnostic | undefined;
    for (const line of (stdout ?? "").split(/\r?\n/)) {
      const header = HEADER.exec(line);
      if (header) {
        current = {
          kind: header[4] === "error" ? "compile-error" : "compile-warning",
          level: header[4] as "error" | "warning",
          code: header[5],
          message: header[6],
          spans: [this.makeSpan(header[1], Number(header[2]), Number(header[3]), read)],
          suggestions: [],
          rendered: line,
        };
        out.push(current);
        continue;
      }
      const global = GLOBAL.exec(line);
      if (global) {
        current = {
          kind: global[1] === "error" ? "compile-error" : "compile-warning",
          level: global[1] as "error" | "warning",
          code: global[2],
          message: global[3],
          spans: [],
          suggestions: [],
          rendered: line,
        };
        out.push(current);
        continue;
      }
      // A continuation line (nested elaboration) is indented under an open
      // diagnostic. Anything else — garbage, blank — closes the current one,
      // so a stray indented line after garbage cannot append to the wrong
      // diagnostic.
      if (current !== undefined && /^\s+\S/.test(line)) {
        current.message += "\n" + line;
        current.rendered += "\n" + line;
        continue;
      }
      current = undefined;
    }
    return out;
  }

  // tsc text carries line/col only, but repair's scope intersection speaks
  // UTF-8 bytes. Convert with the same prefix-slice-then-encode rule the
  // vscode byteScope uses (col counts UTF-16 code units, verified against
  // tsc 5.9 on multibyte source), so the two sides cannot disagree.
  // Unreadable file: keep line/col, set bytes to -1 — a position that can
  // never test inside a scope, so repair refuses (the safe direction).
  private makeSpan(
    fileName: string,
    line: number,
    col: number,
    read: (p: string) => { content?: string; changed: boolean },
  ): DiagnosticSpan {
    let byteOffset = -1;
    const { content, changed } = read(fileName);
    if (changed) {
      // Guarded by the autosave mtime check: the -1 sentinel, already logged
      // once per file by the read path.
    } else if (content === undefined) {
      this.log?.(`[oracle] parse skipped byte offsets: unreadable ${fileName}`);
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
      // A column past this line's end refuses too, the symmetric twin of the
      // line-past-EOF guard: on the autosave race an out-of-range column would
      // otherwise slice into the next line. A col AT the line end (the newline)
      // is a valid range end; only a col strictly past it is refused.
      const nl = content.indexOf("\n", lineStart);
      const lineEnd = nl === -1 ? content.length : nl;
      const target = lineStart + col - 1;
      if (found && target > lineEnd) {
        found = false;
      }
      if (found) {
        byteOffset = Buffer.byteLength(content.slice(0, target), "utf8");
      } else {
        this.log?.(`[oracle] parse skipped byte offsets: line ${line} past EOF in ${fileName}`);
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

  checkSuccess(_stdout: string, exitCode: number): boolean {
    // tsc's exit code is its whole verdict (0 clean, 1 diagnostics, 2 config
    // failure); there is no build-finished line to prefer.
    return exitCode === 0;
  }

  resolveDiagnosticPath(crateRoot: string, fileName: string): string {
    // tsc reports paths relative to the cwd it ran in, which
    // buildCheckCommand pins to the project root. No workspace anchor walk —
    // that is a cargo behavior.
    return path.isAbsolute(fileName) ? fileName : path.join(crateRoot, fileName);
  }

  isAssertionShaped(diagnostic: Diagnostic): boolean {
    // Kind tag only. tsc emits compile diagnostics, never runtime assertion
    // text, so no text family exists: a TS message that happens to look like
    // a rustc assertion stays eligible for repair.
    return diagnostic.kind === "assertion-failure";
  }
}
