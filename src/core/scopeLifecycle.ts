import { separatorRunAt } from "./fimInject";

// The scope/sticky/window/revert decision as one pure machine, extracted from
// the vscode provider so a table test can drive it without an editor. The rule
// it enforces: a scope is a loan, not a transfer - whatever
// happens to the scoped request, served, dropped, or never servable, the site
// hands back to the unscoped completion. The vscode layer is plumbing over
// this module: it translates editor types into the events below, owns the one
// real timer (armed from `opensWindowUntil`, consulting `onExpiry` when it
// fires), and mirrors `scopedGhostKey` into the editor context key that gates
// the second-Escape keybinding.
//
// Time comes in through `now` on the events; the module holds no timers and
// never reads a clock. State keys are opaque strings minted by the caller: the
// machine compares them by equality only, so "same document state" is whatever
// the caller's key format says it is.

/** How long a passive preselect keeps the ghost after the Escape that reads it.
 *  Long enough to press Tab at a suggestion already being looked at, short
 *  enough that a member the user never chose does not own the ghost. */
export const PASSIVE_SCOPE_MS = 1500;

// `selectedCompletionInfo.text` SOMETIMES carries a leading separator
// (`.enrollTile`, `::enrollTile`) and sometimes a bare name; which one is per
// language and per state, measured in docs/architecture/vscode-layer.md.
// Stripping unconditionally is what makes the two comparable, and every layer
// downstream wants the bare name.
//
// Uses the shared separator run rather than a private `[.:]+`, and it has to:
// this and the provider's landed-name backstop measure the SAME run, and the
// backstop slices at `floor + run.length + willLand.length`. If one of them
// learns `?.` and the other does not, that slice lands in the wrong place and
// the error is in the serve direction.
export function bareMemberName(text: string): string {
  return text.slice(separatorRunAt(text).length);
}

// `\w` is ASCII, and `café` and `日本` are member names a language server
// really returns. ID_Continue is the Unicode class identifiers are actually
// built from; `$` is the JS/TS spelling it omits.
const IDENTIFIER_RUN = /^[\p{ID_Continue}$]*/u;

// The member NAME inside a widget selection, which is not the whole selection.
// tsserver hands back `.enrollTile`; rust-analyzer hands back a SNIPPET,
// `rehome_by_lod(by_lod)`, with the parameter names already written in. Reading
// the identifier run rather than trusting the whole string is what makes the
// two servers comparable, and comparing a snippet against a landed name is what
// dropped every snippet-shaped Rust member.
export function memberIdentifier(text: string): string {
  return IDENTIFIER_RUN.exec(bareMemberName(text))?.[0] ?? "";
}

