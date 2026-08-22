// BLIND CONTRACT ORACLE - session-v37 item 5 (roadmap item 32).
// The tuple-variant payload. Written from the phase goal and the declared facade
// only. Nothing here read `src/core/crossFileShape.ts` or `src/vscode/fnGen.ts`.
//
// THE DEFECT. rust-analyzer hovers a tuple variant with its payload elided:
//
//     what rust-analyzer hovers:   Constrained( /* … */ )
//     what the source says:        Constrained(u8)
//
// For a tuple variant the payload TYPE IS the constructor's argument, so eliding it
// removes the one fact the injection existed to supply. On the live `create_ca`
// capture the model needed `BasicConstraints::Constrained(0)`, invented
// `BasicConstraints::from(true)`, and a human repaired it by hand.
//
// HOW OFTEN (goal, `spike-6-payload.cjs`): 76 of 152 enums in acme-db (50.0%)
// and 11 of 18 in the OSS crates (61.1%) carry at least one tuple variant, 224 tuple
// variants in acme-db alone, payload recoverable from source in 224 of 224, 100%.
//
// WHY SOURCE AND NOT THE SERVER. No RA setting recovers it. `hover.show.structFields:
// 99` and `enumVariants: 99` leave it unchanged; both `null` deletes the enum body,
// which is worse. RA config is not ours to set either, because the shipping Rust path
// asks VS Code via `executeHoverProvider`. `DerivedType.defUri` is already carried and
// the cross-file walk already opens def files, so the body is reachable at source.
//
// SCOPE: RUST ONLY. Go, Python and C# have their own versions of this defect, measured
// in the goal's own table, and are NOT built in this session. There is one Go row below
// and it is a SCOPE GUARD, not a Go build.
//
// PROVENANCE. Every fixture below is real. Sources are quoted from the sandbox corpora
// with file and line. Hovers are labelled MEASURED (lifted from a real capture or spike
// output in this repo) or SYNTHESIZED (real source, hover written in the elision form
// that was byte-verified on three real enums - see BYTE CHECK below). Nothing is
// hand-invented. The corpora are read once here and inlined so these rows run on any box.
//
// BYTE CHECK. The Rust elision spike printed `hoverBytes` beside each injected
// def. The three hover strings reconstructed from it measure 142, 84 and 62
// bytes, matching the spike exactly, so the elision form used throughout this file
// (four-space indent, `( /* … */ )` with U+2026) is the real one and not a guess.
//
// Run: SKIP_LIVE=1 node --test test/blind-v37-p5-tuple-payload.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v37-p5-tuple-payload",
  `export { renderDerivedDef, recoverElidedSurface } from "../src/core/crossFileShape";\n`
);
const { renderDerivedDef, recoverElidedSurface } = mod;
test.after(cleanup);

// A DerivedType as the cross-file walk builds it: `signature` is the RAW hover,
// verbatim, and `defUri` is the file the type is defined in.
const derived = (name, signature) => ({
  name,
  signature,
  fields: [],
  methods: [],
  methodsResolved: true,
  defUri: `file:///corpus/${name}.rs`,
});

// ---------------------------------------------------------------------------
// HOVERS
// ---------------------------------------------------------------------------

// MEASURED. The live `create_ca` capture that filed roadmap item 32, under the
// header "Data shape of `BasicConstraints`".
const HOVER_BASIC_CONSTRAINTS = [
  "pub enum BasicConstraints {",
  "    Unconstrained,",
  "    Constrained( /* … */ ),",
  "}",
].join("\n");

// MEASURED. The Rust elision spike, "PRODUCT INJECTS (renderDef, byte for byte)"
// for base64::DecodeError. Spike reports hoverBytes=142.
const HOVER_DECODE_ERROR = [
  "pub enum DecodeError {",
  "    InvalidByte( /* … */ ),",
  "    InvalidLength( /* … */ ),",
  "    InvalidLastSymbol( /* … */ ),",
  "    InvalidPadding,",
  "}",
].join("\n");

// MEASURED. Same spike file, base64::DecodeSliceError. hoverBytes=84.
const HOVER_DECODE_SLICE_ERROR = [
  "pub enum DecodeSliceError {",
  "    DecodeError( /* … */ ),",
  "    OutputSliceTooSmall,",
  "}",
].join("\n");

// MEASURED. Same spike file, httparse::Status. hoverBytes=62.
const HOVER_STATUS = [
  "pub enum Status<T> {",
  "    Complete( /* … */ ),",
  "    Partial,",
  "}",
].join("\n");

// MEASURED. Same `create_ca` capture. A real enum carrying all three variant
// kinds, and the only captured evidence in this repo of how RA renders a STRUCT
// variant: braces, body elided, no parentheses anywhere.
const HOVER_SIGNATURE_ALGORITHM_PARAMS = [
  "pub(crate) enum SignatureAlgorithmParams {",
  "    None,",
  "    Null,",
  "    RsaPss { /* … */ },",
  "}",
].join("\n");

