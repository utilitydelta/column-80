// IMPLEMENTER tests - session-v37 item 5, the Rust tuple-variant payload.
// White-box: written against `src/core/rustHoverRecovery.ts` and its wiring into
// the cross-file walk, covering the mechanics the frozen contract set cannot see
// from outside.
//
// Companion to test/blind-v37-p5-tuple-payload.test.cjs, which is frozen and was
// authored blind. Where a row here overlaps a row there, the frozen one wins.
// What is here and not there: the character-scan shapes one at a time (nested
// generics, a where clause, a discriminant on a TUPLE variant), the refusal
// table, and the walk-level wiring proof that the recovered text is what
// `renderDerivedDef` emits.
//
// THE BAR every row exists to hold: a WRONG payload is worse than an elided one,
// because the model is told a lie in the compiler's voice. So every refusal row
// asserts byte-identity with the input, and every refusal FIXTURE also carries a
// control variant that DOES recover from the same source - a row that passes
// because the function died proves nothing.
//
// Run: SKIP_LIVE=1 node --test test/impl-v37-p5-tuple-payload.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v37-p5-tuple-payload",
  `export {
  recoverElidedSurface,
  renderDerivedDef,
  resolveCrossFileShape,
  tsShapeHooks,
} from "../src/core/crossFileShape";\n`,
);
const { recoverElidedSurface, renderDerivedDef, resolveCrossFileShape, tsShapeHooks } = mod;
test.after(cleanup);

// The hover form is rust-analyzer's own, byte-verified against
// session-v37/spike-10-elision-rust.txt: four-space indent, a real U+2026 inside
// a block comment, one space either side of it.
const elided = (name) => `${name}( /* … */ ),`;
const show = (v) => JSON.stringify(v);

// ===========================================================================
// 1. THE SHAPES. Every one of these is a real enum body in the corpora, and
// each row is a whole hover in and a whole hover out - the function's contract
// is the string, not a variant list.
// ===========================================================================