// Whether a widget selection names a member at all, which is not the same
// question as what that member is called - and deliberately wider than
// `memberIdentifier`. A JS/TS private field (`#count`) and a C# escaped
// identifier (`@class`) read EMPTY through the identifier run and are real
// members the user can arrow to and Tab; `[Symbol]` reads empty and is not.
const MEMBER_NAME_RUN = /^[#@]?[\p{ID_Continue}$]+/u;

export function namesAMember(text: string): boolean {
  return MEMBER_NAME_RUN.test(bareMemberName(text));
}

/** A highlighted member pinned to the exact document state it was highlighted
 *  in. A request observing any other state expires it. */
interface HeldScope {
  readonly stateKey: string;
  /** The widget's text, copied verbatim. Whether it carries a leading
   *  separator, a bare name, or a rendered argument list is the server's
   *  choice and varies by language and by state. */
  readonly text: string;
  /** The bare member name: no leading `.`, no leading `::`. */
  readonly name: string;
  readonly snippet: boolean;
  /** A ghost for this record reached the screen at least once. A record that
   *  never did still gets its ONE post-close attempt - snippet members
   *  structurally serve nothing while the widget is open, and dropping them
   *  at the close would delete the window for every gopls and rust-analyzer
   *  method (goal.md triage amendment 2026-07-26). What the bit decides is
   *  that attempt's ZERO serve: never-served means drop and hand back
   *  actively, served means the window fallback. Without it both revert paths
   *  armed only at the serve of a visible ghost, and a scope that guaranteed
   *  no ghost could ever serve wedged the site: scoped forever, silent
   *  forever (capture 2026-07-26). */
  served: boolean;
  /** Wall clock at which the record stops being read, stamped at the serve of
   *  the first widget-closed request that reads it - not when the widget
   *  opened, and not when that request started: the window measures time the
   *  developer has the ghost in front of them, not time the model spent
   *  thinking. UNIFORM across preselected and arrowed members: the human's
   *  dictated gesture puts the same 1.5s window on "whatever the last one was
   *  run" (decided 2026-07-26, superseding the earlier indefinite hold for
   *  arrowed choices; the journey and the ruling are in
   *  docs/architecture/vscode-layer.md, "The member-dot journey"). */
  deadline?: number;
}

export interface ScopeState {
  record?: HeldScope;
  /** The current widget session's preselect tracking: its document-state key,
   *  the first (preselect) selection text, and whether the user has since
   *  arrowed off it. Post-close, preselected and arrowed records live the same
   *  lifecycle (uniform window); the active flag's remaining work is refusedAt
   *  (an arrow clears a refusal, a preselect respects it) and ending cleanly
   *  at the widget's close so a reopen reads as a fresh session (b470af7). */
  session?: { key: string; initial: string; active: boolean };
  /** The document state at which the user dismissed a scope by hand. A passive
   *  preselect at that exact state does not become sticky again: dogfooding
   *  showed the widget re-opening moments after a dismissal and re-scoping the
   *  ghost to the very member that was just refused. An ARROW still overrides
   *  it, because that is the user choosing rather than the widget guessing. */
  refusedAt?: string;
  /** The record the LAST onRequest returned a scope from. Without a
   *  `requestId` on the serve event this is the best attribution available;
   *  with one, a stale serve is detected exactly (see onServe). */
  pending?: HeldScope;
  /** The id handed out with the last scope, and the counter minting them. The
   *  drop decision now lives at the serve point, so attribution is
   *  load-bearing: a superseded request's zero-serve mis-attributed to the
   *  live record would drop a scope the user still holds and fire a spurious
   *  re-render. */
  pendingId?: number;
  requestSeq: number;
}

export function createScopeState(): ScopeState {
  return { requestSeq: 0 };
}

// Every path that abandons a record goes through here. The context key is
// derived from record-in-force, so it can never survive the scope it was
// armed for; the window dies with the record (`deadline` lives on it), and
// cancelling the caller's real timer is the caller's half, driven off
// `windowDeadline` going undefined.
function dropRecord(state: ScopeState): void {
  state.record = undefined;
}

export interface ScopeRequestEvent {
  readonly stateKey: string;
  readonly atMemberSite: boolean;
  /** The widget's highlighted text; undefined means the widget is closed. */
  readonly selectedText?: string;
  readonly selectionIsSnippet?: boolean;
  readonly now: number;
}

export interface RequestedScope {
  readonly name: string;
  readonly text: string;
  readonly snippet: boolean;
}

// The scope in force for one request, and every state transition a request
// causes. Expiry is driven by requests as well as by the timer: a record dies
// when some request OBSERVES a state it does not match or a deadline that has
// passed, so a closed window reverts even when the timer's re-render lost the
// race to a keystroke.
//
// A scoped result carries a `requestId`; the caller echoes it on the serve so
// a superseded request's serve cannot act on a record it never read.
export function onRequest(
  state: ScopeState,
  ev: ScopeRequestEvent,
): { scope?: RequestedScope; requestId?: number } {
  state.pending = undefined;
  state.pendingId = undefined;
  if (ev.selectedText !== undefined) {
    if (!ev.atMemberSite) {
      // No member site, so nothing to be sticky about - and whatever was
      // sticky belongs to a cursor the user has left.
      dropRecord(state);
      state.session = undefined;
      return {};
    }
    // The widget's FIRST highlight is a preselect, not a choice: it auto-opens
    // on `.` and auto-highlights its first member. A whole open-arrow-arrow run
    // shares one document state, because arrowing edits nothing and moves the
    // cursor nowhere - so the first selection seen at that state is the
    // preselect, and a selection whose text later DIFFERS is the user pressing
    // up/down. Once a session goes active it stays active, so arrowing back to
    // the first item still counts as a choice.
    if (state.session?.key !== ev.stateKey) {
      state.session = { key: ev.stateKey, initial: ev.selectedText, active: false };
    } else if (ev.selectedText !== state.session.initial) {
      state.session.active = true;
    }
    // A dismissal at this exact state stands until the user does something.
    // An ARROW is that something: it makes the session active, which clears
    // the refusal, so a deliberate choice is never suppressed by an earlier
    // Escape. A widget that merely re-opens on its own is not.
    if (state.session.active) {
      state.refusedAt = undefined;
    } else if (state.refusedAt === ev.stateKey) {
      // Refused means refused. Not scoped, not recorded: the developer said no
      // to this member at this cursor, and re-scoping to it because the widget
      // came back would be the product arguing. The request goes out UNSCOPED,
      // so the model works on what the developer actually wants.
      dropRecord(state);
      return {};
    }
    // A selection that names no member gets no scope. Not a scope named
    // nothing - no scope.
    //
    // This sits AFTER the session tracking on purpose: `[Symbol]` is a real
    // highlight the user can arrow off, and a session that never saw it would
    // read the next arrow as the preselect instead of the choice it is.
    if (!namesAMember(ev.selectedText)) {
      dropRecord(state);
      return {};
    }
    // Whatever the last scoped run was, preselected or arrowed, it survives
    // the Escape the same way: it holds the ghost for PASSIVE_SCOPE_MS after
    // its post-close serve - long enough to Tab a suggestion already on
    // screen, then the ghost reverts to the provider's own most-likely
    // completion (the uniform window, journeys/member-dot-flow.md).
    //
    // The served bit carries over when the record being replaced is the same
    // member at the same state - the editor re-asks without anything having
    // changed - but never across an arrow: a different member's ghost on
    // screen earlier says nothing about this one. The deadline does NOT carry:
    // a reopened widget is a fresh session and its Escape gets a fresh window.
    const name = memberIdentifier(ev.selectedText);
    const prior = state.record;
    const served =
      prior !== undefined &&
      prior.stateKey === ev.stateKey &&
      prior.text === ev.selectedText &&
      prior.served;
    dropRecord(state);
    state.record = {
      stateKey: ev.stateKey,
      text: ev.selectedText,
      name,
      snippet: ev.selectionIsSnippet === true,
      served,
    };
    state.pending = state.record;
    state.requestSeq += 1;
    state.pendingId = state.requestSeq;
    return {
      scope: { name, text: ev.selectedText, snippet: ev.selectionIsSnippet === true },
      requestId: state.pendingId,
    };
  }
  // The widget just closed (Escape, or an accept). End the session so a widget
  // REOPENED at the same untouched state is a fresh one, and its auto-highlight
  // is a passive preselect again. Without this the `active` flag outlives the
  // widget and the reopen's preselect would inherit it - the
  // preselect-becomes-a-choice bug b470af7 removed. The record is left intact
  // here; it is the session TRACKING that ends, not the member the user chose.
  state.session = undefined;
  const held = state.record;
  if (held === undefined) {
    return {};
  }
  // The key is a DOCUMENT STATE, not an editor: two editors on the same
  // document at the same position are the same member site and share one
  // record by design. A request observing any other state expires it.
  if (!ev.atMemberSite || held.stateKey !== ev.stateKey) {
    dropRecord(state);
    return {};
  }
  // A never-served record is NOT dropped here: it holds its scope for the
  // post-close attempt, because snippet members structurally serve nothing
  // while the widget is open and a drop at the close would delete the window
  // for every gopls and rust-analyzer method. The drop decision for that
  // attempt lives at its serve (goal.md triage amendment 2026-07-26).
  //
  // The window closed without the timer having run - a request beat it here.
  // Same disposition either way: the record is gone and this request is
  // unscoped, which is the revert.
  if (held.deadline !== undefined && ev.now >= held.deadline) {
    dropRecord(state);
    return {};
  }
  state.pending = held;
  state.requestSeq += 1;
  state.pendingId = state.requestSeq;
  return {
    scope: { name: held.name, text: held.text, snippet: held.snippet },
    requestId: state.pendingId,
  };
}

export interface ScopeServeEvent {
  /** How many items the request put on screen; zero when everything was
   *  generated-and-dropped or nothing was generated at all. */
  readonly servedCount: number;
  /** Whether the request being served was made with the widget open. */
  readonly widgetOpen: boolean;
  readonly now: number;
  /** The id onRequest handed out with this request's scope. Optional for
   *  compatibility; without it attribution degrades to "the record the last
   *  onRequest returned", which is safe only while the caller cancels
   *  superseded requests before their serves run. */
  readonly requestId?: number;
}

// The serve point, where the scoped attempt's outcome is decided. Stamps the
// served bit, opens the window, and - when the post-close attempt served
// ZERO with nothing ever on screen - drops the record and asks for the
// unscoped re-render. That `rerender` is the immediate hand-back: nothing
// else re-invokes a provider (the Escape re-invocation is not
// platform-guaranteed), so a drop with no active trigger would be the wedge
// back again on its quiet path. Preselected and arrowed records take the
// same path here - the uniform window, journeys/member-dot-flow.md.
//
// The window opens at the serve of the first widget-closed request that read
// the record, whatever that serve's count once the record has served: a
// zero-items serve under a record that served earlier still starts the
// revert clock (fix (c)), because the alternative is the captured wedge - no
// deadline, no timer, no re-render, the scope in force until a cursor move.
//
// Attribution: with a `requestId`, a serve for any request but the latest
// scoped one is a no-op - it neither stamps, opens, nor drops. Without one,
// the record-identity check catches a record that DIED between request and
// serve, but a serve landing after a newer scoped request is attributed to
// that newer record; the drop decision living here is why exact attribution
// is worth threading.
export function onServe(
  state: ScopeState,
  ev: ScopeServeEvent,
): { opensWindowUntil?: number; scopedGhostKey: boolean; rerender?: boolean } {
  const stale =
    (ev.requestId !== undefined && ev.requestId !== state.pendingId) ||
    state.pending === undefined ||
    state.record !== state.pending;
  const rec = stale ? undefined : state.record;
  let opensWindowUntil: number | undefined;
  let rerender = false;
  if (rec !== undefined) {
    if (ev.servedCount > 0) {
      rec.served = true;
      if (!ev.widgetOpen && rec.deadline === undefined) {
        rec.deadline = ev.now + PASSIVE_SCOPE_MS;
        opensWindowUntil = rec.deadline;
      }
    } else if (!ev.widgetOpen) {
      if (!rec.served) {
        // The one post-close attempt served nothing and nothing was ever on
        // screen: there is no suggestion the developer could be reaching
        // for. Hand the site back NOW.
        dropRecord(state);
        rerender = true;
      } else if (rec.deadline === undefined) {
        rec.deadline = ev.now + PASSIVE_SCOPE_MS;
        opensWindowUntil = rec.deadline;
      }
    }
  }
  return {
    ...(opensWindowUntil !== undefined && { opensWindowUntil }),
    scopedGhostKey: state.record !== undefined,
    ...(rerender && { rerender: true }),
  };
}

// The caller's window timer fired. Whether that closes anything is decided
// here, not by the timer: a timer armed for a window the state has since left
// behind finds no due deadline and asks for nothing, so a stale fire can never
// drop a scope the user is looking at.
export function onExpiry(state: ScopeState, now: number): { rerender: boolean } {
  const held = state.record;
  if (held === undefined || held.deadline === undefined || now < held.deadline) {
    return { rerender: false };
  }
  dropRecord(state);
  return { rerender: true };
}

// The fast revert: waiting out PASSIVE_SCOPE_MS is the slow way to the generic
// ghost, and a second Escape is the way with the developer's finger already on
// the key. It applies to an ACTIVE scope too, which otherwise has no way out
// but typing. reached=false means the key fired against a scope already gone
// (an expiry, an edit, a race), and the caller falls back to the editor's own
// Escape rather than eating the developer's keypress.
export function onSecondEscape(state: ScopeState): { reached: boolean; rerender: boolean } {
  const held = state.record;
  if (held === undefined) {
    return { reached: false, rerender: false };
  }
  // Remember WHERE this was refused, so a widget that re-opens at the same
  // untouched state cannot hand the ghost straight back. Without it the
  // gesture flickered: dismissed, plain ghost, widget back, scoped again.
  state.refusedAt = held.stateKey;
  dropRecord(state);
  // The widget session goes with it. Without this a dismissal taken while a
  // widget is somehow still open leaves the session marked, and the next
  // preselect inherits `active` and becomes a permanent choice - the
  // preselect-becomes-a-choice bug b470af7 removed. The keybinding cannot
  // reach that state, and an invariant that holds only while a `when` clause
  // is right is not an invariant.
  state.session = undefined;
  return { reached: true, rerender: true };
}

// A record pins the exact state it was taken at, so a move reported under any
// other key kills it. A move to the SAME key is not a move: arrowing the
// widget moves no cursor, and the Escape re-invocation lands at the position
// the record was taken at. Keys are opaque here, so the caller filters the
// per-editor fan-out first: a background editor's cursor must not kill the
// scope in the file being typed in, and only the caller knows which file a
// key names.
export function onCursorMoved(state: ScopeState, stateKey: string): void {
  if (state.record !== undefined && state.record.stateKey !== stateKey) {
    dropRecord(state);
  }
}

/** Drop the held record outright, whatever its kind - the edit hook's kill.
 *  An edit in the record's own file bumps the version, so the record is
 *  already dead to the next request; what this clears is the window and the
 *  armed key, which do not go through a request. */
export function dropHeldScope(state: ScopeState): void {
  dropRecord(state);
}

/** The held record's state key, for the caller's per-file event filtering. */
export function heldStateKey(state: ScopeState): string | undefined {
  return state.record?.stateKey;
}

/** The held member's bare name, for the caller's log lines. */
export function heldScopeName(state: ScopeState): string | undefined {
  return state.record?.name;
}

/** The open window's deadline, undefined when no window is in force. The
 *  caller cancels its real timer when this goes undefined - the machine's
 *  drops are the decision, the timer is the caller's mirror of it. */
export function windowDeadline(state: ScopeState): number | undefined {
  return state.record?.deadline;
}

/** The context key: a scope is in force. Nothing more - the widget-closed
 *  condition lives in the keybinding's `!suggestWidgetVisible`, which the
 *  editor evaluates live, so arming depends on no post-close event arriving
 *  (goal.md triage amendment 2026-07-26; the serve-armed key was down in
 *  exactly the starved states the second Escape exists for). Read after every
 *  event so drops that happen outside a serve still lower it. */
export function scopedGhostKey(state: ScopeState): boolean {
  return state.record !== undefined;
}
