// Blind oracle: digestFailures + renderFailureEvidence, written from
// session-v60/contracts/phaseB2-failure-evidence.md ONLY. Never read
// src/core/failureDigest.ts or any per-framework extractor.
//
// Real captures bound here:
//   test/fixtures/rustc/assertion-panic.txt  - a real `cargo test` run, 7 failures
//   test/fixtures/csharp-trx/fail.trx        - a real `dotnet test` trx report
// parseLibtestOutput is imported as a PARSER (it produces the {name,message}
// input), not as the thing under test.
//
// Expected red until phase B2 lands.
//
// Run: SKIP_LIVE=1 node --test test/blind-v60-failuredigest.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

// The module may not exist yet. Bundle failure must surface as a per-test
// failure, not as a load-time crash that hides the rest of the file.
let mod = {};
let cleanup = () => {};
let bundleError = null;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v60-failuredigest",
    `export { digestFailures, renderFailureEvidence } from "../src/core/failureDigest";
export { parseLibtestOutput } from "../src/core/compilerOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const need = (name) => {
  if (bundleError) throw new Error(`module not built: ${String(bundleError.message).split("\n")[0]}`);
  const fn = mod[name];
  if (typeof fn !== "function") throw new Error(`module not built: ${name} is not exported`);
  return fn;
};
// CONTRACT GAP: the contract declares both functions synchronous
// (`: FailureShape[]`, `: FailureEvidence`), but the brief asks that a throwing
// hook still "resolves". Reading chosen: await every call, which is correct for
// a sync return and also correct if the build makes it a promise.
const digest = async (failures, opts) => await need("digestFailures")(failures, opts);
const render = async (input) => await need("renderFailureEvidence")(input);

// ---------------------------------------------------------------- fixtures

const FIX = path.join(__dirname, "fixtures");
const CAPTURE = fs.readFileSync(path.join(FIX, "rustc", "assertion-panic.txt"), "utf8");
const TRX = fs.readFileSync(path.join(FIX, "csharp-trx", "fail.trx"), "utf8");

// The libtest hooks, derived from the contract's per-framework table:
//   location: `panicked at <path>:<line>:<col>:` in the header line
//   noise:    the `thread '...' (...) ` identity, and the RUST_BACKTRACE note
//
// CONTRACT GAP: rule 1 orders strip THEN locate ("the extractor runs on the
// STRIPPED message"), while the per-framework table says the libtest stripper
// removes "the whole `thread '...' (...) panicked at ...:` header" - which
// would delete the only thing the libtest extractor can read, making the
// location unreachable for the contract's own headline runner. Rule 1 also
// says the key is "the stripped message with its location header removed",
// while rule 2 says the key is the stripped message with digits/hex/whitespace
// normalised and "Nothing else". Reading chosen: rule 2 is the operative,
// mechanical spec of the key; the stripper removes the thread identity (real
// noise) and keeps the `panicked at ...` line so the extractor can still work.
// Under either reading the assertions below hold, because digit normalisation
// maps every `src/taskNN.rs:L:C` to the same `src/task#.rs:#:#`.
const stripLibtest = (m) =>
  String(m)
    .split("\n")
    .filter((l) => !/^note: run with `RUST_BACKTRACE/.test(l.trim()))
    .filter((l) => !/^---- .* stdout ----$/.test(l.trim()))
    .map((l) => l.replace(/^thread '[^']*'\s*(\(\d+\)\s*)?panicked at /, "panicked at "))
    .join("\n")
    .trim();

const locateLibtest = (m) => {
  const hit = /panicked at ([^\s:]+):(\d+):(\d+):/.exec(String(m));
  if (!hit) return undefined;
  return { filePath: hit[1], line: Number(hit[2]), column: Number(hit[3]) };
};

const LIBTEST = { strip: stripLibtest, locate: locateLibtest };

const parsedFailures = () => {
  const parse = need("parseLibtestOutput");
  return parse(CAPTURE).failures;
};

// ---------------------------------------------------- the real cargo capture

test("real capture: parses to the 7 failing tests the run reported", async () => {
  const f = parsedFailures();
  assert.equal(f.length, 7, "the committed capture ends `44 passed; 7 failed`");
  for (const one of f) {
    assert.equal(typeof one.name, "string");
    assert.equal(typeof one.message, "string");
  }
});

test("real capture headline: the `not implemented` failures collapse to ONE shape", async () => {
  const f = parsedFailures();
  // Derived from the capture, not from the parser's ordering choice.
  const notImpl = f.filter((x) => stripLibtest(x.message).includes("not implemented"));
  // FIXTURE FACT, and a defect in the contract's prose: the contract's fact 1
  // claims "four distinct tests fail with the byte-identical message `not
  // implemented`, from the byte-identical location `src/task10.rs:6:63`". The
  // committed capture has FIVE such failures, and only THREE of them are at
  // src/task10.rs:6:63 (the other two are at src/task15.rs:8:41). The rules
  // themselves are unambiguous about what that means, and this test asserts the
  // rules, not the prose.
  assert.equal(notImpl.length, 5, "the capture has five `not implemented` panics");

  const shapes = await digest(f, LIBTEST);
  assert.equal(shapes.length, 3, "one `not implemented` shape plus two distinct assertion shapes");

  const top = shapes[0];
  assert.equal(top.count, 5, "rule 2+3: all five `not implemented` panics are one shape and it leads");
  assert.deepEqual(
    top.names,
    notImpl.map((x) => x.name),
    "rule 3: names are the failing tests in the order they arrived"
  );
  assert.ok(top.representative.includes("not implemented"), "rule 5: the representative is a real message");
});

