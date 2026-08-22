/**
 * FIM whole-block injection: the types-in-play struct graph injected
 * into the FIM prefix (as a comment block the base model reads) so a whole-block
 * completion over cross-file/crate types uses the REAL names. Rides the existing
 * 50ms injection race (completionService.ts) and a per-file-version cache, so a
 * slow resolve degrades to plain FIM and never blocks a keystroke.
 *
 * Pure and headless: the site detection and the rendering take strings and an
 * injected resolveStruct edge-resolver (the same walkDataShape seam every path
 * uses). rust-analyzer resolution + the cache live in the vscode layer.
 */

import { SharedWalkState, StructResolution, WalkBounds, parseBraceDef, renderDefsWithinBudget, walkDataShape } from "./dataShape";
// Re-exported for backward compatibility: `parseBraceDef` (and, since v40,
// `renderDefsWithinBudget`) originated in this file and moved to dataShape.ts
// so `walkDataShape` itself could use them for its own render-time truncation
// (dataShape.ts cannot import FROM this file - this file already imports FROM
// dataShape.ts, and a cycle back the other way isn't worth it for two pure
// functions). Existing callers/tests that import them from here keep working.
export { parseBraceDef, renderDefsWithinBudget };
import { typesNamedIn } from "./compilerDirected";
import { PY_STD_TYPE_NAMES, STD_TYPE_NAMES } from "./crossFileShape";
import { TS_LANGUAGE_IDS, TS_STD_TYPE_NAMES } from "./tsExtraction";
import { CS_STD_TYPE_NAMES } from "./csExtraction";
import { GO_STD_TYPE_NAMES } from "./goExtraction";

/** A whole-block FIM site: the cursor sits in an EMPTY (whitespace-only) function
 *  body, so a full block over the signature's types can be offered. `signature`
 *  is the enclosing function's signature; `types` are the types in play (its
 *  PascalCase parameter/return types) — the SELECTIVE set to derive, never a
 *  file-wide fan-out. undefined when the cursor is not at a whole-block site (mid-
 *  expression, a non-empty body, no enclosing fn, or a signature naming no types).
 *  The exact trigger FEEL (when a full block should be offered vs stay quiet) is a
 *  human-delegated UX call; this is the mechanism's conservative default. */
export interface WholeBlockSite {
  signature: string;
  types: string[];
}

export function wholeBlockSite(prefix: string): WholeBlockSite | undefined {
  // Backward brace-depth scan to the ENCLOSING `{`: a closing brace deepens, an
  // opening brace at depth 0 is the cursor's own enclosing block. A balanced
  // sibling block (`fn helper() {}`) nets to zero and is skipped.
  let depth = 0;
  let openIdx = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === "}") {
      depth++;
    } else if (c === "{") {
      if (depth === 0) {
        openIdx = i;
        break;
      }
      depth--;
    }
  }
  if (openIdx < 0) {
    return undefined; // no enclosing block
  }
  // The whole-block trigger (conservative default): the body so far must be
  // whitespace-only. Any real content (mid-expression) is NOT a whole-block site.
  if (/\S/.test(prefix.slice(openIdx + 1))) {
    return undefined;
  }
  // The nearest `fn ` before the brace is the enclosing function. It must be a
  // clean fn signature directly opening this brace — no intervening `{`/`}` (an
  // inner block, not the fn body) and real parens.
  const before = prefix.slice(0, openIdx);
  let fnIdx = -1;
  for (const m of before.matchAll(/\bfn\b/g)) {
    fnIdx = m.index ?? -1;
  }
  if (fnIdx < 0) {
    return undefined; // no enclosing fn
  }
  const signature = before.slice(fnIdx).trim();
  if (/[{}]/.test(signature) || !signature.includes("(") || !signature.includes(")")) {
    return undefined; // not a clean fn signature directly enclosing this brace
  }
  const types = typesInPlay(signature);
  if (types.length === 0) {
    return undefined; // a signature naming no user type is not a whole-block site
  }
  return { signature, types };
}

// The PascalCase/identifier names declared in a signature's `<...>` generic
// clause (the params AND their trait bounds): `fn f<T: Trait>(..)` -> {T, Trait}.
// These are NOT concrete types to derive — resolving a generic param or a bound is
// noise. Depth-tracked so a nested `<>` in a bound does not close the clause early.
function genericClauseNames(signature: string): Set<string> {
  const names = new Set<string>();
  const fnm = /\bfn\s+[A-Za-z_]\w*\s*</.exec(signature);
  if (!fnm) {
    return names;
  }
  let i = fnm.index + fnm[0].length - 1; // at the opening `<`
  let depth = 0;
  const start = i + 1;
  for (; i < signature.length; i++) {
    if (signature[i] === "<") {
      depth++;
    } else if (signature[i] === ">") {
      depth--;
      if (depth === 0) {
        break;
      }
    }
  }
  for (const m of signature.slice(start, i).matchAll(/[A-Za-z_]\w*/g)) {
    names.add(m[0]);
  }
  return names;
}

/** The types in play for a whole-block site: the signature's PascalCase
 *  parameter/return types, SELECTIVE — never a file-wide scrape. Excludes
 *  std/primitive containers (STD_TYPE_NAMES), generic parameters and their trait
 *  bounds (the `<...>` clause names — `T`, `Trait`), and single-letter type names
 *  (a bare generic like `T`/`U`). What survives is the concrete user types to
 *  derive. Exported for the site oracle. */
export function typesInPlay(signature: string): string[] {
  const generic = genericClauseNames(signature);
  return typesNamedIn(signature).filter(
    (t) => !STD_TYPE_NAMES.has(t) && !generic.has(t) && !/^[A-Z]$/.test(t),
  );
}

// Statement keywords whose parenthesized header opens a BLOCK, not a function
// body: `if (...) {` is a site to complete inside, never a body to generate.
const TS_NON_BODY_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "with"]);

/** The TS types in play: the header's PascalCase parameter/return types minus
 *  lib.d.ts names (TS_STD_TYPE_NAMES), the generic-clause names, and bare
 *  single-letter generics — the TS sibling of typesInPlay. */
