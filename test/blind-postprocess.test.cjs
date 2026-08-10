// Blind oracle: postprocess filter contract (phase1-surface.md
// "src/core/postprocess.ts"). Written against the surface doc only; never
// read src/**. Expected red while step-A stubs throw "unimplemented".
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-postprocess",
  `export {
  trimStopTokens,
  toSingleLine,
  dropDuplicateSuffixLines,
  limitScopeByIndentation,
  removeRepetitiveBlocks,
  postprocess,
} from "../src/core/postprocess";\n`
);
const {
  trimStopTokens,
  toSingleLine,
  dropDuplicateSuffixLines,
  limitScopeByIndentation,
  removeRepetitiveBlocks,
  postprocess,
} = mod;
test.after(cleanup);

// ---- trimStopTokens [surface: 'cuts the text at the first occurrence of any leaked FIM special token']

const STOP_TOKENS = [
  "<|fim_prefix|>",
  "<|fim_suffix|>",
  "<|fim_middle|>",
  "<|fim_pad|>",
  "<|repo_name|>",
  "<|file_sep|>",
  "<|endoftext|>",
];

for (const tok of STOP_TOKENS) {
  test(`trimStopTokens cuts at ${tok} [surface: trimStopTokens]`, () => {
    assert.strictEqual(trimStopTokens(`keep();${tok}drop();`), "keep();");
  });
}

test("trimStopTokens leaves token-free text unchanged [surface: trimStopTokens]", () => {
  const text = "plain();\nsecond();";
  assert.strictEqual(trimStopTokens(text), text);
});

test("trimStopTokens cuts at the FIRST token when several leak [surface: 'first occurrence of any']", () => {
  assert.strictEqual(
    trimStopTokens("a<|fim_pad|>b<|endoftext|>c"),
    "a"
  );
});

// ---- toSingleLine [surface: 'keeps only the text before the first newline']

for (const [input, expected] of [
  ["a\nb\nc", "a"],
  ["one line", "one line"],
  ["\ntail", ""],
]) {
  test(`toSingleLine(${JSON.stringify(input)}) === ${JSON.stringify(expected)} [surface: toSingleLine]`, () => {
    assert.strictEqual(toSingleLine(input), expected);
  });
}

// ---- dropDuplicateSuffixLines [surface: 'the suggestion never re-types code that is already in the buffer below the cursor']

test("dropDuplicateSuffixLines (a): character-level tail/suffix-head overlap is removed [surface: dropDuplicateSuffixLines (a)]", () => {
  const completion = "const sum = a + b;\nreturn sum;";
  const suffix = "\nreturn sum;\n}";
  const out = dropDuplicateSuffixLines(completion, suffix);
  assert.ok(completion.startsWith(out), "result is a head of the input");
  assert.ok(!out.includes("return sum;"), "duplicated tail removed");
  assert.strictEqual(out.trimEnd(), "const sum = a + b;");
});

test("dropDuplicateSuffixLines (b): completion cut before the line that starts repeating the suffix lines [surface: dropDuplicateSuffixLines (b)]", () => {
  const completion = "let total = 0;\n  return total;\n}";
  const suffix = "\n  return total;\n}\nmodule.exports = f;";
  const out = dropDuplicateSuffixLines(completion, suffix);
  assert.ok(!out.includes("return total"), "cut before the duplicated line");
  assert.strictEqual(out.trimEnd(), "let total = 0;");
});

test("dropDuplicateSuffixLines: no duplication passes through unchanged [surface: dropDuplicateSuffixLines]", () => {
  assert.strictEqual(dropDuplicateSuffixLines("x = 1;", "y = 2;"), "x = 1;");
});

// ---- limitScopeByIndentation [surface: 'a multi-line completion must not escape the block the cursor is in']

test("limitScopeByIndentation cuts before the first line shallower than the cursor depth [surface: limitScopeByIndentation]", () => {
  const out = limitScopeByIndentation(
    "done();\n    next();\nfunction escape() {",
    "    " // cursor at depth 4
  );
  assert.ok(out.includes("done();"), "first line kept");
  assert.ok(out.includes("next();"), "same-depth line kept");
  assert.ok(!out.includes("escape"), "shallower non-closer line cut");
});

test("limitScopeByIndentation keeps a single immediate block-closing line one level shallower as the final line [surface: 'except a single immediate block-closing line']", () => {
  const out = limitScopeByIndentation("return x;\n}", "  ");
  assert.strictEqual(out.trimEnd().split("\n").pop().trim(), "}", "closer kept as final line");
});

test("limitScopeByIndentation cuts everything after the kept block-closing line [surface: 'may be kept as the final line']", () => {
  const out = limitScopeByIndentation("return x;\n}\nfunction next() {", "  ");
  assert.ok(!out.includes("function next"), "nothing survives past the closer");
  assert.strictEqual(out.trimEnd().split("\n").pop().trim(), "}");
});

test("limitScopeByIndentation never cuts the first line, which continues the cursor line [surface: 'First line of the completion ... is never cut']", () => {
  assert.strictEqual(limitScopeByIndentation("}", "    ").trimEnd(), "}");
});

