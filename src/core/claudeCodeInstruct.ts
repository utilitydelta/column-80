/**
 * Optional Claude Code instruct backend: the user's installed `claude` CLI run
 * headless (`claude -p`), swapped in behind the SAME InstructGenerateFn seam the
 * local ollama client and the OpenAI-compatible cloud client fill. Only the
 * fn-gen path (function/struct/test/repair) ever reaches here.
 *
 * FIM is NOT on this path and never will be: a measured 5-15s per call has no
 * business on a keystroke, and the chat transport this CLI speaks has no native
 * `suffix` infill to begin with.
 *
 * Why a subprocess rather than an API call: the point of this backend is that a
 * user with a Claude subscription and the CLI already installed needs no API
 * key. Billing rides their subscription, which means the CLI's own auth, which
 * means the CLI. The tradeoff is honest and stated in the settings copy: the
 * prompt leaves the machine, so this backend is off by default behind an
 * explicit provider setting - the same trust category as the cloud providers.
 * See ARCHITECTURE.md ("What this is NOT" / the offline invariant).
 *
 * Three traps, all PROVEN live against claude 2.1.224 on 2026-08-08 (the
 * recordings are in session-v43/); every one of them is load-bearing:
 *
 * 1. FENCE: the reply arrives wrapped in a ```lang fence DESPITE an explicit
 *    no-fences instruction in the prompt, and instructPostprocess REJECTS a
 *    reply carrying a fence line. Unstripped, this backend would fail every
 *    round and measure the model's fence habit rather than the model. Exactly
 *    one outer pair comes off, and the strip is reported on the evidence line
 *    so a reader never mistakes a normalized reply for a raw one.
 * 2. MCP LEAK: without --strict-mcp-config, user-scope MCP servers attach in
 *    ANY cwd - including, on the box this was proven on, a server indexing this
 *    very repo. A clean cwd is NOT isolation. The flag is mandatory on every
 *    spawn, which is why it is a constant here and not an option.
 * 3. AGENTIC REPLY: `claude` is an agent, not a completion endpoint. A reply
 *    that took more than one turn used tools to get there and is not a
 *    generation of the requested function. Those rounds are rejected by name
 *    rather than silently accepted for their text.
 *
 * What still reaches the model that this file cannot stop: Claude Code's own
 * system prompt and the user's GLOBAL ~/.claude context (config, user memory)
 * ride every subscription-mode call. That is how the subscription
 * authenticates, so it is documented rather than defeated. The other half of
 * that weight, the built-in tool definitions, IS stoppable and is stopped - see
 * BASE_ARGS.
 *
 * What the neutral cwd buys is the workspace's own CLAUDE.md, auto-memory and
 * project MCP servers staying out of a generation the context panel never
 * showed - a human-curates-everything violation if it leaked in.
 */

import { spawn } from "child_process";
import { createHash } from "crypto";
import { existsSync } from "fs";
import { DEFAULT_FNGEN_CONFIG } from "./config";
import { GEN_TIMEOUT_MS } from "./budgetProfile";
import { usageEvidence } from "./cacheEvidence";
import { SECTION_SEPARATOR } from "./prompt";
import { InstructGenerateFn, InstructGenerateParams, InstructGenerateResult } from "./ollama";

/** The `fnGenProvider` value that selects this backend. One constant so the
 *  settings enum, the config branch and the service builder cannot drift. */
export const CLAUDE_CODE = "claude-code";

export interface ClaudeCodeInstructConfig {
  /** Absolute path to a product-owned EMPTY directory to spawn in - never the
   *  user's workspace (see the file comment). The caller owns creating it; a
   *  cwd that is not there fails the round as `bad-cwd`, not as a missing
   *  binary. */
  cwd: string;
  /** Executable name or path. Default "claude", resolved off PATH. */
  binary?: string;
  /** Evidence sink: one line per round, success or failure. */
  log?: (line: string) => void;
  /** Hard cap on one child. A hung CLI must not pin fn-gen the way the known
   *  ollama hang pins FIM, and the caller's signal only covers the cases the
   *  caller notices. Generous against a measured 15.2s realistic round. */
  timeoutMs?: number;
}

/** Every failure reason this backend can name. The rig that will drive it
 *  (session-v44) branches on these: `serving-failure` aborts a run rather than
 *  recording a row, because a throttled CLI is a fact about the hour, not about
 *  the model. */
