/**
 * cfg-gate source scan: recover which Cargo feature gates a crate's top-level
 * module, offline, from the crate's own lib.rs. Feeds the classifier's E0433
 * disambiguation (needs-a-feature vs invented item). A light regex pass, not a
 * `syn` reader: `#[cfg(feature = "TOKEN")] mod NAME` at the top level is the
 * shape that matters, and the marquee cloud modules (aws/azure/gcp/http) all
 * sit there. The literal gate token is often internal (`aws-base`); the
 * metadata reverse-closure resolves it to the public feature (`aws`) a user
 * enables.
 *
 * Pure and offline: strings in, maps out. The lib.rs disk read and the
 * `cargo metadata` spawn live in the vscode/oracle layer, never here.
 */

// A code line, as opposed to a comment. cfg patterns embedded in `//!` doc
// examples (object_store's lib.rs has 65 of them) are decoys, never gates.
function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

// The char ranges spanned by each top-level `not( ... )` in a cfg string, so a
// `feature = "X"` inside a negation is not read as positively required. Paren
// balance from each `not(` to its close; nesting is handled by depth.
function notRanges(cfg: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /\bnot\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cfg)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1; // at the opening paren
    for (; i < cfg.length; i++) {
      if (cfg[i] === "(") {
        depth++;
      } else if (cfg[i] === ")") {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}

// The first positively-required feature token in a cfg predicate string, or
// undefined when there is none (no feature at all, or only negated features).
function positiveFeatureToken(cfg: string): string | undefined {
  const negated = notRanges(cfg);
  const inside = (idx: number) => negated.some(([a, b]) => idx >= a && idx <= b);
  const re = /feature\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cfg)) !== null) {
    if (!inside(m.index)) {
      return m[1];
    }
  }
  return undefined;
}

const MOD_RE = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*[;{]/;

/**
 * Scan Rust source for top-level `#[cfg(feature = "TOKEN")]` gates on `mod`
 * declarations. Returns `module name -> gate TOKEN` (the literal feature on the
 * cfg, often an internal token like `aws-base`). Comment/doc lines are ignored;
 * an ungated `mod` is absent; a `not(feature=...)` gate records nothing. Never
 * throws: unparseable input yields an empty map.
 */
export function scanCfgGates(libRsSource: string): Map<string, string> {
  const gates = new Map<string, string>();
  const lines = libRsSource.split("\n");
  // The token from the most recent cfg attribute, still waiting for the mod it
  // gates. Cleared when a non-attribute, non-mod code line intervenes (the cfg
  // gated something else - a fn, a use, a struct).
  let pendingToken: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || isCommentLine(trimmed)) {
      continue; // blank and comment lines never gate and never break a pending gate
    }

    // `#[cfg(` gates presence; `#[cfg_attr(` only conditionally applies ANOTHER
    // attribute (the mod is always present), so it is NOT a gate - fall through
    // to the generic-attribute skip below.
    if (/^#\[cfg\s*\(/.test(trimmed)) {
      // Accumulate the (possibly multi-line) attribute until its brackets close.
      let attr = trimmed;
      let depth = bracketDelta(trimmed);
      let j = i;
      while (depth > 0 && j + 1 < lines.length) {
        j++;
        attr += " " + lines[j].trim();
        depth += bracketDelta(lines[j]);
      }
      i = j;
      const token = positiveFeatureToken(attr);
      // A positive feature arms the gate. A cfg with none (a stacked
      // `#[cfg(target_arch)]`, a `not(feature)`, a `test`) does NOT clear an
      // already-pending feature token: rustc stacks `#[cfg]` attributes with AND
      // semantics, so `#[cfg(feature="x")] #[cfg(target_arch="y")] mod m` still
      // gates m on feature x. Only a real non-attribute code line (below) clears
      // a pending gate.
      if (token !== undefined) {
        pendingToken = token;
      }
      continue;
    }

    if (trimmed.startsWith("#[") || trimmed.startsWith("#!")) {
      continue; // a non-cfg attribute (#[doc], #[allow]) between the cfg and the mod
    }

    const modMatch = MOD_RE.exec(lines[i]);
    if (modMatch) {
      if (pendingToken !== undefined) {
        gates.set(modMatch[1], pendingToken);
      }
      pendingToken = undefined;
      continue;
    }

    // Any other code line breaks a pending gate: the cfg gated this, not a mod.
    pendingToken = undefined;
  }
  return gates;
}

