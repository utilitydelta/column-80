import * as vscode from "vscode";
import {
  DEFAULT_FIM_CONFIG,
  DEFAULT_FNGEN_CONFIG,
  FimConfig,
  FnGenConfig,
  fimApiBase,
} from "../core/config";
import { CLOUD_PROVIDERS, OPENAI_COMPATIBLE } from "../core/cloudInstruct";
import { CLAUDE_CODE } from "../core/claudeCodeInstruct";
import {
  ContextStop,
  DEFAULT_CONTEXT_STOP,
  INJECTED_CONTEXT_STOPS,
  ModelClass,
  budgetProfileFor,
  modelClassFor,
  providerKnown,
} from "../core/budgetProfile";

export interface ExtensionConfig extends FimConfig {
  enabled: boolean;
  /** Language ids to serve FIM in ON TOP of the ones the product understands
   *  (`FIM_LANGUAGES`). Widens only; it can never take a language away. Lives
   *  on the vscode-side config rather than in `FimConfig` because the gate runs
   *  in the provider, before the service is reached at all - that is what makes
   *  an unserved language cost no debounce, no cache lookup and no model call. */
  fimLanguages: readonly string[];
}

// Clearing a text field in the settings UI stores "" rather than removing the
// key, and get's fallback only applies to an absent key — an emptied setting
// must fall back too or "" flows downstream as a model name or API base.
function str(c: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const v = c.get<string>(key, fallback).trim();
  return v === "" ? fallback : v;
}

export function readConfig(): ExtensionConfig {
  const c = vscode.workspace.getConfiguration("column80");
  const d = DEFAULT_FIM_CONFIG;
  return {
    enabled: c.get<boolean>("enabled", true),
    // An array setting a human types into: a non-array (a hand-edited string in
    // settings.json) reads as no widening rather than as a crash on a keystroke
    // path. Entries are trimmed and case-folded where they are compared, in
    // `fimServesLanguage`.
    fimLanguages: (() => {
      const v = c.get<unknown>("fimLanguages", []);
      return Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : [];
    })(),
    // Goal amendment A: one setting, two consumers, and it no longer moves both.
    // A base naming another machine belongs to fn-gen; FIM stays local. Every
    // FIM consumer reads through here, so the carve lands once.
    apiBase: fimApiBase(str(c, "apiBase", d.apiBase)),
    model: str(c, "fimModel", d.model),
    maxTokens: c.get<number>("maxTokens", d.maxTokens),
    temperature: c.get<number>("temperature", d.temperature),
    debounceMs: c.get<number>("debounceMs", d.debounceMs),
    prefixChars: c.get<number>("prefixChars", d.prefixChars),
    suffixChars: c.get<number>("suffixChars", d.suffixChars),
    // 0 disables the cache outright: the evict loop runs after the insert, so
    // an entry is stored and immediately dropped and no lookup can ever hit.
    // That is the dogfood switch - a cache hit answers a keystroke with a
    // completion some EARLIER keystroke generated, so measuring what this one
    // does by hand needs a way to force a fresh generation every time.
    cacheCapacity: c.get<number>("cacheCapacity", d.cacheCapacity),
    // The length floor, shipped as a default rather than a constant because the
    // number is JetBrains' and has to be arguable here. Measured against the 750
    // real sites of the verify run that has the declaration bound in it, which
    // is the only run that can price this floor: 7 of the 710 served ghosts trip
    // it (1.0%), and none of those 7 matched what the developer went on to
    // write. That number holds only WITH the block-opener exemption in
    // `belowGhostFloor`; without it the same run refuses 17 and nine of them are
    // the developer's own next line.
    minGhostChars: c.get<number>("minGhostChars", d.minGhostChars),
    minGhostAlnum: c.get<number>("minGhostAlnum", d.minGhostAlnum),
    logPrompts: c.get<boolean>("logPrompts", false),
  };
}

