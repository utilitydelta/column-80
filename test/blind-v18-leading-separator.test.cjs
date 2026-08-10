// REGRESSION NET - v18 phase 2 "the leading-separator gate bypass"
// [session-v18/phase2-surface.md]. Written against the contract, not against
// the code. Never reads src/**: the entries re-export the modules and esbuild
// resolves them at bundle time only.
//
// NOTHING SHIPPED, AND THAT IS THE POINT. The phase was ordered to close a gate
// bypass. Measurement showed the bypass is not reachable - 0 leading-separator
// completions in 485, across two temperatures and a 4.7x parameter range, with
// controls firing at 26/150 and 90-98% - and two attempts to close it anyway
// each suppressed correct code. No well-formedness leg was ever built.
//
// The gate is MEMBERSHIP-ONLY. It once had two legs, membership and arity; the
// arity leg was removed in v19 because it parsed only TypeScript signatures,
// returned undefined for every C#/Python one, and its one TypeScript catch sat
// behind the compiler oracle that catches the same wrong call on accept
// [session-v19/gate-membership-only-surface.md]. So this file no longer pins
// arity at all - the two functions below are the whole surface it reads.
//
// So this file is a NET, not a spec. It pins that:
//
//   - the two pure functions read no name out of a leading separator, which is
//     a real property of them and NOT a product defect, because nothing
//     produces the input;
//   - a leading-separator ghost at a member site is SERVED, deliberately;
//   - the gate is one leg, membership, gated on resolved member names, with no
//     well-formedness leg.
//
// IF YOU ARE HERE BECAUSE THIS FILE WENT RED, you have probably rebuilt the
// withdrawn well-formedness leg. Read the surface document before going
// further. Three separate reviews found three distinct populations of correct
// code that leg suppressed, each after the previous declared the class
// understood, and the last one - C# `list[lo.` + `.hi];`, which has a named
// receiver and renders the legal `list[lo..hi]` - satisfies every precondition
// the design had accumulated.
//
// THE BAR FOR REVISITING IS A MEASUREMENT, NOT AN ARGUMENT: show a
// leading-separator completion at a gated member site with a named receiver and
// an empty partial, from a real model on real code, with a control proving the
// probe can detect one. This file is where that bar is enforced. Until it is
// met, every row below is the correct behaviour.
//
//   ghostMemberRefs(ghost, partial, receiver?)                -> string[]
//   ghostNamesMember(ghost, partial, memberNames, receiver?)  -> boolean
//
// Run: SKIP_LIVE=1 node --test test/blind-v18-leading-separator.test.cjs
// (Hermetic: pure functions plus a stubbed generate and a stubbed injection.
// No model, no network, no vscode.)

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// `export *` for the pure functions, never named re-exports: a named re-export
// of a function that does not exist is an esbuild BUILD error, which would
// collapse every test into one harness failure and hide the regression net.
// The service is bundled SEPARATELY so a break in one does not blind the other.
const build = (tag, source) => {
  try {
    const built = bundleCore(tag, source);
    return { mod: built.mod, cleanup: built.cleanup };
  } catch (e) {
    return { mod: {}, cleanup: () => {}, error: e };
  }
};

const core = build("blind-v18-leading-separator", `export * from "../src/core/fimInject";\n`);
const svc = build(
  "blind-v18-leading-separator-svc",
  `export { CompletionService } from "../src/core/completionService";\n`
);

test.after(() => {
  core.cleanup();
  svc.cleanup();
});

test("harness: src/core/fimInject and src/core/completionService both bundle [harness guard - red here is a build problem, not a contract failure]", () => {
  if (core.error) assert.fail(`src/core/fimInject does not build: ${core.error.message}`);
  if (svc.error) assert.fail(`src/core/completionService does not build: ${svc.error.message}`);
});

const need = (name) => {
  if (core.error) assert.fail(`src/core/fimInject does not build: ${core.error.message}`);
  const f = core.mod[name];
  if (typeof f !== "function") {
    assert.fail(`src/core/fimInject exports no ${name}() (got ${typeof f})`);
  }
  return f;
};