test("real capture: the shared shape gets NO location because its members disagree", async () => {
  const shapes = await digest(parsedFailures(), LIBTEST);
  const top = shapes[0];
  // rule 4: three members panicked at src/task10.rs:6:63, two at
  // src/task15.rs:8:41. Claiming either would point the model at the wrong line.
  assert.equal(top.location, undefined, "rule 4: no single agreed location, so the field stays absent");
});

test("real capture: the three task10 failures alone DO agree on src/task10.rs:6:63", async () => {
  const f = parsedFailures().filter((x) => x.message.includes("src/task10.rs"));
  assert.equal(f.length, 3, "fixture: three tests panic in src/task10.rs");
  const shapes = await digest(f, LIBTEST);
  assert.equal(shapes.length, 1, "byte-identical messages are one shape");
  assert.equal(shapes[0].count, 3);
  assert.deepEqual(shapes[0].location, { filePath: "src/task10.rs", line: 6, column: 63 });
});

test("real capture: the two assertion messages do NOT collapse into each other", async () => {
  const shapes = await digest(parsedFailures(), LIBTEST);
  const asserts = shapes.filter((s) => s.representative.includes("assertion `left == right` failed"));
  assert.equal(asserts.length, 2, "`left: (0, None)` and `left: Some(305)` differ structurally, not just in digits");
  for (const s of asserts) assert.equal(s.count, 1);
});

test("real capture: ordering is count desc, ties by first arrival", async () => {
  const f = parsedFailures();
  const shapes = await digest(f, LIBTEST);
  const counts = shapes.map((s) => s.count);
  assert.deepEqual(counts, [5, 1, 1], "the loudest evidence leads");
  const firstIndex = (s) => f.findIndex((x) => x.name === s.names[0]);
  assert.ok(firstIndex(shapes[1]) < firstIndex(shapes[2]), "rule 3: the tie is broken by first-arrival index");
});

test("real capture: every failing test appears in exactly one shape", async () => {
  const f = parsedFailures();
  const shapes = await digest(f, LIBTEST);
  const all = shapes.flatMap((s) => s.names);
  assert.equal(all.length, f.length, "rule 6: nothing is dropped");
  assert.equal(new Set(all).size, f.length, "and nothing is duplicated");
  assert.equal(shapes.reduce((n, s) => n + s.count, 0), f.length, "count sums to the failure count");
});

// ------------------------------------------------------- the real trx report

const trxMessage = () => {
  const msg = /<Message>([\s\S]*?)<\/Message>/.exec(TRX)[1];
  const stack = /<StackTrace>([\s\S]*?)<\/StackTrace>/.exec(TRX)[1];
  const un = (s) => s.replace(/&#xD;/g, "\r").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return `${un(msg)}\n${un(stack)}`;
};

// The C# hooks, from the contract's table: location is ` in <path>:line <n>`,
// noise is frames whose type starts with Xunit. / NUnit. /
// Microsoft.VisualStudio.TestTools.
// CONTRACT GAP: the table says which frames to strip but not WHICH ` in
// <path>:line <n>` wins for C# (it says FIRST for vitest and LAST for pytest,
// and nothing for trx). Reading chosen here: the first frame that survives
// stripping, which is the deepest product frame - the same choice the contract
// makes for vitest, and the one fact 3 argues for ("the panic LOCATION is in
// product code, not the test"). The trx's own real stack makes that
// SiteValidation.cs:30, the throwing product line.
const stripCsharp = (m) =>
  String(m)
    .split("\n")
    .filter((l) => !/^\s*at (Xunit\.|NUnit\.|Microsoft\.VisualStudio\.TestTools)/.test(l))
    .join("\n")
    .trim();

const locateCsharp = (m) => {
  const hit = / in (.+?):line (\d+)/.exec(String(m));
  return hit ? { filePath: hit[1], line: Number(hit[2]) } : undefined;
};

test("real trx: one failure, located at the product line the stack names", async () => {
  const raw = trxMessage();
  assert.ok(raw.includes("SiteValidation.cs:line 30"), "fixture sanity: the real trx stack");
  const shapes = await digest([{ name: "ValidateTimeZone_ValidTimeZone_DoesNotThrow", message: raw }], {
    strip: stripCsharp,
    locate: locateCsharp,
  });
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].count, 1);
  assert.ok(shapes[0].location, "rule 4: a lone failure trivially agrees with itself");
  assert.ok(shapes[0].location.filePath.endsWith("Contoso.DataModel/SiteValidation.cs"));
  assert.equal(shapes[0].location.line, 30);
  assert.equal(shapes[0].location.column, undefined, "the extractor gave no column, so none is invented");
});

