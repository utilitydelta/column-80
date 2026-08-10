// Blind oracle for the honest-failure classifier [P2-surface.md:
// `classifyTestability(signature, docComment?)` from ../src/core/testability].
// It decides, from a Rust fn header + doc comment ALONE, whether a function is a
// valid BLIND-UNIT-TEST target, and when not, WHY. Precedence is FIXED and
// first-match-wins: async -> io -> needs-fixture -> underspecified -> testable
// (P2-surface clauses 1..5). Never read src/**; the classifier is a stub
// (returns {testable:true}), so every !testable case below is expected red.
// Signatures are drawn from session-v8/sampledb-sample.json where possible so
// the cases are realistic, not toy.
//
// Run: SKIP_LIVE=1 node --test test/blind-v8-testability.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v8-testability",
  `export { classifyTestability } from "../src/core/testability";\n`,
);
const { classifyTestability } = mod;
test.after(cleanup);

// A representative doc; the specific wording never matters to the contract, only
// its presence/absence does (the doc IS the contract, P2 clause 4).
const DOC = "/// A meaningful contract sentence describing the return value.";

// ---- shared assertion helpers (unit-testing-discipline: name the invariant) --

// A testable verdict: testable === true and NO reason/detail (P2 clause 5).
function expectTestable(sig, doc, clause) {
  const v = classifyTestability(sig, doc);
  assert.strictEqual(v.testable, true, `should be testable [${clause}] :: ${sig}`);
  assert.strictEqual(v.reason, undefined, `testable verdict carries no reason [${clause}] :: ${sig}`);
}

// A not-testable verdict: testable === false, reason EXACTLY as expected, and
// detail present-and-nonempty but its wording NOT pinned (P2 "Notes for the oracle").
function expectReason(sig, doc, reason, clause) {
  const v = classifyTestability(sig, doc);
  assert.strictEqual(v.testable, false, `should be not-testable [${clause}] :: ${sig}`);
  assert.strictEqual(v.reason, reason, `reason must be "${reason}" [${clause}] :: ${sig}`);
  assert.strictEqual(typeof v.detail, "string", `detail is a string when !testable [${clause}] :: ${sig}`);
  assert.ok(v.detail.length > 0, `detail is non-empty when !testable [${clause}] :: ${sig}`);
}

// ---- P2 clause 5: testable positives -----------------------------------------
// Free, sync, meaningful non-unit return, WITH a doc -> { testable: true }.

const testableCases = [
  {
    clause: "clause 5 / example: Result<Vec<T>,E> + doc",
    sig: "fn parse_san_types(hosts: &[String]) -> Result<Vec<SanType>, PkiError>",
    doc: "/// Parse a list of host strings into rcgen `SanType`s.",
  },
  {
    clause: "clause 5: free fn returning a concrete struct + doc",
    sig: "fn write_req(aggregate_id: u128, client_id: u128, client_seq: u64, enforce_idempotency: bool) -> WriteRequest",
    doc: "/// One tiny inline event = one dense ~512B metablock.",
  },
  {
    clause: "clause 5: a plain -> i32 becomes testable ONCE a doc is present",
    sig: "fn kth_largest(xs: &[i32], k: usize) -> i32",
    doc: "/// Return the kth largest element of `xs` (1-indexed).",
  },
  {
    clause: "clause 5: free fn returning bool + doc",
    sig: "fn batch_kept_for_type(meta: &Metablock, t: u64) -> bool",
    doc: "/// Whether the batch is kept for the given type id.",
  },
];

for (const { clause, sig, doc } of testableCases) {
  test(`testable: ${sig} [P2 ${clause}]`, () => expectTestable(sig, doc, clause));
}

// ---- P2 clause 2, deliberate NON-marker: Path/PathBuf are NOT io -------------
// A stated design choice: pure path manipulation is common and testable, so a
// `&Path` / `PathBuf` param on an otherwise-testable fn with a doc stays testable.

const pathNonMarkerCases = [
  {
    clause: "clause 2 non-marker: &Path param, meaningful return, + doc -> testable",
    sig: "fn load_api_keys(data_root: &Path) -> Result<Option<ApiKeysConfig>, ApiKeysError>",
    doc: "/// Load API key hashes from api_keys.toml under the data root.",
  },
  {
    clause: "clause 2 non-marker: PathBuf param stays testable",
    sig: "fn tmp_name(base: PathBuf, suffix: &str) -> String",
    doc: "/// Derive a temp file name from a base path.",
  },
];