const needService = () => {
  if (svc.error) assert.fail(`src/core/completionService does not build: ${svc.error.message}`);
  const C = svc.mod.CompletionService;
  if (typeof C !== "function") assert.fail(`src/core/completionService exports no CompletionService`);
  return C;
};

// Table runner: one body, many cases, every failure reported together so a run
// shows the whole shape of the gap rather than the first case.
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
  assert.deepStrictEqual(got, row.expect, `expected ${JSON.stringify(row.expect)}, got ${JSON.stringify(got)}`);

// The surface's measured basis, verbatim: receiver `s`, real members push, len,
// iter, and one invented name spelled three ways.
const MEMBERS = ["push", "len", "iter"];
const RECEIVER = "s";
const INVENTED = "partition_by_lod";


// ===========================================================================
// A. THE PURE FUNCTIONS ARE UNTOUCHED, and must stay byte-identical to
// f617cfa. The surface's defect table is the record of what these functions
// DO, not of what they should stop doing: a leading-separator ghost has its
// member names read as `[]`. The reach that would have changed that was
// withdrawn, so a leading separator yields NO reference.
// [surface "The defect, and why it does not matter", "What must NOT change"]
// ===========================================================================

test("A. ghostMemberRefs reads NO name out of a leading separator - the surface's defect table is the record of today's behaviour, and it is a property of the function rather than a product defect because nothing produces the input [surface 'The defect, and why it does not matter']", () => {
  const ghostMemberRefs = need("ghostMemberRefs");
  table(
    [
      { name: "leading dot `.partition_by_lod(by_lod);` - surface table row 2, reads []", ghost: `.${INVENTED}(by_lod);` },
      { name: "leading `::partition_by_lod(x);` - surface table row 3, reads []", ghost: `::${INVENTED}(x);` },
      { name: "a leading separator naming a REAL member is read no differently", ghost: ".push(item);" },
      { name: "`::push(item);` likewise", ghost: "::push(item);" },
      { name: "unterminated `.pus`", ghost: ".pus" },
      { name: "a separator behind whitespace is still not read", ghost: `   .${INVENTED}(x);` },
      { name: "a separator behind a newline is still not read", ghost: `\n.${INVENTED}(x);` },
    ].map((r) => ({ ...r, expect: [] })),
    (r) => ghostMemberRefs(r.ghost, "", RECEIVER),
    eq
  );
});

test("A. the bare counterpart is still read exactly as before - the leading identifier of a bare ghost is a member reference, with `partial` prepended [surface 'What holds today, unchanged'] (regression net)", () => {
  const ghostMemberRefs = need("ghostMemberRefs");
  table(
    [
      { name: "bare `partition_by_lod(by_lod);` - surface table row 1", ghost: `${INVENTED}(by_lod);`, partial: "", expect: [INVENTED] },
      { name: "bare `push(x);`", ghost: "push(x);", partial: "", expect: ["push"] },
      { name: "`sh(x);` after partial `pu` reads `push`", ghost: "sh(x);", partial: "pu", expect: ["push"] },
      { name: "`n();` after partial `le` reads `len`", ghost: "n();", partial: "le", expect: ["len"] },
      { name: "an invented tail is still glued to the partial and REPORTED", ghost: "rge();", partial: "me", expect: ["merge"] },
    ],
    (r) => ghostMemberRefs(r.ghost, r.partial, RECEIVER),
    eq
  );
});

test("A. ghostNamesMember got NO stricter: with no reference read out of a leading separator there is nothing to judge, so it stays consistent and the ghost is served [surface defect table: 'names read []', 'passes']", () => {
  const ghostNamesMember = need("ghostNamesMember");
  table(
    [
      { name: "leading-dot invention is not judged here", ghost: `.${INVENTED}(by_lod);`, expect: true },
      { name: "leading-:: invention is not judged here", ghost: `::${INVENTED}(x);`, expect: true },
      { name: "leading-dot real member", ghost: ".push(item);", expect: true },
      { name: "unterminated `.zzz` is not judged here either", ghost: ".zzz", expect: true },
      { name: "bare invention IS judged, exactly as before - surface table row 1", ghost: `${INVENTED}(by_lod);`, expect: false },
      { name: "bare real member passes, exactly as before", ghost: "push(x);", expect: true },
    ],
    (r) => ghostNamesMember(r.ghost, "", MEMBERS, RECEIVER),
    eq
  );
});