test("real trx: the key is normalised but the representative keeps the detail", async () => {
  const raw = trxMessage();
  const shapes = await digest([{ name: "t", message: raw }], { strip: stripCsharp, locate: locateCsharp });
  const s = shapes[0];
  assert.ok(!/\s\s/.test(s.shape) && !/[\r\n\t]/.test(s.shape), "rule 2: every whitespace run collapsed to one space");
  assert.ok(!/\d/.test(s.shape), "rule 2: every digit run replaced by #");
  assert.ok(s.shape.includes("#"), "rule 2: and the # is actually there");
  assert.ok(s.representative.includes("line 30"), "rule 5: the representative keeps its own digits");
  assert.ok(s.representative.includes("Invalid timezone ID"), "rule 5: verbatim, stripped only");
});

// ------------------------------------------------------------ rule 2: the key

test("digit normalisation collapses two messages that differ only in numbers", async () => {
  const shapes = await digest([
    { name: "a", message: "assertion `left == right` failed left: Some(305) right: Some(300)" },
    { name: "b", message: "assertion `left == right` failed left: Some(1) right: Some(29)" },
  ]);
  assert.equal(shapes.length, 1, "runs of digits are one #");
  assert.equal(shapes[0].count, 2);
});

test("digit normalisation does NOT collapse two messages that differ structurally", async () => {
  const shapes = await digest([
    { name: "a", message: "assertion `left == right` failed left: Some(305) right: Some(300)" },
    { name: "b", message: "assertion `left == right` failed left: None right: Some(300)" },
  ]);
  assert.equal(shapes.length, 2, "Some(#) and None are different shapes");
});

test("hex normalisation collapses 0x-prefixed runs", async () => {
  const shapes = await digest([
    { name: "a", message: "misaligned pointer dereference at 0xdeadbeef" },
    { name: "b", message: "misaligned pointer dereference at 0x1f" },
  ]);
  assert.equal(shapes.length, 1, "0x-prefixed hex runs are one 0xH");
  assert.equal(shapes[0].count, 2);
});

test("whitespace runs collapse and the key is trimmed", async () => {
  const shapes = await digest([
    { name: "a", message: "  not implemented\n\n   yet \t" },
    { name: "b", message: "not implemented yet" },
  ]);
  assert.equal(shapes.length, 1, "every run of whitespace becomes one space, ends trimmed");
  assert.equal(shapes[0].count, 2);
});

test("a key longer than 400 characters is truncated to 400", async () => {
  const head = "x".repeat(400);
  const shapes = await digest([
    { name: "a", message: `${head}AAAAA` },
    { name: "b", message: `${head}BBBBB` },
  ]);
  assert.equal(shapes.length, 1, "two messages agreeing for 400 characters are one shape");
  assert.equal(shapes[0].count, 2);
  assert.ok(shapes[0].shape.length <= 400, "the key itself is capped at 400");
  assert.ok(shapes[0].representative.endsWith("AAAAA"), "rule 5: the representative is NOT truncated");
});

test("messages that diverge before 400 characters stay separate", async () => {
  const head = "x".repeat(399);
  const shapes = await digest([
    { name: "a", message: `${head}A` },
    { name: "b", message: `${head}B` },
  ]);
  assert.equal(shapes.length, 2, "the 400th character still discriminates");
});

test("nothing else is normalised: case and punctuation still discriminate", async () => {
  const shapes = await digest([
    { name: "a", message: "not implemented" },
    { name: "b", message: "Not implemented" },
    { name: "c", message: "not implemented!" },
  ]);
  assert.equal(shapes.length, 3, 'rule 2 says digits, hex, whitespace, trim, and "Nothing else"');
});

// ------------------------------------------------- rule 3: order and stability

test("shapes come back ordered by count descending", async () => {
  const shapes = await digest([
    { name: "t1", message: "rare" },
    { name: "t2", message: "common" },
    { name: "t3", message: "common" },
    { name: "t4", message: "common" },
  ]);
  assert.deepEqual(shapes.map((s) => s.count), [3, 1]);
  assert.equal(shapes[0].representative, "common");
});

