/**
 * The generate-time recursive DATA-SHAPE walk: a BOUNDED BFS over a struct's
 * field-type graph, emitting each reachable LOCAL struct/enum def at most once.
 *
 * The payload grows by depth x branching, so the
 * bound is the deliverable, not the walk. The function is PURE and headless: the
 * field-type graph is reached through the INJECTED `resolveStruct` edge-resolver
 * (rust-analyzer resolution lives in the vscode layer), so the ship-gate test
 * feeds a synthetic adversarial graph and proves the bound by construction.
 *
 * The bound is 2-D plus two hard guards, and the `min` binds:
 *   - D_MAX  : max graph distance from the root (reachability).
 *   - B_MAX  : distinct LOCAL types walked per node (per-node fan-out).
 *   - N_MAX  : TOTAL struct defs emitted - the OUTER HARD GUARD that dominates the
 *              geometric blow-up (D=2,B=4 allows 21; N_MAX=6 forces <=6). Enforced
 *              even when D/B would allow more.
 *   - TOK_MAX: token budget (chars/4 proxy) for the whole block.
 * `visited` (keyed by type name) makes each type emit at most once, so cycles and
 * diamonds terminate independent of the caps.
 *
 * v40: TOK_MAX and the shared cross-walk budget (`SharedWalkState.remainingChars`)
 * used to be WALK-TIME drops - a def that breached either went dark whole, not
 * even its name surviving. They are now RENDER-TIME truncations instead (brace-
 * safe, whole field units, a `... N more fields` marker - see
 * `renderDefsWithinBudget` below): discovery (this file's BFS) is bounded only by
 * the STRUCTURAL caps (D_MAX/B_MAX/N_MAX, unchanged), and the char budgets are
 * enforced once, after discovery, against whatever the walk actually found.
 */

/** The resolved edge for one type: its emitted def text, plus its fields with the
 *  local-ness the walk recurses on. `isLocal=false` marks a std/primitive/external
 *  field type - a stop edge, never recursed into. */
export interface StructResolution {
  def: string;
  fields: Array<{ name: string; typeName: string; isLocal: boolean }>;
}

export interface WalkBounds {
  D_MAX: number;
  B_MAX: number;
  N_MAX: number;
  TOK_MAX: number;
}

export interface WalkResult {
  /** The emitted struct defs, one bounded block, joined. "" when the root does
   *  not resolve to a local struct (honest degrade). */
  block: string;
  /** The emitted defs as an ordered NAMED list (BFS emit order), each name once.
   *  Same content as `block`, but a consumer that must attribute per-type (e.g.
   *  place a type's methods right after its own def) reads this instead of
   *  re-splitting `block` on SEP - which a def carrying an internal blank line
   *  would shatter. Each entry's `def` is the RENDERED text (v40: possibly
   *  brace-safe truncated with a `... N more fields` marker, never the raw
   *  untruncated form once truncation applied). */
  defs: Array<{ name: string; def: string }>;
  /** The type names a cap (N_MAX/B_MAX/TOK_MAX/shared-budget) dropped ENTIRELY
   *  (not even a truncated shell fit) - never silent. A dropped name is
   *  guaranteed NOT also emitted. */
  dropped: string[];
  /** The SAME names as `dropped`, in the same order, each with the cap that did
   *  it (session-v48 phase 3). A drop line that names types without naming what
   *  dropped them tells the developer something is missing and nothing about
   *  which way to turn the dial. */
  droppedBy: DroppedType[];
}

/** Which bound dropped a type entirely.
 *   - `total-types`: N_MAX, the walk's total distinct-type guard.
 *   - `breadth`: B_MAX, one node's fan-out over its local field types.
 *   - `budget`: the render-time char budget (this walk's TOK_MAX, or what was
 *     left of the shared per-prompt aggregate). */
export type DropCause = "total-types" | "breadth" | "budget";