// ===========================================================================
// B. WHAT MUST NOT CHANGE, inside the pure functions. [surface "What must NOT
// change": masking, float and range rules, source order, hostile input.]
// ===========================================================================

test("B. a ghost with NO leading separator behaves exactly as it does today - source order, string and comment masking, other receivers, empty ghosts, hallucinations reported not judged [surface 'A ghost with no leading separator behaves exactly as it does today'] (regression net)", () => {
  const ghostMemberRefs = need("ghostMemberRefs");
  table(
    [
      {
        name: "leading identifier plus later receiver accesses, in source order",
        ghost: "push(1);\ns.len();\ns.iter();",
        expect: ["push", "len", "iter"],
      },
      { name: "a name inside a STRING LITERAL is not a reference", ghost: 'push(1);\nlog("s.vaporize");', expect: ["push"] },
      { name: "a name inside a LINE COMMENT is not a reference", ghost: "push(1);\n// s.vaporize() next\n", expect: ["push"] },
      { name: "a name inside a BLOCK COMMENT is not a reference", ghost: "push(1);\n/* s.vaporize() */\n", expect: ["push"] },
      { name: "a member access on a DIFFERENT receiver is out of scope", ghost: "push(1);\nother.vaporize();", expect: ["push"] },
      { name: "hallucinated names are REPORTED, never judged here", ghost: "vaporize(1);\ns.melt(2);", expect: ["vaporize", "melt"] },
      { name: "an empty ghost yields nothing", ghost: "", expect: [] },
      { name: "punctuation-only ghost yields nothing", ghost: "(1, 0);", expect: [] },
    ],
    (r) => ghostMemberRefs(r.ghost, "", RECEIVER),
    eq
  );
});

test("B. the existing masking and float/range rules keep their current behaviour - a leading `.` that is not member access is not READ as one [surface 'The existing masking and float/range rules inside the pure functions keep their current behaviour regardless'] (regression net)", () => {
  const ghostMemberRefs = need("ghostMemberRefs");
  table(
    [
      { name: "float continuation `.5;`", ghost: ".5;", expect: [] },
      { name: "float continuation `.5 + x;`", ghost: ".5 + x;", expect: [] },
      { name: "float continuation `.0_f64`", ghost: ".0_f64", expect: [] },
      { name: "range `..10]`", ghost: "..10]", expect: [] },
      { name: "range `..len]`", ghost: "..len]", expect: [] },
      { name: "range `..=end`", ghost: "..=end", expect: [] },
      { name: "spread `...items`", ghost: "...items", expect: [] },
      { name: "a separator inside a STRING LITERAL", ghost: 'log(".vaporize");', expect: ["log"] },
      { name: "a whole-ghost LINE COMMENT holding a separator", ghost: "// .vaporize() goes here", expect: [] },
      { name: "a whole-ghost BLOCK COMMENT holding a separator", ghost: "/* .vaporize() */", expect: [] },
      { name: "a bare `.` names nothing", ghost: ".", expect: [] },
      { name: "a bare `::` names nothing", ghost: "::", expect: [] },
      { name: "a separator followed by punctuation names nothing", ghost: ".(1);", expect: [] },
    ],
    (r) => ghostMemberRefs(r.ghost, "", RECEIVER),
    eq
  );
});

test("B. an empty `memberNames` still rejects every identifier and that stays the CALLER's guard, and a ghost adding no identifier characters is still consistent [surface 'ghostNamesMember'] (regression net)", () => {
  const ghostNamesMember = need("ghostNamesMember");
  table(
    [
      { name: "bare identifier against an empty set is rejected", ghost: "push(x);", expect: false },
      { name: "no identifier at all is consistent even against an empty set", ghost: ");", expect: true },
      { name: "`.` alone adds no identifier characters", ghost: ".", expect: true },
      { name: "`::` alone adds no identifier characters", ghost: "::", expect: true },
    ],
    (r) => ghostNamesMember(r.ghost, "", [], RECEIVER),
    eq
  );
});

