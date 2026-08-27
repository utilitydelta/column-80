// Blind oracle, session-v58 phase 5: the cancel affordance (roadmap item 67,
// the RULED REPLACEMENT for the watchdog). Written BEFORE the code, against
// the phase-5 contract only.
//
// ===========================================================================
// WHAT THIS FILE PINS, AND THE ONE CLAUSE THE PHASE EXISTS FOR
// ===========================================================================
//
// Cancel lives today in exactly four places, all of them inside a progress
// NOTIFICATION: `cancellable: true` on `vscode.window.withProgress`, wiring an
// AbortController through the token. Measured here at the branch point, all
// four fire and all four work.
//
// A notification is dismissable. Dismiss it and the Cancel button goes with
// it, and nothing else on screen says a generation is still running - so the
// generation runs on against a hung server with no way to stop it. That is the
// exact state the watchdog was proposed to rescue, and the human's ruling
// replaced the watchdog with this: the in-flight state must be VISIBLE for as
// long as it lasts, and cancel must be ONE OBVIOUS ACTION away.
//
// So C4 is the clause the phase exists for, and the honesty of this file turns
// on how a dismissed notification is modelled. In the real API, dismissing
// does NOT cancel the token and does NOT unwind `withProgress`: the task
// promise stays pending and the token stays unfired. The harness models
// exactly that - `dismiss()` sets no flag the product can see, it only makes
// the HARNESS refuse to fire the token afterwards. A cancel that lands after a
// dismiss therefore PROVES it did not travel through the notification, and the
// C4 rows assert `rec.fired === false` on top of the outcome so that proof is
// on the record rather than assumed.
//
// ===========================================================================
// THE STUB PROBLEM, AND WHAT WAS CHOSEN
// ===========================================================================
//
// This phase adds the product's first status-bar item, so it adds an API
// surface no shared harness models. The shared `test/.vscode-stub.cjs` has
// neither `createStatusBarItem` nor `StatusBarAlignment`, and it is used by
// many files; extending it is a change to shared infrastructure.
//
// CHOSEN: neither extend the shared stub nor hand-roll a new one. This file
// composes `ACTIVATION_STUB_SOURCE` from `test/.activation-stub.cjs` - the
// ~400-line stub that already drives the product's REAL `activate` - and
// appends a LOCAL patch to it. Three reasons, in order:
//
//   1. IT IS ALREADY THERE. The activation stub already exports
//      `StatusBarAlignment` and already has a `createStatusBarItem`; what it
//      lacks is a RECORDING one. The patch replaces that single factory. No
//      shared file changes; the append happens in this file's own scratch stub.
//   2. IT DRIVES `activate`. C1 and C9 are about a command and a disposable
//      reaching the extension, and the only honest witness for that is the
//      product's own activation, not a hand-assembled approximation of it.
//      `test/.vscode-stub.cjs` cannot activate the extension - it has no
//      `withProgress`, no `ProgressLocation`, no `applyEdit`, no `tabGroups`,
//      no `createTerminal` - so building on it would have meant writing most
//      of the activation stub again beside the one that exists.
//   3. THE SEAM IS NOT NAMED. The contract fixes the registry's SHAPE but not
//      its module path or its export names. A file that imported the registry
//      would be inventing those names, which is designing the internals. Every
//      row here reaches the registry the way a user does: through `activate`,
//      through a registered command id the contract DOES fix
//      (`column80.cancelGeneration`), and through the status-bar item the
//      product creates. Nothing here knows where the registry lives.
//
// `test/.activation-stub.cjs` is itself byte-locked to a frozen blind file by
// a drift guard (`test/impl-v55-p23-activation-stub.test.cjs`), so appending
// rather than editing is the only option that leaves that guard green.
//
// The one cost, stated: a status-bar surface is now modelled in two places
// (here, and the shared stub's absence of one). If a later phase needs it
// again, promoting the patch below into the SHARED stub is the right move -
// but that is a change for a session that has a second caller, not this one.
//
// ===========================================================================
// THE HARNESS, AND WHY IT ACTIVATES AND THEN RE-REGISTERS
// ===========================================================================
//
// `activate(ctx)` runs ONCE at module scope. It gives the rows the real
// command table, the real subscription list, and whatever status-bar wiring
// the phase adds - wherever the phase chooses to add it. The contract says the
// registry is "in a leaf so fnGen.ts and the extension can BOTH reach it", so
// the cancel command may be registered in either place; a file that only
// called `registerFnGen` would read a red for the wrong reason if the command
// landed in `extension.ts`.
//
// `registerFnGen` is then called a SECOND time against its `buildService`
// seam, which overwrites the gesture commands with instrumented ones sharing a
// transport this file can hold open, fail, or abort on demand. The registry is
// a module singleton either way, so both registrations see the same one.
//
// No packet leaves and no hardware is probed: the tier is the REMOTE arm
// against an RFC 2606 `.invalid` host with `listModels` injected, and the
// hardware probe is stubbed. The generation itself is a promise this file
// holds.
//
// ===========================================================================
// BINDINGS THE CONTRACT LEAVES OPEN, RESOLVED AND REPORTED
// ===========================================================================
//
//   * THE ITEM'S IDENTITY. The contract fixes "the status-bar item's `command`
//     is `column80.cancelGeneration`", so that is how this file finds it: any
//     item whose `command` is that id (as a string or as a `{ command }`
//     object, both of which the real API accepts). Nothing else about the item
//     is assumed.
//   * "VISIBLE". Bound to the last of `show`/`hide`/`dispose` called on the
//     item being `show`. An item created and never shown is not visible; one
//     hidden or disposed is not visible.
//   * "IT SPINS" (C3). Bound to a spinning codicon in the item's `text`, i.e. a
//     `~spin` modifier. This is the product's OWN precedent: `withVerifyStatus`
//     at fnGen.ts:1619 writes `$(sync~spin)` for the same purpose. A different
//     spinner codicon passes; a static one does not.
//   * "IT NAMES THE TARGET" (C3). Bound to the resolved symbol name appearing
//     in the item's `text` or `tooltip`. The fixture's target is `walk`, and
//     the four progress titles the product already writes name the symbol the
//     same way ("Generating walk...").
//   * "THE CHANNEL RECORDS A CANCELLATION" (C6). Bound to a channel line
//     matching /abort|cancel/i, NOT to a literal. The product writes
//     `[fngen] aborted` today; a re-word that still says cancellation passes,
//     and that is the right latitude for a clause whose point is that the
//     event is recorded at all.
//   * "THE COMMAND'S DESCRIPTION" (falsifier 9). SETTLED BY AMENDMENT A2 - see
//     the amendments section below. The hint lives on the status-bar item's
//     TOOLTIP, not on the manifest, and the tooltip must carry both halves:
//     what a click does (/cancel|stop/i) and that a key can be bound
//     (/bind|shortcut|keyboard/i). A tooltip is a string OR a MarkdownString and
//     both are read. The palette title stays clean.
//   * "A GENERATION ENDS" (C3). Bound to the `withProgress` task settling, not
//     to the human accepting or rejecting the preview that follows. The preview
//     is a consent gate on work that has already finished; an item that stayed
//     up through it would be claiming a generation is running when none is.
//   * C5's "REGISTERS". A blind file cannot name the registry, so the source
//     pin asks for the STRUCTURE the contract forces: every cancellable
//     `withProgress` site in fnGen.ts must mention one and the same identifier
//     that fnGen.ts imports from a RELATIVE module (the leaf). Measured at the
//     branch point: no such identifier exists - the only name common to all
//     four sites is `vscode` itself, which is not a relative import. A fifth
//     cancellable site added later without registering breaks the "all of
//     them" quantifier, which is the failure mode C5 exists for.
//
// ===========================================================================
// FOUR CONTRACT FINDINGS, RAISED FROM THIS FILE AND RULED BEFORE ANY PRODUCT
// CODE WAS WRITTEN. The contract now carries them as amendments A1-A4.
// ===========================================================================
//
// A1 - C7's "two generations in flight" was wrong about the product, and the
// clause is rewritten to what the product does. `FnGenService.run` is
// SINGLE-FLIGHT: "newest wins, no join", it aborts `this.inflight` before
// starting a new round (src/core/fnGenService.ts around line 461). Every
// gesture shares one service, so the moment a second generation starts, the
// first is cancelled at the transport. Two claims still overlap - both
// `withProgress` notifications are up, both registry claims are live - but the
// older one always ends as a CANCELLATION and always ends FIRST. It cannot be
// made to end by success while another runs.
//
// So `C7 [overlap]` is written to that: start a generation, start a second
// one, let the first unwind, assert the item SURVIVES, end the second, assert
// the item goes. That is the clause's substance - a release must not drop
// another claim's item - and it is the only overlap the product can produce.
// `G [overlap mechanics]` is the witness that the overlap is real here.
//
// A2 - falsifier 9's hint moved from the manifest to the TOOLTIP. A
// `contributes.commands` entry has no `description` field, so the hint would
// have had to ride the palette title, where it is noise on a surface every
// user reads every time. Ruled: the status-bar item's tooltip says both that
// clicking cancels and that the command can be bound to a key; the palette
// title stays `Column 80: Cancel Generation`. The row moved with it, from the
// manifest group to `C2 [tooltip says bindable]` in the drive section.
//
// A3 - C5 and the contract's out-of-scope line contradicted each other, and
// C5 won. The fourth site (`:6790`, "Running tests for ...") is a spawned
// framework run, not a generation, and the out-of-scope line could be read as
// excluding it. It registers: a hung `cargo test` is the same user problem as
// a hung server - a dismissable notification and no other way out - and it is
// work this product started. The out-of-scope line now means "do not go
// hunting other cancellable things elsewhere in the product".
// `C6 [run-tests arm, source pin]` stands.
//
// A4 - "it spins" stays bound to `~spin` in the item text rather than to a
// named icon, so a better icon later is not a contract breach.
//
// A5 - RAISED BY THE IMPLEMENTATION, AND THE IMPLEMENTATION WAS RIGHT. C5's
// first cut demanded that all four sites mention an identifier IMPORTED from a
// leaf. The registry as built is an INSTANCE, made in `registerFnGen`, pushed
// to `context.subscriptions` and injectable, so the sites call `begin` on a
// local const and no import appears at any of them. Conceded: the import shape
// was a detection convenience of mine, and satisfying it would have forced a
// module-level singleton - worse on disposal (C9), worse across activations,
// and untestable, which the contract's own seam paragraph already argued
// against ("the registry takes its vscode surface by injection"). The row now
// detects the CALL. It is re-cut, not weakened, and `G [C5 detector]` proves
// that by running the same detector against four mutations.
//
// ===========================================================================
// WHAT HAPPENED WHEN THE CODE LANDED
// ===========================================================================
//
// 29 rows, all green. Two of them earned their keep on the way:
//
//   * THE DRIVE ROWS CAUGHT A REAL BUG. Thirteen went red on "an item that
//     shows and immediately hides". At the largest site the task callback is
//     `async` and its body was `try { ... return service.generate(...) }
//     finally { claim.release() }` - and a bare `return promise` inside a
//     try/finally runs the finally AT THE RETURN, before the promise settles.
//     The claim was released the instant the generation started, so the item
//     appeared and vanished in one tick. `return await` fixed it. The other
//     three sites release with `.finally()` on the returned promise and were
//     never affected, which is why only one site was wrong and why a row that
//     only checked "the item appears somewhere" would have missed it.
//   * C6's SOURCE PIN DROVE A FIX AND A SECOND, BETTER ONE. The test-run
//     catch now checks for a cancellation before toasting, and it does NOT
//     reuse `firstRun.ts`'s `isAbort`: that one runs `/abort/i` over the whole
//     message, so a server whose body says "aborted upstream" is read as a
//     user cancellation and the failure vanishes silently (session-v57 scrap
//     S57-3, still open). The new `isCancellation` is name-only.
//
// The RED-at-the-branch-point census below is kept as written. It is the
// record of what this file was worth before the code existed, and a row that
// was never red is a row nobody should trust.
//
// ===========================================================================
// EXPECTED AT THE BRANCH POINT (3301121, before any implementation)
// ===========================================================================
//
// 28 rows at the time. 21 RED, 7 green by design, three runs, stable. The 29th
// row, `G [C5 detector]`, arrived with A5's re-cut.
//
// RED, all 21 for the same reason - the affordance does not exist. Each one
// says which absence it hit, so a later red for a DIFFERENT reason is legible:
//   C1 [contributed]           C1 [registered]
//   C9 [contributed once]      C9 [registered once]
//   C9 [disposed with the extension]
//   C5 [all four sites register]    C6 [run-tests arm, source pin]
//   C3 [appears]  C3 [names the target]  C3 [spins]  C3 [click target]
//   C2 [tooltip says bindable]
//   C3 [gone on success]  C3 [gone on failure]  C3 [gone on cancel]
//   C4 [survives a dismissed notification]  C4 [cancel still works]
//   C6 [cancel via the command]     C7 [overlap]
//   C7 [an early return releases]   C8 [nothing in flight]
//
// Every "the item went away" row asserts FIRST that the item was there. Without
// that precondition all four of them pass today against an empty status bar,
// which is a row testing nothing.
//
// GREEN BY DESIGN - these are NOT weak rows and they are NOT expected to flip:
//   C2 [no default keybinding]        a RULING pin. Green by absence today; it
//                                     exists to go red the day a default
//                                     binding is added.
//   C2 [the keybinding set is these three]  the same ruling from the other
//                                     side - it catches ANY new keybinding
//                                     entry, including one for a command this
//                                     phase never mentions.
//   C6 [REGRESSION: cancel via the notification]  phase 3's transport
//                                     behaviour. Red here means this phase
//                                     WEAKENED something, never that the
//                                     feature has not landed.
//   C5 [precondition: five sites, four cancellable]  the census the source pin
//                                     runs on, including the deliberate
//                                     exclusion of withVerifyStatus.
//   G [manifest]  G [harness]  G [overlap mechanics]  G [C5 detector]
//                                     the rig's own witnesses. Two are load
//                                     bearing rather than decorative:
//                                     [overlap mechanics] proves two gestures
//                                     really do overlap here, so a red C7 is
//                                     about the registry and not the rig; and
//                                     [C5 detector] runs the C5 pin against
//                                     four mutations, because a source pin is
//                                     only worth what it REFUSES and "it
//                                     passes on the current file" is not
//                                     evidence of that.
//
// ===========================================================================
// WHAT THIS FILE CANNOT SEE - the residue that belongs on a real screen
// ===========================================================================
//
// Everything here is a stub, and the contract says so before this file does.
// These are NOT gaps a better row would close:
//
//   * Whether the spinner animates, where the item sits, its priority against
//     other extensions' items, whether the tooltip reads well, and whether a
//     user actually NOTICES it.
//   * The real dismiss gesture. The harness models the API contract honestly -
//     dismissing neither fires the token nor unwinds `withProgress` - but the
//     gesture itself is a click on a notification.
//   * The test-run arm's cancellation. `runFrameworkTestsAt` spawns a real
//     runner and takes no injection seam, so C6 on that arm is SOURCE-PINNED
//     ONLY. Cancelling a live `cargo test` has never been driven here.
//   * That the palette really shows the command, and that a user can bind it
//     from the keybindings UI.
//
// The human now has a server that reproduces the state these need: the fake
// server gained `hang` (accepts, sends headers, never answers) and
// `hang-silent` (accepts and sends nothing). Walk 6 of the phase's visual
// residual list is the drive: generate against `hang`, dismiss the
// notification, cancel from the status bar.
//
// Run: node --test test/blind-v58-p5-cancel-affordance.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const esbuild = require("esbuild");
const { ACTIVATION_STUB_SOURCE } = require("./.activation-stub.cjs");

