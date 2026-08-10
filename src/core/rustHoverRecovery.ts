/**
 * Restoring what rust-analyzer elided from a type's hover, out of the definition
 * file's own source text.
 *
 * ONE marker, `/* … *\/`, THREE losses, told apart by POSITION:
 *
 *   1. PAYLOAD ELIDED    the marker inside a variant's own delimiters.
 *                          `Constrained( /* … *\/ )`  tuple  (recovered since v37)
 *                          `Leader { /* … *\/ }`      struct (v39)
 *   2. LIST CUT          the marker as a member of its own: everything past
 *                        rust-analyzer's display cap is simply gone. (v39)
 *   3. COLLABORATOR PRUNED  a hidden member names a type, so the walk never
 *                        resolves it. Not this file's job — it falls out of 2,
 *                        because the caller parses field edges off what this
 *                        returns.
 *
 * Why it matters: the product injects the elided text verbatim and then closes the
 * prompt with "Call ONLY methods and constructors of `X` that appear in the API
 * surface above". The prompt shows a list rust-analyzer has itself marked
 * incomplete, and then forbids everything not on it. Measured on the acme
 * corpus (session-v39/goal.md): 324 injected blocks carried a list cut across 63
 * distinct types, and `ServerMeta` hid `compression: CompressionMeta`, so
 * `CompressionMeta` was never resolved at all — the cut prunes the walk's graph,
 * not just one line.
 *
 * No RA setting recovers it (`hover.show.enumVariants: 99` leaves it unchanged,
 * `null` deletes the body outright), and RA's configuration is the user's, not
 * ours: the shipping Rust path reads hovers through `executeHoverProvider`. The
 * definition file is already open in the cross-file walk, so the members are
 * recoverable at source with no new transport.
 *
 * THE BAR: a WRONG member is worse than an absent one, because the model is told a
 * lie in the compiler's voice. Every function here refuses to the input signature
 * the moment it cannot prove the answer, refusal is TOTAL for the type rather than
 * per member, and none of them throws.
 */

/** A member of a declaration, from the hover or from the source, in ONE canonical
 *  form so the two can be compared byte for byte.
 *
 *  `kind` is the shape the member is declared in. `payload` is what sits inside a
 *  variant's delimiters, or a field's TYPE, whitespace-collapsed and with any
 *  trailing comma dropped; empty for a unit variant. `text` is the member as it
 *  would render on one line, no trailing comma. */
interface Member {
  name: string;
  kind: "tuple" | "struct" | "unit" | "field";
  payload: string;
  text: string;
  /** Is this member itself behind a `#[cfg(...)]`? Then the SOURCE list and the
   *  list the language server indexed are different lists, and a CUT cannot be
   *  restored from this declaration. */
  conditional: boolean;
  /** Is a `#[cfg(...)]` inside this member's own DELIMITERS? Then the member
   *  exists (the hover showed it) and its payload still is not provable: `Io(
   *  /* … *\/ )` over `Io(#[cfg(unix)] RawFd, u32)` is `Io(u32)` on a box without
   *  that cfg. A separate flag from `conditional` because the hover settles the
   *  member's existence and settles nothing inside it. */
  payloadConditional: boolean;
}

/** A hover member, plus whether its payload was the elision marker rather than a
 *  type. `listCut` marks the marker standing where a MEMBER would: rust-analyzer
 *  saying "and more", with no name attached. */
type HoverMember = ({ listCut: false; elided: boolean } & Member) | { listCut: true };

/** The marker in every form a server might spell it: a block comment (RA writes
 *  `/* … *\/`), a bare ellipsis, or three dots. */
const MARKER_SOURCE = "\\/\\*(?:[^*]|\\*(?!\\/))*\\*\\/|…|\\.\\.\\.";
const markerAnywhere = (): RegExp => new RegExp(MARKER_SOURCE);
const markerOnly = (): RegExp => new RegExp(`^(?:${MARKER_SOURCE})$`);

/** An elided payload in the hover: `Name( /* … *\/ )` or `Name { /* … *\/ }`. The
 *  delimiters must hold NOTHING ELSE — `InvalidByte(usize, u8)` already carries
 *  its payload and is never rewritten. */
const elidedPayload = (): RegExp =>
  new RegExp(`([A-Za-z_][A-Za-z0-9_]*)[ \\t]*([({])\\s*(?:${MARKER_SOURCE})\\s*([)}])`, "g");