// MEASURED. Same capture. RA truncated the variant LIST at five and appended a
// bare `/* … */,` line. The source declares eight.
const HOVER_PKI_ERROR = [
  "pub enum PkiError {",
  "    Io( /* … */ ),",
  "    CertGen( /* … */ ),",
  "    Tls( /* … */ ),",
  "    Verifier( /* … */ ),",
  "    NoPrivateKey( /* … */ ),",
  "    /* … */",
  "}",
].join("\n");

// MEASURED. The comment-anchor spike, "PRODUCT INJECTS" for
// base64::alphabet::Alphabet. A struct: RA prints the field WITH its type, no elision.
const HOVER_ALPHABET = [
  "pub struct Alphabet {",
  "    pub(crate) symbols: [u8; ALPHABET_SIZE],",
  "}",
].join("\n");

// MEASURED. Same capture, under "Data shape of `CertificateParams`". RA
// truncated the FIELD list at five. A struct, so item 5 must not touch it.
const HOVER_CERTIFICATE_PARAMS = [
  "pub struct CertificateParams {",
  "    pub not_before: OffsetDateTime,",
  "    pub not_after: OffsetDateTime,",
  "    pub serial_number: Option<SerialNumber>,",
  "    pub subject_alt_names: Vec<SanType>,",
  "    pub distinguished_name: DistinguishedName,",
  "    /* … */",
  "}",
].join("\n");

// SYNTHESIZED hover, REAL source (acme-db). Written in the byte-verified
// elision form above. The source is what these rows are really about.
const HOVER_FETCH_DATABLOCK_ERROR = [
  "pub enum FetchDatablockError {",
  "    DatablockError { /* … */ },",
  "    LogSegmentFileError( /* … */ ),",
  "    LogSegmentFileReaderContention,",
  "    LogSegmentFileUnavailable { /* … */ },",
  "    DatablockReadError( /* … */ ),",
  "    MissingDatablocksOnDisk,",
  "}",
].join("\n");

// SYNTHESIZED hover, REAL source (acme-db). Payload carries a comma INSIDE
// angle brackets, which is the shape a naive split on "," gets wrong.
const HOVER_WATCH_STEP = [
  "enum WatchStep {",
  "    Frame( /* … */ ),",
  "    PeerGone,",
  "}",
].join("\n");

// SYNTHESIZED hover, REAL source (acme-db). Nested generics and a
// path-qualified payload type.
const HOVER_CLIENT_STREAM = [
  "pub(crate) enum ClientStream {",
  "    Plain( /* … */ ),",
  "    Tls( /* … */ ),",
  "}",
].join("\n");

// ---------------------------------------------------------------------------
// SOURCES, verbatim from the corpora
// ---------------------------------------------------------------------------

// ~/.cargo/registry/src/index.crates.io-*/rcgen-0.14.7/src/certificate.rs:1098-1108.
// rcgen 0.14.7 is the version acme-db's Cargo.lock pins. Note the TAB indent:
// the source and the hover do not agree on whitespace, so nothing here can work by
// column alignment.
const SRC_RCGEN_CERTIFICATE = [
  "/// The path length constraint (only relevant for CA certificates)",
  "///",
  "/// Sets an optional upper limit on the length of the intermediate certificate chain",
  "/// length allowed for this CA certificate (not including the end entity certificate).",
  "#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]",
  "pub enum BasicConstraints {",
  "\t/// No constraint",
  "\tUnconstrained,",
  "\t/// Constrain to the contained number of intermediate certificates",
  "\tConstrained(u8),",
  "}",
].join("\n");