const ROOT = path.join(__dirname, "..");
const CANCEL_ID = "column80.cancelGeneration";

// ---------------------------------------------------------------------------
// PART 0 - the package manifest. C1, C2, C8's palette entry point, C9.
// Pure JSON, no bundle, no stub.
// ---------------------------------------------------------------------------

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const contributes = pkg.contributes ?? {};
const contributedCommands = contributes.commands ?? [];
const contributedKeybindings = contributes.keybindings ?? [];
const paletteEntries = (contributes.menus ?? {}).commandPalette ?? [];

/** Every string an entry carries, at any depth. What a user could read. */
const stringsOf = (value) => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsOf);
  return [];
};

test("G [manifest]: the contributes block is the shape the rows below read", () => {
  assert.ok(Array.isArray(contributedCommands), "contributes.commands must be an array");
  assert.ok(Array.isArray(contributedKeybindings), "contributes.keybindings must be an array");
  assert.ok(
    contributedCommands.length >= 19,
    `precondition: the branch point contributes 19 commands, got ${contributedCommands.length}`,
  );
});

test("C1 [contributed]: column80.cancelGeneration is a contributed, palette-visible command", () => {
  const entry = contributedCommands.find((c) => c.command === CANCEL_ID);
  assert.ok(
    entry,
    `${CANCEL_ID} must be contributed in package.json. Contributed: ${JSON.stringify(contributedCommands.map((c) => c.command))}`,
  );
  // Palette-visible: either no commandPalette entry at all, or one that does
  // not hide it. `"when": "false"` is how this manifest hides the eight
  // commands it does not want in the palette.
  const hidden = paletteEntries.find(
    (m) => m.command === CANCEL_ID && String(m.when ?? "").trim() === "false",
  );
  assert.ok(
    !hidden,
    `${CANCEL_ID} must be reachable from the palette; a commandPalette entry hides it: ${JSON.stringify(hidden)}`,
  );
  assert.ok(
    typeof entry.title === "string" && entry.title.length > 0,
    "a palette entry needs a title to be readable",
  );
});

