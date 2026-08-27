// Adversarial review: session-v58 phase 5, the cancel affordance
// (src/vscode/inFlight.ts, the four claim sites in src/vscode/fnGen.ts, and
// the `column80.cancelGeneration` contribution).
//
// Written AFTER the implementation and after the blind oracle
// (test/blind-v58-p5-cancel-affordance.test.cjs, 29 rows green). Its job is
// the opposite of the oracle's: every row here is an attempt to break the
// thing, and a row that stays green is a claim of CLEAN, not decoration.
//
// WHAT THE ORACLE COULD NOT REACH, AND WHY THIS FILE EXISTS
//
//   * The oracle deliberately never names the seam - it reaches the registry
//     only through `activate` and a command id. So `InFlightRegistry` and
//     `isCancellation` have never been called directly, and their edges
//     (double release, a claim released after dispose, a host with half a
//     status bar, an error a server could forge) have never been driven.
//     Parts 1 and 2 import the leaf and hit those edges head on.
//   * The oracle drives two of the four claim sites (generate, generate
//     tests). It source-pins the other two. Site 2 - the anti-punt RETRY - is
//     drivable and had never been driven; part 3 drives it.
//   * Site 4, the spawned test run, is not drivable here for the reason the
//     oracle gives (`runFrameworkTestsAt` takes no injection seam). What CAN
//     be driven is the predicate its new guard turns on, against errors
//     captured from REAL spawns rather than hand-built ones. Part 2 does that.
//
// Run: node --test test/adversarial-v58-p5.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const { ACTIVATION_STUB_SOURCE } = require("./.activation-stub.cjs");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scratch = [];
test.after(() => {
  for (const f of scratch) fs.rmSync(f, { force: true, recursive: true });
});

// ---------------------------------------------------------------------------
// Bundling the leaf against a chosen `vscode`. `inFlight.ts` imports `vscode`
// and nothing of ours, so a three-line stub is a whole host - which is what
// lets the host-shape rows below exist at all.
// ---------------------------------------------------------------------------

function bundleLeaf(tag, stubSource) {
  const stub = path.join(__dirname, `.adv-v58p5-${tag}.stub.cjs`);
  const entry = path.join(__dirname, `.adv-v58p5-${tag}.entry.ts`);
  const outfile = path.join(__dirname, `.adv-v58p5-${tag}.bundle.cjs`);
  scratch.push(stub, entry, outfile);
  fs.writeFileSync(stub, stubSource);
  fs.writeFileSync(
    entry,
    `export { InFlightRegistry, CANCEL_COMMAND, isCancellation } from "../src/vscode/inFlight";
export { __probe } from "vscode";
`,
  );
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    alias: { vscode: stub },
  });
  return require(outfile);
}

/** A recording status-bar item: everything the real one carries plus a call log. */
const RECORDING_ITEM = `
function makeItem(alignment, priority) {
  return {
    alignment, priority,
    text: "", tooltip: undefined, command: undefined, name: undefined,
    calls: [],
    show() { this.calls.push("show"); },
    hide() { this.calls.push("hide"); },
    dispose() { this.calls.push("dispose"); },
  };
}
`;

// A FULL host: everything render() touches.
const FULL = bundleLeaf(
  "full",
  `${RECORDING_ITEM}
class MarkdownString { constructor(v) { this.value = v === undefined ? "" : String(v); } }
const created = [];
module.exports = {
  MarkdownString,
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: { createStatusBarItem: (a, b) => { const i = makeItem(a, b); created.push(i); return i; } },
  __probe: { created, makeItem },
};
`,
);

// A BARE host: no status bar at all. The shape the defensive constructor was
// added for, and the shape fourteen private test stubs actually have.
const BARE = bundleLeaf(
  "bare",
  `${RECORDING_ITEM}
class MarkdownString { constructor(v) { this.value = v === undefined ? "" : String(v); } }
module.exports = { MarkdownString, window: {}, __probe: { makeItem } };
`,
);

// A HALF host: it HAS createStatusBarItem and StatusBarAlignment - so the
// constructor's guard passes and an item is made - and it has no
// MarkdownString, which render() reaches for a line later.
const HALF = bundleLeaf(
  "half",
  `${RECORDING_ITEM}
const created = [];
module.exports = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: { createStatusBarItem: (a, b) => { const i = makeItem(a, b); created.push(i); return i; } },
  __probe: { created, makeItem },
};
`,
);

const { InFlightRegistry, CANCEL_COMMAND, isCancellation } = FULL;

/** A registry over a fresh recording item, plus the log it writes. */
function reg(mod = FULL) {
  const lines = [];
  const item = mod.__probe.makeItem(2, 100);
  return { r: new mod.InFlightRegistry((l) => lines.push(String(l)), item), item, lines };
}
const visible = (item) => item.calls.filter((c) => c !== "dispose").pop() === "show";

// ===========================================================================
// PART 0 - the manifest and the source, no bundle needed.
// ===========================================================================

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const FNGEN_SRC = fs.readFileSync(path.join(ROOT, "src", "vscode", "fnGen.ts"), "utf8");

test("CLEAN A0: the manifest's command id is CANCEL_COMMAND itself, character for character", () => {
  // A drift here is a palette entry that exists and does nothing: the manifest
  // publishes one id and the code registers another. The oracle asserts both
  // against the same hardcoded literal, which cannot see a drift where the
  // literal is the thing that moved.
  const ids = pkg.contributes.commands.map((c) => c.command);
  assert.ok(
    ids.includes(CANCEL_COMMAND),
    `the code registers ${JSON.stringify(CANCEL_COMMAND)}; the manifest contributes ${JSON.stringify(ids.filter((i) => /cancel/i.test(i)))}`,
  );
});