export function tsTypesInPlay(signature: string, genericNames?: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of signature.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    const t = m[1];
    if (seen.has(t)) {
      continue;
    }
    seen.add(t);
    if (TS_STD_TYPE_NAMES.has(t) || genericNames?.has(t) || /^[A-Z]$/.test(t)) {
      continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * The TS/TSX whole-block site detector — the sibling of wholeBlockSite (which
 * stays the Rust detector, untouched). Fires when the cursor sits in an EMPTY
 * body whose brace is directly headed by a function-SHAPED declaration: a
 * `function` declaration or expression, an arrow (`=>` before the brace), or a
 * method (`name(params)[: Ret]`). Detection keys on the header's shape, never
 * on any keyword-named identifier — a parameter or identifier named `fn` is
 * data here, not a trigger (`process(fn: () => void) { }` ENGAGES; the banned
 * mechanism is the Rust `fn`-keyword heuristic).
 * Control-flow headers (`if (...) {`, incl. `for await`), object literals,
 * class bodies (incl. mixin `extends Name(Base) {` headers), type-level
 * braces (`type`/`interface` statements), and non-empty bodies are not
 * sites. undefined when the header names no user type.
 */
export function tsWholeBlockSite(prefix: string): WholeBlockSite | undefined {
  // Backward brace-depth scan to the ENCLOSING `{` (same scan as the Rust
  // detector); the body so far must be whitespace-only.
  let depth = 0;
  let openIdx = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === "}") {
      depth++;
    } else if (c === "{") {
      if (depth === 0) {
        openIdx = i;
        break;
      }
      depth--;
    }
  }
  if (openIdx < 0) {
    return undefined; // no enclosing block
  }
  if (/\S/.test(prefix.slice(openIdx + 1))) {
    return undefined; // the body already has content: not a whole-block site
  }

  // The header directly before the brace. An arrow strips its `=>` first.
  let header = prefix.slice(0, openIdx).trimEnd();
  const isArrow = header.endsWith("=>");
  if (isArrow) {
    header = header.slice(0, -2).trimEnd();
  }

  // The parameter-list close: the header ends `)` or `): ReturnType` (a return
  // annotation carrying braces would make THIS brace ambiguous — degrade).
  let closeIdx: number;
  if (header.endsWith(")")) {
    closeIdx = header.length - 1;
  } else {
    const lastClose = header.lastIndexOf(")");
    if (lastClose < 0 || !/^\s*:\s*[^{};]*$/.test(header.slice(lastClose + 1))) {
      return undefined; // no parameter list directly heading this brace
    }
    closeIdx = lastClose;
  }
  let parenDepth = 0;
  let openParen = -1;
  for (let i = closeIdx; i >= 0; i--) {
    if (header[i] === ")") {
      parenDepth++;
    } else if (header[i] === "(") {
      parenDepth--;
      if (parenDepth === 0) {
        openParen = i;
        break;
      }
    }
  }
  if (openParen < 0) {
    return undefined; // unbalanced params
  }

  // What heads the params: an optional generic clause, then a name. A method or
  // function needs the name (and it must not be a statement keyword); an arrow's
  // parameter list needs none (a callback arrow has no name of its own).
  let nameEnd = openParen;
  while (nameEnd > 0 && /\s/.test(header[nameEnd - 1])) {
    nameEnd--;
  }
  const genericNames = new Set<string>();
  if (header[nameEnd - 1] === ">") {
    let genericDepth = 0;
    let genericStart = -1;
    for (let i = nameEnd - 1; i >= 0; i--) {
      if (header[i] === ">") {
        genericDepth++;
      } else if (header[i] === "<") {
        genericDepth--;
        if (genericDepth === 0) {
          genericStart = i;
          break;
        }
      }
    }
    if (genericStart < 0) {
      return undefined; // unbalanced generic clause
    }
    for (const m of header.slice(genericStart + 1, nameEnd - 1).matchAll(/[A-Za-z_$][\w$]*/g)) {
      genericNames.add(m[0]);
    }
    nameEnd = genericStart;
  }
  const nameMatch = /([A-Za-z_$][\w$]*)$/.exec(header.slice(0, nameEnd));
  const name = nameMatch?.[1];
  if (!isArrow) {
    if (name === undefined) {
      return undefined; // a bare parenthesized expression before `{`
    }
    // `for await (...) {`: the backward name scan lands on `await`; the
    // statement keyword sits one word further left.
    const keywordName =
      name === "await"
        ? (/([A-Za-z_$][\w$]*)\s*$/.exec(header.slice(0, nameEnd - name.length))?.[1] ?? name)
        : name;
    if (TS_NON_BODY_KEYWORDS.has(keywordName)) {
      return undefined; // `if (...) {` and friends: a block, not a body
    }
    if (name === "extends" || /\bextends\s*$/.test(header.slice(0, nameEnd - name.length))) {
      return undefined; // mixin header `extends Name(Base) {`: a class body
    }
  }
  // An arrow needs no name (a callback's params head the `=>` directly), and
  // whatever identifier precedes its parameter list is not part of the site.

  const sigStart = name !== undefined ? nameEnd - name.length : openParen;
  // The enclosing STATEMENT's head keyword: inside a `type`/`interface`
  // statement every brace is an object TYPE literal, never a body - a
  // type-level arrow (`type Handler = (a: A) => {`, `interface Api { fetch:
  // (o: O) => {`) must not fire. The statement runs
  // from the last `;`/`}`; `export`/`declare` modifiers are skipped. A VALUE
  // arrow property (`const obj = { fetch: (o: O) => {`) keeps its head word
  // (`const`) and still engages.
  const stmt = header.slice(0, sigStart);
  const stmtHead = stmt.slice(Math.max(stmt.lastIndexOf(";"), stmt.lastIndexOf("}")) + 1);
  const headWords = stmtHead.match(/[A-Za-z_$][\w$]*/g) ?? [];
  let hw = 0;
  while (hw < headWords.length && (headWords[hw] === "export" || headWords[hw] === "declare")) {
    hw++;
  }
  if (headWords[hw] === "type" || headWords[hw] === "interface") {
    return undefined; // a type-level brace, not a body
  }
  // The statement head only sees the INNERMOST statement: an arrow property
  // after a `;`-terminated member inside an interface/type body has a bland
  // head (`process: (o: Order) =>`). The type context lives on an ENCLOSING
  // brace, so walk them: a brace opened by a type/interface statement, or a
  // `satisfies` type literal, makes every brace inside it type-level.
  let stmtDepth = 0;
  for (let i = stmt.length - 1; i >= 0; i--) {
    const c = stmt[i];
    if (c === "}") {
      stmtDepth++;
    } else if (c === "{") {
      if (stmtDepth > 0) {
        stmtDepth--;
        continue;
      }
      const before = stmt.slice(0, i);
      if (/\bsatisfies\s*$/.test(before)) {
        return undefined;
      }
      const encHead = before.slice(Math.max(before.lastIndexOf(";"), before.lastIndexOf("}")) + 1);
      const encWords = encHead.match(/[A-Za-z_$][\w$]*/g) ?? [];
      let ew = 0;
      while (ew < encWords.length && (encWords[ew] === "export" || encWords[ew] === "declare")) {
        ew++;
      }
      if (encWords[ew] === "type" || encWords[ew] === "interface") {
        return undefined;
      }
    }
  }
  const signature = header.slice(sigStart).trim();
  const types = tsTypesInPlay(header.slice(openParen), genericNames);
  if (types.length === 0) {
    return undefined; // a header naming no user type is not a whole-block site
  }
  return { signature, types };
}

