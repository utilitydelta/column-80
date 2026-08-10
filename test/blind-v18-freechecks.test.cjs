// BLIND ORACLE - v18 phase 4, "two checks that need no server"
// [session-v18/phase4-surface.md, as amended 2026-07-21]. Written against the
// contract only. Never reads src/**: the entries re-export the modules and
// esbuild resolves them at bundle time only.
//
// PART 1 (the self-reference gate leg) WAS WITHDRAWN. It shipped on a claim of
// 0 false suppressions in 11,135 sites (96% TypeScript) and re-measured at 224
// false suppressions in 1,600,063 real member sites across four languages,
// every firing on correct compiling code, against no measured true positive.
// The gate is back to membership and arity. Section Z below is the regression
// net against anyone rebuilding it: the shape that fired 224 times must be
// SERVED. Its control proves the gate is still live while serving it.
//
// PART 2 (the construction-surface filter) survives, amended twice:
//   - it is LIVE IN RUST AND ONLY IN RUST. Python strips the leading self/cls
//     before the renderer sees a signature, and TS and C# render no receiver
//     parameter at all, so in three of four languages nothing is filtered.
//     The rows for those three therefore pin the UNFILTERED reality: a
//     production-shaped instance method SURVIVES into `to build a <Type>:`.
//     Asserting Python filtering would pin a shape production never emits.
//   - the RUST BUILDER CARVE-OUT: a receiver taken BY VALUE whose declared
//     return is the type being built or `Self` is KEPT (`build(self) -> Tile`
//     is how Rust constructs). BY REFERENCE is excluded whatever it returns.
//
// Run: SKIP_LIVE=1 node --test test/blind-v18-freechecks.test.cjs
// (Hermetic: pure functions plus a stubbed service. No model, no network.)

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore, sleep } = require("./.blind-util.cjs");

// `export *` for the pure module, never named re-exports: a named re-export of
// a function that does not exist is an esbuild BUILD error, which would
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

const core = build("blind-v18-freechecks", `export * from "../src/core/fimInject";\n`);
const svcMod = build(
  "blind-v18-freechecks-svc",
  `export * from "../src/core/completionService";\nexport * from "../src/core/config";\n`
);

test.after(() => {
  core.cleanup();
  svcMod.cleanup();
});

test("harness: src/core/fimInject bundles [harness guard - red here is a build problem, not a contract failure]", () => {
  if (core.error) assert.fail(`src/core/fimInject does not build: ${core.error.message}`);
});

test("harness: src/core/completionService bundles [harness guard]", () => {
  if (svcMod.error) assert.fail(`src/core/completionService does not build: ${svcMod.error.message}`);
});

const need = (name) => {
  if (core.error) assert.fail(`src/core/fimInject does not build: ${core.error.message}`);
  const f = core.mod[name];
  if (typeof f !== "function") assert.fail(`src/core/fimInject exports no ${name}() (got ${typeof f})`);
  return f;
};

// Table runner: one body, many cases, every failure reported together so a run
// shows the whole shape of the gap rather than only its first case.
const collect = () => {
  const bad = [];
  return {
    bad,
    check(name, fn) {
      try {
        fn();
      } catch (e) {
        bad.push(`${name}: ${e.message}`);
      }
    },
    done(total, why) {
      assert.deepStrictEqual(bad, [], `${bad.length}/${total} cases failed - ${why}`);
    },
  };
};

// ###########################################################################
// Z - THE WITHDRAWN LEG MUST STAY WITHDRAWN.
// [surface "Part 1: the self-reference check, WITHDRAWN 2026-07-21"]
// A ghost that reads the identifier its own line is binding is CORRECT,
// COMPILING code - shadowing is idiomatic in every language the tool serves,
// and `let tile = tile.rehome(&tile);` is two shared borrows, not an error.
// Suppressing it cost 224 false suppressions for no measured true positive.
// The gate is membership and arity; a self-reference is neither.
// ###########################################################################

const GATE_MEMBERS = ["rehome", "scale", "len"];

// A member-site request whose line shadows `tile` and whose ghost reads `tile`.
function selfRefRequest(text) {
  return {
    prefix: "let tile = grid.tile_at(idx);\nlet tile = tile.",
    suffix: "\n",
    uri: "file:///a.rs",
    memberSite: true,
    memberPartial: "",
    memberReceiver: "tile",
    resolveInjection: async () => ({ memberNames: GATE_MEMBERS }),
  };
}