test("CLEAN A1: no keybinding anywhere in the manifest mentions the cancel command", () => {
  // Wider than the oracle's row, which reads `contributes.keybindings` only.
  // This walks the WHOLE manifest for the id and checks nothing outside
  // `contributes.commands` claims it - a `menus` entry with a key hint, a
  // second keybindings array under a different contribution point, anything.
  const hits = [];
  const walk = (node, at) => {
    if (typeof node === "string") {
      if (node.includes(CANCEL_COMMAND)) hits.push(at);
      return;
    }
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${at}[${i}]`));
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, `${at}.${k}`);
    }
  };
  walk(pkg, "$");
  // INDEX-INDEPENDENT since session-v60, which added a sixth command and moved
  // this one from 19 to 20. The claim was never about the index: it is that the
  // ONLY place in the whole manifest naming the cancel command is a
  // `contributes.commands[*].command` slot, so nothing binds it to a key.
  // Pinning the literal index made an unrelated command registration look like a
  // keybinding regression.
  assert.deepStrictEqual(
    hits.map((h) => h.replace(/\[\d+\]/, "[*]")),
    ["$.contributes.commands[*].command"],
    `the v32 ruling: the cancel command is CONTRIBUTED and never BOUND. Every place the manifest names it: ${JSON.stringify(hits)}`,
  );
});

test("CLEAN A2: the palette label renders as the house style, and the entry carries no extra surface", () => {
  const entry = pkg.contributes.commands.find((c) => c.command === CANCEL_COMMAND);
  assert.ok(entry, "no contribution to read");
  // VS Code renders `category: title`. Amendment A2 fixed the rendered string.
  assert.strictEqual(
    `${entry.category}: ${entry.title}`,
    "Column 80: Cancel Generation",
    `amendment A2 ruled the palette title stays clean; got ${JSON.stringify(entry)}`,
  );
  // And no `enablement`: eight sibling commands are language-gated, and a
  // cancel that is only available in a Rust editor is a cancel that vanishes
  // the moment the user clicks away from the file being generated.
  assert.strictEqual(
    entry.enablement,
    undefined,
    "the cancel command must not be language- or context-gated: the generation outlives the editor focus that started it",
  );
});

test("CLEAN A3: the extension activates on startup, so the palette entry is live before any gesture", () => {
  // A contributed command whose extension is not activated is a palette entry
  // that does nothing until something else wakes the extension. This one is
  // the recovery path for a hung generation, so it must be live.
  assert.deepStrictEqual(pkg.activationEvents, ["onStartupFinished"]);
});

test("CLEAN A4: the largest claim site returns AWAITED, which is the bug the phase already paid for", () => {
  // `return promise` inside try/finally runs the finally at the RETURN. The
  // phase hit this and fixed it with `return await`. This row is the pin that
  // stops a later tidy-up ("the await is redundant") putting it back.
  const site = FNGEN_SRC.indexOf("const claim = inFlight.begin(`Generating ${resolved.symbolName}`");
  assert.ok(site > 0, "harness: the generate site's claim must be findable");
  const body = FNGEN_SRC.slice(site, FNGEN_SRC.indexOf("claim.release();", site));
  assert.match(
    body,
    /return await service\.generate\(/,
    "a bare `return service.generate(...)` inside this try/finally releases the claim the instant the generation starts, so the item appears and vanishes in one tick",
  );
});

test("CLEAN A5: every claim site releases, and the three .finally() sites release on the SAME promise they return", () => {
  // The failure this catches: `promise.finally(release); return promise;`
  // reads identically and is fine, but `promise; return other.finally(...)`
  // or a `.finally` attached to a promise that is not returned is a strand.
  // The census moved in session-v60: `column80.runTests` takes a fifth claim and
  // releases it in a finally BLOCK, so the split is 2 and 3 rather than 1 and 3.
  // The claim this row makes is unchanged: EVERY site releases, and every
  // `.finally()` site attaches to the promise it returns.
  const claims = [...FNGEN_SRC.matchAll(/const claim = inFlight\.begin\(/g)].map((m) => m.index);
  assert.strictEqual(claims.length, 5, `all five sites take a claim; found ${claims.length}`);
  let awaited = 0;
  let chained = 0;
  for (const [i, at] of claims.entries()) {
    const chunk = FNGEN_SRC.slice(at, claims[i + 1] ?? at + 8000);
    if (/\}\s*finally\s*\{\s*\n?\s*claim\.release\(\);/.test(chunk)) awaited++;
    else if (/\.finally\(\(\) => claim\.release\(\)\)/.test(chunk)) chained++;
  }
  assert.strictEqual(awaited + chained, 5, `every site must release; ${awaited} by finally-block and ${chained} by .finally()`);
  assert.strictEqual(awaited, 2, "two sites release in a finally BLOCK (the async callbacks)");
  assert.strictEqual(chained, 3, "three release by chaining .finally() onto the promise they return");
});

// ---------------------------------------------------------------------------
// The scope rows. Neither was a bug in the code that landed; both were the
// ruling being unmet on a path the contract's scope line excluded.
//
// The first was upheld and FIXED: `generateRaw` already took a signal as its
// third parameter and an aborted round already returned undefined onto an
// `outcome("aborted")` branch that was already written, so the fix was a
// controller, a claim, a third argument and a `finally` - no new failure
// branch, and `withVerifyStatus` untouched. The row below is re-cut to the
// wiring, not the construction, for the reason triage gave: a
// `new AbortController()` anywhere in the file is satisfied by a controller
// nothing ever aborts.
//
// The second is DEFERRED, and is skipped rather than inverted.
// ---------------------------------------------------------------------------

test("CLEAN (re-cut): every model call in oracleSurface.ts is claimed AND carries the signal", () => {
  // The original row asserted `new AbortController()` appears in the file.
  // Triage was right that this is a construction pin and a construction pin is
  // green on a controller nothing aborts. Re-cut to the two facts that make a
  // call cancellable: a claim was taken before it, and its signal was passed.
  //
  // Third-argument detection is by balanced parens from the call's own open
  // paren, so the object literal's internal commas cannot be mistaken for the
  // argument separator.
  const SRC = fs.readFileSync(path.join(ROOT, "src", "vscode", "oracleSurface.ts"), "utf8");
  const CALL = "service.generateRaw(";
  const sites = [];
  for (let at = SRC.indexOf(CALL); at >= 0; at = SRC.indexOf(CALL, at + 1)) {
    let depth = 0;
    let end = at + CALL.length - 1;
    const args = [];
    let argStart = end + 1;
    for (; end < SRC.length; end++) {
      const ch = SRC[end];
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          args.push(SRC.slice(argStart, end));
          end++;
          break;
        }
      } else if (ch === "," && depth === 1) {
        args.push(SRC.slice(argStart, end));
        argStart = end + 1;
      }
    }
    sites.push({ at, line: SRC.slice(0, at).split("\n").length, args, before: SRC.slice(Math.max(0, at - 900), at) });
  }
  assert.ok(sites.length >= 2, `harness: the repair round and the refine round both live here; found ${sites.length}`);
  for (const s of sites) {
    assert.strictEqual(
      s.args.length,
      3,
      `oracleSurface.ts:${s.line} calls generateRaw with ${s.args.length} arguments. Without the third the round takes no signal and cannot be cancelled by anything - not the command, not a notification, not a token. Args: ${JSON.stringify(s.args.map((a) => a.trim().slice(0, 40)))}`,
    );
    assert.match(
      s.args[2].trim(),
      /\.signal$/,
      `oracleSurface.ts:${s.line}'s third argument must be a controller's signal; got ${JSON.stringify(s.args[2].trim())}`,
    );
    assert.match(
      s.before,
      /inFlight\?\.begin\(/,
      `oracleSurface.ts:${s.line} passes a signal but takes no in-flight claim, so the round is abortable and nothing on screen offers to abort it - the status bar stays empty and the cancel command says "nothing in flight"`,
    );
    assert.match(
      SRC.slice(s.at, s.at + 2200),
      /claim\?\.release\(\)/,
      `oracleSurface.ts:${s.line} takes a claim it never releases`,
    );
  }
});

// DEFERRED as S58-10. Not fn-gen, so item 67's ruling
// does not reach it; wiring it means lifting the registry out of
// `registerFnGen` into `extension.ts` and threading it through `FirstRunDeps`,
// because `registerFirstRun` is a sibling call; and it carries a product call
// nobody in this loop has the allowance to make - one registry means "Cancel
// Generation" also kills a multi-gigabyte download. The scrap records two
// things to settle first: whether aborting the client fetch actually stops
// ollama's server-side pull, and that `firstRun.ts`'s own `isAbort` still
// carries the S57-3 defect.
//
// SKIPPED, not inverted: the assertion below is the one that will be true when
// S58-10 is done, and a row rewritten to assert the gap would have to be
// rewritten again to un-assert it.
test.skip("S58-10 (deferred): the model PULL still keeps its cancel inside a dismissable notification", () => {
  // The exact defect this phase exists to fix, in another file. firstRun.ts's
  // model download is a cancellable ProgressLocation.Notification wiring an
  // AbortController through the token - and nothing else. Dismiss it and the
  // cancel goes with it, and a model pull is the LONGEST thing this product
  // ever runs (tens of GB).
  //
  // C5's source pin cannot see this: it quantifies over withProgress calls in
  // fnGen.ts only, so a cancellable notification-only site in any other file
  // is invisible to it. That file-scoped quantifier is the reviewable part.
  const SRC = fs.readFileSync(path.join(ROOT, "src", "vscode", "firstRun.ts"), "utf8");
  assert.match(SRC, /cancellable:\s*true/, "harness: firstRun's pull progress is cancellable");
  assert.match(
    SRC,
    /\.begin\(/,
    "firstRun.ts's cancellable download notification takes no in-flight claim, so dismissing it leaves a multi-gigabyte pull running with no way to stop it - the same shape the phase fixed four times in fnGen.ts",
  );
});

// ===========================================================================
// PART 1 - the registry, driven directly. Edges the oracle never reached.
// ===========================================================================

test("CLEAN B1: a claim raises the item with the spinner, the label, the click target and both tooltip halves", () => {
  const { r, item } = reg();
  assert.strictEqual(visible(item), false, "an item with no claim is not shown");
  const c = r.begin("Generating walk", new AbortController());
  assert.strictEqual(visible(item), true);
  assert.match(item.text, /~spin/);
  assert.match(item.text, /Generating walk/);
  assert.strictEqual(item.command, CANCEL_COMMAND);
  const tip = String(item.tooltip && item.tooltip.value !== undefined ? item.tooltip.value : item.tooltip);
  assert.match(tip, /cancel/i);
  assert.match(tip, /bind|shortcut|keyboard/i);
  c.release();
  assert.strictEqual(visible(item), false);
  assert.strictEqual(r.count(), 0);
});

test("CLEAN B2: a double release retires ONE claim, not two", () => {
  // The stated reason the handle is idempotent: a `finally` beside an early
  // return must not be able to drop somebody else's claim.
  const { r, item } = reg();
  const a = r.begin("A", new AbortController());
  const b = r.begin("B", new AbortController());
  a.release();
  a.release();
  a.release();
  assert.strictEqual(r.count(), 1, "three releases of one handle must not evict B");
  assert.strictEqual(visible(item), true, "and the item must still be up: work is still running");
  b.release();
  assert.strictEqual(visible(item), false);
});

test("CLEAN B3: releases out of order leave the item up until the LAST one goes", () => {
  const { r, item } = reg();
  const a = r.begin("A", new AbortController());
  const b = r.begin("B", new AbortController());
  const c = r.begin("C", new AbortController());
  b.release();
  assert.strictEqual(visible(item), true);
  c.release();
  assert.strictEqual(visible(item), true);
  a.release();
  assert.strictEqual(visible(item), false);
});

test("CLEAN B4: cancelAll with nothing in flight returns 0, says one quiet line, and touches no item", () => {
  const { r, item, lines } = reg();
  const calls = item.calls.length;
  assert.strictEqual(r.cancelAll(), 0);
  assert.strictEqual(item.calls.length, calls, "nothing to cancel means nothing to redraw");
  assert.deepStrictEqual(lines, ["[cancel] nothing in flight"]);
});

test("CLEAN B5: one claim whose abort listener throws does not stop cancelAll reaching the others", async () => {
  // AbortController.abort() reports a throwing listener as an uncaught
  // exception rather than propagating it, so the loop survives. Asserted
  // rather than assumed: if it ever propagated, cancelAll would abort the
  // first claim and silently abandon the rest, which is a cancel that half
  // works and reports success.
  const { r } = reg();
  const bad = new AbortController();
  const good = new AbortController();
  const prior = process.listeners("uncaughtException").slice();
  process.removeAllListeners("uncaughtException");
  process.on("uncaughtException", () => {});
  bad.signal.addEventListener("abort", () => {
    throw new Error("a listener that throws");
  });
  r.begin("bad", bad);
  r.begin("good", good);
  let threw;
  try {
    assert.strictEqual(r.cancelAll(), 2);
    // EventTarget delivers a listener's throw as an uncaughtException on a
    // LATER turn, so the swallowing handler has to outlive the synchronous
    // body. Without this await the exception lands after the row ends and
    // node:test reports "generated asynchronous activity after the test
    // ended" - green today, a flake under load tomorrow.
    await sleep(20);
  } catch (e) {
    threw = e;
  } finally {
    process.removeAllListeners("uncaughtException");
    for (const h of prior) process.on("uncaughtException", h);
  }
  assert.strictEqual(threw, undefined, `cancelAll must not throw out to its caller; got ${threw}`);
  assert.strictEqual(good.signal.aborted, true, "the second claim must still have been aborted");
});

test("CLEAN B6: two claims behind ONE controller cancel together and still need two releases", () => {
  const { r, item } = reg();
  const shared = new AbortController();
  const a = r.begin("A", shared);
  const b = r.begin("B", shared);
  assert.strictEqual(r.cancelAll(), 2, "the count is CLAIMS, which is what the label list is drawn from");
  assert.strictEqual(shared.signal.aborted, true);
  a.release();
  assert.strictEqual(visible(item), true, "one release does not retire an item two claims are holding");
  b.release();
  assert.strictEqual(visible(item), false);
});

test("CLEAN B7: cancelAll counts a claim whose controller is ALREADY aborted", () => {
  // Honest-limit probe rather than a bug: the return value is "claims I told
  // to stop", not "work that was still alive". Nothing consumes it today (the
  // command ignores it), so the only cost is the channel line, which is worth
  // pinning before something starts trusting the number.
  const { r, lines } = reg();
  const dead = new AbortController();
  dead.abort();
  r.begin("already dead", dead);
  assert.strictEqual(r.cancelAll(), 1);
  assert.ok(
    lines.some((l) => /cancelling 1: already dead/.test(l)),
    `the channel line is the count of claims, not of live work: ${JSON.stringify(lines)}`,
  );
});

test("CLEAN B8: the item names the OLDEST claim and counts the rest", () => {
  // Under single-flight the oldest claim is the one that was just cancelled,
  // so during the overlap the headline names the DYING generation and the live
  // one hides behind "+1". Transient and self-correcting (the old claim
  // releases a beat later) and the tooltip lists both, so this is pinned as
  // behaviour rather than claimed as a defect - but it is behaviour a reader
  // of the text alone would get wrong.
  const { r, item } = reg();
  r.begin("older", new AbortController());
  r.begin("newer", new AbortController());
  assert.match(item.text, /older/);
  assert.match(item.text, /\+1/);
  assert.doesNotMatch(item.text, /newer/);
  const tip = String(item.tooltip.value);
  assert.match(tip, /older/);
  assert.match(tip, /newer/, "the tooltip is where both are named");
});

test("CLEAN B9: a host with no status bar degrades to command-only, honestly and once", () => {
  const lines = [];
  const r = new BARE.InFlightRegistry((l) => lines.push(String(l)));
  assert.deepStrictEqual(lines, ["[cancel] no status bar on this host; cancel is command-only"]);
  const ctrl = new AbortController();
  let threw;
  try {
    const c = r.begin("Generating walk", ctrl);
    assert.strictEqual(r.count(), 1, "claims are still tracked with nothing to draw");
    assert.strictEqual(r.cancelAll(), 1);
    assert.strictEqual(ctrl.signal.aborted, true, "the degradation keeps the FUNCTION: cancelAll still aborts");
    c.release();
    assert.strictEqual(r.count(), 0);
    r.dispose();
  } catch (e) {
    threw = e;
  }
  assert.strictEqual(threw, undefined, `nothing on this path may throw; got ${threw}`);
  assert.strictEqual(lines.length, 2, `the no-status-bar line is said once at construction, not per generation: ${JSON.stringify(lines)}`);
});

test("CLEAN B10: a registry with no log at all is silent, not broken", () => {
  const r = new BARE.InFlightRegistry();
  const ctrl = new AbortController();
  const c = r.begin("x", ctrl);
  assert.strictEqual(r.cancelAll(), 1);
  c.release();
  r.dispose();
  assert.strictEqual(ctrl.signal.aborted, true);
});

// THE HALF HOST. It HAS createStatusBarItem and StatusBarAlignment - so the
// constructor's guard passes and an item is made - and it has no
// MarkdownString, which the draw reaches for a line later.
//
// This shape was two red rows on the first pass: `begin` threw a TypeError out
// of every gesture's withProgress callback, killing the generation with a
// failure toast on a host that merely lacked a drawing API, AND stranding the
// claim it had already inserted. Both are closed by a try/catch over the USE
// rather than a wider typeof probe, which is the right shape: probing
// MarkdownString too would only have moved the boundary to the next API.
//
// The rows stay, re-cut to the invariant that survives the fix. There is still
// no known host with this shape - every real VS Code has all three APIs - so
// what these pin is the DEGRADATION, not a live failure.

test("CLEAN B10a: a host with a broken draw does not take the generation down with it", () => {
  const lines = [];
  const r = new HALF.InFlightRegistry((l) => lines.push(String(l)));
  assert.strictEqual(HALF.__probe.created.length, 1, "precondition: the guard passed and an item was made");
  let threw;
  try {
    r.begin("Generating walk", new AbortController());
  } catch (e) {
    threw = e;
  }
  assert.strictEqual(
    threw,
    undefined,
    `begin() is called inside every gesture's withProgress callback, so a throw here is a dead generation and a failure toast over a missing badge API. Got ${threw && threw.message}`,
  );
  assert.ok(
    lines.some((l) => /command-only/.test(l)),
    `and the degradation is stated, not silent: ${JSON.stringify(lines)}`,
  );
  assert.deepStrictEqual(
    HALF.__probe.created[0].calls.filter((c) => c === "dispose"),
    ["dispose"],
    "the item it cannot draw on is dropped, so every later render takes the no-item path",
  );
});

