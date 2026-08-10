// Per-language INPUT DATA for the product-transport contract suite.
//
// Every coordinate here is expressed as a text needle plus an offset into it,
// never as a hardcoded line/column, so the dogfood repos can move without
// silently re-pointing an assertion at the wrong token.
//
// `forbidden` is the identity axis. It lists members of the SIBLING containers
// that sit near the type under test: the static helper class, the collection
// class, the enclosing playground class. If any of these come back from a
// request for `Tile`'s members, the payload is WRONG rather than merely empty,
// which is the v15 defect class.
//
// `knownLeaks` is the other half of that honesty. These names DO come back from
// a request for `Tile` and are not `Tile`'s members. They are declared here
// rather than added to `forbidden` because the member-list noise they represent
// is tracked as its own work in `docs/roadmap.md`; asserting on them would make
// this tier red for a defect it was not built to report. Declared, they stop a
// green from being read as "identity is clean on the completion path".
//
// `ownExtras` is `Tile`'s own surface beyond `required` — privates, the
// constructor, associated functions. Listing it keeps the undeclared-name
// report free of members that are not leaks at all, so anything it does print
// is a real gap in the two lists above.
//
// `productSignatures` declares whether the PRODUCT transport hands back members
// carrying a signature today, which is per-language and not a property of the
// tier. Half the v15 defect was members arriving with real names and no
// signatures, so a row that delivers them is held to it; a row that does not is
// named as pending rather than skipped, because a silent skip is how that
// defect stayed green. `delivered: false` REQUIRES a `pending` reason, enforced
// at the bottom of this file.
//
// `construction` names the one member that carries the type's construction
// arity, plus what that arity is. The whole argument-type feature exists so the
// model writes `Tile(1, 0)` rather than `Tile(1)`, and this member is the only
// one that can say so.
//
// `selfQualified` lists the members whose rendered signature is ALLOWED to name
// the type. A type-qualified instance member (`Tile.band: LodBand`) is a name
// the model cannot type at a `t.` site, so it is refused everywhere except
// where the qualifier is how you really call the thing.
//
// `provenanceFabrication` grades the provenance axis itself. Each entry is a
// pair of rendered lines for one real member: `refused`, built from identifiers
// the member's BODY names and its declaration does not, and `accepted`, the
// true line. Provenance once read the whole documentSymbol range, so a method's
// body was evidence about its own signature and
// `constructor Tile(mortonCode: MAX_LOD, lod: Math): Tile` passed. The pair
// catches that in both directions: too much graded text accepts the
// fabrication, too little rejects the truth.
//
// `gestureSite` is where the sticky-selection e2e runs: arrow through the
// native suggest widget, Escape, Tab, and check the member that LANDED is the
// member that was highlighted. `family` is the whole point of the row. The three
// names are prefixes of each other (`enroll` -> `enrollTile` -> `enrollBatch`),
// because serving `enrollTile` where the user highlighted `enroll` is the exact
// defect the feature prevents and a member set without prefix sharing cannot
// detect it. Their arities differ (1, 2, 3) so a wrong pick is visible in the
// landed call text and not only in the name.
//
// Coordinates follow `dotSite`: an `anchor` already in the repo plus an `insert`
// the test applies and reverts, so no dogfood repo has to carry a line that does
// not compile. `separator` is the character the widget's replace range starts
// at. Rust uses `.` for a method on a value and `::` for an associated function;
// this site is a method call, so `.`.
//
// `gestureSite.lands` is the end-of-gesture contract, and it exists because the
// obvious version of this test is dishonest. Asserting the member name ONLY when
// something landed makes a completely dead feature green on every row: nothing
// commits, nothing is compared, mocha exits 0. So `lands: true` means Escape then
// Tab MUST put the highlighted member in the buffer, and an empty commit is a
// failure. A row that legitimately serves nothing declares `lands: false` with a
// `landsPending` reason, enforced at the bottom of this file, so the exemption is
// checked-in text rather than a silent pass.
//
// No row declares false today, rust included. rust-analyzer's `fill_arguments`
// mode does suppress the ghost, but only on the request where the widget is still
// OPEN: the product holds the scope across the Escape and the sticky request
// serves it. The suppression is a widget-open property, not an end-of-gesture
// one, so it does not buy rust an exemption here.
//
// `provenanceAllow` is optional and empty everywhere today. The provenance axis
// reads each rendered line against the member's own declaration text on disk and
// refuses an identifier the declaration does not contain; a renderer that
// legitimately introduces a word the source never spells declares it here with a
// reason, rather than the assertion growing a special case.

'use strict';

