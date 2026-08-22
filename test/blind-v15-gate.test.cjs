// BLIND ORACLE - the member-site output gate, membership-only
// [the v19 membership-only gate surface]. Black-box over two pure
// functions in src/core/fimInject.ts. Never reads src/**: the entry re-exports
// the module and esbuild resolves it at bundle time only. Written against the
// CONTRACT, not against the code.
//
// The two:
//   ghostMemberRefs(ghost, partial, receiver?) -> string[]
//   ghostNamesMember(ghost, partial, memberNames, receiver?) -> boolean
//
// The gate had two legs. The arity leg is gone: it parsed only TypeScript's
// signature render, returned undefined for every C#/Python signature, and on
// TypeScript caught one wrong call the compiler oracle already catches on
// accept while wrongly suppressing three correct ones. `callArity` and
// `arityConsistent` are deleted from src/core/fimInject.ts. One leg remains.
//
// The one leg is MEMBERSHIP. With the receiver's resolved member NAMES in hand,
// a ghost that names a member the receiver does not have is suppressed; the
// resolved set is the only thing that tells a real member from a hallucinated
// one. ghostNamesMember carries it. ghostMemberRefs is the reader it is built
// on: every member the ghost accesses on the receiver, in source order.
//
// ghostNamesMember exists in a 3-argument form (leading identifier only) and a
// 4-argument form (every reference the ghost makes on the receiver). Section A
// is the backward-compatibility net for the 3-arg form. C1/C2 pin the reach
// difference: the 4-arg form rejects a multi-line hallucination the 3-arg form
// waves through, which is exactly the reported bad experience.
//
// WHERE THE POSITIVE-EVIDENCE RULE LIVES. An empty memberNames REJECTS every
// identifier - the pure function treats an empty set as "every identifier is an
// invention". It is enforced at the CALL SITE too: completionProvider.ts only
// sets memberNames when the resolved set is non-empty, so the gate is never
// invoked with an empty set in production. An empty LEAD (empty ghost, no
// leading identifier) is judged before the set is consulted and stays
// consistent, because there is nothing to judge.
//
// Run: SKIP_LIVE=1 node --test test/blind-v15-gate.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// `export *`, never named re-exports: a named re-export of a function that does
// not exist yet is an esbuild BUILD error, which would collapse every test into
// one harness failure and hide the regression net. With `export *` an absent
// function is simply undefined and each test reports its own honest red.
let mod = {};
let cleanup = () => {};
let bundleError;
try {
  const built = bundleCore("blind-v15-gate", `export * from "../src/core/fimInject";\n`);
  mod = built.mod;
  cleanup = built.cleanup;
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

test("harness: src/core/fimInject bundles [harness guard - any red here is a build problem, not a contract failure]", () => {
  if (bundleError) assert.fail(`the module does not build: ${bundleError.message}`);
});

// Resolve a function at call time so an absent one is a per-test red naming the
// missing surface, never a module-load crash.
const need = (name) => {
  if (bundleError) assert.fail(`the module does not build: ${bundleError.message}`);
  const f = mod[name];
  if (typeof f !== "function") {
    assert.fail(`src/core/fimInject exports no ${name}() - the P3 surface is absent (got ${typeof f})`);
  }
  return f;
};

// Table runner: one test body, many cases, every failure reported together so a
// single run shows the whole shape of the gap rather than the first case.
const table = (rows, run, compare) => {
  const bad = [];
  for (const row of rows) {
    let got;
    try {
      got = run(row);
    } catch (e) {
      bad.push(`${row.name}: THREW ${e && e.message}`);
      continue;
    }
    try {
      compare(got, row);
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
  }
  if (bad.length) {
    assert.fail(`${bad.length}/${rows.length} cases failed:\n  - ${bad.join("\n  - ")}`);
  }
};

const eq = (got, row) =>
  assert.deepStrictEqual(
    got,
    row.expect,
    `expected ${JSON.stringify(row.expect)}, got ${JSON.stringify(got)}`
  );

// The receiver's real members throughout: EnrollTile is real, Enroll is not.
const MEMBERS = ["EnrollTile", "AggregateFanout"];

// ===========================================================================
// A. BACKWARD COMPATIBILITY - ghostNamesMember with the 4th argument OMITTED.
// Byte-identical to today (surface #2): leading identifier only, `partial`
// prepended to it, TERMINATED must match exactly, UNTERMINATED may prefix-
// match, empty lead and empty memberNames are both consistent.
// Expected GREEN today. This is the regression net.
// ===========================================================================

const compat = [
  // --- terminated: exact match required ---
  {
    name: "terminated exact member -> consistent",
    ghost: "EnrollTile(new Tile(1, 0));",
    partial: "",
    members: MEMBERS,
    expect: true,
  },
  {
    name: "terminated PROPER PREFIX of a member (Enroll of EnrollTile) -> rejected, a hallucinated call is not a name still being typed",
    ghost: "Enroll(new Tile(1, 0));",
    partial: "",
    members: MEMBERS,
    expect: false,
  },
  {
    name: "terminated name matching no member at all -> rejected",
    ghost: "Vaporize(1);",
    partial: "",
    members: MEMBERS,
    expect: false,
  },
  {
    name: "terminated exact match on the SECOND member -> consistent (the whole set is searched)",
    ghost: "AggregateFanout();",
    partial: "",
    members: MEMBERS,
    expect: true,
  },
  {
    name: "terminated name that STRICTLY EXTENDS a member (EnrollTileNow) -> rejected",
    ghost: "EnrollTileNow(1);",
    partial: "",
    members: MEMBERS,
    expect: false,
  },
  // --- partial is prepended to the leading identifier ---
  {
    name: "partial + ghost head forms the member exactly, terminated -> consistent",
    ghost: "Tile(new Tile(1, 0));",
    partial: "Enroll",
    members: MEMBERS,
    expect: true,
  },
  {
    name: "partial + ghost head forms a NON-member, terminated -> rejected (partial is part of the name, not ignored)",
    ghost: "ment(1);",
    partial: "Enroll",
    members: MEMBERS,
    expect: false,
  },
  {
    name: "partial alone would be a prefix but the joined terminated name is not a member -> rejected",
    ghost: "Fanout2();",
    partial: "Aggregate",
    members: MEMBERS,
    expect: false,
  },
  // --- unterminated: prefix-match allowed, the model may still be growing it ---
  {
    name: "unterminated proper prefix running to the end of the ghost -> consistent, still being typed",
    ghost: "Enroll",
    partial: "",
    members: MEMBERS,
    expect: true,
  },
  {
    name: "unterminated prefix split across partial and ghost -> consistent",
    ghost: "oll",
    partial: "Enr",
    members: MEMBERS,
    expect: true,
  },
  {
    name: "unterminated whole member name -> consistent",
    ghost: "EnrollTile",
    partial: "",
    members: MEMBERS,
    expect: true,
  },
  {
    name: "unterminated name that prefixes NOTHING -> rejected",
    ghost: "Zzz",
    partial: "",
    members: MEMBERS,
    expect: false,
  },
  // --- empty lead is consistent ---
  {
    name: "empty ghost -> consistent (nothing to judge)",
    ghost: "",
    partial: "",
    members: MEMBERS,
    expect: true,
  },
  {
    name: "ghost opening with punctuation, no leading identifier -> consistent",
    ghost: "(1, 0);",
    partial: "",
    members: MEMBERS,
    expect: true,
  },
  {
    name: "ghost opening with an operator -> consistent",
    ghost: " = 5;",
    partial: "",
    members: MEMBERS,
    expect: true,
  },
  // --- empty member set: every identifier is an invention (the call site,
  // not this function, enforces positive evidence) ---
  {
    name: "empty memberNames with a terminated identifier -> rejected, every identifier is an invention against an empty set",
    ghost: "Vaporize(1);",
    partial: "",
    members: [],
    expect: false,
  },
  {
    name: "empty memberNames with an unterminated identifier -> rejected, nothing to prefix-match against",
    ghost: "Vapor",
    partial: "",
    members: [],
    expect: false,
  },
  {
    name: "empty memberNames with an empty ghost -> consistent, an empty LEAD is judged before the member set is consulted",
    ghost: "",
    partial: "",
    members: [],
    expect: true,
  },
  {
    name: "empty memberNames with no leading identifier -> consistent, still nothing to judge",
    ghost: "(1, 0);",
    partial: "",
    members: [],
    expect: true,
  },
];

test("A. ghostNamesMember/3 (receiver omitted) behaves byte-identically to today: leading identifier only, partial prepended, terminated matches exactly, unterminated may prefix-match, empty is consistent [REGRESSION NET]", () => {
  const ghostNamesMember = need("ghostNamesMember");
  table(compat, (r) => ghostNamesMember(r.ghost, r.partial, r.members), eq);
});

test("A. ghostNamesMember/3 gives the SAME verdict when an explicitly undefined 4th argument is passed - an optional parameter left unfilled is not a behaviour change", () => {
  const ghostNamesMember = need("ghostNamesMember");
  table(
    compat,
    (r) => ghostNamesMember(r.ghost, r.partial, r.members, undefined),
    eq
  );
});

// ===========================================================================
// B. ghostMemberRefs (surface #1). Every member name the ghost accesses on the
// receiver, IN SOURCE ORDER. `partial` prepends to the leading identifier only.
// String-literal and comment occurrences are not references. [] when the ghost
// opens with no identifier. Never throws.
// ===========================================================================

const refs = [
  {
    name: "leading identifier is a member reference; later receiver.NAME occurrences join it, in source order",
    ghost: "EnrollTile(new Tile(1, 0));\nstripe.AggregateFanout();\nstripe.EnrollTile(new Tile(2, 0));",
    partial: "",
    receiver: "stripe",
    expect: ["EnrollTile", "AggregateFanout", "EnrollTile"],
  },
  {
    name: "partial prepends to the LEADING reference only, never to a later receiver.NAME",
    ghost: "gateFanout();\nstripe.EnrollTile(new Tile(1, 0));",
    partial: "Aggre",
    receiver: "stripe",
    expect: ["AggregateFanout", "EnrollTile"],
  },
  {
    name: "receiver omitted -> leading identifier only (today's scope), later references not reported",
    ghost: "EnrollTile(new Tile(1, 0));\nstripe.AggregateFanout();",
    partial: "",
    receiver: undefined,
    expect: ["EnrollTile"],
  },
  {
    name: "a name inside a STRING LITERAL is not a reference",
    ghost: 'EnrollTile(new Tile(1, 0));\nLog("stripe.Vaporize");',
    partial: "",
    receiver: "stripe",
    expect: ["EnrollTile"],
  },
  {
    name: "a name inside a LINE COMMENT is not a reference",
    ghost: "EnrollTile(new Tile(1, 0));\n// stripe.Vaporize() next\n",
    partial: "",
    receiver: "stripe",
    expect: ["EnrollTile"],
  },
  {
    name: "a name inside a BLOCK COMMENT is not a reference",
    ghost: "EnrollTile(new Tile(1, 0));\n/* stripe.Vaporize() */\n",
    partial: "",
    receiver: "stripe",
    expect: ["EnrollTile"],
  },
  {
    name: "a member access on a DIFFERENT receiver is not a reference to this one [out of scope by contract]",
    ghost: "EnrollTile(new Tile(1, 0));\nother.Vaporize();",
    partial: "",
    receiver: "stripe",
    expect: ["EnrollTile"],
  },
  {
    name: "the receiver name as a bare word (not a member access) contributes nothing",
    ghost: "EnrollTile(stripe);",
    partial: "",
    receiver: "stripe",
    expect: ["EnrollTile"],
  },
  {
    name: "no leading identifier -> [] even when later receiver.NAME occurrences exist",
    ghost: "(1, 0);\nstripe.EnrollTile();",
    partial: "",
    receiver: "stripe",
    expect: ["EnrollTile"],
  },
  {
    name: "empty ghost -> []",
    ghost: "",
    partial: "",
    receiver: "stripe",
    expect: [],
  },
  {
    name: "ghost opening with punctuation and holding nothing else -> []",
    ghost: "(1, 0);",
    partial: "",
    receiver: "stripe",
    expect: [],
  },
  {
    name: "hallucinated names are REPORTED, not filtered - judging is ghostNamesMember's job, not this one's",
    ghost: "Vaporize(1);\nstripe.Enroll(2);",
    partial: "",
    receiver: "stripe",
    expect: ["Vaporize", "Enroll"],
  },
];

test("B. ghostMemberRefs returns every receiver member the ghost accesses, in source order, with partial on the leading one only and string/comment occurrences excluded", () => {
  const ghostMemberRefs = need("ghostMemberRefs");
  table(refs, (r) => ghostMemberRefs(r.ghost, r.partial, r.receiver), eq);
});

const hostileGhosts = [
  "",
  "   ",
  "\n\n",
  "((((",
  '"unterminated string',
  "/* unterminated block",
  "stripe.",
  ".",
  "\u0000\uFFFF ghost",
  "\t\r\n",
  "\u00dcnic\u00f6de(1);",
  "a".repeat(5000),
];

test("B. ghostMemberRefs never throws, and always returns an array of strings, on malformed and unterminated ghosts", () => {
  const ghostMemberRefs = need("ghostMemberRefs");
  table(
    hostileGhosts.map((g) => ({ name: `ghost ${JSON.stringify(g.slice(0, 40))}`, ghost: g })),
    (r) => ghostMemberRefs(r.ghost, "", "stripe"),
    (got, row) => {
      assert.ok(Array.isArray(got), `expected an array, got ${JSON.stringify(got)}`);
      assert.ok(
        got.every((x) => typeof x === "string"),
        `every element must be a string, got ${JSON.stringify(got)}`
      );
      void row;
    }
  );
});

// ===========================================================================
// C. THE MULTI-LINE GATE - the reason this phase exists. `multiline` defaults
// true, so a ghost whose FIRST member is real and whose THIRD line invents one
// is today waved through whole. The 4-arg form must reject it; the 3-arg form
// must still accept it (that acceptance IS the reported bug, and pinning it
// proves the 4-arg form is doing new work).
// ===========================================================================

const CANONICAL_BAD =
  "EnrollTile(new Tile(1, 0));\n" +
  "stripe.EnrollTile(new Tile(2, 0));\n" +
  "stripe.Enroll(new Tile(3, 0));";

const CANONICAL_GOOD =
  "EnrollTile(new Tile(1, 0));\n" +
  "stripe.EnrollTile(new Tile(2, 0));\n" +
  "stripe.AggregateFanout();";

test("C1. ghostNamesMember/4: a ghost whose first member is real but whose third line invents one is REJECTED WHOLE - the gate reaches past the leading identifier", () => {
  const ghostNamesMember = need("ghostNamesMember");
  assert.strictEqual(
    ghostNamesMember(CANONICAL_BAD, "", MEMBERS, "stripe"),
    false,
    `line 3 calls stripe.Enroll, which is a proper prefix of EnrollTile and not a member; the whole ghost must be rejected.\nGHOST:\n${CANONICAL_BAD}\nMEMBERS: ${JSON.stringify(MEMBERS)}`
  );
});

test("C2. ghostNamesMember/3 ACCEPTS that same ghost - today's leading-identifier-only behaviour, pinned so the 4-arg form is provably new work [BUG PIN, stays green]", () => {
  const ghostNamesMember = need("ghostNamesMember");
  assert.strictEqual(
    ghostNamesMember(CANONICAL_BAD, "", MEMBERS),
    true,
    "without a receiver the gate reads the leading identifier only, so this hallucinating ghost passes; that is today's documented scope"
  );
});

const multiline = [
  {
    name: "every reference real -> consistent",
    ghost: CANONICAL_GOOD,
    partial: "",
    members: MEMBERS,
    receiver: "stripe",
    expect: true,
  },
  {
    name: "the LEADING reference is the invented one -> rejected",
    ghost: "Enroll(new Tile(1, 0));\nstripe.EnrollTile(new Tile(2, 0));",
    partial: "",
    members: MEMBERS,
    receiver: "stripe",
    expect: false,
  },
  {
    name: "a MIDDLE reference is invented -> rejected",
    ghost: "EnrollTile(new Tile(1, 0));\nstripe.Vaporize();\nstripe.AggregateFanout();",
    partial: "",
    members: MEMBERS,
    receiver: "stripe",
    expect: false,
  },
  {
    name: "the LAST reference runs to the very end of the ghost as a proper prefix -> consistent, the model is still typing it",
    ghost: "EnrollTile(new Tile(1, 0));\nstripe.Enroll",
    partial: "",
    members: MEMBERS,
    receiver: "stripe",
    expect: true,
  },
  {
    name: "a trailing prefix followed by MORE TEXT is complete, not still being typed -> rejected",
    ghost: "EnrollTile(new Tile(1, 0));\nstripe.Enroll(",
    partial: "",
    members: MEMBERS,
    receiver: "stripe",
    expect: false,
  },
  {
    name: "the invented name sits inside a STRING LITERAL -> consistent, not a reference",
    ghost: 'EnrollTile(new Tile(1, 0));\nLog("stripe.Vaporize");',
    partial: "",
    members: MEMBERS,
    receiver: "stripe",
    expect: true,
  },
  {
    name: "the invented name sits inside a COMMENT -> consistent, not a reference",
    ghost: "EnrollTile(new Tile(1, 0));\n// stripe.Vaporize()",
    partial: "",
    members: MEMBERS,
    receiver: "stripe",
    expect: true,
  },
  {
    name: "the invented name is on ANOTHER receiver -> consistent, gating a second receiver is explicitly out of scope",
    ghost: "EnrollTile(new Tile(1, 0));\nother.Vaporize();",
    partial: "",
    members: MEMBERS,
    receiver: "stripe",
    expect: true,
  },
  {
    name: "partial still joins the leading reference under the 4-arg form",
    ghost: "Tile(new Tile(1, 0));\nstripe.AggregateFanout();",
    partial: "Enroll",
    members: MEMBERS,
    receiver: "stripe",
    expect: true,
  },
  {
    name: "EMPTY memberNames with a receiver -> rejected, the empty-set answer is unchanged by the new parameter",
    ghost: CANONICAL_BAD,
    partial: "",
    members: [],
    receiver: "stripe",
    expect: false,
  },
  {
    name: "EMPTY memberNames with a receiver and a ghost holding no identifier at all -> consistent",
    ghost: "(1, 0);",
    partial: "",
    members: [],
    receiver: "stripe",
    expect: true,
  },
  {
    name: "empty ghost with a receiver -> consistent",
    ghost: "",
    partial: "",
    members: MEMBERS,
    receiver: "stripe",
    expect: true,
  },
];

test("C3. ghostNamesMember/4 judges EVERY reference under the per-reference termination rule, and only real references", () => {
  const ghostNamesMember = need("ghostNamesMember");
  table(
    multiline,
    (r) => ghostNamesMember(r.ghost, r.partial, r.members, r.receiver),
    eq
  );
});

test("C4. every backward-compatibility case keeps its verdict when a receiver the ghost never mentions is supplied - adding the receiver never changes a single-reference verdict", () => {
  const ghostNamesMember = need("ghostNamesMember");
  table(
    compat,
    (r) => ghostNamesMember(r.ghost, r.partial, r.members, "unrelatedReceiver"),
    eq
  );
});

// ===========================================================================
// F. THE EMPTY-SET AND EMPTY-GHOST GUARDS. An empty member set rejects (every
// identifier is an invention against nothing to match); an empty ghost stays
// consistent (nothing to judge); neither entry point throws on malformed input.
// Over-refusal costs a real accept, which is the expensive direction, so the
// gate errs quiet everywhere except the empty set, whose rejection is the
// CALL SITE's guard and pinned in sections A and C3 too.
// ===========================================================================

const emptyish = ["", "   ", "\n", "EnrollTile(new Tile(1));", CANONICAL_BAD];

test("F. an EMPTY member set gives the SAME answer in the 3-arg and the 4-arg form - the new parameter never moves the empty-set verdict [call-site guard, not a gate guard]", () => {
  const ghostNamesMember = need("ghostNamesMember");
  table(
    emptyish.map((g) => ({ name: `ghost ${JSON.stringify(g.slice(0, 30))}`, ghost: g })),
    (r) => ({ three: ghostNamesMember(r.ghost, "", []), four: ghostNamesMember(r.ghost, "", [], "stripe") }),
    (got) =>
      assert.strictEqual(
        got.four,
        got.three,
        `the receiver argument must not change the empty-set answer: 3-arg gave ${got.three}, 4-arg gave ${got.four}`
      )
  );
});

test("F. positive evidence: an EMPTY ghost never rejects at either entry point, and yields no references", () => {
  const ghostNamesMember = need("ghostNamesMember");
  const ghostMemberRefs = need("ghostMemberRefs");
  for (const ghost of ["", "   ", "\n"]) {
    const where = JSON.stringify(ghost);
    assert.strictEqual(ghostNamesMember(ghost, "", MEMBERS), true, `ghostNamesMember/3 on ${where}`);
    assert.strictEqual(ghostNamesMember(ghost, "", MEMBERS, "stripe"), true, `ghostNamesMember/4 on ${where}`);
    assert.deepStrictEqual(ghostMemberRefs(ghost, "", "stripe"), [], `ghostMemberRefs on ${where}`);
  }
});

test("F. positive evidence: the gate never throws on malformed input - a parse failure degrades to a boolean verdict, never to a crash", () => {
  const ghostNamesMember = need("ghostNamesMember");
  table(
    hostileGhosts.map((g) => ({ name: `ghost ${JSON.stringify(g.slice(0, 40))}`, ghost: g })),
    (r) => ghostNamesMember(r.ghost, "", MEMBERS, "stripe"),
    (got, row) => {
      assert.strictEqual(typeof got, "boolean", `${row.name}: ghostNamesMember must return a boolean, got ${JSON.stringify(got)}`);
    }
  );
});
