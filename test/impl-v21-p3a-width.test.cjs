// IMPLEMENTATION tests for the two renderers phase 3a widened: the block's
// width behaviour at a wide-but-real receiver, and the field render's one-line
// invariant.
//
//   - a captured 49-property entity is a REAL member site. Above the width
//     budget the block is truncated and SAYS it is truncated; the header tells
//     the model not to invent a name, so a silently cut list is a lie.
//   - far above it the set cannot be one receiver's surface at all (a mis-fire
//     that resolved a whole scope) and the block is skipped whole.
//   - renderFieldSignature emits exactly one line or nothing. Every consumer
//     joins the rendered signatures with newlines and splits them again, so a
//     second line becomes a candidate name that does not exist.
//
// Run: SKIP_LIVE=1 node --test test/impl-v21-p3a-width.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v21-p3a-width",
  `export * as fim from "../src/core/fimInject";\n` +
    `export * as extraction from "../src/core/extraction";\n`,
);
test.after(() => cleanup());

const { fim, extraction } = mod;

const props = (n, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Prop${String(from + i).padStart(2, "0")}`,
    kind: "field",
    signature: `int Stripe.Prop${String(from + i).padStart(2, "0")} { get; set; }`,
  }));

const lines = (block) => String(block).split("\n");
const memberLines = (block) => lines(block).slice(1);

// ---------------------------------------------------------------------------
// The width budget: truncate and say so, never vanish.
// ---------------------------------------------------------------------------

test("the captured 49-property entity plus its methods renders a block at all - a filter that succeeds must not turn a noisy block into no block", () => {
  const block = fim.renderFimCandidates(props(52), "");
  assert.notStrictEqual(block, undefined, "52 signed members is what a real entity looks like once the noise is gone");
  assert.ok(memberLines(block).length < 52, "and it is cut to the block's width budget");
});

test("the width boundary: the widest set that fits renders whole and unmarked; one line more renders truncated and marked", () => {
  const whole = fim.renderFimCandidates(props(40), "");
  assert.strictEqual(memberLines(whole).length, 40, "40 member lines fit");
  assert.ok(
    memberLines(whole).every((l) => /Prop\d\d/.test(l)),
    `nothing but members at the boundary:\n${whole}`,
  );

  const over = fim.renderFimCandidates(props(41), "");
  const shown = memberLines(over).filter((l) => /Prop\d\d/.test(l));
  assert.strictEqual(shown.length, 40, "the 41st line is cut");
  const marker = memberLines(over).filter((l) => !/Prop\d\d/.test(l));
  assert.strictEqual(marker.length, 1, `exactly one line says the list is cut:\n${over}`);
  assert.match(marker[0], /\b1\b/, "and it says HOW MANY were cut, so the model is not told 31-of-69 with no ellipsis");
});

test("a truncated block still names the members it shows exactly, and the marker is a comment in the buffer's own language", () => {
  const block = fim.renderFimCandidates(props(52), "", "#");
  for (const l of lines(block)) {
    assert.ok(l.startsWith("# "), `a Python buffer takes Python comments: ${JSON.stringify(l)}`);
  }
  assert.match(String(block), /^# int Stripe\.Prop00 /m);
});

test("a runaway set - far wider than any receiver's surface - is still skipped whole rather than truncated to 40 arbitrary names", () => {
  assert.strictEqual(
    fim.renderFimCandidates(props(60), ""),
    undefined,
    "a mis-fire that resolved a whole scope injects nothing",
  );
  assert.strictEqual(fim.renderFimCandidates(props(200), ""), undefined);
});

test("narrowing to the typed partial is measured against the width budget, not the raw set: a wide receiver narrowed to a handful renders whole", () => {
  const wide = [...props(30), ...props(30, 100)];
  const block = fim.renderFimCandidates(wide, "Prop10");
  assert.notStrictEqual(block, undefined);
  assert.ok(
    memberLines(block).every((l) => l.includes("Prop10")),
    `only the narrowed members:\n${block}`,
  );
});

// ---------------------------------------------------------------------------
// The enforcement gate travels on every name, including the cut ones. The
// provider builds it off the MEMBERS, so this pins the property the block
// cannot break: narrowToPartial (what the gate is built from) is unaffected by
// the width budget.
// ---------------------------------------------------------------------------

test("every member survives to the enforcement set, including the ones the block cut", () => {
  const members = props(52);
  const names = fim.narrowToPartial(members, "").map((m) => m.name);
  assert.strictEqual(names.length, 52, "the gate travels on names, and the block's width never removes one");
  const block = fim.renderFimCandidates(members, "");
  const cut = names.filter((n) => !String(block).includes(n));
  assert.ok(cut.length > 0, "precondition: this set IS truncated");
  for (const n of cut) {
    assert.ok(names.includes(n), `${n} is cut from the block and still a legal completion`);
  }
});

// ---------------------------------------------------------------------------
// renderFieldSignature: one line or nothing.
// ---------------------------------------------------------------------------

for (const { name, detail, expected } of [
  { name: "a plain type", detail: "u64", expected: "f: u64" },
  { name: "a nested generic", detail: "HashMap<String, Vec<(u64, Duration)>>", expected: "f: HashMap<String, Vec<(u64, Duration)>>" },
  { name: "a function-pointer field stays data, never callable", detail: "fn(u64) -> bool", expected: "f: fn(u64) -> bool" },
  { name: "a wrapped detail collapses to one line", detail: "Vec<\n  LineItem\n>", expected: "f: Vec< LineItem >" },
  { name: "a two-line detail never becomes two candidates", detail: "line1\nline2", expected: "f: line1 line2" },
  { name: "trailing newline", detail: "u64\n", expected: "f: u64" },
  { name: "empty detail", detail: "", expected: undefined },
  { name: "whitespace-only detail", detail: "  \n  ", expected: undefined },
  { name: "absent detail", detail: undefined, expected: undefined },
  { name: "a runaway detail is dropped rather than half-rendered", detail: "A".repeat(300), expected: undefined },
]) {
  test(`renderFieldSignature: ${name}`, () => {
    const rendered = extraction.renderFieldSignature("f", detail);
    assert.strictEqual(rendered, expected);
    if (rendered !== undefined) {
      assert.ok(!rendered.includes("\n"), "a field signature is ONE line, always");
    }
  });
}

test("a field whose server detail wraps contributes exactly one candidate line to the block", () => {
  const member = extraction.toCompletionMember("payload", "Vec<\n  LineItem\n>", "field");
  const block = fim.renderFimCandidates([member], "");
  assert.strictEqual(lines(block).length, 2, `header plus one candidate:\n${block}`);
});