function gateService() {
  if (svcMod.error) assert.fail(`src/core/completionService does not build: ${svcMod.error.message}`);
  const { CompletionService, DEFAULT_FIM_CONFIG } = svcMod.mod;
  if (typeof CompletionService !== "function") assert.fail("no CompletionService export");
  return (text) =>
    new CompletionService({ ...DEFAULT_FIM_CONFIG, debounceMs: 0 }, async () => {
      await sleep(1);
      return { text, ttftMs: 1, totalMs: 1 };
    });
}

test("Z. a ghost that READS THE IDENTIFIER ITS OWN LINE IS BINDING is served - the withdrawn leg suppressed exactly this, 224 times in 1.6M real member sites, always on compiling code and never on a measured true positive [surface Part 1 WITHDRAWN] (regression net against rebuilding it)", async () => {
  const svc = gateService()("rehome(&tile);");
  const out = await svc.complete(selfRefRequest());
  svc.dispose();
  assert.strictEqual(
    out?.text,
    "rehome(&tile);",
    "`let tile = tile.rehome(&tile);` compiles; `rehome` is a real member; the gate is membership and arity and has no business here"
  );
});

test("Z. CONTROL: the gate is still live while serving the self-reference - an invented member on that same self-referential line is still suppressed [surface Part 1 'the gate is back to membership and arity']", async () => {
  const svc = gateService()("vaporize(&tile);");
  const out = await svc.complete(selfRefRequest());
  svc.dispose();
  assert.strictEqual(
    out?.text,
    undefined,
    "without this the row above passes against a gate that was deleted wholesale rather than reverted to membership and arity"
  );
});

// ###########################################################################
// PART 2 - THE CONSTRUCTION-SURFACE FILTER. [surface Part 2]
// Pure: renderFimCandidates(members, partial, lineComment?, argTypes?).
// ###########################################################################

const render = (...args) => need("renderFimCandidates")(...args);
const mem = (name, signature, kind = "method") => ({ name, signature, kind });
const lines = (block) => String(block).split("\n");
const HEADER = "available here (use one of these exact names, do not invent):";
const PREFIX_FOR = { rust: "//", python: "#", typescript: "//", csharp: "//" };
const LANGS = ["rust", "python", "typescript", "csharp"];

// The receiver, per language. Its own member list is the half that must NOT
// change: instance methods are exactly what you want when completing `tile.`.
// Python/TS/C# are spelled as PRODUCTION renders them - no receiver parameter.
const RECEIVER_MEMBERS = {
  rust: [
    mem("rehome", "rehome(&self, other: &Tile) -> Tile"),
    mem("scale", "scale(&mut self, f: f32)"),
    mem("consume", "consume(self) -> u32"),
  ],
  python: [mem("rehome", "rehome(other: Tile) -> Tile"), mem("scale", "scale(f: float) -> None")],
  typescript: [mem("rehome", "rehome(other: Tile): Tile"), mem("scale", "scale(f: number): void")],
  csharp: [mem("Rehome", "Rehome(Tile) : Tile"), mem("Scale", "Scale(float) : void")],
};

// The `to build a Tile:` section of a rendered block: the lines after that
// header, up to the next header or the end.
function buildSection(block, typeName = "Tile") {
  const ls = lines(block);
  const i = ls.findIndex((l) => l.endsWith(`to build a ${typeName}:`));
  if (i < 0) return undefined;
  const out = [];
  for (let j = i + 1; j < ls.length; j++) {
    if (/ to build a .+:$/.test(ls[j])) break;
    out.push(ls[j]);
  }
  return out;
}

// ===========================================================================
// F. THE FILTER, IN RUST - the one language where it is live.
// [surface Part 2 "The rule", "this filter is live in Rust and only in Rust"]
// ===========================================================================

// KEEP: things that could actually produce a Tile.
const RUST_KEEP = [
  mem("new", "new(morton_code: u32, lod: u8) -> Tile", "constructor"),
  mem("from_morton", "from_morton(code: u32) -> Tile"), // associated fn, no receiver
  mem("build", "build(self) -> Tile"), // carve-out: by value, returns the type
  mem("with_lod", "with_lod(mut self, lod: u8) -> Self"), // carve-out: by value, returns Self
];

