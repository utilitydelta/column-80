// Blind oracle for session-v68 phase 6: the RECEIVER RUNG, five languages
// [session-v68/contracts/P6-receiver.md]. Written from the contract alone,
// WITHOUT READING src/** — not one file, not one grep. Every assertion here is
// derived from P6's numbered rules 1..7 and properties 8..14, plus the verdicts
// the SHIPPED classifier hands back when it is CALLED, which is the only
// channel a blind file is allowed to learn today's behaviour through.
//
// What is oracled, all through the public seam:
//   tddLangFor                                   ../src/core/tddLang
//   lang.classifyTestability(signature, docComment, ctx)
//   ctx = { receiverConstructible: true, receiverExported: true } | { receiverConstructible: false } | absent
//
// AMENDED after the phase 5/6 adversarial review moved contract rule 2:
// TypeScript needs TWO facts, not one. The method form is both the fixture tell
// and the `not-exported` tell, and the surface resolving proves the receiver is
// constructible while saying nothing about whether the CLASS is reachable from
// the test site. So the flagged ctx carries `receiverExported` as well, and its
// ABSENCE is what keeps the refusal. Nothing else in this file changed: the
// twin comparison below is the same idea, driven with the same rows.
//
// The one contract idea being falsified: `receiverConstructible: true` skips
// ONLY the fixture rung. So a member function classified with the flag must
// come back with the SAME verdict its non-member twin gets — same reason, same
// detail, byte for byte — because the fixture rung is the single thing between
// them. That twin comparison is how "precedence is otherwise byte-identical"
// (rule 2) is stated without this file ever guessing which rung wins.
//
// A note on property 11's literal words. It says an async member "reports
// `async`", and that sentence was written before phase 5 lifted the async rung
// for the languages that had nothing to detect. What survives phase 5 is its
// falsifiable half: an async member must NOT report `needs-fixture` when the
// flag is set, and whatever it does report must be its twin's verdict. That is
// what the async rows below assert.
//
// EXPECTED RED where the flag is set. The rows with NO flag (rule 3, property
// 12's second half) pin behaviour that is GREEN TODAY and must stay green,
// which is the only way a blind file can express "unchanged".
//
// Rules 4, 5, 6, 7 and properties 9 and 10 live in the `column80.generateTests`
// gate and in the prompt. A core bundle cannot reach either, and inventing a
// private import path to get at them would be a harness finding dressed as a
// contract finding, so they are `test.skip` rows naming what a VS Code-tier
// test has to cover instead.
//
// Run: SKIP_LIVE=1 node --test test/blind-v68-receiver-rung.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v68-receiver-rung",
    `export { tddLangFor } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
// A failed bundle never returns a cleanup and still wrote the entry file.
test.after(() => {
  cleanup();
  for (const leftover of [
    ".blind-v68-receiver-rung.entry.ts",
    ".blind-v68-receiver-rung.bundle.cjs",
  ]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
});

const { tddLangFor } = mod;

test("bundle: the P6 surface builds and exports the classifier seam [P6 'Surface under contract']", () => {
  assert.strictEqual(
    bundleError,
    undefined,
    `the bundle failed, so every row below is a harness error rather than a contract finding: ${bundleError && bundleError.message}`
  );
  assert.strictEqual(typeof tddLangFor, "function", "tddLangFor(languageId) => TddLang | undefined");
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

const LANG = (id) => {
  const l = tddLangFor(id);
  assert.ok(l, `tddLangFor(${JSON.stringify(id)}) must resolve; the seam registers all five legs`);
  return l;
};

const IDS = ["rust", "go", "typescript", "python", "csharp"];

// The flag, in the three spellings rule 3 names: set, cleared, absent.
const ON = { receiverConstructible: true, receiverExported: true };
const OFF = { receiverConstructible: false };

const why = (label, v, extra) =>
  `${label}: ${extra}\n---- VERDICT ----\n${JSON.stringify(v)}\n---- END ----`;

function assertTestable(label, v, extra) {
  assert.ok(v && typeof v === "object", `${label}: classifyTestability returned ${JSON.stringify(v)}`);
  assert.strictEqual(v.reason, undefined, why(label, v, extra));
  assert.notStrictEqual(v.testable, false, why(label, v, extra));
}

// Doc comments, one per language, in that language's own spelling. Copied from
// the phase 5 oracle so the two files agree on what "documented" means.
const DOC = {
  rust: "/// Widens n and returns the widened value.",
  go: "// Widen returns n widened.",
  typescript: "/** Returns twice the given count of shards. */",
  python: "Return the widened value of n.",
  csharp: "/// <summary>Widens n.</summary>",
};

// ===========================================================================
// The member/twin table. Each row is a real method signature and the SAME
// function written with no receiver — the free function, the module-level def,
// the static. The twin is the whole instrument: rule 2 says the flag removes
// the fixture rung and nothing else, so the member's flagged verdict and the
// twin's unflagged verdict must be the same object.
//
// TypeScript's twin necessarily also adds `export`, because the TS leg reads
// the METHOD FORM ITSELF as the fixture tell and the same missing `export` is
// its not-exported tell. That is not a flaw in the fixture: it is the question
// P6 rule 2 poses for TypeScript. If only the TypeScript rows go red, the
// finding is that lifting the fixture rung there drops the target onto a rung
// it was never really standing on.
// ===========================================================================

const MEMBERS = {
  // value-returning, documented: property 8's shape in each language
  value: [
    ["rust", "pub fn area(&self) -> f64", "pub fn area() -> f64"],
    ["go", "func (w *Widget) Area() float64", "func Area() float64"],
    ["typescript", "area(): number {", "export function area(): number {"],
    ["python", "def area(self) -> float:", "def area() -> float:"],
    ["csharp", "public double Area()", "public static double Area()"],
  ],
  // async, in each language's own spelling of async (Go's is a channel)
  async: [
    ["rust", "pub async fn area(&self) -> f64", "pub async fn area() -> f64"],
    ["go", "func (w *Widget) Drain(c chan int) float64", "func Drain(c chan int) float64"],
    ["typescript", "async area(): Promise<number> {", "export async function area(): Promise<number> {"],
    ["python", "async def area(self) -> float:", "async def area() -> float:"],
    ["csharp", "public async Task<double> AreaAsync()", "public static async Task<double> AreaAsync()"],
  ],
  // io in the signature
  io: [
    ["rust", "pub fn dump(&self, p: &Path) -> io::Result<String>", "pub fn dump(p: &Path) -> io::Result<String>"],
    ["go", "func (w *Widget) Dump(fh *os.File) float64", "func Dump(fh *os.File) float64"],
    [
      "typescript",
      'dump(fh: import("node:fs").WriteStream): number {',
      'export function dump(fh: import("node:fs").WriteStream): number {',
    ],
    ["python", "def dump(self, p: Path) -> str:", "def dump(p: Path) -> str:"],
    ["csharp", "public string Dump(System.IO.Stream s)", "public static string Dump(System.IO.Stream s)"],
  ],
  // returning unit / void: property 12's shape
  unit: [
    ["rust", "pub fn apply(&mut self, n: u32)", "pub fn apply(n: u32)"],
    ["go", "func (w *Widget) Apply(n int)", "func Apply(n int)"],
    ["typescript", "apply(n: number): void {", "export function apply(n: number): void {"],
    ["python", "def apply(self, n: int) -> None:", "def apply(n: int) -> None:"],
    ["csharp", "public void Apply(int n)", "public static void Apply(int n)"],
  ],
};

const ALL_MEMBER_ROWS = [].concat(MEMBERS.value, MEMBERS.async, MEMBERS.io, MEMBERS.unit);

// ===========================================================================
// 1. Rule 3 + property 12's second half: with NO flag, every member is
//    `needs-fixture`. GREEN TODAY. A red here is a regression this phase
//    caused, not a finding about the new leg.
// ===========================================================================

gtest("[P6 §3 + §12] with NO flag every documented member is `needs-fixture`, in all five languages - this is today's behaviour and lifting the rung must not move it", () => {
  for (const [id, member] of MEMBERS.value) {
    const v = LANG(id).classifyTestability(member, DOC[id], undefined);
    assert.strictEqual(
      v.reason,
      "needs-fixture",
      why(`${id} ${JSON.stringify(member)}`, v, "P6 rule 3: absent means today's behaviour, and today a member is refused for its receiver")
    );
    assert.strictEqual(typeof v.detail, "string", why(`${id} ${member}`, v, "a refusal carries a human-facing detail"));
    assert.ok(v.detail.length > 0, why(`${id} ${member}`, v, "the refusal detail is empty"));
  }
});

gtest("[P6 §3 + §12] a member with no doc comment is `needs-fixture` with no flag too - the fixture rung is reached before the doc comment is looked at, and that ORDER is what the cost rule spends", () => {
  for (const [id, member] of MEMBERS.value) {
    const v = LANG(id).classifyTestability(member, undefined, undefined);
    assert.strictEqual(
      v.reason,
      "needs-fixture",
      why(`${id} ${JSON.stringify(member)} nodoc`, v, "P6 step 1 classifies as today, and today's answer for an undocumented member is the fixture rung")
    );
  }
});

gtest("[P6 §3] `receiverConstructible: false` is byte-identical to the flag being ABSENT - 'absent or false is today's behaviour, exactly'", () => {
  for (const [id, member] of ALL_MEMBER_ROWS) {
    const lang = LANG(id);
    for (const doc of [DOC[id], undefined]) {
      const absent = lang.classifyTestability(member, doc, undefined);
      const cleared = lang.classifyTestability(member, doc, OFF);
      assert.deepStrictEqual(
        cleared,
        absent,
        `${id} ${JSON.stringify(member)} doc=${doc ? "yes" : "no"}: a CLEARED flag changed the verdict. absent ${JSON.stringify(absent)} vs false ${JSON.stringify(cleared)}`
      );
    }
  }
});

gtest("[P6 §3] an empty ctx and a ctx carrying unrelated fields are also today's behaviour - only the named flag may move a verdict", () => {
  for (const [id, member] of MEMBERS.value) {
    const lang = LANG(id);
    const absent = lang.classifyTestability(member, DOC[id], undefined);
    for (const ctx of [{}, { asyncRuntime: "tokio" }, { receiverType: "Widget" }, { constructible: true }]) {
      assert.deepStrictEqual(
        lang.classifyTestability(member, DOC[id], ctx),
        absent,
        `${id} ${JSON.stringify(member)}: ctx ${JSON.stringify(ctx)} moved a verdict, and none of these fields is the contract's flag`
      );
    }
  }
});