export type ClaudeCodeFailureReason =
  | "binary-missing"
  | "bad-cwd"
  | "logged-out"
  | "serving-failure"
  | "agentic"
  | "cli-error"
  | "exit"
  | "bad-json"
  /** A spawn that failed for any reason other than the two ENOENT cases above:
   *  EACCES on a binary that is not executable, EPERM, EMFILE. Its own reason
   *  rather than `exit`, for two reasons. The backend never started, so a user
   *  reading "the CLI failed" is told the wrong thing about a binary that never
   *  ran. And `exit` is DEGRADABLE, so an unspawnable binary used to clear a
   *  live fork checkpoint and re-run the whole prompt against the same
   *  unspawnable binary; this reason is deliberately NOT in that set, so the
   *  pointless second round is gone. */
  | "spawn-failed"
  /** A turn-1 warm whose reply parsed and reported success but carried no
   *  session id to fork from. Its own reason rather than `bad-json`: the output
   *  was perfectly parseable, and naming the wrong cause is the one failure
   *  this backend keeps refusing to ship. Never surfaces as a round failure -
   *  it degrades to a whole-prompt round and says so on the evidence line. */
  | "no-session"
  | "timeout";

/** A typed failure. `name` is "ClaudeCodeError" so a caller can identify it
 *  without importing the class; `reason` is what it should branch on. */
export class ClaudeCodeError extends Error {
  readonly reason: ClaudeCodeFailureReason;

  constructor(reason: ClaudeCodeFailureReason, message: string) {
    super(message);
    this.name = "ClaudeCodeError";
    this.reason = reason;
  }
}

// The identity read of the budget profile's timeout cell: the service builder
// passes the profile's value explicitly, and this default only catches a
// caller that did not.
export const DEFAULT_TIMEOUT_MS = GEN_TIMEOUT_MS;

/**
 * Fixed on every spawn, deliberately not configurable.
 *
 * `--strict-mcp-config` is isolation, not preference: see trap 2 above.
 *
 * `--tools ""` disables the built-in tool set, and it is the single biggest
 * lever on what this backend costs. Their definitions are sent as input context
 * on EVERY call: measured 23,217 tokens of context for one small generation
 * with them, 3,471 without, same prompt and byte-identical generated code. The
 * user is paying subscription quota for a Read/Write/Bash toolbelt that a
 * prompt-to-text call can never use.
 *
 * It also makes trap 3 structural rather than detected. A model with no tools
 * cannot go agentic, so the `num_turns > 1` guard stops being the only thing
 * standing between an agent transcript and a function body - and a CLI with no
 * Write tool cannot leave files in the working directory it was given.
 *
 * NOT paired with `--system-prompt`, though that measured a further drop to
 * ~275 tokens. Ruled out for now: replacing Claude Code's own system prompt
 * changes what the model was trained to expect from this transport, and the
 * evidence that quality holds is two easy samples. The tool set is different -
 * nothing in it can help write a function body.
 */
const BASE_ARGS = ["-p", "--output-format", "json", "--strict-mcp-config", "--tools", ""];

/** The serving-failure family: a throttle, a quota wall, or an overloaded
 *  upstream. Matched against the CLI's combined output AND its structured
 *  `api_error_status`, because the CLI reports the same condition either way
 *  depending on where it failed. */
const SERVING_FAILURE = /rate[ _-]?limit|overloaded|usage limit|quota exceeded|\b429\b|\b529\b/i;

const LOGGED_OUT = /not logged in/i;

/** A fence line opening a block, with or without a language tag. */
const FENCE_OPEN = /^\s*```[A-Za-z0-9_+-]*\s*$/;
/** A fence line closing one: no tag is allowed on a closer. */
const FENCE_CLOSE = /^\s*```\s*$/;

/** The CLI's own JSON shape, narrowed to the fields that carry meaning here.
 *  Everything else the payload holds (session_id, total_cost_usd, modelUsage,
 *  uuid, ...) is ignored rather than rejected: an unknown field is the CLI
 *  gaining a feature, not this round failing. */
interface ClaudeCodeReply {
  result?: unknown;
  ttft_ms?: unknown;
  duration_ms?: unknown;
  stop_reason?: unknown;
  num_turns?: unknown;
  is_error?: unknown;
  subtype?: unknown;
  api_error_status?: unknown;
  /** The id a later round forks from. Present on every reply the CLI reports as
   *  a success; a warm that arrives without one cannot be forked. */
  session_id?: unknown;
  /** Token accounting for the round, including the cache split. Read as
   *  `unknown` and narrowed field by field: this is the one part of the payload
   *  whose absence must be REPORTED rather than defaulted (see usageEvidence). */
  usage?: unknown;
}

