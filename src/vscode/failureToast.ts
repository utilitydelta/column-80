/** The failure translator: what the product SAYS when a backend refuses.
 *
 *  A leaf on purpose, for the reason `toastText.ts`'s own header gives one
 *  level down. Those helpers are a leaf because tightenDocComment, firstRun and
 *  oracleSurface all bound their toasts with them and none of the three may
 *  import fnGen, which registers them - a value edge back would be a cycle. The
 *  same three surfaces need the same translation, and while this table lived in
 *  `fnGen.ts` only fn-gen could reach it: the download toast put the provider's
 *  raw JSON on screen and the tighten gesture answered a 401, a 429 and a 503
 *  alike with "the model could not be reached", which is false for all three -
 *  the server was reached and it refused.
 *
 *  So the import edges run one way only: this file takes `toastText.ts` and
 *  `../core/errorBound` and nothing else of ours. It must never import
 *  `fnGen.ts`, `firstRun.ts`, `tightenDocComment.ts` or anything that imports
 *  them.
 *
 *  Moved out of `src/vscode/fnGen.ts` byte for byte. Every sentence, every
 *  marker and every ordering rule below is as it was; a wording change smuggled
 *  in on a move is a change nobody reviewed.
 */
import { HttpStatusError } from "../core/errorBound";
import { firstLine, oneLineWithPointer } from "./toastText";

/** Toast sentences for the service's known rejects (roadmap item 63).
 *
 * One string used to serve two audiences: the service throws channel-grade
 * messages and the gesture catch-alls forwarded them raw, `Error:` prefix
 * included. Now the service keeps its channel wording byte for byte and this
 * table owns what the user sees.
 *
 * Each entry matches a DISTINCTIVE SUBSTRING of one throw message, never the
 * full string: a full-string match would silently fall through to the
 * catch-all the moment the service wording grows a detail. COUPLING: every
 * marker is pinned at its throw site (src/core/fnGenService.ts for the service
 * rejects, src/core/ollama.ts, anthropicInstruct.ts and cloudInstruct.ts for
 * the transport class), each of which carries a comment naming its marker, and
 * test/impl-v56-p4-toast-translation.test.cjs and
 * test/impl-v57-p4-one-voice.test.cjs go red if a throw moves off its marker
 * without this table following.
 *
 * A row carries a marker SET, not a marker, because one user-visible failure is
 * thrown in different words by each transport it can happen on. The set is what
 * keeps the table one row per THING THAT HAPPENED rather than one row per
 * wording (roadmap item 66).
 *
 * `anchored` rows match with startsWith rather than includes. A throw that
 * interpolates server text can otherwise be made to contain another row's
 * marker by the server, and the first matching row wins. Every transport marker
 * sits at index 0 of its throw, so anchoring them costs nothing. The service
 * rows stay on `includes`; two of them do not begin their message and anchoring
 * those needs a reworded throw, which is a change to the service's throw
 * contract rather than a row (session scraps S57-5).
 *
 * Anchoring alone does NOT close the forgery, which is what PAYLOAD_CARRIERS is
 * for. A transport message that carries server text and gets no crafted sentence
 * still reaches the unanchored pass, and a service marker found INSIDE that
 * payload is the server talking, not the service: an ollama stream whose error
 * field reads "generation was empty after postprocess" drew the empty-code
 * sentence. A message that opens with one of these heads is a payload carrier,
 * and no service row may match inside it.
 */
const TEST_REFUSAL_TOAST =
  "Column 80: the model's reply contained no usable tests, so nothing was written - run the gesture again.";

interface RejectToast {
  /** Distinctive substrings, any one of which identifies this failure. */
  readonly markers: readonly string[];
  /** Match with startsWith rather than includes. See the note above. */
  readonly anchored?: true;
  readonly toast: string;
}

