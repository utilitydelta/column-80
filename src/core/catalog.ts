/**
 * Dependency capability-catalog: the crates a project actually has installed,
 * each with a one-line purpose, so an unresolved-crate hallucination can be
 * steered to an installed crate instead of an invented one.
 * Injected ONLY on an unresolved-crate error - a blanket "use only these" prompt
 * backfires on tasks that need no dependency. Pure over `cargo
 * metadata` JSON; the spawn and caching live in the layer that runs cargo.
 */

import { spawn } from "child_process";
import { statSync } from "fs";
import { join } from "path";
import { CheckCommand, RunCommandFn } from "./compilerOracle";

export interface CatalogEntry {
  name: string;
  /** One line, the crate's own Cargo.toml description; absent when it has none. */
  description?: string;
}

interface MetadataDependency {
  name: string;
  /** The name the dependency is imported as when renamed in Cargo.toml
   *  (`foo = { package = "bar" }`); the code uses THIS, not `name`. */
  rename?: string | null;
  kind?: string | null;
  optional?: boolean;
}
interface MetadataPackage {
  name: string;
  id: string;
  description?: string | null;
  dependencies?: MetadataDependency[];
}
/** One resolved edge in `resolve.nodes[].deps`: the RESOLVED dep after the
 *  active feature set and platform filter. `name` is the extern-crate name used
 *  in code (`md5`); `pkg` is the resolved package-id (contains the package name
 *  `md-5`). They differ, which is why the match is by package-id, not name. */
interface ResolveDep {
  name: string;
  pkg: string;
  dep_kinds?: Array<{ kind?: string | null }>;
}
interface ResolveNode {
  id: string;
  deps?: ResolveDep[];
}
interface CargoResolve {
  nodes?: ResolveNode[];
}
interface CargoMetadata {
  packages?: MetadataPackage[];
  workspace_members?: string[];
  /** Present with `--format-version 1`; the feature/platform-resolved graph. */
  resolve?: CargoResolve;
}

// One line of purpose: the first sentence, capped so the catalog stays compact.
function oneLine(description: string | null | undefined): string | undefined {
  if (!description) {
    return undefined;
  }
  const collapsed = description.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return undefined;
  }
  const sentenceEnd = collapsed.indexOf(". ");
  const sentence = sentenceEnd >= 0 ? collapsed.slice(0, sentenceEnd + 1) : collapsed;
  return sentence.length > 100 ? sentence.slice(0, 99).trimEnd() + "…" : sentence;
}

/** The installed direct dependencies of the workspace's own crates, with their
 *  descriptions. Excludes dev- and build-dependencies (not usable in the code
 *  under generation); optional deps are included only when the resolved graph
 *  shows them enabled. Sorted by name for determinism. */
export function buildCatalog(metadata: CargoMetadata): CatalogEntry[] {
  const packages = metadata.packages ?? [];
  const members = new Set(metadata.workspace_members ?? []);
  const descByName = new Map<string, string | null | undefined>();
  const descById = new Map<string, string | null | undefined>();
  const pkgNameById = new Map<string, string>();
  for (const p of packages) {
    descByName.set(p.name, p.description);
    descById.set(p.id, p.description);
    pkgNameById.set(p.id, p.name);
  }
  const nodeById = new Map<string, ResolveNode>();
  for (const n of metadata.resolve?.nodes ?? []) {
    nodeById.set(n.id, n);
  }

  // import name -> description. A Map dedupes and preserves the last write.
  const entries = new Map<string, string | null | undefined>();

  for (const p of packages) {
    if (!members.has(p.id)) {
      continue; // only the project's own crates, not the resolved dep graph
    }

    // Normal (non-optional) direct deps: unchanged. The importable name is the
    // rename when present; the description comes from the real package.
    const optionalPkgNames = new Set<string>();
    for (const dep of p.dependencies ?? []) {
      const kind = dep.kind ?? null; // null = a normal dependency; "dev"/"build" are not
      if (kind !== null) {
        continue;
      }
      if (dep.optional) {
        optionalPkgNames.add(dep.name); // the package name; matched against the resolved id
      } else {
        entries.set(dep.rename ?? dep.name, descByName.get(dep.name));
      }
    }

    // Enabled-optional deps: an optional manifest dep is compiled iff its
    // resolved package-id is a normal edge in the member's resolve node. Match by
    // the package NAME embedded in the resolved id (NOT the extern-crate name:
    // package `md-5` has extern name `md5`), and list it by its IMPORT name (the
    // resolve dep's `name`). No resolve node -> no optionals (backward compat).
    const node = nodeById.get(p.id);
    if (node === undefined) {
      continue;
    }
    for (const nd of node.deps ?? []) {
      const isNormal = (nd.dep_kinds ?? []).some((k) => (k.kind ?? null) === null);
      if (!isNormal) {
        continue; // a dep pulled in only as a dev/build dep is not usable in the code
      }
      const pkgName = pkgNameById.get(nd.pkg);
      if (pkgName === undefined || !optionalPkgNames.has(pkgName)) {
        continue; // not one of this member's optional deps
      }
      entries.set(nd.name, descById.get(nd.pkg));
    }
  }

  return [...entries.keys()]
    .sort()
    .map((importName) => {
      const entry: CatalogEntry = { name: importName };
      const desc = oneLine(entries.get(importName));
      if (desc !== undefined) {
        entry.description = desc;
      }
      return entry;
    });
}