test("a genuine tie is broken by first-arrival index, and is stable", async () => {
  const failures = [
    { name: "t1", message: "zulu" },   // index 0, count 2
    { name: "t2", message: "alpha" },  // index 1, count 2
    { name: "t3", message: "mike" },   // index 2, count 3
    { name: "t4", message: "zulu" },
    { name: "t5", message: "alpha" },
    { name: "t6", message: "mike" },
    { name: "t7", message: "mike" },
  ];
  const shapes = await digest(failures);
  assert.deepEqual(shapes.map((s) => s.representative), ["mike", "zulu", "alpha"],
    "count 3 leads; the two count-2 shapes hold their arrival order, not alphabetical order");
  assert.deepEqual(shapes.map((s) => s.count), [3, 2, 2]);
  const again = await digest(failures);
  assert.deepEqual(again.map((s) => s.representative), shapes.map((s) => s.representative), "total order, so stable");
});

test("names inside a shape are in arrival order", async () => {
  const shapes = await digest([
    { name: "z_first", message: "same" },
    { name: "a_second", message: "other" },
    { name: "m_third", message: "same" },
  ]);
  assert.deepEqual(shapes[0].names, ["z_first", "m_third"], "input order preserved, not sorted");
});

// --------------------------------------------------------- rule 4: location

test("location is set when every member agrees", async () => {
  const loc = (m) => {
    const h = /at ([^\s:]+):(\d+)/.exec(m);
    return h ? { filePath: h[1], line: Number(h[2]) } : undefined;
  };
  const shapes = await digest(
    [
      { name: "a", message: "not implemented at src/task10.rs:6" },
      { name: "b", message: "not implemented at src/task10.rs:6" },
    ],
    { locate: loc }
  );
  assert.equal(shapes.length, 1);
  assert.deepEqual(shapes[0].location, { filePath: "src/task10.rs", line: 6 });
});

test("location is ABSENT when two members of one shape report different lines", async () => {
  // Same shape after digit normalisation, different lines: rule 4 refuses to pick.
  const loc = (m) => {
    const h = /at ([^\s:]+):(\d+)/.exec(m);
    return h ? { filePath: h[1], line: Number(h[2]) } : undefined;
  };
  const shapes = await digest(
    [
      { name: "a", message: "not implemented at src/task10.rs:6" },
      { name: "b", message: "not implemented at src/task10.rs:9" },
    ],
    { locate: loc }
  );
  assert.equal(shapes.length, 1, "digit normalisation makes these one shape");
  assert.equal(shapes[0].count, 2);
  assert.equal(shapes[0].location, undefined, "rule 4: no agreed line, so no location");
  assert.ok(!("location" in shapes[0]) || shapes[0].location === undefined);
});

test("location is absent when the members disagree on the FILE", async () => {
  const loc = (m) => ({ filePath: m.split("|")[1], line: 6 });
  const shapes = await digest(
    [
      { name: "a", message: "boom|src/a.rs" },
      { name: "b", message: "boom|src/b.rs" },
    ],
    { locate: loc }
  );
  // CONTRACT GAP: the messages differ, so whether these are one shape depends on
  // the stripper; with the identity stripper they are two. Assert the invariant
  // that holds either way: no shape claims a location its members disagree on.
  const merged = shapes.find((s) => s.count === 2);
  if (merged) assert.equal(merged.location, undefined, "rule 4: differing files agree on nothing");
  else assert.equal(shapes.length, 2);
});

test("one member declining means the shape has no agreed location", async () => {
  // CONTRACT GAP: rule 4 says location is set only when EVERY failure "yielded
  // the SAME location". A decline yields no location, so the shape has not met
  // that bar. Reading chosen: absent. A build that lets one decliner ride on its
  // neighbours' location is claiming more than it measured.
  let n = 0;
  const loc = () => (n++ === 0 ? { filePath: "src/task10.rs", line: 6, column: 63 } : undefined);
  const shapes = await digest(
    [
      { name: "a", message: "not implemented" },
      { name: "b", message: "not implemented" },
    ],
    { locate: loc }
  );
  assert.equal(shapes[0].count, 2);
  assert.equal(shapes[0].location, undefined);
});

test("with no locate hook at all, every location is absent", async () => {
  const shapes = await digest(parsedFailures(), { strip: stripLibtest });
  for (const s of shapes) assert.equal(s.location, undefined, "the hook is optional and absent is safe");
});

// ------------------------------------- rule 1, AS AMENDED: both hooks read RAW
//
// SUPERSEDED, and deliberately. The contract originally said "strip first, then
// locate", and this row asserted it. The build session amended it (see the
// Amendment at the bottom of session-v60/contracts/phaseB2-failure-evidence.md)
// after running the digest over the committed real capture: libtest puts the
// location INSIDE the harness header the stripper exists to remove
//
//   thread 'task15::tests::size_hint_exact' (3740764) panicked at src/task15.rs:26:9:
//
// so the two hooks fought and the loser was whichever ran second. Leaving the
// header in kept the location and put a redundant thread name and pid into every
// prompt block; taking it out lost the location. The rule now reads: BOTH hooks
// are independent transforms of the RAW message. This row asserts the amended
// rule; the old assertion is kept below in words so the change is not silent.