/**
 * Build an InstructGenerateFn bound to one CLI + neutral cwd. The returned fn
 * ignores every ollama-only param: `apiBase` (there is no endpoint), `numGpu`
 * and `numCtx` (no local carve and no window to set), `think` (the CLI's model
 * decides its own reasoning), and `temperature`/`maxTokens` (the headless CLI
 * exposes no sampling or budget knob). They are accepted without error so the
 * seam stays interchangeable, and they reach nothing.
 */
export function makeClaudeCodeInstruct(config: ClaudeCodeInstructConfig): InstructGenerateFn {
  // The checkpoint lives here, in the closure, and nowhere else. One entry, one
  // owner: a settings change rebuilds the service and drops it, which costs one
  // extra turn 1 and cannot go stale.
  const cache = new ForkCache();
  return (params: InstructGenerateParams): Promise<InstructGenerateResult> =>
    runRound(config, cache, params);
}

/**
 * One generation, which is one CLI call or two.
 *
 * Two because the CLI puts its only cache breakpoint at the end of the user
 * turn: change the trailing signature and the whole 39KB of context blocks in
 * front of it is re-written, measured at 11,062 cache-write tokens on a
 * generation that shared 39,104 leading bytes with the one before it. Sending
 * the blocks as their own turn and forking each generation off that checkpoint
 * drops the per-generation write to ~84 tokens and reads the rest, which is
 * 22,761 base-input-token equivalents against 1,908.
 *
 * Forking rather than resuming is the load-bearing half: a fork never appends
 * to the base session, so generation five reads the same checkpoint generation
 * two did.
 */
async function runRound(
  config: ClaudeCodeInstructConfig,
  cache: ForkCache,
  params: InstructGenerateParams,
): Promise<InstructGenerateResult> {
  if (params.signal.aborted) {
    // Nothing to kill and nothing to spend: an already-aborted round never
    // reaches the CLI at all, so the subscription is not billed for a keystroke
    // the user has already moved past.
    throw abortError();
  }

  const model = modelArg(params.model);
  const plan = planCache(params);
  if (plan.mode !== "fork") {
    return oneRound(config, params, model, [], params.prompt, plan.mode);
  }

  let sessionId = cache.match(plan.hash);
  let built = false;
  if (sessionId === undefined) {
    try {
      const warm = await cache.warm(plan.hash, () => warmTurn1(config, params, model, plan.prefix));
      sessionId = warm.sessionId;
      // Only the round that actually SPAWNED turn 1 may call itself warmed. A
      // round that waited on someone else's warm spawned once and built
      // nothing, and reporting two `warmed` rounds for one turn 1 would make
      // the channel disagree with the `turn1=` lines beside it.
      built = warm.built;
    } catch (err) {
      // MY signal decides whether this is an abort. A warm can be shared with
      // another round (see ForkCache), so its rejection may be that round's
      // cancellation, which says nothing about this one and must not fail it.
      if (params.signal.aborted) {
        throw err;
      }
      return degradeOrFail(config, params, model, cache, plan.hash, err);
    }
  }

  try {
    return await oneRound(
      config,
      params,
      model,
      ["--resume", sessionId, "--fork-session"],
      plan.remainder,
      built ? "warmed" : "forked",
      undefined,
      // The fork attempt does not write its own failure line. It is one attempt
      // of a round that may still succeed on the whole prompt, and a
      // `round=failed` beside a successful degrade is a phantom failure for
      // anyone counting them out of the channel.
      false,
    );
  } catch (err) {
    if (params.signal.aborted) {
      throw err;
    }
    return degradeOrFail(config, params, model, cache, plan.hash, err);
  }
}

/**
 * A caching failure either degrades to a whole-prompt round or fails the round,
 * and WHICH it does is decided by the reason alone.
 *
 * Degrade only for the shapes a lost checkpoint takes. Everything else fails
 * untouched, and that is the same answer the goal gives for the fork round:
 * retrying a throttle makes it worse, a timeout is expensive by definition, and
 * a logged-out or missing CLI will not be any more installed on the second try.
 * Sending a serving failure out as a successful degraded round is the worst of
 * these, because v45's rig aborts a whole run on one and would never see it.
 */
async function degradeOrFail(
  config: ClaudeCodeInstructConfig,
  params: InstructGenerateParams,
  model: string | undefined,
  cache: ForkCache,
  hash: string,
  err: unknown,
): Promise<InstructGenerateResult> {
  const reason = reasonOf(err);
  if (!(err instanceof ClaudeCodeError) || !DEGRADABLE.has(err.reason)) {
    // The checkpoint is untouched on this path, deliberately. A throttle or a
    // timeout says nothing about the session, and dropping a live checkpoint
    // over an unrelated failure would buy an unnecessary turn 1 on the next
    // round.
    config.log?.(`[claude-code] round=failed reason=${reason} model=${model ?? "cli-default"}`);
    throw err;
  }
  // Only if the checkpoint that failed is still the one on file. A round
  // degrading on one block set must not wipe a live checkpoint another round
  // just stored for a different one.
  cache.clearIf(hash);
  return oneRound(config, params, model, [], params.prompt, "degraded", reason);
}

