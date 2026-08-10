// ADVERSARIAL review evidence for session-v39 item 1, the Rust hover recovery
// (`src/core/rustHoverRecovery.ts` and its wiring in `resolveCrossFileShape`).
//
// Every row here is EVIDENCE for a finding in the review report, not a contract.
// Nothing was written to be satisfied by the implementation. Rows tagged [DEFECT]
// are the findings; rows tagged [RECORD] pin behaviour the report describes (a false
// refusal, a budget cost, an attack that found nothing).
//
// Converted 2026-08-10 (session-v48 phase 0): a test that must be red is not a test.
// The one `todo` row, B1, is now a GREEN `SUPERSEDED:` row - its finding was fixed by
// the v39 phase-1 loop-back, so it asserts the un-truncated string the shipped code
// returns. Its ruling and its old expectation are kept above it.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v39-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v39-p1",
  `export { recoverElidedSurface, parseStructHoverFields } from "../src/core/crossFileShape";\n`,
);
const { recoverElidedSurface, parseStructHoverFields } = mod;
test.after(cleanup);

const show = (s) => JSON.stringify(s);
const E = "/* … */";

// ===========================================================================
// A. THE `#[cfg]` GUARD ONLY COVERS THE LIST CUT.
//
// rustHoverRecovery.ts states the rule itself: "`#[cfg(...)]` on a member means
// the SOURCE list and the list the server indexed are different lists, and
// nothing here can tell which members were compiled in." It then consults that
// flag in ONE place - the list-cut branch - and adds "It does not block payload
// substitution: a member the hover SHOWED is a member the server had."
//
// That last sentence is true of the MEMBER and false of the member's PAYLOAD. A
// struct variant's payload is a member list of its own, and restoring it is
// exactly what session-v39 item 1 added. A `#[cfg]` inside those delimiters
// gates a FIELD, not the variant, so the variant is shown, the payload is
// elided, and the recovery restores a field the indexed build may not have.
// ===========================================================================

test("[DEFECT] A1: a `#[cfg]`-gated field inside a STRUCT-VARIANT payload is restored unconditionally", () => {
  // Under `--cfg unix` the variant is `Open { path: PathBuf, mode: u32 }`.
  // Without it, it is `Open { path: PathBuf }` and `mode` does not exist. The
  // hover is the same either way, so the recovery cannot tell - which is the
  // exact reason the cut branch refuses.
  const source = `pub enum Msg {\n    Open { path: PathBuf, #[cfg(unix)] mode: u32 },\n    Close,\n}\n`;
  const hover = `pub enum Msg {\n    Open { ${E} },\n    Close,\n}`;
  const got = recoverElidedSurface(hover, source);
  assert.strictEqual(
    got,
    hover,
    "a cfg-gated field inside a payload is not provable, and the same file refuses the whole\n" +
      "declaration when that field sits in a CUT list. Here it is injected in the compiler's voice:\n" +
      `  got: ${show(got)}`,
  );
});

test("[DEFECT] A2: the same hole through the TUPLE form, where the payload is a type list", () => {
  // Not new in v39 - the tuple leg has shipped since v37 - but it is the sharp
  // shape: `Io( /* … */ )` with the feature off is `Io(u32)`, and the recovery
  // says `Io(RawFd, u32)`, one constructor argument too many.
  const source = `pub enum Ev {\n    Io(#[cfg(unix)] RawFd, u32),\n    Tick,\n}\n`;
  const hover = `pub enum Ev {\n    Io( ${E} ),\n    Tick,\n}`;
  const got = recoverElidedSurface(hover, source);
  assert.strictEqual(got, hover, `a cfg-gated tuple field was injected as a payload type:\n  got: ${show(got)}`);
});

