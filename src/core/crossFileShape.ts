/**
 * The cross-file/cross-crate edge resolver.
 *
 * At a type reference, `definition()` locates the def site (in ANY file or
 * crate); `hoverSurface` reads its fields and `membersOfType` its methods;
 * the walk recurses on local field-types to a bounded depth. This is the ONE
 * rust-analyzer-backed shape resolver every generation path unifies onto — it
 * carries the same-file struct map across the file/crate boundary by wiring
 * `definition()`, which both transports implement.
 *
 * The compiler-directed invariant, extended cross-boundary: the resolver NEVER
 * invents. Every field and method it emits traces to a rust-analyzer resolution
 * of a real definition — `hoverSurface` for fields (RA-indexed, does not need
 * the def file open), `membersOfType` for methods (documentSymbol, DOES need it
 * open). Recursion re-anchors at the FIELD'S OWN type token inside the parent
 * struct body and lets `definition()` resolve it in the parent's scope, so a
 * DIFFERENT type that happens to share the field-type's bare name (a shadowing
 * inner-module type) is never walked into by mistake — the wrong-type inject.
 * A field-type it cannot anchor/resolve is a stop edge, recorded in `dropped`
 * (never silent), never a guess.
 *
 * Oracles: test/fixtures/autocontext-scout/expected-derivation.json (fidelity)
 * and test/fixtures/autocontext-collision/ (the wrong-type regression).
 */

import {
  CompletionMember,
  MEMBER_CAP,
  SourceCursor,
  SurfaceExtractor,
  renderMemberSignatures,
} from "./extraction";
import { StructResolution } from "./dataShape";
import { LanguageVisibility, TargetScope, VisibilityContext } from "./memberVisibility";
import { ReturnStyle, producesType } from "./receiver";
import {
  TS_LANGUAGE_IDS,
  TS_STD_TYPE_NAMES,
  parseTsHoverFields,
  tsFieldTypeCursor,
  tsRenderDerivedDef,
} from "./tsExtraction";
import { CS_STD_TYPE_NAMES, csQualifyStatics, csSignatureRefTypes } from "./csExtraction";
import { pyEnumBaseDecl } from "./pyExtraction";
import { goElideDef } from "./goExtraction";
import { isBareTraitHover, recoverElidedSurface, recoverTraitSurface } from "./rustHoverRecovery";

// The recovery lives in its own module (a character-level Rust scanner with its
// own comment/attribute scrubber, and this file already carries the walk, four
// languages' hooks and the renderers). Re-exported here because THIS is the
// facade every consumer of the derived shape already imports.
export {
  isBareTraitHover,
  recoverElidedSurface,
  recoverTraitSurface,
  surfaceStillTruncated,
} from "./rustHoverRecovery";

/** The shape derived for ONE type. `fields` are the struct's fields (member name
 *  + the field type AS WRITTEN, e.g. `entries` / `Vec<LineItem>`), matching the
 *  literal form in expected-derivation.json. `methods` are rendered inherent-
 *  method signatures (`net_minor_units(&self) -> u64`). `methodsResolved` reports
 *  ONLY that file-local member enumeration ran against the opened def file — NOT
 *  that every method exists: an `impl` block in a DIFFERENT file from the struct
 *  is file-scoped-invisible to `membersOfType` and silently absent (a known
 *  limitation; cross-file impl union is deferred). false means the def file could
 *  not be opened, so methods are unknown and the type degraded to hover-only
 *  field shape — the honest cross-crate caveat. */
export interface DerivedType {
  name: string;
  /** The rust-analyzer hover signature of the type (`pub struct Order {
   *  pub reference: String, ... }`) — the data-shape block emits this so the
   *  injected struct text stays byte-identical to the prefill (which reads this
   *  same field). "" when hover did not resolve (a cross-crate hover-only miss);
   *  renderDerivedDef then synthesizes from `fields`.
   *
   *  Verbatim except for ONE rewrite: a Rust enum's elided tuple-variant
   *  payloads are restored from the definition source (`enumPayloadsFromSource`),
   *  which refuses unless the source proves the answer. Nothing else edits it. */
  signature: string;
  fields: Array<{ name: string; typeName: string }>;
  methods: string[];
  methodsResolved: boolean;
  /** The URI of the file the type is DEFINED in (from `definition()`). Feeds the
   *  import-path hint so a blind test imports the type from where it lives
   *  instead of guessing `crate::` root. Undefined only on a synthesized type. */
  defUri?: string;
  /** For a Rust type alias (`type X = Target<..>`): the RHS head identifier the
   *  walk chased and resolved (tier 2). Present only when the chase anchored a
   *  cursor on the target ident in the alias's own decl line - the def-site-hop
   *  mechanism (spike-3b/3c: members resolve only from the target's def site).
   *  Rendering follows it as one extra data-shape edge, and the alias's method
   *  list is the target's, because a value of the alias type calls exactly
   *  those. Absent for every non-alias type: zero rendered bytes move. */
  aliasTarget?: string;
}

/** The bound on the cross-file walk. D_MAX is graph distance from the root
 *  (Order->Customer->Address is depth 2); N_MAX caps total distinct types so the
 *  payload cannot blow up geometrically. Mirrors dataShape.ts's bound, keeping
 *  the walk tightly scoped and selective. */
export interface CrossFileBound {
  D_MAX: number;
  N_MAX: number;
}

/** The derived shape: every reachable type keyed by name, plus the reachable
 *  type names NOT emitted (a bound cap OR an unresolvable/unanchorable edge) —
 *  never silent, and guaranteed disjoint from the emitted set. */
export interface CrossFileShape {
  types: Map<string, DerivedType>;
  dropped: string[];
  /** The root type's members removed by the construction narrowing, with their
   *  names and kinds intact, so the caller can say how many left and why. Absent
   *  unless the walk ran at a construction target. */
  narrowed?: CompletionMember[];
  /** The members removed by the VISIBILITY pass, each with the type it belonged
   *  to - the walk reaches more than one. Kept apart from `narrowed` because the
   *  two filters argue in opposite directions, and a caller that cannot tell them
   *  apart sends its reader hunting in the wrong subsystem. Absent unless the walk
   *  was given a visibility rule. */
  hidden?: Array<{ type: string; member: CompletionMember }>;
}

/** The visibility pass as the resolver takes it: the language's rule and its
 *  exempt scope, plus where the TARGET sits. The target half is what decides
 *  whether the rule runs for a given type at all - a member of a type the target
 *  is already inside is callable whatever its modifier says. */
export interface VisibilityPass extends LanguageVisibility {
  target: TargetScope;
}

/** Open the file at `uri` in the resolver's rust-analyzer session and return its
 *  text. Cross-file/crate resolution needs the definition's file open for
 *  membersOfType, and the resolver reads the text to locate the field-type
 *  reference cursor for the recursive walk. Returns undefined when the file
 *  cannot be opened (methods degrade to unknown; the walk cannot descend). */
export type FileOpener = (uri: string) => Promise<string | undefined>;

/** std/library container and wrapper types that are never a local struct to walk
 *  into: their PascalCase names appear in field types but resolving them is
 *  noise (and definition() would leave the crate). Primitives are lower-case and
 *  excluded by the PascalCase candidate filter already. */
export const STD_TYPE_NAMES = new Set([
  "String", "Vec", "Box", "Option", "Result", "Rc", "Arc", "Cell", "RefCell",
  "Mutex", "RwLock", "Cow", "HashMap", "HashSet", "BTreeMap", "BTreeSet",
  "VecDeque", "BinaryHeap", "LinkedList", "Range", "RangeInclusive", "Duration",
  "Instant", "PathBuf", "Path", "OsString", "OsStr", "Weak", "Pin", "Ordering",
  "PhantomData", "NonZero", "NonZeroU8", "NonZeroU16", "NonZeroU32", "NonZeroU64",
  "NonZeroUsize",
]);