/** The hover for `enum X` or `struct X`, with everything rust-analyzer elided
 *  restored from the definition's own source text. Returns `signature` UNCHANGED
 *  whenever it cannot do better: no enum/struct in the hover, nothing elided, no
 *  matching declaration in the source, a member the source does not declare the
 *  same way, a member the hover shows that the source disagrees about, or two
 *  declarations of the name that produce different answers. Pure, offline, total.
 *
 *  `source` is the text of the file the type is DEFINED in (the walk already opens
 *  it). Undefined or empty means unreadable, which is unchanged. */
export function recoverElidedSurface(signature: string, source: string | undefined): string {
  if (typeof signature !== "string" || signature.length === 0) {
    return typeof signature === "string" ? signature : "";
  }
  if (typeof source !== "string" || source.length === 0) {
    return signature;
  }
  const head = /\b(enum|struct)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(signature);
  if (!head) {
    return signature; // not a Rust enum/struct hover. Go shares this walk's defaults and never matches here.
  }
  const kind = head[1] as "enum" | "struct";
  const body = bodyRange(signature, head.index + head[0].length);
  if (!body) {
    return signature; // a tuple struct (`struct Foo(u8);`) or a bodyless head
  }
  const region = signature.slice(body.open + 1, body.close);
  if (!markerAnywhere().test(region)) {
    return signature; // nothing elided: the hover already carries its whole surface
  }
  const hoverMembers = parseHoverMembers(region, kind);
  if (hoverMembers === undefined) {
    return signature; // a hover this parser cannot read is a hover it must not rewrite
  }

  // Every declaration of this name in the file, because a `#[cfg(test)] mod` can
  // declare a second one and there is no way to tell from the hover which is in
  // front of us. They have to AGREE, or the answer is not provable.
  const scrubbed = scrubRust(source);
  // A SECOND pass that blanks comments and attributes but keeps string and char
  // literals. The structure pass above must not see a brace inside a string; the
  // member text must not lose the ABI out of `extern "system" fn()` nor the
  // const-generic argument out of `Sep<'/'>`. Same length, same offsets, so the
  // two are read at the same positions.
  //
  // This is also what keeps a doc comment out of the model's mouth. A naive line
  // filter over the source leaves the prose glued to the member it precedes —
  // `rejects TCP replication. FollowerCatchingUp { leader_lease_epoch: u64 }` —
  // which is a fabricated member name arriving in the compiler's voice, the one
  // outcome the bar forbids. Blanked-with-offsets is the fix, and it was already
  // written for v37.
  const memberText = scrubRust(source, true);
  const decls = declarationBodies(scrubbed, kind, head[2]);
  if (decls.length === 0) {
    return signature;
  }
  let answer: string | undefined;
  for (const decl of decls) {
    const sourceMembers = membersOf(
      scrubbed.slice(decl.open + 1, decl.close),
      memberText.slice(decl.open + 1, decl.close),
      // The ORIGINAL bytes, at the same offsets, for the `#[cfg]` scan alone. The
      // scrub that makes a body readable is the same scrub that erases the
      // attribute, so the guard cannot run on either of the other two copies.
      source.slice(decl.open + 1, decl.close),
      kind,
    );
    const rewritten =
      sourceMembers === undefined ? undefined : rewriteRegion(region, hoverMembers, sourceMembers);
    if (rewritten === undefined) {
      return signature; // one declaration cannot prove it, so none of them can
    }
    if (answer === undefined) {
      answer = rewritten;
    } else if (answer !== rewritten) {
      return signature; // two declarations, two answers
    }
  }
  return answer === undefined
    ? signature
    : signature.slice(0, body.open + 1) + answer + signature.slice(body.close);
}

/** The rewritten body, or undefined on ANY disagreement between the hover and the
 *  source. Refusal is whole-body on purpose: a hover and a source that disagree
 *  about one member are not describing the same type, and the rest of the answer
 *  is worth nothing. A build that restores four payloads and then declines to
 *  un-cut the list has told the model four things it could not prove. */
