// session-v75 phase 5: no prompt whose ANSWER IS A POINTER may teach by
// concrete identifier.
//
// The defect this guards was not a bad sentence. `assembleProposerPrompt`
// carried a worked example, `"shard mem cache" is how a transcript spells
// `ShardMemCache``, and on the default local model the reply was `ShardMemCache`
// on 49 of 160 dictation items - the example, answered instead of the data.
// The parser dropped every one of them, so the gesture went quiet rather than
// wrong, which is why it survived four sessions of review.
//
// WHY THE RULE IS SCOPED TO POINTER PROMPTS, and not to every prompt in the
// product. A prompt that asks for CODE can name `assert_eq!` and `[InlineData]`
// and `todo!()`, because it has to: those identifiers are the framework the
// answer is written in, the answer is compiled, and an echo is caught by the
// build. A prompt whose answer is a NAME or a LINE OF THE USER'S OWN TEXT has
// no such check. There the example is spelled in the exact shape the answer
// takes, and a model that reaches for it produces something the product cannot
// tell from a real answer. The tighten proposer only got off lightly because
// `parseProposerReply` refuses a span the prose does not contain.
//
// THE RULE IS WORDING-INDEPENDENT, which is the point. It says nothing about
// microphones or transcripts. Reword the prompt however you like; put a
// concrete type name back in it and this file goes red.
//
// WHAT IT CANNOT DO. The list of pointer prompts below is maintained by hand. A
// new prompt that asks a model to point at something, added without a row here,
// is not covered - there is no way to detect "the answer is a pointer" from the
// source. `session-v75/scraps.md` carries that gap. The four rows here are the
// whole pointer-output family as of this session's audit.

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { bundleCore } = require("./.blind-util.cjs");

const loaded = bundleCore(
  "v75-p5-no-worked-example",
  [
    `export { assembleProposerPrompt } from "../src/core/tightenProposer";`,
    `export { buildExplainPrompt } from "../src/core/criticizeExplain";`,
    `export { buildAdvicePrompt } from "../src/core/criticizeAdvise";`,
    `export { buildHonestyPrompt } from "../src/core/criticizeHonestyModel";`,
    `export { criticizeLangFor } from "../src/core/criticizeLang";`,
    "",
  ].join("\n"),
);
const mod = loaded.mod;
test.after(() => loaded.cleanup());

/**
 * A token that names something ONLY A CODEBASE PRODUCES.
 *
 * Three shapes, and two things deliberately excluded. What fires: a backticked
 * name with a hump boundary (`ShardMemCache`, and the qualified forms
 * `foo::Bar`, `Assert.AreEqual`), a `snake_case` run anywhere, and a call or
 * macro shape anywhere.
 *
 * What does NOT fire, both learned by running this guard against the product:
 *
 *  - **A bare PascalCase word.** The first version caught `McCabe 1976` in the
 *    advice prompt's rubric sources. That is a citation, and a review prompt
 *    naming the source of a principle is the prompt doing its job. A rule with
 *    a false positive on the product's own bibliography is a rule someone
 *    deletes.
 *  - **A single LOWER-CASE word in backticks.** The advice prompt spells its
 *    reply schema `` `anchor` `` and `` `line` ``, and the model MUST write
 *    those keys. A required format token is the opposite of a worked example:
 *    echoing it is the correct answer. `ShardMemCache` was neither required nor
 *    checkable.
 *
 * A BACKTICKED WORD THAT STARTS WITH A CAPITAL IS CAUGHT EVEN WITH ONE HUMP,
 * and the first version of this guard missed exactly that. It demanded an
 * INTERNAL hump, so `` `Lease` `` and `` `Request` `` passed - and adversarial
 * review put `"lease" is how a transcript spells \`Lease\`` back into the real
 * shipped prompt and watched all six rows stay green. Those two are not
 * hypothetical names: they are two of the three junk rows this very session
 * measured coming back out of the workspace. A capital letter inside backticks
 * is a type name in every language this product serves.
 *
 * The cost, stated rather than hidden: a prompt that wrote "a type name like
 * ShardMemCache" with no backticks would pass. Nothing in this product writes
 * an identifier that way, and it is the trade that buys a rule with no
 * exception list.
 */
