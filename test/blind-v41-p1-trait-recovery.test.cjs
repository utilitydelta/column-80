// BLIND CONTRACT ORACLE - session-v41, phase 1: trait surface recovery.
//
// Written from `session-v41/goal.md` (phase-1 section) and from the phase-1
// contract handed to this oracle. File conventions copied from
// test/blind-v39-p1-hover-recovery.test.cjs and test/impl-v39-p1-hover-recovery.test.cjs
// (header style, bundleCore harness, bundle guard, btest skip pattern) - their
// BEHAVIOUR was not consulted.
//
// WHAT THIS FILE NEVER READ. Nothing here opened `src/core/rustHoverRecovery.ts`
// beyond its exported signatures. The two names it binds to,
// `isBareTraitHover(signature)` and `recoverTraitSurface(signature, source)`,
// are the names the phase-1 contract itself declares will be exported. Every
// fixture is AUTHORED Rust source, modeled on the census traits the goal names
// (`Validate` 22 hits, `LeaseStore` 4, `S3Downloader` 4) and on the one method
// signature the contract quotes verbatim. No fixture is quoted from the corpus.
//
// ---------------------------------------------------------------------------
// THE CONTRACT
// ---------------------------------------------------------------------------
//
// rust-analyzer answers a TRAIT with a bare-head hover (`pub trait Validate` -
// four words, no body) and an empty member list, so traits inject nothing
// (PROVEN, S38-9). Phase 1 recovers the trait's surface from its definition
// source, v39's family: refuse-unless-proven, refusal is ALWAYS "return the
// signature unchanged", never throw, never guess.
//
//   isBareTraitHover: TRUE for a hover whose last declaration is a trait head
//   with NO braced member body (plain, no-pub, supertrait bounds, generics;
//   attributes/where-clauses around the head do not change the answer). FALSE
//   for struct/enum/fn hovers, a trait hover carrying a braced member body,
//   the empty string, non-Rust text.
//
//   recoverTraitSurface: trait found in source by exact name -> the head (with
//   the SOURCE's bounds and generics) plus a braced body of the trait's items:
//   method signatures one per line, semicolon-terminated; a default-body method
//   contributes its SIGNATURE only; assoc types and consts as declared; no
//   comments; a #[cfg]-gated item is omitted; #[cfg] on the trait itself
//   refuses whole; other item attributes (#[must_use]) are not rendered.
//   Refuse unchanged on: non-trait signature (even with a same-named trait in
//   source), undefined/empty source, name not found, duplicate trait
//   declarations, a body the parser cannot balance. Empty trait -> head plus
//   empty braced body, honest, not refused.
//
// ---------------------------------------------------------------------------
// ROWS. A = recovery, B = trigger predicate, C = controls.
//
//   A1   one-method trait recovers; docs and the impl's body do not leak (Validate)
//   A2   assoc types, assoc const, #[must_use] stripped, comments out  (LeaseStore)
//   A3   default-body methods contribute signatures only               (S3Downloader)
//   A4   supertrait bounds + generics come from the SOURCE head        (Codec<T>)
//   A5   a #[cfg]-gated item is omitted, the rest recovered            (ShardRouter)
//   A6   #[cfg] on the trait declaration itself refuses whole
//   A7   empty trait renders head + empty braced body, not refused     (Marker)
//   A8   duplicate trait declarations refuse whole
//   A9   name present only as `impl Trait for` refuses (not found)
//   A10  undefined and empty source refuse, and never throw
//   A11  a source the parser cannot balance refuses whole
//   A12  ADVERSARIAL: default body with "{" in a string literal, then a second
//        method - correct parse OR whole refusal is green; a MANGLED surface
//        (body text leaked, or second method dropped while the first shows) is red
//   B1   bare trait heads trigger (plain, no-pub, supertraits, generics)
//   B2   attributes / where-clause around the head still trigger
//   B3   struct, enum and fn hovers do not trigger
//   B4   a trait hover WITH a braced member body does not trigger
//   B5   empty string and non-Rust text do not trigger
//   C1   struct hover passes through untouched, same-named trait in source
//   C2   enum hover passes through untouched
//   C3   a v39-shaped elided STRUCT hover (the `/* … */` marker) is byte-identical
//        through the new function - the trigger reversal: v39 keys on the marker,
//        this phase keys on trait-shaped-hover-plus-empty-members, and neither
//        may eat the other's input
//
// EXPECTED RED, and MEASURED RED, against the working tree at 03ff8a7: the two
// exports do not exist yet (esbuild WARNS on the missing TS re-exports and
// bundles `undefined`), so the BUNDLE GUARD is the one loud failure and every
// row skips. That whole-file red is the correct baseline. After the build the
// guard goes green and each row must pass on its own assertion.
//
// WHY THE REFUSAL ROWS MATTER ONLY BESIDE SECTION A's GREENS. "Came back
// unchanged" is free while nothing recovers anything. A1..A5 and A7 are the
// non-vacuity controls: once they are green, A6 and A8..A11 asserting the
// unchanged signature is a real refusal, not a no-op.
//
// ---------------------------------------------------------------------------
// CONTRACT AMBIGUITIES HIT WHILE WRITING THIS. Called out at their rows.
//
//   Q1  The exact bytes terminating a default-body method's rendered line. The
//       contract says "signature only, semicolon-terminated"; the rows assert
//       that with whitespace tolerance and pin no further formatting.
//   Q2  The empty trait's exact bytes (`{}` vs `{ }` vs a braced newline). The
//       contract says "head plus an empty braced body"; A7 asserts the shape by
//       regex, not byte equality.
//   Q3  A HOVER that itself carries an empty braced body (`pub trait Marker {}`).
//       The contract's FALSE list names only a body WITH members. Not pinned -
//       pinning it either way would invent contract.
//   Q4  Duplicate declarations that AGREE. The contract refuses on count alone
//       ("appears more than once"), stricter than v39's disagree-only bar. A8
//       uses disagreeing duplicates; the agreeing case follows the same written
//       rule but is not rowed.
//   Q5  Whether the rendered head's visibility comes from hover or source when
//       they differ. Every fixture here agrees on `pub`; not pinned.
//
// Run: SKIP_LIVE=1 node --test test/blind-v41-p1-trait-recovery.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// HARNESS. The two contract exports, bundled headless. The exports do not
// exist before the build, so the bundle FAILS today; that failure must be one
// loud guard, never a wall of TypeErrors a reader could mistake for contract
// failures.
// ===========================================================================

