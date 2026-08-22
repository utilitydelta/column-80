/**
 * Manual context blocks: the ordered list of LINE RANGES the user chose to
 * show the model. The product's identity feature, and the mechanism stays
 * dumb by design - no auto-inclusion, no retrieval, no ranking. The store
 * holds exactly what the human added, in the order they added it.
 *
 * The identity claim is: the lines you chose, AS THEY READ NOW. That reversed
 * the older claim ("the snapshot you saw is the snapshot the model gets") on
 * purpose: a block over a function you are still writing has to carry the
 * implementation you just typed into it, or the human is generating against
 * text that no longer exists. The trade is reproducibility of the exact bytes,
 * which the panel showing live text is what keeps inspectable.
 *
 * The zero-tolerance guarantee hangs on consumption discipline: prompt
 * assembly reads the live list at generate time, never a copy captured
 * earlier. Under the async payload path that costs one more mechanism, and
 * adversarial review found it missing: `resolveForPrompt` is suspended on an
 * await while the human still has the panel, so a block can be removed AFTER
 * its own text was read and it is already in the emission list. What earns the
 * word "provably" is the POST-WALK filter: the returned projection is built by
 * walking the live list at the end and taking each surviving entry's block, so
 * a removed block has nothing left to reach the prompt through.
 *
 * A block is live, or it is LOST. Lost is terminal: only remove or a fresh add
 * clears it, and nothing heals on its own. `reanchorRange` decides which, per
 * change EVENT, against the block's pre-event range so the answer cannot depend
 * on the order the changes arrive in.
 *
 * The anchor is three-way (shift, resize, lost) and `resolveForPrompt` reads
 * each block's payload out of the live document at generate time, through a
 * reader the vscode layer supplies. `text` is the LAST KNOWN slice rather than
 * the payload: it is what the panel previews without an await and what the
 * re-adoption audit compares against after a close. `toPromptBlocks()` keeps
 * its synchronous last-known semantics for the headless callers that ride it,
 * and nothing that reaches a model rides it.
 */

import { ContextBlock, ContextBlockRange } from "./prompt";
import { LogFn } from "./completionService";

/** Why a block stopped tracking its lines. Terminal, all three of them. */
export type LostReason =
  /** A change crossed the block's boundary. */
  | "crossed"
  /** The file was deleted, or is unreadable. */
  | "deleted"
  /** Tracking lapsed and the recorded range no longer matches the last known text. */
  | "lapsed";

export interface ContextBlockEntry {
  /** Store-scoped, monotonic ("b1", "b2", ...), never reused. */
  id: string;
  uri: string;
  /** 1-based inclusive source line range, LIVE: it tracks every edit. */
  range: ContextBlockRange;
  /** The LAST KNOWN slice of those lines, for the panel preview and the
   *  re-adoption audit. Not the prompt payload: `resolveForPrompt` reads that
   *  out of the live document. */
  text: string;
  /** The version of the last event processed for this uri. */
  addedAtVersion: number;
  /** ABSENT while tracking is live, never present-and-false: the document
   *  closed, so the range is no longer known to be exact. */
  lapsed?: true;
  /** ABSENT while the block is healthy, never present-and-false. */
  lost?: LostReason;
}

export interface AddBlockInput {
  uri: string;
  range: ContextBlockRange;
  text: string;
  version: number;
}

/** Whatever the caller currently knows about the source document. Either
 *  field may be absent (document closed, version unavailable); a field
 *  present but undefined counts as absent. */
export interface StalenessProbe {
  version?: number;
  text?: string;
}

/** 0-based inclusive line span, the shape editor decorations and selections
 *  consume. Entry ranges are 1-based; the conversion lives here so both the
 *  highlight and the click-to-reveal share one clamp. */
export interface EditorLineSpan {
  startLine: number;
  endLine: number;
}

/**
 * The entry's lines as an editor span, clamped to the document's current
 * length. A shrunk document still yields a valid span (landing near where
 * the block WAS beats a dead click); an empty document yields undefined.
 */