test("B. a non-string ghost yields [] and nothing throws, in every leading-separator-adjacent shape [surface 'It never throws, and a non-string ghost yields []'] (regression net)", () => {
  const ghostMemberRefs = need("ghostMemberRefs");
  const ghostNamesMember = need("ghostNamesMember");
  table(
    [
      { name: "undefined", ghost: undefined },
      { name: "null", ghost: null },
      { name: "a number", ghost: 42 },
      { name: "an object", ghost: { ghost: ".push(x);" } },
      { name: "an array", ghost: [".push(x);"] },
      { name: "a boolean", ghost: true },
      { name: "an object with a poisoned toString", ghost: { toString() { throw new Error("boom"); } } },
    ].map((r) => ({ ...r, expect: [] })),
    (r) => ghostMemberRefs(r.ghost, "", RECEIVER),
    eq
  );
  const hostile = [undefined, null, 42, {}, [], true, ".", "::", "...", ".".repeat(500), `.${"a".repeat(5000)}`, '."unterminated', ". ￿"];
  table(
    hostile.map((g) => ({ name: `ghost ${JSON.stringify(String(g).slice(0, 40))}`, ghost: g })),
    (r) => ghostNamesMember(r.ghost, "", MEMBERS, RECEIVER),
    (got) => {
      assert.strictEqual(typeof got, "boolean", `ghostNamesMember must return a boolean, got ${JSON.stringify(got)}`);
    }
  );
});

// ===========================================================================
// C. THE GATE SERVES A LEADING-SEPARATOR GHOST. There is no well-formedness
// leg: the gate is one leg, membership, gated on resolved member names. Driven
// through the service with a stubbed generate and a stubbed injection. [surface
// "What must NOT change"; harness idiom is test/impl-v15-gate.test.cjs, and it
// is the same gate.]
// ===========================================================================

const CFG = {
  apiBase: "http://x",
  model: "m",
  maxTokens: 64,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 3000,
  suffixChars: 1000,
  multiline: true,
  cacheCapacity: 100,
};

const generator = (texts) => {
  let i = 0;
  return async () => {
    const text = texts[Math.min(i, texts.length - 1)];
    i += 1;
    return { text, ttftMs: 1, totalMs: 2 };
  };
};

// The arity leg is gone, so the injection carries member names only: the
// `argSignatures` field that fed arity is off the payload [surface].
const FULL_INJECTION = { memberNames: MEMBERS };

// The reason string the WITHDRAWN well-formedness leg carried. Nothing may ever
// log it again. Its presence in a dogfood log means the leg was rebuilt.
const WITHDRAWN_REASON = "ghost re-opens a separator the prefix already closed";
// The one surviving leg, by its reason string.
const MEMBERSHIP_REASON = "ghost names no resolved member";

// One completion through the real service.
//
// `injection` and `receiver` are read with an `in` check, NEVER as default
// parameters: `injection: undefined` is the "resolver never answered" case and
// `receiver: undefined` is the "member site with no receiver NAME" case. A
// default parameter silently swaps a real value in for either, and that
// mistake greened a discriminating row twice during this phase.
async function serve(opts = {}) {
  const { ghost, ghosts, partial = "", memberSite = true, alternatives, prefix } = opts;
  const injection = "injection" in opts ? opts.injection : FULL_INJECTION;
  const receiver = "receiver" in opts ? opts.receiver : memberSite ? RECEIVER : undefined;
  const CompletionService = needService();
  const lines = [];
  const service = new CompletionService(CFG, generator(ghosts ?? [ghost]), (l) => lines.push(l));
  const out = await service.complete({
    prefix: prefix ?? `let s: Vec;\ns${memberSite ? `.${partial}` : " "}`,
    suffix: "",
    manual: true,
    alternatives,
    memberSite,
    memberPartial: memberSite ? partial : "",
    memberReceiver: receiver,
    resolveInjection: async () => injection,
  });
  service.dispose();
  return { out, lines, text: out && out.text };
}

