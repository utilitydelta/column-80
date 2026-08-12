/**
 * The existence gate, tier 2: does this word name a type that EXISTS somewhere
 * in the workspace, and if it does, how would this file get at it.
 *
 * Tier 1 is `PrefillLang.typeReference` and is not rebuilt here: a code
 * occurrence in the span, an import line, a same-file definition. Tier 3 is the
 * strip. Tier 2 is the COMMON case for a dictated comment, not an edge - the
 * developer is about to write the function that uses the type, so the import is
 * not there yet, because the code is not written yet.
 *
 * TWO THINGS MAKE THIS MORE THAN A LOOKUP.
 *
 *  1. A WORKSPACE SYMBOL PROVIDER IS FUZZY. A query for `ClientSet` comes back
 *     with `ClientSetBuilder`, `ClientSets` and `client_set` as well. The fold
 *     (`spokenName.foldName`) decides: exact key equality, plus a type-ish
 *     kind.
 *  2. A RATIFICATION WITHOUT AN IMPORT PATH MANUFACTURES ITEM 48. The injected
 *     surface names types and members and never says where they come from;
 *     Rust is masked by its use-path leg and Python's largest measured failure
 *     family is a name the body needs and the file does not import. So the
 *     ruling is: a tier-2 ratification carries the import path or it does not
 *     ship.
 *
 * PRECISION IS THE SHIP CONDITION, RECALL IS A NUMBER IN THE WRITE-UP, and that
 * ordering is the whole design of this file after the phase-3 adversarial
 * review graded the first build against `cargo check`, `go list`, the CPython
 * interpreter, `tsc` and a live Roslyn server (44.2% / 50.7% / 36.4% / 100% /
 * 0%). An import line that does not compile hands the model a type it will name
 * confidently and fail to import, which is this product MANUFACTURING roadmap
 * item 48's failure rather than suffering it. A refusal is a channel line and a
 * strip, and it is cheap. So every reachability question a filesystem can
 * answer is asked here, and a "probably" is a refusal:
 *
 *  - Rust: the module chain must be `pub` the whole way (a re-export is looked
 *    for before refusing), the type must be `pub`, and a cross-crate hit must
 *    be a real dependency of the target crate under the name the target links
 *    it as.
 *  - Go: exported names only, no `main`, no `_test` package, and the
 *    `internal/` boundary is enforced.
 *  - C#: the namespace comes from the def file's own declaration, never from
 *    the provider's `containerName`, which is a Roslyn DISPLAY STRING.
 *  - Python: the dotted path is rooted at something that is actually a sys.path
 *    entry, not at the first directory missing an `__init__.py`.
 *  - TypeScript: a package boundary is not a directory boundary, and a
 *    collapsed `/index` must not point at a shadowing sibling.
 *
 * Pure: no vscode, no clock, no filesystem of its own (everything goes through
 * `ImportPathDeps`), and it never throws.
 */

import * as path from "path";
import { foldName } from "./spokenName";
import { TS_LANGUAGE_IDS } from "./tsExtraction";
import { deriveUsePath } from "./usePath";

/**
 * Which `SymbolKind` numbering a hit's `kind` is written in.
 *
 * REQUIRED, and that is the point. vscode's enum is 0-indexed and the LSP's is
 * 1-indexed, so a raw-LSP Class (5) reads as vscode's Method and is refused,
 * while a raw-LSP Enum (10) is ACCEPTED BY COINCIDENCE because 10 is vscode's
 * Interface. This repo runs both transports at once: `csExtraction.ts` carries
 * `csVscodeSymbolRole` and `csLspSymbolRole` side by side for exactly this
 * split. A bare `number` has nothing to catch a mis-wired caller; a caller that
 * has to SAY which numbering it speaks cannot silently speak the other one.
 */
export type KindScheme = "vscode" | "lsp";

export interface WorkspaceSymbolHit {
  name: string;
  /** The provider's numeric symbol kind, in the numbering `kindScheme` names. */
  kind: number;
  /** Which enum `kind` is written in. Required: see `KindScheme`. */
  kindScheme: KindScheme;
  /** The defining file, as a filesystem path. */
  path: string;
  /**
   * The namespace, module or package the provider reported. Often absent, and
   * NEVER parsed for C#: measured live, Roslyn answers
   * `project Atlas (net10.0)` for a top-level type and
   * `in Result<T, E> (project Atlas (net10.0))` for a nested one, so it is
   * display text and not a namespace. `csExtraction.ts:900` records the same
   * measurement and reaches the same conclusion. It is kept on the record
   * because two DIFFERING container strings are real evidence of two different
   * types, which is a comparison and not a parse.
   */
  containerName?: string;
}

/**
 * Class, Struct, Interface, Enum, TypeParameter, in vscode's 0-indexed
 * `SymbolKind` numbering. A hit that arrives in LSP numbering is converted
 * before it is tested, so this set has exactly one meaning.
 *
 * Never Function, Constant, Variable or Method: that exclusion is the filter
 * which clears most fold collisions, where one side is a const or a function of
 * the same concept (`ReadError` against `read_error`). It does NOT clear all of
 * them in every language - Go's exported/unexported convention puts `Options`
 * and `options` on one key with a type on both sides - and those reach the
 * ambiguity refusal instead. See `session-v52/ratify-measurements.md` for the
 * per-language table.
 *
 * Wider than `fnGen.ts`'s per-language type-target sets ON PURPOSE. Those decide
 * what a generator may splice a body into, so a C# interface is excluded there
 * for having bodyless members. This decides whether a name IS a type, and a C#
 * interface plainly is.
 */
export const TYPE_ISH_KINDS: ReadonlySet<number> = new Set<number>([
  4, // Class
  9, // Enum
  10, // Interface
  22, // Struct
  25, // TypeParameter
]);

/**
 * How many provider queries one candidate may cost.
 *
 * `identifierVariants` yields at most nine spellings (eight conventions plus the
 * inner-token split for a phrase of three words or more), and the cap admits the
 * whole set rather than truncating it: a sweep that stops at eight drops
 * `ShardMemcache`, which is exactly the awkward spelling the ninth exists for.
 * The cap is here to bound a CALLER that hands in a longer list, against a
 * measured ~500ms Roslyn floor per round trip.
 */
