/**
 * The compiler-directed loop's decision core: turn a rustc diagnostic into the
 * hallucination class it names, and render the resolved surface into the prompt
 * payload. Pure and headless; the vscode layer resolves the surface through the
 * extractor and drives the RepairSession loop with it.
 *
 * The compiler names the hallucination class, and the payload is the worked
 * example when the crate has one, signatures otherwise, never both.
 */

import { Diagnostic } from "./compilerOracle";
import { exampleNamesItsType } from "./extraction";

/** A position without a uri: the classifier knows WHERE in the buffer the
 *  offending identifier is, but not which uri the span resolves to. The
 *  orchestration adds the uri to make a full SourceCursor before it queries the
 *  extractor. */
export interface CursorPosition {
  line: number;
  character: number;
}

/** The type-INDEPENDENT half of the firm instruction: what holds however many
 *  types the payload describes. It closes every surface payload, so it is the
 *  literal suffix a caller can test for; the half in front of it names the types
 *  the constraint applies to and is rendered per payload by
 *  `firmInstructionFor`.
 *
 *  The permission clause is load-bearing, not politeness. In the capture a
 *  surface describing ONE type closed with an unqualified ban, and the correct
 *  body needed a field read, a metadata read and a sibling method that the ban
 *  forbade. The instruction could not be obeyed and satisfied at once, so the
 *  model split the difference and invented. */
export const FIRM_INSTRUCTION =
  "Do not invent methods beyond that surface. Everything else in the file is unaffected by this: calls on other values in scope, on the receiver's own fields, on sibling functions, and on standard-library types stay allowed. If a builder chain ends at a method returning the target type, that value IS the target; do not append any further call.";

/** The instruction closing an injected API surface, SCOPED to the types that
 *  surface actually describes.
 *
 *  The scope is whatever rendered, never "the receiver": a payload may carry no
 *  receiver at all (a static utility target gets none by rule, a mid-edit file
 *  whose symbol tree does not resolve gets none by honest degrade), and an
 *  instruction hard-coded to the receiver then names a type the model cannot
 *  see. An empty list is the honest degrade for a payload whose blocks carry no
 *  usable type name - it constrains the surface without naming anything. */
export function firmInstructionFor(types: readonly string[]): string {
  return `Call ONLY methods and constructors ${ofTypes(types, "that appear in the API surface above")}. ${FIRM_INSTRUCTION}`;
}

/** `of \`Alpha\` and \`Beta\` <tail>`, or the bare tail when nothing is named -
 *  the shared scoping clause for both instruction vocabularies. */
export function ofTypes(types: readonly string[], tail: string): string {
  if (types.length === 0) {
    return tail;
  }
  const quoted = types.map((t) => `\`${t}\``);
  const list =
    quoted.length === 1
      ? quoted[0]
      : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
  return `of ${list} ${tail}`;
}

/** What the compiler named. The cursor is at the offending identifier, so the
 *  extractor can resolve exactly that type/crate's surface. */
export type HallucinationClass =
  | { kind: "unresolved-method"; member: string; type: string; cursor: CursorPosition }
  | { kind: "unresolved-assoc"; member: string; type: string; cursor: CursorPosition }
  // suggestion: the compiler's own did-you-mean candidate when the message
  // carries one (TS2724). Rust classification never sets it.
  | { kind: "wrong-item"; crate: string; item: string; suggestion?: string; cursor: CursorPosition }
  | { kind: "unresolved-crate"; crate: string; cursor: CursorPosition }
  | { kind: "needs-feature"; crate: string; module: string; feature: string; cursor: CursorPosition }
  // An invented FIELD access - `E0609 no field \`X\` on
  // type \`Y\``. The receiver type Y is rustc-named ground truth, so the payload
  // is Y's DEPTH-1 struct def (its real fields) - NOT the recursive walk. Rides
  // the self-terminating repair machinery; the diagnostic bounds the payload.
  | { kind: "unresolved-field"; member: string; type: string; cursor: CursorPosition }
  // The offending item is defined in THIS file - the
  // model wrote `use somecrate::Local;` (or `somecrate::Local` inline) for a
  // same-file definition. Never inject the crate's surface (that amplifies the
  // hallucination into a deeper wrong type); steer the model to drop the import
  // and refer to the local name directly.
  | { kind: "local-symbol"; name: string; cursor: CursorPosition }
  // An operator applied to types that do not fit it - C# CS0019, `Operator '=='
  // cannot be applied to operands of type 'int' and 'LodBand'`. There is no
  // receiver at an operator site to resolve members at, so this class injects no
  // block of its own; it exists so the round stops reading class=none, and so
  // the operand types it names reach the span's types-in-play. Both operands are
  // compiler-named ground truth about what the span is working with, which is
  // exactly what the repair surface was missing when the model invented one.
  | { kind: "operand-mismatch"; types: string[]; cursor: CursorPosition }
  // A call with the wrong number of arguments - rustc E0061, CS7036, TS2554,
  // pyright's reportCallIssue, go's "not enough arguments in call to". Five for
  // five, this class read `none` before v30, which is the loudest gap the scout
  // found: an arity error is the shape a model produces when it can see a member
  // NAME and not its parameter list, and it is exactly the round that most needs
  // a surface.
  //
  // Like operand-mismatch it resolves no block of its own. What it carries is
  // what the compiler already said, and only ONE language says anything useful:
  // C# quotes the whole qualified member (`'Cursor.ToManifest(Cursor?, long,
  // long)'`), so the receiver is free. Rust, TypeScript and pyright name no type
  // at all, and Go's `want` list is the parameter list rather than a signature,
  // so its receiver is not in the message either. Those four resolve the
  // receiver through session-v30 item 1's disclosure leg.
  | { kind: "arity-mismatch"; member: string; type?: string; cursor: CursorPosition };

/** The catalog + cfg-scan context that turns an E0433 `cannot find X in Y` from
 *  ambiguous into one of three fates. Injected, not read here: this module is
 *  pure and offline, and the catalog and cfg-scan are the
 *  sources. Absent means the loop has not resolved the project yet, so the
 *  ambiguous E0433 stays undefined rather than guessing. */
export interface CrateResolution {
  /** Is `crate` an installed dependency of the project (incl. enabled-optional)? */
  isInstalledCrate(crate: string): boolean;
  /** For an installed crate, the PUBLIC feature that cfg-gates top-level module
   *  `mod`, or undefined when `mod` is not a feature-gated module of it. The
   *  cfg-scan resolves the internal gate token to the public feature. */
  gatingFeature(crate: string, mod: string): string | undefined;
}

// The wrappers a receiver type is worth reduced THROUGH. rustc names the type it
// resolved, and for a field access behind a smart pointer that is the pointer:
// the live capture reported `Ref<'_, Rc<LogSegmentFile>>` and the field leg went
// looking for the shape of `Ref` and found nothing.
//
// A bounded list rather than "strip any generic", because `HashMap<K, V>` is not
// a wrapper and its shape is not `V`'s. Everything here is a std container whose
// single type argument IS the thing the field was read on.
//
// Size it honestly: unwrapping buys the type whose FIELD was missed, never the
// type whose METHOD is being called (the scout measured three for three). It
// makes the field leg resolvable; it does not fix the session's capture.
const SMART_POINTERS = new Set([
  "Ref", "RefMut", "RefCell", "Rc", "Arc", "Box", "Cell", "MutexGuard",
  "RwLockReadGuard", "RwLockWriteGuard", "Pin", "Option",
]);

/** Split a generic argument list on TOP-LEVEL commas, so a nested type's own
 *  commas (`HashMap<u32, Vec<u64>>`) do not split it. */
function splitGenericArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "<" || c === "(" || c === "[") {
      depth++;
    } else if (c === ">" || c === ")" || c === "]") {
      depth--;
    } else if (c === "," && depth === 0) {
      out.push(args.slice(start, i));
      start = i + 1;
    }
  }
  out.push(args.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Reduce a receiver spelling through the smart pointers wrapping it.
 *  `Ref<'_, Rc<LogSegmentFile>>` becomes `LogSegmentFile`; `HashMap<K, V>` and
 *  `Boxed<Shard>` are left exactly as they came. Lifetime arguments are skipped,
 *  which is what makes `Ref<'a, T>` a one-argument wrapper. A wrapper whose
 *  remaining arguments do not come to exactly one is left alone: two type
 *  arguments mean the caller is guessing which one the field lives on. */
function unwrapSmartPointer(type: string): string {
  const strip = (s: string) =>
    s
      .trim()
      .replace(/^(?:&\s*|\*\s*)+/, "")
      .replace(/^(?:const|mut|ref)\s+/, "")
      .trim();
  let current = strip(type);
  // Bounded rather than `while (true)`: a pathological spelling must not spin,
  // and no real receiver nests eight deep.
  for (let i = 0; i < 8; i++) {
    // The head may be PATH-QUALIFIED. rustc names a type the way the crate
    // spells it, and the real corpus has
    // `glommio::sync::RwLockWriteGuard<'_, ConnState>`; a head pattern with no
    // `::` in it left that whole string as the receiver, which resolves to
    // nothing and then fails the PascalCase guard downstream, so the round saw
    // no receiver at all. The wrapper is matched on its LAST segment, which is
    // the type's own name.
    const m = /^(?:[A-Za-z_][A-Za-z0-9_]*::)*([A-Za-z_][A-Za-z0-9_]*)\s*<(.*)>$/s.exec(current);
    if (!m || !SMART_POINTERS.has(m[1])) {
      return current;
    }
    const args = splitGenericArgs(m[2]).filter((a) => !a.startsWith("'"));
    if (args.length !== 1) {
      return current;
    }
    // The reference is stripped at EVERY step, not only the first. Before this
    // `Option<&atlas::Cursor>` unwrapped to the string `&atlas::Cursor`, which
    // is the parameter type in this session's own capture and is not a name any
    // resolver can look up.
    const inner = strip(args[0]);
    // What is inside a wrapper is not always a NAME. `Box<dyn Error>`,
    // `Box<[u8]>` and `Option<(Cursor, u64)>` all unwrap to something the
    // resolver would spend a round trip on and could never find. Keep the
    // wrapper's own spelling in that case: thin, but honest, and the diagnostic
    // still reaches the model verbatim either way.
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*\s*(?:<.*>)?$/s.test(inner)) {
      return current;
    }
    current = inner;
  }
  return current;
}

/** Classify one diagnostic into a hallucination class, or undefined when it is
 *  not one (a borrow or type error rides plain repair, no surface). The cursor
 *  comes from the primary span, so a diagnostic with no primary span is
 *  undefined: there is nowhere to point the extractor. */