// A RULING, pinned hard. Green at the branch point by absence. It is here to
// go RED the day someone gives this command a default keybinding, which the
// v32 ruling forbids and the human's Escape suggestion does NOT license.
test("C2 [no default keybinding] RULING: nothing binds column80.cancelGeneration to a key", () => {
  const bound = contributedKeybindings.filter((k) => k.command === CANCEL_ID);
  assert.deepStrictEqual(
    bound,
    [],
    "the v32 ruling stands: no DEFAULT keybinding for the cancel command. The human's Escape suggestion is served by making it BINDABLE (see the C9 description row), not by shipping a binding",
  );
});

// The same ruling from the other side. A phase that quietly adds a binding for
// some OTHER command is still a phase that added a default binding.
test("C2 [the keybinding set is these three] RULING: no keybinding was added anywhere", () => {
  const seen = contributedKeybindings.map((k) => `${k.command} :: ${k.key}`).sort();
  assert.deepStrictEqual(
    seen,
    [
      "column80.dismissScopedGhost :: escape",
      "column80.proposalAccept :: enter",
      "column80.proposalReject :: escape",
    ],
    "the branch point contributes exactly these three keybindings, all when-guarded to narrow editor contexts. This phase adds none",
  );
});

// Falsifier 9 USED to be asserted here, against the command's contribution
// entry. AMENDMENT A2 moved it: a `contributes.commands` entry has no
// `description` field, so the hint would have had to ride the palette title,
// and "(bindable)" in a title is noise on a surface every user sees every
// time. The hint now lives on the STATUS-BAR ITEM'S TOOLTIP - our own surface,
// and the one the user is standing on at the moment they want to cancel. The
// row is re-cut as `C2 [tooltip says bindable]` in the drive section below.
// This comment stays so the move is legible rather than looking like a
// deletion.

test("C9 [contributed once]: exactly one contributes.commands entry claims the id", () => {
  const hits = contributedCommands.filter((c) => c.command === CANCEL_ID);
  assert.strictEqual(hits.length, 1, `expected exactly one contribution for ${CANCEL_ID}, got ${hits.length}`);
});

// ---------------------------------------------------------------------------
// PART 1 - the source pin. C5, and C6's un-drivable arm.
//
// A source scan, because the contract asks for one: "a site added later
// without registering is the failure mode this clause exists for", and that is
// a fact about the file, not about any run.
// ---------------------------------------------------------------------------

const FNGEN_PATH = path.join(ROOT, "src", "vscode", "fnGen.ts");
const fnGenSource = fs.readFileSync(FNGEN_PATH, "utf8");

/** Every `vscode.window.withProgress(...)` call, by balanced parens. */
function progressSites(src) {
  const CALL = "vscode.window.withProgress(";
  const out = [];
  let at = 0;
  for (;;) {
    const start = src.indexOf(CALL, at);
    if (start < 0) break;
    let depth = 0;
    let end = start + CALL.length - 1;
    for (; end < src.length; end++) {
      if (src[end] === "(") depth++;
      else if (src[end] === ")") {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
    const text = src.slice(start, end);
    out.push({
      start,
      end,
      text,
      line: src.slice(0, start).split("\n").length,
      cancellable: /cancellable\s*:\s*true/.test(text),
      // Widened backwards: an implementer may take the claim just before the
      // call rather than inside the task callback, and both satisfy C5.
      wide: src.slice(Math.max(0, start - 600), end),
    });
    at = end;
  }
  return out;
}

/** Names fnGen.ts imports from a RELATIVE module - i.e. from a leaf of its own. */
function relativeImportNames(src) {
  const names = new Set();
  // `[^;]*?` on purpose: a lazy `[\s\S]*?` walks past a NON-relative import's
  // own `from` clause and swallows every identifier between it and the next
  // relative one, which made this scan pass on names nothing imports.
  for (const m of src.matchAll(/^import\s+([^;]*?)\s+from\s+"(\.[^"]*)";/gm)) {
    for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) {
      if (id[0] !== "type" && id[0] !== "as" && id[0] !== "from") names.add(id[0]);
    }
  }
  return names;
}

const SITES = progressSites(fnGenSource);
const CANCELLABLE = SITES.filter((s) => s.cancellable);
const NON_CANCELLABLE = SITES.filter((s) => !s.cancellable);

test("C5 [precondition: six sites, five cancellable]: the census the pin runs on", () => {
  // The census MOVED in session-v60: `column80.runTests` added a sixth
  // withProgress site, and it is cancellable. The invariant this row guards is
  // unchanged - every notification-location progress site is cancellable and
  // exactly one window-location site is not - so the counts move with the code
  // and the claim does not.
  assert.strictEqual(
    SITES.length,
    6,
    `the branch point has six withProgress calls in fnGen.ts; got ${SITES.length} at lines ${JSON.stringify(SITES.map((s) => s.line))}. If a site was added, the C5 pin below must cover it`,
  );
  assert.strictEqual(
    CANCELLABLE.length,
    5,
    `five of them are cancellable: ${JSON.stringify(SITES.map((s) => [s.line, s.cancellable]))}`,
  );
  // The deliberate exclusion. withVerifyStatus is ProgressLocation.Window and
  // not cancellable, and the contract puts it out of scope; the pin must not
  // reach it, and this row is what says the partition does the excluding.
  assert.strictEqual(NON_CANCELLABLE.length, 1, "one non-cancellable site: withVerifyStatus");
  assert.match(
    NON_CANCELLABLE[0].text,
    /ProgressLocation\.Window/,
    "the excluded site is the Window-location verify spinner, not a notification",
  );
  assert.match(
    NON_CANCELLABLE[0].wide,
    /withVerifyStatus/,
    "and it is inside withVerifyStatus, the function the contract names as out of scope",
  );
});

