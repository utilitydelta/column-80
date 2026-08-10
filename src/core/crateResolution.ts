/**
 * Assemble a CrateResolution (the catalog + cfg-scan context the E0433
 * disambiguation needs) from `cargo metadata` plus the crates' own on-disk
 * lib.rs. Pure over the parsed metadata and an injected lib.rs reader: the
 * `cargo metadata` spawn and the real filesystem read live in the vscode layer,
 * so this is blind-testable headless and the reader keeps the offline invariant
 * explicit (it only ever reads local registry source, never the network).
 * Implements the CrateResolution interface compilerDirected.ts declares.
 */

import { CrateResolution } from "./compilerDirected";
import { buildGatingFeatures } from "./cfgScan";
import { buildCatalog } from "./catalog";

interface ResPackage {
  name: string;
  id: string;
  manifest_path?: string;
  features?: Record<string, string[]>;
}
interface ResDep {
  name: string;
  pkg: string;
  dep_kinds?: Array<{ kind?: string | null }>;
}
interface ResNode {
  id: string;
  deps?: ResDep[];
}
export interface ResolutionMetadata {
  packages?: ResPackage[];
  workspace_members?: string[];
  resolve?: { nodes?: ResNode[] };
}

// The crate's lib.rs sits beside its Cargo.toml. Kept string-only so core needs
// no `path` import; handles both separators.
function libRsPathFor(manifestPath: string): string {
  const idx = Math.max(manifestPath.lastIndexOf("/"), manifestPath.lastIndexOf("\\"));
  const dir = idx >= 0 ? manifestPath.slice(0, idx) : "";
  return `${dir}/src/lib.rs`;
}

/**
 * Build the CrateResolution from resolved metadata and a lib.rs reader.
 * `isInstalledCrate` is the set of import names the user can actually path into
 * (buildCatalog: enabled direct deps, incl. enabled-optional). `gatingFeature`
 * lazily reads a crate's lib.rs and runs the cfg-scan, cached per crate. The
 * reader returns undefined when the file is absent (a crate whose lib is not at
 * the conventional path); that degrades to "no gate known", never a throw.
 */
export function buildResolution(
  metadata: ResolutionMetadata,
  readLibRs: (libRsPath: string) => string | undefined,
): CrateResolution {
  const installed = new Set(buildCatalog(metadata).map((e) => e.name));
  const pkgById = new Map<string, ResPackage>();
  for (const p of metadata.packages ?? []) {
    pkgById.set(p.id, p);
  }
  // import name (as written in code) -> resolved package id, from the members'
  // resolve nodes: dep.name is the extern name (`md5`), dep.pkg the id.
  const members = new Set(metadata.workspace_members ?? []);
  const importToPkgId = new Map<string, string>();
  for (const n of metadata.resolve?.nodes ?? []) {
    if (!members.has(n.id)) {
      continue;
    }
    for (const d of n.deps ?? []) {
      const normal = (d.dep_kinds ?? []).some((k) => (k.kind ?? null) === null);
      if (normal) {
        importToPkgId.set(d.name, d.pkg);
      }
    }
  }

  const gateCache = new Map<string, Map<string, string>>();
  const gatingFor = (crate: string): Map<string, string> => {
    const cached = gateCache.get(crate);
    if (cached !== undefined) {
      return cached;
    }
    let map = new Map<string, string>();
    const pkgId = importToPkgId.get(crate);
    const pkg = pkgId !== undefined ? pkgById.get(pkgId) : undefined;
    if (pkg?.manifest_path) {
      const src = readLibRs(libRsPathFor(pkg.manifest_path));
      if (src !== undefined) {
        map = buildGatingFeatures(src, pkg.features ?? {});
      }
    }
    gateCache.set(crate, map);
    return map;
  };

  return {
    isInstalledCrate: (c) => installed.has(c),
    // installed-first mirrors the classifier's installed-before-gate guard:
    // never name a feature on a crate the user has not installed.
    gatingFeature: (c, mod) => (installed.has(c) ? gatingFor(c).get(mod) : undefined),
  };
}