// ===========================================================================
// 2. Rule 2 + property 8 + rule 13: with the flag SET, a documented
//    value-returning member is TESTABLE. In all five languages.
// ===========================================================================

gtest("[P6 §2 + §8 + §13] with `receiverConstructible: true` a documented, value-returning member is TESTABLE - the receiver was the single thing in the way, and the flag says it is not in the way", () => {
  for (const [id, member, twin] of MEMBERS.value) {
    const v = LANG(id).classifyTestability(member, DOC[id], ON);
    assertTestable(
      `${id} ${JSON.stringify(member)}`,
      v,
      `P6 property 8: this member is documented, returns a value, touches no IO and is not async. With the receiver granted there is nothing left to refuse it for. Its non-member twin ${JSON.stringify(twin)} is admitted today`
    );
  }
});

gtest("[P6 §13] all five languages ACCEPT the flag - the verdict for a documented value-returning member must CHANGE when it is set, which is the only proof the leg reads it at all", () => {
  const deaf = [];
  for (const [id, member] of MEMBERS.value) {
    const lang = LANG(id);
    const off = lang.classifyTestability(member, DOC[id], undefined);
    const on = lang.classifyTestability(member, DOC[id], ON);
    if (JSON.stringify(off) === JSON.stringify(on)) deaf.push(`${id} ${JSON.stringify(member)} -> ${JSON.stringify(off)}`);
  }
  assert.deepStrictEqual(
    deaf,
    [],
    `these legs ignore receiverConstructible entirely, so the gate's step 2 cannot ask them anything:\n${deaf.join("\n")}`
  );
});