// ~/sandbox/complexity-study-oss/base64/src/decode.rs:8-57, verbatim.
// This block is deliberately quoted whole, because it is a real fabrication trap:
//   - TWO enums in one file, `DecodeError` and `DecodeSliceError`;
//   - `DecodeSliceError` has a VARIANT named `DecodeError`, colliding with the enum;
//   - the `impl Display` between them writes `Self::InvalidByte(index, byte)`, so a
//     scan of the whole file for `InvalidByte(` finds VALUE names, not types;
//   - a doc comment mentions `[DecodeError::InvalidByte]` in prose.
// Anything that recovers `InvalidByte(index, byte)` here has told the model a lie in
// the voice of the compiler.
const SRC_BASE64_DECODE = [
  "/// Errors that can occur while decoding.",
  "#[derive(Clone, Debug, PartialEq, Eq)]",
  "pub enum DecodeError {",
  "    /// An invalid byte was found in the input. The offset and offending byte are provided.",
  "    ///",
  "    /// Padding characters (`=`) interspersed in the encoded form are invalid, as they may only",
  "    /// be present as the last 0-2 bytes of input.",
  "    ///",
  "    /// This error may also indicate that extraneous trailing input bytes are present, causing",
  "    /// otherwise valid padding to no longer be the last bytes of input.",
  "    InvalidByte(usize, u8),",
  "    /// The length of the input, as measured in valid base64 symbols, is invalid.",
  "    /// There must be 2-4 symbols in the last input quad.",
  "    InvalidLength(usize),",
  "    /// The last non-padding input symbol's encoded 6 bits have nonzero bits that will be discarded.",
  "    /// This is indicative of corrupted or truncated Base64.",
  "    /// Unlike [DecodeError::InvalidByte], which reports symbols that aren't in the alphabet,",
  "    /// this error is for symbols that are in the alphabet but represent nonsensical encodings.",
  "    InvalidLastSymbol(usize, u8),",
  "    /// The nature of the padding was not as configured: absent or incorrect when it must be",
  "    /// canonical, or present when it must be absent, etc.",
  "    InvalidPadding,",
  "}",
  "",
  "impl fmt::Display for DecodeError {",
  "    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {",
  "        match *self {",
  "            Self::InvalidByte(index, byte) => {",
  '                write!(f, "Invalid symbol {}, offset {}.", byte, index)',
  "            }",
  '            Self::InvalidLength(len) => write!(f, "Invalid input length: {}", len),',
  "            Self::InvalidLastSymbol(index, byte) => {",
  '                write!(f, "Invalid last symbol {}, offset {}.", byte, index)',
  "            }",
  '            Self::InvalidPadding => write!(f, "Invalid padding"),',
  "        }",
  "    }",
  "}",
  "",
  '#[cfg(any(feature = "std", test))]',
  "impl error::Error for DecodeError {}",
  "",
  "/// Errors that can occur while decoding into a slice.",
  "#[derive(Clone, Debug, PartialEq, Eq)]",
  "pub enum DecodeSliceError {",
  "    /// A [DecodeError] occurred",
  "    DecodeError(DecodeError),",
  "    /// The provided slice is too small.",
  "    OutputSliceTooSmall,",
  "}",
].join("\n");

// ~/sandbox/complexity-study-oss/httparse/src/lib.rs:165-176, verbatim. A generic
// enum whose payload IS the generic parameter, and whose last variant has no
// trailing comma in source.
const SRC_HTTPARSE_STATUS = [
  "/// The result of a successful parse pass.",
  "///",
  "/// `Complete` is used when the buffer contained the complete value.",
  "/// `Partial` is used when parsing did not reach the end of the expected value,",
  "/// but no invalid data was found.",
  "#[derive(Copy, Clone, Eq, PartialEq, Debug)]",
  "pub enum Status<T> {",
  "    /// The completed result.",
  "    Complete(T),",
  "    /// A partial result.",
  "    Partial",
  "}",
].join("\n");

// ~/.cargo/registry/src/index.crates.io-*/rcgen-0.14.7/src/sign_algo.rs:25-37, verbatim.
// The struct variant `RsaPss` spans three lines in source and is not a tuple variant.
const SRC_RCGEN_SIGN_ALGO = [
  "#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]",
  "pub(crate) enum SignatureAlgorithmParams {",
  "\t/// Omit the parameters",
  "\tNone,",
  "\t/// Write null parameters",
  "\tNull,",
  "\t/// RSASSA-PSS-params as per RFC 4055",
  "\tRsaPss {",
  "\t\thash_algorithm: &'static [u64],",
  "\t\tsalt_length: u64,",
  "\t},",
  "}",
].join("\n");

// ~/sandbox/acme-db/acme_crypto/src/pki.rs:20-31, verbatim. Eight variants
// against a hover truncated at five. Every payload is a path-qualified foreign type.
const SRC_ACME_PKI = [
  "pub enum PkiError {",
  "    Io(std::io::Error),",
  "    CertGen(rcgen::Error),",
  "    Tls(rustls::Error),",
  "    Verifier(rustls::server::VerifierBuilderError),",
  "    NoPrivateKey(PathBuf),",
  "    NoCertificates(PathBuf),",
  "    /// A host string could not be parsed as a DNS name.",
  "    InvalidDnsName(String),",
  "    /// The requested validity duration overflows the datetime representation.",
  "    InvalidValidity(String),",
  "}",
].join("\n");

// ~/sandbox/acme-db/acme_shard/src/error/fetch_datablock_error.rs:1-12,
// verbatim. One real enum carrying all four cases item 5 has to separate: struct
// variant, tuple variant, unit variant, and a struct variant on one line.
const SRC_ACME_FETCH_DATABLOCK = [
  "use acme_rotating_log::errors::open_or_create_error::OpenOrCreateError;",
  "use acme_wire::disk::disk_format_error::DiskFormatError;",
  "",
  "#[derive(Debug, Clone)]",
  "pub enum FetchDatablockError {",
  "    DatablockError { log_id: u64, wal_seq: u64, source: DiskFormatError, is_inline: bool },",
  "    LogSegmentFileError(OpenOrCreateError),",
  "    LogSegmentFileReaderContention,",
  "    LogSegmentFileUnavailable { log_id: u64 },",
  "    DatablockReadError(String),",
  "    MissingDatablocksOnDisk,",
  "}",
].join("\n");