for (const { clause, sig, doc } of pathNonMarkerCases) {
  test(`testable (Path is not an io marker): ${sig} [P2 ${clause}]`, () => expectTestable(sig, doc, clause));
}

// ---- P2 clause 1: async ------------------------------------------------------
// `async fn`, OR a non-async fn whose RETURN names a future.

const asyncCases = [
  {
    clause: "clause 1: async fn (real sample, truncated header)",
    sig: "pub async fn run_schema_under_partition(",
    doc: "/// Schema registration under partition.",
  },
  {
    clause: "clause 1: async fn with a meaningful return",
    sig: "async fn resolve_leader(addrs: &[&str]) -> Option<String>",
    doc: "/// Probe addresses for the one currently leading.",
  },
  {
    clause: "clause 1: non-async fn whose return names impl Future",
    sig: "fn spawn_probe(addr: &str) -> impl Future<Output = bool>",
    doc: "/// Build the probe future without awaiting it.",
  },
  {
    clause: "clause 1: non-async fn returning Pin<Box<dyn Future",
    sig: "fn boxed_probe(addr: &str) -> Pin<Box<dyn Future<Output = u32>>>",
    doc: "/// Build a pinned boxed probe future.",
  },
  {
    clause: "clause 1: non-async fn returning BoxFuture",
    sig: "fn boxfut_probe(addr: &str) -> BoxFuture<'static, u32>",
    doc: "/// Build a BoxFuture probe.",
  },
];

for (const { clause, sig, doc } of asyncCases) {
  test(`async: ${sig} [P2 ${clause}]`, () => expectReason(sig, doc, "async", clause));
}

// ---- P2 clause 2: io ---------------------------------------------------------
// Each CLOSED marker, isolated on an otherwise-testable fn (meaningful return, a
// doc, no self) so ONLY the io marker can be the trigger.

const ioCases = [
  { clause: "clause 2 marker: File", sig: "fn dump(f: &mut File, buf: &[u8]) -> usize" },
  { clause: "clause 2 marker: OpenOptions", sig: "fn make(opts: OpenOptions) -> u32" },
  { clause: "clause 2 marker: TcpStream", sig: "fn peer(s: &TcpStream) -> String" },
  { clause: "clause 2 marker: TcpListener", sig: "fn bound(l: &TcpListener) -> u16" },
  { clause: "clause 2 marker: UdpSocket", sig: "fn local(s: &UdpSocket) -> String" },
  { clause: "clause 2 marker: io:: path segment", sig: "fn last_err(e: io::Error) -> u32" },
  { clause: "clause 2 marker: impl Read", sig: "fn count(r: impl Read) -> usize" },
  { clause: "clause 2 marker: impl Write", sig: "fn emit(w: impl Write, n: u32) -> usize" },
  { clause: "clause 2 marker: dyn Read", sig: "fn count(r: &dyn Read) -> usize" },
  { clause: "clause 2 marker: dyn Write", sig: "fn emit(w: &mut dyn Write) -> usize" },
];

for (const { clause, sig } of ioCases) {
  test(`io: ${sig} [P2 ${clause}]`, () => expectReason(sig, DOC, "io", clause));
}

// ---- P2 clause 3: needs-fixture ----------------------------------------------
// Any self receiver. Each has a doc + no io/async so ONLY the receiver triggers.

const fixtureCases = [
  {
    clause: "clause 3: &mut self receiver (real sample)",
    sig: "pub fn get_write_event_seqes(&mut self, aggregate_key: &AggregateKey) -> EventIndexes",
    doc: "/// Get the latest batch and event index for an aggregate.",
  },
  {
    clause: "clause 3: &self receiver (real sample)",
    sig: "pub fn is_any_follower_state(&self) -> bool",
    doc: "/// Whether the node is in any follower state.",
  },
  {
    clause: "clause 3: mut self receiver (by-value, consuming)",
    sig: "fn into_bytes(mut self) -> Vec<u8>",
    doc: "/// Consume and return the buffered bytes.",
  },
  {
    clause: "clause 3: self receiver (by-value)",
    sig: "fn into_inner(self) -> Inner",
    doc: "/// Unwrap into the inner value.",
  },
];

for (const { clause, sig, doc } of fixtureCases) {
  test(`needs-fixture: ${sig} [P2 ${clause}]`, () => expectReason(sig, doc, "needs-fixture", clause));
}

// ---- P2 clause 4: underspecified ---------------------------------------------
// (a) doc missing/empty/whitespace -> underspecified even with a meaningful sig.