test("CLEAN B10b: the claim survives a failed draw - live, countable, releasable, and said once", () => {
  // The invariant that replaces the strand row. `begin` inserts into the live
  // map and THEN draws; the caller gets its handle on the way out. If the draw
  // could still throw past `begin`, that entry would be unreleasable forever -
  // count never back to 0, the item never retiring, cancelAll aborting a dead
  // controller. What must hold now: the claim is real, it can be cancelled, it
  // can be released, and the degradation line is said ONCE however many claims
  // arrive after it.
  const lines = [];
  const r = new HALF.InFlightRegistry((l) => lines.push(String(l)));
  const ctrl = new AbortController();
  const a = r.begin("first", ctrl);
  const b = r.begin("second", new AbortController());
  assert.strictEqual(r.count(), 2, "a failed draw must not lose the claims behind it");
  assert.strictEqual(r.cancelAll(), 2);
  assert.strictEqual(ctrl.signal.aborted, true, "the affordance keeps its FUNCTION on a host it cannot draw on");
  a.release();
  b.release();
  assert.strictEqual(r.count(), 0, "and every claim is releasable, so the registry returns to empty");
  assert.strictEqual(
    lines.filter((l) => /command-only/.test(l)).length,
    1,
    `the degradation is announced once, not per claim: ${JSON.stringify(lines)}`,
  );
});