test("BOTH hooks read the RAW message, so a stripper may delete the line the extractor reads", async () => {
  const seenByLocate = [];
  const seenByStrip = [];
  const shapes = await digest(
    [{ name: "a", message: "RAW-ONLY tail" }],
    {
      strip: (m) => {
        seenByStrip.push(m);
        return m.replace("RAW-ONLY", "STRIPPED-FORM");
      },
      locate: (m) => {
        seenByLocate.push(m);
        return undefined;
      },
    }
  );
  assert.equal(seenByLocate.length >= 1, true, "the extractor was called");
  for (const s of seenByLocate) {
    assert.ok(s.includes("RAW-ONLY"), "amended rule 1: the extractor sees the RAW message");
  }
  for (const s of seenByStrip) {
    assert.ok(s.includes("RAW-ONLY"), "amended rule 1: the stripper also sees the RAW message");
  }
  assert.equal(shapes[0].representative, "STRIPPED-FORM tail", "rule 5: representative is the stripped message");
});

test("the amendment is load-bearing: a stripper that deletes the location line still leaves the location found", async () => {
  // The libtest shape, minimally. Under the ORIGINAL rule this returns no
  // location at all, which is the regression the amendment exists to prevent.
  const message = "thread 'x' (1) panicked at src/a.rs:9:3:\nnot implemented";
  const shapes = await digest([{ name: "a", message }], {
    strip: (m) => m.split("\n").filter((l) => !/panicked at/.test(l)).join("\n"),
    locate: (m) => {
      const hit = /panicked at ([^\s:]+):(\d+):(\d+):/.exec(m);
      return hit ? { filePath: hit[1], line: Number(hit[2]), column: Number(hit[3]) } : undefined;
    },
  });
  assert.deepEqual(shapes[0].location, { filePath: "src/a.rs", line: 9, column: 3 });
  assert.equal(shapes[0].representative, "not implemented", "and the redundant header is gone from the prompt");
});

test("the key is computed from the stripped message, so stripping can merge shapes", async () => {
  const shapes = await digest(
    [
      { name: "a", message: "HARNESS FRAME\nnot implemented" },
      { name: "b", message: "not implemented" },
    ],
    { strip: (m) => m.split("\n").filter((l) => l !== "HARNESS FRAME").join("\n") }
  );
  assert.equal(shapes.length, 1, "the noise line was the only difference");
  assert.equal(shapes[0].count, 2);
});

// ------------------------------------------------- rule 5: the representative

test("representative is the FIRST stripped message verbatim, digits intact", async () => {
  const shapes = await digest([
    { name: "a", message: "left: Some(305) right: Some(300)" },
    { name: "b", message: "left: Some(1) right: Some(2)" },
  ]);
  assert.equal(shapes[0].count, 2);
  assert.equal(shapes[0].representative, "left: Some(305) right: Some(300)",
    "the first one, with its own digits, not the normalised key");
  assert.notEqual(shapes[0].representative, shapes[0].shape);
});

// -------------------------------------------------- rule 6: pure and total

test("empty input gives an empty array", async () => {
  const shapes = await digest([]);
  assert.ok(Array.isArray(shapes));
  assert.equal(shapes.length, 0);
});

test("an empty message, an all-whitespace message, and a stripped-to-nothing message all group", async () => {
  const shapes = await digest(
    [
      { name: "a", message: "" },
      { name: "b", message: "   \n\t  " },
      { name: "c", message: "PURE-NOISE" },
      { name: "d", message: "real failure" },
    ],
    { strip: (m) => m.replace("PURE-NOISE", "") }
  );
  const empty = shapes.find((s) => s.shape === "");
  assert.ok(empty, "rule 6: they group under the empty key");
  assert.equal(empty.count, 3, "a failure with no message is still a failure");
  assert.deepEqual(empty.names, ["a", "b", "c"]);
  assert.equal(shapes.reduce((n, s) => n + s.count, 0), 4, "nothing is dropped");
  assert.equal(empty.representative, "", "the first stripped message, which is empty");
});

test("the input is not mutated and the caller's objects survive", async () => {
  const failures = [
    { name: "a", message: "  left: Some(305)  " },
    { name: "b", message: "left: Some(1)" },
  ];
  const before = JSON.stringify(failures);
  await digest(failures, LIBTEST);
  assert.equal(JSON.stringify(failures), before, "rule 6: pure");
  assert.equal(failures.length, 2);
});