export function clampedLineSpan(
  range: ContextBlockRange,
  lineCount: number,
): EditorLineSpan | undefined {
  if (lineCount < 1 || range.endLine < 1) {
    return undefined;
  }
  const endLine = Math.min(range.endLine, lineCount) - 1;
  const startLine = Math.max(0, Math.min(range.startLine - 1, endLine));
  return { startLine, endLine };
}

/**
 * The spans to highlight in an open document: LIVE entries only.
 *
 * A live block's range tracks every edit, so its lines are where the range says
 * they are and the tint is honest by construction. A LOST block is skipped: its
 * range is a record of where the block used to be, and tinting those lines
 * green would claim the model still gets them when the whole point of the red
 * tree row is that it does not.
 *
 * `lineCount` is the only thing about the document this needs. There is no
 * staleness probe here any more, because there is no stale state left to probe
 * for: text is read at generate time and a block whose text changed is the
 * feature rather than the warning.
 */
export function decorationLineSpans(
  entries: readonly ContextBlockEntry[],
  lineCount: number,
): EditorLineSpan[] {
  const spans: EditorLineSpan[] = [];
  for (const entry of entries) {
    if (entry.lost) {
      continue;
    }
    const span = clampedLineSpan(entry.range, lineCount);
    if (span) {
      spans.push(span);
    }
  }
  return spans;
}

/**
 * What the human sees, decided in core so the decisions are testable without an
 * extension host. The vscode layer turns these answers into pixels and nothing
 * else: this is the repo's standing split, where the store owns state and
 * `[ctx]` evidence and the panel owns gestures and pixels.
 */
export interface BlockRowShape {
  /** A theme icon id. There is no third member on purpose: a healthy block
   *  never carries a warning again. */
  icon: "file" | "error";
  /** A theme color id, absent when the row takes the default foreground. */
  color?: string;
  /** The tree row's description, `L3-L8`, plus ` (lost)` when it is lost. */
  description: string;
  /** The tooltip sentence naming which loss fired. Absent when healthy. */
  reason?: string;
}

/**
 * One sentence per `LostReason`, and the three DIFFER because a tooltip that
 * says the same thing for three causes tells the human nothing about which one
 * fired. Copy is the human's to rewrite in a UX pass; the shape is not.
 */
const LOST_REASON_SENTENCE: Record<LostReason, string> = {
  crossed: "an edit crossed this block's boundary",
  deleted: "its file was deleted or cannot be read",
  lapsed: "its document closed and the lines no longer match",
};

/**
 * What one tree row looks like.
 *
 * The description is a function of the entry's CURRENT range and nothing else,
 * so it moves as the block moves. A `lapsed` block renders exactly like a
 * healthy one: a lapse is a thing the next resolve may recover from, and a
 * warning for it would fire on every tab close, which is the noise this session
 * exists to remove.
 *
 * Pure. The entry is not mutated, which matters because the panel repaints on
 * every keystroke.
 */
export function blockRowShape(entry: ContextBlockEntry): BlockRowShape {
  const range = `L${entry.range.startLine}-L${entry.range.endLine}`;
  if (!entry.lost) {
    return { icon: "file", description: range };
  }
  // A reason with no sentence behind it yields NO `reason` key rather than one
  // that is present-and-undefined. The union is closed, so this cannot fire
  // today; what it buys is that adding a fourth reason and forgetting its
  // sentence loses a tooltip line instead of producing a value the entry
  // contract says may not exist.
  const sentence = LOST_REASON_SENTENCE[entry.lost];
  return {
    icon: "error",
    color: "list.errorForeground",
    description: `${range} (lost)`,
    ...(sentence === undefined ? {} : { reason: sentence }),
  };
}

/**
 * ONE message for however many blocks a single event took, each named the way
 * its tree row reads so the human can go straight to the row.
 *
 * One block and three blocks are two different sentences rather than one frame
 * with a list poured into it: "1 blocks were lost" is the bug this shape
 * exists not to have. Empty in, empty out; the caller only toasts when
 * something was actually lost.
 */
export function lostToastMessage(entries: readonly ContextBlockEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  const named = entries
    .map((e) => `${fileLabel(e.uri)} L${e.range.startLine}-L${e.range.endLine}`)
    .join(", ");
  if (entries.length === 1) {
    return `a context block is lost and will not reach the model: ${named}.`;
  }
  return `${entries.length} context blocks are lost and will not reach the model: ${named}.`;
}

