/**
 * Fn-gen prompt assembly. The whole product identity hangs on what is NOT
 * here: the prompt is signature + doc comment + the user's ordered context
 * blocks and nothing else — no repo scraping, no automatic inclusion, no
 * hidden system message. Deterministic: same input, same bytes.
 */

/** 1-based inclusive line range. It is the block's IDENTITY, not a label:
 *  `resolveForPrompt` slices exactly these lines out of the live document to
 *  build the payload. It renders in the prompt as a label too. */
export interface ContextBlockRange {
  startLine: number;
  endLine: number;
}

/**
 * One block of context the user explicitly added, resolved. `text` is what
 * those lines read at the moment the prompt was assembled, not a copy taken at
 * add time: contextBlocks owns the store, the anchor and the read. The fn-gen
 * service only ever receives an ordered list of these.
 */
export interface ContextBlock {
  uri: string;
  range: ContextBlockRange;
  text: string;
}

/** The generation kind routing the prompt shape. "function" (or omitted)
 *  reproduces the exact v1 function bytes. The four type kinds route the
 *  per-language type-definition instruction. One shared alias so the four
 *  places that carry a kind (prompt, fnGenService, repair, the vscode
 *  resolver) cannot drift apart. The type-kind SET a language admits is a
 *  vscode-layer decision (typeKindsFor in src/vscode/fnGen.ts); this union is
 *  every kind any language can route, so Rust only ever produces struct/enum. */
export type GenKind = "function" | "struct" | "enum" | "class" | "interface";

/** The type kinds, split out from GenKind so the instruction router can take a
 *  non-function kind without re-narrowing. */
export type TypeGenKind = Exclude<GenKind, "function">;

export interface FnGenPromptInput {
  signature: string;
  docComment?: string;
  /** Ordered; rendered in list order. Default empty. */
  contextBlocks?: ContextBlock[];
  /** Code-fence tag for the target block; empty fence when absent. */
  languageId?: string;
  /** v2 round-1 pre-fill: auto-injected API surface for types named in the
   *  signature/doc. Rendered as a visible, labelled block when present; absent
   *  keeps the prompt byte-identical to the v1 identity. */
  injectedSurface?: string;
  /** v2 punt mitigation: append a firm "implement it fully, no stubs" directive
   *  to the instruction. Off (default) keeps the v1 prompt bytes. */
  noPunt?: boolean;
  /** Structure generation: which symbol the target block holds. A type routes
   *  the instruction to "complete the type definition" (the member noun is
   *  per-language: Rust fields/variants, C#/TS members); the header carries
   *  little signal, the doc comment carries the semantics. Omitted or
   *  "function" reproduces the exact v1 bytes — the frozen prompt-identity
   *  oracles hang on that. */
  kind?: GenKind;
  /** Generate only the BODY, below an already-written header and docstring that
   *  are shown as context (Python Fork A — the docstring is the preserved spec,
   *  kept outside the generated span). The model must not repeat the signature or
   *  the docstring. Omitted/false reproduces the exact prior bytes. */
  bodyOnly?: boolean;
  /** The DOC COMMENT's own column, so it renders 0-based instead of ragged.
   *  Named for what it drives: in this prompt it reaches only the doc render.
   *  It is NOT always the header's indent - a Python docstring arrives already
   *  0-based from `stripPyDocstring`, so a bodyOnly target passes "" and any
   *  other value strips a level the docstring never had, straight out of the
   *  prose (adversarial review D2). Omitted reproduces the v1 bytes. */
  spanIndent?: string;
  /** Names DEFINED in the target's own file that the signature/doc references,
   *  so the model refers to them directly instead of inventing a
   *  `use somecrate::LocalType;` for a same-file definition it cannot otherwise
   *  see. Rendered as a visible section when non-empty; absent or empty keeps
   *  the prompt byte-identical to the prior identity. */
  localSymbols?: string[];
  /** The comments the developer left at the body's own depth: `// step 1`,
   *  `// step 2`. They are the spec the human just wrote, so they render as a
   *  labelled instruction section above the reference material, never silently.
   *  Absent or empty keeps every existing prompt byte-identical.
   *
   *  Generation ONLY. The test-authoring pass never receives these: an internal
   *  comment is an algorithm note, and a test authored from one couples to the
   *  algorithm instead of the behaviour. */
  scaffoldComments?: string[];
}

import { fenceFor } from "./instructPostprocess";
import { noPuntInstructionFor } from "./punt";
import { dedentDocComment } from "./reindent";

/** Test-authoring pass input. The contract half (signature + doc) plus the
 *  resolved collaborator surface; never a reference implementation (blind). */