// DROP: things you can only call once you already HAVE a Tile.
const RUST_DROP = [
  mem("rehome", "rehome(&self, other: &Tile) -> Tile"), // by reference, returns the type
  mem("clone", "clone(&self) -> Tile"), // by reference, returns the type
  mem("scale", "scale(&mut self, f: f32)"), // by reference, returns nothing
  mem("consume", "consume(self) -> u32"), // by VALUE but returns neither the type nor Self
];

test("F. (rust) the 'to build a Tile:' section lists only what could produce one: associated functions, constructors and by-value builders survive; members that need a Tile to start from are excluded - they cannot build one and the model demonstrably reads these lines [surface Part 2 'The rule', 'The Rust builder carve-out']", () => {
  const block = render(RECEIVER_MEMBERS.rust, "", "//", [{ name: "Tile", members: [...RUST_KEEP, ...RUST_DROP] }]);
  assert.ok(block !== undefined, "the receiver carries signatures, so a block must render");
  const section = buildSection(block);
  assert.ok(section !== undefined, `the section must still be rendered:\n${block}`);
  const c = collect();
  for (const m of RUST_DROP) {
    c.check(`excludes ${m.signature}`, () =>
      assert.ok(
        !section.includes(`// ${m.signature}`),
        `a member that needs a Tile to start from must not appear under 'to build a Tile:':\n${section.join("\n")}`
      )
    );
  }
  for (const m of RUST_KEEP) {
    c.check(`keeps ${m.signature}`, () =>
      assert.ok(
        section.includes(`// ${m.signature}`),
        `a member that can produce a Tile must survive the filter:\n${section.join("\n")}`
      )
    );
  }
  c.done(RUST_KEEP.length + RUST_DROP.length, "the filter keeps construction and drops circularity");
});

// The carve-out in both directions, with the return type held constant so the
// RECEIVER FORM is the only variable. `build(self) -> Tile` is how Rust
// constructs; `clone(&self) -> Tile` is the circularity this filter exists to
// cut, and both spell the same return.
const CARVE_OUT = [
  { sig: "build(self) -> Tile", kept: true, why: "by value, returns the type being built - the builder terminal" },
  { sig: "finish(mut self) -> Self", kept: true, why: "by value with `mut`, returns Self" },
  { sig: "with_lod(mut self, lod: u8) -> Tile", kept: true, why: "by value, mid-chain, returns the type" },
  { sig: "build(&self) -> Tile", kept: false, why: "BY REFERENCE - needs a Tile already, whatever it returns" },
  { sig: "clone(&self) -> Tile", kept: false, why: "by reference returning the type is still circular" },
  { sig: "patch(&mut self) -> Self", kept: false, why: "by mutable reference, returns Self, still circular" },
  { sig: "consume(self) -> u32", kept: false, why: "by value but returns NEITHER the type nor Self" },
  { sig: "into_id(self) -> u32", kept: false, why: "by value, returns something else - a consumer, not a builder" },
];

test("F. (rust) the builder carve-out turns on the RECEIVER FORM, not the return type: by VALUE returning the type or `Self` is kept, by REFERENCE is excluded whatever it returns, and by value returning something else is a consumer [surface Part 2 'The Rust builder carve-out']", () => {
  const c = collect();
  const anchor = mem("new", "new(code: u32) -> Tile", "constructor");
  for (const cse of CARVE_OUT) {
    c.check(`${cse.sig} (${cse.why})`, () => {
      const block = render(RECEIVER_MEMBERS.rust, "", "//", [
        { name: "Tile", members: [anchor, mem(cse.sig.split("(")[0], cse.sig)] },
      ]);
      const section = buildSection(block);
      assert.ok(section !== undefined, `the anchor guarantees a section:\n${block}`);
      assert.strictEqual(
        section.includes(`// ${cse.sig}`),
        cse.kept,
        `expected ${cse.kept ? "KEPT" : "EXCLUDED"} - ${cse.why}:\n${section.join("\n")}`
      );
    });
  }
  c.done(CARVE_OUT.length, "the carve-out keys on how the receiver is taken");
});