function rewriteRegion(
  region: string,
  hoverMembers: ReadonlyArray<{ member: HoverMember; start: number; text: string }>,
  sourceMembers: readonly Member[],
): string | undefined {
  const byName = new Map<string, Member>();
  for (const m of sourceMembers) {
    if (byName.has(m.name)) {
      return undefined; // two members of one name: nothing here is provable
    }
    byName.set(m.name, m);
  }

  const shownNames: string[] = [];
  for (const h of hoverMembers) {
    if (h.member.listCut) {
      continue;
    }
    const s = byName.get(h.member.name);
    if (s === undefined || s.kind !== h.member.kind) {
      return undefined; // the hover shows a member the source does not declare the same way
    }
    if (h.member.elided) {
      // A field whose TYPE the hover elided is a shape no capture has ever shown,
      // and guessing at it is exactly what the bar forbids.
      if (h.member.kind === "field" || s.payload.length === 0) {
        return undefined;
      }
      // The hover showing the member proves the member; it proves nothing INSIDE
      // it. `Io( /* … */ )` over `Io(#[cfg(unix)] RawFd, u32)` is `Io(u32)` on a
      // box without that cfg, and substituting the source's two types hands the
      // model a constructor arity the compiler will reject. A payload is a member
      // list of its own, and this is that list's version of the cut guard.
      if (s.payloadConditional) {
        return undefined;
      }
    } else if (s.text !== h.member.text) {
      return undefined; // the two texts disagree about a member the hover DID show
    }
    shownNames.push(h.member.name);
  }

  // The shown members must appear in the source in the SAME ORDER. A cut takes a
  // suffix off a list; a reordering is evidence the parse is wrong, and "missing"
  // is only well defined against an order both texts agree on.
  let at = 0;
  for (const name of shownNames) {
    const found = sourceMembers.findIndex((m, i) => i >= at && m.name === name);
    if (found === -1) {
      return undefined;
    }
    at = found + 1;
  }

  const shown = new Set(shownNames);
  const missing = sourceMembers.filter((m) => !shown.has(m.name));
  const cuts = hoverMembers.filter((h) => h.member.listCut);
  if (cuts.length > 1) {
    return undefined; // two cuts, no way to attribute the hidden members to either
  }
  if (cuts.length === 1 && missing.length === 0) {
    return undefined; // the hover says there is more and the source has none: a disagreement
  }
  // A hover SHORTER than the source with no cut marker is NOT a refusal, and that
  // is deliberate. `#[cfg(feature = "x")]` members are in the source and out of
  // the build the server indexed, so the hover legitimately shows fewer with
  // nothing marked. Recovering payloads there is v37's shipped behaviour and
  // claims nothing new; ADDING those members would name members the compiler may
  // never see, which is why the cfg guard below refuses the whole declaration
  // before the list is ever restored.

  let out = region;
  if (cuts.length === 1) {
    if (sourceMembers.some((m) => m.conditional)) {
      return undefined; // a cfg-gated declaration: the source list is not the indexed list
    }
    const cut = cuts[0];
    const inSegment = markerAnywhere().exec(cut.text);
    if (!inSegment) {
      return undefined;
    }
    const from = cut.start + inSegment.index;
    const to = from + inSegment[0].length;
    // The cut marker's own indent, so the restored members land in the column the
    // hover already uses. A hover the server rendered on one line has none, and
    // the members then run together on that line, which is still valid Rust.
    const indent = /[ \t]*$/.exec(region.slice(0, from))?.[0] ?? "";
    const last = hoverMembers[hoverMembers.length - 1] === cut;
    const restored = missing.map((m) => m.text).join(`,\n${indent}`) + (last ? "," : "");
    out = region.slice(0, from) + restored + region.slice(to);
  }

  // Payload substitution runs LAST and over the whole rewritten body. It is
  // position-independent, and the members just restored carry real payloads, so
  // nothing it can match came from this function.
  out = out.replace(elidedPayload(), (whole, name: string, open: string, close: string) => {
    const s = byName.get(name);
    if (s === undefined || s.payload.length === 0) {
      return whole;
    }
    if (open === "(" && close === ")" && s.kind === "tuple") {
      return `${name}(${s.payload})`;
    }
    if (open === "{" && close === "}" && s.kind === "struct") {
      return `${name} { ${s.payload} }`;
    }
    return whole;
  });
  if (markerAnywhere().test(out)) {
    return undefined; // something elided survived the rewrite, so nothing was proven
  }
  return out;
}

/** The hover body's members, each with its OFFSET in the region, or undefined when
 *  any segment is not a member this parser can read. The hover is its own
 *  structure text: it carries no doc comments, and the one comment in it is the
 *  marker, which must survive to be recognised. */
function parseHoverMembers(
  region: string,
  kind: "enum" | "struct",
): Array<{ member: HoverMember; start: number; text: string }> | undefined {
  const out: Array<{ member: HoverMember; start: number; text: string }> = [];
  for (const seg of topLevelSegments(region, kind === "struct")) {
    if (markerOnly().test(seg.text.trim())) {
      out.push({ member: { listCut: true }, start: seg.start, text: seg.text });
      continue;
    }
    const m = memberFrom(seg, region, kind);
    if (m === undefined) {
      return undefined;
    }
    out.push({
      member: { listCut: false, elided: markerOnly().test(m.payload), ...m },
      start: seg.start,
      text: seg.text,
    });
  }
  return out;
}