/** For a `budget` drop: WHICH char budget was actually in force, and what it was
 *  worth in tokens (the chars/4 convention the walk's own caps use).
 *
 *  Adversarial review D3: the channel printed `render budget ${TOK_MAX} tok`
 *  unconditionally while the render pass binds on
 *  `min(TOK_MAX * 4, shared.remainingChars)`. That is not a corner - at the
 *  shipped `small` stop the per-walk cap is 400 tok and the shared aggregate is
 *  600 tok across every walk in the prompt, so from the SECOND walk onward the
 *  aggregate is the binder and the per-walk number is not the number in force.
 *  A confident figure that was never in force is the failure class this phase
 *  exists to end, so the binder travels with the drop. */
export interface DropBudgetBound {
  /** `walk` = this walk's own TOK_MAX. `shared` = what was left of the
   *  cross-walk aggregate, which is tighter and usually the real binder. */
  kind: "walk" | "shared";
  /** The budget in force, in tokens, rounded up from the char figure. */
  tok: number;
}

export interface DroppedType {
  name: string;
  cause: DropCause;
  /** Present only when `cause` is `budget`. */
  budgetBound?: DropBudgetBound;
}

/** Cross-walk state so SUCCESSIVE walks in ONE prompt share a bound, not just each
 *  their own. Threaded through every per-type walk of a prefill so the PER-PROMPT
 *  data-shape total is bounded (the self-inflation guard), not merely
 *  the per-walk total. MUTATED in place by each walk:
 *   - `visited`: a type emitted by an earlier walk is not re-emitted by a later
 *     one (cross-walk dedup - a shared nested type appears once across the prompt).
 *     A type this walk DISCOVERED but then dropped entirely at the render-time
 *     truncation pass (v40) is NOT added - it never made this walk's block
 *     either, so a later sibling walk still gets its own chance at it, the same
 *     as a pre-v40 budget-dropped type always could.
 *   - `remainingChars`: the aggregate char budget left across all walks; each
 *     walk charges it by what it ACTUALLY rendered (post-truncation, v40 - not
 *     the raw pre-truncation def size, which would double-charge a def this
 *     walk just shrank), and once exhausted later walks truncate harder or
 *     drop + log. */
export interface SharedWalkState {
  visited: Set<string>;
  remainingChars: number;
  /** OPTIONAL, session-v48 phase 3: where every walk sharing this state records
   *  the types it dropped entirely, so ONE gesture can report ONE list.
   *
   *  Present means "collect"; absent means the walk records nothing, which is
   *  what the FIM whole-block path does - it has no channel of its own to put a
   *  per-gesture line on. A name a LATER walk manages to emit is removed again,
   *  so the map only ever holds types that made no block anywhere in the prompt.
   *
   *  The VALUE is the whole `DroppedType`, not just its cause, so the cap that
   *  actually bound travels with it (review D3), and the LAST walk to lose a
   *  name overwrites the earlier attribution (review D4). */
  droppedBy?: Map<string, DroppedType>;
  /** OPTIONAL, session-v50 phase 2: the types that have already been given a
   *  MEMBER block in this prompt. A second set, and it has to be second.
   *
   *  `visited` above dedups DATA SHAPES: a type whose fields one walk rendered
   *  must not have them rendered again by a sibling walk. C# is the only language
   *  whose member blocks are also deduped across a prompt (it renders a block per
   *  collaborator, not one per root), and while C# had no data-shape walk the two
   *  jobs could share one set without anyone noticing. The moment it got one,
   *  they collided: the walk marked a type visited and the member renderer read
   *  that as "already given a member block", so a type's shape shipped and its
   *  members vanished. Caught by `blind-v34-stdlib-provenance` item 1 point 6. */
  memberBlocks?: Set<string>;
}

// The blocks are joined by a blank line, matching the generate-side rendering.
export const SEP = "\n\n";

/** Net brace change across a line (`{` = +1, `}` = -1). */
function braceDelta(line: string): number {
  let d = 0;
  for (const ch of line) {
    if (ch === "{") {
      d++;
    } else if (ch === "}") {
      d--;
    }
  }
  return d;
}