const kthSig = "fn kth_largest(xs: &[i32], k: usize) -> i32";
const noDocCases = [
  { clause: "clause 4a: doc undefined", doc: undefined },
  { clause: "clause 4a: doc empty string", doc: "" },
  { clause: "clause 4a: doc whitespace-only", doc: "   \n\t  " },
];
for (const { clause, doc } of noDocCases) {
  test(`underspecified (no contract): ${kthSig} [P2 ${clause}]`, () =>
    expectReason(kthSig, doc, "underspecified", clause));
}

// (b) WITH a doc present, a unit return -> underspecified (nothing to assert).

const unitReturnCases = [
  {
    clause: "clause 4b: no -> at all",
    sig: "fn tidy(x: &mut Vec<u32>)",
    doc: "/// Sort and dedup in place.",
  },
  {
    clause: "clause 4b: no -> at all (real sample, empty param list)",
    sig: "fn excludes_boundary_wal_seqs()",
    doc: "/// Half-open semantics: boundary metablocks must not appear.",
  },
  {
    clause: "clause 4b: explicit -> ()",
    sig: "fn reset(state: &mut State) -> ()",
    doc: "/// Reset the state to defaults.",
  },
  {
    clause: "clause 4b: -> Result<(), E> (value is unit)",
    sig: "fn validate(cfg: &Config) -> Result<(), ConfigError>",
    doc: "/// Validate the config, returning nothing on success.",
  },
];

for (const { clause, sig, doc } of unitReturnCases) {
  test(`underspecified (unit return): ${sig} [P2 ${clause}]`, () =>
    expectReason(sig, doc, "underspecified", clause));
}

// ---- Precedence: first-match-wins (P2 "Precedence matters", clauses 1..4) -----
// Each case matches TWO categories; the EARLIER one must win.

const precedenceCases = [
  {
    clause: "async before needs-fixture: an async method reports async",
    sig: "async fn snapshot(&self) -> Snapshot",
    doc: "/// Take an async snapshot of self.",
    reason: "async",
  },
  {
    clause: "async before underspecified: a no-doc async fn reports async",
    sig: "async fn resolve_leader(addrs: &[&str]) -> Option<String>",
    doc: undefined,
    reason: "async",
  },
  {
    clause: "async before io: an async fn taking a TcpStream reports async",
    sig: "async fn handshake(s: TcpStream) -> bool",
    doc: "/// Async handshake over the stream.",
    reason: "async",
  },
  {
    clause: "io before needs-fixture: a &mut self method touching File reports io",
    sig: "fn read_into(&mut self, f: &mut File) -> usize",
    doc: "/// Read from the file into self's buffer.",
    reason: "io",
  },
  {
    clause: "io before underspecified: io:: marker AND unit return reports io (real sample)",
    sig: "pub fn append_final_reads(path: &Path, records: &[FinalReadRecord]) -> std::io::Result<()>",
    doc: "/// Append `final-read` records to an existing file.",
    reason: "io",
  },
  {
    clause: "needs-fixture before underspecified: a &self method with a unit return reports needs-fixture (real sample)",
    sig: "pub fn seal_aggregate_chain_tips(&self)",
    doc: "/// Seal the aggregate chain tips.",
    reason: "needs-fixture",
  },
];

for (const { clause, sig, doc, reason } of precedenceCases) {
  test(`precedence: ${sig} -> ${reason} [P2 ${clause}]`, () => expectReason(sig, doc, reason, clause));
}

// ---- Robustness: never throws; garbage degrades to a verdict (P2 last note) ---

test("robustness: empty signature + no doc never throws and is underspecified [P2 'never throws']", () => {
  assert.doesNotThrow(() => classifyTestability("", undefined));
  const v = classifyTestability("", undefined);
  assert.strictEqual(v.testable, false, "empty signature is not testable");
  assert.strictEqual(v.reason, "underspecified", "no ->, no receiver, no doc -> underspecified");
});

test("robustness: an unparseable garbage signature degrades to a verdict, no throw [P2 'never throws']", () => {
  const garbage = "@@@ not a rust fn ### <<>>";
  assert.doesNotThrow(() => classifyTestability(garbage, undefined));
  const v = classifyTestability(garbage, undefined);
  assert.strictEqual(v.testable, false, "garbage with no contract is not testable");
  assert.strictEqual(v.reason, "underspecified", "no ->, no receiver, no doc -> underspecified");
  assert.strictEqual(typeof v.detail, "string", "a verdict still carries a detail string");
});