const SHAPES = [
  {
    what: "a unit variant does not grow parentheses, and the tuple variant beside it recovers",
    source: `pub enum BasicConstraints {\n    Unconstrained,\n    Constrained(u8),\n}\n`,
    hover: `pub enum BasicConstraints {\n    Unconstrained,\n    ${elided("Constrained")}\n}`,
    want: `pub enum BasicConstraints {\n    Unconstrained,\n    Constrained(u8),\n}`,
  },
  {
    // REVERSED BY session-v39 item 1. v37 scoped itself to the tuple form and
    // pinned the brace form as untouched; v39 recovers both, and a struct variant
    // still never grows parentheses.
    what: "a struct variant recovers its own braces, and stays a struct variant",
    source: `pub enum Shape {\n    Beta { a: u8 },\n    Gamma(u16),\n}\n`,
    hover: `pub enum Shape {\n    Beta { /* … */ },\n    ${elided("Gamma")}\n}`,
    want: `pub enum Shape {\n    Beta { a: u8 },\n    Gamma(u16),\n}`,
  },
  {
    what: "a multi-payload tuple variant keeps both types in order",
    source: `pub enum DecodeError {\n    InvalidByte(usize, u8),\n    InvalidPadding,\n}\n`,
    hover: `pub enum DecodeError {\n    ${elided("InvalidByte")}\n    InvalidPadding,\n}`,
    want: `pub enum DecodeError {\n    InvalidByte(usize, u8),\n    InvalidPadding,\n}`,
  },
  {
    what: "a comma INSIDE a generic argument list is not a variant separator",
    source: `pub enum Held {\n    Wrapper(Vec<u8>),\n    Pair(HashMap<String, u32>),\n    Empty,\n}\n`,
    hover: `pub enum Held {\n    ${elided("Wrapper")}\n    ${elided("Pair")}\n    Empty,\n}`,
    want: `pub enum Held {\n    Wrapper(Vec<u8>),\n    Pair(HashMap<String, u32>),\n    Empty,\n}`,
  },
  {
    what: "nested angle brackets survive: the scan is character-level, not a `split(\",\")`",
    source: `pub enum Nested {\n    Deep(HashMap<String, Vec<Option<u8>>>),\n    None,\n}\n`,
    hover: `pub enum Nested {\n    ${elided("Deep")}\n    None,\n}`,
    want: `pub enum Nested {\n    Deep(HashMap<String, Vec<Option<u8>>>),\n    None,\n}`,
  },
  {
    what: "a nested TUPLE payload keeps its own parentheses",
    source: `pub enum Nested {\n    Pair((u8, u8)),\n    Unit,\n}\n`,
    hover: `pub enum Nested {\n    ${elided("Pair")}\n    Unit,\n}`,
    want: `pub enum Nested {\n    Pair((u8, u8)),\n    Unit,\n}`,
  },
  {
    what: "a payload carrying a path keeps the path",
    source: `pub enum ApiKeysError {\n    Io(std::io::Error),\n    Parse(toml::de::Error),\n    InvalidHash(String),\n}\n`,
    hover: `pub enum ApiKeysError {\n    ${elided("Io")}\n    ${elided("Parse")}\n    ${elided("InvalidHash")}\n}`,
    want: `pub enum ApiKeysError {\n    Io(std::io::Error),\n    Parse(toml::de::Error),\n    InvalidHash(String),\n}`,
  },
  {
    what: "doc comments, attributes and cfg blocks between variants are not variants",
    source:
      `pub enum Wire {\n` +
      `    /// The first one.\n` +
      `    /// Documented across two lines, with a , and a ( in the prose.\n` +
      `    #[serde(rename = "x")]\n` +
      `    Alpha(u8),\n` +
      `    #[cfg(feature = "extra")]\n` +
      `    Beta(String),\n` +
      `    /* a block comment, with a } in it */\n` +
      `    Gamma,\n` +
      `}\n`,
    hover: `pub enum Wire {\n    ${elided("Alpha")}\n    ${elided("Beta")}\n    Gamma,\n}`,
    want: `pub enum Wire {\n    Alpha(u8),\n    Beta(String),\n    Gamma,\n}`,
  },
  {
    what: "generics and a where clause on the type itself do not hide the body",
    source: `pub enum Either<L, R>\nwhere\n    L: Clone + Into<Vec<u8>>,\n    R: Fn() -> u8,\n{\n    Left(L),\n    Right(R),\n}\n`,
    hover: `pub enum Either<L, R> {\n    ${elided("Left")}\n    ${elided("Right")}\n}`,
    want: `pub enum Either<L, R> {\n    Left(L),\n    Right(R),\n}`,
  },
  {
    what: "an explicit discriminant on a UNIT variant leaves it a unit variant",
    source: `pub enum Kind {\n    Alpha = 1,\n    Beta(u8),\n}\n`,
    hover: `pub enum Kind {\n    Alpha = 1,\n    ${elided("Beta")}\n}`,
    want: `pub enum Kind {\n    Alpha = 1,\n    Beta(u8),\n}`,
  },
  {
    what: "an explicit discriminant on a TUPLE variant does not swallow the variant after it",
    // Real shape: acme_wal/src/metablocks/datablock_storage_kind.rs. The
    // discriminant is NOT added to the output: only the elided parens are
    // rewritten, and text the hover never carried is text nobody proved.
    source: `#[repr(u8)]\npub enum DatablockStorageKind {\n    None = 0,\n    Inline(DatablockInlineData) = 1,\n    Block(DatablockBlockRef) = 2,\n}\n`,
    hover: `pub enum DatablockStorageKind {\n    None = 0,\n    ${elided("Inline")}\n    ${elided("Block")}\n}`,
    want: `pub enum DatablockStorageKind {\n    None = 0,\n    Inline(DatablockInlineData),\n    Block(DatablockBlockRef),\n}`,
  },
  {
    what: "a payload written across several lines is injected on one",
    source: `pub enum Split {\n    Long(\n        usize,\n        u8,\n    ),\n    Short,\n}\n`,
    hover: `pub enum Split {\n    ${elided("Long")}\n    Short,\n}`,
    want: `pub enum Split {\n    Long(usize, u8),\n    Short,\n}`,
  },
  {
    what: "a comment INSIDE the payload is scrubbed, not injected",
    source: `pub enum Commented {\n    Alpha(/* the offset */ usize),\n    Beta,\n}\n`,
    hover: `pub enum Commented {\n    ${elided("Alpha")}\n    Beta,\n}`,
    want: `pub enum Commented {\n    Alpha(usize),\n    Beta,\n}`,
  },
  {
    what: "the source is TAB-indented and the hover is four-space indented: nothing matches by column",
    // The `create_ca` capture's own shape - rcgen's BasicConstraints is
    // tab-indented source read against a space-indented hover.
    source: `pub enum BasicConstraints {\n\t/// No constraint\n\tUnconstrained,\n\t/// Constrain to the contained number of intermediate certificates\n\tConstrained(u8),\n}\n`,
    hover: `pub enum BasicConstraints {\n    Unconstrained,\n    ${elided("Constrained")}\n}`,
    want: `pub enum BasicConstraints {\n    Unconstrained,\n    Constrained(u8),\n}`,
  },
  {
    what: "a lifetime in the payload is a lifetime, not a character literal that eats the rest of the file",
    source: `pub enum InlineEntry<'a> {\n    Occupied(InlineOccupiedEntry<'a>),\n    Vacant(InlineVacantEntry<'a>),\n}\n`,
    hover: `pub enum InlineEntry<'a> {\n    ${elided("Occupied")}\n    ${elided("Vacant")}\n}`,
    want: `pub enum InlineEntry<'a> {\n    Occupied(InlineOccupiedEntry<'a>),\n    Vacant(InlineVacantEntry<'a>),\n}`,
  },
  {
    what: "a char literal in a discriminant does not close the body early",
    source: `pub enum Marked {\n    Sep = '}' as isize,\n    Payload(u8),\n}\n`,
    hover: `pub enum Marked {\n    Sep = '}' as isize,\n    ${elided("Payload")}\n}`,
    want: `pub enum Marked {\n    Sep = '}' as isize,\n    Payload(u8),\n}`,
  },
];