const SERVICE_REJECT_TOASTS: ReadonlyArray<RejectToast> = [
  {
    markers: ["generation truncated at num_predict"],
    toast: "Column 80: the model's reply was cut off mid-function, so nothing was written - run the gesture again.",
  },
  // The test-module refusal has a Rust and a non-Rust throw; one sentence
  // covers both.
  { markers: ["does not contain a test module", "test functions (no fenced block"], toast: TEST_REFUSAL_TOAST },
  {
    markers: ["generation contains a code-fence line"],
    toast:
      "Column 80: the model wrapped its reply in markdown that cannot land in source code, so nothing was written - run the gesture again.",
  },
  {
    markers: ["generation does not contain the requested function"],
    toast:
      "Column 80: the model answered with something other than the requested function, so nothing was written - run the gesture again.",
  },
  {
    markers: ["generation was empty after postprocess"],
    toast: "Column 80: the model's reply contained no usable code, so nothing was written - run the gesture again.",
  },
  {
    // THE SILENT SERVER, on every transport that can have one. Item 63 bought
    // this sentence for the ollama arm only, so the same event reached the user
    // in three voices: two of them handed over `message_stop` and
    // `response has no body`, which are API vocabulary rather than
    // instructions. One event, one sentence (roadmap item 66).
    //
    // Every marker here is the HEAD of its throw string, which is what lets the
    // row be anchored. A new one must be too: a marker that sits after an
    // interpolation can be moved by a format change, or forged by a server.
    markers: [
      "Ollama stream cut:",
      "Ollama: response has no body",
      "Anthropic: the stream ended before message_stop",
      "Anthropic: response has no body",
      "Cloud: response has no body",
      // Roadmap item 67. Until these two throws existed, only the
      // Anthropic arm could FEEL a stream die mid-reply; the local and cloud
      // readers returned whatever text had arrived and the service accepted it,
      // so a half function was proposed as a complete generation. Same event as
      // the five above, so the same sentence - a second wording for one failure
      // is the defect item 66 closed.
      "Ollama: the stream ended before its done frame",
      "Cloud: the stream ended before any terminal signal",
    ],
    anchored: true,
    toast:
      "Column 80: the model server went silent mid-reply, so nothing was written - check the server, then run the gesture again.",
  },
];

/**
 * THE STRUCTURAL PASS. What a failure IS, rather than what its message says.
 *
 * Every row in the table above matches text. That works while the product owns
 * the whole string, and the Claude Code backend is where it stops working: its
 * failures lead with output the CLI chose, so a marker cannot be anchored ahead
 * of the interpolation and matching a substring of CLI text would let the CLI
 * pick the sentence. It already throws the stronger signal - a `ClaudeCodeError`
 * whose `reason` is set at the throw site, from a union of ten - so this reads
 * that instead (roadmap item 68).
 *
 * Session-v57 set "roughly ten rows" as the point to reconsider the table.
 * Claude Code's reasons alone would double it.
 *
 * IT ALSO CLOSED A HOLE NOBODY HAD CLAIMED. Before this pass, a Claude Code
 * message began with the backend's own prefix, matched no `PAYLOAD_CARRIERS`
 * head, and so reached the substring pass - where a CLI that printed
 * `generation was empty after postprocess` drew the model-refusal sentence.
 * A failure on one backend could be told to the user in another failure's
 * words.
 *
 * IT ONLY EVER NARROWS. A reason with no entry returns undefined and falls
 * through to the three passes that already exist, so nothing that is not a
 * `ClaudeCodeError` can reach a different sentence than it does today.
 *
 * `no-session` has no entry on purpose: the union's own comment says it never
 * surfaces as a round failure, because a turn-1 warm that parses clean without a
 * session id degrades to a whole-prompt round and says so on the evidence line.
 * Giving it a sentence would invent a reachability it does not have.
 */