// ------------------------------------------------- rule 7: never throws

test("a stripper that throws is treated as declining, and the digest still returns", async () => {
  const shapes = await digest(
    [
      { name: "a", message: "not implemented" },
      { name: "b", message: "not implemented" },
    ],
    {
      strip: () => {
        throw new Error("stripper blew up");
      },
    }
  );
  assert.equal(shapes.length, 1, "declining means identity, so the raw messages still group");
  assert.equal(shapes[0].count, 2);
  assert.equal(shapes[0].representative, "not implemented", "declined strip leaves the message as it was");
});

test("an extractor that throws is treated as declining, and the digest still returns", async () => {
  const shapes = await digest(
    [{ name: "a", message: "not implemented" }],
    {
      locate: () => {
        throw new Error("extractor blew up");
      },
    }
  );
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].location, undefined, "a throwing hook declines, it does not poison the shape");
});

test("a stripper returning a non-string, and both hooks throwing, still never throws", async () => {
  const shapes = await digest(
    [
      { name: "a", message: "not implemented" },
      { name: "b", message: "" },
    ],
    {
      strip: () => {
        throw new Error("boom");
      },
      locate: () => {
        throw new Error("boom");
      },
    }
  );
  assert.equal(Array.isArray(shapes), true);
  assert.equal(shapes.reduce((n, s) => n + s.count, 0), 2);
});

// =================================================== renderFailureEvidence

const ORDER = ["shapes", "locations", "names", "docs"];
const isOrderedPrefix = (reached) => reached.every((v, i) => v === ORDER[i]);

// Markers chosen so no marker is a substring of any other and none appears in
// the header numbers.
const REP = { a: "not implemented", b: "index out of bounds", c: "left == right failed" };
const LOC = { a: "locmarkalpha.rs", b: "locmarkbeta.rs", c: "locmarkgamma.rs" };
const NAMES = {
  a: ["namemark_a1", "namemark_a2", "namemark_a3", "namemark_a4", "namemark_a5"],
  b: ["namemark_b1"],
  c: ["namemark_c1"],
};
const THREE = [
  { shape: "k-a", representative: REP.a, count: 5, names: NAMES.a, location: { filePath: LOC.a, line: 6, column: 63 } },
  { shape: "k-b", representative: REP.b, count: 1, names: NAMES.b, location: { filePath: LOC.b, line: 27, column: 9 } },
  { shape: "k-c", representative: REP.c, count: 1, names: NAMES.c, location: { filePath: LOC.c, line: 12, column: 4 } },
];
const ALL_NAMES = [...NAMES.a, ...NAMES.b, ...NAMES.c];
const baseInput = (over = {}) => ({ shapes: THREE, tokMax: 400, ran: 11, passed: 4, ...over });

const sweep = async (over = {}, max = 900, step = 5) => {
  const out = [];
  for (let tokMax = 1; tokMax <= max; tokMax += step) {
    out.push({ tokMax, r: await render(baseInput({ ...over, tokMax })) });
  }
  return out;
};

test("empty shapes gives an empty section and zero spend", async () => {
  const r = await render({ shapes: [], tokMax: 4000, ran: 11, passed: 11 });
  assert.equal(r.section, "", "a compiler-only round must look exactly like one");
  assert.equal(r.spentTok, 0);
  assert.equal(r.droppedNames, 0);
  // CONTRACT GAP: the contract does not say what `reached` is when nothing is
  // rendered. Reading chosen: nothing was reached, so the empty array.
  assert.deepEqual(r.reached, []);
});

test('"body" is never in reached, at any budget', async () => {
  for (const { r } of await sweep()) assert.ok(!r.reached.includes("body"), "priority 5 is not implemented");
  const huge = await render(baseInput({ tokMax: 1000000, docCommentFor: () => "intent line" }));
  assert.ok(!huge.reached.includes("body"), "not even with an unlimited budget");
});

test("reached is always an ordered prefix of shapes, locations, names, docs", async () => {
  for (const { tokMax, r } of await sweep({ docCommentFor: () => "why this test exists" })) {
    assert.ok(Array.isArray(r.reached));
    assert.ok(isOrderedPrefix(r.reached), `tokMax ${tokMax}: reached ${JSON.stringify(r.reached)} is out of order`);
  }
});

test("there is a budget that reaches shapes ONLY, and it names no location", async () => {
  const rows = await sweep();
  const only = rows.find(({ r }) => r.reached.length === 1 && r.reached[0] === "shapes");
  assert.ok(only, "a budget exists that fits priority 1 and nothing more");
  assert.deepEqual(only.r.reached, ["shapes"]);
  for (const key of Object.keys(LOC)) {
    assert.ok(!only.r.section.includes(LOC[key]), "priority 2 is not spent before it is affordable");
  }
  assert.ok(only.r.section.includes(REP.a), "but the shapes themselves are there");
  assert.ok(/\b5\b/.test(only.r.section), "with the count that makes them worth sending");
});