// C# statement keywords whose parenthesized header opens a BLOCK, not a method
// body: `if (...) {`, `foreach (...) {` are sites to complete inside, never a
// body to generate. The C# sibling of TS_NON_BODY_KEYWORDS.
const CS_NON_BODY_KEYWORDS = new Set([
  "if", "for", "foreach", "while", "switch", "catch", "using", "lock", "fixed", "do", "else",
]);

/** The C# types in play: the header's PascalCase parameter/return types minus
 *  BCL names (CS_STD_TYPE_NAMES), the generic-clause names, and bare
 *  single-letter generics — the C# sibling of tsTypesInPlay. */
export function csTypesInPlay(signature: string, genericNames?: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of signature.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    const t = m[1];
    if (seen.has(t)) {
      continue;
    }
    seen.add(t);
    if (CS_STD_TYPE_NAMES.has(t) || genericNames?.has(t) || /^[A-Z]$/.test(t)) {
      continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * The C# whole-block site detector — the sibling of wholeBlockSite (Rust) and
 * tsWholeBlockSite (TS), both untouched. Fires when the cursor sits in an EMPTY
 * body whose brace is directly headed by a C# method/local-function HEADER: a
 * `ReturnType Name(params)` (optionally preceded by modifiers and a generic
 * clause `Name<T>`). A C# method body opens with `{` (an expression-bodied
 * member opens with `=>`, never this brace), so the enclosing brace directly
 * following a `)` param list is the site. Control-flow headers (`if (...) {`,
 * `foreach (...) {`), class/namespace/struct bodies (no param list before the
 * brace), and non-empty bodies are not sites. undefined when the header names no
 * user type.
 */
export function csWholeBlockSite(prefix: string): WholeBlockSite | undefined {
  // Backward brace-depth scan to the ENCLOSING `{` (same scan as the Rust/TS
  // detectors); the body so far must be whitespace-only.
  let depth = 0;
  let openIdx = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === "}") {
      depth++;
    } else if (c === "{") {
      if (depth === 0) {
        openIdx = i;
        break;
      }
      depth--;
    }
  }
  if (openIdx < 0) {
    return undefined; // no enclosing block
  }
  if (/\S/.test(prefix.slice(openIdx + 1))) {
    return undefined; // the body already has content: not a whole-block site
  }

  // The header directly before the brace must end in a `)` param list (a class/
  // namespace/enum brace has no param list; an expression-bodied member opens
  // with `=>`, not this brace).
  const header = prefix.slice(0, openIdx).trimEnd();
  if (!header.endsWith(")")) {
    return undefined;
  }
  // Match the parameter list's open paren by depth.
  let parenDepth = 0;
  let openParen = -1;
  for (let i = header.length - 1; i >= 0; i--) {
    if (header[i] === ")") {
      parenDepth++;
    } else if (header[i] === "(") {
      parenDepth--;
      if (parenDepth === 0) {
        openParen = i;
        break;
      }
    }
  }
  if (openParen < 0) {
    return undefined; // unbalanced params
  }

  // The method name heads the param list, after an optional generic clause.
  let nameEnd = openParen;
  while (nameEnd > 0 && /\s/.test(header[nameEnd - 1])) {
    nameEnd--;
  }
  const genericNames = new Set<string>();
  if (header[nameEnd - 1] === ">") {
    let genericDepth = 0;
    let genericStart = -1;
    for (let i = nameEnd - 1; i >= 0; i--) {
      if (header[i] === ">") {
        genericDepth++;
      } else if (header[i] === "<") {
        genericDepth--;
        if (genericDepth === 0) {
          genericStart = i;
          break;
        }
      }
    }
    if (genericStart < 0) {
      return undefined; // unbalanced generic clause
    }
    for (const m of header.slice(genericStart + 1, nameEnd - 1).matchAll(/[A-Za-z_][\w]*/g)) {
      genericNames.add(m[0]);
    }
    nameEnd = genericStart;
  }
  const nameMatch = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(header.slice(0, nameEnd));
  const name = nameMatch?.[1];
  if (name === undefined) {
    return undefined; // a bare parenthesized expression before `{`, not a method
  }
  if (CS_NON_BODY_KEYWORDS.has(name)) {
    return undefined; // `if (...) {` and friends: a block, not a body
  }

  // The signature: from the last statement/block boundary before the name to the
  // param close — the method header (`public int Fill(Widget w)`), modifiers and
  // return type included.
  const stmt = header.slice(0, nameEnd - name.length);
  const boundary = Math.max(
    stmt.lastIndexOf(";"),
    stmt.lastIndexOf("{"),
    stmt.lastIndexOf("}"),
    stmt.lastIndexOf("\n"),
  );
  const signature = header.slice(boundary + 1).trim();
  // Types in play come from BOTH the RETURN-TYPE region (C# return types are
  // PREFIX: `Widget Build()`, `List<Order> GetOrders()` name their user type only
  // before the method name) AND the params. The return region is the text between
  // the statement boundary and the NAME start (`nameEnd - name.length`), so the
  // method name itself is never scanned as a type (`Build` in `Widget Build()` is
  // excluded). Attribute brackets on the same line are stripped so `[HttpGet]`
  // does not register as a user type; C# modifiers are lowercase and never match
  // the PascalCase scan. Union (return first), deduped.
  const returnRegion = header.slice(boundary + 1, nameEnd - name.length).replace(/\[[^\]]*\]/g, " ");
  const seen = new Set<string>();
  const types: string[] = [];
  for (const t of [...csTypesInPlay(returnRegion, genericNames), ...csTypesInPlay(header.slice(openParen), genericNames)]) {
    if (!seen.has(t)) {
      seen.add(t);
      types.push(t);
    }
  }
  // Defect 2: a collaborator can be named ONLY in the doc-comment, never the
  // signature — `int StripeFanout()` has a primitive return and no params, so the
  // signature names no user type, yet the `/// ... Create a `Stripe` ...` doc
  // does. Mine backtick-quoted PascalCase type names from the `///` block
  // directly heading the method (the same convention fn-gen pre-fill adopts) so
  // FIM whole-block is not blind to it. Without this the header returns undefined
  // and FIM gets zero injection.
  for (const t of csDocBacktickTypes(csDocBlockAbove(header, boundary), genericNames)) {
    // The function being written is not a type in play, even when its own doc
    // mentions it in backticks - "`Compute` returns a `LocationFactor`" is the
    // near-universal doc convention, and `Compute` is the method the cursor is
    // inside, not a collaborator to inject.
    if (t === name) {
      continue;
    }
    if (!seen.has(t)) {
      seen.add(t);
      types.push(t);
    }
  }
  if (types.length === 0) {
    return undefined; // a header naming no user type (in signature OR doc) is not a whole-block site
  }
  return { signature, types };
}