export const RATIFY_QUERY_CAP = 9;

export type RatifyVerdict =
  | { ok: true; tier: 1; identifier: string }
  | {
      ok: true;
      tier: 2;
      identifier: string;
      path: string;
      importLine: string;
      qualifier?: string;
      /**
       * The def file is in the target's OWN import scope, so `importLine` is
       * empty because none is needed - NOT because none could be derived.
       *
       * That distinction is the whole reason this field exists. The import-path
       * ruling is there to stop a surface being injected with no way to REACH
       * the type; a same-scope type is already reachable, so the honest answer
       * is neither a refusal nor an import the compiler will reject. A Go file
       * cannot import its own package and a `pkg.` qualifier inside `package
       * pkg` is exactly as broken as the import, so a same-scope verdict never
       * carries a qualifier either.
       *
       * Only Go (the same package CLAUSE, which is not the same thing as the
       * same directory) and C# (the same `namespace` declaration) have the
       * case. A Rust sibling module still needs a `use`, a TypeScript sibling
       * file still needs an import, and a Python sibling module in the same
       * package still needs a `from`, so those three never set it.
       */
      sameScope?: true;
    }
  | { ok: false; reason: "not-in-workspace" | "ambiguous" | "no-import-path"; detail: string };

export interface ImportPathDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => string | undefined;
  /** Directories from the workspace root down to the def file, so a caller can find a
   *  `go.mod`, a `Cargo.toml` or the top of a Python package. */
  workspaceRoot?: string;
}

/** What one language's row derived. `sameScope` is decided by the verdict, not
 *  by the row, because it is a fact about the pair and not about the def. */
interface ImportRow {
  importLine: string;
  qualifier?: string;
}

// ---------------------------------------------------------------- plumbing

/**
 * Backslashes to forward slashes, `.` and `..` collapsed, trailing separator
 * off (amendments 7 and defect 15). The extension runs on Windows and every
 * path here is read with `path.posix`, so normalisation happens ONCE, at the
 * door, before any dep is handed a string. Two spellings of one file are also
 * one file to the ambiguity test, which otherwise refuses a type because the
 * provider reached it twice by two spellings of the same path.
 */
function normalisePath(p: unknown): string {
  if (typeof p !== "string" || p === "") {
    return "";
  }
  const slashed = path.posix.normalize(p.replace(/\\/g, "/"));
  return slashed.length > 1 ? slashed.replace(/\/+$/, "") : slashed;
}

/** The deps, with every call wrapped: a filesystem that throws is a miss here.
 *  The caller is a VS Code command reading a workspace it does not own. */
interface SafeDeps {
  exists(p: string): boolean;
  read(p: string): string | undefined;
  root: string;
}

function safeDeps(deps: ImportPathDeps | undefined): SafeDeps {
  return {
    exists(p) {
      try {
        return deps?.fileExists?.(p) === true;
      } catch {
        return false;
      }
    },
    read(p) {
      try {
        const text = deps?.readFile?.(p);
        // The BOM is stripped HERE, once, rather than in each parser. 132 files
        // in the C# corpus start with one, and `^namespace` cannot match
        // `﻿namespace`; 21 of 271 namespace declarations refused for that
        // alone. Amendment 7 anticipated Windows for separators and not for the
        // byte order mark.
        return typeof text === "string" ? text.replace(/^﻿/, "") : undefined;
      } catch {
        return undefined;
      }
    },
    root: normalisePath(deps?.workspaceRoot),
  };
}

/** vscode's `SymbolKind` number for a hit, whatever numbering it arrived in.
 *  The LSP enum is the vscode enum PLUS ONE across every value this set cares
 *  about (Class 5/4, Enum 10/9, Interface 11/10, Struct 23/22,
 *  TypeParameter 26/25), which is the same relationship `csExtraction.ts`'s two
 *  role mappers encode. */
function vscodeKindOf(hit: WorkspaceSymbolHit): number {
  return hit.kindScheme === "lsp" ? hit.kind - 1 : hit.kind;
}

/** A record shaped like a provider hit. Anything else is dropped before it can
 *  reach a filter, and COUNTED, so a provider that returns nulls is reported as
 *  hits that were dropped rather than as an empty workspace.
 *
 *  `kindScheme` is required on the interface, which is a compile-time contract
 *  for a TypeScript caller. At runtime an absent one is read as "vscode": that
 *  is the numbering every existing caller in this repo's vscode layer speaks,
 *  and refusing an untyped caller's hit outright would turn a wiring mistake
 *  into a silent empty workspace, which is the failure this discriminator
 *  exists to prevent. */
function isHit(h: unknown): h is WorkspaceSymbolHit {
  const r = h as WorkspaceSymbolHit | undefined;
  return (
    !!r &&
    typeof r === "object" &&
    typeof r.name === "string" &&
    r.name.length > 0 &&
    typeof r.path === "string" &&
    r.path.length > 0 &&
    typeof r.kind === "number"
  );
}

/** Every ancestor directory of `from`, `from` itself first, stopping at
 *  `root` (inclusive) when one is given and at the filesystem top otherwise. */
function ancestorsOf(from: string, root: string): string[] {
  const out: string[] = [];
  let dir = from;
  for (;;) {
    out.push(dir);
    if (root !== "" && dir === root) {
      return out;
    }
    const parent = path.posix.dirname(dir);
    if (parent === dir) {
      return out;
    }
    dir = parent;
  }
}

/** True when `inner` is `outer` or sits underneath it. */
function isUnder(inner: string, outer: string): boolean {
  return inner === outer || inner.startsWith(`${outer}/`);
}

// ----------------------------------------------------------------- rust

/** Nearest ancestor holding a Cargo.toml: the crate root. */
function crateRootOf(filePath: string, d: SafeDeps): string | undefined {
  return ancestorsOf(path.posix.dirname(filePath), "").find((dir) =>
    d.exists(path.posix.join(dir, "Cargo.toml")),
  );
}