const CLAUDE_CODE_SENTENCES: Readonly<Record<string, (message: string) => string>> = {
  "logged-out": () =>
    "Column 80: Claude Code is not logged in, so nothing was written - run `claude` in a terminal, " +
    "then `/login`, and run the gesture again.",
  // THE ONE EXCEPTION to "no interpolation on screen", and it is safe because
  // these two messages are product prose end to end: the only thing either
  // interpolates is a binary name or a working directory this extension's own
  // settings chose. A user who cannot start the backend needs to see WHICH
  // path was wrong; a sentence that hides it sends them to the channel to
  // learn one word.
  // NEITHER CLAUSE NAMES A SETTING, because there is no setting. The binary
  // comes from a fixed candidate list `resolveClaudeBinary` probes, and the
  // working directory is `globalStorageUri/claude-cwd`, created once when the
  // service is built. The first cut of these two sentences sent the user to
  // "the Claude Code binary setting" and "the working directory setting",
  // neither of which the product contributes - a crafted sentence naming a
  // remedy that does not exist, which is worse than the raw message it
  // replaced and is exactly the failure S20 was written about.
  //
  // The real remedies: PATH is re-resolved on every spawn, so putting `claude`
  // back is enough; the directory is created once, so only a rebuild of the
  // service restores it, and a window reload is how a user does that.
  "binary-missing": (message) =>
    oneLineWithPointer(`Column 80: ${message}`, "", " Put `claude` on PATH, then run the gesture again."),
  "bad-cwd": (message) =>
    oneLineWithPointer(`Column 80: ${message}`, "", " Reload the window, then run the gesture again."),
  // A spawn that failed for any reason other than the two above: EACCES, EPERM,
  // EMFILE. The backend never started, so it does NOT belong with the CLI-failed
  // family - a user whose binary is not executable should not read "the CLI
  // failed". It carries no cause, unlike its two siblings, because what it
  // interpolates is Node's own ErrnoException rather than product prose.
  "spawn-failed": () =>
    "Column 80: Claude Code could not start, so nothing was written - the full message is in the " +
    "output channel.",
  // NO TIMING PROMISE, and the pointer is unconditional. This class is a
  // POSITIVE classification the product makes - it fires only on a rate-limit,
  // overloaded, quota or 429/529 match - so unlike S20's generic envelope a
  // crafted sentence is true of every member of it. What it cannot know is HOW
  // LONG: a per-minute rate limit clears in seconds and a subscription window
  // in hours, and the first cut said "wait a moment" for both. All three throw
  // sites interpolate a diagnostic this sentence discards and the service logs
  // whole, so the pointer is kept by construction rather than by luck, which is
  // why it can be unconditional where `oneLineWithPointer`'s must be earned.
  "serving-failure": () =>
    "Column 80: Claude Code is rate limited or its provider is having trouble, so nothing was " +
    "written - wait, then run the gesture again. The full message is in the output channel.",
  timeout: () =>
    "Column 80: Claude Code did not answer in time, so nothing was written - run the gesture " +
    "again, or check that the CLI still responds.",
  // FOUR REASONS, ONE SENTENCE, because the next action is the same for all
  // four: read the channel. `exit` is a non-zero exit, `cli-error` a declared
  // failure, `bad-json` unparseable output and `agentic` a reply that is an
  // agent transcript rather than a generation - four different faults with one
  // remedy, and item 66's rule is one sentence per thing the USER must do.
  // None of their raw text reaches here: every one of them leads with CLI
  // output.
  exit: () => CLI_FAILED_TOAST,
  "cli-error": () => CLI_FAILED_TOAST,
  "bad-json": () => CLI_FAILED_TOAST,
  agentic: () => CLI_FAILED_TOAST,
};

const CLI_FAILED_TOAST =
  "Column 80: the Claude Code CLI failed, so nothing was written - the full message is in the " +
  "output channel.";

/** What a SURFACE says happened, and how the user retries there.
 *
 *  Every status sentence below has the shape
 *  `Column 80: <CAUSE>, so nothing was written - <REMEDY>. <pointer>`, and the
 *  two halves are not equally portable. The CAUSE is what the server did, so it
 *  is true wherever the throw lands. The consequence and the remedy are about
 *  the gesture, and on two of the three surfaces the generation gesture's words
 *  were false:
 *
 *  * The tighten gesture does NOT stop at its warn. It goes on through the
 *    delta and existence gates and applies the re-wrap, so "nothing was
 *    written" arrived in the same notification as the write, beside
 *    "The re-wrap needs no model." - the product contradicting itself in one
 *    sentence.
 *  * The download has no gesture to run again. The user clicked Download in a
 *    notification, and "run the gesture again" names a control that is not
 *    there - the same defect a crafted remedy pointing at a setting that does
 *    not exist was, one class up.
 *
 *  So they split. One throw class still produces one DIAGNOSIS on every
 *  surface, which is the invariant worth holding; only this half varies. */
