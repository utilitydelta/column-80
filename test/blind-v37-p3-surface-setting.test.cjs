// SUPERSEDED IN FULL by session-v48 phase 1, the context dial.
// Register entry: docs/supersessions.md.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE USED TO BE
//
// The blind contract oracle for session-v37 item 2b, "the injection budget
// becomes a setting". It pinned `column80.injectedSurface`, a string enum of
// exactly `auto | minimal | generous` defaulting to `auto`, applied ON TOP of
// the per-language `typeCap` through `injectedTypeCap(prefillLangFor(id))`, and
// reaching the BYTE budget only - `resolveCap` and `provenanceCap` had to stay
// identical under all three values, in every language, because they spend
// language-server round trips rather than prompt bytes.
//
// ---------------------------------------------------------------------------
// WHY IT IS GONE
//
// The setting moved ONE of the four numbers that bound the injected surface,
// and session-v48's trap proof is that one is not enough. Measured against the
// shipped `walkDataShape` on a 40-wide synthetic type graph at depth 2: raising
// breadth alone 4 -> 48 with the total-type cap at 6 and the render budget at
// 200 produced a BYTE-IDENTICAL 791-char block at every rung, and so did
// breadth and the total together with the budget pinned. Only all four moving
// together moved the block, 791 -> 10648 chars. The root cap is the same story
// one stage up: more roots against an unchanged shared byte budget re-divide the
// same bytes, which session-v45 measured directly on C# (cap 4 -> 8 took
// types-that-got-a-slot 47.8% -> 92.6% and injection only 16.4% -> 20.2%).
//
// So the setting this file guarded could not, in general, change the prompt at
// all - a slider that silently does nothing, which is the exact failure class
// the project spent two sessions digging out of. `column80.injectedContext`
// replaces it: four stops, four numbers moving together, plus the two
// round-trip caps that had to move with them because a root beyond the resolve
// cap can never be injected.
//
// THE ONE DESIGN THIS FILE EXISTED TO REFUSE IS NOW THE DESIGN. Its section B
// refused "one knob driving all three caps", on the grounds that a developer who
// wanted a bigger prompt would get a slower editor without being told. The
// refusal was right about the CONSEQUENCE and wrong about the remedy: holding
// the round-trip caps still did not protect the editor, it made the byte setting
// inert, because a root that is never resolved has no surface to inject. The
// consequence is handled where it belongs now - the setting is named for the
// model class the developer is choosing, its description says in as many words
// that a higher setting means more language-server lookups and a slower first
// token, and the stops raise the round-trip caps in visible steps rather than
// silently.
//
// What replaced the contract is `test/blind-v48-p1-context-dial.test.cjs`, 54
// rows written blind against the context-dial contract. What survives here is
// the reversal, asserted rather than described.
//
// Run: SKIP_LIVE=1 node --test test/blind-v37-p3-surface-setting.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const STUB = path.join(__dirname, ".blind-v37-p3-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
module.exports = {
  Position: class { constructor(l, c) { this.line = l; this.character = c; } },
  Range: class { constructor(a, b) { this.start = a; this.end = b; } },
  Uri: { parse: (s) => ({ toString: () => String(s) }), file: (s) => ({ toString: () => String(s) }) },
  SymbolKind: { Class: 4, Struct: 22, Interface: 10, Enum: 9, Module: 1, Namespace: 2, Function: 11, Method: 5 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({
      get: (k, f) => {
        const cfg = globalThis.__V37P3_CONFIG__ || {};
        return cfg[k] !== undefined ? cfg[k] : f;
      },
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    openTextDocument: () => Promise.resolve({ getText: () => "" }),
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v37-p3.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v37-p3.bundle.cjs");
let mod;
let bundleSrc = "";
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export * as fngen from "../src/vscode/fnGen";\n` +
      `export { injectedContextStop } from "../src/vscode/config";\n` +
      `export { contextBoundsFor, INJECTED_CONTEXT_STOPS, DEFAULT_CONTEXT_STOP } from "../src/core/budgetProfile";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  bundleSrc = fs.readFileSync(OUTFILE, "utf8");
  mod = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("bundle guard: the replacement setting's resolver builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof mod.injectedContextStop, "function", "the replacement's resolver must be exported");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

const REPLACED = "column80.injectedSurface";
const REPLACEMENT = "column80.injectedContext";
const show = (v) => JSON.stringify(v);

btest("SUPERSEDED (v48 phase 1): `injectedTypeCap`, the function that applied the setting, is gone", () => {
  assert.equal(
    mod.fngen.injectedTypeCap,
    undefined,
    "the whole mechanism this file's contract described - one setting scaling one per-language cap - was " +
      "removed because it could not change the prompt on its own",
  );
});

btest("SUPERSEDED (v48 phase 1): the setting itself is out of the manifest, and its replacement is in", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const props = (pkg.contributes && pkg.contributes.configuration && pkg.contributes.configuration.properties) || {};
  assert.ok(Object.keys(props).length > 5, `CONTROL - the manifest must have real settings to scan`);
  assert.ok(!(REPLACED in props), `${REPLACED} is still declared: ${show(props[REPLACED])}`);
  const p = props[REPLACEMENT];
  assert.ok(p, `${REPLACEMENT} must take its place. injected-* keys present: ${show(Object.keys(props).filter((k) => /injected/i.test(k)))}`);
  assert.deepEqual(p.enum, ["small", "medium", "large", "frontier"]);
  assert.equal(p.default, "small");
});

btest("SUPERSEDED (v48 phase 1): a value still sitting in settings.json changes nothing, and is not read as a stop", () => {
  // The contract's promise to a user who upgrades: "their value is otherwise
  // ignored". Not "reinterpreted", which is what a resolver that fell through
  // to the old key would do.
  const before = globalThis.__V37P3_CONFIG__;
  try {
    for (const stale of ["auto", "minimal", "generous"]) {
      globalThis.__V37P3_CONFIG__ = { injectedSurface: stale, "column80.injectedSurface": stale };
      assert.equal(
        mod.injectedContextStop(),
        mod.DEFAULT_CONTEXT_STOP,
        `${show(stale)} in the old key must leave the stop at the install default, not steer it`,
      );
    }
  } finally {
    globalThis.__V37P3_CONFIG__ = before;
  }
});

btest("SUPERSEDED (v48 phase 1): the user is TOLD, once, rather than left with a value that quietly stopped mattering", () => {
  const before = globalThis.__V37P3_CONFIG__;
  try {
    globalThis.__V37P3_CONFIG__ = { injectedSurface: "generous", injectedContext: "large" };
    const logs = [];
    assert.equal(mod.injectedContextStop((l) => logs.push(String(l))), "large");
    const named = logs.filter((l) => l.includes("injectedSurface") && l.includes("injectedContext"));
    assert.equal(named.length, 1, `exactly one line naming the replacement; got ${show(logs)}`);
  } finally {
    globalThis.__V37P3_CONFIG__ = before;
  }
});

btest("KEPT: no setting exposes a latency cap or a per-language split", () => {
  // The v37 F3 row, and it still holds for the right reason. The dial DOES move
  // the two round-trip caps - holding them still is what made the old setting
  // inert - but it moves them as part of one named choice about the model, not
  // as knobs. Nobody is asked how many `definition()` calls they want, and
  // nobody is asked to know that Rust names 20.1 candidate types per function
  // where C# names 1.7.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const keys = Object.keys((pkg.contributes && pkg.contributes.configuration && pkg.contributes.configuration.properties) || {});
  for (const k of keys) {
    assert.ok(!/resolveCap|provenanceCap|typeCap|lookup/i.test(k), `${k} exposes a latency cap`);
    assert.ok(!/(rust|typescript|csharp|python|go)/i.test(k.replace(/^column80\./, "")) || /Model|Provider|Languages/.test(k), `${k} exposes a per-language budget`);
  }
});

btest("SUPERSEDED (v48 phase 1): the old three values are not a code path any more", () => {
  assert.ok(!/\bminimal\b/.test(bundleSrc) || !/\bgenerous\b/.test(bundleSrc), "the auto/minimal/generous ladder is gone from the bundle");
  assert.deepEqual([...mod.INJECTED_CONTEXT_STOPS], ["small", "medium", "large", "frontier"]);
});