export interface OracleConfig {
  repairEnabled: boolean;
  /** v2 compiler-directed injection: resolve the real crate surface from the
   *  user's rust-analyzer and inject it into repair rounds, and qualify missing
   *  imports in-span. Defaults on (the v2 trust model is human-can-veto, not
   *  human-selects), and degrades silently to v1 repair when rust-analyzer is
   *  not answering. Off returns the exact v1 behaviour. */
  injectionEnabled: boolean;
  /** Roadmap item: run the refine round's reference leg inside a REPAIR
   *  round, so a round with a compiler error can see how the repo already calls
   *  the members it is fixing.
   *
   *  Defaults OFF, and that is the arm's verdict rather than caution.
   *  docs/architecture/compiler-oracle.md, "The repair usage-window arm": over
   *  16 real cases from `acme-db`, 192 runs, usage scored 24 of 48 against the
   *  control's 23 and 3 of 24 against 3 of 24 on the receiver-blind cases the
   *  leg exists for, while costing the winning arm six passes and 2.6 seconds of
   *  median latency. The mechanism it
   *  loses on is visible on the channel: 51% of injected windows come from
   *  outside the workspace, and the leg spends its whole budget on `borrow` and
   *  `map_err` before it reaches the failing call.
   *
   *  Kept behind a switch rather than deleted so it can be re-armed once window
   *  selection is fixed. */
  repairUsageWindows: boolean;
  /** v29 item 2: at a member site whose name the buffer already spells, inject
   *  real call sites of that member under the signature block. Its own switch
   *  rather than a corner of `injectionEnabled`, because it is a separate bet
   *  with its own arms (docs/architecture/fim-completion.md, "Usage windows at
   *  a member site": 8 of 40 type-wrong continuations down to 3) and its own way
   *  of being wrong (a window carries
   *  another call site's locals and the model reaches for them). Defaults on,
   *  the way every measured injection here does. */
  usageExamples: boolean;
}

// The repair gate is the only oracle setting: check-and-surface always runs;
// repair is the separable module a user can switch off without losing the
// oracle.
export function readOracleConfig(): OracleConfig {
  const c = vscode.workspace.getConfiguration("column80");
  return {
    repairEnabled: c.get<boolean>("repairEnabled", true),
    injectionEnabled: c.get<boolean>("compilerDirectedInjection", true),
    usageExamples: c.get<boolean>("fimUsageExamples", true),
    // OFF by default because it LOST its arm. Putting the refine round's
    // reference leg inside a repair round, measured over 16 real cases from
    // acme-db, scored 24 of 48 against the control's 23, and 3 of 24 against
    // 3 of 24 on the receiver-blind cases the leg exists for; it cost the
    // winning arm six passes and 2.6s of median latency. The switch stays so
    // the leg can be re-armed after the window selection is fixed (51% of
    // injected windows landed outside the workspace); it does not stay on.
    repairUsageWindows: c.get<boolean>("repairUsageWindows", false),
  };
}

// Which tier drives the carve: "auto" probes the hardware; a tier id is a
// human override that skips the probe.
export interface TierConfig {
  hardwareTier: "auto" | "24gb" | "16gb-large-ram" | "16gb-low-ram" | "below-12gb";
  /** True when the human explicitly set fnGenModel - an explicit tag keeps
   *  the carve off it (applyTier's rule; a cap tuned for the 30b is wrong
   *  for any other model). */
  explicitFnGenModel: boolean;
}

const TIER_IDS: readonly TierConfig["hardwareTier"][] = [
  "auto",
  "24gb",
  "16gb-large-ram",
  "16gb-low-ram",
  "below-12gb",
];

