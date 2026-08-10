// BLIND ORACLE — v11 (Python) contract for the Python member-site detector
// `pyMemberSite` and the `memberSiteFor(languageId)` registry (the
// `wholeBlockSiteFor` analog). Written from the phase-3 brief + goal ONLY; the
// implementation (src/core/fimInject.ts additions) is never opened.
//
// This is the thing that RESOLVES scrap F2: the shared C-family `fimMemberSite`
// reads a Python slice `arr[1::` as a `::` scope member site. In Rust/C# `::` is
// a real scope operator and MUST keep firing (proven here against the shared
// helper), so the fix is a Python-SPECIFIC detector, not a change to the shared
// one. `pyMemberSite` treats every `::` as non-member (Python has no `::` member
// operator; it appears only inside slices), keeps `.` after ident/call/subscript
// and f-string holes as member sites, and darkens `#` comment lines.
//
// Expected RED: pyMemberSite / memberSiteFor do not exist yet. The bundle guard
// keeps the red to one loud failure; every other case skips until the impl lands.
//
// EXPECTED EXPORT LOCATION (finding for the implementer): both `pyMemberSite` and
// `memberSiteFor` are imported from src/core/fimInject.ts — beside `fimMemberSite`
// and mirroring `wholeBlockSiteFor`'s registry shape. Re-export there if they are
// authored in pyExtraction.ts.
//
// Run: SKIP_LIVE=1 node --test test/blind-v11-pymembersite.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v11-pymembersite",
    `export { pyMemberSite, memberSiteFor, fimMemberSite } from "../src/core/fimInject";\n`,
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-v11-pymembersite.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v11-pymembersite.bundle.cjs"), { force: true });
  };
}
if (!bundleError && typeof mod.pyMemberSite !== "function") {
  bundleError = new Error("the bundle built but exports no pyMemberSite function");
}
if (!bundleError && typeof mod.memberSiteFor !== "function") {
  bundleError = new Error("the bundle built but exports no memberSiteFor registry");
}
const { pyMemberSite, memberSiteFor, fimMemberSite } = mod;

test.after(() => cleanup());