/** A `key = "value"` from one TOML section, section-aware so a dependency's
 *  `name` is never read as the package's. */
function tomlField(text: string, section: string, key: string): string | undefined {
  let inSection = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const header = /^\[([^\]]+)\]/.exec(line);
    if (header) {
      inSection = header[1].trim() === section;
      continue;
    }
    if (inSection) {
      const m = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`).exec(line);
      if (m) {
        return m[1];
      }
    }
  }
  return undefined;
}

/** The dependency table of a Cargo.toml, as key -> the declaration text. Covers
 *  `[dependencies]` lines and `[dependencies.key]` sections, and reports which
 *  table the key came from so a dev-dependency can be treated differently. */
function cargoDependencies(text: string): Map<string, { table: string; decl: string }> {
  const out = new Map<string, { table: string; decl: string }>();
  let table: string | undefined;
  let subKey: string | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const header = /^\[([^\]]+)\]/.exec(line);
    if (header) {
      const name = header[1].trim();
      const m = /^(?:target\.[^.]+\.)?(dependencies|dev-dependencies|build-dependencies)(?:\.(.+))?$/.exec(name);
      table = m ? m[1] : undefined;
      subKey = m && m[2] ? m[2].replace(/"/g, "") : undefined;
      if (table && subKey) {
        out.set(subKey, { table, decl: out.get(subKey)?.decl ?? "" });
      }
      continue;
    }
    if (!table) {
      continue;
    }
    if (subKey) {
      const prev = out.get(subKey);
      out.set(subKey, { table, decl: `${prev?.decl ?? ""}\n${line}` });
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (kv) {
      out.set(kv[1], { table, decl: kv[2] });
    }
  }
  return out;
}

/**
 * The name the TARGET crate links the DEF crate under, or undefined when it
 * does not link it at all.
 *
 * This is defect 4 and defect 19 in one lookup, because in Cargo they are one
 * fact. rust-analyzer's workspace symbol search spans every crate in the
 * workspace, so the common case for a multi-crate repo is a hit in a crate the
 * target cannot see: 43 of 435 derived `use` lines compiled across the whole
 * celeriant-db workspace, 43 of 50 once restricted to crates the target links.
 * And the extern name is the DEPENDENCY KEY, not the package name:
 * `celeriant_lib = { package = "celeriant", path = "../celeriant" }` is linked
 * as `celeriant_lib`, which is also what `[lib] name` says.
 *
 * A dev-dependency is only linkable from a test target, so it is accepted only
 * when the target file is one.
 */
function externCrateName(
  defCrateRoot: string,
  targetCrateRoot: string,
  targetPath: string,
  d: SafeDeps,
): string | undefined {
  const manifest = d.read(path.posix.join(targetCrateRoot, "Cargo.toml"));
  const defManifest = d.read(path.posix.join(defCrateRoot, "Cargo.toml"));
  if (manifest === undefined || defManifest === undefined) {
    return undefined;
  }
  const defPackage = tomlField(defManifest, "package", "name");
  if (!defPackage) {
    return undefined;
  }
  // A test target may link dev-dependencies; a library target may not.
  const rel = path.posix.relative(targetCrateRoot, targetPath);
  const isTestTarget = /^(tests|benches|examples)\//.test(rel) || /(^|\/)[^/]*_test\.rs$/.test(rel);
  for (const [key, { table, decl }] of cargoDependencies(manifest)) {
    if (table === "dev-dependencies" && !isTestTarget) {
      continue;
    }
    if (table === "build-dependencies") {
      continue;
    }
    const renamed = /package\s*=\s*"([^"]+)"/.exec(decl);
    const depPath = /path\s*=\s*"([^"]+)"/.exec(decl);
    const pointsAtDef =
      (renamed ? renamed[1] : key) === defPackage ||
      (depPath !== null &&
        normalisePath(path.posix.resolve(targetCrateRoot, depPath[1])) === normalisePath(defCrateRoot));
    if (pointsAtDef) {
      return key.replace(/-/g, "_");
    }
  }
  return undefined;
}

/** The module file that DECLARES the children of a module: `src/lib.rs` for the
 *  crate root, then `<dir>/<seg>.rs` or `<dir>/<seg>/mod.rs` going down. */
function moduleFileFor(srcRoot: string, segs: readonly string[], d: SafeDeps): string | undefined {
  let dir = srcRoot;
  let file = [path.posix.join(srcRoot, "lib.rs"), path.posix.join(srcRoot, "main.rs")].find((f) => d.exists(f));
  for (const seg of segs) {
    if (file === undefined) {
      return undefined;
    }
    const flat = path.posix.join(dir, `${seg}.rs`);
    const folded = path.posix.join(dir, seg, "mod.rs");
    if (d.exists(folded)) {
      dir = path.posix.join(dir, seg);
      file = folded;
    } else if (d.exists(flat)) {
      dir = path.posix.join(dir, seg);
      file = flat;
    } else {
      return undefined;
    }
  }
  return file;
}

/**
 * Is the item at `index` behind a `#[cfg(...)]`.
 *
 * A conditional item may not exist in the build the developer is compiling, and
 * nothing here can evaluate a feature flag. glommio declares
 * `#[cfg(feature = "bench")] pub mod nop;`, and the derived
 * `use crate::nop::NopSubmitter;` is E0432 with the feature off - the last two
 * wrong rows in the corpus. The walk back crosses other attributes, doc
 * comments and blank lines, because the cfg is rarely the attribute nearest the
 * item.
 */
function precededByCfg(text: string, index: number): boolean {
  const before = text.slice(0, index).split("\n");
  for (let i = before.length - 2; i >= 0; i--) {
    const line = before[i].trim();
    if (line === "" || line.startsWith("///") || line.startsWith("//!") || line.startsWith("//")) {
      continue;
    }
    if (line.startsWith("#[cfg(") || line.startsWith("#[cfg_attr(")) {
      return true;
    }
    if (line.startsWith("#[") || line.startsWith("#![")) {
      continue;
    }
    return false;
  }
  return false;
}

/** The visibility of `mod <seg>` as declared in `text`, or undefined when the
 *  declaration is not there at all (a `#[path]` attribute, a `mod` nested in a
 *  block, a cfg-gated tree this cannot see). */
function modVisibility(text: string, seg: string): "public" | "crate" | "private" | undefined {
  const m = new RegExp(`^[ \\t]*(pub(?:\\(([^)]*)\\))?[ \\t]+)?mod[ \\t]+${seg}[ \\t]*[;{]`, "m").exec(text);
  if (!m || precededByCfg(text, m.index)) {
    return undefined;
  }
  if (!m[1]) {
    return "private";
  }
  if (m[2] === undefined) {
    return "public";
  }
  return m[2].trim() === "crate" ? "crate" : "private";
}

/** The visibility of the type declaration itself. A `pub use` cannot rescue a
 *  private type, so this is checked before the module chain. */
function typeVisibility(text: string, name: string): "public" | "crate" | "private" | "conditional" | undefined {
  const m = new RegExp(
    `^[ \\t]*(pub(?:\\(([^)]*)\\))?[ \\t]+)?(?:struct|enum|trait|union|type)[ \\t]+${name}\\b`,
    "m",
  ).exec(text);
  if (!m) {
    return undefined; // not found is not a refusal: a macro can declare a type
  }
  if (precededByCfg(text, m.index)) {
    return "conditional";
  }
  if (!m[1]) {
    return "private";
  }
  if (m[2] === undefined) {
    return "public";
  }
  return m[2].trim() === "crate" ? "crate" : "private";
}

/** Top-level commas of a `use` group body, braces respected. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    } else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.filter((p) => p !== "");
}

/** One `use` body into the flat paths it names: `a::{b::{C, D}, E}` becomes
 *  `a::b::C`, `a::b::D`, `a::E`. */
function expandUse(s: string): string[] {
  const open = s.indexOf("{");
  if (open < 0) {
    return [s];
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") {
      depth++;
    } else if (s[i] === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) {
    return [s];
  }
  const prefix = s.slice(0, open);
  const tail = s.slice(close + 1);
  return splitTopLevel(s.slice(open + 1, close)).flatMap((part) => expandUse(prefix + part + tail));
}

/** Every path a `pub use` in `text` re-exports, flattened. Whitespace goes
 *  first, so the multi-line grouped form is one item; an `as` rename is marked
 *  and dropped, because the reachable name is then the alias and not the one
 *  the provider gave us. */
function pubUsePaths(text: string, sameCrate: boolean): string[] {
  const marked = text.replace(/\s+as\s+/g, "#as#");
  const re = /(?:^|\n)[ \t]*pub(?:\(([^)]*)\))?[ \t]+use[ \t]+/g;
  const out: string[] = [];
  for (let m = re.exec(marked); m; m = re.exec(marked)) {
    const scope = m[1];
    if (scope !== undefined && !(sameCrate && scope.trim() === "crate")) {
      continue;
    }
    let depth = 0;
    let body = "";
    for (let i = re.lastIndex; i < marked.length; i++) {
      const c = marked[i];
      if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
      } else if (c === ";" && depth === 0) {
        break;
      }
      body += c;
    }
    for (const p of expandUse(body.replace(/\s+/g, ""))) {
      if (!p.includes("#as#")) {
        out.push(p);
      }
    }
  }
  return out;
}