/** The failure shapes a lost checkpoint takes, and the only ones a caching
 *  problem may turn into a whole-prompt round. Exactly amendment B5's
 *  `cache-degraded` vocabulary, so a reason outside it cannot reach that field
 *  by construction rather than by a second filter. */
const DEGRADABLE: ReadonlySet<ClaudeCodeFailureReason> = new Set<ClaudeCodeFailureReason>([
  "cli-error",
  "exit",
  "bad-json",
  "no-session",
]);

/**
 * The smallest prefix worth forking, in bytes, roughly 512 tokens.
 *
 * That is the SMALLEST per-model minimum cacheable prefix any current Claude
 * model has, not the largest, and the choice is deliberate: our payload is not
 * the whole cached prefix. Claude Code's own system prompt sits in front of it
 * inside the same prefix, and with the built-in tools off one small generation
 * measured 3,471 tokens of context in total. So a floor on our bytes alone is a
 * lower bound on what actually gets cached, and the only thing being too eager
 * below 2KB buys is a round trip for nothing.
 */
export const MIN_PREFIX_BYTES = 2048;

interface CachePlan {
  mode: "fork" | "single-shot" | "below-floor";
  prefix: string;
  remainder: string;
  hash: string;
}

/**
 * Decide how this round is served, from the bytes alone.
 *
 * The prefix must BE a prefix. Context blocks are live - `resolveForPrompt`
 * re-reads them out of the document at generate time - so the only key that
 * cannot go stale is the resolved payload itself, and the only split that
 * cannot corrupt a prompt is one the prompt agrees with. A prefix that does not
 * match the prompt means the assemblers and the prefix renderer have drifted;
 * that round goes out whole rather than throwing.
 */
function planCache(params: InstructGenerateParams): CachePlan {
  const prefix = params.cachePrefix ?? "";
  const head = prefix + SECTION_SEPARATOR;
  if (prefix === "" || !params.prompt.startsWith(head)) {
    return { mode: "single-shot", prefix, remainder: params.prompt, hash: "" };
  }
  if (Buffer.byteLength(prefix, "utf8") < MIN_PREFIX_BYTES) {
    return { mode: "below-floor", prefix, remainder: params.prompt, hash: "" };
  }
  return {
    mode: "fork",
    prefix,
    remainder: params.prompt.slice(head.length),
    // The exact bytes, hashed. Not the block ids, not their ranges, not a file
    // fingerprint: a developer who edits inside a pinned range must get a new
    // turn 1, and a developer who edits elsewhere in the same file must keep
    // the old one. Only the payload knows the difference.
    hash: createHash("sha256").update(prefix, "utf8").digest("hex"),
  };
}

/**
 * Turn 1: the context blocks as their own turn, answered in one word.
 *
 * It fires on the generation call and never before it. Warming when a block is
 * PINNED was considered and refused: ARCHITECTURE.md forbids automatic or
 * hidden cloud calls, and pinning a block is not a request for a model call.
 *
 * Returns the session id to fork from. Its own evidence line carries its cost,
 * because turn 1 is a real expense paid once per block set and a measurement
 * that could not see it would be measuring half the round.
 */
async function warmTurn1(
  config: ClaudeCodeInstructConfig,
  params: InstructGenerateParams,
  model: string | undefined,
  prefix: string,
): Promise<string> {
  const started = Date.now();
  const stdin = prefix + SECTION_SEPARATOR + TURN1_INSTRUCTION;
  try {
    const { code, stdout, stderr } = await spawnClaude(config, {
      args: baseArgs(model),
      stdin,
      signal: params.signal,
    });
    const reply = parseReply(stdout);
    classifyFailure(code, stdout, stderr, reply);
    const sessionId = typeof reply?.session_id === "string" ? reply.session_id.trim() : "";
    if (reply === undefined || sessionId === "") {
      // No id, nothing to fork from. A warm that cannot be forked is a failed
      // warm, not a silent single-shot: the caller degrades and says so.
      throw new ClaudeCodeError("no-session", "Claude Code returned no session id to fork from.");
    }
    config.log?.(
      `[claude-code] turn1=warmed session=${sessionId.slice(0, 8)} ` +
        `bytes=${Buffer.byteLength(stdin, "utf8")} total=${Date.now() - started}ms ` +
        usageEvidence(reply.usage),
    );
    return sessionId;
  } catch (err) {
    if (!params.signal.aborted) {
      config.log?.(`[claude-code] turn1=failed reason=${reasonOf(err)} model=${model ?? "cli-default"}`);
    }
    throw err;
  }
}