const IDENTIFIER_SHAPES = [
  {
    name: "a backticked code name",
    re: /`[A-Za-z_][A-Za-z0-9_]*(?:(?:[.:]{1,2}|_)[A-Za-z0-9_]+)*!?(?:\(\s*\))?`/g,
    // A leading capital, an internal hump, an underscore, a qualifier or a call
    // shape. Only an all-lower-case bare word is let through, because that is a
    // schema key rather than a name out of a codebase.
    keep: (token) => /^[A-Z]|[A-Z][a-z0-9]+[A-Z]|_|[.:]|!|\(/.test(token.slice(1, -1)),
  },
  { name: "snake_case", re: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g },
  { name: "a call or macro shape", re: /\b[A-Za-z_][A-Za-z0-9_.]*!?\(\s*\)/g },
];

/** Every identifier-shaped token in a string, deduplicated. */
function identifiersIn(text) {
  const found = new Map();
  for (const shape of IDENTIFIER_SHAPES) {
    for (const hit of String(text).matchAll(shape.re)) {
      if (shape.keep !== undefined && !shape.keep(hit[0])) {
        continue;
      }
      found.set(hit[0], shape.name);
    }
  }
  return found;
}

/**
 * THE INPUTS CARRY NO IDENTIFIER, so anything the guard finds in the assembled
 * prompt is the prompt's own words.
 *
 * That is what makes the check exact rather than a heuristic with an allow
 * list. A sentinel that smuggled in a `ClientSet` would make the rule
 * unfalsifiable in the one direction that matters, so each sentinel is checked
 * against the same shapes before it is used.
 */
const SERVED_LANGUAGES = ["rust", "typescript", "csharp", "python", "go"];

const SENTINEL_PROSE = "then put the thing into the other thing before the loop runs";

function sentinelFunction(languageId) {
  return {
    languageId,
    name: "f",
    lines: ["/// the doc line above it", "fn f() {", "    let x = 1;", "}"],
    startLine: 10,
    headIndex: 1,
    bodyIndex: 2,
  };
}

test("v75-p5 0: the sentinels themselves carry no identifier, or the guard proves nothing", () => {
  const prose = identifiersIn(SENTINEL_PROSE);
  assert.equal(prose.size, 0, `the sentinel prose carries ${[...prose.keys()].join(", ")}`);
});

/**
 * The pointer-output prompts, with an assembler that uses the sentinels.
 *
 * `buildAdvicePrompt` and `buildHonestyPrompt` are handed a function slice, and
 * a function slice is code, so its identifiers are the caller's data by
 * construction. They are subtracted from the result rather than excluded from
 * the prompt: the rule is about the prompt's OWN words.
 */
const POINTER_PROMPTS = [
  {
    name: "assembleProposerPrompt",
    answer: "a span of the developer's own doc comment",
    // EVERY SERVED LANGUAGE, not just one. The prompt interpolates
    // `languageId`, so a branch that said something extra for C# would never be
    // assembled by a guard that only ever asks about Rust.
    build: () => ({
      prompt: SERVED_LANGUAGES.map((languageId) =>
        mod.assembleProposerPrompt({ prose: SENTINEL_PROSE, languageId }),
      ).join("\n"),
      fromInput: [SENTINEL_PROSE],
    }),
  },
  {
    name: "buildExplainPrompt",
    answer: "prose about one finding, planted into the developer's source file",
    build: () => ({
      prompt: mod.buildExplainPrompt({
        finding: {
          dimension: "honesty",
          detail: "the body reads something the caller did not hand it",
          line: 12,
          evidence: "    let now = clock();",
        },
        source: "a function answers a question or changes the world, never both",
      }),
      fromInput: ["    let now = clock();"],
    }),
  },
  {
    name: "buildAdvicePrompt",
    answer: "review blocks anchored to a line copied out of the function",
    build: () => {
      const lang = mod.criticizeLangFor("rust");
      assert.ok(lang, 'criticizeLangFor("rust") gave no profile, so this row would grade nothing');
      const fn = sentinelFunction("rust");
      return { prompt: mod.buildAdvicePrompt(fn, lang, {}), fromInput: fn.lines };
    },
  },
  {
    name: "buildHonestyPrompt",
    answer: "document line numbers, per dimension",
    build: () => {
      const lang = mod.criticizeLangFor("rust");
      assert.ok(lang, 'criticizeLangFor("rust") gave no profile, so this row would grade nothing');
      const fn = sentinelFunction("rust");
      return { prompt: mod.buildHonestyPrompt(fn, lang, {}), fromInput: fn.lines };
    },
  },
];

for (const row of POINTER_PROMPTS) {
  test(`v75-p5: ${row.name} teaches by no concrete identifier (its answer is ${row.answer})`, () => {
    const built = row.build();
    assert.ok(typeof built.prompt === "string" && built.prompt.length > 0, `${row.name} produced no prompt`);
    const fromInput = new Set();
    for (const text of built.fromInput) {
      for (const name of identifiersIn(text).keys()) {
        fromInput.add(name);
      }
    }
    const offenders = [...identifiersIn(built.prompt)]
      .filter(([name]) => !fromInput.has(name))
      .map(([name, shape]) => `${JSON.stringify(name)} (${shape})`);
    assert.deepEqual(
      offenders,
      [],
      `${row.name} carries a concrete identifier that did not come from its caller: ${offenders.join(", ")}.\n` +
        "Its answer is a pointer, so a model that reaches for the example produces something the product " +
        "cannot tell from a real answer. Describe the shape instead of naming one.",
    );
  });
}

test("v75-p5: the guard fails on a ONE-HUMP backticked name, the escape review proved", () => {
  // `Lease` is a real type in the measurement corpus and one of the three junk
  // rows this session measured. The first version of this guard let a prompt
  // teaching `` `Lease` `` straight through, verified against the real
  // assembler, so the escape gets its own row rather than a note.
  const escaped = 'so a type name arrives as separate spoken words: "lease" is how a transcript spells `Lease`.';
  const found = identifiersIn(escaped);
  assert.ok(
    [...found.keys()].some((t) => t.includes("Lease")),
    `the guard still lets a one-hump backticked type name through (it found ${JSON.stringify([...found.keys()])})`,
  );
});

test("v75-p5: the guard fails on the sentence this session deleted", () => {
  // THE FALSIFIER. A rule that cannot go red is decoration, and this session
  // has been bitten by that shape before: the check is run against the exact
  // wording that shipped until v75 and must reject it.
  const shipped =
    'Below is a doc comment a developer dictated for some rust code. It was transcribed by a microphone, ' +
    'so a type name arrives as separate spoken words with arbitrary capitalisation: "shard mem cache" is ' +
    "how a transcript spells `ShardMemCache`.";
  const found = identifiersIn(shipped);
  assert.ok(
    [...found.keys()].some((t) => t.includes("ShardMemCache")),
    `the guard does not recognise the identifier it exists to catch (it found ${JSON.stringify([...found.keys()])})`,
  );
});
