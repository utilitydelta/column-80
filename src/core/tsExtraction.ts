/**
 * TS-shaped pure extraction helpers, the TypeScript siblings of extraction.ts's
 * Rust-specific parsers (parseHover, renderMemberSignature, ...). They live in
 * their own module because the Rust helpers are pinned by blind suites and must
 * not grow language branches; both TS transports (tsLsExtractor, tsExtractor)
 * render through these so the two produce identical member shapes.
 *
 * TS carries no trait provenance, so no member built here ever sets viaTrait;
 * and the injection payload for TS is signatures-only (a locked scope
 * decision), so no helper here ever produces an example.
 */

import { CompletionMember, HoverSurface, MemberKind, SymbolMemberBuilder, SymbolRole } from "./extraction";
import { dedentToZeroBase, replyBaseIndent, withoutBase } from "./reindent";
import type { DerivedType } from "./crossFileShape";

/** The four language ids the TS server serves. THE one id set every TS gesture
 *  gate dispatches on (registry, resolver hooks, site detector, doc scanner) -
 *  one set, not four drifting copies. */
export const TS_LANGUAGE_IDS = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);

/** Slice a member's own declaration out of a quickinfo/detail display:
 *  `(method) ThemeStore.setTheme(theme: string): void` -> `setTheme(theme: string): void`,
 *  `(property) ThemeStore.isDark: boolean` -> `isDark: boolean`,
 *  `function sum(a: number, b: number): number` -> `sum(a: number, b: number): number`.
 *  The name must be followed by `(`/`<`/`:`/`?` so a same-named receiver in the
 *  qualifier (`theme.theme: string`) cannot win the slice. A display that never
 *  states the name declaration-style is passed through trimmed: it is the
 *  language service's real text, never an invention. undefined only when there
 *  is no display at all (an unresolved detail; the member is then rendered
 *  signature-less and dropped downstream). */