export function readTierConfig(): TierConfig {
  const c = vscode.workspace.getConfiguration("column80");
  const raw = c.get<string>("hardwareTier", "auto");
  // An unknown value (hand-edited settings.json) degrades to auto rather
  // than crashing tier resolution.
  const hardwareTier = (TIER_IDS as readonly string[]).includes(raw)
    ? (raw as TierConfig["hardwareTier"])
    : "auto";
  // Explicit means the HUMAN wrote a non-empty value in some scope; the
  // settings UI stores "" when a field is cleared, and an empty string is
  // an un-choice, not a model (the donor extension's chooseModel rule).
  const info = c.inspect<string>("fnGenModel");
  const isSet = (v: string | undefined): boolean => v !== undefined && v.trim() !== "";
  return {
    hardwareTier,
    explicitFnGenModel:
      isSet(info?.globalValue) || isSet(info?.workspaceValue) || isSet(info?.workspaceFolderValue),
  };
}

// Settings expose only the model tags; sampling knobs stay at core defaults
// until a persona needs them. numGpu is deliberately not a setting (humans
// should not hand-tune it) and deliberately not set HERE either: this is the
// base config half of the seam, and applyTier(base, resolvedTier,
// explicitFnGenModel) in the fn-gen rebuild path supplies the tier-computed
// carve. The reference constant lives as the 16gb-large-ram table row in
// src/core/tiers.ts.
/**
 * The `think` field, from the user's setting or the config default.
 *
 * A FREE STRING, PASSED THROUGH, because the vocabulary belongs to the MODEL.
 * Measured 2026-08-29: `qwen3-coder:30b` refuses reasoning outright, `qwen3:8b`
 * accepts `true`, `qwen3.8:27b` accepts `true` and `"low"`, and OpenAI's 5.6
 * line accepts only `"none"` and under a different field name entirely. A closed
 * enum would be wrong the first time a model shipped a level it did not list, so
 * anything this function does not recognise goes to the server verbatim and the
 * server's own refusal reaches the channel.
 *
 * `off` and `on` are spelled out because they are the two a user actually
 * reaches for, and `true`/`false` are accepted for anyone who read the ollama
 * API rather than this description.
 */
function thinkFrom(setting: string, fallback: boolean | string | undefined): { think?: boolean | string } {
  const value = setting.trim().toLowerCase();
  if (value === "") {
    return fallback === undefined ? {} : { think: fallback };
  }
  if (value === "off" || value === "false") {
    return { think: false };
  }
  if (value === "on" || value === "true") {
    return { think: true };
  }
  return { think: setting.trim() };
}

export function readFnGenConfig(): FnGenConfig {
  const c = vscode.workspace.getConfiguration("column80");
  const d = DEFAULT_FNGEN_CONFIG;
  // The transport ceilings come from the ACTIVE backend's budget-profile cell
  // rather than the default table, so a class whose cell moves them moves this
  // read with it. The language is unknown at config time, so the base cell
  // serves; at identity every cell equals the defaults anyway.
  // The stop moves no transport ceiling, but it is passed live rather than
  // hard-coded: `budgetProfileFor` takes it as a required argument precisely so
  // no call site silently acquires a stop nobody chose.
  const budget = budgetProfileFor(fnGenModelClass(), "", injectedContextStop());
  return {
    apiBase: str(c, "apiBase", d.apiBase),
    model: str(c, "fnGenModel", d.model),
    fallbackModel: str(c, "fnGenFallbackModel", d.fallbackModel),
    maxTokens: budget.maxTokens,
    testMaxTokens: d.testMaxTokens,
    numCtx: budget.numCtx,
    // Spread-when-set, not `think: d.think`. An absent optional field is
    // KEY-ABSENT in this codebase, never value-undefined, because configs are
    // compared with deepStrictEqual and the two are not equal. `think` has no
    // default, so writing it straight through put a `think: undefined` key on
    // every config the tier seam hands out and turned the disabled-tier
    // field-identity row red.
    //
    // `column80.fnGenThinking` is EMPTY BY DEFAULT and empty stays key-absent,
    // which is what preserves that discipline: the tier row then decides, and
    // every tier shipping a reasoning model carries `fnGenThink: false`. A user
    // who sets the setting overrides the tier, because they are the one who
    // knows what model they pointed this at.
    ...thinkFrom(str(c, "fnGenThinking", ""), d.think),
    temperature: d.temperature,
    logPrompts: c.get<boolean>("logPrompts", false),
  };
}