/** Every `IDENT.begin(` in a chunk - a claim taken against a named object. */
const claimReceiversIn = (text) =>
  new Set([...text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*begin\s*\(/g)].map((m) => m[1]));

/** Is `name` bound, somewhere in `src`, out of something imported from a leaf?
 *  This is what stops a site claiming against an unrelated object that happens
 *  to have a `begin`. */
function boundFromRelativeImport(src, name, relative) {
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b[^;]*;`, "g");
  for (const m of src.matchAll(decl)) {
    for (const id of m[0].matchAll(/[A-Za-z_$][\w$]*/g)) {
      if (id[0] !== name && relative.has(id[0])) return true;
    }
  }
  return false;
}

/** The C5 verdict for an arbitrary source text. Extracted so the mutation row
 *  below can run the SAME detector against deliberately broken variants -
 *  a detector whose failure modes are asserted, not asserted about. */
function c5Verdict(src) {
  const cancellable = progressSites(src).filter((s) => s.cancellable);
  if (cancellable.length === 0) return { ok: false, why: "no cancellable withProgress site at all" };
  const relative = relativeImportNames(src);
  const perSite = cancellable.map((s) => claimReceiversIn(s.wide));
  const shared = [...perSite[0]].filter((name) => perSite.every((set) => set.has(name)));
  if (shared.length === 0) {
    return {
      ok: false,
      why: `no single object takes a claim at every cancellable site. Per site: ${JSON.stringify(perSite.map((s) => [...s]))}`,
    };
  }
  const anchored = shared.filter((name) => boundFromRelativeImport(src, name, relative));
  if (anchored.length === 0) {
    return {
      ok: false,
      why: `every site claims against ${JSON.stringify(shared)}, but nothing binds that out of a leaf module - so it is some other object with a begin(), not the registry`,
    };
  }
  return { ok: true, receiver: anchored[0], sites: cancellable.length };
}

// RE-CUT BY AMENDMENT A5, and the reasoning is worth keeping. The first version
// of this row demanded that all four sites mention one and the same identifier
// IMPORTED from a leaf module. That was a detection convenience of mine, not a
// contract requirement, and it would have forced a module-level singleton -
// which is worse on three counts the contract cares about: it cannot be
// disposed with the extension (C9), it leaks across activations, and it cannot
// be injected, which is what lets a headless oracle read the item at all. The
// contract's own seam paragraph already leaned the other way ("the registry
// takes its vscode surface by injection"). So the row now detects the CLAIM
// rather than the import: every cancellable site must call `begin` on one and
// the same object, and that object must be built from a leaf. A fifth site
// added without claiming still fails it, and so does a site claiming against
// something that merely has a `begin`. Both of those are PROVEN by the
// mutation row that follows, not merely intended.
test("C5 [all four sites register]: every cancellable withProgress site claims against the same leaf registry", () => {
  const verdict = c5Verdict(fnGenSource);
  assert.ok(
    verdict.ok,
    `C5: each cancellable withProgress site must publish its in-flight state to the shared registry. ${verdict.why}. ` +
      `Sites at lines ${JSON.stringify(CANCELLABLE.map((s) => s.line))}`,
  );
  assert.strictEqual(
    verdict.sites,
    CANCELLABLE.length,
    "the verdict must have covered every cancellable site, not a subset",
  );
});

// The row that makes the row above worth having. A source pin is only as good
// as what it REFUSES, and "it passes on the current file" is not evidence of
// that. Each mutation is a way the phase could regress; the detector must call
// each one out. If any of these ever passes, C5 has stopped detecting and the
// message here says which failure mode went blind.
test("G [C5 detector]: the pin refuses every way a site can stop claiming", () => {
  const base = c5Verdict(fnGenSource);
  assert.ok(base.ok, `precondition: the real file must pass, or the mutations prove nothing. ${base.why}`);
  const RECEIVER = base.receiver;

  // M1 - A FIFTH CANCELLABLE SITE, ADDED LATER, THAT NEVER CLAIMS. This is the
  // failure mode C5 exists for and the one the coordinator asked to keep.
  const fifth =
    "\nasync function laterGesture() {\n" +
    "  return vscode.window.withProgress(\n" +
    "    { location: vscode.ProgressLocation.Notification, title: `Doing something new`, cancellable: true },\n" +
    "    async (_p, token) => {\n" +
    "      const controller = new AbortController();\n" +
    "      token.onCancellationRequested(() => controller.abort());\n" +
    "      return doSomething(controller.signal);\n" +
    "    },\n" +
    "  );\n" +
    "}\n";
  const withFifth = c5Verdict(fnGenSource.replace(/^const PREVIEW_SCHEME/m, `${fifth}\nconst PREVIEW_SCHEME`));
  assert.strictEqual(
    withFifth.ok,
    false,
    "a FIFTH cancellable site that never claims must fail C5. It does not, so a gesture added next session would ship with the old notification-only affordance and this pin would stay green",
  );

  // M2 - AN EXISTING SITE STOPS CLAIMING. The same regression, from the other
  // direction: a refactor drops one `begin` and three sites still have theirs.
  const dropped = fnGenSource.replace(new RegExp(`${RECEIVER}\\s*\\.\\s*begin\\s*\\(`), "noClaimHere(");
  assert.notStrictEqual(dropped, fnGenSource, "harness: the mutation must actually change the source");
  assert.strictEqual(
    c5Verdict(dropped).ok,
    false,
    "one site losing its claim must fail C5",
  );

  // M3 - A SITE CLAIMS AGAINST SOMETHING ELSE. Not a missing call: a call on
  // the wrong object, which reads correct and registers nothing.
  const misdirected = fnGenSource.replace(
    new RegExp(`${RECEIVER}\\s*\\.\\s*begin\\s*\\(`),
    "someOtherThing.begin(",
  );
  assert.strictEqual(
    c5Verdict(misdirected).ok,
    false,
    "a site claiming against a DIFFERENT object must fail C5",
  );

  // M4 - THE RECEIVER IS NOT THE REGISTRY. Every site claims, all against one
  // object, but that object is a local stub rather than anything from a leaf.
  // This is the half that stops the pin degrading into "some method called
  // begin is called four times".
  const declAt = fnGenSource.search(new RegExp(`\\b(?:const|let|var)\\s+${RECEIVER}\\b[^;]*;`));
  assert.ok(declAt >= 0, `harness: ${RECEIVER} must be declared somewhere for this mutation to mean anything`);
  const decl = fnGenSource.slice(declAt).match(new RegExp(`\\b(?:const|let|var)\\s+${RECEIVER}\\b[^;]*;`))[0];
  const detached = fnGenSource.replace(decl, `const ${RECEIVER} = { begin: () => ({ release() {} }) };`);
  assert.strictEqual(
    c5Verdict(detached).ok,
    false,
    "a receiver that is not built from a leaf module must fail C5 - otherwise the pin passes on any object with a begin()",
  );

  // AND THE EXCLUSION STILL HOLDS. withVerifyStatus takes no claim and must
  // not be required to: the pin quantifies over CANCELLABLE sites only.
  assert.strictEqual(
    claimReceiversIn(NON_CANCELLABLE[0].wide).has(RECEIVER),
    false,
    "the out-of-scope Window-location spinner must not have been swept into the registry",
  );
});

test("C6 [run-tests arms, source pin]: a cancelled test RUN must not be reported as a failed one", () => {
  // The arms this file cannot drive. A runner spawn is a real process and takes
  // no injection seam, so its abort behaviour is only visible in the source.
  // At the branch point the catch reports ANY throw - an abort included - as
  // "the run could not start", which is an error toast on a cancellation and
  // exactly what C6 forbids.
  //
  // RE-CUT in session-v60, and the re-cut is the point. `column80.runTests`
  // added a SECOND runner-spawning gesture and moved its spawn into
  // `src/core/coveringTestRun.ts`, so "the last cancellable withProgress site in
  // fnGen.ts" stopped being the runner site. Worse, that site's COMMENT mentions
  // `runFrameworkTestsAt`, so a locator matching raw source text found it anyway
  // and then ran the substantive assertion against the wrong body: a green
  // bought with prose, in the one row whose whole design is about not doing that.
  //
  // So the locator strips comments too, and the row now quantifies over EVERY
  // site that spawns a runner, wherever the spawn lives.
  const decommented = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  // Proof the strip works, asserted before it is relied on.
  assert.doesNotMatch(
    decommented("// this one is cancelled, honest\n/* cancellation, truly */\nvoid 0;"),
    /abort|cancel/i,
    "harness: the comment strip must actually remove comments, or every row below can be satisfied by prose",
  );

  const spawnSites = CANCELLABLE.filter((s) =>
    /runFrameworkTestsAt|runCoveringGroups/.test(decommented(s.text)),
  );
  assert.ok(
    spawnSites.length >= 2,
    `harness: two gestures spawn a test runner (runTddTests directly, runTests through runCoveringGroups); found ${spawnSites.length} at lines ${JSON.stringify(CANCELLABLE.map((s) => s.line))}`,
  );

  for (const site of spawnSites) {
    const after = fnGenSource.slice(site.end, site.end + 2400);
    assert.ok(after.indexOf("catch") >= 0, `harness: the site at line ${site.line} is followed by a catch block`);
    const errorAt = after.indexOf("showErrorMessage");
    if (errorAt < 0) {
      continue; // a site that never error-toasts cannot violate C6
    }
    // From the site's own close-paren, not just from `catch`: an implementer may
    // guard before the catch as easily as inside it, and both satisfy C6.
    const guard = decommented(after.slice(0, errorAt));
    assert.match(
      guard,
      /abort|cancel/i,
      `C6: aborting produces no error toast on ANY arm. The runner site at line ${site.line} reaches showErrorMessage without ever asking whether the throw was the user's own cancellation, so cancelling a run toasts "the run could not start"`,
    );
  }
});