/** The contiguous `///` XML-doc block directly heading a member: the trailing
 *  run of doc lines in `header` before the signature line (`boundary` is the
 *  statement boundary just before the method name). Blank lines and attribute
 *  lines (`[HttpGet]`) between the doc and the signature are skipped so the doc
 *  is still found; the first other non-doc line stops the walk. */
function csDocBlockAbove(header: string, boundary: number): string {
  const before = header.slice(0, Math.max(0, boundary));
  const lines = before.split("\n");
  const doc: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith("///")) {
      doc.unshift(lines[i]);
      continue;
    }
    if (t === "" || /^\[.*\]$/.test(t)) {
      continue; // a blank line or an attribute between doc and signature
    }
    break; // any other code line ends the doc block
  }
  return doc.join("\n");
}

/** Backtick-quoted PascalCase type names in a doc-comment: `` `Stripe` `` and
 *  `` `Atlas.Stripe` `` (last dotted segment), BCL names (CS_STD_TYPE_NAMES) and
 *  bare single-letter generics dropped — the doc sibling of csTypesInPlay. Only
 *  backticked identifiers are taken (prose like "Create" is never a type). */
function csDocBacktickTypes(docText: string, genericNames: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of docText.matchAll(/`([A-Za-z_][A-Za-z0-9_.]*)`/g)) {
    const seg = m[1].split(".").pop();
    if (seg === undefined || !/^[A-Z]/.test(seg)) {
      continue;
    }
    if (seen.has(seg) || CS_STD_TYPE_NAMES.has(seg) || genericNames.has(seg) || /^[A-Z]$/.test(seg)) {
      continue;
    }
    seen.add(seg);
    out.push(seg);
  }
  return out;
}

/** The Python types in play: a signature's PascalCase parameter/return
 *  annotations minus the std/typing names (PY_STD_TYPE_NAMES) and bare
 *  single-letter TypeVars — the Python sibling of tsTypesInPlay / csTypesInPlay.
 *  Python builtins (`int`, `str`, `dict`) are lowercase and never match the
 *  PascalCase scan, so only the typing aliases (`Optional`, `List`) need the
 *  stop-set. */