/** Is this definition inside the Rust toolchain's own shipped source tree?
 *
 *  The companion to `STD_TYPE_NAMES` and deliberately not the same mechanism.
 *  That set guards the RECURSIVE HOP: it stops the walk descending into a
 *  container type named as a field. This guards the ROOT: whether a candidate
 *  gets a data shape and a member list rendered for it at all. `Path` is in the
 *  set above and still arrived at `load_api_keys` with a private field
 *  (`inner: OsStr`) and 24 method signatures including `from_u8_slice`,
 *  `as_u8_slice` and `from_inner_mut`, under a header reading "use these exact
 *  names, do not invent". A name set could not have caught that, because the
 *  root was never a field.
 *
 *  PROVENANCE, not names, on purpose. A blocklist has to be maintained against
 *  a standard library that grows, and it cannot distinguish a project's own
 *  `Path` from std's. The sysroot's source component lives under
 *  `<sysroot>/lib/rustlib/src/`, so everything below that segment is toolchain
 *  source by construction: rustup writes
 *  `~/.rustup/toolchains/<tc>/lib/rustlib/src/rust/library/std/src/path.rs`,
 *  and a distro-packaged toolchain writes the same tail under its own prefix.
 *  Matching the segment rather than the crate names means `std`, `core`,
 *  `alloc`, `proc_macro` and anything else the component ships are all covered
 *  without listing one of them.
 *
 *  Scoped to the sysroot and NOT widened to the cargo registry. A registry
 *  crate's API is a thing the model can genuinely be wrong about and its
 *  version is the project's choice, which is what the worked-example leg is
 *  for. The standard library is the one dependency every model has read.
 *
 *  Takes the URI as the resolver reports it, so a Windows path with backslashes
 *  and a percent-encoded `file://` URI both match.
 *
 *  The segment tested is `/lib/rustlib/src/rust/`, not the shorter
 *  `/lib/rustlib/src/`. The shorter one matches a workspace whose own crate is
 *  named `lib` (`/work/lib/rustlib/src/…`), and the two failure directions are
 *  not symmetric: refusing a stdlib type by mistake costs the prompt nothing it
 *  had before, while refusing a PROJECT type by mistake starves the model of the
 *  one thing it cannot know. So the test is the more specific one, and a layout
 *  it does not recognise degrades to today's behaviour rather than to silence.
 *  `rust/` is the directory the rust-src component unpacks into under both
 *  rustup and a distro-packaged toolchain. */
export function isRustSysrootDef(defUri: string): boolean {
  // TOTAL over any string a resolver can hand back. `decodeURIComponent` throws
  // URIError on a lone `%`, and this predicate is called from `resolvePrefill`'s
  // render loop OUTSIDE any try, so a throw there would take down the whole
  // prefill for one malformed URI. A percent-decode that fails means the raw form
  // is the best reading available, and the raw form still contains the segment
  // when the path is a real sysroot path.
  return normalizedDefPath(defUri).includes("/lib/rustlib/src/rust/");
}

/** Is this definition inside the cargo registry (or a git checkout cargo made)?
 *
 *  `isRustSysrootDef`'s sibling, same family, different external source. The
 *  segments are the ones cargo itself writes under CARGO_HOME
 *  (`~/.cargo/registry/src/<index>/<crate>-<ver>/…` and
 *  `~/.cargo/git/checkouts/…`); the `/.cargo/` prefix is what keeps a
 *  workspace crate NAMED `registry` (`/work/registry/src/lib.rs`) from
 *  matching, because the two failure directions are not symmetric - refusing
 *  an external by mistake costs the prompt nothing it had before this
 *  session, refusing a PROJECT def starves recovery of the one thing it
 *  exists to supply. A custom CARGO_HOME not ending in `.cargo` evades the
 *  test and degrades to pre-gate behaviour, never to silence. */
export function isCargoRegistryDef(defUri: string): boolean {
  const p = normalizedDefPath(defUri);
  return p.includes("/.cargo/registry/src/") || p.includes("/.cargo/git/checkouts/");
}

function normalizedDefPath(defUri: string): string {
  let normalized: string;
  try {
    normalized = decodeURIComponent(defUri);
  } catch {
    normalized = defUri;
  }
  return normalized.replace(/\\/g, "/");
}

// Split a struct body on top-level commas only, so a field type's own commas
// (`HashMap<u32, Vec<u64>>`) do not split it. Tracks the four bracket pairs a
// rust type can nest.
function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<" || c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ">" && (s[i - 1] === "-" || s[i - 1] === "=")) {
      // `->` and `=>` close nothing. Without this, the return arrow in a
      // rendered method signature (`fn get(&self, k: &str) -> Option<V>;`)
      // drives depth negative and a later param-list comma splits at "depth
      // 0" - the phantom-field defect off recovered trait surfaces, and the
      // same miscount `Box<dyn Fn(u8) -> u16>` fed struct fields all along.
    } else if (c === ">" || c === ")" || c === "]" || c === "}") {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** Parse a struct hover signature into its named fields, each as
 *  `{ name, typeName }` with the type AS WRITTEN. Reads the `{...}` body, splits
 *  top-level fields, and takes `[pub] name: Type` per field. An enum, a tuple
 *  struct, or a bodyless signature yields [] — the walk then has no field edges,
 *  the honest degrade. Exported for the fidelity oracle's shape check. */
export function parseStructHoverFields(signature: string | undefined): Array<{ name: string; typeName: string }> {
  if (!signature) {
    return [];
  }
  const open = signature.indexOf("{");
  const close = signature.lastIndexOf("}");
  if (open < 0 || close < 0 || close <= open) {
    return [];
  }
  const body = signature.slice(open + 1, close);
  const fields: Array<{ name: string; typeName: string }> = [];
  for (const part of splitTopLevelCommas(body)) {
    const t = part.trim();
    if (t.length === 0) {
      continue;
    }
    const m = /^(?:pub\s*(?:\([^)]*\))?\s+)?([A-Za-z_]\w*)\s*:\s*([\s\S]+)$/.exec(t);
    if (m) {
      fields.push({ name: m[1], typeName: m[2].trim() });
    }
  }
  return fields;
}

// The distinct PascalCase struct/enum type names named in ONE field's type, in
// first-seen order, minus std containers/wrappers (per-language via `std`).
// `Vec<LineItem>` yields `LineItem`; `Customer` yields `Customer`;
// `String`/`u32` yield nothing.
function candidateTypesOf(typeName: string, std: Set<string> = STD_TYPE_NAMES): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of typeName.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    const name = m[1];
    if (seen.has(name) || std.has(name)) {
      continue;
    }
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Per-language parsing/rendering hooks for the ONE resolver.
 * Language-specific pieces only - hover-field parsing, the recursive-hop field
 * anchor, def rendering, the std stop-set - never a second resolver or a
 * language branch inside the walk. Absent hooks mean the Rust defaults, byte-
 * identical to the pre-hook behavior; the frozen Rust suites hang on that.
 */