/** The members a declaration body declares, in order, or undefined when one of
 *  them cannot be read. Structure comes from the SCRUBBED body and text is sliced
 *  from `raw` at the same offsets, which is what lets a payload keep its string
 *  and char literals while no comment or attribute reaches the model. */
function membersOf(
  body: string,
  raw: string,
  original: string,
  kind: "enum" | "struct",
): Member[] | undefined {
  const out: Member[] = [];
  for (const seg of topLevelSegments(body, kind === "struct")) {
    const m = memberFrom(seg, raw, kind, original);
    if (m === undefined) {
      return undefined;
    }
    // MACRO syntax in a member is not a type, and this is the one place it can be
    // caught. An `enum` written inside a `macro_rules!` body or a proc-macro
    // `quote!` has metavariables where its payload types go, and reading the text
    // verbatim would ship `$t` or `#ty` to the model as a type name. Proven by a
    // v37 review, which reached them through a real declaration site.
    if (/[$#]/.test(m.text)) {
      return undefined;
    }
    out.push(m);
  }
  return out;
}

/** ONE segment read as a member. `seg.text` carries the STRUCTURE (scrubbed for a
 *  source body, the hover itself for a hover) and `raw` is the text the member's
 *  own bytes are sliced from, at the same offsets. */
function memberFrom(
  seg: { text: string; start: number },
  raw: string,
  kind: "enum" | "struct",
  // The ORIGINAL bytes at the same offsets, for the `#[cfg]` scan alone. A hover
  // passes itself: it carries no attributes, so both flags come back false.
  original: string = raw,
): Member | undefined {
  const conditional = conditionalIn(original.slice(seg.start, seg.start + seg.text.length));
  if (kind === "struct") {
    const m = /^\s*((?:pub\s*(?:\([^)]*\))?\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*/.exec(seg.text);
    if (!m) {
      return undefined;
    }
    const vis = m[1].replace(/\s+/g, "").trim();
    const payload = normalize(raw.slice(seg.start + m[0].length, seg.start + seg.text.length));
    if (payload.length === 0) {
      return undefined;
    }
    // A field has no delimiters of its own, so it has no payload to gate: an
    // elided field TYPE is already refused outright in `rewriteRegion`.
    return {
      name: m[2],
      kind: "field",
      payload,
      text: `${vis ? `${vis} ` : ""}${m[2]}: ${payload}`,
      conditional,
      payloadConditional: false,
    };
  }

  const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(seg.text);
  if (!name) {
    return undefined;
  }
  const rest = seg.text.slice(name[0].length);
  const trimmed = rest.trimStart();
  const at = name[0].length + (rest.length - trimmed.length);
  if (trimmed.startsWith("(") || trimmed.startsWith("{")) {
    const tuple = trimmed.startsWith("(");
    const close = matchDelim(trimmed, 0, tuple ? "(" : "{", tuple ? ")" : "}");
    if (close === -1) {
      return undefined; // unbalanced delimiters
    }
    // The one thing allowed after a payload is an explicit discriminant, which
    // `#[repr(u8)] enum DatablockStorageKind { Inline(..) = 1 }` really writes.
    // Anything else is syntax this parser has not accounted for, and a member it
    // cannot fully read is a member it must not speak for.
    const tail = normalize(raw.slice(seg.start + at + close + 1, seg.start + seg.text.length));
    if (tail.length > 0 && !tail.startsWith("=")) {
      return undefined;
    }
    const payload = normalize(raw.slice(seg.start + at + 1, seg.start + at + close));
    const base = tuple ? `${name[1]}(${payload})` : `${name[1]} { ${payload} }`;
    return {
      name: name[1],
      kind: tuple ? "tuple" : "struct",
      payload,
      text: tail.length > 0 ? `${base} ${tail}` : base,
      conditional,
      payloadConditional: conditionalIn(original.slice(seg.start + at + 1, seg.start + at + close)),
    };
  }
  // A unit variant, with or without an explicit discriminant (`Alpha = 1`).
  if (trimmed.length > 0 && !trimmed.startsWith("=")) {
    return undefined;
  }
  return {
    name: name[1],
    kind: "unit",
    payload: "",
    text: normalize(raw.slice(seg.start, seg.start + seg.text.length)),
    conditional,
    payloadConditional: false,
  };
}

/** The `{ ... }` body of a declaration whose head starts at `from`: the first
 *  brace at generic/paren depth zero, and its match. Undefined when the head ends
 *  without a body (a `;`, or a run long enough that this was never a
 *  declaration). */
function bodyRange(text: string, from: number): { open: number; close: number } | undefined {
  let angle = 0;
  let paren = 0;
  const limit = Math.min(text.length, from + 4000); // a generic head plus a where clause; past that it is not one
  for (let i = from; i < limit; i++) {
    const skip = literalEnd(text, i);
    if (skip > i) {
      i = skip - 1;
      continue;
    }
    const c = text[i];
    if (c === "<") {
      angle++;
    } else if (c === ">") {
      // `->` and `=>` inside a where clause close nothing.
      if (angle > 0 && text[i - 1] !== "-" && text[i - 1] !== "=") {
        angle--;
      }
    } else if (c === "(") {
      paren++;
    } else if (c === ")") {
      paren = Math.max(0, paren - 1);
    } else if (c === ";" && angle === 0 && paren === 0) {
      return undefined;
    } else if (c === "{" && angle === 0 && paren === 0) {
      const close = matchBrace(text, i);
      return close === -1 ? undefined : { open: i, close };
    }
  }
  return undefined;
}

function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const skip = literalEnd(text, i);
    if (skip > i) {
      i = skip - 1;
      continue;
    }
    if (text[i] === "{") {
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** The index just past a comment, string or char literal starting at `i`, or `i`
 *  itself when nothing starts there. The two brace scanners run over the HOVER as
 *  well as the scrubbed source, and a `'}'` discriminant in the hover would
 *  otherwise close a body it never opened. */
function literalEnd(text: string, i: number): number {
  const c = text[i];
  if (c === "/" && text[i + 1] === "/") {
    const nl = text.indexOf("\n", i);
    return nl === -1 ? text.length : nl;
  }
  if (c === "/" && text[i + 1] === "*") {
    return blockCommentEnd(text, i);
  }
  if (c === "\"" || ((c === "b" || c === "r") && isStringStart(text, i))) {
    return stringEnd(text, i);
  }
  if (c === "'" && isCharLiteral(text, i)) {
    return charLiteralEnd(text, i);
  }
  return i;
}

/** Every `enum <name>` / `struct <name>` body in the (already scrubbed) source.
 *  The KIND is part of the search: a source that declares the name as a struct
 *  where the hover said enum has proven nothing about the hover in front of us,
 *  and finding no declaration is the refusal. */
function declarationBodies(
  scrubbed: string,
  kind: "enum" | "struct",
  name: string,
): Array<{ open: number; close: number }> {
  const found: Array<{ open: number; close: number }> = [];
  const decl = new RegExp(`\\b${kind}\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  for (let m = decl.exec(scrubbed); m !== null; m = decl.exec(scrubbed)) {
    const body = bodyRange(scrubbed, m.index + m[0].length);
    if (body) {
      found.push(body);
    }
  }
  return found;
}

/** A body split at commas that are at bracket depth zero, each segment carrying
 *  its OFFSET so the caller can slice the same span out of the raw text. The
 *  offset is what lets member text be read from source bytes while the structure
 *  is read from the scrubbed copy.
 *
 *  `angles` counts `<` and `>` as well, which a STRUCT body needs and an enum body
 *  does not: `pub tips: RefCell<HashMap<AggregateKey, u64>>` carries a comma at
 *  bracket depth zero, and splitting there cuts a field in half. An enum's commas
 *  are always inside a variant's own delimiters, so its splitter stays exactly as
 *  v37 shipped it. `->` and `=>` close nothing, so an `Fn(A) -> B` field type
 *  survives. */
function topLevelSegments(body: string, angles: boolean): Array<{ text: string; start: number }> {
  const segments: Array<{ text: string; start: number }> = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(" || c === "[" || c === "{" || (angles && c === "<")) {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1);
    } else if (angles && c === ">" && body[i - 1] !== "-" && body[i - 1] !== "=") {
      depth = Math.max(0, depth - 1);
    } else if (c === "," && depth === 0) {
      segments.push({ text: body.slice(start, i), start });
      start = i + 1;
    }
  }
  segments.push({ text: body.slice(start), start });
  return segments.filter((s) => s.text.trim().length > 0);
}

/** Is any part of this span behind a `#[cfg(...)]`? A cfg'd member is in the
 *  SOURCE and may be out of the build the language server indexed, and the two
 *  hover identically, so nothing downstream can tell them apart.
 *
 *  `#[cfg_attr(...)]` is deliberately NOT matched: it changes how a member is
 *  derived, never whether it exists. */
function conditionalIn(span: string): boolean {
  return /#\s*\[\s*cfg\s*\(/.test(span);
}

/** The index of the delimiter closing the one at `open`, or -1. */
function matchDelim(text: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) {
      depth++;
    } else if (text[i] === closer) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** Member text as it will be injected: one line, no scrubbed-out gaps, no trailing
 *  comma inside or after it. A multi-line `RsaPss {\n  hash_algorithm: &'static
 *  [u64],\n  salt_length: u64,\n}` reads as `hash_algorithm: &'static [u64],
 *  salt_length: u64`. */
function normalize(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,>])/g, "$1")
    .trim()
    .replace(/,$/, "")
    .trim();
}

// MEMOIZING the two scrubs per source file was tried in session-v39 and REFUTED
// on the corpus. The argument was that a walk resolves several types out of one
// definition file in a row, so each pays an O(file) scrub twice. Measured over the
// 237-row prefill arm the mean `injectMs` moved 140.0 -> 139.4, which is noise:
// the types in one prompt mostly come from different files. A mutable cache in a
// module documented as pure, for nothing measurable, is a worse trade than the
// scrub.

/** The source with every comment, string/char literal and attribute replaced by
 *  spaces, LENGTH AND LINES PRESERVED so offsets still line up. A declaration body
 *  is full of doc comments, `#[serde(rename = "x")]` and `#[error("not found:
 *  {path}")]`, and each of them can carry a brace, a paren or a comma that would
 *  otherwise be read as structure.
 *
 *  EXPORTED for the enclosing-impl scan in fnGen (session-v41 phase 3): any
 *  scope decision made by counting braces over raw Rust is wrong the moment a
 *  string literal carries one, and this scrub is the repo's one shared answer
 *  to that. */
export function scrubRust(source: string, keepLiterals = false): string {
  const out: string[] = [];
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < source.length; i++) {
      out.push(source[i] === "\n" ? "\n" : " ");
    }
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const stop = blockCommentEnd(source, i);
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "\"" || ((c === "b" || c === "r") && isStringStart(source, i))) {
      const stop = stringEnd(source, i);
      // `keepLiterals` still SCANS the literal, so a `//` inside a string cannot
      // open a comment, but emits it verbatim. That is the difference between
      // reading structure and reading the member text: the structure pass must not
      // see a brace inside a string, and the text pass must not lose an ABI string
      // out of `extern "system" fn()`.
      if (keepLiterals) {
        for (let j = i; j < stop && j < source.length; j++) {
          out.push(source[j]);
        }
      } else {
        blank(i, stop);
      }
      i = stop;
      continue;
    }
    if (c === "'" && isCharLiteral(source, i)) {
      const stop = charLiteralEnd(source, i);
      if (keepLiterals) {
        for (let j = i; j < stop && j < source.length; j++) {
          out.push(source[j]);
        }
        i = stop;
        continue;
      }
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "#" && (next === "[" || (next === "!" && source[i + 2] === "["))) {
      const stop = attributeEnd(source, i);
      blank(i, stop);
      i = stop;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/** Rust block comments NEST: an inner open needs its own close. */
function blockCommentEnd(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    if (source[i] === "/" && source[i + 1] === "*") {
      depth++;
      i += 2;
    } else if (source[i] === "*" && source[i + 1] === "/") {
      depth--;
      i += 2;
      if (depth === 0) {
        return i;
      }
    } else {
      i++;
    }
  }
  return source.length;
}

/** Is a string literal starting at `i` (`"`, `b"`, `r"`, `br#"`, ...)? */
function isStringStart(source: string, i: number): boolean {
  const rest = source.slice(i, i + 8);
  return /^(?:b?r#*"|b")/.test(rest);
}

function stringEnd(source: string, start: number): number {
  let i = start;
  while (i < source.length && (source[i] === "b" || source[i] === "r")) {
    i++;
  }
  const raw = source[start] === "r" || source[start + 1] === "r";
  if (raw) {
    let hashes = 0;
    while (source[i] === "#") {
      hashes++;
      i++;
    }
    if (source[i] !== "\"") {
      return start + 1; // not a raw string after all; step past one char
    }
    const terminator = "\"" + "#".repeat(hashes);
    const end = source.indexOf(terminator, i + 1);
    return end === -1 ? source.length : end + terminator.length;
  }
  i++; // the opening quote
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "\"") {
      return i + 1;
    }
    i++;
  }
  return source.length;
}