for (const row of SHAPES) {
  test(`shape: ${row.what}`, () => {
    const got = recoverElidedSurface(row.hover, row.source);
    assert.equal(got, row.want, `row ${show(row.what)}\n  hover: ${show(row.hover)}\n  got  : ${show(got)}`);
  });
}

test("recovery is idempotent: a hover that already carries its payloads is returned byte for byte", () => {
  for (const row of SHAPES) {
    const once = recoverElidedSurface(row.hover, row.source);
    const twice = recoverElidedSurface(once, row.source);
    assert.equal(twice, once, `row ${show(row.what)} moved on the second pass`);
  }
});

// ===========================================================================
// 2. NEVER FABRICATE. Each row proves the refusal AND, on the SAME source, that
// a control variant still recovers - so no row can pass because the function
// blew up, returned early, or was never called.
// ===========================================================================

const CONTROL_TAIL = `\npub enum Control {\n    Works(u8),\n}\n`;
const CONTROL_HOVER = `pub enum Control {\n    ${elided("Works")}\n}`;
const CONTROL_WANT = `pub enum Control {\n    Works(u8),\n}`;

const REFUSALS = [
  {
    what: "a hover variant the source does not declare refuses the WHOLE hover, including the variants that did match",
    source: `pub enum Mixed {\n    Known(u8),\n}\n`,
    hover: `pub enum Mixed {\n    ${elided("Known")}\n    ${elided("Ghost")}\n}`,
  },
  {
    what: "a variant the source declares as a STRUCT variant is a disagreement, not a payload",
    source: `pub enum Mixed {\n    Known { a: u8 },\n}\n`,
    hover: `pub enum Mixed {\n    ${elided("Known")}\n}`,
  },
  {
    what: "a variant the source declares as a UNIT variant is a disagreement, not a payload",
    source: `pub enum Mixed {\n    Known,\n}\n`,
    hover: `pub enum Mixed {\n    ${elided("Known")}\n}`,
  },
  {
    what: "an empty payload in the source is not a type to inject",
    source: `pub enum Mixed {\n    Known(),\n}\n`,
    hover: `pub enum Mixed {\n    ${elided("Known")}\n}`,
  },
  {
    what: "the enum is not declared in this file at all",
    source: `pub struct Other {\n    a: u8,\n}\n`,
    hover: `pub enum Mixed {\n    ${elided("Known")}\n}`,
  },
  {
    what: "the only mention of the enum is inside a comment",
    source: `// pub enum Mixed { Known(u8) }\n/* pub enum Mixed { Known(String) } */\n`,
    hover: `pub enum Mixed {\n    ${elided("Known")}\n}`,
  },
  {
    what: "a match arm binding is not a declaration: `Self::Known(index, byte)` names two values, not two types",
    source:
      `impl fmt::Display for Mixed {\n` +
      `    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {\n` +
      `        match *self {\n` +
      `            Self::Known(index, byte) => write!(f, "{} {}", byte, index),\n` +
      `        }\n` +
      `    }\n` +
      `}\n`,
    hover: `pub enum Mixed {\n    ${elided("Known")}\n}`,
  },
  {
    what: "a constructor call is not a declaration either",
    source: `fn build() -> Mixed {\n    Mixed::Known(*n as u8)\n}\n`,
    hover: `pub enum Mixed {\n    ${elided("Known")}\n}`,
  },
  {
    what: "two cfg'd declarations of the same name that DISAGREE cannot prove which one the hover is",
    source:
      `#[cfg(feature = "wide")]\npub enum Mixed {\n    Known(u64),\n}\n` +
      `#[cfg(not(feature = "wide"))]\npub enum Mixed {\n    Known(u8),\n}\n`,
    hover: `pub enum Mixed {\n    ${elided("Known")}\n}`,
  },
];

