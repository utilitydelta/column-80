import * as vscode from "vscode";
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  HardwareProbe,
  ProbeCommandFn,
  ProbeHardwareOptions,
  ollamaInstalled,
  probeCommandRunner,
  probeHardware,
} from "../core/hardware";
import { listModels, pullModel } from "../core/ollama";
import { TIER_TABLE, TierId, TierRow, TierSelection, applyTier, computeTier, tierLogLine } from "../core/tiers";
import { isRemoteApiBase } from "../core/config";
import { readCloudConfig, readConfig, readFnGenConfig, readTierConfig } from "./config";

// First-run tier flow, the modelPull pattern ported from the
// human-replay-vscode-extension's src/modelPull.ts (same author): detect
// what's missing, offer each fix as a one-click gesture the human ratifies.
// The invariant nothing here may bend: no download ever starts without a
// logged ratify event, and declining leaves the extension honest about what
// is disabled. Contract: docs/architecture/hardware-tiers.md.
//
// offerModelPull below is the ONLY caller of core's pullModel in the vscode
// layer - that sole-caller shape is what makes never-auto-pull structural,
// and the impl oracle asserts it over the source.

/** Test seams: every side effect that is not a vscode UI gesture. The UI
 *  itself is driven through vscode, which the impl oracle stubs. */
export interface FirstRunDeps {
  probe?: ProbeHardwareOptions;
  listModels?: typeof listModels;
  pull?: typeof pullModel;
  /** The `ollama --version` PATH check for startOllamaTerminal (default: real
   *  spawn). Injected so the server-down consent path is testable without a host
   *  ollama and without a real process. */
  ollamaCheck?: ProbeCommandFn;
}

const FIRST_RUN_KEY = "column80.firstRunDone";

// Honest one-liners per tier for the QuickPick; package.json's
// enumDescriptions carry the same facts for the settings UI.
const TIER_DESCRIPTIONS: Record<TierId, string> = {
  "24gb": "24GB+ VRAM: both models fully GPU-resident (provisional, never validated on real hardware)",
  "16gb-large-ram":
    "16GB VRAM, 32GB+ RAM: 30b layer-capped at num_gpu=30 beside a fully resident FIM model (the reference config)",
  "16gb-low-ram": "12-16GB VRAM or low RAM: dense 14b function generation, no carve needed",
  "below-12gb": "Below 12GB or no GPU: FIM completion only, function generation disabled",
};

// A tier forced by the hardwareTier setting: the row supplies the model
// facts; the message names the SETTING as the reason, because the honest
// explanation for a disabled override is the human's own choice, not a
// hardware claim computeTier never made.
function overrideSelection(id: TierId): TierSelection {
  const row = TIER_TABLE.find((r) => r.id === id) as TierRow;
  if (row.fnGenModel === undefined) {
    return {
      id: row.id,
      fnGenEnabled: false,
      provisional: row.provisional,
      message: `Function generation is disabled: the hardwareTier setting is '${id}'. FIM tab-completion still works.`,
    };
  }
  return {
    id: row.id,
    fnGenEnabled: true,
    fnGenModel: row.fnGenModel,
    ...(row.fnGenNumGpu !== undefined ? { fnGenNumGpu: row.fnGenNumGpu } : {}),
    provisional: row.provisional,
  };
}

/** Resolve the effective tier for this session: the hardwareTier setting when
 *  overridden, else computeTier over a fresh probe. Emits the [carve] probe
 *  and tier evidence lines. */
export async function resolveTier(
  output: vscode.OutputChannel,
  probeOpts?: ProbeHardwareOptions,
): Promise<{ probe: HardwareProbe; selection: TierSelection }> {
  // The probe always runs - it is one process spawn and its evidence line
  // renders real values even when an override skips it for selection.
  const probe = await probeHardware({ ...probeOpts, log: (line) => output.appendLine(line) });
  const tierConfig = readTierConfig();
  if (tierConfig.hardwareTier === "auto") {
    // The probe's own verdict on whether the model shares one pool with the
    // toolchain rides through, for the one thing that hangs on it: no CUDA layer
    // carve on Metal (session-v34 item 4).
    const selection = computeTier(probe.vramMB, probe.ramMB, { unifiedMemory: probe.unifiedMemory });
    output.appendLine(tierLogLine(selection, probe.vramMB, probe.ramMB, "auto"));
    return { probe, selection };
  }
  const selection = overrideSelection(tierConfig.hardwareTier);
  output.appendLine(tierLogLine(selection, probe.vramMB, probe.ramMB, "override"));
  return { probe, selection };
}