// Language-server UI chrome that must never survive into a rendered signature.
// The injected block is read by the model as text to imitate, so every spelling
// here is either syntax the language does not have or a claim about the member
// that is not its declaration. Each entry was observed coming out of a real
// server in this tier; a sixth spelling belongs here as a checked-in decision,
// not as a regex tweak inside an assertion.
const SIGNATURE_CHROME = [
  { text: '(method) ', reason: 'tsserver and Pylance quickinfo kind annotation' },
  { text: '(property) ', reason: 'tsserver and Pylance quickinfo kind annotation' },
  { text: '(variable) ', reason: 'Pylance quickinfo annotation on a bare attribute' },
  { text: '(get) ', reason: 'tsserver names a getter documentSymbol node this way' },
  { text: '(set) ', reason: 'tsserver names a setter documentSymbol node this way' },
  { text: 'Self@', reason: 'Pylance UI notation for the receiver type; not Python syntax' },
  // Matched on the tail so every count and spacing variant is caught at once:
  // tsserver writes `(+1 overload)`, Roslyn `(+ 1 overload)`, and both go plural
  // past one.
  { text: ' overload)', reason: 'tsserver quickinfo overload count, not TypeScript' },
  { text: ' overloads)', reason: 'tsserver quickinfo overload count, not TypeScript' },
];

// A row whose language server never loads skips everything and mocha exits 0,
// so an absent instrument reads as a clean run. Every healthy row passes 14 of
// the 15 contract tests today, the one red being a real product defect; this
// floor leaves room for another red to appear without turning into a nuisance,
// and still catches a row that measured nothing.
const MIN_CONTRACT_PASSES = 10;