/** `'a` is a lifetime and must survive; `'x'` and `'\n'` are literals and must
 *  not, because a `'}'` would otherwise close a body it never opened. */
function isCharLiteral(source: string, i: number): boolean {
  if (source[i + 1] === "\\") {
    return true;
  }
  return source[i + 2] === "'";
}

function charLiteralEnd(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "'") {
      return i + 1;
    }
    i++;
  }
  return source.length;
}

/** The end of `#[...]` / `#![...]`, counting brackets and stepping over the
 *  strings and comments inside it (`#[doc = "]"]` is legal). */
function attributeEnd(source: string, start: number): number {
  let i = source.indexOf("[", start);
  if (i === -1) {
    return start + 1;
  }
  let depth = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "*") {
      i = blockCommentEnd(source, i);
      continue;
    }
    if (c === "\"" || ((c === "b" || c === "r") && isStringStart(source, i))) {
      i = stringEnd(source, i);
      continue;
    }
    if (c === "'" && isCharLiteral(source, i)) {
      i = charLiteralEnd(source, i);
      continue;
    }
    if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
    i++;
  }
  return source.length;
}

// ---------------------------------------------------------------------------
// TRAIT surface recovery. The opposite hole from the elision above: for a
// TRAIT rust-analyzer answers a bare head (`pub trait Validate` - four words,
// no body) and documentSymbol reports no children, so there is no marker to
// key on and nothing to compare against. The signature IS the injected surface
// for a trait (its members carry no hover of their own downstream), so the
// surface comes from the definition source whole: method signatures, assoc
// types and consts, and the head's own bounds. Same bar as everything else in
// this file: refuse to the input signature the moment the answer is not
// provable, never throw.
// ---------------------------------------------------------------------------