export interface CrossFileShapeHooks {
  /** Def-site hover signature -> named fields (Rust default: parseStructHoverFields). */
  parseHoverFields: (signature: string | undefined) => Array<{ name: string; typeName: string }>;
  /** Anchor a field's own type token inside the def body for the recursive hop
   *  (Rust default: the line-anchored fieldTypeCursor). */
  fieldTypeCursor: (
    lines: string[],
    range: { open: number; close: number },
    fieldName: string,
    candType: string,
  ) => { line: number; character: number } | undefined;
  /** Render one derived type's def text (Rust default: renderDerivedDef). */
  renderDef: (t: DerivedType) => string;
  /** Library/container names never walked into (Rust default: STD_TYPE_NAMES). */
  stdTypeNames: Set<string>;
  /** Refuse a def-site hover that is language-service chrome, not a type
   *  definition (a TS type parameter hovers as `(type parameter) T in type
   *  Order<T>`); the walk then records the name as a stop edge instead of
   *  emitting the chrome as a def. Absent (Rust): no hover is ever refused. */
  refuseHover?: (signature: string) => boolean;
  /** Skip a field-type candidate name before the recursive hop (TS: a bare
   *  single-letter generic - `T[]` must never queue `T`). `fieldType` is the
   *  owning field's type AS WRITTEN, which is the only place a package
   *  qualifier survives: `candidateTypesOf` strips it, so `*testing.T` and
   *  `[]T` both arrive as `T` and only Go's rule needs to tell them apart.
   *  Absent (Rust): every candidate queues, unchanged. */
  skipCandidate?: (name: string, fieldType?: string) => boolean;
  /** OPT-IN SIGNATURE-edge source (C#): given a resolved type's rendered member
   *  SIGNATURES (the `methods` string[]), the distinct user types named in their
   *  return/param/property positions to recurse into — the collaborator graph a
   *  C# hover cannot express as field edges. This is a DIFFERENT traversal than
   *  the default FIELD-edge walk, added ALONGSIDE it. Absent (Rust/TS/Python):
   *  no signature edges — field edges only, byte-identical to the pre-hook walk.
   *  Anchoring uses the extractor's OPTIONAL resolveTypeCursorByName (the
   *  capability-gated cross-project by-name resolver); when EITHER this hook or
   *  that capability is absent, the walk stays field-only. */
  signatureRefTypes?: (methods: string[]) => string[];
  /** The rendered line for ONE member of a type that rendered no signatures at
   *  all, or undefined when this member is not one the hook speaks for. Exists
   *  for enums, whose variants arrive as bare names: the name IS the surface, so
   *  a language that can recognise its own enum hover spells the variant rather
   *  than letting the whole type go dark. Absent (Rust, whose hover already
   *  carries the variants in the def text): unchanged.
   *
   *  `defLines` is the declaring file's own source, the same text `rewriteMembers`
   *  gets — C# never needs it (Roslyn's hover already says `enum Atlas.LodBand`),
   *  Python does: pyright's class hover and its documentSymbol kind both turned
   *  out not to say "enum" (see pyExtraction.ts's pyEnumBaseDecl), so Python reads
   *  the `class LodBand(IntEnum):` line instead. */
  enumMemberLine?: (
    member: CompletionMember,
    typeName: string,
    typeSignature: string | undefined,
    defLines: readonly string[],
  ) => string | undefined;
  /** Rewrite the resolved members before they are rendered, given the type's own
   *  hover and the lines of the file it is declared in. Exists for one fact the
   *  transport does not carry: which members are STATIC, and therefore have to
   *  be spelled through their type to be callable at all. Absent (Rust, TS,
   *  Python): members render exactly as they resolved. */
  rewriteMembers?: (
    members: readonly CompletionMember[],
    typeSignature: string | undefined,
    defLines: readonly string[],
  ) => CompletionMember[];
}

/** The TS hooks: quickinfo-object-type field parsing, mid-line field anchoring,
 *  `interface X { ... }` def synthesis, lib.d.ts stop names. */
export const tsShapeHooks: CrossFileShapeHooks = {
  parseHoverFields: parseTsHoverFields,
  fieldTypeCursor: tsFieldTypeCursor,
  renderDef: tsRenderDerivedDef,
  stdTypeNames: TS_STD_TYPE_NAMES,
  // tsserver quickinfo for a type parameter is chrome, not TS syntax; emitting
  // it as a def pollutes the injected block.
  refuseHover: (signature) => signature.startsWith("(type parameter)"),
  skipCandidate: (name) => /^[A-Z]$/.test(name),
};

/** The C# hooks: a C# type hover is `class Live.Widget` with no field body, so
 *  parseHoverFields yields [] and the walk never recurses on fields — the C#
 *  surface is SIGNATURES-ONLY, its methods resolved through
 *  membersOfType (documentSymbol). No field-edge recursion, so fieldTypeCursor is
 *  never reached; renderDef returns the raw hover for the rare data-shape caller.
 *  The Rust struct-field parser would misread a C# hover, so C# gets its own
 *  empty field parser rather than falling to the Rust default. */
export const csShapeHooks: CrossFileShapeHooks = {
  parseHoverFields: () => [],
  fieldTypeCursor: () => undefined,
  renderDef: (t) => t.signature,
  stdTypeNames: CS_STD_TYPE_NAMES,
  // C# has no field body to walk, so its collaborator graph is projected through
  // member SIGNATURES instead: the types named in return/param/property positions,
  // anchored cross-project via the extractor's resolveTypeCursorByName. Only C#
  // sets this hook, so only C# gets signature-edge recursion.
  signatureRefTypes: csSignatureRefTypes,
  // Roslyn hovers an enum as `enum Atlas.LodBand` and returns its variants as
  // signature-less fields. `Type.Variant` is what the model has to type, and it
  // is exactly the shape the diagnostic-keyed leg already renders for the same
  // enum, so the two surfaces read alike wherever both can fire.
  enumMemberLine: (member, typeName, typeSignature) =>
    /^enum\b/.test((typeSignature ?? "").trim()) && member.signature === undefined
      ? `${typeName}.${member.name}`
      : undefined,
  // A static is not callable by its bare name, and Roslyn's documentSymbol does
  // not say which members are static. The modifier is on the declaration line,
  // which the visibility pass already reads out of the same def text.
  rewriteMembers: csQualifyStatics,
};

/** The Python std/typing type names never walked into: builtins (lowercase ones
 *  never match the PascalCase scan, but the capitalized `typing` aliases and
 *  container generics do) plus the common `typing` surface. The Python sibling of
 *  CS_STD_TYPE_NAMES / TS_STD_TYPE_NAMES. */
export const PY_STD_TYPE_NAMES = new Set([
  "None", "True", "False", "Any", "Optional", "Union", "List", "Dict", "Set",
  "Tuple", "FrozenSet", "Type", "Callable", "Sequence", "Iterable", "Iterator",
  "Mapping", "MutableMapping", "Generator", "Awaitable", "Coroutine", "AsyncIterator",
  "AsyncIterable", "Literal", "Final", "ClassVar", "Annotated", "TypeVar", "Generic",
  "Protocol", "NamedTuple", "TypedDict", "Self", "Never", "NoReturn", "Object",
]);

/** The Python hooks: a pyright class hover is `class Foo` with no field body, so
 *  parseHoverFields yields [] and the walk never recurses on fields — the Python
 *  surface is SIGNATURES-ONLY, its methods resolved through documentSymbol /
 *  completeMembers, exactly like C#. The Rust struct-field parser would misread a
 *  pyright hover, so Python gets its own empty field parser rather than falling to
 *  the Rust default. */
export const pyShapeHooks: CrossFileShapeHooks = {
  parseHoverFields: () => [],
  fieldTypeCursor: () => undefined,
  renderDef: (t) => t.signature,
  stdTypeNames: PY_STD_TYPE_NAMES,
  // An Enum's variants resolve with no signature, same hole C# fills with
  // `enumMemberLine` — but pyright's hover never names the base class
  // (`(class) LodBand`, plain class or Enum subclass alike) and its
  // documentSymbol kind for a member turned out to be an ALL_CAPS naming
  // heuristic, not an Enum signal (pyExtraction.ts's pyEnumBaseDecl doc
  // comment has the live evidence). Only the declaration source says the
  // truth, so this reads `defLines` for `class LodBand(IntEnum):` and renders
  // every no-signature member as `Type.Variant` when it finds one — otherwise
  // undefined, same as an ordinary field staying dark.
  enumMemberLine: (member, typeName, _typeSignature, defLines) =>
    member.signature === undefined && pyEnumBaseDecl(defLines, typeName)
      ? `${typeName}.${member.name}`
      : undefined,
};