test("reached grows in the documented order as the budget rises", async () => {
  const rows = await sweep({ docCommentFor: () => "why this test exists" });
  const firstWith = (p) => rows.find(({ r }) => r.reached.includes(p));
  for (const p of ORDER) assert.ok(firstWith(p), `no budget in the sweep ever reached ${p}`);
  assert.ok(firstWith("shapes").tokMax <= firstWith("locations").tokMax, "shapes before locations");
  assert.ok(firstWith("locations").tokMax <= firstWith("names").tokMax, "locations before names");
  assert.ok(firstWith("names").tokMax <= firstWith("docs").tokMax, "names before docs");
});

test("BREADTH before DEPTH: every shape is stated before ANY location is", async () => {
  // The bug this rule exists to prevent: a depth-first renderer spends shape 1's
  // location before shape 3 has been mentioned at all.
  for (const { tokMax, r } of await sweep()) {
    const anyLoc = Object.values(LOC).some((m) => r.section.includes(m));
    if (!anyLoc) continue;
    for (const key of ["a", "b", "c"]) {
      assert.ok(
        r.section.includes(REP[key]),
        `tokMax ${tokMax}: a location was rendered while shape ${key} was still missing`
      );
    }
  }
});

test("BREADTH before DEPTH: every location is stated before ANY name is", async () => {
  for (const { tokMax, r } of await sweep()) {
    const named = ALL_NAMES.filter((n) => r.section.includes(n));
    if (named.length === 0) continue;
    for (const key of ["a", "b", "c"]) {
      assert.ok(
        r.section.includes(LOC[key]),
        `tokMax ${tokMax}: names were listed while shape ${key}'s location was still missing`
      );
    }
  }
});

test("a budget that fits one location but not three spends on breadth instead", async () => {
  const rows = await sweep();
  const shapesOnly = rows.filter(({ r }) => r.reached.length === 1 && r.reached[0] === "shapes");
  assert.ok(shapesOnly.length > 0, "such budgets exist");
  const widest = shapesOnly[shapesOnly.length - 1].r;
  for (const key of ["a", "b", "c"]) {
    assert.ok(widest.section.includes(REP[key]), `shape ${key} must be stated at the widest shapes-only budget`);
  }
  for (const key of Object.keys(LOC)) assert.ok(!widest.section.includes(LOC[key]));
});

test("droppedNames equals the failing names the section could not name", async () => {
  for (const { tokMax, r } of await sweep({ docCommentFor: () => "intent" })) {
    const named = ALL_NAMES.filter((n) => r.section.includes(n)).length;
    assert.equal(r.droppedNames, ALL_NAMES.length - named, `tokMax ${tokMax}: droppedNames disagrees with the section`);
  }
});

test("droppedNames is every name when the budget never reaches priority 3", async () => {
  const rows = await sweep();
  const only = rows.find(({ r }) => r.reached.length === 1 && r.reached[0] === "shapes");
  assert.equal(only.r.droppedNames, ALL_NAMES.length, "7 failing tests, none named");
});

test("droppedNames is zero when the budget names them all", async () => {
  const r = await render(baseInput({ tokMax: 1000000, docCommentFor: () => "intent" }));
  assert.equal(r.droppedNames, 0);
  for (const n of ALL_NAMES) assert.ok(r.section.includes(n), `${n} should be named at an unlimited budget`);
});

test("the header states what happened and does not claim the function is wrong", async () => {
  const r = await render(baseInput({ tokMax: 4000, ran: 11, passed: 4 }));
  const header = r.section.split("\n").find((l) => l.trim().length > 0);
  assert.ok(header, "there is a header line");
  assert.ok(/\b7\b/.test(header) && /\b11\b/.test(header), `header must state 7 of 11: ${JSON.stringify(header)}`);
  assert.ok(/fail/i.test(header), "and say they failed");
  for (const forbidden of [
    /the function is wrong/i,
    /your function is wrong/i,
    /the code is wrong/i,
    /incorrect implementation/i,
    /implementation is incorrect/i,
    /is buggy/i,
    /you (?:wrote|made) a bug/i,
  ]) {
    assert.ok(!forbidden.test(r.section), `the section must claim nothing more than what happened: ${forbidden}`);
  }
});

test("the header counts come from ran and passed, not from the shapes alone", async () => {
  const r = await render(baseInput({ tokMax: 4000, ran: 40, passed: 33 }));
  const header = r.section.split("\n").find((l) => l.trim().length > 0);
  assert.ok(/\b40\b/.test(header), `the ran count must appear: ${JSON.stringify(header)}`);
  assert.ok(/\b7\b/.test(header), "and the failed count derived from it");
});