for (const row of REFUSALS) {
  test(`refuse: ${row.what}`, () => {
    const source = row.source + CONTROL_TAIL;
    assert.equal(
      recoverElidedSurface(row.hover, source),
      row.hover,
      `row ${show(row.what)} rewrote a hover it could not prove`,
    );
    assert.equal(
      recoverElidedSurface(CONTROL_HOVER, source),
      CONTROL_WANT,
      `the control in row ${show(row.what)} did not recover, so the refusal above proves nothing`,
    );
  });
}

test("two cfg'd declarations that AGREE do recover: the refusal above is about disagreement, not about the count", () => {
  const source =
    `#[cfg(unix)]\npub enum Mixed {\n    Known(u8),\n}\n` + `#[cfg(windows)]\npub enum Mixed {\n    Known(u8),\n}\n`;
  assert.equal(
    recoverElidedSurface(`pub enum Mixed {\n    ${elided("Known")}\n}`, source),
    `pub enum Mixed {\n    Known(u8),\n}`,
  );
});

test("unreadable source is unchanged: empty, undefined, and a source that is not Rust at all", () => {
  const hover = `pub enum Mixed {\n    ${elided("Known")}\n}`;
  for (const source of ["", undefined, null, "{{{ not rust ((("]) {
    assert.equal(recoverElidedSurface(hover, source), hover, `source ${show(source)} moved the hover`);
  }
});

test("a hover that is not an enum is never touched, whatever the source says", () => {
  const source = `pub enum Order {\n    Known(u8),\n}\npub struct Order {\n    reference: String,\n}\n`;
  for (const hover of [
    `pub struct Order {\n    pub reference: String,\n    /* private fields */\n}`,
    `type ShellCompDirective int`,
    `(class) LodBand`,
    "",
  ]) {
    assert.equal(recoverElidedSurface(hover, source), hover, `hover ${show(hover)} moved`);
  }
});

test("an enum hover with nothing elided is returned byte for byte", () => {
  const source = `pub enum Mixed {\n    Known(u8),\n    Plain,\n}\n`;
  const hover = `pub enum Mixed {\n    Known(u8),\n    Plain,\n}`;
  assert.equal(recoverElidedSurface(hover, source), hover);
});

test("rust-analyzer's own truncation marker restores the variants it stands for", () => {
  // REVERSED BY session-v39 item 1. With more variants than
  // `hover.show.enumVariants` allows, RA writes a bare ellipsis where the rest
  // would be. v37 read that as unrecoverable because the marker has no name;
  // v39 reads it as a LIST CUT, which is a position rather than a name, and the
  // members it stands for are the ones the source declares and the hover does
  // not. The restored members land at the marker's own indent, and the marker
  // goes with them.
  const source = `pub enum Big {\n    A(u8),\n    B(u16),\n    C(u32),\n}\n`;
  const hover = `pub enum Big {\n    ${elided("A")}\n    /* … */\n}`;
  assert.equal(
    recoverElidedSurface(hover, source),
    `pub enum Big {\n    A(u8),\n    B(u16),\n    C(u32),\n}`,
  );
});