export function renderTsMemberSignature(name: string, display: string | undefined): string | undefined {
  if (display === undefined) {
    return undefined;
  }
  // The leading `(method) ` / `(property) ` annotation and the trailing
  // `(+1 overload)` count are quickinfo chrome, not part of the signature the
  // prompt should carry. The count is the worse of the two: it sits where an
  // argument list ends, so a model imitating the line can read it as syntax.
  const chrome = display
    .trim()
    .replace(/^\([a-z][a-z ]*\)\s*/, "")
    .replace(/\s*\(\+\s*\d+\s+[a-z ]*overloads?\)$/, "")
    .trim();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declared = new RegExp(`(?:^|[.\\s])(${escaped}\\s*[(<:?][\\s\\S]*)$`).exec(chrome);
  if (declared) {
    return callShapedProperty(name, declared[1].trim());
  }
  // tsserver states a constructor as `constructor Tile(mortonCode: number,
  // lod: number): Tile` — the name is followed by the TYPE, so the declared
  // slice above cannot match it. Captured from a real editor. Anchored here
  // rather than left to the passthrough below, which would accept any display
  // at all under the block's "how to build a Tile" header.
  if (name === "constructor") {
    return /^constructor\s+[A-Za-z_$][\w$]*\s*[(<]/.test(chrome) ? chrome : undefined;
  }
  return chrome.length > 0 ? chrome : undefined;
}

/** A function-TYPED property (`toggle: () => void` - the MobX arrow-action
 *  idiom) rewrites to call shape (`toggle(): void`): the injected line then
 *  matches what a completion will actually type, and arity reads as arity.
 *  Dogfood capture: a FIM model given `toggle: () => void` still invented
 *  `toggle("dark")`; given the call shape the parentheses ARE the signature.
 *  Optional properties come in BOTH real displays: non-strict projects print
 *  the bare arrow (`onPick?: (index: number) => void`), strict projects (the
 *  overwhelming default) print the union
 *  (`onPick?: ((index: number) => void) | undefined`) - the `?` head already
 *  carries the undefined, so that exact wrapper is stripped and the one
 *  function inside call-shapes to `onPick?(index: number): void`.
 *  Data properties keep `name: Type`; anything else that does not parse as
 *  one top-level `(params) => ret` stays exactly as the service printed it
 *  (other unions, generic arrows, string-literal types carrying parens, and
 *  every odd shape degrade to the honest verbatim form). */
function callShapedProperty(name: string, sliced: string): string {
  const head = sliced.startsWith(`${name}?:`)
    ? `${name}?`
    : sliced.startsWith(`${name}:`)
      ? name
      : undefined;
  if (head === undefined) {
    return sliced;
  }
  let rhs = sliced.slice(head.length + 1).trim();
  if (head.endsWith("?")) {
    const inner = unwrapOptionalUndefined(rhs);
    if (inner !== undefined) {
      rhs = inner;
    }
  }
  if (!rhs.startsWith("(")) {
    return sliced;
  }
  const close = balancedParen(rhs);
  if (close === undefined) {
    return sliced;
  }
  const after = rhs.slice(close + 1).trimStart();
  if (!after.startsWith("=>")) {
    return sliced;
  }
  const ret = after.slice(2).trim();
  return ret === "" ? sliced : `${head}${rhs.slice(0, close + 1)}: ${ret}`;
}

/** `((params) => ret) | undefined` -> `(params) => ret`; undefined when the
 *  rhs is not exactly one parenthesized group followed by `| undefined` (an
 *  optional property under strict wraps ONLY the function this way; any other
 *  union stays for the caller to pass through verbatim). */
function unwrapOptionalUndefined(rhs: string): string | undefined {
  if (!rhs.startsWith("(")) {
    return undefined;
  }
  const close = balancedParen(rhs);
  if (close === undefined || rhs.slice(close + 1).trim() !== "| undefined") {
    return undefined;
  }
  return rhs.slice(1, close).trim();
}

/** Index of the paren balancing rhs[0]. Quote-aware: a string/template
 *  literal type is skipped opaquely (its `|`s and arrows are text), and a
 *  literal CONTAINING a paren aborts the walk (undefined) - a naive depth
 *  count would balance inside the literal and fabricate a signature that
 *  never existed (the `") => x"` poison). Unterminated literals and
 *  unbalanced parens also abort. */
function balancedParen(rhs: string): number | undefined {
  let depth = 0;
  for (let i = 0; i < rhs.length; i++) {
    const c = rhs[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < rhs.length; i++) {
        const q = rhs[i];
        if (q === "\\") {
          i++;
          continue;
        }
        if (q === "(" || q === ")") {
          return undefined;
        }
        if (q === c) {
          break;
        }
      }
      if (i >= rhs.length) {
        return undefined;
      }
      continue;
    }
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return undefined;
}

/** Build a TS CompletionMember from a name + display text + mapped kind. Unlike
 *  the Rust toCompletionMember, signatures are rendered for EVERY kind: a typed
 *  property's `name: Type` is contract for TS (the structural-typing payload),
 *  where Rust deliberately withholds field signatures (the fn-pointer guard does
 *  not apply - TS quickinfo states a property AS a property). */
export function toTsCompletionMember(
  name: string,
  display: string | undefined,
  kind: MemberKind,
): CompletionMember {
  const member: CompletionMember = { name, kind };
  const signature = renderTsMemberSignature(name, display);
  if (signature !== undefined) {
    member.signature = signature;
  }
  return member;
}

/** tsserver names an accessor's documentSymbol node `(get) band` / `(set) band`.
 *  That is an outline label, not the member's name: no hover, completion or
 *  source text spells it that way, so the name-anchored slice in
 *  renderTsMemberSignature searches the quickinfo for a string it cannot
 *  contain, misses, and the member is left carrying either nothing or the whole
 *  quickinfo. Completion labels never carry the prefix, which is why the strip
 *  lives in the documentSymbol builder rather than in toTsCompletionMember. */
const TS_ACCESSOR_CHROME = /^\((?:get|set)\)\s*/;

/** The SymbolMemberBuilder for the TypeScript documentSymbol descent. */
export const tsSymbolMember: SymbolMemberBuilder = (name, detail, kind) =>
  toTsCompletionMember(name.replace(TS_ACCESSOR_CHROME, ""), detail, kind);

/** Map a language-service ScriptElementKind (string enum) to a MemberKind, or
 *  undefined for an entry that is never a member and must be dropped:
 *  - "warning" is the loose inferred suggestion the service emits at an `any`
 *    receiver (every identifier in the file). Dropping it is what keeps the
 *    untyped-JS darkness pin honest ([] instead of fabricated members) while a
 *    JSDoc-typed receiver in the same project keeps its real method/property
 *    entries (verified against typescript 5.9).
 *  - "keyword" is syntax, not API surface. */
export function tsElementMemberKind(kind: string): MemberKind | undefined {
  switch (kind) {
    case "warning":
    case "keyword":
      return undefined;
    case "method":
      return "method";
    case "property":
    case "getter":
    case "setter":
      return "field";
    case "function":
    case "local function":
      return "function";
    default:
      return "other";
  }
}

/** Map a vscode CompletionItemKind (0-indexed enum; NOT the LSP wire enum, and
 *  NOT the Rust transport's table - TS surfaces properties as Property=9 where
 *  rust-analyzer uses Field=4) to a MemberKind. Text/Keyword/Snippet are never
 *  members; everything unmapped is "other". */
export function tsVscodeMemberKind(kind: unknown): MemberKind | undefined {
  if (typeof kind !== "number") {
    return "other";
  }
  switch (kind) {
    case 0: // Text
    case 13: // Keyword
    case 14: // Snippet
      return undefined;
    case 1: // Method
      return "method";
    case 2: // Function
      return "function";
    case 4: // Field
    case 9: // Property
      return "field";
    default:
      return "other";
  }
}

/** vscode SymbolKind (0-indexed) -> the documentSymbol role membersOfType needs,
 *  the TS sibling of raExtractor's vscodeSymbolRole: TS types are Class=4,
 *  Enum=9, Interface=10 (Rust's containers are Struct=22/Enum=9). A getter
 *  surfaces as a Property symbol, so it lands on "field". */
export function tsVscodeSymbolRole(kind: unknown): SymbolRole {
  switch (kind) {
    case 4: // Class
    case 9: // Enum
    case 10: // Interface
      return "container";
    case 5: // Method
      return "method";
    case 11: // Function
      return "function";
    case 6: // Property
    case 7: // Field
      return "field";
    default:
      return "other";
  }
}

// Fence tags the TS hover's quickinfo block may carry. The signature block is
// always the FIRST such fence; anything after it is documentation prose.
const TS_FENCE_LANGS = new Set(["typescript", "tsx", "ts", "javascript", "jsx", ""]);

/** Parse a vscode TS hover's markdown into a HoverSurface: the first
 *  ```typescript fence body is the signature VERBATIM (the quickinfo display
 *  text), the prose below the fence is doc, example is never set
 *  (signatures-only). undefined when there is no quickinfo fence at all - an
 *  empty or prose-only hover degrades to no surface, never a guess. */
export function parseTsHover(markdown: string): HoverSurface | undefined {
  const lines = markdown.split("\n");
  let signature: string | undefined;
  const prose: string[] = [];
  let inFence = false;
  let fenceIsSignature = false;
  const body: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      if (!inFence) {
        inFence = true;
        fenceIsSignature = signature === undefined && TS_FENCE_LANGS.has(trimmed.slice(3).trim().toLowerCase());
        body.length = 0;
      } else {
        inFence = false;
        if (fenceIsSignature) {
          const text = body.join("\n").trim();
          if (text.length > 0) {
            signature = text;
          }
        }
      }
      continue;
    }
    if (inFence) {
      body.push(line);
    } else if (signature !== undefined) {
      prose.push(line);
    }
  }
  if (signature === undefined) {
    return undefined;
  }
  const surface: HoverSurface = { signature };
  const doc = prose.join("\n").trim();
  if (doc.length > 0) {
    surface.doc = doc;
  }
  return surface;
}