// ===========================================================================
// F2. THE OTHER THREE LANGUAGES ARE UNFILTERED IN PRODUCTION, and that is the
// thing to pin. Python strips the leading self/cls before the renderer sees a
// signature; TS and C# render no receiver parameter at all. "The predicate
// never sees one to exclude" and "the section is unfiltered" are the same
// sentence. A row asserting Python filtering would pin a shape production
// never emits, so these rows assert the SURVIVAL of production-shaped
// instance methods instead.
// [surface Part 2 "AMENDED 2026-07-21: this filter is live in Rust and only in
// Rust", "Closing the gap in the other three languages ... is deferred"]
// ===========================================================================

// Spelled as the production renderer emits them: no leading receiver anywhere.
const UNFILTERED = {
  python: [
    mem("__init__", "__init__(morton_code: int, lod: int)", "constructor"),
    mem("from_morton", "from_morton(code: int) -> Tile"),
    mem("rehome", "rehome(other: Tile) -> Tile"), // instance method: survives, unfiltered
    mem("scale", "scale(f: float) -> None"), // instance method: survives, unfiltered
  ],
  typescript: [
    mem("Tile", "Tile(mortonCode: number, lod: number)", "constructor"),
    mem("fromMorton", "fromMorton(code: number): Tile"),
    mem("rehome", "rehome(other: Tile): Tile"),
    mem("scale", "scale(f: number): void"),
  ],
  csharp: [
    mem("Tile", "Tile(int mortonCode, int lod)", "constructor"),
    mem("FromMorton", "FromMorton(int) : Tile"),
    mem("Rehome", "Rehome(Tile) : Tile"),
    mem("Scale", "Scale(float) : void"),
  ],
};

for (const lang of ["python", "typescript", "csharp"]) {
  test(`F2. (${lang}) the construction section is UNFILTERED in production and every member survives, instance methods included - no production signature in this language begins with a receiver, so the predicate has nothing to see and closing the gap here is deferred, not built [surface Part 2 'this filter is live in Rust and only in Rust']`, () => {
    const p = PREFIX_FOR[lang];
    const block = render(RECEIVER_MEMBERS[lang], "", p, [{ name: "Tile", members: UNFILTERED[lang] }]);
    assert.ok(block !== undefined);
    const section = buildSection(block);
    assert.ok(section !== undefined, `the section must render:\n${block}`);
    const c = collect();
    for (const m of UNFILTERED[lang]) {
      c.check(`survives ${m.signature}`, () =>
        assert.ok(
          section.includes(`${p} ${m.signature}`),
          `nothing is filtered in ${lang}; a Rust-shaped predicate leaking here would drop this:\n${section.join("\n")}`
        )
      );
    }
    c.done(UNFILTERED[lang].length, "three of four languages render no receiver, so nothing is excluded");
  });
}

test("F. RULING: a constructor is kept even when its first parameter IS a receiver - `__init__(self, ...)` is the way to build a Python type, and the naive predicate would leave Python with no construction surface at all, the opposite of this part's purpose. Production strips the `self` so this shape should not reach the renderer; the row stands as the net against a receiver predicate applied indiscriminately under `#` [surface Part 2 'A constructor is kept even when its first parameter is a receiver']", () => {
  const block = render(RECEIVER_MEMBERS.python, "", "#", [
    {
      name: "Tile",
      members: [
        mem("__init__", "__init__(self, morton_code: int, lod: int)", "constructor"),
        mem("from_morton", "from_morton(code: int) -> Tile"),
      ],
    },
  ]);
  assert.ok(block !== undefined);
  const section = buildSection(block);
  assert.ok(section !== undefined, `Python must still get a construction section:\n${block}`);
  assert.ok(
    section.includes("# __init__(self, morton_code: int, lod: int)"),
    `the Python constructor carries the full arity and must not be filtered as a receiver method:\n${block}`
  );
});

// ===========================================================================
// G. THE RECEIVER'S OWN LIST IS UNTOUCHED. The discriminating shape: the SAME
// member in both places, filtered from the construction section and kept above
// it. Rust only - it is the only language where anything is filtered at all.
// [surface Part 2 "The receiver's OWN member list is untouched"]
// ===========================================================================