test("a cfg-gated declaration refuses the list cut: the source list is not the indexed list", () => {
  // The guard the reversal above needs. `#[cfg(feature = ...)]` members are in the
  // source and out of the build the server indexed, so restoring the cut would
  // name members the compiler may never see. Payload substitution is unaffected:
  // a member the hover SHOWED is a member the server had.
  const source =
    `pub enum Gated {\n    A(u8),\n    #[cfg(feature = "extra")]\n    B(u16),\n    C(u32),\n}\n`;
  const cut = `pub enum Gated {\n    ${elided("A")}\n    /* … */\n}`;
  assert.equal(recoverElidedSurface(cut, source), cut, "a cfg-gated body refuses the whole rewrite");
  const noCut = `pub enum Gated {\n    ${elided("A")}\n    ${elided("C")}\n}`;
  assert.equal(
    recoverElidedSurface(noCut, source),
    `pub enum Gated {\n    A(u8),\n    C(u32),\n}`,
    "with no cut to restore, the shown members' payloads still recover",
  );
});

// ===========================================================================
// 3. THE REAL CORPORA. Source quoted verbatim from the read-only sandboxes, with
// the traps that live in them: `DecodeSliceError` has a variant NAMED
// `DecodeError` while `DecodeError` is a second enum in the same file, and
// between them an `impl Display` writes `Self::InvalidByte(index, byte)`.
// ===========================================================================

// ~/sandbox/complexity-study-oss/base64/src/decode.rs lines 1-80, verbatim.
const DECODE_RS = `use crate::engine::{general_purpose::STANDARD, DecodeEstimate, Engine};
#[cfg(any(feature = "alloc", test))]
use alloc::vec::Vec;
use core::fmt;
#[cfg(any(feature = "std", test))]
use std::error;

/// Errors that can occur while decoding.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DecodeError {
    /// An invalid byte was found in the input. The offset and offending byte are provided.
    ///
    /// Padding characters (\`=\`) interspersed in the encoded form are invalid, as they may only
    /// be present as the last 0-2 bytes of input.
    ///
    /// This error may also indicate that extraneous trailing input bytes are present, causing
    /// otherwise valid padding to no longer be the last bytes of input.
    InvalidByte(usize, u8),
    /// The length of the input, as measured in valid base64 symbols, is invalid.
    /// There must be 2-4 symbols in the last input quad.
    InvalidLength(usize),
    /// The last non-padding input symbol's encoded 6 bits have nonzero bits that will be discarded.
    /// This is indicative of corrupted or truncated Base64.
    /// Unlike [DecodeError::InvalidByte], which reports symbols that aren't in the alphabet,
    /// this error is for symbols that are in the alphabet but represent nonsensical encodings.
    InvalidLastSymbol(usize, u8),
    /// The nature of the padding was not as configured: absent or incorrect when it must be
    /// canonical, or present when it must be absent, etc.
    InvalidPadding,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match *self {
            Self::InvalidByte(index, byte) => {
                write!(f, "Invalid symbol {}, offset {}.", byte, index)
            }
            Self::InvalidLength(len) => write!(f, "Invalid input length: {}", len),
            Self::InvalidLastSymbol(index, byte) => {
                write!(f, "Invalid last symbol {}, offset {}.", byte, index)
            }
            Self::InvalidPadding => write!(f, "Invalid padding"),
        }
    }
}

#[cfg(any(feature = "std", test))]
impl error::Error for DecodeError {}

/// Errors that can occur while decoding into a slice.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DecodeSliceError {
    /// A [DecodeError] occurred
    DecodeError(DecodeError),
    /// The provided slice is too small.
    OutputSliceTooSmall,
}

impl fmt::Display for DecodeSliceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DecodeError(e) => write!(f, "DecodeError: {}", e),
            Self::OutputSliceTooSmall => write!(f, "Output slice too small"),
        }
    }
}

#[cfg(any(feature = "std", test))]
impl error::Error for DecodeSliceError {
    fn source(&self) -> Option<&(dyn error::Error + 'static)> {
        match self {
            DecodeSliceError::DecodeError(e) => Some(e),
            DecodeSliceError::OutputSliceTooSmall => None,
        }
    }
}

impl From<DecodeError> for DecodeSliceError {
    fn from(e: DecodeError) -> Self {
        DecodeSliceError::DecodeError(e)
`;

