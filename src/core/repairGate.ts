/**
 * The repair-output member gate: where a repair round was handed a surface, the
 * text it hands back may not contradict that surface.
 *
 * The FIM leg has had this gate since v18 (ghostNamesMember, fimInject.ts) and
 * repair had none, so repair output faced only the compiler. The capture that
 * proved it (session-v28 goal item 1, capture B round 2): with nothing
 * disclosed the model invented `tile.LodBand`, the round cap ran out, and the
 * invention stayed in the human's file.
 *
 * Both legs below refuse on RESOLVED EVIDENCE and nothing else. A refusal costs
 * the human a round and leaves them where they started, so neither leg may fire
 * on a guess: no type inference happens here, and a type whose disclosed member
 * list was truncated never refuses anything. Lambda-interior member gating (what
 * type does `tile` have inside `Count(tile => ...)`) is deliberately NOT
 * attempted; it is a scout question, and the type-as-member leg closes the
 * captured invention without it.
 */

import { maskNonCode } from "./fimInject";

/** The member NAME a rendered signature line carries, or undefined when the
 *  line yields none. The renderers this reads produce several shapes across the
 *  four languages, and each is answered by POSITION rather than by language:
 *
 *    MortonCode : int                   Roslyn's property render, name FIRST
 *    Encloses(Tile) : bool              same, with a parameter list
 *    LodBand Tile.Band { get; }         a qualified member, the name after the dot
 *    LodBand.Continental = 0            an enum variant, same shape
 *    net_minor_units(&self) -> u64      a bare signature, the name leads the paren
 *    subtended_children                 a bare name, nothing to strip
 *
 *  The name-first shape is why the reading order matters and is not cosmetic.
 *  Taking the last identifier of the head reads `MortonCode : int` as `int` and
 *  `Band : LodBand` as `LodBand`, which both hides the real members from the
 *  gate AND makes it believe the type has a member named after the enum, which
 *  is precisely what disarms the type-as-member leg (found by the live replay).
 *
 *  A line it cannot read yields undefined and contributes nothing, which costs
 *  the gate a refusal it might have made and never causes one it should not. */