// Asserts the ghost came through byte-for-byte AND that no withdrawn leg fired.
// Both halves matter: a rebuilt leg fails the first, and a leg rebuilt with a
// different reason string still fails it, so the second is belt and braces for
// the dogfood log rather than the only guard.
const servedBy = async (bad, name, opts) => {
  const { out, lines } = await serve(opts);
  if (!out || out.text !== opts.ghost) {
    bad.push(`${name}: expected the ghost SERVED untouched, got ${JSON.stringify(out && out.text)}`);
  } else if (lines.some((l) => l.includes(WITHDRAWN_REASON))) {
    bad.push(`${name}: the withdrawn well-formedness leg has been rebuilt`);
  }
};

test("C. a leading-separator ghost at a member site is SERVED, not dropped - deliberate, and the measured basis is 0 leading-separator completions in 485 across two temperatures and a 4.7x parameter range [surface 'What must NOT change': 'A leading-separator ghost at a member site is SERVED, not dropped']", async () => {
  const bad = [];
  const cases = [
    // The surface's own defect table. The names read are [], so the gate has
    // nothing to judge and passes the ghost. That is a real property of the
    // functions and NOT a product defect, because nothing produces the input.
    ["`.partition_by_lod(by_lod);` - surface defect table row 2", `.${INVENTED}(by_lod);`],
    ["`::partition_by_lod(x);` - surface defect table row 3", `::${INVENTED}(x);`],
    ["a real member behind a leading dot", ".push(item);"],
    ["a real member behind `::`", "::iter();"],
    ["an unterminated invention", ".zzz"],
    ["behind a space", " .push(item);"],
    ["behind several spaces", "    .push(item);"],
    ["behind a tab", "\t.push(item);"],
    // The shapes an earlier draft called malformed renders and dropped. They
    // are served now, and three of them are legal code at the right site.
    ["a float continuation", ".5;"],
    ["a range", "..10]"],
    ["a spread", "...items"],
  ];
  for (const [name, ghost] of cases) await servedBy(bad, name, { ghost });
  assert.deepStrictEqual(bad, [], `${bad.length}/${cases.length} leading-separator ghosts were suppressed; the gate chain has no well-formedness leg`);
});

// ---------------------------------------------------------------------------
// The three false-suppression populations three separate reviews found, each
// after the previous declared the class understood. They are pinned by name
// because they are the argument for why nothing was built: the enumeration was
// not converging, against a benefit measured at zero. [surface "Why nothing was
// built"]
// ---------------------------------------------------------------------------

test("C. legal spread and range syntax at RECEIVER-LESS dot sites is served - `(.`, `[.`, `{ .` and `, .` are member sites with an empty partial and no receiver, where a leading dot is the second dot of a spread the user is typing [surface 'Why nothing was built', population 1]", async () => {
  const bad = [];
  const cases = [
    ["`return [.` + `..entries.values()]` renders `return [...entries.values()]`", "return [.", "..entries.values()]"],
    ["`args.push(.` + `..filters)` renders `args.push(...filters)`", "args.push(.", "..filters)"],
    ["`Foo { .` + `..base }` renders `Foo { ..base }`", "Foo { .", "..base }"],
    ["`&v[lo.` + `.hi]` renders `&v[lo..hi]`", "&v[lo.", ".hi]"],
  ];
  // A FULL injection deliberately: resolution has landed and the gate is live,
  // so nothing but the absence of a well-formedness leg is serving these.
  for (const [name, prefix, ghost] of cases) await servedBy(bad, name, { prefix, ghost, receiver: undefined });
  assert.deepStrictEqual(bad, [], "every one of these renders legal code and a well-formedness leg dropped all of them");
});