/** Parse a MULTI-LINE brace-delimited def into a header (the lines up to and including
 *  the FIRST opening `{`), the body as an ordered list of whole depth-0 field UNITS,
 *  and the closing-brace line(s). A UNIT is a maximal run of body lines that returns to
 *  the container's base depth - so a flat `name: T,` is one unit and a multi-line
 *  struct-variant / nested-object field is ALSO one unit, never split across its inner
 *  braces. Returns undefined - the caller then emits the def ATOMICALLY - when the def
 *  is too short to split, has no `{`, is brace-unbalanced, opens more than one net brace
 *  in its header, or its body does not partition cleanly into depth-0 units. Undefined
 *  is the SAFE answer: an unparseable def is emitted whole or skipped, never as a partial
 *  that could ship an unclosed brace. */
export function parseBraceDef(
  lines: string[],
): { header: string[]; units: string[][]; close: string[] } | undefined {
  if (lines.length < 3) {
    return undefined; // header+close only, or single line: nothing to truncate.
  }
  // Overall balance, and the line that first opens a brace.
  let depth = 0;
  let openLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (openLine < 0 && lines[i].includes("{")) {
      openLine = i;
    }
    depth += braceDelta(lines[i]);
    if (depth < 0) {
      return undefined; // a `}` precedes its `{`: not a struct-body shape.
    }
  }
  if (depth !== 0 || openLine < 0) {
    return undefined; // brace-unbalanced, or no brace at all.
  }
  const lastIdx = lines.length - 1;
  if (openLine >= lastIdx) {
    return undefined; // the opening `{` is on the last line: no separable body.
  }
  // The header must open exactly ONE net brace (a simple single-container field list);
  // anything else is not a shape this splitter understands.
  let headerDepth = 0;
  for (let i = 0; i <= openLine; i++) {
    headerDepth += braceDelta(lines[i]);
  }
  if (headerDepth !== 1) {
    return undefined;
  }
  // Partition the body (between the header's `{` and the final `}`) into whole depth-0
  // units, relative to the container's interior (base depth 0 here).
  const units: string[][] = [];
  let cur: string[] = [];
  let d = 0;
  for (let i = openLine + 1; i < lastIdx; i++) {
    cur.push(lines[i]);
    d += braceDelta(lines[i]);
    if (d === 0) {
      units.push(cur);
      cur = [];
    } else if (d < 0) {
      return undefined; // a line closes the container early: bail to atomic.
    }
  }
  if (cur.length > 0 || d !== 0) {
    return undefined; // trailing body lines did not close to depth 0: not clean.
  }
  return { header: lines.slice(0, openLine + 1), units, close: [lines[lastIdx]] };
}