export function memberNameOf(signature: string): string | undefined {
  if (typeof signature !== "string") {
    return undefined;
  }
  // Roslyn marks an extension member with a leading `(extension)`. Left in, the
  // parenthesis reads as a parameter list and the whole line yields nothing, so
  // every extension member dropped out of a member set that still called itself
  // complete.
  const line = signature.trim().replace(/^\(extension\)\s*/, "");
  if (line === "") {
    return undefined;
  }
  // Everything from the first parameter list, indexer bracket, brace body or
  // value assignment on is about the member's type, never its name. The bracket
  // is why an indexer render (`this[int index] : Tile`) does not come back as
  // its own parameter's name.
  let head = line.split(/[({[=]/)[0];
  // A `:` separates the name from its type in the name-first renders. `::` is a
  // path separator, not that: it belongs to the qualified reading below.
  //
  // The blanking is TWO characters wide, because the index it produces is used
  // against the ORIGINAL string. A one-character stand-in shortens the text and
  // every offset past it points one character early, which mis-slices any line
  // carrying both a path separator and a later annotation colon.
  const colon = head.replace(/::/g, "  ").indexOf(":");
  if (colon >= 0) {
    head = head.slice(0, colon);
  }
  // A generic clause belongs to the member's type parameters, not its name: a
  // head of `Pick<T>` reads as `T` without this, which is a type parameter
  // masquerading as a member.
  head = head.replace(/<[^<>]*>\s*$/, "");
  // Qualified: the name is the last dotted segment.
  const dot = head.lastIndexOf(".");
  if (dot >= 0) {
    head = head.slice(dot + 1);
  }
  const bare = [...head.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)].pop();
  return bare ? bare[0] : undefined;
}

/** One type whose surface a repair prompt disclosed. */
export interface DisclosedType {
  name: string;
  /** Every member name the prompt showed for this type. */
  members: readonly string[];
  /** Whether `members` is the WHOLE surface: every name this type can answer
   *  to. Only a complete list may refuse anything.
   *
   *  The bar is deliberately high, and a resolver that enumerated a class's
   *  members does NOT clear it. Nested types, extension members, generic
   *  statics and partial declarations all add names a member walk never sees,
   *  and claiming completeness anyway refuses correct repairs: four classes,
   *  each measured (session-v28/triage-p1.md). What does clear it is a CLOSED
   *  set, which today means an enum's variants. */
  complete: boolean;
  /** The rendered member lines the prompt actually showed, verbatim. `members`
   *  is the names read out of these; the lines themselves carry the TYPES,
   *  which is what an operand-mismatch steer needs to answer "which member here
   *  is a LodBand". Absent from a leg that disclosed a type without enumerating
   *  it. */
  signatures?: readonly string[];
}

/** The disclosed members whose TYPE is `typeName`, rendered as `Owner.member`.
 *
 *  Exists for one measured failure. Given CS0019 ("operands of type 'int' and
 *  'LodBand'"), `Tile`'s whole member list and `LodBand`'s whole variant list,
 *  the 30b returned its input unchanged in ten runs out of ten: it would not
 *  swap `tile.Lod` for `tile.Band` on its own. Disclosure told it what exists;
 *  it did not tell it which member answers the type the compiler named. The
 *  match is on the member line's own text, so a member whose NAME merely
 *  contains the type name is not one of these. */
export function membersOfType(
  disclosed: readonly DisclosedType[],
  typeName: string,
): string[] {
  if (!IDENTIFIER.test(typeName)) {
    return [];
  }
  const out: string[] = [];
  for (const t of disclosed) {
    for (const line of t.signatures ?? []) {
      const name = memberNameOf(line);
      if (name === undefined || name === typeName) {
        continue;
      }
      // The type as a whole word, anywhere the render puts it: `Band : LodBand`,
      // `LodBand Tile.Band { get; }`, `band(&self) -> LodBand`. Two things are
      // struck out first, or the answer is circular: the OWNER's qualifier, so
      // `LodBand.Regional` does not read as a member of type LodBand, and the
      // member's own name.
      const withoutName = line
        .split(new RegExp(`\\b${t.name}\\s*\\.\\s*`))
        .join(" ")
        .split(new RegExp(`\\b${name}\\b`))
        .join(" ");
      if (new RegExp(`\\b${typeName}\\b`).test(withoutName)) {
        out.push(`${t.name}.${name}`);
      }
    }
  }
  return out;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Every `receiver.member` access the text makes, in source order. Reads the
 *  masked text, so an access written inside a comment or a string literal is
 *  prose and not a call. The receiver is the identifier immediately left of the
 *  separator; a chained access (`a.b.c`) contributes `a.b` and `b.c`, which is
 *  the honest reading - `c` is a member of whatever `b` returned.
 *
 *  `::` counts as a separator, not only `.`. Rust spells every static and every
 *  enum variant that way, so a reader that knows only `.` cannot see the Rust
 *  spelling of the very shape this file exists to catch. Which of the two it was
 *  is REPORTED rather than discarded: the static leg wants both, and the
 *  type-as-member leg is only sound for `.`. */
function memberAccesses(code: string): Array<{ receiver: string; member: string; qualified: boolean }> {
  const masked = maskNonCode(code);
  const out: Array<{ receiver: string; member: string; qualified: boolean }> = [];
  // The SEPARATOR is carried, because the two legs below need different things
  // from it. `::` is a path qualifier and a static access; `.` is a member access
  // on a value. Collapsing them was a real refusal of correct code: see the
  // type-as-member leg.
  const pattern = /([A-Za-z_$][A-Za-z0-9_$]*)\s*(::|\.)\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
  for (const m of masked.matchAll(pattern)) {
    out.push({ receiver: m[1], member: m[3], qualified: m[2] === "::" });
  }
  return out;
}

/**
 * The reason this repair contradicts its own disclosed surface, or undefined
 * when it does not. Pure, language-neutral, never throws.
 *
 * BOTH legs refuse only against a type whose member list is COMPLETE, and the
 * caller owes the truth about that. See `DisclosedType.complete`: a class's
 * enumerated members are not a complete list, an enum's variants are.
 *
 * Static leg: `T.M` (or `T::M`) where `T` is a disclosed type and `M` is not one
 * of its members. The receiver IS the type, so no inference is involved.
 *
 * Type-as-member leg: `x.T` where `T` is a disclosed TYPE name, `x` reads as a
 * VALUE, and no disclosed type carries a member of that name. A type is not a
 * member of a value. A nested-type reference (`Outer.Inner`) has a type for a
 * receiver and is answered by the static leg instead; a qualified spelling
 * (`Enums.JobStatus`) has a namespace for a receiver and is answered by nobody.
 *
 * DOT ONLY. The type-as-member leg reads `.` and never `::`, because a `::`
 * receiver is a path qualifier rather than a value and the rule it enforces is
 * about values. The static leg still reads both.
 */
export function undisclosedMemberRefusal(
  code: string,
  disclosed: readonly DisclosedType[],
): string | undefined {
  if (typeof code !== "string" || code === "" || !Array.isArray(disclosed) || disclosed.length === 0) {
    return undefined;
  }
  const byName = new Map<string, DisclosedType>();
  for (const t of disclosed) {
    if (t && typeof t.name === "string" && IDENTIFIER.test(t.name) && Array.isArray(t.members)) {
      byName.set(t.name, t);
    }
  }
  if (byName.size === 0) {
    return undefined;
  }
  // Every member name any disclosed type carries. A name in here is a real
  // member somewhere, which is what keeps the type-as-member leg off a property
  // legitimately named after its own type.
  const anyMember = new Set<string>();
  for (const t of byName.values()) {
    for (const m of t.members) {
      anyMember.add(m);
    }
  }
  for (const { receiver, member, qualified } of memberAccesses(code)) {
    const asType = byName.get(receiver);
    if (asType !== undefined) {
      if (asType.complete && !asType.members.includes(member)) {
        return `\`${receiver}.${member}\` names a member \`${asType.name}\` does not have (disclosed: ${asType.members.join(", ")})`;
      }
      continue;
    }
    // A `::` PATH is not a member access on a value, so the type-as-member leg
    // below must not read it as one. `rcgen::DnType::OrganizationName` is the
    // correct way to name a crate's enum, and the gate refused it: `rcgen` is
    // lowercase so it survived the namespace guard, `DnType` was a disclosed
    // complete enum, and the whole repair round was thrown away for writing valid
    // Rust. The capitalization guard cannot catch this, because Rust crate names
    // are lowercase by convention - which is to say the guard was tuned on C#
    // (`Enums.JobStatus`) and does not transfer.
    //
    // Nothing is lost. A `::` receiver that IS a disclosed type was already
    // answered by the static leg above, which is the leg that should own it.
    if (qualified) {
      continue;
    }
    // The leg's rule is that a type is not a member of a VALUE, so the receiver
    // has to be one. A receiver spelled with a leading capital is a namespace or
    // a type in every language this product serves, and `Enums.JobStatus` is
    // then correct code the gate would refuse: measured at 2 of 60 pristine
    // spans in a real C# solution, each costing the human a repair round for
    // writing the qualified spelling. A disclosed-type receiver never reaches
    // here (the static leg above took it), so what this drops is the undisclosed
    // capitalized receiver, where the gate is guessing rather than reading.
    if (/^[A-Z]/.test(receiver)) {
      continue;
    }
    // A type whose member list came back EMPTY proves nothing about anything, so
    // it may not power a refusal even by lending its name.
    const named = byName.get(member);
    if (named !== undefined && named.complete && named.members.length > 0 && !anyMember.has(member)) {
      return `\`${receiver}.${member}\` names the disclosed type \`${member}\` as a member of a value`;
    }
  }
  return undefined;
}