// Net change in unclosed `[`/`(` on a line, for accumulating a multi-line attr.
function bracketDelta(line: string): number {
  let d = 0;
  for (const ch of line) {
    if (ch === "[" || ch === "(") {
      d++;
    } else if (ch === "]" || ch === ")") {
      d--;
    }
  }
  return d;
}

// An internal, not-user-facing feature by naming convention: the `__` prefix
// (Cargo's hidden-feature convention), the `-base`/`_base` intermediate-feature
// convention (object_store), and the internal/unstable/private/hidden/sealed/
// bench and rustc- markers real crates use. Telling a user to enable one of
// these is wrong steering; the resolver climbs past them to a public ancestor
// or stays silent. Deliberately conservative: a false "internal" only makes the
// resolver climb one more edge or return undefined (no steer), never a wrong one.
function isInternalFeature(name: string): boolean {
  return (
    name.startsWith("__") ||
    name.endsWith("-base") ||
    name.endsWith("_base") ||
    /(?:^|[-_])(?:internal|unstable|private|hidden|sealed|bench)(?:$|[-_])/i.test(name) ||
    /^rustc[-_]/i.test(name)
  );
}

/**
 * Resolve a gate TOKEN to the PUBLIC feature a user enables to turn it on, from
 * the crate's metadata feature map (`feature -> the features/deps it enables`).
 * A non-internal token is the user-facing knob itself. An internal token is
 * climbed: walk parent edges up to the NEAREST non-internal ancestor(s) - the
 * public knobs that pull the internal token in. Fails SAFE: undefined when the
 * token is absent from the graph, or when no public feature reaches it (better
 * no steer than "enable feature `__tls`").
 */
export function resolvePublicFeature(
  features: Record<string, string[]>,
  gateToken: string,
  moduleName: string,
): string | undefined {
  const isKey = Object.prototype.hasOwnProperty.call(features, gateToken);
  const referenced = Object.values(features).some((list) => list.includes(gateToken));
  if (!isKey && !referenced) {
    return undefined;
  }
  if (!isInternalFeature(gateToken)) {
    return gateToken; // the user enables this feature directly
  }
  // Climb: the parents of g are the features that enable it. Keep walking THROUGH
  // internal parents; the first non-internal ancestor on each path is a public
  // knob and stops that path. `default` is not a user-named feature -> excluded.
  const parentsOf = (g: string) => Object.keys(features).filter((f) => features[f].includes(g));
  const publicRoots = new Set<string>();
  const seen = new Set<string>();
  const stack = [gateToken];
  while (stack.length > 0) {
    const g = stack.pop() as string;
    if (seen.has(g)) {
      continue;
    }
    seen.add(g);
    for (const p of parentsOf(g)) {
      if (p === g) {
        continue;
      }
      if (isInternalFeature(p)) {
        stack.push(p);
      } else if (p !== "default") {
        publicRoots.add(p);
      }
    }
  }
  const candidates = [...publicRoots];
  if (candidates.length === 0) {
    return undefined; // no public feature reaches this internal token: no steer
  }
  if (candidates.includes(moduleName)) {
    return moduleName;
  }
  return candidates.sort()[0];
}

/**
 * Compose the scan and the reverse-closure: `module -> public feature` for one
 * crate, from its lib.rs source and its metadata feature map. This backs
 * `CrateResolution.gatingFeature(crate, module)`.
 */
export function buildGatingFeatures(
  libRsSource: string,
  features: Record<string, string[]>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [module, token] of scanCfgGates(libRsSource)) {
    const feature = resolvePublicFeature(features, token, module);
    if (feature !== undefined) {
      out.set(module, feature);
    }
  }
  return out;
}
