/**
 * C#-shaped pure extraction helpers, the C# siblings of tsExtraction.ts's
 * TypeScript parsers and extraction.ts's Rust ones. They live in their own
 * module because the Rust helpers are pinned by blind suites and must not grow
 * language branches; both C# transports (csExtractor product, csLspExtractor
 * headless) render through these so the two produce identical member shapes.
 *
 * C# carries no trait provenance, so no member built here ever sets viaTrait;
 * and no C# symbol survives decompilation with a usage example (metadata-as-
 * source strips doc examples), so no helper here ever produces an example.
 */

import { CompletionMember, HoverSurface, MemberKind, SourceCursor, SymbolRole, TypeNameHint } from "./extraction";
import { fenceFor } from "./instructPostprocess";
import { dedentToZeroBase, replyBaseIndent, withoutBase } from "./reindent";

// The ```csharp fence that carries the signature in a Roslyn hover. The empty
// tag is accepted too (a bare fence), matching the TS parser's leniency.
const CS_FENCE_LANGS = new Set(["csharp", "c#", "cs", ""]);

/** Parse a Roslyn C# hover's markdown into a HoverSurface: the first ```csharp
 *  fence body is the signature VERBATIM (the LS-rendered display text), the
 *  prose below the fence is doc, example is NEVER set (C# metadata-as-source
 *  carries no example, so the C# surface is signatures + doc only). undefined
 *  when there is no fence at all — an empty or prose-only hover degrades to no
 *  surface, never a guess. Mirrors parseTsHover; the fence language differs. */