const SPECS = {
  ts: {
    repo: '/home/utilitydelta/repos/ts-scratch',
    languageId: 'typescript',
    typeName: 'Tile',
    memberSite: { file: 'playground/src/fim.ts', needle: 'return t.subtendedChildren', at: 'return t.'.length },
    argSite: { file: 'playground/src/fim.ts', needle: 's.enrollTile', at: 's.'.length, argMember: 'enrollTile' },
    typeRef: { file: 'playground/src/fim.ts', needle: 'tile: Tile | undefined', at: 'tile: '.length },
    defFile: 'packages/atlas-ts/src/index.ts',
    required: ['subtendedChildren', 'encloses', 'mortonCode', 'lod', 'band'],
    forbidden: [
      'bandOfLod', 'tileFromMorton', 'issueTicket', 'interleaveBits',
      'enroll', 'enrollTile', 'enrollBatch',
      'aggregateFanout', 'partitionByLod', 'rehomeByLod',
      'crossPackageSite', 'storeSite', 'gestureSite',
    ],
    dotSite: { file: 'playground/src/fim.ts', anchor: 'const t = tileFromMorton(42, 3);', insert: '\n  t.' },
    gestureSite: {
      file: 'playground/src/fim.ts',
      anchor: 's.enroll(1);',
      insert: '\n  s.',
      separator: '.',
      family: ['enroll', 'enrollTile', 'enrollBatch'],
      lands: true,
    },
    unimported: { file: 'playground/src/fim.ts', anchor: 'function freshSite(): number {', insert: '\n  bandOfLod(1);', probe: 'bandOfLod' },
    ownExtras: ['constructor', '_lod', '_mortonCode'],
    // documentSymbol detail is empty on all 8 of Tile's TypeScript members,
    // constructor included, so the descent alone renders names with no argument
    // list. The transport recovers them with a capped hover fan-out per member,
    // which is why this row is now held to the assertion.
    productSignatures: { delivered: true },
    construction: { member: 'constructor', arity: 2 },
    // `MAX_LOD` and `Math` appear only in the constructor BODY.
    provenanceFabrication: {
      member: 'constructor',
      refused: 'constructor Tile(mortonCode: MAX_LOD, lod: Math): Tile',
      accepted: 'constructor Tile(mortonCode: number, lod: number): Tile',
    },
    // No TypeScript member of `Tile` is static, so nothing may render as
    // `Tile.x`: that is a name the model cannot type at a `t.` site.
    selfQualified: [],
    // Nothing outside `Tile` reaches the TypeScript member set in this tier's
    // own output. The `Symbol` leak the goal records is on the headless
    // transport, which this tier does not touch.
    knownLeaks: [],
  },

  csharp: {
    repo: '/home/utilitydelta/repos/csharp-scratch',
    languageId: 'csharp',
    typeName: 'Tile',
    memberSite: { file: 'src/Playground/Fim.cs', needle: 'tile.SubtendedChildren', at: 'tile.'.length },
    argSite: { file: 'src/Playground/Fim.cs', needle: 'stripe.EnrollTile', at: 'stripe.'.length, argMember: 'EnrollTile' },
    typeRef: { file: 'src/Playground/Fim.cs', needle: 'Tile tile = Cartography', at: 0 },
    defFile: 'src/Atlas/Atlas.cs',
    required: ['SubtendedChildren', 'Encloses', 'MortonCode', 'Lod', 'Band'],
    forbidden: [
      'BandOfLod', 'TileFromMorton', 'InterleaveBits', 'MaxLod',
      'Enroll', 'EnrollTile', 'EnrollBatch',
      'AggregateFanout', 'PartitionByLod', 'RehomeByLod', 'Summarize',
      'TileSite', 'StripeMutatorSite', 'FreshSite', 'GestureSite',
    ],
    dotSite: { file: 'src/Playground/Fim.cs', anchor: 'Tile tile = Cartography.TileFromMorton(42, 3);', insert: '\n        tile.' },
    // The anchor is the call checked in at `GestureSite()`, and it is
    // `AggregateFanout` rather than the one-argument enroll call this row was
    // authored against: csharp-scratch carries the former and the spec asked
    // for the latter, so `atGestureSite` threw before any C# gesture row could
    // run. Nothing caught it because this tier needs a display and the roadmap
    // had it blocked. The name is still unique in the file, which is all the
    // exact-string search needs.
    gestureSite: {
      file: 'src/Playground/Fim.cs',
      anchor: 'stripe.AggregateFanout();',
      insert: '\n        stripe.',
      separator: '.',
      family: ['Enroll', 'EnrollTile', 'EnrollBatch'],
      lands: true,
    },
    // Limits.cs is the one Playground file with no `using Atlas;`, so an
    // in-repo `Tile` there is genuinely unimported. Fim.cs cannot host this
    // probe: it already imports Atlas, which is why the probe used to reach for
    // the BCL's `Regex` and measure something other than its own title.
    unimported: {
      file: 'src/Playground/Limits.cs',
      anchor: 'string s = "column eighty";',
      insert: '\n        Tile t = Cartography.TileFromMorton(1, 0);',
      probe: 'Tile',
    },
    ownExtras: [],
    productSignatures: { delivered: true },
    // Roslyn names the constructor node after the type, so `Tile` here is the
    // ctor, not the type appearing among its own members.
    construction: { member: 'Tile', arity: 2 },
    // `Math` appears only in the constructor BODY's `Math.Clamp` call.
    provenanceFabrication: {
      member: 'Tile',
      refused: 'Tile(Math mortonCode, int lod)',
      accepted: 'Tile(int, int)',
    },
    // Roslyn's documentSymbol detail renders `Encloses(Tile) : bool`, never
    // type-qualified. The hover fallback does qualify, which is why this stays
    // empty rather than being relaxed.
    selfQualified: [],
    // Roslyn hands back `object`'s members at every receiver.
    knownLeaks: ['Equals', 'GetHashCode', 'GetType', 'ToString'],
  },

  python: {
    repo: '/home/utilitydelta/repos/python-scratch',
    languageId: 'python',
    typeName: 'Tile',
    memberSite: { file: 'playground/fim.py', needle: 'tile.subtended_children', at: 'tile.'.length },
    argSite: { file: 'playground/fim.py', needle: 'stripe.enroll_tile', at: 'stripe.'.length, argMember: 'enroll_tile' },
    typeRef: { file: 'playground/fim.py', needle: 'def _typed_tile(tile: Tile)', at: 'def _typed_tile(tile: '.length },
    defFile: 'atlas_py/_core.py',
    required: ['subtended_children', 'encloses', 'morton_code', 'lod', 'band'],
    forbidden: [
      'band_of_lod', 'tile_from_morton', '_interleave_bits',
      'enroll', 'enroll_tile', 'enroll_batch',
      'aggregate_fanout', 'partition_by_lod', 'rehome_by_lod',
      'tile_site', 'fresh_site', 'gesture_site',
    ],
    dotSite: { file: 'playground/fim.py', anchor: 'tile = tile_from_morton(42, 3)', insert: '\n    tile.' },
    gestureSite: {
      file: 'playground/fim.py',
      anchor: 'stripe.enroll(1)',
      insert: '\n    stripe.',
      separator: '.',
      family: ['enroll', 'enroll_tile', 'enroll_batch'],
      lands: true,
    },
    unimported: { file: 'playground/fim.py', anchor: 'x = 42', insert: '\n    band_of_lod(1)', probe: 'band_of_lod' },
    ownExtras: ['__init__', '_morton_code', '_lod'],
    // Pylance answers documentSymbol with an empty detail on Tile's members, the
    // same gap TypeScript has and closed the same way: a capped hover fan-out
    // per member, so this row is held to the assertion.
    productSignatures: { delivered: true },
    // `self` is not an argument the caller supplies, so the arity the block
    // must state is 2, not 3.
    construction: { member: '__init__', arity: 2 },
    // `MAX_LOD` appears only in `__init__`'s BODY.
    provenanceFabrication: {
      member: '__init__',
      refused: '__init__(morton_code: MAX_LOD, lod: int) -> None',
      accepted: '__init__(morton_code: int, lod: int) -> None',
    },
    selfQualified: [],
    // Everything `object` defines, which Pylance offers at every receiver.
    knownLeaks: [
      '__subclasshook__', '__str__', '__sizeof__', '__setattr__', '__repr__',
      '__reduce_ex__', '__reduce__', '__qualname__', '__new__', '__ne__',
      '__module__', '__init_subclass__', '__hash__', '__getstate__',
      '__getattribute__', '__format__', '__eq__', '__doc__', '__dir__',
      '__delattr__', '__dict__', '__class__', '__annotations__',
    ],
  },

  rust: {
    repo: '/home/utilitydelta/repos/rust-scratch',
    languageId: 'rust',
    typeName: 'Tile',
    memberSite: { file: 'crates/playground/src/fim.rs', needle: 't.subtended_children', at: 't.'.length },
    argSite: { file: 'crates/playground/src/fim.rs', needle: 's.enroll_tile', at: 's.'.length, argMember: 'enroll_tile' },
    typeRef: { file: 'crates/playground/src/fim.rs', needle: 'use atlas::{Stripe, Tile};', at: 'use atlas::{Stripe, '.length },
    defFile: 'crates/atlas/src/lib.rs',
    required: ['subtended_children', 'encloses', 'morton_code', 'lod'],
    forbidden: [
      'enroll', 'enroll_tile', 'enroll_batch',
      'aggregate_fanout', 'partition_by_lod', 'rehome_by_lod',
      'floor_code', 'ceil_code', 'seen_codes',
      'cross_crate_method_site', 'fresh_site', 'gesture_site',
    ],
    dotSite: { file: 'crates/playground/src/fim.rs', anchor: 'let t = Tile::from_morton(42, 3);', insert: '\n    t.' },
    gestureSite: {
      file: 'crates/playground/src/fim.rs',
      anchor: 's.enroll(1);',
      insert: '\n    s.',
      separator: '.',
      family: ['enroll', 'enroll_tile', 'enroll_batch'],
      lands: true,
    },
    unimported: { file: 'crates/playground/src/fim.rs', anchor: 'let x = 42;', insert: '\n    let _e: Envelope;', probe: 'Envelope' },
    ownExtras: ['from_morton'],
    productSignatures: { delivered: true },
    // Rust has no constructor; `from_morton` is the associated fn the dogfood
    // crate builds a `Tile` with.
    construction: { member: 'from_morton', arity: 2 },
    // Graded on `encloses` rather than the constructor: `from_morton`'s body
    // names nothing its own signature does not. `morton_code` is in `encloses`'s
    // body only.
    provenanceFabrication: {
      member: 'encloses',
      refused: 'encloses(&self, other: &morton_code) -> bool',
      accepted: 'encloses(&self, &Tile) -> bool',
    },
    // An associated fn is called `Tile::from_morton`, so a `Tile.` qualifier
    // would still be wrong here. Rust never emits one.
    selfQualified: [],
    // Blanket-impl methods every type grows, plus rust-analyzer's postfix
    // snippets, which are editor gestures rather than members of anything.
    knownLeaks: [
      'into', 'try_into', 'type_id',
      'arc', 'box', 'call', 'const', 'dbg', 'dbgr', 'deref', 'err',
      'let', 'letm', 'match', 'ok', 'pinbox', 'rc', 'ref', 'refm', 'return',
      'some', 'unsafe',
    ],
  },

  go: {
    repo: '/home/utilitydelta/repos/go-scratch',
    languageId: 'go',
    typeName: 'Tile',
    memberSite: { file: 'playground/fim.go', needle: 'tile.SubtendedChildren', at: 'tile.'.length },
    argSite: { file: 'playground/fim.go', needle: 'stripe.EnrollTile', at: 'stripe.'.length, argMember: 'EnrollTile' },
    typeRef: { file: 'playground/fim.go', needle: 'func typedTile(tile atlas.Tile)', at: 'func typedTile(tile atlas.'.length },
    defFile: 'atlas/atlas.go',
    // Morton and Lod are exported FIELDS: the receiver-sibling join carries
    // them as the struct node's children, beside the two methods.
    required: ['SubtendedChildren', 'Encloses', 'Morton', 'Lod'],
    forbidden: [
      'TileFromMorton', 'NewStripe',
      'Enroll', 'EnrollTile', 'EnrollBatch',
      'AggregateFanout', 'PartitionByLod', 'RehomeByLod',
      'Spans', 'Floor', 'Ceiling',
      'tileSite', 'stripeMutatorSite', 'freshSite', 'gestureSite',
    ],
    // gofmt tab indentation: the insert carries a real tab, matching every
    // checked-in line, so the injected site is byte-shaped like the file.
    dotSite: { file: 'playground/fim.go', anchor: 'tile := atlas.TileFromMorton(42, 3)', insert: '\n\ttile.' },
    // The anchor is the one-argument Enroll call fim.go checks in for exactly
    // this purpose (its own comment says why the text appears nowhere else).
    gestureSite: {
      file: 'playground/fim.go',
      anchor: 'stripe.Enroll(7)',
      insert: '\n\tstripe.',
      separator: '.',
      family: ['Enroll', 'EnrollTile', 'EnrollBatch'],
      lands: true,
    },
    // limits.go is the one playground file that does not import the atlas
    // package, so an in-repo `atlas.` reference there is genuinely unimported;
    // the probe is the package qualifier because that is the name gopls's Add
    // import quickfix resolves (Go imports packages, never bare types).
    unimported: {
      file: 'playground/limits.go',
      anchor: 'buf.WriteString(text)',
      insert: '\n\t_ = atlas.TileFromMorton(1, 0)',
      probe: 'atlas',
    },
    // gopls postfix snippets ride the RAW completion list at every receiver
    // (`var!`, `print!` on a struct; a slice gets ~12). They are the exact
    // contamination the two-rule filter exists to drop (kind=Snippet, labels
    // that are not plain identifiers), so every product consumer sees them
    // filtered; this tier grades the raw list, where they are expected noise,
    // not a leak of another container's members.
    knownLeaks: ['var!', 'print!', 'append!', 'copy!', 'defer!', 'if!', 'ifnot!', 'iferr!', 'len!', 'for!', 'forr!', 'range!'],
    ownExtras: [],
    // gopls fills `detail` on completion items and documentSymbols alike, so
    // signatures arrive with the members — no resolve, no hover fan-out.
    productSignatures: { delivered: true },
    // Go has no constructor member: a Tile is built by the PACKAGE-LEVEL
    // TileFromMorton (or a composite literal), and the receiver-sibling join
    // structurally cannot carry a package function into Tile's member set. So
    // NO construction claim: Go builds a Tile through the PACKAGE-LEVEL
    // `TileFromMorton(code, lod)`, and the ratified v23 join contract pins
    // membersOfType to exactly the type's methods + fields (builders like
    // NewGauge are blind-pinned EXCLUDED), so no line in the injected block
    // can state construction without a new discovery mechanism. Absent field
    // = the tier skips the axis and says so; the gap is a ledger line in
    // docs/roadmap.md (v23 scraps), not a permanent red.
    construction: undefined,
    // `Morton` appears in `Encloses`'s BODY only; the declaration names Tile.
    provenanceFabrication: {
      member: 'Encloses',
      refused: 'Encloses(other Morton) bool',
      accepted: 'Encloses(other Tile) bool',
    },
    // A Go method is called `t.Encloses(...)`; nothing renders type-qualified.
    selfQualified: [],
  },
};

// `product.test.js` prints `productSignatures.pending` as the reason a row is
// allowed to hand back bare names instead of failing on them. An undeclared one
// printed "undefined" as that reason, so the exemption is now only expressible
// with the reason attached.
for (const [row, spec] of Object.entries(SPECS)) {
  if (!spec.productSignatures.delivered && !spec.productSignatures.pending) {
    throw new Error(
      `specs.js row ${row}: productSignatures.delivered is false with no \`pending\` reason. ` +
      'A row exempt from the signature assertion has to say why in checked-in text.',
    );
  }
  if (!spec.gestureSite.lands && !spec.gestureSite.landsPending) {
    throw new Error(
      `specs.js row ${row}: gestureSite.lands is false with no \`landsPending\` reason. ` +
      'A row allowed to commit nothing at the end of the gesture has to say why in checked-in text.',
    );
  }
}

module.exports = { SPECS, MIN_CONTRACT_PASSES, SIGNATURE_CHROME };