export interface TestGenPromptInput {
  signature: string;
  docComment?: string;
  /** ADDED session-v68 phase 4. The user's ordered context blocks, rendered as
   *  the prompt HEAD exactly as `assembleFnGenPrompt` renders them.
   *
   *  The machinery already existed and the seam was ONE MISSING CALL: blocks
   *  rode into generation and repair through `renderContextPrefix` and were
   *  invisible to test authoring, so a staged block reached three of the four
   *  ways into the model and not the fourth.
   *
   *  What it buys is the thing the product cannot guess: which attribute drives
   *  an async test in THIS project — tokio, async-std, smol, or something
   *  in-house. The developer hands over a test-function template. Blind-safe by
   *  construction, because a test template is not the function body; the one
   *  block that would break blindness is the target's own body, and that is
   *  decidable at the command layer, where the resolved span lives.
   *
   *  Absent or empty keeps every assembled prompt byte-identical. */
  contextBlocks?: ContextBlock[];
  /** The doc comment's own column. Same field and same reason as
   *  FnGenPromptInput's. */
  spanIndent?: string;
  /** Resolved callee signatures so the test can construct inputs / call
   *  collaborators. Rendered as a labelled section; absent = none. */
  calleeSurface?: string;
  languageId?: string;
  /** ADDED phase 6. The RESOLVED framework's assertion idiom
   *  (`TestFramework.assertionInstruction`), so the model writes
   *  `Assert.AreEqual(expected, actual)` for MSTest and `expect(actual).toBe(…)`
   *  for vitest. Absent, or a `rust` languageId, keeps the frozen Rust
   *  instruction byte-for-byte. */
  assertionInstruction?: string;
  /** ADDED phase 6. The language's human name, as the instruction's first line
   *  spells it ("Go", "TypeScript", "C#"). */
  languageName?: string;
  /** ADDED session-v68 phase 1. The RESOLVED framework's TABLE idiom
   *  (`TestFramework.tableShape`), for a framework whose table idiom is not its
   *  language's default. It rides on the framework for the same reason
   *  `assertionInstruction` and `replyShape` do: the table clause and the
   *  assertion clause land in ONE prompt and must not contradict, and only the
   *  framework knows both. C# is the case that forces it - NUnit spells a row
   *  `[TestCase(...)]`, xUnit `[Theory]` plus `[InlineData(...)]` and MSTest
   *  `[DataTestMethod]` plus `[DataRow(...)]`, three idioms inside one
   *  languageId. python/unittest is the second: it has no `parametrize`, so its
   *  rows live in a plain list walked under `self.subTest`.
   *  Absent falls back to the languageId default below. */
  tableShape?: string;
  /** ADDED session-v68 phase 1 (adversarial review). Can this framework's ROWS
   *  hold a constructed value?
   *
   *  C#'s three row attributes take compile-time CONSTANTS only, so the
   *  constructed-column knob rule is structurally unreachable there and stating
   *  it puts two contradicting instructions in one prompt. True suppresses that
   *  clause and leaves the group rule to carry the case. Absent means the rows
   *  can hold anything, which is true of the other five frameworks. */
  rowsAreConstantsOnly?: boolean;
  /** ADDED session-v68 phase 5. The shape a test takes when the TARGET is async,
   *  resolved off the project (`TestabilityContext.asyncTest.shape`): the Rust
   *  runtime attribute that this Cargo.toml actually provides,
   *  `@pytest.mark.asyncio`, `unittest.IsolatedAsyncioTestCase`, a
   *  `public async Task` method, an `async` callback.
   *
   *  Never guessed. Rust has no stdlib answer and the attribute differs per
   *  runtime, so an invented one produces a test that does not compile, which is
   *  worse than the refusal it replaced. Absent means the target is not async
   *  and keeps every prompt byte-identical. */
  asyncTestShape?: string;
  /** ADDED session-v68 phase 6. The enclosing type, when the target is a METHOD
   *  the gesture admitted because that type's surface carries a producer.
   *
   *  A table of rows over a method needs the receiver built somewhere, and the
   *  model has to be told to build it from the collaborator surface rather than
   *  mock it. Absent means the target is a free function and keeps every prompt
   *  byte-identical. */
  receiverTypeName?: string;
  /** ADDED phase 6 loop 2. The RESOLVED framework's reply SHAPE
   *  (`TestFramework.replyShape`), for a framework whose shape is not its
   *  language's default. It has to come off the framework for the same reason
   *  `assertionInstruction` does: python/unittest needs its tests on a
   *  `unittest.TestCase` class, and a shape clause keyed on `python` demanded
   *  bare top-level functions in the SAME prompt, and a model obeying the
   *  shape clause then wrote a module `python -m unittest` does not collect.
   *  Absent falls back to the languageId default below. */
  replyShape?: string;
}