test("CLEAN B11: dispose() disposes the item exactly once, even called twice", () => {
  const { r, item } = reg();
  r.dispose();
  r.dispose();
  assert.deepStrictEqual(
    item.calls.filter((c) => c === "dispose"),
    ["dispose", "dispose"],
    "harness: the registry forwards each dispose (VS Code's own item is idempotent, so this is a pass-through, not a leak)",
  );
});

test("CLEAN B12: a release that arrives after dispose still drives the disposed item", () => {
  // Honest-limit probe. The registry keeps no disposed flag, so a claim
  // released during teardown calls hide() on an item that is already gone.
  // VS Code's StatusBarItem is inert after dispose (its update() returns early
  // on `_disposed`), so this costs nothing on a real host - but it IS an
  // unguarded use-after-dispose, and it is pinned here so a future host that
  // is less forgiving shows up as this row rather than as a mystery.
  const { r, item } = reg();
  const c = r.begin("late", new AbortController());
  r.dispose();
  let threw;
  try {
    c.release();
  } catch (e) {
    threw = e;
  }
  assert.strictEqual(threw, undefined, `a late release must not throw; got ${threw}`);
  assert.deepStrictEqual(
    item.calls.slice(-2),
    ["dispose", "hide"],
    `the registry drove the item after disposing it: ${JSON.stringify(item.calls)}`,
  );
});

test("CLEAN B13: dispose() does not abort in-flight work, and that is correct here", () => {
  // Checked because the opposite would be a real leak. The registry leaves the
  // controllers alone on dispose - but `registerFnGen` pushes
  // `{ dispose: () => service.dispose() }` into the same subscription list,
  // and `FnGenService.dispose()` aborts `this.inflight`. So deactivation does
  // kill the generation; it just is not the registry's job.
  const { r } = reg();
  const ctrl = new AbortController();
  r.begin("running", ctrl);
  r.dispose();
  assert.strictEqual(ctrl.signal.aborted, false, "the registry is not the thing that stops the work");
  assert.match(
    FNGEN_SRC,
    /\{ dispose: \(\) => service\.dispose\(\) \}/,
    "and the thing that IS must still be in the same subscription list",
  );
});

test("CLEAN B14: the real (uninjected) constructor right-aligns one item and wires the command", () => {
  const before = FULL.__probe.created.length;
  const r = new FULL.InFlightRegistry(() => {});
  const made = FULL.__probe.created.slice(before);
  assert.strictEqual(made.length, 1, "exactly one item per registry");
  assert.strictEqual(made[0].alignment, 2, "right-aligned");
  assert.strictEqual(made[0].command, CANCEL_COMMAND);
  // `name` is what the "Manage status bar items" menu lists the entry under.
  // Unset, an item whose whole job is to be FOUND appears there under a
  // generic extension label. Whether the wording reads well is a screen
  // question; whether it is SET is this row's.
  assert.strictEqual(
    made[0].name,
    "Column 80 Generation",
    `the item must name itself for the status-bar visibility menu; got ${JSON.stringify(made[0].name)}`,
  );
  assert.strictEqual(visible(made[0]), false, "created hidden: nothing is in flight yet");
  r.dispose();
});

// ===========================================================================
// PART 2 - isCancellation, against errors captured from the real producers.
// ===========================================================================

/** The shape all four transports' private `abortError()` helpers construct. */
const transportAbortError = () => {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
};

/** The error a REAL spawn emits when its AbortSignal fires. Not hand-built. */
function realSpawnError(makeChild) {
  return new Promise((resolve) => {
    const child = makeChild();
    child.on("error", resolve);
    child.on("close", () => resolve(undefined));
  });
}

test("CLEAN C1: fetch's own rejection is classified as a cancellation", () => {
  assert.strictEqual(isCancellation(new DOMException("This operation was aborted", "AbortError")), true);
  const ac = new AbortController();
  ac.abort();
  assert.strictEqual(isCancellation(ac.signal.reason), true, "and so is the default abort reason");
});