test("C6 [core spawn, source pin]: the shared covering-test run honours the signal between groups", () => {
  // The spawn `column80.runTests` and the repair test leg share now lives in
  // core, so the guard has to be pinned where it actually is. Both gestures run
  // groups SEQUENTIALLY, and a cancel between two spawns must stop the walk
  // rather than start the next runner.
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "core", "coveringTestRun.ts"), "utf8");
  const decommented = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const body = decommented.slice(decommented.indexOf("export async function runCoveringGroups"));
  assert.ok(body.length > 0, "harness: runCoveringGroups must exist in core");
  assert.match(
    body.slice(0, body.indexOf("runFrameworkTestsAt")),
    /signal\.aborted/,
    "C6: the loop must check the signal BEFORE spawning the next group, or a cancel starts one more runner",
  );
  assert.match(
    body,
    /isCancellation\(/,
    "C6: a throw from the spawn must be classified as the user's cancel before it can be reported as a failure",
  );
});

// ---------------------------------------------------------------------------
// PART 2 - the bundle. The activation stub, plus the local patch described in
// the header. Nothing shared is edited.
// ---------------------------------------------------------------------------

const TAG = "blind-v58-p5";
const STUB = path.join(__dirname, `.${TAG}.stub.cjs`);
const ENTRY = path.join(__dirname, `.${TAG}.entry.ts`);
const OUTFILE = path.join(__dirname, `.${TAG}.bundle.cjs`);

// The patch. A RECORDING status bar, a RECORDING command registration, a
// progress host whose token can be fired or made unreachable, and the two
// surfaces the activation stub lacks that the fn-gen preview path touches.
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
// A RECORDING status-bar item. Everything the real one carries, plus a call
// log: "visible" is decided by the last of show/hide/dispose.
module.exports.window.createStatusBarItem = (a, b, c) => {
  const item = {
    id: typeof a === "string" ? a : undefined,
    alignment: typeof a === "string" ? b : a,
    priority: typeof a === "string" ? c : b,
    text: "", tooltip: undefined, command: undefined, name: undefined,
    color: undefined, backgroundColor: undefined, accessibilityInformation: undefined,
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
  const rec = { id, disposed: false };
  st.commandRegs.push(rec);
  realRegisterCommand(id, fn);
  return { dispose() { rec.disposed = true; } };
};
// The tab surface the proposal presenter prunes through, driveable so a row
// can close a preview and let the gesture terminate.
st.tabs = [];
module.exports.window.tabGroups = {
  get all() { return st.tabs; },
  activeTabGroup: undefined,
  onDidChangeTabs: (h) => { st.tabHandlers.push(h); return { dispose() {} }; },
  close: async () => true,
};
// THE PROGRESS HOST, and the honesty of C4 lives here.
//
// The real API: \`withProgress\` runs the task and resolves with its result.
// The user DISMISSING the notification does not cancel the token, does not
// unwind the task, and does not settle the promise - the work runs on,
// invisibly. So \`dismiss()\` below changes NOTHING the product can observe.
// All it does is make the HARNESS refuse to fire the token afterwards, which
// is what turns "cancel still worked" into proof that the cancel did not
// travel through the notification.
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
      if (this.dismissed) {
        throw new Error("harness: the notification was dismissed; its Cancel button no longer exists");
      }
      this.fired = true;
      token.isCancellationRequested = true;
      for (const h of handlers.slice()) h();
    },
  };
  st.progress.push(rec);
  rec.promise = Promise.resolve()
    .then(() => task({ report() {} }, token))
    .then(
      (v) => { rec.settled = true; return v; },
      (e) => { rec.settled = true; throw e; },
    );
  return rec.promise;
};
`;

let B = {};
let bundleErr;
try {
  fs.writeFileSync(STUB, ACTIVATION_STUB_SOURCE + PATCH);
  fs.writeFileSync(
    ENTRY,
    `export { activate } from "../src/vscode/extension";