test("G. (rust) the SAME member appears in both places and is treated differently in each: kept in the receiver's own list, dropped from 'to build a Tile:' - instance methods are exactly what you want when completing `tile.` [surface Part 2 'The receiver's OWN member list is untouched']", () => {
  const shared = RECEIVER_MEMBERS.rust[0]; // rehome(&self, ..) -> Tile
  const block = render(RECEIVER_MEMBERS.rust, "", "//", [{ name: "Tile", members: [...RUST_KEEP, shared] }]);
  assert.ok(block !== undefined);
  const ls = lines(block);
  const line = `// ${shared.signature}`;
  assert.strictEqual(
    ls.filter((l) => l === line).length,
    1,
    `\`${shared.name}\` belongs to the receiver's list and NOT to the construction section, so it appears exactly once:\n${block}`
  );
  const iShared = ls.indexOf(line);
  const iBuild = ls.findIndex((l) => l.endsWith("to build a Tile:"));
  assert.ok(iBuild > 0, `the section must still render:\n${block}`);
  assert.ok(iShared > 0 && iShared < iBuild, `the surviving occurrence is the receiver's, above the section:\n${block}`);
});

test("G. (rust) the receiver's own member list is byte-identical with and without a filtered argTypes payload - the filter reaches only into the 'to build a' sections [surface Part 2 'the filter applies only to the to build a <Type>: sections'] (regression net)", () => {
  const plain = render(RECEIVER_MEMBERS.rust, "");
  const withArgs = render(RECEIVER_MEMBERS.rust, "", "//", [
    { name: "Tile", members: [...RUST_KEEP, ...RUST_DROP] },
  ]);
  assert.ok(plain !== undefined && withArgs !== undefined);
  const head = lines(withArgs).slice(0, lines(plain).length).join("\n");
  assert.strictEqual(head, String(plain), "the receiver half of the block is unchanged, including its `&self` methods");
});

// ===========================================================================
// H. NO EMPTY HEADING. A type with no constructible members contributes NO
// section at all: an empty `to build a Tile:` tells the model the type cannot
// be built, which is worse than silence.
// [surface Part 2 "contributes NO section at all"]
// ===========================================================================

test("H. (rust) a type whose members are ALL circular contributes no section at all - not a bare 'to build a Tile:' heading with nothing under it, which would tell the model the type cannot be built [surface Part 2 'rather than an empty heading']", () => {
  const block = render(RECEIVER_MEMBERS.rust, "", "//", [{ name: "Tile", members: RUST_DROP }]);
  assert.ok(block !== undefined, "the receiver still renders; only the argument-type section is skipped");
  assert.ok(!String(block).includes("to build a"), `no heading may be emitted at all:\n${block}`);
  assert.strictEqual(
    block,
    render(RECEIVER_MEMBERS.rust, "", "//"),
    "a fully-filtered argTypes list leaves the block identical to the render without it"
  );
});

test("H. an argument type carrying no members at all emits no heading either, in every language - the empty-heading rule is about the rendered result, not about why the list came out empty [surface Part 2 'contributes NO section at all']", () => {
  const c = collect();
  for (const lang of LANGS) {
    c.check(lang, () => {
      const p = PREFIX_FOR[lang];
      assert.strictEqual(
        render(RECEIVER_MEMBERS[lang], "", p, [{ name: "Tile", members: [] }]),
        render(RECEIVER_MEMBERS[lang], "", p),
        "an empty member list must not produce a bare heading"
      );
    });
  }
  c.done(LANGS.length, "no empty heading, whatever the language");
});

test("H. (rust) one type filtered to nothing does not suppress a sibling that still has a constructor [surface Part 2 'contributes NO section at all']", () => {
  const block = render(RECEIVER_MEMBERS.rust, "", "//", [
    { name: "Ghost", members: RUST_DROP },
    { name: "Tile", members: RUST_KEEP },
  ]);
  assert.ok(block !== undefined);
  assert.ok(!String(block).includes("to build a Ghost:"), `the fully-filtered type is skipped:\n${block}`);
  assert.match(String(block), /^\/\/ to build a Tile:$/m);
  assert.match(String(block), /^\/\/ new\(morton_code: u32, lod: u8\) -> Tile$/m);
});