// ===========================================================================
// 3. Rule 2 + properties 11 and 12: the flag skips ONLY the fixture rung.
//    Precedence is otherwise byte-identical, and the twin is what "otherwise"
//    means.
// ===========================================================================

gtest("[P6 §2 + §11] an ASYNC member with the flag set does NOT report `needs-fixture` - the fixture rung is skipped, so what it reports is whatever the async rung decided for its twin", () => {
  for (const [id, member, twin] of MEMBERS.async) {
    const lang = LANG(id);
    const v = lang.classifyTestability(member, DOC[id], ON);
    assert.notStrictEqual(
      v.reason,
      "needs-fixture",
      why(`${id} ${JSON.stringify(member)}`, v, "the flag grants the receiver, so the fixture rung is not what refuses this")
    );
    assert.deepStrictEqual(
      v,
      lang.classifyTestability(twin, DOC[id], undefined),
      `${id} ${JSON.stringify(member)}: precedence is not byte-identical to its non-member twin ${JSON.stringify(twin)}. flagged member ${JSON.stringify(v)} vs twin ${JSON.stringify(lang.classifyTestability(twin, DOC[id], undefined))}`
    );
  }
});

gtest("[P6 §2] an IO member with the flag set still reports `io` - io wins over the fixture rung today and granting the receiver does not buy a filesystem", () => {
  for (const [id, member] of MEMBERS.io) {
    const v = LANG(id).classifyTestability(member, DOC[id], ON);
    assert.strictEqual(
      v.reason,
      "io",
      why(`${id} ${JSON.stringify(member)}`, v, "P6 rule 2: io still wins over the fixture rung, flag or no flag")
    );
  }
});