/**
 * The last path segment of a uri, which is the label a block's panel row
 * carries. Lives here rather than in the vscode layer because the loss toast,
 * the generate-time warning and the tree row must all name one uri the same
 * way, and two label rules would eventually disagree about one of them.
 *
 * Hand-rolled rather than `vscode.Uri.parse` so core stays free of `vscode`.
 * Anything it cannot make a segment out of falls back to the whole uri, which
 * is a poor label but never a wrong one.
 */
export function fileLabel(uri: string): string {
  const path = uri
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, "")
    .replace(/^\/\/[^/?#]*/, "")
    .split(/[?#]/)[0];
  const tail = path.split("/").filter((s) => s !== "").pop();
  if (tail === undefined) {
    return uri;
  }
  try {
    // Percent-escapes are how a uri carries a space or a hash in a filename;
    // the human's tree row shows the filename, not its encoding.
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

/**
 * The lines of `range` out of `text`, 1-based inclusive, EOL-normalized
 * (no CR, no trailing newline). A trailing newline terminates the last
 * line rather than opening an empty one, so "a\nb\n" has two lines.
 * Malformed or out-of-range inputs degrade to "" rather than throwing. That
 * degradation is not display-only: this is the PAYLOAD path, and
 * `resolveForPrompt` reads a "" slice as lost:"crossed" and drops the
 * block. Which is why "" is still the right answer rather than a throw. A range
 * that resolves to nothing is not a block, and saying so loses one block where
 * a panic loses the whole generation.
 */
export function sliceLines(text: string, range: ContextBlockRange): string {
  const { startLine, endLine } = range;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    return "";
  }
  const lines = text.split(/\r\n|\n/);
  if (lines[lines.length - 1] === "") {
    // The split's trailing empty segment is the artifact of a final
    // newline (or empty text), not a line a user could have selected.
    lines.pop();
  }
  if (startLine > lines.length) {
    return "";
  }
  return lines.slice(startLine - 1, Math.min(endLine, lines.length)).join("\n");
}

// Staleness comparison tolerance: editors disagree about CRLF and whether a
// selection drags in the final newline, and neither difference means the
// source changed under the user.
function canonical(text: string): string {
  const lf = text.replace(/\r\n/g, "\n");
  return lf.endsWith("\n") ? lf.slice(0, -1) : lf;
}

/**
 * "Has the source changed since the snapshot" was the older question, and the
 * claim it served has been reversed: there is no snapshot any more, and a
 * block whose text changed is the feature rather than the warning. So this
 * has exactly one job left, and it is LEG 2: does the recorded range still
 * slice to the last known text, under a rule that forgives CRLF and a trailing
 * newline because editors disagree about both and neither means the source
 * moved. That is the re-adoption audit after a document closes, which
 * `resolveForPrompt` runs inline against the same `canonical` so a second rule
 * cannot drift from the first.
 *
 * Nothing in `src/**` calls this any more: the decoration filter was its last
 * caller and it now filters on `lost`. It stays exported because it is a
 * black-box surface frozen oracles bind to, and because `canonical` below is
 * the rule the audit shares with it.
 */
export function isStale(entry: ContextBlockEntry, probe: StalenessProbe): boolean {
  if (probe.version !== undefined && probe.version !== entry.addedAtVersion) {
    return true;
  }
  // The text leg catches reopened documents whose version counter reset.
  if (probe.text !== undefined && canonical(sliceLines(probe.text, entry.range)) !== canonical(entry.text)) {
    return true;
  }
  return false;
}

/**
 * One VS Code content change, reduced to what an anchor cares about. The
 * vscode layer builds these; core never sees a `vscode` type.
 */
export interface LineChange {
  /** 0-based first line of the REPLACED range. */
  startLine: number;
  /** 0-based last line of the REPLACED range. */
  endLine: number;
  /** 0-based character of the replaced range's END. Only `0` is load-bearing. */
  endCharacter: number;
  /** Newlines in the REPLACEMENT text. Zero for a single-line replacement. */
  newlineCount: number;
  /**
   * Does the content FOLLOWING this replacement still begin on a fresh line?
   * The vscode layer computes it as
   *   `change.text.endsWith("\n") || (change.text.length === 0 && change.range.start.character === 0)`
   * and it is REQUIRED so a producer cannot forget it. It is the one bit the
   * other four fields cannot recover: they say which lines were replaced and
   * how many newlines went back, never whether the boundary at the replaced
   * range's END survived.
   *
   * A hand-written fixture that omits it reads as `false` at runtime, which
   * keeps one line too many. That is the safe direction: an extra line beats
   * dropping the block's closing brace.
   */
  endsAtLineStart: boolean;
}

export type ReanchorOutcome =
  /** The block moved; its own lines were not touched. */
  | { kind: "shift"; range: ContextBlockRange }
  /** The block's own lines changed: the end moves, the start does not. */
  | { kind: "resize"; range: ContextBlockRange }
  /** A change crossed a boundary, so what the human pointed at no longer has
   *  both ends. Terminal. */
  | { kind: "lost"; reason: "crossed" };

/** What one change event did to the blocks of one uri. `moved` counts the
 *  entries whose range or version changed; `lost` carries the entries lost by
 *  THIS event, in list order, so the vscode layer can raise ONE notification
 *  naming all of them however many blocks the edit crossed. */
export interface ReanchorReport {
  moved: number;
  lost: readonly ContextBlockEntry[];
}

/**
 * The entry's new range after one change EVENT, or the loss of the block.
 *
 * Every change is classified against the PRE-EVENT range, never against a
 * partially shifted one, and the deltas are summed. That is what makes the
 * answer order-independent, and it has to be: the changes were measured
 * arriving in DESCENDING document order, the reverse of how they were
 * submitted, and one `replace` from outside the editor arrives as a delete and
 * an insert. Nothing here may depend on the order, so the observations stop
 * mattering.
 *
 * Four cases per change, and there is deliberately no fifth: a change that
 * crosses a boundary is REFUSED rather than clamped to whatever survived. The
 * scout built the clamp and it got the first measured case wrong, keeping two
 * lines of the replacement text as though they were the human's block; the
 * expectation written beside it was wrong too, differently. Two wrong answers
 * to one small piece of arithmetic is the argument for having no arithmetic.
 * The cost is a re-add, on a shape (pasting over a region that spans out of a
 * function) this product's flow does not produce.
 *
 * An empty change list shifts by zero rather than losing the block. A second
 * event arrives at the same version carrying ZERO changes on every edit in
 * every language (v32 finding 6, v33 findings 3 and 6); reading that as
 * "something I cannot model" flags every block on every save.
 *
 * Pure. Neither argument is mutated.
 */
export function reanchorRange(
  range: ContextBlockRange,
  changes: readonly LineChange[],
): ReanchorOutcome {
  // The entry's range is 1-based inclusive; changes arrive 0-based.
  const firstLine = range.startLine - 1;
  const lastLine = range.endLine - 1;
  let shiftDelta = 0;
  let endDelta = 0;
  // Whether any change landed INSIDE. Any change classified inside yields
  // resize even at a net line delta of zero, because `shift` means the block
  // moved and its content did not, and a formatter rewriting bytes inside the
  // block has changed its content whatever the line count did. Both readings
  // resolve the identical range, so this decides a label and nothing a user
  // sees (contract.md, ruled 2026-07-28).
  let touched = false;
  for (const change of changes) {
    // Newlines added minus line boundaries removed.
    const lineDelta = change.newlineCount - (change.endLine - change.startLine);
    // A replaced range ending at character 0 of a line does not touch that
    // line. This is the one place the character offset is load-bearing, and it
    // decides both boundaries: "press Enter at the start of the block" is
    // above, and "select the block's lines including the final newline" is
    // still inside.
    const lastTouched =
      change.endCharacter === 0 && change.endLine > change.startLine
        ? change.endLine - 1
        : change.endLine;

    if (
      change.endLine < firstLine ||
      (change.endLine === firstLine && change.endCharacter === 0)
    ) {
      shiftDelta += lineDelta; // Entirely above: the whole block moves.
      continue;
    }
    if (change.startLine > lastLine) {
      continue; // Entirely below: nothing the block cares about moved.
    }
    if (change.startLine >= firstLine && lastTouched <= lastLine) {
      // Entirely inside: the block grows or shrinks. One correction first.
      // When the replaced range ends exactly on the block's TAIL boundary, the
      // line boundary `lineDelta` charged the block for is the one between the
      // block and the line BELOW it. That boundary is not the block's to lose:
      // its own last line survives, and the following line is what got pulled
      // up. Give the line back unless the replacement re-supplies the boundary
      // itself, which is what `endsAtLineStart` reports. Delete at the end of
      // the closing brace is this shape, and without the correction it hands
      // the model a function with no `}`.
      const atTail =
        change.endCharacter === 0 && change.endLine === lastLine + 1 && change.endLine > change.startLine;
      endDelta += lineDelta + (atTail && !change.endsAtLineStart ? 1 : 0);
      touched = true;
      continue;
    }
    // Crossing a boundary. Lost wins over any number of clean shifts in the
    // same event, which is why this returns rather than flagging.
    return { kind: "lost", reason: "crossed" };
  }
  const startLine = range.startLine + shiftDelta;
  const endLine = range.endLine + shiftDelta + endDelta;
  if (startLine < 1 || endLine < startLine) {
    // The deltas disagree with the classification, so trust neither.
    return { kind: "lost", reason: "crossed" };
  }
  return { kind: touched ? "resize" : "shift", range: { startLine, endLine } };
}

export class ContextBlockStore {
  private readonly entries: ContextBlockEntry[] = [];
  // One token per subscription (not per function) so subscribing the same
  // listener twice yields two independent, order-stable registrations.
  private readonly subscriptions: { listener: () => void }[] = [];
  private nextId = 1;
  private readonly log?: LogFn;

  constructor(log?: LogFn) {
    this.log = log;
  }

  add(input: AddBlockInput): ContextBlockEntry {
    const { startLine, endLine } = input.range;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
      // A malformed range is a gesture-layer bug, not user data; clamping
      // would make the panel show a range the user never selected.
      throw new TypeError(`context block range must be integer, 1-based, ordered: L${startLine}-L${endLine}`);
    }
    const entry: ContextBlockEntry = Object.freeze({
      id: `b${this.nextId++}`,
      uri: input.uri,
      // Copied and frozen: the caller mutating its input object afterwards
      // must not reach into the snapshot (the trust rule).
      range: Object.freeze({ startLine, endLine }),
      text: input.text,
      addedAtVersion: input.version,
    });
    this.entries.push(entry);
    this.log?.(
      `[ctx] add id=${entry.id} range=L${startLine}-L${endLine} bytes=${utf8ByteLength(entry.text)} version=${entry.addedAtVersion} uri=${entry.uri}`,
    );
    this.notify();
    return entry;
  }

  /**
   * Re-anchor every entry in `uri` against ONE change event.
   *
   * Advancing `addedAtVersion` is not optional, and it happens per EVENT rather
   * than per change: one event carries N changes and bumps the document version
   * ONCE, measured and then reconfirmed. An entry whose range did NOT move
   * still gets the new version, because the document's version bumped and the
   * version is what says how recently anyone could honestly claim the range was
   * exact.
   *
   * A lost entry keeps its range and its text so the panel can still say where
   * the block used to be, and is then skipped by every later event: lost is
   * terminal, and a block does not return to health because the next keystroke
   * happened to miss it.
   *
   * `documentText` is the document's full text after the event, and passing it
   * re-slices every SURVIVING entry's cached text out of its new range. It is
   * optional only because a frozen oracle calls the three-argument
   * form; the vscode layer always passes it, and two things break when it does
   * not. The panel preview renders `entry.text` and cannot await, so a block
   * the human is actively editing would read as whatever it said at the last
   * generation. And the re-adoption audit only answers "did this change while
   * nobody was watching" if `entry.text` is current as of the moment watching
   * STOPPED: without the refresh, a perfectly tracked block that was edited and
   * then had its tab closed is reported lost:"lapsed", which is false. Found by
   * adversarial review; `getText()` is free (v33 finding 8, and the panel
   * already pays it per keystroke).
   */
  reanchor(
    uri: string,
    changes: readonly LineChange[],
    version: number,
    documentText?: string,
  ): ReanchorReport {
    let moved = 0;
    let changed = false;
    const lost: ContextBlockEntry[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (entry.uri !== uri || entry.lost) {
        continue;
      }
      const outcome = reanchorRange(entry.range, changes);
      if (outcome.kind === "lost") {
        // Range, text and version left exactly as they were: they are now a
        // record of where the block WAS, which is all the panel can offer.
        const gone = Object.freeze({ ...entry, lost: outcome.reason });
        this.entries[i] = gone;
        lost.push(gone);
        changed = true;
        this.log?.(`[ctx] lost id=${entry.id} reason=${outcome.reason}`);
        continue;
      }
      // `moved` counts entries whose RANGE or VERSION changed, per the contract,
      // so a cache catching up is not a move. It is still a change the panel has
      // to hear about, because the preview renders this text.
      const anchored =
        outcome.range.startLine !== entry.range.startLine ||
        outcome.range.endLine !== entry.range.endLine ||
        version !== entry.addedAtVersion;
      const text = documentText === undefined ? entry.text : sliceLines(documentText, outcome.range);
      if (!anchored && text === entry.text) {
        continue; // Nothing to say; do not churn a frozen object for free.
      }
      // Replaced in place: id and list position are preserved, so remove, move
      // and toPromptBlocks keep working on the same entry.
      this.entries[i] = Object.freeze({
        ...entry,
        range: Object.freeze({ startLine: outcome.range.startLine, endLine: outcome.range.endLine }),
        addedAtVersion: version,
        text,
      });
      changed = true;
      if (anchored) {
        moved++;
      }
      if (
        outcome.range.startLine !== entry.range.startLine ||
        outcome.range.endLine !== entry.range.endLine
      ) {
        this.log?.(
          `[ctx] reanchor id=${entry.id} L${entry.range.startLine}-L${entry.range.endLine} -> L${outcome.range.startLine}-L${outcome.range.endLine} version=${version}`,
        );
      }
    }
    if (changed) {
      this.notify();
    }
    return { moved, lost };
  }

  /**
   * The payload path: every live block's text as the document reads NOW,
   * projected for prompt assembly.
   *
   * This walk lives on the STORE and has to stay here. Bar 3 (a removed block
   * can never reach a prompt) hangs on the prompt being assembled from the LIVE
   * list at generate time; move the walk out into fnGen and that guarantee
   * moves with it, into a caller free to hold a list captured earlier. The same
   * reason drives the two mechanisms below: `read` is async, so a human can
   * remove a block from the panel while its file is being read, and the entry
   * must not come back from that.
   *
   * MECHANISM 1, progress. There is no integer cursor, because an integer
   * cursor carried across an await cannot express what the list did under it:
   * two removals in one gesture (the toast's `Remove` action naming three
   * blocks) make it skip a healthy neighbour, and a `move` makes it emit a
   * block twice or skip one. Instead every entry VISITED is recorded by id and
   * each iteration re-scans the live list for the first entry not yet visited.
   * By ID rather than by object, because every uri-level method (`reanchor`,
   * `markLapsed`, `markDeleted`, `renameUri`) replaces the frozen entry in
   * place: object identity reads that as a brand new entry and re-reads it
   * without bound. Ids are store-scoped and never reused, so an id that is
   * still in the list is the same block.
   *
   * MECHANISM 2, bar 3. Emitting into a list as we go is not enough: a block
   * removed AFTER its own read has already been pushed. So nothing is returned
   * from the emission order at all. The blocks are keyed by entry id, and the
   * projection is built at the END by walking the live list and taking each
   * surviving entry's block. That drops anything the human removed while the
   * resolve was in flight (bar 3, zero tolerance) and it is also what keeps
   * "order in the panel is order in the prompt" true when the panel reordered
   * mid-resolve. Both were real defects, found by adversarial review.
   *
   * No content SEARCH, in either direction, ever. The re-adoption audit checks
   * the RECORDED range and nothing else, and nothing here hunts for a block's
   * text elsewhere in the document. A block that moved while nobody was
   * watching is lost, not found. Named non-goal in goal.md, and the scout
   * removed its only reason (finding 1: five formatters measured, every one
   * emits minimal edits, so no format silently relocates a block).
   */
  async resolveForPrompt(read: (uri: string) => Promise<string | undefined>): Promise<ContextBlock[]> {
    const visited = new Set<string>();
    const emitted = new Map<string, ContextBlock>();
    let changed = false;
    try {
      for (;;) {
        const pending = this.entries.find((e) => !visited.has(e.id));
        if (!pending) {
          break;
        }
        visited.add(pending.id);
        if (pending.lost) {
          // Terminal. Excluded, and not worth a read: the answer cannot change.
          continue;
        }
        const text = await read(pending.uri);
        // The list moved under the await, or the entry was re-frozen by an
        // event that landed during the read. Re-locate by id and decide against
        // the entry as it stands NOW, not the copy we started with.
        const at = this.entries.findIndex((e) => e.id === pending.id);
        if (at === -1) {
          continue; // Removed while we awaited its text. Bar 3: it is gone.
        }
        const entry = this.entries[at];
        if (entry.lost) {
          continue; // A delete or a crossing edit landed under the await.
        }
        const lose = (reason: LostReason): void => {
          // Range and text left as they were, exactly as reanchor leaves them:
          // they are now a record of where the block WAS, which is all the
          // panel can offer.
          this.entries[at] = Object.freeze({ ...entry, lost: reason });
          this.log?.(`[ctx] lost id=${entry.id} reason=${reason}`);
          changed = true;
        };
        if (text === undefined) {
          // Never an empty string in its place: that silently hands the model
          // an empty section instead of saying the file is gone.
          lose("deleted");
          continue;
        }
        const slice = sliceLines(text, entry.range);
        if (entry.lapsed) {
          // Re-adoption audit. The document closed, so the editor may have
          // discarded the model and we may have missed edits; the recorded
          // range is no longer known to be exact. This is leg 2 of `isStale`,
          // reusing the same `canonical` so a second rule cannot drift from the
          // first. Everywhere else the text is SUPPOSED to differ, which is why
          // the auditor only means something here.
          if (canonical(slice) !== canonical(entry.text)) {
            lose("lapsed");
            continue;
          }
        }
        if (slice === "") {
          // A resolved range with no text in it is not a block.
          lose("crossed");
          continue;
        }
        if (entry.lapsed || slice !== entry.text) {
          // Adopted: `lapsed` is dropped rather than set false, so a healthy
          // entry's key set never grows. Replaced in place, so id and list
          // position survive.
          const { lapsed: _adopted, ...healthy } = entry;
          this.entries[at] = Object.freeze({ ...healthy, text: slice });
          changed = true;
        }
        emitted.set(entry.id, {
          uri: entry.uri,
          range: { startLine: entry.range.startLine, endLine: entry.range.endLine },
          text: slice,
        });
      }
    } finally {
      // In a `finally` because a rejecting read must not leave the store
      // mutated with nobody told: the contract's own reader wraps
      // `vscode.workspace.openTextDocument`, which REJECTS for a missing file.
      // Once, so a resolve that lost something repaints the panel and a resolve
      // that found no news does not.
      if (changed) {
        this.notify();
      }
    }
    // The live list is the order AND the membership. Anything the human removed
    // while the resolve was in flight is simply not here to be taken.
    //
    // Membership is not enough on its own: a lost entry STAYS in the list, so
    // the panel can still say where the block used to be. `read` is async and
    // the extension host dispatches workspace events while a resolve is
    // suspended, so a block read early can be deleted or crossed while a LATER
    // block is being read - after its own post-await recheck, and already in
    // `emitted`. Asking only "is it still listed" shipped it. Lost is terminal
    // and the block is excluded from EVERY prompt, or the red row, the tooltip,
    // the toast and the generate-time warning are all lying at once.
    const blocks: ContextBlock[] = [];
    for (const entry of this.entries) {
      const block = emitted.get(entry.id);
      if (block && !entry.lost) {
        blocks.push(block);
      }
    }
    return blocks;
  }

  /**
   * The document closed, so the editor may drop its model and stop telling us
   * about edits. Not a loss: the entries get ONE audit at the next resolve.
   */
  markLapsed(uri: string): number {
    let n = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      // Lost is terminal: a lost block does not come back to being merely
      // lapsed. Already lapsed is left alone so marking twice is free.
      if (entry.uri !== uri || entry.lost || entry.lapsed) {
        continue;
      }
      this.entries[i] = Object.freeze({ ...entry, lapsed: true });
      n++;
    }
    if (n > 0) {
      this.notify();
    }
    return n;
  }

  /** The file is gone. Every live block in it is lost, said out loud, and
   *  returned in list order so the vscode layer raises ONE toast naming all of
   *  them. An already-lost entry is not re-reported. */
  markDeleted(uri: string): readonly ContextBlockEntry[] {
    const lost: ContextBlockEntry[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (entry.uri !== uri || entry.lost) {
        continue;
      }
      const gone = Object.freeze({ ...entry, lost: "deleted" as const });
      this.entries[i] = gone;
      lost.push(gone);
      this.log?.(`[ctx] lost id=${entry.id} reason=deleted`);
    }
    if (lost.length > 0) {
      this.notify();
    }
    return lost;
  }

  /** The file moved. A rename moves a block's ADDRESS, not its health: range,
   *  text, id, list position and lost/lapsed state are all untouched, and a
   *  lost block follows its file too so the panel can still name it. */
  renameUri(from: string, to: string): number {
    let n = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (entry.uri !== from) {
        continue;
      }
      this.entries[i] = Object.freeze({ ...entry, uri: to });
      n++;
    }
    if (n > 0) {
      this.log?.(`[ctx] rename n=${n} ${from} -> ${to}`);
      this.notify();
    }
    return n;
  }

  remove(id: string): boolean {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) {
      return false;
    }
    this.entries.splice(index, 1);
    this.log?.(`[ctx] remove id=${id}`);
    this.notify();
    return true;
  }

  clear(): number {
    const n = this.entries.length;
    this.entries.length = 0;
    // Unconditional gesture: n=0 still logs and notifies.
    this.log?.(`[ctx] clear n=${n}`);
    this.notify();
    return n;
  }

  move(id: string, direction: "up" | "down"): boolean {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) {
      return false;
    }
    const neighbor = direction === "up" ? index - 1 : index + 1;
    if (neighbor < 0 || neighbor >= this.entries.length) {
      return false;
    }
    const moved = this.entries[index];
    this.entries[index] = this.entries[neighbor];
    this.entries[neighbor] = moved;
    this.log?.(`[ctx] move id=${id} ${direction}`);
    this.notify();
    return true;
  }

  list(): readonly ContextBlockEntry[] {
    // Fresh array per call so no caller holds a view that tracks (or can
    // disturb) later mutations; the entries themselves are frozen.
    return [...this.entries];
  }

  /** The live projection prompt assembly consumes at generate time:
   *  {uri, range, text} of list(), nothing else — id and addedAtVersion
   *  never enter a prompt. */
  toPromptBlocks(): ContextBlock[] {
    return this.entries.map((e) => ({
      uri: e.uri,
      range: { startLine: e.range.startLine, endLine: e.range.endLine },
      text: e.text,
    }));
  }

  /** Synchronous change notification for the panel; returns unsubscribe. */
  subscribe(listener: () => void): () => void {
    const token = { listener };
    this.subscriptions.push(token);
    return () => {
      const index = this.subscriptions.indexOf(token);
      if (index !== -1) {
        this.subscriptions.splice(index, 1);
      }
    };
  }

  private notify(): void {
    // Snapshot: a listener subscribing or unsubscribing during delivery
    // changes the NEXT notification's roster, not this one. Exceptions
    // propagate to the mutating caller by design — the state change has
    // already landed by the time listeners run.
    for (const { listener } of [...this.subscriptions]) {
      listener();
    }
  }
}

// Byte length under UTF-8, dependency-free so the module stays portable
// between node tests and the extension bundle (no Buffer).
function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}