// ~/sandbox/acme-db/acme_runtimes/src/sharded/connection_handler.rs:1467-1470,
// verbatim, indent included. Declared INSIDE a function body, and its payload holds a
// comma inside angle brackets.
const SRC_ACME_WATCH_STEP = [
  "    enum WatchStep {",
  "        Frame(Result<WatchOutputType, WatchReadError>),",
  "        PeerGone,",
  "    }",
].join("\n");

// ~/sandbox/acme-db/acme_client_tokio/src/acme_client.rs:51-54, verbatim.
// Nested generics, and a payload written as a module path.
const SRC_ACME_CLIENT_STREAM = [
  "pub(crate) enum ClientStream {",
  "    Plain(Compat<TcpStream>),",
  "    Tls(Compat<tokio_rustls::client::TlsStream<TcpStream>>),",
  "}",
].join("\n");

// ~/sandbox/complexity-study-oss/base64/src/alphabet.rs:54-57, verbatim.
const SRC_BASE64_ALPHABET = [
  "#[derive(Clone, Debug, Eq, PartialEq)]",
  "pub struct Alphabet {",
  "    pub(crate) symbols: [u8; ALPHABET_SIZE],",
  "}",
].join("\n");

// A REAL PREFIX of rcgen-0.14.7/src/certificate.rs:55-65 - the file as it would look
// if a read were cut short. The struct never closes. Real bytes, unbalanced braces.
const SRC_RCGEN_CERTIFICATE_TRUNCATED = [
  "pub struct CertificateParams {",
  "\tpub not_before: OffsetDateTime,",
  "\tpub not_after: OffsetDateTime,",
  "\tpub serial_number: Option<SerialNumber>,",
  "\tpub subject_alt_names: Vec<SanType>,",
  "\tpub distinguished_name: DistinguishedName,",
  "\tpub is_ca: IsCa,",
  "\tpub key_usages: Vec<KeyUsagePurpose>,",
].join("\n");

// ~/sandbox/v23-corpus/cobra/completions.go:43-45 plus the head of its const block.
// Present ONLY as a scope guard. Go's payload defect is measured in the goal
// ("worse than Rust: all 8 values absent") and is NOT built in this session.
const SRC_COBRA_COMPLETIONS = [
  "// ShellCompDirective is a bit map representing the different behaviors the shell",
  "// can be instructed to have once completions have been provided.",
  "type ShellCompDirective int",
  "",
  "const (",
  "\t// ShellCompDirectiveError indicates an error occurred and completions should be ignored.",
  "\tShellCompDirectiveError ShellCompDirective = 1 << iota",
  ")",
].join("\n");

// MEASURED. The Go elision spike, what the product injects for cobra's
// ShellCompDirective.
const HOVER_SHELL_COMP_DIRECTIVE = "type ShellCompDirective int // size=8";

const ELLIPSIS = "/* … */";

// ---------------------------------------------------------------------------
// ROWS
// ---------------------------------------------------------------------------

// R1. The row the whole item exists for, taken all the way through the injection
// facade rather than stopping at the recovery function.
test("item 5 [rust]: the live-capture enum INJECTS its payload - Constrained(u8), not Constrained( /* … */ )", () => {
  const t = derived("BasicConstraints", HOVER_BASIC_CONSTRAINTS);
  const before = renderDerivedDef(t);
  assert.ok(
    before.includes("Constrained( /* … */ )"),
    "premise check: today's injection elides the payload, which is the defect;\n" + before
  );

  const recovered = recoverElidedSurface(t.signature, SRC_RCGEN_CERTIFICATE);
  const after = renderDerivedDef({ ...t, signature: recovered });

  assert.ok(
    /Constrained\(u8\)/.test(after),
    "the injected def must carry the payload type the model needs to write\n" +
      "`BasicConstraints::Constrained(0)`; got:\n" + after
  );
  assert.ok(
    !after.includes(ELLIPSIS),
    "no elision marker may survive on an enum whose every payload was recovered;\n" + after
  );
  // The rest of the hover is not the fix's business.
  assert.ok(after.startsWith("pub enum BasicConstraints {"), "the hover header is untouched:\n" + after);
  assert.ok(/^\s*Unconstrained,$/m.test(after), "the unit variant is untouched:\n" + after);
});