// ~/.cargo/registry/.../rcgen-0.14.8/src/certificate.rs lines 1126-1137, verbatim
// (tab-indented). This is the type from the live `create_ca` capture that
// started item 5: the model needed `BasicConstraints::Constrained(0)` and
// invented `BasicConstraints::from(true)`.
const RCGEN_RS = `/// The path length constraint (only relevant for CA certificates)
///
/// Sets an optional upper limit on the length of the intermediate certificate chain
/// length allowed for this CA certificate (not including the end entity certificate).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BasicConstraints {
	/// No constraint
	Unconstrained,
	/// Constrain to the contained number of intermediate certificates
	Constrained(u8),
}

`;

// ~/sandbox/complexity-study-oss/httparse/src/lib.rs lines 165-177, verbatim.
const HTTPARSE_RS = `/// The result of a successful parse pass.
///
/// \`Complete\` is used when the buffer contained the complete value.
/// \`Partial\` is used when parsing did not reach the end of the expected value,
/// but no invalid data was found.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Status<T> {
    /// The completed result.
    Complete(T),
    /// A partial result.
    Partial
}

`;

const CORPUS = [
  {
    what: "base64 DecodeError, the goal's own worked example",
    source: DECODE_RS,
    // 142 bytes, matching `hoverBytes` for this def in spike-10-elision-rust.txt.
    hover: `pub enum DecodeError {\n    ${elided("InvalidByte")}\n    ${elided("InvalidLength")}\n    ${elided("InvalidLastSymbol")}\n    InvalidPadding,\n}`,
    want: `pub enum DecodeError {\n    InvalidByte(usize, u8),\n    InvalidLength(usize),\n    InvalidLastSymbol(usize, u8),\n    InvalidPadding,\n}`,
  },
  {
    what: "base64 DecodeSliceError, whose variant is named after the other enum in the same file",
    source: DECODE_RS,
    // 84 bytes, matching the same spike.
    hover: `pub enum DecodeSliceError {\n    ${elided("DecodeError")}\n    OutputSliceTooSmall,\n}`,
    want: `pub enum DecodeSliceError {\n    DecodeError(DecodeError),\n    OutputSliceTooSmall,\n}`,
  },
  {
    what: "httparse Status<T>, a generic tuple variant",
    source: HTTPARSE_RS,
    // 62 bytes, matching the same spike.
    hover: `pub enum Status<T> {\n    ${elided("Complete")}\n    Partial,\n}`,
    want: `pub enum Status<T> {\n    Complete(T),\n    Partial,\n}`,
  },
  {
    what: "rcgen BasicConstraints, the capture that started item 5",
    source: RCGEN_RS,
    hover: `pub enum BasicConstraints {\n    Unconstrained,\n    ${elided("Constrained")}\n}`,
    want: `pub enum BasicConstraints {\n    Unconstrained,\n    Constrained(u8),\n}`,
  },
];

for (const row of CORPUS) {
  test(`corpus: ${row.what}`, () => {
    const got = recoverElidedSurface(row.hover, row.source);
    assert.equal(got, row.want, `row ${show(row.what)}\n  got: ${show(got)}`);
  });
}

test("the same-name trap in real source: DecodeError's own payloads never come from DecodeSliceError's variant", () => {
  const got = recoverElidedSurface(
    `pub enum DecodeError {\n    ${elided("InvalidByte")}\n}`,
    DECODE_RS,
  );
  assert.ok(!got.includes("index"), `a match-arm binding reached the injected def: ${show(got)}`);
  assert.ok(!got.includes("byte,"), `a match-arm binding reached the injected def: ${show(got)}`);
  assert.equal(got, `pub enum DecodeError {\n    InvalidByte(usize, u8),\n}`);
});

