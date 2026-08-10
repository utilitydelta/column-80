// Blind oracle: phase 0b budget-profile seam
// [session-v46/contract-phase0b.md]. Black-box against the written contract
// only: `modelClassFor(provider, modelTag)` and `budgetProfileFor(cls,
// languageId)` from the new core module (contract's suggested name
// src/core/budgetProfile.ts - if the implementer picks another name, the
// contract requires it exported through the same paths, so this import is the
// contract's default). Never read src/**; expected RED until the module
// exists - that is the TDD state, not a regression.
//
// Run: SKIP_LIVE=1 node --test test/blind-v46-budgetprofile.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

let mod, cleanup;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v46-budgetprofile",
    `export { modelClassFor, budgetProfileFor } from "../src/core/budgetProfile";\n`
  ));
} catch (e) {
  // Module not implemented yet: the expected TDD red. Remove the leaked
  // entry file so the bundle failure does not litter test/, then rethrow so
  // this whole file reports red.
  fs.rmSync(path.join(__dirname, ".blind-v46-budgetprofile.entry.ts"), {
    force: true,
  });
  throw e;
}
const { modelClassFor, budgetProfileFor } = mod;
test.after(cleanup);

// The three class literals the contract's return type names
// ["fim-small" | "local-mid" | "frontier"].
const CLASSES = ["fim-small", "local-mid", "frontier"];

// "EVERY shipped language id (rust, typescript, csharp, python, go)".
const LANGS = ["rust", "typescript", "csharp", "python", "go"];

// ---------------------------------------------------------------------------
// 1. modelClassFor is pure, total, never throws ["Pure, total, never throws."]
// ---------------------------------------------------------------------------

test("modelClassFor is total and never throws, even on degenerate input", () => {
  const inputs = [
    ["", ""],
    ["", "qwen2.5-coder:1.5b"],
    ["garbage-provider", "garbage-tag"],
    ["   ", "\n\t"],
    ["\u0000", "￿"],
    ["a".repeat(10000), "b".repeat(10000)],
    ["ollama", ""],
    ["anthropic", ""],
  ];
  for (const [provider, tag] of inputs) {
    let out;
    assert.doesNotThrow(
      () => {
        out = modelClassFor(provider, tag);
      },
      `modelClassFor(${JSON.stringify(provider)}, ${JSON.stringify(tag)}) threw`
    );
    assert.ok(
      CLASSES.includes(out),
      `modelClassFor(${JSON.stringify(provider)}, ${JSON.stringify(
        tag
      )}) returned ${JSON.stringify(out)}, not one of the three class literals`
    );
  }
});