/** Probe -> offer the computed tier as the default -> let the human override
 *  -> persist the pick -> offer ratified pulls for whatever the tier needs
 *  and disk lacks. Runs once per install (globalState-gated) and on demand
 *  via column80.selectHardwareTier. */
export async function runFirstRunFlow(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  deps: FirstRunDeps = {},
): Promise<void> {
  void context;
  const probe = await probeHardware({ ...deps.probe, log: (line) => output.appendLine(line) });
  const computed = computeTier(probe.vramMB, probe.ramMB, { unifiedMemory: probe.unifiedMemory });
  output.appendLine(tierLogLine(computed, probe.vramMB, probe.ramMB, "auto"));

  const picked = await pickTier(computed);
  if (picked === undefined) {
    return; // dismissed: change nothing, ask nothing
  }
  let selection = computed;
  if (picked !== "auto") {
    // An explicit pick persists; accepting the computed default keeps
    // hardwareTier "auto" so a hardware change re-adapts.
    await vscode.workspace
      .getConfiguration("column80")
      .update("hardwareTier", picked, vscode.ConfigurationTarget.Global);
    selection = overrideSelection(picked);
    output.appendLine(tierLogLine(selection, probe.vramMB, probe.ramMB, "override"));
  }

  // A cloud fn-gen backend detaches function generation from local hardware:
  // the VRAM tier still governs FIM (always local), but the "needs 12GB" story
  // is false for the cloud arm, so suppress the local disabled message and pull
  // no fn-gen model. The provider's key check lives in buildFnGenService.
  const cloud = readCloudConfig();
  if (cloud) {
    output.appendLine(`[carve] fn-gen backend=cloud provider=${cloud.provider} (no local model pull)`);
  }

  // A remote Ollama detaches fn-gen from local hardware the same way, and for a
  // sharper reason: this flow is where "no usable GPU detected" actually
  // reaches the user. buildFnGenService grew its remote arm and this function
  // did not, so a laptop pointed at an answering GPU server was told the tier
  // was disabled while the service came up enabled. Roadmap item 19 is that
  // sentence, and suppressing it here is most of the item.
  const remoteHost = isRemoteApiBase(readFnGenConfig().apiBase) ? readFnGenConfig().apiBase : undefined;
  if (remoteHost !== undefined) {
    output.appendLine(`[carve] fn-gen backend=remote host=${remoteHost} (no local model pull)`);
  }

  if (!cloud && remoteHost === undefined && !selection.fnGenEnabled) {
    output.appendLine(`[carve] fn-gen disabled: ${selection.message}`);
    void vscode.window.showInformationMessage(`Column 80: ${selection.message}`);
  }

  // Model availability. One listModels call answers both "is the server up"
  // and "what is pulled" (the donor's readiness-check shape). FIM is local on
  // every tier, so this readiness pass runs even when fn-gen is cloud.
  const fnGenConfig = applyTier(readFnGenConfig(), selection, readTierConfig().explicitFnGenModel);
  const list = deps.listModels ?? listModels;
  const models = await list(fnGenConfig.apiBase);
  if (models === undefined) {
    // No stranded flow: the branch that cannot finish names the
    // one-click way back in - the same gesture the decline path names - in
    // the notification AND the channel.
    const wayBack = `Once the server is up, run "Column 80: Select Hardware Tier" to finish model setup.`;
    const choice = await vscode.window.showWarningMessage(
      `Column 80: the Ollama server is not answering, so models cannot be checked or downloaded. ${wayBack}`,
      "Start ollama serve",
    );
    if (choice === "Start ollama serve") {
      await startOllamaTerminal(output, deps.ollamaCheck);
    }
    output.appendLine(`[carve] tier flow incomplete: server down. ${wayBack}`);
    return;
  }

  const needed: { model: string; why: string; fnGen: boolean }[] = [
    { model: readConfig().model, why: "FIM tab-completion needs its model", fnGen: false },
  ];
  // The cloud backend serves fn-gen from the provider, so no local fn-gen
  // model is ever pulled; FIM above is the only local model a cloud user needs.
  // A remote host is excluded for a different reason: `applyTier` would name
  // the LOCAL VRAM row's model here, and `offerModelPull` targets apiBase, so
  // this used to offer to download this box's tier model onto somebody else's
  // server, citing this box's tier as the reason. FIM's entry above still runs
  // and is still right, because FIM rides the same apiBase.
  if (!cloud && remoteHost === undefined && selection.fnGenEnabled) {
    needed.push({
      model: fnGenConfig.model,
      why: `function generation on the ${selection.id} tier needs its model`,
      fnGen: true,
    });
  }
  for (const need of needed) {
    if (hasModel(models, need.model)) {
      continue;
    }
    const landed = await offerModelPull(fnGenConfig.apiBase, need.model, output, need.why, deps);
    if (!landed && need.fnGen) {
      // Declining leaves the extension honest: what is missing, what that
      // disables, and the one-click that fixes it.
      const message = `Function generation is disabled until ${need.model} is downloaded. Run "Column 80: Select Hardware Tier" for the one-click download. FIM tab-completion still works.`;
      output.appendLine(`[carve] fn-gen disabled: ${message}`);
      void vscode.window.showInformationMessage(`Column 80: ${message}`);
    }
  }
}

