/**
 * The C# leg of the TDD language seam, the last one built.
 *
 * The goal calls this the hardest leg and expected it to argue with the design.
 * It does, and four things make it unlike the four legs before it:
 *
 *  1. **THE ASSERTION ORDER INVERTS.** `Assert.AreEqual(expected, actual)` puts
 *     the expected value FIRST, where Rust's `assert_eq!` puts it second. Point
 *     the shipped Rust locator at MSTest and it blanks the CALL UNDER TEST and
 *     keeps the model's guessed value: the blank-value invariant inverted, which
 *     makes the product lie rather than merely break. Three frameworks, three
 *     locators, and NUnit hides the expected value inside `Is.EqualTo(…)`.
 *  2. **The target lives in a different PROJECT.** `runRoot` is the TEST
 *     project's directory, not the source project's, which is the case that
 *     forced the rung to take a resolved placement rather than a file path. The
 *     test project is FOUND, never created: that is the human's stated boundary.
 *  3. **FOUR no-run outcomes, not three.** Test failure, filter miss (exit 0,
 *     the silent false green), compile failure, and a MISSING RUNTIME which is
 *     C#'s alone. Today all four report "the tests did not compile".
 *  4. **It refuses everything on its corpus and ships anyway.** MEASURED on
 *     `contoso/data-processing/dotnet`: 0 of 251 methods survive, the worst of
 *     the five, and only 4 would survive if every method were public and static.
 *     The clearest blind-test targets there, `GapsOverlap` and
 *     `RemoveOverlappingGaps`, are both `private`, and `InternalsVisibleTo`
 *     appears nowhere in the solution. The human ruled all four languages ship
 *     exactly as specified (Amendment 1). RELAXING A LEG TO MANUFACTURE
 *     SURVIVORS IS A DECISION FOR THE HUMAN, not a change to make here.
 *
 * Never imports vscode (the src/core rule). No contract file for C# survived
 * the build; this module's own comments are the primary source, and
 * docs/architecture/tdd-language-seam.md records that and what is established
 * elsewhere.
 */

import * as os from "os";
import * as path from "path";
import type { TestCaseResult, TestFailureDetail, TestOutcome } from "./compilerOracle";
import type { FailureLocation } from "./failureDigest";
import { CsOracle, dotnetEnv } from "./csOracle";
import {
  LiteralProfile,
  TestInsertionPlan,
  matchDelim as matchDelimIn,
  reindent,
  skipLiteralOrComment,
  testMarkers,
  topLevelArgs,
} from "./testAssembly";
import type { TestabilityVerdict } from "./testability";
import { BlankValueResult, escapeSnippet } from "./tabstop";
import {
  PlacementRefusal,
  PlacementResult,
  ScaffoldInput,
  TddDeps,
  TddLang,
  TestFramework,
  TestPlacement,
  TestRunCommand,
  TestRunParse,
  fileExistsOf,
  readDirOf,
  readFileOf,
} from "./tddLang";
import { XmlTag, attrNumber, elementText, scanXmlTags } from "./xmlReader";

// ===========================================================================
// The C# literal profile
// ===========================================================================

/**
 * C# against the shared scanner, and it has the RICHEST string syntax of the
 * five languages. Every flag here is opt-in and defaults off, exactly as Go's,
 * TypeScript's and Python's did, so the other four legs read identical bytes.
 *
 *  - `verbatimStrings`: `@"C:\path"`, where `""` is the escaped quote and a
 *    backslash is ordinary. Both readings of a backslash lose spans, in opposite
 *    directions.
 *  - `csRawStrings`: `"""…"""`, no escapes at all, closed by the fence length.
 *  - `dollarInterpolation`: `$"{a} and {b}"`, whose `{…}` hold expressions that
 *    may themselves contain strings.
 *  - `nestedBlockComments: false`: C# block comments do NOT nest, unlike Rust's.
 *
 * `singleQuoteStrings` stays FALSE: `'a'` is a char literal in C# as in Rust,
 * and the shared scanner's char-literal branch already reads it. C# has no
 * lifetimes, so the Rust ambiguity that branch guards against cannot arise here.
 */
export const CS_LITERALS: LiteralProfile = {
  verbatimStrings: true,
  csRawStrings: true,
  dollarInterpolation: true,
  nestedBlockComments: false,
};

const OPENERS = "([{";
const CLOSERS = ")]}";

function matchDelim(text: string, open: number): number {
  return matchDelimIn(text, open, CS_LITERALS);
}

function isIdentChar(c: string): boolean {
  return /[\w$]/.test(c ?? "");
}

/** What may appear inside a GENERIC ARGUMENT LIST and nothing else: identifier
 *  characters, the separators, the nested brackets a type argument may carry,
 *  and whitespace. */
const CS_TYPE_ARG_CHAR = /[\w\s,.<>[\]?*():]/;

/**
 * The `>` matching the `<` at `open`, or -1 when the `<` is not a generic
 * argument list at all.
 *
 * The seam's shared depth scanner counts `()`, `[]` and `{}` and NOT `<>`,
 * because angle brackets are ambiguous with comparison in every language that
 * has both — which is exactly why the seam left them out. C# is the one leg that
 * cannot avoid them: the return type sits before the method name, so
 * `List<DtoGapAnalysis> RemoveOverlappingGaps(List<DtoGapAnalysis> gaps)` needs
 * the generic list closed before the NAME can be found at all. Handing that `<`
 * to the paren scanner ran the "type" all the way to the parameter list's `)`
 * and swallowed the method name with it.
 *
 * The ambiguity is resolved by the CHARACTER SET rather than by a parse: a
 * generic argument list holds only type syntax, so the first character that is
 * not type syntax (`&&`, `=`, a quote, a newline of ordinary code) means the `<`
 * was a comparison and the answer is -1. `>>` closes two levels, which is how
 * `List<List<int>>` is written.
 */
function matchAngle(text: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const c = text[i];
    if (c === "<") {
      depth++;
    } else if (c === ">") {
      depth--;
      if (depth === 0) {
        return i;
      }
    } else if (!CS_TYPE_ARG_CHAR.test(c)) {
      return -1;
    }
    i++;
  }
  return -1;
}

/** Past whitespace INCLUDING newlines: a C# signature is routinely spread over
 *  several lines, and a scanner that stops at the line end reads the return type
 *  as the whole declaration. */
function skipWs(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) {
    i++;
  }
  return i;
}

/** Past any run of `[…]` ATTRIBUTES and the whitespace around them. Bracket
 *  depth, not `indexOf("]")`, so `[Description("]")]` ends where it really
 *  ends. */
function skipAttributes(text: string, i: number): number {
  for (;;) {
    const at = skipWs(text, i);
    if (text[at] !== "[") {
      return at;
    }
    const close = matchDelim(text, at);
    if (close === -1) {
      return at;
    }
    i = close + 1;
  }
}

// ===========================================================================
// The declaration head
// ===========================================================================

/**
 * The modifiers the contract names. Deliberately CLOSED: an unknown word ends
 * the modifier run and becomes the return type, which is the safe direction —
 * an unrecognised modifier yields no method rather than a wrong one.
 *
 * Stated residual: `ref` returns (`public ref int Slot()`) are not in this set,
 * so `ref` reads as the type, `int` as the name, and the head does not parse.
 * That answers `undefined` rather than answering wrongly, and a ref return is
 * not a blind-unit-test target in any case.
 */
/**
 * The keywords that make a declaration a TYPE rather than a method, and every
 * one of them is a live false positive rather than a defensive guess.
 *
 * C# 12 primary constructors put a parameter list directly on the type:
 * `public class EventMetadata(Dictionary<string, Monitor> byHash)` matches
 * `modifiers TYPE NAME (` exactly, with `class` read as the return type — found
 * in the corpus on the first measurement pass. `record`, `struct` and
 * `delegate int F(int x);` are the same shape.
 */
const CS_TYPE_KEYWORDS = new Set(["class", "struct", "record", "interface", "enum", "delegate", "namespace", "using", "return", "throw", "yield"]);

const CS_MODIFIERS = new Set([
  "public",
  "private",
  "protected",
  "internal",
  "static",
  "virtual",
  "override",
  "sealed",
  "abstract",
  "extern",
  "unsafe",
  "new",
  "partial",
  "async",
]);

/**
 * The end of the TYPE REFERENCE starting at `i`, or -1.
 *
 * Depth-counted, never split on whitespace, because C# type syntax is full of
 * the characters a naive split breaks on: `Dictionary<int, ShiftHour>` holds a
 * comma, `(int, string)` holds parens AND a comma, `List<Dictionary<K, V>>`
 * nests, and `int[,]` holds a comma inside brackets. The seam's shared depth
 * scanner does the counting; this is the fifth language to use it and there is
 * no sixth scanner.
 */
function readTypeRef(text: string, i: number): number {
  // A TUPLE type is the case that makes finding "the parameter list's `(`" by
  // indexOf wrong: `public (int, string) Split(int n)` has two `(` and the
  // FIRST one belongs to the return type.
  if (text[i] === "(") {
    const close = matchDelim(text, i);
    if (close === -1) {
      return -1;
    }
    i = close + 1;
  } else {
    const nameM = /^[A-Za-z_]\w*/.exec(text.slice(i));
    if (nameM === null) {
      return -1;
    }
    i += nameM[0].length;
    for (;;) {
      if (text[i] === "<") {
        const close = matchAngle(text, i);
        if (close === -1) {
          return -1;
        }
        i = close + 1;
        continue;
      }
      // `global::System.Text` and `A.B.C`, one qualifier at a time.
      const sep = text[i] === ":" && text[i + 1] === ":" ? 2 : text[i] === "." ? 1 : 0;
      if (sep === 0) {
        break;
      }
      const next = /^[A-Za-z_]\w*/.exec(text.slice(i + sep));
      if (next === null) {
        break;
      }
      i += sep + next[0].length;
    }
  }
  // The suffixes: nullable `?`, pointer `*`, and array ranks `[]` / `[,]`.
  for (;;) {
    if (text[i] === "?" || text[i] === "*") {
      i++;
      continue;
    }
    if (text[i] === "[") {
      const close = matchDelim(text, i);
      if (close === -1) {
        return i;
      }
      i = close + 1;
      continue;
    }
    return i;
  }
}

export interface CsMethodHead {
  /** As written, `void` included. */
  returnType: string;
  /** `Widen`, `Identity<T>`, or `IFoo.Bar` for an explicit interface
   *  implementation. */
  name: string;
  modifiers: string[];
  /** Index of the `(` opening the parameter list. */
  paramsOpen: number;
}

/**
 * The METHOD declaration starting at `from`, or undefined when there is not one
 * there.
 *
 * Structure, not a regex, and the shape it has to get right is `modifiers TYPE
 * NAME (`. What makes that hard is that C# writes the return type BEFORE the
 * name with no `->` anywhere, so the only thing separating a method from a
 * constructor is whether a NAME follows the type:
 *
 *   public static int Widen(int n)     -> type `int`,  name `Widen`
 *   public Foo(int a)                  -> type `Foo`,  NO name, so undefined
 *
 * That false positive was found during the refusal-rate measurement, where it
 * read every constructor as a method returning `public`, and fixing it took the
 * corpus count from 300 to 251. Constructors are excluded by construction here,
 * not by a special case.
 *
 * A local variable declaration and a bare call answer undefined for the same
 * reason: `var x = Widen(3);` has `=` where the `(` must be, and `Widen(3);`
 * parses `Widen` as the type and then finds `(` with no name in between.
 */
export function csMethodHead(text: string, from = 0): CsMethodHead | undefined {
  let i = skipAttributes(text, from);
  const modifiers: string[] = [];
  for (;;) {
    const at = skipWs(text, i);
    const word = /^[A-Za-z_]\w*/.exec(text.slice(at));
    if (word === null || !CS_MODIFIERS.has(word[0])) {
      i = at;
      break;
    }
    modifiers.push(word[0]);
    i = at + word[0].length;
  }
  const typeStart = skipWs(text, i);
  const typeEnd = readTypeRef(text, typeStart);
  if (typeEnd === -1) {
    return undefined;
  }
  const nameStart = skipWs(text, typeEnd);
  const nameEnd = readTypeRef(text, nameStart);
  if (nameEnd === -1) {
    return undefined;
  }
  const paramsOpen = skipWs(text, nameEnd);
  if (text[paramsOpen] !== "(") {
    return undefined;
  }
  const returnType = text.slice(typeStart, typeEnd).trim();
  if (CS_TYPE_KEYWORDS.has(returnType)) {
    return undefined;
  }
  return { returnType, name: text.slice(nameStart, nameEnd).trim(), modifiers, paramsOpen };
}