test("CLEAN C2: the four transports' abortError() helpers are classified as cancellations", () => {
  assert.strictEqual(isCancellation(transportAbortError()), true);
  // Pinned against the source so a helper that stops setting `name` shows up
  // here rather than as a mystery toast on a cancel.
  for (const f of ["anthropicInstruct", "claudeCodeInstruct", "cloudInstruct", "ollama"]) {
    const src = fs.readFileSync(path.join(ROOT, "src", "core", `${f}.ts`), "utf8");
    assert.match(
      src,
      /function abortError\(\): Error \{\s*const err = new Error\("The operation was aborted"\);\s*err\.name = "AbortError";/,
      `${f}.ts's abortError must keep setting the NAME - the name is the whole signal isCancellation reads`,
    );
  }
});

test("CLEAN C3: a REAL spawned process killed by its signal is classified as a cancellation", async () => {
  const ac = new AbortController();
  const p = realSpawnError(() => {
    const c = spawn(process.execPath, ["-e", "setTimeout(()=>{},5000)"], { signal: ac.signal });
    setTimeout(() => ac.abort(), 40);
    return c;
  });
  const err = await p;
  assert.ok(err, "harness: the abort must produce an error event");
  assert.strictEqual(err.name, "AbortError", `captured: ${err && err.name}: ${err && err.message}`);
  assert.strictEqual(
    isCancellation(err),
    true,
    "this is the throw the test-RUN arm's new guard has to recognise; miss it and cancelling a run toasts \"the run could not start\"",
  );
});

test("CLEAN C4: a REAL spawn failure (no such binary) is NOT a cancellation, so it still toasts", async () => {
  const err = await realSpawnError(() =>
    spawn(path.join(os.tmpdir(), "c80-no-such-runner-binary-58p5"), ["--version"]),
  );
  assert.ok(err, "harness: a missing binary must produce an error event");
  assert.strictEqual(err.code, "ENOENT");
  assert.strictEqual(
    isCancellation(err),
    false,
    "the guard must not swallow a genuine spawn failure: the runner not being on PATH is exactly what that toast is for",
  );
});

test("CLEAN C5: a server cannot forge a cancellation through its error BODY (scrap S57-3)", () => {
  // firstRun.ts's private isAbort runs /abort/i over the whole message, so a
  // server body saying "aborted upstream" is read as the user's own action and
  // the failure disappears with no toast. The new predicate must refuse every
  // one of these.
  for (const message of [
    "aborted upstream",
    "Request aborted by the gateway",
    "upstream connection aborted after 300s",
    "AbortError: the model refused",
    "cancelled by policy",
    "the operation was aborted",
  ]) {
    assert.strictEqual(
      isCancellation(new Error(message)),
      false,
      `a server body must never be readable as a user cancellation: ${JSON.stringify(message)}`,
    );
  }
});

test("CLEAN C6: no transport ever sets an error's NAME from anything a server sent", () => {
  // The forgery the name-only check would still be open to: a transport that
  // copies a server-supplied string into `err.name`. Scanned rather than
  // assumed, because the whole safety of C5 rests on it.
  for (const f of ["anthropicInstruct", "claudeCodeInstruct", "cloudInstruct", "ollama", "fnGenService"]) {
    const src = fs.readFileSync(path.join(ROOT, "src", "core", `${f}.ts`), "utf8");
    for (const m of src.matchAll(/\.name\s*=\s*([^;\n]+);/g)) {
      assert.match(
        m[1].trim(),
        /^"[A-Za-z]+"$/,
        `${f}.ts assigns a non-literal to an error name (${m[0].trim()}), which is how a server body could forge a cancellation`,
      );
    }
  }
});

test("CLEAN C7: a non-Error rejection carrying name AbortError is NOT classified as a cancellation", () => {
  // Deliberate: the check is `instanceof Error && name`. Pinned so the
  // consequence is on the record - a transport that ever rejects with a plain
  // object would have its cancels toasted as failures.
  assert.strictEqual(isCancellation({ name: "AbortError" }), false);
  assert.strictEqual(isCancellation("AbortError"), false);
  assert.strictEqual(isCancellation(undefined), false);
  assert.strictEqual(isCancellation(null), false);
});

test("CLEAN C8: a TIMEOUT signal is not a user cancellation, and nothing on these paths uses one", () => {
  assert.strictEqual(AbortSignal.timeout(1) instanceof AbortSignal, true);
  const timeoutReason = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  assert.strictEqual(isCancellation(timeoutReason), false, "a timeout IS a failure and must keep its toast");
  // Comments stripped: ollama.ts's FIM_SILENCE doc QUOTES a rejected proposal
  // ("the queue proposed one AbortSignal.timeout"), and a row that reads prose
  // is a row that reports a design note as a code path.
  const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  for (const f of ["compilerOracle", "fnGenService", "ollama", "cloudInstruct"]) {
    const src = decomment(fs.readFileSync(path.join(ROOT, "src", "core", `${f}.ts`), "utf8"));
    assert.doesNotMatch(
      src,
      /AbortSignal\.timeout/,
      `${f}.ts uses AbortSignal.timeout, whose rejection is a TimeoutError - it would be reported as a failure, which may or may not be intended`,
    );
  }
});

// ===========================================================================
// PART 3 - drives against the REAL activate, on the composed activation stub.
//
// Same shape as the blind oracle's rig (one `activate`, then one instrumented
// `registerFnGen` over a transport this file holds), because that is the only
// honest way to reach the registry. What is different is the target: these
// rows drive the ANTI-PUNT RETRY, which is claim site 2 and which the oracle
// only source-pinned - it is the one generation arm whose claim is released by
// `.finally()` on a promise built from a function call evaluated AFTER the
// claim was taken.
// ===========================================================================

const TAG = "adv-v58p5";
const D_STUB = path.join(__dirname, `.${TAG}.stub.cjs`);
const D_ENTRY = path.join(__dirname, `.${TAG}.entry.ts`);
const D_OUT = path.join(__dirname, `.${TAG}.bundle.cjs`);
scratch.push(D_STUB, D_ENTRY, D_OUT);

const PATCH = `
const st = module.exports.__state;
st.statusBarItems = [];
st.commandRegs = [];
st.progress = [];
st.terminals = [];
st.tabHandlers = [];
class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
module.exports.TabInputTextDiff = TabInputTextDiff;
module.exports.window.createTerminal = (opts) => {
  const t = { opts, sendText() {}, show() {}, dispose() {} };
  st.terminals.push(t);
  return t;
};
module.exports.window.createStatusBarItem = (a, b, c) => {
  const item = {
    alignment: typeof a === "string" ? b : a,
    priority: typeof a === "string" ? c : b,
    text: "", tooltip: undefined, command: undefined,
    calls: [],
    show() { this.calls.push("show"); },
    hide() { this.calls.push("hide"); },
    dispose() { this.calls.push("dispose"); },
  };
  st.statusBarItems.push(item);
  return item;
};
const realRegisterCommand = module.exports.commands.registerCommand;
module.exports.commands.registerCommand = (id, fn) => {
  st.commandRegs.push({ id });
  realRegisterCommand(id, fn);
  return { dispose() {} };
};
st.tabs = [];
module.exports.window.tabGroups = {
  get all() { return st.tabs; },
  activeTabGroup: undefined,
  onDidChangeTabs: (h) => { st.tabHandlers.push(h); return { dispose() {} }; },
  close: async () => true,
};
module.exports.window.withProgress = (opts, task) => {
  const handlers = [];
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (h) => { handlers.push(h); return { dispose() {} }; },
  };
  const rec = {
    opts, token, dismissed: false, fired: false, settled: false,
    dismiss() { this.dismissed = true; },
    fireCancel() {
      if (this.dismissed) throw new Error("harness: the notification was dismissed");
      this.fired = true;
      token.isCancellationRequested = true;
      for (const h of handlers.slice()) h();
    },
  };
  st.progress.push(rec);
  rec.promise = Promise.resolve()
    .then(() => task({ report() {} }, token))
    .then((v) => { rec.settled = true; return v; }, (e) => { rec.settled = true; throw e; });
  return rec.promise;
};
`;

let D = {};
let dErr;
try {
  fs.writeFileSync(D_STUB, ACTIVATION_STUB_SOURCE + PATCH);
  fs.writeFileSync(
    D_ENTRY,
    `export { activate } from "../src/vscode/extension";
export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state, Position, Range } from "vscode";
`,
  );
  esbuild.buildSync({
    entryPoints: [D_ENTRY],
    bundle: true,
    outfile: D_OUT,
    format: "cjs",
    platform: "node",
    alias: { vscode: D_STUB },
  });
  D = require(D_OUT);
} catch (e) {
  dErr = e;
}

const WROOT = fs.mkdtempSync(path.join(os.tmpdir(), "c80-adv58p5-"));
scratch.push(WROOT);
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });
const TARGET = "walk";
const SRC =
  "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
  "export function walk(): number {\n" +
  "  return 1;\n" +
  "}\n\n";
const FSPATH = path.join(WROOT, "src", "walk.ts");
fs.writeFileSync(FSPATH, SRC);
fs.writeFileSync(
  path.join(WROOT, "package.json"),
  JSON.stringify({ name: "c80-adv58p5", version: "0.0.0", devDependencies: { vitest: "^1.0.0" } }, null, 2),
);
fs.writeFileSync(path.join(WROOT, "vitest.config.ts"), "export default {};\n");

const REMOTE = "http://ml-box.invalid:11434";
const MODEL = "qwen3-coder:480b";
const MB = 1048576;
const PROBE = { runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }), totalMemBytes: () => 61826 * MB };
const CFG = { apiBase: REMOTE, model: MODEL, fallbackModel: MODEL, maxTokens: 512, temperature: 0.2 };
const GEN = "column80.generateFunction";
const TDD_GEN = "column80.generateTests";
// A reply that PASSES the single-function trim and reads as a stub, so the
// product opens the anti-punt retry. /\bnot implemented\b/i is one of the
// high-confidence markers in src/core/punt.ts.
const PUNT = {
  text: 'export function walk(): number {\n  throw new Error("not implemented");\n}',
  ttftMs: 1,
  totalMs: 2,
  doneReason: "stop",
};
const GOOD = { text: "export function walk(): number {\n  return 2;\n}", ttftMs: 1, totalMs: 2, doneReason: "stop" };

