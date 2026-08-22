// Blind oracle for session-v26 phase 1: the scope lifecycle machine,
// src/core/scopeLifecycle.ts. Contract source: this session's goal ("The rule
// this session ships" + the acceptance bar) and the three dogfood captures
// taken 2026-07-26. The rule under test: a scope is a loan,
// not a transfer - whatever happens to the scoped request, the product hands
// the site back to the unscoped completion.
//
// Frozen contract: implementation agents may not edit this file. Wrong-looking
// tests go back through review and triage.
//
// The module is pure and headless; time is injected through `now`, no timers.
// Readings taken where the facade underspecifies (also flagged at use sites):
// - selectedText present on onRequest means the widget is open with that row
//   highlighted; absent means no widget selection (the captures log
//   selection="clone()" vs selection=none).
// - The first selected request in a widget session is the passive preselect;
//   a later request at the same stateKey with a DIFFERENT selectedText is an
//   arrowed (active) choice, matching captures invocation 1 vs invocation 3.
// - onSecondEscape being invoked implies the widget is already closed (the
//   first Escape dismissed it), so its internal gate is scope-in-force only.
// - reached=true implies rerender=true: the re-render request is the
//   deliberate path that swaps in the unscoped run (goal.md acceptance bar,
//   "Second Escape ... always reaches the unscoped run").
//
// Run: SKIP_LIVE=1 node --test test/blind-v26-lifecycle.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v26-lifecycle",
  `export * from "../src/core/scopeLifecycle";\n`
);
test.after(cleanup);

// Opaque state keys. K is the captured site (log_segments_cache.rs 132:21,
// just after the `.` in `metadata.`); K2 is any other position.
const K = "log_segments_cache.rs:132:21#v7";
const K2 = "log_segments_cache.rs:140:9#v7";

// The whole contract is driven through these two helpers so a facade change
// is one place to update. `now` is always passed explicitly by callers.
function req(state, over) {
  return mod.onRequest(state, { stateKey: K, atMemberSite: true, ...over });
}
function serve(state, over) {
  return mod.onServe(state, over);
}

// ---- Rule 1: widget-open scoping to the highlight (flagship, stays)

test("capture inv1: widget-open passive preselect at a member site scopes to the highlighted member", () => {
  const s = mod.createScopeState();
  const r = req(s, { selectedText: "clone()", selectionIsSnippet: true, now: 1000 });
  assert.ok(r.scope, "widget open + highlighted selection scopes the request");
  // Reading: the module derives the bare member name from the snippet text,
  // "clone()" -> "clone", matching the capture line `scoped to clone`.
  assert.strictEqual(r.scope.name, "clone");
  assert.strictEqual(r.scope.text, "clone()");
  assert.strictEqual(r.scope.snippet, true);
});

test("capture inv3: arrowing to another row re-scopes the request to the arrowed member", () => {
  const s = mod.createScopeState();
  req(s, { selectedText: "clone()", selectionIsSnippet: true, now: 1000 });
  const r = req(s, { selectedText: "log_id", selectionIsSnippet: false, now: 1200 });
  assert.ok(r.scope, "a deliberate arrow scopes the request");
  assert.strictEqual(r.scope.name, "log_id");
  assert.strictEqual(r.scope.snippet, false);
});

// ---- Rule 2 (capture A/B): the never-served record drops immediately

// Rewritten under TRIAGE authority 2026-07-26, triage-p1.md, goal.md
// amendment: the scoped attempt gets its one post-close serve. The original
// row pinned the drop at the first post-close REQUEST, which review-p1.md
// proved forecloses the v20 window for every snippet member (their widget-open
// serve is structurally zero on rust-analyzer and gopls). The drop decision
// now lives at that attempt's serve: zero items means drop plus an actively
// requested unscoped re-render (`rerender: true`); the key means
// scope-in-force, widget-closed gating delegated to the keybinding's
// `!suggestWidgetVisible`.
test("capture A/B: the never-served passive record holds for its one post-close attempt; the zero serve drops it and requests the hand-back re-render", () => {
  const s = mod.createScopeState();
  const r1 = req(s, { selectedText: "clone()", selectionIsSnippet: true, now: 1000 });
  assert.ok(r1.scope, "invocation 1 stays scoped while the widget is open");
  // The snippet renders no ghost while the widget is open: zero items served.
  const sv1 = serve(s, { servedCount: 0, widgetOpen: true, now: 1360 });
  assert.strictEqual(sv1.opensWindowUntil, undefined, "no window from a widget-open serve");
  assert.strictEqual(sv1.scopedGhostKey, true, "the key means scope-in-force; the widget-closed gate lives in the when-clause");
  // Escape closes the widget; the re-invocation carries no selection. The
  // scoped attempt runs: this request STAYS scoped (invocation 2's prompt
  // really did end `metadata.clone`).
  const r2 = req(s, { now: 2000 });
  assert.strictEqual(r2.scope?.name, "clone", "the post-close attempt keeps the scope");
  // The attempt serves zero (the landed-name guard dropped clone_into): the
  // record drops HERE and the machine asks for the unscoped re-render - the
  // hand-back the capture never got.
  const sv2 = serve(s, { servedCount: 0, widgetOpen: false, now: 2400 });
  assert.strictEqual(sv2.opensWindowUntil, undefined, "a never-served zero serve opens no window");
  assert.strictEqual(sv2.rerender, true, "the immediate hand-back: the unscoped re-render is actively requested");
  assert.ok(!sv2.scopedGhostKey, "the drop lowers the key");
  const r3 = req(s, { now: 2500 });
  assert.strictEqual(r3.scope, undefined, "the re-render's request goes out unscoped");
  assert.strictEqual(mod.onSecondEscape(s).reached, false, "nothing left in force after the drop");
});

