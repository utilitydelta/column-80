/**
 * The members of a Rust type a macro expanded, which the outline cannot see.
 *
 * `membersOfType` reads documentSymbol, a syntax outline. A `macro_rules!`
 * newtype (`newtype_id!(TenantId)`) has no struct and no impl in that outline,
 * so it resolves with zero members while hover, which is semantic, still names
 * the type. Completion runs over expanded code, so `TenantId::` lists the
 * members the outline could not.
 *
 * The completion is asked at a `Type::` path that ALREADY EXISTS in the
 * workspace, found through the reference provider. Never at a synthetic one:
 * writing `Type::` into a buffer dirties a tab on the VS Code transport even
 * after the text is restored (measured), and a buffer the user did not touch
 * must stay clean. A type nobody has spelled a path to yet gets no members and
 * says so.
 */

import { CompletionMember, SourceCursor, SurfaceExtractor, semanticMembers } from "./extraction";

export interface MacroMembers {
  type: string;
  /** The existing `Type::` path completion was asked at. Absent: none was found. */
  pathAt?: SourceCursor;
  /** Inherent members only. Trait members arrive labelled with their trait. */
  members: CompletionMember[];
  /** How many references were read looking for a path. */
  searched: number;
  /** references() came back empty. With the declaration included a real answer
   *  is never empty, so this is a cancelled or failed request, not "no path". */
  unavailable?: true;
}

// Per extractor (one server session): def file + name -> the answer and the def
// file text it was computed against. A hit counts only while that text is
// unchanged and the entry is younger than MEMO_TTL_MS. Only a real answer is
// kept: members found, or a genuine no-path. No position in the key: an edit
// above the invocation moves it, and the def text check already catches that.
interface MemoEntry {
  defText: string | undefined;
  found: MacroMembers;
  at: number;
}
const MEMO = new WeakMap<object, Map<string, MemoEntry>>();

// Every answer depends on files other than the def file: a `Type::` path the
// user writes later, the macro body, a hand-written `impl` elsewhere. No key can
// see those, so every entry expires. A bound, not a measured number. What it
// costs FIM: at most one references() and one completion ask per type per 30s.
const MEMO_TTL_MS = 30_000;

// Reference FILES opened while looking for a path. Each open is a document the
// server may have to parse, and this runs on FIM's keystroke path; the first
// path found ends the search, so the cap only bites on a type referenced in
// many files and never followed by `::`. A bound, not a measured number.
const PATH_SEARCH_FILE_CAP = 8;

// Words that can sit before `!(` without being a macro name: `if !(a && b)`.
const NOT_MACRO_NAMES = new Set(["if", "while", "match", "return", "let", "in", "else", "and", "or", "break", "yield"]);

/** Whether a hover names a data type of that name, so a trait, an alias, a
 *  generic parameter or a function never takes the macro path. */
export function hoverDeclaresDataType(signature: string, name: string): boolean {
  return new RegExp(`\\b(?:struct|enum|union)\\s+${name}\\b`).test(signature);
}

/** Whether `cursor` sits inside a macro invocation's delimiters (`name!(...)`,
 *  `name! { ... }`) or a `macro_rules!` body. A declaration outside every one is
 *  hand-written, and the outline already answered for it, empty or not.
 *
 *  A lexer, not a parser: it skips comments, strings and char literals so a
 *  bracket inside them is not counted, and otherwise only tracks brackets. */
export function isInsideMacroInvocation(text: string, cursor: SourceCursor): boolean {
  const lines = text.split("\n");
  if (cursor.line >= lines.length) {
    return false;
  }
  let end = cursor.character;
  for (let l = 0; l < cursor.line; l++) {
    end += lines[l].length + 1;
  }
  const stack: boolean[] = [];
  let i = 0;
  while (i < end) {
    const c = text[i];
    const next = text[i + 1];
    const charLit = c === "'" ? CHAR_LITERAL.exec(text.slice(i, i + 12)) : null;
    if (c === "/" && next === "/") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? end : nl;
    } else if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < end && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (text[i] === "*" && text[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
    } else if (c === "r" && startsRawString(text, i) && /^r#*"/.test(text.slice(i, i + 8))) {
      const hashes = /^r(#*)"/.exec(text.slice(i, i + 8))?.[1] ?? "";
      const close = text.indexOf(`"${hashes}`, text.indexOf('"', i) + 1);
      i = close < 0 ? end : close + 1 + hashes.length;
    } else if (c === '"') {
      i++;
      while (i < end && text[i] !== '"') {
        i += text[i] === "\\" ? 2 : 1;
      }
      i++;
    } else if (charLit !== null) {
      i += charLit[0].length; // `'('`; a lifetime (`'a`) is not a literal and falls through
    } else {
      if (c === "(" || c === "[" || c === "{") {
        stack.push(opensMacro(text, i));
      } else if (c === ")" || c === "]" || c === "}") {
        stack.pop();
      }
      i++;
    }
  }
  return stack.includes(true);
}

const CHAR_LITERAL = /^'(?:\\.|[^\\'])'/;

const isWordChar = (c: string | undefined): boolean => c !== undefined && /\w/.test(c);

// `r"..."` or a byte raw string `br"..."`; `for"` or `bar"` is not one.
const startsRawString = (text: string, i: number): boolean =>
  !isWordChar(text[i - 1]) || (text[i - 1] === "b" && !isWordChar(text[i - 2]));