// The computed tier leads as the preselected default; every tier stays
// pickable as an override, described honestly (24gb says provisional).
async function pickTier(computed: TierSelection): Promise<TierId | "auto" | undefined> {
  type Item = vscode.QuickPickItem & { value: TierId | "auto" };
  const items: Item[] = [
    {
      label: `$(check) Use detected tier: ${computed.id}`,
      // computeTier only ever emits a TierId; the "cloud" selection is
      // synthesized past this local-only flow and never reaches pickTier.
      detail: TIER_DESCRIPTIONS[computed.id as TierId],
      description: "recommended - keeps 'auto' so a hardware change re-adapts",
      value: "auto",
    },
    ...TIER_TABLE.map((row) => ({
      label: row.id,
      detail: TIER_DESCRIPTIONS[row.id],
      description: row.id === computed.id ? "detected" : "override",
      value: row.id,
    })),
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: "Column 80: hardware tier",
    placeHolder: "Which models fit this machine - the carve keeps FIM fast beside the 30b",
  });
  return pick?.value;
}

const hasModel = (models: string[], model: string): boolean =>
  models.includes(model) || models.includes(`${model}:latest`);

/** One-click ratified download. The Download click logs
 *  `[carve] pull ratified` BEFORE the request starts; decline logs
 *  `[carve] pull declined` and changes nothing. Returns true when the model
 *  landed. */