/**
 * The return type text of a C# method signature, or undefined for `void` and
 * for anything that is not a method declaration.
 *
 * C# HAS NO `->` AT ALL, so the shipped Rust regex answers undefined for every
 * C# method and the gesture would report "returns no value to assert" on the
 * whole language. The type precedes the name:
 *
 *   public static int Widen(int n)                                -> "int"
 *   private static List<DtoGapAnalysis> Remove(List<T> gaps)      -> "List<DtoGapAnalysis>"
 *   public static Dictionary<int, ShiftHour> Make(CustomerSite s) -> "Dictionary<int, ShiftHour>"
 *   public static long ToUnixTimeSeconds(this DateTime input)     -> "long"
 *   public (int, string) Split(int n)                             -> "(int, string)"
 *   public void Apply(int n)                                      -> undefined
 *
 * `void` answers undefined per supersession S1's reasoning, which this session
 * ratified for Rust and every leg has kept: a unit return is nothing to assert
 * on, so the consumer's "returns no value to assert" gate must be able to fire.
 */
export function csReturnTypeOf(signature: string): string | undefined {
  const head = csMethodHead(signature ?? "", 0);
  if (head === undefined) {
    return undefined;
  }
  const ty = head.returnType;
  return ty.length === 0 || ty === "void" ? undefined : ty;
}

// ===========================================================================
// Testability
// ===========================================================================

/** `Task`, `Task<T>`, `ValueTask` and `ValueTask<T>`: the return types that mean
 *  "async" to a caller whether or not the `async` modifier is spelled. */
const CS_ASYNC_RETURN = /^(Task|ValueTask)\s*(<|$)/;

/**
 * The IO/network marker set, from the contract.
 *
 * MEASURED 0 on the Contoso corpus, AND THAT ZERO IS FALSE.
 * `GetMD5HashFromFile(string filename)` opens a file in its BODY and passes this
 * leg, because `classifyTestability` sees a signature and never a body. The same
 * false zero shows in Python for the same reason. Shared with the product's
 * shipped Rust classifier, not fixable here, and written down so nobody files it
 * as a bug against this leg.
 *
 * Word-bounded on both sides, which is the honest bound rather than an
 * oversight: `MemoryStream` and `FileStream` do not match, and neither does the
 * corpus class `FileLoading`. Widening the left side would catch the first two
 * and refuse a great deal else besides.
 */
const CS_IO = /\b(Stream|File|FileInfo|HttpClient|Socket|DbConnection)\b/;

/**
 * Classify a C# method as a blind-unit-test target or an honest failure.
 * First-match-wins over the same FIXED precedence as every other leg, so the
 * reported reason is stable: async → io → needs-fixture → not-exported →
 * underspecified → testable. Pure; never throws.
 *
 * MEASURED on `contoso/data-processing/dotnet`, 251 methods: not-exported 108
 * (43.0%), async 70, needs-fixture 55, underspecified 18, io 0, testable ZERO.
 * Read the file header before touching any leg here.
 *
 * `ctx.internalsVisible` is the one fact a signature cannot show, and it is why
 * Amendment 8a widened the seam: whether an `internal` member is reachable is a
 * property of the source PROJECT, not of the method. `csInternalsVisibleTo`
 * answers it by matching the grant's ARGUMENT against the test assembly's name,
 * because a grant to some other assembly grants the test project nothing;
 * absent means NOT visible, which is both the
 * safe default and the measured truth of the corpus, where `InternalsVisibleTo`
 * appears nowhere (grepped across `.cs` and `.csproj`, zero hits).
 *
 * WHAT CAN AND CANNOT REACH `not-exported`, because Amendment 5 exists for
 * exactly this and the detail must name a fix the human can PERFORM. Only a
 * non-`public` STATIC method reaches this leg, since every instance method is
 * refused as `needs-fixture` first. So the fix offered is always `public`, and
 * always performable. C#'s equivalent of the class-property trap Amendment 5
 * corrected — an explicit interface implementation, which cannot be made public
 * by any edit — is an instance member by definition and never gets here.
 *
 * Stated residual: a `public static` method on an `internal` class is reported
 * as reachable, because the signature does not carry its container. That
 * over-ACCEPTS, and it is the one direction here that is not conservative.
 */
export function classifyCsTestability(
  signature: string,
  docComment?: string,
  ctx?: { internalsVisible?: boolean },
): TestabilityVerdict {
  const sig = signature ?? "";
  const head = csMethodHead(sig, 0);
  const modifiers = head?.modifiers ?? [];
  const returnType = head?.returnType ?? "";

  if (modifiers.includes("async") || CS_ASYNC_RETURN.test(returnType)) {
    return {
      testable: false,
      reason: "async",
      detail: "async, or a Task/ValueTask return: a blind unit test cannot drive it",
    };
  }
  if (CS_IO.test(sig)) {
    return {
      testable: false,
      reason: "io",
      detail: "IO/network in the signature (Stream, File, HttpClient, Socket, DbConnection): integration territory, not a blind unit test",
    };
  }
  if (head === undefined) {
    // Not a method declaration this leg can read. Honest-dark rather than a
    // verdict assembled out of a failed parse.
    return { testable: false, reason: "underspecified", detail: "not a readable C# method signature: nothing to author a blind test from" };
  }
  if (!modifiers.includes("static")) {
    return {
      testable: false,
      reason: "needs-fixture",
      detail: "instance method: needs a constructed receiver, which a blind unit test has no contract for",
    };
  }
  if (!modifiers.includes("public")) {
    const declared = ["private", "protected", "internal"].filter((m) => modifiers.includes(m));
    if (declared.includes("internal") && !declared.includes("protected") && ctx?.internalsVisible === true) {
      // Reachable after all: the source assembly grants the test assembly access.
    } else {
      return { testable: false, reason: "not-exported", detail: notExportedDetail(declared) };
    }
  }
  if (docComment === undefined || docComment.trim() === "") {
    return { testable: false, reason: "underspecified", detail: "no `///` doc comment: no contract to author a blind test from" };
  }
  if (returnType === "void" || returnType.length === 0) {
    return { testable: false, reason: "underspecified", detail: "returns `void`: nothing to assert on" };
  }
  return { testable: true };
}

/** The `not-exported` sentence, and every branch of it names an edit the human
 *  can actually make. Amendment 5's rule: a refusal the human cannot act on is
 *  worse than one they can. */
function notExportedDetail(declared: string[]): string {
  const test = "the test project reaches this method through an assembly reference, and";
  if (declared.includes("internal")) {
    return (
      `${test} \`internal\` is not visible across assemblies. Make it \`public\`, or add ` +
      '`[assembly: InternalsVisibleTo("<your test project>")]` to this project.'
    );
  }
  if (declared.includes("protected")) {
    return `${test} \`protected\` is only reachable from a subclass. Make it \`public\` to test it directly.`;
  }
  if (declared.includes("private")) {
    return `${test} \`private\` is not visible outside its own type. Make it \`public\`.`;
  }
  // No access modifier at all: a class member defaults to `private` in C#.
  return `${test} a member with no access modifier is \`private\` by default. Make it \`public\`.`;
}

/** XML comments blanked, so a grant someone commented out years ago is not read
 *  as a live one. Length-preserving is not needed here; nothing downstream uses
 *  offsets into this text. */
function withoutXmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, " ");
}

/** C# comments blanked with the shared literal-aware scanner, which is the only
 *  reader that knows a `//` inside a string is not a comment and that `@"a//b"`
 *  has no comment in it at all. */
function withoutCsComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, CS_LITERALS);
    if (skipped > i) {
      const chunk = text.slice(i, skipped);
      out += /^(\/\/|\/\*)/.test(chunk) ? " " : chunk;
      i = skipped;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/** The assembly names an `InternalsVisibleTo` grant names, in all three
 *  spellings a project uses: the MSBuild item SDK 8+ supports, the raw
 *  `<AssemblyAttribute>` escape hatch, and the `[assembly: …]` attribute in an
 *  `AssemblyInfo.cs`.
 *
 *  A grant may carry a strong-name key (`"Tests, PublicKey=0024…"`); the
 *  assembly NAME is the part before the first comma. */
function internalsVisibleGrants(text: string, isProject: boolean): string[] {
  const stripped = isProject ? withoutXmlComments(text) : withoutCsComments(text);
  const names: string[] = [];
  if (isProject) {
    for (const m of stripped.matchAll(/<InternalsVisibleTo\b[^>]*\bInclude\s*=\s*"([^"]*)"/gi)) {
      names.push(m[1]);
    }
    for (const m of stripped.matchAll(
      /<AssemblyAttribute\b[^>]*\bInclude\s*=\s*"[^"]*InternalsVisibleTo"[^>]*>([\s\S]*?)<\/AssemblyAttribute\s*>/gi,
    )) {
      for (const p of m[1].matchAll(/<_Parameter\d+>([^<]*)<\/_Parameter\d+\s*>/gi)) {
        names.push(p[1]);
      }
    }
  } else {
    for (const m of stripped.matchAll(/InternalsVisibleTo\s*\(\s*[@$]{0,2}"([^"]*)"/g)) {
      names.push(m[1]);
    }
  }
  return names.map((n) => n.split(",")[0].trim()).filter((n) => n.length > 0);
}

/**
 * Does the project at `projectDir` grant its internals to `testAssemblyName`?
 *
 * THE GRANT'S ARGUMENT IS THE ANSWER, not the presence of the word. A project
 * that opens its internals to a benchmark harness, an analyzer or a sibling
 * library grants the TEST project nothing, and reading a bare
 * `/InternalsVisibleTo/` hit as a grant makes the classifier call an `internal
 * static` method testable, write a test the test assembly cannot compile, and
 * hand the human a CS0122 they did not cause.
 *
 * No `testAssemblyName` means no assembly to match, so the answer is false: the
 * caller could not say who is asking, and not-visible is the safe default the
 * whole visibility leg is built on. Checked in the `.csproj`, in any
 * `AssemblyInfo.cs` at the project root and in `Properties/`.
 *
 * Exported rather than folded into the classifier because the seam's
 * `classifyTestability` carries no deps and this question needs the filesystem.
 * A caller that holds both passes the answer through
 * `classifyCsTestability(sig, doc, { internalsVisible })`.
 *
 * MEASURED: zero hits anywhere in `contoso/data-processing`, so on the corpus of
 * record this always answers false.
 */