export interface SurfaceVoice {
  /** The clause after the cause: what did NOT happen here. */
  readonly consequence: string;
  /** How the user retries HERE, named as a control that exists. */
  readonly retry: string;
}

/** The generation gestures, and the DEFAULT everywhere. Every caller that does
 *  not name a surface draws exactly the sentences it drew before the split. */
export const GENERATION_VOICE: SurfaceVoice = {
  consequence: "so nothing was written",
  retry: "run the gesture again",
};

/** The tighten gesture's model round only supplies backticked type names, so a
 *  refused round costs the names and nothing else. This is the clause the
 *  surface's own unclassified sentence has always used, kept rather than
 *  invented. */
export const TIGHTEN_VOICE: SurfaceVoice = {
  consequence: "so no type names were offered",
  retry: "run the gesture again",
};

/** The download. Its retry names the command the product's own "fn-gen is
 *  disabled" message names, because that command IS how a user reaches the
 *  one-click download again - `offerModelPull` has no other entry point. */
export const DOWNLOAD_VOICE: SurfaceVoice = {
  consequence: "so the model was not downloaded",
  retry: 'run "Column 80: Select Hardware Tier" to try again',
};

/** What an HTTP status means to the person who has to do something about it.
 *
 *  CLASSES, NOT CODES. A 401 and a 403 are one problem to a user - the key was
 *  refused - and a 500, 502, 503 and 529 are one problem too. The class is the
 *  actionable unit; the code is a support detail, and phase 1's `[http-body]`
 *  channel line already carries it for that.
 *
 *  Which is why these sentences do NOT repeat the number and the fallback does:
 *  where a class is known, the class IS the information; where none is, the
 *  number is the only specific thing the product knows and withholding it would
 *  leave the user nothing to search for.
 *
 *  The provider's own body never reaches here. It is in the channel twice - raw
 *  under `[http-body]`, bounded under `[fngen] request failed:` - and putting a
 *  JSON document where a sentence belongs is what this replaces. */
function httpStatusSentence(transport: string, status: number, voice: SurfaceVoice): string | undefined {
  if (status === 401 || status === 403) {
    // TWO SENTENCES, because the next action genuinely differs by arm and this
    // is the one class where it does. `column80.cloudApiKey` is the product's
    // ONLY key setting and its own description says the local backend ignores
    // it, so sending an ollama user there would be phase 6's defect again: a
    // crafted remedy pointing at a control that cannot help them. The local
    // variant names no setting at all, deliberately - a 401 from ollama means
    // something in front of it wants auth, and that is the user's own
    // deployment.
    return transport === "ollama"
      ? `Column 80: the local model server refused the request as unauthorised, ${voice.consequence} - ` +
          "check the server's own authentication. The full message is in the output channel."
      : `Column 80: the model provider refused the API key, ${voice.consequence} - check ` +
          `\`column80.cloudApiKey\`, then ${voice.retry}. The full message is in the output channel.`;
  }
  if (status === 429) {
    // The pointer is not decoration here: the body separates a per-minute rate
    // limit from an exhausted quota, and "wait, then run the gesture again"
    // only clears the first. The class cannot say which; the channel can.
    return (
      // "this key" was wrong on one arm. 401/403 splits on transport because
      // the remedy differs; this one does not need a split, it needed a word
      // that is true everywhere - the local backend has no key to rate limit.
      `Column 80: the model provider is rate limiting these requests, ${voice.consequence} - ` +
      `wait, then ${voice.retry}. The full message is in the output channel.`
    );
  }
  // THE WHOLE 5xx RANGE, not four enumerated codes. The first cut listed 500,
  // 502, 503 and 529 and dropped 504 - the commonest of the set after 503 - plus
  // Cloudflare's 520 to 524, onto the path below. "Try again shortly" is true of
  // every 5xx by HTTP semantics; there is none where waiting is the wrong next
  // action. NaN fails both comparisons and Infinity fails the second, so neither
  // reaches a sentence.
  if (status >= 500 && status < 600) {
    // NO `voice.retry` HERE, and none in the 401 local branch either. "Try
    // again shortly" is already surface-independent, and a local server's own
    // authentication is not something a gesture re-run fixes. A voice supplies
    // words where the sentence needs them, not everywhere it could.
    return (
      `Column 80: the model provider is having trouble, ${voice.consequence} - try again ` +
      "shortly. The full message is in the output channel."
    );
  }
  // NO SENTENCE, and this is a ruling rather than a gap.
  //
  // The first cut answered an unclassified status with "the model provider
  // answered with HTTP 404", which DELETED the only useful thing on screen. A
  // 404 carries `model "x" not found, try pulling it first`; a 400 carries
  // `prompt is too long: 250000 tokens > 200000 maximum`; a 413 carries
  // `context_length_exceeded`. Those are exactly the statuses where the BODY is
  // the next action, and exactly the ones with no class - so the crafted
  // sentence replaced a remedy with a number.
  //
  // That is S20's ratified reasoning one layer out: no class means no crafted
  // sentence, because the provider's own message is the actionable half. Falling
  // through hands the message to the catch-all, which renders the status, the
  // provider's reason AND the channel pointer - so the number reaches the screen
  // anyway, just not inside a sentence this product invented.
  return undefined;
}