let isBareTraitHover, recoverTraitSurface;
let cleanup = () => {};
let bundleErr;
try {
  const b = bundleCore(
    "blind-v41-p1-trait-recovery",
    `export { isBareTraitHover, recoverTraitSurface } from "../src/core/rustHoverRecovery";\n`,
  );
  cleanup = b.cleanup;
  ({ isBareTraitHover, recoverTraitSurface } = b.mod);
} catch (e) {
  bundleErr = e;
  // esbuild wrote the entry file before it threw; do not leave it behind.
  fs.rmSync(path.join(__dirname, ".blind-v41-p1-trait-recovery.entry.ts"), { force: true });
}
test.after(() => cleanup());

// esbuild only WARNS on a missing TS re-export and bundles `undefined`, so the
// missing-exports state must be caught here too, not just a thrown build.
const exportsMissing = typeof isBareTraitHover !== "function" || typeof recoverTraitSurface !== "function";
test("bundle guard: isBareTraitHover and recoverTraitSurface build headless from src/core/rustHoverRecovery", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof isBareTraitHover, "function", "isBareTraitHover must be exported");
  assert.equal(typeof recoverTraitSurface, "function", "recoverTraitSurface must be exported");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr || exportsMissing) return ctx.skip("exports missing or bundle broken; see the bundle guard");
    return fn(ctx);
  });

const show = (v) => JSON.stringify(v);
const count = (s, ch) => s.split(ch).length - 1;
const ELLIPSIS = "/* … */";

// ===========================================================================
// FIXTURES. Authored, modeled on the census traits the goal names. Each trap
// is stated at its declaration.
// ===========================================================================

