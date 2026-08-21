/**
 * Rust reachability: given the module chain a FILE TREE walk produced, decide
 * whether Rust's MODULE TREE actually lets a name be reached that way, and
 * rewrite the chain to the `pub use` re-export when it does not.
 *
 * This is one mechanism with two callers, and it lives here so it stays one.
 *
 *  - `tightenRatify`'s `rustImport` derives the import line a tier-2
 *    ratification carries. Precision is its ship condition, so it asks with
 *    `unproven: "refuse"`.
 *  - `usePath`'s `renderImportHint` derives the fn-gen pre-fill's "Import these
 *    collaborators" block. It asks with `unproven: "keep"` (see `UnprovenPolicy`).
 *
 * The measurement that motivates it, from the corpus runs recorded on the
 * gesture side: 110 of 249 derived `use` lines compiled on glommio and 136 of
 * the failures were E0603 module-is-private; on the real rustup sysroot, 15 of
 * 53 derived stdlib lines compile and 35 of the 38 failures are E0603. All one
 * cause: the file tree says `std/src/io/buffered/bufreader.rs` and the module
 * tree says `std::io::BufReader`.
 *
 * Pure and headless: every filesystem touch goes through `RustReachDeps`, so
 * this is unit-tested against synthetic layouts with no crate on disk.
 */

import * as path from "path";

/** The injected filesystem. Structurally what `UsePathDeps` already is, so the
 *  hint's caller passes its own deps straight through. */
export interface RustReachDeps {
  fileExists(p: string): boolean;
  readFile(p: string): string | undefined;
}

/**
 * What "reachability could not be established" means to the caller, and it is
 * NOT one thing. There are two ways a walk ends without a proof:
 *
 *  - DISPROVEN OR AMBIGUOUS: readable source says the module is private and
 *    carries no re-export for this name, or re-exports a different name, or the
 *    type itself is not `pub`. The path is known wrong, or known unknowable.
 *    BOTH policies refuse it. A wrong import is worse than no import.
 *  - NOTHING WAS READ: no `lib.rs`, no `mod` declaration file, an unreadable
 *    def file. The module tree was never in evidence at all.
 *
 * Only the second is a policy question, because "no evidence" is the ordinary
 * case for the pre-fill hint: the same-crate hint the product renders every day
 * (`use crate::orders::Order;`) is derived from a `Cargo.toml` and a file path,
 * with no crate source read. Refusing on absence would delete every one of
 * those. So `refuse` is for the ratification path, which is allowed to be
 * silent, and `keep` returns the file-tree chain unchanged, which is exactly
 * today's render.
 */
export type UnprovenPolicy = "refuse" | "keep";

export interface RustReachQuery {
  /** The type being imported. Its own `pub` is checked, and a re-export only
   *  counts when it carries THIS name. */
  typeName: string;
  /** The file that declares the type. */
  defPath: string;
  /** The directory holding the def crate's `Cargo.toml`. */
  defCrateRoot: string;
  /** True when the target file and the def live in the same crate: `pub(crate)`
   *  is reachable then and not otherwise. */
  sameCrate: boolean;
  /** The module chain below the crate prefix, as the file-tree walk derived it. */
  segments: readonly string[];
  unproven: UnprovenPolicy;
}

/** Backslashes to forward slashes: everything below joins with `path.posix`,
 *  and Node's fs takes forward slashes on Windows too. */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** The module file that DECLARES the children of a module: `src/lib.rs` for the
 *  crate root, then `<dir>/<seg>.rs` or `<dir>/<seg>/mod.rs` going down. */
function moduleFileFor(srcRoot: string, segs: readonly string[], d: RustReachDeps): string | undefined {
  let dir = srcRoot;
  let file = [path.posix.join(srcRoot, "lib.rs"), path.posix.join(srcRoot, "main.rs")].find((f) => d.fileExists(f));
  for (const seg of segs) {
    if (file === undefined) {
      return undefined;
    }
    const flat = path.posix.join(dir, `${seg}.rs`);
    const folded = path.posix.join(dir, seg, "mod.rs");
    if (d.fileExists(folded)) {
      dir = path.posix.join(dir, seg);
      file = folded;
    } else if (d.fileExists(flat)) {
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
 * The module chain a `use` line should actually name, or undefined to refuse.
 *
 * The chain is walked one `mod` declaration at a time from the crate root down.
 * A segment that is `pub` (or `pub(crate)` from inside the same crate) is kept.
 * A private one sends the walk looking for the re-export that publishes the
 * name here: when it finds one, the segments SO FAR are the whole path and the
 * rest of the file chain is not part of the module path at all - `DeadlineQueue`
 * lives in a private `mod deadline_queue;` and is nameable only at
 * `crate::controllers::`.
 */
export function reachableSegments(q: RustReachQuery, deps: RustReachDeps): readonly string[] | undefined {
  const refuse = q.unproven === "refuse";
  const srcRoot = path.posix.join(toPosix(q.defCrateRoot), "src");

  // Only Rust source is evidence about Rust's module tree. `deriveUsePath` is
  // not language-gated - it derives a `use` path for any file under a crate's
  // `src/`, which is how a `.go` or `.ts` collaborator inside a cargo tree gets
  // one - and running the visibility parser over that file is a category error:
  // Go's `type KeyConfig struct` reads as a non-`pub` Rust type alias and would
  // silently withhold a non-Rust hint that renders today (contract clause 4).
  const defText = /\.rs$/.test(q.defPath) ? deps.readFile(toPosix(q.defPath)) : undefined;
  if (defText === undefined) {
    return refuse ? undefined : q.segments; // nothing read: not a disproof
  }
  const typeVis = typeVisibility(defText, q.typeName);
  if (typeVis === "private" || typeVis === "conditional" || (typeVis === "crate" && !q.sameCrate)) {
    return undefined; // readable source disproves it, so no policy rescues it
  }

  const visible: string[] = [];
  for (let i = 0; i < q.segments.length; i++) {
    const parent = moduleFileFor(srcRoot, q.segments.slice(0, i), deps);
    const parentText = parent === undefined ? undefined : deps.readFile(parent);
    if (parentText === undefined) {
      return refuse ? undefined : q.segments; // the module tree is not in evidence
    }
    const vis = modVisibility(parentText, q.segments[i]);
    if (vis === "public" || (vis === "crate" && q.sameCrate)) {
      visible.push(q.segments[i]);
      continue;
    }
    if (vis !== undefined && reExports(parentText, q.segments[i], q.typeName, q.sameCrate, q.segments.slice(0, i))) {
      return visible; // published HERE; the rest of the file chain is not a module path
    }
    if (vis === undefined) {
      // The `mod` is not in the readable source at all: a `#[path]` attribute, a
      // cfg-gated tree, a macro-declared module. That is absence of evidence and
      // not a private declaration, so the policy decides.
      return refuse ? undefined : q.segments;
    }
    return undefined; // private (or crate-from-outside) with no re-export: E0603
  }
  return visible;
}