// ---- Rule 3: the second Escape is reachable whenever a scope is in force

test("never-served scope with no re-invocation: second Escape reaches and unscopes (the capture's dead double-Escape, fixed)", () => {
  const s = mod.createScopeState();
  req(s, { selectedText: "clone()", selectionIsSnippet: true, now: 1000 });
  serve(s, { servedCount: 0, widgetOpen: true, now: 1360 });
  // The Escape re-invocation is not platform-guaranteed (goal.md research
  // answer); here it never fires. The scope is in force, so the second Escape
  // must still reach.
  const esc = mod.onSecondEscape(s);
  assert.strictEqual(esc.reached, true, "second Escape reaches whenever a scope is in force, served or not");
  assert.strictEqual(esc.rerender, true, "reaching means triggering the unscoped run");
  const r = req(s, { now: 2000 });
  assert.strictEqual(r.scope, undefined, "after the second Escape the site is unscoped");
});

test("second Escape with no scope in force reports reached=false", () => {
  const s = mod.createScopeState();
  const esc = mod.onSecondEscape(s);
  assert.strictEqual(esc.reached, false);
  assert.ok(!esc.rerender, "nothing to revert, no re-render");
});

// ---- Rule 4 (capture C): arrowed choice, nothing served

test("capture C: arrowed choice that served nothing - second Escape reaches and unscopes the site", () => {
  const s = mod.createScopeState();
  req(s, { selectedText: "clone()", selectionIsSnippet: true, now: 1000 });
  const r = req(s, { selectedText: "log_id", selectionIsSnippet: false, now: 1500 });
  assert.strictEqual(r.scope?.name, "log_id", "the arrow to a real field scopes");
  serve(s, { servedCount: 0, widgetOpen: true, now: 1760 }); // len=0, empty after postprocess
  // The active scope may survive the widget close (goal.md keeps the hold, so
  // that is not asserted either way); what is outlawed is the second Escape
  // failing to hand the site back.
  const esc = mod.onSecondEscape(s);
  assert.strictEqual(esc.reached, true, "an active scope in force is reachable by the second Escape");
  assert.strictEqual(esc.rerender, true);
  const r2 = req(s, { now: 3000 });
  assert.strictEqual(r2.scope, undefined, "after the second Escape the site is unscoped");
});

// ---- Rule 5 (v20 flagship): the served passive path and its 1500ms window

test("v20 flagship: a served passive preselect holds through the close and the post-close serve opens the 1500ms window", () => {
  const s = mod.createScopeState();
  const r1 = req(s, { selectedText: "read", selectionIsSnippet: false, now: 1000 });
  assert.strictEqual(r1.scope?.name, "read");
  const sv1 = serve(s, { servedCount: 1, widgetOpen: true, now: 1100 });
  assert.strictEqual(sv1.opensWindowUntil, undefined, "the window starts at the post-close serve, not the widget-open one");
  // Rewritten under TRIAGE authority 2026-07-26, triage-p1.md, goal.md
  // amendment: the scoped attempt gets its one post-close serve. The key now
  // pins scope-in-force arming; widget-closed gating is delegated to the
  // keybinding's `!suggestWidgetVisible`, because arming must not depend on a
  // post-close event that is not platform-guaranteed to arrive.
  assert.strictEqual(sv1.scopedGhostKey, true, "scope in force arms the key even before the close");
  // Widget closes; the sticky keeps the SERVED record scoped.
  const r2 = req(s, { now: 2000 });
  assert.strictEqual(r2.scope?.name, "read", "a served passive record holds through the widget close");
  const sv2 = serve(s, { servedCount: 1, widgetOpen: false, now: 2100 });
  assert.strictEqual(sv2.opensWindowUntil, 2100 + 1500, "opensWindowUntil = serve now + PASSIVE_SCOPE_MS");
  assert.strictEqual(sv2.scopedGhostKey, true, "scope in force after the close arms the key");
  const r3 = req(s, { now: 3000 });
  assert.strictEqual(r3.scope?.name, "read", "inside the window the scope holds at the same state");
});

