// Implementer regression net: a leading-separator ghost is SERVED, not dropped,
// and the three pure functions read no member name out of one. This is the
// deliberate behaviour, not an oversight — two designs that changed it were
// built and withdrawn, each having suppressed correct code, against a benefit
// measured at 0 in 485 real generations. See session-v18/phase2-surface.md
// before making any of these red.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v18-leading-separator",
  `export { ghostMemberRefs, ghostNamesMember } from "../src/core/fimInject";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`
);
const { ghostMemberRefs, ghostNamesMember, CompletionService, DEFAULT_FIM_CONFIG } = mod;
test.after(cleanup);

const MEMBERS = ["push", "len", "iter"];

// Drives the real gate. `prefix` and `receiver` are explicit rather than
// defaulted: a receiver that is absent is a case these tests care about, and a
// default parameter would swap a real one back in and green the row by accident.
async function serve(opts) {
  const lines = [];
  const ghost = opts.ghost;
  const service = new CompletionService(
    { ...DEFAULT_FIM_CONFIG, debounceMs: 0 },
    async () => ({ text: ghost, ttftMs: 1, totalMs: 2 }),
    (l) => lines.push(l)
  );
  const out = await service.complete({
    prefix: opts.prefix,
    suffix: "",
    memberSite: true,
    memberPartial: opts.partial ?? "",
    memberReceiver: "receiver" in opts ? opts.receiver : "s",
    resolveInjection: async () => ({ memberNames: MEMBERS }),
  });
  service.dispose();
  return { text: out?.text, dropped: out === undefined, why: lines.filter((l) => l.includes("dropped:")).join(" | ") };
}

// ---- The pure functions read no name out of a leading separator.

for (const ghost of [".vaporize(x);", "::vaporize(x);", " .vaporize(x);", ".push(x);"]) {
  test(`ghostMemberRefs reads no member name out of a leading separator: ${JSON.stringify(ghost)}`, () => {
    assert.deepStrictEqual(ghostMemberRefs(ghost, "", MEMBERS, "s"), []);
    // No reference means nothing to judge, so the membership predicate is
    // vacuously satisfied. The gate does not drop these.
    assert.strictEqual(ghostNamesMember(ghost, "", MEMBERS, "s"), true);
  });
}

// ---- Through the real gate: served, including the shapes that made two
// withdrawn designs suppress correct code.

const SERVED = [
  {
    why: "the bare invention this gate exists for is still caught, proving the gate is live in these rows",
    prefix: "let s = v;\ns.",
    ghost: "vaporize(x);",
    dropped: true,
  },
  {
    why: "a leading separator at a named receiver: malformed if it happens, and it does not",
    prefix: "let s = v;\ns.",
    ghost: ".vaporize(x);",
    dropped: false,
  },
  {
    why: "a spread the user is midway through typing, at a receiver-less dot site",
    prefix: "return [.",
    receiver: undefined,
    ghost: "..entries.values()]",
    dropped: false,
  },
  {
    why: "and the same inside a call argument list",
    prefix: "args.push(.",
    receiver: undefined,
    ghost: "..filters)",
    dropped: false,
  },
  {
    why: "a Rust struct-update, also receiver-less",
    prefix: "let x = Foo { .",
    receiver: undefined,
    ghost: "..base }",
    dropped: false,
  },
  {
    why: "a range whose FIRST dot yields a real receiver name, so a receiver check does not save it",
    prefix: "var slice = list[lo.",
    receiver: "lo",
    ghost: ".hi];",
    dropped: false,
  },
  {
    why: "the same range shape in Rust, which is where the gate switch is headed next",
    prefix: "let s = &v[first.",
    receiver: "first",
    ghost: ".last];",
    dropped: false,
  },
];

for (const c of SERVED) {
  test(`gate: ${c.why}`, async () => {
    const r = await serve(c);
    if (c.dropped) {
      assert.strictEqual(r.dropped, true, "this one must still be caught, or the rows below prove nothing");
    } else {
      assert.strictEqual(r.text, c.ghost, `must be served untouched: ${c.prefix}${c.ghost}`);
      assert.strictEqual(r.why, "", "and no gate leg may claim it");
    }
  });
}

test("a typed partial is untouched too, at every separator spelling", async () => {
  for (const ghost of [".push(x);", ".vaporize(x);", "::push(x);", " .len();"]) {
    const r = await serve({ prefix: "let s = v;\ns.pu", partial: "pu", ghost });
    assert.strictEqual(r.text, ghost, `${ghost} chains off what the partial returns`);
  }
});