export function classifyHallucination(
  diagnostic: Diagnostic,
  resolution?: CrateResolution,
  // Names DEFINED in the target's file. When the
  // offending item's leaf is one of these, the import/path is spurious (the type
  // is local), so classify as local-symbol instead of wrong-item - never inject
  // the external crate's surface. Absent keeps the classifier byte-identical.
  localDefs?: Set<string>,
): HallucinationClass | undefined {
  const primary = diagnostic.spans.find((s) => s.isPrimary);
  if (!primary) {
    return undefined;
  }
  const cursor: CursorPosition = {
    line: primary.lineStart - 1,
    character: primary.columnStart - 1,
  };
  const msg = diagnostic.message;
  // A wrong-item whose leaf names a same-file definition is really a local
  // symbol: the model qualified a local name with a crate path. Local wins even
  // over a gated-module reading - a same-file definition means the import is
  // spurious, so dropping it (not enabling a Cargo feature) is the fix.
  const localShadow = (name: string): HallucinationClass | undefined =>
    localDefs?.has(name) ? { kind: "local-symbol", name, cursor } : undefined;

  // E0425/E0412: an item named through a real crate path that does not exist in
  // it. A struct field inlines the type as a path (`x: fastbloom::InventedType`)
  // rather than importing it, so the miss surfaces here, not as an E0432 import.
  // "in crate `Y`" / "in module `A::B`" pins it to a real crate; "in this scope"
  // is a local/qualifiable name that rides plain repair (unresolvedNameCursor),
  // never this class.
  if (diagnostic.code === "E0425" || diagnostic.code === "E0412") {
    const m = /cannot find .+? `([^`]+)` in (?:crate|module) `([\w:]+)`/.exec(msg);
    if (m) {
      const item = m[1];
      const crate = m[2].split("::")[0]; // the crate whose surface the extractor resolves
      return localShadow(item) ?? { kind: "wrong-item", crate, item, cursor };
    }
    return undefined;
  }

  if (diagnostic.code === "E0609") {
    // `no field `X` on type `Y``: the model accessed a field the receiver type Y
    // does not have. Y is the injection root - its real field list is the fix.
    const m = /no field `([^`]+)` on type `([^`]+)`/.exec(msg);
    if (m) {
      const member = m[1];
      // Tolerate a leading reference/pointer/qualifier on the receiver: a `&Order`
      // / `&mut Order` / `*const Order` / `ref Order` receiver classifies as
      // `Order` (the owning struct is what we resolve fields on). rustc usually
      // auto-derefs and names the owning type, but be defensive across phrasings.
      // Then reduce through any SMART POINTER wrapping it. rustc names the type
      // it resolved, which behind a `RefCell` borrow is the guard and not the
      // struct: the live capture said `Ref<'_, Rc<LogSegmentFile>>` and the field
      // leg asked for the shape of `Ref`.
      const type = unwrapSmartPointer(
        m[2]
          .trim()
          .replace(/^(?:&\s*|\*\s*)+/, "")
          .replace(/^(?:const|mut|ref)\s+/, "")
          .trim(),
      );
      return { kind: "unresolved-field", member, type, cursor };
    }
    return undefined;
  }

  if (diagnostic.code === "E0061") {
    // The arity class. rustc's MESSAGE is a count and nothing else, so nothing
    // here names the receiver or the member. What the model still gets is
    // rustc's RENDERED block, which the prompt passes through verbatim and which
    // does carry each missing argument's TYPE - the receiver is the one thing
    // absent from it, and that is what item 1's disclosure leg is for.
    if (/argument(?:s)? (?:was|were) supplied/.test(msg)) {
      return { kind: "arity-mismatch", member: "", cursor };
    }
    return undefined;
  }

  if (diagnostic.code === "E0599") {
    // The receiver descriptor after "found for" is one or more words (`struct`,
    // but also `mutable reference`, `trait object`, `type parameter`), so match
    // lazily up to the backticked type rather than a single word.
    let m = /no method named `([^`]+)` found for .+? `([^`]+)`/.exec(msg);
    if (m) {
      return { kind: "unresolved-method", member: m[1], type: m[2], cursor };
    }
    m = /no associated function or constant named `([^`]+)` found for .+? `([^`]+)`/.exec(msg);
    if (m) {
      return { kind: "unresolved-assoc", member: m[1], type: m[2], cursor };
    }
    // The method EXISTS but a trait bound is unmet: a DIFFERENT problem (satisfy
    // the bound, not rename the member). Member injection cannot steer it - the
    // member is already right - so leave it to plain repair, never a surface.
    if (/trait bounds were not satisfied/.test(msg)) {
      return undefined;
    }
    // Every other E0599 is the SAME failure the two forms above are: a member the
    // receiver type does not have. rustc words it many ways (``Type` is not an
    // iterator` when the invented name is a std-trait method, a trait-not-in-scope
    // note, future phrasings) but the steer is identical - inject the receiver
    // type's real members and let the model pick the right one. So key on the
    // ERROR CODE (E0599 means "member not found"), not on each message string:
    // one rule, not a regex per rustc phrasing. The member's real name is not
    // always in the message and is informational only (the surface resolves off
    // the cursor's receiver, not off member); the type is a best-effort hint (the
    // last backticked token, which is the receiver in these forms) for the example.
    const ticks = [...msg.matchAll(/`([^`]+)`/g)];
    const type = ticks.length > 0 ? ticks[ticks.length - 1][1] : "";
    return { kind: "unresolved-method", member: "", type, cursor };
  }
  if (diagnostic.code === "E0432") {
    // `unresolved import `crate::a::b::Item`` (or plural `imports`): first
    // segment is the real crate, last is the invented item.
    const m = /unresolved imports? `([\w:]+)`/.exec(msg);
    if (m) {
      const segments = m[1].split("::").filter((s) => s.length > 0);
      const first = segments[0];
      // crate::/self::/super:: are LOCAL paths, not dependency hallucinations;
      // a missing local item rides plain repair, not surface injection.
      if (first === undefined || first === "crate" || first === "self" || first === "super") {
        return undefined;
      }
      // A single-segment import (`fastbloom`) is the CRATE itself unresolved: a
      // missing dependency, which no injection can fix (there is nothing to
      // resolve). A multi-segment import (`fastbloom::Bloom`) means the crate
      // resolved but the item is invented - the injectable wrong-item case.
      if (segments.length === 1) {
        return { kind: "unresolved-crate", crate: first, cursor };
      }
      // A multi-segment import that failed at a cfg-gated MODULE is the
      // needs-a-feature case, not an invented item: the model idiomatically
      // writes `use object_store::aws::AmazonS3Builder;` and rustc truncates the
      // report to the first unresolvable segment (`object_store::aws`), so the
      // gated module is the LAST segment here. This is the import form of the
      // E0433 disambiguation below - and the COMMON one, because a generated
      // function body reaches for a crate API through a `use`, not an inline path.
      const last = segments[segments.length - 1];
      // Local wins over both needs-feature and wrong-item: a same-file leaf means
      // the import is spurious regardless of any gated-module coincidence.
      const local = localShadow(last);
      if (local) {
        return local;
      }
      if (resolution !== undefined) {
        const feature = resolution.gatingFeature(first, last);
        if (feature !== undefined) {
          return { kind: "needs-feature", crate: first, module: last, feature, cursor };
        }
      }
      return { kind: "wrong-item", crate: first, item: last, cursor };
    }
    return undefined;
  }
  if (diagnostic.code === "E0433") {
    // Bare "module or crate `X` in this scope": the crate is not a dependency.
    // Template-separable, needs no resolution.
    const bare = /(?:cannot find (?:module or crate|crate)|use of undeclared (?:crate or module|type)) `(\w+)`/.exec(msg);
    if (bare) {
      return { kind: "unresolved-crate", crate: bare[1], cursor };
    }
    // "cannot find `X` in `Y`": crate Y resolved, segment X did not. Three fates
    // share this one template, separable only by the catalog + cfg-scan:
    //   - X is a cfg-gated module of Y  -> needs a feature enabled
    //   - Y installed, X not gated      -> genuine invented item (wrong-item)
    //   - Y not an installed crate      -> a local path; rides plain repair
    // Without the resolution context there is nothing to disambiguate against.
    const inY = /cannot find `([^`]+)` in `([\w:]+)`/.exec(msg);
    if (inY && resolution) {
      const item = inY[1];
      const crate = inY[2].split("::")[0];
      // crate::/self::/super:: are LOCAL paths, not dependency crates - a missing
      // local item rides plain repair, never a crate-surface or feature steer.
      if (crate === "crate" || crate === "self" || crate === "super") {
        return undefined;
      }
      // A same-file leaf: the crate path is spurious, drop it. Before install/gate
      // checks so local wins even when the crate is installed and gated. Note the
      // asymmetry with the E0432 branch, where localShadow fires without any
      // resolution: this E0433 `cannot find X in Y` path only reaches here when
      // resolution is present (the outer `if (inY && resolution)`). That is safe -
      // absent resolution the diagnostic rides plain repair, never a crate inject -
      // and the real oracleSurface flow always builds resolution for an E0433.
      const local = localShadow(item);
      if (local) {
        return local;
      }
      // Installed-before-gate: only an installed dependency can be steered. This
      // also disambiguates a LOCAL module Y (not installed) from a real crate,
      // and prevents a stale gate map from naming a feature on a crate the user
      // cannot enable one on.
      if (!resolution.isInstalledCrate(crate)) {
        return undefined;
      }
      const feature = resolution.gatingFeature(crate, item);
      if (feature !== undefined) {
        return { kind: "needs-feature", crate, module: item, feature, cursor };
      }
      return { kind: "wrong-item", crate, item, cursor };
    }
    return undefined;
  }
  return undefined;
}

/** The cursor for an unresolved-but-resolvable NAME error ("cannot find type
 *  `BloomFilter` in this scope"), or undefined when the diagnostic is not one.
 *  This is the deterministic-import case: the symbol exists in a dependency and
 *  is only missing its path, so rust-analyzer's qualify assist fixes it in span
 *  with no model round. Distinct from wrong-item (an invented symbol) and from
 *  unresolved-crate (a missing dependency), which classifyHallucination owns. */
export function unresolvedNameCursor(diagnostic: Diagnostic): CursorPosition | undefined {
  const primary = diagnostic.spans.find((s) => s.isPrimary);
  if (!primary) {
    return undefined;
  }
  if (/cannot find (?:type|value|function|trait|macro|struct|enum) `[^`]+` in this scope/.test(diagnostic.message)) {
    return { line: primary.lineStart - 1, character: primary.columnStart - 1 };
  }
  return undefined;
}

/** The type names a diagnostic NAMES, harvested from its message and its span
 *  labels (session-v34 item 2).
 *
 *  The classifier above is a code-by-code table and it recognises seven rustc
 *  codes. Across 25 real compile failures 16 of 28 diagnostics fell outside it,
 *  and when nothing classified, repair went out with no type surface at all:
 *  `surfaceBytes` was 0 on 8 of 9 measured repair rounds. The codes that
 *  actually arrive are E0308, E0277 and E0063, and none of them is in the table.
 *
 *  This is the rule that replaces growing the table: the diagnostic already
 *  names the type, so read the name rather than teaching the classifier one more
 *  code. `missing field \`acked_versions\` in initializer of \`SampledAggregate\``
 *  names `SampledAggregate`; `the trait bound \`ApiKeysConfig:
 *  serde::Deserialize<'de>\` is not satisfied` names `ApiKeysConfig`; `expected
 *  \`Bar\`, found \`Baz\`` names both, and it arrives as a SPAN LABEL rather than
 *  a message, which is why both are read.
 *
 *  The v6 principle is intact: every harvested name came out of a compiler
 *  diagnostic, so every byte it goes on to inject still traces to one. What this
 *  does NOT do is decide the name is real - resolution does that, and a name that
 *  resolves to nothing injects nothing.
 *
 *  Pure and offline. Rust's backtick convention, and only Rust's: C# and
 *  TypeScript quote with apostrophes and their classifiers already read their own
 *  shapes, so a caller in another language must not reuse this.
 *
 *  What is filtered, and why each is not a type worth a round trip:
 *   - a chunk with no PascalCase segment. `acked_versions` in the E0063 above is
 *     the FIELD, not the type, and every rust field is snake_case.
 *   - `stopNames` (the caller passes the prelude set). `Result`, `Option`, `Vec`
 *     and `String` arrive in almost every message and the model knows all of
 *     them. Item 1's rule by a cheaper route: this saves the round trip, and
 *     provenance on the resolved definition is what actually decides.
 *   - a single uppercase letter. `T` is a generic parameter and resolves to
 *     language-service chrome, never a shape.
 *  Trait bounds are split on `:` and paths on `::` before the segments are
 *  taken, so `ApiKeysConfig: serde::Deserialize<'de>` yields `ApiKeysConfig` and
 *  `Deserialize` rather than one unresolvable string. `Deserialize` surviving is
 *  deliberate: it is a real name the diagnostic named, and resolution is what
 *  refuses it. */
export function harvestDiagnosticTypes(
  diagnostic: Diagnostic,
  stopNames: ReadonlySet<string> = PRELUDE_TYPES,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const texts = [diagnostic.message, ...diagnostic.spans.map((s) => s.label ?? "")];
  for (const text of texts) {
    for (const m of text.matchAll(/`([^`]+)`/g)) {
      // One backticked chunk can carry several names: a trait bound, a path, a
      // generic argument list. Split on everything that separates one name from
      // another and take the segments; ordering follows first appearance, so the
      // SUBJECT of a trait bound comes before the bound itself.
      for (const raw of m[1].split(/[^A-Za-z0-9_]+/)) {
        if (!/^[A-Z][A-Za-z0-9_]*$/.test(raw) || /^[A-Z]$/.test(raw)) {
          continue;
        }
        if (stopNames.has(raw) || seen.has(raw)) {
          continue;
        }
        seen.add(raw);
        out.push(raw);
      }
    }
  }
  return out;
}

// ===========================================================================
// The TypeScript classifier sibling. classifyHallucination above
// is rustc-shaped and FROZEN; TS diagnostics carry structured codes, so this
// sibling keys on the code and reads only the quoted names the message
// carries - never free-text scraping. Codes outside the classified set return
// undefined: honest restraint, no injection.
// ===========================================================================

// The quoted names in the three classified TS message shapes. The receiver
// type is matched lazily up to the closing `'.` so an inline object type
// (`type '{ a: string; }'`) survives.
const TS_PROPERTY_MISS = /Property '([^']+)' does not exist on type '(.+?)'\.(?:\s|$)/;
const TS_NO_EXPORT = /Module '(.+?)' has no exported member '([^']+)'/;
const TS_NO_EXPORT_NAMED = /'(.+?)' has no exported member named '([^']+)'\.(?: Did you mean '([^']+)'\?)?/;

/** Classify one TS diagnostic into a hallucination class, or undefined when it
 *  is not one. TS2339/TS2551 (property miss) is the member class - the payload
 *  is the quoted receiver's member surface, signatures first; TS2305/TS2724
 *  (no exported member) is wrong-item, naming the quoted item and tsc's own
 *  did-you-mean when present. TS2304/TS2552 (cannot find name) belong to the
 *  QUALIFY class: they return undefined here (no injection) and are owned by
 *  tsUnresolvedNameCursor + the qualify pass. Everything else: undefined.
 *  resolution/localDefs ride only for hook-signature uniformity with the Rust
 *  classifier; TS has no feature graph and no crate-path local-shadow shape. */
export function classifyTsHallucination(
  diagnostic: Diagnostic,
  _resolution?: CrateResolution,
  _localDefs?: Set<string>,
): HallucinationClass | undefined {
  const primary = diagnostic.spans.find((s) => s.isPrimary);
  if (!primary) {
    return undefined;
  }
  const cursor: CursorPosition = {
    line: primary.lineStart - 1,
    character: primary.columnStart - 1,
  };
  const msg = diagnostic.message;
  if (diagnostic.code === "TS2339" || diagnostic.code === "TS2551") {
    const m = TS_PROPERTY_MISS.exec(msg);
    if (m) {
      return { kind: "unresolved-method", member: m[1], type: m[2], cursor };
    }
    return undefined;
  }
  if (diagnostic.code === "TS2305") {
    const m = TS_NO_EXPORT.exec(msg);
    if (m) {
      return { kind: "wrong-item", crate: stripModuleQuotes(m[1]), item: m[2], cursor };
    }
    return undefined;
  }
  if (diagnostic.code === "TS2554" || diagnostic.code === "TS2555") {
    // The arity class. tsc says `Expected 3 arguments, but got 1.` and that is
    // the whole of it: no member name, no parameter types, no receiver. Of the
    // five languages TypeScript is the one where an arity error leaves the model
    // with literally nothing about the call, which is why disclosure is the only
    // route here.
    if (/Expected (?:at least )?\d+ argument/.test(msg)) {
      return { kind: "arity-mismatch", member: "", cursor };
    }
    return undefined;
  }
  if (diagnostic.code === "TS2724") {
    const m = TS_NO_EXPORT_NAMED.exec(msg);
    if (m) {
      return m[3] !== undefined
        ? { kind: "wrong-item", crate: stripModuleQuotes(m[1]), item: m[2], suggestion: m[3], cursor }
        : { kind: "wrong-item", crate: stripModuleQuotes(m[1]), item: m[2], cursor };
    }
    return undefined;
  }
  return undefined;
}

// tsc renders a module specifier with its own quotes (`Module '"./order"'`);
// the payload names the bare specifier.
function stripModuleQuotes(moduleName: string): string {
  return moduleName.replace(/^"(.*)"$/, "$1");
}

/** The TS qualify-class cursor: TS2304/TS2552 `Cannot find name 'X'` - the
 *  deterministic auto-import case, the TS sibling of unresolvedNameCursor.
 *  Keyed on the code (structured), not the message family alone. */
export function tsUnresolvedNameCursor(diagnostic: Diagnostic): CursorPosition | undefined {
  const primary = diagnostic.spans.find((s) => s.isPrimary);
  if (!primary) {
    return undefined;
  }
  if (
    (diagnostic.code === "TS2304" || diagnostic.code === "TS2552") &&
    /Cannot find name '[^']+'/.test(diagnostic.message)
  ) {
    return { line: primary.lineStart - 1, character: primary.columnStart - 1 };
  }
  return undefined;
}