/** The Go hooks. ONE thing differs from the Rust defaults this language used to
 *  run on: the def RENDERER. A gopls hover is the declaration plus the source's
 *  own doc comments plus gopls's `// size=728 (0x2d8), class=768 (0x300)` layout
 *  chrome, and the product was emitting all of it. Measured live on the v23
 *  corpus: `cobra.Command` hovers at 8363 bytes and elides to 1944, `gin.Engine`
 *  4255 to 811. Nothing in a prompt reads a byte offset.
 *
 *  The FIELD leg deliberately stays on the Rust defaults, byte for byte. Go's
 *  hover writes `Name Type` where the Rust parser wants `name: Type`, so it
 *  parses nothing and the walk has no field edges — dark, not wrong. Lighting
 *  that leg up is a different change with its own measurement, and this one is
 *  the renderer.
 *
 *  `skipCandidate` is here anyway, and it is the qualifier-aware rule the
 *  warning inside resolveCrossFileShape demands: the Go standard library
 *  declares 186 single-letter structs (`testing.T`, `testing.B`, `testing.F`,
 *  `testing.M`), and the single-letter default would drop every one of them the
 *  day someone lands a Go field parser. A guard whose case is unreachable today
 *  is still the guard that has to be right when the door opens. */
export const goShapeHooks: CrossFileShapeHooks = {
  parseHoverFields: parseStructHoverFields,
  fieldTypeCursor,
  renderDef: (t) =>
    // A hover-less type names itself and claims nothing about its shape. The
    // Rust default synthesizes `struct X { }` here, which for Go would be an
    // invented declaration in another language's syntax.
    t.signature.length > 0 ? goElideDef(t.signature).text : `type ${t.name}`,
  stdTypeNames: STD_TYPE_NAMES,
  skipCandidate: (name, fieldType) => {
    if (!/^[A-Z]$/.test(name)) {
      return false;
    }
    // `candidateTypesOf` has already stripped the package qualifier, so the
    // bare name cannot tell `*testing.T` from `[]T`. The field type AS WRITTEN
    // can: an occurrence that is not preceded by a `.` is a type parameter.
    return fieldType === undefined || new RegExp(`(^|[^.\\w])${name}\\b`).test(fieldType);
  },
};

/** The hook registry consumers dispatch on: TS-family ids get the TS hooks,
 *  csharp the C# hooks, python the Python hooks, go the Go hooks, everything
 *  else the Rust defaults (undefined). */
export function shapeHooksFor(languageId: string): CrossFileShapeHooks | undefined {
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return tsShapeHooks;
  }
  if (languageId === "csharp") {
    return csShapeHooks;
  }
  if (languageId === "python") {
    return pyShapeHooks;
  }
  if (languageId === "go") {
    return goShapeHooks;
  }
  return undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The [openLine, closeLine] line span of the brace body of the struct whose name
// sits at `cursor` in `text`. Scans forward from the cursor for the first `{`
// (bailing on a `;` first — a unit/tuple struct has no brace body) then matches
// the closing `}` by brace depth. undefined when there is no brace body.
function structBodyLineRange(
  text: string,
  cursor: SourceCursor,
): { open: number; close: number } | undefined {
  const lines = text.split("\n");
  let openLine = -1;
  let openCh = -1;
  for (let i = cursor.line; i < lines.length && openLine < 0; i++) {
    const from = i === cursor.line ? cursor.character : 0;
    const brace = lines[i].indexOf("{", from);
    const semi = lines[i].indexOf(";", from);
    if (semi >= 0 && (brace < 0 || semi < brace)) {
      return undefined; // `struct Foo;` / `struct Foo(...);` — no brace body
    }
    if (brace >= 0) {
      openLine = i;
      openCh = brace;
    }
  }
  if (openLine < 0) {
    return undefined;
  }
  let depth = 0;
  for (let i = openLine; i < lines.length; i++) {
    const line = lines[i];
    for (let j = i === openLine ? openCh : 0; j < line.length; j++) {
      if (line[j] === "{") {
        depth++;
      } else if (line[j] === "}") {
        depth--;
        if (depth === 0) {
          return { open: openLine, close: i };
        }
      }
    }
  }
  return undefined;
}

/** A source cursor on the candidate type token WITHIN the parent struct's own
 *  declaration of field `fieldName`. Finds the field-binding line inside the
 *  struct body (`^ [pub] fieldName :`), then the candidate token after the colon.
 *  Anchoring at the field's OWN type token (not a bare-name search of the file)
 *  is what makes definition() resolve the field's ACTUAL type in the parent's
 *  scope, so a same-named shadowing type is never walked into. undefined when the
 *  field or the token is not locatable on its declaration line (a stop edge). */
function fieldTypeCursor(
  lines: string[],
  range: { open: number; close: number },
  fieldName: string,
  candType: string,
): { line: number; character: number } | undefined {
  const fieldRe = new RegExp(`^\\s*(?:pub\\s*(?:\\([^)]*\\))?\\s+)?${escapeRe(fieldName)}\\s*:`);
  const candRe = new RegExp(`\\b${escapeRe(candType)}\\b`);
  for (let i = range.open; i <= range.close; i++) {
    const line = lines[i];
    const fm = fieldRe.exec(line);
    if (!fm) {
      continue;
    }
    const colon = line.indexOf(":", fm[0].length - 1);
    const searchFrom = colon >= 0 ? colon + 1 : fm[0].length;
    const cm = candRe.exec(line.slice(searchFrom));
    if (cm) {
      return { line: i, character: searchFrom + cm.index };
    }
    return undefined; // field found but candidate not on its line — stop edge
  }
  return undefined;
}

// The identifier word covering `cursor` in `text` — the type name the caller
// clicked. undefined when the cursor sits off any word.
function identifierAt(text: string, cursor: SourceCursor): string | undefined {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) {
    s--;
  }
  while (e < line.length && isWord(line[e])) {
    e++;
  }
  const word = line.slice(s, e);
  return word.length > 0 ? word : undefined;
}

// Rendered inherent-method signatures from a member list, one per entry: reuses
// the fn-gen/FIM payload filter (drops fields — no signature — and universal
// blanket-trait noise). [] when there are no renderable methods.
//
// The construction member is dropped here and not upstream. This list is
// rendered under a header naming these as the exact names to type, where
// `constructor Order(...)` invites `o.constructor(...)` — Object.prototype, not
// the class. `keepConstruction` inverts that at a construction target, where the
// member carrying the type's arity is the whole point of the block; the member
// set itself keeps it either way.
function renderMethods(members: CompletionMember[], typeName: string, keepConstruction = false): string[] {
  const kept = keepConstruction ? members : members.filter((m) => !isConstructionMember(m.name, typeName));
  const joined = renderMemberSignatures(kept);
  return joined.length > 0 ? joined.split("\n").filter((l) => l.length > 0) : [];
}

/** Keep this member on the CONSTRUCTION surface (case B)? Asked of the member,
 *  never of its rendered text, because the two answers differ: a field whose
 *  type is a function renders `on_tick: fn(u64) -> bool` precisely so nothing
 *  reads it as a call, and a filter that classifies by the presence of parens
 *  or an arrow deletes it from the one surface that must list every field a
 *  constructor fills.
 *
 *  Three keeps and a drop. Data is kept because data is what a constructor
 *  fills. The language's own construction member is kept because it IS the
 *  constructor, which also overrides the member-site noise rules that would
 *  strip it (`__init__` is noise at a completion site and the headline here).
 *  A callable is kept when it can produce the type. Everything else goes. */
export function keepAtConstructionTarget(
  member: CompletionMember,
  typeName: string,
  style: ReturnStyle,
): boolean {
  if (member.kind !== "method" && member.kind !== "function") {
    return true;
  }
  if (isConstructionMember(member.name, typeName)) {
    return true;
  }
  return producesType(member.signature, typeName, style);
}

// The construction member's name, per language: TypeScript and JavaScript spell
// it `constructor`, Python `__init__`, C# the type's own name. The last one
// cannot collide with an ordinary member, because C# forbids a member sharing
// its enclosing type's name (CS0542).
export function isConstructionMember(name: string, typeName: string): boolean {
  return name === "constructor" || name === "__init__" || name === typeName;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function safe<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch {
    return undefined;
  }
}