/** One word back, so the checkpoint costs almost nothing to establish. The
 *  reply is discarded; only the session id it arrives with is kept. */
const TURN1_INSTRUCTION =
  "The code above is reference material for the function generation requests that follow. " +
  "Do not write any code yet. Reply with exactly one word: understood.";

/**
 * One CLI call, interpreted, logged, and turned into the seam's result.
 *
 * `extraArgs` is what makes a round a fork; `stdin` is the whole prompt on a
 * single-shot round and the prompt minus its cached head on a forked one.
 */
async function oneRound(
  config: ClaudeCodeInstructConfig,
  params: InstructGenerateParams,
  model: string | undefined,
  extraArgs: readonly string[],
  stdin: string,
  mode: string,
  degradedReason?: string,
  /** Whether a failure here is THE round's failure. False for the fork attempt,
   *  which may still succeed on the whole prompt: a `round=failed` line beside
   *  a successful degrade is a phantom failure for anyone counting them out of
   *  the channel, and phase 4 and v45's rig both do. */
  logFailure = true,
): Promise<InstructGenerateResult> {
  const started = Date.now();
  try {
    const { code, stdout, stderr } = await spawnClaude(config, {
      args: [...baseArgs(model), ...extraArgs],
      stdin,
      signal: params.signal,
    });
    const { result, evidence } = interpret(code, stdout, stderr, started, model, mode, degradedReason);
    config.log?.(evidence);
    // Non-streaming transport: the whole reply arrives at once, so the chunk
    // hook fires once with the finished text rather than pretending to stream.
    // --output-format stream-json exists and is deliberately not used until a
    // live e2e shows the UX needs progress chunks.
    params.onChunk?.(result.text);
    return result;
  } catch (err) {
    if (params.signal.aborted || !logFailure) {
      throw err;
    }
    config.log?.(`[claude-code] round=failed reason=${reasonOf(err)} model=${model ?? "cli-default"}`);
    throw err;
  }
}

function baseArgs(model: string | undefined): string[] {
  return [...BASE_ARGS, ...(model !== undefined ? ["--model", model] : [])];
}

function reasonOf(err: unknown): ClaudeCodeFailureReason {
  return err instanceof ClaudeCodeError ? err.reason : "exit";
}

/**
 * The live checkpoint, and the one warm that may be in flight for it.
 *
 * Single-flight is not an optimization here: without it, two generations fired
 * against a cold block set both build a turn 1, both pay the write, and one of
 * the two sessions is immediately orphaned. A second round arriving on the SAME
 * hash waits for the warm already running. A different hash does not wait; it
 * builds its own and the last one to finish owns the slot.
 */
class ForkCache {
  private hash: string | undefined;
  private sessionId: string | undefined;
  // Keyed by hash, not a single slot. One slot meant a round on a DIFFERENT
  // block set evicted the in-flight entry, and the next round on the original
  // one no longer matched and built a second turn 1 for a checkpoint that was
  // already coming. Measured at two turn-1 spawns for one payload, which is
  // ~11,000 cache-write tokens off the user's subscription for a session that
  // is orphaned the moment it exists.
  private readonly inflight = new Map<string, Promise<string>>();

  match(hash: string): string | undefined {
    return this.hash === hash ? this.sessionId : undefined;
  }

  /** `built` is true only for the caller that actually ran the build, so a
   *  round that merely waited never reports itself as having warmed. */
  async warm(hash: string, build: () => Promise<string>): Promise<{ sessionId: string; built: boolean }> {
    const waiting = this.inflight.get(hash);
    if (waiting !== undefined) {
      return { sessionId: await waiting, built: false };
    }
    const pending = build().then((sessionId) => {
      // Written as ONE pair. A key that could be stored without its session, or
      // a session without its key, is how a checkpoint built on one payload
      // gets served to another.
      this.hash = hash;
      this.sessionId = sessionId;
      return sessionId;
    });
    this.inflight.set(hash, pending);
    const done = (): void => {
      if (this.inflight.get(hash) === pending) {
        this.inflight.delete(hash);
      }
    };
    pending.then(done, done);
    return { sessionId: await pending, built: true };
  }

  /** Drop the checkpoint only if it is still the one that failed. An
   *  unconditional clear let a round degrading on one block set wipe a live
   *  checkpoint another round had just stored for a different one. */
  clearIf(hash: string): void {
    if (this.hash === hash) {
      this.hash = undefined;
      this.sessionId = undefined;
    }
  }
}