/** A trait head at a LINE START (a hover may put a path line above it), with
 *  optional visibility and `unsafe`. Anchoring to the line is what keeps a
 *  mid-sentence "the trait object is boxed" from reading as a declaration. */
const TRAIT_HEAD =
  /^[ \t]*(?:pub\s*(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)/m;

/** Is this hover a trait head with NO braced member body - the shape the trait
 *  recovery exists for? ANY brace means the server rendered a body (even an
 *  empty one), so there is nothing bare to recover and the answer is false. */
export function isBareTraitHover(signature: string): boolean {
  if (typeof signature !== "string" || signature.length === 0) {
    return false;
  }
  return TRAIT_HEAD.test(signature) && !signature.includes("{");
}

/** The bare trait hover, replaced by the trait's declared surface out of the
 *  definition file's source: the SOURCE's head (its supertrait bounds and
 *  generics - the hover has neither), then one line per item. A default body is
 *  implementation, not surface, so its method contributes the signature alone.
 *  Returns `signature` UNCHANGED whenever it cannot do better: not a bare trait
 *  hover, unreadable source, no `trait <name>` declaration (an `impl <name>
 *  for` is a use, not a declaration), TWO declarations of the name, a `#[cfg]`
 *  on the declaration itself, or a body this parser cannot read whole. A
 *  `#[cfg]` on one ITEM omits that item and keeps the trait, v39's precedent.
 *  An empty trait renders `head {}` - the model learning the trait HAS no
 *  members is not the product knowing nothing. Pure, offline, total. */
export function recoverTraitSurface(signature: string, source: string | undefined): string {
  if (typeof signature !== "string" || signature.length === 0) {
    return typeof signature === "string" ? signature : "";
  }
  if (!isBareTraitHover(signature)) {
    return signature; // struct/enum/elided hovers keep their own paths' custody
  }
  if (typeof source !== "string" || source.length === 0) {
    return signature; // the def file read failed; today's behaviour is the fallback
  }
  const name = TRAIT_HEAD.exec(signature)?.[1];
  if (name === undefined) {
    return signature;
  }
  const scrubbed = scrubRust(source);
  const memberText = scrubRust(source, true);
  const decl = new RegExp(
    `(?:\\bpub\\s*(?:\\([^)]*\\))?\\s+)?(?:\\bunsafe\\s+)?\\btrait\\s+` +
      `${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "g",
  );
  const heads: number[] = [];
  let bodyAt: { open: number; close: number } | undefined;
  for (let m = decl.exec(scrubbed); m !== null; m = decl.exec(scrubbed)) {
    heads.push(m.index);
    bodyAt = bodyRange(scrubbed, m.index + m[0].length);
  }
  // TWO declarations refuse on the count alone, unlike the elision path's
  // agree-and-proceed: there is no hover body to check either against, so
  // there is no way to prove which one the server resolved.
  if (heads.length !== 1 || bodyAt === undefined) {
    return signature;
  }
  const headStart = heads[0];
  // Everything between the previous item boundary and the head is the
  // declaration's own decoration (attributes, doc comments - both blanked in
  // the scrubbed copy, so the boundary scan sees only real structure). A cfg
  // there means the whole trait may not exist in the caller's build.
  let boundary = 0;
  for (let i = headStart - 1; i >= 0; i--) {
    const c = scrubbed[i];
    if (c === "{" || c === "}" || c === ";") {
      boundary = i + 1;
      break;
    }
  }
  if (conditionalIn(source.slice(boundary, headStart))) {
    return signature;
  }
  const items = traitItems(
    scrubbed.slice(bodyAt.open + 1, bodyAt.close),
    memberText.slice(bodyAt.open + 1, bodyAt.close),
    source.slice(bodyAt.open + 1, bodyAt.close),
  );
  if (items === undefined) {
    return signature;
  }
  const head = normalize(memberText.slice(headStart, bodyAt.open));
  if (head.length === 0) {
    return signature;
  }
  return items.length === 0
    ? `${head} {}`
    : `${head} {\n${items.map((line) => `    ${line}`).join("\n")}\n}`;
}

/** The trait body's items rendered one per line, or undefined when ANY span is
 *  not an item this parser can read - whole-trait refusal, on purpose. The
 *  three bodies are the same bytes at the same offsets: `scrubbedBody` gives
 *  structure (a brace in a string literal splits nothing), `textBody` the
 *  bytes to render (literals kept, comments and attributes blanked),
 *  `originalBody` the `#[cfg]` scan alone. An empty string in the result would
 *  mean a cfg-omitted item; those are dropped here, not rendered. */
function traitItems(
  scrubbedBody: string,
  textBody: string,
  originalBody: string,
): string[] | undefined {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < scrubbedBody.length; i++) {
    const c = scrubbedBody[i];
    if (c === "(" || c === "[") {
      depth++;
    } else if (c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && (c === ";" || c === "{")) {
      // `;` ends a required item; `{` opens a default body, and the signature
      // is everything before it. `[u8; 32]` and `Result<(), E>` never split
      // because their `;` and `,` sit inside counted delimiters.
      const sigEnd = i;
      if (c === "{") {
        const close = matchBrace(scrubbedBody, i);
        if (close === -1) {
          return undefined; // a default body that never closes
        }
        i = close;
      }
      const line = traitItemLine(
        scrubbedBody.slice(start, sigEnd),
        textBody.slice(start, sigEnd),
        originalBody.slice(start, sigEnd),
      );
      if (line === undefined) {
        return undefined;
      }
      if (line.length > 0) {
        out.push(line);
      }
      start = i + 1;
    }
  }
  if (scrubbedBody.slice(start).trim().length > 0) {
    return undefined; // trailing bytes with no terminator: the parse is not whole
  }
  return out;
}

/** The declarable heads of a trait item. `fn` (with its qualifiers), assoc
 *  `type`, assoc `const` - anything else in item position is syntax this
 *  parser has not accounted for, and refusing the whole trait is the bar. */
const TRAIT_ITEM_HEAD =
  /^(?:pub\s*(?:\([^)]*\)\s*)?)?(?:default\s+)?(?:unsafe\s+)?(?:async\s+)?(?:fn|type|const)\b/;

/** ONE item's rendered line, "" for a cfg-omitted item, undefined to refuse.
 *  The cfg scan runs over the SIGNATURE span only: an attribute binds above
 *  the item's head, and the dropped default body can legally contain a nested
 *  `#[cfg]` that gates nothing about this item. */
function traitItemLine(
  scrubbedSig: string,
  textSig: string,
  originalSig: string,
): string | undefined {
  if (!TRAIT_ITEM_HEAD.test(scrubbedSig.trim())) {
    return undefined;
  }
  if (conditionalIn(originalSig)) {
    return ""; // in the source, maybe out of the build the server indexed
  }
  const text = normalize(textSig);
  // Metavariables mean a macro body, not a declaration - the same catch as
  // `membersOf`, at the same place: the one point the text is still raw.
  if (text.length === 0 || /[$#]/.test(text)) {
    return undefined;
  }
  return `${text};`;
}

/** Does this signature still carry rust-analyzer's truncation marker? The question
 *  item 2 turns on: an incomplete surface may be SHOWN, it may not be declared
 *  exhaustive. */
export function surfaceStillTruncated(signature: string | undefined): boolean {
  return typeof signature === "string" && markerAnywhere().test(signature);
}