/** Brace-safe render of an ORDERED list of named defs into one char budget: each
 *  def either fits WHOLE, or is truncated at whole field-UNIT boundaries (via
 *  `parseBraceDef`) with a `... N more fields` marker naming what was cut, or -
 *  if not even the bare shell (header + marker + close) fits - is skipped
 *  entirely. Never a partial def without a marker, never an unclosed brace.
 *
 *  Originated (v22) as a private closure (`emitDef`) inside
 *  `fimWholeBlock.ts#renderWholeBlockInjection`; extracted here (v40) so
 *  `walkDataShape` itself can apply the SAME algorithm to its own char-budget
 *  enforcement (see the walk's render-time truncation pass below), and
 *  `fimWholeBlock.ts` re-exports it for its own, differently-shaped budget
 *  (methods + reached-members + defs sharing ONE render pass across multiple
 *  roots) rather than duplicating the algorithm.
 *
 *  `lineCost` is the caller's own per-line accounting (a comment-prefixed FIM
 *  line costs more than a plain one) - the truncation algorithm itself doesn't
 *  care about comment syntax. `startingTotal` lets a caller that already spent
 *  part of the SAME budget on something else (FIM: methods + reached-members,
 *  rendered ahead of the defs) keep charging against it instead of resetting;
 *  `walkDataShape` has nothing else sharing its budget, so it passes 0.
 *
 *  `sepCost` (v40, OPTIONAL) is the width, in `lineCost` units, of whatever
 *  separator the CALLER will actually join kept defs' texts with - default
 *  `undefined` reproduces the original behavior byte for byte (every line
 *  charged as if a plain single-unit newline follows it, the shape every
 *  existing caller - FIM's own flat "\n".join(out) - already relies on).
 *  A caller that joins defs with something WIDER (`walkDataShape`'s two-char
 *  `SEP`) must pass that width here, or its own declared budget silently stops
 *  matching what it actually renders (session-v40 review finding 2). When
 *  passed, `total` on return is also corrected to the EXACT real joined
 *  length (not the +1-per-line-conservative estimate every other caller gets),
 *  so a caller charging a shared aggregate by `total` charges it precisely.
 *
 *  `preferWholeFirst` (v40, OPTIONAL, default false - every existing caller is
 *  unaffected) processes `defs` in TWO passes instead of one: pass 1 commits,
 *  in the given order, every def that fits WHOLE against the budget as it
 *  stands when that def is reached; pass 2 spends whatever budget remains on
 *  the leftovers, in their original relative order, truncating or dropping as
 *  the single-pass algorithm always has. Without this, a large def processed
 *  first can truncate down to a near-empty shell while spending the entire
 *  budget getting there, starving a small sibling queued behind it that would
 *  have rendered in full for a fraction of the cost (review finding 1) - the
 *  given order still decides EVERYTHING within each pass, so it remains a
 *  tie-break, just no longer the sole allocator of who gets truncated first.
 *
 *  Returns the rendered lines, the SAME lines regrouped per source def (`perDef` -
 *  a def entirely skipped contributes no entry, so a caller that wants to join
 *  defs with its own separator, e.g. this file's SEP, doesn't need to re-split
 *  `lines` and guess where one def ends and the next begins), the running total
 *  AFTER this call (so a caller chaining budgets can thread it onward), and the
 *  names of any defs that did not fit at all - never overlapping with a name
 *  that appears in `lines`/`perDef`. */
