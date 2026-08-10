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

/**
 * The Rust `use` path for a type defined in `defFilePath`, as referenced from
 * `targetFilePath`. Same crate → `crate::a::b`; another crate → `crate_name::a::b`.
 * `lib.rs`/`main.rs` → the crate root (`crate` / `crate_name`); `foo/mod.rs` →
 * `…::foo`. undefined is the honest degrade — no import hint beats a wrong one —
 * when a crate root is missing, the def file is not under `src/`, or a cross-crate
 * name cannot be read.
 */
export function deriveUsePath(
  defFilePath: string,
  targetFilePath: string,
  deps: UsePathDeps,
): string | undefined {
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

  let prefix: string;
  if (path.resolve(defRoot) === path.resolve(targetRoot)) {
    prefix = "crate";
  } else {
    const name = crateName(path.join(defRoot, "Cargo.toml"), deps.readFile);
    if (!name) {
      return undefined;
    }
    prefix = name;
  }
  return [prefix, ...segs].join("::");
}

/**
 * Render the `use` lines that import a set of resolved collaborator types,
 * grouped by module path (one `use path::{A, B};` per module), paths and names
 * sorted for a deterministic prompt. A type whose path cannot be derived is
 * skipped — the honest degrade, never a guessed import. undefined when nothing
 * resolvable remains.
 */
export function renderImportHint(
  types: Array<{ name: string; defPath: string }>,
  targetFilePath: string,
  deps: UsePathDeps,
): string | undefined {
  const byPath = new Map<string, Set<string>>();
  for (const t of types) {
    const usePath = deriveUsePath(t.defPath, targetFilePath, deps);
    if (!usePath) {
      continue;
    }
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
