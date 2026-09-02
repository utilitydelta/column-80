/**
 * Dictate-then-FIM, the VS Code side. Everything decided lives in `src/core/dictationGesture.ts`
 * (the reducer) and `src/core/dictation.ts` (the cleaner and the comment); this file resolves
 * editor state into events and executes the reducer's actions: the recorder child, the resident
 * recogniser, the speaker mute, the cursor-line decoration, the status bar item, and the one
 * FIM request the intent rides on.
 *
 * Rulings this file carries (session-v65 goal.md): the recogniser is resident from activation
 * and the model downloads through a ratified toast like every other model; the indicator goes
 * live on the first audio buffer; partials render while talking and the heard sentence stays
 * while the ghost lives; a dictated ghost lands the cursor on a fresh line at the block's indent
 * with nothing pressed; Remote is refused with one sentence.
 */
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { CaptureTake, classifyCaptureExit, listCaptureDevices, type TakeResult } from "../core/capture";
import { backtickSpokenNames, partialWindow, refusalSentence, timingLine, virtualComment } from "../core/dictation";
import { IDLE, reduce, type Action, type GestureEvent, type GestureState, type Readiness, type RefusalKind, type Site } from "../core/dictationGesture";
import { commentSyntaxFor, cursorInComment } from "../core/fimComment";
import { fimServesLanguage } from "../core/fimLanguages";
import { SPEECH_MODEL, VAD_MODEL, downloadFile, modelPresent, type SpeechModelSpec } from "../core/modelFile";
import { harvestSpokenNames } from "../core/dictationNames";
import { nativeBinaryPath } from "../core/nativeLayout";
import { Recogniser } from "../core/recogniser";
import { muteSpeakers, type MuteHandle } from "../core/speakerMute";
import { commentScanStart, type ArmedIntent } from "./completionProvider";
import { readConfig } from "./config";
import { isDocumentScheme } from "./documentSchemes";

export const DICTATE_COMMAND = "column80.dictate";
export const SELECT_MIC_COMMAND = "column80.selectMicrophone";
export const DOWNLOAD_MODEL_COMMAND = "column80.downloadSpeechModel";
export const DICTATION_ACCEPTED_COMMAND = "column80.dictationAccepted";
export const DISMISS_DICTATION_GHOST_COMMAND = "column80.dismissDictationGhost";
export const DICTATION_GHOST_CONTEXT = "column80.dictationGhost";
export const RECORDING_CONTEXT = "column80.recording";

/** The trailing window a streaming partial decodes, and how often. The spike held a 300ms loop
 *  on a six second window with margin; a longer window costs decode time per tick. */
const PARTIAL_WINDOW_MS = 6000;
const PARTIAL_INTERVAL_MS = 300;
const PULSE_MS = 450;
const REFUSAL_STATUS_MS = 8000;
/** How long a cursor move off the site is held after an edit on it, waiting for the accept
 *  command that follows an accepted ghost. */
const ACCEPT_GRACE_MS = 300;
const DECLINED_KEY = "column80.dictation.modelDeclined";
/** How long after the ghost is served the gesture commits it; the editor needs a frame to
 *  draw the item before the commit command can take it. */
const AUTO_COMMIT_DELAY_MS = 120;
/** How long the heard label stays after the code landed. */
const HEARD_LINGER_MS = 2500;

export interface DictationConfig {
  enabled: boolean;
  microphone: string;
  muteSpeakers: boolean;
  partials: boolean;
  /** Commit the ghost the moment it lands, so the code is in the file and the caret is on
   *  the next line with nothing pressed (the human's ruling, restated on the first real
   *  gesture: "shouldn't it just auto-run FIM and dump the output into the IDE"). Off leaves
   *  the ghost for Tab. */
  autoAccept: boolean;
  /** Resolve the spoken type names into surfaces above the comment. Ruled on by
   *  the pipeline ruling; measured NEGATIVE on 360 sites (phase 7), so it is a
   *  setting rather than a constant. */
  surfaces: boolean;
}

export function readDictationConfig(): DictationConfig {
  const c = vscode.workspace.getConfiguration("column80");
  const s = (key: string, d: string) => {
    const v = c.get<unknown>(key, d);
    return typeof v === "string" ? v : d;
  };
  const b = (key: string, d: boolean) => {
    const v = c.get<unknown>(key, d);
    return typeof v === "boolean" ? v : d;
  };
  return {
    enabled: b("dictation.enabled", true),
    microphone: s("dictation.microphone", ""),
    muteSpeakers: b("dictation.muteSpeakers", true),
    partials: b("dictation.partials", true),
    surfaces: b("dictation.surfaces", true),
    autoAccept: b("dictation.autoAccept", true),
  };
}