test("window expiry: before the deadline nothing fires and the scope holds; at the deadline rerender fires and the site unscopes", () => {
  const s = mod.createScopeState();
  req(s, { selectedText: "read", selectionIsSnippet: false, now: 1000 });
  serve(s, { servedCount: 1, widgetOpen: true, now: 1100 });
  req(s, { now: 2000 });
  const sv = serve(s, { servedCount: 1, widgetOpen: false, now: 2100 });
  const deadline = sv.opensWindowUntil;
  assert.strictEqual(deadline, 3600);
  assert.strictEqual(mod.onExpiry(s, deadline - 1).rerender, false, "a tick before the deadline does nothing");
  const r = req(s, { now: deadline - 1 });
  assert.strictEqual(r.scope?.name, "read", "an early tick does not drop the scope");
  assert.strictEqual(mod.onExpiry(s, deadline).rerender, true, "at the deadline the revert re-render fires");
  const r2 = req(s, { now: deadline + 50 });
  assert.strictEqual(r2.scope, undefined, "after expiry the next request is unscoped");
});

test("expiry ticks with no window pending never rerender", () => {
  const s = mod.createScopeState();
  assert.strictEqual(mod.onExpiry(s, 99999).rerender, false);
});

// ---- Rule 6: the served active path - indefinite hold, Escape drop, sticky refusal

// Amended under the human design call 2026-07-26
// (`docs/architecture/vscode-layer.md`, "The member-dot journey, and the
// uniform window"): the 1.5 second window is UNIFORM.
// "Escape keeps the ghost from whatever the last one was run" -
// preselected or arrowed - and the window elapsing reruns unconstrained
// either way. This row originally pinned v20's indefinite hold for arrowed
// choices, which that design call voids.
test("uniform window: a served arrowed choice gets the same 1500ms window as a preselect - serve opens it, expiry hands back", () => {
  const s = mod.createScopeState();
  req(s, { selectedText: "read", selectionIsSnippet: false, now: 1000 });
  const r1 = req(s, { selectedText: "log_id", selectionIsSnippet: false, now: 1200 });
  assert.strictEqual(r1.scope?.name, "log_id");
  serve(s, { servedCount: 1, widgetOpen: true, now: 1300 });
  const r2 = req(s, { now: 2000 });
  assert.strictEqual(r2.scope?.name, "log_id", "the served arrowed scope survives the close");
  const sv = serve(s, { servedCount: 1, widgetOpen: false, now: 2100 });
  assert.strictEqual(sv.opensWindowUntil, 2100 + 1500, "the arrowed scope's serve opens the same window a preselect gets");
  assert.strictEqual(sv.scopedGhostKey, true, "key arms on scope-in-force after the close, arrowed included");
  const inWindow = req(s, { now: 2100 + 1499 });
  assert.strictEqual(inWindow.scope?.name, "log_id", "inside the window the arrowed choice holds so Tab can take it");
  assert.strictEqual(mod.onExpiry(s, 2100 + 1500).rerender, true, "at the deadline the unconstrained rerun fires");
  const r3 = req(s, { now: 10000 });
  assert.strictEqual(r3.scope, undefined, "past the window the site is unscoped - the indefinite hold is void");
});

test("after the second-Escape drop of an active scope, the reopened widget's preselect refuses but a fresh arrow scopes", () => {
  const s = mod.createScopeState();
  req(s, { selectedText: "read", selectionIsSnippet: false, now: 1000 });
  req(s, { selectedText: "log_id", selectionIsSnippet: false, now: 1200 });
  serve(s, { servedCount: 1, widgetOpen: true, now: 1300 });
  req(s, { now: 2000 });
  serve(s, { servedCount: 1, widgetOpen: false, now: 2100 });
  const esc = mod.onSecondEscape(s);
  assert.strictEqual(esc.reached, true);
  // The widget re-opens on its own moments after a dismissal (goal.md); the
  // drop stamps a refusal so the reopened preselect cannot re-wedge the state.
  const r1 = req(s, { selectedText: "write", selectionIsSnippet: false, now: 2500 });
  assert.strictEqual(r1.scope, undefined, "the refusal sticks against the reopened widget's passive preselect");
  // A fresh arrow is a new deliberate human choice and scopes again.
  const r2 = req(s, { selectedText: "file_len", selectionIsSnippet: false, now: 2700 });
  assert.strictEqual(r2.scope?.name, "file_len", "a fresh arrow at the same state scopes again");
});