// Hover at a freshly resolved def can lag a didOpen; poll briefly so a real
// struct is not read as an unresolved miss. undefined only after the buffer
// stays unresolved past the window (a genuine non-struct / unresolved edge).
async function hoverWithSettle(
  extractor: SurfaceExtractor,
  cursor: SourceCursor,
): Promise<{ signature: string } | undefined> {
  for (let i = 0; i < 12; i++) {
    const hover = await safe(extractor.hoverSurface(cursor));
    if (hover) {
      return hover;
    }
    await delay(50);
  }
  return undefined;
}

// membersOfType right after a cold-file didOpen can return [] before RA has the
// documentSymbol ready (the cold-file race). When the type
// itself resolved (hover succeeded), retry briefly; an empty result after the
// window is the honest "no file-local members" (e.g. a field-only struct).
async function membersWithSettle(
  extractor: SurfaceExtractor,
  cursor: SourceCursor,
  typeName: string,
  hadHover: boolean,
): Promise<CompletionMember[]> {
  // Re-poll while nothing renders AND a re-poll could plausibly change that. The
  // first membersOfType touch of a just-opened def file has its hover fan-out cut by
  // HOVER_FANOUT_BUDGET_MS, and the one member that answers cold is often the
  // constructor - which renderMethods drops - leaving a set that renders to nothing;
  // settling only on `length === 0` never re-polls it, so a seven-method type reads
  // as a type with none (session-v21 goal item 8 / §1b). But re-polling on
  // `renderMethods === 0` ALONE also fires on a FULLY-SETTLED field-only struct
  // whose members carry no signature (a Rust data struct: fields render bare), which
  // burns 3x40ms=120ms recovering nothing - the very shape this session began at
  // (goal item 8 review F2). So re-poll only when the set is empty, OR a re-poll
  // could still add a renderable method: an UNSIGNED callable member is pending its
  // signature, or the fan-out already SIGNED the constructor (proof it is landing
  // answers, so the rest are likely coming). A set whose only members are unsigned
  // NON-callables (a pure field/data struct) matches none of these and does not
  // re-poll.
  const isCallable = (m: CompletionMember) => m.kind === "method" || m.kind === "function";
  const mayRepollHelp = (ms: CompletionMember[]) =>
    ms.length === 0 ||
    ms.some((m) => m.signature === undefined && isCallable(m) && !isConstructionMember(m.name, typeName)) ||
    ms.some((m) => m.signature !== undefined && isConstructionMember(m.name, typeName));
  let members = (await safe(extractor.membersOfType(cursor))) ?? [];
  for (let i = 0; i < 3 && hadHover && renderMethods(members, typeName).length === 0 && mayRepollHelp(members); i++) {
    await delay(40);
    members = (await safe(extractor.membersOfType(cursor))) ?? [];
  }
  return members;
}

/** Resolve the cross-file/cross-crate shape reachable from the type reference at
 *  `rootSite`, walking field-type edges to `bound`. Uses `definition()` to cross
 *  file/crate boundaries, `hoverSurface` for fields, `membersOfType` for methods.
 *  Never throws: an unresolvable edge degrades to a stop (recorded in `dropped`),
 *  an empty result is the honest "nothing derivable". Terminates on cycles,
 *  self-reference, and diamonds via the emit-once `visited` set, bounded by
 *  D_MAX (depth) and N_MAX (total types). `hooks` swaps the language-specific
 *  parsing pieces (per CrossFileShapeHooks); absent means Rust, unchanged.
 *  A supplied `rootName` is cross-checked against `rootSite` and a disagreement
 *  is a miss; `constructionStyle` narrows the ROOT's members to the ones that
 *  can build it. Both are inert when omitted. */