export function csInternalsVisibleTo(projectDir: string, deps: TddDeps, testAssemblyName?: string): boolean {
  const wanted = (testAssemblyName ?? "").trim().toLowerCase();
  if (wanted.length === 0) {
    return false;
  }
  const readFile = readFileOf(deps);
  const readDir = readDirOf(deps);
  const grantsIn = (file: string, isProject: boolean): boolean =>
    internalsVisibleGrants(readFile(file) ?? "", isProject).some((n) => n.toLowerCase() === wanted);

  for (const name of readDir(projectDir) ?? []) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".csproj") && grantsIn(path.join(projectDir, name), true)) {
      return true;
    }
    if ((lower === "assemblyinfo.cs" || lower === "globalassemblyinfo.cs") && grantsIn(path.join(projectDir, name), false)) {
      return true;
    }
    if (lower === "properties") {
      const props = path.join(projectDir, name);
      for (const inner of readDir(props) ?? []) {
        if (inner.toLowerCase().endsWith(".cs") && grantsIn(path.join(props, inner), false)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * The one PROJECT fact `classifyCsTestability` needs and a signature cannot show,
 * resolved from a placement the caller already holds.
 *
 * PHASE 6 obligation, handed over by phase 5: `csInternalsVisibleTo` needs to be
 * told WHO IS ASKING, and the right name is the test project's `<AssemblyName>`
 * WHEN IT SETS ONE, not the `.csproj` basename. MSBuild defaults AssemblyName to
 * the project file's name, which is why the basename is the right FALLBACK and
 * the wrong ANSWER: a test project that renames its assembly grants internals to
 * that name, and matching the basename against the grant silently under-answers,
 * reporting `not-exported` for a method the test project can in fact reach.
 *
 * Absent grants answer false, which is the safe default the whole visibility leg
 * is built on.
 */
function csTestabilityContext(filePath: string, placement: TestPlacement, deps: TddDeps): { internalsVisible?: boolean } {
  const readFile = readFileOf(deps);
  const oracle = new CsOracle({
    fileExists: fileExistsOf(deps),
    readFile,
    readDir: (dir) => readDirOf(deps)(dir) ?? [],
    log: deps.log,
  });
  const sourceProjectDir = oracle.detectCrateRoot(filePath);
  if (sourceProjectDir === undefined || placement.packageArg === undefined) {
    return {};
  }
  const testCsproj = path.join(placement.runRoot, placement.packageArg);
  const assemblyName =
    propertyValue(readFile(testCsproj) ?? "", "AssemblyName") ?? path.basename(placement.packageArg, ".csproj");
  return { internalsVisible: csInternalsVisibleTo(sourceProjectDir, deps, assemblyName) };
}

// ===========================================================================
// Blank values
// ===========================================================================

/** The types whose hole is BARE: nothing about them is type-determined, so a
 *  hint would tell the human what the surrounding line already says. */
const CS_SCALAR = /^(s?byte|u?short|u?int|u?long|n?u?int|float|double|decimal|bool|char|string)$/;

/** `List<int>` -> `{ name: "List", args: ["int"] }`; undefined when the type
 *  carries no generic argument list. */
function parseGeneric(ty: string): { name: string; args: string[] } | undefined {
  const m = /^([A-Za-z_][\w.]*)\s*<([\s\S]*)>$/.exec(ty.trim());
  if (m === null) {
    return undefined;
  }
  const bare = m[1].includes(".") ? m[1].slice(m[1].lastIndexOf(".") + 1) : m[1];
  return { name: bare, args: splitTopLevel(m[2]) };
}

/** Split on TOP-LEVEL commas over `<>`, `()`, `[]` and `{}`, so
 *  `Dictionary<int, List<string>>` splits into two and not three. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (OPENERS.includes(c) || c === "<") {
      depth++;
    } else if (CLOSERS.includes(c) || c === ">") {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * The blank-value RHS for a C# return type. Amendments 2 and 6a together are the
 * rule, and 6a is the sharper statement of it: **a hole is HINTED when it stands
 * for an unknown NUMBER of values, and BARE when it stands for exactly one value
 * whose type the human can read off the position.**
 *
 * So a tuple gets one BARE hole per element (its arity is type-determined and
 * the third hole is unambiguously the third element's type), while `List<T>`
 * gets one HINTED hole covering an unknown count, hinted with `T` rather than
 * with the container type.
 *
 * The hint spelling `/* T *​/` IS a C# comment, unlike Python's, which makes it
 * the one language where an unfilled hole leaves compiling code. That does not
 * change the gesture: the scaffold is a snippet placeholder the human types
 * over, and `Assert.AreEqual(/* int *​/, Widen(3))` does not compile either
 * because a comment is not an expression.
 *
 * Pure; never throws.
 */
export function csRenderBlankValue(returnType: string, opts?: { startHole?: number }): BlankValueResult {
  const start = opts?.startHole ?? 1;
  const ty = (returnType ?? "").trim();
  const hole = (i: number) => `\${${start + i}}`;
  const hint = (t: string) => `\${${start}:/* ${escapeSnippet(t)} */}`;

  // `T?` first, and before the scalar check so `int?` is not read as `int`. The
  // VARIANT is the answer, which is the Option/Result precedent Rust set and
  // every leg has kept: null or a value is the contract's choice, not the type's.
  if (ty.endsWith("?")) {
    return { rhs: hint(ty), holes: 1 };
  }
  if (CS_SCALAR.test(ty)) {
    return { rhs: hole(0), holes: 1 };
  }
  // A TUPLE: `(int, string)`. Arity is type-determined, so one bare hole each.
  if (ty.startsWith("(") && matchDelim(ty, 0) === ty.length - 1) {
    const parts = splitTopLevel(ty.slice(1, -1));
    if (parts.length > 1) {
      return { rhs: `(${parts.map((_, i) => hole(i)).join(", ")})`, holes: parts.length };
    }
  }
  // `T[]`. The CONSTRUCTOR is type-determined and leaks nothing; how many
  // elements and which they are is contract-determined and stays ONE hole.
  if (ty.endsWith("[]")) {
    return { rhs: `new[] { ${hint(ty.slice(0, -2).trim())} }`, holes: 1 };
  }
  const generic = parseGeneric(ty);
  if (generic !== undefined && generic.name === "List" && generic.args.length === 1) {
    return { rhs: `new List<${generic.args[0]}> { ${hint(generic.args[0])} }`, holes: 1 };
  }
  // A `Dictionary`, an interface (`IEnumerable<T>` has no constructor to spell),
  // a record, a class: one hole hinting the type, the honest fallback for every
  // shape that is not scaffoldable.
  return { rhs: hint(ty), holes: 1 };
}

// ===========================================================================
// The expected-value locators, and this is the safety-critical part
// ===========================================================================

/** The `(` of a call to `callee` at `i`, seeing past an explicit generic
 *  argument list (`Assert.AreEqual<int>(a, b)`), or -1. */
function callOpenAt(text: string, i: number, callee: string): number {
  if (!text.startsWith(callee, i) || isIdentChar(text[i - 1] ?? "") || isIdentChar(text[i + callee.length])) {
    return -1;
  }
  let j = skipWs(text, i + callee.length);
  if (text[j] === "<") {
    const close = matchAngle(text, j);
    if (close === -1) {
      return -1;
    }
    j = skipWs(text, close + 1);
  }
  return text[j] === "(" ? j : -1;
}

/**
 * The EXPECTED-VALUE spans for the frameworks whose expected value is the FIRST
 * argument: MSTest's `Assert.AreEqual(expected, actual)` and xUnit's
 * `Assert.Equal(expected, actual)`.
 *
 * THIS IS THE INVERSION, and `goal.md` item 6 opens with it. The shipped Rust
 * locator takes the SECOND argument; pointed here it would blank
 * `AggregateFanout(3)` — the call under test — and leave the model's guessed `7`
 * standing as the expected value. That is the blank-value invariant inverted,
 * and the goal says getting it wrong in that direction makes the product LIE
 * rather than merely break.
 *
 * Only value-asserting overloads, and only when the call carries at least TWO
 * top-level arguments:
 *
 *  - `Assert.IsTrue(x)` / `Assert.IsNull(x)` carry no expected VALUE, so they
 *    yield no span. The locator FAILS OPEN, as every leg's does.
 *  - `Assert.AreEqual(7, Widen(3), "message")` blanks the `7` and NEVER the
 *    message, which falls out of taking argument ZERO rather than needing a
 *    special case.
 *  - A one-argument call yields nothing: a lone argument is the ACTUAL value in
 *    every one of these overloads.
 *
 * Spans come back ascending and non-overlapping.
 */
function firstArgumentSpans(text: string, callees: string[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, CS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    let matched = false;
    for (const callee of callees) {
      const open = callOpenAt(text, i, callee);
      if (open === -1) {
        continue;
      }
      const parsed = topLevelArgs(text, open, CS_LITERALS);
      if (parsed !== undefined && parsed.args.length >= 2) {
        spans.push(parsed.args[0]);
        i = parsed.close + 1;
        matched = true;
      }
      break;
    }
    if (!matched) {
      i++;
    }
  }
  return spans;
}

const MSTEST_EQUALITY = ["Assert.AreEqual", "Assert.AreNotEqual", "Assert.AreSame", "Assert.AreNotSame"];
const XUNIT_EQUALITY = ["Assert.Equal", "Assert.NotEqual", "Assert.Same", "Assert.NotSame"];

/** MSTest: `Assert.AreEqual(expected, actual)`, expected FIRST. */
export function mstestExpectedValueSpans(text: string): Array<{ start: number; end: number }> {
  return firstArgumentSpans(text, MSTEST_EQUALITY);
}

/** xUnit: `Assert.Equal(expected, actual)`, expected FIRST. */
export function xunitExpectedValueSpans(text: string): Array<{ start: number; end: number }> {
  return firstArgumentSpans(text, XUNIT_EQUALITY);
}

/**
 * NUnit: `Assert.That(actual, Is.EqualTo(expected))`. The expected value is
 * NESTED, which is the shape TypeScript's terminating-matcher locator already
 * had to solve, and it is why the argument POSITION alone is never the rule.
 *
 * The constraint argument is searched for `Is.EqualTo(…)` rather than assumed to
 * be one, so `Assert.That(x, Is.Not.Null)` and `Assert.That(x, Is.GreaterThan(0))`
 * yield no span: fail open, nothing wrong blanked.
 *
 * Stated residual: NUnit's CLASSIC model (`Assert.AreEqual(expected, actual)`)
 * is not matched here. It is expected-first like MSTest, so it would be one line
 * to add, and it is left out because the contract's table names `Assert.That`
 * and nothing on this machine writes classic NUnit for us to measure against.
 */
export function nunitExpectedValueSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, CS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const open = callOpenAt(text, i, "Assert.That");
    if (open !== -1) {
      const parsed = topLevelArgs(text, open, CS_LITERALS);
      if (parsed !== undefined && parsed.args.length >= 2) {
        const span = equalToArgument(text, parsed.args[1].start, parsed.args[1].end);
        if (span !== undefined) {
          spans.push(span);
        }
        i = parsed.close + 1;
        continue;
      }
    }
    i++;
  }
  return spans;
}

/** The sole argument of the first `Is.EqualTo(…)` between `from` and `limit`,
 *  or undefined. */
function equalToArgument(text: string, from: number, limit: number): { start: number; end: number } | undefined {
  let i = from;
  while (i < limit) {
    const skipped = skipLiteralOrComment(text, i, CS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const open = callOpenAt(text, i, "Is.EqualTo");
    if (open !== -1) {
      const parsed = topLevelArgs(text, open, CS_LITERALS);
      if (parsed !== undefined && parsed.args.length >= 1 && parsed.close <= limit) {
        return parsed.args[0];
      }
    }
    i++;
  }
  return undefined;
}

/** The three types every C# assertion is spelled on. The floor walks calls on
 *  THESE, not on the locator's own callee list: a count keyed on the same list
 *  the locator resolves can never, by construction, see a shape outside it, and
 *  the shapes outside it are precisely the ones that fail open. Measured misses
 *  that a list-keyed floor could not report: NUnit's classic
 *  `Assert.AreEqual(expected, actual)` (which `nunitExpectedValueSpans` states it
 *  does not match), `CollectionAssert.AreEqual(new[] { 7 }, …)` and
 *  `StringAssert.StartsWith(…, "abc-7")`. */
const CS_ASSERT_ENTRY = /^(Assert|CollectionAssert|StringAssert)\.[A-Za-z_]\w*/;

/**
 * How many assertion calls the locator walked without resolving an expected-value
 * span inside them, over EVERY assertion-shaped call rather than over one
 * framework's equality family.
 *
 * scraps D5's all-or-nothing floor, spelled for the C# frameworks. A call counts
 * when the locator placed no span inside it AND either:
 *
 *  - it is on `callees`, this framework's own value-asserting family, so the
 *    locator was pointed at it and came back with nothing: a one-argument
 *    `Assert.AreEqual(Only(1))`, or an NUnit constraint that is not `Is.EqualTo`;
 *  - or it carries a LITERAL the locator did not blank. That literal is a value
 *    the human would have had to type, standing in the human's file as the model
 *    guessed it.
 *
 * `Assert.IsTrue(x)`, `Assert.IsNull(Find("x"))` and `Assert.Fail()` are counted
 * by NEITHER limb: not on any equality family, and no literal outside a nested
 * call's own arguments. They carry no expected value to type, so refusing over
 * them would refuse a good pass.
 *
 * Two residual over-refusals, both stated rather than fixed, because over-refusing
 * is the safe direction: `Assert.IsTrue(Widen(3) > 0)` counts (the `0` is an
 * expected value the locator cannot place, exactly like NUnit's `Is.GreaterThan(0)`
 * and pytest's `>`), and so does a message argument on a value-free overload,
 * `Assert.IsNull(x, "should be null")`, which is indistinguishable from
 * `StringAssert.StartsWith(x, "abc-7")` without a per-method vocabulary this leg
 * deliberately does not model.
 */
function unresolvedCalls(
  text: string,
  callees: string[],
  resolve: (open: number) => boolean,
  // THIS framework's locator and no other. Taking the union of all three would
  // let MSTest's locator vouch for a span NUnit's never placed, which is the
  // exact fail-open the classic-model shape is here to catch.
  locate: (t: string) => Array<{ start: number; end: number }>,
): number {
  const resolved = locate(text);
  let unresolved = 0;
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, CS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const entry = isIdentChar(text[i - 1] ?? "") ? null : CS_ASSERT_ENTRY.exec(text.slice(i));
    if (entry === null) {
      i++;
      continue;
    }
    const callee = entry[0];
    const open = callOpenAt(text, i, callee);
    if (open === -1) {
      i += callee.length;
      continue;
    }
    const parsed = topLevelArgs(text, open, CS_LITERALS);
    const end = parsed === undefined ? open : parsed.close;
    const placed = resolved.some((s) => s.start >= open && s.end <= end);
    if (!placed && (callees.includes(callee) ? !resolve(open) : carriesBareLiteral(text, open + 1, end))) {
      unresolved++;
    }
    i = parsed === undefined ? i + callee.length : parsed.close + 1;
  }
  return unresolved;
}

/**
 * Is there a literal between `from` and `limit` that is NOT inside a nested
 * call's own argument list?
 *
 * The nesting rule is what tells an expected value from an input. In
 * `Assert.IsNull(Find("x"))` the `"x"` is an ARGUMENT to the call under test, so
 * it is the human's input, not an expectation, and the locator was right to
 * leave it. In `CollectionAssert.AreEqual(new[] { 4242424 }, Widen(1))` the `4242424`
 * sits in a collection initialiser at the assertion's own level, which is the
 * expected value the model guessed.
 */
function carriesBareLiteral(text: string, from: number, limit: number): boolean {
  let i = from;
  while (i < limit) {
    const skipped = skipLiteralOrComment(text, i, CS_LITERALS);
    if (skipped > i) {
      // A comment carries nothing; a string or char literal is a value.
      if (text[i] !== "/") {
        return true;
      }
      i = skipped;
      continue;
    }
    if (/[0-9]/.test(text[i]) && !isIdentChar(text[i - 1] ?? "") && text[i - 1] !== ".") {
      return true;
    }
    if (!isIdentChar(text[i - 1] ?? "")) {
      const word = /^(true|false|null)\b/.exec(text.slice(i, limit));
      if (word !== null) {
        return true;
      }
    }
    if (isIdentStart(text[i])) {
      // An identifier: skip it, and skip a call's whole argument list with it, so
      // the literals INSIDE the call under test are never read as expectations.
      let j = i;
      while (j < limit && isIdentChar(text[j])) {
        j++;
      }
      const after = skipWs(text, j);
      if (text[after] === "(") {
        const close = matchDelim(text, after);
        j = close === -1 ? limit : close + 1;
      }
      i = Math.max(j, i + 1);
      continue;
    }
    i++;
  }
  return false;
}

const isIdentStart = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_]/.test(c);

