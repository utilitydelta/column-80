/**
 * The dictation gesture as a state machine. Contract: `session-v65/contracts/phase4-gesture.md`.
 *
 * Pure: the vscode adapter feeds events and executes the returned actions in order. Every
 * ruling about the gesture lives here rather than in the adapter, which is what lets the whole
 * gesture be swept headless: one shortcut toggles on and off, turning it off is what generates,
 * the indicator goes live on the FIRST AUDIO BUFFER rather than on the press, each press is its
 * own comment, and a press over a living ghost dismisses it and re-records.
 */
import { cleanTranscript, type DictationRefusal } from "./dictation";

export type Phase = "idle" | "arming" | "recording" | "finalising" | "requesting" | "ghost";

export interface Site {
  uri: string;
  line: number;
}

export interface GestureState {
  phase: Phase;
  site?: Site;
  languageId?: string;
  indentColumns?: number;
  partial?: string;
  heard?: string;
  pressedAt?: number;
  firstBufferMs?: number;
}

export const IDLE: GestureState = { phase: "idle" };

export interface Readiness {
  remote: boolean;
  binaryPresent: boolean;
  modelPresent: boolean;
  recogniserAlive: boolean;
  served: boolean;
  commentRow: boolean;
  inComment: boolean;
  platform?: string;
}

export type CaptureFailureKind = "binary-missing" | "no-device" | "device-denied" | "failed";

export type GestureEvent =
  | { type: "press"; site: Site; languageId: string; indentColumns: number; now: number; ready: Readiness; ghostVisible: boolean }
  | { type: "first-buffer"; msSincePress: number }
  | { type: "partial"; text: string }
  | { type: "stopped"; pcmBytes: number; failure?: CaptureFailureKind; stderr?: string }
  | { type: "transcript"; text: string; decodeMs: number }
  | { type: "intent"; comment: string; matched: number; refused: number }
  | { type: "served"; ghost: boolean }
  | { type: "accepted" }
  | { type: "dismissed" }
  | { type: "edit"; site: Site }
  | { type: "cursor-moved"; site: Site }
  | { type: "error"; message: string }
  /** Escape. `now` only feeds the elapsed figure on the record. */
  | { type: "cancel"; now: number }
  /** The adapter's landing watch: the auto-commit resolved and no edit arrived on the site
   *  inside the grace. The editor never drew the item (session-v66). */
  | { type: "nothing-landed" };

export type RefusalKind = DictationRefusal | "in-comment" | "not-served" | "failed" | "cancelled" | "nothing-landed";

export type Action =
  | { type: "hide-ghost" }
  | { type: "mute" }
  | { type: "unmute" }
  | { type: "start-capture" }
  | { type: "stop-capture" }
  | { type: "abort-capture" }
  /** Drop the armed intent so the next keystroke request cannot consume a cancelled one. */
  | { type: "disarm-intent" }
  | { type: "indicator"; mode: "armed" | "live" | "thinking" | "heard" | "off"; text?: string }
  | { type: "transcribe" }
  | { type: "build-intent"; sentence: string; languageId: string; indentColumns: number }
  | { type: "trigger-fim"; site: Site; comment: string }
  | { type: "refuse"; kind: RefusalKind; detail?: string }
  | { type: "log"; line: string };

export interface Step {
  state: GestureState;
  actions: Action[];
}

const EVENT_TYPES = new Set<string>([
  "press", "first-buffer", "partial", "stopped", "transcript", "intent", "served",
  "accepted", "dismissed", "edit", "cursor-moved", "error", "cancel", "nothing-landed",
]);
const PHASES = new Set<string>(["idle", "arming", "recording", "finalising", "requesting", "ghost"]);
const CAPTURE_PHASES = new Set<Phase>(["arming", "recording", "finalising"]);

const log = (line: string): Action => ({ type: "log", line });
const indicator = (mode: "armed" | "live" | "thinking" | "heard" | "off", text?: string): Action =>
  text === undefined ? { type: "indicator", mode } : { type: "indicator", mode, text };
const ms = (n: number): string => `${Math.round(Number.isFinite(n) ? n : 0)}ms`;

function ignored(state: GestureState, event: GestureEvent): Step {
  return { state, actions: [log(`[dictate] ignored ${event.type} in ${state.phase}`)] };
}