/** A crafted sentence for a typed backend failure, or undefined for anything
 *  else.
 *
 *  Identity, never text: `name` is set in the `ClaudeCodeError` constructor and
 *  `reason` beside it, so neither can be forged by a CLI or a server putting
 *  words in its output. A plain `Error` carrying the identical message gets
 *  today's catch-all, which is the distinction this pass exists to make.
 *
 *  Defensive about the shape because the thing being classified is a caught
 *  `unknown`: a non-Error, a null, or a plain object wearing the right `name`
 *  must not reach the map or crash the translator. */
function translateStructural(err: unknown): string | undefined {
  if (!(err instanceof Error) || err.name !== "ClaudeCodeError") {
    return undefined;
  }
  const reason = (err as Error & { reason?: unknown }).reason;
  if (typeof reason !== "string") {
    return undefined;
  }
  // OWN PROPERTIES ONLY. A bare object literal inherits from
  // `Object.prototype`, so a reason of `constructor` used to return the raw
  // message with its `Error:` token intact, `toString` rendered
  // `[object Object]`, and `__proto__` threw a TypeError out of
  // `generationFailedToast` - which runs inside the gesture's own catch, so the
  // user got no toast at all. Unreachable from a throw site today, all of which
  // pass literals, but the contract says an unrecognised reason falls through
  // and six names did not.
  if (!Object.prototype.hasOwnProperty.call(CLAUDE_CODE_SENTENCES, reason)) {
    return undefined;
  }
  return CLAUDE_CODE_SENTENCES[reason](err.message);
}

/** The second case of the same pass: an HTTP status, from the transport that
 *  set it.
 *
 *  `instanceof`, not a name check, and not a text match. The status is a number
 *  the transport read off a `Response`, so no server can forge a class by
 *  putting `429` in its body - which is the whole reason this is a typed error
 *  rather than three more marker rows.
 *
 *  EXPORTED because one surface wants ONLY this, and used to get it by gating
 *  the whole translator on `err instanceof HttpStatusError` - which is not the
 *  same thing. The gate admits every typed status, and an UNCLASSIFIED one
 *  returns undefined from here and fell through to the anchored, payload-carrier
 *  and substring passes. Driven: a 404 whose message read
 *  `pull failed: generation was empty after postprocess` drew a GENERATION
 *  reject's sentence on a download toast. Unreachable through the download
 *  transport, whose every message is headed `Ollama <status> ` and so trips the
 *  carrier guard - so the surface was protected by a table two modules away
 *  rather than by the gate whose comment claimed the protection. This is that
 *  gate, said in code. */
export function httpStatusToast(err: unknown, voice: SurfaceVoice = GENERATION_VOICE): string | undefined {
  return err instanceof HttpStatusError ? httpStatusSentence(err.transport, err.status, voice) : undefined;
}