function makeDoc() {
  const lineStarts = [0];
  for (let i = 0; i < SRC.length; i++) if (SRC[i] === "\n") lineStarts.push(i + 1);
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? SRC.length) + pos.character, SRC.length);
  return {
    languageId: "typescript",
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1,
    lineCount: SRC.split("\n").length,
    fileName: FSPATH,
    uri: { fsPath: FSPATH, path: FSPATH, scheme: "file", toString: () => `file://${FSPATH}`, with() { return this; } },
    getText: (range) => (range ? SRC.slice(offsetAt(range.start), offsetAt(range.end)) : SRC),
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new D.Position(line, offset - lineStarts[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const text = SRC.split("\n")[n] ?? "";
      const m = text.match(/\S/);
      return {
        lineNumber: n,
        text,
        range: new D.Range(n, 0, n, text.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : text.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
}

const waitFor = async (p, tries = 300) => {
  for (let i = 0; i < tries; i++) {
    if (p()) return true;
    await sleep(5);
  }
  return false;
};

/**
 * Bound a promise, and DO NOT LEAK THE TIMER.
 *
 * The defect this replaces cost 280 seconds on every gate run:
 * `Promise.race([work, sleep(280000)])` settles the instant `work` wins - so
 * the row measured 61ms - and leaves the LOSING setTimeout armed, holding the
 * Node event loop open long after every test in the file has finished. The
 * file reported `duration_ms 281486` for 1.5s of actual work, and the whole
 * gate went 68s -> 282s.
 *
 * Belt and braces: the timer is unref'd so a pending one can never hold the
 * loop open, and cleared when the race settles so it does not even sit there.
 * Any bounded wait added to this file later must go through here.
 */
function within(promise, ms) {
  let timer;
  const bound = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
    timer.unref?.();
  });
  return Promise.race([promise.then((value) => ({ value })), bound]).finally(() => clearTimeout(timer));
}

const rig = { ready: false, reason: "", channel: [], calls: [] };

async function buildRig() {
  if (dErr) {
    rig.reason = `the bundle did not build: ${dErr}`;
    return;
  }
  const st = D.__state;
  st.config = { apiBase: REMOTE, fnGenModel: MODEL, repairEnabled: true };
  st.commands = {};
  st.commandRegs = [];
  st.statusBarItems = [];
  st.messages = [];
  st.outputLines = [];
  st.progress = [];
  st.executeCalls = [];
  st.tabHandlers = [];
  st.commandHandlers = { "vscode.executeDocumentSymbolProvider": () => st.symbols };
  const doc = makeDoc();
  st.textDocuments = [doc];
  st.symbols = [
    {
      name: TARGET,
      detail: "",
      kind: 11,
      range: new D.Range(1, 0, 3, 1),
      selectionRange: new D.Range(1, 16, 1, 20),
      children: [],
    },
  ];
  rig.activateContext = {
    subscriptions: [],
    globalState: { get: () => undefined, update: async () => {} },
    workspaceState: { get: () => undefined, update: async () => {} },
    extensionUri: { fsPath: "/ext", toString: () => "file:///ext" },
    globalStorageUri: { fsPath: path.join(WROOT, ".storage") },
  };
  await D.activate(rig.activateContext);
  await sleep(250);

  const output = {
    appendLine: (l) => rig.channel.push(String(l)),
    append() {}, replace() {}, show() {}, hide() {}, clear() {}, dispose() {},
  };
  const generateFn = async (params) => {
    const call = { signal: params.signal };
    call.promise = new Promise((res, rej) => {
      call.resolve = res;
      call.reject = rej;
    });
    params.signal.addEventListener("abort", () =>
      call.reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
    );
    rig.calls.push(call);
    return call.promise;
  };
  let built;
  rig.fnGenContext = { subscriptions: [], globalStorageUri: { fsPath: path.join(WROOT, ".storage") } };
  D.registerFnGen(rig.fnGenContext, output, new D.ContextBlockStore(() => {}), {
    buildService: async (out, log) => {
      built = await D.buildFnGenService(out, log, PROBE, { listModels: async () => [MODEL] });
      try {
        built.service.dispose();
      } catch {
        /* teardown only */
      }
      built = { ...built, service: new D.FnGenService(CFG, generateFn, log) };
      return built;
    },
    listModels: async () => [MODEL],
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
  });
  if (!(await waitFor(() => typeof st.commands[GEN] === "function" && built !== undefined))) {
    rig.reason = `the instrumented gestures never registered: ${JSON.stringify(Object.keys(st.commands))}`;
    return;
  }
  const at = new D.Position(2, 4);
  const selection = new D.Range(at, at);
  selection.active = at;
  selection.anchor = at;
  st.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    options: { tabSize: 2, insertSpaces: true },
    selection,
    insertSnippet: async () => true,
    revealRange: () => {},
    edit: async (cb) => {
      cb({ replace() {}, insert() {}, delete() {} });
      return true;
    },
  };
  rig.ready = true;
}
const ready = buildRig();

const cancelItems = () =>
  (D.__state?.statusBarItems ?? []).filter((i) => {
    const c = i.command;
    return c === CANCEL_COMMAND || (c && typeof c === "object" && c.command === CANCEL_COMMAND);
  });
const shown = () => cancelItems().filter((i) => i.calls.filter((c) => c !== "dispose").pop() === "show");
const describe = () =>
  JSON.stringify((D.__state?.statusBarItems ?? []).map((i) => ({ text: i.text, calls: i.calls })));
const toasts = () => (D.__state?.messages ?? []).map((m) => ({ kind: m.kind, message: String(m.message) }));
const loudToasts = () => toasts().filter((t) => t.kind === "error" || t.kind === "warning");

function beginRow() {
  const st = D.__state;
  st.messages = [];
  st.progress = [];
  rig.channel.length = 0;
  rig.calls.length = 0;
  return st;
}
async function drain() {
  const st = D.__state;
  st.tabs = [];
  for (const h of st.tabHandlers.slice()) {
    try {
      h({ opened: [], closed: [], changed: [] });
    } catch {
      /* teardown only */
    }
  }
  await sleep(30);
}
const rtest = (name, fn) =>
  test(name, async (t) => {
    await ready;
    if (!rig.ready) assert.fail(`harness is not up: ${rig.reason}`);
    try {
      await fn(t);
    } finally {
      await drain();
    }
  });

async function startGeneration(commandId = GEN) {
  const st = D.__state;
  const before = rig.calls.length;
  const run = st.commands[commandId]();
  run.catch(() => undefined);
  const up = await waitFor(() => rig.calls.length > before, 400);
  assert.ok(up, `harness: ${commandId} never reached the transport. Channel: ${JSON.stringify(rig.channel)}`);
  return { run, call: rig.calls[rig.calls.length - 1], progress: st.progress[st.progress.length - 1] };
}

test("CLEAN D0 [harness]: the bundle builds and the real extension activates", async () => {
  await ready;
  assert.ok(!dErr, `the bundle did not build: ${dErr}`);
  assert.ok(rig.ready, rig.reason);
  assert.strictEqual(typeof D.__state.commands[CANCEL_COMMAND], "function");
});

rtest("CLEAN D1: the anti-punt RETRY raises the item too - claim site 2, never driven before", async () => {
  // Site 2 is the one the oracle could only source-pin. It is also the site
  // with the most fragile release: `begin(...)` then a promise built from
  // `assembleAntiPuntReprompt(...)`, a function call evaluated AFTER the claim
  // exists, with the release chained onto the result.
  beginRow();
  const first = await startGeneration();
  first.call.resolve(PUNT);
  const retryUp = await waitFor(() => rig.calls.length >= 2, 600);
  assert.ok(
    retryUp,
    `harness: the punt must trigger the anti-punt retry. Channel: ${JSON.stringify(rig.channel)}`,
  );
  assert.ok(
    rig.channel.some((l) => /punt detected/.test(l)),
    `harness: this row must be on the punt path: ${JSON.stringify(rig.channel)}`,
  );
  const items = shown();
  assert.ok(
    items.length >= 1,
    `C5: the retry is a live model call against a server that can hang, so it must be on the bar: ${describe()}`,
  );
  assert.match(
    items.map((i) => i.text).join(" | "),
    new RegExp(`Reworking ${TARGET}|${TARGET}`),
    `and it must name what it is doing: ${describe()}`,
  );
  rig.calls[1].resolve(GOOD);
  await sleep(150);
  assert.deepStrictEqual(shown().map((i) => i.text), [], `and it goes when the retry ends: ${describe()}`);
});

rtest("CLEAN D2: cancelling the anti-punt retry is silent and releases site 2's claim", async () => {
  // C6 on the arm the oracle never drove. Two ways this could go wrong: the
  // `.finally()` never runs (the item outlives the work), or the abort reaches
  // the "came back as a stub twice" WARNING, which would toast a diagnosis at
  // someone who just pressed cancel.
  const st = beginRow();
  const first = await startGeneration();
  first.call.resolve(PUNT);
  assert.ok(await waitFor(() => rig.calls.length >= 2, 600), "harness: the retry must start");
  assert.ok(shown().length >= 1, `precondition: the retry raised the item: ${describe()}`);
  st.messages = [];
  await st.commands[CANCEL_COMMAND]();
  assert.ok(await waitFor(() => rig.calls[1].signal.aborted, 400), "the retry must actually be aborted");
  await sleep(150);
  assert.deepStrictEqual(
    loudToasts(),
    [],
    `cancelling a retry is the user's own action: no error toast and no "came back as a stub twice" warning. Got ${JSON.stringify(toasts())}`,
  );
  assert.ok(
    rig.channel.some((l) => /aborted|cancel/i.test(l)),
    `the channel records it: ${JSON.stringify(rig.channel)}`,
  );
  assert.deepStrictEqual(shown().map((i) => i.text), [], `and site 2's claim is released: ${describe()}`);
});

rtest("CLEAN D3: the registry is not poisoned by a cancel - the next generation raises the item again", async () => {
  const st = beginRow();
  const one = await startGeneration();
  assert.ok(shown().length >= 1, `precondition: ${describe()}`);
  await st.commands[CANCEL_COMMAND]();
  await waitFor(() => one.progress.settled, 400);
  await sleep(60);
  assert.deepStrictEqual(shown().map((i) => i.text), [], `precondition: the item retired: ${describe()}`);
  const two = await startGeneration();
  assert.ok(shown().length >= 1, `a second generation after a cancel must raise the item again: ${describe()}`);
  assert.doesNotMatch(
    shown().map((i) => i.text).join(" "),
    /\+\d/,
    `and it must not carry a phantom claim from the cancelled one: ${describe()}`,
  );
  two.call.resolve(GOOD);
  await sleep(150);
  assert.deepStrictEqual(shown().map((i) => i.text), [], describe());
});

rtest("CLEAN D4: the cancel command run twice, and run again with nothing left, stays silent", async () => {
  const st = beginRow();
  const gen = await startGeneration();
  await st.commands[CANCEL_COMMAND]();
  await st.commands[CANCEL_COMMAND]();
  await st.commands[CANCEL_COMMAND]();
  await waitFor(() => gen.progress.settled, 400);
  await sleep(60);
  assert.deepStrictEqual(loudToasts(), [], `got ${JSON.stringify(toasts())}`);
  assert.deepStrictEqual(shown().map((i) => i.text), [], describe());
});

rtest("CLEAN D5: one cancel during a two-claim overlap kills both and retires the item exactly once", async () => {
  // The registry counts claims, and cancelAll snapshots them before aborting.
  // If the snapshot were the live map, an abort that synchronously released
  // its own claim would skip the next entry and leave work running with the
  // item down.
  const st = beginRow();
  const first = await startGeneration(GEN);
  const second = await startGeneration(TDD_GEN);
  assert.notStrictEqual(second.progress, first.progress, "harness: two claims overlap");
  await st.commands[CANCEL_COMMAND]();
  assert.ok(await waitFor(() => second.call.signal.aborted, 400), "the newer claim must be aborted too");
  await waitFor(() => first.progress.settled && second.progress.settled, 600);
  await sleep(80);
  assert.deepStrictEqual(loudToasts(), [], `no arm may toast on a cancel; got ${JSON.stringify(toasts())}`);
  assert.deepStrictEqual(shown().map((i) => i.text), [], `and the item retires: ${describe()}`);
});

rtest("CLEAN D6: cancel reaches a generation whose notification was dismissed AND whose retry is running", async () => {
  // C4 carried one step further than the oracle takes it: the notification the
  // user dismissed was the FIRST one, and the thing still running is the retry
  // behind a SECOND notification they never saw appear.
  const st = beginRow();
  const first = await startGeneration();
  first.progress.dismiss();
  first.call.resolve(PUNT);
  assert.ok(await waitFor(() => rig.calls.length >= 2, 600), "harness: the retry must start");
  const retryProgress = st.progress[st.progress.length - 1];
  retryProgress.dismiss();
  assert.ok(shown().length >= 1, `the item is the only thing left on screen: ${describe()}`);
  await st.commands[CANCEL_COMMAND]();
  assert.ok(await waitFor(() => rig.calls[1].signal.aborted, 400), "and it is the only way to stop the retry");
  assert.strictEqual(retryProgress.fired, false, "the cancel did not travel through the dismissed notification");
  await sleep(150);
  assert.deepStrictEqual(loudToasts(), [], `got ${JSON.stringify(toasts())}`);
  assert.deepStrictEqual(shown().map((i) => i.text), [], describe());
});

test("CLEAN A6: the command id has exactly one source of truth in shipped material", async () => {
  // A drifted literal is the failure this closes: the manifest says one id,
  // `fnGen.ts` registers another, and the palette entry is dead. Shipped
  // material must name the id in exactly two places - the manifest, and the
  // constant. `fnGen.ts` must not spell it out at all.
  // A filesystem walk, not `git grep`: inFlight.ts is untracked in the working
  // tree this reviews, and a grep that cannot see the file under review would
  // pass by missing it.
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && fs.readFileSync(p, "utf8").includes("column80.cancelGeneration")) {
        out.push(path.relative(ROOT, p));
      }
    }
  };
  walk(path.join(ROOT, "src"));
  if (fs.readFileSync(path.join(ROOT, "package.json"), "utf8").includes("column80.cancelGeneration")) {
    out.push("package.json");
  }
  out.sort();
  assert.deepStrictEqual(
    out,
    ["package.json", "src/vscode/inFlight.ts"],
    "the id belongs in the manifest and in CANCEL_COMMAND, nowhere else - a second literal is a drift waiting to happen",
  );
});

