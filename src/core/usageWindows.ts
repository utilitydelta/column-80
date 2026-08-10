/**
 * Usage windows: real call sites of a symbol, cut out of the repo and bounded,
 * for the two v29 experiments that inject "how this repo calls things".
 *
 * The retrieval question the v22 spike lost on is not asked here. That spike
 * mined usage blind and surfaced the target call at 3 of 32 sites, and an
 * example missing the needed call displaces context that would have helped.
 * Both v29 callers name their symbol first (the widget selected a member; the
 * draft function calls a method), and the locations come from the reference
 * PROVIDER, so an alias, a re-export and a renamed import are all seen through
 * where a text search would miss them. What is left is the part v22 DID measure
 * a lift on: call SHAPE, arity and argument kinds.
 *
 * Pure: no vscode, no I/O, no clock. Locations and file text arrive as
 * arguments; who resolved them is the caller's problem.
 *
 * Every bound here is a parameter with no default, deliberately. How many
 * windows and how long is a budget question with a measurable answer, and this
 * session measures it; a default baked in here would be the guess the
 * measurement exists to replace.
 */

/** Where the reference provider said the symbol is used. `line` is 0-based, as
 *  it is everywhere else in this codebase. */
export interface UsageSite {
  uri: string;
  line: number;
}

export interface UsageWindowBounds {
  /** How many windows may be emitted. */
  maxWindows: number;
  /** Context lines kept above the usage line. */
  linesBefore: number;
  /** Context lines kept below it. */
  linesAfter: number;
  /** Hard ceiling on the RENDERED characters across all windows, which is the
   *  number a caller with a prompt budget actually has. A window that would
   *  cross it is dropped whole, never cut: half a call is worse than no call,
   *  because the model completes what it can see.
   *
   *  Rendering is not free and the budget has to know it, or it under-charges by
   *  a fifth and a caller passing its remaining prompt room overruns. The
   *  overheads below are what the caller's chosen renderer adds; the whole-block
   *  injector learned this the same way, by charging its header and its `// `
   *  prefixes after the budget rather than inside it. */
  maxChars: number;
  /** Characters the renderer adds per LINE. `renderUsageComment` adds the
   *  comment opener and a space; `renderUsageSection` adds nothing. Absent is
   *  zero, which is right only for a caller rendering the lines verbatim. */
  perLineChars?: number;
  /** Characters the renderer adds per WINDOW: the `file:line` provenance line,
   *  the fences. Absent is zero. */
  perWindowChars?: number;
}

export interface UsageWindow {
  uri: string;
  /** 0-based, inclusive, after blank-line trimming. */
  startLine: number;
  endLine: number;
  /** Dedented, blank-trimmed. Never empty. */
  lines: string[];
}

/**
 * Cut the windows.
 *
 * `readLines` returns the file's lines or undefined when the caller cannot read
 * it (a location outside the workspace, a file that moved). Unreadable is not
 * an error: that site is skipped and the next one is tried, because a resolver
 * that answers with one unreachable location should not cost the human every
 * other window.
 *
 * `exclude` is the site the caller is generating AT. Without it the human's own
 * cursor line comes back as an example of itself, which teaches the model
 * nothing and spends a window doing it.
 */
export function collectUsageWindows(
  sites: readonly UsageSite[],
  readLines: (uri: string) => readonly string[] | undefined,
  bounds: UsageWindowBounds,
  exclude?: UsageSite,
): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const seenText = new Set<string>();
  // Per file, the line ranges already emitted. Two references inside one small
  // function produce overlapping windows, and the overlap is the same code
  // twice: the second is dropped rather than merged, because merging grows a
  // window past the length the caller budgeted for.
  const covered = new Map<string, Array<[number, number]>>();
  let chars = 0;

  for (const site of sites) {
    if (windows.length >= bounds.maxWindows) {
      break;
    }
    if (exclude !== undefined && site.uri === exclude.uri && site.line === exclude.line) {
      continue;
    }
    const lines = readLines(site.uri);
    if (lines === undefined || site.line < 0 || site.line >= lines.length) {
      continue;
    }
    const ranges = covered.get(site.uri) ?? [];
    if (ranges.some(([lo, hi]) => site.line >= lo && site.line <= hi)) {
      continue;
    }
    const from = Math.max(0, site.line - bounds.linesBefore);
    const to = Math.min(lines.length - 1, site.line + bounds.linesAfter);
    const cut = trimBlankEdges(lines.slice(from, to + 1), from);
    if (cut === undefined) {
      continue;
    }
    const body = dedent(cut.lines);
    const text = body.join("\n");
    // Two call sites that render the same text add nothing the first did not.
    // Common in real repos: the same one-line call in a test table, or a
    // generated file.
    if (seenText.has(text)) {
      continue;
    }
    // Rendered cost, not raw cost: the caller's ceiling is prompt room.
    const cost =
      text.length + 1 + body.length * (bounds.perLineChars ?? 0) + (bounds.perWindowChars ?? 0);
    if (chars + cost > bounds.maxChars) {
      // `continue`, not `break`. The rule this enforces is "no half calls", and
      // one long generated line at the head of the server's reference list must
      // not zero the whole leg when the windows behind it fit. The window cap
      // above is what ends the loop.
      continue;
    }
    seenText.add(text);
    chars += cost;
    ranges.push([cut.startLine, cut.endLine]);
    covered.set(site.uri, ranges);
    windows.push({ uri: site.uri, startLine: cut.startLine, endLine: cut.endLine, lines: body });
  }
  return windows;
}