interface SpawnOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** One `claude` child: argv, stdin, abort, watchdog, and its raw output. Every
 *  classification decision lives above this; nothing here reads the reply. */
function spawnClaude(
  config: ClaudeCodeInstructConfig,
  opts: { args: string[]; stdin: string; signal: AbortSignal },
): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolve, reject) => {
    // Checked HERE, once, rather than at each caller. `addEventListener` never
    // fires for a signal that is ALREADY aborted, so without this a round
    // cancelled between turn 1 and turn 2 spawned the whole generation anyway
    // and resolved with its text - billing the subscription and handing a
    // caller a generation for a keystroke they had moved past. One guard covers
    // that window, the shared-warm waiter's much wider one, and every call site
    // added later.
    if (opts.signal.aborted) {
      reject(abortError());
      return;
    }
    const child = spawn(config.binary ?? "claude", opts.args, { cwd: config.cwd });

    // Bytes, not strings. A `data` event boundary falls wherever the pipe's
    // read landed, which splits multibyte characters in half: decoding each
    // chunk on its own turns one `é` into two U+FFFD, JSON.parse still
    // succeeds, and the corruption is spliced into the user's file with nothing
    // logged. Both siblings decode with a streaming TextDecoder; this backend
    // needs no incremental text at all, so it concatenates and decodes once.
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    // One exit door for every path: it stops the watchdog, drops the abort
    // listener, and makes the first outcome the only outcome. Without it a
    // watchdog kill and the child's own close race to settle the same promise,
    // and the loser's cleanup leaks.
    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      opts.signal.removeEventListener("abort", onAbort);
      fn();
    };

    const fail = (reason: ClaudeCodeFailureReason, message: string): void =>
      settle(() => reject(new ClaudeCodeError(reason, message)));

    function onAbort(): void {
      // Kill first, settle second: the caller is already gone, and a surviving
      // CLI would keep spending the subscription on a reply nobody reads.
      // KNOWN LIMITATION, measured: this signals the `claude` process only, not
      // its process group, so any tool subprocess it had already spawned
      // outlives the kill and runs to completion. A process-group kill is not
      // portable to Windows, which this extension ships on, so the orphan is
      // accepted and documented rather than half-fixed.
      child.kill("SIGKILL");
      settle(() => reject(abortError()));
    }
    opts.signal.addEventListener("abort", onAbort);

    timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail("timeout", `Claude Code did not answer within ${config.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`);
    }, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (d: Buffer) => stdoutChunks.push(d));
    child.stderr.on("data", (d: Buffer) => stderrChunks.push(d));

    child.on("error", (err: NodeJS.ErrnoException) => {
      // Node reports a missing binary AND a nonexistent cwd as the same ENOENT.
      // Telling a user their `claude` is not installed when in fact the product
      // handed the spawn a directory that is not there sends them to fix the
      // wrong thing, so the two are separated by asking the filesystem.
      if (err.code === "ENOENT" && !existsSync(config.cwd)) {
        fail("bad-cwd", `Claude Code could not start: its working directory ${config.cwd} does not exist.`);
        return;
      }
      if (err.code === "ENOENT") {
        fail(
          "binary-missing",
          `Claude Code could not start: \`${config.binary ?? "claude"}\` is not on PATH.`,
        );
        return;
      }
      // The MESSAGE is unchanged; only its reason moved. See the union.
      fail("spawn-failed", `Claude Code could not start: ${err.message}`);
    });

    child.on("close", (code) =>
      settle(() =>
        resolve({
          code,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
        }),
      ),
    );

    child.stdin.on("error", () => undefined); // a child that died before reading stdin is diagnosed by its own exit
    // The prompt is stdin and nothing else: no trailing newline, no argv. An
    // argv-borne prompt would be visible in the process table and would hit the
    // platform's arg length limit on a realistic injected surface.
    child.stdin.end(opts.stdin);
  });
}

/**
 * Turn one finished child into a result or a typed failure. Throws
 * ClaudeCodeError; the caller owns settling the promise, so every classification
 * decision lives here rather than being spread across event handlers.
 */