export function parseCsHover(markdown: string): HoverSurface | undefined {
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
        fenceIsSignature = signature === undefined && CS_FENCE_LANGS.has(trimmed.slice(3).trim().toLowerCase());
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

/** The signature that Roslyn hangs on a RESOLVED completion item's
 *  `documentation` (the signature does NOT ride `detail`, which is absent). It
 *  comes back in TWO forms depending on the
 *  client's advertised documentationFormat, and this must survive both — the
 *  HEADLESS transport advertises plaintext, but the PRODUCT transport rides the
 *  user's ms-dotnettools extension, which advertises MARKDOWN:
 *
 *    plaintext: "string JsonConvert.SerializeObject(object? value) (+ 7 overloads)\r\n..."
 *               -> the signature is line 0.
 *    markdown:  "```csharp\nstring JsonConvert.SerializeObject(object? value)\n```\n..."
 *               -> the signature is the first line INSIDE the ```csharp fence
 *               (line 0 is the fence marker; taking it verbatim injected the
 *               literal "```csharp" into every product FIM/repair prompt — the
 *               green-but-wrong defect). The markdown form also drops the
 *               "(+ N overloads)" suffix below the fence, so the two forms are
 *               not byte-identical — only the core signature is shared.
 *
 *  undefined when there is no documentation (an unresolved item) — the member
 *  then renders signature-less, never with an invented signature. */
export function csSignatureFromDocumentation(doc: string | undefined): string | undefined {
  if (doc === undefined) {
    return undefined;
  }
  const lines = doc.split(/\r?\n/);
  let i = 0;
  // A leading ```csharp / bare ``` fence (the markdown form): skip the marker
  // and any blank lines to the first content line inside the fence.
  if (lines[i]?.trimStart().startsWith("```")) {
    i++;
    while (i < lines.length && lines[i].trim().length === 0) {
      i++;
    }
  }
  const signature = lines[i]?.trim();
  // Guard the degenerate case (a fence with no body): never return a fence marker.
  return signature !== undefined && signature.length > 0 && !signature.startsWith("```")
    ? signature
    : undefined;
}

/** The signature a completion item carries BEFORE anything is resolved, read off
 *  `detail` or `labelDetails.description`. Roslyn usually defers the signature to
 *  completionItem/resolve and leaves both empty, in which case this is undefined
 *  and nothing changes; when it does fill one in, the member costs no resolve
 *  slot and the declaring-type filter can run without one either.
 *
 *  Guarded rather than trusted: the text must actually declare this member (name
 *  as a whole token) and say more than its bare name, so a `detail` carrying
 *  something other than a signature is refused instead of injected as one. */
export function csPreResolveSignature(label: string, detail: string | undefined): string | undefined {
  const name = label.trim();
  const text = detail?.trim();
  if (name.length === 0 || text === undefined || text.length <= name.length) {
    return undefined;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(text) ? text : undefined;
}

/** The type a Roslyn-rendered signature declares its member ON:
 *  "bool object.Equals(object? obj)" -> "object",
 *  "(extension) TResult object.Field<TResult>(string name)" -> "object",
 *  "int Stripe.AtlasId { get; set; }" -> "Stripe",
 *  "(extension) IQueryable<Tile> IQueryable<Tile>.WhereLod(int lod)" -> "IQueryable<Tile>".
 *
 *  The qualified name is the token immediately before the parameter list, the
 *  property accessors, or the end of the declaration; the extension marker and
 *  the return type sit ahead of it. undefined when the text is not a rendered
 *  signature, which keeps every caller's default "cannot tell, so keep it". */
export function csDeclaringType(signature: string | undefined): string | undefined {
  if (signature === undefined) {
    return undefined;
  }
  const head = signature.trim().replace(/^\(extension\)\s*/, "").split("{")[0];
  const match = /([^\s(]+)\.([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^<>]*>)?\s*(?:\(|$)/.exec(head);
  return match ? match[1] : undefined;
}

// The words that HEAD a type's own declaration render rather than name a type:
// `enum Atlas.LodBand`, `class Atlas.Stripe`. Hovering a type gives one of
// these where hovering a member gives the member's type, and the two renders are
// otherwise the same shape, so the head word is the only thing separating them.
const CS_DECLARATION_HEADS = new Set([
  "class", "struct", "interface", "enum", "record", "delegate", "namespace", "event",
]);

/** The DECLARED TYPE of the member a Roslyn hover describes:
 *  "LodBand Tile.Band { get; }" -> "LodBand",
 *  "LodBand? Tile.Band { get; }" -> "LodBand",
 *  "(local variable) LodBand band" -> "LodBand",
 *  "int Stripe.TileTally { get; }" -> "int".
 *
 *  The type LEADS the render, ahead of the qualified member name, which is the
 *  mirror of `csDeclaringType` reading the qualified name itself. Roslyn's
 *  parenthesised role chrome ("(extension)", "(local variable)") sits ahead of
 *  the type and is stripped; the property accessors and the parameter list are
 *  cut so a method yields its RETURN type.
 *
 *  undefined when the text is not a member render at all: a type's own hover
 *  (`enum Atlas.LodBand`), a render with no name after the type, or a type this
 *  cannot spell as a plain identifier: a generic, an array, a tuple. That last
 *  refusal is deliberate rather than lazy: the caller resolves the answer BY
 *  NAME, and `List<Tile>` is not a name any resolver can anchor.
 *
 *  Whether what comes back is a USER type is the caller's question. This says
 *  what the member is declared as, keyword primitives included. */
export function csMemberTypeName(signature: string | undefined): string | undefined {
  const declared = csMemberDeclaredType(signature);
  // A qualified type contributes its LAST segment: `Atlas.LodBand` is the type
  // LodBand and `Atlas` is a namespace, the same last-segment rule
  // csSignatureRefTypes follows.
  return declared?.split(".").pop();
}

/** The CONTAINER `csMemberTypeName` drops: `DataModel.Enums.DataOrigin
 *  FileParsingResults.DataOrigin { get; set; }` -> "DataModel.Enums".
 *  undefined when the hover names no member type at all, and undefined when the
 *  type it names is unqualified (`DataOrigin Tile.Origin { get; }`) — an absent
 *  container is not the empty one, and a caller that treats it as evidence would
 *  be matching every namespace at once.
 *
 *  This is the by-name resolution leg's disambiguator, and it exists because
 *  reading only the last segment throws away the one piece of evidence that
 *  tells two same-named types apart. Roslyn renders a member's type MINIMALLY
 *  QUALIFIED against the consuming file, so what comes back is a SUFFIX of the
 *  declaring namespace (`DataModel.Enums` for `Contoso.DataModel.Enums`), never
 *  reliably the whole of it — `selectCsTypeCursor` matches it as one. */
export function csMemberTypeContainer(signature: string | undefined): string | undefined {
  const declared = csMemberDeclaredType(signature);
  if (declared === undefined) {
    return undefined;
  }
  const lastDot = declared.lastIndexOf(".");
  return lastDot < 0 ? undefined : declared.slice(0, lastDot);
}

// The one parse of a member hover's head, shared by the name reader and the
// container reader so the two can never disagree about what the hover declared:
// the QUALIFIED type as written, `?` suffix stripped, or undefined when this is
// not a member render at all.
function csMemberDeclaredType(signature: string | undefined): string | undefined {
  if (signature === undefined) {
    return undefined;
  }
  const head = signature.trim().replace(/^\([^)]*\)\s*/, "").split("{")[0].split("(")[0].trim();
  const words = head.split(/\s+/).filter((w) => w.length > 0);
  // A type AND the member it declares: one word alone is a bare name, not a
  // declaration this can read a type out of.
  if (words.length < 2 || CS_DECLARATION_HEADS.has(words[0])) {
    return undefined;
  }
  const declared = words[0].replace(/\?+$/, "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(declared)) {
    return undefined;
  }
  return declared;
}

// A type's OWN hover, and the qualified name it declares: `enum
// Contoso.DataModel.Enums.DataOrigin`, `class Atlas.Stripe`, `record Ns.Point`,
// `class Ns.Box<T>` (the generic argument list trails the name and is not part
// of it). `delegate` is excluded on purpose: its render puts the return type
// where every other head puts the name, so it is a different grammar, and the
// leg reading this only ever cares about enums.
const CS_TYPE_DECLARATION =
  /^(?:class|struct|interface|enum|record(?:\s+(?:class|struct))?)\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/;

// A file's `using` imports and its own namespace declarations, which together
// decide whether a short type name resolves in it. An alias (`using X = Ns.Y;`)
// is not an import of `X` and the `;` in the pattern excludes it; `using static`
// imports members rather than a namespace and is excluded by name. Read off the
// raw text rather than a masked copy: masking a whole document costs a scan on
// the injection deadline, and a line whose first non-blank characters are
// `using Foo;` inside a comment is not a shape real C# takes.
const CS_USING_IMPORT = /^[ \t]*(?:global[ \t]+)?using[ \t]+(?!static\b)([A-Za-z_][A-Za-z0-9_.]*)[ \t]*;/gm;
const CS_NAMESPACE_DECLARATION = /^[ \t]*namespace[ \t]+([A-Za-z_][A-Za-z0-9_.]*)/gm;

/** The plain (non-alias, non-`static`) `using` namespaces this file imports —
 *  session-v40 item 2's candidate leg reads this to tell a real fully-
 *  qualified reference (`Newtonsoft.Json.Linq.JObject`, this file `using`s
 *  `Newtonsoft.Json.Linq`) from a look-alike dotted chain that names no
 *  import at all. Reuses CS_USING_IMPORT rather than a second parse of the
 *  same line shape — csFileReachesContainer already trusts it for the
 *  by-name resolution leg's own hint disambiguation. */
export function csUsingNamespaces(fullText: string): Set<string> {
  const out = new Set<string>();
  for (const m of fullText.matchAll(CS_USING_IMPORT)) {
    out.add(m[1]);
  }
  return out;
}

/** The FULLY QUALIFIED name a type's own def hover declares: `enum
 *  Contoso.DataModel.Enums.DataOrigin` -> "Contoso.DataModel.Enums.DataOrigin".
 *  undefined when the hover declares no type at all, which is how a caller tells
 *  a TYPE's hover from a MEMBER's (`DataOrigin FileParsingResults.DataOrigin
 *  { get; set; }`).
 *
 *  The one parse of that shape. `csTypeSpelling` asks it what was declared and
 *  then answers the spelling question; the by-name resolution leg asks it which
 *  of two same-named types a hit actually is. A second reader of the same hover
 *  would be a second chance to disagree about what Roslyn said. */
/** How a STATIC member of the type `defSignature` declares must be qualified to
 *  be callable, or undefined when the hover declares no type.
 *
 *  The generic clause is part of the answer, not decoration. `Result.Ok(...)`
 *  does not compile for `Result<T, E>`; `Result<T, E>.Ok(...)` is the shape the
 *  caller substitutes into. Measured: a surface rendering the bare name got
 *  `return Err(...)` and CS0103 five times out of five, one rendering
 *  `Result<T, E>.Ok(T)` got compiling code five out of five, and a middle arm
 *  rendering `Result.Ok(T)` got `Result.Err(...)` five out of five, which
 *  compiles no better than the bare name.
 *
 *  Reads the same hover `csDeclaredTypeName` does, and takes what that one
 *  discards: the modifiers a struct hover opens with (`readonly struct`), and
 *  the arity clause at the end. */
export function csStaticQualifier(defSignature: string | undefined): string | undefined {
  const hover = (defSignature ?? "").trim();
  const m = /(?:^|\s)(?:class|struct|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*(<[^<>]*>)?/.exec(hover);
  if (!m) {
    return undefined;
  }
  const last = m[1].split(".").pop();
  return last === undefined || last === "" ? undefined : `${last}${m[2] ?? ""}`;
}

// The modifiers that make a member unreachable through an INSTANCE, read off its
// own declaration line. A word, not a substring: staticLabel, StaticCount,
// `constantCount` and Constants are ordinary members.
//
// `const` is here because a C# `const` IS implicitly static — the language says
// so — and a constant is no more callable through an instance than a static
// method is. It was missed, and the miss was measured rather than argued: over
// the live member list of one real 26-member constants class in the C# corpus,
// 26 members resolved and this test qualified 3. The other 23 are `public const
// string …` and every one of them rendered BARE, under a block header reading
// "use these exact names, do not invent", in a spelling that does not compile.
//
// One word, and it is independent of every data-shape walk: it reads a member
// list and a declaration line and nothing else.
const CS_STATIC_MODIFIER = /(?:^|\s)(?:static|const)\s/;

/** The part of a C# declaration line a MODIFIER can legally appear in: the line
 *  with its string and character literals blanked, its comments removed, and
 *  everything from the first `{` onward cut away.
 *
 *  Reading the modifier off the raw line was already slightly wrong for
 *  `static` and became materially wrong when `const` joined it, because `const`
 *  is an ordinary English word and `static` is not. Every case below was found
 *  by the phase 0 adversarial review, with a failing row each, and every one of
 *  them ends with a member being spelled Type.Member when it is reachable
 *  through an instance — a name that does not compile, which is the exact defect
 *  the qualifier exists to remove, arriving from the other direction:
 *
 *    public string Sql = "select const from t";     <- a literal
 *    public int Count;  // const-time lookup        <- a comment, and the common one
 *    [Obsolete("use const path")] public int X;     <- an attribute argument
 *    public int Get() { const int k = 1; return k; } <- a LOCAL const, in a one-line body
 *
 *  The three erasures are each sound rather than merely convenient. A C#
 *  modifier is a keyword, so it can never be inside a literal. It can never be
 *  inside a comment. And it always precedes the member's body or accessor list,
 *  so nothing after the first `{` can be one — which is what makes cutting there
 *  safe for `public static int P { get; set; }` while still killing a local
 *  `const` declared inside a single-line body.
 *
 *  Literals are BLANKED rather than deleted so the `{` cut and the member-name
 *  check downstream still see the same column structure. */
function csModifierRegion(line: string, memberName?: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "/" && line[i + 1] === "/") {
      break; // line comment: nothing after it is code
    }
    if (c === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      const stop = end < 0 ? line.length : end + 2;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      // A verbatim string (@"…") doubles its quote to escape; every other form
      // uses a backslash. Both terminate on an unescaped closing quote.
      const verbatim = c === '"' && line[i - 1] === "@";
      let j = i + 1;
      while (j < line.length) {
        if (!verbatim && line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === c) {
          if (verbatim && line[j + 1] === c) {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out += " ".repeat(Math.min(j, line.length) - i);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  // THE BRACE CUT, and it is anchored on the MEMBER rather than on the line.
  //
  // Cutting at the first `{` on the line is what a modifier-before-the-body rule
  // sounds like, and it is wrong for a member that shares a line with its
  // CONTAINER's opening brace: in `public class Holder { public static int Count
  // = 0; }` the first brace precedes the member entirely, so cutting there threw
  // away the member and its `static` with it. That under-qualified a member that
  // qualified correctly before `const` was ever added — a regression on the
  // static leg, found by the phase 0 adversarial review.
  //
  // The brace that actually ends a member's modifiers is the first one AFTER the
  // member's own name: a body (`… Log(string m) { const string prefix = …; }`),
  // or an accessor list (`public string Tag { get { … } }`). Anchored there,
  // both shapes come out right, and a member with no brace after its name keeps
  // its whole line.
  if (memberName !== undefined) {
    const at = new RegExp(`(?:^|\\W)${escapeCsName(memberName)}(?:\\W|$)`).exec(out);
    const brace = at === undefined || at === null ? out.indexOf("{") : out.indexOf("{", at.index + at[0].length);
    if (brace >= 0) {
      return out.slice(0, brace);
    }
    return out;
  }
  const brace = out.indexOf("{");
  return brace >= 0 ? out.slice(0, brace) : out;
}

/** Qualify every STATIC member's rendered signature with the type it belongs
 *  to, so the surface spells what the caller has to type.
 *
 *  The transport carries no static flag: Roslyn's documentSymbol answers a name,
 *  a kind and a declaration LINE. So this reads the modifier off that line, from
 *  the same def text the visibility pass already reads, and a member whose
 *  declaration cannot be read is left exactly as it was. A wrong qualifier is a
 *  name that does not compile, which is the defect this closes arriving from the
 *  other direction, so absence of evidence changes nothing.
 *
 *  Never mutates its input, and never qualifies a signature that already carries
 *  its owner: the enum leg spells its variants qualified and both legs render
 *  through here. */
export function csQualifyStatics(
  members: readonly CompletionMember[],
  defSignature: string | undefined,
  defLines: readonly string[],
): CompletionMember[] {
  const qualifier = csStaticQualifier(defSignature);
  if (qualifier === undefined) {
    return [...members];
  }
  return members.map((member) => {
    const line = member.declLine;
    if (
      member.signature === undefined ||
      line === undefined ||
      line < 0 ||
      line >= defLines.length ||
      !CS_STATIC_MODIFIER.test(csModifierRegion(defLines[line], member.name)) ||
      !new RegExp(`(?:^|\\W)${escapeCsName(member.name)}(?:\\W|$)`).test(defLines[line]) ||
      member.signature.startsWith(`${qualifier}.`)
    ) {
      return member;
    }
    return { ...member, signature: `${qualifier}.${member.signature}` };
  });
}

const escapeCsName = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function csDeclaredTypeName(defSignature: string | undefined): string | undefined {
  return CS_TYPE_DECLARATION.exec((defSignature ?? "").trim())?.[1];
}

/** How a type declared by `defSignature` must be SPELLED to compile inside
 *  `fileText`, or undefined when the hover does not declare a type at all.
 *
 *  Roslyn hovers a definition with its fully qualified name, and the consuming
 *  file decides whether the short form reaches it. `enum
 *  Contoso.DataModel.Enums.DataOrigin` is `DataOrigin` in a file that imports
 *  that namespace or sits inside it, and `Contoso.DataModel.Enums.DataOrigin`
 *  everywhere else. Both compile. Keeping the last segment unconditionally does
 *  not: at 11 real sites in two files the short form names nothing, and the
 *  block that renders it says "do not invent" while doing the inventing.
 *
 *  Conservative in one direction only. A `global using` in ANOTHER file, or an
 *  SDK implicit using, would also make the short form resolve and cannot be seen
 *  from this buffer, so those files get the qualified spelling - longer than the
 *  human would write, and still correct. A nested type (`Outer.Inner`, which
 *  Roslyn renders in the same dotted shape a namespace does) is the same
 *  question with a type for a container: no `using` names a type, so it takes
 *  the qualified spelling, which is what compiles outside `Outer`.
 *
 *  The undefined answer is load-bearing beyond spelling: it is also how a caller
 *  tells a hover that declares a TYPE from one that declares a member, which is
 *  what `DataOrigin FileParsingResults.DataOrigin { get; set; }` is. */
export function csTypeSpelling(defSignature: string | undefined, fileText: string): string | undefined {
  const declared = csDeclaredTypeName(defSignature);
  if (declared === undefined) {
    return undefined;
  }
  const lastDot = declared.lastIndexOf(".");
  if (lastDot < 0) {
    return declared;
  }
  const container = declared.slice(0, lastDot);
  return csFileReachesContainer(container, fileText) ? declared.slice(lastDot + 1) : declared;
}

// Does an unqualified name from `container` resolve inside `fileText` — is the
// namespace imported by the file, or enclosing it? The whole of csTypeSpelling's
// question, factored out because the by-name resolution leg asks the SAME one of
// a candidate's namespace, and two copies of this scan would be two chances to
// disagree about what a file can see.
//
// C# resolves an unqualified name through the ENCLOSING namespaces too, so a
// file declaring `A.B.C` sees a type in `A.B` and in `A` without importing
// either. Nested `namespace A { namespace B {` declarations are read as two
// namespaces rather than one path, which loses the short form and keeps the
// spelling that compiles.
function csFileReachesContainer(container: string, fileText: string): boolean {
  for (const m of fileText.matchAll(CS_USING_IMPORT)) {
    if (m[1] === container) {
      return true;
    }
  }
  for (const m of fileText.matchAll(CS_NAMESPACE_DECLARATION)) {
    if (m[1] === container || m[1].startsWith(`${container}.`)) {
      return true;
    }
  }
  return false;
}

/** The receiver TYPE a member site belongs to, read off the site's own
 *  natively-resolved signatures at zero round trips: the majority non-object
 *  declaring type over whatever the resolve cap reached (`void
 *  List<Stripe>.Add(Stripe item)` names it outright; extension heads name
 *  `IEnumerable<Stripe>` and lose the vote to the instance majority).
 *
 *  This is the chain cache's namespace discriminator (session-v27
 *  triage-p3.md finding 1): a warm absorbed at a `List<Tile>` receiver served
 *  Tile-substituted signatures at a `List<Stripe>` site — 78 of 79 fills
 *  wrong at the measured second receiver — so entries only serve where the
 *  receiver type matches. A tie or no evidence returns undefined, and the
 *  caller then neither fills nor warms: the honest degrade is a dark site,
 *  never a guessed namespace. */
export function csReceiverType(members: ReadonlyArray<CompletionMember>): string | undefined {
  const counts = new Map<string, number>();
  for (const member of members) {
    const declaring = csDeclaringType(member.signature);
    if (declaring === undefined || declaring === "object" || declaring === "System.Object") {
      continue;
    }
    counts.set(declaring, (counts.get(declaring) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  let tied = false;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

/** Is this member declared on `object` — one of its four universal members, or
 *  an extension method someone hung on `object` so it appears on EVERY receiver
 *  in the project?
 *
 *  Keyed on the declaring type and never on member names: the fourteen the
 *  capture found are the Cosmos SDK's, and the next project brings its own set,
 *  so a name list is wrong by construction. It would also be unable to tell an
 *  inherited `object.ToString()` from the developer's own override.
 *
 *  The keyword spelling only, plus the fully qualified one. Roslyn renders
 *  `System.Object` as the keyword `object`, so a bare `Object` is a USER type of
 *  that name (common in interop and schema-generated code) and filtering it
 *  would delete a real property's line - the failure the surface calls worse
 *  than showing noise. */
export function isCsObjectDeclaredMember(signature: string | undefined): boolean {
  const declaring = csDeclaringType(signature);
  return declaring === "object" || declaring === "System.Object";
}

/** Build a C# CompletionMember from a completion label + the resolved item's
 *  documentation + mapped kind, plus whatever signature the item carried BEFORE
 *  resolve. The name is the label verbatim (what a model types); the signature is
 *  the documentation's first line (see csSignatureFromDocumentation), rendered
 *  for every kind because a C# property declaration
 *  ("Func<..>? JsonConvert.DefaultSettings { get; set; }") is as load-bearing as
 *  a method's. viaTrait is never set — C# has no trait provenance in a
 *  completion label.
 *
 *  A member declared on `object` keeps its NAME and loses its SIGNATURE. That is
 *  the whole filter: the name still travels to the enforcement gate, so an
 *  incomplete block can never suppress a correct completion, while the block
 *  itself shows only members of the receiver's own type — a rendered line needs a
 *  signature. At a captured 49-property entity, `object`'s four plus fourteen
 *  blanket extensions were half of what the block had room for.
 *
 *  The same evidence stamps the server-relevance tier (`CompletionMember.tier`):
 *  an object-declared signature is tier 1. When no signature resolved, `object`'s
 *  four universal names are the fallback discriminator — Roslyn's sortText is an
 *  alphabetical index (probe-proven useless for relevance), so names are all
 *  that is left there. A developer's own resolved override (`string
 *  Stripe.ToString()`) stays tier 0 via its declaring type; an unresolved own
 *  override mis-stamped by the name fallback costs the block nothing, because
 *  a member with no signature never renders a line anyway. */
export function toCsCompletionMember(
  label: string,
  documentation: string | undefined,
  kind: MemberKind,
  detail?: string,
): CompletionMember {
  const member: CompletionMember = { name: label.trim(), kind };
  const signature = csSignatureFromDocumentation(documentation) ?? csPreResolveSignature(label, detail);
  if (signature !== undefined && !isCsObjectDeclaredMember(signature)) {
    member.signature = signature;
  }
  if (isCsObjectDeclaredMember(signature) || (signature === undefined && CS_OBJECT_UNIVERSAL_NAMES.has(member.name))) {
    member.tier = 1;
  }
  return member;
}

/** `object`'s four instance members every C# receiver inherits — the tier
 *  fallback for UNRESOLVED items only (see toCsCompletionMember). Never a
 *  drop filter: the membersOfType lesson below stands, a bare-name set cannot
 *  tell an inherited static from a user override, so this set only ever
 *  stamps a tier on a member whose signature said nothing. */
const CS_OBJECT_UNIVERSAL_NAMES = new Set(["Equals", "GetHashCode", "GetType", "ToString"]);

/** The bare member identifier a model would type, sliced out of a Roslyn
 *  documentSymbol name: "Greet() : string" -> "Greet", "_name : string" ->
 *  "_name", "Greeter(string)" -> "Greeter", "Sum() : int" -> "Sum". The name
 *  Roslyn renders carries the parameter list and return type as chrome; the
 *  leading C# identifier is the member. Falls back to the trimmed input when no
 *  leading identifier is present (never invents a name). */
export function csBareMemberName(name: string): string {
  const trimmed = name.trim();
  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed);
  return m ? m[0] : trimmed;
}

/** Build a C# CompletionMember from a documentSymbol child's raw name + detail
 *  + mapped kind — the SymbolMemberBuilder membersFromDocumentSymbols calls for
 *  the C# transports. The name is reduced to the bare identifier
 *  (csBareMemberName) so the raw " : Type"-suffixed form never leaks; the
 *  signature is the LS-rendered detail verbatim ("Greet() : string") when it
 *  carries more than the bare name. Roslyn populates detail on documentSymbol,
 *  so the C# product transport gets its signatures straight from the descent. */
export function toCsSymbolMember(
  label: string,
  detail: string | undefined,
  kind: MemberKind,
): CompletionMember {
  const name = csBareMemberName(label);
  const member: CompletionMember = { name, kind };
  const rendered = detail?.trim();
  if (rendered !== undefined && rendered.length > 0 && rendered !== name) {
    member.signature = rendered;
  }
  return member;
}

// There is deliberately NO object-statics name filter here. An earlier design
// dropped {Equals, ReferenceEquals, GetHashCode, GetType, ToString} by bare name
// in membersOfType to strip inherited System.Object noise — but membersOfType is
// a documentSymbol descent, which is SYNTACTIC (declared members only). Inherited
// statics are NEVER present there, so the filter's only real effect was deleting
// the developer's OWN declared overrides (a `public override string ToString()`,
// a `bool Equals(MyType)`, a custom `GetHashCode`). A bare-name set cannot tell an
// inherited static from a user override.
//
// The completion path DOES filter object noise (isCsObjectDeclaredMember), and
// the difference is exactly the one this comment is about: it keys on the
// DECLARING TYPE Roslyn renders into the signature, which distinguishes an
// inherited `object.ToString()` from `Stripe.ToString()`. It also withholds a
// signature rather than deleting a member, so the `.`-site set the interface
// contract promises stays verbatim.

// ---------------------------------------------------------------------------
// Kind / role mappers. The vscode enums are 0-indexed; the raw LSP enums are
// 1-indexed (the SAME concept numbered one higher). Each transport passes its
// own mapper, never a shared table — the two enums genuinely disagree.
// ---------------------------------------------------------------------------

/** vscode CompletionItemKind (0-indexed) -> MemberKind, or undefined for a kind
 *  that is never a member (Text/Keyword/Snippet). Method=1, Function=2,
 *  Constructor=3, Field=4, Property=9. Everything unmapped is "other". */
export function csVscodeMemberKind(kind: unknown): MemberKind | undefined {
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
    case 3: // Constructor
      return "method";
    case 4: // Field
    case 9: // Property
    case 19: // EnumMember
      return "field";
    default:
      return "other";
  }
}

/** Raw LSP CompletionItemKind (1-indexed) -> MemberKind, or undefined for a kind
 *  that is never a member (Text=1/Keyword=14/Snippet=15). Method=2, Function=3,
 *  Constructor=4, Field=5, Property=10. The vscode number MINUS ONE. */
export function csLspMemberKind(kind: unknown): MemberKind | undefined {
  if (typeof kind !== "number") {
    return "other";
  }
  switch (kind) {
    case 1: // Text
    case 14: // Keyword
    case 15: // Snippet
      return undefined;
    case 2: // Method
      return "method";
    case 3: // Function
      return "function";
    case 4: // Constructor
      return "method";
    case 5: // Field
    case 10: // Property
    case 20: // EnumMember
      return "field";
    default:
      return "other";
  }
}

/** vscode SymbolKind (0-indexed) -> the documentSymbol role membersOfType needs.
 *  C# containers are Class=4, Struct=22, Interface=10, Enum=9; members are
 *  Method=5, Constructor=8, Field=7, Property=6. */
export function csVscodeSymbolRole(kind: unknown): SymbolRole {
  switch (kind) {
    case 4: // Class
    case 22: // Struct
    case 10: // Interface
    case 9: // Enum
      return "container";
    case 5: // Method
    case 8: // Constructor
      return "method";
    case 6: // Property
    case 7: // Field
    case 13: // Constant
    case 21: // EnumMember
      return "field";
    default:
      return "other";
  }
}

/** Raw LSP SymbolKind (1-indexed) -> the documentSymbol role membersOfType
 *  needs. C# containers are Class=5, Struct=23, Interface=11, Enum=10; members
 *  are Method=6, Constructor=9, Field=8, Property=7, Constant=14, EnumMember=22.
 *  The vscode number PLUS ONE — the two field-ish cases (Constant, EnumMember)
 *  map to "field" in BOTH tables so an enum member reads identically across the
 *  two transports (the parity bar). */
export function csLspSymbolRole(kind: unknown): SymbolRole {
  switch (kind) {
    case 5: // Class
    case 23: // Struct
    case 11: // Interface
    case 10: // Enum
      return "container";
    case 6: // Method
    case 9: // Constructor
      return "method";
    case 7: // Property
    case 8: // Field
    case 14: // Constant
    case 22: // EnumMember
      return "field";
    default:
      return "other";
  }
}

/** The C# doc comment IMMEDIATELY above a declaration head — the C# doc
 *  channel. The Roslyn LS EXCLUDES `///` XML-doc lines (and `#region`) from
 *  range.start (PROVEN against a live Roslyn LS), so the range-based trivia
 *  slice is empty on a documented C# member and the doc never reaches the
 *  fn-gen prompt; this scans upward from the head instead. Recognizes a contiguous `///` XML-doc run and a
 *  `/** ... *` / `/* ... *` block comment ending on the line directly above the
 *  head — a blank or code line breaks the scan (the doc must be immediately
 *  above). A plain `//` line is NOT a doc (only `///` is C# XML doc), so a
 *  two-slash comment above the head is never swept in. undefined when there is
 *  none. Sibling of tsDocCommentAbove; the Rust in-range doc path is untouched. */
export function csDocCommentAbove(
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
  // A `///` XML-doc run: walk up while the line above is also a `///` line. `////`
  // and richer `/// <summary>` forms all start with the three-slash marker.
  if (endTrim.startsWith("///")) {
    let start = end;
    while (start - 1 >= 0 && getLine(start - 1).trim().startsWith("///")) {
      start--;
    }
    return collect(start);
  }
  // A `/* ... *` / `/** ... *` block comment closing on the line above: walk up
  // to its `/*` opener. A non-comment line inside the walk means it is not a
  // contiguous doc block (a trailing block comment on a code line is not a doc).
  if (endTrim.endsWith("*/")) {
    for (let start = end; start >= 0; start--) {
      const t = getLine(start).trim();
      if (t.startsWith("/*")) {
        return collect(start);
      }
      if (!/^[/*]/.test(t)) {
        return undefined;
      }
    }
    return undefined;
  }
  return undefined;
}

// C# BCL/framework container and primitive-wrapper type names that appear in
// signatures but are never a user type worth pre-resolving or a type-in-play to
// derive. C# primitives (int, string, bool) are lower-case and never match the
// PascalCase scan. The C# sibling of STD_TYPE_NAMES / TS_STD_TYPE_NAMES.
export const CS_STD_TYPE_NAMES = new Set([
  "String", "Object", "Boolean", "Char", "Byte", "SByte", "Int16", "UInt16",
  "Int32", "UInt32", "Int64", "UInt64", "Single", "Double", "Decimal", "Void",
  "Guid", "DateTime", "DateTimeOffset", "TimeSpan", "Uri", "Type", "Exception",
  "Task", "ValueTask", "List", "Dictionary", "HashSet", "Queue", "Stack",
  "IEnumerable", "IList", "ICollection", "IDictionary", "IReadOnlyList",
  "IReadOnlyCollection", "IReadOnlyDictionary", "KeyValuePair", "Array", "Span",
  "ReadOnlySpan", "Memory", "Nullable", "Tuple", "ValueTuple", "Func", "Action",
  "Predicate", "Comparer", "StringBuilder", "Stream", "CancellationToken",
]);

/** The distinct user types NAMED IN a resolved C# type's rendered member
 *  SIGNATURES — the return types, parameter types, and property types — for the
 *  cross-file shape walk's SIGNATURE-edge recursion. This is a DIFFERENT
 *  traversal than Rust's struct-FIELD recursion: a C# type hover is
 *  `class Atlas.Stripe` with no field body, so the collaborator graph a
 *  fluent/LINQ chain projects through is reachable only through the member
 *  signatures (`EnrollTile(Tile) : bool`, `PartitionByLod() : ... List<Tile>`,
 *  `Summarize(string?) : StripeSummary`).
 *
 *  Each rendered signature leads with the member's OWN name
 *  (`PartitionByLod(...)`, `TileTally : int`), which is NOT a referenced type, so
 *  the leading identifier is stripped before the PascalCase scan — otherwise
 *  `PartitionByLod`/`TileTally`/`Summarize` would be mined as phantom types. BCL
 *  container/wrapper names (CS_STD_TYPE_NAMES) and single-letter generics are
 *  filtered — the SAME stop-set the whole-block detector's csTypesInPlay uses,
 *  so `List`/`IReadOnlyDictionary`/`int`/`T` never queue. Deduped, first-seen
 *  order. GUARDRAIL: this mines ONLY signature-referenced types, never a `using`
 *  namespace — bulk using-injection is proven to backfire. */
export function csSignatureRefTypes(signatures: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sig of signatures) {
    // Drop the leading member-name identifier so the member's own name is never
    // mined as a type. A generic method's `<...>` clause survives the strip, but
    // its single-letter type params are filtered below like any generic.
    const body = sig.replace(/^\s*[A-Za-z_][A-Za-z0-9_]*/, "");
    for (const m of body.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
      const t = m[1];
      // A qualified type contributes only its LAST segment: `Atlas.Stripe` is the
      // type `Stripe`, and `Atlas` is a NAMESPACE, not a type — mining it costs a
      // wasted workspace/symbol round-trip and, worse, a `class Atlas` shadowing
      // the namespace would inject the wrong type. Skip a segment immediately
      // followed by `.<identifier>` (mirrors typesNamedIn's last-segment rule).
      if (/^\.[A-Za-z_]/.test(body.slice((m.index ?? 0) + m[0].length))) {
        continue;
      }
      if (seen.has(t) || CS_STD_TYPE_NAMES.has(t) || /^[A-Z]$/.test(t)) {
        continue;
      }
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** One workspace/symbol hit reduced to what the by-name resolution leg needs:
 *  the symbol NAME, its documentSymbol ROLE (via the transport's own role
 *  mapper — the vscode and LSP SymbolKind enums disagree), and the def location
 *  (its name-token cursor). Decoupled from the raw vscode/LSP shapes so the
 *  selection is pure and blind-testable over a fixed candidate list. */
export interface CsSymbolCandidate {
  name: string;
  role: SymbolRole;
  /** Where Roslyn reports the hit as living — the workspace/symbol
   *  `containerName`. It is what tells a same-name COLLISION (`Atlas.Stripe` vs
   *  `Rival.Stripe`) apart from a legit `partial class` (same name AND same
   *  container). Empty when absent.
   *
   *  DISPLAY TEXT, not a namespace: measured against the live Roslyn server it
   *  reads `project Contoso.LocalDb (net9.0)` for a top-level type and
   *  `in DpmDataFile (project Contoso.LocalDb (net9.0))` for a nested one. Two
   *  of these differing is real evidence of two different types; neither one on
   *  its own names a namespace, so nothing here parses it. */
  containerName: string;
  uri: string;
  line: number;
  character: number;
}

/** Pick the def cursor for a bare type NAME from workspace-symbol candidates.
 *  Roslyn's workspace/symbol is FUZZY — a query for "Stripe" also returns
 *  StripeSummary, StripeFanout, StripeMutatorSite — so this filters to the
 *  EXACT-name TYPE (role "container": class/struct/interface/enum/record),
 *  never a partial-name or non-type (method/field) hit.
 *
 *  AMBIGUITY IS FATAL, not tiebroken. If the exact-name types span more than one
 *  distinct namespace (`Atlas.Stripe` AND `Rival.Stripe`), there is no safe way
 *  to GUESS which the caller meant, so we resolve NOTHING rather than inject the
 *  WRONG type's members under a "use these exact names" header — the goal's
 *  single worst failure (a wrong surface took a std-correct task 8/8 -> 0/8).
 *  Honest no-resolution beats a wrong surface.
 *
 *  A caller holding EVIDENCE of which one it meant asks through
 *  `resolveCsTypeCursorWithHint` instead, which runs this first and only then
 *  spends round trips on the ambiguity. Nothing here was relaxed to make that
 *  work: this function's answer is what it always was.
 *
 *  `containerName` is Roslyn's own display string and is NOT a namespace — a
 *  top-level type reads `project Contoso.LocalDb (net9.0)` and a nested one
 *  `in DpmDataFile (project Contoso.LocalDb (net9.0))` (measured against the live
 *  server). It is used here only for INEQUALITY, which is all this needs and all
 *  a display string can honestly carry; anything wanting the real namespace has
 *  to hover the definition.
 *
 *  Multiple hits that share ONE namespace are the SAME type — a `partial class`
 *  split across files — and resolve fine (one location's cursor; the partial-
 *  member union across files is a separate, deferred concern). Among those it
 *  prefers a workspace (file://) location over decompiled metadata. undefined
 *  when no exact-name type exists, or when the name is genuinely ambiguous.
 *  Shared by both C# transports so they select identically. */
export function selectCsTypeCursor(candidates: CsSymbolCandidate[], name: string): SourceCursor | undefined {
  const exactTypes = exactCsTypeHits(candidates, name);
  if (exactTypes.length === 0) {
    return undefined;
  }
  const namespaces = new Set(exactTypes.map((c) => c.containerName));
  if (namespaces.size > 1) {
    return undefined; // ambiguous across containers — degrade, never guess
  }
  // A real workspace source location is a file:// URI that is NOT a decompiled
  // metadata-as-source file (Roslyn writes those under a `MetadataAsSource`
  // path, also file://). Prefer one; fall back to the first exact-name type when
  // only a metadata/other location exists. (In practice workspace/symbol only
  // returns loaded-project symbols, so the fallback is defensive.) With the
  // namespace now unambiguous, which same-type location wins is immaterial.
  const isWorkspaceLoc = (uri: string) => uri.startsWith("file:") && !/\/MetadataAsSource\//i.test(uri);
  const chosen = exactTypes.find((c) => isWorkspaceLoc(c.uri)) ?? exactTypes[0];
  return { uri: chosen.uri, line: chosen.line, character: chosen.character };
}

/** The exact-name TYPE hits among fuzzy workspace-symbol candidates, in the
 *  order a resolver should prefer them: a real workspace source location ahead
 *  of a decompiled metadata-as-source one (Roslyn writes those under a
 *  `MetadataAsSource` path, also file://). Shared by the single-answer selection
 *  and the disambiguating one so the two can never disagree about which hits are
 *  even in play. */
export function exactCsTypeHits(candidates: CsSymbolCandidate[], name: string): CsSymbolCandidate[] {
  const exact = candidates.filter((c) => c.name === name && c.role === "container");
  const isWorkspaceLoc = (uri: string) => uri.startsWith("file:") && !/\/MetadataAsSource\//i.test(uri);
  return [...exact.filter((c) => isWorkspaceLoc(c.uri)), ...exact.filter((c) => !isWorkspaceLoc(c.uri))];
}

/** `selectCsTypeCursor`, and then the ambiguity it refuses decided by EVIDENCE
 *  rather than left dark. Shared by both C# transports so the two resolve
 *  identically.
 *
 *  The unambiguous answer costs exactly what it always cost: this returns it
 *  without hovering anything. Only a name the selection REFUSED - a name two
 *  projects both declare - reaches the second half, and only when the caller
 *  brought something to decide it with. Measured on a real solution declaring
 *  `DataOrigin` and `ThreatLevel` twice each, that refusal took 27 of 31
 *  enum-typed FIM sites dark while the caller was already holding a hover
 *  reading `DataModel.Enums.DataOrigin`.
 *
 *  The decision is made on each candidate's OWN def hover (`enum
 *  Contoso.DataModel.Enums.DataOrigin`), never on the workspace-symbol
 *  containerName, which is a project display string rather than a namespace. One
 *  hover per ambiguous candidate, paid only at sites that are dark today.
 *
 *  Two kinds of evidence, in strict precedence, never combined:
 *
 *   1. `hint.container`: the caller SAW the type written under a namespace.
 *      Roslyn renders minimally qualified, so `DataModel.Enums` is a SUFFIX of
 *      the declared `Contoso.DataModel.Enums`, matched on a segment boundary. A
 *      container that fits two candidates decides nothing; one that fits none
 *      also refuses rather than falling through, because the caller's own
 *      evidence contradicting every candidate is a reason to trust it less.
 *   2. `hint.fileText` with no container: the type was written UNQUALIFIED where
 *      the caller saw it, and the buffer's imports say which candidates that
 *      could have meant. Sound in the same direction the compiler is - a file
 *      importing both namespaces cannot write the name bare at all (CS0104), so
 *      a bare occurrence that compiles has exactly one reachable candidate.
 *
 *  Either way the survivors must agree on ONE fully qualified name (two
 *  locations of a `partial` type do, two different types never do) or this
 *  refuses, exactly as the selection would have. */
export async function resolveCsTypeCursorWithHint(
  candidates: CsSymbolCandidate[],
  name: string,
  hint: TypeNameHint | undefined,
  defSignature: (cursor: SourceCursor) => Promise<string | undefined>,
): Promise<SourceCursor | undefined> {
  const unambiguous = selectCsTypeCursor(candidates, name);
  if (unambiguous !== undefined) {
    return unambiguous;
  }
  const container = hint?.container;
  const fileText = hint?.fileText;
  const hits = exactCsTypeHits(candidates, name);
  if (hits.length < 2 || (container === undefined && fileText === undefined)) {
    return undefined;
  }
  const survivors: Array<{ cursor: SourceCursor; declared: string }> = [];
  for (const hit of hits) {
    const cursor = { uri: hit.uri, line: hit.line, character: hit.character };
    const declared = csDeclaredTypeName(await defSignature(cursor));
    if (declared === undefined || declared.lastIndexOf(".") < 0) {
      continue;
    }
    const declaredContainer = declared.slice(0, declared.lastIndexOf("."));
    const fits =
      container !== undefined && container !== ""
        ? declaredContainer === container || declaredContainer.endsWith(`.${container}`)
        : fileText !== undefined && csFileReachesContainer(declaredContainer, fileText);
    if (fits) {
      survivors.push({ cursor, declared });
    }
  }
  return new Set(survivors.map((s) => s.declared)).size === 1 ? survivors[0].cursor : undefined;
}

/** True when a code-action title is Roslyn's fully-qualify action: the bare
 *  fully-qualified type name ("Newtonsoft.Json.Linq.JObject"), a dotted path of
 *  identifiers. This is the in-span rewrite the surface loop wants — NOT the
 *  competing "using ...;" auto-import (which writes a using line out of span, so
 *  it carries a space and a semicolon) and NOT "Generate type 'JObject'" /
 *  "Fix typo 'JObject'" (which carry spaces and quotes). A title with any
 *  whitespace, quote, or semicolon is rejected before the dotted-path test. */
export function isCsFullyQualifyTitle(title: string): boolean {
  if (/[\s';]/.test(title)) {
    return false;
  }
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(title);
}

/** True when a code action is Roslyn's AddImport auto-import — the one that adds
 *  a `using X;` DIRECTIVE at the top of the file (out of span), the C#-idiomatic
 *  fix for an unimported-but-reachable type (CS0246). This is the SEPARATE
 *  recognizer for the OUT-OF-SPAN path, deliberately NOT isCsFullyQualifyTitle's
 *  job (that owns the IN-SPAN `Atlas.Stripe` fully-qualify and correctly rejects
 *  this action's space+semicolon `using ...;` title).
 *
 *  The robust key is the action's structured `data.CustomTags` carrying
 *  "AddImport" (title-independent, PROVEN against the live Roslyn LS), cross-
 *  checked with the `using ...;` title shape so a future retagging cannot smuggle
 *  a non-import action through. FullyQualify (tag "FullyQualify", title
 *  "Atlas.Stripe"), "Generate type 'X'" and "Fix typo 'X'" all fail both checks.
 *
 *  The vscode command transport STRIPS the raw LSP `data` when it converts to a
 *  CodeAction, so on that path only the title survives; when CustomTags is absent
 *  the `using ...;` title is the best available signal and is accepted alone (the
 *  only Roslyn quickfix whose title is literally a using directive is AddImport).
 *  Accepts a loose action shape so both transports' raw objects feed it. */
/** One type's rendered members for the pre-fill graph render. */
export interface CsShapeType {
  name: string;
  methods: string[];
}

/** Render the C# pre-fill injection for a resolved type GRAPH: one "Members of
 *  `X`" block per type, in the given order (root first, then Fix-3's recursively-
 *  resolved collaborators so a method taking `Tile` is accompanied by `Tile`'s
 *  constructor). Renders what it is handed. A `_`-prefix filter stood in for
 *  accessibility here and was retired once the real modifier became readable
 *  upstream (`src/core/memberVisibility.ts`): a naming convention must not
 *  overrule the fact, and two filters answering the same question hide real API
 *  between them. Method-less types (an empty record/enum) render no block; each
 *  type is emitted once (deduped against `visited`, shared across candidates),
 *  bounded by `budget.remaining` chars, and reported through `onEmit`. The pure
 *  core of csShapeBlock — the vscode layer adapts the CrossFileShape and threads
 *  the shared walk state. undefined when no type contributes a block. */
export function csShapeGraphBlock(
  types: CsShapeType[],
  opts: {
    memberCap: number;
    visited: Set<string>;
    budget: { remaining: number };
    /** Each type that actually got a block, in render order. The caller cannot
     *  recover this from the returned string without parsing headers back out of
     *  what it just rendered, and the dedup and the budget both decide it here. */
    onEmit?: (name: string) => void;
    onTruncate?: (name: string, total: number, dropped: string[]) => void;
    onBudget?: (name: string) => void;
  },
): string | undefined {
  const blocks: string[] = [];
  for (const t of types) {
    if (opts.visited.has(t.name)) {
      continue;
    }
    let methods = t.methods;
    if (methods.length === 0) {
      // NOTHING TO RENDER IS STILL AN ANSWER, and the type is marked given.
      //
      // Two ways a type arrives here with no members: it genuinely has none, or
      // a data-shape block upstream already printed every line it had and the
      // caller shed them. Leaving it unmarked in either case means a LATER root
      // that reaches the same type sheds nothing from it (an earlier walk has
      // already claimed its def, so no def is rendered for it twice) and prints
      // its whole member list, out of a budget the first root was released from.
      // Measured by the session-v51 phase 0 review: a 4-field collaborator
      // shared by eight roots was paid for twice, and the tail root lost the
      // member list it had.
      //
      // Marking it costs nothing it would have rendered: the block this loop
      // would have emitted is empty either way.
      opts.visited.add(t.name);
      continue;
    }
    const total = methods.length;
    let header = `Members of \`${t.name}\` (real signatures, use these exact names, do not invent):`;
    if (methods.length > opts.memberCap) {
      const dropped = methods.slice(opts.memberCap);
      methods = methods.slice(0, opts.memberCap);
      header = `Members of \`${t.name}\` (a subset — the first ${opts.memberCap} of ${total}; real signatures, use these exact names, do not invent):`;
      opts.onTruncate?.(t.name, total, dropped);
    }
    // The fence is derived from the members, not handed in: a signature list a
    // hover leaked a fence marker into would otherwise close its own block.
    const body = methods.join("\n");
    const fence = fenceFor(body);
    const block = `${header}\n${fence}cs\n${body}\n${fence}`;
    if (block.length > opts.budget.remaining) {
      opts.onBudget?.(t.name);
      continue;
    }
    opts.visited.add(t.name);
    opts.budget.remaining -= block.length;
    opts.onEmit?.(t.name);
    blocks.push(block);
  }
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

export function isCsAddImportAction(action: { title?: unknown; data?: unknown }): boolean {
  const title = typeof action?.title === "string" ? action.title : "";
  // `using X;` and the file-scoped `global using X;` form; both are import
  // directives Roslyn's AddImport can title. Nothing else Roslyn offers for a
  // CS0246 is `using`-shaped (FullyQualify is a dotted path, Generate/Fix-typo
  // are prose), so the title shape alone is a safe fallback when CustomTags is
  // stripped by the vscode command transport. A `(` excludes a `using var x =
  // Open();` statement shape — an import directive never carries a call.
  const titleShaped = /^(?:global\s+)?using\s.+;$/.test(title) && !title.includes("(");
  const tags = (action?.data as { CustomTags?: unknown } | undefined)?.CustomTags;
  if (Array.isArray(tags)) {
    return tags.includes("AddImport") && titleShaped;
  }
  return titleShaped;
}

// ---------------------------------------------------------------------------
// Re-indent a generated C# body, the C# sibling of reindentPyBody. The model is
// handed a dedented header and replies flush-left; the splice needs every line
// after the header shifted by the header's indent, or the brace lands at column
// 0 and the body one level short (goal.md "broken indentation"). The ONE hard
// constraint: a physical line INSIDE a multi-line string literal must be
// byte-exact — shifting it changes the string's value. C# has three cross-line
// string/comment shapes to track: a verbatim string `@"..."` (a `""` escapes a
// quote), a raw string `"""..."""` (a run of >=3 quotes, closed by a run of the
// same length), and a `/* */` block comment (does NOT freeze the line — a
// comment line shifts fine — but a quote inside it must not open a string).
// Regular `"..."` strings and `'x'` char literals never span physical lines in
// C# (a newline inside is a compile error), so they carry no cross-line state.
//
// A verbatim string may be INTERPOLATED (`$@"..."` or `@$"..."`): a `{...}` hole
// carries C# code, where a `"` (e.g. `{x.ToString("C")}`) is NOT the string's
// close and a `{{`/`}}` is an escaped literal brace. The scan tracks hole depth
// so a quote inside a hole never mis-closes the string; a line whose start is
// inside a hole is CODE (shifted), a line inside the string TEXT is frozen.
// ---------------------------------------------------------------------------

/** One line-spanning string context. `holeDepth` is the brace depth inside an
 *  interpolated verbatim string's `{...}` holes; 0 means the scan is in that
 *  string's TEXT. A raw string carries no hole depth, because this scanner has
 *  never tracked holes inside one and widening that is not this phase.
 *
 *  That gap has a sharp edge, and it is worse than a shifted byte: in a raw
 *  INTERPOLATED string a hole holding a run of `>=` fence quotes closes the
 *  string early, so the closing delimiter's line is classified as code and
 *  re-indented away from its content, and the C# that comes out DOES NOT
 *  COMPILE (CS8999). Pre-existing, byte-identical before and after phase 13,
 *  filed as queue Q16b and pinned live by row A13-7 of
 *  `test/adversarial-v55-p13-scanner-stack.test.cjs`. */
type CsStrCtx =
  | { kind: "verbatim"; interp: boolean; holeDepth: number }
  | { kind: "raw"; fence: number; holeDepth: 0 };

interface CsLineScan {
  /** The open string contexts, innermost LAST. Empty means ordinary code.
   *
   *  A STACK rather than the flag set this used to be (`verbatim`,
   *  `verbatimInterp`, `holeDepth`, `raw`), and session-v55 phase 13 measured
   *  why a flag pair would not have been enough. C# nests string contexts
   *  through interpolation holes, and three shapes were wrong:
   *
   *  - a `@"..."` opened inside a hole was read with REGULAR string rules, so
   *    `\` was an escape and `""` was not, and a string spanning lines left the
   *    scan claiming "inside a hole" - which classifies the next line as CODE
   *    and re-indents bytes the developer wrote inside a literal;
   *  - a raw `"""` opened inside a hole was not seen at all, and the damage
   *    LEAKED: the value of the next unrelated `@"..."` in the same body changed;
   *  - a hole inside a nested interpolated verbatim (`$@"a{$@"b{c}"}"`) needs
   *    more than one level, which is exactly what a flag pair cannot hold.
   *
   *  Depth is bounded by the source's own nesting, so the stack is small. */
  open: CsStrCtx[];
  block: boolean; // inside a /* ... */ block comment spanning lines
}

/** Is the scan sitting in string TEXT - bytes a re-indent must not touch?
 *
 *  The innermost context decides, which is the whole point of the stack: inside
 *  an interpolated verbatim string's `{...}` hole the answer is NO, that is C#
 *  code and it moves, but inside a string opened WITHIN that hole it is yes
 *  again. Both callers ask this one question so the two directions cannot
 *  disagree about which bytes are a value. */
function csScanFrozen(s: CsLineScan): boolean {
  const top = s.open[s.open.length - 1];
  return top !== undefined && top.holeDepth === 0;
}

/** Index past a regular `"..."` string that opens at `i` (honoring `\"`); used
 *  inside an interpolation hole so a `}` in `"...}..."` does not pop the hole. */
function skipCsRegularString(line: string, i: number, n: number): number {
  i++;
  while (i < n) {
    if (line[i] === "\\") {
      i += 2;
      continue;
    }
    if (line[i] === '"') {
      return i + 1;
    }
    i++;
  }
  return i;
}

/** Index past a `'x'` char literal that opens at `i` (honoring `\'`). */
function skipCsCharLiteral(line: string, i: number, n: number): number {
  i++;
  while (i < n) {
    if (line[i] === "\\") {
      i += 2;
      continue;
    }
    if (line[i] === "'") {
      return i + 1;
    }
    i++;
  }
  return i;
}

/** The first index at or after `from` where a run of `>= fence` double-quotes
 *  begins, returning the index PAST that run (the raw string's close); -1 if the
 *  line holds no closing fence. */
function csRawClose(line: string, from: number, fence: number): number {
  for (let i = from; i < line.length; i++) {
    if (line[i] !== '"') {
      continue;
    }
    let q = 0;
    while (line[i + q] === '"') {
      q++;
    }
    if (q >= fence) {
      return i + q;
    }
    i += q - 1; // skip the short run; the loop's i++ lands past it
  }
  return -1;
}

/** Advance the cross-line scan state by one physical line, mirroring
 *  scanPyStringState: consume any carried string/comment, then scan the rest of
 *  the line as code, opening the shapes that can span into the next line. */
function advanceCsLineScan(line: string, s: CsLineScan): void {
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
    const top = s.open[s.open.length - 1];
    if (top?.kind === "raw") {
      const close = csRawClose(line, i, top.fence);
      if (close < 0) {
        return; // raw string continues to the next line
      }
      i = close;
      s.open.pop();
      continue;
    }
    if (top !== undefined && top.holeDepth === 0) {
      // VERBATIM STRING TEXT. `""` is the escape, `\` is a literal character,
      // and `{` opens a hole only when the string is interpolated.
      const ch = line[i];
      if (ch === '"') {
        if (line[i + 1] === '"') {
          i += 2; // "" is an escaped quote inside a verbatim string
          continue;
        }
        s.open.pop();
        i++;
        continue;
      }
      if (top.interp && ch === "{") {
        if (line[i + 1] === "{") {
          i += 2; // {{ is an escaped literal brace in the string text
          continue;
        }
        top.holeDepth = 1; // open an interpolation hole
        i++;
        continue;
      }
      if (top.interp && ch === "}" && line[i + 1] === "}") {
        i += 2; // }} is an escaped literal brace in the string text
        continue;
      }
      i++;
      continue;
    }
    // CODE: either nothing is open, or the innermost context is an interpolation
    // hole, whose contents are C#. ONE branch for both, which is what lets a
    // string opened inside a hole be recognised by the same openers that
    // recognise one at statement level - the defect this phase fixes was that
    // the hole had its own, shorter, list.
    //
    // What that shared list does NOT contain, at EITHER level, is `$"` - a
    // regular interpolated string. Its `{...}` hole is modelled nowhere, so a
    // `@"` opened inside one desynchronises the quote count and a later
    // string's value can move. The parity above is real, but it is parity with
    // a statement level that has the same hole; queue Q16c, pinned live by row
    // A13-8 of `test/adversarial-v55-p13-scanner-stack.test.cjs`.
    const inHole = top !== undefined;
    const c = line[i];
    const c2 = line[i + 1];
    // Comments are honoured at statement level only, exactly as before: a `//`
    // cannot legally appear inside an interpolation hole, and reading one there
    // would silence the rest of a line the old scanner still scanned.
    if (!inHole && c === "/" && c2 === "/") {
      return; // line comment: the rest of the line is inert
    }
    if (!inHole && c === "/" && c2 === "*") {
      s.block = true;
      i += 2;
      continue;
    }
    if (inHole && c === "{") {
      top.holeDepth++;
      i++;
      continue;
    }
    if (inHole && c === "}") {
      top.holeDepth--; // 0 puts the scan back in the enclosing string's TEXT
      i++;
      continue;
    }
    // Verbatim string openers: @" (plain), and the interpolated $@" / @$" forms.
    if (((c === "$" && c2 === "@") || (c === "@" && c2 === "$")) && line[i + 2] === '"') {
      s.open.push({ kind: "verbatim", interp: true, holeDepth: 0 });
      i += 3;
      continue;
    }
    if (c === "@" && c2 === '"') {
      s.open.push({ kind: "verbatim", interp: false, holeDepth: 0 });
      i += 2;
      continue;
    }
    if (c === '"') {
      let q = 0;
      while (line[i + q] === '"') {
        q++;
      }
      if (q >= 3) {
        s.open.push({ kind: "raw", fence: q, holeDepth: 0 }); // the carry above finds its close
        i += q;
        continue;
      }
      i = skipCsRegularString(line, i, n); // a regular "..." closes on this line
      continue;
    }
    if (c === "'") {
      i = skipCsCharLiteral(line, i, n); // a char literal 'x' / '\'' closes on this line
      continue;
    }
    i++;
  }
}

/** Re-indent a generated C# definition so a nested target's body lands at the
 *  right column. `indent` is the header line's leading whitespace. Line 1 (the
 *  header) is left as-is — it lands after the indent the document already holds
 *  before the span start. Every LATER line that is code (not inside a verbatim
 *  or raw multi-line string, not blank) gets `indent` prepended; a line inside
 *  such a string is byte-exact so its value never shifts. `indent === ""` (a
 *  top-level target, the Rust-shaped case) returns the text unchanged, byte for
 *  byte. The C# sibling of reindentPyBody. */
export function reindentCsBody(generated: string, indent: string): string {
  if (indent === "") {
    return generated;
  }
  const lines = generated.split("\n");
  const s: CsLineScan = { open: [], block: false };
  // The reply's own base column, off before the target's goes on: see reindent.ts.
  const base = replyBaseIndent(lines);
  const out: string[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    // Frozen (byte-exact) only inside string TEXT: a line whose start is inside a
    // verbatim string's {...} interpolation hole is code and still gets shifted.
    const frozen = csScanFrozen(s);
    if (frozen || line.trim() === "") {
      out.push(line);
    } else if (n === 0) {
      out.push(withoutBase(line, base));
    } else {
      out.push(indent + withoutBase(line, base));
    }
    advanceCsLineScan(line, s);
  }
  return out.join("\n");
}

/** Normalise C# code read out of a document to its own column zero, the inverse
 *  of reindentCsBody. Frozen on the same condition that leg freezes on: inside a
 *  verbatim string's TEXT (a line starting inside a `{...}` interpolation hole
 *  is code and moves) or inside a raw string, decided by the SAME scan, so the
 *  two directions can never disagree about which bytes are a string's value. */
export function dedentCsBody(code: string, known?: string): string {
  const lines = code.split("\n");
  const s: CsLineScan = { open: [], block: false };
  const byteExact: boolean[] = [];
  for (const line of lines) {
    // The state ENTERING the line, exactly as reindentCsBody reads it: the scan
    // advances only after the line has been classified.
    byteExact.push(csScanFrozen(s));
    advanceCsLineScan(line, s);
  }
  return dedentToZeroBase(lines, byteExact, known).join("\n");
}

/** A C# type's fields, derived from its RESOLVED MEMBERS rather than from its
 *  hover — the C# leg of the widened `parseFields` seam (session-v49 phase 2).
 *
 *  Roslyn writes a member as Name : Type, so the type is everything after the
 *  first ` : `. Only `field` members contribute: a method's signature carries a
 *  parameter list, not a field type, and a walk that took one would spend round
 *  trips on the types in a method's arguments — which is the SIGNATURE-edge
 *  traversal's job (`csSignatureRefTypes`), deliberately kept separate.
 *
 *  A member with no signature yields nothing rather than a guess. An enum's
 *  variants arrive exactly that way, which is why an enum contributes no fields
 *  here and keeps its own `enumMemberLine` spelling instead. */
/** A C# type's DEF as the data-shape block prints it (session-v50 phase 2).
 *
 *  A Roslyn class hover is `class Contoso.DataModel.RetroJob` and stops there, so
 *  until now C# had nothing to render but a head. The fields exist, they arrive
 *  on `membersOfType` and `csFieldsFromMembers` parses them, so the body is
 *  synthesised from what the walk derived rather than read from a hover that
 *  never had one.
 *
 *  The head is the hover VERBATIM, fully qualified as Roslyn wrote it. Shortening
 *  it would be inventing a spelling: `RetroJob` compiles only in a file that
 *  imports or sits inside that namespace, and this block is read by a model that
 *  cannot check which.
 *
 *  Fields keep Roslyn's own `Name : Type` order, which is what the member lines
 *  beside them already use, so a reader is not asked to hold two spellings of the
 *  same fact. A type with no derived fields renders its head alone, unchanged
 *  from today - an enum, an interface, a type whose members are all callables. */
export function csRenderDerivedDef(t: {
  name: string;
  signature: string;
  fields: ReadonlyArray<{ name: string; typeName: string }>;
}): string {
  const head = t.signature.length > 0 ? t.signature.trim() : `class ${t.name}`;
  if (t.fields.length === 0) {
    return head;
  }
  const body = t.fields.map((f) => `    ${f.name} : ${f.typeName}`).join("\n");
  return `${head} {\n${body}\n}`;
}

export function csFieldsFromMembers(
  members: readonly CompletionMember[],
): Array<{ name: string; typeName: string }> {
  const fields: Array<{ name: string; typeName: string }> = [];
  for (const m of members) {
    if (m.kind !== "field" || m.signature === undefined) {
      continue;
    }
    const at = m.signature.indexOf(" : ");
    if (at < 0) {
      continue;
    }
    const typeName = m.signature.slice(at + 3).trim();
    if (typeName.length > 0) {
      fields.push({ name: m.name, typeName });
    }
  }
  return fields;
}

/** A source cursor on the candidate type token within a C# field's own
 *  declaration, for the recursive hop.
 *
 *  C# writes the TYPE FIRST (`public List<DpmMonitor> Monitors { get; set; }`),
 *  which is why the Rust anchor — built for name: Type — finds nothing here.
 *  The field's declaration line is found by its own name, then the candidate is
 *  matched on that line.
 *
 *  Searching the WHOLE line, not just the part before the name, and that is
 *  deliberate: a back-reference field spells its own type
 *  (`public CustomerSite? CustomerSite { get; set; }`) and the first occurrence
 *  on the line is the type, which is the token that resolves. Anchoring inside
 *  the field's own declaration rather than searching the file by name is what
 *  makes `definition()` resolve the type in the declaring scope, so a same-named
 *  type elsewhere is never walked into.
 *
 *  undefined when the field or the candidate is not on a line of the type's own
 *  body — a stop edge, and the walk records every one of those. */
export function csFieldTypeCursor(
  lines: string[],
  range: { open: number; close: number },
  fieldName: string,
  candType: string,
): { line: number; character: number } | undefined {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declRe = new RegExp(`(?:^|\\W)${esc(fieldName)}\\s*(?:[;={]|=>|$)`);
  const candRe = new RegExp(`\\b${esc(candType)}\\b`);
  for (let i = range.open; i <= range.close && i < lines.length; i++) {
    const line = lines[i];
    if (!declRe.test(line)) {
      continue;
    }
    const m = candRe.exec(line);
    return m ? { line: i, character: m.index } : undefined;
  }
  return undefined;
}