// ===========================================================================
// 4. THE WIRING. The recovery has to reach the text the prompt carries, and the
// def file is already open in the walk. These rows drive `resolveCrossFileShape`
// with a hand-built extractor - the def source arrives through the SAME
// `openFile` the walk already uses, with no second read.
// ===========================================================================

const URI = "file:///w/pki.rs";
const ENUM_SRC = `pub enum BasicConstraints {\n\tUnconstrained,\n\tConstrained(u8),\n}\n`;
const ENUM_HOVER = `pub enum BasicConstraints {\n    Unconstrained,\n    ${elided("Constrained")}\n}`;
const STRUCT_SRC = `pub struct Order {\n    pub reference: String,\n}\n`;
const STRUCT_HOVER = `pub struct Order {\n    pub reference: String,\n    /* private fields */\n}`;

const extractorFor = (hover, defUri = URI) => ({
  definition: async () => ({ uri: defUri, range: { startLine: 0, startCharacter: 9, endLine: 0, endCharacter: 25 } }),
  hoverSurface: async () => ({ signature: hover }),
  membersOfType: async () => [],
  completeMembers: async () => [],
  example: async () => undefined,
  qualifyImport: async () => undefined,
});
const ROOT = { uri: URI, line: 0, character: 12 };
const BOUND = { D_MAX: 1, N_MAX: 4 };

test("the walk stores the recovered def, and renderDerivedDef is what emits it into the prompt", async () => {
  const shape = await resolveCrossFileShape(extractorFor(ENUM_HOVER), ROOT, BOUND, async () => ENUM_SRC);
  const derived = shape.types.get("BasicConstraints");
  assert.ok(derived, `the walk derived nothing: ${show([...shape.types.keys()])}`);
  assert.equal(derived.signature, `pub enum BasicConstraints {\n    Unconstrained,\n    Constrained(u8),\n}`);
  assert.equal(renderDerivedDef(derived), derived.signature, "the render site emits the stored def");
  assert.ok(!renderDerivedDef(derived).includes("…"), "no ellipsis survives into the injected def");
});

test("a def file the walk cannot open leaves the hover exactly as the server gave it", async () => {
  // The cross-crate case: the type resolves through the RA index but its file
  // cannot be synced, so there is no source to prove a payload from. The hover
  // is the floor, and the floor is what ships.
  const shape = await resolveCrossFileShape(
    extractorFor(ENUM_HOVER, "file:///elsewhere/vendor.rs"),
    ROOT,
    BOUND,
    async (uri) => (uri === URI ? ENUM_SRC : undefined),
  );
  const derived = shape.types.get("BasicConstraints");
  assert.ok(derived, `the walk derived nothing: ${show([...shape.types.keys()])}`);
  assert.equal(derived.signature, ENUM_HOVER, "no source, no recovery, no invention");
  assert.equal(derived.methodsResolved, false, "and the def file really was unreadable");
});

test("a STRUCT is untouched by the enum recovery: the field leg does not move a byte", async () => {
  const shape = await resolveCrossFileShape(extractorFor(STRUCT_HOVER), ROOT, BOUND, async () => STRUCT_SRC);
  const derived = shape.types.get("Order");
  assert.ok(derived, `the walk derived nothing: ${show([...shape.types.keys()])}`);
  assert.equal(derived.signature, STRUCT_HOVER, "a struct hover is stored verbatim, as it always was");
  assert.deepEqual(
    derived.fields.map((f) => `${f.name}: ${f.typeName}`),
    ["reference: String"],
    "the fields still come off the raw hover",
  );
});

test("the recovery is on the Rust default path only: a language with its own hooks is unchanged", async () => {
  const shape = await resolveCrossFileShape(
    extractorFor(ENUM_HOVER),
    ROOT,
    BOUND,
    async () => ENUM_SRC,
    tsShapeHooks,
  );
  assert.equal(
    shape.types.get("BasicConstraints").signature,
    ENUM_HOVER,
    "a hooked language keeps its raw hover; its own elision is a different item",
  );
});