const hasTwoArguments = (text: string) => (open: number) => {
  const parsed = topLevelArgs(text, open, CS_LITERALS);
  return parsed !== undefined && parsed.args.length >= 2;
};

/** MSTest: an `Assert.AreEqual`-family call with no readable expected argument,
 *  plus any other assertion call carrying an unblanked literal. */
export function mstestUnresolvedAssertions(text: string): number {
  return unresolvedCalls(text, MSTEST_EQUALITY, hasTwoArguments(text), mstestExpectedValueSpans);
}

/** xUnit: the same, over its own equality family. */
export function xunitUnresolvedAssertions(text: string): number {
  return unresolvedCalls(text, XUNIT_EQUALITY, hasTwoArguments(text), xunitExpectedValueSpans);
}

/**
 * NUnit: an `Assert.That(actual, <constraint>)` whose constraint is not an
 * `Is.EqualTo(…)` the locator can read, plus the classic model
 * (`Assert.AreEqual(expected, actual)`) that `nunitExpectedValueSpans` does not
 * match at all and that the broad limb now counts.
 *
 * `Assert.That(x, Is.Not.Null)` and `Assert.That(x, Is.GreaterThan(0))` DO count
 * as misses, and deliberately: `Is.GreaterThan(0)` carries an expected value the
 * human would have typed, and the locator cannot place it. `Is.Not.Null` carries
 * none, but telling the two apart needs the constraint vocabulary this leg does
 * not model — and over-refusing is the safe direction, because the failure it
 * prevents is the model's guess shipping unblanked.
 */
export function nunitUnresolvedAssertions(text: string): number {
  return unresolvedCalls(text, ["Assert.That"], (open) => {
    const parsed = topLevelArgs(text, open, CS_LITERALS);
    return (
      parsed !== undefined &&
      parsed.args.length >= 2 &&
      equalToArgument(text, parsed.args[1].start, parsed.args[1].end) !== undefined
    );
  }, nunitExpectedValueSpans);
}

// ===========================================================================
// The TRX parse
// ===========================================================================

/** A TRX outcome attribute to the rung's three. TRX spells more outcomes than
 *  the rung has, and the mapping is the conservative one: anything that is not a
 *  pass and not a deliberate non-run counts as a FAILURE, because a run that
 *  ended some other way must never read as green. */
function outcomeOf(raw: string): TestOutcome {
  switch (raw) {
    case "Passed":
      return "pass";
    case "NotExecuted":
    case "Inconclusive":
    case "Pending":
    case "InProgress":
      return "ignored";
    default:
      return "fail";
  }
}

/** A UTF-8 BOM, which `dotnet test` DOES write at the head of every TRX
 *  (measured), stripped. Without this the "does this document begin as a report"
 *  guard rejects every real TRX on this machine. */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * The test host could not START, told from the console text.
 *
 * Needed even though the measured missing-runtime run DOES write a TRX, because
 * the two facts are independent: the TRX is written by VSTest, and a host that
 * aborts before VSTest gets that far leaves only these lines. Checked BEFORE the
 * compile-error reader for a specific reason — the abort message contains the
 * words "exited with error:", which a loose diagnostic reader classifies as a
 * COMPILE failure and reports as "the tests did not compile". That is the exact
 * lie this leg exists to stop telling.
 */
const CS_ENVIRONMENT_TELL =
  /You must install or update \.NET|Test Run Aborted|Testhost process for source|framework '[^']+', version '[^']+' was not found/;

/**
 * MSBuild diagnostic lines out of the console text.
 *
 * Two shapes, both narrow on purpose: a diagnostic CODE (`CSC : error CS8630:`,
 * `/p/F.cs(12,5): error CS1002: … [proj]`, `error MSB1011:`, `error NETSDK1004:`),
 * or the codeless `error : …` MSBuild writes at the head of a line, which is how
 * the Microsoft.Testing.Platform rejection arrives. A bare `\berror\s*:` would
 * also match "exited with error:" in the middle of the missing-runtime message.
 */
const CS_COMPILE_LINE = /\berror\s+[A-Z]{2,}\d+\s*:|^\s*(?:\S+\s+)?error\s*:/;

function compileErrorLines(text: string): string[] {
  const seen = new Set<string>();
  for (const line of (text ?? "").replace(/\r/g, "").split("\n")) {
    if (CS_COMPILE_LINE.test(line) && line.trim().length > 0) {
      seen.add(line.trim());
    }
  }
  return [...seen];
}

/**
 * Parse a `dotnet test --logger trx` run.
 *
 * `report` IS THE TRX DOCUMENT, read from the file `csTrxPath` names, NOT the
 * runner's stdout. That distinction is the same security property pytest's
 * junit-xml carries and it is why C# stopped being the build's last text parser:
 * counts are ATTRIBUTES on `<Counters>` and each result is a `<UnitTestResult>`
 * with its own `testName` and `outcome`, so a test printing
 * `Failed! - Failed: 1, Passed: 99` into its own output cannot reach either.
 *
 * WHEN NO TRX WAS WRITTEN, `stdout` IS THE PROCESS'S REAL STDOUT. That is
 * Amendment 8c, and this leg is the reason it exists: MEASURED on the real
 * corpus, `dotnet test` writes MSBuild compile errors to STDOUT, leaves STDERR
 * EMPTY, and writes no TRX at all — so without the fallback a C# compile failure
 * reaches the human as "the tests did not compile" with no message, which is
 * precisely the hole `buildError` exists to close for Go.
 *
 * THE FOUR OUTCOMES, all four measured against `Contoso.ProcessingLogic.Tests`:
 *
 * | outcome        | tell                                             | exit | field |
 * | -------------- | ------------------------------------------------ | ---- | ----- |
 * | test failure   | `<Counters failed="14">` and Failed results      | 1    | none  |
 * | filter miss    | zero results, `total="0"`, RunInfo `Warning`     | 0    | filterMatchedNothing |
 * | compile failure| NO TRX, `error CS…` on stdout, stderr empty      | 1    | buildError |
 * | missing runtime| TRX with zero results and RunInfo `Error`        | 1    | environmentError |
 *
 * A RunInfo `Error` alongside real results is the fifth shape: a host that dies
 * part way through. It gets `environmentError` too, on a parse whose `ran` is
 * true, because the alternative is a red with no message anywhere.
 *
 * TWO CORRECTIONS TO THE CONTRACT, both measured, both in the same place:
 *
 *  1. The missing runtime DOES write a TRX. `contract-cs.md` says it writes
 *     none. It writes one carrying `<ResultSummary outcome="Failed">`,
 *     `total="0"` and a `<RunInfos><RunInfo outcome="Error">` holding the whole
 *     "You must install or update .NET" message. So the environment failure and
 *     the filter miss are STRUCTURALLY IDENTICAL except for that RunInfo
 *     outcome — which is exactly the trap `contract-seam.md` warns about in Go,
 *     arriving in a third language. The Error check comes FIRST here for that
 *     reason: get it backwards and a human with no matching runtime is told
 *     their filter matched nothing.
 *  2. The compile failure writes no TRX and puts its errors on STDOUT. The
 *     contract predicted the missing TRX; nothing predicted the stream.
 */
export function parseTrx(report: string, stderr: string, exitCode: number): TestRunParse {
  const raw = stripBom(report ?? "").trim();
  // A TRX may open with an XML declaration; the ROOT element is the tell, and
  // the name may carry a namespace prefix.
  const xml = raw;
  const err = (stderr ?? "").trim();

  if (!/^(?:<\?xml[^>]*\?>\s*)?<[\w.-]*:?TestRun\b/.test(xml)) {
    // NO REPORT, so `raw` is the process's real stdout (Amendment 8c) rather
    // than a document. On every measured capture this means the BUILD failed:
    // the test host never started, so there was nothing to log.
    const console = raw;
    const noReport: TestRunParse = { ran: false, cases: [], failures: [], passed: 0, failed: 0, ignored: 0, casesComplete: true };
    // THE ENVIRONMENT FIRST. A missing runtime and a compile failure are both
    // exit 1 with no report, so the exit code cannot separate them and the
    // MESSAGE is the only tell. Reading it in the other order reports a missing
    // runtime as a compile error, which is what today's rung does to all four.
    if (CS_ENVIRONMENT_TELL.test(console) || CS_ENVIRONMENT_TELL.test(err)) {
      noReport.environmentError = [err, console].map((s) => s.trim()).filter((s) => s.length > 0).join("\n\n");
      return noReport;
    }
    const compile = compileErrorLines(console).concat(compileErrorLines(err));
    if (compile.length > 0) {
      noReport.buildError = compile.join("\n");
    } else if (err.length > 0) {
      noReport.environmentError = err;
    } else {
      noReport.environmentError = console || `dotnet test wrote no TRX report (exit ${exitCode}), so the run did not start`;
    }
    return noReport;
  }

  const tags = scanXmlTags(xml);
  const counters = tags.find((t) => t.local === "Counters");
  if (counters === undefined) {
    // A report `dotnet test` did not finish writing. Its results would be a
    // session that never ended, and trusting a partial write is how a truncated
    // report becomes a green.
    return {
      ran: false,
      cases: [],
      failures: [],
      passed: 0,
      failed: 0,
      ignored: 0,
      casesComplete: true,
      environmentError: "the TRX report has no <Counters> element, so the run did not finish",
    };
  }

  const cases: TestCaseResult[] = [];
  const failures: TestFailureDetail[] = [];
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].local !== "UnitTestResult") {
      continue;
    }
    const name = tags[i].attrs.testName ?? "";
    const outcome = outcomeOf(tags[i].attrs.outcome ?? "");
    cases.push({ name, outcome });
    if (outcome === "fail") {
      const message = errorInfoOf(xml, tags, i);
      if (message.length > 0) {
        failures.push({ name, message });
      }
    }
  }

  // THE COUNTS COME FROM THE ATTRIBUTES. That is the point of the format.
  const passed = attrNumber(counters.attrs, "passed");
  const failed =
    attrNumber(counters.attrs, "failed") +
    attrNumber(counters.attrs, "error") +
    attrNumber(counters.attrs, "timeout") +
    attrNumber(counters.attrs, "aborted");
  const ignored =
    attrNumber(counters.attrs, "notExecuted") +
    attrNumber(counters.attrs, "inconclusive") +
    attrNumber(counters.attrs, "notRunnable");

  const parse: TestRunParse = {
    // Amendment 6b's rule, spelled from the counters rather than from the
    // element count: `ran` means the runner produced TEST results, and the
    // counters are the half of the document a printing test cannot reach.
    ran: passed + failed + ignored > 0,
    cases,
    failures,
    passed,
    failed,
    ignored,
    // Amendment 7, re-confirmed on the real corpus: TRX enumerates PASSING tests
    // by name. The goal's "cases cannot be a full list" limit belonged to the
    // human-readable console output, not to `dotnet test`.
    casesComplete: true,
  };

  // `<RunInfo outcome="Error">` IS READ WHATEVER THE RESULT COUNT. A test host
  // that dies part way through logs the results it managed AND the abort, so a
  // parse that only reads RunInfo on an empty run throws the abort message away:
  // `runRung` then leaves `buildError` undefined because `ran` is true, and the
  // human gets a not-green run with zero failures and no reason in any field.
  // That is the message-less failure this leg exists to stop producing.
  const errors = tags
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.local === "RunInfo" && t.attrs.outcome === "Error")
    .map(({ t, i }) => runInfoText(xml, tags, i) || t.attrs.outcome)
    .filter((s) => s.length > 0);
  if (errors.length > 0) {
    // The environment check comes FIRST on an empty run. A missing runtime and a
    // filter miss are both zero results and `total="0"`; only this attribute
    // separates them.
    parse.environmentError = errors.join("\n\n");
  } else if (!parse.ran) {
    parse.filterMatchedNothing = true;
  }
  return parse;
}