// R2. Requirements 1 and 2, over real enums from both corpora. One table, one
// mechanism, the failure message names the row.
const PAYLOAD_ROWS = [
  {
    row: "BasicConstraints [rcgen-0.14.7/src/certificate.rs:1103, the create_ca capture]",
    hover: HOVER_BASIC_CONSTRAINTS,
    source: SRC_RCGEN_CERTIFICATE,
    // source line: `Constrained(u8),`
    want: ["Constrained(u8)"],
    ellipsisLeft: false,
  },
  {
    row: "base64::DecodeError [complexity-study-oss/base64/src/decode.rs:10]",
    hover: HOVER_DECODE_ERROR,
    source: SRC_BASE64_DECODE,
    // source lines: `InvalidByte(usize, u8),` `InvalidLength(usize),` `InvalidLastSymbol(usize, u8),`
    want: ["InvalidByte(usize, u8)", "InvalidLength(usize)", "InvalidLastSymbol(usize, u8)"],
    ellipsisLeft: false,
  },
  {
    row: "base64::DecodeSliceError [same file, variant name collides with the sibling enum]",
    hover: HOVER_DECODE_SLICE_ERROR,
    source: SRC_BASE64_DECODE,
    // source line: `DecodeError(DecodeError),`
    want: ["DecodeError(DecodeError)"],
    ellipsisLeft: false,
  },
  {
    row: "httparse::Status<T> [complexity-study-oss/httparse/src/lib.rs:171, generic payload]",
    hover: HOVER_STATUS,
    source: SRC_HTTPARSE_STATUS,
    // source line: `Complete(T),`
    want: ["Complete(T)"],
    ellipsisLeft: false,
  },
  {
    row: "acme WatchStep [acme_runtimes/.../connection_handler.rs:1467, comma inside <>]",
    hover: HOVER_WATCH_STEP,
    source: SRC_ACME_WATCH_STEP,
    // source line: `Frame(Result<WatchOutputType, WatchReadError>),`
    want: ["Frame(Result<WatchOutputType, WatchReadError>)"],
    ellipsisLeft: false,
  },
  {
    row: "acme ClientStream [acme_client_tokio/src/acme_client.rs:51, nested generics]",
    hover: HOVER_CLIENT_STREAM,
    source: SRC_ACME_CLIENT_STREAM,
    // source lines: `Plain(Compat<TcpStream>),` `Tls(Compat<tokio_rustls::client::TlsStream<TcpStream>>),`
    want: ["Plain(Compat<TcpStream>)", "Tls(Compat<tokio_rustls::client::TlsStream<TcpStream>>)"],
    ellipsisLeft: false,
  },
  {
    row: "acme FetchDatablockError [acme_shard/src/error/fetch_datablock_error.rs:5, mixed kinds]",
    hover: HOVER_FETCH_DATABLOCK_ERROR,
    source: SRC_ACME_FETCH_DATABLOCK,
    // source lines: `LogSegmentFileError(OpenOrCreateError),` `DatablockReadError(String),`
    want: ["LogSegmentFileError(OpenOrCreateError)", "DatablockReadError(String)"],
    // The two STRUCT variants keep their own `{ /* … */ }`, so the marker survives here.
    ellipsisLeft: true,
  },
  {
    row: "acme PkiError [acme_crypto/src/pki.rs:20, hover truncated at five of eight]",
    hover: HOVER_PKI_ERROR,
    source: SRC_ACME_PKI,
    // source lines 21-25, in hover order.
    want: [
      "Io(std::io::Error)",
      "CertGen(rcgen::Error)",
      "Tls(rustls::Error)",
      "Verifier(rustls::server::VerifierBuilderError)",
      "NoPrivateKey(PathBuf)",
    ],
    // RA's own list-truncation line `/* … */` is not a variant and stays.
    ellipsisLeft: true,
  },
];

test("item 5 [rust]: every tuple variant in the real corpora renders its payload type", () => {
  for (const c of PAYLOAD_ROWS) {
    const out = recoverElidedSurface(c.hover, c.source);
    for (const w of c.want) {
      assert.ok(
        out.includes(w),
        `${c.row}: expected the source payload \`${w}\` in the recovered hover; got:\n${out}`
      );
    }
    if (!c.ellipsisLeft) {
      assert.ok(
        !out.includes(ELLIPSIS),
        `${c.row}: every variant here is a tuple or a unit variant, so no elision marker may survive; got:\n${out}`
      );
    }
  }
});

// R2b. Requirement 2 stated on its own, because a one-payload fix passes R2's
// substring check on six of eight rows and still drops the second type.
test("item 5 [rust]: a multi-payload variant keeps ALL of them, in order", () => {
  const out = recoverElidedSurface(HOVER_DECODE_ERROR, SRC_BASE64_DECODE);
  assert.ok(
    /InvalidByte\(usize,\s*u8\)/.test(out),
    "base64/src/decode.rs:18 says `InvalidByte(usize, u8)`; both types must arrive:\n" + out
  );
  assert.ok(
    /InvalidLastSymbol\(usize,\s*u8\)/.test(out),
    "base64/src/decode.rs:26 says `InvalidLastSymbol(usize, u8)`:\n" + out
  );
  // Control that DOES change in the same call: the single-payload sibling moved too.
  assert.ok(out.includes("InvalidLength(usize)"), "control: the single-payload variant also recovered:\n" + out);
});