export interface DictationWiring {
  armIntent(intent: ArmedIntent): void;
}

interface Paths {
  capture: string;
  server: string;
  model: string;
  vad: string;
}

function resolvePaths(context: vscode.ExtensionContext): Paths {
  const exe = process.platform === "win32" ? ".exe" : "";
  const nativeDir = process.env.COLUMN80_NATIVE_DIR;
  const binary = (name: string) =>
    nativeDir !== undefined && nativeDir !== ""
      ? join(nativeDir, `${name}${exe}`)
      : nativeBinaryPath(context.extensionPath, name, process.platform, process.arch);
  // The headless activation stub has no global storage; the real host always does.
  const modelDir = join(context.globalStorageUri?.fsPath ?? join(tmpdir(), "column80"), "speech");
  return {
    capture: binary("column80-capture"),
    server: binary("whisper-server"),
    model: process.env.COLUMN80_WHISPER_MODEL || join(modelDir, SPEECH_MODEL.file),
    vad: process.env.COLUMN80_VAD_MODEL || join(modelDir, VAD_MODEL.file),
  };
}

export class Dictation implements vscode.Disposable {
  private state: GestureState = IDLE;
  private recogniser: Recogniser | undefined;
  private starting: Promise<void> | undefined;
  private take: CaptureTake | undefined;
  private lastTake: TakeResult | undefined;
  private mutePromise: Promise<MuteHandle> | undefined;
  private partialTimer: ReturnType<typeof setInterval> | undefined;
  private partialInFlight = false;
  private pulseTimer: ReturnType<typeof setInterval> | undefined;
  private pulseOn = false;
  private decoration: vscode.TextEditorDecorationType | undefined;
  private indicatorText = "";
  private indicatorMode: "armed" | "live" | "thinking" | "heard" | "off" = "off";
  private readonly statusItem: vscode.StatusBarItem | undefined;
  private micClosedAt = 0;
  private pendingRoots: string[] = [];
  private holdMovesUntil = 0;
  private gestureId = 0;
  private lingerHeard = false;
  private lingerTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly downloads = new Map<string, Promise<void>>();
  private heldMove: ReturnType<typeof setTimeout> | undefined;
  private fimStartedAt = 0;
  private decodeMs = 0;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly paths: Paths;

  private readonly memento: vscode.Memento | undefined;