/**
 * Does the module file `text` re-export `name` from its private child `seg`,
 * and is the type therefore nameable at THIS module's path.
 *
 * This is the shape the corpus actually uses, and it is why 136 of glommio's
 * 249 rows were E0603 before: `mod deadline_queue;` is private with
 * `pub use self::deadline_queue::*;` beside it, and lib.rs re-exports a dozen
 * private modules at once through a grouped, multi-line
 * `pub use crate::{ byte_slice_ext::{ByteSliceExt, ByteSliceMutExt}, … };`.
 *
 * A whole-module glob (`seg::*`) counts, and so does a named export at any
 * depth under `seg`. A DEEPER glob (`seg::inner::*`) does not: it would only
 * carry the name if the name is in that particular inner module, and this
 * cannot see that, so it refuses instead of guessing.
 */
function reExports(text: string, seg: string, name: string, sameCrate: boolean, here: readonly string[]): boolean {
  const ownPath = ["crate", ...here].join("::");
  for (const raw of pubUsePaths(text, sameCrate)) {
    let p = raw;
    if (p.startsWith("self::")) {
      p = p.slice("self::".length);
    } else if (p.startsWith(`${ownPath}::`)) {
      p = p.slice(ownPath.length + 2);
    }
    if (p === `${seg}::*` || (p.startsWith(`${seg}::`) && p.endsWith(`::${name}`))) {
      return true;
    }
  }
  return false;
}

/**
 * Rust: `deriveUsePath` derives the FILE path; this decides whether that path is
 * REACHABLE, and rewrites it to the re-export when it is not.
 *
 * 110 of 249 derived `use` lines compiled on glommio and 136 of the failures
 * were E0603, all one mechanism: `deriveUsePath` walks the file tree and Rust
 * resolves the module tree. `DeadlineQueue` lives in a private
 * `mod deadline_queue;` and is reachable only at `crate::controllers::` through
 * a `pub use`. So the chain is walked, each `mod` declaration is read, and a
 * private segment sends this looking for the re-export before it refuses.
 *
 * `deriveUsePath` itself is deliberately NOT changed: it is the fn-gen prompt's
 * use-path leg, and standing rule 6 forbids a behaviour change there.
 */