/** Message heads that mean "the rest of this string came from the server."
 *
 *  Every one of these interpolates text the model server chose, so a service
 *  reject's marker appearing later in the message is the server's words and not
 *  the service's. See the note on the table above. */
const PAYLOAD_CARRIERS: readonly string[] = [
  "Ollama error:",
  "Ollama stream cut:",
  "Ollama ",
  "Anthropic reported an error mid-reply:",
  "Anthropic ",
  // Listed explicitly even though the broader `"Cloud "` head below already
  // covers it, for the reason its Anthropic twin above is listed beside
  // `"Anthropic "`: this table is read as the inventory of throws that carry
  // server-chosen text, and a reader looking for the cloud error frame should
  // find it named rather than have to notice it falls under a prefix.
  "Cloud reported an error mid-reply:",
  "Cloud ",
];

/** The crafted sentence for a known service reject, or undefined for anything
 *  else. Matches on the error MESSAGE (String(err) would prepend "Error: ").
 *
 *  `voice` is the SURFACE's consequence clause, and it defaults to the
 *  generation gestures' so every caller that does not name a surface gets the
 *  sentence it got before the split, byte for byte. Only the HTTP status
 *  sentences read it today; the structural and marker rows are one wording per
 *  throw and stay that way. */
export function translateServiceReject(err: unknown, voice: SurfaceVoice = GENERATION_VOICE): string | undefined {
  // STRUCTURAL FIRST, before any text is looked at. A typed failure knows what
  // it is; every pass below is guessing from a string, and the backend this
  // serves leads its strings with text the CLI chose. Only ever narrows: an
  // unrecognised reason returns undefined and falls straight through.
  const structural = translateStructural(err) ?? httpStatusToast(err, voice);
  if (structural !== undefined) {
    return structural;
  }
  const text = err instanceof Error ? err.message : String(err);
  // ANCHORED ROWS FIRST, and the order is the point rather than an optimisation.
  // "this message BEGINS with the marker" is a stronger claim than "this message
  // contains it somewhere", and the weaker one is satisfiable by text a server
  // chose. Without this pass a transport failure whose payload happened to carry
  // a service reject's words drew the service reject's sentence: the first
  // matching row wins, and the service rows are declared first.
  const anchored = SERVICE_REJECT_TOASTS.find(
    (row) => row.anchored === true && row.markers.some((m) => text.startsWith(m)),
  );
  if (anchored !== undefined) {
    return anchored.toast;
  }
  // ANCHORED FIRST, then the payload guard, then the substring rows. "This
  // message BEGINS with the marker" is a stronger claim than "it contains the
  // marker somewhere", and only the weaker one is satisfiable by text a server
  // chose, so the strong pass runs first and a payload carrier never reaches the
  // weak one at all.
  if (PAYLOAD_CARRIERS.some((head) => text.startsWith(head))) {
    return undefined;
  }
  // `row.anchored !== true` is not decoration. Without it an anchored row is
  // reachable by substring here, which is the exact matching this pass exists to
  // keep it out of.
  return SERVICE_REJECT_TOASTS.find(
    (row) => row.anchored !== true && row.markers.some((m) => text.includes(m)),
  )?.toast;
}

/** What a gesture catch-all toasts: a known reject gets its crafted sentence;
 *  an unknown error gets its first line plus the channel pointer, never the
 *  raw multi-line dump. The channel keeps the full message either way (the
 *  service logs every reject and transport failure verbatim).
 *
 *  The unknown branch reads err.message for the same reason translateServiceReject
 *  does: String(err) prepends "Error: ", which is the internal jargon this whole
 *  table exists to keep out of a toast. An error whose message is empty gets the
 *  bare sentence rather than a dangling "failed - Error." */
export function generationFailedToast(err: unknown, gesture: string): string {
  const translated = translateServiceReject(err);
  if (translated !== undefined) return translated;
  const detail = firstLine(err instanceof Error ? err.message : String(err))
    .replace(/\.$/, "")
    .trim();
  return detail === ""
    ? `Column 80: ${gesture} failed. The full message is in the output channel.`
    : `Column 80: ${gesture} failed - ${detail}. The full message is in the output channel.`;
}