/** TS/JS library and utility type names that are never a user shape to walk
 *  into: resolving them crosses into lib.d.ts and yields noise, the same stop
 *  class as Rust's STD_TYPE_NAMES. Primitives (string, number, boolean) are
 *  lower-case and already excluded by the PascalCase candidate scan. */
export const TS_STD_TYPE_NAMES = new Set([
  "Array", "ReadonlyArray", "Promise", "PromiseLike", "Map", "Set", "WeakMap", "WeakSet",
  "Record", "Partial", "Required", "Readonly", "Pick", "Omit", "Exclude", "Extract",
  "NonNullable", "Parameters", "ReturnType", "InstanceType", "ThisType", "Awaited",
  "Iterable", "Iterator", "AsyncIterable", "AsyncIterator", "Generator", "AsyncGenerator",
  "Date", "RegExp", "Error", "TypeError", "RangeError", "Object", "Function", "Boolean",
  "Number", "String", "Symbol", "BigInt", "JSON", "Math", "ArrayBuffer", "SharedArrayBuffer",
  "DataView", "Uint8Array", "Uint8ClampedArray", "Int8Array", "Uint16Array", "Int16Array",
  "Uint32Array", "Int32Array", "Float32Array", "Float64Array", "BigInt64Array",
  "BigUint64Array", "URL", "URLSearchParams", "Buffer",
]);