  constructor(
    context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly wiring: DictationWiring,
  ) {
    this.paths = resolvePaths(context);
    this.memento = context.globalState;
    this.statusItem =
      typeof vscode.window.createStatusBarItem === "function"
        ? vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101)
        : undefined;
    if (this.statusItem !== undefined) {
      this.statusItem.command = DICTATE_COMMAND;
      this.disposables.push(this.statusItem);
    }
  }

  private log(line: string): void {
    this.output.appendLine(line);
  }

  get phase(): GestureState["phase"] {
    return this.state.phase;
  }

  // ---- the recogniser's life

  /** Start the resident recogniser if the model is on disk; otherwise offer the download, and
   *  start once it lands. Never throws: dictation stays refusable, the rest of the extension
   *  is untouched. */
  /** The OFFER is per call, the DOWNLOAD is single-flight. An unanswered activation toast
   *  folds into the notification bell with its promise still pending; a press must put a
   *  fresh toast in front of the user rather than wait on that one (found by the human on the
   *  first try). Whichever toast is clicked first starts the download; the other joins it. */
  ensureReady(offer: boolean, fromPress: boolean = false): Promise<void> {
    return this.ready(offer, fromPress);
  }

  private async ready(offer: boolean, fromPress: boolean): Promise<void> {
    if (!readDictationConfig().enabled) {
      return;
    }
    if (vscode.env.remoteName !== undefined) {
      // Over Remote the extension host is the server and the mic is on the client; nothing
      // here would ever hear, so no download and no resident process (ruling 4).
      this.log("[dictate] remote host: recogniser not started, dictation refuses");
      return;
    }
    // An env override (tests, the measurement rigs) names a file that may be a different upload
    // of the same model, so presence there is existence, not the spec's byte count.
    const speechPresent = process.env.COLUMN80_WHISPER_MODEL
      ? existsSync(this.paths.model)
      : await modelPresent(this.paths.model, SPEECH_MODEL);
    if (!speechPresent) {
      if (!offer || !(await this.offerModel(fromPress))) {
        return;
      }
    }
    const vadPresent = process.env.COLUMN80_VAD_MODEL ? existsSync(this.paths.vad) : await modelPresent(this.paths.vad, VAD_MODEL);
    if (!vadPresent) {
      // The VAD file is 0.9MB and rides the same consent as the speech model; a failure here
      // costs the silence gate, not dictation.
      await this.fetchModel(VAD_MODEL, this.paths.vad).catch((err) =>
        this.log(`[dictate] vad model download failed: ${String(err)}`),
      );
    }
    await this.startRecogniser();
  }

  /** A declined download is remembered, so activation does not ask again every morning; a
   *  press with the model still missing re-offers, because that is the user asking. */
  private async offerModel(fromPress: boolean): Promise<boolean> {
    if (!fromPress && this.memento?.get<boolean>(DECLINED_KEY) === true) {
      this.log(`[dictate] model not offered: declined earlier; the gesture re-offers`);
      return false;
    }
    this.log(`[dictate] model offered model=${SPEECH_MODEL.file} bytes=${SPEECH_MODEL.bytes}`);
    const pick = await vscode.window.showInformationMessage(
      `Column 80: dictation needs the ${SPEECH_MODEL.name} speech model (${Math.round(SPEECH_MODEL.bytes / 1e6)}MB, whisper.cpp). Download it?`,
      "Download",
    );
    if (pick !== "Download") {
      this.log(`[dictate] model declined model=${SPEECH_MODEL.file}`);
      await this.memento?.update(DECLINED_KEY, true);
      return false;
    }
    await this.memento?.update(DECLINED_KEY, undefined);
    this.log(`[dictate] model ratified model=${SPEECH_MODEL.file}`);
    try {
      await this.fetchModel(SPEECH_MODEL, this.paths.model);
      return true;
    } catch (err) {
      this.log(`[dictate] model download failed model=${SPEECH_MODEL.file}: ${String(err)}`);
      void vscode.window.showWarningMessage(`Column 80: the speech model download failed: ${String(err)}`);
      return false;
    }
  }

  private fetchModel(spec: SpeechModelSpec, dest: string): Promise<void> {
    const inFlight = this.downloads.get(dest);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const run = this.fetchModelOnce(spec, dest).finally(() => this.downloads.delete(dest));
    this.downloads.set(dest, run);
    return run;
  }

  private async fetchModelOnce(spec: SpeechModelSpec, dest: string): Promise<void> {
    mkdirSync(join(dest, ".."), { recursive: true });
    if (existsSync(dest)) {
      return;
    }
    const started = Date.now();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Column 80: downloading ${spec.file}…`, cancellable: true },
      async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        let reported = 0;
        await downloadFile(spec.url, dest, {
          signal: controller.signal,
          sha256: spec.sha256,
          onProgress: (fraction) => {
            if (fraction === undefined) {
              return;
            }
            const pct = Math.floor(fraction * 100);
            if (pct > reported) {
              progress.report({ increment: pct - reported, message: `${pct}%` });
              reported = pct;
            }
          },
        });
      },
    );
    this.log(`[dictate] model done model=${spec.file} ms=${Date.now() - started}`);
  }

  private startRecogniser(): Promise<void> {
    if (this.recogniser?.alive) {
      return Promise.resolve();
    }
    if (this.starting !== undefined) {
      return this.starting;
    }
    this.starting = Recogniser.start({
      binary: this.paths.server,
      model: this.paths.model,
      vadModel: existsSync(this.paths.vad) ? this.paths.vad : undefined,
      log: (line) => this.log(line),
    })
      .then((rec) => {
        this.recogniser = rec;
      })
      .catch(() => undefined)
      .finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }

  stopRecogniser(): void {
    this.recogniser?.dispose();
    this.recogniser = undefined;
  }

  // ---- events in

  dispatch(event: GestureEvent): void {
    const step = reduce(this.state, event);
    const before = this.state.phase;
    this.state = step.state;
    for (const action of step.actions) {
      try {
        this.execute(action);
      } catch (err) {
        this.log(`[dictate] action ${action.type} failed: ${String(err)}`);
      }
    }
    if (before !== this.state.phase) {
      this.syncContextKeys();
      if (this.state.phase === "ghost") {
        this.autoCommit();
      }
    }
  }

  /** The two keybinding gates follow the PHASE, so no path can leave one raised. */
  private syncContextKeys(): void {
    const phase = this.state.phase;
    void vscode.commands.executeCommand("setContext", RECORDING_CONTEXT, phase === "arming" || phase === "recording");
    void vscode.commands.executeCommand("setContext", DICTATION_GHOST_CONTEXT, phase === "ghost");
  }

  /** The shortcut. Everything the reducer needs to decide is read here, once. */
  press(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      this.log("[dictate] refused: no active editor");
      void vscode.window.setStatusBarMessage("Column 80: dictation needs an editor with a cursor.", REFUSAL_STATUS_MS);
      return;
    }
    const config = readDictationConfig();
    if (!config.enabled) {
      this.log("[dictate] refused: disabled by column80.dictation.enabled");
      void vscode.window.setStatusBarMessage("Column 80: dictation is off (column80.dictation.enabled).", REFUSAL_STATUS_MS);
      return;
    }
    if (!readConfig().enabled) {
      // Keystroke FIM off, dictation on: the provider serves a dictated request regardless.
      this.log("[dictate] keystroke FIM is off (column80.enabled); the dictated request is served anyway");
    }
    const document = editor.document;
    const position = editor.selection.active;
    const syntax = commentSyntaxFor(document.languageId);
    const inComment =
      syntax !== undefined &&
      cursorInComment(document.getText(new vscode.Range(commentScanStart(document, position), position)), syntax).inComment;
    const indent = /^[ \t]*/.exec(document.lineAt(position.line).text)?.[0] ?? "";
    const ready: Readiness = {
      remote: vscode.env.remoteName !== undefined,
      binaryPresent: existsSync(this.paths.capture) && existsSync(this.paths.server),
      modelPresent: existsSync(this.paths.model),
      recogniserAlive: this.recogniser?.alive === true,
      served: fimServesLanguage(document.languageId, readConfig().fimLanguages),
      commentRow: syntax !== undefined,
      inComment,
      platform: `${process.platform}-${process.arch}`,
    };
    if (!ready.recogniserAlive && ready.modelPresent && ready.binaryPresent) {
      // A recogniser that died is restarted for the NEXT press; this one refuses honestly.
      void this.startRecogniser();
    }
    this.dispatch({
      type: "press",
      site: { uri: document.uri.toString(), line: position.line },
      languageId: document.languageId,
      indentColumns: indent.replace(/\t/g, "    ").length,
      now: Date.now(),
      ready,
      ghostVisible: this.state.phase === "ghost",
    });
  }

  onDocumentChanged(e: vscode.TextDocumentChangeEvent): void {
    if ((this.state.phase !== "ghost" && this.state.phase !== "requesting") || e.contentChanges.length === 0) {
      return;
    }
    // The Output panel is a text document too, and every channel line the gesture writes
    // changes it; only a real document can be "the site left" (the human's first live
    // gestures went idle on their own log lines).
    if (!isDocumentScheme(e.document.uri.scheme)) {
      return;
    }
    const first = e.contentChanges[0];
    const site = { uri: e.document.uri.toString(), line: first.range.start.line };
    if (this.state.phase === "ghost" && this.state.site !== undefined && site.uri === this.state.site.uri && site.line === this.state.site.line) {
      // An accept lands as an edit on the site line, then the cursor moves to the fresh line,
      // and only THEN does the item's command run. Without a grace the move would read as
      // "site left" and the accept would arrive in idle (measured in the host tier).
      this.holdMovesUntil = Date.now() + ACCEPT_GRACE_MS;
    }
    this.dispatch({ type: "edit", site });
  }

  onSelectionChanged(e: vscode.TextEditorSelectionChangeEvent): void {
    if (this.state.phase !== "ghost" && this.state.phase !== "requesting") {
      return;
    }
    if (!isDocumentScheme(e.textEditor.document.uri.scheme)) {
      return;
    }
    const site = { uri: e.textEditor.document.uri.toString(), line: e.selections[0].active.line };
    if (this.state.phase === "ghost" && Date.now() < this.holdMovesUntil) {
      if (this.heldMove !== undefined) {
        clearTimeout(this.heldMove);
      }
      this.heldMove = setTimeout(() => {
        this.heldMove = undefined;
        if (this.state.phase === "ghost") {
          this.dispatch({ type: "cursor-moved", site });
        }
      }, ACCEPT_GRACE_MS);
      return;
    }
    this.dispatch({ type: "cursor-moved", site });
  }

  /** The accepted command arrived: the held move, if any, is the accept's own. */
  accepted(): void {
    if (this.heldMove !== undefined) {
      clearTimeout(this.heldMove);
      this.heldMove = undefined;
    }
    this.holdMovesUntil = 0;
    // The heard label stays on screen a moment after the code lands, so the user can read
    // what the line was written from; the reducer's `off` is deferred for it.
    this.lingerHeard = true;
    this.dispatch({ type: "accepted" });
  }

  /** The ghost landed: commit it now through the editor's own inline-suggest commit, the
   *  same path Tab takes, so the only writes are still the accepted ghost and its newline. */
  private autoCommit(): void {
    if (!readDictationConfig().autoAccept) {
      return;
    }
    setTimeout(() => {
      if (this.state.phase !== "ghost") {
        return;
      }
      void Promise.resolve(vscode.commands.executeCommand("editor.action.inlineSuggest.commit")).then(
        () => this.log("[dictate] ghost committed by the gesture"),
        (err) => this.log(`[dictate] auto-commit failed: ${String(err)}`),
      );
    }, AUTO_COMMIT_DELAY_MS);
  }

  // ---- actions out

  private execute(action: Action): void {
    switch (action.type) {
      case "log":
        this.log(action.line);
        return;
      case "hide-ghost":
        void vscode.commands.executeCommand("editor.action.inlineSuggest.hide").then(undefined, () => undefined);
        return;
      case "mute":
        if (readDictationConfig().muteSpeakers) {
          this.mutePromise = muteSpeakers(process.platform).then((h) => {
            if (h.reason !== undefined) {
              this.log(`[dictate] speakers: ${h.reason}`);
            }
            return h;
          });
        }
        return;
      case "unmute": {
        const pending = this.mutePromise;
        this.mutePromise = undefined;
        void pending?.then((h) => h.restore());
        return;
      }
      case "start-capture":
        this.startCapture();
        return;
      case "stop-capture":
        this.stopCapture();
        return;
      case "abort-capture":
        this.clearPartials();
        this.take?.abort();
        this.take = undefined;
        return;
      case "indicator":
        this.renderIndicator(action.mode, action.text);
        return;
      case "transcribe":
        this.transcribe();
        return;
      case "build-intent":
        this.buildIntent(action.sentence, action.languageId, action.indentColumns);
        return;
      case "trigger-fim":
        this.triggerFim(action.site, action.comment);
        return;
      case "refuse":
        this.refuse(action.kind, action.detail);
        return;
      default:
        return;
    }
  }

  private startCapture(): void {
    const device = readDictationConfig().microphone;
    const take = CaptureTake.start(this.paths.capture, device === "" ? undefined : device, {
      onFirstBuffer: (ms) => {
        if (this.take === take) {
          this.dispatch({ type: "first-buffer", msSincePress: ms });
          this.startPartials(take);
        }
      },
      onExit: (result) => {
        if (this.take === take) {
          this.clearPartials();
          this.take = undefined;
          this.dispatch({
            type: "stopped",
            pcmBytes: result.pcm.length,
            failure: classifyCaptureExit(result.exitCode) ?? "failed",
            stderr: result.stderr,
          });
        }
      },
    });
    this.take = take;
  }

  private stopCapture(): void {
    const take = this.take;
    this.take = undefined;
    this.clearPartials();
    this.micClosedAt = Date.now();
    if (take === undefined) {
      this.dispatch({ type: "stopped", pcmBytes: 0 });
      return;
    }
    void take.stop().then((result) => {
      this.lastTake = result;
      const failure = classifyCaptureExit(result.exitCode);
      this.dispatch(
        failure === undefined
          ? { type: "stopped", pcmBytes: result.pcm.length }
          : { type: "stopped", pcmBytes: result.pcm.length, failure, stderr: result.stderr },
      );
    });
  }

  private startPartials(take: CaptureTake): void {
    if (!readDictationConfig().partials) {
      return;
    }
    this.clearPartials();
    this.partialTimer = setInterval(() => {
      const rec = this.recogniser;
      if (this.partialInFlight || rec === undefined || !rec.alive || this.take !== take) {
        return;
      }
      const pcm = take.pcm;
      const totalMs = pcm.length / 32;
      if (totalMs < 500) {
        return;
      }
      const window = partialWindow(totalMs, PARTIAL_WINDOW_MS);
      this.partialInFlight = true;
      rec
        .transcribe(pcm, { offsetMs: window.offsetMs, durationMs: window.durationMs, vad: false })
        .then((t) => {
          if (this.take === take && this.state.phase === "recording") {
            this.dispatch({ type: "partial", text: (window.offsetMs > 0 ? "… " : "") + t.text.replace(/\s+/g, " ").trim() });
          }
        })
        .catch(() => undefined)
        .finally(() => {
          this.partialInFlight = false;
        });
    }, PARTIAL_INTERVAL_MS);
  }

  private clearPartials(): void {
    if (this.partialTimer !== undefined) {
      clearInterval(this.partialTimer);
      this.partialTimer = undefined;
    }
  }

  private transcribe(): void {
    const rec = this.recogniser;
    const take = this.lastTake;
    if (rec === undefined || !rec.alive || take === undefined) {
      this.dispatch({ type: "error", message: refusalSentence("server-down") });
      return;
    }
    rec
      .transcribe(take.pcm)
      .then((t) => {
        this.decodeMs = t.decodeMs;
        this.dispatch({ type: "transcript", text: t.text, decodeMs: t.decodeMs });
      })
      .catch((err) => this.dispatch({ type: "error", message: String(err) }));
  }

  private buildIntent(sentence: string, languageId: string, indentColumns: number): void {
    const editor = vscode.window.activeTextEditor;
    const names = editor === undefined ? [] : harvestSpokenNames(editor.document.getText());
    const ticked = backtickSpokenNames(sentence, names);
    if (ticked.matched.length > 0 || ticked.refused.length > 0) {
      this.log(
        `[dictate] backticks: matched=${ticked.matched.map((m) => m.identifier).join(",") || "none"}` +
          ` refused=${ticked.refused.map((r) => `${r.phrase}→${r.identifier}(${r.reason})`).join(",") || "none"}`,
      );
    }
    const comment = virtualComment(ticked.text, languageId, indentColumns);
    if (comment === undefined) {
      this.dispatch({ type: "error", message: refusalSentence("no-comment-row", languageId) });
      return;
    }
    // The spoken TYPE names go to the resolver first; a ticked function or field name is
    // prose for the model, not a root.
    const typeNames = new Set(names.filter((n) => n.kind === "type").map((n) => n.name));
    this.pendingRoots = readDictationConfig().surfaces
      ? ticked.matched.map((m) => m.identifier).filter((id, i, all) => typeNames.has(id) && all.indexOf(id) === i)
      : [];
    this.dispatch({ type: "intent", comment, matched: ticked.matched.length, refused: ticked.refused.length });
  }

  private triggerFim(site: Site, comment: string): void {
    void this.focusSiteThenTrigger(site, comment);
  }

  /** The inline-suggest trigger acts on the ACTIVE editor. When the mic closes with the
   *  Output panel or a terminal focused (the human was reading the log), the trigger goes
   *  nowhere and the armed intent waits for a click; so the site's editor is brought to the
   *  front first. */
  private async focusSiteThenTrigger(site: Site, comment: string): Promise<void> {
    let editor = vscode.window.activeTextEditor;
    if (editor === undefined || editor.document.uri.toString() !== site.uri) {
      const open = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === site.uri);
      if (open === undefined) {
        this.dispatch({ type: "error", message: "the editor moved away from the dictated line" });
        return;
      }
      try {
        editor = await vscode.window.showTextDocument(open.document, { viewColumn: open.viewColumn, preserveFocus: false });
        this.log("[dictate] focus returned to the dictated editor for the request");
      } catch (err) {
        this.dispatch({ type: "error", message: `could not focus the dictated editor: ${String(err)}` });
        return;
      }
    }
    if (this.state.phase !== "requesting") {
      return;
    }
    this.armAndTrigger(editor, site, comment);
  }

  private armAndTrigger(editor: vscode.TextEditor, site: Site, comment: string): void {
    if (site.line >= editor.document.lineCount) {
      this.dispatch({ type: "error", message: "the dictated line is gone" });
      return;
    }
    const line = editor.document.lineAt(site.line).text;
    const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
    const eol = editor.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    // The caret goes to the press line, and never inside its leading whitespace. A request
    // from column 0 of an indented empty line injects the comment unindented and leaves the
    // indent AFTER the cursor; the model served nothing in the host tier and an unindented
    // ghost Tab would not take for the human. The end of the indent is the proven shape.
    const caret = editor.selection.active;
    const target =
      caret.line !== site.line
        ? editor.document.lineAt(site.line).range.end
        : caret.character < indent.length
          ? new vscode.Position(site.line, indent.length)
          : caret;
    if (!target.isEqual(caret)) {
      editor.selection = new vscode.Selection(target, target);
      if (typeof editor.revealRange === "function") {
        editor.revealRange(new vscode.Range(target, target));
      }
      this.log(`[dictate] caret moved to ${target.line}:${target.character} for the request`);
    }
    this.fimStartedAt = Date.now();
    // Every armed intent is its own gesture for the answer's sake: an earlier intent the
    // provider never consumed answers `false` when it is replaced, and that answer must not
    // end this one.
    this.gestureId += 1;
    const gestureId = this.gestureId;
    this.wiring.armIntent({
      id: gestureId,
      uri: site.uri,
      line: site.line,
      comment,
      roots: this.pendingRoots,
      eol,
      indent,
      onServed: (ghost) => {
        if (gestureId !== this.gestureId) {
          this.log(`[dictate] served answer for an earlier gesture ignored (ghost=${ghost})`);
          return;
        }
        const now = Date.now();
        this.log(
          timingLine({
            pressToFirstBufferMs: this.state.firstBufferMs,
            takeMs: this.micClosedAt - (this.state.pressedAt ?? this.micClosedAt),
            decodeMs: this.decodeMs,
            fimMs: now - this.fimStartedAt,
            micCloseToGhostMs: now - this.micClosedAt,
          }),
        );
        this.dispatch({ type: "served", ghost });
      },
    });
    // HIDE, then trigger, always. The explicit trigger preserves whatever item is drawn and
    // re-selects it, with the new item parked behind (docs/architecture/vscode-layer.md, "The
    // explicit trigger preserves the drawn item"); a plain FIM ghost drawn before the press was
    // what the gesture committed on the human's box while the dictated serve sat at index 1.
    void Promise.resolve(vscode.commands.executeCommand("editor.action.inlineSuggest.hide"))
      .then(undefined, () => undefined)
      .then(() => vscode.commands.executeCommand("editor.action.inlineSuggest.trigger"))
      .then(undefined, (err) => this.dispatch({ type: "error", message: `the inline suggestion trigger failed: ${String(err)}` }));
  }

  private refuse(kind: RefusalKind, detail?: string): void {
    const sentence =
      kind === "in-comment"
        ? "Column 80: the cursor is inside a comment; dictation writes code, not the spec."
        : kind === "not-served"
          ? `Column 80: FIM does not serve ${detail ?? "this language"}; add it to column80.fimLanguages first.`
          : kind === "failed"
            ? `Column 80: dictation stopped: ${detail ?? "unknown error"}`
            : refusalSentence(kind, detail);
    void vscode.window.setStatusBarMessage(sentence, REFUSAL_STATUS_MS);
    if (kind === "model-missing") {
      void this.ensureReady(true, true);
    }
  }

  // ---- the indicator

  private renderIndicator(mode: "armed" | "live" | "thinking" | "heard" | "off", text?: string): void {
    if (mode === "off" && this.lingerHeard && this.indicatorMode === "heard") {
      this.lingerHeard = false;
      if (this.lingerTimer !== undefined) {
        clearTimeout(this.lingerTimer);
      }
      this.lingerTimer = setTimeout(() => {
        this.lingerTimer = undefined;
        if (this.indicatorMode === "heard") {
          this.renderIndicator("off");
        }
      }, HEARD_LINGER_MS);
      this.paintStatus();
      this.paintDecoration();
      return;
    }
    this.lingerHeard = false;
    this.indicatorMode = mode;
    this.indicatorText = text ?? "";
    if (mode === "live") {
      if (this.pulseTimer === undefined) {
        this.pulseTimer = setInterval(() => {
          this.pulseOn = !this.pulseOn;
          this.paintDecoration();
        }, PULSE_MS);
      }
    } else {
      if (this.pulseTimer !== undefined) {
        clearInterval(this.pulseTimer);
        this.pulseTimer = undefined;
      }
      this.pulseOn = false;
    }
    this.paintStatus();
    this.paintDecoration();
  }

  private paintStatus(): void {
    const item = this.statusItem;
    if (item === undefined) {
      return;
    }
    switch (this.indicatorMode) {
      case "armed":
        item.text = "$(record) opening mic…";
        item.backgroundColor = undefined;
        item.show();
        return;
      case "live":
        item.text = "$(record) Column 80 listening";
        item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        item.show();
        return;
      case "thinking":
        item.text = "$(sync~spin) Column 80 hearing…";
        item.backgroundColor = undefined;
        item.show();
        return;
      case "heard":
        item.text = "$(mic) heard";
        item.backgroundColor = undefined;
        item.show();
        return;
      default:
        item.hide();
    }
  }

  private paintDecoration(): void {
    const editor = vscode.window.activeTextEditor;
    this.decoration?.dispose();
    this.decoration = undefined;
    if (editor === undefined || this.indicatorMode === "off" || this.indicatorMode === "armed") {
      return;
    }
    const site = this.state.site;
    const line = site !== undefined && site.uri === editor.document.uri.toString() ? site.line : editor.selection.active.line;
    if (line >= editor.document.lineCount) {
      return;
    }
    const glyph =
      this.indicatorMode === "live" ? (this.pulseOn ? "●" : "○") : this.indicatorMode === "thinking" ? "◌" : "🎙";
    // The heard sentence is a LABEL, not code: quoted, prefixed, in the code-lens colour, so it
    // cannot be read as part of the ghost text that renders right before it on the same line.
    const body =
      this.indicatorMode === "live"
        ? this.indicatorText === "" ? "listening…" : this.indicatorText
        : this.indicatorMode === "thinking"
          ? "hearing…"
          : `heard: “${this.indicatorText}”`;
    this.decoration = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: `    ${glyph} ${body}`,
        color: new vscode.ThemeColor(this.indicatorMode === "live" ? "editorWarning.foreground" : "editorCodeLens.foreground"),
        fontStyle: "italic",
        margin: "0 0 0 2em",
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    const end = editor.document.lineAt(line).range.end;
    editor.setDecorations(this.decoration, [new vscode.Range(end, end)]);
  }

  // ---- commands

  async selectMicrophone(): Promise<void> {
    if (!existsSync(this.paths.capture)) {
      void vscode.window.setStatusBarMessage(refusalSentence("binary-missing", `${process.platform}-${process.arch}`), REFUSAL_STATUS_MS);
      return;
    }
    let devices: Awaited<ReturnType<typeof listCaptureDevices>>;
    try {
      devices = await listCaptureDevices(this.paths.capture);
    } catch (err) {
      this.log(`[dictate] device list failed: ${String(err)}`);
      void vscode.window.setStatusBarMessage(`Column 80: could not list microphones: ${String(err)}`, REFUSAL_STATUS_MS);
      return;
    }
    if (devices.length === 0) {
      void vscode.window.setStatusBarMessage(refusalSentence("no-device"), REFUSAL_STATUS_MS);
      return;
    }
    const current = readDictationConfig().microphone;
    const items: (vscode.QuickPickItem & { name: string })[] = [
      { label: "$(circle-filled) System default", description: current === "" ? "current" : undefined, name: "" },
      ...devices.map((d) => ({
        label: `$(mic) ${d.name}`,
        description: [d.default ? "OS default" : undefined, d.name === current ? "current" : undefined].filter(Boolean).join(", ") || undefined,
        name: d.name,
      })),
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: "Column 80: which microphone should dictation use?" });
    if (pick === undefined) {
      return;
    }
    await vscode.workspace.getConfiguration("column80").update("dictation.microphone", pick.name, vscode.ConfigurationTarget.Global);
    this.log(`[dictate] microphone set to ${pick.name === "" ? "the system default" : JSON.stringify(pick.name)}`);
  }

  dispose(): void {
    if (this.lingerTimer !== undefined) {
      clearTimeout(this.lingerTimer);
    }
    this.state = IDLE;
    this.syncContextKeys();
    if (this.heldMove !== undefined) {
      clearTimeout(this.heldMove);
    }
    this.clearPartials();
    if (this.pulseTimer !== undefined) {
      clearInterval(this.pulseTimer);
    }
    this.take?.abort();
    this.decoration?.dispose();
    void this.mutePromise?.then((h) => h.restore());
    this.stopRecogniser();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

export function registerDictation(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  wiring: DictationWiring,
): Dictation {
  const dictation = new Dictation(context, output, wiring);
  context.subscriptions.push(
    dictation,
    vscode.commands.registerCommand(DICTATE_COMMAND, () => dictation.press()),
    vscode.commands.registerCommand(SELECT_MIC_COMMAND, () => dictation.selectMicrophone()),
    vscode.commands.registerCommand(DOWNLOAD_MODEL_COMMAND, () => dictation.ensureReady(true, true)),
    vscode.commands.registerCommand(DICTATION_ACCEPTED_COMMAND, async (...args: unknown[]) => {
      // The post-accept check first, exactly as a plain ghost gets it; then the gesture hears.
      await Promise.resolve(vscode.commands.executeCommand("column80.fimAccepted", ...args)).catch((err) =>
        output.appendLine(`[dictate] post-accept check failed: ${String(err)}`),
      );
      dictation.accepted();
    }),
    vscode.commands.registerCommand(DISMISS_DICTATION_GHOST_COMMAND, async () => {
      await Promise.resolve(vscode.commands.executeCommand("editor.action.inlineSuggest.hide")).catch(() => undefined);
      dictation.dispatch({ type: "dismissed" });
    }),
    vscode.workspace.onDidChangeTextDocument((e) => dictation.onDocumentChanged(e)),
    vscode.window.onDidChangeTextEditorSelection((e) => dictation.onSelectionChanged(e)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("column80.dictation.enabled")) {
        if (readDictationConfig().enabled) {
          void dictation.ensureReady(true);
        } else {
          dictation.stopRecogniser();
          output.appendLine("[dictate] disabled by setting; recogniser stopped");
        }
      }
    }),
  );
  void dictation.ensureReady(true);
  return dictation;
}