export function pyTypesInPlay(signature: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of signature.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    const t = m[1];
    if (seen.has(t)) {
      continue;
    }
    seen.add(t);
    if (PY_STD_TYPE_NAMES.has(t) || /^[A-Z]$/.test(t)) {
      continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * The Python whole-block site detector — the sibling of wholeBlockSite (Rust),
 * tsWholeBlockSite (TS), and csWholeBlockSite (C#), all untouched. Python has no
 * braces: a block is INDENTATION + the header-terminating `:`. The cursor sits in
 * an EMPTY (whitespace-only) `def` body directly over the header.
 *
 * A safety win Python has that TS did not: `def` and `async` are RESERVED words
 * and can never be identifiers, so a `\bdef\b` / `\basync\s+def\b` keyword scan is
 * SAFE (unlike the banned Rust `fn`-keyword heuristic in TS).
 *
 * Algorithm: the body so far must be whitespace-only, so the last non-whitespace
 * char of the prefix must be the header-terminating `:`, at bracket-depth 0 (not a
 * dict/slice/annotation colon still inside brackets, and not inside a string). The
 * logical line holding that `:` is reconstructed by walking back to the most
 * recent depth-0 newline (implicit paren continuation — a multi-line header spans
 * physical lines). If the logical line starts with `def `/`async def ` it is a
 * site; class/if/for/while/with headers and dict/lambda/slice colons are not.
 */
export function pyWholeBlockSite(prefix: string): WholeBlockSite | undefined {
  // The body so far is whitespace-only ⇒ the cursor sits right after the
  // header-terminating ':', so the last non-whitespace char must be that ':'.
  const trimmed = prefix.replace(/\s+$/, "");
  if (!trimmed.endsWith(":")) {
    return undefined;
  }
  const colonIdx = trimmed.length - 1;

  // Forward scan tracking bracket depth and string state, skipping `#` comments,
  // to (a) prove the terminating ':' is at depth 0 and (b) find the logical line
  // start (the most recent depth-0 newline before the colon).
  let depth = 0;
  let logicalStart = 0;
  let quote: string | undefined; // the open string delimiter (', ", ''', """)
  // Inline `#` comment spans [start, newline) inside the header: stripped from
  // the logical line before type extraction so a PascalCase word in a param-line
  // comment (`a: int,  # see Gadget`) never leaks into `types`. Uses the scan's
  // own string-aware detection, never a `#.*` regex (which would truncate a `#`
  // inside a string default like `def f(a: str = "#x"):`).
  const commentSpans: Array<[number, number]> = [];
  for (let i = 0; i < colonIdx; i++) {
    const c = prefix[i];
    if (quote !== undefined) {
      if (c === "\\") {
        i++; // an escaped char inside a string never closes it
        continue;
      }
      if (prefix.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = undefined;
      }
      continue;
    }
    if (c === "#") {
      const nl = prefix.indexOf("\n", i);
      if (nl === -1) {
        break;
      }
      commentSpans.push([i, nl]);
      i = nl - 1; // skip the comment body; the loop's ++ lands on the newline
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = prefix.startsWith(c + c + c, i);
      quote = triple ? c + c + c : c;
      if (triple) {
        i += 2;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1);
    } else if (c === "\n" && depth === 0) {
      logicalStart = i + 1;
    }
  }
  // The terminating ':' is a real header terminator only at bracket-depth 0 and
  // outside any string; otherwise it is a dict/slice/annotation colon → dark.
  if (depth !== 0 || quote !== undefined) {
    return undefined;
  }

  // Rebuild the logical header skipping any inline `#` comment bodies inside
  // [logicalStart, colonIdx], so their text is never scanned for types.
  let logicalLine = "";
  let cur = logicalStart;
  for (const [cs, ce] of commentSpans) {
    if (ce <= logicalStart || cs > colonIdx) {
      continue;
    }
    if (cs > cur) {
      logicalLine += prefix.slice(cur, cs);
    }
    cur = ce; // skip the comment body up to its newline (the newline is kept)
  }
  logicalLine += prefix.slice(cur, colonIdx + 1);
  logicalLine = logicalLine.replace(/^\s+/, "");
  // def / async def are reserved: a safe keyword scan. Anything else (class, if,
  // for, while, with, else, try, a dict/lambda colon that reached depth 0) is not
  // a whole-block site — stay dark, conservative.
  if (!/^(?:async\s+)?def\s/.test(logicalLine)) {
    return undefined;
  }
  const signature = logicalLine.replace(/\s+/g, " ").trim();
  // Types from the params + `-> Return` only (from the first `(`), so the def
  // name is never scanned as a type.
  const parenIdx = signature.indexOf("(");
  const types = pyTypesInPlay(parenIdx >= 0 ? signature.slice(parenIdx) : signature);
  if (types.length === 0) {
    return undefined; // a header naming no user type is not a whole-block site
  }
  return { signature, types };
}

/** The Go generic-clause names: `func Reduce[T any](..)` -> {T, any}. The
 *  clause is the `[...]` directly after the func's name (methods carry their
 *  receiver's params in the receiver, where single-letter exclusion already
 *  covers them). Depth-tracked so a nested `[]byte` in a constraint does not
 *  close the clause early. */
function goGenericClauseNames(signature: string): Set<string> {
  const names = new Set<string>();
  const fm = /\bfunc\s+(?:\([^)]*\)\s*)?[A-Za-z_]\w*\s*\[/.exec(signature);
  if (!fm) {
    return names;
  }
  let i = fm.index + fm[0].length - 1; // at the opening `[`
  let depth = 0;
  const start = i + 1;
  for (; i < signature.length; i++) {
    if (signature[i] === "[") {
      depth++;
    } else if (signature[i] === "]") {
      depth--;
      if (depth === 0) {
        break;
      }
    }
  }
  for (const m of signature.slice(start, i).matchAll(/[A-Za-z_]\w*/g)) {
    names.add(m[0]);
  }
  return names;
}

/** The Go types in play: the header's capitalized receiver/param/return
 *  types minus the std stop-set (GO_STD_TYPE_NAMES — spelled bare because
 *  the PascalCase harvest reduces `time.Time` to `Time`), the generic-clause
 *  names, and bare single letters. Go's builtins (`error`, `string`, `int`)
 *  are lowercase and never harvested — but exported FUNC NAMES are
 *  capitalized (`Split`), a false type no other language's harvest could
 *  produce, so the scan covers the receiver parens and the text from the
 *  param list onward, never the name between them. */
export function goTypesInPlay(signature: string): string[] {
  const generic = goGenericClauseNames(signature);
  const receiver = /^func\s*\(([^)]*)\)/.exec(signature);
  // A generic METHOD's type params live in the receiver's own brackets
  // (`func (c *Cache[Key, Val]) Get(k Key) Val`), not in a clause after the
  // name — without this they leak into the roots as fake user types (F23).
  if (receiver) {
    const rb = /\[([^\]]*)\]/.exec(receiver[1]);
    if (rb) {
      for (const m of rb[1].matchAll(/[A-Za-z_]\w*/g)) {
        generic.add(m[0]);
      }
    }
  }
  const afterReceiver = receiver
    ? signature.slice(receiver[0].length)
    : signature.replace(/^func\s*/, "");
  // Strip the declared name — only when a param list (or generic clause)
  // follows it: in a bare `func(x Tile) LodBand` literal the receiver regex
  // consumed the params, afterReceiver starts at the RETURN type, and an
  // unguarded strip would eat it.
  const rest = afterReceiver.replace(/^\s*[A-Za-z_]\w*(?=\s*[([])/, "");
  const scan = (receiver ? `${receiver[1]} ` : "") + rest;
  // The reader gets GO's stop set, not its Rust default: `Result` and `Cow` are
  // ordinary Go type names, and inheriting Rust's prelude drops them before the
  // filter below ever runs.
  return typesNamedIn(scan, undefined, undefined, GO_STD_TYPE_NAMES).filter(
    (t) => !generic.has(t) && !/^[A-Z]$/.test(t),
  );
}

/**
 * The Go whole-block site detector — the Rust detector's shape with `func`
 * for `fn` and Go's types-in-play. The same backward brace scan carries the
 * safety: a control-flow header (`if x {`), a composite literal (`Foo{`), or
 * any brace inside an enclosing function leaves the enclosing function's own
 * `{` between the last `\bfunc\b` and the cursor's brace, so the clean-header
 * check rejects it without naming a single Go keyword. gofmt means every
 * real fixture is tab-indented; the signature is whitespace-normalized to
 * one line (Go headers wrap long param lists).
 */
export function goWholeBlockSite(prefix: string): WholeBlockSite | undefined {
  let depth = 0;
  let openIdx = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === "}") {
      depth++;
    } else if (c === "{") {
      if (depth === 0) {
        openIdx = i;
        break;
      }
      depth--;
    }
  }
  if (openIdx < 0) {
    return undefined; // no enclosing block
  }
  if (/\S/.test(prefix.slice(openIdx + 1))) {
    return undefined; // non-empty body: mid-expression, not a whole-block site
  }
  const before = prefix.slice(0, openIdx);
  // The header start. A Go header can CONTAIN `func` (function-typed params:
  // `func (s *Stripe) Each(fn func(Tile) error) {` — core idiom), so taking
  // the LAST match truncates the header and drops the receiver type from the
  // injection (review F20). Take the LEFTMOST brace-free candidate that
  // starts its line (gofmt puts every decl/method `func` at column 0 — a
  // `func` inside a doc comment or string sits mid-line and never wins);
  // fall back to the LAST brace-free candidate so closure literals
  // (`f := func(t Tile) uint32 {`) keep firing.
  let lineStartIdx = -1;
  let lastBraceFree = -1;
  for (const m of before.matchAll(/\bfunc\b/g)) {
    const i = m.index ?? -1;
    if (/[{}]/.test(before.slice(i))) {
      continue; // an inner block sits between this candidate and the brace
    }
    if (lineStartIdx < 0 && (i === 0 || before[i - 1] === "\n")) {
      lineStartIdx = i;
    }
    lastBraceFree = i;
  }
  const funcIdx = lineStartIdx >= 0 ? lineStartIdx : lastBraceFree;
  if (funcIdx < 0) {
    return undefined; // no enclosing func (type decls, top-level braces)
  }
  const header = before.slice(funcIdx);
  if (!header.includes("(") || !header.includes(")")) {
    return undefined; // not a clean func header directly opening this brace
  }
  const signature = header.replace(/\s+/g, " ").trim();
  const types = goTypesInPlay(signature);
  if (types.length === 0) {
    return undefined; // a header naming no user type is not a whole-block site
  }
  return { signature, types };
}

/** The site-detector registry the FIM provider dispatches on: each language's
 *  own detector, no cross-language keyword heuristics. undefined keeps the
 *  whole-block gesture dark for languages without one. */
export function wholeBlockSiteFor(
  languageId: string,
): ((prefix: string) => WholeBlockSite | undefined) | undefined {
  if (languageId === "rust") {
    return wholeBlockSite;
  }
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return tsWholeBlockSite;
  }
  if (languageId === "csharp") {
    return csWholeBlockSite;
  }
  if (languageId === "python") {
    return pyWholeBlockSite;
  }
  if (languageId === "go") {
    return goWholeBlockSite;
  }
  return undefined;
}