// Split an object-type body on top-level member separators. TS members separate
// on `;`, `,`, or a bare newline; a nested type's own separators (`{ a: string;
// b: number }`, `Map<string, number>`) stay inside their bracket depth.
function splitTsMembers(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "<" || c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ">" || c === ")" || c === "]" || c === "}") {
      depth--;
    } else if ((c === ";" || c === "," || c === "\n") && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

// The body of the brace group opening at `open`, matched by brace depth (never
// lastIndexOf: a later arm's `}` is not this group's close). With requireSole,
// anything but whitespace after the close refuses the group - a `{...}` that a
// top-level `|`, `&`, `extends`, or `?` continues past is one operand of a
// larger type, not the type's own field set.
function tsBraceBody(text: string, open: number, requireSole: boolean): string | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        if (requireSole && text.slice(i + 1).trim().length > 0) {
          return undefined;
        }
        return text.slice(open + 1, i);
      }
    }
  }
  return undefined;
}

/** Locate the object-type body a hover display actually DECLARES, or undefined
 *  when it declares none. The first `{` in a quickinfo display is frequently
 *  not the body: a default generic param (`<T = { x }>`),
 *  a conditional's `extends {...}` clause, a union arm, a function alias's
 *  braced return. Same reasoning class as tsSignatureFromSpanText: walk at
 *  bracket depth (`<([{`), read `=>` as one token so its `>` closes no generic
 *  clause. An alias's body is the RHS of its top-level `=`, and only when that
 *  RHS is exactly one object literal; any other display takes its first
 *  top-level brace group (an `extends`/generic-clause `{` sits at depth > 0
 *  and never wins). */
function tsHoverObjectBody(signature: string): string | undefined {
  const isAlias = /^\s*(?:export\s+)?(?:declare\s+)?type\b/.test(signature);
  let depth = 0;
  for (let i = 0; i < signature.length; i++) {
    const c = signature[i];
    if (c === "=" && signature[i + 1] === ">") {
      i++;
      continue;
    }
    if (c === "=" && depth === 0 && isAlias) {
      const rhs = signature.slice(i + 1);
      const open = rhs.search(/\S/);
      if (open < 0 || rhs[open] !== "{") {
        return undefined; // conditional, function, union-of-names, bare name: no own body
      }
      return tsBraceBody(rhs, open, true);
    }
    if (c === "<" || c === "(" || c === "[" || c === "{") {
      if (c === "{" && depth === 0 && !isAlias) {
        return tsBraceBody(signature, i, false);
      }
      depth++;
    } else if (c === ">" || c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  return undefined;
}

/** Parse a TS quickinfo signature into its named fields, each `{ name,
 *  typeName }` with the type AS WRITTEN - the TS sibling of the Rust
 *  parseStructHoverFields. Reads the `{...}` body of an object type alias
 *  (`type X = { a: string; b: B }`) or a braced interface/class display,
 *  located by tsHoverObjectBody (never the naive first-`{`/last-`}` span);
 *  a bodyless hover (`interface Order`, `class ThemeStore`, `enum Color`)
 *  and a display whose type is not one object literal (conditional, union,
 *  function alias) yield [] - fields then come from membersOfType, never a
 *  guess. Methods (`name(args): R`) and index signatures are not field edges
 *  and are skipped. */
export function parseTsHoverFields(signature: string | undefined): Array<{ name: string; typeName: string }> {
  if (!signature) {
    return [];
  }
  const body = tsHoverObjectBody(signature);
  if (body === undefined) {
    return [];
  }
  const fields: Array<{ name: string; typeName: string }> = [];
  for (const part of splitTsMembers(body)) {
    const t = part.trim();
    if (t.length === 0) {
      continue;
    }
    const m = /^(?:(?:public|protected|private)\s+)?(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:\s*([\s\S]+)$/.exec(t);
    if (m) {
      fields.push({ name: m[1], typeName: m[2].trim() });
    }
  }
  return fields;
}

// The index of the closing delimiter of the quoted run that OPENS at `open`
// (`"`, `'` or a template backtick), or the end of the text when it never
// closes. Backslash escapes are consumed, so `"a\"b"` is one run.
function tsSkipQuoted(text: string, open: number): number {
  const quote = text[open];
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === quote) {
      return i;
    }
  }
  return text.length;
}

// The RHS of a type-alias hover display (`type Id = string` -> `string`), or
// undefined when the display is not an alias or has no top-level `=`. Its own
// bracket walk rather than a share of tsHoverObjectBody's: that one is the
// frozen field leg, and this question is asked precisely of the displays it
// answers undefined for. `=>` reads as one token so a function alias's arrow is
// not mistaken for the alias's `=`, and a generic parameter default
// (`type A<T = string> = ...`) sits at depth > 0 and never wins.
function tsAliasRhs(signature: string): string | undefined {
  if (!/^\s*(?:export\s+)?(?:declare\s+)?type\b/.test(signature)) {
    return undefined;
  }
  let depth = 0;
  for (let i = 0; i < signature.length; i++) {
    const c = signature[i];
    if (c === "=" && signature[i + 1] === ">") {
      i++;
      continue;
    }
    if (c === "=" && depth === 0) {
      return signature.slice(i + 1).trim();
    }
    if (c === "<" || c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ">" || c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  return undefined;
}

// The top-level `|` arms of a type expression. A quoted run is skipped whole (a
// `|` inside `"a|b"` is data, not a union bar) and a `|` inside a bracket group
// belongs to an inner type.
function tsUnionArms(rhs: string): string[] {
  const arms: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < rhs.length; i++) {
    const c = rhs[i];
    if (c === '"' || c === "'" || c === "`") {
      i = tsSkipQuoted(rhs, i);
    } else if (c === "<" || c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ">" || c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1);
    } else if (c === "|" && depth === 0) {
      arms.push(rhs.slice(start, i));
      start = i + 1;
    }
  }
  arms.push(rhs.slice(start));
  return arms.map((a) => a.trim()).filter((a) => a.length > 0);
}

// The primitive type keywords an alias can resolve to WHOLE. `any` and `object`
// are deliberately absent: neither is a primitive, and what a member walk
// returns for them was never measured here.
const TS_PRIMITIVE_KEYWORDS = new Set([
  "string", "number", "boolean", "bigint", "symbol", "null", "undefined",
  "void", "never", "unknown", "true", "false",
]);

const TS_NUMERIC_LITERAL =
  /^[+-]?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.[\d_]+(?:[eE][+-]?\d+)?)n?$/;