// ===========================================================================
// The C# classifier sibling. classifyHallucination is
// rustc-shaped and FROZEN; the Roslyn LS emits structured CS#### codes, so this
// sibling keys on the code and reads only the quoted names the message carries.
// The rustc classifier reads NO CS#### code, so this is a real new classifier,
// not a lang string. Codes outside the classified set
// return undefined: honest restraint, no injection.
// ===========================================================================

// The quoted receiver + member in a CS1061 (instance) / CS0117 (static) member
// miss: "'Widget' does not contain a definition for 'Frobnicate' ...". The
// receiver type is named first, the invented member second.
const CS_MEMBER_MISS = /'([^']+)' does not contain a definition for '([^']+)'/;

// CS0019's operand pair: "Operator '==' cannot be applied to operands of type
// 'int' and 'LodBand'". Both quoted operand types are named after the phrase, so
// the match anchors on it rather than on quote counting.
const CS_OPERAND_MISMATCH = /cannot be applied to operands of type '([^']+)' and '([^']+)'/;

/** Classify one C# diagnostic into a hallucination class, or undefined when it
 *  is not one. CS1061/CS0117 (member does not exist) is the member class — the
 *  payload is the receiver's real member surface (completeMembers signatures),
 *  the quoted receiver type named for the log. CS0246/CS0234 (missing type or
 *  namespace) and CS0103 (missing name) are the QUALIFY class: they return
 *  undefined here (no injection) and are owned by csUnresolvedNameCursor + the
 *  deterministic fully-qualify pass — Roslyn's fully-qualify code action resolves
 *  a real-but-unqualified symbol in span with no model round. Everything else:
 *  undefined. resolution/localDefs ride only for hook-signature uniformity with
 *  the Rust/TS classifiers; C# has no feature graph and no crate-path shadow. */
export function classifyCsHallucination(
  diagnostic: Diagnostic,
  _resolution?: CrateResolution,
  _localDefs?: Set<string>,
): HallucinationClass | undefined {
  const primary = diagnostic.spans.find((s) => s.isPrimary);
  if (!primary) {
    return undefined;
  }
  const cursor: CursorPosition = {
    line: primary.lineStart - 1,
    character: primary.columnStart - 1,
  };
  const msg = diagnostic.message;
  if (diagnostic.code === "CS1061" || diagnostic.code === "CS0117") {
    const m = CS_MEMBER_MISS.exec(msg);
    if (m) {
      // The member surface is resolved off the cursor's receiver (completeMembers
      // at the `.` site), so `member` is informational; `type` is the quoted
      // receiver, a best-effort hint for the log/dedup.
      return { kind: "unresolved-method", member: m[2], type: m[1], cursor };
    }
    return undefined;
  }
  if (diagnostic.code === "CS7036" || diagnostic.code === "CS1501") {
    // The arity class, and the one place C# is the cheapest language in the set:
    // Roslyn quotes the WHOLE signature it was matching against,
    // `'Cursor.ToManifest(Cursor?, long, long)'`, so the receiver's type is
    // already in the diagnostic text the prompt passes through verbatim. Parsing
    // it costs nothing; resolving it would cost a ~500ms Roslyn round trip.
    //
    // The type is read from the QUALIFIED MEMBER NAME in front of the parameter
    // list, never from the parameter list itself. `Cursor.ToManifest(Cursor?,
    // long, long)` names `Cursor` twice for unrelated reasons, and a reader that
    // took the first parameter would be right by coincidence here and wrong at
    // every call whose first argument is not the receiver's own type.
    const m = /\bof '([^']+)'/.exec(msg);
    if (m) {
      const path = m[1].split("(")[0].trim().split(".");
      const member = path[path.length - 1] ?? "";
      const type = path.length > 1 ? path[path.length - 2] : undefined;
      return type !== undefined
        ? { kind: "arity-mismatch", member, type, cursor }
        : { kind: "arity-mismatch", member, cursor };
    }
    // CS1501 words it differently and names no receiver: `No overload for method
    // 'ToManifest' takes 1 arguments`. The member alone, honestly.
    const overload = /No overload for method '([^']+)' takes/.exec(msg);
    if (overload) {
      return { kind: "arity-mismatch", member: overload[1], cursor };
    }
    return undefined;
  }
  if (diagnostic.code === "CS0019") {
    const m = CS_OPERAND_MISMATCH.exec(msg);
    if (m) {
      // Both operands, in the compiler's own order. A primitive among them
      // (`int`) is dropped later by the span-types stop sets, not here: this
      // classifier reports what the compiler said.
      return { kind: "operand-mismatch", types: [m[1], m[2]], cursor };
    }
    return undefined;
  }
  return undefined;
}