// R3. Requirement 3. Each of these enums has a unit variant beside a tuple variant,
// so the same call is its own control: the tuple line moved, the unit line did not.
const UNIT_ROWS = [
  {
    row: "BasicConstraints::Unconstrained [rcgen certificate.rs:1105]",
    hover: HOVER_BASIC_CONSTRAINTS,
    source: SRC_RCGEN_CERTIFICATE,
    unit: "Unconstrained",
    control: "Constrained(u8)",
  },
  {
    row: "DecodeError::InvalidPadding [base64 decode.rs:29]",
    hover: HOVER_DECODE_ERROR,
    source: SRC_BASE64_DECODE,
    unit: "InvalidPadding",
    control: "InvalidLength(usize)",
  },
  {
    row: "DecodeSliceError::OutputSliceTooSmall [base64 decode.rs:56]",
    hover: HOVER_DECODE_SLICE_ERROR,
    source: SRC_BASE64_DECODE,
    unit: "OutputSliceTooSmall",
    control: "DecodeError(DecodeError)",
  },
  {
    row: "Status::Partial [httparse lib.rs:175, no trailing comma in source]",
    hover: HOVER_STATUS,
    source: SRC_HTTPARSE_STATUS,
    unit: "Partial",
    control: "Complete(T)",
  },
  {
    row: "WatchStep::PeerGone [acme connection_handler.rs:1469]",
    hover: HOVER_WATCH_STEP,
    source: SRC_ACME_WATCH_STEP,
    unit: "PeerGone",
    control: "Frame(Result<WatchOutputType, WatchReadError>)",
  },
  {
    row: "FetchDatablockError::MissingDatablocksOnDisk [acme fetch_datablock_error.rs:11]",
    hover: HOVER_FETCH_DATABLOCK_ERROR,
    source: SRC_ACME_FETCH_DATABLOCK,
    unit: "MissingDatablocksOnDisk",
    control: "DatablockReadError(String)",
  },
  {
    row: "SignatureAlgorithmParams::Null [rcgen sign_algo.rs:30, no tuple variant in this enum at all]",
    hover: HOVER_SIGNATURE_ALGORITHM_PARAMS,
    source: SRC_RCGEN_SIGN_ALGO,
    unit: "Null",
    control: null,
  },
];

test("item 5 [rust]: a unit variant is byte-identical and never grows parentheses", () => {
  for (const c of UNIT_ROWS) {
    const out = recoverElidedSurface(c.hover, c.source);
    const line = new RegExp(`^\\s*${c.unit},$`, "m");
    assert.ok(
      line.test(out),
      `${c.row}: the unit variant line must survive byte for byte as \`${c.unit},\`; got:\n${out}`
    );
    assert.ok(
      !out.includes(`${c.unit}(`),
      `${c.row}: a unit variant has no payload and must not be given one; got:\n${out}`
    );
    if (c.control) {
      assert.ok(
        out.includes(c.control),
        `${c.row}: CONTROL - the same call must have changed the tuple variant to \`${c.control}\`; got:\n${out}`
      );
    }
  }
});