// One union arm that is a primitive: a keyword, a numeric/bigint literal, or a
// single quoted or template-literal run. Anything else — a name, an object
// literal, an array, a function, an intersection, a parenthesized group — is not.
function isTsPrimitiveArm(arm: string): boolean {
  if (TS_PRIMITIVE_KEYWORDS.has(arm) || TS_NUMERIC_LITERAL.test(arm)) {
    return true;
  }
  const q = arm[0];
  return (q === '"' || q === "'" || q === "`") && tsSkipQuoted(arm, 0) === arm.length - 1;
}

/** Does this hover display declare a type alias whose every union arm is a
 *  PRIMITIVE (`type SuppressionKind = "bound-unsafe" | "in-comment"`,
 *  `type Id = string`, `type Bits = 1 | 2 | 4`)?
 *
 *  Such a type has no members of its own. A member walk on it resolves the
 *  underlying primitive's prototype and nothing else: `SuppressionKind` returns
 *  57 members, `toString(): string` through `fontcolor(color: string): string`
 *  down to `matchAll`, every one of them `String`'s (session-v37 spike 10). The
 *  def line already carries the whole truth, so the member list is pure cost —
 *  measured at 736 bytes for the first MEMBER_CAP of them, about what a whole
 *  real type is budgeted, for nothing.
 *
 *  Deliberately NOT "an alias with no object body", which is the wider rule and
 *  the wrong one: `type Bar = Baz` has no object body either, and Baz's members
 *  are exactly what the injection exists to carry. A discriminated union of
 *  object types (`{ kind: "shift" } | { kind: "lost" }`) resolves its COMMON
 *  members and keeps them for the same reason. */
export function isPrimitiveAliasHover(signature: string | undefined): boolean {
  if (!signature) {
    return false;
  }
  const rhs = tsAliasRhs(signature);
  if (rhs === undefined) {
    return false;
  }
  const arms = tsUnionArms(rhs);
  return arms.length > 0 && arms.every(isTsPrimitiveArm);
}

const escapeTsRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A cursor on the candidate type token within the parent's OWN declaration of
 *  field `fieldName` - the TS sibling of the Rust fieldTypeCursor. TS members
 *  are not line-anchored (`type X = { a: A; b: B }` packs several per line), so
 *  the field binding is located mid-line (`fieldName?:` after a separator) and
 *  the candidate token taken after its colon. Anchoring at the field's own type
 *  token is what keeps a same-named shadowing type out of the recursive hop.
 *  undefined when the field or the token is not locatable (a stop edge). */
export function tsFieldTypeCursor(
  lines: string[],
  range: { open: number; close: number },
  fieldName: string,
  candType: string,
): { line: number; character: number } | undefined {
  const fieldRe = new RegExp(`(?:^|[{;,\\s])(?:readonly\\s+)?${escapeTsRe(fieldName)}\\s*\\??\\s*:`);
  const candRe = new RegExp(`\\b${escapeTsRe(candType)}\\b`);
  for (let i = range.open; i <= range.close; i++) {
    const line = lines[i];
    const fm = fieldRe.exec(line);
    if (!fm) {
      continue;
    }
    const colon = line.indexOf(":", fm.index + fm[0].length - 1);
    const searchFrom = colon >= 0 ? colon + 1 : fm.index + fm[0].length;
    const cm = candRe.exec(line.slice(searchFrom));
    if (cm) {
      return { line: i, character: searchFrom + cm.index };
    }
    return undefined; // field found but candidate not on its line - stop edge
  }
  return undefined;
}

/** Render one derived type's def in TS syntax - the TS sibling of the Rust
 *  renderDerivedDef. Prefers the raw quickinfo signature verbatim; synthesizes
 *  an `interface X { ... }` only when hover did not resolve. A signature-less
 *  field renders name-only - honest, never an invented type. */
export function tsRenderDerivedDef(t: DerivedType): string {
  if (t.signature.length > 0) {
    return t.signature;
  }
  const fields = t.fields
    .map((f) => (f.typeName.length > 0 ? `  ${f.name}: ${f.typeName};` : `  ${f.name};`))
    .join("\n");
  return `interface ${t.name} {\n${fields}\n}`;
}

/** The type-shaped identifiers brought into scope by `import` statements, in
 *  first-seen order, TS library names excluded - the TS sibling of the Rust
 *  typesFromUses. Reads only the import CLAUSE (before `from`), so a PascalCase
 *  module path never over-captures. Multi-line clauses are accumulated until
 *  the statement's `from`/`;`. */
