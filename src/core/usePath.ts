/**
 * Derive the Rust `use` path for a resolved collaborator type, so the
 * blind test author imports it from where it ACTUALLY lives instead of guessing
 * `crate::` root. The cross-file resolver already knows each type's definition
 * URI (it opened that file to read the fields); this turns that URI into the
 * import path the model copies.
 *
 * Pure and headless: filesystem access is injected, so the derivation is unit-
 * tested against synthetic layouts with no real crate on disk.
 */

import * as path from "path";
import { reachableSegments } from "./rustReach";

export interface UsePathDeps {
  /** True when a file exists at `p` (used to find the nearest Cargo.toml). */
  fileExists(p: string): boolean;
  /** The file's text, or undefined when unreadable (used to read a crate name). */
  readFile(p: string): string | undefined;
}

// Nearest ancestor directory (starting at the file's own dir) that holds a
// Cargo.toml — the crate root. undefined when none is found up to the fs root.
function crateRootOf(filePath: string, fileExists: (p: string) => boolean): string | undefined {
  let dir = path.dirname(filePath);
  for (;;) {
    if (fileExists(path.join(dir, "Cargo.toml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

// The `[package].name` from a Cargo.toml, hyphens normalized to underscores (the
// identifier form a `use` path needs). undefined when unreadable or nameless. The
// scan is section-aware so a dependency's `name` is never mistaken for the crate's.
function crateName(cargoTomlPath: string, readFile: (p: string) => string | undefined): string | undefined {
  const text = readFile(cargoTomlPath);
  if (text === undefined) {
    return undefined;
  }
  let inPackage = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const section = /^\[([^\]]+)\]/.exec(line);
    if (section) {
      inPackage = section[1].trim() === "package";
      continue;
    }
    if (inPackage) {
      const m = /^name\s*=\s*"([^"]+)"/.exec(line);
      if (m) {
        return m[1].replace(/-/g, "_");
      }
    }
  }
  return undefined;
}

/** A derived path before it is joined: the crate prefix, the module chain under
 *  it, and the two facts the reachability walk needs about the def crate. */
interface DerivedPath {
  prefix: string;
  segs: string[];
  defRoot: string;
  sameCrate: boolean;
}

// The file-tree derivation. `deriveUsePath` joins it; `renderImportHint` runs
// the module-tree walk over it first.
function derive(defFilePath: string, targetFilePath: string, deps: UsePathDeps): DerivedPath | undefined {
  const defRoot = crateRootOf(defFilePath, deps.fileExists);
  const targetRoot = crateRootOf(targetFilePath, deps.fileExists);
  if (!defRoot || !targetRoot) {
    return undefined;
  }

  const srcRoot = path.join(defRoot, "src");
  const rel = path.relative(srcRoot, defFilePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return undefined; // not under the crate's src/ — no module path to derive
  }

  const noExt = rel.replace(/\.rs$/, "");
  let segs = noExt.split(/[\\/]/).filter((s) => s.length > 0);
  if (segs.length === 1 && (segs[0] === "lib" || segs[0] === "main")) {
    segs = []; // crate-root file — the type is at the crate root
  } else if (segs.length > 0 && segs[segs.length - 1] === "mod") {
    segs = segs.slice(0, -1); // foo/mod.rs is module `foo`, not `foo::mod`
  }

  const sameCrate = path.resolve(defRoot) === path.resolve(targetRoot);
  if (sameCrate) {
    return { prefix: "crate", segs, defRoot, sameCrate };
  }
  const name = crateName(path.join(defRoot, "Cargo.toml"), deps.readFile);
  if (!name) {
    return undefined;
  }
  return { prefix: name, segs, defRoot, sameCrate };
}

/**
 * The Rust `use` path for a type defined in `defFilePath`, as referenced from
 * `targetFilePath`. Same crate → `crate::a::b`; another crate → `crate_name::a::b`.
 * `lib.rs`/`main.rs` → the crate root (`crate` / `crate_name`); `foo/mod.rs` →
 * `…::foo`. undefined is the honest degrade — no import hint beats a wrong one —
 * when a crate root is missing, the def file is not under `src/`, or a cross-crate
 * name cannot be read.
 *
 * This is the FILE-TREE path and stays that way: it takes no type name, so it
 * cannot ask a re-export question, and `tightenRatify`'s import row depends on
 * its shape. The module-tree correction lives one level up, in
 * `renderImportHint`.
 */
export function deriveUsePath(
  defFilePath: string,
  targetFilePath: string,
  deps: UsePathDeps,
): string | undefined {
  const d = derive(defFilePath, targetFilePath, deps);
  return d === undefined ? undefined : [d.prefix, ...d.segs].join("::");
}

/**
 * Render the `use` lines that import a set of resolved collaborator types,
 * grouped by module path (one `use path::{A, B};` per module), paths and names
 * sorted for a deterministic prompt. A type whose path cannot be derived is
 * skipped — the honest degrade, never a guessed import. undefined when nothing
 * resolvable remains.
 *
 * The file-tree path is corrected by `rustReach.reachableSegments` before it is
 * rendered (roadmap item 56): measured against real `rustc`, 35 of the 38
 * failing derived stdlib lines were E0603 module-is-private, printed under a
 * header that says the imports are already defined. The walk is the SAME one
 * the Tighten gesture's import row uses, asked with a different policy for the
 * unproven case — see `UnprovenPolicy`, and the note at the call below.
 */
export function renderImportHint(
  types: Array<{ name: string; defPath: string }>,
  targetFilePath: string,
  deps: UsePathDeps,
): string | undefined {
  const byPath = new Map<string, Set<string>>();
  for (const t of types) {
    const d = derive(t.defPath, targetFilePath, deps);
    if (d === undefined) {
      continue;
    }
    // THE REFUSAL DECISION, and the subtle part of it is what "cannot be proven"
    // means. It means DISPROVEN OR AMBIGUOUS — a private `mod` read out of real
    // source with no re-export for this name, or a re-export naming a different
    // type — and NOT "no evidence was read". Absence of evidence keeps today's
    // render, which is why the policy is `keep`: the ordinary same-crate hint
    // (`use crate::orders::Order;`) is derived from a `Cargo.toml` and a file
    // path with no crate source read at all, and a literal prove-it-or-refuse-it
    // reading would withhold every one of them. The ratification row, which is
    // allowed to say nothing, asks the same walk with `refuse`.
    const segs = reachableSegments(
      {
        typeName: t.name,
        defPath: t.defPath,
        defCrateRoot: d.defRoot,
        sameCrate: d.sameCrate,
        segments: d.segs,
        unproven: "keep",
      },
      deps,
    );
    if (segs === undefined) {
      continue;
    }
    const usePath = [d.prefix, ...segs].join("::");
    let names = byPath.get(usePath);
    if (!names) {
      names = new Set<string>();
      byPath.set(usePath, names);
    }
    names.add(t.name);
  }
  if (byPath.size === 0) {
    return undefined;
  }
  const lines = [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([usePath, names]) => {
      const sorted = [...names].sort();
      return sorted.length === 1 ? `use ${usePath}::${sorted[0]};` : `use ${usePath}::{${sorted.join(", ")}};`;
    });
  return lines.join("\n");
}