// Read backwards from the bracket at `at`: `name!` or `name !` right before it
// opens a macro invocation, and so does `macro_rules! name`. Only whitespace may
// sit between the pieces; a comment there reads as not-a-macro.
function opensMacro(text: string, at: number): boolean {
  let j = skipSpaceBack(text, at - 1);
  if (text[j] === "!") {
    const word = wordBack(text, skipSpaceBack(text, j - 1));
    return word !== undefined && !NOT_MACRO_NAMES.has(word.text);
  }
  const name = wordBack(text, j);
  if (name === undefined) {
    return false;
  }
  j = skipSpaceBack(text, name.start - 1);
  if (text[j] !== "!") {
    return false;
  }
  return wordBack(text, skipSpaceBack(text, j - 1))?.text === "macro_rules";
}

function skipSpaceBack(text: string, j: number): number {
  while (j >= 0 && /\s/.test(text[j])) {
    j--;
  }
  return j;
}

function wordBack(text: string, j: number): { text: string; start: number } | undefined {
  let start = j;
  while (start >= 0 && isWordChar(text[start])) {
    start--;
  }
  return start === j ? undefined : { text: text.slice(start + 1, j + 1), start: start + 1 };
}

/** The members completion lists at an existing `name::` path, inherent only.
 *  One reference query, at most one completion ask, no retry, no edits, and
 *  none of those on a repeat ask within 30s while the def file is unchanged.
 *
 *  No client deadline. This runs on FIM's keystroke path, but rust-analyzer
 *  cancels the request itself on the next edit, and a deadline would stop the
 *  memo from ever filling on a slow workspace. Measured on a 514-file workspace
 *  with a typing edit before each call: 402ms cold, then 0ms per call; a request
 *  cancelled by an edit recovered on the next call 15/15 times warm; cold, 6/6
 *  came back unavailable and none was memoized. */
export async function macroMembersViaPath(
  extractor: SurfaceExtractor,
  defCursor: SourceCursor,
  name: string,
  openFile: (uri: string) => Promise<string | undefined>,
  now: () => number = Date.now,
): Promise<MacroMembers> {
  const defText = await openFile(defCursor.uri).catch(() => undefined);
  const key = `${defCursor.uri}#${name}`;
  let memo = MEMO.get(extractor);
  if (memo === undefined) {
    memo = new Map();
    MEMO.set(extractor, memo);
  }
  const hit = memo.get(key);
  const fresh = hit !== undefined && now() - hit.at < MEMO_TTL_MS;
  if (hit !== undefined && fresh && hit.defText === defText) {
    return hit.found;
  }
  const found = await macroMembersUncached(extractor, defCursor, name, openFile);
  // A path whose completion listed nothing is not kept: that ask may have been
  // cancelled too, and the next walk should try again.
  if (!found.unavailable && (found.pathAt === undefined || found.members.length > 0)) {
    memo.set(key, { defText, found, at: now() });
  }
  return found;
}

async function macroMembersUncached(
  extractor: SurfaceExtractor,
  defCursor: SourceCursor,
  name: string,
  openFile: (uri: string) => Promise<string | undefined>,
): Promise<MacroMembers> {
  let refs: Awaited<ReturnType<NonNullable<SurfaceExtractor["references"]>>> = [];
  try {
    // With the declaration: excluding it costs the VS Code transport a second
    // dispatch, and a macro argument is never followed by `::` anyway.
    refs = (await extractor.references?.(defCursor, { includeDeclaration: true })) ?? [];
  } catch {
    refs = [];
  }
  if (refs.length === 0) {
    return { type: name, members: [], searched: 0, unavailable: true };
  }
  const texts = new Map<string, string | undefined>();
  let searched = 0;
  for (const ref of refs) {
    if (!texts.has(ref.uri)) {
      if (texts.size >= PATH_SEARCH_FILE_CAP) {
        break;
      }
      texts.set(ref.uri, await openFile(ref.uri).catch(() => undefined));
    }
    searched++;
    const line = texts.get(ref.uri)?.split("\n")[ref.endLine];
    if (line === undefined || line.slice(ref.endCharacter, ref.endCharacter + 2) !== "::") {
      continue;
    }
    // A turbofish (`Name::<T>`) is still a path to the type's members, but the
    // cursor after it completes generic arguments, so it is not a site.
    if (line[ref.endCharacter + 2] === "<") {
      continue;
    }
    const pathAt: SourceCursor = { uri: ref.uri, line: ref.endLine, character: ref.endCharacter + 2 };
    let listed: CompletionMember[] = [];
    try {
      listed = await extractor.completeMembers(pathAt, { once: true });
    } catch {
      listed = [];
    }
    const members = semanticMembers(listed).filter((m) => m.viaTrait === undefined);
    return { type: name, pathAt, members, searched };
  }
  return { type: name, members: [], searched };
}

/** The channel line for one macro-generated type, shared by every gesture that
 *  resolves through the walk so the evidence reads the same everywhere. */
export function macroGeneratedLine(note: {
  type: string;
  pathAt?: SourceCursor;
  memberCount: number;
  searched: number;
  unavailable?: true;
}): string {
  const t = note.type;
  if (note.unavailable) {
    return (
      `\`${t}\` is macro-generated; the reference search came back empty (cancelled, or the server ` +
      `was not ready), so its members are unknown this time`
    );
  }
  if (note.pathAt === undefined) {
    return (
      `\`${t}\` is macro-generated and no \`${t}::\` path exists in its ${note.searched} reference(s), ` +
      `so its members are unknown (no buffer is edited to find them)`
    );
  }
  const where = `${note.pathAt.uri.split("/").pop()}:${note.pathAt.line + 1}`;
  return (
    `\`${t}\` is macro-generated, so the outline has no members for it; completion at the existing ` +
    `\`${t}::\` path (${where}) listed ${note.memberCount} inherent member(s)`
  );
}