/**
 * The serving class of the ACTIVE fn-gen backend, from what the product
 * already knows: the provider setting and the model tag. A provider the
 * product has never heard of resolves to the conservative `local-mid` class,
 * and the line on the channel is the only place that fact surfaces - pass the
 * log wherever one exists.
 *
 * The tier carve can swap the model to `fallbackModel`; both local tags are
 * the same `local-mid` class, so the swap cannot change the answer and the
 * pre-carve read here is safe.
 */
export function fnGenModelClass(log?: (line: string) => void): ModelClass {
  try {
    const c = vscode.workspace.getConfiguration("column80");
    const provider = c.get<string>("fnGenProvider", "ollama").trim();
    const model = str(c, "fnGenModel", DEFAULT_FNGEN_CONFIG.model);
    const cls = modelClassFor(provider, model);
    if (!providerKnown(provider)) {
      log?.(`[fngen] provider "${provider}" is not one this product knows; model "${model}" gets the conservative ${cls} budget profile`);
    }
    return cls;
  } catch {
    // A headless harness stubs vscode without getConfiguration. The local
    // default class keeps every derived value at identity.
    return "local-mid";
  }
}

/** The setting `column80.injectedContext` replaced, and its values. Kept as a
 *  name rather than a bare string so the one channel line below cannot drift
 *  from what a user still has in their settings.json. */
const REPLACED_SURFACE_SETTING = "injectedSurface";

/**
 * The context stop in force: how much type surface the fn-gen prompt may
 * carry, as ONE setting driving four numbers together.
 *
 * TOTAL AND NEVER THROWING, the same defensiveness `fnGenModelClass` carries
 * and for the same reason: the pre-fill leg runs on hosts that supply a partial
 * `vscode` surface, and a settings read is not a reason for the whole injected
 * surface to disappear. An absent configuration provider, an absent setting, an
 * empty string and an unrecognised value all resolve to `small`.
 *
 * Read ONCE PER GESTURE by its callers, never once per candidate: a developer
 * who changes the setting should not have to restart the editor, and a
 * `getConfiguration()` inside the admission loop would pay for that freshness
 * on every iteration.
 */
export function injectedContextStop(log?: (line: string) => void): ContextStop {
  // RESOLVED FIRST, HELD, AND RETURNED WHATEVER THE NOTICE BELOW DOES. The
  // deprecation notice used to sit inside this try, after the stop was
  // computed, so a host that throws on `inspect` (or on an unknown key) threw
  // away a `frontier` the user had explicitly chosen and answered `small`. A
  // failure in a MESSAGE about a setting that no longer matters must never
  // discard the setting that does.
  let stop: ContextStop = DEFAULT_CONTEXT_STOP;
  let cfg: ReturnType<typeof vscode.workspace.getConfiguration> | undefined;
  try {
    cfg = vscode.workspace.getConfiguration?.("column80");
    // The settings UI stores "" when a field is cleared, and `get`'s fallback
    // only applies to an ABSENT key - an emptied enum must fall back too.
    //
    // TYPE-CHECKED BEFORE COERCED. `String(["frontier"])` is "frontier", so a
    // settings.json carrying an array (or anything else non-string) would have
    // been accepted as a valid stop through a value the setting cannot hold.
    // A non-string is not an unrecognised stop, it is not a stop at all: the
    // default answers.
    const read: unknown = cfg?.get<string>("injectedContext", DEFAULT_CONTEXT_STOP);
    const raw = typeof read === "string" ? read.trim() : "";
    if ((INJECTED_CONTEXT_STOPS as readonly string[]).includes(raw)) {
      stop = raw as ContextStop;
    }
  } catch {
    // A headless harness stubs vscode without getConfiguration. The install
    // default is the answer, never an exception and never a dark path.
    return DEFAULT_CONTEXT_STOP;
  }
  // `injectedSurface` is gone from contributes.configuration; a user who
  // still carries it in settings.json gets told what took its place rather
  // than finding out through a value that quietly stopped mattering. One
  // line, on the same once-per-gesture read as the stop itself.
  // Read BOTH ways, because either one alone misses a real user. `get` with
  // no fallback answers undefined for a key nothing declares a default for,
  // which is exactly what a removed setting is - so a non-empty answer means
  // the user wrote it. `inspect` is the scope-by-scope form `readTierConfig`
  // already uses, and it is the one that still answers when a host serves
  // `get` from the manifest defaults only.
  //
  // ITS OWN TRY. Everything in here is about a setting the product no longer
  // reads; nothing in here may change the answer above.
  try {
    const stale = typeof cfg?.inspect === "function" ? cfg.inspect<string>(REPLACED_SURFACE_SETTING) : undefined;
    const set = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";
    const read = cfg?.get<string>(REPLACED_SURFACE_SETTING);
    if (set(read) || set(stale?.globalValue) || set(stale?.workspaceValue) || set(stale?.workspaceFolderValue)) {
      log?.(
        `[fngen] \`column80.${REPLACED_SURFACE_SETTING}\` is set and is no longer read; ` +
          `\`column80.injectedContext\` replaces it and is at "${stop}"`,
      );
    }
  } catch {
    // Nothing to say: the notice is a courtesy and the stop is already decided.
  }
  return stop;
}