gtest("[P6 §2 + §12] a member returning UNIT reports `underspecified` when the flag is set, and `needs-fixture` when it is not - property 12 stated in both directions", () => {
  for (const [id, member] of MEMBERS.unit) {
    const lang = LANG(id);
    const off = lang.classifyTestability(member, DOC[id], undefined);
    const on = lang.classifyTestability(member, DOC[id], ON);
    assert.strictEqual(
      off.reason,
      "needs-fixture",
      why(`${id} ${JSON.stringify(member)} flag absent`, off, "P6 property 12: with no flag the fixture rung claims it first")
    );
    assert.strictEqual(
      on.reason,
      "underspecified",
      why(`${id} ${JSON.stringify(member)} flag set`, on, "P6 property 12: underneath the fixture rung there is nothing to assert on")
    );
  }
});

gtest("[P6 §2] a member with NO doc comment reports `underspecified` when the flag is set - `underspecified` still catches a missing doc comment underneath", () => {
  for (const [id, member] of MEMBERS.value) {
    const v = LANG(id).classifyTestability(member, undefined, ON);
    assert.strictEqual(
      v.reason,
      "underspecified",
      why(`${id} ${JSON.stringify(member)} nodoc`, v, "P6 rule 2: the flag skips the fixture rung and lands on the missing contract")
    );
  }
});