test("C. the C# named-range site is served - `list[lo.` has receiver `lo` and satisfies EVERY precondition the withdrawn leg had, yet renders the perfectly legal `list[lo..hi]`; Rust has 6,587 such sites and its gate is the goal's next item [surface 'Why nothing was built', population 2 - the fifth case, which the named-receiver condition did not save]", async () => {
  const bad = [];
  // memberReceiverName returns a name for the FIRST dot of a range, so a
  // named-receiver condition does not exclude this. It is the case that ended
  // the design: adding preconditions was not converging on the class.
  await servedBy(bad, "C# `list[lo.` + `.hi];`", { prefix: "list[lo.", ghost: ".hi];", receiver: "lo" });
  await servedBy(bad, "Rust `&v[lo.` + `.hi]` with a named receiver", { prefix: "&v[lo.", ghost: ".hi]", receiver: "lo" });
  await servedBy(bad, "a range with a step, named receiver", { prefix: "arr[start.", ghost: ".end]", receiver: "start" });
  assert.deepStrictEqual(bad, [], "these satisfy member site, named receiver, empty partial and resolved members, and are still legal code");
});

test("C. no precondition the withdrawn leg used changes anything now - a partial typed, an unresolved site, and a non-member site all serve the same ghost, because there is no well-formedness leg left to condition [surface 'The gate is one leg, membership, gated on resolved member names']", async () => {
  const bad = [];
  await servedBy(bad, "with a partial typed", { ghost: ".len();", partial: "pu", prefix: "let s: Vec;\ns.pu" });
  await servedBy(bad, "with NO resolution at all", { ghost: `.${INVENTED}(x);`, injection: undefined });
  await servedBy(bad, "with member names resolved", { ghost: `.${INVENTED}(x);`, injection: { memberNames: MEMBERS } });
  await servedBy(bad, "at a non-member site, where a leading dot is correct text", { ghost: `.${INVENTED}(x);`, memberSite: false, receiver: RECEIVER });
  assert.deepStrictEqual(bad, [], "the leg was withdrawn entirely, not narrowed further");
});

// ---------------------------------------------------------------------------
// The gate that DOES exist, unchanged. Its measured basis is 0 false
// suppressions in 196 real sites and this change must not move it.
// ---------------------------------------------------------------------------

test("C. the membership gate still works: it drops an invented name and says so, and serves correct code [surface 'One leg: membership'] (regression net)", async () => {
  const invented = await serve({ ghost: `${INVENTED}(by_lod);` });
  assert.strictEqual(invented.out, undefined, "the membership leg still drops a bare invented name");
  assert.ok(
    invented.lines.some((l) => l.includes(MEMBERSHIP_REASON)),
    `and says so: expected ${JSON.stringify(MEMBERSHIP_REASON)}, got ${JSON.stringify(invented.lines)}`
  );

  const good = await serve({ ghost: "push(item);" });
  assert.ok(good.out && good.out.text === "push(item);", "and correct code is served, which is the whole point of the gate having a measured basis");
});

test("C. the membership gate is gated on RESOLVED MEMBER NAMES: with no resolution it does not fire and the invented name is served [surface 'With no resolution it is dark and suppresses nothing'] (regression net)", async () => {
  const noInjection = await serve({ ghost: `${INVENTED}(by_lod);`, injection: undefined });
  assert.ok(
    noInjection.out && noInjection.out.text === `${INVENTED}(by_lod);`,
    `a lost race knows nothing and suppresses nothing; got ${JSON.stringify(noInjection.out && noInjection.out.text)}`
  );
});

test("C. a ghost with NO leading separator behaves exactly as it does today - the whole population the gate's measured basis was taken on, 0 false suppressions in 196 real sites [surface 'What must NOT change'] (regression net)", async () => {
  const bad = [];
  const cases = [
    ["a real member called correctly", "push(item);"],
    ["a zero-argument real member", "len();"],
    ["a chain of real members on one line", "push(item).len();"],
    ["a real member reached through the explicit receiver", "push(item); s.len();"],
    ["a ghost adding no identifier characters", ");"],
  ];
  for (const [name, ghost] of cases) await servedBy(bad, name, { ghost });
  assert.deepStrictEqual(bad, [], "this change must not move that number, and the change is that nothing changed");
});