/** Drop blank lines at both edges and report where the survivor starts.
 *  undefined when the whole slice is blank, which happens at the top of a file
 *  or between two declarations. */
function trimBlankEdges(
  slice: readonly string[],
  offset: number,
): { lines: string[]; startLine: number; endLine: number } | undefined {
  let start = 0;
  let end = slice.length - 1;
  while (start <= end && slice[start].trim() === "") {
    start++;
  }
  while (end >= start && slice[end].trim() === "") {
    end--;
  }
  if (start > end) {
    return undefined;
  }
  return {
    lines: slice.slice(start, end + 1).map((l) => l.replace(/\s+$/, "")),
    startLine: offset + start,
    endLine: offset + end,
  };
}

/** Strip the common leading whitespace. A call site three scopes deep otherwise
 *  spends a third of its budget on indentation, and at a FIM site the block sits
 *  above the cursor where a wrong indent is a shape the model copies. Tabs and
 *  spaces are compared as characters, which is right for a file that is
 *  consistent with itself and is the only file a window comes from. */
function dedent(lines: readonly string[]): string[] {
  let common = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    common = Math.min(common, line.length - line.trimStart().length);
  }
  if (!Number.isFinite(common) || common === 0) {
    return [...lines];
  }
  return lines.map((l) => (l.trim() === "" ? "" : l.slice(common)));
}

/**
 * The FIM shape: a comment block, because it is injected into the prefix above
 * the cursor and anything that is not a comment there is code the model will
 * continue. `lineComment` comes from the language's own row
 * (`commentSyntaxFor`), never a hardcoded `//`.
 *
 * Each window carries its file and line, which is not decoration: the human
 * reading the channel needs to be able to go and look at the example, and the
 * v22 verdict on usage injection was conditional on the context being visible
 * and attributable.
 */
export function renderUsageComment(
  windows: readonly UsageWindow[],
  header: string,
  lineComment: string,
): string | undefined {
  if (windows.length === 0) {
    return undefined;
  }
  // The header is caller text, and a caller that spells it over two lines would
  // otherwise put an UNCOMMENTED line into the FIM prefix. That is the one
  // property this function has: it is injected above the cursor, and anything
  // that is not a comment there is code the model continues.
  const out: string[] = header.split("\n").map((l) => `${lineComment} ${l}`);
  for (const w of windows) {
    out.push(`${lineComment} ${shortName(w.uri)}:${w.startLine + 1}`);
    for (const line of w.lines) {
      out.push(line === "" ? lineComment : `${lineComment} ${line}`);
    }
  }
  return out.join("\n");
}

/**
 * The fn-gen shape: a labelled, fenced section, the same as a context block, so
 * the previewed prompt shows it as one more visible section the human can read
 * and reject. The repair path assembles sections, not comments.
 */
export function renderUsageSection(
  windows: readonly UsageWindow[],
  header: string,
): string | undefined {
  if (windows.length === 0) {
    return undefined;
  }
  const parts: string[] = [header];
  for (const w of windows) {
    const body = w.lines.join("\n");
    parts.push(`${shortName(w.uri)}#L${w.startLine + 1}-L${w.endLine + 1}`);
    // A window two lines above a call site can hold a Rust doc example or a
    // Python docstring, and either can carry its own triple backtick. Markdown's
    // own rule is the way out: a fence longer than the longest run inside the
    // body cannot be closed by it.
    const fence = "`".repeat(Math.max(3, longestBacktickRun(body) + 1));
    parts.push(fence);
    parts.push(body);
    parts.push(fence);
  }
  return parts.join("\n");
}

/** The last two path segments of a uri. A full `file:///home/...` path in a
 *  prompt is budget spent on a prefix every window shares, and in a comment
 *  block above the cursor it is a line the model has to read past. */
function shortName(uri: string): string {
  const path = decodePath(uri.replace(/^file:\/\//, "").replace(/[?#].*$/, ""));
  const parts = path.split("/").filter((p) => p !== "");
  return parts.slice(-2).join("/") || uri;
}

/** The longest run of backticks in the text, so a fence can be built that the
 *  body cannot close. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  let run = 0;
  for (const c of text) {
    run = c === "`" ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** Percent-decode a uri path, and keep the raw one when it does not decode. A
 *  path with a space arrives as `my%20dir/x.rs`, and putting that in a prompt
 *  shows the human a path that is not on their disk. `decodeURIComponent`
 *  throws on a malformed escape, which is a reason to keep the original rather
 *  than to lose the window. */
function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