// ===========================================================================
// The C# failure hooks (session-v60 phase B2)
// ===========================================================================

/**
 * One .NET stack frame carrying a source position:
 *
 *      at Contoso.DataModel.Service.SiteValidation.ValidateTimeZone(String timezone) in /repo/SiteValidation.cs:line 30
 *   1)    at Widget.Tests.CalcTests.Add_Throws_WhenAsked() in /repo/WidgetTests.cs:line 16
 *
 * The optional `N)` is NUnit, which repeats the frame under a numbered marker.
 * The leading whitespace is OPTIONAL because of what the shipped parser does to
 * it: `errorInfoOf` joins the `<Message>` and `<StackTrace>` elements after
 * trimming each, so the first frame of the trace arrives flush left and every
 * later one keeps its three spaces. An extractor that required the indent read
 * the real capture and found nothing.
 *
 * `:line ` is the marker and it is not translated by the adapters measured; a
 * localised test host spells it differently and this DECLINES there, which is
 * the right answer for a shape that only looks familiar.
 */
const TRX_FRAME = /^\s*(?:\d+\)\s*)?at\s+(\S[^\n]*?)\s+in\s+(.+?):line (\d+)\s*$/;

/** A frame belonging to the test FRAMEWORK rather than to the code under test.
 *  Matched against the frame's type-and-method text, which is what the adapters
 *  namespace: `Xunit.Assert.Equal[T](…)`, `NUnit.Framework.Assert.That(…)`,
 *  `Microsoft.VisualStudio.TestTools.UnitTesting.Assert.AreEqual[T](…)`. */
const TRX_FRAMEWORK_FRAME = /^(?:Xunit\.|NUnit\.|Microsoft\.VisualStudio\.TestTools)/;

/**
 * The failure LOCATION out of a TRX failure message: the FIRST frame that is
 * not framework code.
 *
 * First, not last, and that is the opposite of the Python rule for a reason:
 * .NET prints the stack innermost-first, so the first frame IS the innermost
 * one. On the committed MSTest capture it is `SiteValidation.cs:line 30`, the
 * product line that threw, one frame below the test that called it.
 *
 * The frames the runtime adds below the test (`System.Reflection.
 * MethodBaseInvoker…`) carry no `in <path>:line <n>` at all, so they can never
 * become an answer and need no rule of their own.
 *
 * TRX reports no COLUMN, so the field stays absent rather than being invented.
 */
export function trxFailureLocation(message: string): FailureLocation | undefined {
  for (const line of (message ?? "").split(/\r?\n/)) {
    const m = TRX_FRAME.exec(line);
    if (m === null || TRX_FRAMEWORK_FRAME.test(m[1])) {
      continue;
    }
    return { filePath: m[2], line: Number(m[3]) };
  }
  return undefined;
}

/**
 * The adapters' OWN frames, removed, leaving the assertion text and the frames
 * in the human's code.
 *
 * NOT MEASURED ON A REAL CAPTURE, and said so: xunit 2.9.3, NUnit 4.6.0 and
 * MSTest all trimmed their own frames out of the trace in the three captures
 * committed here, because their assemblies ship without the PDBs that would put
 * a line number on one. The filter is kept because a framework built from
 * source does emit them and because it costs nothing when there are none: a
 * message with no framework frame comes back byte for byte.
 */
export function trxStripHarnessFrames(message: string): string {
  return (message ?? "")
    .split(/\r?\n/)
    .filter((line) => {
      const m = /^\s*(?:\d+\)\s*)?at\s+(\S[^\n]*)$/.exec(line);
      return m === null || !TRX_FRAMEWORK_FRAME.test(m[1]);
    })
    .join("\n")
    .replace(/\s+$/, "");
}

/** `<Output><ErrorInfo><Message>…</Message><StackTrace>…</StackTrace></ErrorInfo></Output>`
 *  for the result at `at`, as one message. Bounded by the NEXT `UnitTestResult`
 *  so a sibling's failure can never be attributed to this test. */
function errorInfoOf(xml: string, tags: XmlTag[], at: number): string {
  const parts: string[] = [];
  for (let j = at + 1; j < tags.length && tags[j].local !== "UnitTestResult"; j++) {
    if (tags[j].local === "Message" || tags[j].local === "StackTrace") {
      const body = elementText(xml, tags[j]);
      if (body.length > 0) {
        parts.push(body);
      }
    }
  }
  return parts.join("\n");
}

/** The `<Text>` child of the RunInfo at `at`. */
function runInfoText(xml: string, tags: XmlTag[], at: number): string {
  for (let j = at + 1; j < tags.length && tags[j].local !== "RunInfo" && tags[j].local !== "/RunInfos"; j++) {
    if (tags[j].local === "Text") {
      return elementText(xml, tags[j]);
    }
  }
  return "";
}

// ===========================================================================
// The command
// ===========================================================================

/**
 * Where `dotnet test` writes its TRX: a SYSTEM TEMP path, never inside the
 * human's repo, derived from the target file so the same rung always names the
 * same file and the parse can find what the command wrote.
 *
 * The runner DELETES this path before spawning, which matters more here than it
 * looks: three of the four no-run outcomes leave no fresh TRX, and a stale one
 * parsed as a live one is a green from a run that never happened.
 */
export function csTrxPath(placement: TestPlacement): string {
  let hash = 0;
  for (const ch of placement.targetPath) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return path.join(os.tmpdir(), `column80-cs-${hash.toString(36)}.trx`);
}

/** VSTest's filter grammar gives `\`, `(`, `)`, `&`, `|`, `=`, `!`, `~` and `,`
 *  meaning, so each is backslash-escaped. Test method names are identifiers and
 *  never need it; this is the floor under a name that is not. */
function escapeFilterValue(name: string): string {
  return name.replace(/[\\()&|=!~,]/g, "\\$&");
}

/** A VSTest fully-qualified test name: a namespace-and-type path, `+` between
 *  nested types, ending in the method. A bare method name is NOT one, which is
 *  what keeps `=` off a name it would fail to match. */
const CS_FULLY_QUALIFIED = /^\w+(?:[.+]\w+)+$/;

/**
 * `dotnet test <project> --no-restore --filter <expr> --logger trx --results-directory <tmp>`
 * from the TEST project's directory. Every part of it is load-bearing:
 *
 *  - `--no-restore` is the offline invariant, the same one `CsOracle` pins for
 *    the check: `dotnet test` implicitly restores over the NETWORK otherwise.
 *    An unrestored project then surfaces as a real MSBuild error naming restore,
 *    never as a silent network call.
 *  - `--logger trx` is the whole parse. See `parseTrx`.
 *  - `--results-directory` is the SYSTEM TEMP area. `dotnet test` defaults to a
 *    `TestResults/` directory INSIDE the project, and this product does not
 *    write into the human's repo unbidden.
 *  - `DOTNET_ROLL_FORWARD` IS NOT SET, and that is a decision rather than an
 *    omission. Setting it would run the human's tests on a runtime their own
 *    `dotnet test` refuses, so the rung could report GREEN where their own
 *    command hard-fails — the same divergence `GoOracle` already warns about for
 *    `GOENV=off`. A missing runtime is an `environmentError`: name it and stop.
 *
 * `FullyQualifiedName=` is an EXACT match and rides with a RESOLVED name, only.
 * `~` is a CONTAINS match, so a generated name that is a prefix of another
 * test's name selects both and the rung can blame the neighbour. The operator
 * alone does not fix it: measured on dotnet 10.0.111, `=Add` against a bare
 * method name matches NOTHING, and a rung that selects nothing reads as a
 * passing rung with nothing in it. So `=` is emitted only when EVERY name is
 * fully qualified, which is what `csGeneratedTestNames` produces once the
 * enclosing namespace and class resolve. Anything less keeps `~`, which
 * over-selects and can only add a red, never manufacture a green.
 */
function buildCsCommand(placement: TestPlacement, testNames: string[]): TestRunCommand {
  const names = testNames.filter((n) => n.length > 0);
  if (names.length === 0) {
    // An empty filter runs the WHOLE test project, which would blame this one
    // function for every test in it. The floor under the caller's refusal.
    throw new Error("dotnet test needs at least one test name: an empty filter runs the whole test project");
  }
  const trx = csTrxPath(placement);
  const project = placement.packageArg;
  const op = names.every((n) => CS_FULLY_QUALIFIED.test(n)) ? "=" : "~";
  return {
    command: "dotnet",
    args: [
      "test",
      ...(project === undefined ? [] : [project]),
      "--no-restore",
      "--filter",
      names.map((n) => `FullyQualifiedName${op}${escapeFilterValue(n)}`).join("|"),
      "--logger",
      `trx;LogFileName=${path.basename(trx)}`,
      "--results-directory",
      path.dirname(trx),
    ],
    cwd: placement.runRoot,
    env: dotnetEnv(),
    // The runner reads this file after the spawn and hands its CONTENT to
    // parseOutput. Declared here so the framework that writes the report is the
    // one that says where it lands.
    outputFile: trx,
  };
}

// ===========================================================================
// The frameworks
// ===========================================================================

/** Every `*.csproj` in `dir`, as text. A project directory holds one in
 *  practice; reading all of them costs nothing and means a repo that holds two
 *  is not silently half-read. */
function csprojTexts(dir: string, deps: TddDeps): Array<{ path: string; text: string }> {
  const readFile = readFileOf(deps);
  return (readDirOf(deps)(dir) ?? [])
    .filter((n) => n.toLowerCase().endsWith(".csproj"))
    .sort()
    .map((n) => ({ path: path.join(dir, n), text: readFile(path.join(dir, n)) ?? "" }));
}

/** Does any project in `dir` reference a package whose Include matches? */
function referencesPackage(dir: string, deps: TddDeps, matches: (id: string) => boolean): boolean {
  for (const { text } of csprojTexts(dir, deps)) {
    for (const m of text.matchAll(/<PackageReference\b[^>]*\bInclude\s*=\s*"([^"]*)"/gi)) {
      if (matches(m[1])) {
        return true;
      }
    }
  }
  return false;
}

const MSTEST_USING = "using Microsoft.VisualStudio.TestTools.UnitTesting;";
const XUNIT_USING = "using Xunit;";
const NUNIT_USING = "using NUnit.Framework;";

/**
 * The class-level attribute each framework wants, looked up by
 * `TestPlacement.frameworkId` (Amendment 8d).
 *
 * Keyed by ID rather than by the using LINE, and the corpus is why that matters
 * rather than being a tidiness preference: `Contoso.ProcessingLogic.Tests`
 * carries `global using Microsoft.VisualStudio.TestTools.UnitTesting;` in a
 * `GlobalUsings.cs`, so the per-file using is redundant and this leg omits it —
 * which leaves `frameworkImportLine` ABSENT on a project that is very much using
 * MSTest. Inferring the attribute from the using line would emit no `[TestClass]`
 * there, and a test class without it is a class MSTest does not collect.
 *
 * xUnit is the empty string on purpose: it has no class-level attribute, and
 * `[Fact]` on the METHOD is the model's to write from `assertionInstruction`.
 */
const CS_CLASS_ATTRIBUTE: Record<string, string> = {
  mstest: "[TestClass]",
  xunit: "",
  nunit: "[TestFixture]",
};

const MSTEST: TestFramework = {
  id: "mstest",
  displayName: "MSTest (dotnet test)",

  detect(root, deps) {
    return referencesPackage(root, deps, (id) => /^MSTest(\.(TestFramework|TestAdapter|Analyzers))?$/i.test(id));
  },

  buildCommand: buildCsCommand,
  parseOutput: parseTrx,
  failureLocation: trxFailureLocation,
  stripHarnessFrames: trxStripHarnessFrames,

  assertionInstruction:
    "Assert with `Assert.AreEqual(<expected>, <call>)`: the EXPECTED value is the FIRST argument and the " +
    "call under test is the SECOND. Write each expected value inline as the first argument of its own " +
    "assert, one case per test method, and mark every test method `[TestMethod] public void`.",

  expectedValueSpans: mstestExpectedValueSpans,
  classifiesBuildError: true,
  unresolvedAssertions: mstestUnresolvedAssertions,
};