/** The C# qualify-class cursor: CS0246/CS0234 (`type or namespace name 'X'`) and
 *  CS0103 (`The name 'X' does not exist`) — the deterministic fully-qualify case,
 *  the C# sibling of unresolvedNameCursor / tsUnresolvedNameCursor. The rustc
 *  "cannot find ... in this scope" heuristic does NOT match these,
 *  so C# needs its own variant. Keyed on the code (structured),
 *  with a message guard so an off-shape diagnostic is not mis-cursored. */
export function csUnresolvedNameCursor(diagnostic: Diagnostic): CursorPosition | undefined {
  const primary = diagnostic.spans.find((s) => s.isPrimary);
  if (!primary) {
    return undefined;
  }
  if (
    (diagnostic.code === "CS0246" || diagnostic.code === "CS0234" || diagnostic.code === "CS0103") &&
    /(?:type or namespace name|The name) '[^']+'/.test(diagnostic.message)
  ) {
    return { line: primary.lineStart - 1, character: primary.columnStart - 1 };
  }
  return undefined;
}

// ===========================================================================
// The Python qualify-class cursor. pyright emits a `rule`
// which pyOracle maps onto Diagnostic.code; `reportUndefinedVariable` names an
// undefined-but-possibly-importable name (`"X" is not defined`) — the Python
// sibling of tsUnresolvedNameCursor / csUnresolvedNameCursor. The rustc
// "cannot find ... in this scope" heuristic does NOT match pyright's
// text, so Python needs its own variant.
// ===========================================================================