function rustImport(hit: WorkspaceSymbolHit, defPath: string, targetPath: string, d: SafeDeps): ImportRow | undefined {
  const usePath = deriveUsePath(defPath, targetPath, {
    fileExists: (p) => d.exists(p),
    readFile: (p) => d.read(p),
  });
  if (usePath === undefined) {
    return undefined;
  }
  const defCrate = crateRootOf(defPath, d);
  const targetCrate = crateRootOf(targetPath, d);
  if (defCrate === undefined || targetCrate === undefined) {
    return undefined;
  }
  const sameCrate = defCrate === targetCrate;

  const defText = d.read(defPath);
  if (defText === undefined) {
    return undefined;
  }
  const typeVis = typeVisibility(defText, hit.name);
  if (typeVis === "private" || typeVis === "conditional" || (typeVis === "crate" && !sameCrate)) {
    return undefined;
  }

  const segs = usePath.split("::").slice(1);
  const srcRoot = path.posix.join(defCrate, "src");
  const visible: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const parent = moduleFileFor(srcRoot, segs.slice(0, i), d);
    const parentText = parent === undefined ? undefined : d.read(parent);
    if (parentText === undefined) {
      return undefined; // cannot verify the chain, so cannot claim it compiles
    }
    const vis = modVisibility(parentText, segs[i]);
    if (vis === "public" || (vis === "crate" && sameCrate)) {
      visible.push(segs[i]);
      continue;
    }
    // Private (or undeclared) from here down. The re-export is the corpus's
    // answer: when this module publishes the name, the type is nameable HERE,
    // at the path built so far, and the rest of the file chain is not part of
    // its module path at all.
    if (vis !== undefined && reExports(parentText, segs[i], hit.name, sameCrate, segs.slice(0, i))) {
      break;
    }
    return undefined;
  }

  let prefix = usePath.split("::")[0];
  if (!sameCrate) {
    const extern = externCrateName(defCrate, targetCrate, targetPath, d);
    if (extern === undefined) {
      return undefined; // not a dependency of the target crate: E0433
    }
    prefix = extern;
  }
  return { importLine: `use ${[prefix, ...visible, hit.name].join("::")};` };
}

// ------------------------------------------------------------ typescript

const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];

/** Every extension a TS/JS specifier drops. `.d.ts` is peeled first because the
 *  single-extension pass would leave `api.d` behind. */
function stripTsExtension(spec: string): string {
  if (/\.d\.[cm]?ts$/.test(spec)) {
    return spec.replace(/\.d\.[cm]?ts$/, "");
  }
  return spec.replace(/\.([cm]?[jt]sx?)$/, "");
}

/** The nearest package.json at or above `file`'s directory. */
function packageJsonFor(file: string, d: SafeDeps): string | undefined {
  return ancestorsOf(path.posix.dirname(file), d.root)
    .map((dir) => path.posix.join(dir, "package.json"))
    .find((p) => d.exists(p));
}

/** A top-level string field of a package.json, without a JSON parse that can
 *  throw on a manifest with a trailing comma. */
function jsonStringField(text: string, key: string): string | undefined {
  const m = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(text);
  return m ? m[1] : undefined;
}

/** Does this manifest depend on `name`, in any of the dependency tables a
 *  bundler will resolve from. */
