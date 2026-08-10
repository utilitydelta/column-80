/**
 * Fn-gen prompt assembly. The whole product identity hangs on what is NOT
 * here: the prompt is signature + doc comment + the user's ordered context
 * blocks and nothing else — no repo scraping, no automatic inclusion, no
 * hidden system message. Deterministic: same input, same bytes.
 */

/** 1-based inclusive line range; label-only, never used to re-read files. */
export interface ContextBlockRange {
  startLine: number;
  endLine: number;
}

/**
 * A snapshot the user explicitly added. contextBlocks owns the store and
 * staleness; the fn-gen service only ever receives an ordered list of these.
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
  /** Names DEFINED in the target's own file that the signature/doc references,
   *  so the model refers to them directly instead of inventing a
   *  `use somecrate::LocalType;` for a same-file definition it cannot otherwise
   *  see. Rendered as a visible section when non-empty; absent or empty keeps
   *  the prompt byte-identical to the prior identity. */
  localSymbols?: string[];
}

import { noPuntInstructionFor } from "./punt";

const FENCE = "```";

/** Test-authoring pass input. The contract half (signature + doc) plus the
 *  resolved collaborator surface; never a reference implementation (blind). */
export interface TestGenPromptInput {
  signature: string;
  docComment?: string;
  /** Resolved callee signatures so the test can construct inputs / call
   *  collaborators. Rendered as a labelled section; absent = none. */
  calleeSurface?: string;
  languageId?: string;
}

// The blind test-authoring instruction. Encodes unit-testing-discipline (one
// parameterized table over rows, each naming its invariant; few tests), the
// blind-oracle rule (author from the contract, never a reference implementation),
// the reply shape (one `#[cfg(test)] mod tests` block), the panic-message rule
// (bare #[should_panic], never a guessed expected=), and the mocking ladder
// (real collaborators, never a fake). The human blanks the expected values after
// (the tabstop pass); the model proposes concrete asserts so the assertion is
// syntactically complete and the value position is locatable.
const TEST_GEN_INSTRUCTION =
  "Write unit tests for the Rust function whose contract is given below. You are given ONLY the " +
  "contract: the doc comment and the signature. Do NOT write, assume, or infer a reference " +
  "implementation - author the tests from the contract alone, so they check the promised behaviour " +
  "and would catch a wrong implementation.\n\n" +
  "Reply with ONE fenced code block containing a single `#[cfg(test)] mod tests { ... }` module and " +
  "nothing else: no prose, no other items, no code before or after the block.\n\n" +
  "Inside the module write a SINGLE `#[test]` fn. In its body put ONE `assert_eq!(<call>, <expected>)` " +
  "line per case (about five in all): the happy path plus the contract's named edge and failure cases. " +
  "Write each expected value inline as the second argument of its own assert - NEVER pull it from a " +
  "shared variable and NEVER loop over a table of rows, because each expected value is reviewed and " +
  "filled in on its own line. A short `//` comment after a line may name the invariant it proves. Any " +
  "shared setup (constructing inputs the cases reuse) goes in `let` bindings above the asserts.\n\n" +
  "Only if the contract EXPLICITLY states the function must panic for some input, add a SECOND " +
  "`#[test]` fn with a bare `#[should_panic]` that calls it with that input. Do NOT invent a panic " +
  "case the contract does not state, and NEVER construct invalid input with `unsafe`, raw pointers, " +
  "or similar tricks to force one. Do NOT write `#[should_panic(expected = \"...\")]` unless the " +
  "contract quotes the exact panic message - a guessed message is a false failure.\n\n" +
  "Do NOT use mocks. Construct and call the real collaborators. If the function genuinely cannot be " +
  "tested without a fake, say so instead of inventing one.";

/** Assemble the blind test-authoring prompt (sibling of assembleFnGenPrompt).
 *  Deterministic: same input, same bytes. The contract (signature + doc) is the
 *  ONLY thing about the target the model sees; never a reference implementation. */
export function assembleTestGenPrompt(input: TestGenPromptInput): string {
  const sections: string[] = [TEST_GEN_INSTRUCTION];

  // Resolved collaborator signatures so the test can construct inputs and call
  // real names. A visible, labelled section; absent (or empty) keeps the
  // prompt free of it, byte-for-byte.
  if (input.calleeSurface) {
    sections.push(
      `Collaborator API (real signatures you may construct and call - do NOT mock these):\n` +
        `${FENCE}rust\n${input.calleeSurface}\n${FENCE}`,
    );
  }

  // The contract as the model reads it: doc comment then signature, fenced. Same
  // shape as assembleFnGenPrompt's target so the two passes render identically.
  let target = `${FENCE}${input.languageId ?? ""}\n`;
  if (input.docComment !== undefined) {
    target += input.docComment.replace(/\n+$/, "") + "\n";
  }
  target += input.signature.endsWith("\n") ? input.signature : input.signature + "\n";
  target += FENCE;
  sections.push(target);

  return sections.join("\n\n");
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
  return `Context: ${block.uri}#L${block.range.startLine}-L${block.range.endLine}\n${FENCE}\n${text}${FENCE}`;
}

/** Render the single user prompt string. */
export function assembleFnGenPrompt(input: FnGenPromptInput): string {
  const sections: string[] = [];

  for (const block of input.contextBlocks ?? []) {
    sections.push(renderContextBlock(block));
  }

  // Body-only generation (Python, below a preserved docstring) takes precedence
  // over the kind routing: the header and docstring are already written and shown
  // as context, so the model writes ONLY the body/members below them.
  if (input.bodyOnly) {
    sections.push(BODY_ONLY_INSTRUCTION);
  } else if (input.kind !== undefined && input.kind !== "function") {
    // A type routes to the definition instruction; a function (or an omitted
    // kind) keeps the exact v1 instruction, noPunt append included. The punt
    // directive is a function concept — a type body cannot punt — so it never
    // touches the type instruction.
    sections.push(typeInstruction(input.languageId, input.kind));
  } else {
    sections.push(input.noPunt ? `${INSTRUCTION} ${noPuntInstructionFor(input.languageId)}` : INSTRUCTION);
  }

  // Name the file's local symbols the doc/signature references, so the model
  // refers to them directly instead of inventing a `use somecrate::LocalType;`
  // import for a same-file definition. Non-empty only; absent or empty keeps
  // the prompt byte-identical to the prior identity. Rust keeps its original
  // "a use import" bytes (v5 identity); every other language gets the neutral
  // noun - "a use import" is Rust vocabulary.
  if (input.localSymbols && input.localSymbols.length > 0) {
    const importNoun = input.languageId === "rust" ? "a use import" : "an import";
    sections.push(
      `The following names are defined in this file and are already in scope: ${input.localSymbols.join(", ")}. ` +
        `Refer to them directly; do NOT add ${importNoun} for them.`,
    );
  }

  // v2 round-1 pre-fill: the auto-injected surface reads as its own labelled
  // section between the instruction and the target, so the human can see and
  // veto exactly what was added. Absent (or empty) keeps the v1 prompt bytes.
  if (input.injectedSurface) {
    sections.push(input.injectedSurface);
  }

  let target = `${FENCE}${input.languageId ?? ""}\n`;
  if (input.docComment !== undefined) {
    // Normalized to end with exactly one newline so the signature always
    // starts its own line, however the resolver sliced the comment.
    target += input.docComment.replace(/\n+$/, "") + "\n";
  }
  target += input.signature.endsWith("\n") ? input.signature : input.signature + "\n";
  target += FENCE;
  sections.push(target);

  return sections.join("\n\n");
}