// pyright's attribute miss: `Cannot access attribute "mirror" for class
// "Boxed[Shard]"`. The member is quoted first, the class second, and pyright
// spells a generic instantiation with brackets rather than angles.
const PY_ATTRIBUTE_MISS = /Cannot access attribute "([^"]+)" for class "([^"]+)"/;

/**
 * Classify one pyright diagnostic into a hallucination class, or undefined when
 * it is not one.
 *
 * Python and Go had NO classifier before v30. `repairLangFor` sent everything
 * that was not TypeScript or C# to the Rust hooks, so every pyright rule name
 * was matched against rustc's E0609/E0599/E0425 codes and came back `none`,
 * always. Both languages have been running on the span's types-in-play alone,
 * which is the one leg that misses the receiver.
 *
 * pyright rule names arrive as `Diagnostic.code` (pyOracle maps `rule` onto it),
 * so this keys on the code and reads only the quoted names the message carries,
 * exactly like the TS and C# siblings. `reportUndefinedVariable` belongs to the
 * QUALIFY class and returns undefined here; it is owned by
 * `pyUnresolvedNameCursor` and the qualify pass. resolution/localDefs ride for
 * hook-signature uniformity; Python has no feature graph and no crate-path
 * shadow.
 */
export function classifyPyHallucination(
  diagnostic: Diagnostic,
  _resolution?: CrateResolution,
  _localDefs?: Set<string>,
): HallucinationClass | undefined {
  const primary = diagnostic.spans?.find((s) => s.isPrimary);
  if (!primary) {
    return undefined;
  }
  const cursor: CursorPosition = {
    line: primary.lineStart - 1,
    character: primary.columnStart - 1,
  };
  const msg = diagnostic.message;
  if (diagnostic.code === "reportAttributeAccessIssue") {
    const m = PY_ATTRIBUTE_MISS.exec(msg);
    if (m) {
      return { kind: "unresolved-method", member: m[1], type: m[2], cursor };
    }
    return undefined;
  }
  if (diagnostic.code === "reportCallIssue") {
    // pyright names the missing PARAMETERS and neither their types nor the
    // receiver, so this class carries no type and Python gets no cheap route.
    // The resolve leg is the only one that helps here.
    if (/Arguments? missing for parameters?|Expected \d+ positional argument/.test(msg)) {
      return { kind: "arity-mismatch", member: "", cursor };
    }
    return undefined;
  }
  return undefined;
}

// go's member miss: `shard.Mirror undefined (type *atlas.Boxed[*atlas.Shard] has
// no field or method Mirror)`. The receiver's type sits inside the parenthetical
// and is spelled in full: pointer, package qualifier and type arguments.
const GO_MEMBER_MISS = /\bundefined \(type (.+?) has no field or method ([A-Za-z_][A-Za-z0-9_]*)\)/;

// go's arity error, after GoOracle has folded the indented `have`/`want`
// continuation lines into the message with a single space.
//
// Only the CALLEE is captured. The first draft also read the first `want`
// parameter as the receiver's type, and that was simply wrong: go's `want` list
// is the PARAMETER list, and a method's receiver is not in it. The scout's
// reproduction hid it because `ToManifest`'s first parameter happened to be the
// same type as its receiver, which is the exact coincidence the C# sibling's
// comment warns about twenty lines above. Verified against go1.26.5:
//
//   not enough arguments in call to c.ToManifest
//     have (string)
//     want (string, uint64, uint64)     <- receiver `*Cursor` appears nowhere
//
// So Go pays nothing forward at an arity error, and its receiver has to be
// resolved like Rust's, TypeScript's and Python's. The `have`/`want` block still
// reaches the model verbatim, because the prompt passes diagnostics through.
const GO_ARITY = /\b(?:not enough|too many) arguments in call to ([^\s]+)/;

/** A go type spelling reduced to a bare type NAME: `*atlas.Boxed[*atlas.Shard]`
 *  becomes `Boxed`. Pointers and references off the front, type arguments off
 *  the back, package qualifier dropped. The bare name is what the payload header
 *  and the dedup key want; the member surface itself resolves off the CURSOR, so
 *  nothing downstream needs the full spelling. */
function goBareTypeName(spelling: string): string {
  const stripped = spelling.trim().replace(/^[*&\s]+/, "");
  const withoutArgs = stripped.split("[")[0];
  const segments = withoutArgs.split(".");
  return (segments[segments.length - 1] ?? "").trim();
}

/**
 * Classify one `go build` diagnostic into a hallucination class, or undefined
 * when it is not one.
 *
 * Go has NO diagnostic codes at all, so unlike every other sibling here this one
 * keys on the message text. That is not the free-text scraping the TS classifier
 * refuses: go's compiler messages for these two classes are fixed strings from
 * the compiler's own source, and there is no code to key on instead.
 *
 * Go pays NOTHING forward at an arity error: `want (...)` is the parameter list,
 * and a method's receiver is not in it, so the class carries no type (see the
 * comment on GO_ARITY for the go1.26.5 reproduction). The have/want block still
 * reaches the model verbatim, because the prompt passes diagnostics through.
 */
export function classifyGoHallucination(
  diagnostic: Diagnostic,
  _resolution?: CrateResolution,
  _localDefs?: Set<string>,
): HallucinationClass | undefined {
  const primary = diagnostic.spans?.find((s) => s.isPrimary);
  if (!primary) {
    return undefined;
  }
  const cursor: CursorPosition = {
    line: primary.lineStart - 1,
    character: primary.columnStart - 1,
  };
  const msg = diagnostic.message;
  const miss = GO_MEMBER_MISS.exec(msg);
  if (miss) {
    return { kind: "unresolved-method", member: miss[2], type: goBareTypeName(miss[1]), cursor };
  }
  const arity = GO_ARITY.exec(msg);
  if (arity) {
    // The callee is a whole expression (`shard.Value().Meta.Head.ToManifest`);
    // its last dotted segment is the member. No type: see GO_ARITY above.
    const path = arity[1].split(".");
    const member = (path[path.length - 1] ?? "").replace(/\(.*$/, "");
    return { kind: "arity-mismatch", member, cursor };
  }
  return undefined;
}

/** The Python qualify-class cursor: pyright `reportUndefinedVariable`
 *  (`"X" is not defined`) — the deterministic auto-import case. Keyed on BOTH the
 *  code AND the message family (so a `reportUndefinedVariable` with an off-shape
 *  message is not mis-cursored). Returns the primary span's 0-based cursor. */
export function pyUnresolvedNameCursor(diagnostic: Diagnostic): CursorPosition | undefined {
  const primary = diagnostic.spans?.find((s) => s.isPrimary);
  if (!primary) {
    return undefined;
  }
  if (
    diagnostic.code === "reportUndefinedVariable" &&
    /"[^"]+" is not defined/.test(diagnostic.message)
  ) {
    return { line: primary.lineStart - 1, character: primary.columnStart - 1 };
  }
  return undefined;
}

const FENCE = "```";

/** Render the C# member-surface payload: the receiver's real members, fenced
 *  cs. Lines are signatures where completionItem/resolve delivered them and BARE
 *  NAMES where the tail could not resolve in the budget (the honest name-only
 *  render — never an invented type). C#-owned constant text, free of the Rust
 *  byte pins; C# carries no worked example (metadata-as-source strips them), so
 *  the member surface is the only repair payload C# injects. */
export function assembleCsMemberPayload(input: { type: string; members: string }): string {
  return (
    `Members of \`${input.type}\` (real member names from the type; use only these, do not invent):\n` +
    `${FENCE}cs\n${input.members}\n${FENCE}`
  );
}

/** Render the Python member-surface payload: the receiver's real members, fenced
 *  python (the tag pyright's own hovers use). Python carries no worked example
 *  and no struct-field def, so the member surface is the only repair payload it
 *  injects. */
export function assemblePyMemberPayload(input: { type: string; members: string }): string {
  return (
    `Members of \`${input.type}\` (real member names from the type; use only these, do not invent):\n` +
    `${FENCE}python\n${input.members}\n${FENCE}`
  );
}

/** Render the Go member-surface payload: the receiver's real members, fenced go
 *  (the tag gopls' own hovers use). Same contract as the Python one. */
export function assembleGoMemberPayload(input: { type: string; members: string }): string {
  return (
    `Members of \`${input.type}\` (real member names from the type; use only these, do not invent):\n` +
    `${FENCE}go\n${input.members}\n${FENCE}`
  );
}

/** Render the TS member-surface payload: the quoted receiver's real members,
 *  fenced ts. Lines are signatures where the extractor delivered them and BARE
 *  NAMES where it did not (the honest name-only render - never an invented
 *  type). TS-owned constant text, free of the Rust byte pins. */
export function assembleTsMemberPayload(input: { type: string; members: string }): string {
  return (
    `Members of \`${input.type}\` (real member names from the type; use only these, do not invent):\n` +
    `${FENCE}ts\n${input.members}\n${FENCE}`
  );
}

/** Render the TS wrong-item payload (TS2305/TS2724): terminal steering naming
 *  the quoted missing export and tsc's own did-you-mean when it carried one.
 *  No example (dark for TS), no fence - there is no code to show. */
export function assembleTsWrongItemPayload(input: {
  item: string;
  module: string;
  suggestion?: string;
}): string {
  const hint =
    input.suggestion !== undefined
      ? ` The compiler suggests \`${input.suggestion}\`.`
      : "";
  return (
    `\`${input.item}\` is not an exported member of \`${input.module}\`.${hint} ` +
    `Use only names that module really exports.`
  );
}

/** Render the injection block from a resolved surface: the example when present,
 *  else signatures, plus the firm instruction; "" when neither is available.
 *  Example wins and never coexists with signatures. */
export function assembleSurfacePayload(input: {
  typeOrCrate: string;
  example?: string;
  signatures?: string;
  // When true, the block omits the trailing FIRM_INSTRUCTION - the pre-fill path
  // assembles up to N type blocks and emits ONE shared instruction for the whole
  // prompt, rather than repeating it per block. Default false, so
  // the single-block repair path (resolveSurfaceInjection) is unchanged.
  omitInstruction?: boolean;
}): string {
  const tail = input.omitInstruction ? "" : `\n\n${firmInstructionFor([input.typeOrCrate])}`;
  // THE GATE (session-v41 phase 3), at the ONE render seam every example
  // block passes - fn-gen's pre-fill and the repair surface both assemble
  // here. An example whose code never names the type it would be headed with
  // is refused, so no caller can reach the "(from its docs, this compiles)"
  // sentence with code that does not: the payload falls to the signatures
  // branch, or to "" when nothing else exists. Callers may pre-check with the
  // same predicate for their own accounting; this is the line no block
  // crosses.
  const example =
    input.example !== undefined && exampleNamesItsType(input.typeOrCrate, input.example)
      ? input.example
      : undefined;
  if (example) {
    return (
      `Usage example for \`${input.typeOrCrate}\` (from its docs, this compiles):\n` +
      `${FENCE}rust\n${example}\n${FENCE}${tail}`
    );
  }
  if (input.signatures) {
    return (
      `API surface for \`${input.typeOrCrate}\` (real signatures, use these exact names, do not invent):\n` +
      `${FENCE}\n${input.signatures}\n${FENCE}${tail}`
    );
  }
  return "";
}

/** Render the needs-feature payload: crate Y has module X, but the feature that
 *  gates it is off. This is terminal steering, not a worked example - there is
 *  no code to show, the fix is a Cargo.toml edit - so it emits no rust fence and
 *  reaches no network. Names the public feature the cfg-scan resolved. */
export function assembleNeedsFeaturePayload(input: {
  crate: string;
  module: string;
  feature: string;
}): string {
  const { crate, module, feature } = input;
  // No FIRM_INSTRUCTION here: that instruction governs an injected API surface,
  // and this is terminal steering with none - the fix is a Cargo.toml edit, so
  // the model is told to change approach, not to call names from a surface.
  return (
    `\`${crate}::${module}\` exists but is behind the \`${feature}\` feature, which is not enabled. ` +
    `Enable it in Cargo.toml (\`${crate} = { version = "...", features = ["${feature}"] }\`) ` +
    `and regenerate, or generate against an API of \`${crate}\` (or another installed crate) that is already available.`
  );
}

/** Render the local-symbol steer: the offending name is defined in this file,
 *  so the import/crate path is spurious. Terminal steering, not a worked example
 *  - there is no crate surface to show and none must be shown (showing it is the
 *  amplification bug), so it emits no rust fence and reaches no network, and it
 *  carries no FIRM_INSTRUCTION (that governs an injected API surface; there is
 *  none). Tells the model to drop the import and use the local name directly. */
export function assembleLocalSymbolPayload(input: { name: string }): string {
  const { name } = input;
  return (
    `\`${name}\` is defined in this file - it is not an item of any external crate. ` +
    `Remove the \`use ...::${name};\` import (and any crate-path prefix such as \`somecrate::${name}\`) ` +
    `and refer to \`${name}\` directly by its bare name.`
  );
}

// RUST's std-prelude and common std container types: named in a signature but
// not a user crate type worth pre-resolving. Primitives (i32, bool, str) are
// lower case and never match the PascalCase scan, so they need no listing.
//
// It is Rust's, and only Rust's. `Result`, `Option`, `Box` and `Cow` are
// ordinary user types in the other four languages, and this set applied to them
// hides a type the model then cannot use: measured live on a .NET codebase
// whose house rules say to return `Result<T,E>`, where round 0 never saw it and
// the compiler refused the generation. A caller in another language passes its
// own set.
export const PRELUDE_TYPES = new Set([
  "String", "Vec", "Option", "Result", "Box", "Self", "Some", "None", "Ok", "Err",
  "Rc", "Arc", "Cell", "RefCell", "Cow", "HashMap", "HashSet", "BTreeMap",
  "BTreeSet", "VecDeque",
]);

/** The type-shaped identifiers named in a signature and doc, first-seen order,
 *  primitives and std-prelude names excluded. Round-1 pre-fill resolves each.
 *  `excludeName` (the DECLARED symbol, threaded from resolved.symbolName) is
 *  never returned: a C# method name is PascalCase (`StripeFanout`), so without
 *  this the target's own name resolves as a "collaborator" to the enclosing
 *  class's members and fills the single injection slot with garbage (goal.md
 *  Defect 1). Rust/TS names are snake/camelCase and never matched the scan, so
 *  omitting the arg leaves their behaviour byte-for-byte unchanged.
 *
 *  `excludeName` is reduced to its LEADING IDENTIFIER before comparison: the C#
 *  transport passes Roslyn's documentSymbol name VERBATIM, which carries chrome
 *  ("StripeFanout() : int", "PickLargest<T>(...) : T?"), while the scan yields
 *  the bare token "StripeFanout" — an exact-string compare never matched, so the
 *  target's own name leaked back in (PROVEN against the live LS). */
export function typesNamedIn(
  signature: string,
  docComment?: string,
  excludeName?: string,
  // The names this caller's language treats as std. Absent means Rust's, which
  // is what every Rust caller wants and what the frozen Rust oracles pin. A
  // caller in another language MUST pass its own, or it inherits Rust's idea of
  // what is not worth resolving.
  stopNames: ReadonlySet<string> = PRELUDE_TYPES,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const excludeBare = excludeName?.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
  const take = (name: string) => {
    if (stopNames.has(name) || seen.has(name) || name === excludeBare) {
      return;
    }
    seen.add(name);
    out.push(name);
  };
  // A signature is code: every PascalCase token is a type. Doc prose is not, so
  // a capitalized sentence word ("Uses") would be a false positive; take only
  // backtick-quoted identifiers from the doc, where types are referenced by
  // convention.
  for (const m of signature.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    take(m[1]);
  }
  if (docComment !== undefined) {
    for (const name of backtickedTypeNames(docComment)) {
      take(name);
    }
  }
  return out;
}

/** The backtick-quoted type names in PROSE, in first-seen order, duplicates and
 *  all: `BloomFilter`, and also `fastbloom::BloomFilter` (the final PascalCase
 *  segment is the type). A bare lowercase backtick (`fastbloom`) has no
 *  PascalCase segment and is skipped, because the crate alone is not a
 *  pre-fillable type.
 *
 *  Prose is not code, so a capitalized sentence word ("Uses", "Phase", "The")
 *  is a false positive and the backtick is what separates the two. Measured on
 *  6,856 human-written comment lines: an unbackticked PascalCase scan is 97.7%
 *  junk, and under a type cap that binds, junk does not merely waste bytes, it
 *  evicts real types (session-v36 goal, "Scanning comments for unbackticked
 *  type names").
 *
 *  Extracted from `typesNamedIn`'s doc leg so the BODY-comment gesture is
 *  literally the same rule pointed at a second source rather than a second
 *  regex free to drift from it. Callers apply their own stop set and dedup;
 *  this returns what the text says.
 *
 *  THE RULE INSIDE THE SPAN, ratified 2026-08-02 (session-v37 item 1). v36
 *  required the ENTIRE span to be one identifier or a `::` path, and that rule
 *  is invisible for the shapes developers actually type. Playing the developer
 *  over 5,514 real functions, `` `IsCa Yes` `` scored 0% in Go and C#; the
 *  nonzero Rust figures were other legs recovering the name by accident, not
 *  the gesture working.
 *
 *  The first cut split the span on commas and brackets and took each part's
 *  leading identifier. An adversarial review then measured how the five
 *  languages actually SPELL a type, and that rule refuses most of it: of every
 *  capitalized type occurrence in a real signature, Go spells 79.8% a way it
 *  cannot read (56.2% `pkg.T`, 23.6% `*T`), Rust 12.0%, C# 4.8%. Go has no
 *  import leg and no doc leg, so the gesture is the only channel it has, and
 *  four Go type mentions in five went into it silently.
 *
 *  So the span is split on `, < > [ ] | & *`, and each chunk yields one name.
 *  Every clause below is load-bearing and every one was measured against BOTH
 *  populations, the gesture and committed doc prose, because a single number
 *  always argues for widening:
 *
 *  - Leading punctuation is skipped, so `*Config` and `&'a Config` read. Only
 *    NON-identifier characters, which is what stops this reaching a second
 *    identifier and inventing `Yes` out of `` `IsCa Yes` ``.
 *  - A fixed set of type-position keywords is skipped, so `dyn Storage` and
 *    `chan Event` read. NOT any lowercase word: that version was measured and
 *    it reads the prose "to build a Stripe:" as the type `Stripe`.
 *  - `::` and `.` both join a path, and a CALL is told from a qualified name by
 *    the character after it. `Assert.AreEqual(x, y)` names `Assert`;
 *    `Contoso.DataModel.Widget` and `http.Client` name the segment on the right;
 *    `CrateResolution.gatingFeature` falls back to the left. This also closes
 *    the `` `PkiManager::create_ca` `` gap, which now reads `PkiManager`.
 *  - A chunk starting with a dot continues a member chain and is refused, or
 *    `c.Request.URL.Query().Get(key)` injects the method `Get`.
 *  - A lone capital is not a type. `Map<K, V>` would otherwise contribute `K`
 *    and `V`, which are type PARAMETERS: no definition to resolve, one slot each.
 *
 *  On the 34 measured shapes it returns every name the developer asked for and
 *  invents none; the shipped-before rule returned 20 and invented 2.
 *
 *  The cost lands on the doc population, where a backtick is often prose
 *  punctuation, and junk there evicts a real type under the cap. Measured over
 *  the doc comments the PRODUCT reads, through each language's own doc channel,
 *  with the product's own stop sets, counting a name real if the workspace
 *  declares or imports it. This rule is better than what shipped on every
 *  corpus, in rate as well as count:
 *
 *      acme-db   rust   289 names at 33.9%  ->  374 at 35.3%
 *      column-80      ts     245 names at 13.1%  ->  820 at 17.0%
 *      cobra+gin+hugo go      13 names at 30.8%  ->   28 at 35.7%
 *      contoso        c#       0 backticked doc spans in the corpus
 *
 *  Frozen as a fixture in `test/fixtures/v37-doc-spans.json`, harvested by
 *  `session-v37/harvest-doc-spans.cjs` through the product's own
 *  `tsDocCommentAbove` and `csDocCommentAbove` rather than a line-prefix scan,
 *  which is a distinction that mattered: the prefix version could not see the
 *  plain `//` run that is the dominant TypeScript doc shape, and scanned Go for
 *  a `///` marker Go never writes. */
export function backtickedTypeNames(text: string): string[] {
  const out: string[] = [];
  // `*`, not `+`, and it is not cosmetic. An EMPTY pair is a real thing people
  // write, and a span body that must be non-empty makes the scanner pair the
  // second backtick of ```` `` ```` with the OPENER of the name beside it, so
  // ``` `` `Widget` ``` yields nothing. Allowing the empty match consumes the
  // pair as a pair and leaves the real span intact, which is how the pre-v37
  // rule behaved.
  // `\r` is excluded alongside `\n`, and a fuzz found why: a file with CRLF or
  // bare-CR endings would otherwise let one span swallow a line break and pair
  // the backtick that opens line 1 with the one that opens line 2, reading a
  // name out of text the developer never put in a span. A backtick span never
  // crosses a line.
  for (const m of text.matchAll(/`([^`\r\n]*)`/g)) {
    // A SINGLE colon splits, a double colon does not. `data: Widget` is how
    // Python spells a parameter type, and `Widget` is unreachable without this;
    // `fastbloom::BloomFilter` must stay one token. Measured on the doc fixture
    // as a wash, acme 35.8% to 35.4% and column-80 15.1% to 15.4%.
    for (const part of m[1].split(/[,<>[\]|&*]|(?<!:):(?!:)/)) {
      // Parens are split KEEPING the delimiter, because the character after a
      // token is the only thing in the text that separates a CALL from a
      // qualified type name. Dropping it costs both: `Some(CompactionResult)`
      // has to yield the payload, and `Assert.AreEqual(x, y)` must not yield
      // `AreEqual`.
      const pieces = part.split(/([()])/);
      for (let k = 0; k < pieces.length; k += 2) {
        // A chunk that STARTS with a dot continues a member chain and is never
        // a new type reference. Without this, `c.Request.URL.Query().Get(key)`
        // reaches `.Get` as a fresh chunk and a method name is injected.
        if (/^\s*\./.test(pieces[k])) {
          continue;
        }
        let rest = pieces[k]
          // Leading punctuation is not part of the name the developer wrote.
          // `*Config`, `&Config`, `[]Tile`, `?Widget`. Only NON-identifier
          // characters are skipped, so this can never reach a SECOND identifier
          // and invent a name the way "any token anywhere" does.
          //
          // A LETTER or DIGIT is never skipped, and the class is Unicode-aware
          // for the same reason. Stripping them reads `3Type` as `Type`,
          // `0000-NNNN` as `NNNN` and `ÉType` as `Type`, which invents a name
          // out of text that is not a name at all. Both were caught by a test,
          // one input apiece, after the ASCII-only version looked right.
          .replace(/^[^\p{L}\p{N}_']+/u, "")
          // A Rust lifetime is punctuation in front of the type: `&'a Config`.
          .replace(/^'[A-Za-z_][A-Za-z0-9_]*\s+/, "")
          .replace(/^[^\p{L}\p{N}_]+/u, "");
        // Keywords that sit between the developer and the type they named.
        // A fixed set, not "any lowercase word": the blanket version was
        // measured and it reads the prose "to build a Stripe:" as the type
        // `Stripe`, which is the invention this rule exists to refuse.
        for (;;) {
          const kw = rest.match(/^([a-z_][A-Za-z0-9_]*)\s+/);
          if (kw === null || !TYPE_POSITION_KEYWORDS.has(kw[1])) {
            break;
          }
          rest = rest.slice(kw[0].length);
        }
        // UNICODE-AWARE, and a fuzz is why. An ASCII-only identifier class ends
        // the match at the first non-ASCII letter, and the `startsWith` guard
        // below is then satisfied by the PREFIX, so `CaféType` returned `Caf`.
        // The invariant that catches this whole family, and it is the fourth
        // member of it, is that a returned name must appear in the text as a
        // WHOLE identifier and never as a prefix of one. `isPlainGoIdentifier`
        // already spells the class this way.
        const token = rest.match(/[\p{L}_][\p{L}\p{N}_]*(?:(?:::|\.)[\p{L}_][\p{L}\p{N}_]*)*/u)?.[0];
        if (token === undefined || !rest.startsWith(token)) {
          continue;
        }
        const segs = token.split(/::|\./);
        // A call names its RECEIVER, so take the first segment: `Widget::new()`
        // and `Assert.AreEqual(...)` both name a type on the left. Otherwise the
        // path is a qualified name and the type is on the right, which is how
        // `Contoso.DataModel.Widget` and `http.Client` are written; falling back
        // to the first segment covers a member access like
        // `CrateResolution.gatingFeature`.
        const last = segs[segs.length - 1];
        if (pieces[k + 1] === "(") {
          if (typeish(segs[0])) {
            out.push(segs[0]);
          }
          continue;
        }
        if (typeish(last)) {
          out.push(last);
        }
        // BOTH ends of a TWO-segment path, when both are type-shaped and there is
        // no paren to decide. The call signal is the right discriminator and its
        // limit is that prose does not carry parens: of 394 dotted paths in the
        // TypeScript doc population only 79 are followed by `(`, so it is there
        // for one mention in five. For the other four, `Namespace.Widget` wants
        // the leaf and `Severity.Error` wants the head, and nothing in the text
        // separates them, because C# and TypeScript PascalCase their methods and
        // enum members too. So when the text cannot say, say both and let
        // resolution refuse the wrong one.
        //
        // TWO segments only, because at three or more the leaf is a type by
        // construction: nobody writes a two-deep member chain in a doc comment,
        // they write a namespace. Measured, and the narrower rule is the better
        // one rather than merely the cheaper one: column-80 goes 777 names at
        // 15.4% real to 820 at 17.0% hedging two-segment paths, against 836 at
        // 16.6% hedging every depth. The extra names a deep hedge buys are worse
        // than the ones already there.
        //
        // Read the rate as a discriminator between these two arms, not as proof
        // the hedge is free. At a 15% base rate any rule adding names that are
        // half real lifts the average, so the aggregate alone would have argued
        // for the wrong arm. The argument for hedging at all is the cap: getting
        // the end wrong spends a slot on a name that cannot resolve, and so does
        // hedging, but hedging spends it knowing the right name is also present.
        //
        // It fires only when BOTH ends are type-shaped, so the dominant Go shape
        // `pkg.Type` costs nothing: a lowercase package head is not a candidate
        // and the leaf is emitted alone.
        if (typeish(last) && segs.length === 2 && typeish(segs[0])) {
          out.push(segs[0]);
        } else if (!typeish(last) && typeish(segs[0])) {
          out.push(segs[0]);
        }
      }
    }
  }
  return out;
}