/** A SAFE anchor for a type in a document's text: prefers a `use` import line (the
 *  persona's imported-type case, precise), else the first NON-COMMENT occurrence
 *  of the bare type name. NEVER a comment/string occurrence — a bare
 *  first-in-file scan lands in a header comment and definition() resolves
 *  nothing, or on a shadowing same-named type.
 *  undefined when the type is not referenced in real code. Pure/testable; the
 *  vscode caller adds the uri and drives definition() from here. */
export function findTypeAnchorInText(
  text: string,
  type: string,
): { line: number; character: number } | undefined {
  if (type.length === 0) {
    return undefined;
  }
  const lines = text.split("\n");
  const word = new RegExp(`\\b${type}\\b`);
  const useLine = /^(?:pub\s*(?:\([^)]*\))?\s+)?use\s/;
  for (let i = 0; i < lines.length; i++) {
    if (useLine.test(lines[i].trim())) {
      const m = word.exec(lines[i]);
      if (m) {
        return { line: i, character: m.index };
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("//")) {
      continue;
    }
    const m = word.exec(lines[i]);
    if (m) {
      return { line: i, character: m.index };
    }
  }
  return undefined;
}

/** The Python type anchor: prefers a `import X` / `from X import Y`
 *  line (the persona's imported-type case, precise), else the first NON-COMMENT
 *  occurrence of the bare type name; NEVER a `#`-comment occurrence, where
 *  definition() resolves nothing. The Python sibling of findTypeAnchorInText
 *  (Rust `use`-shaped + `//`-comment-shaped). */
export function pyFindTypeAnchorInText(
  text: string,
  type: string,
): { line: number; character: number } | undefined {
  if (type.length === 0) {
    return undefined;
  }
  const lines = text.split("\n");
  const word = new RegExp(`\\b${type}\\b`);
  const importLine = /^(?:from\s+\S+\s+import\b|import\s)/;
  for (let i = 0; i < lines.length; i++) {
    if (importLine.test(lines[i].trim())) {
      const m = word.exec(lines[i]);
      if (m) {
        return { line: i, character: m.index };
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("#")) {
      continue;
    }
    const m = word.exec(lines[i]);
    if (m) {
      return { line: i, character: m.index };
    }
  }
  return undefined;
}

/** The Go type anchor: prefers an import line — a bare `import "pkg"` or any
 *  line of an `import ( ... )` block, where the type's PACKAGE path lives —
 *  else the first NON-COMMENT occurrence of the bare type name; NEVER a
 *  `//`-comment occurrence, where definition() resolves nothing. The Go
 *  sibling of findTypeAnchorInText (Rust `use`-shaped) and
 *  pyFindTypeAnchorInText, same two-pass shape; the block flag exists because
 *  a grouped import's lines carry no `import` keyword of their own. */
export function goFindTypeAnchorInText(
  text: string,
  type: string,
): { line: number; character: number } | undefined {
  if (type.length === 0) {
    return undefined;
  }
  const lines = text.split("\n");
  const word = new RegExp(`\\b${type}\\b`);
  // No import-line preference pass, unlike the py/rust siblings: Go import
  // lines name PACKAGES, never types, so that rung can never match a type —
  // and a lowercase type sharing a package path segment would FALSE-anchor
  // on the import, where definition() resolves the package (review F24).
  // The first non-comment occurrence is the whole rule.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("//")) {
      continue;
    }
    const m = word.exec(lines[i]);
    if (m) {
      return { line: i, character: m.index };
    }
  }
  return undefined;
}