export async function resolveCrossFileShape(
  extractor: SurfaceExtractor,
  rootSite: SourceCursor,
  bound: CrossFileBound,
  openFile: FileOpener,
  hooks?: CrossFileShapeHooks,
  // The root type's name, when the caller already knows it from something other
  // than the buffer — a symbol node's own name. Omitted, the name is read off the
  // identifier under `rootSite`, which is what a caller that only has a cursor
  // has to do. Supplied, it is cross-checked against `rootSite` (see below).
  rootName?: string,
  // The ROOT type is a construction target and its members are narrowed to the
  // ones that can build it, rendered in this language's return style. Absent (a
  // call target, and every non-receiver walk) means no narrowing at all. Never
  // applied past the root: a type reached by a field or signature edge is a
  // collaborator, not the thing being built.
  constructionStyle?: ReturnStyle,
  // Drop the members the target cannot legally call, by this language's own
  // signal, and only for the types whose scope the target is OUTSIDE of. OPT-IN,
  // and that is the scope boundary: this resolver also serves the FIM whole-block
  // injection, which this phase must not move a byte of. Absent means no
  // visibility pass ran and every member survives, unchanged.
  visibility?: VisibilityPass,
): Promise<CrossFileShape> {
  const parseFields = hooks?.parseHoverFields ?? parseStructHoverFields;
  const anchorFieldType = hooks?.fieldTypeCursor ?? fieldTypeCursor;
  const stdNames = hooks?.stdTypeNames ?? STD_TYPE_NAMES;
  const signatureRefTypes = hooks?.signatureRefTypes;
  // A single uppercase LETTER in a field's generic argument list is a type
  // parameter, never a concrete type, and the walk must not spend a definition
  // round trip on one. This was a TypeScript-only guard, set in `tsShapeHooks`;
  // Rust runs on these defaults with no hooks object at all, so it queued every
  // parameter it met. Measured live on `acme-db`: a private
  // `LruCache<K, V, S>` field put `K`, `V` and `S` into the walk, `K` resolved to
  // a bare line in the injected prompt, and `V` and `S` were reported as dropped
  // types. Six extractor calls per parameter, eighteen in that one walk, for
  // names that cannot resolve by construction.
  //
  // Single letter, and deliberately not "short": `Ok`, `Vec`, `T1` and `Kind`
  // are real names in these languages and the over-correction would cost far
  // more than the noise does. For RUST that trade is measured at zero: 621 files
  // of `acme-db` declare no single-letter struct, enum, trait or union, and
  // all 17 single-letter field positions in it are parameters.
  //
  // GO IS NOT SAFE UNDER THIS RULE: the Go standard library declares 186
  // single-letter structs, `testing.T`, `testing.B`, `testing.F` and
  // `testing.M` among them, and `candidateTypesOf` strips the package qualifier
  // so `*testing.T` arrives here as `T`. `goShapeHooks` therefore sets its own
  // qualifier-aware rule, reading the field type AS WRITTEN (see there). Go's
  // field leg is dark today - `parseStructHoverFields` wants Rust's `name: type`
  // and a gopls hover writes `name type` - so the rule guards a door rather than
  // a live path; see session-v30/scraps.md.
  const skipCandidate = hooks?.skipCandidate ?? ((name: string) => /^[A-Z]$/.test(name));
  const enumMemberLine = hooks?.enumMemberLine;
  const types = new Map<string, DerivedType>();
  const droppedSet = new Set<string>(); // reachable-but-not-emitted (cap OR stop edge)
  const visited = new Set<string>(); // names already emitted (emit-once, cycle/diamond stop)
  const queuedSig = new Set<string>(); // signature-edge names already queued (dedup the by-name LS anchor)

  const narrowed: CompletionMember[] = []; // root members the construction narrowing removed
  const hidden: Array<{ type: string; member: CompletionMember }> = []; // members the visibility pass removed

  // A supplied root NAME and the root SITE are two answers to the same question:
  // the block is headed with the name, and its contents come from the site. Where
  // they disagree, one symbol's members ship under another's header — an anchor
  // landing on an attribute, on a base clause, on a receiver binding, or anywhere
  // else off the name token. So the name is trusted only where the identifier
  // under the anchor IS it. Line granularity is not enough: a base clause, an
  // `extends`, a base list and a trait name all sit on the declaration's own
  // line, and every measured server anchors at the name token. Disagreement is
  // the empty shape, the existing miss path.
  // The shape as it stands, with each optional half present iff the pass that
  // fills it was asked for - so "the walk ran and hid nothing" and "no visibility
  // pass ran at all" stay different answers at every exit.
  const shapeSoFar = (): CrossFileShape => {
    const shape: CrossFileShape = { types, dropped: [...droppedSet].filter((d) => !types.has(d)) };
    if (constructionStyle) {
      shape.narrowed = narrowed;
    }
    if (visibility) {
      shape.hidden = hidden;
    }
    return shape;
  };

  const rootText = await openFile(rootSite.uri);
  const under = rootText === undefined ? undefined : identifierAt(rootText, rootSite);
  const agrees = rootName === undefined || under === rootName;
  const root = agrees ? (rootName ?? under) : undefined;
  if (!root) {
    return shapeSoFar();
  }
  // NO single-letter guard at the ROOT, and that is a decision rather than an
  // omission. A root is HANDED to the walk, and the callers that hand one in
  // have information this function does not: `prioritizedTypes` resolves a
  // doc-named `T` against the file's OWN type definitions, so a one-character
  // root can be a real local type the human wrote. `blind-v7-prepare` freezes
  // exactly that ("doc-only local type T is anchored at its own def and gets
  // shape + methods"), and a guard here breaks it.
  //
  // The queue is different: a name reaches it out of a FIELD's generic argument
  // list, where a single letter is a type parameter and nothing else.
  //
  // The root hole is real and is scoped in session-v30/scraps.md: it belongs
  // where `localTypeNames` is in scope, not here.

  // `viaAlias` marks an entry queued by the tier-2 alias chase. It carries two
  // rules the other edges do not: the target's def must pass the sysroot
  // provenance predicate (a std-target alias ships its one-line hover and the
  // chase is refused), and an alias reached THROUGH an alias is never chased
  // again - single hop, so a transitive alias chain stops honestly at tier 1.
  const queue: Array<{ refSite: SourceCursor; depth: number; name: string; viaAlias?: boolean }> = [
    { refSite: rootSite, depth: 0, name: root },
  ];

  while (queue.length > 0) {
    const { refSite, depth, name, viaAlias } = queue.shift() as {
      refSite: SourceCursor;
      depth: number;
      name: string;
      viaAlias?: boolean;
    };
    if (visited.has(name)) {
      continue; // already emitted via another path
    }
    if (types.size >= bound.N_MAX) {
      droppedSet.add(name); // total-type cap: named, never silent
      continue;
    }

    const defLoc = await safe(extractor.definition(refSite));
    if (!defLoc) {
      droppedSet.add(name); // unresolved reference: stop edge, recorded
      continue;
    }
    if (viaAlias === true && isRustSysrootDef(defLoc.uri)) {
      droppedSet.add(name); // tier 2 is for project targets; the std chase is refused on provenance
      continue;
    }
    const defCursor: SourceCursor = {
      uri: defLoc.uri,
      line: defLoc.range.startLine,
      character: defLoc.range.startCharacter,
    };

    // hover is RA-indexed and does NOT need the def file open, so it works even
    // for a cross-crate def we cannot sync; it is the field-shape floor.
    const hover = await hoverWithSettle(extractor, defCursor);
    if (hover !== undefined && hooks?.refuseHover?.(hover.signature)) {
      droppedSet.add(name); // chrome hover (a type parameter, not a type): stop edge
      continue;
    }

    // membersOfType (documentSymbol) DOES need the def file open. Open it; if we
    // cannot, methods degrade to unknown (the cross-crate caveat).
    const defText = await openFile(defLoc.uri);
    let methods: string[] = [];
    let methodsResolved = false;
    if (defText !== undefined) {
      const members = await membersWithSettle(extractor, defCursor, name, hover !== undefined);
      // TWO PASSES, and they stay two. Visibility asks whether the target may
      // call the member at all and KEEPS when it cannot tell; role asks whether
      // the member belongs on THIS target's surface and drops a public instance
      // method at a construction target on purpose. Both are right, and merged
      // into one pass a construction target loses a public producer whose
      // declaration line happens to be unreadable — the drop-on-uncertainty
      // failure arriving through the other door.
      //
      // Both run HERE, over structured members, at every type the walk reaches
      // for visibility and only at the root for role (depth 0 is the walk's own
      // entry point; every other name arrives on an edge). Downstream the members
      // are rendered strings, where the facts these turn on — is this a callable,
      // is it the construction member, where is it declared — are only
      // recoverable by re-parsing text that was rendered to hide them.
      let visible = members;
      // The filter answers "can THIS TARGET call it", and a type whose own scope
      // the target already sits inside answers yes for every member it has. The
      // exemption is the language's, not this walk's: Rust modules, Go packages
      // and C#/TypeScript types draw the line in three different places.
      if (visibility && !visibility.exempt({ name, defUri: defLoc.uri }, visibility.target)) {
        const ctx: VisibilityContext = {
          lines: defText.split("\n"),
          typeName: name,
          typeSignature: hover?.signature,
        };
        visible = [];
        for (const m of members) {
          if (visibility.rule(m, ctx) === "non-public") {
            hidden.push({ type: name, member: m });
          } else {
            visible.push(m);
          }
        }
      }
      const narrowing = depth === 0 ? constructionStyle : undefined;
      const kept = narrowing
        ? visible.filter((m) => keepAtConstructionTarget(m, name, narrowing))
        : visible;
      if (narrowing) {
        narrowed.push(...visible.filter((m) => !kept.includes(m)));
      }
      // The last thing before rendering: give the language a chance to say how a
      // member has to be SPELLED, which needs the declaring file's text and is
      // therefore knowable here and nowhere downstream.
      const spelled = hooks?.rewriteMembers
        ? hooks.rewriteMembers(kept, hover?.signature, defText.split("\n"))
        : kept;
      methods = renderMethods(spelled, name, narrowing !== undefined);
      // An ENUM resolves members with no signature to render: documentSymbol
      // names its variants and there is no hover or completionItem tail to hang
      // on them, so renderMemberSignatures drops every one and the type comes
      // back with nothing at all. That is the whole surface of an enum going
      // dark, and it is what let a repair round see `LodBand` named and never
      // learn a single variant (session-v28 live replay). The names ARE the
      // surface, so the language's hook spells them; a language with no hook is
      // unchanged, and a type the hook does not recognise as an enum is too.
      if (methods.length === 0 && enumMemberLine !== undefined) {
        const defLines = defText.split("\n");
        methods = kept
          .map((m) => enumMemberLine(m, name, hover?.signature, defLines))
          .filter((line): line is string => line !== undefined);
      }
      methodsResolved = true;
    }

    // The one place the stored signature is not the raw hover: rust-analyzer
    // elides parts of what it prints. A TUPLE VARIANT's payload
    // (`Constrained( /* … */ )` for `Constrained(u8)`), a STRUCT VARIANT's
    // payload (`Leader { /* … */ }`), and the whole tail of a member list past
    // its display cap (`/* … */` standing where a member would). Each deletes
    // exactly the fact the injection exists to supply. The def file is already
    // open two lines up, so the recovery costs no transport. It reads the
    // source, refuses on any disagreement with the hover, and returns the hover
    // byte for byte when it cannot prove the answer.
    //
    // Runs on the NO-HOOKS default path, which is Rust alone now that Go has
    // hooks. Go lost nothing by leaving: the recovery needs `enum <Name>` or
    // `struct <Name>` in the hover AND a Rust declaration body in the source,
    // and a gopls hover writes `type X struct`, which matches neither. Go's own
    // elision is a typed const set and a separate item.
    const raw = hover?.signature ?? "";
    const recovered = hooks === undefined ? recoverElidedSurface(raw, defText) : raw;
    // A TRAIT is the other Rust hole, and the opposite one: the hover is a bare
    // head (`pub trait Validate`) and documentSymbol reports no children, so
    // there is no elision marker and no member list — the server answered
    // empty, honestly. The signature is a trait's ENTIRE injected surface, so
    // it is recovered whole from the same def source, keyed on trait-shaped
    // hover plus empty members because that is all a trait leaves to key on.
    // Refusal returns the hover unchanged, so this cannot regress below the
    // four words the prompt carries today. Fields parse to nothing off a trait
    // surface - a trait has no fields to walk - but only because
    // splitTopLevelCommas does not count a return arrow's `>` as a close;
    // without that guard a method's param commas read as top-level and every
    // multi-parameter method sheds a phantom field that can ANCHOR on the
    // trait's own param-list lines and spend walk budget on junk edges.
    //
    // PROJECT traits only (goal decision rule 4): external traits ship dark
    // pending their own timed-read measurement, so a def in the sysroot or the
    // cargo registry refuses recovery and keeps today's bare head - the same
    // provenance family the alias chase applies at its own hop.
    const signature =
      hooks === undefined &&
      methods.length === 0 &&
      isBareTraitHover(recovered) &&
      !isRustSysrootDef(defLoc.uri) &&
      !isCargoRegistryDef(defLoc.uri)
        ? recoverTraitSurface(recovered, defText)
        : recovered;
    // Fields come off the RECOVERED signature, and that is the third loss being
    // repaired rather than a side effect. A cut member list prunes the walk's
    // GRAPH: `ServerMeta` hid `compression: CompressionMeta`, so nothing ever
    // resolved `CompressionMeta` at all. Recovery without this line restores the
    // line and still never follows the edge.
    //
    // Costs nothing where recovery refuses (the signature is then the raw hover,
    // byte for byte) and nothing in the four hooked languages (they never enter
    // the recovery). An enum gains no fields either way: `parseStructHoverFields`
    // needs `name: Type` at brace depth zero, and a variant's payload is inside
    // its own braces.
    const fields = parseFields(signature);
    if (!hover && !methodsResolved) {
      droppedSet.add(name); // could resolve nothing about this reference
      continue;
    }

    visited.add(name);
    const emittedType: DerivedType = { name, signature, fields, methods, methodsResolved, defUri: defLoc.uri };
    types.set(name, emittedType);

    if (depth >= bound.D_MAX) {
      continue; // at the depth frontier — no further edges from here
    }

    // TIER-2 ALIAS CHASE (Rust no-hooks path). An alias's hover is one line
    // and its documentSymbol has no children, so without this the name renders
    // its `type X = Y` line and nothing else while the surface the caller
    // needs lives on Y. The chase anchors a cursor on the RHS head ident in
    // the alias's OWN decl line and queues it as one more walk entry - same
    // caps, one extra hop, and the def-site provenance guard above decides
    // whether the target may be walked at all. `!viaAlias` is the single-hop
    // rule: a target that is itself an alias ships its own tier-1 line and
    // stops.
    if (hooks === undefined && viaAlias !== true && defText !== undefined) {
      const target = aliasChaseHead(signature, name);
      if (target !== undefined && !skipCandidate(target)) {
        const cur = aliasTargetCursor(defText, defLoc, target);
        if (cur) {
          emittedType.aliasTarget = target;
          if (!visited.has(target)) {
            queue.push({ refSite: cur, depth: depth + 1, name: target, viaAlias: true });
          }
        }
      }
    }

    // SIGNATURE-edge recursion (opt-in; C#): the collaborator graph a type
    // projects through its member SIGNATURES (return/param/property types), NOT
    // its fields — a C# hover has no field body, so the field-edge walk below is
    // dark for it. Fires only when the language sets signatureRefTypes AND the
    // extractor exposes the by-name resolver to anchor a referenced type
    // cross-project. Bounded by the SAME D_MAX (depth + 1) and N_MAX (the dequeue
    // cap), deduped via `visited` (emitted) and `queuedSig` (already anchored, so
    // a type two collaborators both reference is resolved once). Rust/TS/Python
    // set no hook, so this is skipped and the walk is byte-identical.
    if (signatureRefTypes && extractor.resolveTypeCursorByName) {
      for (const refType of signatureRefTypes(methods)) {
        if (stdNames.has(refType) || visited.has(refType) || queuedSig.has(refType)) {
          continue; // std stop-set, already emitted, or already anchored this walk
        }
        queuedSig.add(refType);
        const cur = await safe(extractor.resolveTypeCursorByName(refType));
        if (cur) {
          queue.push({ refSite: cur, depth: depth + 1, name: refType });
        } else {
          droppedSet.add(refType); // signature-named type we could not anchor — never silent
        }
      }
    }

    if (defText === undefined) {
      continue; // no def source to anchor FIELD edges in
    }
    const bodyRange = structBodyLineRange(defText, defCursor);
    const defLines = defText.split("\n");
    for (const f of fields) {
      for (const cand of candidateTypesOf(f.typeName, stdNames)) {
        if (skipCandidate(cand, f.typeName)) {
          continue; // a generic-parameter name, not a concrete type to derive
        }
        if (visited.has(cand)) {
          continue; // already emitted (diamond) - not re-walked
        }
        const cur = bodyRange ? anchorFieldType(defLines, bodyRange, f.name, cand) : undefined;
        if (cur) {
          queue.push({ refSite: { uri: defLoc.uri, line: cur.line, character: cur.character }, depth: depth + 1, name: cand });
        } else {
          droppedSet.add(cand); // could not anchor the field's own type token — never silent
        }
      }
    }
  }

  // An alias's callable surface IS its chased target's: the def-site hop
  // resolved the target's members, and a value of the alias type calls exactly
  // those through the alias name. Copied AFTER the walk because the target
  // resolves later in the queue than the alias that named it. Single hop by
  // construction: a target that is itself an alias was never chased, so there
  // is nothing transitive to inherit here.
  for (const t of types.values()) {
    if (t.aliasTarget !== undefined && t.methods.length === 0) {
      const target = types.get(t.aliasTarget);
      if (target !== undefined && target.methods.length > 0) {
        t.methods = target.methods;
        t.methodsResolved = t.methodsResolved || target.methodsResolved;
      }
    }
  }

  // A name dropped at one edge may be emitted via another path; the drop log must
  // name only types that truly did NOT make the shape (disjoint from emitted) -
  // which is what `shapeSoFar` computes.
  return shapeSoFar();
}