export function renderDefsWithinBudget(
  defs: ReadonlyArray<{ name: string; def: string }>,
  budgetChars: number,
  lineCost: (line: string) => number,
  startingTotal: number = 0,
  sepCost?: number,
  preferWholeFirst: boolean = false,
): { lines: string[]; perDef: Array<{ name: string; text: string }>; total: number; droppedNames: string[] } {
  const out: string[] = [];
  const perDef: Array<{ name: string; text: string }> = [];
  let total = startingTotal;
  const droppedNames: string[] = [];
  const linesCost = (ls: string[]) => ls.reduce((c, l) => c + lineCost(l), 0);
  const push = (l: string) => {
    total += lineCost(l);
    out.push(l);
  };
  // The default per-line accounting charges every line as though a single-unit
  // separator follows it - correct when the caller's own eventual join uses
  // that exact separator throughout (FIM: one flat "\n".join(out)). `boundary`
  // is the EXTRA width (beyond that already-assumed single unit) the real
  // def-to-def join costs; 0 when `sepCost` is not given, so every existing
  // call site computes an identical `total` to before, line for line.
  const boundary = sepCost === undefined ? 0 : sepCost - 1;
  let sawOutput = false;

  // Attempt to emit ONE def against the CURRENT budget. `allowTruncate=false`
  // (pass 1 of a `preferWholeFirst` run) accepts only a whole fit and leaves
  // everything else - truncatable or not - untouched for pass 2; the def is
  // NOT marked dropped yet, since a later def's whole-fit must not be blocked
  // by a premature drop verdict on an earlier one. Returns whether the def
  // committed something.
  const emitOne = (name: string, def: string, allowTruncate: boolean): boolean => {
    const pending = sawOutput ? boundary : 0;
    const preFits = (cost: number) => total + pending + cost <= budgetChars;
    const lines = def.split("\n");
    const parsed = parseBraceDef(lines);
    const commit = (ls: string[]) => {
      total += pending;
      for (const l of ls) {
        push(l);
      }
      sawOutput = true;
    };

    if (parsed === undefined) {
      // Not a cleanly-splittable brace def: emit atomically (whole or skip) -
      // never a partial, so there is nothing further to try in pass 2 either.
      if (preFits(linesCost(lines))) {
        commit(lines);
        return true;
      }
      if (allowTruncate) {
        droppedNames.push(name);
      }
      return false;
    }
    if (preFits(linesCost(lines))) {
      // Fits WHOLE: emit every line, no marker (the exact INV-whole case).
      commit(lines);
      return true;
    }
    if (!allowTruncate) {
      return false; // defer to pass 2 - budget only shrinks, so this will not
      // fit whole later either, but it may still earn a truncated shell.
    }
    // Truncation path. Reserve the close AND the WORST-CASE marker (all units
    // dropped => the most digits) at every step, so the eventual (shorter-or-
    // equal) marker + close always fit the reserved room. If even the
    // fieldless shell (header + marker + close) will not fit, skip the whole
    // def rather than emit an over-budget or unclosed prefix. The whole def
    // did NOT fit, so the loop can never keep every unit, and the marker's N
    // is always >= 1.
    const { header, units, close } = parsed;
    const indent = /^[ \t]*/.exec(units[0]?.[0] ?? "")?.[0] ?? "    ";
    const reserve = lineCost(`${indent}... ${units.length} more fields`) + linesCost(close);
    if (!preFits(linesCost(header) + reserve)) {
      droppedNames.push(name);
      return false;
    }
    total += pending;
    for (const l of header) {
      push(l);
    }
    let kept = 0;
    const fitsNow = (cost: number) => total + cost <= budgetChars;
    for (const unit of units) {
      if (!fitsNow(linesCost(unit) + reserve)) {
        break;
      }
      for (const l of unit) {
        push(l);
      }
      kept++;
    }
    push(`${indent}... ${units.length - kept} more fields`);
    for (const l of close) {
      push(l);
    }
    sawOutput = true;
    return true;
  };

  const run = (list: ReadonlyArray<{ name: string; def: string }>, allowTruncate: boolean) => {
    const leftover: Array<{ name: string; def: string }> = [];
    for (const { name, def } of list) {
      const startIdx = out.length;
      const committed = emitOne(name, def, allowTruncate);
      if (committed) {
        perDef.push({ name, text: out.slice(startIdx).join("\n") });
      } else if (!allowTruncate) {
        leftover.push({ name, def });
      }
    }
    return leftover;
  };

  if (!preferWholeFirst) {
    run(defs, true);
  } else {
    const deferred = run(defs, false); // pass 1: whole fits only, given order
    run(deferred, true); // pass 2: truncate/drop the rest with what remains
  }

  // The default per-line accounting always leaves exactly ONE unit of
  // "assumed but never actually used" trailing separator sitting on `total`
  // once anything has been pushed (every line was pre-charged for a follow-on
  // separator; the very last line pushed never gets one). Harmless and left
  // alone for every existing caller (matches the doc comment's "conservative"
  // note above). Only a caller that passed `sepCost` - meaning it wants
  // `total` to be the EXACT real joined length, not a +1-conservative one -
  // gets that trailing unit removed here.
  if (sepCost !== undefined && out.length > 0) {
    total -= 1;
  }

  return { lines: out, perDef, total, droppedNames };
}

/**
 * Walk the field-type graph from `rootTypeName`, emitting each reachable LOCAL
 * struct/enum def once, within the 2-D bound. Pure: the graph is reached only
 * through `resolveStruct`, which returns a type's def + fields or undefined when
 * the name is not a local struct/enum.
 */