rtest("CLEAN D7: activation makes exactly ONE registry, and production has exactly one caller", async () => {
  // The rig deliberately registers fn-gen a second time, so two items exist
  // here. That is a test shape, and the row that makes it safe is the second
  // assertion: `extension.ts` calls `registerFnGen` once, so a shipped VS Code
  // has one registry, one item, and one command registration pointing at it.
  const src = fs.readFileSync(path.join(ROOT, "src", "vscode", "extension.ts"), "utf8");
  const callers = [...src.matchAll(/(?<!export function )\bregisterFnGen\(/g)].length;
  assert.strictEqual(callers, 1, `production must construct exactly one registry; extension.ts calls registerFnGen ${callers} times`);
  const regs = (D.__state.commandRegs ?? []).filter((r) => r.id === CANCEL_COMMAND).length;
  assert.strictEqual(
    regs,
    2,
    `harness: this rig registers twice on purpose (activate, then the instrumented pass); saw ${regs}`,
  );
  assert.ok(
    cancelItems().length >= 1,
    `and each registry owns its own item, all wired to the cancel command: ${describe()}`,
  );
});

// ===========================================================================
// PART 4 - the repair/refine claim, DRIVEN. Added after triage upheld the
// scope finding and the wiring landed.
//
// The re-cut source pin above says the claim and the signal are both there.
// This says they WORK, which a source pin cannot: a real `runPostAcceptOracle`
// session over a real cargo check, a fake transport that answers only when the
// signal fires, and the REAL `InFlightRegistry` over a recording item as
// `ctx.inFlight` - the interface is structural, so nothing is faked at the
// seam under test.
//
// The refine round is the one driven, because it is the DIRECT user gesture
// and it needs only a clean crate; the repair round shares the same four lines
// (controller, claim, third argument, finally) and the same pin above.
//
// Harness shape copied from test/impl-v29-p4-refine-flow.test.cjs, which is
// the proven way to reach this code path headlessly.
// ===========================================================================

const O_STUB = path.join(__dirname, `.${TAG}-oracle.stub.cjs`);
const O_ENTRY = path.join(__dirname, `.${TAG}-oracle.entry.ts`);
const O_OUT = path.join(__dirname, `.${TAG}-oracle.bundle.cjs`);
scratch.push(O_STUB, O_ENTRY, O_OUT);

let O = {};
let oErr;
try {
  fs.writeFileSync(
    O_STUB,
    `
const state = (globalThis.__advv58p5 = globalThis.__advv58p5 || { messages: [] });
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor(v) { this.value = v === undefined ? "" : String(v); this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  workspace: {
    getConfiguration: () => ({ get: (k, fb) => fb, inspect: () => undefined, update: async () => {} }),
    get textDocuments() { return []; },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    showErrorMessage: async (message) => { state.messages.push({ kind: "error", message }); },
    showWarningMessage: async (message) => { state.messages.push({ kind: "warn", message }); },
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); },
    setStatusBarMessage: (message) => { state.messages.push({ kind: "status", message }); return { dispose() {} }; },
  },
  commands: { executeCommand: async () => undefined },
};
`,
  );
  fs.writeFileSync(
    O_ENTRY,
    `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";
export { FnGenService } from "../src/core/fnGenService";
`,
  );
  esbuild.buildSync({
    entryPoints: [O_ENTRY],
    bundle: true,
    outfile: O_OUT,
    format: "cjs",
    platform: "node",
    alias: { vscode: O_STUB },
  });
  O = require(O_OUT);
} catch (e) {
  oErr = e;
}

const REPAIRBENCH = path.join(__dirname, "fixtures", "repairbench");
/** How long the refine round gets to reach the fake transport. See the note at
 *  the wait: the measured cost is ~60ms, cargo check included. */
const REFINE_BUDGET_MS = 15000;

const oracleDocument = (file) => ({
  languageId: "rust",
  isDirty: false,
  isClosed: false,
  version: 1,
  uri: { fsPath: file, path: file, scheme: "file", toString: () => "file://" + file },
  getText(range) {
    const t = fs.readFileSync(file, "utf8");
    return range ? t.slice(range.start.offset, range.end.offset) : t;
  },
  positionAt(offset) {
    const t = fs.readFileSync(file, "utf8");
    const before = t.slice(0, offset);
    return { offset, line: before.split("\n").length - 1, character: offset - before.lastIndexOf("\n") - 1 };
  },
  lineAt(line) {
    const t = fs.readFileSync(file, "utf8").split("\n")[line] ?? "";
    return { text: t, range: { start: { line, character: 0 }, end: { line, character: t.length } } };
  },
  save: async () => true,
});

const oracleResolver = (fnName) => async (document) => {
  const t = document.getText();
  const start = t.indexOf(`pub fn ${fnName}`);
  if (start < 0) return undefined;
  const end = t.indexOf("\n}", start) + 2;
  return {
    span: { start, end },
    signature: t.slice(start, t.indexOf("{", start)).trimEnd(),
    docComment: undefined,
    symbolName: fnName,
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "",
  };
};

test(
  "CLEAN E1 (driven): a hung refine round is on the bar, and cancelAll stops it - no toast, claim released",
  // Comfortably above the 15s internal budget and nowhere near the old 300s:
  // a row that hangs should fail as one row, not read as a hung suite.
  { timeout: 60000 },
  async () => {
    // What the source pin above cannot say. Everything here is real except the
    // transport and the status-bar item: a real cargo check, the real session
    // loop, the real registry, the real render.
    assert.ok(!oErr, `the oracle bundle did not build: ${oErr}`);
    const crate = fs.mkdtempSync(path.join(os.tmpdir(), "c80-adv58p5-oracle-"));
    scratch.push(crate);
    fs.cpSync(REPAIRBENCH, crate, { recursive: true });
    const file = path.join(crate, "src", "task1.rs");
    const t = fs.readFileSync(file, "utf8");
    const start = t.indexOf("pub fn parse_duration");
    const end = t.indexOf("\n}", start) + 2;

    // A transport that answers ONLY when the signal fires - a hung server.
    let atModel;
    const reached = new Promise((r) => (atModel = r));
    const service = new O.FnGenService(
      { apiBase: "http://ml-box.invalid:1", model: "hung-30b", fallbackModel: "x", maxTokens: 512, temperature: 0.2 },
      ({ signal }) =>
        new Promise((_res, rej) => {
          atModel();
          signal.addEventListener("abort", () =>
            rej(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
          );
        }),
    );

    // THE REAL REGISTRY, over a recording item. `PostAcceptContext.inFlight` is
    // a structural `{ begin(label, controller) }`, so this is the shipped class
    // and the shipped render, not a stand-in for them.
    const logLines = [];
    const item = FULL.__probe.makeItem(2, 100);
    const registry = new FULL.InFlightRegistry((l) => logLines.push(String(l)), item);

    const channel = [];
    const state = globalThis.__advv58p5;
    state.messages.length = 0;

    const session = O.runPostAcceptOracle({
      document: oracleDocument(file),
      landedSpan: { start, end },
      source: "fngen",
      service,
      inFlight: registry,
      output: { appendLine: (l) => channel.push(String(l)) },
      presenter: { present: async () => "reject" },
      resolveFunction: oracleResolver("parse_duration"),
      repairTierGate: { allowed: true },
      manualRefine: true,
      // The reference leg has to answer with a hit somewhere else in the
      // crate, or the refine finds no usage to inject and spends no round -
      // and a round that never happens cannot be cancelled. Same stub shape as
      // test/impl-v29-p4-refine-flow.test.cjs.
      extractor: {
        completeMembers: async () => [],
        example: async () => undefined,
        membersOfType: async () => [],
        references: async () => [
          {
            uri: "file://" + path.join(crate, "src", "lib.rs"),
            line: 2,
            character: 4,
            endLine: 2,
            endCharacter: 8,
          },
        ],
      },
    });
    session.catch(() => undefined);

    // The cargo check runs first; the model call is behind it. MEASURED: a
    // cold `cargo check` on a fresh copy of this fixture is ~50ms - repairbench
    // has no dependencies and fifteen small files - and the whole row is ~60ms.
    // So the budget is 250x the observed cost and still small enough that a
    // genuinely hung row fails as one test instead of reading like a hung
    // suite. The old 280s was longer than the entire gate.
    const arrived = await within(reached, REFINE_BUDGET_MS);
    assert.ok(
      !arrived.timedOut,
      `the refine round did not reach the transport within ${REFINE_BUDGET_MS}ms. Channel: ${JSON.stringify(channel)}`,
    );
    assert.ok(await waitFor(() => registry.count() > 0, 200), "the round must have taken a claim");

    assert.strictEqual(visible(item), true, `the hung refine must be ON THE BAR: ${JSON.stringify(item)}`);
    assert.match(item.text, /~spin/, `and spinning: ${JSON.stringify(item.text)}`);
    assert.match(
      item.text,
      /parse_duration/,
      `and naming what it is doing, so the user knows what they are about to cancel: ${JSON.stringify(item.text)}`,
    );
    assert.strictEqual(item.command, CANCEL_COMMAND, "and one click from the cancel command");

    assert.strictEqual(registry.cancelAll(), 1, "cancelAll must find the round");
    await waitFor(() => registry.count() === 0, 400);

    assert.strictEqual(
      registry.count(),
      0,
      `the claim must be released when the round unwinds; the item would otherwise outlive the work: ${JSON.stringify(item)}`,
    );
    assert.strictEqual(visible(item), false, `and the item goes with it: ${JSON.stringify(item.calls)}`);
    assert.ok(
      channel.some((l) => /aborted/.test(l)),
      `the channel records the cancellation rather than a failure: ${JSON.stringify(channel.slice(-8))}`,
    );
    assert.ok(
      !channel.some((l) => /refine outcome round=\d+ result=failed/.test(l)),
      `a cancel is not a failed round: ${JSON.stringify(channel.slice(-8))}`,
    );
    assert.deepStrictEqual(
      state.messages.filter((m) => m.kind === "error" || m.kind === "warn"),
      [],
      `and cancelling toasts nothing: ${JSON.stringify(state.messages)}`,
    );
    await session;
  },
);