function dependsOn(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const table of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const m = new RegExp(`"${table}"\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(text);
    if (m && new RegExp(`"${escaped}"\\s*:`).test(m[1])) {
      return true;
    }
  }
  return false;
}

/**
 * TypeScript: a relative specifier from the TARGET's directory, or the PACKAGE
 * NAME when the two sit in different packages.
 *
 * A package boundary is not a directory boundary, and the relative path across
 * one is not what the repo writes: `continue`'s own target file imports
 * `@continuedev/config-yaml`, not `../../packages/config-yaml/src/validation`.
 * Same mechanism as Rust's crate check, and the same refusal when the target
 * does not depend on the package.
 *
 * A named import in double quotes and never `import type` (amendment 6): the
 * surface is a hint to a model, and the named form is the one that works for a
 * class and an interface alike.
 */
function tsImport(hit: WorkspaceSymbolHit, defPath: string, targetPath: string, d: SafeDeps): ImportRow | undefined {
  if (targetPath === "") {
    return undefined;
  }
  const defPkg = packageJsonFor(defPath, d);
  const targetPkg = packageJsonFor(targetPath, d);
  if (defPkg !== undefined && targetPkg !== undefined && defPkg !== targetPkg) {
    const defManifest = d.read(defPkg);
    const targetManifest = d.read(targetPkg);
    const name = defManifest === undefined ? undefined : jsonStringField(defManifest, "name");
    if (!name || targetManifest === undefined || !dependsOn(targetManifest, name)) {
      return undefined;
    }
    return { importLine: `import { ${hit.name} } from "${name}";` };
  }

  let spec = path.posix.relative(path.posix.dirname(targetPath), defPath);
  if (spec === "") {
    return undefined; // the def file IS the target file; nothing to import
  }
  spec = stripTsExtension(spec);
  if (spec.endsWith("/index")) {
    // Only when nothing shadows it. `moltbot` has both `plugins/runtime.ts` and
    // `plugins/runtime/index.ts`, and node and tsc both resolve the FILE, so a
    // blind collapse points the specifier at a different module.
    const collapsed = spec.slice(0, -"/index".length);
    const shadowDir = path.posix.dirname(defPath);
    const shadowed = TS_EXTENSIONS.some((ext) => d.exists(`${shadowDir}${ext}`));
    if (!shadowed) {
      spec = collapsed;
    }
  }
  if (spec === "") {
    return undefined;
  }
  if (!spec.startsWith(".")) {
    spec = `./${spec}`;
  }
  return { importLine: `import { ${hit.name} } from "${spec}";` };
}

// ------------------------------------------------------------------ c#

/** Comments and string literals blanked, newlines kept, so a `namespace` in
 *  prose cannot answer and a brace inside a string cannot move the depth. */
function scrubCs(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && text[i] !== "\n") {
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") {
          out += "\n";
        }
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "@" && d === '"') {
      i += 2;
      while (i < n && !(text[i] === '"' && text[i + 1] !== '"')) {
        if (text[i] === "\n") {
          out += "\n";
        }
        i += text[i] === '"' ? 2 : 1;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n && text[i] !== quote && text[i] !== "\n") {
        i += text[i] === "\\" ? 2 : 1;
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const CS_TYPE_DECL =
  /^\s*(?:\[[^\]]*\]\s*)*(?:(?:public|internal|private|protected|static|sealed|abstract|partial|readonly|unsafe|ref|file|new)\s+)*(?:class|struct|interface|enum|record)\s+([A-Za-z_]\w*)/;

/**
 * The namespace ENCLOSING a named type, brace-aware.
 *
 * The first `namespace` in the file is not the type's: a nested
 * `namespace Outer { namespace Inner { class Widget } }` makes `using Outer;`
 * useless, and a file with `namespace First;` followed by a block
 * `namespace Second` answers for both. Both forms are declared C#. When
 * `typeName` is absent this answers for the file's first declaration, which is
 * what a same-scope test on the TARGET file wants.
 *
 * Undefined means no enclosing namespace was found, which is a refusal and not
 * a `using` of the global namespace: a global-namespace type needs no using,
 * but nothing here can tell that apart from a file it failed to parse, and a
 * wrong provenance is worse than none.
 */
function csNamespaceOfType(text: string | undefined, typeName?: string): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  const stack: { ns: string; atDepth: number }[] = [];
  let fileScoped: string | undefined;
  let depth = 0;
  let firstSeen: string | undefined;
  for (const line of scrubCs(text).split("\n")) {
    const ns = /^\s*namespace\s+([A-Za-z_][A-Za-z0-9_.]*)\s*([;{]?)/.exec(line);
    if (ns) {
      if (ns[2] === ";") {
        fileScoped = ns[1];
      } else {
        stack.push({ ns: ns[1], atDepth: depth });
      }
    } else {
      const t = CS_TYPE_DECL.exec(line);
      if (t) {
        const chain = fileScoped !== undefined ? [fileScoped, ...stack.map((x) => x.ns)] : stack.map((x) => x.ns);
        const joined = chain.join(".");
        if (typeName !== undefined && t[1] === typeName) {
          return joined === "" ? undefined : joined;
        }
        if (firstSeen === undefined && joined !== "") {
          firstSeen = joined;
        }
      }
    }
    for (const ch of line) {
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        while (stack.length > 0 && stack[stack.length - 1].atDepth >= depth) {
          stack.pop();
        }
      }
    }
  }
  if (typeName !== undefined) {
    // The provider says the type is in this file and the scan did not find its
    // declaration (a generic arity, a nested type, a partial spelled across
    // lines). A file with exactly one namespace still answers safely.
    return fileScoped !== undefined ? fileScoped : firstSeen;
  }
  return fileScoped !== undefined ? fileScoped : firstSeen;
}

/** C#: `using Namespace;`, always from the def file's own declaration.
 *  `containerName` is NEVER parsed - see `WorkspaceSymbolHit.containerName`. */
function csImport(hit: WorkspaceSymbolHit, defPath: string, d: SafeDeps): ImportRow | undefined {
  const ns = csNamespaceOfType(d.read(defPath), hit.name);
  return ns ? { importLine: `using ${ns};` } : undefined;
}

// -------------------------------------------------------------- python

const PY_ROOT_MARKERS = ["pyproject.toml", "setup.py", "setup.cfg"];

/**
 * Python: the dotted module path, rooted at something that is actually a
 * sys.path ENTRY.
 *
 * "Climb while `__init__.py` is there" is the rule the contract wrote and the
 * interpreter refuses it: `mpl_toolkits` is a PEP 420 namespace package with no
 * `__init__.py`, so the climb stops one directory too low and
 * `from mplot3d.axes3d import Axes3D` raises ModuleNotFoundError. A sys.path
 * entry is a project root or the workspace root, so that is what this climbs
 * to: `pyproject.toml`, `setup.py`, `setup.cfg`, a `src/` directory, or
 * `workspaceRoot`, whichever comes first going up.
 *
 * The `__init__.py` chain is still the fallback for a tree with no marker and
 * no workspace root, where climbing to the filesystem top would invent a dotted
 * path out of somebody's home directory.
 */
function pyImport(hit: WorkspaceSymbolHit, defPath: string, d: SafeDeps): ImportRow | undefined {
  const base = path.posix.basename(defPath).replace(/\.pyi?$/, "");
  const defDir = path.posix.dirname(defPath);

  let root: string | undefined;
  for (const dir of ancestorsOf(defDir, d.root)) {
    if (dir === d.root || path.posix.basename(dir) === "src" || PY_ROOT_MARKERS.some((m) => d.exists(path.posix.join(dir, m)))) {
      root = dir;
      break;
    }
  }
  let packages: string[];
  if (root !== undefined && isUnder(defDir, root)) {
    const rel = path.posix.relative(root, defDir);
    packages = rel === "" ? [] : rel.split("/");
  } else {
    packages = [];
    for (const dir of ancestorsOf(defDir, d.root)) {
      if (!d.exists(path.posix.join(dir, "__init__.py"))) {
        break;
      }
      packages.unshift(path.posix.basename(dir));
    }
  }

  const parts = base === "__init__" ? packages : [...packages, base];
  if (parts.length === 0 || parts.some((p) => p === "" || !/^[A-Za-z_]\w*$/.test(p))) {
    return undefined;
  }
  return { importLine: `from ${parts.join(".")} import ${hit.name}` };
}

// ------------------------------------------------------------------ go

/** The `module` line of a go.mod, quotes and trailing comment off. */
function goModulePath(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  const m = /^[ \t]*module[ \t]+("?)([^"\s]+)\1/m.exec(text);
  return m ? m[2] : undefined;
}

/** The `package` clause of a Go file. */
function goPackageClause(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  const m = /^[ \t]*package[ \t]+([A-Za-z_][A-Za-z0-9_]*)/m.exec(text);
  return m ? m[1] : undefined;
}

/**
 * Go: the module path from the nearest go.mod plus the def file's directory
 * relative to that module root, AND the qualifier the body must type.
 *
 * THE QUALIFIER IS NOT OPTIONAL. A Go body cannot name another package's type
 * unqualified, so an import line on its own hands the model a type it will
 * write as `Client` where only `store.Client` compiles.
 *
 * FOUR REFUSALS, and `go list` graded every one of them. They are cheap and
 * they are the difference between 50.7% and a shippable number:
 *
 *  - An UNEXPORTED name is not nameable from another package at all, and it was
 *    the largest single failure family at 1,427 rows. `memberVisibility.ts`
 *    already argues the point for members: a private member is an invitation to
 *    a guaranteed compile error.
 *  - A `_test.go` file or a `_test` package is importable by nothing.
 *    `pgx/bench_test.go` is `package pgx_test` and declares an exported type.
 *  - `package main` is a program, not an import.
 *  - `internal/` is importable only from within the subtree rooted at that
 *    directory's parent.
 *
 * A def in the target's OWN directory never gets an import line either: that is
 * either the same package (the verdict answers `sameScope`) or a test package
 * beside it (refused above).
 */
function goImport(hit: WorkspaceSymbolHit, defPath: string, targetPath: string, d: SafeDeps): ImportRow | undefined {
  if (!/^\p{Lu}/u.test(hit.name)) {
    return undefined;
  }
  if (/_test\.go$/.test(defPath)) {
    return undefined;
  }
  const defDir = path.posix.dirname(defPath);
  // The go tool ignores a directory named `testdata` and any directory whose
  // name starts with `_` or `.`, so nothing under one is importable and
  // `go list ./...` does not even name it. 3 of the 4 surviving wrong rows
  // across six repos were one `testdata/` package.
  if (defDir.split("/").some((seg) => seg === "testdata" || /^[._]./.test(seg))) {
    return undefined;
  }
  if (targetPath !== "" && defDir === path.posix.dirname(targetPath)) {
    return undefined;
  }
  const clause = goPackageClause(d.read(defPath));
  if (clause === "main" || (clause !== undefined && clause.endsWith("_test"))) {
    return undefined;
  }
  const modDir = ancestorsOf(defDir, d.root).find((dir) => d.exists(path.posix.join(dir, "go.mod")));
  if (modDir === undefined) {
    return undefined;
  }
  const modulePath = goModulePath(d.read(path.posix.join(modDir, "go.mod")));
  if (!modulePath) {
    return undefined;
  }
  const rel = path.posix.relative(modDir, defDir);
  if (rel.startsWith("..")) {
    return undefined;
  }
  const importPath = rel === "" ? modulePath : `${modulePath}/${rel}`;

  const segs = rel === "" ? [] : rel.split("/");
  const internalAt = segs.lastIndexOf("internal");
  if (internalAt >= 0) {
    const boundary = path.posix.join(modDir, ...segs.slice(0, internalAt));
    if (targetPath === "" || !isUnder(path.posix.dirname(targetPath), boundary)) {
      return undefined;
    }
  }

  const segment = importPath.slice(importPath.lastIndexOf("/") + 1);
  // The def file's own clause beats the directory name: the two legitimately
  // differ (`store-go/` holding `package storepkg`, a `/v2` module suffix), and
  // the clause is what the body has to type. The segment is the fallback for an
  // unreadable file, and only when it is a valid Go identifier.
  const qualifier = clause ?? (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment) ? segment : undefined);
  if (!qualifier) {
    return undefined;
  }
  return { importLine: `import "${importPath}"`, qualifier };
}

/**
 * The import the target file would need, and for Go the qualifier the body must
 * use. Undefined when it cannot be derived OR when the type is not reachable,
 * which FAILS the ratification rather than shipping a surface with no
 * provenance or a wrong one.
 *
 * The TypeScript family comes from `TS_LANGUAGE_IDS` (amendment 5) rather than a
 * second list. An unregistered language has no row and refuses: this product
 * would rather strip a backtick than invent an import syntax.
 */
export function importLineFor(
  languageId: string,
  hit: WorkspaceSymbolHit,
  targetPath: string,
  deps: ImportPathDeps,
): { importLine: string; qualifier?: string } | undefined {
  if (!isHit(hit)) {
    return undefined;
  }
  const defPath = normalisePath(hit.path);
  const target = normalisePath(targetPath);
  if (defPath === "") {
    return undefined;
  }
  const d = safeDeps(deps);
  if (languageId === "rust") {
    return rustImport(hit, defPath, target, d);
  }
  if (typeof languageId === "string" && TS_LANGUAGE_IDS.has(languageId)) {
    return tsImport(hit, defPath, target, d);
  }
  if (languageId === "csharp") {
    return csImport(hit, defPath, d);
  }
  if (languageId === "python") {
    return pyImport(hit, defPath, d);
  }
  if (languageId === "go") {
    return goImport(hit, defPath, target, d);
  }
  return undefined;
}

// ------------------------------------------------------------ the verdict

/** A refusal always names the WORD and the TIER that refused it (amendment 9),
 *  because ship condition 2 is a channel line saying exactly that, and a detail
 *  that omits either forces the caller to rebuild the sentence. */
function refuse(
  reason: "not-in-workspace" | "ambiguous" | "no-import-path",
  detail: string,
): RatifyVerdict {
  return { ok: false, reason, detail };
}

/**
 * Is the def file already in the TARGET's import scope, so that the body can
 * name the type with no import and no qualifier at all.
 *
 * Two languages have the case and three do not, and the asymmetry is real
 * rather than an omission. Go's unit of import is the PACKAGE and C#'s is the
 * `namespace`; Rust, TypeScript and Python all scope by FILE, so a sibling
 * still needs a `use`, an `import` or a `from`.
 *
 * GO COMPARES THE CLAUSE, NOT THE DIRECTORY. Amendment 11 said "same directory
 * is the same package, and that is the whole rule", and `pgconn_test.go` is
 * `package pgconn_test` sitting beside `pgconn.go`: same directory, two
 * packages, neither able to name the other's types bare. The clause is already
 * read for the qualifier, so the correction is free. Same directory remains
 * NECESSARY, because a Go package cannot span directories.
 *
 * The same-FILE case never reaches here; it is tier 1, decided earlier.
 */
function isSameScope(
  languageId: string,
  hit: WorkspaceSymbolHit,
  defPath: string,
  targetPath: string,
  d: SafeDeps,
): boolean {
  if (targetPath === "") {
    return false;
  }
  if (languageId === "go") {
    if (path.posix.dirname(defPath) !== path.posix.dirname(targetPath)) {
      return false;
    }
    const defClause = goPackageClause(d.read(defPath));
    const targetClause = goPackageClause(d.read(targetPath));
    return defClause !== undefined && defClause === targetClause;
  }
  if (languageId === "csharp") {
    const defNs = csNamespaceOfType(d.read(defPath), hit.name);
    const targetNs = csNamespaceOfType(d.read(targetPath));
    return defNs !== undefined && targetNs !== undefined && defNs === targetNs;
  }
  return false;
}

/** Two rows are the same answer when both halves match. Used to tell one type
 *  reached twice from two genuinely different types. */
function sameRow(a: ImportRow | undefined, b: ImportRow | undefined): boolean {
  return a !== undefined && b !== undefined && a.importLine === b.importLine && a.qualifier === b.qualifier;
}

/**
 * Tier 2's whole decision, given what the provider returned for one candidate.
 *
 * The order is fixed and each step earns its place:
 *
 *  1. SHAPE, then FOLD, then KIND. Every count rides into the refusal detail,
 *     because "five hits came back and none was a type", "two arrived
 *     malformed" and "nothing came back" are different facts about the
 *     workspace and the developer needs the difference.
 *  2. THE TARGET FILE ITSELF is tier 1. No language imports a type from the
 *     file that declares it.
 *  3. AMBIGUITY, and the test is the ANSWER, not the path. Amendment 1 rescued
 *     two survivors in the same file; a C# `partial class` split across
 *     `X.cs` and `X.Designer.cs` (every EF Core migration) is one type in two
 *     files, and so is a re-export that lands on one module. Two survivors that
 *     produce the SAME import line are one type. Anything else with more than
 *     one path refuses: this product refuses rather than picks, everywhere, and
 *     two survivors that BOTH derive nothing stay a refusal to pick rather than
 *     becoming a missing path (amendment 8).
 *  4. THE IMPORT PATH, or a refusal. Ship condition 3.
 *
 * The verdict's `identifier` is the HIT's spelling and never the candidate's
 * (amendment 3). The repo's spelling is the truth: a backtick spelled any other
 * way will not anchor when `findTypeReference` reads it back one phase later,
 * which turns a ratified type into a dead gesture.
 */
export function ratifyWorkspaceHits(
  identifier: string,
  hits: readonly WorkspaceSymbolHit[],
  languageId: string,
  targetPath: string,
  deps: ImportPathDeps,
): RatifyVerdict {
  const word = typeof identifier === "string" ? identifier : "";
  const key = foldName(word);
  const incoming = Array.isArray(hits) ? hits : [];
  const raw = incoming.filter(isHit);
  const label = `tier 2: \`${word}\``;
  if (key === "") {
    return refuse("not-in-workspace", `${label} folds to nothing, so no symbol can match it`);
  }

  const byName = raw.filter((h) => foldName(h.name) === key);
  const survivors = byName.filter((h) => TYPE_ISH_KINDS.has(vscodeKindOf(h)));
  if (survivors.length === 0) {
    const drops = [
      incoming.length - raw.length > 0 ? `${incoming.length - raw.length} dropped as malformed` : "",
      `${raw.length - byName.length} dropped by fold key`,
      `${byName.length - survivors.length} dropped by kind`,
    ].filter((s) => s !== "");
    const counts =
      incoming.length === 0
        ? "0 hits from the symbol provider"
        : `${incoming.length} hits, ${drops.join(", ")}`;
    return refuse("not-in-workspace", `${label} is not a type in this workspace (${counts})`);
  }

  const target = normalisePath(targetPath);
  const d = safeDeps(deps);
  const paths = [...new Set(survivors.map((h) => normalisePath(h.path)))];
  if (paths.includes(target)) {
    const here = survivors.find((h) => normalisePath(h.path) === target);
    return { ok: true, tier: 1, identifier: here ? here.name : survivors[0].name };
  }

  // One answer per surviving path, so ambiguity is decided on what the
  // developer would be handed rather than on how many files the provider named.
  const all = survivors.map((h) => {
    const defPath = normalisePath(h.path);
    const scope = isSameScope(languageId, h, defPath, target, d);
    return {
      hit: h,
      defPath,
      sameScope: scope,
      row: scope ? { importLine: "" } : importLineFor(languageId, h, target, deps),
    };
  });
  // A survivor the target CANNOT REACH is not a candidate, so it cannot make
  // the reachable one ambiguous. This is not the product picking between two
  // answers; the other is not an answer. Go's exported/unexported convention is
  // why it matters: `Page` and `page` are one fold key with a type on both
  // sides, 37 of hugo's 1,216 type keys, and the kind filter cannot clear them.
  // Gate the unexported side out and that number is 0 of 675. When NOTHING is
  // reachable the whole list stays, so the refusal still reports the real
  // ambiguity instead of a missing path.
  const reachable = all.filter((a) => a.sameScope || a.row !== undefined);
  const answers = reachable.length > 0 ? reachable : all;
  const reachedPaths = [...new Set(answers.map((a) => a.defPath))];
  const chosen = answers[0];
  if (reachedPaths.length > 1 && !answers.every((a) => a.sameScope === chosen.sameScope && sameRow(a.row, chosen.row))) {
    return refuse(
      "ambiguous",
      `${label} is defined in ${reachedPaths.length} places (${reachedPaths.join(", ")}); refusing to pick`,
    );
  }

  if (chosen.sameScope) {
    return { ok: true, tier: 2, identifier: chosen.hit.name, path: chosen.defPath, importLine: "", sameScope: true };
  }
  if (chosen.row === undefined) {
    const lang = typeof languageId === "string" && languageId !== "" ? languageId : "this language";
    return refuse(
      "no-import-path",
      `${label} is defined in ${chosen.defPath} but no ${lang} import path can be derived`,
    );
  }
  return {
    ok: true,
    tier: 2,
    identifier: chosen.hit.name,
    path: chosen.defPath,
    importLine: chosen.row.importLine,
    ...(chosen.row.qualifier === undefined ? {} : { qualifier: chosen.row.qualifier }),
  };
}