/** The first readiness check that fails, in the ruled order, or undefined when all pass. */
function refusalFor(ready: Readiness, languageId: string): Extract<Action, { type: "refuse" }> | undefined {
  if (ready.remote) {
    return { type: "refuse", kind: "remote" };
  }
  if (!ready.binaryPresent) {
    return { type: "refuse", kind: "binary-missing", detail: typeof ready.platform === "string" && ready.platform !== "" ? ready.platform : "unknown" };
  }
  if (!ready.modelPresent) {
    return { type: "refuse", kind: "model-missing" };
  }
  if (!ready.recogniserAlive) {
    return { type: "refuse", kind: "server-down" };
  }
  if (!ready.served) {
    return { type: "refuse", kind: "not-served", detail: languageId };
  }
  if (!ready.commentRow) {
    return { type: "refuse", kind: "no-comment-row", detail: languageId };
  }
  if (ready.inComment) {
    return { type: "refuse", kind: "in-comment" };
  }
  return undefined;
}

function press(state: GestureState, event: Extract<GestureEvent, { type: "press" }>): Step {
  switch (state.phase) {
    case "idle":
    case "ghost":
    case "requesting": {
      const rerecord = state.phase !== "idle";
      if (state.phase === "idle") {
        const ready = event.ready !== null && typeof event.ready === "object" ? event.ready : ({} as Readiness);
        const refusal = refusalFor(ready, event.languageId);
        if (refusal !== undefined) {
          return { state, actions: [refusal, log(`[dictate] refused: ${refusal.kind}`)] };
        }
      }
      const actions: Action[] = [];
      if (rerecord || event.ghostVisible) {
        actions.push({ type: "hide-ghost" });
      }
      actions.push({ type: "mute" }, { type: "start-capture" }, indicator("armed"));
      actions.push(log(`[dictate] press at ${event.site.uri}:${event.site.line}${rerecord ? " (re-record)" : ""}`));
      return {
        state: {
          phase: "arming",
          site: event.site,
          languageId: event.languageId,
          indentColumns: event.indentColumns,
          pressedAt: event.now,
        },
        actions,
      };
    }
    case "arming":
      return {
        state: IDLE,
        actions: [{ type: "abort-capture" }, { type: "unmute" }, indicator("off"), log("[dictate] cancelled before the mic opened")],
      };
    case "recording":
      return {
        state: { ...state, phase: "finalising" },
        actions: [{ type: "stop-capture" }, indicator("thinking"), log(`[dictate] stop after ${ms(event.now - (state.pressedAt ?? event.now))}`)],
      };
    default:
      return ignored(state, event);
  }
}

function endWithRefusal(kind: RefusalKind, line: string, detail?: string): Step {
  const refuse: Action = detail === undefined ? { type: "refuse", kind } : { type: "refuse", kind, detail };
  return { state: IDLE, actions: [{ type: "unmute" }, indicator("off"), refuse, log(line)] };
}

function stopped(state: GestureState, event: Extract<GestureEvent, { type: "stopped" }>): Step {
  if (state.phase === "finalising") {
    if (event.failure !== undefined) {
      return endWithRefusal(event.failure, `[dictate] capture failed: ${event.failure}`, event.stderr);
    }
    if (!(event.pcmBytes > 0)) {
      return endWithRefusal("empty-transcript", "[dictate] no audio captured");
    }
    return { state, actions: [{ type: "transcribe" }] };
  }
  if (state.phase === "arming" || state.phase === "recording") {
    const failure = event.failure ?? "failed";
    return endWithRefusal(failure, `[dictate] capture failed: ${failure}`, event.stderr);
  }
  return ignored(state, event);
}

function transcript(state: GestureState, event: Extract<GestureEvent, { type: "transcript" }>): Step {
  if (state.phase !== "finalising") {
    return ignored(state, event);
  }
  const cleaned = cleanTranscript(event.text);
  if (cleaned.sentence === "") {
    return endWithRefusal("empty-transcript", `[dictate] heard nothing (decode=${ms(event.decodeMs)})`);
  }
  const stripped = cleaned.stripped.length > 0 ? `, stripped: ${cleaned.stripped.join(", ")}` : "";
  return {
    state: { ...state, phase: "requesting", heard: cleaned.sentence },
    actions: [
      { type: "unmute" },
      indicator("heard", cleaned.sentence),
      log(`[dictate] heard: ${cleaned.sentence} (decode=${ms(event.decodeMs)}${stripped})`),
      { type: "build-intent", sentence: cleaned.sentence, languageId: state.languageId ?? "", indentColumns: state.indentColumns ?? 0 },
    ],
  };
}

function siteLeft(state: GestureState, event: Extract<GestureEvent, { type: "edit" | "cursor-moved" }>): Step {
  if (state.phase !== "ghost" && state.phase !== "requesting") {
    return ignored(state, event);
  }
  const here = event.site;
  const same = state.site !== undefined && here !== null && typeof here === "object" && here.uri === state.site.uri && here.line === state.site.line;
  if (same) {
    return ignored(state, event);
  }
  return { state: IDLE, actions: [indicator("off"), log("[dictate] site left")] };
}