test("modelClassFor is pure: same inputs, same output", () => {
  const pairs = [
    ["ollama", "qwen2.5-coder:1.5b"],
    ["anthropic", "claude-sonnet-4"],
    ["nobody-knows", "nobody-knows-this-tag"],
  ];
  for (const [provider, tag] of pairs) {
    assert.strictEqual(
      modelClassFor(provider, tag),
      modelClassFor(provider, tag),
      `modelClassFor not stable for (${provider}, ${tag})`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Provider mappings ["claude-code, anthropic, openai, xai, gemini ...
//    resolve to frontier"; "Provider ollama (and the empty/default provider)
//    resolves by tag"; "An UNKNOWN tag on an unknown provider resolves to
//    local-mid (conservative) - never frontier"]
// ---------------------------------------------------------------------------

test("named cloud providers resolve to frontier regardless of tag", () => {
  // The contract states these providers "resolve to frontier" with no tag
  // condition, so the tag - even empty, even the FIM family tag - does not
  // demote them.
  for (const provider of ["claude-code", "anthropic", "openai", "xai", "gemini"]) {
    assert.strictEqual(
      modelClassFor(provider, "some-model-tag"),
      "frontier",
      `${provider} with an ordinary tag`
    );
    assert.strictEqual(
      modelClassFor(provider, ""),
      "frontier",
      `${provider} with an empty tag`
    );
  }
  assert.strictEqual(
    modelClassFor("anthropic", "qwen2.5-coder:1.5b"),
    "frontier",
    "a named cloud provider is frontier even when the tag looks like the FIM family"
  );
});

test("ollama and the empty/default provider resolve by tag", () => {
  // "the shipped FIM tag family (qwen2.5-coder:1.5b*) is fim-small" - the
  // trailing * makes it a prefix family, so suffixed variants are included.
  assert.strictEqual(modelClassFor("ollama", "qwen2.5-coder:1.5b"), "fim-small");
  assert.strictEqual(
    modelClassFor("ollama", "qwen2.5-coder:1.5b-base"),
    "fim-small",
    "family suffix -base"
  );
  assert.strictEqual(
    modelClassFor("ollama", "qwen2.5-coder:1.5b-instruct-q4_K_M"),
    "fim-small",
    "family suffix -instruct-q4_K_M"
  );
  assert.strictEqual(
    modelClassFor("", "qwen2.5-coder:1.5b"),
    "fim-small",
    "the empty/default provider resolves by tag like ollama"
  );

  // "anything else local is local-mid".
  assert.strictEqual(
    modelClassFor("ollama", "qwen2.5-coder:7b"),
    "local-mid",
    "same model name outside the 1.5b family is NOT fim-small"
  );
  assert.strictEqual(modelClassFor("ollama", "llama3:8b"), "local-mid");
  assert.strictEqual(
    modelClassFor("ollama", ""),
    "local-mid",
    "an empty tag on ollama is not the FIM family, so local-mid"
  );
  assert.strictEqual(modelClassFor("", "llama3:8b"), "local-mid");
});

test("unknown provider with unknown tag is local-mid, never frontier", () => {
  // The contract holds two sentences in tension: "any other non-local
  // provider" resolves to frontier, yet "An UNKNOWN tag on an unknown
  // provider resolves to local-mid (conservative) - never frontier". A
  // black-box caller cannot know which arbitrary names count as "non-local",
  // so this suite binds only the explicit conservative rule. Whether a
  // recognisable-but-unlisted cloud name (e.g. "mistral") is frontier is NOT
  // pinned by the contract and is deliberately untested here.
  assert.strictEqual(
    modelClassFor("totally-unknown-provider", "totally-unknown-tag"),
    "local-mid"
  );
  assert.strictEqual(modelClassFor("mystery", "mystery:latest"), "local-mid");
  assert.notStrictEqual(
    modelClassFor("totally-unknown-provider", "totally-unknown-tag"),
    "frontier",
    "conservative rule: never frontier for unknown+unknown"
  );
  assert.notStrictEqual(
    modelClassFor("zzz", "zzz"),
    "frontier",
    "conservative rule: never frontier for unknown+unknown"
  );
});

// ---------------------------------------------------------------------------
// 3. budgetProfileFor identity defaults ["With no profile overrides
//    configured, for EVERY class and EVERY shipped language id"] - the eight
//    named values, all classes x all languages. csharp's 300 is stated as
//    300 x CS_BUDGET_FACTOR with the factor 1 today, so the observable is
//    still exactly 300.
// ---------------------------------------------------------------------------

// SUPERSEDED FIELD, session-v47: `maxTokens` is no longer class-independent.
// The identity table was written when one flat 2048 served every class. That
// number was measured against a local 30B with no reasoning budget, and it also
// gated cloud models: on Claude Opus 5, Sonnet 5 and Fable 5 an omitted
// `thinking` parameter runs adaptive thinking, and `max_tokens` caps thinking
// PLUS answer, so 2048 was spent before the model began answering and the round
// failed as a truncated generation. The frontier cell now serves 64000.
//
// The identity property the contract is really about is intact and is what the
// rest of this table still pins: every OTHER field is class-independent, and
// `CELL_OVERRIDES` still ships empty, so a replayed generation produces a
// byte-identical prompt. `maxTokens` moved to a declared per-class table, not to
// a per-cell override, which is why it is asserted separately below.
const IDENTITY = {
  surfaceBudgetTok: 300,
  memberCap: 24,
  surfaceCap: 4,
  refineTotalChars: 2400,
  walkTokMax: 200,
  numCtx: 16384,
  timeoutMs: 120000,
};

/** `maxTokens` by class: local classes keep the measured 2048, frontier gets
 *  room for adaptive thinking. */
const MAX_TOKENS_BY_CLASS = {
  "fim-small": 2048,
  "local-mid": 2048,
  frontier: 64000,
};

// RE-CUT by session-v48 phase 1 (docs/supersessions.md). `budgetProfileFor` now
// takes a REQUIRED third argument, the context stop, because the four numbers
// the dial moves are resolved in the same seam. The v46 contract's "identity
// defaults" ARE the pre-dial point, which the stop table calls `shipped` and
// which is spelled against the same two module constants (`DATASHAPE_TOTAL_TOK`,
// `PREFILL_TYPE_CAP`) the v46 table was written from. So the identity table
// below is unchanged, value for value; only the stop it is asked for is named.
// The dial's own default (`small`) is deliberately NOT what this asserts - that
// belongs to v48's contract, not v46's.
const IDENTITY_STOP = "shipped";

for (const cls of CLASSES) {
  test(`budgetProfileFor identity defaults - ${cls}, all five languages`, () => {
    for (const lang of LANGS) {
      const profile = budgetProfileFor(cls, lang, IDENTITY_STOP);
      // "returns at minimum { ... }": extra fields are allowed, so assert
      // each named field, not object equality. numCtx is stated as
      // "meaningful for local classes only" and timeoutMs "for the
      // claude-code transport", but the identity table lists both values
      // unconditionally for every class and language, so they are asserted
      // everywhere.
      assert.strictEqual(
        profile.maxTokens,
        MAX_TOKENS_BY_CLASS[cls],
        `budgetProfileFor(${JSON.stringify(cls)}, ${JSON.stringify(lang)}, ${JSON.stringify(IDENTITY_STOP)}).maxTokens`
      );
      for (const [key, want] of Object.entries(IDENTITY)) {
        assert.strictEqual(
          profile[key],
          want,
          `budgetProfileFor(${JSON.stringify(cls)}, ${JSON.stringify(
            lang
          )}).${key}`
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 4. Derivation property - UNTESTABLE BLACK-BOX RESIDUE
//
// The contract's "Deriveds are declared, not free-floating" section requires
// memberCap, surfaceCap, refineTotalChars, and walkTokMax to be expressed IN
// CODE as fractions/functions of surfaceBudgetTok, so that moving
// surfaceBudgetTok for a cell moves the deriveds with it. That is a
// code-shape requirement: the contract's stated API surface
// (modelClassFor + budgetProfileFor, "no settings/package.json surface this
// phase") exposes no overrides parameter or any other way to move
// surfaceBudgetTok from outside. Inventing one here would test behaviour the
// contract does not state, so this property is left to code review /
// implementation-side tests. Named residue, not an oversight.
// ---------------------------------------------------------------------------