// R4. REVERSED BY session-v39 ITEM 1, on purpose and with the goal's name on it.
//
// v37 scoped itself to "restore the tuple variant's payload", so a struct variant's
// brace form was out of reach and this row pinned it as unchanged. That was correct
// for v37 and is exactly what session-v39 item 1 decides to change: the elision is
// the same elision, `Leader { /* … */ }` deletes the same fact as
// `Constrained( /* … */ )`, and the corpus says the brace form is the COMMON one
// (182 struct + 142 enum member slots cut across 63 types).
//
// What did NOT change is the bar, and the two assertions carrying it are kept
// verbatim: a struct variant must never grow parentheses, and the tuple control in
// the same call must still fire. The blind contract for the new behaviour is
// test/blind-v39-p1-hover-recovery.test.cjs row A5, on this same fixture.
test("item 5 [rust]: a struct variant recovers its brace payload (v39 reversal of the v37 pin)", () => {
  // Whole-enum case: the one captured piece of evidence in this repo of RA
  // rendering a struct variant, and the source is tab-indented against a
  // space-indented hover, so nothing here can work by column alignment.
  const alone = recoverElidedSurface(HOVER_SIGNATURE_ALGORITHM_PARAMS, SRC_RCGEN_SIGN_ALGO);
  assert.ok(
    /RsaPss \{ hash_algorithm: &'static \[u64\], salt_length: u64 \}/.test(alone),
    "rcgen sign_algo.rs:32 declares `RsaPss { hash_algorithm: &'static [u64], salt_length: u64 }`\n" +
      "across three tab-indented lines, and session-v39 item 1 restores it:\n" + alone
  );
  assert.ok(
    !alone.includes("RsaPss("),
    "a struct variant must never be rewritten into a tuple variant:\n" + alone
  );
  assert.ok(
    !alone.includes("/* … */"),
    "nothing is left elided in this enum:\n" + alone
  );

  // Mixed case, with the control that DOES change in the same call.
  const mixed = recoverElidedSurface(HOVER_FETCH_DATABLOCK_ERROR, SRC_ACME_FETCH_DATABLOCK);
  assert.ok(
    /DatablockError \{ log_id:/.test(mixed),
    "acme fetch_datablock_error.rs:6 `DatablockError { log_id, wal_seq, source, is_inline }` is a\n" +
      "struct variant and now recovers its own fields:\n" + mixed
  );
  assert.ok(
    !mixed.includes("DatablockError(") && !mixed.includes("LogSegmentFileUnavailable("),
    "no struct variant may grow parentheses:\n" + mixed
  );
  assert.ok(
    mixed.includes("LogSegmentFileError(OpenOrCreateError)"),
    "CONTROL: the tuple variant in the SAME enum and the SAME call did change:\n" + mixed
  );
});

// R5. REVERSED IN PART BY session-v39 ITEM 1, and the reversal is the third one
// this file owes. v37 wrote "the struct path is not item 5's business, at all" and
// "item 5 recovers TUPLE VARIANT payloads and nothing else", and session-v39 item 1
// makes both false: a truncated STRUCT is exactly what `ServerMeta` is, and hiding
// `compression: CompressionMeta` is what pruned the walk's graph.
//
// An adversarial review found this row still GREEN after the change and showed why:
// `SRC_RCGEN_CERTIFICATE_TRUNCATED` is a cut-short file read with no closing brace,
// so the row was exiting through the unreadable-source door while claiming to prove
// a scope decision. The truncated-read case is kept, because it is a real refusal
// worth pinning; what it is NOT is evidence about scope. The closed-body case is
// added beside it with the opposite expectation.
test("item 5 [rust]: a struct with nothing elided is byte-identical; a cut-short read refuses", () => {
  const out = recoverElidedSurface(HOVER_ALPHABET, SRC_BASE64_ALPHABET);
  assert.strictEqual(
    out,
    HOVER_ALPHABET,
    "base64/src/alphabet.rs:55 `pub struct Alphabet` has one field and RA printed it WITH its type.\n" +
      "There is nothing elided, so a recovery pass over it is a no-op down to the byte."
  );

  // The source is a REAL PREFIX of the file: the struct never closes. Nothing about
  // this declaration is readable, so nothing about it is provable.
  const trunc = recoverElidedSurface(HOVER_CERTIFICATE_PARAMS, SRC_RCGEN_CERTIFICATE_TRUNCATED);
  assert.strictEqual(
    trunc,
    HOVER_CERTIFICATE_PARAMS,
    "rcgen CertificateParams hovers with five fields and a `/* … */`, and the source read came back\n" +
      "cut short mid-declaration. An unreadable body proves nothing, so the hover is returned."
  );
  assert.ok(
    !trunc.includes("key_usages"),
    "and `key_usages` is IN the prefix that was read. Being present in the bytes is not being proven:\n" +
      trunc
  );

  // The same struct, same hover, with the declaration CLOSED. This is the reversal.
  const whole = recoverElidedSurface(
    HOVER_CERTIFICATE_PARAMS,
    SRC_RCGEN_CERTIFICATE_TRUNCATED + "\n\tpub use_authority_key_identifier_extension: bool,\n}\n"
  );
  assert.ok(
    /pub is_ca: IsCa/.test(whole) && /pub key_usages: Vec<KeyUsagePurpose>/.test(whole),
    "session-v39 item 1: a readable declaration un-truncates the field list rust-analyzer cut:\n" + whole
  );
  assert.ok(!whole.includes("/* … */"), "and the marker goes with it:\n" + whole);

  // CONTROL: the same function, on an enum, does change.
  assert.notStrictEqual(
    recoverElidedSurface(HOVER_DECODE_ERROR, SRC_BASE64_DECODE),
    HOVER_DECODE_ERROR,
    "CONTROL: base64::DecodeError must NOT come back unchanged, or these rows prove nothing"
  );
});

// R6. Requirement 6. A wrong payload is worse than an elided one, because the model is
// told a lie in the voice of the compiler. Degraded input returns TODAY's bytes.
const DEGRADED_ROWS = [
  {
    row: "source is empty (def file unreadable)",
    hover: HOVER_BASIC_CONSTRAINTS,
    source: "",
  },
  {
    row: "source is whitespace only",
    hover: HOVER_DECODE_ERROR,
    source: "\n\n   \n\t\n",
  },
  {
    row: "wrong file: BasicConstraints hover against base64/src/decode.rs",
    hover: HOVER_BASIC_CONSTRAINTS,
    source: SRC_BASE64_DECODE,
  },
  {
    row: "wrong file: httparse::Status hover against base64/src/alphabet.rs",
    hover: HOVER_STATUS,
    source: SRC_BASE64_ALPHABET,
  },
  {
    row: "enum absent: DecodeError hover against rcgen certificate.rs",
    hover: HOVER_DECODE_ERROR,
    source: SRC_RCGEN_CERTIFICATE,
  },
  {
    row: "unbalanced braces: DecodeError hover against a truncated rcgen certificate.rs read",
    hover: HOVER_DECODE_ERROR,
    source: SRC_RCGEN_CERTIFICATE_TRUNCATED,
  },
  {
    row: "source is a Rust file with no enum at all",
    hover: HOVER_BASIC_CONSTRAINTS,
    source: SRC_BASE64_ALPHABET,
  },
];

test("item 5 [rust]: unreadable, wrong or unparseable source returns TODAY's bytes, never throws, never fabricates", () => {
  for (const c of DEGRADED_ROWS) {
    let out;
    assert.doesNotThrow(() => {
      out = recoverElidedSurface(c.hover, c.source);
    }, `${c.row}: the recovery is pure and offline and must never throw`);
    assert.strictEqual(
      out,
      c.hover,
      `${c.row}: with nothing better available the hover is returned unchanged.\n` +
        "An elided payload is a gap; a wrong payload is a lie in the voice of the compiler."
    );
  }
});

// R6b. The fabrication trap, on real source. Two enums in one file, a variant named
// after the sibling enum, and an impl block full of `Self::InvalidByte(index, byte)`.
test("item 5 [rust]: a payload is never taken from a sibling enum, an impl block or a doc comment", () => {
  const de = recoverElidedSurface(HOVER_DECODE_ERROR, SRC_BASE64_DECODE);
  assert.ok(
    !/InvalidByte\(index,\s*byte\)/.test(de),
    "`Self::InvalidByte(index, byte)` at base64/src/decode.rs:35 is a MATCH ARM binding values,\n" +
      "not the variant declaration. Recovering it would inject two identifiers that are not types:\n" + de
  );
  assert.ok(
    !/InvalidLastSymbol\(index,\s*byte\)/.test(de),
    "same trap at base64/src/decode.rs:38:\n" + de
  );
  assert.ok(
    !de.includes("OutputSliceTooSmall"),
    "the sibling enum `DecodeSliceError` in the same file must not leak variants into DecodeError:\n" + de
  );

  // The sharp half: `DecodeSliceError` has a variant literally named `DecodeError`.
  // Resolving the enum by name must not land on the sibling.
  const dse = recoverElidedSurface(HOVER_DECODE_SLICE_ERROR, SRC_BASE64_DECODE);
  assert.ok(
    dse.includes("DecodeError(DecodeError)"),
    "base64/src/decode.rs:54 says `DecodeError(DecodeError)`; the variant and the enum share a name\n" +
      "and the payload is still recoverable:\n" + dse
  );
  assert.ok(
    !dse.includes("InvalidByte") && !dse.includes("InvalidPadding"),
    "no variant of the OTHER enum in the file may appear:\n" + dse
  );

  // REVERSED BY session-v39 ITEM 1. v37 read the list cut as out of scope ("item 5
  // restores payloads, it does not un-truncate the list") and pinned the three
  // hidden variants as staying hidden. Session-v39 measured what that pin costs:
  // 324 injected blocks carried a cut, and the prompt then closes with "Call ONLY
  // methods and constructors of `PkiError` that appear in the API surface above" —
  // a list rust-analyzer itself marked incomplete, declared exhaustive. So the cut
  // is now restored from the same source this row already reads.
  //
  // The fabrication half of this row is untouched and is the point of keeping it
  // here: the restored variants come from `PkiError`'s own declaration body, so the
  // doc comments between them stay out and no sibling leaks in.
  const pki = recoverElidedSurface(HOVER_PKI_ERROR, SRC_ACME_PKI);
  assert.ok(
    pki.includes("NoPrivateKey(PathBuf)"),
    "CONTROL: the five variants RA did show must all recover:\n" + pki
  );
  for (const [hidden, payload] of [
    ["NoCertificates", "PathBuf"],
    ["InvalidDnsName", "String"],
    ["InvalidValidity", "String"],
  ]) {
    assert.ok(
      pki.includes(`${hidden}(${payload})`),
      `acme_crypto/src/pki.rs declares eight variants and RA showed five. \`${hidden}(${payload})\`\n` +
        "is in the source the resolver already read:\n" + pki
    );
  }
  assert.ok(
    !/A host string could not be parsed|overflows the datetime/.test(pki),
    "the doc-comment prose sitting between those variants is not a variant:\n" + pki
  );
  assert.ok(
    !pki.includes("/* … */"),
    "eight of eight recovered leaves RA's truncation marker nothing to mark:\n" + pki
  );
});

// R7. SCOPE GUARD, not a Go build. The goal measures Go's payload defect as worse
// than Rust's ("all 8 values absent") and orders it AFTER Rust so it can reuse this
// walk. Until then a Go hover must fall straight through, because the alternative -
// a Rust enum parser chewing on Go source - is exactly how a fabricated payload ships.
test("item 5 [scope]: a Go const-set hover falls through untouched; Go, Python and C# are not built here", () => {
  const out = recoverElidedSurface(HOVER_SHELL_COMP_DIRECTIVE, SRC_COBRA_COMPLETIONS);
  assert.strictEqual(
    out,
    HOVER_SHELL_COMP_DIRECTIVE,
    "cobra/completions.go:45 `type ShellCompDirective int` plus a const block is Go's analogue of a\n" +
      "variant set, measured in the goal and NOT in this session's scope. Rust only."
  );
  // CONTROL that DOES change: the same function on the Rust row it was built for.
  assert.ok(
    recoverElidedSurface(HOVER_BASIC_CONSTRAINTS, SRC_RCGEN_CERTIFICATE).includes("Constrained(u8)"),
    "CONTROL: the Rust row still recovers, so the Go row above is a scope decision and not a dead function"
  );
});