const XUNIT: TestFramework = {
  id: "xunit",
  displayName: "xUnit (dotnet test)",

  detect(root, deps) {
    return referencesPackage(root, deps, (id) => /^xunit(\.|$)/i.test(id));
  },

  buildCommand: buildCsCommand,
  parseOutput: parseTrx,
  failureLocation: trxFailureLocation,
  stripHarnessFrames: trxStripHarnessFrames,

  assertionInstruction:
    "Assert with `Assert.Equal(<expected>, <call>)`: the EXPECTED value is the FIRST argument and the " +
    "call under test is the SECOND. Write each expected value inline as the first argument of its own " +
    "assert, one case per test method, and mark every test method `[Fact] public void`.",

  expectedValueSpans: xunitExpectedValueSpans,
  classifiesBuildError: true,
  unresolvedAssertions: xunitUnresolvedAssertions,
};

const NUNIT: TestFramework = {
  id: "nunit",
  displayName: "NUnit (dotnet test)",

  detect(root, deps) {
    return referencesPackage(root, deps, (id) => /^NUnit$/i.test(id));
  },

  buildCommand: buildCsCommand,
  parseOutput: parseTrx,
  failureLocation: trxFailureLocation,
  stripHarnessFrames: trxStripHarnessFrames,

  assertionInstruction:
    "Assert with `Assert.That(<call>, Is.EqualTo(<expected>))`: the EXPECTED value is the argument of " +
    "`Is.EqualTo` and the call under test is the first argument of `Assert.That`. Write each expected " +
    "value inline, one case per test method, and mark every test method `[Test] public void`.",

  expectedValueSpans: nunitExpectedValueSpans,
  classifiesBuildError: true,
  unresolvedAssertions: nunitUnresolvedAssertions,
};

const CS_FRAMEWORKS = [MSTEST, XUNIT, NUNIT];

/** The framework detected at `root`, or undefined. Placement needs this before
 *  `frameworkFor` runs, for the same reason the Python leg needed it: the using
 *  line the scaffold writes is the FRAMEWORK's, not the language's. */
function detectedFramework(root: string, deps: TddDeps): TestFramework | undefined {
  return CS_FRAMEWORKS.find((f) => f.detect(root, { ...deps, log: undefined }));
}

function frameworkUsing(framework: TestFramework | undefined): string | undefined {
  switch (framework?.id) {
    case "mstest":
      return MSTEST_USING;
    case "xunit":
      return XUNIT_USING;
    case "nunit":
      return NUNIT_USING;
    default:
      return undefined;
  }
}

// ===========================================================================
// Reading a project and a source file
// ===========================================================================

/** An MSBuild boolean property, true only when the project says so. */
function propertyIsTrue(text: string, name: string): boolean {
  const m = new RegExp(`<${name}>\\s*([^<]*)</${name}>`, "i").exec(text);
  return m !== null && m[1].trim().toLowerCase() === "true";
}

function propertyValue(text: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>\\s*([^<]*)</${name}>`, "i").exec(text);
  const value = m?.[1]?.trim();
  return value === undefined || value.length === 0 || value.includes("$(") ? undefined : value;
}

/** Every `<ProjectReference Include="…">` path of a project, as written. */
function projectReferenceIncludes(text: string): string[] {
  return [...text.matchAll(/<ProjectReference\b[^>]*\bInclude\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
}

/** Every `<ProjectReference Include="…">` of a project, resolved to an absolute
 *  path. MSBuild writes these with BACKSLASHES whatever the platform, which is
 *  the whole reason this is not a `path.resolve` one-liner.
 *
 *  A path holding an MSBuild VARIABLE (`..\$(SrcDir)\Src.csproj`) resolves to
 *  nonsense, because nothing here evaluates MSBuild. It is dropped rather than
 *  resolved, and `unresolvedTestProjectRefs` is what turns that silence into a
 *  sentence the human can act on. */
function projectReferences(csprojPath: string, text: string): string[] {
  const dir = path.dirname(csprojPath);
  return projectReferenceIncludes(text)
    .filter((include) => !include.includes("$("))
    .map((include) => path.resolve(dir, include.split("\\").join(path.sep)));
}

/** The NAMESPACE a C# file declares, in either spelling (`namespace X;` and
 *  `namespace X { … }`), or undefined.
 *
 *  Read through the literal-aware scanner rather than by regex: a `namespace`
 *  spelled inside a doc comment or a raw string is not a declaration, and the
 *  corpus writes plenty of both. */
export function csNamespaceOf(text: string): string | undefined {
  let i = 0;
  while (i < (text ?? "").length) {
    const skipped = skipLiteralOrComment(text, i, CS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (text.startsWith("namespace", i) && !isIdentChar(text[i - 1] ?? "") && !isIdentChar(text[i + 9])) {
      const m = /^\s+([A-Za-z_][\w.]*)/.exec(text.slice(i + 9));
      if (m !== null) {
        return m[1];
      }
    }
    i++;
  }
  return undefined;
}

/** A path segment as a C# namespace segment: `My-Folder` is a legal directory
 *  name and an illegal identifier, and MSBuild's own rule is to substitute `_`. */
function namespaceSegment(segment: string): string {
  const cleaned = segment.replace(/[^\w]/g, "_");
  return /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
}

// ===========================================================================
// Placement
// ===========================================================================

interface TestProjectCandidate {
  dir: string;
  csproj: string;
  text: string;
}

/** Is this project a TEST project? Either signal, per the contract, and both are
 *  present in `Contoso.ProcessingLogic.Tests.csproj`. */
function isTestProject(text: string): boolean {
  return propertyIsTrue(text, "IsTestProject") || /<PackageReference\b[^>]*\bInclude\s*=\s*"Microsoft\.NET\.Test\.Sdk"/i.test(text);
}

/** Every directory worth looking in for a test project: the source project's
 *  SIBLINGS, plus every project a solution above it lists. The corpus is the
 *  sibling shape; the solution walk is what makes a `src/` + `test/` layout
 *  work, where the test project is not a sibling at all. */
function candidateDirs(sourceProjectDir: string, deps: TddDeps): string[] {
  const readDir = readDirOf(deps);
  const dirs = new Set<string>();
  const parent = path.dirname(sourceProjectDir);
  for (const name of readDir(parent) ?? []) {
    dirs.add(path.join(parent, name));
  }
  // The solution: up to four levels above the project, which covers
  // `<sln>/src/<proj>` and `<sln>/source/<area>/<proj>` without walking to `/`.
  let dir = parent;
  for (let depth = 0; depth < 4; depth++) {
    for (const name of readDir(dir) ?? []) {
      if (!/\.slnx?$/i.test(name)) {
        continue;
      }
      const text = readFileOf(deps)(path.join(dir, name)) ?? "";
      for (const m of text.matchAll(/"([^"]*\.csproj)"/g)) {
        dirs.add(path.dirname(path.resolve(dir, m[1].split("\\").join(path.sep))));
      }
    }
    const up = path.dirname(dir);
    if (up === dir) {
      break;
    }
    dir = up;
  }
  dirs.delete(sourceProjectDir);
  return [...dirs].sort();
}

/** The test projects that reference `sourceCsproj`. */
function testProjectsFor(sourceProjectDir: string, sourceCsproj: string, deps: TddDeps): TestProjectCandidate[] {
  const found: TestProjectCandidate[] = [];
  for (const dir of candidateDirs(sourceProjectDir, deps)) {
    for (const { path: csproj, text } of csprojTexts(dir, deps)) {
      if (!isTestProject(text)) {
        continue;
      }
      if (projectReferences(csproj, text).some((ref) => path.resolve(ref) === path.resolve(sourceCsproj))) {
        found.push({ dir, csproj, text });
      }
    }
  }
  return found;
}

/**
 * Test projects near the source whose `<ProjectReference>` paths hold an
 * unresolved MSBuild variable, with the path as written.
 *
 * Nothing here evaluates MSBuild, so such a reference is invisible and the test
 * project looks like it points nowhere. Refusing is right; the DEFAULT SENTENCE
 * is not, because it tells the human to create a `<Source>.Tests` project that
 * is sitting right there and already references the source. Amendment 5's rule
 * is that a refusal must name something the human can perform, and "go create
 * the thing you already have" is the shape it exists to stop.
 */
function unresolvedTestProjectRefs(sourceProjectDir: string, deps: TddDeps): Array<{ csproj: string; include: string }> {
  const found: Array<{ csproj: string; include: string }> = [];
  for (const dir of candidateDirs(sourceProjectDir, deps)) {
    for (const { path: csproj, text } of csprojTexts(dir, deps)) {
      if (!isTestProject(text)) {
        continue;
      }
      for (const include of projectReferenceIncludes(text)) {
        if (include.includes("$(")) {
          found.push({ csproj, include });
        }
      }
    }
  }
  return found;
}

/** The one `*.csproj` in a directory, chosen the way `CsOracle` chooses it, so
 *  the rung and the check never disagree about which project a file belongs
 *  to. */
function findCsproj(dir: string, deps: TddDeps): string | undefined {
  const names = (readDirOf(deps)(dir) ?? []).filter((n) => n.toLowerCase().endsWith(".csproj")).sort();
  return names.length > 0 ? path.join(dir, names[0]) : undefined;
}

function refuse(reason: PlacementRefusal["reason"], detail: string): PlacementResult {
  return { ok: false, refusal: { reason, detail } };
}

/**
 * Where a C# test goes, and it is the only leg whose target lives in a different
 * PROJECT from the source. That is the case that forced the rung to take a
 * resolved placement rather than a file path: `runRoot` is the TEST project's
 * directory, and every command runs there.
 *
 * The test project is FOUND, never created. The human's boundary is that this
 * gesture creates a test FILE; a missing test project is `no-test-project` and
 * names what was looked for.
 *
 * THE ONE-TO-MANY TRAP is real on the corpus: `Contoso.ProcessingLogic.Tests`
 * references `Contoso.DataModel`, `Contoso.ProcessingLogic` AND
 * `Contoso.Portal.Api`, so one test project serves three source projects, and
 * nothing stops two test projects from serving one. When more than one matches,
 * `<Source>.Tests` wins by name, and when that does not decide it, the refusal
 * NAMES the candidates rather than guessing.
 */
function csPlacementFor(filePath: string, symbolName: string, deps: TddDeps): PlacementResult {
  const exists = fileExistsOf(deps);
  const readFile = readFileOf(deps);
  const oracle = new CsOracle({
    fileExists: exists,
    readFile,
    readDir: (dir) => readDirOf(deps)(dir) ?? [],
    log: deps.log,
  });
  // The SAME project resolution the check uses, deliberately. Stated trade: it
  // also inherits CsOracle's SDK floor, so a global.json pinning below SDK 8
  // refuses the rung too. The detail names that reason rather than claiming
  // there is no project, and one C# project resolution beats two that can
  // disagree about which project owns a file.
  const sourceProjectDir = oracle.detectCrateRoot(filePath);
  if (sourceProjectDir === undefined) {
    return refuse("no-project-root", `${oracle.describeMissingRoot(filePath) ?? `no .csproj above ${filePath}`}, so there is no project to test`);
  }
  const sourceCsproj = findCsproj(sourceProjectDir, deps);
  if (sourceCsproj === undefined) {
    return refuse("no-project-root", `no .csproj in ${sourceProjectDir}, so there is no project to test`);
  }

  const sourceName = path.basename(sourceCsproj, path.extname(sourceCsproj));
  const candidates = testProjectsFor(sourceProjectDir, sourceCsproj, deps);
  if (candidates.length === 0) {
    const unresolved = unresolvedTestProjectRefs(sourceProjectDir, deps);
    if (unresolved.length > 0) {
      return refuse(
        "no-test-project",
        `${unresolved.map((u) => `${path.basename(u.csproj)} references \`${u.include}\``).join(", and ")}. ` +
          "That path holds an unresolved MSBuild variable, and this gesture does not evaluate MSBuild, so it " +
          `cannot tell whether the reference points back at ${path.basename(sourceCsproj)}. Spell the path ` +
          "literally in that `<ProjectReference>`, or write the test yourself.",
      );
    }
    return refuse(
      "no-test-project",
      `no test project references ${path.basename(sourceCsproj)}. Looked for a project carrying ` +
        "`<IsTestProject>true</IsTestProject>` or a `Microsoft.NET.Test.Sdk` package reference AND a " +
        `\`<ProjectReference>\` back to this project, beside ${sourceProjectDir} and in any solution above it. ` +
        `This gesture writes a test FILE into an existing test project; create a \`${sourceName}.Tests\` ` +
        "project yourself and it will be used.",
    );
  }
  const chosen =
    candidates.length === 1
      ? candidates[0]
      : candidates.find((c) => path.basename(c.csproj, ".csproj").toLowerCase() === `${sourceName.toLowerCase()}.tests`);
  if (chosen === undefined) {
    return refuse(
      "ambiguous-test-project",
      `${candidates.length} test projects reference ${path.basename(sourceCsproj)} and none is named ` +
        `\`${sourceName}.Tests\`, so there is no way to tell which one the test belongs in: ` +
        `${candidates.map((c) => path.basename(c.csproj)).join(", ")}.`,
    );
  }

  // Microsoft.Testing.Platform. Under `<EnableMSTestRunner>true</EnableMSTestRunner>`
  // on SDK 10, `dotnet test --filter` HARD FAILS with "Testing with VSTest target
  // is no longer supported" — loud, not silent, which is better than the goal
  // feared. Detected and refused by NAME rather than served by a second command
  // path, because nothing on this machine uses MTP in anger and a second path
  // would be built on reasoning rather than measurement. This is `goal.md`'s own
  // stated alternative.
  if (propertyIsTrue(chosen.text, "EnableMSTestRunner") || propertyIsTrue(chosen.text, "UseMicrosoftTestingPlatformRunner")) {
    return refuse(
      "unsupported-runner",
      `${path.basename(chosen.csproj)} sets \`<EnableMSTestRunner>true</EnableMSTestRunner>\`, so it runs on ` +
        "Microsoft.Testing.Platform. This rung drives `dotnet test --filter`, which that mode rejects outright " +
        "on the .NET 10 SDK. Remove the property to use the VSTest path, or run those tests yourself.",
    );
  }

  const relDir = path.relative(sourceProjectDir, path.dirname(filePath));
  if (relDir.startsWith("..") || path.isAbsolute(relDir)) {
    return refuse("no-project-root", `${filePath} does not sit under ${sourceProjectDir}, so it has no place to mirror in the test project`);
  }
  const stem = path.basename(filePath, path.extname(filePath));
  const targetPath = path.join(chosen.dir, relDir, `${stem.endsWith("Tests") ? stem : `${stem}Tests`}.cs`);

  // The namespace the generated file DECLARES: the test project's root
  // namespace plus the mirrored folders, which is MSBuild's own rule.
  const testRoot = propertyValue(chosen.text, "RootNamespace") ?? path.basename(chosen.csproj, ".csproj");
  const segments = relDir.length === 0 ? [] : relDir.split(path.sep).map(namespaceSegment);
  const packageName = [testRoot, ...segments].join(".");

  // The using for the unit under test, read from the SOURCE rather than guessed
  // from the directory, and omitted when C# name lookup already finds it: a test
  // in `A.B.Tests` sees everything in `A.B` and in `A`, because lookup walks the
  // ENCLOSING namespaces. Writing the redundant using would still compile; not
  // writing it is what keeps the plan a small append instead of a whole-file one.
  const sourceNamespace = csNamespaceOf(readFile(filePath) ?? "");
  const implied =
    sourceNamespace === undefined || packageName === sourceNamespace || packageName.startsWith(`${sourceNamespace}.`);
  const importLine = implied ? undefined : `using ${sourceNamespace};`;

  const framework = detectedFramework(chosen.dir, deps);
  const using = frameworkUsing(framework);
  // A `global using` already in the test project makes the per-file using
  // redundant. The corpus does exactly this: `GlobalUsings.cs` holds
  // `global using Microsoft.VisualStudio.TestTools.UnitTesting;`.
  const frameworkImportLine =
    using === undefined || hasGlobalUsing(chosen.dir, using, deps) ? undefined : using;

  if (!/^[A-Za-z_]\w*$/.test(symbolName)) {
    deps.log?.(`[tdd] csharp: \`${symbolName}\` is not a plain identifier; placing by file name only`);
  }
  return {
    ok: true,
    placement: {
      targetPath,
      exists: exists(targetPath),
      mode: "project-file",
      // NOT the source project. This is the whole reason the seam carries a
      // resolved placement.
      runRoot: chosen.dir,
      packageArg: path.basename(chosen.csproj),
      packageName,
      ...(importLine === undefined ? {} : { importLine }),
      ...(frameworkImportLine === undefined ? {} : { frameworkImportLine }),
      // Amendment 8d. The scaffold needs the framework's ATTRIBUTES as well as
      // its using, and `frameworkImportLine` goes ABSENT the moment the project
      // carries a `global using` for it — which the corpus does. Carrying the id
      // is what keeps `[TestClass]` correct in exactly that case.
      ...(framework === undefined ? {} : { frameworkId: framework.id }),
    },
  };
}