function error(state: GestureState, event: Extract<GestureEvent, { type: "error" }>): Step {
  const line = log(`[dictate] error: ${event.message}`);
  if (state.phase === "idle") {
    return { state, actions: [line] };
  }
  const actions: Action[] = [];
  if (CAPTURE_PHASES.has(state.phase)) {
    actions.push({ type: "abort-capture" });
  }
  actions.push({ type: "unmute" }, indicator("off"), { type: "refuse", kind: "failed", detail: event.message }, line);
  return { state: IDLE, actions };
}

/** Escape: the way out of every phase. The capture phases abort the take; `requesting` drops
 *  the armed intent so a late answer has nothing to land on; a drawn ghost is dismissed. */
function cancel(state: GestureState, event: Extract<GestureEvent, { type: "cancel" }>): Step {
  const refuse: Action = { type: "refuse", kind: "cancelled" };
  switch (state.phase) {
    case "arming":
      return { state: IDLE, actions: [{ type: "abort-capture" }, { type: "unmute" }, indicator("off"), refuse, log("[dictate] cancelled by Escape before the mic opened")] };
    case "recording": {
      const now = typeof event.now === "number" && Number.isFinite(event.now) ? event.now : undefined;
      const elapsed = now !== undefined && state.pressedAt !== undefined ? now - state.pressedAt : 0;
      return { state: IDLE, actions: [{ type: "abort-capture" }, { type: "unmute" }, indicator("off"), refuse, log(`[dictate] cancelled by Escape after ${ms(elapsed)}`)] };
    }
    case "finalising":
      return { state: IDLE, actions: [{ type: "abort-capture" }, { type: "unmute" }, indicator("off"), refuse, log("[dictate] cancelled by Escape while decoding")] };
    case "requesting":
      return { state: IDLE, actions: [{ type: "disarm-intent" }, { type: "unmute" }, indicator("off"), refuse, log("[dictate] cancelled by Escape while requesting")] };
    case "ghost":
      return { state: IDLE, actions: [indicator("off"), log("[dictate] ghost dismissed")] };
    default:
      return ignored(state, event);
  }
}

export function reduce(state: GestureState, event: GestureEvent): Step {
  if (state === null || typeof state !== "object" || !PHASES.has((state as GestureState).phase)) {
    return { state: IDLE, actions: [] };
  }
  if (event === null || typeof event !== "object" || !EVENT_TYPES.has((event as GestureEvent).type)) {
    return { state: IDLE, actions: [] };
  }
  switch (event.type) {
    case "press":
      return press(state, event);
    case "first-buffer":
      if (state.phase !== "arming") {
        return ignored(state, event);
      }
      return {
        state: { ...state, phase: "recording", firstBufferMs: event.msSincePress },
        actions: [indicator("live", ""), log(`[dictate] mic live press-to-first-buffer=${ms(event.msSincePress)}`)],
      };
    case "partial": {
      if (state.phase !== "recording") {
        return ignored(state, event);
      }
      const text = typeof event.text === "string" ? event.text.replace(/\s+/g, " ").trim() : "";
      return { state: { ...state, partial: text }, actions: [indicator("live", text)] };
    }
    case "stopped":
      return stopped(state, event);
    case "transcript":
      return transcript(state, event);
    case "intent":
      if (state.phase !== "requesting" || state.site === undefined) {
        return ignored(state, event);
      }
      return {
        state,
        actions: [
          { type: "trigger-fim", site: state.site, comment: event.comment },
          log(`[dictate] intent matched=${event.matched} refused=${event.refused}`),
        ],
      };
    case "served":
      if (state.phase !== "requesting") {
        return ignored(state, event);
      }
      if (event.ghost) {
        const { partial: _partial, ...rest } = state;
        return { state: { ...rest, phase: "ghost" }, actions: [log("[dictate] ghost served")] };
      }
      return { state: IDLE, actions: [indicator("off"), log("[dictate] no ghost for the intent")] };
    case "accepted":
      if (state.phase !== "ghost") {
        return ignored(state, event);
      }
      return { state: IDLE, actions: [indicator("off"), log("[dictate] ghost accepted")] };
    case "dismissed":
      if (state.phase !== "ghost" && state.phase !== "requesting") {
        return ignored(state, event);
      }
      return { state: IDLE, actions: [indicator("off"), log("[dictate] ghost dismissed")] };
    case "edit":
    case "cursor-moved":
      return siteLeft(state, event);
    case "error":
      return error(state, event);
    case "cancel":
      return cancel(state, event);
    case "nothing-landed":
      if (state.phase !== "ghost") {
        return ignored(state, event);
      }
      return {
        state: IDLE,
        actions: [indicator("off"), { type: "refuse", kind: "nothing-landed" }, log("[dictate] nothing landed: no edit arrived on the site after the commit")],
      };
    default:
      return { state: IDLE, actions: [] };
  }
}