// The one method signature the contract quotes verbatim. The impl below the
// trait is the trap: `fn validate` appears twice in the file, and the impl's
// copy carries a body (`Ok(())`) that must not leak into the surface.
const SRC_VALIDATE = [
  "use crate::event::EventEnvelope;",
  "",
  "/// Validates a raw event payload before it is admitted to the WAL.",
  "pub trait Validate {",
  "    /// Returns Ok when the payload parses under the compiled schema.",
  "    fn validate(&self, event_value: &[u8]) -> Result<(), String>;",
  "}",
  "",
  "pub struct CompiledValidator {",
  "    pub schema_name: String,",
  "}",
  "",
  "impl Validate for CompiledValidator {",
  "    fn validate(&self, event_value: &[u8]) -> Result<(), String> {",
  "        Ok(())",
  "    }",
  "}",
  "",
].join("\n");

// Assoc types with and without bounds, an assoc const, a `//` comment, a
// `#[must_use]` attribute on an item. None of the decoration is surface.
const SRC_LEASE_STORE = [
  "/// Storage for the leader lease record.",
  "pub trait LeaseStore {",
  "    /// The lease handle this store hands out.",
  "    type Lease;",
  "    type Error: std::error::Error + Send;",
  "    const TTL_SECS: u64;",
  "    // renewal happens on the heartbeat path",
  "    #[must_use]",
  "    fn acquire(&mut self, node_id: &str, epoch: u64) -> Result<Self::Lease, Self::Error>;",
  "    fn renew(&mut self, lease: &Self::Lease) -> Result<(), Self::Error>;",
  "    fn release(&mut self, lease: Self::Lease) -> Result<(), Self::Error>;",
  "}",
  "",
].join("\n");

// Two default-body methods. A body is implementation, not surface: nothing
// between a default body's braces may reach the output.
const SRC_S3_DOWNLOADER = [
  "pub trait S3Downloader {",
  "    fn fetch(&self, path: &str) -> Vec<u8>;",
  "",
  "    /// Retries transient failures with a capped backoff.",
  "    fn fetch_with_retry(&self, path: &str, max_attempts: u32) -> Vec<u8> {",
  "        let mut attempt = 0;",
  "        loop {",
  "            attempt += 1;",
  "            if attempt >= max_attempts {",
  "                panic!(\"retries exhausted\");",
  "            }",
  "        }",
  "    }",
  "",
  "    fn endpoint(&self) -> &str {",
  "        \"https://s3.amazonaws.com\"",
  "    }",
  "}",
  "",
].join("\n");

// The hover shows NO bounds; the source declares them. The contract says the
// rendered head carries the bounds and generics as the SOURCE declares them.
const SRC_CODEC = [
  "pub trait Codec<T>: Send + Sync {",
  "    fn encode(&self, value: &T) -> Vec<u8>;",
  "    fn decode(&self, bytes: &[u8]) -> Option<T>;",
  "}",
  "",
].join("\n");

const SRC_CFG_ITEM = [
  "pub trait ShardRouter {",
  "    fn route(&self, key: &[u8]) -> u32;",
  "    #[cfg(test)]",
  "    fn route_fixed(&self) -> u32;",
  "    fn shard_count(&self) -> u32;",
  "}",
  "",
].join("\n");

const SRC_CFG_TRAIT = [
  "#[cfg(feature = \"s3\")]",
  "pub trait GatedDownloader {",
  "    fn fetch(&self, path: &str) -> Vec<u8>;",
  "}",
  "",
].join("\n");

const SRC_MARKER = ["pub trait Marker {}", ""].join("\n");

// Two declarations of the same trait name. They disagree on purpose; the
// contract refuses on the count alone (see Q4).
const SRC_DUP = [
  "pub trait Dup {",
  "    fn a(&self) -> u8;",
  "}",
  "",
  "mod fallback {",
  "    pub trait Dup {",
  "        fn b(&self) -> u8;",
  "    }",
  "}",
  "",
].join("\n");