export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state, Position, Range, Selection, Uri } from "vscode";
`,
  );
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}

// ---------------------------------------------------------------------------
// The fixture. A real TS file with a doc-commented, return-annotated function
// in a project a test framework can be detected in - the TDD gesture needs
// both, and C7's overlap needs a SECOND gesture that reaches the transport.
// ---------------------------------------------------------------------------

const WROOT = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v58p5-"));
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });
const TARGET = "walk";
const SRC =
  "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
  "export function walk(): number {\n" +
  "  return 1;\n" +
  "}\n" +
  "\n";
const FSPATH = path.join(WROOT, "src", "walk.ts");
fs.writeFileSync(FSPATH, SRC);
fs.writeFileSync(
  path.join(WROOT, "package.json"),
  JSON.stringify({ name: "c80-v58p5-fixture", version: "0.0.0", devDependencies: { vitest: "^1.0.0" } }, null, 2),
);
fs.writeFileSync(path.join(WROOT, "vitest.config.ts"), "export default {};\n");

const REMOTE = "http://ml-box.invalid:11434";
const MODEL = "qwen3-coder:480b";
const MB = 1048576;
const PROBE = { runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }), totalMemBytes: () => 61826 * MB };
const CFG = { apiBase: REMOTE, model: MODEL, fallbackModel: MODEL, maxTokens: 512, temperature: 0.2 };
const GEN = "column80.generateFunction";
const TDD_GEN = "column80.generateTests";
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
      return new B.Position(line, offset - lineStarts[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const text = SRC.split("\n")[n] ?? "";
      const m = text.match(/\S/);
      return {
        lineNumber: n,
        text,
        range: new B.Range(n, 0, n, text.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : text.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
}

const SYMBOLS = () => [
  { name: TARGET, detail: "", kind: 11, range: new B.Range(1, 0, 3, 1), selectionRange: new B.Range(1, 16, 1, 20), children: [] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (predicate, tries = 300) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await sleep(5);
  }
  return false;
};

// ---------------------------------------------------------------------------
// The rig. One activation, one instrumented re-registration, shared by every
// drive row. Rows run sequentially (node:test default) and each cleans up
// after itself; the status-bar assertions are stateless - they read the item's
// CURRENT visibility, never a per-row reset.
// ---------------------------------------------------------------------------

const rig = {
  ready: false,
  reason: "",
  channel: [],
  calls: [],
  activateContext: undefined,
  fnGenContext: undefined,
};

async function buildRig() {
  if (bundleErr) {
    rig.reason = `the bundle did not build: ${bundleErr}`;
    return;
  }
  const st = B.__state;
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
  st.symbols = SYMBOLS();

  // 1. The product's own activation. This is the only witness for C1 and C9,
  //    and it is what puts the phase's wiring on the board wherever the phase
  //    chose to put it.
  rig.activateContext = {
    subscriptions: [],
    globalState: { get: () => undefined, update: async () => {} },
    workspaceState: { get: () => undefined, update: async () => {} },
    extensionUri: { fsPath: "/ext", toString: () => "file:///ext" },
    globalStorageUri: { fsPath: path.join(WROOT, ".storage") },
  };
  await B.activate(rig.activateContext);
  // The remote reachability probe against the .invalid host must settle before
  // the rows read the command table.
  await sleep(250);
  rig.afterActivate = {
    commands: Object.keys(st.commands).slice(),
    regs: st.commandRegs.map((r) => r.id),
    items: st.statusBarItems.slice(),
  };

  // 2. The instrumented gestures, over a transport this file holds.
  const output = {
    appendLine: (l) => rig.channel.push(String(l)),
    append() {},
    replace() {},
    show() {},
    hide() {},
    clear() {},
    dispose() {},
  };
  const generateFn = async (params) => {
    const call = { signal: params.signal, resolve: undefined, reject: undefined };
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
  B.registerFnGen(rig.fnGenContext, output, new B.ContextBlockStore(() => {}), {
    buildService: async (out, log) => {
      built = await B.buildFnGenService(out, log, PROBE, { listModels: async () => [MODEL] });
      try {
        built.service.dispose();
      } catch {
        /* teardown only */
      }
      built = { ...built, service: new B.FnGenService(CFG, generateFn, log) };
      return built;
    },
    listModels: async () => [MODEL],
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
  });
  const up = await waitFor(() => typeof st.commands[GEN] === "function" && built !== undefined);
  if (!up) {
    rig.reason = `the instrumented gestures never registered; commands: ${JSON.stringify(Object.keys(st.commands))}`;
    return;
  }
  const at = new B.Position(2, 4);
  const selection = new B.Range(at, at);
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
  rig.tier = built.tier;
  rig.ready = true;
}

const ready = buildRig();

test.after(() => {
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
  fs.rmSync(WROOT, { recursive: true, force: true });
});

/** Every recorded status-bar item whose click target is the cancel command. */
const cancelItems = () =>
  (B.__state?.statusBarItems ?? []).filter((i) => {
    const c = i.command;
    return c === CANCEL_ID || (c && typeof c === "object" && c.command === CANCEL_ID);
  });

/** Visible = the last of show/hide/dispose was show. */
const isVisible = (item) => {
  const last = item.calls.filter((c) => c === "show" || c === "hide" || c === "dispose").pop();
  return last === "show";
};
const visibleCancelItems = () => cancelItems().filter(isVisible);

const describeItems = () =>
  JSON.stringify(
    (B.__state?.statusBarItems ?? []).map((i) => ({ text: i.text, tooltip: i.tooltip, command: i.command, calls: i.calls })),
  );

const toasts = () => (B.__state?.messages ?? []).map((m) => ({ kind: m.kind, message: String(m.message) }));
const errorToasts = () => toasts().filter((t) => t.kind === "error");

/** Fresh per-row bookkeeping. The status bar is deliberately NOT reset. */
function beginRow() {
  const st = B.__state;
  st.messages = [];
  st.progress = [];
  rig.channel.length = 0;
  rig.calls.length = 0;
  return st;
}

/** Close any preview the row left open, so the next row starts clean. */
async function drainPreviews() {
  const st = B.__state;
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
  test(name, async (ctx) => {
    await ready;
    if (!rig.ready) {
      assert.fail(`harness is not up: ${rig.reason}`);
    }
    try {
      await fn(ctx);
    } finally {
      await drainPreviews();
    }
  });

// ---------------------------------------------------------------------------
// PART 2a - activation. C1, C8, C9.
// ---------------------------------------------------------------------------

test("G [harness]: the bundle builds, the real extension activates, and the gestures register", async () => {
  await ready;
  assert.ok(!bundleErr, `the bundle did not build: ${bundleErr}`);
  assert.ok(rig.ready, rig.reason);
  assert.ok(
    rig.afterActivate.commands.includes(GEN),
    `activation must register the generate gesture: ${JSON.stringify(rig.afterActivate.commands)}`,
  );
  assert.ok(rig.tier && rig.tier.fnGenEnabled, `the fixture tier must be enabled: ${JSON.stringify(rig.tier)}`);
  assert.ok(rig.activateContext.subscriptions.length > 0, "activation registered disposables against its context");
});

test("C1 [registered]: activation registers column80.cancelGeneration as a command", async () => {
  await ready;
  assert.strictEqual(
    typeof B.__state.commands[CANCEL_ID],
    "function",
    `${CANCEL_ID} must be registered by the time activation returns. Registered: ${JSON.stringify(rig.afterActivate.commands)}`,
  );
});

test("C9 [registered once]: activation registers the cancel command exactly once", async () => {
  await ready;
  const hits = rig.afterActivate.regs.filter((id) => id === CANCEL_ID);
  assert.strictEqual(
    hits.length,
    1,
    `one activation must register ${CANCEL_ID} exactly once; saw ${hits.length} in ${JSON.stringify(rig.afterActivate.regs)}`,
  );
});

rtest("C8 [nothing in flight]: the command is harmless, silent, and leaves nothing on the bar", async () => {
  const st = beginRow();
  const handler = st.commands[CANCEL_ID];
  assert.strictEqual(typeof handler, "function", `${CANCEL_ID} is not registered, so it cannot be run from the palette`);
  assert.strictEqual(rig.calls.length, 0, "precondition: nothing is in flight");
  let threw;
  try {
    await handler();
  } catch (err) {
    threw = err;
  }
  assert.strictEqual(threw, undefined, `cancelling with nothing in flight must not throw; got ${threw}`);
  assert.deepStrictEqual(errorToasts(), [], `and it must say nothing alarming; got ${JSON.stringify(toasts())}`);
  assert.deepStrictEqual(
    visibleCancelItems().map((i) => i.text),
    [],
    `and it must not leave an in-flight item on the bar: ${describeItems()}`,
  );
});

// ---------------------------------------------------------------------------
// PART 2b - the lifecycle. C3, C4, C6, C7.
// ---------------------------------------------------------------------------

/** Start a gesture and wait until its generation is actually at the transport. */
async function startGeneration(commandId = GEN) {
  const st = B.__state;
  const before = rig.calls.length;
  const run = st.commands[commandId]();
  // A rejected gesture promise must not become an unhandled rejection while a
  // row is still asserting; every row that cares inspects `run` itself.
  run.catch(() => undefined);
  const up = await waitFor(() => rig.calls.length > before, 400);
  assert.ok(up, `harness: ${commandId} never reached the transport. Channel: ${JSON.stringify(rig.channel)}`);
  return { run, call: rig.calls[rig.calls.length - 1], progress: st.progress[st.progress.length - 1] };
}

rtest("C3 [appears]: a generation in flight puts an item on the status bar", async () => {
  beginRow();
  const gen = await startGeneration();
  assert.ok(
    visibleCancelItems().length >= 1,
    `while ${TARGET} is generating, a status-bar item whose command is ${CANCEL_ID} must be VISIBLE. Items: ${describeItems()}`,
  );
  gen.call.resolve(GOOD);
  await sleep(120);
});

rtest("C3 [names the target]: the item says which generation it belongs to", async () => {
  beginRow();
  const gen = await startGeneration();
  const shown = visibleCancelItems();
  assert.ok(shown.length >= 1, `no visible cancel item to read: ${describeItems()}`);
  const surface = shown.map((i) => `${i.text} ${i.tooltip ?? ""}`).join(" | ");
  assert.match(
    surface,
    new RegExp(TARGET),
    `C3: the item names the target. The progress notification beside it already says "Generating ${TARGET}"; got ${JSON.stringify(surface)}`,
  );
  gen.call.resolve(GOOD);
  await sleep(120);
});

rtest("C3 [spins]: the item is animated, not a static label", async () => {
  beginRow();
  const gen = await startGeneration();
  const shown = visibleCancelItems();
  assert.ok(shown.length >= 1, `no visible cancel item to read: ${describeItems()}`);
  assert.match(
    shown.map((i) => i.text).join(" | "),
    /~spin/,
    `C3: "it spins". The product's own precedent is the $(sync~spin) codicon withVerifyStatus writes; got ${JSON.stringify(shown.map((i) => i.text))}`,
  );
  gen.call.resolve(GOOD);
  await sleep(120);
});