export function walkDataShape(
  rootTypeName: string,
  resolveStruct: (typeName: string) => StructResolution | undefined,
  bounds: WalkBounds,
  // Optional cross-walk state. Absent => a self-contained walk with fresh state
  // (the single-walk contract, byte-identical to no-shared). Present => this
  // walk shares its visited-set and remaining token budget with sibling walks in
  // the same prompt, mutating both, so the PER-PROMPT total is bounded.
  shared?: SharedWalkState,
): WalkResult {
  // ---- Phase A: STRUCTURAL discovery only (D_MAX / B_MAX / N_MAX). ----
  //
  // v40: TOK_MAX and the shared aggregate no longer gate discovery or
  // recursion here - a def that would have breached either is still walked
  // (and its children too, subject only to the structural bounds), then
  // brace-safe truncated at the render pass below instead of going dark. This
  // mirrors what fimWholeBlock.ts's FIM path has done since v22 (seed the walk
  // with an unbounded char cap, truncate at render) - the difference is FIM's
  // caller does that seeding itself, while every OTHER caller of this
  // function (fn-gen's shapeBlock/tsShapeBlock chief among them) gets it for
  // free by calling walkDataShape at all, since the truncation now lives
  // inside the walk rather than requiring each caller to know to ask for it.
  //
  // `crossWalkVisited` (read from `shared`, if given) still skips a type an
  // EARLIER walk already committed to ITS block - that dedup must apply
  // immediately during discovery, not deferred. This walk's OWN BFS
  // cycle/diamond dedup uses a separate local set, because final commitment to
  // `shared.visited` can only happen once the render pass (below) decides
  // what THIS walk actually keeps: a type discovered here but fully dropped
  // by the render pass must not poison `shared.visited`, or a later sibling
  // walk would lose its own chance at a type that never actually rendered
  // anywhere (worse than the bug this session fixes, not better).
  const crossWalkVisited = shared?.visited;
  const thisWalkDiscovered = new Set<string>();
  // A SET plus a parallel cause map rather than a map alone: `droppedSet`'s
  // insertion order is what the drop list has always been ordered by, and the
  // cause is a lookup beside it.
  //
  // LAST CAUSE WINS (adversarial review D4). It used to be first-cause-wins,
  // which reported the cap that refused a type's FIRST reachable edge even when
  // the type was later reached by another path, emitted, and then lost by
  // something else entirely. The cause a developer is owed is the one that
  // actually lost it - the last attempt that failed - because that is the only
  // one whose dial, turned, would have kept it.
  const droppedSet = new Set<string>();
  const droppedCause = new Map<string, DropCause>();
  const dropWith = (name: string, cause: DropCause): void => {
    droppedSet.add(name);
    droppedCause.set(name, cause);
  };
  const emitted: Array<{ name: string; def: string }> = [];

  const queue: Array<{ name: string; depth: number }> = [{ name: rootTypeName, depth: 0 }];

  while (queue.length > 0) {
    const { name, depth } = queue.shift() as { name: string; depth: number };
    if (thisWalkDiscovered.has(name) || crossWalkVisited?.has(name)) {
      continue; // already emitted (this walk's own cycle/diamond, or an earlier sibling walk)
    }
    const res = resolveStruct(name);
    if (!res) {
      continue; // not a local struct/enum: std/primitive/external/unresolved
    }

    // N_MAX is the OUTER HARD GUARD: stop discovering once N_MAX defs are out,
    // even when D/B would allow more. This is what caps the geometric blow-up,
    // and it is unchanged by v40 - only the char budgets moved to render time.
    if (emitted.length >= bounds.N_MAX) {
      dropWith(name, "total-types");
      continue;
    }

    thisWalkDiscovered.add(name);
    emitted.push({ name, def: res.def });

    // Enqueue LOCAL field-types only, subject to D_MAX (reachability) and B_MAX
    // (distinct local types walked at THIS node). Already-discovered types are
    // not re-enqueued (they cost no B_MAX slot - they are done, not walked).
    if (depth >= bounds.D_MAX) {
      continue; // at the depth frontier: emit no children
    }
    const distinctLocal: string[] = [];
    const seenLocal = new Set<string>();
    for (const f of res.fields) {
      if (!f.isLocal || seenLocal.has(f.typeName)) {
        continue;
      }
      seenLocal.add(f.typeName);
      distinctLocal.push(f.typeName);
    }
    let walked = 0;
    for (const typeName of distinctLocal) {
      if (thisWalkDiscovered.has(typeName) || crossWalkVisited?.has(typeName)) {
        continue; // already discovered via another path (diamond) - not re-walked
      }
      if (walked >= bounds.B_MAX) {
        dropWith(typeName, "breadth"); // per-node fan-out cap truncated this edge
        continue;
      }
      queue.push({ name: typeName, depth: depth + 1 });
      walked++;
    }
  }

  // ---- Phase B: RENDER-TIME truncation (v40). ----
  //
  // `emitted` may be oversized in raw bytes (Phase A never checked TOK_MAX).
  // Truncate brace-safe against the TIGHTER of this walk's own TOK_MAX*4 and
  // whatever remains of the shared cross-walk aggregate - a def must still
  // respect BOTH caps, exactly as the pre-v40 per-node check did (sequential
  // TOK_MAX-then-shared checks, either one dropping it); this is the same
  // requirement enforced once, after the fact, instead of per def during
  // discovery.
  //
  // Exempting the ROOT from this cap was tried in session-v39 and REFUTED on
  // the corpus: it moved nothing (the walk still dropped its own root on 63 of
  // 237 rows) and made starvation slightly worse (21 rows to 24), because the
  // binding ceiling is the SHARED per-prompt budget, not the per-walk one. A
  // root let past its own cap just spends the shared budget the next walk
  // needed - v40 does not reopen that: the root competes for render-time
  // truncation exactly like every other def here, with no exemption from it.
  //
  // Allocation order (v40 review fix): `renderDefsWithinBudget` is called with
  // `preferWholeFirst=true`, so a def that fits WHOLE (the root very often
  // does - it is small relative to a fanned-out child) is committed ahead of
  // one that needs truncating, regardless of which was discovered first. A
  // single greedy discovery-order pass let an oversized def truncate down to a
  // near-empty stub while spending the whole budget getting there, starving a
  // small sibling queued right behind it that would have rendered in full for
  // a fraction of the cost - strictly worse than pre-v40's whole-drop, and the
  // opposite of the "spend the SHAPE of the budget better" goal this session
  // set out to hit. BFS/discovery order still decides who wins WITHIN each of
  // the two passes - a tie-break now, not the sole allocator.
  //
  // `shared.remainingChars` is charged by what this pass ACTUALLY rendered
  // (`rendered.total`), not by summing `res.def.length` per accepted def the
  // way the pre-v40 per-node check did - charging the untruncated size here
  // would double-count a def this very pass just shrank to fit. `sepCost:
  // SEP.length` (v40 review fix) makes that `total` match the REAL cost of
  // this walk's own `block` exactly: `renderDefsWithinBudget`'s per-line
  // accounting alone assumes every def-to-def join costs as much as a single
  // internal line join, but `block` below joins kept defs with the WIDER
  // `SEP` ("\n\n") - left uncorrected, a walk keeping 3+ whole defs could
  // report "everything fit" while its own `block.length` quietly exceeded the
  // budget it was just computed against, and under-charge `remainingChars` by
  // the same amount on every such walk.
  const walkBudgetChars = bounds.TOK_MAX * 4;
  const sharedBudgetChars = shared?.remainingChars ?? Number.POSITIVE_INFINITY;
  const effectiveBudget = Math.min(walkBudgetChars, sharedBudgetChars);
  // WHICH of the two actually bound, recorded rather than assumed (review D3).
  // At the shipped `small` stop these are 1600 chars and 2400 chars shared, so
  // the aggregate takes over from the second walk on and the per-walk number
  // stops being the truth. Ties go to `walk`: the walk's own cap held on its
  // own terms.
  const budgetBound: DropBudgetBound = {
    kind: sharedBudgetChars < walkBudgetChars ? "shared" : "walk",
    tok: Number.isFinite(effectiveBudget) ? Math.max(0, Math.ceil(effectiveBudget / 4)) : bounds.TOK_MAX,
  };
  const lineCost = (l: string) => l.length + 1;

  // v40 second-loop review fix: give the walk's own ROOT first claim on the
  // budget before its children ever compete for it. `emitted[0]` is always
  // the root - Phase A's BFS starts the queue with only the root and pushes
  // it to `emitted` before any child is enqueued. Without this, an oversized
  // root sits at the front of `preferWholeFirst`'s pass 1 (whole fits only),
  // fails to commit there, and pass 1 keeps walking past it - so small
  // children queued right behind it win the budget pass 1 hands out for
  // free, and by the time pass 2 reaches the deferred root there is nothing
  // left, not even its own bare shell. That drops the root ENTIRELY while
  // unrelated children survive in full - worse than pre-v40 (a root that
  // breached budget was dropped before children were even enqueued, so the
  // whole walk came back empty) and the opposite of "spend the SHAPE of the
  // budget better."
  //
  // Rendering the root alone first, then the rest against what remains (via
  // `startingTotal`, exactly the chaining `renderDefsWithinBudget`'s own doc
  // comment describes), keeps the root out of that free-pass race: it gets
  // truncated-if-needed against the FULL budget, same as before this fix,
  // and only the leftover goes to the fair whole-first race among children.
  const [root, ...restDefs] = emitted;
  let rendered: ReturnType<typeof renderDefsWithinBudget>;
  if (root === undefined) {
    rendered = { lines: [], perDef: [], total: 0, droppedNames: [] };
  } else {
    const rootRendered = renderDefsWithinBudget([root], effectiveBudget, lineCost, 0, SEP.length, true);
    // `boundary` reproduces, across the seam between the two calls, the same
    // def-to-def SEP charge `renderDefsWithinBudget` would have applied had
    // this been one call - only owed if the root actually committed
    // something for a later child to be joined onto.
    const boundary = rootRendered.perDef.length > 0 ? SEP.length - 1 : 0;
    const restRendered = renderDefsWithinBudget(restDefs, effectiveBudget, lineCost, rootRendered.total + boundary, SEP.length, true);
    rendered = {
      lines: [...rootRendered.lines, ...restRendered.lines],
      perDef: [...rootRendered.perDef, ...restRendered.perDef],
      total: restRendered.total,
      droppedNames: [...rootRendered.droppedNames, ...restRendered.droppedNames],
    };
  }

  const keptDefs = rendered.perDef.map((d) => ({ name: d.name, def: d.text }));
  if (shared !== undefined) {
    shared.remainingChars -= rendered.total;
    for (const { name } of keptDefs) {
      shared.visited.add(name);
    }
  }

  // A type dropped at one node's B_MAX/N_MAX may be reachable-and-emitted via
  // another path within the SAME walk; the drop log must name only types that
  // truly did NOT make the final (post-truncation) block, so the "dropped is
  // disjoint from emitted" invariant holds by construction. Render-time drops
  // (`rendered.droppedNames`) can never overlap `keptDefs` by construction of
  // `renderDefsWithinBudget` itself, so only the structural set needs filtering.
  //
  // ONE ENTRY PER TYPE, AND THE LAST CAUSE WINS (adversarial review D4). These
  // two lists overlap: a type refused at one node's breadth cap, then reached
  // via another node, emitted, and finally lost to the render budget was landing
  // in `dropped` TWICE with two different causes, inflating every count derived
  // from it (~3% of walks in a 20k fuzz) and reporting the cause that
  // demonstrably did not lose it. A Map keyed by name keeps the first
  // appearance's ORDER while the later write replaces the attribution.
  const keptNames = new Set(keptDefs.map((d) => d.name));
  const byName = new Map<string, DroppedType>();
  for (const name of droppedSet) {
    if (!keptNames.has(name)) {
      byName.set(name, { name, cause: droppedCause.get(name) ?? "total-types" });
    }
  }
  for (const name of rendered.droppedNames) {
    byName.set(name, { name, cause: "budget", budgetBound });
  }
  const droppedBy: DroppedType[] = [...byName.values()];
  const dropped = droppedBy.map((d) => d.name);

  // The per-GESTURE ledger (session-v48 phase 3), when the caller asked for one.
  // Written after `keptNames` exists so a type an EARLIER sibling walk dropped
  // and this one emitted leaves the ledger: the developer is owed the types that
  // reached no block ANYWHERE in the prompt, not a list of near misses.
  //
  // The write is LAST-WINS across walks too (review D4), for the same reason it
  // is within one: whichever walk lost the name most recently is the one whose
  // cap the developer would have to move.
  const ledger = shared?.droppedBy;
  if (ledger !== undefined) {
    for (const name of keptNames) {
      ledger.delete(name);
    }
    for (const d of droppedBy) {
      ledger.set(d.name, d);
    }
  }

  return { block: keptDefs.map((d) => d.def).join(SEP), defs: keptDefs, dropped, droppedBy };
}