/** Render the whole-block injection: a COMMENT block carrying the data-shape of
 *  the types in play — the bounded walkDataShape over `resolveStruct` (struct
 *  defs) plus the root types' method lists. Bounded by `bounds` (the 2-D walk
 *  bound) and `tokenBudget` (aggregate char budget / 4). undefined when nothing
 *  resolves (the honest degrade → plain FIM). The block is inserted before the
 *  cursor line by the caller (injectBeforeCursorLine).
 *
 *  `lineComment` is the token every emitted line carries, so the block lands as
 *  a comment in the buffer it is injected into rather than a syntax error; it
 *  defaults to `//`, keeping every existing call site byte-identical. */
const WHOLE_BLOCK_HEADER = "types in play (use these real names, do not invent):";

/** A type the roots REACH whose members are its whole definition, and which the
 *  def walk cannot emit: an enum. Its variants are the only thing a caller can
 *  write about it, and a def line of `enum Atlas.LodBand` says nothing a model
 *  can type.
 *
 *  This exists because of a live capture from a real dogfood run. At an empty
 *  `RegionLodCount(List<Tile>)` body the block disclosed `Band : LodBand` and
 *  no variant, so the 1.5b could not write
 *  `tile.Band == LodBand.Regional` and invented `tile.IsRegional()` instead.
 *  Same law as the repair leg's: what the model cannot see, it makes up. The
 *  variants were already in the resolved graph; only the render dropped them. */
export interface ReachedMembers {
  type: string;
  lines: readonly string[];
}