// ONE sentence, shared by every language, because ONE locator rule reads it: the
// expected-value span in a generated table is the row's LAST column, in all five
// languages and all nine frameworks. Written once so the wordings cannot drift -
// the first draft of this phase had four languages saying "IS THE LAST COLUMN"
// and the TS family saying "IN THE LAST COLUMN", which the blind oracle caught.
export const LAST_COLUMN_CLAUSE = "THE EXPECTED VALUE IS THE LAST COLUMN OF EVERY ROW";

// The blind test-authoring instruction. Encodes unit-testing-discipline (one
// parameterized table over rows, each row one case; few rows), the blind-oracle
// rule (author from the contract, never a reference implementation), the reply
// shape (one `#[cfg(test)] mod tests` block), the panic-message rule (bare
// #[should_panic], never a guessed expected=), and the mocking ladder (real
// collaborators, never a fake). The human blanks the expected values after (the
// tabstop pass); the model proposes concrete rows so each row is syntactically
// complete and its last column is locatable.
//
// SUPERSESSION S31 (session-v68, ruled by the human 2026-09-10). Through v67 this
// string FORBADE the table and demanded one inline `assert_eq!` per case. The
// reversal is not about output quality - eight measurement arms failed to make
// the model write better cases - it is about the AFFORDANCE. A developer who
// spots a missing case adds one line to an array instead of copying a whole test
// function, renaming it and rebuilding a fixture. What survives unchanged is the
// half that keeps the blank-value invariant standing: every expected value is a
// LITERAL, spelled out on its own line, never pulled from a name.
const TEST_GEN_INSTRUCTION =
  "Write unit tests for the Rust function whose contract is given below. You are given ONLY the " +
  "contract: the doc comment and the signature. Do NOT write, assume, or infer a reference " +
  "implementation - author the tests from the contract alone, so they check the promised behaviour " +
  "and would catch a wrong implementation.\n\n" +
  "Reply with ONE fenced code block containing a single `#[cfg(test)] mod tests { ... }` module and " +
  "nothing else: no prose, no other items, no code before or after the block.\n\n" +
  "Inside the module write a SINGLE `#[test]` fn holding a TABLE of cases: a `let cases = [ ... ];` " +
  "array of about five rows, then ONE `for` loop over `cases` whose body holds ONE `assert_eq!`. Put " +
  "a `//` comment directly above the array naming the columns in order. Every row sits on ONE line, " +
  `and ${LAST_COLUMN_CLAUSE}. Cover the happy path plus the contract's ` +
  "named edge and failure cases.\n\n" +
  "Write each expected value out as a literal value in its own row - NEVER pull it from a shared " +
  "variable and NEVER from a named constant, because each expected value is reviewed and filled in on " +
  "its own line.\n\n" +
  "Give the table one column per input the cases vary, and READ EVERY COLUMN in the loop body: do not " +
  "declare a column the body never uses. Prefer a column carrying a value the test CONSTRUCTS (a " +
  "`Vec`, a struct, an enum value) over a scalar stand-in, so a later row can reach any case the " +
  "contract describes.\n\n" +
  "If a case cannot be a row of the same table - it needs a different shape, or a value the row cannot " +
  "carry - write it as its own separate `#[test]` fn rather than distorting the table. If a case fits " +
  "no shape at all, say so instead of writing a test that does not check it.\n\n" +
  "Only if the contract EXPLICITLY states the function must panic for some input, add a SEPARATE " +
  "`#[test]` fn with a bare `#[should_panic]` that calls it with that input. Do NOT invent a panic " +
  "case the contract does not state, and NEVER construct invalid input with `unsafe`, raw pointers, " +
  "or similar tricks to force one. Do NOT write `#[should_panic(expected = \"...\")]` unless the " +
  "contract quotes the exact panic message - a guessed message is a false failure.\n\n" +
  "Do NOT use mocks. Construct and call the real collaborators. If the function genuinely cannot be " +
  "tested without a fake, say so instead of inventing one.";

// The DEFAULT reply shape per language: what one fenced block must contain when
// the resolved framework does not state a shape of its own. Rust's is inside
// TEST_GEN_INSTRUCTION and stays there, frozen. The other four all place their
// tests in a separate file whose wrapper the SCAFFOLD writes, so the model is
// asked for the test functions alone — a model that also emits the package
// clause, the imports or the test class would have them written twice.
//
// EVERY languageId the seam registers is keyed here, not just one per family.
// `typescript` alone left `typescriptreact`, `javascript` and `javascriptreact`
// on the generic fallback while the reply GUARD covered all four, which is
// scraps D4's one-flip-at-a-time id drift in a second place.
const TS_FAMILY_REPLY_SHAPE =
  "Reply with ONE fenced code block containing ONLY the test functions, wrapped in a single `describe(...)` " +
  "block: no imports, no prose, no code before or after the block.";