rtest("C3 [click target]: clicking the item runs the cancel command", async () => {
  beginRow();
  const gen = await startGeneration();
  const shown = visibleCancelItems();
  assert.ok(
    shown.length >= 1,
    `the item's whole purpose is being one click from cancel, so its command must be ${CANCEL_ID}: ${describeItems()}`,
  );
  gen.call.resolve(GOOD);
  await sleep(120);
});

// FALSIFIER 9, re-cut by AMENDMENT A2 onto the tooltip. The ruling against a
// default keybinding only pays for itself if the user LEARNS the command is
// bindable, and the palette title is the wrong place to tell them - it is read
// by everyone, every time, and the hint is for the one person who wants a key.
// The tooltip is read by the person hovering the thing they want to cancel.
// It has to say BOTH halves: what a click does, and that a key can do it too.
rtest("C2 [tooltip says bindable]: the tooltip says a click cancels and that a key can be bound to it", async () => {
  beginRow();
  const gen = await startGeneration();
  const shown = visibleCancelItems();
  assert.ok(shown.length >= 1, `no visible cancel item to read a tooltip from: ${describeItems()}`);
  // A tooltip is a string OR a MarkdownString; stringsOf flattens either.
  const tip = shown.map((i) => stringsOf(i.tooltip ?? "").join(" ")).join(" | ");
  assert.match(
    tip,
    /cancel|stop/i,
    `the tooltip must say what a click does; got ${JSON.stringify(tip)}`,
  );
  assert.match(
    tip,
    /bind|shortcut|keyboard/i,
    `C2 pays for itself only if the user learns the command is bindable, and A2 put that sentence HERE rather than in the palette title. Got ${JSON.stringify(tip)}`,
  );
  gen.call.resolve(GOOD);
  await sleep(120);
});

rtest("C3 [gone on success]: the item does not outlive a generation that succeeded", async () => {
  beginRow();
  const gen = await startGeneration();
  assert.ok(
    visibleCancelItems().length >= 1,
    `precondition: the generation must have raised the item, or "it went away" is a claim about nothing: ${describeItems()}`,
  );
  gen.call.resolve(GOOD);
  const settled = await waitFor(() => gen.progress.settled, 400);
  assert.ok(settled, "harness: the progress task must settle once the model answers");
  await sleep(60);
  assert.deepStrictEqual(
    visibleCancelItems().map((i) => i.text),
    [],
    `the generation ended by SUCCESS, so nothing may still claim it is running. The preview that follows is a consent gate on finished work, not a generation: ${describeItems()}`,
  );
});

rtest("C3 [gone on failure]: the item does not outlive a generation that failed", async () => {
  beginRow();
  const gen = await startGeneration();
  assert.ok(
    visibleCancelItems().length >= 1,
    `precondition: the generation must have raised the item, or "it went away" is a claim about nothing: ${describeItems()}`,
  );
  gen.call.reject(new Error("boom, the model exploded"));
  await waitFor(() => errorToasts().length > 0, 400);
  await sleep(60);
  assert.ok(errorToasts().length > 0, `precondition: a plain failure toasts; got ${JSON.stringify(toasts())}`);
  assert.deepStrictEqual(
    visibleCancelItems().map((i) => i.text),
    [],
    `C7's "a gesture that throws still releases its claim". The failure branch RETURNS early, which is exactly what a try{} without a finally{} leaks through: ${describeItems()}`,
  );
});