function interpret(
  code: number | null,
  stdout: string,
  stderr: string,
  started: number,
  model: string | undefined,
  mode: string,
  degradedReason: string | undefined,
): { result: InstructGenerateResult; evidence: string } {
  const reply = parseReply(stdout);
  classifyFailure(code, stdout, stderr, reply);

  const { text, stripped } = stripOuterFence(reply.result);
  // WALL CLOCK, not the CLI's self-report. `duration_ms` excludes the process
  // spawn, the CLI boot, and the ~23-41k-token harness reload that rides
  // every subscription call - the sample payload says 1730ms for a round whose
  // realistic measured cost is 15.2s. The product prints this number on its own
  // evidence channel and the v44 rig will compare it against ollama's real wall
  // clock, so a partial number here would be compared against a whole one. The
  // CLI's figures are kept, on the evidence line, labelled as the CLI's.
  const totalMs = Date.now() - started;
  const turns = typeof reply.num_turns === "number" ? String(reply.num_turns) : "?";
  return {
    // Non-streaming: nothing arrives before the whole reply does, so there is
    // no honest time-to-first-token to report and ttft IS the total.
    result: { text, ttftMs: totalMs, totalMs, doneReason: doneReason(reply.stop_reason) },
    evidence:
      `[claude-code] fence-strip=${stripped ? "yes" : "no"} num_turns=${turns} ` +
      `model=${model ?? "cli-default"} cache-mode=${mode}` +
      // Why a round degraded, next to the fact that it did: a human reading the
      // channel has to be able to tell an expired checkpoint from a broken one.
      (degradedReason === undefined ? "" : ` cache-degraded=${degradedReason}`) +
      ` ttft=${totalMs}ms total=${totalMs}ms ` +
      `cli-ttft=${numberOr(reply.ttft_ms, -1)}ms cli-total=${numberOr(reply.duration_ms, -1)}ms ` +
      usageEvidence(reply.usage),
  };
}

/**
 * Every way a finished child can be a failure, in one place, so turn 1 and the
 * generation round classify identically. Throws ClaudeCodeError; returning
 * means the payload parsed and the CLI called it a success.
 */
function classifyFailure(
  code: number | null,
  stdout: string,
  stderr: string,
  reply: (ClaudeCodeReply & { result: string }) | undefined,
): asserts reply is ClaudeCodeReply & { result: string } {
  // WHICH TEXT IS A DIAGNOSTIC. stderr always is. stdout is only when it did
  // NOT parse into a reply - because when it did, stdout is the JSON carrying
  // the model's own generated code, and scanning that for "not logged in" or
  // "rate limit" reads the user's function body as if it were a CLI status.
  // Measured, all four on healthy rounds: a function named `check_rate_limit`,
  // a body returning `HttpError::new(429, ..)`, a body containing the string
  // "user is not logged in", and - with no bad code at all - a payload whose
  // `output_tokens` happened to be 429, since JSON puts word boundaries around
  // every number it holds. The last one is the dangerous one: it makes a
  // perfect round fail intermittently and unreproducibly, and the rig that
  // will drive this backend ABORTS A WHOLE RUN on a serving failure.
  const diagnostics = stderr + (reply === undefined ? stdout : "");
  if (LOGGED_OUT.test(diagnostics)) {
    throw new ClaudeCodeError(
      "logged-out",
      "Claude Code is not logged in. Run `claude` in a terminal, then `/login`.",
    );
  }
  if (SERVING_FAILURE.test(diagnostics)) {
    throw new ClaudeCodeError(
      "serving-failure",
      `Claude Code is rate limited or overloaded: ${firstLine(diagnostics)}`,
    );
  }
  if (reply === undefined) {
    // Nothing parseable came back, so the exit code is all there is to go on.
    throw code !== 0
      ? new ClaudeCodeError("exit", `Claude Code exited ${code}: ${firstLine(stdout + stderr) || "<no output>"}`)
      : new ClaudeCodeError(
          "bad-json",
          `Claude Code returned unparseable output: ${firstLine(stdout) || "<empty>"}`,
        );
  }

  // Past here the payload parsed, so every remaining decision is made from
  // FIELDS the CLI sets, never from the text it generated.
  if (SERVING_FAILURE.test(String(reply.api_error_status ?? ""))) {
    throw new ClaudeCodeError("serving-failure", `Claude Code upstream status ${String(reply.api_error_status)}.`);
  }
  if (reply.is_error === true || (reply.subtype !== undefined && reply.subtype !== "success")) {
    // The one place scanning `result` is safe: the CLI has said this payload is
    // a failure, so `result` holds its diagnostic rather than a generation. A
    // logged-out or throttled CLI that reports itself this way still gets the
    // reason that names the remedy.
    if (LOGGED_OUT.test(reply.result)) {
      throw new ClaudeCodeError(
        "logged-out",
        "Claude Code is not logged in. Run `claude` in a terminal, then `/login`.",
      );
    }
    if (SERVING_FAILURE.test(reply.result)) {
      throw new ClaudeCodeError(
        "serving-failure",
        `Claude Code is rate limited or overloaded: ${firstLine(reply.result)}`,
      );
    }
    throw new ClaudeCodeError(
      "cli-error",
      `Claude Code reported failure (subtype=${String(reply.subtype)}): ${firstLine(reply.result)}`,
    );
  }
  // An agentic reply is not a worse generation, it is a different kind of
  // thing: the model went and did something, and its text is a report of having
  // done it. Taking that text silently would put tool output in a function body.
  if (typeof reply.num_turns === "number" && reply.num_turns > 1) {
    throw new ClaudeCodeError(
      "agentic",
      `Claude Code took ${reply.num_turns} turns; that reply is an agent transcript, not a generation.`,
    );
  }
  if (code !== 0) {
    // A well-formed success payload from a process that still failed to exit
    // cleanly: trust the exit code, not the payload.
    throw new ClaudeCodeError("exit", `Claude Code exited ${code} despite a well-formed reply.`);
  }
}