const TEST_REPLY_SHAPE: Record<string, string> = {
  go:
    "Reply with ONE fenced code block containing ONLY top-level `func TestXxx(t *testing.T)` functions and " +
    "nothing else: no package clause, no import block, no prose, no code before or after the block.",
  typescript: TS_FAMILY_REPLY_SHAPE,
  typescriptreact: TS_FAMILY_REPLY_SHAPE,
  javascript: TS_FAMILY_REPLY_SHAPE,
  javascriptreact: TS_FAMILY_REPLY_SHAPE,
  python:
    "Reply with ONE fenced code block containing ONLY top-level `def test_...():` functions and nothing else: " +
    "no imports, no prose, no code before or after the block.",
  csharp:
    "Reply with ONE fenced code block containing ONLY the test METHODS, each with its framework attribute: no " +
    "namespace, no using directives, no enclosing class, no prose, no code before or after the block.",
};

const TEST_REPLY_SHAPE_DEFAULT =
  "Reply with ONE fenced code block containing ONLY the test functions and nothing else: no imports, no prose, " +
  "no code before or after the block.";

// The DEFAULT table idiom per language: what ONE parameterised table looks like
// when the resolved framework does not state an idiom of its own. Rust's is
// inside TEST_GEN_INSTRUCTION and stays there.
//
// Keyed by languageId, and EVERY registered id is keyed, not one per family —
// `typescript` alone would leave `typescriptreact`, `javascript` and
// `javascriptreact` on the generic fallback, which is scraps D4's
// one-flip-at-a-time id drift in a third place.
//
// The one sentence every language repeats is "the expected value is the LAST
// column of every row", because ONE locator rule reads it in all five.
// This clause was the only one of the five that did not name the expected column
// `want`, and the phase 2 review found the cost: a reply free to call it anything
// hands the locator a name in neither of its closed sets, and the runner's read
// gets blanked instead of the rows. Go, Python and all three C# clauses name it,
// so this one does too.
const TS_FAMILY_TABLE_SHAPE =
  "Put the cases in ONE table: `it.each([ ... ])` taking an array of about five row arrays, then one " +
  "arrow function that runs the case. Give the row a leading label column so the title reads, name the " +
  `last column \`want\`, and ${LAST_COLUMN_CLAUSE}. Every row sits on ONE line.`;

const TEST_TABLE_SHAPE: Record<string, string> = {
  go:
    "Put the cases in ONE table: `cases := []struct{ ... }{ ... }` with about five rows, then " +
    "`for _, tt := range cases { t.Run(tt.name, func(t *testing.T) { ... }) }`. Name the struct's last " +
    `field \`want\`, so ${LAST_COLUMN_CLAUSE}. Every row sits on ONE line.`,
  typescript: TS_FAMILY_TABLE_SHAPE,
  typescriptreact: TS_FAMILY_TABLE_SHAPE,
  javascript: TS_FAMILY_TABLE_SHAPE,
  javascriptreact: TS_FAMILY_TABLE_SHAPE,
  python:
    "Put the cases in ONE table: `@pytest.mark.parametrize(\"...\", [ ... ])` over about five row " +
    "tuples, on a single test function taking those names as parameters. Name the last parameter " +
    `\`want\`, so ${LAST_COLUMN_CLAUSE}. Every row sits on ONE line.`,
  // No framework resolved means the product does not know WHICH of C#'s three
  // row attributes this project uses, so the default names all three rather than
  // guessing one. The framework overrides narrow it to the right one.
  csharp:
    "Put the cases in ONE table: about five row attributes on a single test method, whose parameters " +
    "the rows fill in order - `[TestCase(...)]` for NUnit, `[InlineData(...)]` under `[Theory]` for " +
    "xUnit, `[DataRow(...)]` under `[DataTestMethod]` for MSTest. Name the last parameter `want`, so " +
    `${LAST_COLUMN_CLAUSE}. Every row sits on ONE line. These attributes take compile-time constants ` +
    "only, so a case needing a constructed value gets its own single-case test method instead of being " +
    "flattened into a scalar column.",
};

const TEST_TABLE_SHAPE_DEFAULT =
  "Put the cases in ONE table: a list of about five rows, then one runner that walks it. " +
  `${LAST_COLUMN_CLAUSE}, and every row sits on ONE line.`;

// The two knob rules, which are the whole of the table's risk. Rows are cheap
// and columns are not: a sparse table is one line from being better, and a table
// whose columns cannot express a contract clause is stuck, because rewriting the
// tuple type means rewriting every row.
//
// Rule 2 is stated here AND linted deterministically after the reply, because a
// model will not obey it on its own: the measured harness-and-rows arm declared
// a `max_bytes` knob, put it in the failure message, and never used it.
const TABLE_KNOB_RULE_DEAD_COLUMN =
  "Give the table one column per input the cases vary, and READ EVERY COLUMN in the body: do not " +
  "declare a column the body never uses.";