rtest("C7 [an early return releases]: a server-unreachable refusal still releases the claim", async () => {
  beginRow();
  const gen = await startGeneration();
  assert.ok(
    visibleCancelItems().length >= 1,
    `precondition: the generation must have raised the item, or "it went away" is a claim about nothing: ${describeItems()}`,
  );
  // A second early-return branch, one the plain-failure row does not reach:
  // the gesture recognises an unreachable server, offers to start it, and
  // returns from inside the offer. Same leak shape, a different exit.
  gen.call.reject(Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
  await waitFor(() => toasts().length > 0, 400);
  await sleep(60);
  assert.ok(
    toasts().some((t) => /isn't running|Ollama server/i.test(t.message)),
    `precondition: this row must take the SERVER-UNREACHABLE exit, not the generic failure one; got ${JSON.stringify(toasts())}`,
  );
  assert.deepStrictEqual(
    visibleCancelItems().map((i) => i.text),
    [],
    `every exit from the gesture releases, including the ones that return before the end: ${describeItems()}`,
  );
});

rtest("C3 [gone on cancel]: the item does not outlive a generation the user cancelled", async () => {
  const st = beginRow();
  const gen = await startGeneration();
  const handler = st.commands[CANCEL_ID];
  assert.strictEqual(typeof handler, "function", `${CANCEL_ID} is not registered, so there is nothing to cancel with`);
  assert.ok(visibleCancelItems().length >= 1, `precondition: the generation raised the item: ${describeItems()}`);
  await handler();
  const settled = await waitFor(() => gen.progress.settled, 400);
  assert.ok(settled, "the cancelled gesture must unwind");
  await sleep(60);
  assert.deepStrictEqual(
    visibleCancelItems().map((i) => i.text),
    [],
    `a cancelled generation is an ENDED generation: ${describeItems()}`,
  );
});

rtest("C6 [cancel via the command]: cancelling is not a failure - no error toast, a cancellation in the channel", async () => {
  const st = beginRow();
  const gen = await startGeneration();
  const handler = st.commands[CANCEL_ID];
  assert.strictEqual(typeof handler, "function", `${CANCEL_ID} is not registered, so this arm cannot be cancelled at all`);
  assert.ok(visibleCancelItems().length >= 1, `precondition: the generation raised the item: ${describeItems()}`);
  await handler();
  await waitFor(() => gen.progress.settled, 400);
  await sleep(60);
  assert.deepStrictEqual(
    errorToasts(),
    [],
    `C6: aborting produces NO error toast. Got ${JSON.stringify(toasts())}`,
  );
  assert.ok(
    rig.channel.some((l) => /abort|cancel/i.test(l)),
    `C6: the channel records the cancellation. Channel: ${JSON.stringify(rig.channel)}`,
  );
});

// REGRESSION. Green at the branch point, and green afterwards. Phase 3 made
// both readers throw an abort rather than the silent-server sentence when the
// signal fires inside the final read; this row is what says phase 5 did not
// weaken that. A red here is a regression, never "the feature has not landed".
rtest("C6 [REGRESSION: cancel via the notification]: the notification's own Cancel is still silent", async () => {
  beginRow();
  const gen = await startGeneration();
  assert.strictEqual(gen.progress.opts.cancellable, true, "precondition: the notification is cancellable");
  gen.progress.fireCancel();
  const settled = await waitFor(() => gen.progress.settled, 400);
  assert.ok(settled, "the cancelled gesture must unwind");
  await sleep(60);
  assert.deepStrictEqual(errorToasts(), [], `no error toast on a notification cancel; got ${JSON.stringify(toasts())}`);
  assert.ok(
    rig.channel.some((l) => /abort|cancel/i.test(l)),
    `and the channel still records it: ${JSON.stringify(rig.channel)}`,
  );
});

// ---------------------------------------------------------------------------
// C4 - the clause the phase exists for.
// ---------------------------------------------------------------------------

rtest("C4 [survives a dismissed notification]: dismissing the toast does not take the affordance with it", async () => {
  beginRow();
  const gen = await startGeneration();
  gen.progress.dismiss();
  await sleep(40);
  assert.strictEqual(gen.progress.settled, false, "harness: dismissing does not unwind withProgress - the work runs on");
  assert.strictEqual(gen.progress.token.isCancellationRequested, false, "harness: dismissing does not fire the token");
  assert.strictEqual(gen.call.signal.aborted, false, "harness: and the generation is still live");
  assert.ok(
    visibleCancelItems().length >= 1,
    `THE POINT OF THE PHASE. The notification is gone and the generation is still running, so the status-bar item must still be there saying so: ${describeItems()}`,
  );
  gen.call.resolve(GOOD);
  await sleep(120);
});

rtest("C4 [cancel still works]: with the notification dismissed, the command kills the generation", async () => {
  const st = beginRow();
  const gen = await startGeneration();
  gen.progress.dismiss();
  const handler = st.commands[CANCEL_ID];
  assert.strictEqual(
    typeof handler,
    "function",
    `${CANCEL_ID} is not registered. With the notification dismissed there is now NO way to stop this generation, which is the state the watchdog was proposed to rescue`,
  );
  await handler();
  const aborted = await waitFor(() => gen.call.signal.aborted, 400);
  assert.ok(aborted, "the in-flight generation must actually be aborted");
  // THE PROOF. The cancel cannot have travelled through the notification,
  // because the harness would have refused to fire its token.
  assert.strictEqual(
    gen.progress.fired,
    false,
    "the cancellation must NOT have come through the progress token - if it did, this row proves nothing about a dismissed notification",
  );
  const settled = await waitFor(() => gen.progress.settled, 400);
  assert.ok(settled, "and the gesture unwinds");
  await sleep(60);
  assert.deepStrictEqual(errorToasts(), [], `still not a failure; got ${JSON.stringify(toasts())}`);
  assert.deepStrictEqual(
    visibleCancelItems().map((i) => i.text),
    [],
    `and the item goes with the work: ${describeItems()}`,
  );
});

// ---------------------------------------------------------------------------
// C7 - two claims. See the CONTRACT FINDING in the header: the service is
// single-flight, so the older generation always ends first and always ends as
// a cancellation. The clause's substance survives that: one claim ending must
// not drop another claim's item.
// ---------------------------------------------------------------------------

// The rig's own witness for the row below, and it is not decoration: C7 is
// the one row whose RED could be the harness rather than the feature - if two
// gestures cannot be in flight at once here, "the item survived the first
// ending" is a claim about a state that never existed. Green at the branch
// point, where there is no item to observe, so a red C7 afterwards is about
// the registry and nothing else.
rtest("G [overlap mechanics]: two gestures really are in flight at once, and the older one unwinds first", async () => {
  beginRow();
  const first = await startGeneration(GEN);
  const second = await startGeneration(TDD_GEN);
  assert.notStrictEqual(second.progress, first.progress, "two distinct progress notifications");
  assert.strictEqual(B.__state.progress.length, 2, "both are up at the same time");
  const firstEnded = await waitFor(() => first.progress.settled, 400);
  assert.ok(firstEnded, `the older gesture unwinds: ${JSON.stringify(rig.channel)}`);
  assert.strictEqual(
    first.call.signal.aborted,
    true,
    "and it unwinds as a CANCELLATION - the service is single-flight, newest wins",
  );
  assert.strictEqual(second.call.signal.aborted, false, "while the newer one runs on");
  second.call.resolve({ text: "it('walks', () => { expect(walk()).toBe(1); });", ttftMs: 1, totalMs: 2, doneReason: "stop" });
  await waitFor(() => second.progress.settled, 400);
  await sleep(120);
});

rtest("C7 [overlap]: the item survives the first generation ending and goes when the last one does", async () => {
  beginRow();
  const first = await startGeneration(GEN);
  assert.ok(visibleCancelItems().length >= 1, `precondition: the first generation raised the item: ${describeItems()}`);
  const second = await startGeneration(TDD_GEN);
  assert.notStrictEqual(second.progress, first.progress, "harness: two progress notifications are up, so two claims exist");
  // The first is now superseded at the transport ("newest wins, no join").
  const firstEnded = await waitFor(() => first.progress.settled, 400);
  assert.ok(firstEnded, `harness: the first gesture must unwind. Channel: ${JSON.stringify(rig.channel)}`);
  assert.strictEqual(second.call.signal.aborted, false, "precondition: the second generation is still running");
  await sleep(60);
  assert.ok(
    visibleCancelItems().length >= 1,
    `ONE of two claims released, so the item must STAY - work is still running and the affordance is the only thing saying so: ${describeItems()}`,
  );
  second.call.resolve({ text: "it('walks', () => { expect(walk()).toBe(1); });", ttftMs: 1, totalMs: 2, doneReason: "stop" });
  const secondEnded = await waitFor(() => second.progress.settled, 400);
  assert.ok(secondEnded, "the second gesture must unwind");
  await sleep(120);
  assert.deepStrictEqual(
    visibleCancelItems().map((i) => i.text),
    [],
    `and when the LAST claim releases, the item goes: ${describeItems()}`,
  );
});

// ---------------------------------------------------------------------------
// C9 - nothing leaks. Runs last: it disposes the extension out from under the
// rig, so no drive row may follow it.
// ---------------------------------------------------------------------------

test("C9 [disposed with the extension]: the item and the command die with the subscriptions", async () => {
  await ready;
  assert.ok(rig.ready, rig.reason);
  const items = cancelItems();
  assert.ok(
    items.length >= 1,
    `no status-bar item claiming ${CANCEL_ID} was ever created, so there is nothing for this row to see disposed: ${describeItems()}`,
  );
  const reg = (B.__state.commandRegs ?? []).find((r) => r.id === CANCEL_ID);
  assert.ok(reg, `${CANCEL_ID} was never registered, so its registration cannot be disposed`);
  for (const ctx of [rig.fnGenContext, rig.activateContext]) {
    for (const d of ctx.subscriptions) {
      try {
        d.dispose?.();
      } catch {
        /* teardown only */
      }
    }
  }
  assert.ok(
    items.every((i) => i.calls.includes("dispose")),
    `every cancel item must be disposed with the extension: ${describeItems()}`,
  );
  assert.strictEqual(reg.disposed, true, `and the command registration must be disposed with it`);
});