gtest("[P6 §2 + §13] the WHOLE precedence chain is byte-identical to the twin's, for every member shape and both doc spellings - one deepStrictEqual per row is the strongest reading of 'otherwise byte-identical'", () => {
  const bad = [];
  for (const [id, member, twin] of ALL_MEMBER_ROWS) {
    const lang = LANG(id);
    for (const doc of [DOC[id], undefined]) {
      const flagged = lang.classifyTestability(member, doc, ON);
      const twinV = lang.classifyTestability(twin, doc, undefined);
      if (JSON.stringify(flagged) !== JSON.stringify(twinV)) {
        bad.push(
          `${id} doc=${doc ? "yes" : "no"}\n  member ${JSON.stringify(member)} + flag -> ${JSON.stringify(flagged)}\n  twin   ${JSON.stringify(twin)}        -> ${JSON.stringify(twinV)}`
        );
      }
    }
  }
  assert.deepStrictEqual(
    bad,
    [],
    `granting the receiver must leave a member classified exactly as its receiver-free twin. These rows disagree:\n${bad.join("\n")}`
  );
});

gtest("[P6 §2] granting the receiver never turns a REFUSAL into a different refusal for a non-member - a signature with no receiver never reaches the fixture rung, so the flag has nothing to skip there", () => {
  const bad = [];
  for (const [id, , twin] of ALL_MEMBER_ROWS) {
    const lang = LANG(id);
    for (const doc of [DOC[id], undefined]) {
      const off = lang.classifyTestability(twin, doc, undefined);
      const on = lang.classifyTestability(twin, doc, ON);
      if (JSON.stringify(off) !== JSON.stringify(on)) {
        bad.push(`${id} ${JSON.stringify(twin)} doc=${doc ? "yes" : "no"}: ${JSON.stringify(off)} became ${JSON.stringify(on)}`);
      }
    }
  }
  assert.deepStrictEqual(bad, [], `the flag moved a NON-MEMBER verdict:\n${bad.join("\n")}`);
});

// ===========================================================================
// 4. Rule 3, sharply: with the flag ABSENT, every verdict AND every detail
//    string for a large set of NON-MEMBER signatures is what it is today.
//    These strings are pinned deliberately: a later change to any of them is a
//    change to what the human is told, and it should have to be seen.
//    GREEN TODAY.
// ===========================================================================