// Rule 1, and it is SUPPRESSED where the language cannot obey it. C#'s row
// attributes take compile-time constants only, so telling an MSTest prompt to
// prefer a constructed column and, four sentences later, that its rows cannot
// hold one, is two instructions in one prompt that contradict — the exact shape
// the python/unittest reply-shape precedent was about. Where rows are
// constants-only the group rule is the honest answer instead: a case needing a
// constructed value becomes its own single-case test.
const TABLE_KNOB_RULE_CONSTRUCTED =
  "Prefer a column carrying a value the test CONSTRUCTS (a list, a struct, an object) over a scalar " +
  "stand-in, so a later row can reach any case the contract describes.";

// Some functions do not decompose into one table, and forcing them to is how you
// get a tidy artefact that tests a third of the contract. So the gesture may emit
// more than one shaped group, and refuses what fits none rather than flattening
// it.
const TABLE_GROUP_RULE =
  "If a case cannot be a row of the same table - it needs a different shape, or a value the row cannot " +
  "carry - write it as its own separate test rather than distorting the table. If a case fits no shape " +
  "at all, say so instead of writing a test that does not check it.";


/**
 * The blind test-authoring instruction for a language that is NOT Rust. Same
 * clauses as the Rust one — blind of the implementation, one fenced block, ONE
 * parameterised table whose last column is the expected value, no invented
 * failure cases, no mocks — with the reply shape, the table idiom and the
 * assertion idiom coming from the language and its resolved framework instead of
 * being Rust-literal.
 *
 * The load-bearing clause is no longer "inline" but "a LITERAL, in its own row":
 * the human reviews and types each expected value on its own line, so a value
 * pulled from a shared variable or a named constant is a value the locator cannot
 * blank. SUPERSESSION S31 reversed the table half of that rule and kept this
 * half; see the comment above TEST_GEN_INSTRUCTION for why.
 */
function testGenInstructionFor(input: TestGenPromptInput): string {
  const languageName = input.languageName ?? input.languageId ?? "";
  // The FRAMEWORK first, for the shape, the table idiom and the assertion idiom:
  // all three land in ONE prompt and must not contradict, and only the framework
  // knows all three. The languageId defaults answer for the frameworks whose
  // idioms ARE their language's.
  const shape = input.replyShape ?? TEST_REPLY_SHAPE[input.languageId ?? ""] ?? TEST_REPLY_SHAPE_DEFAULT;
  const table = input.tableShape ?? TEST_TABLE_SHAPE[input.languageId ?? ""] ?? TEST_TABLE_SHAPE_DEFAULT;
  return (
    `Write unit tests for the ${languageName} function whose contract is given below. You are given ONLY the ` +
    "contract: the doc comment and the signature. Do NOT write, assume, or infer a reference " +
    "implementation - author the tests from the contract alone, so they check the promised behaviour " +
    "and would catch a wrong implementation.\n\n" +
    `${shape}\n\n` +
    `${table} Cover about five cases in all: the happy path plus the contract's named edge and failure ` +
    `cases. ${input.assertionInstruction ?? ""}\n\n` +
    "Write each expected value out as a literal value in its own row - NEVER pull it from a shared " +
    "variable and NEVER from a named constant, because each expected value is reviewed and filled in on " +
    "its own line.\n\n" +
    `${input.rowsAreConstantsOnly === true ? TABLE_KNOB_RULE_DEAD_COLUMN : `${TABLE_KNOB_RULE_DEAD_COLUMN} ${TABLE_KNOB_RULE_CONSTRUCTED}`}\n\n` +
    `${TABLE_GROUP_RULE}\n\n` +
    (input.asyncTestShape === undefined
      ? ""
      : `The function under test is ASYNC, so the test must AWAIT it: write the test as ${input.asyncTestShape} ` +
        "and await the call inside the table's runner. The table shape is unchanged - one table, one runner, " +
        "the expected value still the last column of every row.\n\n") +
    (input.receiverTypeName === undefined
      ? ""
      : `The function under test is a METHOD on \`${input.receiverTypeName}\`, so the test must CONSTRUCT one to ` +
        `call it. Build it with the real \`${input.receiverTypeName}\` API shown above - once above the table when ` +
        "every case uses the same receiver, or as a column of the table when the cases need different ones. Do NOT " +
        "mock it and do NOT invent a constructor the API above does not show.\n\n") +
    "Do NOT invent a failure case the contract does not state, and do NOT assert on an error message the " +
    "contract does not quote - a guessed message is a false failure.\n\n" +
    "Do NOT use mocks. Construct and call the real collaborators. If the function genuinely cannot be " +
    "tested without a fake, say so instead of inventing one."
  );
}