/** A name is type-shaped when it starts with a capital and is not a LONE
 *  capital. A lone capital is a type parameter: no definition to resolve, and
 *  one budget slot spent finding that out. Splitting manufactures them, because
 *  `Map<K, V>` would otherwise contribute `K` and `V`. */
const typeish = (name: string): boolean => /^[A-Z]/.test(name) && name.length > 1;

/** Lowercase words that sit between the developer and the type they named, in
 *  a type position. Fixed and small on purpose: skipping ANY leading lowercase
 *  word was measured on the doc fixture and it reads ordinary prose as a type. */
const TYPE_POSITION_KEYWORDS: ReadonlySet<string> = new Set([
  "dyn", "impl", "mut", "ref", "const", "chan", "map", "func", "out", "params",
  "in", "new", "readonly", "type", "struct", "enum", "class", "interface", "record",
]);

/** The type-shaped identifiers brought into scope by `use` statements in the
 *  source, first-seen order, primitives and std-prelude excluded. Round-1
 *  pre-fill's second input: a type the doc/signature does not name but the file
 *  already imports (`use fastbloom::BloomFilter;`) is still the type the model
 *  needs, and the `use` line gives a real cursor to resolve its example at. */
export function typesFromUses(source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Accept `pub use` / `pub(crate) use` re-exports (the dominant lib.rs shape),
  // not just bare `use`.
  const useStart = /^(?:pub\s*(?:\([^)]*\))?\s+)?use\s/;
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!useStart.test(lines[i].trim())) {
      continue;
    }
    // Accumulate a multi-line grouped import (rustfmt wraps groups one type per
    // line) until the statement ends, so continuation lines - which do NOT start
    // with `use` - are not skipped.
    let stmt = lines[i];
    let j = i;
    while (!stmt.includes(";") && j + 1 < lines.length) {
      j++;
      stmt += " " + lines[j];
    }
    i = j;
    // Every PascalCase token in the statement: the imported type(s) and any
    // alias. Over-capturing a PascalCase module name is harmless - it just
    // resolves no example and is skipped.
    for (const m of stmt.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
      const name = m[1];
      if (PRELUDE_TYPES.has(name) || seen.has(name)) {
        continue;
      }
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