test("limitScopeByIndentation ignores blank lines for depth comparison [surface: 'Blank lines are ignored for depth comparison']", () => {
  const out = limitScopeByIndentation("a();\n\n  b();\nc();", "  ");
  assert.ok(out.includes("b();"), "blank line does not end the block");
  assert.ok(!out.includes("c();"), "shallower line after the blank still cut");
});

// ---- removeRepetitiveBlocks [surface: 'the failure mode of small FIM models running on']

const BLOCK = "count += 1;\nlist.push(count);\n";

test("removeRepetitiveBlocks truncates a block repeated 4+ times to at most 2 consecutive repeats [surface: removeRepetitiveBlocks guarantee]", () => {
  const input = "let count = 0;\n" + BLOCK.repeat(6);
  const out = removeRepetitiveBlocks(input);
  assert.ok(out.length < input.length, "output strictly shorter");
  assert.ok(!out.includes(BLOCK.repeat(3)), "at most 2 consecutive repeats survive");
});

test("removeRepetitiveBlocks leaves non-repetitive text unchanged [surface: 'text with no consecutive repetition passes through unchanged']", () => {
  const text = "alpha();\nbeta();\ngamma();";
  assert.strictEqual(removeRepetitiveBlocks(text), text);
});

// ---- idempotence [surface: 'Every filter is pure and idempotent: filter(filter(x)) === filter(x)']

const IDEMPOTENCE_CASES = [
  ["trimStopTokens", (x) => trimStopTokens(x), "keep();<|endoftext|>drop();"],
  ["toSingleLine", (x) => toSingleLine(x), "a\nb\nc"],
  [
    "dropDuplicateSuffixLines",
    (x) => dropDuplicateSuffixLines(x, "\nreturn sum;\n}"),
    "const sum = a + b;\nreturn sum;",
  ],
  [
    "limitScopeByIndentation",
    (x) => limitScopeByIndentation(x, "    "),
    "done();\n    next();\nfunction escape() {",
  ],
  ["removeRepetitiveBlocks", (x) => removeRepetitiveBlocks(x), "seed();\n" + BLOCK.repeat(6)],
];

for (const [name, f, input] of IDEMPOTENCE_CASES) {
  test(`${name} is idempotent: f(f(x)) === f(x) [surface: 'Every filter is pure and idempotent']`, () => {
    const once = f(input);
    assert.strictEqual(f(once), once);
  });
}

// ---- postprocess pipeline [surface: 'postprocess runs the filters in this order']

const CTX = { suffix: "", currentLinePrefix: "", multiline: true };

test("postprocess applies stop-token trim [surface: pipeline step trimStopTokens]", () => {
  assert.strictEqual(postprocess("code();<|endoftext|>garbage", CTX), "code();");
});

test("postprocess applies toSingleLine only when multiline is false [surface: 'toSingleLine when ctx.multiline is false']", () => {
  assert.strictEqual(
    postprocess("first();\nsecond();", { ...CTX, multiline: false }),
    "first();"
  );
  assert.strictEqual(
    postprocess("first();\nsecond();", { ...CTX, multiline: true }),
    "first();\nsecond();"
  );
});

test("postprocess cleans trailing whitespace [surface: 'then trailing-whitespace cleanup']", () => {
  assert.strictEqual(postprocess("value();  \n\n", CTX), "value();");
});

for (const raw of ["<|fim_pad|>anything", "", "   \n\t "]) {
  test(`postprocess returns "" when nothing survivable remains (raw=${JSON.stringify(raw)}) [surface: 'Returns "" when nothing survivable remains']`, () => {
    assert.strictEqual(postprocess(raw, CTX), "");
  });
}

test("postprocess composes scope limit, suffix dedup, and stop trim in one pass [surface: pipeline order]", () => {
  // Cursor at depth 2. limitScope runs before dropDuplicateSuffixLines, so the
  // depth-0 "return out;" line is cut by scope before dedup even sees it, and
  // the leaked stop token was already trimmed first.
  const raw = "let out = compute();\n  log(out);\nreturn out;\n}<|endoftext|>trash";
  const ctx = { suffix: "\nreturn out;\n}", currentLinePrefix: "  ", multiline: true };
  const out = postprocess(raw, ctx);
  assert.ok(out.startsWith("let out = compute();"), "first line survives");
  assert.ok(out.includes("log(out);"), "in-scope line survives");
  assert.ok(!out.includes("trash"), "stop token trimmed first");
  assert.ok(!out.includes("return out;"), "block escape / suffix duplicate removed");
});

test("postprocess is idempotent end to end [surface: filters pure and idempotent, cleanup included]", () => {
  const raw = "let out = compute();\n  log(out);\nreturn out;\n}<|endoftext|>trash";
  const ctx = { suffix: "\nreturn out;\n}", currentLinePrefix: "  ", multiline: true };
  const once = postprocess(raw, ctx);
  assert.strictEqual(postprocess(once, ctx), once);
});