const PINNED = [
  ["rust", "pub fn widen(n: i32) -> i64", DOC.rust, undefined, undefined],
  ["rust", "pub fn widen(n: i32) -> i64", undefined, "underspecified", "no doc comment — no contract to author a blind test from"],
  ["rust", "pub fn parse(s: &str) -> Result<Shard, ParseError>", DOC.rust, undefined, undefined],
  ["rust", "pub fn read_all(p: &Path) -> io::Result<String>", DOC.rust, "io", "IO/network in the signature — integration territory, not a blind unit test"],
  ["rust", "fn helper(n: i32) -> i64", DOC.rust, undefined, undefined],
  ["rust", "pub fn apply(n: u32)", DOC.rust, "underspecified", "no return value to assert — side-effect only"],
  ["rust", "pub async fn widen(n: u32) -> u64", DOC.rust, "async", "async fn, and no async test runtime found in Cargo.toml — looked for tokio, async-std and smol"],
  ["rust", "pub const fn widen(n: i32) -> i64", DOC.rust, undefined, undefined],
  ["go", "func Widen(n int) int", DOC.go, undefined, undefined],
  ["go", "func Widen(n int) int", undefined, "underspecified", "no doc comment — no contract to author a blind test from"],
  ["go", "func ParseShard(s string) (int, error)", DOC.go, undefined, undefined],
  ["go", "func widen(n int) int", DOC.go, undefined, undefined],
  ["go", "func Dump(fh *os.File) int", DOC.go, "io", "IO/network in the signature (os, net, io, bufio, http) — integration territory, not a blind unit test"],
  ["go", "func Drain(c chan int) int", DOC.go, "async", "a channel in the signature — a blind test cannot know who fills it, when, or how many times"],
  ["go", "func Apply(n int)", DOC.go, "underspecified", "no return value to assert — side-effect only"],
  ["go", "func Widen(ctx context.Context, n int) int", DOC.go, undefined, undefined],
  ["typescript", "export function widen(n: number): number {", DOC.typescript, undefined, undefined],
  ["typescript", "export function widen(n: number): number {", undefined, "underspecified", "no doc comment — no contract to author a blind test from"],
  ["typescript", "export const widen = (n: number): string =>", DOC.typescript, undefined, undefined],
  ["typescript", "function helper(n: number): number {", DOC.typescript, "not-exported", "not exported — the sibling test file imports the unit, so add `export` or it stays untestable"],
  ["typescript", "export function log(n: number): void {", DOC.typescript, "underspecified", "returns void or has no return annotation — nothing to assert"],
  ["typescript", "export function h(a: number) {", DOC.typescript, "underspecified", "returns void or has no return annotation — nothing to assert"],
  ["typescript", "export async function widen(n: number): Promise<number> {", DOC.typescript, undefined, undefined],
  ["typescript", "export function flush(n: number): Promise<void> {", DOC.typescript, "underspecified", "resolves to `void` — awaiting it gives nothing to assert"],
  ["typescript", 'export function dump(fh: import("node:fs").WriteStream): number {', DOC.typescript, "io", "IO/network in the signature (node:fs, fs, fetch, http, https) — integration territory, not a blind unit test"],
  ["python", "def widen(n: int) -> int:", DOC.python, undefined, undefined],
  ["python", "def widen(n: int) -> int:", undefined, "underspecified", "no docstring: no contract to author a blind test from"],
  ["python", "def _helper(n: int) -> int:", DOC.python, undefined, undefined],
  ["python", "def widen(n: int) -> None:", DOC.python, "underspecified", "no return annotation, or `-> None`: nothing to assert on"],
  ["python", "def widen(n):", DOC.python, "underspecified", "no return annotation, or `-> None`: nothing to assert on"],
  ["python", "async def widen(n: int) -> int:", DOC.python, "async", "async def, and this project's interpreter has neither pytest-asyncio nor anyio, so pytest would collect the test and skip it. This gesture never installs a package."],
  ["python", "def read_all(p: Path) -> str:", DOC.python, "io", "IO/network in the signature (open, Path, socket, requests): integration territory, not a blind unit test"],
  ["csharp", "public static int Widen(int n)", DOC.csharp, undefined, undefined],
  ["csharp", "public static int Widen(int n)", undefined, "underspecified", "no `///` doc comment: no contract to author a blind test from"],
  ["csharp", "private static int Widen(int n)", DOC.csharp, "not-exported", "the test project reaches this method through an assembly reference, and `private` is not visible outside its own type. Make it `public`."],
  ["csharp", "internal static int Widen(int n)", DOC.csharp, "not-exported", 'the test project reaches this method through an assembly reference, and `internal` is not visible across assemblies. Make it `public`, or add `[assembly: InternalsVisibleTo("<your test project>")]` to this project.'],
  ["csharp", "public static void Apply(int n)", DOC.csharp, "underspecified", "returns `void`: nothing to assert on"],
  ["csharp", "public static async Task<int> WidenAsync(int n)", DOC.csharp, undefined, undefined],
  ["csharp", "public static async void FireAndForget(int n)", DOC.csharp, "async", "async void: it cannot be awaited, so a test that calls it observes nothing"],
  ["csharp", "public static string Dump(System.IO.Stream s)", DOC.csharp, "io", "IO/network in the signature (Stream, File, HttpClient, Socket, DbConnection): integration territory, not a blind unit test"],
];

gtest("[P6 §3] with the flag ABSENT, every non-member row keeps its exact REASON - 40 signatures across five languages, and this phase must move none of them", () => {
  const bad = [];
  for (const [id, sig, doc, reason] of PINNED) {
    const v = LANG(id).classifyTestability(sig, doc, undefined);
    if (v.reason !== reason) bad.push(`${id} ${JSON.stringify(sig)} doc=${doc ? "yes" : "no"}: expected ${JSON.stringify(reason)}, got ${JSON.stringify(v)}`);
  }
  assert.deepStrictEqual(bad, [], `P6 rule 3 says absent is today's behaviour exactly:\n${bad.join("\n")}`);
});