test("bundle: pyMemberSite + memberSiteFor build (Python member-site detector exists) [surface: brief (a).5 / (e) F2]", () => {
  if (bundleError) assert.fail(`the Python member-site detector is not implemented yet: ${bundleError.message}`);
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// 1. pyMemberSite — member sites: `.` after ident/call/subscript + f-string holes
// ---------------------------------------------------------------------------

const MEMBER_SITE_CASES = [
  // [name, prefix, expectedPartial]
  ["ident then dot, nothing typed", "user.", ""],
  ["ident then dot, partial typed", "user.na", "na"],
  ["ident then dot, full member typed", "user.name", "name"],
  ["dot after a call", "get_user().", ""],
  ["dot after a call, partial", "get_user().na", "na"],
  ["dot after a subscript", "items[0].", ""],
  ["dot after a SLICE subscript (closed) is still a member site", "arr[::2].", ""],
  ["dot inside f-string interpolation hole", 'f"{user.', ""],
  ["dot+partial inside f-string hole", 'f"greeting {obj.attr', "attr"],
  ["dot after chained attribute", "self.repo.", ""],
];

gtest("pyMemberSite: member sites return {partial} [surface: brief 'the . after ident/call/subscript and f-string holes are member sites']", () => {
  for (const [name, prefix, expectedPartial] of MEMBER_SITE_CASES) {
    assert.deepStrictEqual(
      pyMemberSite(prefix),
      { partial: expectedPartial },
      `[${name}] prefix=${JSON.stringify(prefix)} -> expected {partial:${JSON.stringify(expectedPartial)}}, got ${JSON.stringify(pyMemberSite(prefix))}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. pyMemberSite — dark: the F2 slice `::`, plus floats, comments, literals
// ---------------------------------------------------------------------------

const DARK_CASES = [
  // [name, prefix]
  ["F2: open slice `arr[1::`", "arr[1::"],
  ["F2: open slice `arr[::`", "arr[::"],
  ["`::` is NEVER a Python member operator (`std::`)", "std::"],
  ["`::` scope-shaped `std::string` is not a Python member site", "std::string"],
  ["fresh empty position", ""],
  ["pure whitespace", "   "],
  ["bare identifier, no trailing dot", "user"],
  ["string literal, no trailing .member", '"hello"'],
  ["numeric float `1.`", "1."],
  ["numeric float `3.14`", "3.14"],
  ["numeric float `x = 42.`", "x = 42."],
  ["double dot", "user.."],
  ["Python `#` comment line with a `.member` in it", "    # see user.name"],
  ["Python `#` comment, dotted call", "# result = obj.method()"],
];

gtest("pyMemberSite: dark positions return undefined (F2 slice `::`, floats, `#` comments) [surface: brief (e) F2 'arr[1::, arr[:: are dark']", () => {
  for (const [name, prefix] of DARK_CASES) {
    assert.strictEqual(
      pyMemberSite(prefix),
      undefined,
      `[${name}] prefix=${JSON.stringify(prefix)} -> expected undefined, got ${JSON.stringify(pyMemberSite(prefix))}`,
    );
  }
});

// The multi-line discipline: only the CURRENT line is inspected for the comment
// token (a prior comment line must not darken live code below it).
gtest("pyMemberSite: only the current line's `#` darkens (prior comment line does not) [surface: fimMemberSite current-line discipline, Python-shaped]", () => {
  assert.deepStrictEqual(
    pyMemberSite("# a note on the previous line\nuser.na"),
    { partial: "na" },
    "a `#` on a PRIOR line must not darken the current live `user.na`",
  );
  assert.strictEqual(
    pyMemberSite("user = get()\n    # note obj.attr"),
    undefined,
    "the CURRENT line starting (after trim) with `#` is dark",
  );
});

// ---------------------------------------------------------------------------
// 3. memberSiteFor("python") == the pyMemberSite contract
// ---------------------------------------------------------------------------

gtest("memberSiteFor('python') returns a detector with the pyMemberSite behavior [surface: brief (a).5 memberSiteFor registry]", () => {
  const detect = memberSiteFor("python");
  assert.strictEqual(typeof detect, "function", "memberSiteFor('python') yields a detector function");
  assert.deepStrictEqual(detect("user.na"), { partial: "na" }, "the python detector fires at a `.` site");
  assert.strictEqual(detect("arr[1::"), undefined, "the python detector darkens the F2 slice `::` (resolved)");
  assert.strictEqual(detect("std::"), undefined, "the python detector treats `::` as non-member");
  assert.strictEqual(detect("    # x.y"), undefined, "the python detector darkens a `#` comment line");
});

// ---------------------------------------------------------------------------
// 4. Language scoping — the crux of F2: `::` MUST keep firing for the C-family,
//    it is only Python where a `::` is dark. Contrast the two detectors on the
//    SAME `::` input.
// ---------------------------------------------------------------------------

gtest("scoping: the shared fimMemberSite still fires on `::` (Rust/C# scope) while pyMemberSite darkens it [surface: brief (e) 'the shared helper is NOT further parameterized — `::` MUST keep firing there']", () => {
  // The shared C-family helper: `::` is a real scope member operator -> fires.
  assert.deepStrictEqual(fimMemberSite("std::"), { partial: "" }, "shared helper: `std::` IS a member site (C-family)");
  assert.deepStrictEqual(fimMemberSite("std::string"), { partial: "string" }, "shared helper: `std::string` IS a member site");
  // The Python detector on the identical input: dark.
  assert.strictEqual(pyMemberSite("std::"), undefined, "python detector: the same `std::` is dark");
  assert.strictEqual(pyMemberSite("std::string"), undefined, "python detector: the same `std::string` is dark");
});

gtest("scoping: memberSiteFor for a C-family language keeps `::` a member site (F2 stays Python-only) [surface: brief 'shared fimMemberSite stays for Rust/TS/C#']", () => {
  for (const lang of ["rust", "csharp"]) {
    const detect = memberSiteFor(lang);
    // If the registry returns a concrete C-family detector (the wholeBlockSiteFor
    // shape), it must keep `::` firing. A registry that instead returns undefined
    // for non-python (caller falls back to fimMemberSite) is flagged as a finding.
    if (typeof detect !== "function") {
      assert.fail(
        "memberSiteFor(" + JSON.stringify(lang) + ") returned " + typeof detect + "; expected a "
          + "concrete detector mirroring wholeBlockSiteFor (which returns detectors for "
          + "rust/ts/csharp). If the design instead returns undefined and the call site "
          + "falls back to fimMemberSite, adjust this lock (finding).",
      );
    }
    assert.deepStrictEqual(
      detect("Type::"),
      { partial: "" },
      "[" + lang + "] a trailing :: must remain a member site — the F2 fix is Python-scoped, never a change to the C-family",
    );
  }
});