// The name appears ONLY as `impl Validate for` - the trait is imported, not
// declared here. That is "not found", not a declaration.
const SRC_IMPL_ONLY = [
  "use crate::validate::Validate;",
  "",
  "pub struct CompiledValidator;",
  "",
  "impl Validate for CompiledValidator {",
  "    fn validate(&self, event_value: &[u8]) -> Result<(), String> {",
  "        Ok(())",
  "    }",
  "}",
  "",
].join("\n");

// A truncated file: the declaration never closes.
const SRC_UNBALANCED = [
  "pub trait Broken {",
  "    fn a(&self) -> u8;",
  "    fn b(&self",
].join("\n");

// The adversarial shape: a default body whose string literals carry braces,
// then a second method AFTER it. A parser that counts the literal's braces
// closes the trait early and drops `key_prefix`.
const SRC_LITERAL_BRACE = [
  "pub trait KeyRenderer {",
  "    fn render_key(&self, shard: u32) -> String {",
  "        let open = \"{\";",
  "        let close = \"}\";",
  "        format!(\"{}shard-{:04}{}\", open, shard, close)",
  "    }",
  "    fn key_prefix(&self) -> String;",
  "}",
  "",
].join("\n");

const HOVER_STRUCT = [
  "pub struct CompiledValidator {",
  "    pub schema_name: String,",
  "}",
].join("\n");

const HOVER_ENUM = [
  "pub enum NodeStatus {",
  "    BootCatchup,",
  "    Fenced,",
  "}",
].join("\n");

// The v39 seam's input: a struct hover carrying the elision marker. The new
// function must not touch it.
const HOVER_ELIDED_STRUCT = [
  "pub struct ShardMemCache {",
  "    pub shards: u32,",
  `    ${ELLIPSIS}`,
  "}",
].join("\n");

const HOVER_TRAIT_WITH_BODY = [
  "pub trait Validate {",
  "    fn validate(&self, event_value: &[u8]) -> Result<(), String>;",
  "}",
].join("\n");

const dump = (out) => `\n  GOT:\n${out}`;

// ===========================================================================
// A. RECOVERY.
// ===========================================================================

btest("A1 [rust]: a one-method trait recovers its surface; docs and the impl's body do not leak", () => {
  const sig = "pub trait Validate";
  const out = recoverTraitSurface(sig, SRC_VALIDATE);
  assert.notEqual(out, sig, `the trait is declared in the source; refusing it is a miss.${dump(out)}`);
  assert.ok(/pub trait Validate/.test(out), `the head must survive into the surface.${dump(out)}`);
  assert.ok(
    /fn validate\(&self, event_value: &\[u8\]\)\s*->\s*Result<\(\), String>\s*;/.test(out),
    `the contract's own quoted signature, semicolon-terminated.${dump(out)}`,
  );
  assert.ok(
    !/Ok\(\(\)\)/.test(out),
    `\`Ok(())\` is the IMPL's body, declared below the trait in the same file. It is not surface.${dump(out)}`,
  );
  assert.ok(
    !/Validates a raw event|Returns Ok when/.test(out),
    `doc comments are not part of the surface.${dump(out)}`,
  );
  assert.ok(!/schema_name/.test(out), `\`CompiledValidator\`'s field is a sibling's, not the trait's.${dump(out)}`);
  assert.equal(count(out, "{"), 1, `one braced body, nothing nested leaked in.${dump(out)}`);
  assert.equal(count(out, "}"), 1, `braces must balance.${dump(out)}`);
});