// ---- Rule 7: cursor movement

test("cursor move to a different stateKey kills the held scope; a move reported at the identical stateKey does not", () => {
  const s = mod.createScopeState();
  req(s, { selectedText: "read", selectionIsSnippet: false, now: 1000 });
  req(s, { selectedText: "log_id", selectionIsSnippet: false, now: 1200 });
  serve(s, { servedCount: 1, widgetOpen: true, now: 1300 });
  req(s, { now: 2000 });
  serve(s, { servedCount: 1, widgetOpen: false, now: 2100 });
  mod.onCursorMoved(s, K);
  const r1 = req(s, { now: 2500 });
  assert.strictEqual(r1.scope?.name, "log_id", "a move to the identical stateKey is not a move");
  mod.onCursorMoved(s, K2);
  const r2 = req(s, { stateKey: K2, now: 3000 });
  assert.strictEqual(r2.scope, undefined, "a request at the new position is unscoped");
  assert.strictEqual(mod.onSecondEscape(s).reached, false, "nothing left in force after the move");
});

// ---- Rule 8: non-member sites

test("a selection at a non-member site never scopes and clears any held state", () => {
  const s = mod.createScopeState();
  const r0 = req(s, { stateKey: K2, atMemberSite: false, selectedText: "foo", selectionIsSnippet: false, now: 500 });
  assert.strictEqual(r0.scope, undefined, "non-member sites never scope");
  // A held active scope at K, then a non-member selected request: state clears.
  req(s, { selectedText: "read", selectionIsSnippet: false, now: 1000 });
  req(s, { selectedText: "log_id", selectionIsSnippet: false, now: 1200 });
  serve(s, { servedCount: 1, widgetOpen: true, now: 1300 });
  const r1 = req(s, { stateKey: K2, atMemberSite: false, selectedText: "foo", selectionIsSnippet: false, now: 2000 });
  assert.strictEqual(r1.scope, undefined);
  assert.strictEqual(mod.onSecondEscape(s).reached, false, "the held scope was cleared, nothing in force");
  const r2 = req(s, { now: 2500 });
  assert.strictEqual(r2.scope, undefined, "the old site's scope is gone");
});

// ---- Rule 9: the served-then-dropped fallback

test("served-then-dropped fallback: a zero-items post-close serve under a previously-served passive record still opens the window", () => {
  const s = mod.createScopeState();
  req(s, { selectedText: "read", selectionIsSnippet: false, now: 1000 });
  serve(s, { servedCount: 2, widgetOpen: true, now: 1100 }); // the served bit stamps here
  const r = req(s, { now: 2000 });
  assert.strictEqual(r.scope?.name, "read", "the served record holds through the close");
  const sv = serve(s, { servedCount: 0, widgetOpen: false, now: 2200 });
  assert.strictEqual(sv.opensWindowUntil, 2200 + 1500, "zero items may not starve the revert clock");
  assert.strictEqual(sv.scopedGhostKey, true, "fix (b): the key arms on scope-in-force, ghost or no ghost");
  assert.strictEqual(mod.onExpiry(s, 3700).rerender, true, "the revert fires on schedule");
  assert.strictEqual(req(s, { now: 3800 }).scope, undefined, "and the site hands back");
});

// ---- PASSIVE_SCOPE_MS

test("PASSIVE_SCOPE_MS is 1500 and is the exact window length", () => {
  if (mod.PASSIVE_SCOPE_MS !== undefined) {
    assert.strictEqual(mod.PASSIVE_SCOPE_MS, 1500);
  }
  const s = mod.createScopeState();
  req(s, { selectedText: "read", selectionIsSnippet: false, now: 0 });
  serve(s, { servedCount: 1, widgetOpen: true, now: 100 });
  req(s, { now: 700 });
  const sv = serve(s, { servedCount: 1, widgetOpen: false, now: 900 });
  assert.strictEqual(sv.opensWindowUntil - 900, 1500, "the window is exactly 1500ms from the serve");
});