/** The anatomy of a type-alias declaration head, read off ONE line: the
 *  declared name, the alias's OWN generic-parameter names, and the offset of
 *  the declaration's `=`.
 *
 *  The `=` is the first one at angle-bracket depth ZERO past the generics. A
 *  generic-parameter DEFAULT (`pub type Cache<K = MyKey> = Store<K>` - legal,
 *  idiomatic) puts an earlier `=` INSIDE the brackets, and cutting there
 *  chases the default type and copies ITS methods onto the alias - a wrong
 *  surface in the compiler's voice. An assoc binding in an old-style where
 *  clause (`where I: Iterator<Item = u32>`) hides its `=` the same way. ONE
 *  helper on purpose: the head parse and the cursor anchor must make the SAME
 *  cut, or the anchor silently agrees with a wrong parse and nothing refuses.
 *
 *  undefined when the text is not an alias head, the generics do not close on
 *  the decl's line, or no depth-zero `=` exists there. */
function aliasDeclAnatomy(
  text: string,
): { name: string; params: readonly string[]; eq: number } | undefined {
  const head = /(?:^|\n)[ \t]*(?:pub[ \t]*(?:\([^)]*\)[ \t]*)?)?type[ \t]+([A-Za-z_][A-Za-z0-9_]*)/.exec(
    text,
  );
  if (!head) {
    return undefined;
  }
  let i = head.index + head[0].length;
  const nl = text.indexOf("\n", i);
  const lineEnd = nl === -1 ? text.length : nl;
  const params: string[] = [];
  while (i < lineEnd && (text[i] === " " || text[i] === "\t")) {
    i++;
  }
  if (text[i] === "<") {
    const open = i;
    let depth = 0;
    let close = -1;
    for (let j = open; j < lineEnd; j++) {
      if (text[j] === "<") {
        depth++;
      } else if (text[j] === ">") {
        depth--;
        if (depth === 0) {
          close = j;
          break;
        }
      }
    }
    if (close === -1) {
      return undefined; // generics that do not close on this line are not provable
    }
    // One parameter name per depth-1 comma segment. `'a` is a lifetime and
    // declares no type name; `const N: usize = 4` declares `N`; `K = MyKey`
    // and `T: Clone` declare their leading ident.
    let segStart = open + 1;
    let segDepth = 0;
    for (let j = open + 1; j <= close; j++) {
      const c = text[j];
      if (c === "<") {
        segDepth++;
      } else if (c === ">" && j < close) {
        segDepth = Math.max(0, segDepth - 1);
      }
      if ((c === "," && segDepth === 0) || j === close) {
        const p = /^(?:const[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(segStart, j).trim());
        if (p) {
          params.push(p[1]);
        }
        segStart = j + 1;
      }
    }
    i = close + 1;
  }
  let eq = -1;
  let depth = 0;
  for (let j = i; j < lineEnd; j++) {
    const c = text[j];
    if (c === "<") {
      depth++;
    } else if (c === ">" && text[j - 1] !== "-" && text[j - 1] !== "=") {
      depth = Math.max(0, depth - 1);
    } else if (c === "=" && depth === 0) {
      eq = j;
      break;
    }
  }
  if (eq === -1) {
    return undefined;
  }
  return { name: head[1], params, eq };
}