// ===========================================================================
// I. THE BLOCK'S SHAPE IS UNCHANGED: header text, per-language comment prefix,
// and the MAX_CANDIDATES cap. [surface Part 2 "The block's overall shape, the
// header, the comment prefix per language, and the MAX_CANDIDATES cap are
// unchanged"] (regression net - expected GREEN today)
// ===========================================================================

test("I. the header text and the `// ` prefix are unchanged, and the legacy two-argument call is byte-identical to today [surface Part 2 'the header ... unchanged'] (regression net)", () => {
  const members = [
    mem("with_num_bits", "with_num_bits(usize) -> BuilderWithBits"),
    mem("from_vec", "from_vec(&[u64]) -> BloomFilter"),
  ];
  assert.strictEqual(
    render(members, ""),
    `// ${HEADER}\n// with_num_bits(usize) -> BuilderWithBits\n// from_vec(&[u64]) -> BloomFilter`
  );
});

for (const lang of LANGS) {
  test(`I. (${lang}) every emitted line still carries the language's comment prefix, header and construction section included [surface Part 2 'the comment prefix per language ... unchanged'] (regression net)`, () => {
    const p = PREFIX_FOR[lang];
    const argMembers = lang === "rust" ? RUST_KEEP : UNFILTERED[lang];
    const block = render(RECEIVER_MEMBERS[lang], "", p, [{ name: "Tile", members: argMembers }]);
    assert.ok(block !== undefined);
    assert.strictEqual(lines(block)[0], `${p} ${HEADER}`, "the header is the same text, only the prefix changes");
    for (const l of lines(block)) {
      assert.ok(l.startsWith(`${p} `), `offending line: ${JSON.stringify(l)}`);
      if (lang === "python") {
        assert.ok(!l.includes("//"), `no '//' token may reach a Python buffer: ${JSON.stringify(l)}`);
      }
    }
  });
}

const wideReceiver = Array.from({ length: 60 }, (_, i) => mem(`m${i}`, `m${i}() -> ()`));

test("I. the candidate cap is unchanged: a runaway receiver set still skips, and a filtered argTypes payload does not lift it [surface Part 2 'the MAX_CANDIDATES cap ... unchanged'] (regression net)", () => {
  assert.strictEqual(render(wideReceiver, ""), undefined, "legacy cap behaviour");
  assert.strictEqual(
    render(wideReceiver, "", "//", [{ name: "Tile", members: RUST_KEEP }]),
    undefined,
    "over the cap: skip, do not inject a wall"
  );
});

test("I. the cap still counts the RECEIVER's member lines only - a large argument type, before or after filtering, never trips it [surface Part 2 'the MAX_CANDIDATES cap ... unchanged'] (regression net)", () => {
  const fat = Array.from({ length: 60 }, (_, i) => mem(`make${i}`, `make${i}(a: u32) -> Tile`));
  const block = render(RECEIVER_MEMBERS.rust, "", "//", [{ name: "Tile", members: fat }]);
  assert.ok(block !== undefined, "a three-member receiver is under the cap whatever the argument type's size");
  assert.match(String(block), /^\/\/ to build a Tile:$/m);
});

test("I. the two trailing parameters are still OPTIONAL and their absence still changes nothing - every existing call site rides on this [surface Part 2 'The block's overall shape ... unchanged'] (regression net)", () => {
  const legacy = render(RECEIVER_MEMBERS.rust, "");
  assert.strictEqual(render(RECEIVER_MEMBERS.rust, "", undefined, []), legacy, "defaults are `//` and no argument types");
  assert.strictEqual(render(RECEIVER_MEMBERS.rust, "", "//"), legacy);
});

test("I. narrowing the receiver's list to the typed partial is unchanged [surface Part 2 'The block's overall shape ... unchanged'] (regression net)", () => {
  const legacy = render(RECEIVER_MEMBERS.rust, "re");
  assert.ok(legacy !== undefined);
  assert.match(String(legacy), /^\/\/ rehome\(&self, other: &Tile\) -> Tile$/m);
  assert.ok(!String(legacy).includes("consume("), `the partial narrows the receiver's list:\n${legacy}`);
  assert.strictEqual(render(RECEIVER_MEMBERS.rust, "re", "//", []), legacy, "an empty argTypes changes nothing");
});