/** Rust's instruction, plus the async clause when the target is async. The
 *  non-async bytes are untouched: the clause is APPENDED rather than woven in,
 *  so a non-async Rust prompt stays exactly what the frozen constant says. */
function rustTestGenInstruction(input: TestGenPromptInput): string {
  let out = TEST_GEN_INSTRUCTION;
  if (input.asyncTestShape !== undefined) {
    out +=
      `\n\nThe function under test is ASYNC, so the test must AWAIT it: mark the test fn ${input.asyncTestShape} ` +
      "and `.await` the call inside the loop. Everything else is unchanged - one table of rows, one loop, one " +
      "`assert_eq!`, the expected value the last column of every row.";
  }
  if (input.receiverTypeName !== undefined) {
    out +=
      `\n\nThe function under test is a METHOD on \`${input.receiverTypeName}\`, so the test must CONSTRUCT one ` +
      `to call it. Build it with the real \`${input.receiverTypeName}\` API shown above - once above the table ` +
      "when every case uses the same receiver, or as a column of the table when the cases need different ones. " +
      "Do NOT mock it and do NOT invent a constructor the API above does not show.";
  }
  return out;
}

/** Assemble the blind test-authoring prompt (sibling of assembleFnGenPrompt).
 *  Deterministic: same input, same bytes. The contract (signature + doc) is the
 *  ONLY thing about the target the model sees; never a reference implementation.
 *
 *  The Rust branch is FROZEN byte-for-byte (blind-v8-testgen pins it); phase 6
 *  added the other four rather than widening it. */
export function assembleTestGenPrompt(input: TestGenPromptInput): string {
  const languageId = input.languageId ?? "rust";
  const sections: string[] = [];
  // The blocks lead, through the ONE renderer, for the reason renderContextPrefix
  // exists: the Claude Code backend sends this head as its own cached turn and
  // verifies the prompt STARTS with it. Two renderings differing by one byte
  // would silently turn every fork into a whole-prompt round.
  for (const block of input.contextBlocks ?? []) {
    sections.push(renderContextBlock(block));
  }
  sections.push(languageId === "rust" ? rustTestGenInstruction(input) : testGenInstructionFor(input));

  // Resolved collaborator signatures so the test can construct inputs and call
  // real names. A visible, labelled section; absent (or empty) keeps the
  // prompt free of it, byte-for-byte.
  if (input.calleeSurface) {
    const surfaceFence = fenceFor(input.calleeSurface);
    sections.push(
      `Collaborator API (real signatures you may construct and call - do NOT mock these):\n` +
        `${surfaceFence}${languageId}\n${input.calleeSurface}\n${surfaceFence}`,
    );
  }

  // The contract as the model reads it: doc comment then signature, fenced. Same
  // shape as assembleFnGenPrompt's target so the two passes render identically.
  let body = "";
  if (input.docComment !== undefined) {
    body += dedentDocComment(input.docComment, input.spanIndent).replace(/\n+$/, "") + "\n";
  }
  body += input.signature.endsWith("\n") ? input.signature : input.signature + "\n";
  // A doc comment is prose the repository wrote, so it can hold a fenced
  // example of its own (a Rust `///` block, a Python docstring).
  const targetFence = fenceFor(body);
  sections.push(`${targetFence}${input.languageId ?? ""}\n${body}${targetFence}`);

  return sections.join(SECTION_SEPARATOR);
}

const INSTRUCTION =
  "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block.";

// Python Fork A: the header and its docstring are already written and shown; the
// model writes only the body that goes below them. Do NOT repeat the signature or
// the docstring — they are preserved verbatim in the file, outside what is
// generated. One fenced block, the body statements only.
export const BODY_ONLY_INSTRUCTION =
  "The documented header below is already written. Write only the body that goes below it: the statements (or the members) that implement what the documentation describes. Reply with one fenced code block containing ONLY the body — do not repeat the signature, the header, or the docstring, and add no code before or after the body. Output nothing outside the code block.";