export async function offerModelPull(
  apiBase: string,
  model: string,
  output: vscode.OutputChannel,
  why: string,
  deps: FirstRunDeps = {},
): Promise<boolean> {
  output.appendLine(`[carve] pull offered model=${model} why=${why}`);
  const choice = await vscode.window.showInformationMessage(
    `Column 80: ${why}. Download ${model}?`,
    "Download",
  );
  if (choice !== "Download") {
    output.appendLine(`[carve] pull declined model=${model}`);
    return false;
  }
  // The trust contract's ordering: the ratify line is on the record before
  // any request starts, so a pull line without a ratify line above it is a
  // bug by definition.
  output.appendLine(`[carve] pull ratified model=${model}`);
  const pull = deps.pull ?? pullModel;
  const started = Date.now();
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Column 80: downloading ${model}…`,
        cancellable: true,
      },
      async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        let reported = 0;
        await pull(apiBase, model, controller.signal, (fraction, status) => {
          if (fraction === undefined) {
            progress.report({ message: status });
            return;
          }
          const pct = Math.floor(fraction * 100);
          progress.report({ increment: pct - reported, message: `${pct}%` });
          reported = pct;
        });
      },
    );
    output.appendLine(`[carve] pull done model=${model} ms=${Date.now() - started}`);
    return true;
  } catch (err) {
    if (isAbort(err)) {
      output.appendLine(`[carve] pull cancelled model=${model}`);
      return false;
    }
    output.appendLine(`[carve] pull failed model=${model}: ${errorText(err)}`);
    void vscode.window.showWarningMessage(`Column 80: the download failed - ${errorText(err)}`);
    return false;
  }
}

const isAbort = (err: unknown): boolean =>
  (err instanceof Error && err.name === "AbortError") || /abort/i.test(String(err));

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Start the local model server in a visible terminal - user-initiated only
 *  (ported from the donor's startOllamaTerminal). When the `ollama` CLI is not
 *  installed, "start the server" cannot succeed (the terminal would just print
 *  `command not found`), so point the user at the installer instead of launching
 *  a doomed `ollama serve`. `runOllamaCheck` is injectable for headless tests. */
export async function startOllamaTerminal(
  output: vscode.OutputChannel,
  runOllamaCheck: ProbeCommandFn = probeCommandRunner(DEFAULT_PROBE_TIMEOUT_MS),
): Promise<void> {
  if (!(await ollamaInstalled(runOllamaCheck))) {
    output.appendLine("[carve] ollama not found on PATH — pointed the user to the installer");
    const choice = await vscode.window.showErrorMessage(
      "Column 80: Ollama isn't installed — the `ollama` command was not found. Install it, then run this again.",
      "Install Ollama",
    );
    if (choice === "Install Ollama") {
      void vscode.env.openExternal(vscode.Uri.parse("https://ollama.com/download"));
    }
    return;
  }
  const existing = vscode.window.terminals.find((t) => t.name === "Ollama");
  const terminal = existing ?? vscode.window.createTerminal({ name: "Ollama" });
  terminal.show();
  terminal.sendText("ollama serve");
  output.appendLine("[carve] started `ollama serve` in a visible terminal (user-initiated)");
}

/** Registers column80.selectHardwareTier and the activation-time
 *  first-run check: the flow runs once per install (globalState-gated);
 *  the command re-runs it on demand. deps is the same injection seam
 *  runFirstRunFlow takes (the unit suite must never touch host
 *  hardware through this path). */
export function registerFirstRun(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  deps: FirstRunDeps = {},
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("column80.selectHardwareTier", async () => {
      try {
        await runFirstRunFlow(context, output, deps);
      } catch (err) {
        output.appendLine(`[carve] tier flow failed: ${String(err)}`);
      }
    }),
  );
  if (context.globalState.get<boolean>(FIRST_RUN_KEY) !== true) {
    // Marked done up front: a flow the user dismisses still counts as the
    // one automatic ask; the command stays available forever.
    void context.globalState.update(FIRST_RUN_KEY, true);
    void runFirstRunFlow(context, output, deps).catch((err) =>
      output.appendLine(`[carve] tier flow failed: ${String(err)}`),
    );
  }
}

// rust-analyzer's argument snippets, and why this extension has an opinion
// about another extension's setting.
//
// rust-analyzer defaults `completion.callable.snippets` to `fill_arguments`, so
// the suggest widget's selected item carries a RENDERED ARGUMENT LIST
// (`rehome_by_lod(by_lod)`) where every other supported server carries a bare
// name. VS Code requires an inline item to start with that text verbatim and at
// the same position, so nothing generated can augment it: the ghost stops
// re-rendering as the user arrows the member list, which is the whole gesture.
// `add_parentheses` is no better - `rehome_by_lod()` is equally not a bare name.
//
// The feature still WORKS under it (arrow blind, Escape, Tab, correct member
// with real arguments); what is lost is the live preview while arrowing. So this
// is a nudge, not a requirement, and it is Rust-only: tsserver returns bare
// names, Pylance's completeFunctionParens defaults false, Roslyn has no such
// setting.
const RA_SNIPPET_SECTION = "rust-analyzer.completion.callable";
const RA_SNIPPET_KEY = "snippets";
const RA_NUDGE_KEY = "column80.raSnippetNudgeAnswered";

// The values that render arguments. An ABSENT key counts as one of them:
// rust-analyzer's own default is `fill_arguments`, so unset means the user is in
// the degraded gesture. The usual worry about an absent key - that the server
// might not be installed at all - is answered by the caller's precondition
// rather than by this read. The nudge fires only after a Rust member site has
// been seen with the widget OPEN, and rust-analyzer is what populated that
// widget. A live member list proves the server is running, which no
// configuration read can.
const RENDERS_ARGUMENTS = new Set(["fill_arguments", "add_parentheses"]);

// An answer is remembered PER WORKSPACE, and the reason is a dogfood session
// that lost the gesture in every project but one.
//
// The gate reads the EFFECTIVE value of another extension's setting, which
// includes workspace scope. Reading "already off" in a project whose local
// settings.json sets it, then recording that as an install-wide answer, is
// inferring a fact about the machine from evidence about one folder. Everywhere
// else rust-analyzer falls back to its own default, the gesture is broken, and
// the gate short-circuits before it can ever notice.
//
// The answer goes in `workspaceState`; the SETTING is still written to
// `ConfigurationTarget.Global`. Those pull in opposite directions on purpose.
// The preference is install-wide and a workspace write would drop a
// `.vscode/settings.json` into a repo that may well track it. The evidence the
// question was asked is not install-wide, because the value it was asked about
// is not. Write global, never assume the value you READ is.
//
// Optional-chained because one older test harness supplies a context with no
// `workspaceState`. Real VS Code always has one; a context without it degrades
// to "nobody has answered yet", which re-asks rather than silently deciding.
function answeredIn(context: vscode.ExtensionContext, key: string): boolean {
  return context.workspaceState?.get<boolean>(key) === true;
}

async function recordAnswer(context: vscode.ExtensionContext, key: string): Promise<void> {
  await context.workspaceState?.update(key, true);
}

// Offers with a reply still outstanding. The message is modeless and the user
// keeps typing under it, so without this a second member site opens a second
// offer for a question already on screen.
//
// In memory, not persisted, and that is the whole point: the persisted flag
// used to be written BEFORE the await to get this effect, which made a toast
// that faded while the user kept typing count as an answer. An unanswered
// question is unanswered.
const offersInFlight = new Set<string>();

/** One-time, one-click, Rust-only offer to turn rust-analyzer's argument
 *  snippets off so the ghost re-renders while the user arrows the member list.
 *
 *  Called per member site, so the ANSWERED path must cost NOTHING: the
 *  workspaceState answered key is read before any `getConfiguration` handle is
 *  taken, and the language test comes before both.
 *
 *  The already-off path does pay a `getConfiguration().get()` per member site,
 *  and that is deliberate. It used to settle the gate instead, which is how one
 *  project's local settings.json silenced the nudge in every other project. The
 *  read is a cache lookup; if it is ever shown to cost, memoise it per workspace
 *  folder and invalidate on `onDidChangeConfiguration`. Never by recording an
 *  answer nobody gave.
 *
 *  Never writes another extension's configuration without a ratifying click,
 *  which is the same invariant `offerModelPull` holds for downloads. A dismissed
 *  message is not a yes. */
export async function offerRaSnippetFix(
  context: vscode.ExtensionContext,
  languageId: string,
  output: vscode.OutputChannel,
): Promise<boolean> {
  if (languageId !== "rust") {
    return false;
  }
  const answered = RA_NUDGE_KEY;
  if (answeredIn(context, answered) || offersInFlight.has(answered)) {
    return false;
  }
  const config = vscode.workspace.getConfiguration(RA_SNIPPET_SECTION);
  const live = config.get<string>(RA_SNIPPET_KEY);
  if (live !== undefined && !RENDERS_ARGUMENTS.has(live)) {
    // Already off. Nothing to ask, and nothing to record: the user did not
    // answer a question, the setting simply happens to be right here.
    return false;
  }
  offersInFlight.add(answered);
  output.appendLine(`[carve] ra snippet nudge offered live=${String(live)}`);
  const TURN_OFF = "Turn it off";
  try {
    const choice = await vscode.window.showInformationMessage(
      "Column 80: rust-analyzer's argument snippets stop the inline ghost re-rendering as you arrow" +
        " the member list. Turning them off trades the widget's tabbable parameter-name placeholders" +
        " for a live preview of the real call.",
      TURN_OFF,
      "Not now",
    );
    // A modeless message that faded while the developer kept typing is not an
    // answer, and recording it as one costs them the offer forever.
    if (choice === undefined) {
      return false;
    }
    if (choice !== TURN_OFF) {
      output.appendLine(
        "[carve] ra snippet nudge declined; the ghost will not re-render while the widget is open," +
          " and arrow-Escape-Tab still lands the right member",
      );
      await recordAnswer(context, answered);
      return false;
    }
    // Ratify before acting, so a write line with no ratify line above it is a bug
    // by definition. Global scope: this is an install-wide preference of the
    // user's, and writing it per-workspace would drop a `.vscode/settings.json`
    // into every Rust repo they open.
    output.appendLine(`[carve] ra snippet nudge ratified ${RA_SNIPPET_SECTION}.${RA_SNIPPET_KEY}=none`);
    await config.update(RA_SNIPPET_KEY, "none", vscode.ConfigurationTarget.Global);
    await recordAnswer(context, answered);
    return true;
  } finally {
    offersInFlight.delete(answered);
  }
}

// rust-analyzer's hover truncates, and the `/* … */` in the injected block is
// its ellipsis, not the product's. `renderDerivedDef` emits the hover signature
// byte for byte, so the block carries whatever the user's rust-analyzer is
// configured to give: five fields, and five enum variants, both by default.
//
// Two keys, because one is half a fix. The dogfood capture that started this
// showed `Metablock` cut at 5 of 13 AND `DatablockKind` cut as an enum.
//
// Measured against rust-analyzer 1.96.0 on a 12-field struct: 5 of 12 at the
// default, 12 of 12 at 64. Driven e2e at the capture site, `Metablock` goes 5
// of 13 to 13 of 13 and `ReadFilters` 5 of 15 to 15 of 15. Full fields move
// hidden-field recall 28.6% -> 48.0% and all-field recall 41.4% -> 50.5%, ahead
// on every one of eight seeds.
//
// The product cannot pass these itself: it reads hovers through
// `vscode.executeHoverProvider`, so the user's own configuration is the only
// lever. Hence a nudge, under the same invariant as the snippet one.
const RA_HOVER_SECTION = "rust-analyzer.hover.show";
const RA_HOVER_KEYS = ["fields", "enumVariants"] as const;
const RA_HOVER_NUDGE_KEY = "column80.raHoverCapNudgeAnswered";

// What the nudge raises the caps to. 64 is the value the spike measured, and it
// is a cap rather than `null` on purpose: unlimited would let a pathological
// type spend the whole block budget on one hover.
const RA_HOVER_TARGET = 64;

// `null` is rust-analyzer's spelling of unlimited. An ABSENT key is its default
// of 5, which truncates - the same reasoning the snippet nudge applies to an
// unset `snippets`.
function hoverCapTruncates(value: number | null | undefined): boolean {
  if (value === null) {
    return false;
  }
  return value === undefined || value < RA_HOVER_TARGET;
}

/** One-time, one-click, Rust-only offer to raise rust-analyzer's hover caps so
 *  the injected block carries a type's whole surface instead of five of its
 *  members and an ellipsis.
 *
 *  Same shape, same gate and the same invariant as `offerRaSnippetFix`, and a
 *  SEPARATE answered key: declining one says nothing about the other. Fired
 *  from the same place, a Rust member site with the widget open, because a live
 *  member list is the only proof rust-analyzer is actually running. */
export async function offerRaHoverCapFix(
  context: vscode.ExtensionContext,
  languageId: string,
  output: vscode.OutputChannel,
): Promise<boolean> {
  if (languageId !== "rust") {
    return false;
  }
  const answered = RA_HOVER_NUDGE_KEY;
  if (answeredIn(context, answered) || offersInFlight.has(answered)) {
    return false;
  }
  const config = vscode.workspace.getConfiguration(RA_HOVER_SECTION);
  // The keys that actually truncate, carried through to the write. The offer
  // decision is per key and so is the write: a user who has already set
  // `fields: null` for unlimited, or raised it to 100, must not have that
  // replaced by 64 under a message promising to show them everything.
  const truncating = RA_HOVER_KEYS.filter((key) => hoverCapTruncates(config.get<number | null>(key)));
  if (truncating.length === 0) {
    // Both caps already carry a whole type. Nothing to ask, and nothing to
    // record - the user answered no question.
    return false;
  }
  offersInFlight.add(answered);
  output.appendLine(
    `[carve] ra hover cap nudge offered truncating=${JSON.stringify(truncating)}`,
  );
  const RAISE = "Show all";
  try {
    const choice = await vscode.window.showInformationMessage(
      "Column 80: rust-analyzer's hover shows five struct fields and five enum variants, and the" +
        " rest arrive as `/* … */`. That ellipsis is what the model is asked to write against," +
        " so it invents the names it cannot see. Showing all of them measured a 19 point gain in" +
        " hidden-field recall.",
      RAISE,
      "Not now",
    );
    if (choice === undefined) {
      return false;
    }
    if (choice !== RAISE) {
      output.appendLine(
        "[carve] ra hover cap nudge declined; the injected block will keep showing five members" +
          " per type and an ellipsis for the rest",
      );
      await recordAnswer(context, answered);
      return false;
    }
    // One click, every key that needed raising. Two toasts for one decision is
    // the product making the developer manage it; writing a key that did not
    // need it is the product overruling them.
    for (const key of truncating) {
      output.appendLine(
        `[carve] ra hover cap nudge ratified ${RA_HOVER_SECTION}.${key}=${RA_HOVER_TARGET}`,
      );
      await config.update(key, RA_HOVER_TARGET, vscode.ConfigurationTarget.Global);
    }
    await recordAnswer(context, answered);
    return true;
  } finally {
    offersInFlight.delete(answered);
  }
}