test("[RECORD] A3: the CONTROL - the guard DOES exist, and refuses the same source when the list is cut", () => {
  // The same declaration, the same `#[cfg]`, one loss instead of the other. This
  // is what A1 and A2 should look like, and it is why they are defects rather
  // than a scope decision: the reasoning is already written down and applied.
  const source = `pub struct S {\n    pub a: u8,\n    #[cfg(unix)] pub fd: RawFd,\n    pub z: u8,\n}\n`;
  const hover = `pub struct S {\n    pub a: u8,\n    ${E}\n}`;
  assert.strictEqual(recoverElidedSurface(hover, source), hover, "the list-cut branch refuses a cfg'd body");

  const enumSource = `pub enum Msg {\n    Open { path: PathBuf, #[cfg(unix)] mode: u32 },\n    Close,\n}\n`;
  const enumHover = `pub enum Msg {\n    Open { ${E} },\n    ${E}\n}`;
  assert.strictEqual(
    recoverElidedSurface(enumHover, enumSource),
    enumHover,
    "and it refuses the A1 source too - as soon as a cut is present, which is the only trigger",
  );
});

// ===========================================================================
// B. A COMMITTED ROW WHOSE WRITTEN REASON IS NOW FALSE.
//
// test/blind-v37-p5-tuple-payload.test.cjs "item 5 [rust]: a struct, not an
// enum, comes back byte-identical" is still green and still says:
//
//   "A struct whose hover RA truncated at five fields. Still not item 5's
//    problem: un-truncating a field list is a different item and is not built
//    here."
//   "...Item 5 recovers TUPLE VARIANT payloads and nothing else, so a truncated
//    struct is returned exactly as it arrived."
//
// Session-v39 item 1 un-truncates struct field lists; blind-v39-p1 row A4
// asserts it. The row stayed green because its FIXTURE, SRC_RCGEN_CERTIFICATE_
// TRUNCATED, is source text with no closing brace - it passes through the
// "unreadable source" door, not the "structs are out of scope" door. Two
// neighbouring rows in that same file were reversed with written reasons; this
// one was not, and the file now carries a stale claim about the shipped
// behaviour.
// ===========================================================================

// Verbatim from test/blind-v37-p5-tuple-payload.test.cjs.
const HOVER_CERTIFICATE_PARAMS = [
  "pub struct CertificateParams {",
  "    pub not_before: OffsetDateTime,",
  "    pub not_after: OffsetDateTime,",
  "    pub serial_number: Option<SerialNumber>,",
  "    pub subject_alt_names: Vec<SanType>,",
  "    pub distinguished_name: DistinguishedName,",
  `    ${E}`,
  "}",
].join("\n");
// The same fixture, with the ONE character the committed copy is missing.
const SRC_CERTIFICATE_PARAMS_CLOSED = [
  "pub struct CertificateParams {",
  "\tpub not_before: OffsetDateTime,",
  "\tpub not_after: OffsetDateTime,",
  "\tpub serial_number: Option<SerialNumber>,",
  "\tpub subject_alt_names: Vec<SanType>,",
  "\tpub distinguished_name: DistinguishedName,",
  "\tpub is_ca: IsCa,",
  "\tpub key_usages: Vec<KeyUsagePurpose>,",
  "}",
  "",
].join("\n");

// WAS `todo`: "FIXED by the phase-1 loop-back, and the row is left unedited because
// it is the record of the claim having been false. `test/blind-v37-p5-tuple-payload
// .test.cjs` R5 now carries a written supersession like its two neighbours: the
// cut-short read is kept and re-justified as an UNREADABLE SOURCE (which it is), and
// the same hover against a CLOSED declaration is asserted to un-truncate. This row's
// own assertion is the pre-fix expectation and cannot pass against the shipped
// behaviour."
//
// The row USED TO assert `recoverElidedSurface(hover, closedSource) === hover`, i.e.
// that a truncated struct comes back byte-identical. The fix landed, so the row is
// re-pointed at the un-truncated string the shipped code returns. Today's behaviour
// is the CORRECT one; the stale claim it disproves is blind-v37-p5's, not this file's.
const RECOVERED_CERTIFICATE_PARAMS = [
  "pub struct CertificateParams {",
  "    pub not_before: OffsetDateTime,",
  "    pub not_after: OffsetDateTime,",
  "    pub serial_number: Option<SerialNumber>,",
  "    pub subject_alt_names: Vec<SanType>,",
  "    pub distinguished_name: DistinguishedName,",
  "    pub is_ca: IsCa,",
  "    pub key_usages: Vec<KeyUsagePurpose>,",
  "}",
].join("\n");