gtest("[P6 §3] with the flag ABSENT, every non-member row keeps its exact DETAIL SENTENCE - the detail is what the human reads, so a change to one has to be visible rather than silent", () => {
  const bad = [];
  for (const [id, sig, doc, , detail] of PINNED) {
    const v = LANG(id).classifyTestability(sig, doc, undefined);
    if (v.detail !== detail) bad.push(`${id} ${JSON.stringify(sig)} doc=${doc ? "yes" : "no"}\n  expected ${JSON.stringify(detail)}\n  got      ${JSON.stringify(v.detail)}`);
  }
  assert.deepStrictEqual(bad, [], `a refusal sentence moved under the human:\n${bad.join("\n")}`);
});

gtest("[P6 §2 + §3] the SAME 40 rows are unchanged with the flag SET as well - none of them is a member, so none of them has a fixture rung for the flag to skip", () => {
  const bad = [];
  for (const [id, sig, doc, reason, detail] of PINNED) {
    const v = LANG(id).classifyTestability(sig, doc, ON);
    if (v.reason !== reason || v.detail !== detail) {
      bad.push(`${id} ${JSON.stringify(sig)} doc=${doc ? "yes" : "no"}: ${JSON.stringify({ reason, detail })} became ${JSON.stringify(v)}`);
    }
  }
  assert.deepStrictEqual(bad, [], `the flag reached past the fixture rung and moved a non-member:\n${bad.join("\n")}`);
});

// ===========================================================================
// 5. Rule 1 + rule 14: the classifier stays pure and total under the new flag.
// ===========================================================================

const FS_SYNC = ["readFileSync", "existsSync", "readdirSync", "statSync", "lstatSync", "openSync"];
const CP_SYNC = ["execFileSync", "spawnSync", "execSync"];

function withWorldBlocked(fn) {
  const saved = [];
  const block = (obj, keys, kind) => {
    for (const k of keys) {
      if (typeof obj[k] !== "function") continue;
      saved.push([obj, k, obj[k]]);
      obj[k] = (...a) => {
        throw new Error(`classifyTestability touched the world: ${kind}.${k}(${JSON.stringify(a[0])})`);
      };
    }
  };
  block(fs, FS_SYNC, "fs");
  block(cp, CP_SYNC, "child_process");
  try {
    return fn();
  } finally {
    for (const [obj, k, orig] of saved) obj[k] = orig;
  }
}

gtest("[P6 §1] with the flag SET the classifier still reads NO filesystem and spawns NOTHING - rule 1 forbids a provider call inside classifyTestability, and the receiver fact arrives on the ctx like every other project fact", () => {
  const langs = Object.fromEntries(IDS.map((id) => [id, LANG(id)]));
  withWorldBlocked(() => {
    for (const [id, member] of ALL_MEMBER_ROWS) {
      const v = langs[id].classifyTestability(member, DOC[id], ON);
      assert.ok(v && typeof v === "object", `${id} ${JSON.stringify(member)}: no verdict with the world blocked`);
    }
  });
});

gtest("[P6 §14] classifyTestability is PURE under the new flag - the same arguments twice give the same verdict, every member shape, every flag spelling", () => {
  for (const [id, member, twin] of ALL_MEMBER_ROWS) {
    const lang = LANG(id);
    for (const sig of [member, twin]) {
      for (const doc of [DOC[id], undefined]) {
        for (const ctx of [undefined, ON, OFF]) {
          const a = lang.classifyTestability(sig, doc, ctx);
          const b = lang.classifyTestability(sig, doc, ctx);
          assert.deepStrictEqual(
            b,
            a,
            `${id} ${JSON.stringify(sig)} ctx=${JSON.stringify(ctx)}: two identical calls disagreed, ${JSON.stringify(a)} then ${JSON.stringify(b)}`
          );
        }
      }
    }
  }
});