/**
 * Where a DISCOVERED C# test file runs from, and this is the leg the seam's new
 * member exists for.
 *
 * `csPlacementFor` above searches OUTWARD for a project that TESTS the one the
 * file sits in, because its question is where a new test file goes. Asked that
 * question about a file already inside a test project, it either refuses (the
 * corpus shape: nothing tests the tests) or walks out to a `<Name>.Tests.Tests`
 * project the tests are not in. Neither answer runs this file.
 *
 * So this walks UP to the nearest `.csproj` instead, which is the project that
 * COMPILES the file, and that project is what `dotnet test` is pointed at.
 */
function csRunTargetForTestFile(testFilePath: string, deps: TddDeps): PlacementResult {
  const oracle = new CsOracle({
    fileExists: fileExistsOf(deps),
    readFile: readFileOf(deps),
    readDir: (dir) => readDirOf(deps)(dir) ?? [],
    log: deps.log,
  });
  // The SAME project resolution the check and csPlacementFor use, SDK floor
  // included: one C# project resolution beats two that can disagree about which
  // project owns a file.
  const projectDir = oracle.detectCrateRoot(testFilePath);
  if (projectDir === undefined) {
    return refuse(
      "no-project-root",
      `${oracle.describeMissingRoot(testFilePath) ?? `no .csproj above ${testFilePath}`}, so there is no project to run ${path.basename(testFilePath)} from`,
    );
  }
  const csproj = findCsproj(projectDir, deps);
  if (csproj === undefined) {
    return refuse("no-project-root", `no .csproj in ${projectDir}, so there is no project to run ${path.basename(testFilePath)} from`);
  }
  const framework = detectedFramework(projectDir, deps);
  return {
    ok: true,
    placement: {
      targetPath: testFilePath,
      exists: true,
      mode: "same-file",
      runRoot: projectDir,
      // Relative to runRoot, which is how every shipped consumer joins it back.
      packageArg: path.basename(csproj),
      // No packageName and no importLine: nothing is written, so there is no
      // namespace to declare and nothing to reach for.
      ...(framework === undefined ? {} : { frameworkId: framework.id }),
    },
  };
}

/** Is `using X;` already a `global using` somewhere in the test project's root
 *  directory? The `GlobalUsings.cs` convention, read as text rather than
 *  assumed by filename. */
function hasGlobalUsing(dir: string, usingLine: string, deps: TddDeps): boolean {
  const namespaceOfUsing = usingLine.replace(/^using\s+/, "").replace(/;\s*$/, "");
  const wanted = new RegExp(`global\\s+using\\s+(?:global::)?${namespaceOfUsing.replace(/\./g, "\\.")}\\s*;`);
  const readFile = readFileOf(deps);
  for (const name of readDirOf(deps)(dir) ?? []) {
    if (name.toLowerCase().endsWith(".cs") && wanted.test(readFile(path.join(dir, name)) ?? "")) {
      return true;
    }
  }
  return false;
}

// ===========================================================================
// The scaffold
// ===========================================================================

const CS_MARKER_PREFIX = "//";

/** The top-level classes of a file, as their body's brace span. Literal-aware,
 *  and OUTERMOST only: a nested class sits inside a span already found, and
 *  appending a test method to it would put the test where the runner does not
 *  look for one. */
function topLevelClasses(text: string): Array<{ open: number; close: number }> {
  const spans: Array<{ open: number; close: number }> = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, CS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (
      text.startsWith("class", i) &&
      !isIdentChar(text[i - 1] ?? "") &&
      !isIdentChar(text[i + 5]) &&
      spans.every((s) => i < s.open || i > s.close)
    ) {
      // Past the name, any type parameters, a base list and any `where`
      // constraints, to the `{` that opens the body. Scanned literal-aware so a
      // brace inside an attribute string on the way is not mistaken for it.
      let j = i + 5;
      let open = -1;
      while (j < text.length) {
        const inner = skipLiteralOrComment(text, j, CS_LITERALS);
        if (inner > j) {
          j = inner;
          continue;
        }
        if (text[j] === "{") {
          open = j;
          break;
        }
        if (text[j] === ";") {
          break;
        }
        j++;
      }
      const close = open === -1 ? -1 : matchDelim(text, open);
      if (close !== -1) {
        spans.push({ open, close });
        i = open + 1;
        continue;
      }
    }
    i++;
  }
  return spans;
}

/**
 * Every `using X;` DIRECTIVE in a file, with the namespace each brings into
 * scope and the offset just past its `;`.
 *
 * Walked with the shared literal-aware scanner rather than matched by regex,
 * which is the lesson phase 3 learned and phase 4 repeated: a `using` shown as
 * example code inside a `///` doc comment or a verbatim string is not a
 * directive, and treating it as one makes the scaffold DROP a using the
 * generated file really needs. That is the failure in the bad direction: the
 * file then does not compile, and the human gets a red they did not cause.
 *
 * A `using (var s = …)` STATEMENT and a `using X = Y;` ALIAS are both excluded:
 * the first has a `(`, the second binds a different name.
 */