// A type header (`pub struct Foo`, `public class Bar`) carries almost no
// signal; the doc comment above it carries what the type must hold. So the type
// instruction points the model at the definition body and holds it to the one
// type, exactly as the function instruction holds the reply to one function.
//
// The member noun is per-language: Rust says fields/variants; C# and TS say
// "members" ("fields"/"variants" is Rust vocabulary, and the accidental path
// used to serve it to every language). Rust also carries the "no impl blocks"
// framing, a Rust concept the non-Rust instruction drops. The Rust branch is
// FROZEN byte-for-byte (blind-v3-structgen + blind-v12-typegen-csts pin it);
// any edit to it is a supersession, never a refactor side effect.
function typeInstruction(languageId: string | undefined, kind: TypeGenKind): string {
  if (languageId === "rust") {
    const member = kind === "enum" ? "variants" : "fields";
    return (
      `Complete the ${kind} definition below. Reply with one fenced code block containing the complete ${kind} definition: the header and its ${member}, staying strictly inside this one type. ` +
      `The block must contain only this one ${kind}: no other types, no impl blocks, no functions, no code before or after it. ` +
      `The doc comment above the header describes what the ${kind} must hold. Output nothing outside the code block.`
    );
  }
  // C#/TS/Python, no Rust-only "impl blocks" framing. The member noun is
  // per-language: Python names a class's "attributes" (its `name: type` body),
  // while an Enum subclass and every C#/TS type name "members".
  const member = languageId === "python" && kind === "class" ? "attributes" : "members";
  return (
    `Complete the ${kind} definition below. Reply with one fenced code block containing the complete ${kind} definition: the header and its ${member}, staying strictly inside this one type. ` +
    `The block must contain only this one ${kind}: no other types, no code before or after it. ` +
    `The doc comment above the header describes what the ${kind} must hold. Output nothing outside the code block.`
  );
}

/** One manually-added context block as its labelled prompt section. The single
 *  source of this shape: generation (assembleFnGenPrompt) and repair
 *  (assembleRepairPrompt) both render context through here, so the two can
 *  never drift. */
export function renderContextBlock(block: ContextBlock): string {
  const text = block.text.endsWith("\n") ? block.text : block.text + "\n";
  // A staged block is a live selection out of some document, so a human can
  // stage a fence INTO it (the text is live; the panel is not asked). Adapting
  // here is the whole of queue entry Q14.
  const fence = fenceFor(text);
  return `Context: ${block.uri}#L${block.range.startLine}-L${block.range.endLine}\n${fence}\n${text}${fence}`;
}

/**
 * The context blocks as one prompt HEAD: every assembler leads with these
 * bytes, in this order, joined the way sections are joined.
 *
 * It exists because the Claude Code backend sends this head as its own cached
 * turn, and the transport verifies that the prompt it was handed actually
 * STARTS with it before splitting anything. Two renderings of the same blocks
 * that differed by one byte would silently turn every fork into a whole-prompt
 * round; one function means they cannot differ.
 *
 * Empty for no blocks, and callers append the separator themselves, so the
 * assembled prompts keep their exact prior bytes.
 */
export function renderContextPrefix(blocks: readonly ContextBlock[] | undefined): string {
  return (blocks ?? []).map(renderContextBlock).join(SECTION_SEPARATOR);
}

/** Sections are separated by a blank line, everywhere, on every assembler. */
export const SECTION_SEPARATOR = "\n\n";

/** Which of the three arbitration parts a section's bytes belong to.
 *  `developer` is untouchable, `injected` is the only part that shrinks,
 *  `fixed` is irreducible. */
type PromptPart = "developer" | "injected" | "fixed";

/** One assembled section with the part it is charged to. */
interface PromptSection {
  text: string;
  part: PromptPart;
}

/**
 * The sections of the fn-gen prompt, in order, each tagged with whose bytes it
 * is. THE ONE SOURCE: `assembleFnGenPrompt` joins these and `fnGenPromptShare`
 * counts them, so the estimate the window arbitration runs on cannot drift from
 * the prompt that is actually sent. A section added here is charged to a part
 * by construction rather than by a second list somebody has to remember.
 */