export function renderWholeBlockInjection(
  rootTypes: string[],
  resolveStruct: (typeName: string) => StructResolution | undefined,
  methodsOf: (typeName: string) => string[],
  bounds: WalkBounds,
  tokenBudget: number,
  lineComment: string = "//",
  // The reached types whose members must be spelled out. Absent reproduces the
  // pre-v28 block byte for byte, which the frozen whole-block oracles pin.
  reached: readonly ReachedMembers[] = [],
): string | undefined {
  // ONE shared walk state across every per-root walk: `visited` dedups a nested type
  // shared by two roots (emit once across the block). The char budget is DELIBERATELY
  // non-binding at the WALK layer (v22 re-budget): discovery is bounded structurally
  // (N_MAX / D_MAX / B_MAX), and the whole char budget binds at the RENDER pass below
  // (arm C - methods greedy first, defs truncated brace-safe). Seeding the walk with
  // `tokenBudget` instead would drop an OVERSIZED root def inside walkDataShape - before
  // the render could truncate it - which is exactly the "def goes dark whole" regime
  // this session fixes (scout-findings: today's ShardMemCache renders 0 fields). The
  // shared walkDataShape primitive is untouched; only the bound this one caller seeds.
  const shared: SharedWalkState = { visited: new Set<string>(), remainingChars: Number.POSITIVE_INFINITY };
  const walkBounds: WalkBounds = { ...bounds, TOK_MAX: Number.POSITIVE_INFINITY };

  // The deduped, ordered cross-root DEF list (root-first BFS emit order, each type
  // once), and each ROOT's own methods keyed by name. Reading the walk's NAMED defs
  // lets a method attribute to its own type by NAME - via the `TypeName:` anchor the
  // render emits ahead of the def - never by whatever def happens to sit near it.
  const orderedDefs: Array<{ name: string; def: string }> = [];
  const methodsByRoot = new Map<string, string[]>();
  for (const root of rootTypes) {
    const walk = walkDataShape(root, resolveStruct, walkBounds, shared);
    for (const d of walk.defs) {
      orderedDefs.push(d);
    }
    // The ROOT type's methods only (nested reachable types contribute DEFS via the
    // walk, not methods). The char budget binds these at the render pass, not here.
    const sigs = methodsOf(root);
    if (sigs.length > 0) {
      methodsByRoot.set(root, [...(methodsByRoot.get(root) ?? []), ...sigs]);
    }
  }

  // A reached type the roots do not own, but whose members the roots' own
  // signatures point straight at. Deduped against the roots so a type that is
  // both never renders twice.
  const reachedToRender = reached.filter(
    (r) => r.lines.length > 0 && !rootTypes.includes(r.type),
  );

  // Nothing resolved across all roots (no defs AND no methods): honest degrade.
  if (orderedDefs.length === 0 && methodsByRoot.size === 0 && reachedToRender.length === 0) {
    return undefined;
  }

  // ---- Render (arm C). The block, top (furthest from the cursor) to bottom (adjacent
  // to the cursor line): HEADER; METHODS FIRST grouped by owning type under a
  // `TypeName:` anchor (each method line tail-drops); DEFS LAST, each brace-safe-
  // truncated so a def bigger than the budget contributes its fields instead of
  // vanishing whole; a TERMINATOR line that ENDS the list, so the model writes code
  // rather than continuing the comment block (scout: the single largest lever - 100%
  // -> 0% comment-lead at the pathological sites).
  const renderedLen = (l: string) => (l.length > 0 ? lineComment.length + 1 + l.length : lineComment.length);
  const TERMINATOR = "end of type info - the body follows:";
  // Reserve the terminator up front so it always lands adjacent to the cursor line;
  // the surface competes only for what remains.
  const budget = tokenBudget - (renderedLen(TERMINATOR) + 1);

  const out: string[] = [WHOLE_BLOCK_HEADER];
  let total = renderedLen(WHOLE_BLOCK_HEADER); // the header carries no leading newline

  // A CLOSED set is reserved ahead of the roots' open member lists, the way the
  // terminator is, so a long open list cannot starve it. Order is untouched: the
  // roots still render first, because what sits nearest the cursor is what the
  // model reaches for (docs/architecture/surface-injection.md, "Member
  // ordering"), and the reservation
  // decides only what SURVIVES a tight budget, not what comes first.
  //
  // The reservation holds only while the closed set is the SMALL thing this rule
  // assumes it is. An enum wider than the roots' own surface is not a cheap
  // decisive addendum any more, so it competes for the tail like anything else
  // rather than pushing the roots out of their own block.
  const sectionCost = (anchor: string, lines: readonly string[]): number =>
    renderedLen(`${anchor}:`) + 1 + lines.reduce((c, l) => c + renderedLen(l) + 1, 0);
  const reachedCost = reachedToRender.reduce((c, r) => c + sectionCost(r.type, r.lines), 0);
  const rootCost = rootTypes.reduce((c, r) => c + sectionCost(r, methodsByRoot.get(r) ?? []), 0);
  let reserved = reachedCost <= rootCost ? reachedCost : 0;

  const fits = (cost: number) => total + cost + reserved <= budget;
  const push = (l: string) => {
    total += renderedLen(l) + 1; // + the newline joining this line to the previous
    out.push(l);
  };

  // 1. METHODS FIRST, each root's own under a `Name:` anchor. A method line tail-drops
  //    individually; a root whose anchor will not fit is skipped (budget only shrinks).
  for (const root of rootTypes) {
    const sigs = methodsByRoot.get(root);
    if (sigs === undefined || sigs.length === 0) {
      continue;
    }
    const anchor = `${root}:`;
    if (!fits(renderedLen(anchor) + 1)) {
      continue;
    }
    push(anchor);
    for (const sig of sigs) {
      if (!fits(renderedLen(sig) + 1)) {
        break;
      }
      push(sig);
    }
  }

  // 2. THE REACHED TYPES the roots point at, under the same `Name:` anchor. An
  //    enum's variants are its whole surface and a closed one, so a list cut by
  //    the budget is a lie about a closed set under a header that says "do not
  //    invent": the cut says how many it dropped, the way the member block's
  //    truncation already does.
  // The reservation is released here: it existed to hold this room open while
  // the roots rendered, and holding it against the sections it was reserved FOR
  // would leave the room unusable by anyone.
  reserved = 0;
  for (const { type, lines } of reachedToRender) {
    const anchor = `${type}:`;
    if (!fits(renderedLen(anchor) + 1)) {
      continue;
    }
    push(anchor);
    // The WORST-CASE marker is reserved at every step, the way
    // renderDefsWithinBudget reserves its own marker below: a marker that only
    // fits when the budget happens to allow it is a marker that goes missing
    // exactly when it is needed, and a silently cut closed set under a "do not
    // invent" header tells the model the missing values do not exist.
    const markerReserve = renderedLen(`... and ${lines.length} more`) + 1;
    let kept = 0;
    for (const line of lines) {
      if (!fits(renderedLen(line) + 1 + markerReserve)) {
        break;
      }
      push(line);
      kept++;
    }
    if (kept < lines.length) {
      push(`... and ${lines.length - kept} more`);
    }
  }

  // 3. DEFS LAST, adjacent to the cursor, in root-first walk order. `reserved`
  // is always 0 here (released at the top of section 2, above, and never
  // reassigned since), so `fits`'s `total` alone is the budget floor
  // `renderDefsWithinBudget` needs - same brace-safe truncation this file
  // introduced in v22, extracted in v40 so fn-gen's shapeBlock/tsShapeBlock
  // (src/vscode/fnGen.ts) can reuse it against a different budget shape
  // instead of re-deriving the algorithm.
  const defsResult = renderDefsWithinBudget(orderedDefs, budget, (l) => renderedLen(l) + 1, total);
  out.push(...defsResult.lines);
  total = defsResult.total;

  // Only the header fit (no real surface): honest degrade to plain FIM.
  if (out.length <= 1) {
    return undefined;
  }

  // The terminator, reserved above, always fits and lands adjacent to the cursor.
  push(TERMINATOR);

  // Every line a comment (the base model reads the FIM prefix comments).
  return out.map((l) => (l.length > 0 ? `${lineComment} ${l}` : lineComment)).join("\n");
}

/** A per-file-version cache of a resolved injection block: the struct graph
 *  changes only on edit, so a fire with an unchanged (uri, version) is a Map hit
 *  (sub-ms → wins the 50ms race). A version bump invalidates. Keeps FIM warm fires
 *  fast without re-hitting rust-analyzer per keystroke. */
export interface FileVersionInjectionCache {
  /** The cached block for (uri, version), or undefined on a miss / stale version. */
  get(uri: string, version: number): string | undefined;
  /** Cache the resolved block for (uri, version); drops any older-version entry. */
  set(uri: string, version: number, block: string): void;
  /** Cross-file staleness eviction: an edit in `uri` cannot stale its OWN
   *  entry (the version key owns that), but every other file's cached block
   *  may name surface the edit just changed - drop them. */
  retainOnly(uri: string): void;
}

export function createInjectionCache(): FileVersionInjectionCache {
  // One entry per uri: a version bump replaces it, so a stale (uri, version) is a
  // miss and the old block is dropped. Bounded by the open-file count, not edits.
  const store = new Map<string, { version: number; block: string }>();
  return {
    get(uri: string, version: number): string | undefined {
      const entry = store.get(uri);
      return entry !== undefined && entry.version === version ? entry.block : undefined;
    },
    set(uri: string, version: number, block: string): void {
      store.set(uri, { version, block });
    },
    retainOnly(uri: string): void {
      for (const key of store.keys()) {
        if (key !== uri) {
          store.delete(key);
        }
      }
    },
  };
}