/** The target to chase out of an alias hover, or undefined. The hover must
 *  declare `type <name> = RHS` for THIS entry's name (a hover describing some
 *  other alias proves nothing), and the RHS must open with a DIRECT PascalCase
 *  ident, optionally behind `dyn`, that is NOT one of the alias's own generic
 *  parameters (`pub type Chan<Fut2> = Fut2` - the "target" is chrome, not a
 *  type, and walking it emits a junk def line). Everything else -
 *  `fn(u32) -> bool`, `[u8; N]`, a tuple, a path-qualified `ffi::RawHandle` -
 *  returns undefined: narrow on purpose, because an RHS this cannot read still
 *  ships its tier-1 line, while a wrong chase ships a wrong surface in the
 *  compiler's voice. */
function aliasChaseHead(signature: string, name: string): string | undefined {
  const decl = aliasDeclAnatomy(signature);
  if (!decl || decl.name !== name) {
    return undefined;
  }
  const nl = signature.indexOf("\n", decl.eq);
  const rhs = signature.slice(decl.eq + 1, nl === -1 ? signature.length : nl).trim();
  const head = /^(?:dyn[ \t]+)?([A-Z][A-Za-z0-9_]*)\b(?![ \t]*::)/.exec(rhs);
  if (!head || decl.params.includes(head[1])) {
    return undefined;
  }
  return head[1];
}

/** The chase cursor: the target ident inside the alias's own decl line in the
 *  DEF file, after the declaration's `=` (the SAME depth-aware cut as
 *  `aliasChaseHead`, via the shared anatomy - a first-`=` cut here would
 *  anchor a generic default's type and agree with the wrong parse). That
 *  position is the spike-3b/3c mechanism - the server resolves the target's
 *  definition from it, and members only answer at the def site the hop lands
 *  on. A decl whose RHS is not on the name's own line (a multi-line
 *  declaration) returns undefined and the chase is skipped: tier 1 still
 *  ships. */
function aliasTargetCursor(
  defText: string,
  defLoc: { uri: string; range: { startLine: number } },
  target: string,
): SourceCursor | undefined {
  const line = defText.split("\n")[defLoc.range.startLine];
  if (line === undefined) {
    return undefined;
  }
  const decl = aliasDeclAnatomy(line);
  if (!decl) {
    return undefined;
  }
  const m = new RegExp(`\\b${target}\\b`).exec(line.slice(decl.eq));
  if (!m) {
    return undefined;
  }
  return { uri: defLoc.uri, line: defLoc.range.startLine, character: decl.eq + m.index };
}

// A rendered method signature is constructor-shaped when its name is a known
// constructor (new/try_new/from/try_from/default/build/builder/with_*) OR it
// returns `Self` — the methods that BUILD the type, as opposed to consuming an
// instance. Case-insensitive on the name; the `-> Self` check is exact.
function isConstructorSig(sig: string): boolean {
  return (
    /^\s*(new|try_new|from|try_from|default|build|builder|with_[a-z0-9_]*)\s*[(<]/i.test(sig) ||
    /->\s*Self\b/.test(sig)
  );
}

/** The constructor-shaped signatures of every NON-root type in a resolved shape,
 *  each prefixed with its type (`Customer::new(display_name: String, ship_to:
 *  Address, tier: u8) -> Self`). test-gen injects these so a type with a private
 *  field is built via its constructor, not a struct literal that will not compile.
 *  Deterministic (shape insertion order), capped at MEMBER_CAP total lines.
 *  undefined when no non-root type has a constructor. */
export function nestedConstructors(shape: CrossFileShape, rootType: string): string | undefined {
  const lines: string[] = [];
  for (const [name, t] of shape.types) {
    if (name === rootType) {
      continue;
    }
    for (const sig of t.methods) {
      if (isConstructorSig(sig)) {
        lines.push(`${name}::${sig}`);
        if (lines.length >= MEMBER_CAP) {
          return lines.join("\n");
        }
      }
    }
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/** Render one derived type's `def` — the struct text the data-shape walk emits.
 *  Prefers the raw rust-analyzer hover signature (byte-identical to the
 *  prefill's data-shape half); falls back to a synthesized `struct T { fields }`
 *  only when hover did not resolve (a cross-crate hover-only miss), so a derived
 *  type is never emitted as an empty def. Fields only; the method list rides its
 *  own API-surface block. */
export function renderDerivedDef(t: DerivedType): string {
  if (t.signature.length > 0) {
    return t.signature;
  }
  const fields = t.fields
    .map((f) => (f.typeName.length > 0 ? `    ${f.name}: ${f.typeName},` : `    ${f.name},`))
    .join("\n");
  return `struct ${t.name} {\n${fields}\n}`;
}

/** Adapt a resolved cross-file shape to the pure, synchronous `resolveStruct`
 *  edge-resolver `walkDataShape` (src/core/dataShape.ts) consumes — the ONE seam
 *  every path unifies onto. `def` is the rendered struct; `fields`
 *  carries only the walkable edges (a field's inner struct/enum types), each
 *  `isLocal` iff the resolver itself derived that type (so it is a real edge to
 *  recurse, not a std/unresolved stop). walkDataShape is untouched by the
 *  adaptation: the 2-D bound still governs emission.
 *  `hooks` swaps the def renderer and std stop-set; absent means Rust, unchanged. */
export function toResolveStruct(
  shape: CrossFileShape,
  hooks?: CrossFileShapeHooks,
): (typeName: string) => StructResolution | undefined {
  const renderDef = hooks?.renderDef ?? renderDerivedDef;
  const stdNames = hooks?.stdTypeNames ?? STD_TYPE_NAMES;
  return (typeName) => {
    const t = shape.types.get(typeName);
    if (!t) {
      return undefined;
    }
    const fields: StructResolution["fields"] = [];
    for (const f of t.fields) {
      for (const cand of candidateTypesOf(f.typeName, stdNames)) {
        // isLocal == "the resolver derived this type", i.e. a walkable edge.
        fields.push({ name: f.name, typeName: cand, isLocal: shape.types.has(cand) });
      }
    }
    if (t.aliasTarget !== undefined) {
      // The alias's one walkable edge (tier 2): the target's def renders right
      // after the alias's own `type X = Y` line, so the block speaks both
      // names and then shows the surface they share.
      fields.push({ name: t.name, typeName: t.aliasTarget, isLocal: shape.types.has(t.aliasTarget) });
    }
    return { def: renderDef(t), fields };
  };
}