test("passing tests contribute nothing: only failing names ever appear", async () => {
  const r = await render(baseInput({ tokMax: 1000000, docCommentFor: (n) => `doc for ${n}` }));
  assert.ok(!r.section.includes("passing"), "no passing test is described");
  const docCalls = [];
  await render(baseInput({
    tokMax: 1000000,
    docCommentFor: (n) => {
      docCalls.push(n);
      return `doc for ${n}`;
    },
  }));
  for (const n of docCalls) assert.ok(ALL_NAMES.includes(n), `doc comments are asked for failing tests only, got ${n}`);
});

test("readSourceLine is quoted when present and nothing is quoted when it is absent", async () => {
  const QUOTED = "todo!(/* srcquotemarker */)";
  const withRead = await sweep({ readSourceLine: () => ({ line: QUOTED }) });
  assert.ok(withRead.some(({ r }) => r.section.includes(QUOTED)), "priority 2 quotes the line it names");
  for (const { r } of withRead) {
    if (r.section.includes(QUOTED)) {
      assert.ok(r.reached.includes("locations"), "quoting is part of priority 2");
    }
  }
  for (const { r } of await sweep()) {
    assert.ok(!r.section.includes(QUOTED), "absent means locations are named but never quoted");
  }
});

test("readSourceLine never causes a whole body to be emitted", async () => {
  const body = Array.from({ length: 40 }, (_, i) => `body_line_${i}`).join("\n");
  const r = await render(baseInput({ tokMax: 1000000, readSourceLine: () => ({ line: "todo!()", before: body, after: body }) }));
  assert.ok(!r.reached.includes("body"));
  // CONTRACT GAP: the contract says "a little context", not how many lines. The
  // testable floor is that the renderer respects its own budget rather than
  // pasting whatever the reader hands it.
  assert.ok(r.spentTok <= 1000000);
});

test("spentTok tracks the section under the chars/4 estimator", async () => {
  for (const { tokMax, r } of await sweep({ docCommentFor: () => "intent" })) {
    const est = r.section.length / 4;
    assert.ok(
      Math.abs(r.spentTok - est) <= 1,
      `tokMax ${tokMax}: spentTok ${r.spentTok} is not chars/4 of a ${r.section.length}-char section`
    );
  }
});

test("the budget is respected once anything is rendered", async () => {
  for (const { tokMax, r } of await sweep({ docCommentFor: () => "intent" })) {
    if (r.reached.length === 0) continue;
    assert.ok(r.spentTok <= tokMax, `tokMax ${tokMax}: spent ${r.spentTok}`);
  }
});

test("deterministic: the same input renders a byte-identical section", async () => {
  const input = baseInput({ tokMax: 260, readSourceLine: () => ({ line: "todo!()" }), docCommentFor: () => "intent" });
  const a = await render(input);
  const b = await render(input);
  const c = await render(baseInput({ tokMax: 260, readSourceLine: () => ({ line: "todo!()" }), docCommentFor: () => "intent" }));
  assert.equal(a.section, b.section);
  assert.equal(a.section, c.section, "no clock, no filesystem, no ordering wobble");
  assert.equal(a.spentTok, c.spentTok);
  assert.deepEqual(a.reached, c.reached);
  assert.equal(a.droppedNames, c.droppedNames);
});

test("render is pure: it does not mutate the shapes it is given", async () => {
  const input = baseInput({ tokMax: 300 });
  const before = JSON.stringify(input.shapes);
  await render(input);
  assert.equal(JSON.stringify(input.shapes), before);
});

test("a shape with no location does not stop the others being located", async () => {
  const shapes = [
    { shape: "k-a", representative: REP.a, count: 5, names: NAMES.a },
    { shape: "k-b", representative: REP.b, count: 1, names: NAMES.b, location: { filePath: LOC.b, line: 27 } },
  ];
  const r = await render({ shapes, tokMax: 4000, ran: 11, passed: 5 });
  assert.ok(r.section.includes(REP.a) && r.section.includes(REP.b));
  assert.ok(r.section.includes(LOC.b), "the shape that agreed on a location still gets one");
  assert.ok(!r.section.includes(LOC.a), "and no location is invented for the one that did not");
});

test("the real capture renders end to end without claiming more than it knows", async () => {
  const failures = parsedFailures();
  const shapes = await digest(failures, LIBTEST);
  const r = await render({ shapes, tokMax: 200, ran: 51, passed: 44 });
  assert.ok(r.section.length > 0);
  assert.ok(r.section.includes("not implemented"), "the loudest shape leads");
  assert.ok(/\b51\b/.test(r.section) && /\b7\b/.test(r.section), "the honest header: 7 of 51 failed");
  assert.ok(!r.reached.includes("body"));
  assert.ok(r.spentTok <= 200, "the whole thing fits the allowance the priced table argued for");
});