function fnGenSections(input: FnGenPromptInput): PromptSection[] {
  const sections: PromptSection[] = [];

  for (const block of input.contextBlocks ?? []) {
    sections.push({ text: renderContextBlock(block), part: "developer" });
  }

  // Body-only generation (Python, below a preserved docstring) takes precedence
  // over the kind routing: the header and docstring are already written and shown
  // as context, so the model writes ONLY the body/members below them.
  if (input.bodyOnly) {
    sections.push({ text: BODY_ONLY_INSTRUCTION, part: "fixed" });
  } else if (input.kind !== undefined && input.kind !== "function") {
    // A type routes to the definition instruction; a function (or an omitted
    // kind) keeps the exact v1 instruction, noPunt append included. The punt
    // directive is a function concept — a type body cannot punt — so it never
    // touches the type instruction.
    sections.push({ text: typeInstruction(input.languageId, input.kind), part: "fixed" });
  } else {
    sections.push({
      text: input.noPunt ? `${INSTRUCTION} ${noPuntInstructionFor(input.languageId)}` : INSTRUCTION,
      part: "fixed",
    });
  }

  // The developer's own sketch of the body, harvested from the comments at the
  // body's depth. It reads as instruction, not reference material, so it sits
  // above the injected surface and says where it came from - a bad harvest is
  // then self-diagnosing to a human reading the prompt. Absent or empty keeps
  // the prompt bytes exactly as they were.
  if (input.scaffoldComments && input.scaffoldComments.length > 0) {
    sections.push({
      text:
        "The developer sketched the body as comments, in this order. They are the specification for what " +
        "the body must do; implement every one of them:\n" +
        input.scaffoldComments.map((line) => `- ${line}`).join("\n"),
      part: "fixed",
    });
  }

  // Name the file's local symbols the doc/signature references, so the model
  // refers to them directly instead of inventing a `use somecrate::LocalType;`
  // import for a same-file definition. Non-empty only; absent or empty keeps
  // the prompt byte-identical to the prior identity. Rust keeps its original
  // "a use import" bytes (v5 identity); every other language gets the neutral
  // noun - "a use import" is Rust vocabulary.
  if (input.localSymbols && input.localSymbols.length > 0) {
    const importNoun = input.languageId === "rust" ? "a use import" : "an import";
    sections.push({
      text:
        `The following names are defined in this file and are already in scope: ${input.localSymbols.join(", ")}. ` +
        `Refer to them directly; do NOT add ${importNoun} for them.`,
      part: "fixed",
    });
  }

  // v2 round-1 pre-fill: the auto-injected surface reads as its own labelled
  // section between the instruction and the target, so the human can see and
  // veto exactly what was added. Absent (or empty) keeps the v1 prompt bytes.
  if (input.injectedSurface) {
    sections.push({ text: input.injectedSurface, part: "injected" });
  }

  let body = "";
  if (input.docComment !== undefined) {
    // Normalized to end with exactly one newline so the signature always
    // starts its own line, however the resolver sliced the comment.
    body += dedentDocComment(input.docComment, input.spanIndent).replace(/\n+$/, "") + "\n";
  }
  body += input.signature.endsWith("\n") ? input.signature : input.signature + "\n";
  const targetFence = fenceFor(body);
  sections.push({ text: `${targetFence}${input.languageId ?? ""}\n${body}${targetFence}`, part: "fixed" });

  return sections;
}

/** Render the single user prompt string. */
export function assembleFnGenPrompt(input: FnGenPromptInput): string {
  return fnGenSections(input)
    .map((s) => s.text)
    .join(SECTION_SEPARATOR);
}

/**
 * The same prompt, counted instead of joined: whose bytes are whose. Feeds the
 * window arbitration in `src/core/promptBudget.ts`.
 *
 * EXACT ON CHARACTERS, and the only proxy downstream is chars-to-tokens:
 * `developerChars + injectedChars + fixedChars === assembleFnGenPrompt(input).length`
 * for every input, because both functions read the same section list. The
 * separators are charged to `fixed` - they are structure, and they are not the
 * developer's to remove.
 *
 * It builds the section strings a second time rather than joining them, which
 * is a few string concatenations on a gesture that is about to make a network
 * call. It re-runs no walk, no resolver round trip and no render of the
 * injected surface: the surface arrives as a finished string on `input`.
 *
 * The `*NonAscii` counts ride along because `String.length` is UTF-16 units and
 * a token estimator has to charge a CJK character very differently from an
 * ASCII one (adversarial review D6). Counted here, where the section strings
 * exist, and CHARGED in src/core/promptBudget.ts - the two are split only so
 * this module never has to import the budget module it is imported by.
 */
export function fnGenPromptShare(input: FnGenPromptInput): {
  developerChars: number;
  injectedChars: number;
  fixedChars: number;
  developerNonAscii: number;
  injectedNonAscii: number;
  fixedNonAscii: number;
} {
  const sections = fnGenSections(input);
  const separators = Math.max(0, sections.length - 1) * SECTION_SEPARATOR.length;
  let developerChars = 0;
  let injectedChars = 0;
  let fixedChars = separators;
  let developerNonAscii = 0;
  let injectedNonAscii = 0;
  let fixedNonAscii = 0;
  for (const s of sections) {
    if (s.part === "developer") {
      developerChars += s.text.length;
      developerNonAscii += nonAsciiCount(s.text);
    } else if (s.part === "injected") {
      injectedChars += s.text.length;
      injectedNonAscii += nonAsciiCount(s.text);
    } else {
      fixedChars += s.text.length;
      fixedNonAscii += nonAsciiCount(s.text);
    }
  }
  return { developerChars, injectedChars, fixedChars, developerNonAscii, injectedNonAscii, fixedNonAscii };
}

/** UTF-16 units outside ASCII. Duplicated from `countNonAsciiChars` in
 *  promptBudget.ts on purpose: promptBudget imports SECTION_SEPARATOR from
 *  here, and importing back would make a module cycle whose top-level consts
 *  are order-dependent in a bundle. Six lines is cheaper than that hazard. */
function nonAsciiCount(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      n++;
    }
  }
  return n;
}