// The real spawn behind the injectable seam, mirroring the compiler oracle's:
// stdout collected, stderr drained, never throws (a metadata failure is an
// empty catalog, not a crash).
const spawnRun: RunCommandFn = (cmd: CheckCommand) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, exitCode: code ?? -1 }));
  });

/** The host target triple (`x86_64-unknown-linux-gnu`) from `rustc -vV`, or
 *  undefined when it cannot be read. Used to scope `cargo metadata` to the host
 *  platform so offline resolution does not drag in other-platform deps that were
 *  never fetched (and would make the run fail or report phantom deps). Never
 *  throws. */
export async function resolveHostTriple(
  runCommand: RunCommandFn = spawnRun,
): Promise<string | undefined> {
  try {
    const result = await runCommand({ command: "rustc", args: ["-vV"], cwd: process.cwd() });
    if (result.exitCode !== 0) {
      return undefined;
    }
    const m = /^host:\s*(\S+)/m.exec(result.stdout);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

/** Run `cargo metadata` in the crate root and build the catalog. Off the
 *  interactive path (only on an unresolved-crate error), so the metadata cost is
 *  fine. When a host triple is given, scope resolution to it with
 *  `--filter-platform` so offline resolution stays on the cached host graph and
 *  the enabled-optional set is not polluted by other-platform deps. Never
 *  throws: a failed or unparseable run yields an empty catalog, and the caller
 *  falls back to telling the human to add the crate. */
export async function fetchCatalog(
  crateRoot: string,
  runCommand: RunCommandFn = spawnRun,
  hostTriple?: string,
): Promise<CatalogEntry[]> {
  try {
    const args = ["metadata", "--format-version", "1"];
    if (hostTriple) {
      args.push("--filter-platform", hostTriple);
    }
    const result = await runCommand({ command: "cargo", args, cwd: crateRoot });
    if (result.exitCode !== 0) {
      return [];
    }
    return buildCatalog(JSON.parse(result.stdout));
  } catch {
    return [];
  }
}

/** Run `cargo metadata` and return the parsed JSON, host-scoped when a triple is
 *  given (same offline rationale as fetchCatalog). undefined on any failure -
 *  the caller degrades to no resolution, never throws. Shared by the catalog and
 *  the E0433 feature-graph resolution. */
export async function fetchMetadataJson(
  crateRoot: string,
  runCommand: RunCommandFn = spawnRun,
  hostTriple?: string,
): Promise<unknown | undefined> {
  try {
    const args = ["metadata", "--format-version", "1"];
    if (hostTriple) {
      args.push("--filter-platform", hostTriple);
    }
    const result = await runCommand({ command: "cargo", args, cwd: crateRoot });
    if (result.exitCode !== 0) {
      return undefined;
    }
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

/** A crate root's `Cargo.toml` identity: its size and mtime, or undefined when
 *  it cannot be read. Undefined is the honest degrade and it is load-bearing -
 *  a manifest this cannot stat is one whose staleness cannot be known, so the
 *  memo below refuses to cache rather than serving a catalog it cannot vouch
 *  for. Injectable because the memo's whole contract is about WHEN this changes,
 *  and a test that had to touch a real file to say so would be timing-coupled. */
export type ManifestStampFn = (crateRoot: string) => string | undefined;

const defaultManifestStamp: ManifestStampFn = (crateRoot) => {
  try {
    const st = statSync(join(crateRoot, "Cargo.toml"));
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return undefined;
  }
};

/** A catalog fetcher that resolves the host triple ONCE (memoized) and scopes
 *  every `cargo metadata` run to it with `--filter-platform`, so the enabled-
 *  optional set can never include a platform-pruned dep
 *  and offline resolution never reaches for uncached other-platform deps.
 *  This is what the product wires in; the raw `fetchCatalog(root)` seam without a
 *  triple is for tests. The triple resolution shares the
 *  injected runCommand so it is testable headless.
 *
 *  MEMOIZED PER CRATE ROOT. Before that, every unresolved-crate accept
 *  re-spawned `cargo metadata` for the same unchanged project - the catalog is
 *  steering payload for a hallucinated crate name, so a developer hitting that
 *  error twice in a row paid twice for an answer that could not have moved.
 *
 *  Invalidated on the MANIFEST, not on time: a stamp of `Cargo.toml`'s size and
 *  mtime is taken on every call, and a changed stamp re-spawns. That is the
 *  event that can change the answer, and a clock could not tell the two apart.
 *
 *  Two things it deliberately does not do. It caches the PROMISE, so two accepts
 *  racing the same cold root share one spawn rather than both starting one. And
 *  it does not cache an EMPTY result: `fetchCatalog` answers `[]` both for a
 *  project with no dependencies and for a `cargo metadata` that failed, and
 *  caching the second until the manifest changes would strand a transient
 *  failure for the rest of the session. A genuinely dependency-less project
 *  re-spawns, which costs nothing it was going to use. */
export function makeHostScopedCatalogFetcher(
  runCommand: RunCommandFn = spawnRun,
  manifestStamp: ManifestStampFn = defaultManifestStamp,
): (crateRoot: string) => Promise<CatalogEntry[]> {
  let triplePromise: Promise<string | undefined> | undefined;
  const memo = new Map<string, { stamp: string; entries: Promise<CatalogEntry[]> }>();
  return (crateRoot) => {
    if (triplePromise === undefined) {
      triplePromise = resolveHostTriple(runCommand);
    }
    const stamp = manifestStamp(crateRoot);
    const hit = stamp === undefined ? undefined : memo.get(crateRoot);
    if (hit !== undefined && hit.stamp === stamp) {
      return hit.entries;
    }
    const entries = triplePromise.then((triple) => fetchCatalog(crateRoot, runCommand, triple));
    if (stamp !== undefined) {
      memo.set(crateRoot, { stamp, entries });
      void entries.then(
        (list) => {
          if (list.length === 0 && memo.get(crateRoot)?.entries === entries) {
            memo.delete(crateRoot); // a failed or empty run is not an answer worth keeping
          }
        },
        () => {
          if (memo.get(crateRoot)?.entries === entries) {
            memo.delete(crateRoot);
          }
        },
      );
    }
    return entries;
  };
}

const FENCE = "```";

/** Render the catalog as an injection block: the installed crates and a firm
 *  instruction to re-pick from them. "" when the catalog is empty (the caller
 *  then falls back to telling the human to add the crate). */
export function renderCatalog(entries: CatalogEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  const lines = entries.map((e) => (e.description ? `${e.name}: ${e.description}` : e.name));
  return (
    "The crate you reached for is not a dependency of this project. These crates ARE installed - use the one whose purpose fits the task:\n" +
    `${FENCE}\n${lines.join("\n")}\n${FENCE}\n\n` +
    "Generate against one of the crates listed above. Do not use a crate that is not in this list."
  );
}
