// Adversarial review tests for session-v26 phase 1 (review agent's file, not
// the implementer's). These probe the holes the review hunted in
// src/core/scopeLifecycle.ts: the passive-only gate on the never-served drop,
// stale-serve behavior around the fix-(a) drop, the pending-record attribution
// seam, the acceptance-bar wall-clock invariant, and the served-bit carry
// across the widget's own auto-reopen. Tests that PIN a hazard rather than a
// contract say so in their comment.
//
// Run: SKIP_LIVE=1 node --test test/review-v26-lifecycle.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v26-lifecycle",
  `export * from "../src/core/scopeLifecycle";\n`
);
test.after(cleanup);

const {
  PASSIVE_SCOPE_MS,
  createScopeState,
  onRequest,
  onServe,
  onExpiry,
  onSecondEscape,
  heldStateKey,
  windowDeadline,
} = mod;

const K = "review:k1";
const K2 = "review:k2";

const open = (s, text, over = {}) =>
  onRequest(s, {
    stateKey: K,
    atMemberSite: true,
    selectedText: text,
    selectionIsSnippet: false,
    now: 0,
    ...over,
  });
const escape = (s, over = {}) => onRequest(s, { stateKey: K, atMemberSite: true, now: 0, ...over });

const table = (rows, run) => {
  const bad = [];
  for (const row of rows) {
    try {
      run(row);
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
  }
  if (bad.length) assert.fail(`${bad.length}/${rows.length} cases failed:\n  - ${bad.join("\n  - ")}`);
};

// ---------------------------------------------------------------------------
// R1. Fix (a) is passive-only: an ARROWED choice that never served keeps
// today's hold, across repeated post-close requests and long wall clock.
// goal.md: "An arrowed (active) choice keeps today's hold behavior."
// ---------------------------------------------------------------------------

// Updated by the implementer twice on 2026-07-26: first to the triage
// amendment (the drop moved from the first post-close REQUEST to that
// attempt's zero SERVE), then to the human design call recorded in
// docs/architecture/vscode-layer.md, "Measured records": the window is UNIFORM,
// so the arrowed choice takes the same zero-serve hand-back as the preselect.
// What R1 guards now is that the post-close attempt holds for BOTH kinds and
// that its zero serve hands both back the same way.
test("R1. never-served post-close requests hold for both kinds, and the zero SERVE hands both back - the arrowed indefinite hold is void", () => {
  table(
    [
      { name: "preselect, never served", arrow: false },
      { name: "arrowed, never served", arrow: true },
    ],
    (row) => {
      const s = createScopeState();
      open(s, ".alpha", { now: 0 });
      if (row.arrow) open(s, ".beta", { now: 10 });
      // No widget-open serve at all: the generation was cancelled by the
      // Escape (the ordinary fast-Escape timeline). The post-close attempt
      // itself stays scoped for BOTH kinds.
      const name = row.arrow ? "beta" : "alpha";
      const r = escape(s, { now: 100 });
      assert.strictEqual(r.scope?.name, name, "the post-close attempt keeps the scope");
      const sv = onServe(s, { servedCount: 0, widgetOpen: false, now: 200 });
      assert.strictEqual(sv.opensWindowUntil, undefined, "a never-served zero serve opens no window either way");
      assert.strictEqual(sv.rerender, true, "the zero attempt hands back actively, preselected or arrowed");
      assert.strictEqual(escape(s, { now: 500 }).scope, undefined, "and the site is unscoped after it");
    }
  );
});

// ---------------------------------------------------------------------------
// R2. A stale widget-open serve landing AFTER the fix-(a) drop revives
// nothing: no record, no window, no key.
// ---------------------------------------------------------------------------

// Updated by the implementer to the goal.md triage amendment 2026-07-26: the
// drop now happens at the post-close attempt's zero serve, and the stale
// widget-open serve arriving after it must revive nothing.
test("R2. the widget-open request's serve arriving after the zero-serve drop stamps nothing and arms nothing", () => {
  const s = createScopeState();
  open(s, ".alpha", { now: 0 }); // widget-open request, generation slow
  const r = escape(s, { now: 100 }); // the one post-close attempt, still scoped
  assert.strictEqual(r.scope?.name, "alpha");
  const dropServe = onServe(s, { servedCount: 0, widgetOpen: false, now: 200 });
  assert.strictEqual(dropServe.rerender, true, "the zero attempt drops and hands back");
  // The widget-open request's serve arrives late (its record is gone).
  const sv = onServe(s, { servedCount: 2, widgetOpen: true, now: 300 });
  assert.strictEqual(sv.opensWindowUntil, undefined, "no window over a dropped record");
  assert.strictEqual(sv.scopedGhostKey, false, "no key over a dropped record");
  assert.strictEqual(heldStateKey(s), undefined, "nothing revived");
  assert.strictEqual(escape(s, { now: 400 }).scope, undefined, "the site stays unscoped");
});

// ---------------------------------------------------------------------------
// R3. Flipped by the implementer from hazard pin to correctness assertion,
// 2026-07-26, per triage-p1.md (finding 4 folded into Do 2): the machine
// learned per-request attribution. A scoped onRequest returns a `requestId`;
// a serve echoing a superseded id is a no-op - it stamps no served bit, opens
// no window, drops no record. The drop decision living at the serve point is
// what made this load-bearing rather than a hazard note.
// ---------------------------------------------------------------------------

test("R3. a serve echoing a superseded requestId stamps nothing: the served bit cannot land on a record that never served", () => {
  const s = createScopeState();
  const r1 = open(s, ".alpha", { now: 0 }); // request 1 at K, generation in flight
  // The user moved on: request 2, widget open at a NEW state, fresh passive
  // preselect.
  onRequest(s, { stateKey: K2, atMemberSite: true, selectedText: ".gamma", selectionIsSnippet: false, now: 50 });
  // Request 1's serve arrives (the editor failed to cancel it). With its id
  // echoed, the machine refuses the attribution.
  onServe(s, { servedCount: 3, widgetOpen: true, now: 60, requestId: r1.requestId });
  // The K2 record's post-close attempt is therefore still a NEVER-served one:
  // its zero serve hands back instead of opening a window off a forged bit.
  const r = onRequest(s, { stateKey: K2, atMemberSite: true, now: 100 });
  assert.strictEqual(r.scope?.name, "gamma", "the attempt itself stays scoped (triage amendment)");
  const sv = onServe(s, { servedCount: 0, widgetOpen: false, now: 150, requestId: r.requestId });
  assert.strictEqual(sv.opensWindowUntil, undefined, "no window off a forged served bit");
  assert.strictEqual(sv.rerender, true, "the never-served zero attempt hands back");
  assert.strictEqual(heldStateKey(s), undefined, "the record is gone");
});

// ---------------------------------------------------------------------------
// R4. Acceptance-bar invariant, swept per serve outcome: once the first
// post-close serve lands, the passive scope is gone within PASSIVE_SCOPE_MS,
// and NO later serve outcome extends that deadline. (The bar words the clock
// from the widget close; the shipped v20 design starts it at the post-close
// serve - generation time extends the wall clock by the serve delay. That
// reading is pinned here as serve-anchored, per v20's ratified design.)
// ---------------------------------------------------------------------------

test("R4. no serve outcome extends the passive window: zero, one, or many items, repeated in-window serves - the deadline never slides", () => {
  table(
    [
      { name: "post-close serve of 1 item", counts: [1] },
      { name: "post-close serve of 0 items (served-then-dropped fallback)", counts: [0] },
      { name: "three in-window serves 1,0,4", counts: [1, 0, 4] },
      { name: "three in-window serves 0,0,0", counts: [0, 0, 0] },
    ],
    (row) => {
      const s = createScopeState();
      open(s, ".alpha", { now: 0 });
      onServe(s, { servedCount: 2, widgetOpen: true, now: 40 }); // served stamps
      escape(s, { now: 100 });
      let deadline;
      let now = 200;
      for (const count of row.counts) {
        const sv = onServe(s, { servedCount: count, widgetOpen: false, now });
        if (deadline === undefined) {
          deadline = sv.opensWindowUntil;
          assert.strictEqual(deadline, now + PASSIVE_SCOPE_MS, "the first post-close serve opens the window");
        } else {
          assert.strictEqual(sv.opensWindowUntil, undefined, "a later serve must not re-open");
          assert.strictEqual(windowDeadline(s), deadline, "a later serve must not slide the deadline");
        }
        now += 300;
        if (now < deadline) escape(s, { now: (now += 10) });
      }
      // At the deadline the scope is gone, whether the timer or the next
      // request observes it first.
      assert.strictEqual(onExpiry(s, deadline).rerender, true, "expiry fires at the fixed deadline");
      assert.strictEqual(escape(s, { now: deadline + 1 }).scope, undefined, "the scope did not outlive its window");
    }
  );
});

// ---------------------------------------------------------------------------
// R5. PIN of accepted behavior at the fix-(c) boundary: the widget's own
// auto-reopen at the untouched state carries the served bit (same state, same
// text), so its Escape earns a SECOND full window for what is, to the user,
// one preselect they never chose. Each post-close window is individually
// bounded (R4); the total scope lifetime at one state is not, while the
// widget keeps reopening. Pinned so a future change is a deliberate one.
// ---------------------------------------------------------------------------

test("R5. [behavior pin] served bit carries across the auto-reopen: the second Escape-serve opens a second full window at the same state", () => {
  const s = createScopeState();
  open(s, ".alpha", { now: 0 });
  onServe(s, { servedCount: 1, widgetOpen: true, now: 40 });
  escape(s, { now: 100 });
  const sv1 = onServe(s, { servedCount: 0, widgetOpen: false, now: 200 });
  assert.strictEqual(sv1.opensWindowUntil, 200 + PASSIVE_SCOPE_MS, "window one");
  // The widget re-opens on its own at the untouched state (dogfooded).
  open(s, ".alpha", { now: 800 });
  onServe(s, { servedCount: 0, widgetOpen: true, now: 850 });
  const r = escape(s, { now: 900 });
  assert.strictEqual(r.scope?.name, "alpha", "the carried served bit holds the reopened preselect through its close");
  const sv2 = onServe(s, { servedCount: 0, widgetOpen: false, now: 1000 });
  assert.strictEqual(sv2.opensWindowUntil, 1000 + PASSIVE_SCOPE_MS, "window two, fresh and full-length");
});

// ---------------------------------------------------------------------------
// R6. Fix (b) at the machine: the second Escape reaches in EVERY
// scope-in-force state, and the key the serve reports agrees.
// (The live-editor keybinding is a separate finding: package.json gates the
// key on inlineSuggestionVisible, which is false in the ghost-less states.)
// ---------------------------------------------------------------------------

test("R6. second Escape reaches in every scope-in-force state, ghost or no ghost, and the post-close serve arms the key in each", () => {
  table(
    [
      {
        name: "passive, served, ghost on screen",
        build: (s) => {
          open(s, ".alpha", { now: 0 });
          onServe(s, { servedCount: 1, widgetOpen: true, now: 40 });
          escape(s, { now: 100 });
          return onServe(s, { servedCount: 1, widgetOpen: false, now: 200 });
        },
      },
      {
        name: "passive, served earlier, post-close serve starved",
        build: (s) => {
          open(s, ".alpha", { now: 0 });
          onServe(s, { servedCount: 1, widgetOpen: true, now: 40 });
          escape(s, { now: 100 });
          return onServe(s, { servedCount: 0, widgetOpen: false, now: 200 });
        },
      },
      {
        // Updated to the uniform window (journeys/member-dot-flow.md,
        // 2026-07-26): the never-served arrowed starve now hands back at the
        // serve itself (R1), so the scope-in-force starved state this row
        // keeps is the served-then-starved one - capture invocation 3 with a
        // ghost that HAD been on screen.
        name: "active, served while open, post-close serve starved",
        build: (s) => {
          open(s, ".alpha", { now: 0 });
          open(s, ".beta", { now: 10 });
          onServe(s, { servedCount: 1, widgetOpen: true, now: 40 });
          escape(s, { now: 100 });
          return onServe(s, { servedCount: 0, widgetOpen: false, now: 200 });
        },
      },
      {
        name: "active, served",
        build: (s) => {
          open(s, ".alpha", { now: 0 });
          open(s, ".beta", { now: 10 });
          onServe(s, { servedCount: 1, widgetOpen: true, now: 40 });
          escape(s, { now: 100 });
          return onServe(s, { servedCount: 2, widgetOpen: false, now: 200 });
        },
      },
    ],
    (row) => {
      const s = createScopeState();
      const sv = row.build(s);
      assert.strictEqual(sv.scopedGhostKey, true, "the key arms on scope-in-force with the widget closed");
      const esc = onSecondEscape(s);
      assert.strictEqual(esc.reached, true, "the second Escape reaches");
      assert.strictEqual(esc.rerender, true, "and asks for the unscoped run");
      assert.strictEqual(escape(s, { now: 300 }).scope, undefined, "which goes out unscoped");
    }
  );
});