/** Parse stdout into a reply, or undefined when it is not one. "Is it a reply"
 *  is what decides whether stdout may be read as a diagnostic at all, so the
 *  bar is deliberately strict: an object carrying a string `result`. */
function parseReply(stdout: string): (ClaudeCodeReply & { result: string }) | undefined {
  try {
    const parsed = JSON.parse(stdout) as ClaudeCodeReply;
    return typeof parsed?.result === "string" ? (parsed as ClaudeCodeReply & { result: string }) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which model id to put on `--model`, or undefined to let the CLI use its own
 * default. An ollama tag reaching Anthropic is a guaranteed unknown-model error
 * with a confusing message, and the fnGenModel setting still carries the LOCAL
 * default for every user who has not deliberately typed a Claude id. The colon
 * test is what actually fires today (both shipped local tags carry one, and no
 * Anthropic id does); the two explicit tags are kept for the day a shipped
 * default has no colon.
 */
/**
 * What the evidence should CALL the server of a round: the model id when one is
 * actually sent, or "cli-default" when none is and the CLI picks for itself.
 *
 * Exported because the alternative is spelling the rule twice. The vscode layer
 * needs the same answer for its `[carve]` line and for the label it hands the
 * fn-gen service, and a second copy of "is this an ollama tag" would drift from
 * this one the day a shipped default tag has no colon.
 */
export function claudeModelLabel(model: string): string {
  return modelArg(model) ?? "cli-default";
}

function modelArg(model: string): string | undefined {
  const tag = model.trim();
  if (
    tag === "" ||
    tag === DEFAULT_FNGEN_CONFIG.model ||
    tag === DEFAULT_FNGEN_CONFIG.fallbackModel ||
    tag.includes(":")
  ) {
    return undefined;
  }
  return tag;
}

/**
 * Take exactly one outer fence pair off, or nothing. Trap 1 in the file
 * comment is why this exists at all; "exactly one" is why it is this careful.
 * A reply whose CONTENT is markdown carries its own inner fences, and those are
 * the reply, not packaging - stripping greedily would corrupt the very replies
 * that need the least help. Anything that is not a clean open-and-close pair is
 * returned untouched and left to the postprocess's own fence rejection.
 */
function stripOuterFence(result: string): { text: string; stripped: boolean } {
  const lines = result.split("\n");
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && lines[first].trim() === "") {
    first++;
  }
  while (last > first && lines[last].trim() === "") {
    last--;
  }
  if (first >= last || !FENCE_OPEN.test(lines[first]) || !FENCE_CLOSE.test(lines[last])) {
    return { text: result, stripped: false };
  }
  return { text: lines.slice(first + 1, last).join("\n"), stripped: true };
}

/** Map the CLI's stop vocabulary onto the local one the fn-gen service already
 *  guards on ("length" is its truncation signal). An unrecognized reason passes
 *  through untranslated rather than being flattened to "stop": a reason nobody
 *  has seen yet must not read as a clean finish. */
function doneReason(stop: unknown): string | undefined {
  if (typeof stop !== "string") {
    return undefined;
  }
  if (stop === "end_turn") {
    return "stop";
  }
  if (stop === "max_tokens") {
    return "length";
  }
  return stop;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** The first line of a diagnostic, capped. "First line" alone is not a cap
 *  here: `--output-format json` emits the ENTIRE payload as one line, so an
 *  uncapped first line put 24KB into an error message that the fn-gen service
 *  logs verbatim and shows in a notification. */
function firstLine(text: unknown): string {
  const line = String(text ?? "").trim().split("\n")[0] ?? "";
  return line.length > EVIDENCE_CAP ? line.slice(0, EVIDENCE_CAP) + "..." : line;
}

const EVIDENCE_CAP = 200;

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}