test("SUPERSEDED: B1: the v37 struct-scope row was green on a brace, not on scope - close the fixture and it un-truncates", () => {
  const got = recoverElidedSurface(HOVER_CERTIFICATE_PARAMS, SRC_CERTIFICATE_PARAMS_CLOSED);
  assert.strictEqual(
    got,
    RECOVERED_CERTIFICATE_PARAMS,
    "blind-v37-p5 said `a truncated struct is returned exactly as it arrived` and\n" +
      "`un-truncating a field list is a different item and is not built here`. Both are false now:\n" +
      `  got: ${show(got)}`,
  );
  assert.ok(!got.includes(E), "the elision marker is gone, which is the whole point of the fix");
});

// ===========================================================================
// C. FALSE REFUSALS. Every row here is the SAFE direction of the bar - the type
// comes back unchanged - so none is a lie. They are recorded because each is a
// whole type losing its recovery on a shape that is ordinary Rust, and because
// three of the four are new surface that v39 opened.
// ===========================================================================

test("[RECORD] C1: one raw-identifier field refuses the WHOLE type (892 such fields in the local registry)", () => {
  // `membersOf` rejects any member text containing `#`, a v37 guard aimed at
  // macro metavariables. `r#type` is not a macro; it is how you spell a field
  // named after a keyword, and serde/syn-shaped code is full of it.
  const source = `pub struct S {\n    pub r#type: String,\n    pub name: String,\n    pub id: u64,\n}\n`;
  const hover = `pub struct S {\n    pub r#type: String,\n    ${E}\n}`;
  assert.strictEqual(recoverElidedSurface(hover, source), hover);

  // CONTROL: rename the one field and the same declaration recovers.
  const plain = source.replace(/r#type/g, "kind");
  assert.notStrictEqual(
    recoverElidedSurface(hover.replace(/r#type/g, "kind"), plain),
    hover.replace(/r#type/g, "kind"),
    "CONTROL: without the raw identifier the same shape recovers, so C1 is the `#` guard and nothing else",
  );
});

test("[RECORD] C2: a shift in a struct field's array length refuses the whole type", () => {
  // New in v39: the struct splitter counts `<` and `>`, which an enum's never
  // did. `[Node<K, V>; 1 << BITS]` is real (registry: two crates) and leaves the
  // splitter two opens deep, so the field boundary is lost and the parse refuses.
  const source = `pub struct S {\n    pub nodes: [Node; 1 << BITS],\n    pub len: usize,\n    pub cap: usize,\n}\n`;
  const hover = `pub struct S {\n    pub nodes: [Node; 1 << BITS],\n    ${E}\n}`;
  assert.strictEqual(recoverElidedSurface(hover, source), hover);

  const balanced = source.replace(/1 << BITS/g, "64");
  assert.notStrictEqual(
    recoverElidedSurface(hover.replace(/1 << BITS/g, "64"), balanced),
    hover.replace(/1 << BITS/g, "64"),
    "CONTROL: the same declaration with a plain array length recovers",
  );
});

test("[RECORD] C3: a C-variadic payload refuses the whole type, because `...` IS the elision marker", () => {
  // MARKER_SOURCE lists `...` as a spelling of the marker, and the closing guard
  // refuses when a marker survives the rewrite. A restored `extern "C" fn(u32,
  // ...)` therefore reads as an unresolved elision.
  const source = `pub enum E {\n    A(u8),\n    B(unsafe extern "C" fn(u32, ...)),\n}\n`;
  const hover = `pub enum E {\n    A(u8),\n    ${E}\n}`;
  assert.strictEqual(recoverElidedSurface(hover, source), hover);
});

test("[RECORD] C4: a macro invocation in a discriminant IS injected, verbatim", () => {
  // rustix-0.38.44/src/backend/libc/thread/futex.rs. The v37 guard rejects `$`
  // and `#`, so `bitcast!(c::FUTEX_WAKE_OP)` passes it and reaches the model as
  // API surface. The variant NAMES are right, which is what the ONLY list turns
  // on, so this is recorded rather than filed as a lie.
  const source = [
    "pub(crate) enum Operation {",
    "    Wait = bitcast!(c::FUTEX_WAIT),",
    "    Wake = bitcast!(c::FUTEX_WAKE),",
    "    WakeOp = bitcast!(c::FUTEX_WAKE_OP),",
    "}",
    "",
  ].join("\n");
  const hover = `pub(crate) enum Operation {\n    Wait = bitcast!(c::FUTEX_WAIT),\n    ${E}\n}`;
  const got = recoverElidedSurface(hover, source);
  assert.ok(got.includes("WakeOp = bitcast!(c::FUTEX_WAKE_OP)"), `macro text reached the surface: ${show(got)}`);
});

// ===========================================================================
// D. THE BUDGET. Nothing in the change caps how much a recovery may add, and
// `parseFields` now runs off the recovered signature, so one type's field EDGES
// grow with it. CROSS_FILE_BOUND is `{ D_MAX: 2, N_MAX: 12 }` and
// PREFILL_TYPE_CAP is 4.
// ===========================================================================

// ~/sandbox/complexity-study-acme/acme_chaos/src/sample.rs, the head of
// `NodeSample` plus enough of its 55 fields to make the shape real. The full
// declaration measures 151 bytes of hover against 2385 bytes of recovery.
const SRC_NODE_SAMPLE = [
  "pub struct NodeSample {",
  "    pub host: String,",
  "    pub t_ms: u64,",
  "    pub ok: bool,",
  "    pub error: Option<String>,",
  "    pub node_role: f64,",
  "    pub wal_seq_max: u64,",
  "    pub wal_seq_by_shard: BTreeMap<u32, u64>,",
  "    pub read_wal_seq_by_shard: BTreeMap<u32, u64>,",
  "    pub parked_commit_depth_by_shard: BTreeMap<u32, u64>,",
  "    pub last_self_acked_by_shard: BTreeMap<u32, u64>,",
  "    pub node_status_code_by_shard: BTreeMap<u32, u64>,",
  "    pub compression: CompressionMeta,",
  "    pub segments: Vec<LogSegmentFileMetadata>,",
  "    pub tips: RefCell<HashMap<AggregateKey, u64>>,",
  "}",
  "",
].join("\n");
const HOVER_NODE_SAMPLE = [
  "pub struct NodeSample {",
  "    pub host: String,",
  "    pub t_ms: u64,",
  "    pub ok: bool,",
  "    pub error: Option<String>,",
  "    pub node_role: f64,",
  `    ${E}`,
  "}",
].join("\n");

test("[RECORD] D1: a list-cut struct multiplies both the injected bytes and the walk's field edges", () => {
  const got = recoverElidedSurface(HOVER_NODE_SAMPLE, SRC_NODE_SAMPLE);
  assert.notStrictEqual(got, HOVER_NODE_SAMPLE, "precondition: this fixture must recover");
  assert.ok(got.length > HOVER_NODE_SAMPLE.length * 1.8, `bytes: ${HOVER_NODE_SAMPLE.length} -> ${got.length}`);
  const before = parseStructHoverFields(HOVER_NODE_SAMPLE).length;
  const after = parseStructHoverFields(got).length;
  assert.ok(after > before * 2, `field edges: ${before} -> ${after}`);
  // The collaborator names that were pruned and are now walked. This is the
  // intended half of the change; it is recorded because it lands in an N_MAX of
  // 12 with no per-type share.
  for (const t of ["CompressionMeta", "LogSegmentFileMetadata", "AggregateKey"]) {
    assert.ok(got.includes(t), `${t} must now be reachable`);
  }
});

// ===========================================================================
// E. ATTACKS THAT FOUND NOTHING. Recorded so the absence is evidence and not a
// gap in the review.
// ===========================================================================

test("[RECORD] E1: comment, string, attribute and literal hazards never fabricate and never throw", () => {
  // 170 declarations built from 17 hazards x 5 positions x enum/struct, each
  // with a sibling declaration in the same file whose members must not leak.
  // 110 of the 170 recover; none produces an alien member or a quote, an
  // attribute or a comment fragment in the output.
  const HAZ = [
    '#[doc = "r\\" {"]',
    '#[error("read \\"{0}")]',
    '#[error("read \\"{0}\\"")]',
    '#[serde(rename = "r\\"")]',
    '#[doc = "r#\\"x\\"#"]',
    '#[doc = "// }"]',
    '#[doc = "/* {"]',
    "/// */ }",
    "/// unterminated /*",
    "/** nested /* inner */ outer */",
    '/* stray " quote */',
    '#[doc = r#"hash " { "#]',
    '#[cfg_attr(feature = "x", doc = "r\\" {")]',
  ];
  let recovered = 0;
  for (const h of HAZ) {
    for (let pos = 0; pos < 5; pos++) {
      for (const kind of ["enum", "struct"]) {
        const mem =
          kind === "enum" ? ["A(u8)", "B(u16)", "C(u32)", "D(u64)"] : ["pub a: u8", "pub b: u16", "pub c: u32", "pub d: u64"];
        const lines = [`pub ${kind} Target {`];
        mem.forEach((m, i) => {
          if (i === pos) lines.push("    " + h);
          lines.push("    " + m + ",");
        });
        if (pos >= mem.length) lines.push("    " + h);
        lines.push("}", "", `pub ${kind} Neighbour {`);
        lines.push(...(kind === "enum" ? ["    AlienOne(u8),", "    AlienTwo(u16),"] : ["    pub alien_field: u8,"]));
        lines.push("}", "");
        const source = lines.join("\n");
        const shown = mem.slice(0, 2).map((m) => (kind === "enum" ? m.replace(/\(.*\)/, `( ${E} )`) : m));
        const hover = [`pub ${kind} Target {`, ...shown.map((s) => "    " + s + ","), `    ${E}`, "}"].join("\n");
        let out;
        assert.doesNotThrow(() => {
          out = recoverElidedSurface(hover, source);
        }, `hazard ${show(h)} pos ${pos} ${kind} threw`);
        if (out === hover) continue;
        recovered++;
        for (const alien of ["AlienOne", "AlienTwo", "alien_field"]) {
          assert.ok(!out.includes(alien), `hazard ${show(h)} leaked \`${alien}\`:\n${out}`);
        }
        assert.ok(
          !/"|\/\*|\*\/|#\[/.test(out),
          `hazard ${show(h)} put comment/attribute/string bytes in the surface:\n${out}`,
        );
        assert.strictEqual(recoverElidedSurface(out, source), out, `hazard ${show(h)} is not idempotent`);
      }
    }
  }
  assert.ok(recovered > 60, `non-vacuity: ${recovered} of 130 must actually recover, or this row proves nothing`);
});

test("[RECORD] E2: 60,000 adversarial byte soups produce no throw and no runaway", () => {
  // Deterministic LCG over Rust's own punctuation, comment openers, quote
  // prefixes, lifetimes, char literals, astral-plane characters and CR, fed as
  // both the source and the hover.
  const ATOMS = [
    '"', "'", "\\", "/", "*", "#", "[", "]", "{", "}", "(", ")", "<", ">", ",", ";", ":",
    "r", "b", "…", "\n", " ", "\t", "\r", "=", "-", "u8", "pub", "enum", "struct", "Target",
    "A", "$", "€", "\u{1d54f}", "/*", "*/", "//", 'r#"', '"#', "'a", "'x'", "...",
  ];
  let rnd = 20260803;
  const nx = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const gen = (n) => {
    let s = "";
    for (let i = 0; i < n; i++) s += ATOMS[Math.floor(nx() * ATOMS.length)];
    return s;
  };
  const HOVERS = [
    `pub enum Target {\n    A( ${E} ),\n    ${E}\n}`,
    `pub struct Target {\n    pub a: u8,\n    ${E}\n}`,
    `pub enum Target {\n    ${E}\n}`,
    `pub enum Target {\n    A { ${E} },\n    B( ${E} ),\n    ${E}\n}`,
  ];
  const started = Date.now();
  for (let i = 0; i < 12000; i++) {
    const src = `pub enum Target {\n${gen(3 + Math.floor(nx() * 12))}\n}\npub struct Target {\n${gen(3 + Math.floor(nx() * 8))}\n}\n`;
    for (const h of HOVERS) {
      assert.doesNotThrow(() => recoverElidedSurface(h, src), `source ${show(src)} threw`);
    }
    const fuzzedHover = `pub enum Target {\n${gen(3 + Math.floor(nx() * 10))}\n}`;
    assert.doesNotThrow(
      () => recoverElidedSurface(fuzzedHover, "pub enum Target {\n    A(u8),\n    B(u16),\n    C(u32),\n}\n"),
      `hover ${show(fuzzedHover)} threw`,
    );
  }
  assert.ok(Date.now() - started < 60000, "60k calls must not take a minute; a runaway scan would");
});

test("[RECORD] E3: the two scrub passes cannot drift, because they are the same scan", () => {
  // The structure copy and the member-text copy are read at the SAME offsets.
  // The only branch that differs emits the literal instead of blanking it, over
  // the identical span, so an offset drift would have to be a length drift -
  // and a recovered member's text landing at a shifted offset is the loudest
  // failure this parser has. Exercised through the observable behaviour: a
  // payload whose bytes are a string, a char literal and a lifetime at once.
  const rows = [
    [`pub struct S {\n    pub a: u8,\n    ${E}\n}`, `pub struct S {\n    pub a: u8,\n    pub cb: unsafe extern "system" fn(u32) -> u32,\n}\n`, `extern "system"`],
    [`pub struct S {\n    pub a: u8,\n    ${E}\n}`, `pub struct S {\n    pub a: u8,\n    pub sep: Sep<';'>,\n}\n`, `Sep<';'>`],
    [`pub struct S {\n    pub a: u8,\n    ${E}\n}`, `pub struct S {\n    pub a: u8,\n    pub name: &'static str,\n}\n`, `&'static str`],
    [`pub enum E {\n    A(u8),\n    ${E}\n}`, `pub enum E {\n    A(u8),\n    /* nested /* comment */ here */ B(u16),\n}\n`, `B(u16)`],
    [`pub struct S {\n    pub a: u8,\n    ${E}\n}`, `pub struct S {\r\n    pub a: u8,\r\n    /// 🚀 doc 𝕏\r\n    pub b: u16,\r\n}\r\n`, `b: u16`],
  ];
  for (const [hover, source, want] of rows) {
    const got = recoverElidedSurface(hover, source);
    assert.ok(got.includes(want), `expected ${show(want)} in the recovery of ${show(source)}:\n  got: ${show(got)}`);
    assert.ok(!got.includes(E), `nothing may be left elided:\n  got: ${show(got)}`);
  }
});