btest("A2 [rust]: assoc types and consts as declared; #[must_use] and comments are not surface", () => {
  const sig = "pub trait LeaseStore";
  const out = recoverTraitSurface(sig, SRC_LEASE_STORE);
  assert.notEqual(out, sig, `the trait is declared in the source; refusing it is a miss.${dump(out)}`);
  assert.ok(/type Lease\s*;/.test(out), `the bare assoc type, as declared.${dump(out)}`);
  assert.ok(
    /type Error:\s*std::error::Error \+ Send\s*;/.test(out),
    `the bounded assoc type keeps its bound.${dump(out)}`,
  );
  assert.ok(/const TTL_SECS:\s*u64\s*;/.test(out), `the assoc const, as declared.${dump(out)}`);
  for (const m of [
    /fn acquire\(&mut self, node_id: &str, epoch: u64\)\s*->\s*Result<Self::Lease, Self::Error>\s*;/,
    /fn renew\(&mut self, lease: &Self::Lease\)\s*->\s*Result<\(\), Self::Error>\s*;/,
    /fn release\(&mut self, lease: Self::Lease\)\s*->\s*Result<\(\), Self::Error>\s*;/,
  ]) {
    assert.ok(m.test(out), `method ${m} must arrive semicolon-terminated.${dump(out)}`);
  }
  assert.ok(!/#\[must_use\]/.test(out), `item attributes are not part of the rendered signature lines.${dump(out)}`);
  assert.ok(
    !/renewal happens|lease handle this store|Storage for the leader/.test(out),
    `neither the \`//\` comment nor the \`///\` prose is a member.${dump(out)}`,
  );
});

btest("A3 [rust]: a default-body method contributes its SIGNATURE only - no body text in the output", () => {
  const sig = "pub trait S3Downloader";
  const out = recoverTraitSurface(sig, SRC_S3_DOWNLOADER);
  assert.notEqual(out, sig, `the trait is declared in the source; refusing it is a miss.${dump(out)}`);
  assert.ok(/fn fetch\(&self, path: &str\)\s*->\s*Vec<u8>\s*;/.test(out), `the required method.${dump(out)}`);
  assert.ok(
    /fn fetch_with_retry\(&self, path: &str, max_attempts: u32\)\s*->\s*Vec<u8>\s*;/.test(out),
    `the default-body method arrives as a semicolon-terminated signature (Q1).${dump(out)}`,
  );
  assert.ok(/fn endpoint\(&self\)\s*->\s*&str\s*;/.test(out), `the second default-body method too.${dump(out)}`);
  assert.ok(
    !/let mut attempt|attempt \+=|\bloop\b|panic!|retries exhausted|s3\.amazonaws\.com/.test(out),
    `a body is implementation, not surface. No token of either default body may appear. (Bare /attempt/ ` +
      `was wrong here: the required signature's own \`max_attempts\` contains it - adversarial row V1.)${dump(out)}`,
  );
  assert.equal(count(out, "{"), 1, `signatures only means ONE brace pair in the whole surface.${dump(out)}`);
  assert.equal(count(out, "}"), 1, `braces must balance.${dump(out)}`);
});

btest("A4 [rust]: supertrait bounds and generics come from the SOURCE's head, not the bare hover", () => {
  // The hover is four words with no bounds; the source declares them. A caller
  // must know the bound line.
  const sig = "pub trait Codec<T>";
  const out = recoverTraitSurface(sig, SRC_CODEC);
  assert.notEqual(out, sig, `the trait is declared in the source; refusing it is a miss.${dump(out)}`);
  assert.ok(/pub trait Codec<T>/.test(out), `the generic head must survive.${dump(out)}`);
  assert.ok(
    /Codec<T>\s*:\s*Send \+ Sync/.test(out),
    `the SOURCE declares \`Codec<T>: Send + Sync\`; the surface renders the head as the source declares it.${dump(out)}`,
  );
  assert.ok(/fn encode\(&self, value: &T\)\s*->\s*Vec<u8>\s*;/.test(out), dump(out));
  assert.ok(/fn decode\(&self, bytes: &\[u8\]\)\s*->\s*Option<T>\s*;/.test(out), dump(out));
});

btest("A5 [rust]: a #[cfg]-gated item is OMITTED and the rest of the trait recovers", () => {
  const sig = "pub trait ShardRouter";
  const out = recoverTraitSurface(sig, SRC_CFG_ITEM);
  assert.notEqual(out, sig, `one gated item does not refuse the whole trait.${dump(out)}`);
  assert.ok(/fn route\(&self, key: &\[u8\]\)\s*->\s*u32\s*;/.test(out), dump(out));
  assert.ok(/fn shard_count\(&self\)\s*->\s*u32\s*;/.test(out), dump(out));
  assert.ok(
    !/route_fixed/.test(out),
    `\`route_fixed\` sits under \`#[cfg(test)]\` and may not exist in the caller's build. Omit it.${dump(out)}`,
  );
  assert.ok(!/#\[cfg/.test(out), `no cfg attribute text belongs in the surface.${dump(out)}`);
});

btest("A6 [rust]: #[cfg] on the trait DECLARATION itself refuses whole", () => {
  const sig = "pub trait GatedDownloader";
  assert.equal(
    recoverTraitSurface(sig, SRC_CFG_TRAIT),
    sig,
    `the whole trait may not exist in the caller's build; the only honest surface is none`,
  );
});

btest("A7 [rust]: an empty trait renders its head with an empty braced body - honest, not refused", () => {
  const sig = "pub trait Marker";
  const out = recoverTraitSurface(sig, SRC_MARKER);
  assert.ok(
    /pub trait Marker\s*\{\s*\}/.test(out),
    `\`pub trait Marker {}\` shape (Q2: bytes not pinned, shape is): the model learns the trait HAS no ` +
      `members, which is different from the product knowing nothing.${dump(out)}`,
  );
});

btest("A8 [rust]: two trait declarations of the name refuse whole", () => {
  const sig = "pub trait Dup";
  assert.equal(
    recoverTraitSurface(sig, SRC_DUP),
    sig,
    `\`Dup\` is declared twice in the source (Q4: the contract refuses on count alone). A guess ` +
      `between them reaches the model in the compiler's voice`,
  );
});

btest("A9 [rust]: a name present only as `impl Trait for` is NOT FOUND and refuses", () => {
  const sig = "pub trait Validate";
  assert.equal(
    recoverTraitSurface(sig, SRC_IMPL_ONLY),
    sig,
    `\`impl Validate for CompiledValidator\` is a use of the trait, not its declaration. Recovering ` +
      `the impl's method bodies as the trait's surface would be a fabrication`,
  );
});

btest("A10 [rust]: undefined and empty source refuse unchanged, and never throw", () => {
  const sig = "pub trait Validate";
  assert.equal(recoverTraitSurface(sig, undefined), sig, `undefined source: the def file read failed`);
  assert.equal(recoverTraitSurface(sig, ""), sig, `empty source: the def file read came back empty`);
  // A non-trait signature with no source must also come back untouched.
  assert.equal(recoverTraitSurface("", SRC_VALIDATE), "", `an empty signature is not a bare trait head`);
});

btest("A11 [rust]: a source the parser cannot balance refuses whole", () => {
  const sig = "pub trait Broken";
  assert.equal(
    recoverTraitSurface(sig, SRC_UNBALANCED),
    sig,
    `the declaration never closes; any surface rendered from it is a guess`,
  );
});

btest("A12 [rust]: ADVERSARIAL - a brace inside a default body's string literal: parse correctly or refuse whole; a mangled surface is red", () => {
  const sig = "pub trait KeyRenderer";
  const out = recoverTraitSurface(sig, SRC_LITERAL_BRACE);
  if (out === sig) {
    // Whole refusal is GREEN: the contract allows a parser that cannot prove
    // this body's braces to refuse the type.
    return;
  }
  // The recovery chose to parse. Then it must have parsed CORRECTLY: a parser
  // that counted the literal's braces closed the trait early, which shows up
  // as one of the three mangles below.
  assert.ok(
    /fn render_key\(&self, shard: u32\)\s*->\s*String\s*;/.test(out),
    `mangled: the default-body method's signature is missing or malformed.${dump(out)}`,
  );
  assert.ok(
    /fn key_prefix\(&self\)\s*->\s*String\s*;/.test(out),
    `mangled: the method AFTER the literal-brace body was dropped - the parser closed the trait early.${dump(out)}`,
  );
  assert.ok(
    !out.includes('"'),
    `mangled: body text leaked. No signature in this trait contains a string literal, so no quote ` +
      `character may appear in the surface.${dump(out)}`,
  );
  assert.ok(
    !/let open|let close|format!|shard-/.test(out),
    `mangled: default-body text leaked into the surface.${dump(out)}`,
  );
});

// ===========================================================================
// B. THE TRIGGER PREDICATE. The reversal is deliberate and written into the
// rows: v39's recovery keys on an elision marker; this phase has no marker to
// key on - the key is a trait-shaped hover (plus empty members, which the
// predicate's caller supplies).
// ===========================================================================

btest("B1 [rust]: bare trait heads trigger - plain, no-pub, supertraits, generics", () => {
  for (const h of [
    "pub trait Validate",
    "trait LeaseStore",
    "pub trait X: Read + Send",
    "pub trait Codec<T>",
    "pub trait S3Downloader: Send + Sync",
  ]) {
    assert.equal(isBareTraitHover(h), true, `${show(h)} is a bare trait head and must trigger`);
  }
});

btest("B2 [rust]: attributes and where-clauses around the head still answer by the head's shape", () => {
  const withAttr = ["#[non_exhaustive]", "pub trait Validate"].join("\n");
  assert.equal(isBareTraitHover(withAttr), true, `an attribute above the head does not change its shape`);
  const withWhere = ["pub trait Codec<T>", "where", "    T: Sized"].join("\n");
  assert.equal(isBareTraitHover(withWhere), true, `a where-clause after the head does not add a member body`);
});

btest("B3 [rust]: struct, enum and fn hovers do NOT trigger", () => {
  for (const h of [
    HOVER_STRUCT,
    HOVER_ENUM,
    HOVER_ELIDED_STRUCT,
    "pub struct Scraper",
    "pub fn validate(&self, event_value: &[u8]) -> Result<(), String>",
  ]) {
    assert.equal(isBareTraitHover(h), false, `${show(h)} is not a trait head and must not trigger`);
  }
});

btest("B4 [rust]: a trait hover that DOES carry a braced member body does not trigger", () => {
  assert.equal(
    isBareTraitHover(HOVER_TRAIT_WITH_BODY),
    false,
    `the server already answered with a surface; there is nothing bare to recover`,
  );
});

btest("B5 [rust]: the empty string and non-Rust text do not trigger", () => {
  assert.equal(isBareTraitHover(""), false, `empty string`);
  for (const h of [
    "export interface LeaseStore",
    "the trait object is boxed before it crosses the channel",
  ]) {
    assert.equal(isBareTraitHover(h), false, `${show(h)} is not a Rust trait head`);
  }
});

// ===========================================================================
// C. CONTROLS. Non-trait hovers pass through the new function untouched, so
// the v39 recovery path keeps sole custody of its own inputs. No internals
// imported for that: the assertion is on observable pass-through.
// ===========================================================================

btest("C1 [rust]: a STRUCT hover passes through untouched, even with a same-named trait in the source", () => {
  // The trap: the source declares `trait Widget` and the hover is the STRUCT
  // Widget. A recovery keyed on the name instead of the hover's shape rewrites
  // a struct into a trait surface.
  const src = [
    "pub trait Widget {",
    "    fn draw(&self);",
    "}",
    "",
    "pub struct Widget {",
    "    pub id: u32,",
    "}",
    "",
  ].join("\n");
  const hover = ["pub struct Widget {", "    pub id: u32,", "}"].join("\n");
  assert.equal(recoverTraitSurface(hover, src), hover, `a struct hover is not this function's input`);
});

btest("C2 [rust]: an ENUM hover passes through untouched", () => {
  assert.equal(recoverTraitSurface(HOVER_ENUM, SRC_VALIDATE), HOVER_ENUM, `an enum hover is not this function's input`);
});

btest("C3 [rust]: a v39-shaped elided struct hover is byte-identical through the new function", () => {
  // The `/* … */` marker is v39's trigger, not this phase's. The new function
  // must hand it back byte for byte so `recoverElidedSurface` keeps sole
  // custody of the elision path.
  assert.equal(
    recoverTraitSurface(HOVER_ELIDED_STRUCT, SRC_VALIDATE),
    HOVER_ELIDED_STRUCT,
    `the elision marker belongs to the v39 path; this function may not consume or rewrite it`,
  );
});