export function tsTypesFromImports(source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*import\b/.test(lines[i])) {
      continue;
    }
    let stmt = lines[i];
    let j = i;
    while (!/\bfrom\b/.test(stmt) && !stmt.includes(";") && j + 1 < lines.length) {
      j++;
      stmt += " " + lines[j];
    }
    i = j;
    const clause = stmt.split(/\bfrom\b/)[0];
    for (const m of clause.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
      const name = m[1];
      if (TS_STD_TYPE_NAMES.has(name) || seen.has(name)) {
        continue;
      }
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** The interface/class/enum/type-alias definitions at module scope (column 0),
 *  name -> the cursor at the type name - the TS sibling of fnGen's Rust
 *  localTypeDefinitions. The anchor lets a doc-only same-file type resolve at
 *  its OWN definition site. Comment lines and indented (nested) declarations
 *  never anchor. */
export function tsLocalTypeDefinitions(source: string): Map<string, { line: number; character: number }> {
  const defs = new Map<string, { line: number; character: number }>();
  const lines = source.split("\n");
  const decl =
    /^(?:export\s+)?(?:declare\s+)?(?:(?:abstract\s+)?class|interface|(?:const\s+)?enum)\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[<=]/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "" || /^\s/.test(line) || /^\/[/*]/.test(line)) {
      continue; // module scope only, never a comment line
    }
    const m = decl.exec(line);
    const name = m?.[1] ?? m?.[2];
    if (m && name !== undefined && !defs.has(name)) {
      defs.set(name, { line: i, character: line.indexOf(name) });
    }
  }
  return defs;
}

/** The doc comment immediately above a declaration head - the TS doc channel.
 *  Real TS document symbols EXCLUDE doc lines from the symbol
 *  range (rust-analyzer includes them), so the range-based trivia slice comes up
 *  empty on TS documents; this scans upward from the head instead. Recognizes a
 *  JSDoc/plain block comment and a contiguous `//` run ending on the
 *  line directly above the head - a blank line or a code line breaks the scan
 *  (the doc must be IMMEDIATELY above, and a trailing block comment on a code
 *  line is not a doc). undefined when there is none. */
export function tsDocCommentAbove(
  getLine: (line: number) => string,
  headLine: number,
): string | undefined {
  const end = headLine - 1;
  if (end < 0) {
    return undefined;
  }
  const endTrim = getLine(end).trim();
  const collect = (start: number): string => {
    const lines: string[] = [];
    for (let i = start; i <= end; i++) {
      lines.push(getLine(i));
    }
    return lines.join("\n").replace(/\s+$/, "");
  };
  if (endTrim.endsWith("*/")) {
    for (let start = end; start >= 0; start--) {
      const t = getLine(start).trim();
      if (t.startsWith("/*")) {
        return collect(start);
      }
      if (!/^[/*]/.test(t)) {
        return undefined; // a non-comment line inside the walk: not a doc block
      }
    }
    return undefined;
  }
  if (endTrim.startsWith("//")) {
    let start = end;
    while (start - 1 >= 0 && getLine(start - 1).trim().startsWith("//")) {
      start--;
    }
    // A run consisting ONLY of tool-directive lines (eslint/@ts-/prettier/
    // biome pragmas) is machine configuration, not a doc: the doc channel
    // DIRECTS generation, and a pragma is wrong-surface content in it.
    // A mixed run keeps the whole run.
    let directivesOnly = true;
    for (let i = start; i <= end && directivesOnly; i++) {
      directivesOnly = TS_TOOL_DIRECTIVE.test(getLine(i).trim());
    }
    if (directivesOnly) {
      return undefined;
    }
    return collect(start);
  }
  return undefined;
}

// The tool-directive `//` line prefixes tsDocCommentAbove refuses as a doc.
// Deliberately narrow (no wider blocklist): eslint-*, @ts-*, prettier-*,
// biome-* pragmas only.
const TS_TOOL_DIRECTIVE = /^\/\/\s*(?:eslint|@ts-|prettier|biome)/;

/** The TS declaration head: span text up to the BODY brace - the TS sibling
 *  of fnGen's frozen signatureFromSpanText (prompt-byte-pinned for Rust,
 *  which cuts at the FIRST `{`). In TS the first `{` is frequently NOT the
 *  body: destructured parameters (`Panel({ title, count }: Props)`), braced
 *  return annotations (`(): { total: number }`), union arms, `extends`
 *  constraints. Tracks paren/bracket/brace depth; a top-level `{` directly
 *  after `:`, `|`, `&`, or `extends` opens a braced TYPE group and is
 *  skipped; any other top-level `{` is the body. Dispatched on
 *  TS_LANGUAGE_IDS at the resolveFunctionAtCursor site. */
export function tsSignatureFromSpanText(spanText: string): string {
  let depth = 0;
  for (let i = 0; i < spanText.length; i++) {
    const c = spanText[i];
    if (c === "(" || c === "[") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1);
    } else if (c === "{") {
      if (depth > 0) {
        depth++;
        continue;
      }
      const head = spanText.slice(0, i).replace(/\s+$/, "");
      // A braced TYPE group, not the body: after :, |, &, extends, and also
      // inside generic argument positions - `Promise<{...}>`, `Record<K, {...}>`,
      // `<T = {...}>` - where the preceding token is <, a comma, or =.
      if (/(?:[:|&,<=]|\bextends)$/.test(head)) {
        depth++;
        continue;
      }
      return head; // the body brace
    }
  }
  // No body brace (a bodyless overload/ambient signature): the first line.
  const newline = spanText.indexOf("\n");
  return (newline === -1 ? spanText : spanText.slice(0, newline)).replace(/\s+$/, "");
}

/** Whether a TS declaration span contains a top-level BODY brace — a real
 *  method/function body `{ ... }` — as opposed to a braced TYPE group (a return
 *  object type, a `<{...}>` generic arg) or a parameter object type. The
 *  companion to tsSignatureFromSpanText using the identical depth-aware,
 *  type-group-skipping scan, but answering the boolean directly: a bodyless
 *  member (interface member, ambient/overload signature, abstract method) has
 *  none. Checking "does a `{` follow the signature string" is NOT equivalent — a
 *  return-type object placed on a continuation line (`foo():\n  { a: number };`)
 *  puts a type-group `{` after the first-line signature fallback and would fool
 *  a string check into reading a body. This scan cannot be fooled that way. */
export function tsHasBodyBrace(spanText: string): boolean {
  let depth = 0;
  for (let i = 0; i < spanText.length; i++) {
    const c = spanText[i];
    if (c === "(" || c === "[") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1);
    } else if (c === "{") {
      if (depth > 0) {
        depth++;
        continue;
      }
      const head = spanText.slice(0, i).replace(/\s+$/, "");
      if (/(?:[:|&,<=]|\bextends)$/.test(head)) {
        depth++;
        continue;
      }
      return true; // the body brace
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Re-indent a generated TS/JS body, the TS sibling of reindentCsBody and
// reindentPyBody. Same seam: the model replies flush-left and every line after
// the header must shift by the header's indent. TS's one cross-line string
// shape is the template literal `` `...` `` (a `` \` `` escapes a backtick); a
// physical line inside one must stay byte-exact or the string value shifts.
// Regular `'...'`/`"..."` strings do not span lines. KNOWN LIMITATION: a `${...}`
// interpolation hole is NOT depth-tracked. For a plain `${x}` this is safe. But a
// backtick INSIDE a hole (a nested template, or a quoted string containing a
// backtick) can mis-toggle the template state across a line boundary, which can
// shift a template-content line — a genuine VALUE change, not merely cosmetic.
// Deferred (session scraps): the trigger is exotic in a generated body, and the
// goal's TS bar is only "the same awareness the Python path carries" (Python has
// no `${}`). A sound fix needs a real interpolation-depth stack.
// ---------------------------------------------------------------------------

interface TsLineScan {
  template: boolean; // inside a `...` template literal spanning lines
  block: boolean; // inside a /* ... */ block comment spanning lines
}

function advanceTsLineScan(line: string, s: TsLineScan): void {
  const n = line.length;
  let i = 0;
  while (i < n) {
    if (s.block) {
      const end = line.indexOf("*/", i);
      if (end < 0) {
        return; // block comment continues to the next line
      }
      s.block = false;
      i = end + 2;
      continue;
    }
    if (s.template) {
      let closed = false;
      while (i < n) {
        if (line[i] === "\\") {
          i += 2;
          continue;
        }
        if (line[i] === "`") {
          s.template = false;
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return; // template literal continues to the next line
      }
      continue;
    }
    const c = line[i];
    const c2 = line[i + 1];
    if (c === "/" && c2 === "/") {
      return; // line comment: the rest of the line is inert
    }
    if (c === "/" && c2 === "*") {
      s.block = true;
      i += 2;
      continue;
    }
    if (c === "`") {
      s.template = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++; // a regular string closes on this line
      while (i < n) {
        if (line[i] === "\\") {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
}

/** Re-indent a generated TS/JS definition so a nested target's body lands at the
 *  right column. Same contract as reindentCsBody: line 1 (the header) is kept,
 *  every later code line gets `indent` prepended, a line inside a template
 *  literal is byte-exact, and `indent === ""` returns the text unchanged. */
export function reindentTsBody(generated: string, indent: string): string {
  if (indent === "") {
    return generated;
  }
  const lines = generated.split("\n");
  const s: TsLineScan = { template: false, block: false };
  // The reply's own base column, off before the target's goes on: see reindent.ts.
  const base = replyBaseIndent(lines);
  const out: string[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (s.template || line.trim() === "") {
      out.push(line);
    } else if (n === 0) {
      out.push(withoutBase(line, base));
    } else {
      out.push(indent + withoutBase(line, base));
    }
    advanceTsLineScan(line, s);
  }
  return out.join("\n");
}

/** Normalise TS/JS code read out of a document to its own column zero, the
 *  inverse of reindentTsBody. A line inside a template literal is byte-exact,
 *  decided by the SAME scan the re-indent leg uses, so the two directions can
 *  never disagree about which bytes are a string's value. */
export function dedentTsBody(code: string, known?: string): string {
  const lines = code.split("\n");
  const s: TsLineScan = { template: false, block: false };
  const byteExact: boolean[] = [];
  for (const line of lines) {
    // The state ENTERING the line, exactly as reindentTsBody reads it: the scan
    // advances only after the line has been classified.
    byteExact.push(s.template);
    advanceTsLineScan(line, s);
  }
  return dedentToZeroBase(lines, byteExact, known).join("\n");
}