gtest("[P6 §14] classifyTestability is TOTAL under the new flag - nonsense signatures, nonsense flag values and a junk ctx all return a verdict rather than throwing", () => {
  const junk = ["", "   ", "self", "&self", "pub fn", "func (", "def (self", "public", "()", "🌀 &self ∅", "(w *Widget)"];
  const ctxs = [
    ON,
    OFF,
    { receiverConstructible: "yes" },
    { receiverConstructible: null },
    { receiverConstructible: 1 },
    { receiverConstructible: {} },
    { receiverConstructible: true, junk: Symbol("x") },
    null,
    "not an object",
    7,
  ];
  for (const id of IDS) {
    const lang = LANG(id);
    for (const sig of junk.concat(ALL_MEMBER_ROWS.filter((r) => r[0] === id).map((r) => r[1]))) {
      for (const ctx of ctxs) {
        let v;
        assert.doesNotThrow(() => {
          v = lang.classifyTestability(sig, undefined, ctx);
        }, `${id}: classifyTestability threw on ${JSON.stringify(sig)} with ctx ${JSON.stringify(String(ctx))}`);
        assert.ok(v && typeof v === "object", `${id}: ${JSON.stringify(sig)} returned ${JSON.stringify(v)}`);
      }
    }
  }
});

gtest("[P6 §14] a NON-BOOLEAN receiverConstructible does not grant the receiver - only the flag being true may skip the rung, so a truthy string or a 1 must leave the honest refusal standing", () => {
  const bad = [];
  for (const [id, member] of MEMBERS.value) {
    const lang = LANG(id);
    for (const ctx of [{ receiverConstructible: "true" }, { receiverConstructible: 1 }, { receiverConstructible: {} }]) {
      const v = lang.classifyTestability(member, DOC[id], ctx);
      if (v.reason !== "needs-fixture") bad.push(`${id} ${JSON.stringify(member)} ctx=${JSON.stringify(ctx)} -> ${JSON.stringify(v)}`);
    }
  }
  assert.deepStrictEqual(
    bad,
    [],
    `a non-boolean value skipped the fixture rung. The gate passes a real boolean, so anything else arriving here is a caller with a bug and the honest refusal is the safe answer:\n${bad.join("\n")}`
  );
});

// ===========================================================================
// 6. Out of reach from a core bundle. Rules 4, 5, 6, 7 and properties 9, 10
//    are the GATE and the PROMPT. Named here so the coverage gap is a written
//    line rather than an absence, and left skipped rather than reached for
//    through an invented import path.
// ===========================================================================

test.skip("[P6 §4] Go's receiver rung is reachable the same way and its signature names the receiver's type outright, so the type name is free - NEEDS A VS CODE-TIER TEST: the type name is consumed by the gate in src/vscode/fnGen.ts, not by the classifier, and a core bundle cannot see the gate", () => {});

test.skip("[P6 §5] a refusal NAMES the type: 'no way to construct a `Widget` was found in its surface' - NEEDS A VS CODE-TIER TEST: this sentence is written by the gate after a real pre-fill resolves the enclosing type's surface", () => {});

test.skip("[P6 §6] nothing is constructed by the product: it admits a target and hands the model a surface containing a producer - NEEDS A VS CODE-TIER TEST, and arguably a dogfood capture: 'the product wrote no construction' is a property of what the gesture emits", () => {});

test.skip("[P6 §7] the prompt is told it must construct the receiver from the collaborator surface and never mock it - NEEDS A PROMPT-TIER TEST: the clause lives in the assembled prompt, and asserting it here would mean guessing a private import path", () => {});

test.skip("[P6 §9] a member whose surface carries NO producer is refused and the detail names `Widget` - NEEDS A VS CODE-TIER TEST: it is step 6 of the cost rule, and it needs a resolved surface the core bundle cannot produce", () => {});

test.skip("[P6 §10] a member with NO doc comment is refused as `needs-fixture` and THE SURFACE IS NEVER RESOLVED - NEEDS A VS CODE-TIER TEST with a counting spy on the pre-fill. This is the cost rule's most important row: the classifier half is green above, but 'never resolved' is a claim about a call that must not happen, and only the gate can be watched for it", () => {});