function usingDirectives(text: string): Array<{ end: number; name: string }> {
  const out: Array<{ end: number; name: string }> = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, CS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (text.startsWith("using", i) && !isIdentChar(text[i - 1] ?? "") && !isIdentChar(text[i + 5])) {
      const m = /^\s+(?:static\s+)?(?:global::)?([A-Za-z_][\w.]*)\s*;/.exec(text.slice(i + 5));
      if (m !== null) {
        out.push({ end: i + 5 + m[0].length, name: m[1] });
        i += 5 + m[0].length;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** The end of the last top-level `using X;` directive, or -1. */
function lastUsingEnd(text: string): number {
  const all = usingDirectives(text);
  return all.length === 0 ? -1 : all[all.length - 1].end;
}

function usingAlreadyPresent(text: string, line: string): boolean {
  const wanted = /^using\s+(?:static\s+)?(?:global::)?([A-Za-z_][\w.]*)\s*;$/.exec(line.trim().replace(/\s+/g, " "));
  return wanted !== null && usingDirectives(text).some((u) => u.name === wanted[1]);
}

/**
 * Where the generated tests go inside the target file.
 *
 * Three modes, and the third is C#'s own: a C# test method cannot sit at file
 * scope, so `extend-existing` inserts INSIDE the existing test class rather than
 * appending at the end of the file the way every other leg does.
 *
 * THE WHOLE-FILE PLAN, and phase 4's note is the one that matters. A `using` has
 * to go near the TOP while the tests go inside a class BODY, and a
 * TestInsertionPlan is ONE contiguous replacement, so adding a using forces the
 * span to cover the file. That plan is indistinguishable BY MODE from a small
 * append, and the shipped consumer only previews `replace-generated`. What this
 * leg owes phase 6 is DETECTABILITY without a new mode string, and the test is
 * exactly phase 4's: `start === 0 && end === existingText.length` over a
 * NON-EMPTY file, which the narrow branches below can never produce.
 */
function csScaffold(input: ScaffoldInput): TestInsertionPlan {
  const { begin, end } = testMarkers(input.markerId, CS_MARKER_PREFIX);
  const text = input.existingText;

  // 1. replace-generated: a prior marked region for this markerId. Swap exactly
  //    it, so regenerating is idempotent and the developer's own tests in the
  //    same file are never touched.
  const bi = text.indexOf(begin);
  if (bi !== -1) {
    const ei = text.indexOf(end, bi);
    if (ei !== -1) {
      // The region keeps the indentation it already had: it is being replaced in
      // place, inside whatever class body it already sits in.
      const lineStart = text.lastIndexOf("\n", bi) + 1;
      const indent = text.slice(lineStart, bi);
      return {
        start: bi,
        end: ei + end.length,
        mode: "replace-generated",
        text: markedRegion(begin, end, input.generatedTests, /^\s*$/.test(indent) ? indent : "    ").trimStart(),
      };
    }
  }

  const wanted = [input.placement.frameworkImportLine, input.placement.importLine].filter(
    (l): l is string => l !== undefined && l.length > 0,
  );

  // 2. the whole file, when there is no file yet.
  if (text.trim().length === 0) {
    return { start: 0, end: text.length, mode: "new-module", text: csNewFile(input, wanted, begin, end) };
  }

  // 3. extend-existing, INSIDE the last top-level class. A `[TestMethod]` at
  //    file scope is not a test, it is a syntax error.
  const classes = topLevelClasses(text);
  const host = classes[classes.length - 1];
  const missing = wanted.filter((line) => !usingAlreadyPresent(text, line));
  const region = markedRegion(begin, end, input.generatedTests, "    ");
  if (host === undefined) {
    // No class to extend: append a whole test class rather than emitting an
    // orphan method. Still `extend-existing` — the file is the developer's and
    // this adds to it.
    const cls = csTestClass(input, region);
    const tail = `${text.endsWith("\n") ? "" : "\n"}\n${cls}`;
    return missing.length === 0
      ? { start: text.length, end: text.length, mode: "extend-existing", text: tail }
      : { start: 0, end: text.length, mode: "extend-existing", text: `${withUsings(text, missing)}${tail}` };
  }
  const insertAt = host.close;
  const before = text.slice(0, insertAt).endsWith("\n") ? "" : "\n";
  const inserted = `${before}${region}\n`;
  if (missing.length === 0) {
    return { start: insertAt, end: insertAt, mode: "extend-existing", text: inserted };
  }
  const withHead = withUsings(text, missing);
  const shift = withHead.length - text.length;
  return {
    start: 0,
    end: text.length,
    mode: "extend-existing",
    text: `${withHead.slice(0, insertAt + shift)}${inserted}${withHead.slice(insertAt + shift)}`,
  };
}

/** The marked region, indented to sit inside a class body. */
function markedRegion(begin: string, end: string, generatedTests: string, indent: string): string {
  return `${indent}${begin}\n${reindent(generatedTests, indent)}\n${indent}${end}`;
}

/** `text` with each using inserted after the last existing one, or at the very
 *  top when there is none. A using must precede the namespace declaration. */
function withUsings(text: string, lines: string[]): string {
  const at = lastUsingEnd(text);
  const block = lines.join("\n");
  return at === -1 ? `${block}\n\n${text}` : `${text.slice(0, at)}\n${block}${text.slice(at)}`;
}

/** The class name for the generated file: the target file's own stem, which is
 *  the C# convention and the one thing about the file the scaffold can see. */
function testClassName(input: ScaffoldInput): string {
  const stem = path.basename(input.placement.targetPath, ".cs");
  const cleaned = stem.replace(/[^\w]/g, "_");
  return /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function csTestClass(input: ScaffoldInput, region: string): string {
  const attribute = CS_CLASS_ATTRIBUTE[input.placement.frameworkId ?? MSTEST.id] ?? "[TestClass]";
  const head = attribute.length === 0 ? "" : `${attribute}\n`;
  return `${head}public class ${testClassName(input)}\n{\n${region}\n}\n`;
}

function csNewFile(input: ScaffoldInput, usings: string[], begin: string, end: string): string {
  const parts: string[] = [];
  if (usings.length > 0) {
    parts.push(`${usings.join("\n")}\n`);
  }
  if (input.placement.packageName !== undefined && input.placement.packageName.length > 0) {
    // File-scoped, which is the modern spelling and keeps the class body at one
    // level of indentation, matching the region this file emits.
    parts.push(`namespace ${input.placement.packageName};\n`);
  }
  parts.push(csTestClass(input, markedRegion(begin, end, input.generatedTests, "    ")));
  return parts.join("\n");
}

/** A `where T : class` constraint leaves `class where` in the text, and a head
 *  regex reads that as a type named `where`. None of these is ever a type name. */
const CS_NOT_A_TYPE_NAME = new Set([
  "where",
  "new",
  "class",
  "struct",
  "record",
  "interface",
  "namespace",
  "unmanaged",
  "notnull",
  "default",
]);

/** A namespace or type head. Every dotted segment may be ESCAPED (`@class`),
 *  which is how a C# identifier collides with a keyword and stays legal.
 *  Sticky, so the scan never slices the source. */
const CS_SCOPE_HEAD = /(namespace|class|struct|record|interface)\s+(@?[A-Za-z_]\w*(?:\.@?[A-Za-z_]\w*)*)/y;

/** `@` is SOURCE syntax and the CLR never sees it, so VSTest spells
 *  `namespace @namespace` as `namespace`. Measured on dotnet 10.0.111:
 *  `=namespace.VerbChecks.Add` selects one test, `=VerbChecks.Add` matches
 *  nothing. A head that could not read the escape dropped the namespace, the
 *  class alone still looked qualified, and `=` fired at a name no assembly
 *  holds — the silent-zero shape again. */
function csUnescapeName(name: string): string {
  return name.replace(/(^|\.)@/g, "$1");
}

/**
 * The FULLY-QUALIFIED name of the type enclosing `index`, the way VSTest spells
 * it: `Falsifier.Widgets.WidgetChecks`, and `Ns.Outer+WidgetChecks` for a nested
 * class. undefined when no type encloses the position.
 *
 * It exists because `FullyQualifiedName=` matches the whole name and nothing
 * less. Measured on dotnet 10.0.111: `=Add` against a bare method name matches
 * NOTHING, `=Ns.Outer.Inner.Add` for a nested class matches nothing either, and
 * `=Ns.Outer+Inner.Add` matches one. A command that selects no test reads as a
 * passing rung with nothing in it, so the operator and the name have to move
 * together or neither moves.
 *
 * A GENERIC enclosing type refuses: the CLR spells it ``Foo`1`` and this build
 * has not measured that, so the caller keeps the substring filter, which
 * over-selects and never selects nothing.
 */
export function csEnclosingTypePath(text: string, index: number): string | undefined {
  const stack: Array<{ kind: string; name: string; depth: number; generic: boolean }> = [];
  let fileScopedNs: string | undefined;
  let pending: { kind: string; name: string; generic: boolean } | undefined;
  let depth = 0;
  let i = 0;
  const limit = Math.min(index, (text ?? "").length);
  while (i < limit) {
    const skipped = skipLiteralOrComment(text, i, CS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = text[i];
    if (c === "{") {
      depth++;
      if (pending !== undefined) {
        stack.push({ ...pending, depth });
        pending = undefined;
      }
      i++;
      continue;
    }
    if (c === "}") {
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }
      depth--;
      i++;
      continue;
    }
    if (c === ";") {
      // `namespace X;` is file-scoped: it opens no brace and never closes, so it
      // cannot live on the depth stack.
      if (pending?.kind === "namespace") {
        fileScopedNs = pending.name;
      }
      pending = undefined;
      i++;
      continue;
    }
    if (/[a-z]/.test(c) && !isIdentChar(text[i - 1] ?? "")) {
      CS_SCOPE_HEAD.lastIndex = i;
      const m = CS_SCOPE_HEAD.exec(text);
      // Tested on the RAW capture: `where T : class where U : struct` leaves a
      // bare `where` that is a constraint, while `@where` is a real type named
      // `where` and the escape is what says so.
      if (m !== null && !CS_NOT_A_TYPE_NAME.has(m[2])) {
        pending = { kind: m[1], name: csUnescapeName(m[2]), generic: text[CS_SCOPE_HEAD.lastIndex] === "<" };
        i = CS_SCOPE_HEAD.lastIndex;
        continue;
      }
    }
    i++;
  }
  const types = stack.filter((e) => e.kind !== "namespace");
  if (types.length === 0 || types.some((e) => e.generic)) {
    return undefined;
  }
  const namespaces = [fileScopedNs, ...stack.filter((e) => e.kind === "namespace").map((e) => e.name)].filter(
    (n): n is string => n !== undefined,
  );
  const typePath = types.map((e) => e.name).join("+");
  return namespaces.length === 0 ? typePath : `${namespaces.join(".")}.${typePath}`;
}

/**
 * The names of the test METHODS previously generated for markerId.
 *
 * Walked with the shared literal-aware scanner and the same declaration parser
 * the classifier uses, never a raw regex, for the reason phase 3 learned the
 * hard way and phase 4 hit again: a regex found a phantom test name inside
 * `submit('save')`. Here the equivalent is a call in an assertion body, or a
 * method name spelled inside a verbatim string, and a filter naming a test the
 * runner never registered comes back as a filter miss the human did not cause.
 *
 * Only declarations at the region's TOP level count, so a local function inside
 * a test body is not mistaken for a test.
 *
 * Each name is FULLY QUALIFIED (`Falsifier.Widgets.WidgetChecks.Add`), because
 * that is the only string `FullyQualifiedName=` matches; without it the rung is
 * a CONTAINS filter and `Add` also runs `AddMore`. A method whose enclosing type
 * does not resolve — or a GENERIC method, whose VSTest name this build has not
 * measured — stays bare, and `buildCsCommand` then keeps `~` for the whole
 * command rather than pairing `=` with a name it cannot match.
 */
function csGeneratedTestNames(fileText: string, markerId: string): string[] {
  const { begin, end } = testMarkers(markerId, CS_MARKER_PREFIX);
  const bi = fileText.indexOf(begin);
  if (bi === -1) {
    return [];
  }
  const ei = fileText.indexOf(end, bi);
  if (ei === -1) {
    return [];
  }
  const region = fileText.slice(bi + begin.length, ei);
  const typePath = csEnclosingTypePath(fileText, bi);
  const names: string[] = [];
  let i = 0;
  let depth = 0;
  while (i < region.length) {
    const skipped = skipLiteralOrComment(region, i, CS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (region[i] === "{") {
      depth++;
      i++;
      continue;
    }
    if (region[i] === "}") {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && (region[i] === "[" || /[A-Za-z_]/.test(region[i]))) {
      const head = csMethodHead(region, i);
      if (head !== undefined) {
        // The bare name: a generic test method is filtered by its name, and
        // `Widen<int>` is not a name VSTest would ever match.
        const generic = head.name.includes("<");
        const bare = generic ? head.name.slice(0, head.name.indexOf("<")) : head.name;
        if (!bare.includes(".")) {
          // A generic method keeps its bare name, which holds the whole command
          // on `~`: the CLR name of a generic method is not measured here, and a
          // wrong exact name selects zero tests.
          names.push(typePath === undefined || generic ? bare : `${typePath}.${bare}`);
        }
        i = head.paramsOpen + 1;
        continue;
      }
    }
    i++;
  }
  return names;
}

// ===========================================================================
// The language
// ===========================================================================

const CS_TDD_LANG: TddLang = {
  languageId: "csharp",
  displayName: "C#",

  placementFor: csPlacementFor,

  // `dotnet test <project> --filter A|B` from the test project's directory: one
  // spawn covers one PROJECT, whatever files the tests in it sit in.
  runScope: "package",

  runTargetForTestFile: csRunTargetForTestFile,

  scaffold: csScaffold,

  markerPrefix: CS_MARKER_PREFIX,

  generatedTestNames: csGeneratedTestNames,

  // No testNameIsValid. MSTest, xUnit and NUnit each collect by ATTRIBUTE, not
  // by name, so unlike `go test` none of them silently ignores a badly named
  // method. The attribute is the model's to write and the prompt names it.

  // Amendment 8a's third parameter, threaded straight through: the caller that
  // holds the source project directory computes it with `csInternalsVisibleTo`,
  // and a caller that does not gets the safe default of not visible.
  classifyTestability: classifyCsTestability,

  // PHASE 6: the caller no longer has to know that C# is the language with a
  // project fact. It asks the leg for the ctx and passes whatever comes back.
  testabilityContextFor: csTestabilityContext,

  returnTypeOf: csReturnTypeOf,

  renderBlankValue: csRenderBlankValue,

  // MSTest first, per the contract's precedence. Only one of the three is ever
  // declared in a real project, so precedence rarely decides anything — this is
  // not the node problem, where a repo mid-migration declares two at once.
  frameworks: CS_FRAMEWORKS,

  // Amendment 8b's detail. C# is the leg that needs it, because its honest-dark
  // case is a real test project that declares no test framework, and `lookedFor`
  // alone cannot say WHICH project was read.
  frameworkRefusalDetail(root) {
    return (
      `${path.basename(root)} is a test project but declares no test framework: looked for ` +
      `${CS_FRAMEWORKS.map((f) => f.displayName).join(", ")} in its <PackageReference> items. ` +
      "Add one yourself; this gesture never installs a package."
    );
  },
};

export { CS_TDD_LANG, MSTEST, XUNIT, NUNIT };