// The optional cloud fn-gen backend. Present only when fnGenProvider names a
// cloud provider; the default "ollama" (and an emptied field) returns undefined
// so the entire local path - tier probe, carve, model pull - is unchanged. A
// present-but-incomplete result (blank baseUrl or apiKey) is deliberate, not
// filtered here: buildFnGenService fails the tier gate closed with a message
// naming the missing setting, the same honesty the local disabled tiers carry.
export interface CloudFnGenConfig {
  provider: string;
  /** Human-facing name for messages and evidence. */
  label: string;
  /** Resolved `/chat/completions` root; "" when openai-compatible has no base. */
  baseUrl: string;
  /** "" when unset; the fail-closed check lives in buildFnGenService. */
  apiKey: string;
}

export function readCloudConfig(): CloudFnGenConfig | undefined {
  const c = vscode.workspace.getConfiguration("column80");
  const provider = c.get<string>("fnGenProvider", "ollama").trim();
  if (provider === "" || provider === "ollama") {
    return undefined;
  }
  const apiKey = c.get<string>("cloudApiKey", "").trim();
  const override = c.get<string>("cloudApiBase", "").trim();

  // Claude Code is a cloud backend with no endpoint and no key: it runs the
  // user's installed CLI, and billing rides their subscription. It must be
  // decided BEFORE the preset lookup below, which would otherwise drop it into
  // the unknown-provider branch and report it as misconfigured. The key and
  // baseUrl stay "" and are never read on this path - the gate that fails a
  // half-configured cloud provider closed is keyed on the provider, not on a
  // blank field.
  if (provider === CLAUDE_CODE) {
    return { provider, label: "Claude Code (subscription)", baseUrl: "", apiKey: "" };
  }
  if (provider === OPENAI_COMPATIBLE) {
    // No preset host: the base URL is the whole point of picking this option.
    return { provider, label: "OpenAI-compatible", baseUrl: override, apiKey };
  }
  const preset = CLOUD_PROVIDERS[provider];
  if (preset === undefined) {
    // A hand-edited unknown provider is misconfigured, never silently local:
    // carry it through with whatever base the user gave so the gate reports it.
    return { provider, label: provider, baseUrl: override, apiKey };
  }
  // The override wins when set (a proxy or a moved host); otherwise the preset.
  return { provider, label: preset.label, baseUrl: override !== "" ? override : preset.baseUrl, apiKey };
}
