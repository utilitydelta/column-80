import * as vscode from "vscode";
import { FnGenConfig, isRemoteApiBase } from "../core/config";
import { withDocumentEol } from "./eol";
// TYPE-ONLY, and it must stay that way: it is erased before emit, so no runtime
// edge is added from fnGen to the tighten command's pure classifier. See
// `PrefillLedgerViewIsPinned` below.
import type { PrefillLedgerView } from "../core/tightenClassify";
import { ContextBlockStore } from "../core/contextBlocks";
import { ProbeCommandFn, ProbeHardwareOptions, probeCommandRunner } from "../core/hardware";
import { FnGenService } from "../core/fnGenService";
import { FunctionSpan, spliceSpan } from "../core/span";
import { ContextBlock, FnGenPromptInput, GenKind } from "../core/prompt";
import { isPromptWindowError } from "../core/promptBudget";
import { makeBlockReader } from "./blockReader";
import { fileLabel } from "./contextPanel";
import { attachRunStart, attachedCandidateIndex, declarationHeadLine, hasDocumentSymbolShape } from "../core/symbols";
import { TierSelection, applyTier } from "../core/tiers";
import { CloudFnGenConfig, fnGenModelClass, injectedContextStop, readCloudConfig, readFnGenConfig, readOracleConfig, readTierConfig } from "./config";
import {
  BudgetProfile,
  CS_DATASHAPE_TOTAL_TOK,
  ContextStop,
  DATASHAPE_TOTAL_TOK,
  PREFILL_TYPE_CAP,
  budgetProfileFor,
  modelClassFor,
  walkTokMaxFor,
} from "../core/budgetProfile";
import { resolveTier, startOllamaTerminal } from "./firstRun";
import { InstructGenerateFn, hasModel, listModels } from "../core/ollama";
import { makeCloudInstruct } from "../core/cloudInstruct";
import { makeAnthropicInstruct } from "../core/anthropicInstruct";
import { CLAUDE_CODE, claudeModelLabel, makeClaudeCodeInstruct } from "../core/claudeCodeInstruct";
import { callRootPosition, runPostAcceptOracle } from "./oracleSurface";
import { extractorFor } from "./extractors";
import { registerTightenDocComment } from "./tightenDocComment";
import { firstLine, hasMoreThanOneLine, oneLineWithPointer, tierDisabledToast } from "./toastText";
// The failure translator, a leaf beside `toastText.ts` for the same reason it
// is: the download toast and the tighten gesture need the same sentences and
// neither may take an edge back into the file that registers them.
import { generationFailedToast, translateServiceReject } from "./failureToast";
// A leaf: it imports vscode and nothing of ours, so both this file and
// extension.ts can hold it without a cycle.
import { CANCEL_COMMAND, InFlightRegistry, isCancellation } from "./inFlight";
import {
  DocumentSymbolLite,
  MEMBER_CAP,
  PREFILL_HOVER_SIGNATURE_CAP,
  SourceCursor,
  SurfaceExtractor,
  exampleNamesItsType,
  findEnclosingContainer,
} from "../core/extraction";
import { assembleSurfacePayload, firmInstructionFor, ofTypes, typesFromUses, typesNamedIn } from "../core/compilerDirected";
import { commentTypesIn, firstCodeOccurrence } from "../core/commentTypes";
import { DisclosedType, memberNameOf } from "../core/repairGate";
import {
  csTypesFromQualifiedUsage,
  goTypesFromQualifiedUsage,
  isAllCapsConstant,
  prefillStopNamesFor,
  pathQualifiersIn,
  stopNamesFor,
} from "../core/repairTypes";
import { LanguageVisibility, TargetScope, visibilityFor } from "../core/memberVisibility";
import { DroppedType, SharedWalkState, WalkBounds, walkDataShape } from "../core/dataShape";
import { scrubRust } from "../core/rustHoverRecovery";
import * as fs from "fs";
import * as path from "path";
import {
  CrossFileBound,
  CrossFileShape,
  CrossFileShapeHooks,
  DerivedType,
  PY_STD_TYPE_NAMES,
  csShapeHooks,
  goShapeHooks,
  isRustSysrootDef,
  nestedConstructors,
  pyShapeHooks,
  resolveCrossFileShape,
  surfaceStillTruncated,
  freshSettleAllowance,
  toResolveStruct,
  tsShapeHooks,
} from "../core/crossFileShape";
import {
  TS_LANGUAGE_IDS,
  TS_STD_TYPE_NAMES,
  isPrimitiveAliasHover,
  tsDocCommentAbove,
  tsHasBodyBrace,
  tsLocalTypeDefinitions,
  tsSignatureFromSpanText,
  tsTypesFromImports,
} from "../core/tsExtraction";
import { CS_STD_TYPE_NAMES, csDocCommentAbove, csShapeGraphBlock } from "../core/csExtraction";
import { GO_STD_TYPE_NAMES, parseGoReceiverSymbol } from "../core/goExtraction";
import { goTypesInPlay } from "../core/fimWholeBlock";
import { pyDocstringHasAdjacentLiteral, pyLeadingDocstring, pyTypeGenKind, stripPyDocstring } from "../core/pyExtraction";
import { placeGeneratedReply } from "../core/placeReply";
import {
  RECEIVER_RULES,
  ReceiverJob,
  SignatureRules,
  receiverNameOffset,
} from "../core/receiver";
import { renderImportHint } from "../core/usePath";
import { bodyTextOfSpan, harvestBodyComments } from "../core/scaffold";
import { makeHostScopedCatalogFetcher } from "../core/catalog";
import { assembleAntiPuntReprompt, looksLikePunt, puntDiagnosis } from "../core/punt";
import { blankSnippetToDisplay } from "../core/testAssembly";
import { StructFieldShape } from "../core/tabstop";
// The TDD gesture speaks five languages through this seam (docs/supersessions.md
// S2). Everything that used to be Rust-literal in the two commands — the
// return-type reader, the scaffold, the blanker, the marker format, the
// testability classifier and the assertion idiom — comes off the resolved leg.
import { TddDeps, TestPlacement, blankExpectedValues, frameworkFor, tddLangFor, tddLanguageIds } from "../core/tddLang";
import { TestOracleResult, oracleFor, runFrameworkTestsAt, runOracleCheck } from "../core/compilerOracle";
// The Run Covering Tests gesture: the walk and its transport, the classifier's
// language names, the grouper's target resolution, and the ONE pure module that
// owns every sentence the gesture can say about a result.
import { discoverCoveringTests } from "../core/testDiscovery";
import { coveringTestPlan, runCoveringGroups } from "../core/coveringTestRun";
import { RunTestsReport, renderRunTestsReport } from "../core/runTestsReport";
import { makeLineReader, makeResolveCallers, prepareCallRoot } from "./callHierarchy";
import { baselineCheck, describeEnvironment, isMissingImportsStorm } from "../core/pyOracle";
import {
  fenceFor,
  fileImportBindings,
  fileLocalDefinitions,
  fileLocalDefinitionsFor,
  referencedLocalSymbols,
  stripLocalShadowingUses,
  stripRedundantUses,
} from "../core/instructPostprocess";

/**
 * Span resolution and the generate-function command. The core service
 * accepts spans from anywhere; only this file knows about symbol providers,
 * so the boundary oracles run headless without an editor.
 *
 * Silent insertion is banned structurally: the accept handler below is the
 * only code path in the extension that writes to a document, and the edit
 * it applies is core's splice arithmetic over the resolved span.
 *
 * Staleness discipline: `document.version` is captured at resolution and
 * every later stage discards on any mismatch — including edits that leave
 * the span bytes identical. The final version check runs in the same
 * synchronous tick that issues `applyEdit`; what remains is the applyEdit
 * round trip itself, an API-inherent window documented in the surface.
 */

export interface ResolvedFunction {
  /** UTF-16 offsets into document.getText(); doc comments and attributes
   *  above the declaration head are OUTSIDE the span, so a regeneration can
   *  never eat the user's docs. */
  span: FunctionSpan;
  signature: string;
  docComment?: string;
  symbolName: string;
  languageId: string;
  /** The target's generation kind, routing the prompt shape. "function" for
   *  Function/Method/Constructor; a type kind (struct/enum/class/interface)
   *  only when type targeting is admitted (compilerDirectedInjection on) and
   *  only for the kinds the target's language admits (typeKindsFor). */
  kind: GenKind;
  /** Python Fork A: the target has a leading docstring, read as the spec
   *  (docComment) and preserved outside the span, so the model writes only the
   *  BODY below it. False for every non-docstring / non-Python target. */
  bodyOnly: boolean;
  /** The leading whitespace of the header line, used by the full-definition type
   *  reindent. Captured here because the span may start past the docstring, so it
   *  can no longer be read back off span.start. */
  headerIndent: string;
  /** Offset of the DECLARATION HEAD, which `span.start` is not.
   *
   *  Python Fork A moves `span.start` PAST a leading docstring so generation
   *  rewrites only the body, and after that the span no longer begins at the
   *  `def`. Every reader that wants the declaration rather than the writable
   *  region needs this instead, and session-v61's host tier found the first one
   *  that did: the criticize gesture sliced from `span.start`, found no
   *  declaration head in the range, and REFUSED 7 of the 10 functions in a real
   *  Python file, which is to say every function carrying a docstring.
   *
   *  Equal to `span.start` for every non-bodyOnly target. */
  headOffset: number;
  /** The body's actual indentation for a bodyOnly target: the leading whitespace
   *  of the DOCSTRING line (the docstring is the first body statement, so its
   *  column IS the body column). Used verbatim to indent the generated body, so a
   *  2-space / tab file lands the body at the human's real indent, not a hardcoded
   *  4 (review BLOCKER). Empty for a non-bodyOnly target. */
  bodyIndent: string;
  /** The document-symbol tree the span was resolved OUT of. Carried on the
   *  record because the pre-fill needs the same tree to answer which type
   *  encloses the target, and re-asking for it would be a second round trip for
   *  an answer this resolution already had. Absent on a record built any other
   *  way, which the readers treat as "no tree" and degrade on. */
  symbols?: readonly vscode.DocumentSymbol[];
  /** An honest refusal message when a Python docstring cannot be preserved in
   *  place by Fork A — an on-header-line one-liner (`def f(): "d"`) or an implicit
   *  string-concatenation docstring (`"a " "b"`). The command shows it and
   *  declines rather than silently overwriting or half-eating the human's words.
   *  Undefined for every preservable / non-docstring target. */
  docstringRefusal: string | undefined;
}

// The function-like kinds. A cursor inside one of these resolves
// to it; a cursor on a Field/EnumMember (never in the set) walks up to the
// container.
const FUNCTION_KINDS = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
]);

// Type targets, admitted only when compilerDirectedInjection is on, and
// PER-LANGUAGE: the admit set differs by language and a
// single global set would be wrong. A Rust trait, a C# interface (both reported
// as Interface, both with bodyless members) must stay out — deepest-match would
// splice a member body into a bodyless signature — while a TS interface is
// admitted (its container is braced; type-gen fills its member list, never a
// member body). Field/Property/EnumMember are never admitted, so a cursor
// inside a type's member region walks up to the container.
//
// The proven mapping (scout.md Q1, live servers): C# folds record→Class and
// record struct→Struct; TS reports class/interface/enum (const enum ⇒ Enum);
// Python reports Class for everything (its type kinds land in phase 2, so it
// admits no type kind here — unchanged, still function-only). Rust is FROZEN at
// {Struct, Enum}: adding Class/Interface would make traits type-gen targets.
const RUST_TYPE_KINDS: ReadonlySet<vscode.SymbolKind> = new Set([
  vscode.SymbolKind.Struct,
  vscode.SymbolKind.Enum,
]);
const CS_TYPE_KINDS: ReadonlySet<vscode.SymbolKind> = new Set([
  vscode.SymbolKind.Class, // class + record (both fold into Class)
  vscode.SymbolKind.Struct, // struct + record struct
  vscode.SymbolKind.Enum,
  // Interface EXCLUDED: C# interface members are bodyless.
]);
const TS_TYPE_KINDS: ReadonlySet<vscode.SymbolKind> = new Set([
  vscode.SymbolKind.Class, // class + abstract class
  vscode.SymbolKind.Interface, // ADMITTED: the interface's own body is braced
  vscode.SymbolKind.Enum, // enum + const enum
]);
// Python reports Class for a plain class, a @dataclass, AND an Enum subclass
// alike (scout-py.md Q1) — never Struct/Enum — so Class is the whole admit set;
// the class-vs-enum split is a header-text classification (pyTypeGenKind), not a
// kind. Field/Variable/Constant members stay out so a cursor walks up to the class.
const PY_TYPE_KINDS: ReadonlySet<vscode.SymbolKind> = new Set([vscode.SymbolKind.Class]);
// gopls reports `type X struct` as Struct and interfaces as Interface, both
// always braced. Class (gopls's kind for a named non-struct type, e.g.
// `type Celsius float64`) is EXCLUDED: no member body to generate into. The
// iota-const enum idiom is parked with the other enum-adjacent forms (item 8).
const GO_TYPE_KINDS: ReadonlySet<vscode.SymbolKind> = new Set([
  vscode.SymbolKind.Struct,
  vscode.SymbolKind.Interface,
]);
const NO_TYPE_KINDS: ReadonlySet<vscode.SymbolKind> = new Set();

// The type kinds the given language admits as generation targets. An
// unregistered language admits none — function generation is untouched, type
// generation simply does not fire.
function typeKindsFor(languageId: string): ReadonlySet<vscode.SymbolKind> {
  if (languageId === "rust") return RUST_TYPE_KINDS;
  if (languageId === "csharp") return CS_TYPE_KINDS;
  if (TS_LANGUAGE_IDS.has(languageId)) return TS_TYPE_KINDS;
  if (languageId === "python") return PY_TYPE_KINDS;
  if (languageId === "go") return GO_TYPE_KINDS;
  return NO_TYPE_KINDS;
}

// The registered generation languages - the set with a wired oracle, prompt
// shape, and punt idiom. One predicate serves every gesture gate so the gates
// cannot drift from each other (the registries in extractors.ts/compilerOracle
// still encode the set independently; a language added there but not here gets
// a loud refusal at the door, never a silent Rust-shaped generation).
function isRegisteredLanguage(languageId: string): boolean {
  return (
    languageId === "rust" ||
    TS_LANGUAGE_IDS.has(languageId) ||
    languageId === "csharp" ||
    languageId === "python" ||
    languageId === "go"
  );
}
const SUPPORTED_LANGUAGES_TEXT = "Rust, TypeScript/JavaScript, C#, Python, and Go";

// Map a resolved symbol's kind to its generation kind. Only kinds the language
// admits (typeKindsFor) reach the type branches — a Rust Class/Interface never
// arrives here because it is never admitted — so the mapping is a plain
// SymbolKind switch: Struct→"struct", Enum→"enum", Class→"class",
// Interface→"interface", everything else (the function-like kinds)→"function".
// C# records report Class and route "class"; C# record structs report Struct
// and route "struct" (scout.md Q1). The languageId argument keeps the signature
// ready for a language whose kind→genKind ever diverges; today none do.
function genKind(kind: vscode.SymbolKind, _languageId: string): GenKind {
  if (kind === vscode.SymbolKind.Struct) {
    return "struct";
  }
  if (kind === vscode.SymbolKind.Enum) {
    return "enum";
  }
  if (kind === vscode.SymbolKind.Class) {
    return "class";
  }
  if (kind === vscode.SymbolKind.Interface) {
    return "interface";
  }
  return "function";
}

/** Why a resolution produced no function. Three of the four are the
 *  environment's fault and only `no-symbol-at-cursor` is the human's, which is
 *  the entire point of keeping them apart. */
export type ResolveRefusalReason =
  | "no-provider"
  | "empty-tree"
  | "flat-symbols"
  | "no-symbol-at-cursor";

export interface ResolveRefusal {
  reason: ResolveRefusalReason;
}

export type FunctionResolution =
  | { ok: true; fn: ResolvedFunction }
  | { ok: false; refusal: ResolveRefusal };

/** The extension that owns document symbols for a language, and whether the
 *  user has to install it. TS-family symbols ship inside VS Code, so telling a
 *  TypeScript user to install a server is a message that cannot be acted on. */
const SYMBOL_PROVIDERS: Record<string, { name: string; builtIn?: true }> = {
  rust: { name: "rust-analyzer" },
  go: { name: "gopls (the Go extension)" },
  csharp: { name: "the C# extension (Roslyn)" },
  python: { name: "Pylance (the Python extension)" },
  typescript: { name: "VS Code's built-in TypeScript language features", builtIn: true },
  typescriptreact: { name: "VS Code's built-in TypeScript language features", builtIn: true },
  javascript: { name: "VS Code's built-in TypeScript language features", builtIn: true },
  javascriptreact: { name: "VS Code's built-in TypeScript language features", builtIn: true },
};

/** The message the human sees. `cursorText` is the gesture's own wording for
 *  the one cause that IS about the cursor: generate, repair and the two TDD
 *  gestures each want to say something different there, and all four want the
 *  same thing said about a missing server. */
export function refusalMessage(
  refusal: ResolveRefusal,
  languageId: string,
  cursorText: string,
): string {
  if (refusal.reason === "no-symbol-at-cursor") {
    return cursorText;
  }
  if (refusal.reason === "empty-tree") {
    return `Column 80: the language server has no symbols for this ${languageId} file yet, so it is probably still indexing. Try again in a moment.`;
  }
  if (refusal.reason === "flat-symbols") {
    return `Column 80: ${languageId}'s symbol provider answers a flat symbol list, and Column 80 needs a hierarchical document symbol provider to do sound span math.`;
  }
  const provider = SYMBOL_PROVIDERS[languageId];
  if (provider?.builtIn) {
    return `Column 80: no language server answered for ${languageId}. ${provider.name} are disabled or still starting, and generate, repair and TDD all need them.`;
  }
  const install = provider ? provider.name : `a language server extension for ${languageId}`;
  // Deliberately does NOT say "install it". The code has one bit here, an
  // `undefined` from the command, and that bit does not prove the extension is
  // missing: VS Code's isFalsyOrEmpty converts an EMPTY symbol result to
  // undefined twice on the way out (the DocumentSymbolAdapter and the command's
  // own result converter), so a working server looking at a file with no symbols
  // lands in this branch too. An empty new file, a Python script of only
  // top-level statements, a C# file of only `using` lines. Claiming "install
  // rust-analyzer" at a user who already has it working is the exact message
  // item 55 exists to kill, so the string names the server and stops there.
  return `Column 80: no document symbols for this ${languageId} file. Either ${install} is not installed or not enabled, or it is still starting up. Inline completions work without it, which is why the setup can look fine.`;
}

/** The channel line. This branch logged NOTHING before item 55, so the toast was
 *  the only signal in the product and it named the wrong cause. */
export function refusalLogLine(refusal: ResolveRefusal, languageId: string): string {
  // `cause=` because `[fngen] refused: ` is a SHARED prefix: promptBudget.ts and
  // the unsupported-language gate both emit it with a prose tail. A reader
  // parsing the tail as a slug is right only by luck without the key.
  return `[fngen] refused: cause=${refusal.reason} (${languageId})`;
}

/**
 * Innermost function-like symbol containing the cursor, via
 * executeDocumentSymbolProvider. Refuses when no provider answers, when the
 * provider has no symbols yet, when it returns flat SymbolInformation[] (no
 * selectionRange or hierarchy to do sound span math with: degrade, never
 * throw), or when the cursor is outside every function. Rust via rust-analyzer
 * is the proven path; head normalization covers exactly the trivia shapes
 * src/core/symbols.ts documents.
 */
export async function resolveFunctionOrRefusal(
  document: vscode.TextDocument,
  position: vscode.Position,
  // Admit Struct/Enum as targets. Off (the default, and the post-accept
  // oracle's re-resolution path) keeps v1 function-only resolution, so the
  // extension is byte-for-byte v1 when compilerDirectedInjection is off.
  admitTypes = false,
): Promise<FunctionResolution> {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
    "vscode.executeDocumentSymbolProvider",
    document.uri,
  );
  // Three server-side causes and one human-side cause, kept apart because the
  // product used to render all four as "move your cursor". Roadmap item 55: a
  // first-run Windows user with no rust-analyzer read that message, checked the
  // cursor, found it right, and had nowhere left to go.
  if (!symbols) {
    return { ok: false, refusal: { reason: "no-provider" } };
  }
  if (symbols.length === 0) {
    return { ok: false, refusal: { reason: "empty-tree" } };
  }
  if (!hasDocumentSymbolShape(symbols)) {
    return { ok: false, refusal: { reason: "flat-symbols" } };
  }
  const fn = resolveFromSymbolTree(symbols, document, position, admitTypes);
  return fn ? { ok: true, fn } : { ok: false, refusal: { reason: "no-symbol-at-cursor" } };
}

/** The pre-item-55 signature, kept because most callers only need "did it
 *  resolve". A caller that renders a message to the HUMAN uses
 *  `resolveFunctionOrRefusal` instead, or it renders the wrong cause. One
 *  channel-only caller still does not: `tightenDocComment.ts:253` logs the
 *  cursor cause for every cause. It degrades and continues rather than
 *  refusing, so no toast lies, and routing the cause through it means changing
 *  the `wiring.resolveFunction` seam. Deferred. */
export async function resolveFunctionAtCursor(
  document: vscode.TextDocument,
  position: vscode.Position,
  admitTypes = false,
): Promise<ResolvedFunction | undefined> {
  const resolution = await resolveFunctionOrRefusal(document, position, admitTypes);
  return resolution.ok ? resolution.fn : undefined;
}

/** Everything past the provider call: pure span math over a tree that is
 *  already known to be hierarchical and non-empty. */
function resolveFromSymbolTree(
  symbols: vscode.DocumentSymbol[],
  document: vscode.TextDocument,
  position: vscode.Position,
  admitTypes: boolean,
): ResolvedFunction | undefined {
  const kinds = admitTypes
    ? new Set<vscode.SymbolKind>([...FUNCTION_KINDS, ...typeKindsFor(document.languageId)])
    : FUNCTION_KINDS;
  const symbol = symbolAtCursor(symbols, document, position, kinds);
  if (!symbol) {
    return undefined;
  }

  // rust-analyzer (and other providers) include doc comments and attributes
  // in the symbol range; the span must start at the declaration head so a
  // regeneration never eats them.
  const headLine = declarationHeadLine(
    (line) => document.lineAt(line).text,
    symbol.range.start.line,
    symbol.selectionRange.start.line,
    // Python's `#` line comment, so a `#` comment between a decorator and the
    // `def` is walked past. `[]` for every other language keeps the walk
    // byte-identical (a Rust `#[attr]` / C# `#region` is never a comment skip).
    document.languageId === "python" ? ["#"] : [],
  );
  const headTextLine = document.lineAt(headLine);
  const headStart = new vscode.Position(headLine, headTextLine.firstNonWhitespaceCharacterIndex);
  const headerIndent = headTextLine.text.slice(0, headTextLine.firstNonWhitespaceCharacterIndex);
  const span: FunctionSpan = {
    start: document.offsetAt(headStart),
    end: document.offsetAt(symbol.range.end),
  };

  const trivia = document
    .getText(new vscode.Range(symbol.range.start, new vscode.Position(headLine, 0)))
    .replace(/\s+$/, "");
  const spanText = document.getText(new vscode.Range(headStart, symbol.range.end));

  // The doc channel. rust-analyzer includes doc lines in the symbol range, so
  // the range-to-head trivia slice carries them; REAL TS document symbols
  // exclude doc lines from the range, so an empty trivia on a
  // TS-family document still scans upward for the JSDoc block or `//` run
  // immediately above the head. TS symbol ranges DO include decorators, so a
  // decorated target has non-empty trivia with its JSDoc still further up:
  // decorator-only trivia scans from the decorator block's top and the doc is
  // prepended. Rust doc scanning is untouched.
  let docComment = trivia === "" ? undefined : trivia;
  if (document.languageId === "csharp") {
    // The Roslyn LS EXCLUDES `///` XML-doc (and `#region`) from range.start
    // but INCLUDES attributes (proven against the live LS). So a BARE documented member has
    // empty trivia (scan up for the `///` run / `/* */` block); an ATTRIBUTED
    // member (`[HttpGet]`, `[Fact]`, `[Required]` — most real C#) has the
    // attribute AS its trivia, with the `///` doc sitting ABOVE the attribute,
    // still outside range.start. Without the attribute arm the attribute alone
    // would be injected as the "doc" and the real `/// <summary>` dropped. Mirror
    // the TS decorator case below: scan from range.start (above the attribute) and
    // PREPEND the doc, keeping the attribute as context. Rust doc trivia untouched.
    const getLine = (line: number) => document.lineAt(line).text;
    if (docComment === undefined) {
      docComment = csDocCommentAbove(getLine, headLine);
    } else if (trivia.split("\n").find((l) => l.trim() !== "")?.trim().startsWith("[")) {
      // Attribute trivia is identified by its FIRST line: a multiline attribute
      // argument (`[Route("...", Name = ...)]`) can have interior lines starting
      // with anything, so keying on the first line (not every line) is what stops
      // exactly those attributes from eating the `///` doc above them.
      const doc = csDocCommentAbove(getLine, symbol.range.start.line);
      if (doc !== undefined) {
        docComment = `${doc}\n${trivia}`;
      }
    }
  } else if (TS_LANGUAGE_IDS.has(document.languageId)) {
    const getLine = (line: number) => document.lineAt(line).text;
    if (docComment === undefined) {
      docComment = tsDocCommentAbove(getLine, headLine);
    } else if (trivia.split("\n").find((l) => l.trim() !== "")?.trim().startsWith("@")) {
      // Decorator trivia is identified by its FIRST line: a multiline
      // decorator argument (`@UseGuards({ ... })`) has interior lines that
      // start with anything, and requiring every line to start with @ made
      // exactly those decorators eat the JSDoc above them.
      const doc = tsDocCommentAbove(getLine, symbol.range.start.line);
      if (doc !== undefined) {
        docComment = `${doc}\n${trivia}`;
      }
    }
  }

  // The Rust head slice is v1-FROZEN (prompt-byte-pinned); TS dispatches to the
  // depth-aware sibling so destructured/braced params survive; C# dispatches to
  // its own slicer that stops at `{` OR `=>` OR `;`, so an expression-bodied or
  // interface member is not eaten; Python cuts at the header `:`.
  const signature = TS_LANGUAGE_IDS.has(document.languageId)
    ? tsSignatureFromSpanText(spanText)
    : document.languageId === "csharp"
      ? csSignatureFromSpanText(spanText)
      : document.languageId === "python"
        ? pySignatureFromSpanText(spanText)
        : signatureFromSpanText(spanText);

  // Python reports every class-like symbol as Class, so genKind's "class" is
  // refined by the header: an Enum subclass (an enum base in its `(...)` list)
  // becomes "enum", a plain class or @dataclass stays "class". Classify off the
  // SIGNATURE, not the selectionRange line — the signature runs through the whole
  // base list to the header `:`, so a base list wrapped across lines
  // (`class Big(\n  Mixin,\n  Enum,\n):`) still carries its enum base. Decorators
  // are absent from the signature and never change the class-vs-enum answer.
  let kind = genKind(symbol.kind, document.languageId);
  // The head, taken BEFORE any language fork is allowed to move `span.start`.
  const headOffset = span.start;
  let bodyOnly = false;
  let docstringRefusal: string | undefined;
  let bodyIndent = "";
  if (document.languageId === "python") {
    if (symbol.kind === vscode.SymbolKind.Class) {
      kind = pyTypeGenKind(signature.split("\n"));
    }
    // The docstring is Python's doc-comment-is-the-instruction channel: read it
    // as the spec and PRESERVE it byte-exact by moving the span past it, so
    // generation writes only the body below (Fork A). Two shapes cannot be kept
    // outside the span while adding an indented body, so refuse them honestly
    // rather than silently losing the human's words: an on-header-line docstring
    // (the one-liner), and an implicit string-concatenation docstring (only its
    // first literal is located, so the rest would be eaten).
    const doc = pyLeadingDocstring(spanText);
    if (doc && doc.sameLineAsHeader) {
      docstringRefusal = `expand ${symbol.name} to multiple lines before generating — its docstring is on the header line and cannot be preserved in place.`;
    } else if (doc && pyDocstringHasAdjacentLiteral(spanText, doc.end)) {
      docstringRefusal = `join ${symbol.name}'s docstring into one string literal before generating — an implicitly concatenated docstring cannot be preserved in place.`;
    } else if (doc) {
      docComment = stripPyDocstring(spanText.slice(doc.start, doc.end));
      // The body column is the docstring's own indentation (it is the first body
      // statement), read from its line — never a hardcoded 4 spaces.
      const lineStart = spanText.lastIndexOf("\n", doc.start - 1) + 1;
      bodyIndent = spanText.slice(lineStart, doc.start);
      // AFTER THIS LINE `span.start` IS NOT THE DECLARATION HEAD. `headOffset`
      // is captured above precisely because this moves the writable region and
      // nothing else about the target.
      span.start += doc.end;
      bodyOnly = true;
    }
  }

  return {
    span,
    signature,
    docComment,
    symbolName: symbol.name,
    languageId: document.languageId,
    kind,
    bodyOnly,
    headOffset,
    headerIndent,
    bodyIndent,
    symbols,
    docstringRefusal,
  };
}

// Deepest symbol of an admitted kind whose range contains the position.
// Descends through non-admitted containers (impl blocks, classes, modules)
// so a method inside a struct impl still resolves. With type kinds admitted a
// struct/enum has no admitted-kind nesting (fields/variants are Field/
// EnumMember, never in the set), so a cursor inside a type resolves to the
// container, never a member.
function innermostFunction(
  symbols: vscode.DocumentSymbol[],
  position: vscode.Position,
  kinds: Set<vscode.SymbolKind>,
): vscode.DocumentSymbol | undefined {
  let best: vscode.DocumentSymbol | undefined;
  const visit = (list: vscode.DocumentSymbol[]) => {
    for (const s of list) {
      if (!s.range.contains(position)) {
        continue;
      }
      if (kinds.has(s.kind)) {
        best = s; // children are narrower than parents: last hit is innermost
      }
      visit(s.children ?? []);
    }
  };
  visit(symbols);
  return best;
}

/**
 * The symbol the cursor resolves to: innermost containment, then the
 * doc-attachment pass. THE one resolution rule; every gesture goes through it,
 * and the only thing a caller varies is the admitted `kinds` set.
 *
 * The attachment pass exists because four of the five servers EXCLUDE a doc
 * comment from the symbol's range, so a cursor parked in one is outside every
 * function: C# and a TS method resolve to the
 * enclosing CLASS, while a top-level TS, Go or Python function resolves to
 * NOTHING and the gesture refuses. Both shapes are the same bug — the
 * developer's model is that the comment belongs to the declaration below it —
 * and both are fixed by asking which declaration's trivia run the cursor is in.
 *
 * It runs whenever the current answer is NOT function-like, which includes a
 * container the cursor is genuinely inside. That is deliberate and it is safe
 * for the same reason the container case is: nearest-declaration-below wins, and
 * a declaration head line is never trivia to the grammar, so a member's run can
 * never reach up across its container's head. A cursor in a type's own doc
 * comment therefore keeps resolving to the type. A cursor inside a type's BODY
 * keeps resolving to the type too, because the closing brace between it and the
 * next declaration is not trivia either.
 *
 * A cursor already inside a function-like symbol returns before any of this, so
 * that path is byte-identical to before the pass existed. Rust benefits twice:
 * rust-analyzer puts doc comments inside the range, so a documented Rust
 * function never reaches the pass at all.
 *
 * Candidates are the same admitted kinds, so widening the set widens attachment
 * with it. A child node carrying no `selectionRange` is dropped rather than
 * dereferenced: `hasDocumentSymbolShape` validates TOP-LEVEL entries only and
 * says so, and one ragged child anywhere in the file must not turn every
 * resolution in it into a TypeError.
 */
function symbolAtCursor(
  symbols: vscode.DocumentSymbol[],
  document: vscode.TextDocument,
  position: vscode.Position,
  kinds: Set<vscode.SymbolKind>,
): vscode.DocumentSymbol | undefined {
  const symbol = innermostFunction(symbols, position, kinds);
  if (symbol && FUNCTION_KINDS.has(symbol.kind)) {
    return symbol;
  }
  const candidates = flattenOfKind(symbols, kinds).filter(
    (s) => typeof s.selectionRange?.start?.line === "number",
  );
  const attached = attachedCandidateIndex(
    candidates.map((s) => ({ nameLine: s.selectionRange.start.line })),
    (line) => document.lineAt(line).text,
    position.line,
    // Python's `#` line comment, the same arm the head walk takes.
    document.languageId === "python" ? ["#"] : [],
  );
  return attached === -1 ? symbol : candidates[attached];
}

// The kinds the CONTEXT-BLOCK gesture treats as a block, and it is deliberately
// wider than any generation admit set: a C# interface or a Go named type is
// perfectly good context even though neither is a generation target. The file
// extension constrains where code may be GENERATED and has nothing to do with
// what the human may show the model (goal decision 5).
//
// Namespace and Module are EXCLUDED. A C# file-scoped namespace spans the whole
// file, so admitting it would turn "add the enclosing block" into "add the file"
// without the human asking for it.
const BLOCK_KINDS = new Set<vscode.SymbolKind>([
  ...FUNCTION_KINDS,
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Struct,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Enum,
]);

/**
 * The innermost block-like symbol at the cursor, plus the 0-based first line of
 * its trivia run.
 *
 * `firstLine` comes from `attachRunStart`, not from `symbol.range.start.line`,
 * so the block begins at the doc comment in all five languages rather than only
 * in Rust. Undefined when the cursor is outside every admitted symbol, when no
 * provider answers, or when the provider returns
 * flat SymbolInformation[] — the gesture refuses plainly rather than falling
 * back to the whole file.
 */
export async function resolveBlockAtCursor(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<{ symbol: vscode.DocumentSymbol; firstLine: number } | undefined> {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
    "vscode.executeDocumentSymbolProvider",
    document.uri,
  );
  if (!symbols || symbols.length === 0 || !hasDocumentSymbolShape(symbols)) {
    return undefined;
  }
  const symbol = symbolAtCursor(symbols, document, position, BLOCK_KINDS);
  if (!symbol) {
    return undefined;
  }
  const firstLine = attachRunStart(
    (line) => document.lineAt(line).text,
    symbol.selectionRange.start.line,
    document.languageId === "python" ? ["#"] : [],
  );
  // rust-analyzer already puts the doc run inside the range, so the run start
  // and the range start agree there; the other four disagree, and the smaller
  // of the two is the honest first line either way.
  return { symbol, firstLine: Math.min(firstLine, symbol.range.start.line) };
}

// Every symbol of an admitted kind in the tree, in document order, parents
// before their children. Order is what the attachment pass reads: it sorts by
// name line, and the index tie-break falls back to this walk.
function flattenOfKind(
  symbols: readonly vscode.DocumentSymbol[],
  kinds: Set<vscode.SymbolKind>,
): vscode.DocumentSymbol[] {
  const out: vscode.DocumentSymbol[] = [];
  const visit = (list: readonly vscode.DocumentSymbol[]) => {
    for (const s of list) {
      if (kinds.has(s.kind)) {
        out.push(s);
      }
      visit(s.children ?? []);
    }
  };
  visit(symbols);
  return out;
}

// Declaration head: span text up to and excluding the body block. Brace
// languages cut at the first `{`; for the rest (Python and friends) the
// head is the first line.
function signatureFromSpanText(spanText: string): string {
  const brace = spanText.indexOf("{");
  if (brace > 0) {
    return spanText.slice(0, brace).replace(/\s+$/, "");
  }
  const newline = spanText.indexOf("\n");
  return (newline === -1 ? spanText : spanText.slice(0, newline)).replace(/\s+$/, "");
}

/** The C# declaration head: span text up to the body, cutting at the FIRST
 *  top-level `{` (block body), `=>` (expression body), or `;` (interface member /
 *  abstract declaration). The Rust `{`-slicer eats an expression-bodied
 *  `public int Foo() => 1;` whole (no `{`) and keeps an interface member's
 *  trailing `;`; this stops at whichever terminator comes first. Paren/bracket
 *  depth is tracked so a `=>` (a lambda default arg), `;`, or `{` INSIDE the
 *  parameter list is not mistaken for the body terminator. Sibling of
 *  tsSignatureFromSpanText; the Rust/TS slicers stay byte-identical. */
export function csSignatureFromSpanText(spanText: string): string {
  let depth = 0;
  for (let i = 0; i < spanText.length; i++) {
    const c = spanText[i];
    if (c === "(" || c === "[") {
      depth++;
    } else if (c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      if (c === "{" || c === ";") {
        return spanText.slice(0, i).replace(/\s+$/, "");
      }
      if (c === "=" && spanText[i + 1] === ">") {
        return spanText.slice(0, i).replace(/\s+$/, "");
      }
    }
  }
  return spanText.replace(/\s+$/, "");
}

/** The Python declaration head: span text up to and INCLUDING the
 *  `:` that terminates the `def` header at bracket-depth 0. The Rust default
 *  cuts at the first `{` (none in Python) then the first newline, which is WRONG
 *  for a multi-line header (`def f(\n  a: Widget,\n) -> Order:`) — it returns only
 *  `def f(`. Paren/bracket depth is tracked so a param-annotation `:` (at
 *  paren-depth 1) or a `Dict[str, int]` subscript never terminates the header;
 *  only the depth-0 `:` after the closing `)` does. Sibling of
 *  csSignatureFromSpanText; the Rust/TS/C# slicers stay byte-identical. */
export function pySignatureFromSpanText(spanText: string): string {
  let depth = 0;
  for (let i = 0; i < spanText.length; i++) {
    const c = spanText[i];
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1);
    } else if (c === ":" && depth === 0) {
      return spanText.slice(0, i + 1).replace(/\s+$/, "");
    }
  }
  return spanText.replace(/\s+$/, "");
}

/**
 * True when a `kind === "function"` target is a BODYLESS member declaration —
 * an interface member signature (`area(): number;`, `int Area();`) or a C#
 * abstract method — that has no body block to generate into. Generating a body
 * would splice a `{ ... }` (or `=> expr`) over a bodyless signature and produce
 * invalid code (a TS interface member can never carry a body; a C# abstract
 * method can never), so the command refuses honestly instead — the honest-degrade
 * non-negotiable.
 *
 * C# and TypeScript ONLY, and deliberately so: a Rust trait method signature
 * (`fn area(&self) -> f64;`) legally takes a generated DEFAULT body, so Rust must
 * never be refused here (the freeze); Python bodies are brace-less (its member
 * story is a later phase). Soundness rides the depth-aware signature slicers, not
 * a raw substring: the slice already skips a `{` inside a parameter object type or
 * a `<...>` generic, so what follows the slice is the true body delimiter — `{`
 * (a block body, both languages) or `=>` (a C# expression body). Neither present
 * means bodyless.
 */
/**
 * The honest, per-language name for a brace-less type — one that has no body
 * block to generate into, so the gesture refuses. "unit or tuple" is Rust
 * vocabulary (a unit `struct Foo;` / tuple `struct Foo(i32);`); the C# analog is
 * a positional `record Point(int X, int Y);` or `record struct Rgb(...)`, whose
 * members ARE the parameter list. Deliberate-dark: every language names its own
 * no-body shape rather than borrowing Rust's.
 */
export function bracelessTypeShape(languageId: string, kind: GenKind): string {
  if (languageId === "csharp") {
    return kind === "struct" ? "a positional record struct" : "a positional record";
  }
  // The else is Rust by construction: this is only ever called for a target
  // isBracelessTypeTarget already confirmed brace-less, and the only brace-less
  // shapes that exist are a Rust unit/tuple struct and the two C# positional
  // records above. TS types and Rust/C# enums are always braced, so no
  // TS-family or enum id reaches here — the unreachability is load-bearing.
  return `a unit or tuple ${kind}`;
}

/**
 * True when a resolved TYPE target has no body block to generate into, so the
 * gesture refuses honestly. Brace-language-only: a Rust unit/tuple struct or the
 * C# positional record / record struct (no `{` in the span). Python is excluded
 * BY DESIGN — its bodies are indentation-delimited and it has no structurally-
 * empty class (a `pass`/`...`/docstring/one-liner body is always generatable), so
 * a Python type is NEVER brace-less-refused. Extracted so that dark fact is a
 * pinned predicate, not a buried `&&` clause.
 *
 * Go needs no exclusion row: its only admitted type kinds (GO_TYPE_KINDS:
 * Struct, Interface) are ALWAYS braced — even `type X struct{}` carries the
 * `{` — and the brace-less named types (`type Celsius float64`, aliases)
 * report Class, which Go never admits, so no Go target reaches the probe
 * without a brace.
 */
export function isBracelessTypeTarget(languageId: string, kind: GenKind, spanText: string): boolean {
  if (kind === "function" || languageId === "python") {
    return false;
  }
  return !spanText.includes("{");
}

export function isBodylessMemberTarget(languageId: string, spanText: string): boolean {
  if (languageId === "csharp") {
    const after = spanText.slice(csSignatureFromSpanText(spanText).length).trimStart();
    return !after.startsWith("{") && !after.startsWith("=>");
  }
  if (TS_LANGUAGE_IDS.has(languageId)) {
    // TS has no `=> expr` method bodies (an arrow is a type annotation or a
    // property value, and a property never resolves as a function target), so a
    // real body is a top-level `{ }` block. tsHasBodyBrace answers that soundly —
    // a return-type object on a continuation line does not fool it.
    return !tsHasBodyBrace(spanText);
  }
  return false;
}

/** Connection-level codes that mean the server was not reached at all. The
 *  timeout and host-unreachable pair are the remote-host arm's failures: a
 *  LAN or tunnelled ollama that is down answers with silence, not a refusal.
 *
 *  undici's connect timeout joins them by name, NOT by a `UND_ERR_` prefix.
 *  The prefix was too wide: only a connect-phase failure proves the server was
 *  never reached, and `UND_ERR_SOCKET` means the opposite - a real mid-stream
 *  socket close arrives as one, and the server had already answered and
 *  streamed a token. Offering "Start ollama serve" for a server that is
 *  running is worse than falling through to the plain failure wording. */
const UNREACHABLE_CODES = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
];

function isUnreachableCode(code: unknown): boolean {
  return typeof code === "string" && UNREACHABLE_CODES.includes(code);
}

/** True when a generate error is the Ollama server being unreachable rather
 *  than a real generation fault. Node's fetch reports a refused/reset
 *  connection as a TypeError "fetch failed" carrying a cause with the errno
 *  code, so the message, the nested cause and the error's own code are all
 *  checked. Top-level and nested are matched against the SAME list on purpose:
 *  a code that means "unreachable" under `cause` means it at the top too, and
 *  a raw `err.code` is what a non-fetch caller (or a wrapper that flattens the
 *  cause) hands over. */
export function isServerUnreachable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  if (isUnreachableCode(e?.code) || isUnreachableCode(e?.cause?.code)) {
    return true;
  }
  return err instanceof TypeError && /fetch failed/i.test(err.message);
}

const PREVIEW_SCHEME = "column80-fngen";

/** What present() needs to show one proposal and, on consent, splice it. */
export interface ProposalRequest {
  document: vscode.TextDocument;
  span: FunctionSpan;
  /** document.version captured when the span was resolved; any mismatch at
   *  a guard point discards, never applies. */
  versionAtResolve: number;
  /** Diff tab title, e.g. "name: generated body (preview)". */
  title: string;
  /** The replacement function text that would land in the span. */
  text: string;
  /** Evidence sink for accept/reject/discarded outcomes. */
  service: FnGenService;
  /** Surface for PRE-CONSENT system discards ONLY: the document closed or
   *  changed during generation — the product's own doing, never a human
   *  verdict. Absent = today's warning toast, right for a gesture the user
   *  invoked. A background FIM-sourced repair session passes its channel
   *  logger here: the race it loses is the user's own typing, and a toast
   *  for that is noise (roadmap item 64, mechanical half; narrowed by its
   *  post-review amendment). No other cause reaches this callback: every
   *  post-Accept discard (closed/changed while previewing, editor refused
   *  the edit) and a preview that could not open toast in EVERY session,
   *  because an accepted edit failing to land is not a background race the
   *  user never watched. The outcome log records "discarded" either way. */
  onSystemDiscard?: (why: string) => void;
}

export type ProposalOutcome = "accept" | "reject" | "discarded";

type ProposalDecision = "accept" | "reject";
// Which check settled a proposal: the explicit accept/reject commands on the
// diff tab, or the pruner that reads a closed preview tab as a walk-away.
type DecisionVia = "human-gesture" | "preview-tab-closed";

/**
 * The ONE preview-and-confirm consent gate and the ONE document write in
 * the extension. Every proposal — fn-gen command or oracle repair round —
 * goes through present(); repair having no other splice path is what makes
 * "no new insertion route" structural rather than a convention.
 */
export class ProposalPresenter {
  // Read-only virtual documents holding proposed full texts, one entry per
  // preview URI so overlapping generations never show each other's
  // proposal. Entries die with their tabs.
  private readonly previews = new Map<string, string>();
  // Entries here are awaiting their diff tab: the vscode.diff call has not
  // resolved yet, so "no open tab" proves nothing. The pruner must not
  // touch them — a tab event in that window would blank a live preview
  // into a whole-file-deletion render, and the preview is the consent gate.
  private readonly pendingPreviews = new Set<string>();
  // One resolver per preview awaiting a human gesture; resolving settles
  // present()'s decision wait. Removed before present() closes its own tab
  // so only user-driven closes read as gestures. `via` names which check
  // decided — the explicit gesture commands or the tab-close pruner — so a
  // reject's evidence line can say who refused (a bare outcome=reject left
  // that unknowable; the dark-reject record in
  // `docs/architecture/fn-generation.md`).
  private readonly decisions = new Map<string, (decision: ProposalDecision, via: DecisionVia) => void>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private previewSeq = 0;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
        onDidChange: this.changeEmitter.event,
        provideTextDocumentContent: (uri) => this.previews.get(uri.toString()) ?? "",
      }),
      this.changeEmitter,
      // The gesture surface: title-bar buttons and keybindings on the diff
      // tab (package.json scopes both to resourceScheme == column80-fngen),
      // living as long as the preview does.
      vscode.commands.registerCommand("column80.proposalAccept", (uri?: vscode.Uri) =>
        this.decideFromUi(uri, "accept"),
      ),
      vscode.commands.registerCommand("column80.proposalReject", (uri?: vscode.Uri) =>
        this.decideFromUi(uri, "reject"),
      ),
      // A user closing the diff tab by hand must also clear its entry, or
      // the map keeps a stale proposal per abandoned preview.
      vscode.window.tabGroups.onDidChangeTabs(() => {
        if (this.previews.size === 0) {
          return;
        }
        const open = new Set(
          vscode.window.tabGroups.all
            .flatMap((g) => g.tabs)
            .map((t) => (t.input instanceof vscode.TabInputTextDiff ? t.input.modified.toString() : ""))
            .filter((u) => u !== ""),
        );
        for (const key of [...this.previews.keys()]) {
          if (!open.has(key) && !this.pendingPreviews.has(key)) {
            // Closing the preview is the walk-away gesture: reject, so
            // present() terminates and the outcome lands in the evidence
            // channel instead of an await that never settles.
            this.decisions.get(key)?.("reject", "preview-tab-closed");
            this.previews.delete(key);
          }
        }
      }),
    );
  }

  // Title-bar buttons pass the diff's modified-side URI; keybindings and
  // palette invocations pass nothing, so fall back to the active tab's
  // preview.
  private decideFromUi(uri: vscode.Uri | undefined, decision: ProposalDecision): void {
    const key =
      uri !== undefined && uri.scheme === PREVIEW_SCHEME
        ? uri.toString()
        : activePreviewKey();
    if (key !== undefined) {
      this.decisions.get(key)?.(decision, "human-gesture");
    }
  }

  async present(request: ProposalRequest): Promise<ProposalOutcome> {
    const { document, span, versionAtResolve, service } = request;
    // Before the preview, not between the preview and the write: the human must
    // review the bytes that land.
    const text = withDocumentEol(request.text, document);
    // System discard: log outcome=discarded (distinct from a human reject so
    // accept/reject stats stay honest), never touch the document. The surface
    // depends on who asked AND on when (item 64 amendment): only a pre-consent
    // race — the document moved or closed during generation, a race the user's
    // own typing won without them watching — goes to a background caller's
    // channel. Everything after the human clicked Accept is news about an edit
    // they approved, so it toasts in every session, callback or not.
    //
    // `detail` is the one thing on this path the product did not author: the
    // caught error from a preview that would not open. It arrives separately
    // from `why` so the CUT can land inside the brackets the sentence puts it
    // in. Cutting the composed sentence instead - which is what the first fix
    // did - splits the bracket pair and welds the sentence's own period to a
    // truncated clause: "...could not be opened (Error: the diff editor is
    // gone." reached the screen.
    const discard = (
      why: string,
      surface: "channel-if-wired" | "toast",
      detail?: string,
    ): ProposalOutcome => {
      if (surface === "channel-if-wired" && request.onSystemDiscard !== undefined) {
        request.onSystemDiscard(why);
      } else {
        // ONE LINE, the deferred fix item 63 left on this string. Five of the
        // six reasons below are product prose, but the preview-open branch
        // interpolates a caught error, and a stack in a notification renders as
        // a wall of rows.
        //
        // The open bracket sits in `text` and its partner is the `end`
        // argument, on purpose: `oneLineWithPointer` applies `end` AFTER the
        // cut, so the pair cannot be split however long the error is. The
        // period is the `tail`, which lands after the bracket rather than
        // inside it, and the channel pointer - now that the whole reason
        // reaches `logOutcome` below - is a promise with something behind it.
        void vscode.window.showWarningMessage(
          detail === undefined
            ? oneLineWithPointer(`Column 80: generation discarded — ${why}`, ".")
            : oneLineWithPointer(`Column 80: generation discarded — ${why} (${detail}`, ")", "."),
        );
      }
      // THE REASON, and ONLY where there is one to lose. Without this the
      // toast's cut destroyed the only copy of a multi-line error: nothing else
      // on this path writes it anywhere, so a reader who saw "the preview could
      // not be opened" had no way to find out what the editor actually said.
      // The five product-prose reasons pass nothing, because they are one line,
      // are never cut, and the record they leave is the one the surface
      // contract pinned.
      service.logOutcome("discarded", detail === undefined ? undefined : { discardedBecause: detail });
      return "discarded";
    };

    if (document.isClosed) {
      return discard("the document was closed during generation", "channel-if-wired");
    }
    if (document.version !== versionAtResolve) {
      return discard("the document changed during generation", "channel-if-wired");
    }

    const previewUri = vscode.Uri.from({
      scheme: PREVIEW_SCHEME,
      // The document's own path keeps the language's syntax highlighting
      // in the preview pane; the sequence token keys the map entry.
      path: document.uri.path,
      query: `v=${this.previewSeq++}`,
    });
    const previewKey = previewUri.toString();
    this.previews.set(previewKey, spliceSpan(document.getText(), span, text));
    this.pendingPreviews.add(previewKey);
    this.changeEmitter.fire(previewUri);
    try {
      await vscode.commands.executeCommand("vscode.diff", document.uri, previewUri, request.title);
    } catch (err) {
      this.previews.delete(previewKey);
      // Not one of the two racing causes: an editor that cannot open the diff
      // is broken machinery, not the user typing over background work, and a
      // background session's channel is the wrong place to bury that.
      return discard("the preview could not be opened", "toast", String(err));
    } finally {
      // The tab now exists (or never will): the pruner may own the entry.
      this.pendingPreviews.delete(previewKey);
    }

    // Explicit gesture on the diff tab itself: title-bar buttons, the
    // keybindings bound to them, or closing the tab (reject). No toast; a
    // notification auto-hides after seconds and interrupts besides. The
    // tab is the proposal, so the tab carries the gesture. The tab-close
    // path guarantees present() always terminates while the outcome still
    // lands in the evidence channel.
    const [decision, via] = await new Promise<[ProposalDecision, DecisionVia]>((resolve) => {
      this.decisions.set(previewKey, (d, v) => resolve([d, v]));
    });
    // Resolver out first: the closePreviewTabs below fires onDidChangeTabs,
    // which must not read our own close as a user reject.
    this.decisions.delete(previewKey);
    await closePreviewTabs(previewUri);
    this.previews.delete(previewKey);

    if (decision !== "accept") {
      service.logOutcome("reject", { refusedBy: via, offered: text });
      return "reject";
    }
    // Final guards and applyEdit issued in the SAME synchronous tick: no
    // await between the version check and the edit call. What remains is
    // the applyEdit round trip itself — API-inherent and a SILENT
    // mis-apply if a change lands inside it (public WorkspaceEdit text
    // edits carry no versionId, nothing refuses stale edits); see surface.
    if (document.isClosed) {
      return discard("the document was closed while previewing", "toast");
    }
    if (document.version !== versionAtResolve) {
      return discard("the document changed while previewing", "toast");
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)),
      text,
    );
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return discard("the editor refused the edit", "toast");
    }
    service.logOutcome("accept");
    return "accept";
  }

  /**
   * Show a READ-ONLY diff of `document` against `previewFullText` and return the
   * human's gesture — WITHOUT applying any edit. The TDD regen review: see the
   * new tests replace the marked region, Accept (title-bar button / keybinding) to
   * proceed to the tab-in, or Reject / ESC / close the tab to cancel with no write.
   * Reuses present()'s preview + decision machinery: the same accept/reject
   * commands, the tab-close pruner, and the PREVIEW_SCHEME buttons/keybindings all
   * govern this diff too. The caller does the write on "accept".
   */
  async confirmDiff(request: {
    document: vscode.TextDocument;
    previewFullText: string;
    title: string;
    /** ADDED phase 6. When set, a notification carrying this sentence and an
     *  accept/discard pair is raced against the diff tab's own gesture, so the
     *  human can answer from either. Absent keeps the Rust regen review exactly
     *  as it shipped: the tab is the proposal and the tab carries the gesture. */
    prompt?: string;
    acceptLabel?: string;
  }): Promise<ProposalDecision | "discarded"> {
    const { document, previewFullText, title } = request;
    if (document.isClosed) {
      return "discarded";
    }
    const previewUri = this.nextPreviewUri(document.uri);
    this.previews.set(previewUri.toString(), previewFullText);
    return this.showAndDecide(document.uri, previewUri, title, request.prompt, request.acceptLabel);
  }

  /**
   * THE THIRD DOCUMENT WRITE PATH's consent gate (`docs/supersessions.md` S3):
   * preview a file that DOES NOT EXIST YET, whole, as a diff against EMPTY.
   *
   * The same machinery `confirmDiff` uses — the preview scheme, the diff tab,
   * the accept/reject commands, the tab-close pruner — with the original side of
   * the diff supplied as an empty virtual document rather than a real one,
   * because there is no real one. Nothing is created here: this method decides,
   * and the CALLER writes on "accept".
   */
  async confirmNewFile(request: {
    targetUri: vscode.Uri;
    previewFullText: string;
    title: string;
    prompt: string;
    acceptLabel: string;
  }): Promise<ProposalDecision | "discarded"> {
    const emptyUri = this.nextPreviewUri(request.targetUri);
    const previewUri = this.nextPreviewUri(request.targetUri);
    // The empty side is the "against empty" half of the diff. It carries no
    // decision resolver, so the tab pruner dropping its map entry costs nothing:
    // a missing entry renders as "" and "" is what it holds.
    this.previews.set(emptyUri.toString(), "");
    this.previews.set(previewUri.toString(), request.previewFullText);
    const decision = await this.showAndDecide(
      emptyUri,
      previewUri,
      request.title,
      request.prompt,
      request.acceptLabel,
    );
    return decision;
  }

  private nextPreviewUri(forUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.from({
      scheme: PREVIEW_SCHEME,
      // The target's own path keeps the language's syntax highlighting in the
      // preview pane; the sequence token keys the map entry.
      path: forUri.path,
      query: `v=${this.previewSeq++}`,
    });
  }

  /** Open the diff, wait for a gesture, close the tab, and hand back the
   *  decision. The gesture is the diff tab's accept/reject (or its close), and
   *  additionally a notification when the caller supplied one — whichever the
   *  human reaches first settles it. */
  private async showAndDecide(
    originalUri: vscode.Uri,
    previewUri: vscode.Uri,
    title: string,
    prompt: string | undefined,
    acceptLabel: string | undefined,
  ): Promise<ProposalDecision | "discarded"> {
    const previewKey = previewUri.toString();
    this.pendingPreviews.add(previewKey);
    this.changeEmitter.fire(previewUri);
    try {
      await vscode.commands.executeCommand("vscode.diff", originalUri, previewUri, title);
    } catch {
      this.previews.delete(previewKey);
      return "discarded";
    } finally {
      this.pendingPreviews.delete(previewKey);
    }
    const fromTab = new Promise<ProposalDecision>((resolve) => {
      this.decisions.set(previewKey, resolve);
    });
    const decision =
      prompt === undefined
        ? await fromTab
        : await Promise.race([
            fromTab,
            (async (): Promise<ProposalDecision> => {
              const accept = acceptLabel ?? "Accept";
              const choice = await vscode.window.showInformationMessage(prompt, accept, "Discard");
              // Dismissing the notification IS discarding: nothing is written
              // unless the human says so.
              return choice === accept ? "accept" : "reject";
            })(),
          ]);
    // Resolver out first, then close: closePreviewTabs fires onDidChangeTabs, which
    // must not read our own close as a second (reject) gesture.
    //
    // The map entry is left for the TAB PRUNER to collect, deliberately. One
    // owner of a preview's lifetime rather than two: the pruner already collects
    // every entry whose tab is gone, and deleting here as well takes the
    // read-only document out from under a tab that may still be rendering — the
    // blank-into-a-whole-file-deletion render `pendingPreviews` exists to
    // prevent, arriving through the other door.
    this.decisions.delete(previewKey);
    await closePreviewTabs(previewUri);
    return decision;
  }
}

/** One fn-gen service build from settings + the resolved tier. The composed
 *  config is returned alongside the service so the seam is assertable
 *  without reaching into service internals. */
export async function buildFnGenService(
  output: vscode.OutputChannel,
  log: (line: string) => void,
  probeOpts?: ProbeHardwareOptions,
  claudeCode?: FnGenBackendDeps,
): Promise<{ service: FnGenService; tier: TierSelection; config: FnGenConfig }> {
  // Cloud short-circuits the whole local machine story: no hardware probe, no
  // VRAM tier, no carve. FIM stays local and is wired elsewhere, untouched.
  const cloud = readCloudConfig();
  if (cloud?.provider === CLAUDE_CODE) {
    return buildClaudeCodeFnGenService(log, claudeCode);
  }
  if (cloud) {
    return buildCloudFnGenService(cloud, log);
  }
  // A remote Ollama is the third off-table backend, and it is checked AFTER the
  // two cloud arms so a configured cloud provider still wins. Roadmap item 19:
  // the transport was always there (apiBase is the base of every ollama
  // request), and the product still measured THIS box's VRAM and then acted on
  // it, so a laptop pointed at an idle GPU server was told it had no GPU.
  const localConfig = readFnGenConfig();
  if (isRemoteApiBase(localConfig.apiBase)) {
    return buildRemoteFnGenService(localConfig, log, claudeCode?.listModels);
  }
  const { selection } = await resolveTier(output, probeOpts);
  const config = applyTier(readFnGenConfig(), selection, readTierConfig().explicitFnGenModel);
  if (!selection.fnGenEnabled) {
    return {
      service: inertFnGenService(
        config,
        selection.message ?? "Function generation is disabled on this hardware tier. FIM tab-completion still works.",
        log,
      ),
      tier: selection,
      config,
    };
  }
  return { service: new FnGenService(config, undefined, log), tier: selection, config };
}

/** The service a DISABLED arm returns: same config and logging as the live one,
 *  so a settings change still rebuilds and re-enables exactly as before, but
 *  the transport rejects with the tier's recorded reason instead of carrying a
 *  dialable default. The claude-code arm's rule, ratified for every arm
 *  (roadmap item 58): the closed tier gate is what stops a gesture, and the
 *  inert transport is what stops a gate missed anywhere from dialling a
 *  backend the build itself declared dead. */
function inertFnGenService(config: FnGenConfig, message: string, log: (line: string) => void): FnGenService {
  return new FnGenService(config, () => Promise.reject(new Error(message)), log);
}

/** How long activation will wait to learn whether a remote host is up. The
 *  probe is raced rather than merely signalled, because a seam that ignores its
 *  AbortSignal would otherwise hang activation. */
const REMOTE_REACHABILITY_MS = 2000;

/** The remote arm: the same off-table treatment the cloud backends get, for the
 *  one case that was falling through to a probe of the wrong machine. No
 *  hardware probe, no model override, no local carve. Fails CLOSED on a host
 *  that does not answer, naming the HOST, because "no usable GPU detected" is
 *  the sentence this entry exists to stop printing. */
async function buildRemoteFnGenService(
  read: FnGenConfig,
  log: (line: string) => void,
  listModelsFn: typeof listModels = listModels,
): Promise<{ service: FnGenService; tier: TierSelection; config: FnGenConfig }> {
  const host = read.apiBase;
  const config: FnGenConfig = { ...read };
  // numGpu is a local serving carve, tuned against a VRAM row on this box. It
  // means nothing about somebody else's machine.
  delete config.numGpu;
  // Raced, not just signalled: an injected seam that ignores the signal still
  // must not hold activation open.
  const bounded = new Promise<undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), REMOTE_REACHABILITY_MS);
    (timer as { unref?: () => void }).unref?.();
  });
  const models = await Promise.race([
    listModelsFn(host, AbortSignal.timeout(REMOTE_REACHABILITY_MS)),
    bounded,
  ]);
  if (models === undefined) {
    log(`[carve] tier=remote host=${host} fnGen=disabled reason=unreachable`);
    const message = `Function generation is disabled: the Ollama server at ${host} did not answer. FIM tab-completion still works.`;
    return {
      service: inertFnGenService(config, message, log),
      tier: { id: "remote", fnGenEnabled: false, provisional: false, message },
      config,
    };
  }
  // Reachable is only half of ready: the one listModels call already says what
  // is pulled, and a host that lacks the configured model would take the user's
  // first generate to an opaque model-not-found. Fail CLOSED here too, naming
  // the MODEL (roadmap item 57).
  if (!hasModel(models, config.model)) {
    log(`[carve] tier=remote host=${host} model=${config.model} fnGen=disabled reason=model-missing`);
    const message = `Function generation is disabled: the Ollama server at ${host} does not have ${config.model} pulled. FIM tab-completion still works.`;
    return {
      service: inertFnGenService(config, message, log),
      tier: { id: "remote", fnGenEnabled: false, provisional: false, message },
      config,
    };
  }
  // model is the user's verbatim, explicit or not. The tier table's row model is
  // a fact about local VRAM and this is not a local model.
  log(`[carve] tier=remote host=${host} model=${config.model} fnGen=enabled`);
  return { service: new FnGenService(config, undefined, log), tier: { id: "remote", fnGenEnabled: true, provisional: false }, config };
}

/** The cloud arm of buildFnGenService: a synthetic "cloud" tier (no VRAM to
 *  fit) plus the OpenAI-compatible generate fn behind the same seam. Fails the
 *  tier gate CLOSED when the key or endpoint is missing, so a half-configured
 *  provider surfaces as an honest disabled message, never a doomed request. */
function buildCloudFnGenService(
  cloud: CloudFnGenConfig,
  log: (line: string) => void,
): { service: FnGenService; tier: TierSelection; config: FnGenConfig } {
  // apiBase is dead for the cloud client (baseUrl is bound at construction),
  // but mirror it into the config so evidence and inspection stay coherent;
  // drop any local carve.
  const config: FnGenConfig = { ...readFnGenConfig(), apiBase: cloud.baseUrl };
  delete config.numGpu;
  // `num_ctx` reaches nothing on a cloud transport (anthropicInstruct and the
  // OpenAI-compatible client both document it as dead), and its ABSENCE is what
  // tells the service this class has no local window to arbitrate against.
  // Leaving it set would have refused a frontier prompt against a 16384-token
  // window the backend does not have - the exact inherited-constant hazard the
  // budget profile exists to end.
  delete config.numCtx;
  // `anthropic` alone takes the native Messages transport, because
  const missing =
    cloud.baseUrl === "" ? "endpoint (column80.cloudApiBase)" : cloud.apiKey === "" ? "API key (column80.cloudApiKey)" : undefined;
  if (missing !== undefined) {
    log(`[carve] tier=cloud provider=${cloud.provider} fnGen=disabled reason=missing-${cloud.baseUrl === "" ? "endpoint" : "key"}`);
    const message = `Function generation is disabled: the ${cloud.label} cloud backend needs an ${missing}. FIM tab-completion still works.`;
    return {
      service: inertFnGenService(config, message, log),
      tier: { id: "cloud", fnGenEnabled: false, provisional: false, message },
      config,
    };
  }
  // `cache_control` does not exist on the OpenAI-compatible surface the other
  // four ride. That is the ADR amendment written up in
  // docs/architecture/fn-generation.md: the compat surface still serves every
  // provider whose caching is implicit, and the one provider whose caching is
  // explicit gets the client that can reach it. A per-token Anthropic user must
  // not silently fail to cache.
  const generateFn =
    cloud.provider === "anthropic"
      ? makeAnthropicInstruct({ baseUrl: cloud.baseUrl, apiKey: cloud.apiKey, log })
      : makeCloudInstruct({ baseUrl: cloud.baseUrl, apiKey: cloud.apiKey, log });
  // model is the user's fnGenModel verbatim - a cloud id like the provider
  // documents. An id left at the local default surfaces as the provider's own
  // "unknown model" error on first request, not a guess masked here.
  log(`[carve] tier=cloud provider=${cloud.provider} model=${config.model} fnGen=enabled`);
  return {
    service: new FnGenService(config, generateFn, log),
    tier: { id: "cloud", fnGenEnabled: true, provisional: false },
    config,
  };
}

/** What the Claude Code arm needs from the host, injectable so its oracles run
 *  without a host `claude` and without spending a single token of subscription
 *  quota. */
/** What `buildFnGenService` accepts from the host. The claude-code fields are
 *  the original bag; `listModels` arrived with the remote arm and rides the
 *  same parameter rather than growing a fifth, because it is the same kind of
 *  thing: a host call an oracle must be able to replace. */
export interface FnGenBackendDeps extends ClaudeCodeDeps {
  /** Remote-host reachability. The same call firstRun uses to answer "is the
   *  server up", so there is one such call in the product, not two. */
  listModels?: typeof listModels;
}

export interface ClaudeCodeDeps {
  /** The extension's global storage path. The CLI is spawned in a directory
   *  under it, never in the user's workspace. Absent means fail CLOSED. */
  storagePath?: string;
  /** PATH probe for the CLI, default `claude --version`. */
  run?: ProbeCommandFn;
  /** Directory creation, injectable so the oracle can observe it. */
  ensureDir?: (dir: string) => void;
}

/** How long the CLI gets to answer `--version`. It does no network work, so
 *  anything slower than this is a wedged binary, not a slow one. */
const CLAUDE_VERSION_TIMEOUT_MS = 5_000;

/**
 * The Claude Code arm of buildFnGenService: the user's installed `claude` CLI
 * run headless behind the same seam, billed to their subscription rather than
 * an API key. Fails CLOSED when the CLI is absent or when there is nowhere
 * product-owned to run it.
 *
 * Two things are deliberately NOT done here. The login state is not probed: a
 * probe would spend quota on every service build, and every settings change
 * rebuilds the service. A logged-out CLI is discovered lazily on the first real
 * round, where the module's `logged-out` reason already names the remedy. And
 * the model is not validated: `fnGenModel` still holds the LOCAL ollama default
 * for anyone who has not deliberately typed a Claude id, and the module's own
 * rule turns that into "let the CLI pick", which is the right answer rather
 * than an error.
 */
async function buildClaudeCodeFnGenService(
  log: (line: string) => void,
  deps: ClaudeCodeDeps = {},
): Promise<{ service: FnGenService; tier: TierSelection; config: FnGenConfig }> {
  // apiBase is dead here (there is no endpoint at all) and there is no local
  // carve; mirror the cloud arm so evidence and inspection stay coherent.
  const config: FnGenConfig = { ...readFnGenConfig(), apiBase: "" };
  delete config.numGpu;
  // Same reason as the cloud arm: the CLI has no local window to set, so the
  // absent `numCtx` is what exempts this class from the phase-2 arbitration.
  delete config.numCtx;

  const disabled = (reason: string, message: string) => {
    log(`[carve] tier=claude-code fnGen=disabled reason=${reason}`);
    return {
      // A service that can never be called still has to exist: every dispose
      // path and every gate consults one. The closed TIER is what stops it
      // being called - but the transport is made inert anyway, because a
      // disabled build must not be one refactor away from spawning. An earlier
      // version handed this service a real claude transport with `cwd: ""`, and
      // node does not reject an empty cwd: it silently inherits the extension
      // host's, which for `code .` is the user's workspace. That is precisely
      // the leak this backend exists to prevent, armed and waiting on a gate
      // one call away.
      service: inertFnGenService(config, message, log),
      tier: { id: "claude-code" as const, fnGenEnabled: false, provisional: false, message },
      config,
    };
  };

  // No product-owned directory means the only cwd left is the user's workspace,
  // and spawning there would silently import their CLAUDE.md, their auto-memory
  // and their project MCP servers into a generation the context panel never
  // showed. That is the one thing this backend must not do, so an absent
  // storage path fails closed rather than falling back.
  if (deps.storagePath === undefined || deps.storagePath === "") {
    return disabled(
      "no-storage-path",
      "Function generation is disabled: the Claude Code backend has no product-owned directory to run in. FIM tab-completion still works.",
    );
  }
  // The neutral-cwd invariant is only as strong as its weakest input. A
  // relative path resolves against the extension host's cwd - the user's
  // workspace, for a `code .` launch - so it is refused here rather than
  // trusted to the one caller that happens to pass an absolute one.
  if (!path.isAbsolute(deps.storagePath)) {
    return disabled(
      "cwd-unusable",
      `Function generation is disabled: the Claude Code backend needs an absolute working directory and was given ${deps.storagePath}. FIM tab-completion still works.`,
    );
  }

  const run = deps.run ?? probeCommandRunner(CLAUDE_VERSION_TIMEOUT_MS);
  const binary = await resolveClaudeBinary(run);
  if (binary === undefined) {
    return disabled(
      "binary-missing",
      "Function generation is disabled: the Claude Code backend needs the `claude` CLI on PATH. FIM tab-completion still works.",
    );
  }

  // `recursive` because the global-storage parent itself may not exist yet: VS
  // Code does not materialize that directory until something writes to it, so a
  // genuine first run has neither level. A creation that throws (a read-only
  // profile, a permissions problem) fails the tier CLOSED rather than escaping
  // the build: this call sits inside the service rebuild that every settings
  // change triggers, and an exception there takes fn-gen down with no message.
  const cwd = path.join(deps.storagePath, CLAUDE_CWD_DIR);
  try {
    (deps.ensureDir ?? ((dir: string) => fs.mkdirSync(dir, { recursive: true })))(cwd);
  } catch (err) {
    // `String(err)` put an `Error:` envelope at the detail position, which is
    // the internal jargon every sibling message in the product now keeps out
    // (roadmap item 63, third string). The message stays WHOLE here: the tier
    // message is what the channel gets, and `tierDisabledToast` is what shortens
    // it for the notification.
    return disabled(
      "cwd-unusable",
      `Function generation is disabled: the Claude Code backend could not create its working directory ${cwd} (${err instanceof Error ? err.message : String(err)}). FIM tab-completion still works.`,
    );
  }

  // The child's hard timeout comes from the frontier cell of the budget
  // profile (this transport IS the claude-code provider, so the class needs no
  // guessing). The language is unknown at service build, so the base cell
  // serves; today no cell moves timeoutMs at all.
  const generateFn = makeClaudeCodeInstruct({
    cwd,
    binary,
    log,
    timeoutMs: budgetProfileFor(modelClassFor(CLAUDE_CODE, config.model), "", injectedContextStop()).timeoutMs,
  });
  // The label says what the CLI will actually be told, not what the setting
  // holds: a setting still reading the local ollama tag means no --model
  // reaches the CLI at all, and evidence naming an ollama tag as the server of
  // a round no ollama served is a lie the measurement rig would inherit. The
  // service carries it so the fn-gen and repair lines agree with the carve
  // line; `claudeModelLabel` owns the rule so it is not spelled twice.
  const model = claudeModelLabel(config.model);
  const service = new FnGenService(config, generateFn, log, model);
  log(`[carve] tier=claude-code model=${model} fnGen=enabled`);
  return { service, tier: { id: "claude-code", fnGenEnabled: true, provisional: false }, config };
}

/** The empty product-owned directory the CLI is spawned in, under the
 *  extension's global storage. Named rather than inlined because phase 3's docs
 *  and the human's own inspection both need to point at it. */
const CLAUDE_CWD_DIR = "claude-cwd";

/**
 * The name that actually spawns the CLI on this host, or undefined when it is
 * not installed. `claude --version` needs no login and makes no network call,
 * so it separates "not installed" from "not logged in" without spending a token
 * of quota. Never throws: either failure reads as absent.
 *
 * Windows needs the candidate list. A bare `spawn` resolves `.exe` but not
 * `.cmd`, and an npm-installed Claude Code lands as `claude.cmd` - so probing
 * only "claude" would tell a Windows user with a perfectly working CLI that
 * they need to install it, which is the dishonest-message failure this backend
 * keeps refusing to ship. The resolved name is handed to the module rather than
 * re-derived, so the probe and the round always agree on which binary they mean.
 */
async function resolveClaudeBinary(run: ProbeCommandFn): Promise<string | undefined> {
  const candidates = process.platform === "win32" ? ["claude.cmd", "claude.exe", "claude"] : ["claude"];
  for (const candidate of candidates) {
    try {
      if ((await run(candidate, ["--version"])).exitCode === 0) {
        return candidate;
      }
    } catch {
      // Not spawnable under this name; try the next.
    }
  }
  return undefined;
}

/** Test seams for registerFnGen: injectable probe and service build so the
 *  tier-gate oracles run without host hardware or a live server. */
export interface FnGenDeps {
  probeOpts?: ProbeHardwareOptions;
  buildService?: typeof buildFnGenService;
  /** The in-flight registry that owns the status-bar item and the cancel
   *  command's targets. Injectable so a headless oracle can read what the item
   *  says without a real status bar; defaults to a real one. */
  inFlight?: InFlightRegistry;
  /** The post-accept oracle, injectable so the manual repair command's wiring
   *  (the ctx it builds) is testable without a live cargo check. Defaults to
   *  the real runPostAcceptOracle. */
  runOracle?: typeof runPostAcceptOracle;
  /** Server-reachability probe for the manual repair pre-flight, injectable so
   *  the down-server path is testable without a live daemon. Defaults to the
   *  real listModels (undefined return = server unreachable). */
  listModels?: typeof listModels;
  /** The `ollama --version` PATH check for startOllamaTerminal (default: real
   *  spawn), injectable so the server-down consent path is testable without a
   *  host ollama. */
  ollamaCheck?: ProbeCommandFn;
  /** Host seams for the Claude Code backend. `storagePath` defaults to the
   *  extension's own global storage; the oracles override it (and the PATH
   *  probe) so they never need a host `claude` or spend subscription quota. */
  claudeCode?: FnGenBackendDeps;
}

// The post-accept check + repair runs non-blocking (a hiccup must never break
// the accept), so the human otherwise gets no signal that a fix is coming. Show
// a status-bar spinner for the life of the flow: informative, never blocking.
// Defensive for headless stubs that do not implement setStatusBarMessage.
function withVerifyStatus(p: Promise<void>): Promise<void> {
  // A Window-location progress shows an animated spinner in the status bar,
  // which reads as "work is happening" far better than a plain status message.
  // Non-blocking: the human keeps editing while the check and any repair run.
  if (typeof vscode.window.withProgress === "function" && vscode.ProgressLocation) {
    void vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Column 80: verifying generated code…" },
      () => p,
    );
  } else if (typeof vscode.window.setStatusBarMessage === "function") {
    vscode.window.setStatusBarMessage("$(sync~spin) Column 80: verifying generated code…", p);
  }
  return p;
}

// Round-1 pre-fill budget. The three caps that used to live here as module
// constants (PREFILL_TYPE_CAP / PREFILL_RESOLVE_CAP / PREFILL_PROVENANCE_CAP)
// moved to core/budgetProfile.ts with the context dial:
// they are three of the six numbers ONE stop resolves, and a per-language table
// beside a per-stop table is two places for the same decision.
//
// The type cap keeps the relevant few (prioritized below) inside a bounded
// prompt; the member cap stops a wide struct/enum from flooding the surface.
// Both truncations are LOGGED, never silent.
//
// THE ONE BLOCK IN THIS FILE whose content the product composes itself: the
// import hint is `use path::Name;` lines built from resolved type names and
// module paths, so no line of it can open a fence run. Every other block here
// wraps LSP or repository text and takes `fenceFor` instead.
const FENCE = "```";

// THE 2-D BOUND for the generate-time recursive data-shape walk AT THE SHIPPED
// STOP. D_MAX reaches the pillar case (order.customer.address.city, a depth-2
// node); N_MAX=6 is the OUTER HARD GUARD dominating the geometric blow-up;
// TOK_MAX is the profile's derived walk bound (two thirds of the aggregate
// budget, 200 at identity), sitting under the ~350-token codegen knee as the
// data-shape slice. The bound is proven pure in dataShape.ts.
//
// STILL A MODULE CONSTANT, in exactly this text, on purpose. The measurement
// rig rewrites this literal (lib-core's WIDE_PATCHES and loadPrefillBudget,
// both by exact text match) and review-v46-p0 pins that the patch site is
// still there. Every stop above `shipped` derives its bound from the resolved
// profile instead - see `fnGenProfileFor` - and the `shipped` row of the stop
// table is pinned against these three numbers by the phase-1 unit suite.
const DATASHAPE_BOUNDS: WalkBounds = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: walkTokMaxFor(DATASHAPE_TOTAL_TOK) };

// The gather bound for the cross-file resolver, AT THE SHIPPED STOP. It builds
// the graph (crossing files/crates via definition()); walkDataShape then EMITS
// within the full 2-D DATASHAPE_BOUNDS. D_MAX matches so the gather reaches
// every type the walk can emit; N_MAX is generous so the gather never
// under-collects before the walk's own N_MAX/B_MAX/TOK_MAX cap it.
//
// IT HAD TO JOIN THE DIAL. This is the gather that FEEDS the walk, so a stop
// that raises the walk's total-type cap to 192 against a gather that stops
// collecting at 12 is a stop whose extra types do not exist - the same
// inert-number trap the stop table's own comment describes, one stage upstream.
// The margin the shipped pair carries (12 against the walk's 6) is what
// `fnGenProfileFor` below preserves at every stop; the literal stays for the
// rig's `N_MAX: 12 }` patch site.
const CROSS_FILE_BOUND: CrossFileBound = { D_MAX: DATASHAPE_BOUNDS.D_MAX, N_MAX: 12 };
/** How much wider the gather runs than the walk it feeds: SIX MORE TYPES, which
 *  is exactly the shipped pair (6 + 6 = 12).
 *
 *  ADDITIVE, NOT MULTIPLICATIVE, and the difference is a language-server bill
 *  the developer never asked for. Each gathered type costs a `definition()`, a
 *  hover, a file open and a `documentSymbol` - real round trips, spent per
 *  candidate root. The first cut wrote the shipped pair as a 2x FACTOR, which
 *  reads the same at 6 and diverges hard above it: the install default's gather
 *  went 12 -> 48 and `frontier` reached 384, so every existing user paid roughly
 *  8x the round trips on upgrade for a default they never chose (measured:
 *  148 -> 1160 extractor calls for one 20-candidate gesture). A 2x margin over
 *  192 emitted types buys nothing the walk can use; six spare slots is what the
 *  margin was ever expressing - room for a gather that collects a type the walk
 *  then declines to emit. */
const CROSS_FILE_GATHER_MARGIN = 6;

// The AGGREGATE data-shape budget across ALL per-type walks in ONE
// prefill. resolvePrefill runs up to PREFILL_TYPE_CAP independent walks; without
// an aggregate the per-prompt data-shape total would be ~4xTOK_MAX (past the
// ~350-token codegen knee) and a shared nested type would emit per walk. Threading
// ONE shared budget + visited-set across the walks bounds the PER-PROMPT total.
//
// The number itself, its C# factor (CS_BUDGET_FACTOR x the rig knob - measured
// over 465 authored-doc C# rows, see the factor's own comment) and every value
// derived from it live in core/budgetProfile.ts now, so the walk, the repair
// side and the profile cannot drift. Imported back here because this file is
// where they are spent.

// The prefill resolution/emission budget, as a profile so fn-gen and test-gen can
// differ without either reaching into the other's constants.
interface PrefillProfile {
  crossFile: CrossFileBound;
  dataShape: WalkBounds;
  totalTok: number;
  /** Per-type member cap for the blocks this profile renders. The shared
   *  MEMBER_CAP at identity; resolvePrefill's effective fn-gen profile carries
   *  the budget profile's derived value so a moved cell reaches the renderers. */
  memberCap: number;
  /** Also surface each nested type's CONSTRUCTOR signatures (not just the root's
   *  methods), so a type with a private field is built via its `::new` rather than
   *  a struct literal that will not compile. */
  constructors: boolean;
}

// fn-gen: the tuned bound. It CALLS methods on an existing value
// (order.customer.address.city), so depth 2 and the root's own methods suffice.
// Exported so a harness renders a block against the SHIPPING budget instead of a
// re-derived one; a re-derived mapping has already inverted one measurement in
// this project.
export const FNGEN_PROFILE: PrefillProfile = {
  crossFile: CROSS_FILE_BOUND,
  dataShape: DATASHAPE_BOUNDS,
  totalTok: DATASHAPE_TOTAL_TOK,
  memberCap: MEMBER_CAP,
  constructors: false,
};

/** The fn-gen profile as the ACTIVE model class's budget cell and the ACTIVE
 *  context stop serve it: the aggregate budget, the per-walk bound, the member
 *  cap and the four structural numbers all come from `budgetProfileFor`,
 *  everything else from FNGEN_PROFILE. At the `shipped` stop every field
 *  equals FNGEN_PROFILE's, byte for byte.
 *
 *  THE SHIPPED STOP READS THE MODULE CONSTANTS rather than the table's copy of
 *  their values. That is what keeps the measurement rig's textual patches
 *  (DATASHAPE_BOUNDS, CROSS_FILE_BOUND) reaching a live prompt; the table's
 *  `shipped` row is pinned against the constants by the unit suite so the two
 *  cannot drift apart in silence.
 *
 *  test-gen keeps TESTGEN_PROFILE untouched - its numbers were chosen for
 *  construction, and no measurement has ever been taken against that gesture
 *  at any stop.
 *
 *  EXPORTED for the measurement rig's arm guard, which asks this function what
 *  the profile in force actually is and refuses to run an arm whose textual
 *  patch did not reach it (lib-core's `assertArmBinds`). The alternative is the
 *  rig re-deriving the mapping, which has inverted a result in this project
 *  before. */
export function fnGenProfileFor(budget: BudgetProfile): PrefillProfile {
  const shipped = budget.stop === "shipped";
  return {
    ...FNGEN_PROFILE,
    crossFile: shipped
      ? CROSS_FILE_BOUND
      : { D_MAX: budget.depth, N_MAX: budget.totalTypes + CROSS_FILE_GATHER_MARGIN },
    dataShape: shipped
      ? { ...FNGEN_PROFILE.dataShape, TOK_MAX: budget.walkTokMax }
      : { D_MAX: budget.depth, B_MAX: budget.breadth, N_MAX: budget.totalTypes, TOK_MAX: budget.walkTokMax },
    totalTok: budget.surfaceBudgetTok,
    memberCap: budget.memberCap,
  };
}

/** How many ROOT candidates one pre-fill may inject, for this language at this
 *  stop. The stop's `rootCap` everywhere except the `shipped` replay point,
 *  where a language that shipped its own cap gets it back (Go's 8; see
 *  `PrefillLang.shippedRootCap`).
 *
 *  ONE function, exported, because two callers must agree on it: the admission
 *  loop spends it and the measurement rig's arm guard checks the arm's patch
 *  reached it. A rig that re-derived this would be a re-derived mapping, which
 *  has inverted a result in this project before. */
export function prefillRootCap(languageId: string, budget: BudgetProfile): number {
  const lang = prefillLangFor(languageId);
  return budget.stop === "shipped" ? (lang.shippedRootCap ?? budget.rootCap) : budget.rootCap;
}

/**
 * THE P8 CHANNEL LINE: what the stop in force bought, once per fn-gen - and
 * only what it bought FOR THIS LANGUAGE.
 *
 * The dial's six numbers do not all reach all five languages. Go and Python
 * render member SIGNATURES and nothing else, and their gathers have no edges to
 * follow, so depth, breadth and the total-type cap are structurally dead there;
 * C# has no data-shape walk, so breadth is dead for it too. A line reading
 * `breadth=12 types=48` on a Go gesture tells a developer they bought something
 * they did not, and a channel that does that is worse than a silent one -
 * this project reads its own channel as evidence.
 *
 * The inert numbers are named as CONCEPTS and never as VALUES. Printing
 * `breadth=48 (inert)` still puts a number a reader can quote next to a stop
 * they chose. Making those renderers walk data shapes is a different session;
 * this is the honesty half.
 */
/**
 * THE FAN-OUT CAP'S OWN DROP LINE, and it is Python's ship condition.
 *
 * A member whose signature the hover fan-out could not buy comes back bare, and
 * `renderMemberSignatures` drops a bare member — so the block ships a SUBSET of
 * the type's members under a header saying "use these exact names, do not
 * invent", and a reader cannot tell that from a type with fewer members.
 *
 * The walk has always named the TYPES it dropped. This is the same promise one
 * level down, for the members of a type it kept. It names which cap did it,
 * because the two point at different dials: `count` is the per-type ask limit,
 * `budget` is the fan-out's wall clock.
 *
 * Silent on a type that lost nothing, so it costs a clean gesture no bytes.
 */
function cappedMemberLine(type: string, derived: DerivedType): string | undefined {
  const capped = derived.cappedMembers ?? [];
  if (capped.length === 0) {
    return undefined;
  }
  const by = (cause: string) => capped.filter((c) => c.cause === cause).map((c) => c.name);
  const parts = [
    `count cap: ${by("count").join(", ")}`,
    `fan-out budget: ${by("budget").join(", ")}`,
    // The third cause exists so this line points at the right dial. A member
    // whose hover answered instantly with text the language's builder refused is
    // not a budget problem, and a reader sent to the fan-out clock for it is
    // sent to the wrong place (v49 S49-13).
    `refused reply: ${by("unusable").join(", ")}`,
  ].filter((p) => !p.endsWith(": "));
  return (
    `[fngen] pre-fill could not sign ${capped.length} member(s) of \`${type}\`, so they are ABSENT ` +
    `from its block rather than bare (${parts.join("; ")})`
  );
}

function contextStopLine(lang: PrefillLang, budget: BudgetProfile, rootCap: number): string {
  const walks = lang.dialReach === "walk";
  const binds = [`stop=${budget.stop}`, `roots=${rootCap}`];
  if (walks) {
    binds.push(`breadth=${budget.breadth}`, `types=${budget.totalTypes}`);
  }
  binds.push(`budget=${budget.surfaceBudgetTok}tok`, `members=${budget.memberCap}`);
  const parenthetical = [
    ...(walks ? [`depth=${budget.depth}`] : []),
    `resolve cap=${budget.resolveCap}`,
    `provenance cap=${budget.provenanceCap}`,
  ];
  const head = `[fngen] injected context: ${binds.join(" ")} (${parenthetical.join(", ")})`;
  if (walks) {
    return head;
  }
  const why =
    lang.dialReach === "graph"
      ? `it has no data-shape walk, and the shared budget cuts its collaborator graph off before ` +
        `the gather's own caps can bite`
      : `it renders member signatures only, with no data-shape walk and no graph edges, so the ` +
        `budget reaches it through the member cap alone`;
  return `${head}; breadth, total types and depth buy nothing in this language - ${why}`;
}

/**
 * The aggregate data-shape budget in force: the LANGUAGE's own when it declares
 * one AND the gesture is fn-gen, else the gesture profile's shared value.
 *
 * A separate exported function rather than an inline `??` because the whole risk
 * of a per-language budget is that it looks wired and is not - a silent fallback
 * to the global reads as "the budget was not the lever after all", which is a
 * flat arm with a plausible story attached. This is the one line that decides it,
 * so it is the one line a test can bind.
 *
 * `forConstruction` IS NOT OPTIONAL POLISH. The adversarial review caught the
 * first version preferring the language's number over the GESTURE's, which made
 * C# test-gen fall 500 -> 300 tokens the moment C# declared a budget - 58% of the
 * callee surface gone from the `generateTests` prompt, three blocks dropped, and
 * the FIRM instruction's ONLY-list cut from three names to one. That is a live
 * product regression, not a measurement one, and it was invisible in an 8,107-row
 * suite.
 *
 * The rule is a scoping rule: C#'s number was measured on the FN-GEN funnel, so
 * it governs fn-gen. test-gen has its own profile, chosen for a different job
 * (constructing a whole nested input rather than calling into one), and no C#
 * measurement has ever been taken against it. A language may not silently
 * inherit authority over a gesture nobody measured it on.
 *
 * resolvePrefill resolves the language slot through the budget cell BEFORE
 * calling here: `budgetProfileFor`'s csharp leg already carries the language
 * exception, so the value arriving in `lang` is the resolved cell's and a moved
 * cell (CELL_OVERRIDES) reaches the walk.
 */
/** Does this candidate take the SHAPE path rather than the worked-example one?
 *
 *  Extracted so the member-floor pricing pass and the render loop cannot drift
 *  apart: a candidate priced but not rendered holds its share of the reserve for
 *  the whole prompt and starves everything behind it, and a candidate rendered
 *  but not priced spends a floor nobody reserved. One predicate, two callers.
 *
 *  The rule itself is unchanged: a library type whose hover is `{ /* private
 *  fields *\/ }` with no methods resolves to an EMPTY shape, and a stub for it
 *  points the model at a surface that does not exist, so it falls through. The
 *  `admitsEmptyShape` exception is a language's to grant and Rust's enum is the
 *  one kind that has earned it. */
function takesShapePath(lang: Pick<PrefillLang, "admitsEmptyShape">, derived: DerivedType | undefined): boolean {
  return (
    derived !== undefined &&
    (derived.methods.length > 0 || derived.fields.length > 0 || lang.admitsEmptyShape?.(derived) === true)
  );
}

export function prefillTotalTok(
  lang: Pick<PrefillLang, "dataShapeTotalTok">,
  profile: Pick<PrefillProfile, "totalTok">,
  forConstruction = false,
): number {
  if (forConstruction) {
    return profile.totalTok;
  }
  return lang.dataShapeTotalTok ?? profile.totalTok;
}

// test-gen: it must CONSTRUCT the whole nested input, not call into an existing
// one. Order->Customer->Address->Region is depth 3, so D_MAX=3 reaches the leaf
// struct (else a depth-3 type is invisible and gets hallucinated). N_MAX is wider
// so a deep descendant does not evict a shallow sibling under the BFS cap, and
// nested constructors are surfaced so a private-field type is built via `::new`.
const TESTGEN_PROFILE: PrefillProfile = {
  crossFile: { D_MAX: 3, N_MAX: 16 },
  dataShape: { D_MAX: 3, B_MAX: 4, N_MAX: 8, TOK_MAX: 300 },
  totalTok: 500,
  memberCap: MEMBER_CAP,
  constructors: true,
};

// A CLOSED surface: every name the type can answer to is in hand.
//
// A class's enumerated members never are - nested types, extension members,
// generic statics and partial declarations all add names the walk cannot see.
// An ENUM's variants are the whole set, and the hover the language server gave
// is what proves it (Rust `pub enum LodBand { ... }`, Roslyn and pyright `enum
// Atlas.LodBand`). Plus the ordinary conditions: the enumeration ran and nothing
// was capped away.
//
// Two callers, one definition on purpose. It decides what the repair gate may
// refuse against, and it decides what renders first when the shared budget is
// short: the surface the model can be held to is the surface it gets to see.
function isClosedSurface(derived: DerivedType | undefined, memberCap: number): boolean {
  return (
    derived !== undefined &&
    /\benum\b/.test(derived.signature) &&
    derived.methodsResolved &&
    derived.methods.length <= memberCap &&
    derived.methods.length + derived.fields.length > 0
  );
}

/** Is this Rust type's resolved signature a DECLARATION THAT IS ITS OWN
 *  SURFACE - an enum with variants, or a trait with a recovered item body?
 *
 *  The admission test behind `RUST_PREFILL_LANG.admitsEmptyShape`. It started
 *  as the enum, and was extended to the trait (whose members live in the
 *  SIGNATURE by construction - the recovery trigger only fires at
 *  methods === 0, so a recovered trait always reaches this gate empty-handed
 *  and the signature is the only place its surface can be) and to the
 *  type-alias line (the one form with no body to test - see the clause's own
 *  comment). A further self-describing form is one more clause here, not a
 *  second gate. Deliberately NOT
 *  `isClosedSurface`, which is a different question asked of a type that
 *  already rendered: this one is asked of a type with nothing rendered at all,
 *  so it cannot require members.
 *
 *  Two conditions, and the SECOND is what keeps the fastbloom bar intact.
 *
 *  1. A DECLARATION, not the word. The head must open a line, allowing the
 *     optional `pub`/`pub(crate)` (and `unsafe` for a trait) in front, and be
 *     followed by a name. A hover that merely contains "enum" somewhere - a
 *     struct wrapping one, a private-fields comment that mentions one - is not
 *     a declaration. That is not hypothetical: a struct whose private-fields
 *     comment names an enum matches a loose `\benum\s+\w+` and is precisely
 *     the empty-shape stub the gate exists to refuse.
 *  2. A BODY THAT NAMES AT LEAST ONE MEMBER. What this admission delivers is
 *     the member NAMES - variants for an enum, item signatures for a trait. A
 *     body with none carries nothing, so admitting one injects a header and a
 *     firm instruction closing a surface with no members - the same empty stub
 *     again, wearing the declaration's keyword. A bare trait head whose
 *     recovery REFUSED has no body at all and fails here too, which keeps the
 *     refusal honest end to end: it falls to the example leg exactly as it did
 *     before the recovery existed.
 *
 *     Comments are stripped before the test, and that is the whole point of the
 *     clause rather than a nicety. An enum whose hover body is only a
 *     private-fields comment is the fastbloom hazard verbatim, and a body that
 *     is only rust-analyzer's own
 *     elision marker is REACHABLE: `hover.show.enumVariants` is the user's
 *     setting, not ours, and at 0 the marker is the entire body. A test for
 *     non-blank text passes both.
 *
 *  The body test spans the whole signature rather than the head line, because a
 *  `where` clause puts the brace three lines down and 36 of the corpus's injected
 *  enums are that shape.
 *
 *  Condition 1 is empirically equivalent, over all 237 acme rows, to the
 *  looser `/\benum\s/` the arm measured: identical admissions,
 *  identical injected bytes. Condition 2 costs nothing on the same corpus - it
 *  holds zero rows back. Both ship because they were measured to agree with the
 *  arm, not instead of it.
 *
 *  What this does NOT promise: that the variant list is COMPLETE. rust-analyzer
 *  cuts it at five and the product injects the cut text verbatim, which is
 *  not this predicate's to fix. */
function isSelfDescribingDeclaration(derived: DerivedType): boolean {
  const sig = derived.signature;
  // A TYPE-ALIAS line (tier 1 of the v41 alias work): `type X = RHS` is its
  // own whole surface - one line, nothing braced behind it - so the admission
  // is the declaration shape alone: the `=` with a non-blank RHS. A bodiless
  // `type X;` (an unassigned assoc type in some hover) carries nothing and
  // stays refused. The alias tells the model what the name MEANS, which is
  // the entire payload for a std/external target and the header line for a
  // chased project target.
  if (/(?:^|\n)[ \t]*(?:pub[ \t]*(?:\([^)]*\)[ \t]*)?)?type[ \t]+[A-Za-z_][^=\n]*=[ \t]*\S/.test(sig)) {
    return true;
  }
  if (
    !/(?:^|\n)[ \t]*(?:pub[ \t]*(?:\([^)]*\)[ \t]*)?)?(?:enum|(?:unsafe[ \t]+)?trait)[ \t]+[A-Za-z_]/.test(
      sig,
    )
  ) {
    return false;
  }
  const open = sig.indexOf("{");
  const close = sig.lastIndexOf("}");
  if (open === -1 || close <= open) {
    return false;
  }
  const body = sig
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  return /[A-Za-z_]/.test(body);
}

// The struct/enum/union definitions at module scope (column 0), name -> the
// cursor at the type name (the anchor membersOfType/hoverSurface resolve at).
// Only these keywords are the containers membersOfType enumerates; a local `fn`
// or `const` is NOT a type and must never be anchored (it would inject the
// target function's own "members"). Intersected with `localDefs` (comment/string
// -neutralized) so a `struct Foo` living only in a comment never anchors.
function localTypeDefinitions(
  source: string,
  localDefs: Set<string>,
): Map<string, { line: number; character: number }> {
  const defs = new Map<string, { line: number; character: number }>();
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "" || /^\s/.test(line)) {
      continue; // module scope only
    }
    const m = /^(?:pub\s*(?:\([^)]*\))?\s+)?(?:struct|enum|union)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (m && localDefs.has(m[1]) && !defs.has(m[1])) {
      defs.set(m[1], { line: i, character: m[0].length - m[1].length });
    }
  }
  return defs;
}

// The prioritized, deduped candidate type list: signature-named first, then
// doc-named (incl. a doc-only LOCAL type the signature never references), then
// use-mined ambient types LAST. The budget slice is applied to THIS order, so a
// relevant local type is never starved by ambient `use` imports.
// Exported for the impl oracle, the way the other four language variants are.
/** The names the SIGNATURE's own generic parameter list DECLARES.
 *
 *  A declared parameter has no definition to resolve. It spends a language-server
 *  round trip, comes back with nothing, and under a cap that binds it evicts a
 *  real type: `fn go<T, U>(x: T, y: U) -> Widget` put `T` and `U` in front of
 *  `Widget`.
 *
 *  KEYED ON THE DECLARATION, NEVER ON THE NAME'S SHAPE, and both halves of that
 *  are load-bearing.
 *
 *  Refusing lone capitals instead would be both too narrow and too wide. Too
 *  narrow: the corpus declares `fn request_sync_two_phase<C, S, T, Fut2>`, and
 *  `Fut` and `Fut2` are parameters no lone-capital rule can see. Too wide: a lone
 *  capital is a legitimate Rust type name, and `test/blind-v7-prepare.test.cjs`
 *  P3 pins a real `pub struct T` surviving this budget.
 *
 *  A declaration also SHADOWS. When a file declares `pub struct T` and a function
 *  declares `<T>`, the `T` in that signature is the parameter, so the declaration
 *  beats the local type set rather than deferring to it.
 *
 *  Reads the parameter list only, not the `where` clause: valid Rust must declare
 *  a parameter in `<...>` before constraining it, so the clause adds no names.
 *  Its trait bounds are deliberately left alone - `where F: Into<Gadget>` still
 *  yields `Into` and `Gadget`, which are real types this refusal has no business
 *  touching. */
function declaredGenericParams(signature: string): Set<string> {
  const out = new Set<string>();
  // The list attached to the FUNCTION name. Anchored there so a return type's
  // own generic arguments (`-> Vec<Widget>`) are never read as declarations.
  const head = /\bfn\s+[A-Za-z_][A-Za-z0-9_]*\s*</.exec(signature);
  if (!head) {
    return out;
  }
  let depth = 0;
  let end = -1;
  const from = head.index + head[0].length - 1;
  for (let i = from; i < signature.length; i++) {
    const c = signature[i];
    if (c === "<") {
      depth++;
    } else if (c === ">") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    return out;
  }
  // Top-level commas only: `<T: Into<A, B>, U>` declares T and U, not A and B.
  let part = "";
  let d = 0;
  const takePart = (p: string): void => {
    const t = p.trim();
    if (t === "" || t.startsWith("'")) {
      return; // a lifetime is not a type
    }
    // `const N: usize` declares the VALUE N, which is not a type either, but it
    // is still a name the signature declares and still resolves to nothing.
    const m = /^(?:const\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(t);
    if (m) {
      out.add(m[1]);
    }
  };
  for (let i = from + 1; i < end; i++) {
    const c = signature[i];
    if (c === "<" || c === "(" || c === "[") {
      d++;
    } else if (c === ">" || c === ")" || c === "]") {
      d--;
    }
    if (c === "," && d === 0) {
      takePart(part);
      part = "";
      continue;
    }
    part += c;
  }
  takePart(part);
  return out;
}

/** The generic parameters declared by the impl ENCLOSING the target function.
 *
 *  `declaredGenericParams` reads the fn's own `<...>`, but a method inside
 *  `impl<E, V, D> Holder<E, V, D>` uses E, V and D in its signature WITHOUT
 *  declaring them there - the signature text alone cannot tell them from real
 *  single-capital types, so they reach the candidate list, resolve to their
 *  own parameter chrome, and render junk blocks (measured: E/V/D reached the
 *  example leg down exactly this shape).
 *
 *  The enclosing impl is decided by SCOPE, not recency: over the
 *  comment/string-scrubbed source (offsets preserved), an `impl<...>` header
 *  encloses the fn iff its brace block opens before the signature and closes
 *  after it. The innermost such header wins. Scrubbing first is what keeps a
 *  `"{"` string literal in a CLOSED sibling impl from inflating a balance
 *  (adversarial E4), and the containment test is what keeps a closed
 *  `impl<U>` inside an earlier method's body from shadowing the real
 *  enclosing header (adversarial E5). No enclosing impl means no refusal, so
 *  blind-v7 P3's module-scope `pub struct T` is untouched. */
function enclosingImplGenericParams(fullText: string, signature: string): Set<string> {
  const out = new Set<string>();
  const at = fullText.indexOf(signature);
  if (at === -1) {
    return out;
  }
  const scrubbed = scrubRust(fullText);
  // The innermost <...> span among headers whose block contains `at`. Headers
  // are visited in order, and a nested enclosing impl always starts later
  // than the one it sits inside, so the last hit is the innermost.
  let params: { open: number; close: number } | undefined;
  for (const h of scrubbed.matchAll(/(?:^|\n)[ \t]*impl\s*</g)) {
    const lt = h.index + h[0].length - 1;
    if (lt >= at) {
      break;
    }
    let depth = 0;
    let gt = -1;
    for (let i = lt; i < at; i++) {
      const c = scrubbed[i];
      if (c === "<") {
        depth++;
      } else if (c === ">" && scrubbed[i - 1] !== "-" && scrubbed[i - 1] !== "=") {
        depth--;
        if (depth === 0) {
          gt = i;
          break;
        }
      }
    }
    if (gt === -1) {
      continue;
    }
    // The block's `{`: first one at bracket depth 0 past the generics (the
    // self-type's own generic args and a where-clause sit between).
    let d = 0;
    let open = -1;
    for (let i = gt + 1; i < at; i++) {
      const c = scrubbed[i];
      if (c === "<" || c === "(") {
        d++;
      } else if (c === ">" && scrubbed[i - 1] !== "-" && scrubbed[i - 1] !== "=") {
        d = Math.max(0, d - 1);
      } else if (c === ")") {
        d = Math.max(0, d - 1);
      } else if (c === "{" && d === 0) {
        open = i;
        break;
      }
    }
    if (open === -1) {
      continue;
    }
    let braces = 0;
    let close = -1;
    for (let i = open; i < scrubbed.length; i++) {
      if (scrubbed[i] === "{") {
        braces++;
      } else if (scrubbed[i] === "}") {
        braces--;
        if (braces === 0) {
          close = i;
          break;
        }
      }
    }
    if (close > at) {
      params = { open: lt, close: gt };
    }
  }
  if (params === undefined) {
    return out;
  }
  // Same segment reading as the fn-level list: depth-0 commas, lifetimes are
  // not types, `const N` declares the value N.
  let part = "";
  let d = 0;
  const takePart = (p: string): void => {
    const t = p.trim();
    if (t === "" || t.startsWith("'")) {
      return;
    }
    const m = /^(?:const\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(t);
    if (m) {
      out.add(m[1]);
    }
  };
  for (let i = params.open + 1; i < params.close; i++) {
    const c = scrubbed[i];
    if (c === "<" || c === "(" || c === "[") {
      d++;
    } else if (c === ">" || c === ")" || c === "]") {
      d--;
    }
    if (c === "," && d === 0) {
      takePart(part);
      part = "";
      continue;
    }
    part += c;
  }
  takePart(part);
  return out;
}

/** Imported names whose ONLY appearance in the file is inside a `#[derive(...)]`.
 *
 *  `Serialize`, `Deserialize`, `Decode`, `Encode`, `DeepSizeOf` and friends reach
 *  the candidate list through the ambient-import leg, resolve to a trait the
 *  target never calls, and spend a slot each. 26 of the corpus's zero-byte
 *  injections are this class.
 *
 *  A MECHANISM, not a name list, because a name list rots and this one would have
 *  to grow for every crate a developer adds. The test is what the file itself
 *  says: the name is imported, and every other place it occurs is a derive
 *  attribute. A trait the code actually NAMES anywhere else - a bound, a manual
 *  `impl`, a turbofish - fails the test and stays a candidate.
 *
 *  Applied to the USE leg alone. A developer who backticks `Serialize` in a doc
 *  comment has asked for it, and this product already ranks an explicit gesture
 *  above anything it inferred. */
const DERIVE_MACRO_TRAITS: ReadonlySet<string> = new Set([
  "Serialize",
  "Deserialize",
  "Decode",
  "Encode",
  "DeepSizeOf",
]);

function deriveOnlyImports(fullText: string): Set<string> {
  // Candidates: the five measured names, plus anything this file actually
  // derives. The five are seeded rather than discovered because the mechanism
  // needs a `#[derive(...)]` in THIS file and the dominant corpus shape has
  // none - the import sits in a file whose derives are on types declared
  // elsewhere, or behind a macro. They are 26 of the zero-byte injections alone.
  const candidates = new Set<string>(DERIVE_MACRO_TRAITS);
  // `derive(...)` wherever it appears, which includes inside `cfg_attr`. Matching
  // the bare `derive(` rather than `#[derive(` is what reaches
  // `#[cfg_attr(feature = "x", derive(Serialize))]`, and that form is common
  // enough in real crates that missing it makes the rule look arbitrary.
  const deriveList = /\bderive\(([^)]*)\)/g;
  for (const m of fullText.matchAll(deriveList)) {
    for (const n of m[1].split(",")) {
      const t = n.trim().replace(/^.*::/, "");
      // IDENTIFIERS ONLY, and this guard is not tidiness. The name goes into a
      // RegExp below, so a derive holding `*`, `(` or a `format!` template
      // (`#[derive({0})]` in codegen, or a trybuild ui fixture) threw a
      // SyntaxError straight out of candidate finding, on the
      // `column80.generateFunction` path, with nothing catching it.
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) {
        candidates.add(t);
      }
    }
  }
  // The file with every derive list and every `use` STATEMENT blanked, so what
  // is left is the name's other occurrences. Statements, not lines: rustfmt wraps
  // a grouped import one name per line and only the first starts with `use`, so a
  // line filter left `Arbitrary,` visible and read it as real use of the trait.
  const rest = fullText
    .replace(deriveList, " ")
    .replace(/^[ \t]*(?:pub[ \t]*(?:\([^)]*\)[ \t]*)?)?use\b[^;]*;/gm, " ")
    .replace(/^[ \t]*(?:pub[ \t]*(?:\([^)]*\)[ \t]*)?)?use\b[\s\S]*?;/gm, " ");
  const out = new Set<string>();
  for (const name of candidates) {
    // A trait the code NAMES anywhere else - a manual `impl Encode for Widget`, a
    // bound, a turbofish - is one the target may really have to call, so it stays
    // a candidate. That applies to the seeded five as well: hard-coding a name
    // list and then refusing it unconditionally would delete a real project trait
    // that happens to share a name with a popular derive.
    if (!new RegExp(`\\b${name}\\b`).test(rest)) {
      out.add(name);
    }
  }
  return out;
}

export function prioritizedTypes(
  signature: string,
  docComment: string | undefined,
  fullText: string,
  localTypeNames: Set<string>,
  excludeName?: string,
  spanText = "",
): string[] {
  // Three classes of name that cost a resolve round trip and
  // a cap slot and can never repay either. Refused HERE, at candidate finding,
  // rather than at render: the budget is spent on this list, so a name filtered
  // downstream has already evicted a real type. Together they free about 56 slots
  // across the 237-row corpus.
  //
  // Cheap and obviously right, NOT expected to move the compile rate. The cap arm
  // already showed that freeing supply does not convert: widening the cap from 4
  // to 12 cut "the needed type was evicted" from 120 rows to 52 and moved the rate
  // 0.8 points, inside the noise floor.
  const declared = declaredGenericParams(signature);
  // The enclosing impl's params too: a method's signature USES them without
  // declaring them, and a bare type variable is a category error as a
  // candidate whichever scope declared it.
  for (const p of enclosingImplGenericParams(fullText, signature)) {
    declared.add(p);
  }
  const deriveOnly = deriveOnlyImports(fullText);
  const refused = (n: string): boolean => declared.has(n) || isAllCapsConstant(n);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (names: string[], alsoRefuse?: ReadonlySet<string>) => {
    for (const n of names) {
      if (!seen.has(n) && !refused(n) && alsoRefuse?.has(n) !== true) {
        seen.add(n);
        out.push(n);
      }
    }
  };
  // typesNamedIn yields signature PascalCase (tier: signature) then doc-backticked
  // (tier: doc). referencedLocalSymbols adds a doc-only local type named by a bare
  // PascalCase word the backtick scan misses (`CohortRegister` / `T` in prose).
  push(typesNamedIn(signature, docComment, excludeName));
  // The backticked names in the span's own comments. BELOW
  // the doc, unlike the repair ordering, and for the reason the manual states:
  // in fn-gen the doc comment is the instruction and the body sketch is the plan
  // for carrying it out. In repair the span is failing evidence and the doc is
  // the older claim, so there the two swap.
  //
  // ABOVE both remaining tiers, and the second one is a real trade. Over the
  // ambient imports, because a name the developer wrote down beats one the file
  // happens to import. But also over `referencedLocalSymbols`, so four backticked
  // comment names evict a type this file is KNOWN to define once
  // `PREFILL_TYPE_CAP` binds. That is intended: the backtick is an explicit
  // gesture and the local-symbol leg is a heuristic over prose, and this product
  // ranks the thing the developer asked for above the thing it guessed.
  push(commentTypesIn(spanText, "rust", excludeName, prefillStopNamesFor("rust")));
  push(referencedLocalSymbols(signature, docComment, localTypeNames));
  push(typesFromUses(fullText), deriveOnly);
  return out;
}

/**
 * One prefill's rendered surface, WITH the handle the window arbitration needs.
 *
 * A shrink is not a substring operation: dropping a type block also narrows the
 * payload's own "only these types" instruction, so the smaller surface has to be
 * RE-RENDERED rather than sliced. `keep` is that re-render, and it is a function
 * rather than a pre-computed table because the overwhelmingly common case fits
 * at full size and must not pay for a single one of them.
 */
/**
 * What one pre-fill DID, as a record rather than as channel prose.
 *
 * The tighten command has to answer a question no existing hook answers: would
 * backticking this name change the injected set, or evict something for nothing?
 * `onDisclosed` reports what rendered and is the repair gate's evidence; it says
 * nothing about the types a cap never looked at, which is exactly the population
 * a backtick can rescue. Every field below is already computed by the walk. This
 * is a read of it, not a second derivation.
 *
 * READ-ONLY BY CONSTRUCTION. The arrays are copies, so a consumer cannot mutate
 * the walk's own bookkeeping through them.
 */
export interface PrefillLedger {
  /** Type names whose own block rendered into the surface. Root, injected. */
  rendered: readonly string[];
  /** Every type name the prompt's walks EMITTED, root or not (`SharedWalkState.visited`).
   *  A name here already has its surface in the prompt without being a root. */
  visited: readonly string[];
  /** Candidates that spent a cap slot and rendered nothing, with the reason verbatim. */
  noBlock: readonly { type: string; reason: string }[];
  /** Candidates a cap never looked at. */
  notLookedAt: readonly string[];
  /** Types a walk dropped ENTIRELY, with the cap that did it. Never a name that
   *  also rendered: `droppedBy` holds a second, HELD-BACK class (a `member-floor`
   *  refusal withdraws a data shape while the member list stays), and the
   *  channel partitions the two a few lines from the hand-over. This field is
   *  the first partition only. */
  dropped: readonly { name: string; cause: string }[];
  /** The root cap in force for this language and stop. */
  typeCap: number;
  /** Slots spent. At or past `typeCap`, a new root displaces one. */
  admitted: number;
  /** The rendered surface, byte-identical to the return value. */
  surface: string;
}

/**
 * COMPILE-TIME ONLY, and it emits nothing.
 *
 * The delta gate that consumes this ledger is pure (`src/core/tightenClassify.ts`)
 * and `src/core/` never imports a module that imports `vscode`, so it redeclares
 * the shape as `PrefillLedgerView`. Two hand-kept copies of one record drift,
 * and the drift is invisible: a renamed field reads as `undefined` in the
 * classifier and every candidate silently becomes class 4. This assertion is
 * the pin. Both directions, so an addition on EITHER side is a build failure
 * HERE, next to the producer, rather than a wrong answer over there.
 *
 * THE MISMATCH BRANCH IS `false`, NOT `never`, and the first version of this got
 * it wrong. `never` is assignable to every type including `true`, so
 * `AssertTrue<never>` satisfies its own constraint and
 * a drifted shape compiled clean in both directions. A guard that cannot fail is
 * decoration. `test/impl-v52-p2-ledger.test.cjs` now drifts the shape in a copy
 * of the tree and asserts `tsc --noEmit` rejects it, in both directions, because
 * a guard nobody has watched fail is the same decoration one step later.
 */
export type PrefillLedgerMatchesView = PrefillLedger extends PrefillLedgerView
  ? PrefillLedgerView extends PrefillLedger
    ? true
    : false
  : false;
type AssertTrue<T extends true> = T;
export type PrefillLedgerViewIsPinned = AssertTrue<PrefillLedgerMatchesView>;

export interface PrefillSurface {
  /** The full surface - byte-identical to what `resolvePrefill` returned. */
  text: string;
  /** How many injected TYPE BLOCKS it carries: the droppable units. */
  blocks: number;
  /** The surface with only the first `keep` blocks. `undefined` when nothing is
   *  left to render, which is what zero injection looks like. */
  keep: (keep: number) => string | undefined;
}

/** Round-1 pre-fill: the surface injected BEFORE the first generation so the
 *  model calls real names first-pass (prevention beats repair). Unified onto
 *  the ONE cross-file resolver (src/core/crossFileShape.ts): each candidate
 *  type is anchored at a reference in the signature (or its `use` line) and
 *  resolved through `resolveCrossFileShape` — fields AND methods, from WHEREVER
 *  the type lives (any file, any crate). A type the resolver derives gets the
 *  SHAPE block (data-shape walk over the resolver's graph + its method list); a
 *  type it does not (a library type with a worked doc example) keeps the EXAMPLE
 *  block (no fastbloom regression). Candidates are prioritized by relevance and
 *  budget-capped with drop logging. Exported for the blind oracle. Degrades to
 *  undefined (v1 bytes) on no extractor or no resolvable surface; never throws. */
export async function resolvePrefill(
  extractor: SurfaceExtractor | undefined,
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
  log: (line: string) => void,
  // Test-gen only: when set, prepend a `use …;` import block for every resolved
  // collaborator, computed relative to this target file. fn-gen omits it — a
  // generated body lands in a file whose imports already exist, so an import hint
  // would only tempt the model to add one mid-body. `forConstruction` switches to
  // the deeper test-gen resolution profile (construct the whole nested input, not
  // call into an existing value). Absent => byte-identical to the fn-gen prefill.
  opts?: {
    importTargetPath?: string;
    forConstruction?: boolean;
    // The repair round's additions. All three absent
    // reproduce the fn-gen prefill byte for byte, which the frozen v7/v24
    // oracles pin.
    //
    // extraCandidates: the SPAN's types-in-play, merged in right behind the
    // receiver so the types the failing body names are never starved by ambient
    // `use` imports. omitInstruction: hand back the blocks bare, for a caller
    // closing several surfaces with one instruction. onDisclosed: what rendered
    // and how completely, which is the only evidence the repair gate may refuse
    // on.
    extraCandidates?: readonly string[];
    omitInstruction?: boolean;
    onDisclosed?: (types: DisclosedType[]) => void;
    // Candidates that arrive WITH the cursor their
    // declaration sits at. `typeReference` anchors a candidate by searching the
    // TARGET file's text, and the type that owns a chained call is named nowhere
    // in that file - so a bare name for it dies at "no anchor found". A cursor
    // here skips the search entirely. Absent reproduces the byte-for-byte
    // prefill, which the frozen oracles pin.
    extraCursors?: ReadonlyMap<string, SourceCursor>;
    // The context stop to spend, INSTEAD of the one the setting names. Absent
    // means the setting decides, which is every product call.
    //
    // It exists for the two callers that must pin a stop rather than read one:
    // a before/after arm that has to render the pre-dial prompt and the dial's
    // prompt from ONE bundle, and the suite rows that pin the rig's textual
    // patch sites behaviourally. Neither can go through the setting, because no
    // setting value resolves to `shipped`.
    contextStop?: ContextStop;
    // Hand the caller the surface AS A SHRINKABLE THING,
    // not just as a string, so the window arbitration can ask what it would
    // cost at a smaller size. Called once, with the finished surface, before
    // this function returns; absent (every other caller) changes nothing.
    onSurface?: (surface: PrefillSurface) => void;
    // The whole ledger, for the caller that has to decide
    // whether a proposed backtick is a delta or an eviction. Additive and read
    // by nobody else, so the surface bytes every existing caller receives are
    // unchanged. Called once, with the finished record, before this returns.
    onLedger?: (ledger: PrefillLedger) => void;
  },
): Promise<string | undefined> {
  if (!extractor) {
    return undefined;
  }
  const lang = prefillLangFor(resolved.languageId);
  // Read ONCE for this pre-fill. The admission loop below tests all three caps
  // per candidate and a config read in there would pay for freshness on every
  // iteration.
  const forConstruction = opts?.forConstruction === true;
  // TEST-GEN DOES NOT FOLLOW THE DIAL, and that is the whole budget, not just
  // TESTGEN_PROFILE's three fields. `column80.generateTests` spends its own
  // profile because it CONSTRUCTS a nested input rather than calling into one,
  // and no measurement has ever been taken against that gesture at any stop -
  // which applies to the ROOT cap exactly as much as it applies to the walk
  // bounds. Resolving the stop here and reading `rootCap` off it silently took
  // test-gen from 4 roots to 8 at the install default, on a gesture whose
  // channel deliberately prints no stop line to say so. The setting is not even
  // READ on that path: the answer must not be able to depend on it.
  const stop: ContextStop = forConstruction ? "shipped" : (opts?.contextStop ?? injectedContextStop(log));
  const budget = budgetProfileFor(fnGenModelClass(log), resolved.languageId, stop);
  const typeCap = prefillRootCap(resolved.languageId, budget);
  const profile = forConstruction ? TESTGEN_PROFILE : fnGenProfileFor(budget);
  // WHAT THE SETTING BOUGHT, on the channel, once per gesture - and only what
  // it bought FOR THIS LANGUAGE. See `contextStopLine`.
  //
  // test-gen is excluded because it is pinned above: a stop line on a gesture
  // that spends the shipped numbers whatever the setting says would describe a
  // dial that is not in force.
  if (!forConstruction) {
    log(contextStopLine(lang, budget, typeCap));
  }
  const fullText = document.getText();
  const localDefs = fileLocalDefinitions(fullText);
  // The same-file type defs (name -> def position). Kept in full (not just the
  // names) so a doc-only local type — one named in the doc but NOT the signature
  // or an import line — can still be anchored at its OWN definition site.
  const localTypeDefs = lang.localTypeDefs(fullText, localDefs);
  const localTypeNames = new Set(localTypeDefs.keys());

  // The target's own span, and nothing wider, for the backticked comment-name
  // gesture. A whole-document scan would put every comment in the file in
  // competition for the same four cap slots, which is the scan-and-guess design
  // the goal refuted; the span is the developer's sketch of THIS function.
  //
  // Withheld from test-gen deliberately, not by omission. `generateTests` must
  // never read a body-scoped comment (scaffold.ts states the invariant): an
  // algorithm note in the body couples a generated test to the algorithm instead
  // of the behaviour, and blind-by-construction is the property that makes the
  // generated test worth anything.
  const spanText = opts?.forConstruction
    ? ""
    : document.getText(
        new vscode.Range(document.positionAt(resolved.span.start), document.positionAt(resolved.span.end)),
      );
  const ordered = lang.candidates(
    resolved.signature,
    resolved.docComment,
    fullText,
    localTypeNames,
    resolved.symbolName,
    spanText,
  );
  // The RECEIVER first. At a method target the enclosing type is the one type
  // the body is certain to touch, and the ranking never yields it: its name is
  // in the container header, which no signature/doc/import mining reads. First
  // place is also what makes it immune to the type cap, to a sibling eating the
  // shared data-shape budget, and to the shared visited set. It takes the first
  // slot of the existing cap; it does not widen it.
  //
  // Test-gen keeps the receiver too, deliberately, not by omission. The block
  // carries a data shape and signatures and never a body, so blind-by-
  // construction holds; and at a method target the receiver is the very type the
  // generated test must CONSTRUCT to make the call, plus the import hint that
  // stops it guessing a module path.
  const container = enclosingContainer(lang, document, resolved);
  const receiver = resolveReceiver(lang, document, resolved, container);
  // The repair round's span types ride directly behind the receiver: the body
  // that failed the check is the best evidence of what the fix needs, and the
  // ambient `use` tier at the tail of `ordered` must never crowd it out under
  // the type cap. Deduped against both neighbours, first mention wins.
  const spanFirst = [...(opts?.extraCandidates ?? []), ...ordered];
  const deduped = spanFirst.filter((t, i) => spanFirst.indexOf(t) === i);
  const candidates = receiver ? [receiver.typeName, ...deduped.filter((t) => t !== receiver.typeName)] : deduped;
  if (candidates.length === 0) {
    return undefined;
  }
  if (receiver) {
    // Detection, not injection: whether the receiver resolves to a surface is not
    // known until the loop below runs, and a line claiming it was placed in the
    // PROMPT would be contradicted one line later by its own drop line. The job
    // is named because the two carry DIFFERENT surfaces, so a channel reader
    // cannot check the block against the type without it.
    const job = receiver.job === "build" ? "the target constructs one" : "the target calls into it";
    log(`[fngen] pre-fill receiver \`${receiver.typeName}\` (enclosing type, ${job}) is first in the candidate list`);
  }
  // THE TYPE CAP IS SPENT ON ADMISSION, not sliced off the front. A stdlib root
  // renders nothing, and freeing its BYTE budget while it still held one of the
  // four slots left the project type behind the cap dropped - the same selection
  // problem one level up. So a candidate refused for provenance does not spend a
  // slot and the next one moves up into it.
  //
  // Every other refusal DOES spend its slot, exactly as the slice did. That is
  // deliberate: a no-anchor candidate consuming a slot is pre-existing behaviour
  // with frozen oracles on it, and widening the backfill to cover it is a
  // different change needing its own measurement.
  //
  // The lookup is bounded because each admission test is a resolver round trip.
  // `prioritizedTypes` mines EVERY `use` import, so a file with fifty imports
  // would otherwise turn one prefill into fifty round trips the moment a stdlib
  // type appeared early. Both bounds log; neither truncates in silence.
  let admitted = 0;
  let resolveCount = 0;
  let looked = 0;
  const notLookedAt: string[] = [];
  let stdlibBackfills = 0;

  // Open the def file so RA can answer documentSymbol (membersOfType) for it and
  // the resolver can read its source to anchor the recursive walk. openTextDocument
  // is idempotent on the already-open target document; a failure is a stop edge.
  const openFile = async (u: string): Promise<string | undefined> => {
    try {
      return (await vscode.workspace.openTextDocument(vscode.Uri.parse(u))).getText();
    } catch {
      return undefined;
    }
  };

  // WHERE THE TARGET SITS, which is what decides whether the visibility filter
  // runs at all. The modifier answers "is this visible outside its own scope";
  // the question here is "can THIS target call it", and the two disagree for
  // every type the target is already inside — the receiver block above most of
  // all. The enclosing type is taken from the symbol tree rather than from the
  // receiver, because a target can sit inside a type without having one: a C#
  // factory's static method has no receiver and is still inside its own class.
  const targetScope: TargetScope = {
    uri: document.uri.toString(),
    enclosingType:
      container !== undefined && typeof container.name === "string"
        ? lang.receiver.containerName(container.name)
        : undefined,
  };
  const visibility = lang.memberVisibility && { ...lang.memberVisibility, target: targetScope };

  // ONE shared walk state threaded across every per-type data-shape walk below, so
  // the PER-PROMPT total (not just each walk) is bounded and a nested type shared
  // by two roots is emitted once across the whole prefill.
  //
  // The language slot is resolved THROUGH THE BUDGET CELL first.
  // A language's own aggregate (C#'s CS_DATASHAPE_TOTAL_TOK) already
  // lives inside `budgetProfileFor`'s csharp leg, so handing prefillTotalTok
  // the raw table constant let a moved cell (CELL_OVERRIDES) change the
  // profile while the walk kept spending the constant - a frontier/csharp
  // surfaceBudgetTok could never reach the walk. At identity the two are the
  // same number, so no prompt moves by a byte; test-gen is untouched because
  // forConstruction takes TESTGEN_PROFILE's own total inside prefillTotalTok.
  const langWalkBudget: Pick<PrefillLang, "dataShapeTotalTok"> =
    lang.dataShapeTotalTok === undefined ? lang : { dataShapeTotalTok: budget.surfaceBudgetTok };
  const sharedWalk: SharedWalkState = {
    visited: new Set<string>(),
    remainingChars: prefillTotalTok(langWalkBudget, profile, opts?.forConstruction === true) * 4,
    // ONE ledger for the whole gesture, threaded exactly
    // where the shared budget is threaded, so the per-prompt drop list is
    // collected by the same seam that causes most of the drops.
    droppedBy: new Map(),
    // Member-block dedup, kept APART from `visited`, which
    // dedups data shapes. See SharedWalkState's own comment for what happened
    // when C# got a walk and the two shared one set.
    memberBlocks: new Set<string>(),
  };
  const blocks: string[] = [];
  // The type names each block put a header on, PARALLEL to `blocks` - the same
  // content as `rendered` below, kept un-flattened so a shrink can drop a whole
  // block and narrow the instruction's scope with it. One candidate can render
  // several headers (the C# collaborator graph), so the two lists are not
  // one-to-one on candidates.
  const blockTypes: string[][] = [];
  // The types whose blocks actually rendered, in render order - the instruction's
  // scope. Not the kept candidates and not the receiver: a candidate that
  // resolved nothing describes nothing, and a payload can carry no receiver at
  // all, so an instruction built from either names a type the model cannot see.
  const rendered: string[] = [];
  // name -> def file path, for the import hint (test-gen only). Every resolved
  // type (root and nested), deduped, so the block imports the whole graph the
  // test may construct — not just the types whose data-shape block was emitted.
  const importTypes = new Map<string, string>();
  // Sysroot types whose import hint was withheld (Q23). Deliberately NOT a
  // `noBlock` entry: that ledger is one-to-one on CANDIDATES and feeds the
  // `kept= injected= no-block=` arithmetic, and a nested field-hop type was
  // never a candidate, so putting it there corrupts the line. This is the
  // evidence channel instead, because a refusal nobody can see is a refusal
  // nobody can debug.
  const sysrootHintsWithheld = new Set<string>();
  // Every kept candidate that produces no block, with the reason class. The
  // loop has more exits than it has evidence lines, and a candidate that dies on
  // a silent one is indistinguishable from a candidate that was never kept —
  // which makes a receiver that failed to resolve unprovable from the channel.
  const noBlock: { type: string; reason: string }[] = [];
  // Rendered types whose surface still carries the language server's own
  // truncation marker. They keep their block and lose their place in the firm
  // instruction's ONLY list — see `PrefillLang.surfaceTruncated`.
  const unproven = new Set<string>();
  // What each rendered type disclosed, for a caller that gates output on it.
  // Collected from the resolver's OWN structures, not from the rendered text:
  // the gate may only refuse on evidence, and a member list the render capped is
  // marked incomplete so it can never refuse a member it simply did not show.
  const disclosed: DisclosedType[] = [];
  const recordDisclosed = (names: readonly string[], shape: CrossFileShape | undefined): void => {
    for (const name of names) {
      const derived = shape?.types.get(name);
      if (!derived || disclosed.some((d) => d.name === name)) {
        continue;
      }
      const members = [
        ...derived.fields.map((f) => f.name),
        ...derived.methods.map(memberNameOf).filter((m): m is string => m !== undefined),
      ];
      disclosed.push({
        name,
        members,
        // The lines as rendered, kept alongside the names: a steer that has to
        // answer "which member here is a LodBand" reads the types, and the names
        // alone cannot carry them.
        signatures: [...derived.methods],
        complete: isClosedSurface(derived, profile.memberCap) && members.length > 0,
      });
    }
  };

  // What resolution found, held until every candidate has been resolved, because
  // the RENDER order is not the candidate order. See the sort below.
  const resolvedCandidates: {
    type: string;
    refCursor: SourceCursor;
    shape: CrossFileShape | undefined;
    derived: DerivedType | undefined;
  }[] = [];

  // The gesture's sleep budget, minted once and spent across every candidate
  // this loop resolves. See `SettleAllowance`: a walk's own allowance bounds one
  // walk, and this loop runs up to `budget.resolveCap` of them.
  const settleAllowance = freshSettleAllowance();

  for (const type of candidates) {
    if (admitted >= typeCap || resolveCount >= budget.resolveCap || looked >= budget.provenanceCap) {
      notLookedAt.push(type);
      continue;
    }
    looked++;
    // The receiver is anchored where the symbol tree says its container's name
    // is, never through the reference finder: at `impl Stripe {` the name is
    // outside the span, off every import line, and not necessarily defined in
    // this file, so the generic finder is exactly what fails to anchor it.
    const isReceiver = receiver !== undefined && type === receiver.typeName;
    // A candidate that arrived with its own declaration cursor is anchored
    // there, ahead of every text search: the call-owner leg already asked the
    // language server where the type is declared, and re-deriving it from file
    // text would answer from an import, a call site or a comment as confidently
    // as from the declaration.
    let refCursor =
      opts?.extraCursors?.get(type) ??
      (isReceiver ? receiver.cursor : lang.typeReference(type, document, resolved, fullText, localTypeDefs));
    // Fallback (C#, Go): a collaborator named only in the doc-comment/body — for
    // Go, the qualified-usage candidate leg is exactly this
    // case — or defined in another file/project has no in-span or same-file
    // cursor, so the pure per-file `typeReference` returns undefined. Resolve it
    // BY NAME through the extractor's workspace-symbol leg (Roslyn/gopls
    // workspace/symbol -> the exact-name type's def cursor), then resolve its
    // shape as usual. Only the transports that expose the capability fall back
    // here; absent means no fallback.
    if (!refCursor && extractor.resolveTypeCursorByName) {
      try {
        refCursor = (await extractor.resolveTypeCursorByName(type)) ?? undefined;
      } catch {
        refCursor = undefined;
      }
      if (refCursor) {
        log(`[fngen] pre-fill resolved \`${type}\` by workspace symbol (no in-span/same-file cursor)`);
      }
    }
    if (!refCursor) {
      noBlock.push({ type, reason: "no anchor found (no reference cursor)" });
      admitted++;
      continue;
    }
    // PROVENANCE FIRST, before the expensive resolve. One `definition()` round trip
    // decides whether this candidate can render at all, and a stdlib root cannot.
    //
    // Deciding it after the shape walk was measurably wrong twice over. It paid
    // for a full walk, a member enumeration and the visibility pass on a type
    // whose block was then thrown away - and it LOGGED all of that, so a live
    // `create_ca` round emitted six visibility-filter lines naming 21 private
    // members of `Path`, 19 of `BufReader` and 29 of PathBuf, every one of them
    // about a type the next line said injected nothing. Evidence for a decision
    // that was already made reads as evidence for the opposite one.
    let preDefUri: string | undefined;
    if (lang.isStdlibDef) {
      try {
        preDefUri = (await extractor.definition(refCursor))?.uri;
      } catch {
        preDefUri = undefined;
      }
      if (preDefUri !== undefined && lang.isStdlibDef(preDefUri)) {
        noBlock.push({
          type,
          reason: `defined in the standard library (${preDefUri}), which the model already knows`,
        });
        stdlibBackfills++;
        continue;
      }
    }
    resolveCount++;
    // The ONE resolver: fields AND methods from wherever the type lives. A type it
    // derives takes the shape path; else fall through to the worked example.
    let shape: CrossFileShape | undefined;
    try {
      // The receiver's name comes from the symbol tree, so it is passed rather
      // than re-derived from the buffer: the anchor is the provider's own
      // name-token position, and a provider that points a little wide of the
      // token would otherwise silently resolve the shape under the wrong name.
      shape = await resolveCrossFileShape(
        extractor,
        refCursor,
        // THE GATHER STOPS WHERE THE RENDER STOPS, for a language that has proved
        // its renderer can use nothing past that point (`PrefillLang.gatherBreadth`).
        // Through the exported mapping, not inline, so the latency rig times the
        // bound this line spends rather than one it rebuilt for itself.
        prefillGatherBound(lang, profile),
        openFile,
        lang.shapeHooks,
        isReceiver ? type : undefined,
        isReceiver && receiver.job === "build" ? lang.receiver.memberReturn : undefined,
        visibility,
        // ONE SETTLE ALLOWANCE FOR THE WHOLE GESTURE, not per candidate. This
        // loop runs up to `resolveCap` times (8 at the install default, 32 at
        // the frontier stop), so a per-walk allowance would let one gesture
        // sleep for seconds while every individual walk looked well behaved.
        settleAllowance,
        // THE PRE-FILL'S OWN HOVER FAN-OUT CAP, split from FIM's on 2026-08-11.
        // FIM keeps 32 because it spends against a keystroke; this path is a
        // gesture a developer asked for and is waiting on, and 48 is the number
        // the real Python population needs (32 cuts 6 members off one class of
        // eleven, 48 cuts nothing anywhere). With a field walk live, a capped
        // member is a lost EDGE and not only a lost line.
        PREFILL_HOVER_SIGNATURE_CAP,
      );
    } catch {
      shape = undefined;
    }
    if (shape) {
      for (const [name, t] of shape.types) {
        // Q23: a sysroot def contributes no import hint. `deriveUsePath` walks
        // the definition's file tree for the owning manifest, and for a stdlib
        // type that walk lands on `<sysroot>/library/std/Cargo.toml`, reads
        // `name = "std"`, and builds a `use std::…` line out of a directory
        // layout nobody meant to be read that way. Unnecessary when the prelude
        // already had the type in scope, and wrong when the layout and the
        // module path disagree. A confident false `use` line in the prompt is
        // not inert.
        //
        // THIS IS NOT A COLD-START GUARD. Read that before deleting it as dead.
        // The 1.3.0 provenance pre-check judges only the ROOT candidate, and
        // `STD_TYPE_NAMES` (the field hop's stop set) carries 28 prelude-ish
        // names that do not include `File`, `BufReader`, `SocketAddr`,
        // `AtomicU64` or `SystemTime`. So a workspace struct with a sysroot-typed
        // FIELD walks straight in here with a warm resolver. A first
        // `definition()` miss is an additional way in, not the only one.
        //
        // And the harm is not the redundancy the entry filed. Measured on this
        // box against the real rustup sysroot and real `rustc`, one `use` line
        // per file so no failure masks another: 15 of 53 derived stdlib lines
        // compile, 38 fail, 35 of those `error[E0603]: module is private`.
        // `deriveUsePath` walks the FILE tree and Rust resolves the MODULE tree,
        // so `library/std/src/io/buffered/bufreader.rs` yields
        // `use std::io::buffered::bufreader::BufReader;` where the real path is
        // `std::io::BufReader`. The 15 that work are the types declared in one
        // top-level module file, `std/src/fs.rs` and `std/src/process.rs`
        // almost entirely.
        //
        // Withholding those 15 is the price of removing 38 confident false facts
        // under a header that reads "Import these collaborators (they are
        // already defined)", and `usePath.ts:67` already ratified which way that
        // trade goes: no import hint beats a wrong one.
        //
        // The type is NOT dropped: it still reaches the assembly and is still
        // accounted for by name in the noBlock ledger with its stdlib reason.
        // Only the import line is withheld. Dropping it would revert the
        // root-provenance rule, which is a different and much larger change.
        if (t.defUri && isRustSysrootDef(t.defUri)) {
          sysrootHintsWithheld.add(name);
          continue;
        }
        if (t.defUri && !importTypes.has(name)) {
          importTypes.set(name, vscode.Uri.parse(t.defUri).fsPath);
        }
      }
    }
    // Both filters owe evidence, and each line must say WHICH one fired: they
    // argue in opposite directions, so a line that does not distinguish "the
    // target cannot call it" from "it does not belong at this target" sends the
    // reader into the wrong subsystem. The visibility pass runs over the whole
    // walk, so its removals are grouped by the type they left.
    for (const [t, gone] of groupByType(shape?.hidden ?? [])) {
      log(
        `[fngen] pre-fill dropped ${gone.length} non-public member(s) from \`${t}\` ` +
          `(visibility filter; the target cannot call them): ${gone.join(", ")}`,
      );
    }
    // The narrowing itself happened inside the resolver, where the members were
    // still structured. What is owed here is the evidence: the candidate-level
    // accounting below cannot see a member-level drop (a narrowed member was
    // never a candidate), so without this line a construction target ships a
    // shorter surface than the reader expects and nothing says so. Conditional,
    // because a target that narrowed nothing owes nothing.
    const narrowed = shape?.narrowed ?? [];
    if (narrowed.length > 0) {
      log(
        `[fngen] pre-fill narrowed \`${type}\` to its construction surface: ` +
          `removed ${narrowed.length} member(s) that cannot produce it (${narrowed.map((m) => m.name).join(", ")})`,
      );
    }
    const derived = shape?.types.get(type);
    // ROOT PROVENANCE, decided HERE because this is where
    // the slot is spent. A candidate PROVEN to be one the model has known since
    // pretraining renders nothing - no data shape, no member list, and no worked
    // example either - and it costs neither prompt bytes nor a slot.
    //
    // "Proven" is load-bearing and the rule reaches no further. The evidence is
    // `defUri`, so a candidate whose definition did not resolve is not refused;
    // it keeps the pre-existing worked-example path. The rule forbids a name
    // blocklist, and a blocklist is the only thing that could refuse a type whose
    // provenance is unknown.
    //
    // It has to be resolved before it can be refused: `defUri` is the resolver's
    // own answer about where the type lives, and there is no cheaper honest
    // source for it.
    //
    // The ROOT only. A project type that WRAPS a stdlib type still renders in
    // full, because what is tested is where THIS candidate was defined, never
    // what appears inside its shape.
    //
    // A type that resolved with NO defUri is admitted, not refused. The two
    // failure directions are not symmetric: refusing a stdlib type by mistake
    // costs the prompt nothing it had before, while refusing a PROJECT type
    // because a round trip came back empty starves the model of the one thing it
    // cannot know.
    // BACKSTOP. The pre-check above catches this for every candidate whose
    // `definition()` answers, which is nearly all of them. This catches the rest:
    // the resolver reaches a def URI by paths of its own, and a candidate that
    // pre-checked as unprovable can still come back from the walk with one.
    if (derived?.defUri !== undefined && lang.isStdlibDef?.(derived.defUri) === true) {
      noBlock.push({
        type,
        reason: `defined in the standard library (${derived.defUri}), which the model already knows`,
      });
      stdlibBackfills++;
      continue;
    }
    // The unprovable case, said out loud. A candidate that resolved a shape but
    // no definition URI cannot be tested for provenance at all, and it then rides
    // whichever render path its shape earns. Logged because the alternative is a
    // reader concluding the provenance rule ran and passed it.
    // Covers BOTH shapes of unprovable, which is why it does not test `derived`
    // itself: a candidate the resolver derived without a definition URI, and a
    // candidate it could not derive at all (which still goes on to the
    // worked-example leg and can still put a standard-library surface in the
    // prompt). Either way provenance was never tested, and that is the fact owed.
    if (derived?.defUri === undefined && lang.isStdlibDef !== undefined) {
      log(`[fngen] pre-fill \`${type}\` has no definition URI, so its provenance is unknown and it is not refused`);
    }
    admitted++;
    resolvedCandidates.push({ type, refCursor, shape, derived });
  }
  if (notLookedAt.length > 0) {
    log(
      `[fngen] pre-fill dropped ${notLookedAt.length} lower-priority type(s): ${notLookedAt.join(", ")}` +
        (resolveCount >= budget.resolveCap
          ? ` (resolve cap=${budget.resolveCap} reached after ${looked} provenance check(s))`
          : looked >= budget.provenanceCap
            ? ` (provenance cap=${budget.provenanceCap} reached)`
            : ""),
    );
  }
  if (stdlibBackfills > 0) {
    // The slot arithmetic, said out loud. Without it a reader cannot tell a
    // prefill that backfilled from one that simply had fewer candidates.
    log(
      `[fngen] pre-fill backfilled ${stdlibBackfills} slot(s) freed by standard-library type(s); ` +
        `provenance-checked ${looked}, resolved ${resolveCount}, admitted ${admitted}`,
    );
  }

  // CLOSED SURFACES RENDER FIRST. The shared data-shape budget is spent
  // first-come, and a candidate's block carries its whole collaborator graph, so
  // the first wide type through the door can take the lot: measured on a real C#
  // solution, a 46-member DTO and a 25-member parsing result left a four-variant
  // enum with zero lines, twice, and a 116-member `DateTime` did it a third
  // time. The enum was the type the fix needed each time.
  //
  // The rule is precision per character, not size: a CLOSED set is every name
  // the type can answer to, so its block is the only surface in the prompt that
  // can be read as an exhaustive list - and it is also the only one the repair
  // gate is allowed to refuse against. A wide class's member list is a subset
  // however many lines it gets, so it loses nothing by going second. Same
  // predicate as `recordDisclosed`'s `complete`, deliberately: what renders
  // first is what the gate can hold the model to.
  //
  // Stable within each group, so the receiver-first ordering and the span-types
  // tier still decide everything else.
  const closedFirst = [
    ...resolvedCandidates.filter((c) => isClosedSurface(c.derived, profile.memberCap)),
    ...resolvedCandidates.filter((c) => !isClosedSurface(c.derived, profile.memberCap)),
  ];

  // THE MEMBER FLOOR. The whole prompt's member blocks are
  // priced HERE, before the loop below renders anything, because the aggregate is
  // spent across roots and a reservation taken inside a renderer arrives too late
  // - that one was built and reverted.
  //
  // What the floor buys: a member surface a developer had before the field leg is
  // never what the leg costs them. What it costs: at widths where the member half
  // alone nearly fills the aggregate, fewer data-shape blocks render than did
  // before the floor, and every one of them is named on the drop lines below.
  // That trade is one-directional on purpose. The shape block is new surface; the
  // member list is surface a developer already reads.
  //
  // C# only, and structurally so: it is the one language whose member blocks come
  // out of this aggregate at all. `priceMemberBlocks` absent leaves `memberFloor`
  // absent, which leaves every walk in every other language spending exactly what
  // it spent before.
  const memberPrice = new Map<string, number>();
  if (lang.priceMemberBlocks !== undefined) {
    const shapePath = closedFirst.filter((c) => takesShapePath(lang, c.derived));
    const priced = lang.priceMemberBlocks(shapePath, profile, sharedWalk.remainingChars);
    shapePath.forEach((c, i) => memberPrice.set(c.type, priced[i] ?? 0));
    sharedWalk.memberFloor = { reserve: priced.reduce((sum, n) => sum + n, 0), own: 0 };
  }

  for (const { type, refCursor, shape, derived } of closedFirst) {
    // Nothing here refuses on provenance: a stdlib root never reaches this loop,
    // because it was refused at admission above, where the slot it would have
    // spent is also freed.
    // Take the SHAPE path only when the resolver derived something USEFUL — real
    // fields OR methods. A library type whose hover is `{ /* private fields */ }`
    // with no methods resolves to an EMPTY shape; injecting that sparse stub and
    // its FIRM_INSTRUCTION (pointing at a nonexistent surface) is strictly worse
    // than the worked example, so it must fall through (the fastbloom bar).
    //
    // `admitsEmptyShape` is the ONE exception, and it is a language's to grant:
    // an empty shape whose SIGNATURE is already the whole surface. A Rust enum is
    // that type, and a RECOVERED TRAIT is the other: its item signatures live in
    // the signature because the recovery only fires at methods === 0. Both have
    // no fields to parse and no members arriving with signatures to render, so
    // they fail both tests above while the complete declaration sits in
    // `derived.signature`, resolved and paid for. The enum was measured at
    // +7.3 rows of 237 on the acme corpus for 122 more prompt bytes and no
    // extra round trip. The fastbloom bar is untouched: the
    // private-fields struct is not an enum, and answers no.
    if (takesShapePath(lang, derived)) {
      // THIS CANDIDATE'S OWN SHARE, named to the renderer before it runs and
      // released after. The renderer needs it BEFORE, because a shape block that
      // sheds repays its own share and is allowed to borrow that much; it is
      // released AFTER, because releasing it earlier would let a walk borrow
      // against a shed it never delivers.
      const own = memberPrice.get(type) ?? 0;
      if (sharedWalk.memberFloor !== undefined) {
        sharedWalk.memberFloor.own = own;
      }
      const block = lang.renderShapeBlock(type, shape as CrossFileShape, sharedWalk, log, profile);
      // Released even when the block came back undefined: a candidate that
      // rendered nothing is owed nothing either, and leaving its share held would
      // starve every candidate behind it of the surplus.
      if (sharedWalk.memberFloor !== undefined) {
        sharedWalk.memberFloor.reserve = Math.max(0, sharedWalk.memberFloor.reserve - own);
        sharedWalk.memberFloor.own = 0;
      }
      if (block) {
        blocks.push(block.text);
        blockTypes.push([...block.types]);
        // What RENDERED, from the renderer's own account of it — one candidate can
        // put headers on several types (the C# collaborator graph), and the
        // instruction must name every one of them or it points the model at a
        // surface outside its own permission list.
        rendered.push(...block.types);
        // An incomplete surface may be SHOWN; it may not be declared exhaustive.
        // The block above stays exactly as it rendered — withdrawing it would cost
        // the model the members the server DID show — and the type drops out of
        // the instruction's ONLY list instead. Per TYPE, never per prompt: a
        // sibling whose surface is proven keeps its scope in the same sentence.
        for (const name of block.types) {
          const d = shape?.types.get(name);
          if (d && lang.surfaceTruncated?.(d) === true) {
            unproven.add(name);
            log(
              `[fngen] pre-fill \`${name}\` surface is still truncated by the language server;` +
                ` shown, but left out of the ONLY list`,
            );
          }
        }
        recordDisclosed(block.types, shape);
        continue;
      }
    }
    // EXTERNAL/unresolved-as-struct/empty-shape type: the worked example at the
    // SAME safe reference site (never an arbitrary body/doc occurrence — the
    // wrong-example hazard). Unchanged fastbloom behaviour. Rust only: the TS
    // payload is signatures-only by contract, so its example leg stays dark.
    if (!lang.exampleFallback) {
      noBlock.push({ type, reason: noBlockReason(lang, derived, sharedWalk, type) });
      continue;
    }
    let example: string | undefined;
    try {
      example = await extractor.example(refCursor, type);
    } catch {
      example = undefined;
    }
    // THE GATE. A block whose code never names the type
    // it is headed with is refused whole: its header ("Usage example for `X`")
    // would be a false sentence in a prompt whose other blocks say "do not
    // invent". Refused means not emitted - the type falls to the same honest
    // branch as having no example at all, never to the lying block.
    if (example !== undefined && !exampleNamesItsType(type, example)) {
      log(`[fngen] pre-fill \`${type}\` example refused: its code never names the type`);
      example = undefined;
    }
    if (example) {
      blocks.push(assembleSurfacePayload({ typeOrCrate: type, example, omitInstruction: true }));
      blockTypes.push([type]);
      rendered.push(type);
      // A worked example names the type without enumerating its members, so the
      // type is disclosed and its member list is not: incomplete by construction.
      if (!disclosed.some((d) => d.name === type)) {
        disclosed.push({ name: type, members: [], complete: false });
      }
    } else {
      noBlock.push({ type, reason: `${noBlockReason(lang, derived, sharedWalk, type)}, and no worked example` });
    }
  }
  for (const d of noBlock) {
    log(`[fngen] pre-fill \`${d.type}\` injected nothing: ${d.reason}`);
  }
  // The arithmetic the drop lines close: kept minus injected equals the lines
  // above. Emitted only when a candidate went dark, because a prefill where
  // every kept type rendered has nothing to account for and the free-function
  // log identity is frozen.
  if (noBlock.length > 0) {
    log(`[fngen] pre-fill accounting: kept=${admitted} injected=${blocks.length} no-block=${noBlock.length}`);
  }

  // The import hint (test-gen only): where every resolved collaborator lives, so
  // the blind test imports it from its real module instead of guessing crate root.
  const importHint =
    opts?.importTargetPath !== undefined && importTypes.size > 0
      ? renderImportHint(
          [...importTypes].map(([name, defPath]) => ({ name, defPath })),
          opts.importTargetPath,
          { fileExists: (p) => fs.existsSync(p), readFile: (p) => safeReadFile(p) },
        )
      : undefined;

  // THE PER-GESTURE DROP LEDGER.
  // The walk has always recorded the types a cap dropped ENTIRELY; until now
  // only the per-walk lines above read it, and only on the two languages that
  // have a data-shape walk at all. This is the once-per-fn-gen list: what the
  // stop in force cost this prompt, by name, with the cap that did it, so a
  // developer can SEE whether raising `column80.injectedContext` would buy them
  // anything instead of inferring it. Empty stays silent, by contract - a walk
  // that dropped nothing adds no line.
  //
  // The ledger is keyed by NAME, so its size is a count of DISTINCT types
  // (review D4) - the pre-D4 walk could put one type in its own drop list twice
  // with two different causes, and any count taken off that list was inflated.
  const droppedLedger = [...(sharedWalk.droppedBy ?? new Map<string, DroppedType>()).values()];
  if (droppedLedger.length > 0 && !forConstruction) {
    const named = droppedNames(droppedLedger, profile.dataShape);
    // TWO CLASSES SINCE THE MEMBER FLOOR, and the sentence has to tell them
    // apart.
    // A cap drop costs a type its whole presence; a member-floor refusal costs
    // it only its data shape, because the floor exists precisely so its member
    // list survives. One word, "entirely", covering both would tell a developer
    // eight types vanished while eight member lists sit in the prompt in front
    // of them. Each clause is omitted when its class is empty, so a prompt with
    // only cap drops reads exactly as it always did.
    //
    // "dropped" stays the verb in every shape of the line: it is the phrase a
    // developer greps for and the phrase four blind-authored rows are bound to.
    //
    // WHICH CLASS A NAME IS IN IS READ OFF WHAT RENDERED, not off the drop's
    // cause. The two disagree, and the cause is the one that lies: a type the
    // walk's own total-types cap dropped can still be given a member block by
    // C#'s member renderer a moment later, and it would then be counted as
    // dropped ENTIRELY while its member list sits in the prompt in front of the
    // developer reading the line. `rendered` is the payload's own account of
    // which types got a header, so this partition cannot drift from the prompt.
    const heldBack = droppedLedger.filter((d) => rendered.includes(d.name)).length;
    const entirely = droppedLedger.length - heldBack;
    const what = [
      entirely > 0 ? `${entirely} type(s) entirely` : undefined,
      heldBack > 0 ? `${heldBack} data shape(s) whose member lists stay` : undefined,
    ]
      .filter((c) => c !== undefined)
      .join(" and ");
    log(
      `[fngen] injected context dropped ${what} at the \`${stop}\` stop: ` +
        `${named}. Raise \`column80.injectedContext\` to fit more of them.`,
    );
  }

  // THE LEDGER, BUILT ONCE AND HANDED OVER FROM BOTH EXITS. `surface` is the
  // only field that differs between them, so it is the only parameter: the
  // no-block exit returns `undefined` and the ledger's surface is the empty
  // string.
  //
  // Why the early exit needs it at all. The walk has already run by the time
  // control reaches here: `noBlock`, `notLookedAt` and `droppedBy` are full and
  // every one of them has already been LOGGED. A run that injects nothing is
  // precisely the run where the delta gate has the most to say, and skipping
  // the hook there made it say the opposite - an absent ledger classifies every
  // candidate as class 4, and class 4 ranks AHEAD of class 3, so the targets
  // with the most class-3 evidence got their proposals ordered worst.
  const handOverLedger = (surface: string): void => {
    opts?.onLedger?.({
      rendered: [...rendered],
      visited: [...sharedWalk.visited],
      noBlock: noBlock.map((d) => ({ type: d.type, reason: d.reason })),
      notLookedAt: [...notLookedAt],
      // DROPPED ENTIRELY, which is what the field's own comment claims and what
      // a class-3 consumer needs (adversarial defect 5). `droppedBy` also holds
      // the HELD-BACK class: a `member-floor` refusal names a type whose data
      // shape was withdrawn while its member list still rendered, so that name
      // is in `rendered` too and calling it dropped is a lie the channel does
      // not tell. The channel prints both partitions ("N entirely" / "M data
      // shapes whose member lists stay") a few lines above; this field carries
      // the first one only.
      dropped: droppedLedger.filter((d) => !rendered.includes(d.name)).map((d) => ({ name: d.name, cause: d.cause })),
      typeCap,
      admitted,
      surface,
    });
  };

  if (blocks.length === 0 && !importHint) {
    handOverLedger("");
    return undefined;
  }
  if (blocks.length > 0) {
    log(`[fngen] pre-fill injected types=${blocks.length}`);
  }
  if (importHint) {
    log(`[fngen] pre-fill import hint: ${importHint.replace(/\n/g, " ")}`);
  }
  if (sysrootHintsWithheld.size > 0) {
    log(
      `[fngen] pre-fill import hint withheld for ${[...sysrootHintsWithheld].join(", ")}:` +
        ` defined in the rust sysroot, where the derived path is wrong far more often than right`,
    );
  }

  // The surface AT A CHOSEN SIZE. `renderSurface(blocks.length)`
  // is the whole surface and is what this function returns, so the fits case is
  // byte-identical to what it always was; a smaller argument is the shrink, and
  // it RE-RENDERS rather than slicing because the firm instruction's scope has
  // to shrink with the blocks it names. A block dropped here is a block the
  // instruction must stop claiming the model may use.
  const renderSurface = (keep: number): string | undefined => {
    const kept = blocks.slice(0, Math.max(0, keep));
    const parts: string[] = [];
    if (importHint) {
      parts.push(
        `Import these collaborators (they are already defined; do NOT redefine or mock them):\n${FENCE}rust\n${importHint}\n${FENCE}`,
      );
    }
    if (kept.length > 0) {
      // One shared firm instruction for the whole prefill, not one per block: up to
      // PREFILL_TYPE_CAP blocks would otherwise repeat it 4x. Each
      // block above omits its own; the instruction governs the whole surface. A
      // combining caller takes the blocks bare and writes the one instruction that
      // governs its whole prompt, so this one would name a partial scope.
      parts.push(kept.join("\n\n"));
      if (opts?.omitInstruction !== true) {
        // The instruction itself always ships, even when nothing survives the
        // filter: dropping the sentence is a much larger change than narrowing its
        // scope, and `firmInstructionFor([])` is the honest degrade already written
        // for a payload that names no type.
        parts.push(
          lang.firmInstruction(
            blockTypes
              .slice(0, Math.max(0, keep))
              .flat()
              .filter((name) => !unproven.has(name)),
          ),
        );
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  };
  const text = renderSurface(blocks.length) ?? "";
  opts?.onDisclosed?.(disclosed.filter((d) => rendered.includes(d.name)));
  opts?.onSurface?.({ text, blocks: blocks.length, keep: renderSurface });
  handOverLedger(text);
  return text;
}

/** How many dropped type names one channel line spells out before it summarises
 *  the rest. THE COUNT IS NOT BOUNDED and the names are: a wide graph at a low
 *  stop drops hundreds (measured: 397 on the phase-1 synthetic 40-wide graph at
 *  `medium`), and a line carrying all of them is not something a human reads,
 *  it is something that buries the lines around it. Twelve still reads. */
const DROP_LEDGER_NAME_CAP = 12;

/** How a dropped type's cap reads on the channel, WITH THE NUMBER IN FORCE.
 *  Naming the mechanism alone ("the walk dropped it") tells a developer
 *  something is missing and nothing about which way to turn the dial; naming
 *  the cap and its value tells them exactly what raising the stop buys.
 *
 *  THE BUDGET NUMBER COMES OFF THE DROP, NOT OFF THE BOUNDS (review D3). This
 *  printed `render budget ${TOK_MAX} tok` unconditionally while the render pass
 *  binds on `min(TOK_MAX * 4, shared.remainingChars)`; measured, a type dropped
 *  at an effective 120 chars (30 tok) was reported as `render budget 5000 tok`.
 *  A pre-D3 `DroppedType` with no recorded bound falls back to the old wording,
 *  which is the only honest thing left to say about a drop whose binder nobody
 *  wrote down. */
function dropCauseLabel(d: DroppedType, bounds: WalkBounds): string {
  if (d.cause === "total-types") {
    return `total-types cap ${bounds.N_MAX}`;
  }
  if (d.cause === "breadth") {
    return `breadth cap ${bounds.B_MAX}`;
  }
  if (d.cause === "member-floor") {
    // Not a cap. The block was affordable and refused anyway, because what it
    // would have cost is held for member lists this prompt already renders.
    return "member lists hold the rest of the budget";
  }
  if (d.budgetBound === undefined) {
    return `render budget ${bounds.TOK_MAX} tok`;
  }
  return d.budgetBound.kind === "shared"
    ? `render budget ${d.budgetBound.tok} tok left of the prompt's shared aggregate, not this walk's ${bounds.TOK_MAX}`
    : `render budget ${d.budgetBound.tok} tok`;
}

/** A dropped-type list as one bounded channel fragment: each name with the cap
 *  that dropped it, then a count of whatever did not fit on the line. */
function droppedNames(dropped: readonly DroppedType[], bounds: WalkBounds): string {
  const shown = dropped.slice(0, DROP_LEDGER_NAME_CAP);
  const more = dropped.length - shown.length;
  return shown.map((d) => `${d.name} (${dropCauseLabel(d, bounds)})`).join(", ") + (more > 0 ? `, and ${more} more` : "");
}

/** The enclosing type the target is working against, and which of the two jobs
 *  it is doing there. Detection is the SIGNATURE's answer; the type's NAME comes
 *  from the document-symbol tree that resolution already walked, except in Go,
 *  whose receiver clause carries both. `cursor` is where the resolver crosses
 *  from to the type's definition. */
interface Receiver {
  typeName: string;
  job: ReceiverJob;
  cursor: SourceCursor;
}

function resolveReceiver(
  lang: PrefillLang,
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
  container: DocumentSymbolLite | undefined,
): Receiver | undefined {
  // A target that is not a function has no enclosing type to work against — it
  // IS the type. The pre-fill serves type generation too, and a class or struct
  // declaration head carries no `static` and no `self` parameter, so a receiver
  // test reading only the signature passes on it and injects the type into its
  // own generation prompt. The test is "not a function": enumerating the type
  // kinds would rot the moment a language's admit set changes.
  if (resolved.kind !== "function") {
    return undefined;
  }
  const rules = lang.receiver;
  const hasReceiver = rules.hasReceiver(resolved.signature);
  // Go: the signature names the receiver's TYPE as well as its presence, so it
  // resolves with no tree at all. That is the signature-first rule applying more
  // completely, not an exemption from it — what is forbidden is reading a
  // container out of file text, and a resolved signature is neither.
  if (rules.receiverType) {
    const typeName = hasReceiver ? rules.receiverType(resolved.signature) : undefined;
    const at = typeName === undefined ? undefined : receiverNameOffset(resolved.signature, typeName);
    if (typeName === undefined || at === undefined) {
      return undefined;
    }
    return { typeName, job: "call", cursor: cursorAt(document, resolved.span.start + at) };
  }
  if (!container) {
    return undefined;
  }
  const typeName = typeof container.name === "string" ? rules.containerName(container.name) : undefined;
  if (typeName === undefined) {
    return undefined;
  }
  // A receiver means the body calls into a value; no receiver but a return type
  // naming the enclosing type means it builds one. A target with both takes the
  // call surface, which is the fuller of the two — they are never merged.
  const job: ReceiverJob | undefined = hasReceiver
    ? "call"
    : rules.returnNames(resolved.signature, typeName)
      ? "build"
      : undefined;
  if (job === undefined) {
    return undefined;
  }
  // The name token, which is where the type resolves from. `selectionRange` is
  // the provider's own answer for where a symbol's name sits; the whole range is
  // the fallback for a tree that carries none.
  const anchor = container.selectionRange?.start ?? container.range?.start;
  if (!anchor) {
    return undefined;
  }
  return {
    typeName,
    job,
    cursor: { uri: document.uri.toString(), line: anchor.line, character: anchor.character },
  };
}

// The innermost TYPE-kind symbol whose range covers the declaration head. The
// head, never a body cursor: a container's range can end at its last statement
// (Python has no closing token to extend to), so a caret on a fresh indented
// line falls outside its own class even in a well-formed file.
//
// Kind filtering is what keeps the walk off a C# NAMESPACE, which also contains
// the cursor and is the one measured route to a confidently wrong receiver. A
// tree that is absent, empty, or the flat non-hierarchical shape means no
// receiver — the same honest degrade span resolution itself makes.
/** The type that owns a member call the span makes, and where its declaration
 *  is. The cursor is the point: a bare NAME cannot be resolved by the pre-fill
 *  engine, because `typeReference` anchors a candidate by searching the TARGET
 *  file's text and the receiver of a chained call is named nowhere in it. */
export interface CallOwner {
  /** The call this owner was resolved from. On the channel, so a wrong owner
   *  can be traced back to the call that produced it. */
  member: string;
  name: string;
  cursor: SourceCursor;
}

// How many DEFINITION round trips one repair round may spend resolving call
// owners. Six is `REFINE_TARGET_CAP`, chosen against this same seam.
const CALL_OWNER_LOOKUP_CAP = 6;
// How many owners may actually be KEPT. Deliberately much smaller than the
// lookup cap, and the reason is the cap downstream: `PREFILL_TYPE_CAP` is 4,
// span types splice at the FRONT of the candidate list, and the receiver takes
// slot one at a method target. Prepending six owners would evict every type the
// span named to make room for types the span called into. Two owners plus the
// receiver leaves one slot, which is the honest budget rather than a preference.
const CALL_OWNER_CAP = 2;

/**
 * The types that own the member calls a span makes, nearest the diagnostic
 * first.
 *
 * `spanTypesInPlay` reads the types a span NAMES,
 * and the receiver of a chained call is named nowhere: in the live capture the
 * failing call was `metadata.write.to_shard_log_header(...)`, whose receiver is
 * a `LogSegmentCursor`, and all 3710 bytes of the repair prompt carried no
 * parameter list for it. The model deleted the call and satisfied the compiler
 * instead.
 *
 * Route: `definition()` at the call NAME, then the type enclosing that
 * declaration through the document symbol tree. The alternative was to hover the
 * token left of the dot, which is one round trip cheaper and needs
 * expression-boundary parsing to find where the receiver starts - and a chained
 * receiver like `active_file.metadata.borrow().write` is exactly where text
 * parsing goes wrong. This route also produces the CURSOR the pre-fill engine
 * needs, which the hover route does not.
 *
 * Never throws. A call whose owner does not resolve gets a line naming the call
 * and the reason, never silence.
 */
export async function resolveCallOwners(
  extractor: SurfaceExtractor,
  document: vscode.TextDocument,
  targets: readonly { name: string; line: number; character: number; via: "member" | "type" }[],
  log: (line: string) => void,
  skip?: ReadonlySet<string>,
): Promise<CallOwner[]> {
  const lang = prefillLangFor(document.languageId);
  const uri = document.uri.toString();
  const out: CallOwner[] = [];
  const seen = new Set<string>();
  let looked = 0;
  for (const target of targets) {
    if (out.length >= CALL_OWNER_CAP || looked >= CALL_OWNER_LOOKUP_CAP) {
      // No silent truncation. The remaining calls are named, with which bound
      // stopped the leg, because "this call has no owner" and "this call was
      // never asked about" send a reader of the channel to different places.
      const rest = targets.filter((t) => t.via === "member").slice(looked);
      if (rest.length > 0) {
        log(
          `[repair] call owners: ${rest.length} call(s) not looked up (${rest.map((t) => t.name).join(", ")}):` +
            ` ${out.length >= CALL_OWNER_CAP ? `the keep cap of ${CALL_OWNER_CAP} is full` : `the lookup cap of ${CALL_OWNER_LOOKUP_CAP} is spent`}`,
        );
      }
      break;
    }
    // Types are not calls. The type leg's names are already candidates in their
    // own right and resolve through the ordinary anchor.
    if (target.via !== "member") {
      continue;
    }
    looked++;
    let def;
    try {
      def = await extractor.definition({ uri, line: target.line, character: target.character });
    } catch {
      def = undefined;
    }
    if (!def) {
      log(`[repair] call owner unresolved for \`${target.name}\`: the server gave no definition for the call`);
      continue;
    }
    let symbols: unknown;
    try {
      await vscode.workspace.openTextDocument(vscode.Uri.parse(def.uri));
      symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
        "vscode.executeDocumentSymbolProvider",
        vscode.Uri.parse(def.uri),
      );
    } catch {
      symbols = undefined;
    }
    if (!Array.isArray(symbols) || symbols.length === 0 || !hasDocumentSymbolShape(symbols)) {
      log(`[repair] call owner unresolved for \`${target.name}\`: no usable symbol tree at its definition`);
      continue;
    }
    const found = findEnclosingContainer(
      symbols as unknown as DocumentSymbolLite[],
      { uri: def.uri, line: def.range.startLine, character: def.range.startCharacter },
      (kind) => (lang.containerKinds.has(kind as vscode.SymbolKind) ? "container" : "method"),
    );
    const container = found?.container;
    const typeName =
      container !== undefined && typeof container.name === "string"
        ? lang.receiver.containerName(container.name)
        : undefined;
    if (!container || typeName === undefined || typeName === "") {
      // A FREE function is the common honest answer here, not a failure: a span
      // that calls `parse_config(x)` has no owning type to disclose.
      log(`[repair] call owner unresolved for \`${target.name}\`: its definition sits inside no type (a free function, or a tree with no container)`);
      continue;
    }
    // A generic PARAMETER is not a call owner. `T` passes both filters below -
    // it sits in no stop set and it is capitalized - so it was pushed with a
    // cursor and spent one of the two KEEP slots, which under a cap is an
    // eviction of something real. NOTHING DOWNSTREAM REFUSED IT, and the
    // contract this was written from said something else: the
    // provenance rule tests `defUri` against the rust sysroot
    // (`crossFileShape.ts:252`, wired at `fnGen.ts:4274`, applied at
    // `fnGen.ts:2915`), and a parameter anchored at a workspace impl header has
    // a workspace def. So the wrong owner reached the prompt, and the defect was
    // worse than the entry claimed rather than covered by luck.
    //
    // Single letter, deliberately not "short", and the rule is not re-derived
    // here. `crossFileShape.ts:1016-1024` carries the measurement - 621 files of
    // the Rust corpus declare no single-letter struct, enum, trait or union, and
    // all 17 single-letter field positions in it are parameters - and
    // `compilerDirected.ts:491` applies the same test inline. `Ok`, `Vec`, `T1`
    // and `Kind` are real names and over-correcting to them would cost far more
    // than the noise does.
    //
    // GO IS THE EXCEPTION, at the same citation and for the reason written
    // there: the Go standard library declares 186 single-letter structs,
    // `testing.T`, `testing.B`, `testing.F` and `testing.M` among them. See
    // `PrefillLang.singleLetterOwnerIsReal` for what the exception can and
    // cannot reach today.
    //
    // THE ROUND TRIP IS NOT SAVED AND THE LEG SPENDS MORE OF THEM. Both halves
    // stated, because the first one alone reads as "cost unchanged" and the cost
    // went up. The parameter's name is only known AFTER `definition()` and the
    // symbol walk have both run, since this leg resolves the call and then reads
    // its enclosing container's name, so there is no earlier seam here to refuse
    // at. And because the refusal frees the keep slot, the loop no longer breaks
    // at `CALL_OWNER_CAP` and runs on against `CALL_OWNER_LOOKUP_CAP`. Measured
    // on target order `T U K V E S`: 2 lookups before this line, 6 after,
    // keeping nothing either way. On `T U Alpha Beta Gamma Delta`: 2 before, 4
    // after, and the two extra round trips buy `Alpha` and `Beta`. That is the
    // trade, and the lookup cap is what bounds it. What the refusal frees is the
    // keep slot and the wrong owner in the prompt.
    if (lang.singleLetterOwnerIsReal !== true && /^[A-Z]$/.test(typeName)) {
      log(`[repair] call owner for \`${target.name}\` is \`${typeName}\`, a generic parameter and not a type; not disclosed`);
      continue;
    }
    // The std filter, and it is not a nicety. Measured over 61 real call sites
    // in `acme-db`, the route resolves an owner 92% of the time and 18 of
    // the 56 owners it found were Vec, `String`, `HashMap`, `Duration`,
    // PathBuf, Option, `Result`, Box, `RefCell`, `BTreeMap`, `VecDeque`.
    // Every one of those spends a resolver round trip and a slot of a cap of
    // four to tell the model what `Vec::push` does. The same per-language stop
    // set `spanTypesInPlay` applies, applied here.
    if (stopNamesFor(document.languageId).has(typeName) || !/^[A-Z]/.test(typeName)) {
      log(`[repair] call owner for \`${target.name}\` is \`${typeName}\`, a standard-library type; not disclosed`);
      continue;
    }
    if (seen.has(typeName) || skip?.has(typeName) === true) {
      log(`[repair] call owner for \`${target.name}\` is \`${typeName}\`, already disclosed by another leg; not repeated`);
      continue;
    }
    seen.add(typeName);
    const at = container.selectionRange?.start ?? container.range?.start;
    if (at === undefined) {
      log(`[repair] call owner unresolved for \`${target.name}\`: \`${typeName}\` has no declaration position to anchor at`);
      continue;
    }
    out.push({ member: target.name, name: typeName, cursor: { uri: def.uri, line: at.line, character: at.character } });
  }
  return out;
}

function enclosingContainer(
  lang: PrefillLang,
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
): DocumentSymbolLite | undefined {
  const symbols = resolved.symbols;
  if (!Array.isArray(symbols) || symbols.length === 0 || !hasDocumentSymbolShape(symbols)) {
    return undefined;
  }
  const head = document.positionAt(resolved.span.start);
  const found = findEnclosingContainer(
    symbols as unknown as DocumentSymbolLite[],
    { uri: document.uri.toString(), line: head.line, character: head.character },
    (kind) => (lang.containerKinds.has(kind as vscode.SymbolKind) ? "container" : "method"),
  );
  return found?.container;
}

// The visibility pass's removals, one entry per type it took members from, in
// first-seen order. The walk reaches collaborators as well as the root, and a
// line that pooled them would name members without saying whose surface they
// left.
function groupByType(
  hidden: ReadonlyArray<{ type: string; member: { name: string } }>,
): Array<[string, string[]]> {
  const byType = new Map<string, string[]>();
  for (const h of hidden) {
    const names = byType.get(h.type);
    if (names) {
      names.push(h.member.name);
    } else {
      byType.set(h.type, [h.member.name]);
    }
  }
  return [...byType];
}

// Why a kept candidate produced no block, told apart at the one place the two
// causes are still distinguishable. A renderer returning undefined after the
// resolver derived real members is not an unresolved type: `goShapeBlock` and
// `pyShapeBlock` return undefined for any empty method list, so a Go type with
// fields and no methods would otherwise be reported as never resolved, pointing
// the reader at the wrong subsystem.
//
// Asks the SAME question the shape-path gate asks, `admitsEmptyShape` included,
// and takes `lang` for no other reason. A Rust enum admitted on its declaration
// and then evicted by the shared data-shape budget was reported as "nothing
// renderable" while the line above it said the walk had dropped it: two lines
// about one type, disagreeing, in the channel every zero-byte count in this
// project is derived from (7 rows over 5 enums).
//
// The THIRD reason is the same defect one door over, found while
// measuring the budget. `sharedWalk.visited` is shared across a prompt's walks BY
// DESIGN, so a type an earlier walk already emitted makes its own walk emit
// nothing — and was being reported as starved by the budget while its declaration
// sat in the prompt. Four rows on the acme corpus, identical at every budget
// from 300 to 1200 and identical in the v38 baseline, which is how they were
// caught: no budget moved them. They inflated the starvation count
// from 17 to 21 before anyone read the surface they were supposed to be missing.
//
// `visited` can only hold this type from an EARLIER walk here: a walk that emitted
// it would have produced a block, and this function is reached only when the
// renderer produced none.
function noBlockReason(
  lang: PrefillLang,
  derived: DerivedType | undefined,
  sharedWalk: SharedWalkState,
  type: string,
): string {
  if (sharedWalk.visited.has(type)) {
    return "already emitted by an earlier walk in this prompt (shared visited set), so it renders no block of its own";
  }
  if (
    derived &&
    (derived.methods.length > 0 || derived.fields.length > 0 || lang.admitsEmptyShape?.(derived) === true)
  ) {
    return "surface resolved but nothing rendered within the shared budget";
  }
  return "nothing renderable (no fields or members resolved)";
}

// fs.readFileSync as a total function: the file's text, or undefined when it
// cannot be read (a deleted/permission-denied def file is a stop edge, not a throw).
function safeReadFile(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

// A document offset as the cursor shape the extractor seam takes.
function cursorAt(document: vscode.TextDocument, offset: number): { uri: string; line: number; character: number } {
  const pos = document.positionAt(offset);
  return { uri: document.uri.toString(), line: pos.line, character: pos.character };
}

// A SAFE reference cursor for `type`: the first CODE occurrence inside the
// target's own span (its signature), else on a `use` import line, else — for a
// same-file type named only in the doc — its OWN definition site. Never an
// arbitrary body/doc occurrence (a bare first-match can land on a DIFFERENT
// same-named type and resolve the wrong shape). definition() at a type's own def
// resolves to itself, so anchoring there is safe. undefined when no safe
// reference is found.
//
// The span scan runs on raw text, so before `firstCodeOccurrence` it also saw
// COMMENTS, and the v36 backtick gesture puts the name in a body comment by
// construction. rust-analyzer and the TypeScript language service both resolve
// nothing at a comment position, so that anchor injected an empty payload AND
// pre-empted the import line that would have injected the whole type.
function findTypeReference(
  type: string,
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
  fullText: string,
  localTypeDefs: Map<string, { line: number; character: number }>,
): { uri: string; line: number; character: number } | undefined {
  const useLine = /^(?:pub\s*(?:\([^)]*\))?\s+)?use\s/;
  const spanStart = resolved.span.start;
  const headText = fullText.slice(spanStart, resolved.span.end);
  const word = new RegExp(`\\b${type}\\b`);
  let offset = -1;
  const inSpan = firstCodeOccurrence(headText, "rust", type);
  if (inSpan !== undefined) {
    offset = spanStart + inSpan;
  } else {
    let scan = 0;
    // A grouped import's CONTINUATION lines count, not just the line that starts
    // with `use`. rustfmt wraps any group past its width limit one type per line:
    //
    //   use rcgen::{
    //       BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose,
    //   };
    //
    // Only the first line starts with `use`, and it carries none of the names. So a
    // scan that tested each line in isolation could never anchor a type from a
    // wrapped group - which is the dominant shape in real Rust, and it made the
    // whole ambient-import tier of the prefill dead on arrival there.
    //
    // `typesFromUses` already accumulates these statements, and its comment says
    // so, which is what made the disagreement invisible: the candidate LIST
    // contained names the anchor finder could not reach, and the honest
    // "no anchor found" line was hidden behind the type cap dropping them first.
    // Found by item 1's own accounting on `acme_crypto::create_ca`, where
    // `CertificateParams` - the type that function is entirely about - reached the
    // loop only once stdlib refusals stopped spending its slot.
    let inUse = false;
    for (const rawLine of fullText.split("\n")) {
      const trimmed = rawLine.trim();
      if (useLine.test(trimmed)) {
        inUse = true;
      }
      if (inUse) {
        const m = word.exec(rawLine);
        if (m !== null) {
          offset = scan + m.index;
          break;
        }
        // The statement ends at its semicolon. Tracked so a type named in
        // ordinary code below the imports is never mistaken for an imported one.
        if (trimmed.includes(";")) {
          inUse = false;
        }
      }
      scan += rawLine.length + 1; // +1 for the split newline
    }
  }
  if (offset < 0) {
    // A doc-only same-file type: anchor at its own definition (self-resolving).
    const localDef = localTypeDefs.get(type);
    if (localDef) {
      return { uri: document.uri.toString(), line: localDef.line, character: localDef.character };
    }
    return undefined;
  }
  const pos = document.positionAt(offset);
  return { uri: document.uri.toString(), line: pos.line, character: pos.character };
}

// The injection block for a resolver-derived type: its data-shape (the bounded
// walk over the resolver's cross-file graph, each reachable type's struct def
// once) plus its METHOD list (the root's real signatures, member-capped with
// drop logging). Pure and synchronous — the async resolve already happened, so
// the walk is a Map lookup. Empty when the type carries neither shape nor
// methods (the honest degrade). For fn-gen, nested-type methods are NOT injected
// (only the signature-named root's), a deliberate scope choice. For test-gen
// (profile.constructors), nested CONSTRUCTORS are injected too, since the test must
// build those types.
function shapeBlock(
  type: string,
  shape: CrossFileShape,
  sharedWalk: SharedWalkState,
  log: (line: string) => void,
  profile: PrefillProfile,
): RenderedBlock | undefined {
  const derived = shape.types.get(type);
  if (!derived) {
    return undefined;
  }
  // Methods (already rendered signatures from the resolver), member-capped.
  let methods = derived.methods;
  if (methods.length > profile.memberCap) {
    const dropped = methods.slice(profile.memberCap);
    methods = methods.slice(0, profile.memberCap);
    log(`[fngen] pre-fill truncated \`${type}\` members: kept ${profile.memberCap} of ${derived.methods.length} (dropped ${dropped.join(", ")})`);
  }
  const signatures = methods.join("\n");

  // The data-shape half: the SAME bounded walk (dataShape.ts), now over the
  // cross-file graph. Emits the root's struct def plus each reachable field-type's
  // def within the bound, each once. Degrades to nothing when the root has no
  // derived struct text (the honest fallback). v40: a def breaching TOK_MAX or
  // the shared cross-candidate budget is now brace-safe truncated (with a
  // `... N more fields` marker) by walkDataShape itself, at render time,
  // instead of dropped whole - see the walk's own doc comment in dataShape.ts
  // for the render-time-truncation design. `dropped` below now names only
  // defs that did not fit AT ALL, even truncated.
  let dataShape: string | undefined;
  const walk = walkDataShape(type, toResolveStruct(shape), profile.dataShape, sharedWalk);
  if (walk.block) {
    dataShape = `Data shape of \`${type}\` (fields and types, nested):\n${fenceFor(walk.block)}rust\n${walk.block}\n${fenceFor(walk.block)}`;
  }
  // No silent truncation: name the field-types a cap dropped entirely. Outside
  // the block-produced branch on purpose — the walk returns an EMPTY block
  // exactly when the root's own def breached the budget so hard even a
  // truncated shell did not fit, so total loss of the data shape is the one
  // case a nested log would never report. The member list still renders, so
  // the type counts as injected and the drop accounting stays balanced while
  // the human silently loses every field.
  if (walk.dropped.length > 0) {
    log(`[fngen] data-shape walk \`${type}\` dropped ${walk.dropped.length}: ${droppedNames(walk.droppedBy, profile.dataShape)}`);
  }

  const parts: string[] = [];
  if (dataShape) {
    parts.push(dataShape);
  }
  const api = assembleSurfacePayload({ typeOrCrate: type, signatures: signatures.length > 0 ? signatures : undefined, omitInstruction: true });
  if (api) {
    parts.push(api);
  }
  // test-gen: the constructors of the NESTED types (the root's own methods already
  // render above), so a private-field type is built via its `::new`. Each line is
  // `Type::sig`, member-capped across the graph.
  if (profile.constructors) {
    const ctors = nestedConstructors(shape, type);
    if (ctors) {
      parts.push(
        `Constructors for the nested types (build via these, NOT struct literals — some fields are private):\n${fenceFor(ctors)}rust\n${ctors}\n${fenceFor(ctors)}`,
      );
    }
  }
  // Every header here names the ROOT: the nested-type text rides inside the
  // root's own data-shape and constructor blocks rather than under headers of
  // its own.
  return parts.length > 0 ? { text: parts.join("\n\n"), types: [type] } : undefined;
}

// ---------------------------------------------------------------------------
// The per-language prefill seam. Candidate finding, reference
// anchoring, resolver hooks, and block rendering are language-shaped; the
// ORCHESTRATION in resolvePrefill is not, so it dispatches through this table
// instead of branching. The Rust entry is the frozen helpers verbatim
// (Rust prompt bytes stay byte-identical); the TS entry is unpinned.
// ---------------------------------------------------------------------------

interface PrefillLang {
  /** This language's OWN aggregate data-shape budget, when it needs one. Absent
   *  means the gesture profile's shared `totalTok` governs, which is every
   *  language except C#. See CS_DATASHAPE_TOTAL_TOK for why C# is the exception
   *  and why it is currently the same number. */
  dataShapeTotalTok?: number;

  // THE THREE CAPS ARE NOT HERE ANY MORE. `typeCap`, `resolveCap` and
  // `provenanceCap` used to be per-language fields on this interface; they are
  // now three of the six numbers ONE context stop resolves, and they arrive
  // through `budgetProfileFor`.
  //
  // The per-language measurements that put them here are not refuted, they are
  // outranked. Go's own cap ladder (907 authored rows, six repositories) put
  // its knee at 8 against Rust's shipped 4, and the ruling of 2026-08-10 was to
  // bring every language up rather than keep a per-language table: Rust's own
  // 4->12 ladder measured FLAT only because it ran with the token budget
  // pinned, and raising the cap alone was measured to only relocate
  // the loss. In the dial roots and budget move together, so the condition
  // under which Rust measured flat does not hold.

  /** Module-scope type defs (name -> anchor) for the doc-only-local-type case. */
  localTypeDefs(fullText: string, localDefs: Set<string>): Map<string, { line: number; character: number }>;
  /** Prioritized candidate types: signature/doc first, ambient imports last.
   *  `excludeName` is the declared symbol — never a candidate (Defect 1).
   *  `spanText` is the target's own span, the source for the backticked
   *  comment-name gesture; empty means the caller withheld it (test-gen) and
   *  the leg contributes nothing. */
  candidates(
    signature: string,
    docComment: string | undefined,
    fullText: string,
    localTypeNames: Set<string>,
    excludeName: string | undefined,
    spanText: string,
  ): string[];
  /** How this language's signatures spell a receiver, a return type, and a
   *  container symbol's name. */
  receiver: SignatureRules;
  /** The symbol kinds that can be the enclosing TYPE. A namespace, module or
   *  function also encloses the cursor and is never a receiver. */
  containerKinds: ReadonlySet<vscode.SymbolKind>;
  /** A SAFE reference cursor for one candidate type. */
  typeReference(
    type: string,
    document: vscode.TextDocument,
    resolved: ResolvedFunction,
    fullText: string,
    localTypeDefs: Map<string, { line: number; character: number }>,
  ): { uri: string; line: number; character: number } | undefined;
  /** Hooks for the ONE cross-file resolver (undefined = the Rust defaults). */
  shapeHooks?: CrossFileShapeHooks;
  /** Render one resolver-derived type's injection block, and report which types
   *  it put a header on. The two are not the same list: the C# render emits the
   *  root AND every collaborator the walk resolved, and the instruction's scope
   *  is what rendered. The renderer is the only place that knows. */
  renderShapeBlock(
    type: string,
    shape: CrossFileShape,
    sharedWalk: SharedWalkState,
    log: (line: string) => void,
    profile: PrefillProfile,
  ): RenderedBlock | undefined;
  /** Worked-example fallback for a type the resolver cannot derive (the Rust
   *  fastbloom path). TS is signatures-only by contract: no example leg. */
  exampleFallback: boolean;
  /** The one instruction closing the injected surface, scoped to the types whose
   *  blocks actually rendered. Not "the receiver": a payload can carry none. */
  firmInstruction(types: readonly string[]): string;
  /** Did this type's surface reach the prompt with its own INCOMPLETENESS still
   *  marked on it? A type that answers yes renders its block as usual and is then
   *  left out of the instruction's ONLY list, because the surface above is one the
   *  language server has itself declared partial and the sentence would forbid
   *  everything off a list that is admittedly short.
   *
   *  Rust only, and only because rust-analyzer is the one server measured writing
   *  a truncation marker into a hover (`/* … *\/` where the rest of a member list
   *  would be). Absent (TS/C#/Python/Go): every rendered type is named, byte for
   *  byte as before. Absent is not an oversight to fill in by analogy — a
   *  language earns this the day someone measures its server eliding something. */
  surfaceTruncated?: (derived: DerivedType) => boolean;
  /** How this language spells "the target may call this member", and whose
   *  privates the target can already see. Undefined (Python) means it spells it
   *  nowhere and the surface does not change. */
  memberVisibility?: LanguageVisibility;
  /** Is a SINGLE-LETTER enclosing container a real type in this language, or a
   *  generic parameter? Absent means parameter, which is `resolveCallOwners`'s
   *  refusal; `true` means the leg keeps it.
   *
   *  Go is the only language that sets it, and the measurement is
   *  `crossFileShape.ts:1016-1024`, not a re-derivation: the Go standard library
   *  declares 186 single-letter structs, `testing.T`, `testing.B`, `testing.F`
   *  and `testing.M` among them, and a Go repair genuinely wants that receiver
   *  disclosed. `goShapeHooks.skipCandidate` guards the same door on the field
   *  leg with a qualifier-aware rule; it cannot be reused here, because a
   *  container walk reports the declaring symbol's bare name and there is no
   *  field type as written to read a `.` out of.
   *
   *  WHAT IT REACHES TODAY IS NOTHING, and a blind oracle measured it rather
   *  than assuming it: `resolveCallOwners` resolves no
   *  owner for Go at all, for any type. `GO_RULES.containerName` is `() =>
   *  undefined` (`receiver.ts:332`) because a Go method is declared at package
   *  scope with its receiver in the signature, so every Go call reaches the
   *  free-function line before any name filter runs. This flag guards a shut
   *  door, exactly as `goShapeHooks.skipCandidate` did before the field leg was
   *  lit. It is here so that opening the door is a deliberate red row
   *  rather than a silent regression on `testing.T`. */
  singleLetterOwnerIsReal?: boolean;
  /** Is a ROOT candidate whose definition is at this URI one the model already
   *  knows, so the prefill must render nothing for it?
   *
   *  Provenance, never a name set: the resolver reports where the type was
   *  defined and that is the honest test of foreign-and-famous against
   *  project-local. Rust answers with its sysroot; the other four languages
   *  leave it absent, which keeps their surfaces byte-identical. Absent is not
   *  an oversight to fill in by analogy - each language needs its own
   *  measurement before its budget is reallocated. */
  isStdlibDef?: (defUri: string) => boolean;
  /** May a derived type with NO fields and NO methods still take the shape path?
   *
   *  The default is no, and that default is load-bearing: an empty shape is
   *  usually a library type whose hover elides its body to a private-fields
   *  comment, and a stub for it points the model at a surface that does not
   *  exist.
   *
   *  A language answers yes only for a kind whose SIGNATURE is itself the
   *  complete surface. Rust's enum is the one such kind found so far, and it is
   *  the only entry that sets this. The other four are absent on purpose, not by
   *  oversight: C# already reaches its variants through the `enumMemberLine`
   *  hook, and Go, Python and TypeScript each need their own measurement before
   *  their prompts move by a byte. */
  admitsEmptyShape?: (derived: DerivedType) => boolean;
  /** PRICE THE WHOLE PROMPT'S MEMBER BLOCKS, before any data-shape block spends
   *  the shared aggregate. Present for exactly one language, and the reason is
   *  structural rather than stylistic: C# is the only one whose MEMBER blocks
   *  come out of the same per-prompt character aggregate its data-shape blocks
   *  come out of. Go's member half and Python's never touch it, so neither can
   *  lose a member list to a shape block and neither needs a floor.
   *
   *  Returns one charged char count per candidate, in the render order it was
   *  handed, priced UN-SHED - the member render a developer had before the field
   *  leg existed. Un-shed is the point: the floor is the surface they already
   *  have, and a shape block that renders sheds fields out of the member block it
   *  reserved for, so the real spend is always at or under the price.
   *
   *  `totalChars` is the aggregate the pricing pass is allowed to spend, so a
   *  width where the member half alone already overran the budget prices only the
   *  blocks that fit. Nothing is owed to a type that had no block to begin with.
   *
   *  WHY THE CALLER OWNS THIS and `csShapeBlock` cannot. The aggregate is spent
   *  ACROSS ROOTS: by the time a starved root is rendered, the earlier roots'
   *  shape blocks have already taken it. A reservation inside the renderer was
   *  built and reverted for exactly that reason. */
  priceMemberBlocks?: (
    candidates: readonly { type: string; shape: CrossFileShape | undefined }[],
    profile: PrefillProfile,
    totalChars: number,
  ) => number[];
  /** WHICH OF THE DIAL'S STRUCTURAL NUMBERS ACTUALLY REACH THIS LANGUAGE.
   *
   *  Not decoration: the channel line names what a stop bought, and three of the
   *  five languages cannot spend most of it. The renderers say so themselves -
   *  `goShapeBlock` and `pyShapeBlock` take `_sharedWalk` and never read
   *  `profile.dataShape`, and `csShapeBlock` reads the shared budget but has no
   *  data-shape walk either. So:
   *
   *  - `walk` (rust, typescript): every number binds. `walkDataShape` runs with
   *    D_MAX/B_MAX/N_MAX/TOK_MAX and charges the aggregate budget.
   *  - `graph` (csharp): no walk, so breadth reaches nothing, and the gather's
   *    depth and total-type bound are unobservable - C# projects a collaborator
   *    graph through member signatures (`signatureRefTypes`), and the shared
   *    budget cuts that graph off before the gather's caps bite. MEASURED, not
   *    reasoned: a 60-collaborator root rendered byte-identically at all five
   *    stops with the gather bound raised from `totalTypes + 6` to
   *    `totalTypes + 200`. Roots, the budget and the member cap do bind.
   *  - `signatures` (go, python): the root's member list and nothing else. The
   *    gather has no field edges and no signature edges, so depth, breadth and
   *    the total-type cap are all inert, and the aggregate budget reaches this
   *    language only through the derived MEMBER cap.
   *
   *  A language that grows a walk moves its own entry, and the channel line
   *  follows. It is here rather than beside the log call because the renderer is
   *  the thing that decides it. */
  dialReach: "walk" | "graph" | "signatures";
  /** This language's ROOT cap AT THE `shipped` STOP ONLY, when the pre-dial
   *  product gave it one of its own.
   *
   *  A FAITHFUL RECORD OF THE PRE-DIAL POINT, NOT A LIVE EXCEPTION. `shipped`
   *  exists for one job - being the honest before-side of a measurement - and
   *  Go shipped 8 roots where every other language shipped 4 (the v42 authored-
   *  gesture funnel). A `shipped` stop that handed Go 4 would replay a point the
   *  product never shipped, and this project has been bitten repeatedly by a
   *  harness measuring fiction.
   *
   *  It does NOT reintroduce a per-language table for the user-facing stops:
   *  `small`..`frontier` keep one root cap for every language (ruled
   *  2026-08-10), which is why this is read only when the stop is `shipped`. */
  shippedRootCap?: number;
  /** May the GATHER stop at the same per-node field fan-out the RENDER applies?
   *  Opt-in per language, because it is only sound where nothing downstream can
   *  read a type the render's own BFS cannot reach.
   *
   *  Go can: `goShapeBlock` renders one data-shape block (through
   *  `walkDataShape`, which walks at most `B_MAX` local field types per node)
   *  plus the ROOT's member list, and nothing else in the prompt ever names a
   *  collaborator. C# cannot: `csShapeBlock` gives EVERY type in the shape its
   *  own member block, reachable by the field BFS or not, so the gather is its
   *  supply and capping it would delete prompt bytes.
   *
   *  Measured before it was wired. The capture file did not survive, so this
   *  comment is the record: over 20 real `pgx` roots the Go gather resolved 117
   *  types, of which 31 were outside the render's BFS at any budget - 11 of the
   *  26 on `Conn` alone. Each
   *  one costs a definition, a hover and a documentSymbol, and a hover into a
   *  package gopls has not type-checked measured 71-76ms. */
  gatherBreadth?: boolean;
}

/** One rendered injection block and the types whose headers it carries. */
interface RenderedBlock {
  text: string;
  types: string[];
}

// The instruction for the languages whose block vocabulary is "Members of ...".
// Same two jobs as the Rust one (`firmInstructionFor`): name the types the
// constraint applies to, and say plainly that it does not reach the rest of the
// file. `noun` is what that language calls the things a type carries, which is
// the only part that differs between them.
const membersInstruction = (types: readonly string[], noun: string) =>
  `Use ONLY the members and types ${ofTypes(types, "that appear in the surface above")}. ` +
  `Do not invent ${noun} beyond that surface. Everything else in the file is unaffected by this: ` +
  `other values in scope, this function's own locals, sibling functions, and standard-library ` +
  `types stay allowed.`;

// TS-OWNED prompt text: unpinned constants, free to word honestly. Never
// shared with the frozen Rust constants they parallel.
const TS_FIRM_INSTRUCTION = (types: readonly string[]) => membersInstruction(types, "members, fields, or types");

// The TS candidate list, mirroring the Rust prioritization: signature/doc
// PascalCase first, then doc-referenced local types, then import specifiers
// LAST — with lib.d.ts names filtered instead of the Rust prelude, and bare
// single-letter names filtered too (a generic parameter like `T` resolves to
// tsserver type-parameter chrome, never a user shape; the
// resolver's refuseHover hook backstops multi-letter generic params).
// Exported for the impl oracle.
export function tsPrioritizedTypes(
  signature: string,
  docComment: string | undefined,
  fullText: string,
  localTypeNames: Set<string>,
  excludeName?: string,
  spanText = "",
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (names: string[]) => {
    for (const n of names) {
      if (!seen.has(n) && !TS_STD_TYPE_NAMES.has(n) && !/^[A-Z]$/.test(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  };
  push(typesNamedIn(signature, docComment, excludeName, TS_STD_TYPE_NAMES));
  push(commentTypesIn(spanText, "typescript", excludeName, prefillStopNamesFor("typescript")));
  push(referencedLocalSymbols(signature, docComment, localTypeNames));
  push(tsTypesFromImports(fullText));
  return out;
}

// A SAFE TS reference cursor for `type`: the first CODE occurrence inside the
// target's own span, else on an `import` line, else — for a same-file type
// named only in the doc — its OWN definition site. The same never-an-arbitrary-
// occurrence rule as the Rust findTypeReference, with import lines standing in
// for `use` lines, and the same comment refusal in the span leg.
function tsFindTypeReference(
  type: string,
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
  fullText: string,
  localTypeDefs: Map<string, { line: number; character: number }>,
): { uri: string; line: number; character: number } | undefined {
  const importLine = /^import\b/;
  const spanStart = resolved.span.start;
  const spanText = fullText.slice(spanStart, resolved.span.end);
  const word = new RegExp(`\\b${type}\\b`);
  let offset = -1;
  const inSpan = firstCodeOccurrence(spanText, "typescript", type);
  if (inSpan !== undefined) {
    offset = spanStart + inSpan;
  } else {
    let scan = 0;
    // The Rust leg's defect, in its TypeScript twin. Prettier wraps a named
    // import past its print width one specifier per line:
    //
    //   import {
    //     BasicConstraints,
    //     CertificateParams,
    //   } from "./pki";
    //
    // Only the first line starts with `import` and it carries none of the names,
    // so testing each line in isolation could never anchor a wrapped specifier.
    // Swept here when the Rust one was fixed rather than left for the next
    // session to rediscover, because it is the same bug and the same shape.
    //
    // The statement ends at its `from` clause or its semicolon, whichever the file
    // spells; `;` alone is enough, and a side-effect import (`import "./x";`)
    // opens and closes on one line.
    let inImport = false;
    for (const rawLine of fullText.split("\n")) {
      const trimmed = rawLine.trim();
      if (importLine.test(trimmed)) {
        inImport = true;
      }
      if (inImport) {
        const m = word.exec(rawLine);
        if (m !== null) {
          offset = scan + m.index;
          break;
        }
        if (trimmed.includes(";") || /\bfrom\b/.test(trimmed)) {
          inImport = false;
        }
      }
      scan += rawLine.length + 1; // +1 for the split newline
    }
  }
  if (offset < 0) {
    const localDef = localTypeDefs.get(type);
    if (localDef) {
      return { uri: document.uri.toString(), line: localDef.line, character: localDef.character };
    }
    return undefined;
  }
  const pos = document.positionAt(offset);
  return { uri: document.uri.toString(), line: pos.line, character: pos.character };
}

// The TS injection block for a resolver-derived type: data shape + member list,
// both ts-fenced, signatures-only. When the member cap truncates, the header
// says so (the honest subset wording — a capped list must never read as the
// exhaustive surface). Sibling of the Rust shapeBlock, which stays frozen.
//
// A type alias of a PRIMITIVE injects its def and no member list. Its members
// resolve to the underlying primitive's prototype and nothing of its own:
// `type SuppressionKind = "bound-unsafe" | "comment-introduced" | "in-comment" |
// "below-floor"` returns 48, `toString(): string` through `matchAll`, every one
// of them `String`'s. Measured over this repo's own source: 26 of its 55
// exported type aliases are that shape, and the member leg costs 1112 bytes
// against a 161-byte def, so 87% of such a candidate's block is a surface the
// model already knows and the def line already bounds.
//
// The refusal is HERE and not in the walk, which would be cheaper: the admission
// loop takes the shape path only for a candidate that resolved fields or
// methods, and a primitive alias has no fields, so a walk that returned no
// members would drop the whole block — def line included — and TS has no
// worked-example leg to fall back to. The def is the half worth keeping.
function tsShapeBlock(
  type: string,
  shape: CrossFileShape,
  sharedWalk: SharedWalkState,
  log: (line: string) => void,
  profile: PrefillProfile,
): RenderedBlock | undefined {
  const derived = shape.types.get(type);
  if (!derived) {
    return undefined;
  }
  const cappedLine = cappedMemberLine(type, derived);
  if (cappedLine !== undefined) {
    log(cappedLine);
  }
  const primitiveAlias = isPrimitiveAliasHover(derived.signature);
  let methods = primitiveAlias ? [] : derived.methods;
  let memberHeader = `Members of \`${type}\` (real signatures, use these exact names, do not invent):`;
  if (primitiveAlias && derived.methods.length > 0) {
    // Said as a REFUSAL, and it must never read as the truncation line below: a
    // reader auditing this channel has to be able to tell a real surface being
    // cut from one that was never worth carrying.
    log(
      `[fngen] pre-fill refused \`${type}\` members: an alias of a primitive resolves that primitive's` +
        ` prototype (${derived.methods.length} members, none of them \`${type}\`'s own), and its def line is` +
        ` the whole surface, so no member list was capped away here`,
    );
  } else if (methods.length > profile.memberCap) {
    const dropped = methods.slice(profile.memberCap);
    methods = methods.slice(0, profile.memberCap);
    memberHeader = `Members of \`${type}\` (a subset — the first ${profile.memberCap} of ${derived.methods.length}; real signatures, use these exact names, do not invent):`;
    log(`[fngen] pre-fill truncated \`${type}\` members: kept ${profile.memberCap} of ${derived.methods.length} (dropped ${dropped.join(", ")})`);
  }

  // v40: a def breaching TOK_MAX or the shared cross-candidate budget is now
  // brace-safe truncated by walkDataShape itself, at render time - see
  // shapeBlock's comment above and the walk's own doc comment in dataShape.ts.
  const parts: string[] = [];
  const walk = walkDataShape(type, toResolveStruct(shape, tsShapeHooks), profile.dataShape, sharedWalk);
  if (walk.block) {
    parts.push(`Data shape of \`${type}\` (fields and types, nested):\n${fenceFor(walk.block)}ts\n${walk.block}\n${fenceFor(walk.block)}`);
  }
  // Hoisted out of the block-produced branch for the reason given in shapeBlock:
  // an empty block IS the total-loss case, and it is the one that must not be
  // silent.
  if (walk.dropped.length > 0) {
    log(`[fngen] data-shape walk \`${type}\` dropped ${walk.dropped.length}: ${droppedNames(walk.droppedBy, profile.dataShape)}`);
  }
  if (methods.length > 0) {
    parts.push(`${memberHeader}\n${fenceFor(methods.join("\n"))}ts\n${methods.join("\n")}\n${fenceFor(methods.join("\n"))}`);
  }
  return parts.length > 0 ? { text: parts.join("\n\n"), types: [type] } : undefined;
}

// The symbol kinds that can be the type enclosing a member. A NAMESPACE also
// contains the cursor and is not a type, so the walk is filtered on kind rather
// than on name — a name list cannot tell a namespace from a class.
const TYPE_CONTAINER_KINDS: ReadonlySet<vscode.SymbolKind> = new Set([
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Struct,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Enum,
]);
// Rust adds Object: rust-analyzer reports an `impl` block as an untyped object
// symbol, and the struct it belongs to is that node's SIBLING, never its
// ancestor, so the impl node is the only thing enclosing a method cursor.
const RUST_CONTAINER_KINDS: ReadonlySet<vscode.SymbolKind> = new Set([
  ...TYPE_CONTAINER_KINDS,
  vscode.SymbolKind.Object,
]);

const RUST_PREFILL_LANG: PrefillLang = {
  localTypeDefs: localTypeDefinitions,
  candidates: prioritizedTypes,
  receiver: RECEIVER_RULES.rust,
  containerKinds: RUST_CONTAINER_KINDS,
  typeReference: findTypeReference,
  renderShapeBlock: shapeBlock,
  exampleFallback: true,
  firmInstruction: firmInstructionFor,
  surfaceTruncated: (derived) => surfaceStillTruncated(derived.signature),
  memberVisibility: visibilityFor("rust"),
  isStdlibDef: isRustSysrootDef,
  admitsEmptyShape: isSelfDescribingDeclaration,
  dialReach: "walk",
};

const TS_PREFILL_LANG: PrefillLang = {
  localTypeDefs: (fullText) => tsLocalTypeDefinitions(fullText),
  candidates: tsPrioritizedTypes,
  receiver: RECEIVER_RULES.typescript,
  containerKinds: TYPE_CONTAINER_KINDS,
  typeReference: tsFindTypeReference,
  shapeHooks: tsShapeHooks,
  renderShapeBlock: tsShapeBlock,
  exampleFallback: false,
  firmInstruction: TS_FIRM_INSTRUCTION,
  memberVisibility: visibilityFor("typescript"),
  dialReach: "walk",
};

// C#-OWNED prompt text: unpinned constants, never shared
// with the frozen Rust constants they parallel.
const CS_FIRM_INSTRUCTION = (types: readonly string[]) => membersInstruction(types, "members, fields, or types");

/** The class/struct/interface/enum/record definitions in C# source, name -> the
 *  cursor at the type name — the C# sibling of localTypeDefinitions /
 *  tsLocalTypeDefinitions. Leading whitespace is tolerated so a type declared
 *  inside a block-bodied `namespace { }` (indented) still anchors; a comment line
 *  never anchors. The anchor lets a doc-only same-file type resolve at its OWN
 *  definition site. */
export function csLocalTypeDefinitions(source: string): Map<string, { line: number; character: number }> {
  const defs = new Map<string, { line: number; character: number }>();
  const lines = source.split("\n");
  const decl =
    /^\s*(?:(?:public|internal|private|protected|static|sealed|abstract|partial|readonly|ref|unsafe|new)\s+)*(?:class|struct|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("//")) {
      continue; // never a comment line
    }
    const m = decl.exec(line);
    if (m && !defs.has(m[1])) {
      defs.set(m[1], { line: i, character: line.indexOf(m[1]) });
    }
  }
  return defs;
}

// The C# candidate list, mirroring the TS prioritization: signature/doc
// PascalCase first, then doc-referenced local types, then a `using`-qualified
// reference mined from signature/doc/body, LAST, same
// position the Rust/TS ambient-import tier occupies. A plain `using` brings a
// NAMESPACE, not a type, so unlike Rust/TS there is no type name to read off
// the `using` LINE itself; csTypesFromQualifiedUsage instead reads the
// namespace block as a filter over what the CODE already spells fully
// qualified. BCL names filtered (CS_STD_TYPE_NAMES) and bare single-letter
// generics dropped throughout. Exported for the impl oracle.
export function csPrioritizedTypes(
  signature: string,
  docComment: string | undefined,
  fullText: string,
  localTypeNames: Set<string>,
  excludeName?: string,
  spanText = "",
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // A NAMESPACE the signature writes as a path qualifier is not a candidate.
  // C# spells a type it has no `using` for in full, and `public
  // DataModel.Enums.ThreatLevel GetThreatLevel(...)` is one type, not three. The
  // two namespaces resolve to nothing and still hold slots under the type cap:
  // measured on a real solution, they took two of four and dropped the interface
  // carrying the member the round had to fix. C#-only because C# is the language
  // that capitalizes its namespace segments.
  const namespaces = pathQualifiersIn(signature);
  const push = (names: string[]) => {
    for (const n of names) {
      if (!seen.has(n) && !namespaces.has(n) && !CS_STD_TYPE_NAMES.has(n) && !/^[A-Z]$/.test(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  };
  push(typesNamedIn(signature, docComment, excludeName, CS_STD_TYPE_NAMES));
  push(commentTypesIn(spanText, "csharp", excludeName, prefillStopNamesFor("csharp")));
  push(referencedLocalSymbols(signature, docComment, localTypeNames));
  push(csTypesFromQualifiedUsage(signature, docComment, spanText, fullText));
  return out;
}

// A SAFE C# reference cursor for `type`: the first CODE occurrence inside the
// target's own span, else — for a same-file type named only in the doc, or a
// span that does not carry the reference — its OWN definition site. The same
// never-an-arbitrary-occurrence rule and the same comment refusal as the Rust/TS
// findTypeReference. C# has no import-line leg (usings are namespaces), so it
// falls straight from the span to the local definition.
function csFindTypeReference(
  type: string,
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
  fullText: string,
  localTypeDefs: Map<string, { line: number; character: number }>,
): { uri: string; line: number; character: number } | undefined {
  const spanStart = resolved.span.start;
  const spanText = fullText.slice(spanStart, resolved.span.end);
  const inSpan = firstCodeOccurrence(spanText, "csharp", type);
  if (inSpan !== undefined) {
    const pos = document.positionAt(spanStart + inSpan);
    return { uri: document.uri.toString(), line: pos.line, character: pos.character };
  }
  const localDef = localTypeDefs.get(type);
  if (localDef) {
    return { uri: document.uri.toString(), line: localDef.line, character: localDef.character };
  }
  return undefined;
}

/** Run one data-shape walk against a CEILING lower than the aggregate, and charge
 *  the aggregate by what it really spent.
 *
 *  `walkDataShape` reads `shared.remainingChars` as its ceiling and subtracts
 *  what it rendered, so the whole mechanism is: hand it a smaller ceiling, then
 *  put the withheld part back on top of whatever it left. The alternative was a
 *  second budget field threaded through every walk in the codebase for one
 *  language's benefit.
 *
 *  An allowance at or above `remainingChars` leaves this a pass-through, which
 *  is every language but C# and every non-prefill caller. */
function walkWithinAllowance<T>(sharedWalk: SharedWalkState, allowance: number, run: () => T): T {
  const before = sharedWalk.remainingChars;
  if (allowance >= before) {
    return run();
  }
  sharedWalk.remainingChars = Math.max(0, allowance);
  const out = run();
  sharedWalk.remainingChars = before - (Math.max(0, allowance) - sharedWalk.remainingChars);
  return out;
}

/** Which fields each type may shed from its member list: the ones its OWN
 *  rendered def printed, and only when that def is complete.
 *
 *  A type whose def the walk TRUNCATED (`... N more fields`) sheds nothing. The
 *  walk cuts fields at TOK_MAX and the member list cuts at memberCap; both are
 *  honest caps, and shedding on one side while the other is already cutting is
 *  how a field disappears from both. Fields may be cut from one place or the
 *  other, never from both. */
function shedFromDefs(
  defs: ReadonlyArray<{ name: string; def: string }>,
  shape: CrossFileShape,
): Map<string, Set<string>> {
  const shed = new Map<string, Set<string>>();
  for (const d of defs) {
    const t = shape.types.get(d.name);
    if (t === undefined || t.fields.length === 0 || /\.\.\.\s+\d+\s+more fields/.test(d.def)) {
      continue;
    }
    shed.set(d.name, new Set(t.fields.map((f) => f.name)));
  }
  return shed;
}

/** What C#'s member blocks would cost this prompt if no data-shape block existed
 *  - the pre-leg render, replayed through the same pure renderer that produces
 *  the real one, with nothing shed and the same cross-root dedup.
 *
 *  One number per candidate, in the render order handed in, so the caller can
 *  release each candidate's share the moment that candidate's member render has
 *  happened.
 *
 *  ROOTS ARE PRICED BEFORE COLLABORATORS, and that ordering is the whole
 *  correctness of the floor rather than a nicety.
 *
 *  The aggregate can run out INSIDE this pass. Priced candidate by candidate,
 *  the first candidate's collaborators are charged before the last candidate's
 *  own type is reached, so a tail root prices ZERO, is owed nothing, and an
 *  earlier candidate's shape block then spends exactly what that root's member
 *  list needed. Measured at 6 roots x 20 fields with one shared 12-field
 *  collaborator: `Foxes` ended with neither block.
 *
 *  Roots first is the fix because it matches what the floor is FOR. The
 *  guarantee is that a member surface a developer had BEFORE the field leg is
 *  never what the leg costs them. Every candidate root had a member block before
 *  the leg; a collaborator reached through a FIELD edge did not exist in the
 *  prompt at all until the leg derived it. So a root outranks a collaborator for
 *  the reserve, and the two-pass order says so in the only place that can act on
 *  it.
 *
 *  It is a REPLAY and not an estimate. Anything else and the floor would be a
 *  number nobody can tie back to what a developer actually had. */
function csPriceMemberBlocks(
  candidates: readonly { type: string; shape: CrossFileShape | undefined }[],
  profile: PrefillProfile,
  totalChars: number,
): number[] {
  const visited = new Set<string>();
  const budget = { remaining: totalChars };
  const priced = candidates.map(() => 0);
  const charge = (i: number, names: readonly string[], shape: CrossFileShape): void => {
    const types = names.map((name) => ({ name, methods: shape.types.get(name)?.methods ?? [] }));
    const before = budget.remaining;
    csShapeGraphBlock(types, { memberCap: profile.memberCap, visited, budget });
    priced[i] += before - budget.remaining;
  };
  candidates.forEach(({ type, shape }, i) => {
    if (shape !== undefined) {
      charge(i, [type], shape);
    }
  });
  candidates.forEach(({ type, shape }, i) => {
    if (shape !== undefined) {
      charge(
        i,
        [...shape.types.keys()].filter((n) => n !== type),
        shape,
      );
    }
  });
  return priced;
}

// The C# injection block: a DATA SHAPE for every type whose fields the walk
// derived, then the member signatures, both cs-fenced.
//
// SESSION-V50 PHASE 2 ADDED THE FIRST HALF. C# has derived its fields since v49
// and thrown the shape away, because a Roslyn hover is `class Contoso.Widget`
// and stops there, so there was nothing to print them in. `csRenderDerivedDef`
// synthesises the body from what the walk found, and `walkDataShape` nests the
// collaborators to depth 2 the way it already does for Rust, TypeScript and Go.
//
// THE MEMBER LIST SHEDS WHAT THE SHAPE BLOCK PRINTED, PER TYPE, and Go's guards
// transfer verbatim because they are the reason that trade is safe:
//
//  - no shape block for a type means its member list is byte-identical to today
//    (a walk that resolved nothing must not cost a developer the list they have);
//  - a type whose def the walk TRUNCATED (`... N more fields`) sheds nothing.
//    The walk cuts fields at TOK_MAX and the member list cuts at memberCap; both
//    are honest caps, and shedding on one side while the other is already cutting
//    is how a field disappears from both. Fields may be cut from one place or the
//    other, never from both;
//  - which member lines ARE fields is not guessed from their text. Roslyn writes
//    both a field and a method as `Name : Something`, so a line is a field line
//    exactly when its first token is a name in that type's parsed field list;
//  - shedding is keyed per type. A collaborator's block is decided by ITS own
//    rendered def, never by the root's.
//
// Both blocks still run through the same shared budget, so a fat graph competes
// with itself rather than growing without limit.
function csShapeBlock(
  type: string,
  shape: CrossFileShape,
  sharedWalk: SharedWalkState,
  log: (line: string) => void,
  profile: PrefillProfile,
): RenderedBlock | undefined {
  // Render the ROOT type first, then every recursively-resolved collaborator (Fix
  // 3: the types named in the root's member SIGNATURES — Stripe -> Tile,
  // StripeSummary, LodBand). C# has no data-shape walk (no field body in a hover),
  // so unlike Rust/TS the whole graph is rendered here as one block per type.
  // Without it the model sees `EnrollTile(Tile)` but no `Tile` constructor and
  // invents a wrong call (`Enroll(1, 0)`) — the dogfood failure. csShapeGraphBlock
  // (pure core) renders what it is handed, skips method-less types, and
  // dedups/bounds; the member filtering all happened upstream, over structured
  // members (src/core/memberVisibility.ts).
  //
  // ONE candidate, SEVERAL headers, which is why the emitted names come back
  // through `onEmit`: the instruction's scope is every block in the payload, and
  // a type the budget or the dedup dropped rendered no header to be scoped to.
  const parts: string[] = [];
  const derived = shape.types.get(type);
  // THE MEMBER LIST IS THE FLOOR IN C#, AND THIS IS WHERE THE FLOOR IS HELD.
  //
  // C# is the one language whose member blocks spend the shared per-prompt
  // budget: `csShapeGraphBlock` renders a block per collaborator and stops when
  // the budget runs out. Data-shape blocks spend the same budget and they spend
  // it first, so until the floor a fat graph could take a member block a
  // developer had before the field leg existed. Measured at 8 types x 15 fields
  // on the install default: two types lost the member block they had and one
  // ended up in the prompt with neither. That was P4-7 in
  // `test/review-v50-p4-starvation.test.cjs`, red on purpose for a session.
  //
  // `resolvePrefill` now prices the WHOLE prompt's member blocks before this
  // renderer is called for the first root, and parks the total on
  // `sharedWalk.memberFloor`. A reservation computed HERE could never work:
  // the budget is spent ACROSS ROOTS, so by the time a starved root reaches this
  // function the earlier roots' shape blocks have already taken it.
  //
  // What is left here is the spend against that reserve, and it is an ARITHMETIC
  // rule rather than a heuristic. Write `S` for the surplus above the reserve,
  // `P` for this candidate's own priced share, `w` for what its walk spends and
  // `a` for what its member render then costs. The prompt stays solvent for
  // every candidate behind this one exactly when
  //
  //     w + a <= S + P
  //
  // A shape block PAYS FOR ITSELF by shedding: the fields it prints leave the
  // member list, so `a` drops from `P` to the shed floor. The walk is therefore
  // allowed to borrow that difference up front - and the borrow is CHECKED after
  // the walk, not assumed, because a def the walk truncated sheds nothing and
  // repays nothing. A walk whose block does not pay for itself is refused and
  // refunded whole.
  //
  // Refusal is the right answer and not a shortfall: an unshed truncated stub is
  // a block that costs the prompt characters and tells the model nothing it does
  // not already read in the member list underneath it.
  //
  // NO FIELDS, NO SHAPE BLOCK, the same decision `goShapeBlock` makes and for the
  // same reason: an enum, an interface, or a service class whose members are all
  // callables would otherwise start carrying a second block that repeats its own
  // declaration head and names no collaborator. Pure cost on a path where the
  // budget is the whole risk.
  // Read at each use, never captured: the dedup set the member render will
  // really consult is whatever `sharedWalk` holds at the moment it runs.
  const memberSeed = () => sharedWalk.memberBlocks ?? sharedWalk.visited;
  const order = [type, ...[...shape.types.keys()].filter((n) => n !== type)];
  const firstToken = (line: string) => /^\s*([A-Za-z_]\w*)/.exec(line)?.[1];
  const memberTypesWith = (shed: ReadonlyMap<string, ReadonlySet<string>>) =>
    order.map((name) => {
      const methods = shape.types.get(name)?.methods ?? [];
      const drop = shed.get(name);
      return { name, methods: drop ? methods.filter((m) => !drop.has(firstToken(m) ?? "")) : methods };
    });
  // What a member render WOULD charge, against a scratch dedup set and no
  // ceiling. The same renderer that produces the real block, so the number is a
  // replay and not an estimate; only the cost is wanted, so the text is dropped.
  const priceMembers = (types: ReturnType<typeof memberTypesWith>): number => {
    const budget = { remaining: Number.MAX_SAFE_INTEGER };
    csShapeGraphBlock(types, { memberCap: profile.memberCap, visited: new Set(memberSeed()), budget });
    return Number.MAX_SAFE_INTEGER - budget.remaining;
  };
  const floor = sharedWalk.memberFloor;
  const surplus = floor === undefined ? 0 : Math.max(0, sharedWalk.remainingChars - floor.reserve);
  // The best case the walk could ever repay: every type sheds every field it has.
  const shedFloorPrice =
    floor === undefined
      ? 0
      : priceMembers(
          memberTypesWith(
            new Map(
              order.flatMap((name) => {
                const t = shape.types.get(name);
                return t === undefined || t.fields.length === 0
                  ? []
                  : [[name, new Set(t.fields.map((f) => f.name))] as [string, Set<string>]];
              }),
            ),
          ),
        );
  const allowance =
    floor === undefined
      ? sharedWalk.remainingChars
      : Math.min(sharedWalk.remainingChars, Math.max(0, surplus + floor.own - shedFloorPrice));

  const charsBefore = sharedWalk.remainingChars;
  // WHAT A REFUSAL HAS TO PUT BACK. The walk mutates three things on the shared
  // state and all three are snapshotted, because restoring two of them is what
  // the first version of this code did and it left the drop ledger holding an
  // entry from a walk that never happened, carrying that walk's private
  // allowance as if it were the prompt's aggregate. `remainingChars` is a
  // number; `visited` is restored by CONTENT rather than by swapping the object,
  // so nothing holding a reference to the set is left looking at a stale one.
  const visitedBefore = floor === undefined ? undefined : new Set(sharedWalk.visited);
  const ledgerBefore = floor === undefined || sharedWalk.droppedBy === undefined ? undefined : new Map(sharedWalk.droppedBy);
  let walk =
    derived && derived.fields.length > 0
      ? walkWithinAllowance(sharedWalk, allowance, () =>
          walkDataShape(type, toResolveStruct(shape, csShapeHooks), profile.dataShape, sharedWalk),
        )
      : { block: "", defs: [] as Array<{ name: string; def: string }>, dropped: [] as string[], droppedBy: [] };

  // THE CHECK. `shedFromDefs` below is called on the same defs, so pricing the
  // member render here is pricing the one that is about to happen.
  if (floor !== undefined && walk.block) {
    const spent = charsBefore - sharedWalk.remainingChars;
    if (spent + priceMembers(memberTypesWith(shedFromDefs(walk.defs, shape))) > surplus + floor.own) {
      // EVERY name the refused block would have carried, and the walk's own
      // drops with them. None of these types is getting a data shape, and the
      // reason none of them is is this refusal: a cap that fired INSIDE a walk
      // that was then withdrawn is not a figure that was ever in force, and
      // reporting it would be the exact class of confident-wrong number the
      // recorded budget bound exists to end.
      const carried = [...new Set([type, ...walk.defs.map((d) => d.name), ...walk.dropped])];
      log(
        `[fngen] data-shape walk \`${type}\` refused: its block would cost ${spent} char(s) it cannot repay by shedding, ` +
          `and the member lists in this prompt are already holding the rest of the budget. ` +
          `Dropped with it: ${carried.join(", ")}. Raise \`column80.injectedContext\` to fit it.`,
      );
      sharedWalk.remainingChars = charsBefore;
      if (visitedBefore !== undefined) {
        sharedWalk.visited.clear();
        for (const n of visitedBefore) {
          sharedWalk.visited.add(n);
        }
      }
      if (ledgerBefore !== undefined && sharedWalk.droppedBy !== undefined) {
        sharedWalk.droppedBy.clear();
        for (const [k, v] of ledgerBefore) {
          sharedWalk.droppedBy.set(k, v);
        }
      }
      for (const name of carried) {
        sharedWalk.droppedBy?.set(name, { name, cause: "member-floor" });
      }
      walk = { block: "", defs: [], dropped: [], droppedBy: [] };
    }
  }
  if (walk.block) {
    parts.push(`Data shape of \`${type}\` (fields and types, nested):\n${fenceFor(walk.block)}cs\n${walk.block}\n${fenceFor(walk.block)}`);
  }
  // Outside the block-produced branch on purpose: an empty block IS the total
  // loss case, and it is the one that must not be silent.
  if (walk.dropped.length > 0) {
    log(`[fngen] data-shape walk \`${type}\` dropped ${walk.dropped.length}: ${droppedNames(walk.droppedBy, profile.dataShape)}`);
  }
  // THE DEPTH FRONTIER, NAMED. A type a field at depth 2 pointed at was never
  // asked about, so it is neither emitted nor dropped, and until this line a
  // reader could not tell that from "there was nothing there". Measured on the
  // real C# graph: `JobStatus` sits at `CustomerSite -> DpmMonitor -> RetroJob ->
  // JobStatus` and it is an enum, which is exactly the shape the v38 enum gate
  // exists for. Depth does not move this session; the name does.
  if (shape.frontier !== undefined && shape.frontier.length > 0) {
    log(
      `[fngen] data-shape walk \`${type}\` reached ${shape.frontier.length} type(s) at the depth ` +
        `limit and did not expand them: ${shape.frontier.join(", ")} (depth=${profile.dataShape.D_MAX})`,
    );
  }

  const types = memberTypesWith(shedFromDefs(walk.defs, shape));
  // THE MEMBER RENDER IS BOUNDED BY THE FLOOR TOO, and that is the structural
  // half of the guarantee. Pricing says what each candidate is OWED; this says
  // what it may SPEND. `reserve` still includes this candidate's own share here
  // (the caller releases it after this function returns), so the bound is
  // "everything left except what later candidates are owed" and a candidate can
  // always afford at least the blocks it was priced for.
  //
  // Without it the floor leaks: a type this render reaches that the pricing pass
  // never charged to this candidate - because an earlier candidate's shed made
  // it look free, or because the pricing pass ran out of budget before it -
  // spends chars a later candidate's member list is holding. That is the shape
  // the phase 0 review reproduced with a shared collaborator whose member block
  // shed to nothing.
  const memberCeiling =
    floor === undefined ? sharedWalk.remainingChars : Math.max(0, sharedWalk.remainingChars - (floor.reserve - floor.own));
  const charsBeforeMembers = sharedWalk.remainingChars;
  const budget = { remaining: memberCeiling };
  const emitted: string[] = [];
  const out = csShapeGraphBlock(types, {
    memberCap: profile.memberCap,
    visited: sharedWalk.memberBlocks ?? sharedWalk.visited,
    budget,
    onEmit: (name) => emitted.push(name),
    onTruncate: (name, total, dropped) =>
      log(`[fngen] pre-fill truncated \`${name}\` members: kept ${profile.memberCap} of ${total} (dropped ${dropped.join(", ")})`),
    onBudget: (name) => log(`[fngen] pre-fill budget exhausted; \`${name}\` block dropped`),
  });
  // The ceiling withheld what later candidates are owed; charge the aggregate by
  // what this render actually spent and hand the withheld part back.
  sharedWalk.remainingChars = charsBeforeMembers - (memberCeiling - budget.remaining);
  if (out !== undefined) {
    parts.push(out);
  }
  // The shape block counts as injecting the ROOT even when no member block
  // survived the budget: it carries that type's fields and its collaborators'
  // names, which is the thing the instruction is scoped to.
  const types_ = out === undefined && walk.block ? [type] : emitted;
  return parts.length > 0 ? { text: parts.join("\n\n"), types: types_ } : undefined;
}

const CS_PREFILL_LANG: PrefillLang = {
  dataShapeTotalTok: CS_DATASHAPE_TOTAL_TOK,
  localTypeDefs: (fullText) => csLocalTypeDefinitions(fullText),
  candidates: csPrioritizedTypes,
  receiver: RECEIVER_RULES.csharp,
  containerKinds: TYPE_CONTAINER_KINDS,
  typeReference: csFindTypeReference,
  shapeHooks: csShapeHooks,
  renderShapeBlock: csShapeBlock,
  priceMemberBlocks: csPriceMemberBlocks,
  exampleFallback: false,
  firmInstruction: CS_FIRM_INSTRUCTION,
  memberVisibility: visibilityFor("csharp"),
  // WALK. `csShapeBlock` now runs `walkDataShape` over
  // `csShapeHooks`, whose def renderer synthesises a field body from the members
  // Roslyn returns, so breadth, depth and the total-type cap all reach this
  // language the way they reach Rust, TypeScript and Go. Changed in the SAME
  // commit as the render that lights it, because the channel line this drives
  // told every C# gesture that breadth and depth buy nothing here, and a field
  // walk makes that false with nothing else anywhere turning red. That is what
  // the v49 tripwire was built for.
  dialReach: "walk",
};

// PYTHON-OWNED prompt text: unpinned constants, never shared
// with the frozen Rust constants they parallel.
const PY_FIRM_INSTRUCTION = (types: readonly string[]) => membersInstruction(types, "members, attributes, or types");

/** The class definitions in Python source, name -> the cursor at the class name —
 *  the Python sibling of csLocalTypeDefinitions. `class X` (optionally decorated /
 *  indented, e.g. a nested class) anchors; a `#` comment line never anchors. The
 *  anchor lets a doc-only same-file type resolve at its OWN definition site. */
export function pyLocalTypeDefinitions(source: string): Map<string, { line: number; character: number }> {
  const defs = new Map<string, { line: number; character: number }>();
  const lines = source.split("\n");
  const decl = /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("#")) {
      continue; // never a comment line
    }
    const m = decl.exec(line);
    if (m && !defs.has(m[1])) {
      defs.set(m[1], { line: i, character: line.indexOf(m[1]) });
    }
  }
  return defs;
}

// The Python candidate list, mirroring the C# prioritization: signature/doc
// PascalCase first, then doc-referenced local types — with std/typing names
// filtered (PY_STD_TYPE_NAMES) and bare single-letter TypeVars dropped. Python
// `import` brings names, but the ambient-import mining has no worked-example
// analog worth resolving here, so there is no import leg (as with C# usings).
export function pyPrioritizedTypes(
  signature: string,
  docComment: string | undefined,
  _fullText: string,
  localTypeNames: Set<string>,
  excludeName?: string,
  spanText = "",
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (names: string[]) => {
    for (const n of names) {
      if (!seen.has(n) && !PY_STD_TYPE_NAMES.has(n) && !/^[A-Z]$/.test(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  };
  push(typesNamedIn(signature, docComment, excludeName, PY_STD_TYPE_NAMES));
  push(commentTypesIn(spanText, "python", excludeName, prefillStopNamesFor("python")));
  push(referencedLocalSymbols(signature, docComment, localTypeNames));
  return out;
}

// A SAFE Python reference cursor for `type`: the first CODE occurrence inside
// the target's own span, else — for a same-file type named only in the doc — its
// OWN definition site. The same never-an-arbitrary-occurrence rule and the same
// comment refusal as the Rust/TS/C# findTypeReference; a docstring is a comment
// here, so a name written only in one does not anchor. Sibling of
// csFindTypeReference.
function pyFindTypeReference(
  type: string,
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
  fullText: string,
  localTypeDefs: Map<string, { line: number; character: number }>,
): { uri: string; line: number; character: number } | undefined {
  const spanStart = resolved.span.start;
  const spanText = fullText.slice(spanStart, resolved.span.end);
  const inSpan = firstCodeOccurrence(spanText, "python", type);
  if (inSpan !== undefined) {
    const pos = document.positionAt(spanStart + inSpan);
    return { uri: document.uri.toString(), line: pos.line, character: pos.character };
  }
  const localDef = localTypeDefs.get(type);
  if (localDef) {
    return { uri: document.uri.toString(), line: localDef.line, character: localDef.character };
  }
  return undefined;
}

// The Python injection block for a resolver-derived type: its member signatures,
// python-fenced, SIGNATURES-ONLY (a pyright class hover carries no field body;
// methods come from documentSymbol/completeMembers). When the member cap
// truncates, the header says so. Sibling of csShapeBlock; the Rust shapeBlock
// stays frozen.
function pyShapeBlock(
  type: string,
  shape: CrossFileShape,
  sharedWalk: SharedWalkState,
  log: (line: string) => void,
  profile: PrefillProfile,
): RenderedBlock | undefined {
  const derived = shape.types.get(type);
  if (!derived) {
    return undefined;
  }
  // Python is the language this line exists for. Pylance fills `detail` on
  // nothing, so EVERY Python member's signature is bought by the hover fan-out,
  // and every one of them is exposed to its two caps. With a field leg live, a
  // capped member is a lost EDGE and not only a lost line.
  const cappedLine = cappedMemberLine(type, derived);
  if (cappedLine !== undefined) {
    log(cappedLine);
  }
  // THE DATA SHAPE, same shape and same guards as Go's and
  // C#'s. No fields, no block: a service class whose members are all callables
  // would otherwise carry a second block repeating its own `class Foo` line.
  const parts: string[] = [];
  const walk =
    derived.fields.length > 0
      ? walkDataShape(type, toResolveStruct(shape, pyShapeHooks), profile.dataShape, sharedWalk)
      : { block: "", defs: [] as Array<{ name: string; def: string }>, dropped: [] as string[], droppedBy: [] };
  if (walk.block) {
    parts.push(`Data shape of \`${type}\` (fields and types, nested):\n${fenceFor(walk.block)}python\n${walk.block}\n${fenceFor(walk.block)}`);
  }
  if (walk.dropped.length > 0) {
    log(`[fngen] data-shape walk \`${type}\` dropped ${walk.dropped.length}: ${droppedNames(walk.droppedBy, profile.dataShape)}`);
  }
  if (shape.frontier !== undefined && shape.frontier.length > 0) {
    log(
      `[fngen] data-shape walk \`${type}\` reached ${shape.frontier.length} type(s) at the depth ` +
        `limit and did not expand them: ${shape.frontier.join(", ")} (depth=${profile.dataShape.D_MAX})`,
    );
  }

  // The member list sheds exactly the fields the shape block rendered, and only
  // when the root's own def rendered COMPLETE. A Python def carries no braces, so
  // the walk emits it atomically and there is no `... N more fields` shell to
  // read; the test is whether the def is there at all.
  const ownDef = walk.defs.find((d) => d.name === type);
  const shed = ownDef !== undefined && walk.block.length > 0;
  const fieldNames = new Set(derived.fields.map((f) => f.name));
  const firstToken = (line: string) => /^\s*([A-Za-z_]\w*)/.exec(line)?.[1];
  const all = shed ? derived.methods.filter((m) => !fieldNames.has(firstToken(m) ?? "")) : derived.methods;
  let methods = all;
  if (methods.length === 0) {
    return parts.length > 0 ? { text: parts.join("\n\n"), types: [type] } : undefined;
  }
  let header = `Members of \`${type}\` (real signatures, use these exact names, do not invent):`;
  if (methods.length > profile.memberCap) {
    const dropped = methods.slice(profile.memberCap);
    methods = methods.slice(0, profile.memberCap);
    header = `Members of \`${type}\` (a subset — the first ${profile.memberCap} of ${all.length}; real signatures, use these exact names, do not invent):`;
    log(`[fngen] pre-fill truncated \`${type}\` members: kept ${profile.memberCap} of ${all.length} (dropped ${dropped.join(", ")})`);
  }
  parts.push(`${header}\n${fenceFor(methods.join("\n"))}python\n${methods.join("\n")}\n${fenceFor(methods.join("\n"))}`);
  return { text: parts.join("\n\n"), types: [type] };
}

const PY_PREFILL_LANG: PrefillLang = {
  localTypeDefs: (fullText) => pyLocalTypeDefinitions(fullText),
  candidates: pyPrioritizedTypes,
  receiver: RECEIVER_RULES.python,
  containerKinds: TYPE_CONTAINER_KINDS,
  typeReference: pyFindTypeReference,
  shapeHooks: pyShapeHooks,
  renderShapeBlock: pyShapeBlock,
  exampleFallback: false,
  // No memberVisibility: Python spells visibility nowhere, and the standing
  // decision to keep single-underscore members is a human call, not a filter.
  firmInstruction: PY_FIRM_INSTRUCTION,
  // WALK. `pyShapeHooks.parseFields` derives fields
  // from the resolved members and `pyShapeBlock` runs `walkDataShape` over them,
  // so depth, breadth and the total-type cap all reach this language now. This
  // line drives `contextStopLine`, and while it said `signatures` every Python
  // gesture printed that breadth and depth buy nothing here while the walk was
  // running. Caught by the agent re-cutting the v49 tripwire rows, which checked
  // the diff before moving a value and found the render had shipped without its
  // declaration.
  dialReach: "walk",
};

// GO-OWNED prompt text: unpinned constants, never shared
// with the frozen Rust constants they parallel.
const GO_FIRM_INSTRUCTION = (types: readonly string[]) => membersInstruction(types, "members, fields, or types");

/** The `type X ...` definitions in Go source, name -> the cursor at the type
 *  name — the Go sibling of csLocalTypeDefinitions. Column-0 only: Go
 *  top-level declarations start the line (a grouped `type ( ... )` block's
 *  indented entries are not scanned — the anchor is a doc-only-type fallback,
 *  and the grouped form is rare enough that missing it degrades to no anchor,
 *  never a wrong one). A comment line never anchors. */
export function goLocalTypeDefinitions(source: string): Map<string, { line: number; character: number }> {
  const defs = new Map<string, { line: number; character: number }>();
  const lines = source.split("\n");
  const decl = /^type\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("//")) {
      continue; // never a comment line
    }
    const m = decl.exec(line);
    if (m && !defs.has(m[1])) {
      defs.set(m[1], { line: i, character: line.indexOf(m[1]) });
    }
  }
  return defs;
}

// The Go candidate list, C#-shaped (signature/doc first, then doc-referenced
// local types), plus a `pkg.`-qualified reference mined
// from signature/doc/body, LAST, same position the Rust/TS ambient-import tier
// occupies. A Go import line carries a package PATH, not a type name, so
// unlike Rust/TS there is no type name to read off the import LINE itself;
// goTypesFromQualifiedUsage instead reads the import block as a filter over
// what the CODE already spells qualified. The signature leg is goTypesInPlay,
// NOT the shared PascalCase harvest: an exported Go FUNC name is capitalized
// (`Split`), so typesNamedIn would read the target's own name as a type — the
// Go-only trap the whole-block detector already dodges. The std/single-letter
// filter still guards the doc and local legs, which goTypesInPlay does not
// see. Exported for the impl oracle.
export function goPrioritizedTypes(
  signature: string,
  docComment: string | undefined,
  fullText: string,
  localTypeNames: Set<string>,
  excludeName?: string,
  spanText = "",
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (names: string[]) => {
    for (const n of names) {
      if (!seen.has(n) && !GO_STD_TYPE_NAMES.has(n) && !/^[A-Z]$/.test(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  };
  push(goTypesInPlay(signature));
  // gopls names a method symbol `(*Stripe).Summarize`; reduce excludeName to
  // the bare member so the doc's opening-word convention (a Go doc starts with
  // the declared name) can never feed the target back as a candidate.
  const bare = excludeName === undefined ? undefined : (parseGoReceiverSymbol(excludeName)?.member ?? excludeName);
  push(typesNamedIn("", docComment, bare, GO_STD_TYPE_NAMES));
  push(commentTypesIn(spanText, "go", bare, prefillStopNamesFor("go")));
  push(referencedLocalSymbols(signature, docComment, localTypeNames));
  push(goTypesFromQualifiedUsage(signature, docComment, spanText, fullText));
  return out;
}

// A SAFE Go reference cursor for `type`: the first CODE occurrence inside the
// target's own span, else — for a same-file type named only in the doc — its
// OWN definition site. The same never-an-arbitrary-occurrence rule and the same
// comment refusal as the Rust/TS/C# findTypeReference. Like C#, Go has no
// import-line leg (imports are package paths; a type name never appears on
// one), so it falls straight from the span to the local definition.
function goFindTypeReference(
  type: string,
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
  fullText: string,
  localTypeDefs: Map<string, { line: number; character: number }>,
): { uri: string; line: number; character: number } | undefined {
  const spanStart = resolved.span.start;
  const spanText = fullText.slice(spanStart, resolved.span.end);
  const inSpan = firstCodeOccurrence(spanText, "go", type);
  if (inSpan !== undefined) {
    const pos = document.positionAt(spanStart + inSpan);
    return { uri: document.uri.toString(), line: pos.line, character: pos.character };
  }
  const localDef = localTypeDefs.get(type);
  if (localDef) {
    return { uri: document.uri.toString(), line: localDef.line, character: localDef.character };
  }
  return undefined;
}

// The Go injection block: a DATA-SHAPE body plus the member signatures, both
// go-fenced. Sibling of tsShapeBlock now rather than of pyShapeBlock; the Rust
// shapeBlock stays frozen.
//
// THE RENDER DECISION.
//
// Go's member list already carries every field name AND its type — `pgConn
// *pgconn.PgConn` has shipped as a member line since v23. So a rendered field
// body beside that list prints the same bytes twice, and bytes are the scarce
// resource on this path: Go's risk from the field leg is EVICTION, not
// addition, because the new blocks compete for the same shared budget as the
// 52-member Conn list that works today.
//
// So the field body ships, and the member list sheds exactly the fields the
// field body actually rendered. Methods are never touched.
//
// It is guarded so it can never be worse than today, and the guards are the
// point rather than defensive padding:
//
//  - a type with NO data-shape block keeps its member list whole, byte for byte
//    (a walk that resolved nothing must not cost a developer the list they
//    already have);
//  - a type whose def the walk TRUNCATED keeps its member list whole too. The
//    walk cuts fields at TOK_MAX; the member list cuts at memberCap. Both are
//    honest caps, and shedding on one side while the other side is already
//    cutting is how a field disappears from both. Fields may be cut from one
//    place or the other, never from both.
//
// Which member lines ARE fields is not guessed from their text — a Go method
// signature and a `handler func(int) error` field both carry parens. The walk
// hands back the parsed field list, so a member line is a field line exactly
// when its first token is one of those names.
function goShapeBlock(
  type: string,
  shape: CrossFileShape,
  sharedWalk: SharedWalkState,
  log: (line: string) => void,
  profile: PrefillProfile,
): RenderedBlock | undefined {
  const derived = shape.types.get(type);
  if (!derived) {
    return undefined;
  }
  const parts: string[] = [];
  // NO FIELDS, NO SHAPE BLOCK, and this is a decision rather than an
  // optimisation. `walkDataShape` will happily emit a root with an empty body,
  // and for Go that means every non-struct type — an interface, a named func
  // type, `type QueryExecMode int` — would start carrying a second block that
  // repeats its own declaration and names no collaborator. That is pure cost on
  // the one path where cost is the whole risk: Go's exposure from this leg is
  // EVICTION, and a block with no graph in it buys nothing to be evicted for.
  //
  // It also keeps the promise the render decision rests on: a type with no
  // data-shape block keeps its member list byte-identical to today. Every Go
  // type that is not a struct is therefore untouched by this phase, which is
  // what `blind-v39-p1-hover-recovery`'s E2 row asserts for a Rust enum hover
  // arriving on the Go path.
  const walk =
    derived.fields.length > 0
      ? walkDataShape(type, toResolveStruct(shape, goShapeHooks), profile.dataShape, sharedWalk)
      : { block: "", defs: [], dropped: [], droppedBy: [] };
  const ownDef = walk.defs.find((d) => d.name === type);
  // The walk marks a cut def with `... N more fields`; that marker is the only
  // signal that this type's own field list is incomplete, and it decides whether
  // the member list may shed anything.
  const ownDefComplete = ownDef !== undefined && !/\.\.\.\s+\d+\s+more fields/.test(ownDef.def);
  if (walk.block) {
    parts.push(`Data shape of \`${type}\` (fields and types, nested):\n${fenceFor(walk.block)}go\n${walk.block}\n${fenceFor(walk.block)}`);
  }
  // Hoisted out of the block-produced branch on purpose, exactly as tsShapeBlock
  // does it: an empty block IS the total-loss case, and it is the one that must
  // not be silent.
  if (walk.dropped.length > 0) {
    log(`[fngen] data-shape walk \`${type}\` dropped ${walk.dropped.length}: ${droppedNames(walk.droppedBy, profile.dataShape)}`);
  }

  const fieldNames = new Set(derived.fields.map((f) => f.name));
  const shed = ownDefComplete && walk.block.length > 0;
  const firstToken = (line: string) => /^\s*([A-Za-z_]\w*)/.exec(line)?.[1];
  const all = shed ? derived.methods.filter((m) => !fieldNames.has(firstToken(m) ?? "")) : derived.methods;
  let methods = all;
  let header = `Members of \`${type}\` (real signatures, use these exact names, do not invent):`;
  if (methods.length > profile.memberCap) {
    const dropped = methods.slice(profile.memberCap);
    methods = methods.slice(0, profile.memberCap);
    header = `Members of \`${type}\` (a subset — the first ${profile.memberCap} of ${all.length}; real signatures, use these exact names, do not invent):`;
    log(`[fngen] pre-fill truncated \`${type}\` members: kept ${profile.memberCap} of ${all.length} (dropped ${dropped.join(", ")})`);
  }
  if (methods.length > 0) {
    parts.push(`${header}\n${fenceFor(methods.join("\n"))}go\n${methods.join("\n")}\n${fenceFor(methods.join("\n"))}`);
  }
  return parts.length > 0 ? { text: parts.join("\n\n"), types: [type] } : undefined;
}

// `goShapeHooks` swaps ONE thing on the cross-file resolver, the def RENDERER
// (a gopls hover is the declaration plus doc prose plus `// size=...` chrome).
// The hover-field walk still runs the Rust default parser, which cannot read
// Go's Name Type field order and derives nothing — a dark leg, not a wrong
// one — while the method surface rides membersOfType, which no hook touches.
// This pre-fill entry renders SIGNATURES only and never reads a def, so the
// renderer reaches it through the FIM whole-block leg alone.
// GO'S 8-ROOT EXCEPTION IS GONE (ruled 2026-08-10). Go used
// to carry its own measured cap of 8 here against every other language's 4:
// the authored-gesture funnel put the shipped 4 at the binding stage, with
// 1116 of 3037 ground-truth types losing the cap lottery, and the ladder over
// 907 authored rows kneed at 8 (in-cap 50.9% -> 71.3% -> 78.8% -> 81.3%,
// injected 34.8% -> 48.9% -> 53.8% -> 54.5% at caps 4/6/8/12).
//
// That measurement is why the DIAL's bottom stop is 8 roots for everyone. The
// ruling was to bring every language up to Go's level rather than keep a
// per-language table, so the number survives and its exception does not.
//
// IT SURVIVES IN ONE PLACE, AND ONE ONLY: the `shipped` stop, below. That stop
// is not a product setting - it is the before-side the measurement rig and the
// suite replay - and the product HEAD shipped gave Go 8 roots. A `shipped` Go
// prompt rendering 4 roots (1204 bytes where HEAD renders 2116) would be a
// baseline that never existed.
//
// THE NAME IS LOAD-BEARING, as PREFILL_TYPE_CAP's is: the measurement rig
// rewrites the bundled `var GO_PREFILL_TYPE_CAP = …;` to run a Go cap arm
// (lib-core's loadPrefillCap(n, "go")). Derived from the shared knob rather
// than written as a bare 8 so a shared-cap arm still moves Go with it, exactly
// as the pre-dial constant did.
const GO_PREFILL_TYPE_CAP = PREFILL_TYPE_CAP === 4 ? 8 : PREFILL_TYPE_CAP;

const GO_PREFILL_LANG: PrefillLang = {
  shippedRootCap: GO_PREFILL_TYPE_CAP,
  // WALK, and this line moving is the whole reason
  // the tripwire exists. `goShapeBlock` now runs `walkDataShape` over
  // `goShapeHooks`, whose field parser reads a gopls struct hover, so every
  // number the dial carries reaches this language the way it reaches Rust and
  // TypeScript: depth and breadth bound the walk, the total-type cap bounds it,
  // and the aggregate budget cuts the rendered defs.
  //
  // Changed in the SAME commit as the leg that lights it, because the channel
  // line this drives printed "breadth, total types and depth buy nothing in
  // this language" on every Go gesture, and a field walk makes that sentence
  // false on the product's own channel with nothing else anywhere turning red.
  dialReach: "walk",
  // THE MISSING WIRE, and it had been missing since Go got hooks at all.
  // Without this the pre-fill path resolved every Go type through the RUST
  // defaults: the Rust field parser (which cannot read Name Type, so no
  // fields), the Rust def renderer (which synthesises `struct X { }` — another
  // language's syntax), the Rust std stop-set, and the Rust-only alias chase and
  // trait recovery, neither of which can mean anything for Go. `goShapeHooks`
  // reached the FIM whole-block leg and nothing else, which is why a scout
  // driving `resolveCrossFileShape` with the hooks by hand saw a different Go
  // from the one the product shipped.
  shapeHooks: goShapeHooks,
  // Go's prompt names a collaborator in exactly one place, the data-shape block
  // `walkDataShape` renders, and that walk takes at most `B_MAX` field types per
  // node. So a gathered type outside that BFS is unspendable by construction -
  // measured at 31 of 117 over the real corpus - and the gather stops there too.
  gatherBreadth: true,
  localTypeDefs: (fullText) => goLocalTypeDefinitions(fullText),
  candidates: goPrioritizedTypes,
  receiver: RECEIVER_RULES.go,
  containerKinds: TYPE_CONTAINER_KINDS,
  typeReference: goFindTypeReference,
  renderShapeBlock: goShapeBlock,
  exampleFallback: false,
  firmInstruction: GO_FIRM_INSTRUCTION,
  memberVisibility: visibilityFor("go"),
  // `T` IS A TYPE IN THIS LANGUAGE. 186 single-letter structs in the standard
  // library, `testing.T` first among them - the reason is written out once at
  // `crossFileShape.ts:1016-1024` and is not repeated here.
  singleLetterOwnerIsReal: true,
};

// Non-TS/C#/Python/Go ids fall to the Rust entry: only languages with a
// registered extractor reach resolvePrefill at all, so the fallback is the rust
// path, unchanged. csharp/python/go get their own signatures-only entries rather
// than the Rust worked-example candidate parser that cannot read a type-first
// signature (or, for Go, a capitalized func name).
// Exported so an oracle can drive the WHOLE funnel rather than its first stage.
// A candidate name that reaches `candidates` still has to survive the type cap
// and then ANCHOR at a real position through `typeReference`, and a test that
// stops at extraction passes while Go injects nothing. The five entries are the
// product's own, not a re-derived mapping: a harness that rebuilt one inverted
// a v29 arm result.
// `injectedTypeCap` AND `column80.injectedSurface` ARE GONE.
// That setting scaled ONE of the four numbers - the root cap - and left
// breadth, the total-type cap and the render budget where they were, which is
// precisely the configuration the trap proof shows cannot change the prompt:
// with the total at 6 and the budget at 200, more roots re-divide the same
// bytes. `column80.injectedContext` replaces it and moves all four together.
// The clamp that setting carried (never promise more roots than the resolve
// cap can fill) survives as a property OF THE STOP TABLE: no row's `rootCap`
// exceeds its own `resolveCap`.

/** The bound the PRE-FILL hands the cross-file gather, for this language at this
 *  profile. One function, exported, because two callers must agree on it: the
 *  pre-fill spends it and the latency rig times it. A rig that rebuilt this
 *  would be a re-derived mapping, and a re-derived mapping has already inverted
 *  one measurement in this project (`fnGenProfileFor` carries the same warning
 *  for the same reason).
 *
 *  It is `profile.crossFile`, plus the render's own per-node field fan-out for a
 *  language that has opted in - see `PrefillLang.gatherBreadth` for what opting
 *  in claims and `CrossFileBound.B_MAX` for what it costs. */
export const prefillGatherBound = (lang: PrefillLang, profile: PrefillProfile): CrossFileBound =>
  lang.gatherBreadth === true ? { ...profile.crossFile, B_MAX: profile.dataShape.B_MAX } : profile.crossFile;

export const prefillLangFor = (languageId: string): PrefillLang =>
  TS_LANGUAGE_IDS.has(languageId)
    ? TS_PREFILL_LANG
    : languageId === "csharp"
      ? CS_PREFILL_LANG
      : languageId === "python"
        ? PY_PREFILL_LANG
        : languageId === "go"
          ? GO_PREFILL_LANG
          : RUST_PREFILL_LANG;

// Re-exported from here because the impl and blind oracles drive both through
// this file's bundle entry, and because a caller that already holds fnGen
// should not need a second import to say what a failure was. The definitions
// are in `failureToast.ts`; the import sits with the rest at the top.
export { generationFailedToast, translateServiceReject };

/**
 * One GESTURE, one lost-block warning.
 *
 * The blocks are resolved once per prompt, and a manual repair builds up to two
 * prompts from a single invocation, so a boolean "do announce" would name the
 * same lost blocks in two identical toasts seconds apart. The gesture makes one
 * of these and hands the SAME object to every round it runs; whichever round
 * first drops something spends it.
 */
interface DroppedAnnouncer {
  pending: boolean;
}

function announceOnce(): DroppedAnnouncer {
  return { pending: true };
}

/**
 * The bounds, the per-language rows, the scope predicate and the run-target
 * resolution all live in `src/core/coveringTestRun.ts` now, because Repair
 * Function's test leg runs the SAME discovery and the SAME groups. One
 * mechanism, two entry points: a second derivation of "which tests cover this
 * function" would let the two gestures disagree about the set, and the developer
 * would be told about a run the model never saw.
 */

/** What one invocation of Run Covering Tests ended as. Three outcomes rather
 *  than one, because "the server could not place the cursor" and "you cancelled"
 *  are NOT results the report module can speak for: the first means discovery
 *  never started, and reporting it through the report would put the proven-zero
 *  sentence on a search that never ran. */
type RunTestsOutcome =
  | { kind: "report"; report: RunTestsReport }
  | { kind: "no-call-root" }
  | { kind: "cancelled" };

/**
 * What a model-call gesture registered OUTSIDE this file needs from inside it.
 *
 * The tier decision, the tier's recorded reason, the tier-resolved transport
 * and the in-flight registry all live in `registerFnGen`'s closure, and every
 * one of them is read at INVOKE time rather than captured at activation: a
 * settings change rebuilds the service and re-resolves the tier, and a gesture
 * holding a stale instance would keep asking a model the human turned off.
 *
 * Returned rather than imported, so a gesture that only needs these four things
 * can be registered from `extension.ts` beside the others without taking a
 * runtime edge into this file.
 */
export interface ModelGestureWiring {
  /** FAIL CLOSED. The same consult generate, repair, tighten and TDD make. */
  tierGate: () => Promise<{ allowed: boolean; reason?: string }>;
  tierMessage: () => string | undefined;
  transport: () => InstructGenerateFn;
  inFlight: () => InFlightRegistry | undefined;
}

export function registerFnGen(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  // Required on purpose: a defaulted store would let a regressed call site
  // silently split the panel's store from the generate path's (the
  // context-the-user-sees-but-the-model-does-not lie) with every headless
  // oracle still green.
  store: ContextBlockStore,
  deps: FnGenDeps = {},
): ModelGestureWiring {
  const log = (line: string) => output.appendLine(line);
  // Pre-tier placeholder so dispose paths always have a service. Every
  // model-call entry point below consults tierGate() first and fails CLOSED on
  // an unresolved tier (the impl5 fnGen oracles pin that), and the transport is
  // inert on top: a gate missed anywhere dials nothing before the first
  // rebuild resolves a real tier (roadmap item 58).
  let service = inertFnGenService(
    readFnGenConfig(),
    "the hardware tier has not been resolved yet",
    log,
  );
  let tier: TierSelection | undefined;
  const rebuild = async (): Promise<void> => {
    // The global storage path is the ONLY place the neutral cwd can come from,
    // and only registerFnGen holds the ExtensionContext that names it. Threading
    // it through the build is what keeps the CLI out of the user's workspace;
    // an arm that could not see it would fail closed instead.
    const built = await (deps.buildService ?? buildFnGenService)(output, log, deps.probeOpts, {
      ...deps.claudeCode,
      storagePath: deps.claudeCode?.storagePath ?? context.globalStorageUri?.fsPath,
      // The remote arm's reachability probe is a real network call at
      // activation. FnGenDeps already carried a listModels for the repair
      // pre-flight and it did not reach here, so a test that set it believed
      // it had covered activation and had not.
      listModels: deps.claudeCode?.listModels ?? deps.listModels,
    });
    service.dispose();
    service = built.service;
    tier = built.tier;
  };
  const rebuildLogged = (): Promise<void> =>
    rebuild().catch((err) => output.appendLine(`[carve] tier flow failed: ${String(err)}`));
  let tierReady = rebuildLogged();
  // The one tier decision every model-call path consults. Unresolved (the
  // rebuild rejected) is treated exactly like disabled: closed. Honesty,
  // never optimism - the same rule computeTier applies to a failed probe.
  const tierGate = async (): Promise<{ allowed: boolean; reason?: string }> => {
    await tierReady;
    if (tier === undefined) {
      return { allowed: false, reason: "tier-unresolved" };
    }
    if (!tier.fnGenEnabled) {
      return { allowed: false, reason: "tier-disabled" };
    }
    return { allowed: true };
  };
  // The payload reader every prompt's context blocks are resolved through.
  // `workspace.textDocuments`, NOT the visible editors: a document open in no
  // visible tab still holds the human's unsaved edits, and filtering to what is
  // on screen would send the model the disk's version of a file they are in the
  // middle of writing. Stateless, so it is built once and asked every time.
  const readBlockText = makeBlockReader({
    openDocuments: () =>
      vscode.workspace.textDocuments.map((d) => ({ uri: d.uri.toString(), getText: () => d.getText() })),
    // `Uri.parse` throws on a uri it cannot parse, and it throws SYNCHRONOUSLY.
    // Inside the dep on purpose: the reader's own catch is then what answers,
    // with `undefined`, exactly as it answers a rejected open.
    openTextDocument: (uri) => Promise.resolve(vscode.workspace.openTextDocument(vscode.Uri.parse(uri))),
  });
  /**
   * The blocks this prompt gets, read out of the live documents at the moment
   * the prompt is built. Never a list captured earlier: bar 3 (a removed block
   * must never reach a prompt, zero tolerance) hangs on that ordering, and the
   * resolver walking the store's own live list is what keeps it true across the
   * awaits the read now costs.
   *
   * `announce` is the generate-time half of the human's ruling: a lost block
   * DROPS OUT of the prompt rather than refusing it, so the human is told what
   * their prompt went without. Not a duplicate of the loss-time toast - that one
   * says the block is gone, this one says the prompt lacked it - but the two
   * fire-and-forget accept paths pass nothing, because a repair round seconds
   * after a generation would repeat the warning the generation just showed for
   * the same blocks.
   */
  const resolveContextBlocks = async (announce?: DroppedAnnouncer): Promise<ContextBlock[]> => {
    const blocks = await store.resolveForPrompt(readBlockText);
    // Read AFTER the resolve: the resolve is where a deleted file or a failed
    // re-adoption becomes a loss, and the store has already put the
    // `[ctx] lost id=… reason=…` line on the channel by now.
    const dropped = store.list().filter((e) => e.lost);
    if (announce?.pending === true && dropped.length > 0) {
      // Spent HERE rather than at the gesture's start: a first round that
      // dropped nothing must leave the warning available to a later round
      // that does.
      announce.pending = false;
      // By panel label plus line range, which is exactly what the block's row
      // in the tree reads, so the human can go straight to the row named.
      const named = dropped
        .map((e) => `${fileLabel(e.uri)} L${e.range.startLine}-L${e.range.endLine}`)
        .join(", ");
      void vscode.window.showWarningMessage(
        `Column 80: ${dropped.length === 1 ? "a context block is" : `${dropped.length} context blocks are`} lost, ` +
          `so the prompt did not include ${dropped.length === 1 ? "it" : "them"}: ${named}.`,
      );
    }
    return blocks;
  };
  const presenter = new ProposalPresenter(context);
  // The v2 compiler-directed extractor for the document's language (the
  // registry keeps injection dark for languages without a resolver). Read at
  // each accept so a config toggle takes effect without a reload; extractors
  // are cheap to build (they hold no process). A degrade to v1 is silent
  // (queries return empty when the language server is not answering).
  const injectionExtractor = (languageId: string): SurfaceExtractor | undefined =>
    readOracleConfig().injectionEnabled ? extractorFor(languageId) : undefined;

  // `Column 80: Tighten Doc Comment`. Registered from here
  // because the presenter is the extension's ONE consent gate and lives in this
  // closure; everything else the command needs is passed rather than imported,
  // so `tightenDocComment.ts` carries no runtime edge back into this file and
  // its whole pipeline runs headless in the suite. It is MANUAL: its one
  // `resolvePrefill` is a pre-fill-class resolve, so it is wired to no
  // keystroke and to no automatic path.
  registerTightenDocComment(context, output, {
    presenter,
    resolveFunction: resolveFunctionAtCursor,
    resolvePrefill,
    prefillLangFor,
    extractorFor: (languageId) => injectionExtractor(languageId),
    // The SAME transport fn-gen's rounds go through, read at call time so a
    // settings change that rebuilds the service is followed here too.
    transport: () => service.transport,
    modelTag: () => service.modelTag,
    // The one tier decision every model-call gesture consults, and the
    // recorded reason its refusal names (item 58).
    tierGate,
    tierMessage: () => tier?.message,
    // A GETTER because `inFlight` is declared below this call: reading it here
    // would be a TDZ throw at activation. The gesture runs long after the const
    // is bound (scrap S58-11).
    inFlight: () => inFlight,
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      // The service snapshots config at construction (same discipline as the
      // FIM service): swap in a fresh instance on change. The rebuild
      // re-runs resolveTier + applyTier, so a tier or model setting
      // change re-derives the carve.
      if (e.affectsConfiguration("column80")) {
        tierReady = rebuildLogged();
      }
    }),
    { dispose: () => service.dispose() },
  );

  // One host-scoped catalog fetcher, shared by both post-accept paths: it
  // resolves the host triple once and scopes cargo metadata to it, so catalog
  // steering never promotes a platform-pruned optional dep.
  const catalogFetcher = makeHostScopedCatalogFetcher();

  // What is running, and the only way to stop it that survives the progress
  // notification being dismissed (roadmap item 67's ruled replacement for a
  // watchdog). Every cancellable `withProgress` below claims from this; the
  // claim is released in a `finally` so a gesture that throws still gives the
  // status-bar item back.
  const inFlight = deps.inFlight ?? new InFlightRegistry(log);
  context.subscriptions.push(
    inFlight,
    vscode.commands.registerCommand(CANCEL_COMMAND, () => {
      // No toast either way. Cancelling is the user's own action and needs no
      // confirmation, and pressing a bound key with nothing running is not a
      // mistake worth a notification. The channel carries both outcomes.
      inFlight.cancelAll();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("column80.generateFunction", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage("Column 80: no active editor.");
        return;
      }
      // Honest-dark gate on unregistered languages. Without it a .go file
      // generates through the Rust-shaped defaults (coincidence-correct
      // signature slice, no oracle behind it) and dies with a parse error that
      // names no cause. Refuse plainly instead, naming the language.
      const langId = editor.document.languageId;
      if (!isRegisteredLanguage(langId)) {
        output.appendLine(`[fngen] refused: ${langId} is not a registered language`);
        void vscode.window.showWarningMessage(
          `Column 80: function generation is not supported for ${langId} - it supports ${SUPPORTED_LANGUAGES_TEXT}.`,
        );
        return;
      }
      // Tier gate, fail closed: an unresolved tier (tier flow rejected) and
      // a disabled tier both stop here - honest message, zero model-ward
      // work, not even symbol resolution. FIM is untouched on every tier.
      const gate = await tierGate();
      if (!gate.allowed) {
        if (gate.reason === "tier-unresolved") {
          output.appendLine("[carve] fn-gen skipped: tier unresolved (tier flow failed; see [carve] lines above)");
          void vscode.window.showWarningMessage(
            'Column 80: function generation is unavailable - the hardware tier could not be resolved. Re-run "Column 80: Select Hardware Tier" (details in the output channel).',
          );
        } else {
          // Same fallback the TDD gate below uses: a disabled tier that
          // arrives without a message must not render "Column 80: undefined"
          // on either surface.
          const why = tier?.message ?? "the hardware tier is unavailable for generation";
          // The channel takes the message whole, the toast takes one line of it.
          output.appendLine(`[carve] fn-gen disabled: ${why}`);
          void vscode.window.showWarningMessage(`Column 80: ${tierDisabledToast(why)}`);
        }
        return;
      }
      const document = editor.document;
      // The staleness anchor, captured BEFORE the symbol-provider await:
      // spans are offsets into the text the provider saw, and an edit
      // landing during resolution would otherwise produce garbage offsets
      // every later guard blesses. Any later change — even one leaving the
      // span bytes identical — bumps version and discards.
      const versionAtResolve = document.version;
      // Admit Struct/Enum as targets only when compilerDirectedInjection
      // is on. Off keeps the v1 function-only resolution, so the gate is
      // byte-for-byte v1.
      const admitTypes = readOracleConfig().injectionEnabled;
      const resolution = await resolveFunctionOrRefusal(
        document,
        editor.selection.active,
        admitTypes,
      );
      if (!resolution.ok) {
        // The cursor case has several honest sub-causes: the cursor is outside
        // every symbol, OR the symbol at the cursor is a kind this language
        // deliberately does not generate (a C# interface, a Rust trait, both
        // excluded bodyless members). The other three causes are the
        // environment's and are named by refusalMessage.
        log(refusalLogLine(resolution.refusal, document.languageId));
        void vscode.window.showWarningMessage(
          refusalMessage(
            resolution.refusal,
            document.languageId,
            admitTypes
              ? "Column 80: nothing to generate here — the cursor is not inside a function or on a generatable type header."
              : "Column 80: no function at the cursor.",
          ),
        );
        return;
      }
      const resolved = resolution.fn;
      if (document.version !== versionAtResolve) {
        void vscode.window.showWarningMessage(
          "Column 80: generation discarded — the document changed while the function was being resolved.",
        );
        service.logOutcome("discarded");
        return;
      }

      // A Python docstring Fork A cannot preserve in place (an on-header-line
      // one-liner, or an implicitly concatenated docstring): refuse honestly
      // rather than silently overwriting or half-eating the human's words (the
      // honest-degrade non-negotiable). The message says how to make it work.
      if (resolved.docstringRefusal) {
        log(`[fngen] declined: ${resolved.docstringRefusal}`);
        void vscode.window.showWarningMessage(`Column 80: ${resolved.docstringRefusal}`);
        return;
      }

      // The PRE-generation applicability gate. On a
      // Python doc, run ONE baseline pyright check on the untouched buffer BEFORE
      // generating; if it is a missing-imports storm, the interpreter/venv is
      // broken and no generation could be trusted (a broken env darkens all import
      // surface), so surface the honest environment reason and decline — named
      // inapplicability, not a wrong guess. The baselineCheck newtype makes this
      // the ONLY place the storm classifier can be consumed (a post-accept result
      // is type-refused). FIM (per keystroke) runs NO baseline (hot path); it goes
      // honest-dark instead. Python-only: no other language has a storm concept.
      if (document.languageId === "python") {
        const oracle = oracleFor(document.languageId);
        if (oracle) {
          const baseline = await runOracleCheck(oracle, document.uri.fsPath, { log });
          if (baseline && isMissingImportsStorm(baselineCheck(baseline))) {
            const reason =
              describeEnvironment(baselineCheck(baseline)) ?? "the Python environment is not ready";
            log(`[fngen] declined (pre-generation baseline storm): ${reason}`);
            void vscode.window.showWarningMessage(`Column 80: ${reason}`);
            return;
          }
        }
      }

      // A brace-less struct (unit `struct Foo;` / tuple `struct Foo(i32);`, and
      // the C# analog: a positional `record Point(int X, int Y);`) has no body
      // block to generate. Splicing a `{ ... }` body would rewrite the whole
      // declaration into a different shape, so no-op the gesture with an honest
      // message rather than generating noise. The Python exclusion and the no-`{`
      // detection both live in isBracelessTypeTarget so the dark fact is a pinned
      // predicate, not a buried clause (scout-py.md Q4/D5; review MINOR-1/2).
      if (resolved.kind !== "function") {
        const spanText = document.getText(
          new vscode.Range(document.positionAt(resolved.span.start), document.positionAt(resolved.span.end)),
        );
        if (isBracelessTypeTarget(document.languageId, resolved.kind, spanText)) {
          const shape = bracelessTypeShape(document.languageId, resolved.kind);
          log(`[fngen] nothing to generate: ${resolved.symbolName} is ${shape} (no body block)`);
          void vscode.window.showWarningMessage(
            `Column 80: nothing to generate — ${resolved.symbolName} is ${shape} with no body block.`,
          );
          return;
        }
      }

      // A bodyless C#/TS member (interface member / abstract method) resolves as
      // a FUNCTION (Method is a function kind), skips the type brace-less guard
      // above, and would otherwise splice a body over a bodyless signature —
      // invalid code. Refuse honestly instead (never a coincidence splice). Rust
      // is excluded: a trait method signature legally takes a generated default
      // body. See isBodylessMemberTarget.
      if (resolved.kind === "function") {
        const spanText = document.getText(
          new vscode.Range(document.positionAt(resolved.span.start), document.positionAt(resolved.span.end)),
        );
        if (isBodylessMemberTarget(document.languageId, spanText)) {
          log(`[fngen] nothing to generate: ${resolved.symbolName} is a bodyless member signature (interface/abstract)`);
          void vscode.window.showWarningMessage(
            `Column 80: nothing to generate — ${resolved.symbolName} is a bodyless signature (an interface or abstract member has no body to generate).`,
          );
          return;
        }
      }

      // v2 round-1 pre-fill: resolve the surface for types the signature/doc
      // already name, so the first attempt is targeted. Conservative on purpose
      // - example only, never the wide member set - so a bare type reference
      // that resolves nothing leaves the prompt at v1 bytes (blind start, which
      // the loop recovers). Gated on the extractor and the injection setting.
      // `let`, because the window arbitration below may shrink it: the developer
      // added their context blocks on purpose and ours is the part that gives
      // ground.
      let surface: PrefillSurface | undefined;
      let injectedSurface = await resolvePrefill(injectionExtractor(document.languageId), document, resolved, log, {
        onSurface: (s) => {
          surface = s;
        },
      });

      // Tell the model which of the file's own
      // definitions the signature/doc references, so it refers to them directly
      // instead of inventing a `use somecrate::LocalType;` for a same-file type.
      // Gated on injection so injection-off is byte-for-byte v1.
      let localSymbols: string[] | undefined;
      if (readOracleConfig().injectionEnabled) {
        const localDefs = fileLocalDefinitionsFor(document.languageId, document.getText());
        // The target's own name is in every one of its own signatures; naming it
        // "already in scope, do not import" is pure noise, so drop it.
        localDefs.delete(resolved.symbolName);
        localSymbols = referencedLocalSymbols(resolved.signature, resolved.docComment, localDefs);
      }
      if (localSymbols && localSymbols.length > 0) {
        log(`[fngen] local symbols named in prompt: ${localSymbols.join(", ")}`);
      }

      // The developer's comment sketch of the body. A body with BOTH code and
      // comments harvests too: the body is replaced by generation anyway, so
      // harvesting from it costs the human nothing, and the "harvested N of M"
      // line is the number that says whether the depth rule needs narrowing.
      // GENERATION only - the TDD gestures never call this.
      const bodyText = bodyTextOfSpan(
        document.getText(
          new vscode.Range(document.positionAt(resolved.span.start), document.positionAt(resolved.span.end)),
        ),
        resolved.languageId,
        // Fork A already moved span.start past the preserved docstring, so the
        // span IS the body and there is no header left to cut.
        resolved.bodyOnly,
      );
      const harvest = harvestBodyComments(bodyText, resolved.languageId, resolved.bodyIndent);
      if (harvest.considered > 0) {
        log(
          `[fngen] scaffold comments: harvested ${harvest.comments.length} of ${harvest.considered}` +
            (harvest.comments.length > 0 ? `: ${harvest.comments.join(" | ")}` : ""),
        );
      }

      // The exact prompt bytes the model was sent, captured as they are sent.
      // The punt circle-back re-sends these; re-assembling them from remembered
      // inputs would be a second source, free to drift from the first.
      let originalPrompt: string | undefined;
      // The blocks those prompt bytes lead with, captured beside them and for
      // the same reason: the retry must reach the checkpoint the first attempt
      // paid for, and re-reading the store would be a second source free to
      // drift from the first.
      let originalBlocks: readonly ContextBlock[] | undefined;
      let result;
      try {
        result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Generating ${resolved.symbolName}…`,
            cancellable: true,
          },
          async (_progress, token) => {
            const controller = new AbortController();
            token.onCancellationRequested(() => controller.abort());
            // Claimed for as long as this runs, so cancel outlives the
            // notification above it being dismissed. Released in the `finally`
            // at the end of this callback, whatever ends the work.
            const claim = inFlight.begin(`Generating ${resolved.symbolName}`, controller);
            try {
            // Read from the LIVE store at generate time, never a copy captured
            // earlier: bar 3 (a removed block must never reach a prompt, zero
            // tolerance) hangs on this ordering. Since v33 the TEXT is live
            // too: each block's lines are sliced out of the document as it
            // reads right now, so an `if` block the human typed into a staged
            // function is in this prompt.
            const contextBlocks = await resolveContextBlocks(announceOnce());
            // ONE object, spread into the request below, so the bytes the
            // arbitration measures are the bytes the service assembles. Two
            // hand-copied field lists would be free to drift, and an estimate
            // taken over a prompt that is not the one sent is worse than no
            // estimate at all.
            const promptInput: FnGenPromptInput = {
              signature: resolved.signature,
              docComment: resolved.docComment,
              contextBlocks,
              languageId: resolved.languageId,
              // The DOC's own column, which is not the code's. A bodyOnly
              // target is Python Fork A, where `stripPyDocstring` has already
              // returned a 0-based docstring - handing it `bodyIndent` would
              // strip a second level out of the prose, and in Fork A the
              // docstring IS the spec (adversarial review D2).
              spanIndent: resolved.bodyOnly ? "" : resolved.headerIndent ?? "",
              injectedSurface,
              noPunt: readOracleConfig().injectionEnabled,
              // Route the prompt shape. "function" is byte-identical to
              // v1; struct/enum use the type-definition instruction; bodyOnly
              // (Python, below a preserved docstring) writes just the body.
              kind: resolved.kind,
              bodyOnly: resolved.bodyOnly,
              // Same-file names the prompt should not re-import.
              localSymbols,
              scaffoldComments: harvest.comments,
            };
            // `return await`, NOT `return`. Inside a try/finally, a bare
            // `return promise` runs the finally at the RETURN, before the
            // promise settles - so the claim was released the instant the
            // generation started and the status-bar item appeared and vanished
            // in the same tick. The await is what makes the finally mean "when
            // this work ends".
            return await service.generate(
              {
                ...promptInput,
                span: resolved.span,
                // ROADMAP ITEM 43. Past `num_ctx` ollama truncates the prompt
                // silently and eats the HEAD - which is our injected surface,
                // not the developer's context blocks. The service arbitrates
                // (it is the one place that assembles the prompt AND holds the
                // window); this is the handle that lets it shrink OURS rather
                // than cut into theirs. A re-render, not a slice: the payload's
                // "use only these types" sentence has to shrink with it.
                ...(surface !== undefined
                  ? { injectedShrink: { blocks: surface.blocks, keep: surface.keep } }
                  : {}),
                onPrompt: (p) => {
                  originalPrompt = p;
                  originalBlocks = contextBlocks;
                },
              },
              controller.signal,
            );
            } finally {
              claim.release();
            }
          },
        );
      } catch (err) {
        // THE REFUSAL. Checked before every other error
        // branch, because it is not a failure: it is the product declining to
        // send a prompt the window would silently cut in half. No buffer write,
        // no proposal, no ghost - this sentence is the whole outcome, and it
        // carries the honest breakdown of whose bytes are whose. The channel
        // line was written where the decision was taken.
        if (isPromptWindowError(err)) {
          void vscode.window.showWarningMessage(err.message);
          return;
        }
        if (isServerUnreachable(err)) {
          // Same recovery gesture the first-run flow offers, on the path the
          // user actually hits: the server being down is a start-the-server
          // problem, not a generation failure. Offer, never auto-spawn — the
          // trust contract keeps process spawning a human-ratified click.
          log(`[fngen] server unreachable at generate time: ${String(err)}`);
          const choice = await vscode.window.showErrorMessage(
            "Column 80: the Ollama server isn't running, so function generation can't reach a model.",
            "Start ollama serve",
          );
          if (choice === "Start ollama serve") {
            await startOllamaTerminal(output, deps.ollamaCheck);
          }
          return;
        }
        void vscode.window.showErrorMessage(generationFailedToast(err, "function generation"));
        return;
      }
      if (!result) {
        return; // aborted: cancellation, never an error
      }

      // v2 circle-back: a punt (todo!/unimplemented!/"not implemented"/placeholder)
      // COMPILES, so the post-accept oracle never catches it. Detect it here and
      // regenerate ONCE, showing the model its own stub with a firm instruction,
      // before the human ever sees the preview. Gated on injection. Function
      // only: a struct/enum body cannot punt, and the anti-punt reprompt is
      // function-shaped, so a type never enters this path.
      if (resolved.kind === "function" && readOracleConfig().injectionEnabled && looksLikePunt(result.text)) {
        log("[fngen] punt detected in the generated body; regenerating with a firm instruction");
        try {
          const retry = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Reworking ${resolved.symbolName} (avoiding a stub)…`, cancellable: true },
            (_p, token) => {
              const controller = new AbortController();
              token.onCancellationRequested(() => controller.abort());
              // Claimed so cancel outlives a dismissed notification; released
              // on the promise below, so a rejection releases it too.
              const claim = inFlight.begin(`Reworking ${resolved.symbolName}`, controller);
              return service.generateRaw(
                assembleAntiPuntReprompt({
                  signature: resolved.signature,
                  docComment: resolved.docComment,
                  punted: result!.text,
                  languageId: resolved.languageId,
                  injectedSurface,
                  // The retry is the ORIGINAL prompt plus the anti-punt
                  // material. Anything less is a different, poorer question:
                  // the capture's retry dropped the context blocks and the
                  // file, and stubbed again.
                  originalPrompt,
                }),
                // bodyOnly rides the retry for the same reason it rides the
                // first call: the anti-punt reprompt still asks for a body at a
                // docstring target, and the head-anchored trim would refuse it.
                {
                  docComment: resolved.docComment,
                  signature: resolved.signature,
                  span: resolved.span,
                  bodyOnly: resolved.bodyOnly,
                  // The retry leads with the original prompt, which leads with
                  // these, so it forks from the same checkpoint instead of
                  // paying to build a second one.
                  contextBlocks: originalBlocks,
                },
                controller.signal,
              ).finally(() => claim.release());
            },
          );
          if (retry && !looksLikePunt(retry.text)) {
            log("[fngen] regeneration is no longer a stub; presenting it");
            result = retry;
          } else if (retry) {
            log("[fngen] regeneration still looks like a stub; presenting the original");
            // Twice asked, twice refused. The preview about to open is a stub,
            // and the model already said why - so say it to the human, in
            // prose, instead of leaving the diagnosis in the channel. An
            // ABORTED retry is the human's own cancellation and stays silent.
            const diagnosis = puntDiagnosis(result.text);
            void vscode.window.showWarningMessage(
              `Column 80: ${resolved.symbolName} came back as a stub twice, so the preview is that stub, not an implementation.` +
                (diagnosis ? ` The model's own reason: ${diagnosis}` : ""),
            );
          } else {
            log("[fngen] regeneration was aborted; presenting the original");
          }
        } catch (err) {
          // THE RETRY IS THE ONE PROMPT THAT CAN STILL OVERFLOW (adversarial
          // review D1): it is the original prompt plus the anti-punt directive
          // plus the stub, so it is strictly LARGER than a prompt that just
          // passed arbitration, and the stub alone can be up to `maxTokens`. The
          // service refuses it now instead of letting ollama eat the head - and
          // the head is the developer's context blocks. Say so, in the same
          // voice as every other refusal, rather than leaving it in the channel:
          // the human is about to be shown a stub and is owed the reason it was
          // not reworked.
          if (isPromptWindowError(err)) {
            log(`[fngen] punt regeneration refused: the retry prompt does not fit the window; presenting the original`);
            void vscode.window.showWarningMessage(
              `${err.message} (This was the retry that would have replaced ${resolved.symbolName}'s stub, so the stub stands.)`,
            );
          } else {
            log(`[fngen] punt regeneration failed: ${String(err)}; presenting the original`);
          }
        }
      }

      // Strip a redundant inline `use` the model added because it could not
      // see the file's imports (the prompt is signature + doc only). Only a name
      // the file already imports at module scope is removed; anything else stays.
      // Also drop a `use` whose leaf names a SAME-FILE definition - the
      // model invents `use atlas::CohortRegister;` for a local `pub struct` it
      // cannot see. Both gated on injection so injection-off is byte-for-byte v1.
      if (readOracleConfig().injectionEnabled) {
        const src = document.getText();
        result.text = stripRedundantUses(result.text, fileImportBindings(src));
        result.text = stripLocalShadowingUses(result.text, fileLocalDefinitionsFor(document.languageId, src));
      }

      // Place the reply at the span's anchor depth before the splice. Otherwise a
      // nested target lands with its body one level short and its closing brace
      // at column 0, and an in-place reply lands a level deep (Python: an
      // IndentationError either way). Every leg is string-literal aware, so a
      // multi-line string member is never shifted, and every leg is a
      // byte-for-byte no-op at headerIndent === "" (a top-level target).
      // Repair and refine call the same dispatcher.
      result.text = placeGeneratedReply(result.text, {
        languageId: document.languageId,
        bodyOnly: resolved.bodyOnly,
        headerIndent: resolved.headerIndent,
        bodyIndent: resolved.bodyIndent,
      });

      const outcome = await presenter.present({
        document,
        span: resolved.span,
        versionAtResolve,
        title: `${resolved.symbolName}: generated body (preview)`,
        text: result.text,
        service,
      });
      if (outcome !== "accept") {
        return;
      }
      // Fire-and-forget with a catch: the edit already landed, so an oracle
      // failure is evidence in the channel, never a broken accept gesture.
      // The gate is re-read at accept time (a config change can flip the
      // tier mid-generation); a closed gate still checks-and-surfaces, it
      // only bars repair rounds.
      void tierGate()
        .then((repairTierGate) =>
          withVerifyStatus(
            runPostAcceptOracle({
              document,
              landedSpan: {
                start: resolved.span.start,
                end: resolved.span.start + result.text.length,
              },
              source: "fngen",
              service,
              // The registry, so a repair or refine round can be stopped from the
              // status bar (roadmap item 67's ruled cancel affordance).
              inFlight,
              output,
              presenter,
              // The post-accept re-resolution admits Struct/Enum under the
              // same gate the command uses, so a landed struct/enum resolves
              // (kind carried) and the E0425 worked-example steering fires
              // instead of aborting. Re-read at accept, like the extractor.
              resolveFunction: (doc, pos) =>
                resolveFunctionAtCursor(doc, pos, readOracleConfig().injectionEnabled),
              repairTierGate,
              extractor: injectionExtractor(document.languageId),
              fetchCatalog: catalogFetcher,
              // Live read: a repair round sees the same staged context the
              // generation did (or whatever the user has staged by round time),
              // and since v33 the same LIVE text, read at round time rather than
              // at generate time. Silent about lost blocks: the generation that
              // led here already named them.
              readContextBlocks: () => resolveContextBlocks(),
              // The span-surface engine, injected rather than imported: the runtime
              // dependency arrow runs this file -> oracleSurface, never back.
              resolveSpanSurface: (extractor, doc, target, logLine, opts) =>
                resolvePrefill(extractor, doc, target, logLine, opts),
              resolveCallOwners: (extractor, doc, targets, logLine, skip) =>
                resolveCallOwners(extractor, doc, targets, logLine, skip),
            }),
          ),
        )
        .catch((err) => output.appendLine(`[oracle] post-accept hook failed: ${String(err)}`));
    }),

    // FIM-accept trigger: the inline item's accept command (wired in the
    // completion provider) lands here. Same post-accept flow, same repair
    // service; non-blocking so an oracle hiccup can never break the accept.
    // Same fail-closed tier gate as every other model-call entry point.
    vscode.commands.registerCommand(
      "column80.fimAccepted",
      (uriString: string, startOffset: number, textLength: number) => {
        const document = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === uriString,
        );
        if (!document) {
          return;
        }
        void tierGate()
          .then((repairTierGate) =>
            withVerifyStatus(
              runPostAcceptOracle({
                document,
                landedSpan: { start: startOffset, end: startOffset + textLength },
                source: "fim",
                service,
                // The registry, so a repair or refine round can be stopped from the
                // status bar (roadmap item 67's ruled cancel affordance).
                inFlight,
                output,
                presenter,
                // Admit Struct/Enum under the injection gate so a FIM
                // accept inside a type resolves to the container and repairs
                // as a type; v1 function-only when injection is off.
                resolveFunction: (doc, pos) =>
                  resolveFunctionAtCursor(doc, pos, readOracleConfig().injectionEnabled),
                repairTierGate,
                extractor: injectionExtractor(document.languageId),
                fetchCatalog: catalogFetcher,
                // Silent about lost blocks: a FIM accept is not a gesture that
                // built a prompt from the panel, so a warning here would arrive
                // attached to nothing the human just asked for.
                readContextBlocks: () => resolveContextBlocks(),
                // The span-surface engine, injected rather than imported: the runtime
                // dependency arrow runs this file -> oracleSurface, never back.
                resolveSpanSurface: (extractor, doc, target, logLine, opts) =>
                  resolvePrefill(extractor, doc, target, logLine, opts),
                resolveCallOwners: (extractor, doc, targets, logLine, skip) =>
                  resolveCallOwners(extractor, doc, targets, logLine, skip),
              }),
            ),
          )
          .catch((err) => output.appendLine(`[oracle] post-accept hook failed: ${String(err)}`));
      },
    ),

    // Manual "Repair Function" command: the same post-accept oracle (check,
    // surface, repair) the accept paths run, but on demand for the function
    // already under the cursor. Same service, presenter, extractor, catalog,
    // and staged-context reader - no second repair route.
    vscode.commands.registerCommand("column80.repairFunction", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage("Column 80: no active editor.");
        return;
      }
      const document = editor.document;
      // Same honest-dark gate as generateFunction, BEFORE the symbol resolve
      // and the Ollama probe: without it a .go repair resolves via gopls,
      // may offer "Start ollama serve" for a repair that can never run, shows
      // the verify spinner, then dies in the oracle's silent no-oracle branch -
      // a spinner that vanishes, the exact silent fallthrough the gate bans.
      if (!isRegisteredLanguage(document.languageId)) {
        output.appendLine(`[repair] refused: ${document.languageId} is not a registered language`);
        void vscode.window.showWarningMessage(
          `Column 80: function repair is not supported for ${document.languageId} - it supports ${SUPPORTED_LANGUAGES_TEXT}.`,
        );
        return;
      }
      const admitTypes = readOracleConfig().injectionEnabled;
      const resolution = await resolveFunctionOrRefusal(
        document,
        editor.selection.active,
        admitTypes,
      );
      if (!resolution.ok) {
        log(refusalLogLine(resolution.refusal, document.languageId));
        void vscode.window.showWarningMessage(
          refusalMessage(
            resolution.refusal,
            document.languageId,
            "Column 80: no function at the cursor to repair.",
          ),
        );
        return;
      }
      const resolved = resolution.fn;
      // Fail-closed gate, read at invoke time like the accept paths, and read
      // BEFORE the server pre-flight: the pre-flight's listModels is a network
      // request, and a refused gesture must issue none (item 58). A closed
      // tier still checks-and-surfaces through the oracle; it only bars the
      // repair rounds, with the reason on the record. Tell the user so a
      // no-repair outcome on a closed tier is never a silent mystery.
      const repairTierGate = await tierGate();
      // Repair rounds need the model server. Pre-flight it - only when the
      // gate allows rounds at all - and offer the same start gesture generate
      // and FIM use, so a down daemon surfaces HERE instead of as a
      // silently-failed round buried in the oracle. One listModels call
      // answers "is the server up". The cloud backend has no local daemon to
      // start, so skip the probe: its reachability surfaces as a normal round
      // error against the provider.
      const probe = deps.listModels ?? listModels;
      if (
        repairTierGate.allowed &&
        readCloudConfig() === undefined &&
        (await probe(readFnGenConfig().apiBase)) === undefined
      ) {
        output.appendLine("[repair] manual repair: server unreachable; offering start");
        const choice = await vscode.window.showWarningMessage(
          "Column 80: the Ollama server isn't running, so the function can't be repaired.",
          "Start ollama serve",
        );
        if (choice === "Start ollama serve") {
          await startOllamaTerminal(output, deps.ollamaCheck);
        }
        return;
      }
      if (!repairTierGate.allowed) {
        const why =
          repairTierGate.reason === "tier-unresolved"
            ? 'the hardware tier could not be resolved. Re-run "Column 80: Select Hardware Tier"'
            : (tier?.message ?? "the current hardware tier disables function generation");
        output.appendLine(
          `[repair] manual repair: gate closed reason=${repairTierGate.reason}; check-and-surface only: ${why}`,
        );
        void vscode.window.showWarningMessage(
          // `hasMoreThanOneLine`, not `firstLine(why) === why.trim()`. The two
          // agree on every message broken by `\n`, and disagree once `firstLine`
          // cuts the wider set: `trim()` strips U+2028 and U+2029 but not NEL,
          // so a `why` ending in NEL was cut by the toast and kept by the
          // comparison, and the pointer promised a channel line that had no more
          // than the toast did. The leaf states the rule now; this was the last
          // site still inferring it.
          `Column 80: repair is unavailable - ${firstLine(why)}. Errors are still checked and surfaced.` +
            (hasMoreThanOneLine(why) ? " The full message is in the output channel." : ""),
        );
      }
      // One announcer for the whole invocation. The oracle runs the reader once
      // per repair round, and two rounds naming the same lost blocks in two
      // toasts is the repetition the accept paths stay silent to avoid.
      const announce = announceOnce();
      await withVerifyStatus(
        (deps.runOracle ?? runPostAcceptOracle)({
          document,
          landedSpan: resolved.span,
          source: "fngen",
          service,
          // The registry, so a repair or refine round can be stopped from the
          // status bar (roadmap item 67's ruled cancel affordance).
          inFlight,
          output,
          presenter,
          resolveFunction: (doc, pos) =>
            resolveFunctionAtCursor(doc, pos, readOracleConfig().injectionEnabled),
          repairTierGate,
          extractor: injectionExtractor(document.languageId),
          fetchCatalog: catalogFetcher,
          // The one repair path the human invoked THEMSELVES, so it announces a
          // dropped block the way a generation does: this gesture builds its own
          // prompt, and a prompt quietly missing something the panel still lists
          // is the class of thing this product exists not to do.
          readContextBlocks: () => resolveContextBlocks(announce),
          // Repair becomes refine when the build is already clean, and ONLY
          // here. The human's words: "if the user initiates the repair command,
          // and there's no build error and everything's fine, then ... inject
          // other usages of the types and methods". The two accept paths above
          // deliberately do not pass this: a clean accept still ends at
          // `why=clean`, silently, exactly as it always has.
          manualRefine: true,
          // The span-surface engine, injected rather than imported: the runtime
          // dependency arrow runs this file -> oracleSurface, never back.
          resolveSpanSurface: (extractor, doc, target, logLine, opts) =>
            resolvePrefill(extractor, doc, target, logLine, opts),
          resolveCallOwners: (extractor, doc, targets, logLine, skip) =>
            resolveCallOwners(extractor, doc, targets, logLine, skip),
        }),
      ).catch((err) => output.appendLine(`[oracle] manual repair failed: ${String(err)}`));
    }),

    // TDD Generate Tests — the blind, blank-value test-authoring gesture.
    // Classify (honest-failure) -> generate tests blind of any implementation ->
    // blank the expected values -> insert as a live snippet the human Tabs and
    // types. The impl is generated separately (the existing Generate Function,
    // blind of these tests by construction), then Run TDD Tests surfaces the
    // pass/red divergence.
    //
    // Five languages, through `tddLangFor`. What used to be Rust-literal here —
    // the return-type reader, the scaffold, the blanker, the marker format, the
    // testability classifier and the assertion idiom — all come off the resolved
    // leg and its resolved framework now. Supersession S2 in docs/supersessions.md.
    vscode.commands.registerCommand("column80.generateTests", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage("Column 80: no active editor.");
        return;
      }
      // The per-language gate. An unregistered language gets a refusal NAMING it,
      // exactly as oracleFor's does for the check, and it says the gesture does
      // not exist here rather than implying a runner is merely missing. It stops
      // saying "Rust-only": after S2 there is no Rust-only gate left to name, and
      // a refusal describing a gate that no longer exists is a lie.
      const lang = tddLangFor(editor.document.languageId);
      if (lang === undefined) {
        output.appendLine(`[tdd] refused: no TDD leg registered for ${editor.document.languageId}`);
        void vscode.window.showWarningMessage(
          `Column 80: TDD test generation is not built for ${editor.document.languageId} — this gesture is only registered for ${tddLanguageIds().join(", ")}.`,
        );
        return;
      }
      const gate = await tierGate();
      if (!gate.allowed) {
        const why = tier?.message ?? "the hardware tier is unavailable for generation";
        output.appendLine(`[tdd] tests skipped: tier ${gate.reason}: ${why}`);
        // The period goes on the CUT clause, never into the text being cut: a
        // sentence built first and shortened after loses its own punctuation to
        // the cut and glues the channel pointer onto a half-sentence.
        void vscode.window.showWarningMessage(`Column 80: ${tierDisabledToast(why, ".")}`);
        return;
      }
      const document = editor.document;
      const versionAtResolve = document.version;
      // TDD tests target FUNCTIONS only (a struct/enum has no behaviour to assert).
      const resolution = await resolveFunctionOrRefusal(document, editor.selection.active, false);
      if (!resolution.ok) {
        log(refusalLogLine(resolution.refusal, document.languageId));
        void vscode.window.showWarningMessage(
          refusalMessage(
            resolution.refusal,
            document.languageId,
            "Column 80: place the cursor in a function to generate TDD tests.",
          ),
        );
        return;
      }
      const resolved = resolution.fn;
      if (resolved.kind !== "function") {
        void vscode.window.showWarningMessage(
          "Column 80: place the cursor in a function to generate TDD tests.",
        );
        return;
      }
      if (document.version !== versionAtResolve) {
        void vscode.window.showWarningMessage(
          "Column 80: TDD tests discarded — the document changed during resolution.",
        );
        return;
      }
      // WHERE the tests go, and WHICH framework runs them, before the model is
      // asked anything: the framework's assertion idiom is part of the prompt, and
      // a project with nowhere to put a test should not spend a generation first.
      const tddDeps: TddDeps = { log };
      const placed = lang.placementFor(document.uri.fsPath, resolved.symbolName, tddDeps);
      // A placement refusal stops the gesture for the four languages whose tests
      // need a sibling file or an existing test project. It does NOT stop a
      // language whose tests live in the file under the cursor: Rust's go at the
      // bottom of the module under test, so a missing Cargo.toml is a missing RUN
      // root, which `runTddTests` refuses over and names. Authoring never did.
      const fallback = placed.ok ? undefined : lang.placementWithoutProject?.(document.uri.fsPath);
      if (!placed.ok && fallback === undefined) {
        output.appendLine(`[tdd] refused: placement ${placed.refusal.reason} — ${placed.refusal.detail}`);
        void vscode.window.showWarningMessage(`Column 80: ${placed.refusal.detail}.`);
        return;
      }
      const placement = placed.ok ? placed.placement : (fallback as TestPlacement);
      if (!placed.ok) {
        output.appendLine(
          `[tdd] no project (${placed.refusal.reason}): authoring into ${placement.targetPath}; the tests will have nowhere to run until this is fixed — ${placed.refusal.detail}`,
        );
      }
      const resolvedFramework = frameworkFor(lang, placement.runRoot, tddDeps);
      // Honest-dark, never a guess and never an install: name every framework that
      // was looked for and stop. The one exception is the language that just told
      // us it needs no project — a project that does not exist cannot answer a
      // detection question either, and such a language declares a single framework
      // that ships with its toolchain, so there is nothing to be dark ABOUT.
      const framework = resolvedFramework.ok
        ? resolvedFramework.framework
        : !placed.ok && lang.frameworks.length === 1
          ? lang.frameworks[0]
          : undefined;
      if (framework === undefined) {
        const detail = !resolvedFramework.ok
          ? resolvedFramework.detail ?? `looked for ${resolvedFramework.lookedFor.join(", ")} in ${placement.runRoot}`
          : "";
        output.appendLine(`[tdd] refused: no test framework — ${detail}`);
        void vscode.window.showWarningMessage(`Column 80: this project has no test framework configured — ${detail}.`);
        return;
      }
      // Honest-failure gate: TDD generation fits a minority of functions. Surface
      // WHY, never emit a hollow or mocked test. The ctx carries the one PROJECT
      // fact a signature cannot show, and the LEG resolves it (C# alone has one).
      const testabilityCtx = lang.testabilityContextFor?.(document.uri.fsPath, placement, tddDeps);
      const testability = lang.classifyTestability(resolved.signature, resolved.docComment, testabilityCtx);
      if (!testability.testable) {
        output.appendLine(`[tdd] not auto-testable fn=${resolved.symbolName} reason=${testability.reason}`);
        void vscode.window.showInformationMessage(`Column 80: not auto-testable — ${testability.detail}.`);
        return;
      }
      const returnType = lang.returnTypeOf(resolved.signature);
      if (returnType === undefined) {
        output.appendLine(`[tdd] no return type on ${resolved.symbolName}; nothing to assert`);
        void vscode.window.showInformationMessage(
          "Column 80: not auto-testable — the function returns no value to assert.",
        );
        return;
      }
      // Blind: the test pass sees the contract + the resolved callee surface,
      // NEVER a reference implementation (independence — the red signal).
      const calleeSurface = await resolvePrefill(injectionExtractor(document.languageId), document, resolved, log, {
        importTargetPath: placement.targetPath,
        forConstruction: true,
      });
      let result;
      try {
        result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Generating tests for ${resolved.symbolName}…`, cancellable: true },
          (_p, token) => {
            const controller = new AbortController();
            token.onCancellationRequested(() => controller.abort());
            // Claimed so cancel outlives a dismissed notification; released on
            // the promise below, so a rejection releases it too.
            const claim = inFlight.begin(`Generating tests for ${resolved.symbolName}`, controller);
            return service.generateTests(
              {
                signature: resolved.signature,
                docComment: resolved.docComment,
                calleeSurface,
                languageId: resolved.languageId,
                assertionInstruction: framework.assertionInstruction,
                replyShape: framework.replyShape,
                languageName: lang.displayName,
                span: resolved.span,
              },
              controller.signal,
            ).finally(() => claim.release());
          },
        );
      } catch (err) {
        // The window refusal is not a failure to report as one: nothing broke,
        // the prompt did not fit and no model was called. Same voice, same
        // breakdown as generation's (adversarial review D1) - the callee surface
        // this prompt carries is exactly what can push it over.
        if (isPromptWindowError(err)) {
          void vscode.window.showWarningMessage(err.message);
          return;
        }
        if (isServerUnreachable(err)) {
          log(`[tdd] server unreachable: ${String(err)}`);
          const choice = await vscode.window.showErrorMessage(
            "Column 80: the Ollama server isn't running, so tests can't be generated.",
            "Start ollama serve",
          );
          if (choice === "Start ollama serve") {
            await startOllamaTerminal(output, deps.ollamaCheck);
          }
          return;
        }
        void vscode.window.showErrorMessage(generationFailedToast(err, "test generation"));
        return;
      }
      if (!result) {
        return; // aborted
      }
      // Decide WHERE inside the target file (detect-and-extend, never clobber the
      // developer's tests), then blank the located text's expected values into a
      // snippet. The target is not always this document: only Rust puts its tests
      // in the file under test.
      const sameFile = placement.targetPath === document.uri.fsPath;
      // The plan's offsets are applied to a DOCUMENT, so they must be computed
      // over that document's text. When the target test file is already open and
      // DIRTY, its buffer and its bytes on disk differ: an append would land at
      // the wrong offset and the whole-file gate would be measured against text
      // nobody is looking at. Prefer the open buffer; fall back to disk only when
      // nothing has it open.
      const openTarget = sameFile
        ? document
        : vscode.workspace.textDocuments.find((d) => !d.isClosed && d.uri.fsPath === placement.targetPath);
      const existingText = openTarget !== undefined ? openTarget.getText() : safeReadFile(placement.targetPath) ?? "";
      const structFields: StructFieldShape[] | undefined = undefined;
      const plan = lang.scaffold({
        existingText,
        generatedTests: result.text,
        markerId: resolved.symbolName,
        placement,
      });
      const blanked = blankExpectedValues(lang, framework, plan.text, returnType, { structFields });
      // The blank-value floor, in two halves.
      //
      // ZERO HOLES: the locator found no expected value at all, so the text would
      // go in VERBATIM with the model's guess in it, under a message saying tests
      // were inserted. That is the blank-value invariant inverted.
      //
      // ANY UNRESOLVED SITE (scraps D5): the locator walked an assertion carrying
      // an expected value and could not place it. The OTHER assertions still
      // produced holes, so a holes-only floor passes while the guess ships beside
      // them — the locator does not have to be WRONG to lie, only SILENT. The
      // whole pass is refused, because a partial blanking is exactly the shape
      // that reads as safe and is not.
      //
      // Both refuse ahead of BOTH write paths AND ahead of the preview, because a
      // preview of an unblanked test leaks the guess just as surely as a buffer.
      if (blanked.holes === 0) {
        output.appendLine(
          `[tdd] refused: no expected value located in the generated tests for ${resolved.symbolName}; nothing written`,
        );
        void vscode.window.showWarningMessage(
          `Column 80: no expected value could be located in the generated tests for ${resolved.symbolName}, so nothing was written.`,
        );
        return;
      }
      if (blanked.unresolved > 0) {
        // The WORDING matters, because with survival where it is this message is
        // met often. Column 80 DECLINED a shape it does not blank; the generated
        // tests are not faulty and neither is the human's code. Say that, and say
        // what to do next.
        output.appendLine(
          `[tdd] declined: ${blanked.unresolved} assertion shape(s) in the generated tests for ${resolved.symbolName} are ones this gesture does not blank; nothing written`,
        );
        void vscode.window.showWarningMessage(
          `Column 80: ${blanked.unresolved} of the generated assertions for ${resolved.symbolName} are written in a shape this gesture declines to blank, so nothing was written. Inserting a partly blanked pass would leave a guessed value in your file. Run it again for a different generation, or write those cases yourself.`,
        );
        return;
      }
      if (document.isClosed || document.version !== versionAtResolve) {
        void vscode.window.showWarningMessage(
          "Column 80: TDD tests discarded — the document changed during generation.",
        );
        return;
      }

      // The blank-value snippet is a DELIBERATE second document write path, distinct
      // from ProposalPresenter's read-only diff: blank-value entry needs an editable
      // buffer so the human Tabs the holes and TYPES each expected value. Not silent
      // — an explicit command, visible holes, the human owns every value — so the
      // trust invariant's spirit (no silent model write) holds.
      //
      // Creating the target FILE is the THIRD write path (S3), and it is the one
      // gesture here that cannot be verified without a human at a keyboard. The
      // written steps for driving it did not survive.
      if (!placement.exists) {
        const created = await createTestFileWithSnippet({
          presenter,
          output,
          targetPath: placement.targetPath,
          symbolName: resolved.symbolName,
          holes: blanked.holes,
          snippet: blanked.snippet,
          // The preview shows the file with its expected values STILL BLANK. The
          // model's guess must not appear anywhere the human can see, including a
          // diff they only read; blankSnippetToDisplay is the one renderer for it.
          previewFullText: blankSnippetToDisplay(blanked.snippet),
        });
        if (created) {
          void vscode.window.showInformationMessage(
            `Tests created in ${path.basename(placement.targetPath)} — Tab through the ${blanked.holes} blank value(s), type each expected value, then generate the function and run "Run TDD Tests".`,
          );
        }
        return;
      }

      // The target exists. Open it when it is not the document under the cursor,
      // so the snippet lands in the file the plan was computed against.
      let targetEditor = editor;
      let targetDocument = document;
      if (!sameFile) {
        try {
          // `openTarget` when it exists, so the document the offsets are applied
          // to is the very one they were computed over.
          targetDocument = openTarget ?? (await vscode.workspace.openTextDocument(vscode.Uri.file(placement.targetPath)));
          targetEditor = await vscode.window.showTextDocument(targetDocument, editor.viewColumn);
        } catch (err) {
          void vscode.window.showWarningMessage(
            `Column 80: TDD tests discarded — ${placement.targetPath} could not be opened (${firstLine(String(err))}).`,
          );
          return;
        }
      }
      // WHICH plans get reviewed before they land, and it is decided by SHAPE, not
      // by the mode string. `replace-generated` is a regen over a marked region.
      // A plan spanning start 0 to the end of a NON-EMPTY document is a whole-file
      // rewrite, which is what a plan that must add an import looks like — and it
      // is indistinguishable BY MODE from a small append, which is why the mode
      // string cannot be the gate. An append can never produce that span, so the
      // shape is unreachable from the branch that does not need a review.
      const wholeFile = plan.start === 0 && plan.end === existingText.length && existingText.length > 0;
      if (plan.mode === "replace-generated" || wholeFile) {
        // REVIEW the change before touching the buffer. The diff shows the new
        // tests (values still BLANK — never the model's guesses). Accept -> the
        // tab-in below; Reject / ESC / closing the tab cancels with no write.
        const preview = spliceSpan(
          targetDocument.getText(),
          { start: plan.start, end: plan.end },
          blankSnippetToDisplay(blanked.snippet),
        );
        const title =
          plan.mode === "replace-generated"
            ? `Regenerate tests for ${resolved.symbolName} — review, then Tab the values`
            : `Add tests for ${resolved.symbolName} to ${path.basename(placement.targetPath)} — review, then Tab the values`;
        const decision = await presenter.confirmDiff({
          document: targetDocument,
          previewFullText: preview,
          title,
          // The whole-file rewrite gets the notification too, because the human
          // may be looking at the SOURCE file rather than at the diff tab. The
          // regen path keeps its tab-only gesture, byte for byte.
          ...(wholeFile && plan.mode !== "replace-generated"
            ? {
                prompt: `Column 80: adding tests for ${resolved.symbolName} rewrites ${path.basename(placement.targetPath)} whole (the file needs a new import). Review the diff, then choose.`,
                acceptLabel: "Apply to the test file",
              }
            : {}),
        });
        output.appendLine(`[tdd] review=${decision} mode=${plan.mode} whole-file=${wholeFile} fn=${resolved.symbolName}`);
        if (decision !== "accept") {
          return; // Reject / ESC / closed tab: no write
        }
        // The review took human time; re-validate before the write.
        if (targetDocument.isClosed || (sameFile && targetDocument.version !== versionAtResolve)) {
          void vscode.window.showWarningMessage(
            "Column 80: TDD tests discarded — the document changed during review.",
          );
          return;
        }
        // The diff tab was active; bring the target back so the snippet lands in it.
        try {
          targetEditor = await vscode.window.showTextDocument(targetDocument, editor.viewColumn);
        } catch {
          void vscode.window.showWarningMessage(
            "Column 80: TDD tests discarded — the target editor could not be reopened.",
          );
          return;
        }
      } else if (sameFile && vscode.window.activeTextEditor?.document !== document) {
        // Non-regen, same file: the model call is slow; a tab-switch would make
        // `editor` point at a document the user is no longer looking at. Only
        // write when our target is still the active editor.
        void vscode.window.showWarningMessage(
          "Column 80: TDD tests discarded — the active editor changed during generation.",
        );
        return;
      }

      output.appendLine(`[tdd] tests fn=${resolved.symbolName} mode=${plan.mode} holes=${blanked.holes} target=${placement.targetPath}`);
      const range = new vscode.Range(targetDocument.positionAt(plan.start), targetDocument.positionAt(plan.end));
      const ok = await targetEditor.insertSnippet(new vscode.SnippetString(blanked.snippet), range);
      if (!ok) {
        void vscode.window.showWarningMessage("Column 80: the editor refused the test insertion.");
        return;
      }
      // holes is always > 0 here: the floor above returns on a zero-hole pass.
      void vscode.window.showInformationMessage(
        `Tests inserted — Tab through the ${blanked.holes} blank value(s), type each expected value, then generate the function and run "Run TDD Tests".`,
      );
    }),

    // Run TDD Tests — the test rung. Surfaces PASS or the RED
    // divergence between the ratified tests and the implementation (the deliverable
    // fn-gen cannot show). The human adjudicates blame; fn-repair is separate.
    //
    // Report-only in all five languages, deliberately: repair from an assertion
    // failure is roadmap item 14 and ARCHITECTURE.md invariant 4 forbids it.
    vscode.commands.registerCommand("column80.runTddTests", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage("Column 80: no active editor.");
        return;
      }
      const document = editor.document;
      // The same per-language gate as generateTests, worded the same way: the
      // refusal is about the LANGUAGE having no leg, never about a missing runner,
      // because "no test rung for ruby" would imply the gesture exists here.
      const lang = tddLangFor(document.languageId);
      if (lang === undefined) {
        output.appendLine(`[tdd] refused: no TDD leg registered for ${document.languageId}`);
        void vscode.window.showWarningMessage(
          `Column 80: running TDD tests is not built for ${document.languageId} — this gesture is only registered for ${tddLanguageIds().join(", ")}.`,
        );
        return;
      }
      // Scope the rung to EXACTLY this function's generated tests, so a red never
      // blames the whole project's tests on this implementation (the human
      // adjudicates THIS function's test-vs-impl divergence, not unrelated tests).
      const resolution = await resolveFunctionOrRefusal(document, editor.selection.active, false);
      if (!resolution.ok) {
        log(refusalLogLine(resolution.refusal, document.languageId));
        void vscode.window.showWarningMessage(
          refusalMessage(
            resolution.refusal,
            document.languageId,
            "Column 80: place the cursor in the function whose TDD tests you want to run.",
          ),
        );
        return;
      }
      const resolved = resolution.fn;
      if (resolved.kind !== "function") {
        void vscode.window.showWarningMessage(
          "Column 80: place the cursor in the function whose TDD tests you want to run.",
        );
        return;
      }
      const tddDeps: TddDeps = { log };
      const placed = lang.placementFor(document.uri.fsPath, resolved.symbolName, tddDeps);
      if (!placed.ok) {
        output.appendLine(`[tdd] run refused: placement ${placed.refusal.reason} — ${placed.refusal.detail}`);
        void vscode.window.showWarningMessage(`Column 80: ${placed.refusal.detail}.`);
        return;
      }
      const placement = placed.placement;
      const resolvedFramework = frameworkFor(lang, placement.runRoot, tddDeps);
      if (!resolvedFramework.ok) {
        const detail =
          resolvedFramework.detail ??
          `looked for ${resolvedFramework.lookedFor.join(", ")} in ${placement.runRoot}`;
        output.appendLine(`[tdd] run refused: no test framework — ${detail}`);
        void vscode.window.showWarningMessage(`Column 80: this project has no test framework configured — ${detail}.`);
        return;
      }
      const framework = resolvedFramework.framework;
      const sameFile = placement.targetPath === document.uri.fsPath;
      if (sameFile && document.isDirty) {
        await document.save();
      }
      const testFileText = sameFile ? document.getText() : safeReadFile(placement.targetPath) ?? "";
      // The placement rides along because a test name is not always spelled in
      // full inside the file: Rust's libtest path starts with the segment the
      // FILE contributes, which only the crate layout knows.
      const testNames = lang.generatedTestNames(testFileText, resolved.symbolName, { placement, deps: tddDeps });
      if (testNames.length === 0) {
        // "Generate some" was the ONLY exit this sentence offered, and on a file
        // that already has hand-written tests for the target it is wrong advice:
        // the developer does not want tests written, they want the ones they have
        // run. This rung cannot run those - it selects by the fence it wrote, and
        // nothing fenced them - but its SIBLING discovers them through the call
        // graph, so name it. Only when the language actually has that leg:
        // `coveringTestPlan` is undefined for a languageId with no row in
        // RUN_TESTS_LANGS, and pointing someone at a gesture that will refuse them
        // is a worse dead end than the one being fixed.
        const sibling = coveringTestPlan({
          languageId: document.languageId,
          targetFilePath: document.uri.fsPath,
          log,
        });
        const alternative =
          sibling === undefined
            ? ""
            : ` Run "Column 80: Run Covering Tests" instead to run this repo's own tests that reach it.`;
        output.appendLine(
          `[tdd] run refused: no marked region for ${resolved.symbolName} in ${placement.targetPath}`,
        );
        void vscode.window.showInformationMessage(
          `Column 80: no generated tests for ${resolved.symbolName} - run "Generate Tests (TDD)" to write some.${alternative}`,
        );
        return;
      }
      let res;
      try {
        res = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Running tests for ${resolved.symbolName}…`, cancellable: true },
          (_p, token) => {
            const controller = new AbortController();
            token.onCancellationRequested(() => controller.abort());
            // A spawned test run claims too. It is not a generation, and the
            // contract's out-of-scope line first said so - but a hung
            // `cargo test` behind a dismissed notification is the same user
            // problem as a hung server, and it is work this product started.
            const claim = inFlight.begin(`Running tests for ${resolved.symbolName}`, controller);
            return runFrameworkTestsAt(framework, placement, testNames, {
              log,
              signal: controller.signal,
            }).finally(() => claim.release());
          },
        );
      } catch (err) {
        // A cancel is not a failure, and this arm is now cancellable from the
        // status bar as well as from the notification, so the throw that
        // arrives here can be the user's own action. Toasting "the run could
        // not start" at someone who just cancelled the run is the wrong cause
        // and an alarming one. Silent, with the channel keeping the record.
        if (isCancellation(err)) {
          output.appendLine(`[tdd] the ${framework.displayName} run was cancelled`);
          return;
        }
        // The spawn itself failed: the runner binary is not on PATH, or the
        // process could not start. NOT a compile error — nothing was built. Name
        // the problem and STOP: this product never offers to install anything.
        output.appendLine(`[tdd] the ${framework.displayName} run could not start: ${String(err)}`);
        void vscode.window.showErrorMessage(
          `Column 80: the ${framework.displayName} run could not start — ${firstLine(String(err))}. Nothing was built and no test ran.`,
        );
        return;
      }
      if (res === undefined) {
        void vscode.window.showWarningMessage("Column 80: no project root for this file.");
        return;
      }
      if (!res.ran) {
        reportNoRun(output, framework, res, resolved.symbolName, testNames);
        return;
      }
      if (res.success) {
        void vscode.window.showInformationMessage(`Column 80: ${res.passed} test(s) passed for ${resolved.symbolName}.`);
        return;
      }
      // THE FIFTH OUTCOME. The run happened, so none of the four no-run sentences
      // is reachable, and it executed nothing, so the `passed + failed > 0` green
      // rule correctly refuses it. Without its own sentence it falls to the RED
      // branch below and reads "0 test(s) failed (0 passed) — divergence between
      // the ratified tests and the implementation": a red naming zero failures,
      // pointing the human at an implementation that was never exercised. The
      // green rule is right; that report is not.
      if (res.passed + res.failed === 0) {
        output.appendLine(
          `[tdd] every test for ${resolved.symbolName} was skipped by ${framework.displayName}: ${testNames.join(", ")}`,
        );
        void vscode.window.showWarningMessage(
          `Column 80: every test for ${resolved.symbolName} was SKIPPED. ${framework.displayName} ran and executed none of ${testNames.join(", ")}. Nothing passed and nothing failed, so this is neither a green nor a divergence.`,
        );
        return;
      }
      // The RED divergence — the deliverable. Surface exactly which failed and the
      // assertion text; the human adjudicates test-vs-impl blame. When the runner
      // gave no per-test detail (e.g. a should_panic that did not panic), still name
      // the failed cases from the run so the channel is never silently empty.
      const detail =
        res.failures.length > 0
          ? res.failures.map((f) => `  ${f.name}:\n${f.message.replace(/^/gm, "    ")}`).join("\n")
          : res.cases.filter((c) => c.outcome === "fail").map((c) => `  ${c.name}: failed (no failure detail reported by the runner)`).join("\n");
      output.appendLine(`[tdd] RED for ${resolved.symbolName} failed=${res.failed} passed=${res.passed}\n${detail}`);
      void vscode.window.showWarningMessage(
        `Column 80: ${res.failed} test(s) failed (${res.passed} passed) for ${resolved.symbolName} — divergence between the ratified tests and the implementation. See the output channel.`,
      );
    }),

    // Run Covering Tests - the REPO's OWN tests for the function under the
    // cursor, found by walking the call hierarchy UPWARD from it and keeping
    // every caller that classifies as a test.
    //
    // A SIBLING of `column80.runTddTests`, never a rename of it, and the two
    // differ in WHOSE tests they run. That one runs the tests this product
    // GENERATED, selected by name through `generatedTestNames` off the marked
    // region it wrote, so a red there is this function's own test-vs-impl
    // divergence. This one runs tests the product never wrote and cannot
    // recognise by name, which is exactly why they have to be DISCOVERED
    // through the call graph rather than looked up.
    //
    // Report only. It reads, it spawns the repo's runner, and it writes no
    // document of any kind.
    vscode.commands.registerCommand("column80.runTests", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage("Column 80: no active editor.");
        return;
      }
      const document = editor.document;
      // The same per-language gate as the TDD rung, worded the same way: the
      // refusal is about the LANGUAGE having no leg, never about a missing
      // runner, because "no test rung for ruby" would imply the gesture exists
      // here. A languageId with a TDD leg but no row in RUN_TESTS_LANGS has no
      // leg for THIS gesture either, so both gaps get the one honest sentence.
      const plan = coveringTestPlan({ languageId: document.languageId, targetFilePath: document.uri.fsPath, log });
      if (plan === undefined) {
        output.appendLine(`[tests] refused: no covering-test leg registered for ${document.languageId}`);
        void vscode.window.showWarningMessage(
          `Column 80: running covering tests is not built for ${document.languageId} - this gesture is only registered for ${tddLanguageIds().join(", ")}.`,
        );
        return;
      }
      const resolution = await resolveFunctionOrRefusal(document, editor.selection.active, false);
      if (!resolution.ok) {
        log(refusalLogLine(resolution.refusal, document.languageId));
        void vscode.window.showWarningMessage(
          refusalMessage(
            resolution.refusal,
            document.languageId,
            "Column 80: place the cursor in the function whose covering tests you want to run.",
          ),
        );
        return;
      }
      const resolved = resolution.fn;
      // BOTH GESTURES GATE ON A FUNCTION TARGET (adversarial review row A2b).
      // This one refused a type target while the Repair Function test leg
      // accepted any kind, so a cursor on a struct or a class made one gesture
      // refuse and the other run a repair round off tests the developer was
      // never shown. The two are one mechanism and must answer the same question
      // the same way, so the leg now gates as well. Refusing rather than
      // accepting is the direction taken because what a type target's "covering
      // tests" means is not something anyone has measured, and both gestures
      // spend real seconds (one spawns runners, the other calls a model).
      // `column80.runTddTests` keeps its own kind gate untouched.
      if (resolved.kind !== "function") {
        void vscode.window.showWarningMessage(
          "Column 80: place the cursor in the function whose covering tests you want to run.",
        );
        return;
      }
      //
      // NO `tierGate()` HERE, AND THAT IS DELIBERATE. Every neighbouring gesture
      // consults it because every one of them ends in a model call; this one
      // discovers and runs and prompts nothing, so whether a hardware tier can
      // generate has no bearing on whether the repo's tests may be run. Gating
      // it would refuse a gesture the tier is irrelevant to.
      //
      // NO `document.save()` EITHER, and the TDD rung's one is not an oversight
      // there: it is about to run tests IT generated into that buffer. This
      // gesture writes no document, and saving one is a write. Discovery reads
      // the OPEN buffer through `makeLineReader`, so an unsaved edit still
      // decides what is excluded; the runner reads the disk, which is the
      // ordinary meaning of running a repo's tests.
      let outcome: RunTestsOutcome;
      try {
        outcome = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Finding the tests that cover ${resolved.symbolName}…`,
            cancellable: true,
          },
          async (_p, token): Promise<RunTestsOutcome> => {
            const controller = new AbortController();
            token.onCancellationRequested(() => controller.abort());
            // A discovery walk and a spawned test run both claim, for the same
            // reason the TDD rung does: this is work the product started, and a
            // hung server or a hung runner behind a dismissed notification must
            // still be stoppable from the status bar.
            const claim = inFlight.begin(`Running covering tests for ${resolved.symbolName}`, controller);
            try {
              // THE SAME NORMALISATION THE REPAIR LEG USES, and the sharing is
              // the point (adversarial review row A2). This line read
              // `prepareCallRoot(document, editor.selection.active, log)` - the
              // RAW cursor - and `vscode.prepareCallHierarchy` answers for the
              // symbol AT the position, so a cursor inside the body on
              // `foo.bar()` resolved to `bar` and a cursor on whitespace
              // resolved to nothing. Two gestures, one cursor, two different
              // functions' covering tests. `callRootPosition` is imported from
              // the leg's own module rather than copied, because a second
              // normalisation would be a second answer.
              const target = await prepareCallRoot(document, callRootPosition(document, resolved), log);
              if (target === undefined) {
                // A RESULT, not an error, and emphatically not a zero: the
                // server could not place this cursor, so the search never
                // started. Falling through to discovery here would report "no
                // test calls this" about a walk that never made one request.
                return { kind: "no-call-root" };
              }
              const discovery = await discoverCoveringTests({
                target,
                lang: plan.classifyLang,
                resolveCallers: makeResolveCallers(log),
                readLines: makeLineReader(),
                inScope: plan.inScope,
                bounds: plan.bounds,
                runScope: plan.runScope,
                resolveTarget: plan.resolveTarget,
                signal: controller.signal,
                hangGuardMs: plan.hangGuardMs,
                log,
              });
              // The SAME sequential run the repair leg's before- and after-runs
              // use, so the two gestures cannot disagree about what "running the
              // covering tests" means. Each group is ONE `runFrameworkTestsAt`
              // spawn, in order, and a cancel between groups comes back as
              // `cancelled` rather than as a spawn that failed - which is the
              // distinction the catch below turns on.
              const run = await runCoveringGroups({
                groups: discovery.groups,
                frameworkAt: plan.frameworkAt,
                signal: controller.signal,
                isCancellation,
                firstLine,
                log,
              });
              if (run.cancelled) {
                return { kind: "cancelled" };
              }
              // EVERY sentence about what was found and what happened comes off
              // this one pure function. Nothing here composes a second one.
              return {
                kind: "report",
                report: renderRunTestsReport({
                  symbolName: resolved.symbolName,
                  languageId: document.languageId,
                  discovery,
                  outcomes: run.outcomes,
                  scopeWord: plan.scopeWord,
                }),
              };
            } finally {
              claim.release();
            }
          },
        );
      } catch (err) {
        // A cancel is not a failure, and this arm is cancellable from the status
        // bar as well as from the notification, so the throw arriving here can
        // be the user's own action. Silent, with the channel keeping the record.
        if (isCancellation(err)) {
          output.appendLine(`[tests] the covering-test run for ${resolved.symbolName} was cancelled`);
          return;
        }
        output.appendLine(`[tests] the covering-test run for ${resolved.symbolName} could not finish: ${String(err)}`);
        void vscode.window.showErrorMessage(
          `Column 80: the covering-test run for ${resolved.symbolName} could not finish - ${firstLine(String(err))}. See the output channel.`,
        );
        return;
      }
      if (outcome.kind === "cancelled") {
        output.appendLine(`[tests] the covering-test run for ${resolved.symbolName} was cancelled`);
        return;
      }
      if (outcome.kind === "no-call-root") {
        output.appendLine(
          `[tests] no call-hierarchy root for ${resolved.symbolName} at ${document.uri.fsPath}:${editor.selection.active.line + 1}; discovery did not start`,
        );
        void vscode.window.showWarningMessage(
          `Column 80: the ${document.languageId} language server could not place the cursor on ${resolved.symbolName} for a call-hierarchy query, so the search for covering tests never started. Nothing was searched and nothing ran.`,
        );
        return;
      }
      output.appendLine(outcome.report.channel);
      // The severity the report ASKED for. A zero comes back as a warning, and
      // showing it as information would make it read like a pass.
      switch (outcome.report.severity) {
        case "error":
          void vscode.window.showErrorMessage(outcome.report.toast);
          break;
        case "warning":
          void vscode.window.showWarningMessage(outcome.report.toast);
          break;
        default:
          void vscode.window.showInformationMessage(outcome.report.toast);
          break;
      }
    }),
  );

  // The four things a model-call gesture registered elsewhere needs from this
  // closure. Getters, not values: `tierReady` is re-run on every settings
  // change and `service` is swapped for a fresh one, so a captured instance
  // would answer for the configuration the human had at activation.
  return {
    tierGate,
    tierMessage: () => tier?.message,
    transport: () => service.transport,
    inFlight: () => inFlight,
  };
}

/**
 * THE THIRD DOCUMENT WRITE PATH (`docs/supersessions.md` S3, human-ratified).
 *
 * Preview the whole new file as a diff against EMPTY; on accept create it EMPTY,
 * open it, and insert the blank-value snippet into it. That ORDER is the point,
 * and it is why this is a write path rather than a `WorkspaceEdit`: writing the
 * blanked text as file CONTENT would leave the human a file full of placeholder
 * comments, while inserting it as a SNIPPET into an open editor puts the cursor
 * in the first hole and makes every other hole Tab-able.
 *
 * Reject writes nothing and leaves NO file behind — nothing is created before the
 * human answers.
 *
 * A test FILE, never a test PROJECT: no config, no manifest, no package install.
 * The only path created is the target's own directory, which already exists in
 * every placement the five legs produce (a sibling, a mirrored folder in an
 * existing test project) except where the mirror is new.
 */
async function createTestFileWithSnippet(args: {
  presenter: ProposalPresenter;
  output: vscode.OutputChannel;
  targetPath: string;
  symbolName: string;
  holes: number;
  snippet: string;
  previewFullText: string;
}): Promise<boolean> {
  const { presenter, output, targetPath, symbolName, snippet, previewFullText } = args;
  const targetUri = vscode.Uri.file(targetPath);
  const decision = await presenter.confirmNewFile({
    targetUri,
    previewFullText,
    title: `Create ${path.basename(targetPath)} for ${symbolName} — review, then Tab the values`,
    prompt: `Column 80: create ${path.basename(targetPath)} with ${args.holes} blank value(s) for ${symbolName}? Review the diff first; nothing is written until you choose.`,
    acceptLabel: "Create the test file",
  });
  output.appendLine(`[tdd] new-file review=${decision} target=${targetPath}`);
  if (decision !== "accept") {
    return false; // Reject / ESC / closed tab: no file, no write, nothing left behind.
  }
  // The review took human time; re-validate before the write. Same rule the
  // regen path applies, and here it is load-bearing rather than tidy: the human
  // consented to a diff against EMPTY, which is a promise that this file is NEW.
  // If it exists NOW, by any route (the human wrote it by hand while the tab was
  // open, a second invocation whose `placement.exists` predates the first accept,
  // an external tool), that promise is false and the write below would truncate it
  // to zero bytes with no undo, because the content never entered a buffer.
  // Abandon and name the file.
  if (await pathExists(targetUri)) {
    output.appendLine(`[tdd] new-file abandoned: ${targetPath} already exists; it appeared during the review`);
    void vscode.window.showWarningMessage(
      `Column 80: ${path.basename(targetPath)} already exists, so nothing was written. You reviewed it as a NEW file, and it appeared while the diff was open. Open it and run the gesture again to append instead.`,
    );
    return false;
  }
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetPath)));
    await vscode.workspace.fs.writeFile(targetUri, new Uint8Array());
  } catch (err) {
    void vscode.window.showWarningMessage(`Column 80: ${targetPath} could not be created (${firstLine(String(err))}).`);
    return false;
  }
  let editor: vscode.TextEditor;
  try {
    const created = await vscode.workspace.openTextDocument(targetUri);
    editor = await vscode.window.showTextDocument(created);
  } catch (err) {
    void vscode.window.showWarningMessage(
      `Column 80: ${targetPath} was created but could not be opened (${firstLine(String(err))}).`,
    );
    return false;
  }
  const inserted = await editor.insertSnippet(new vscode.SnippetString(snippet));
  if (!inserted) {
    // The file is on disk and EMPTY. Say so rather than leave the human a
    // zero-byte file they never heard about, exactly as the open-failure branch
    // above already does.
    void vscode.window.showWarningMessage(
      `Column 80: the editor refused the test insertion, so ${path.basename(targetPath)} was created and is EMPTY. Delete it, or run the gesture again.`,
    );
    return false;
  }
  return true;
}

/** Does a path exist right now? `workspace.fs.stat` rather than `fs.existsSync`
 *  so a virtual file system answers for its own files. */
async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * The FOUR no-run sentences, one per outcome, and the reason there are four is
 * that there are four outcomes. Every `ran: false` used to read "the tests did
 * not compile", which is wrong for three of them and sends a human with a cold
 * dependency cache, a missing runtime or a filter typo hunting a compile error
 * that does not exist.
 *
 * Both surfaces, matching what this command already did: the notification carries
 * the short sentence, the channel carries the whole thing.
 *
 * NO SUGGESTED FIXES THE PRODUCT FORBIDS. `go test` prints `go get` for a cold
 * module cache and `dotnet` wants a runtime installed; the legs strip that
 * remediation and nothing here adds one back. Name the problem and stop.
 */
function reportNoRun(
  output: vscode.OutputChannel,
  framework: { displayName: string; classifiesBuildError?: boolean },
  res: TestOracleResult,
  symbolName: string,
  testNames: string[],
): void {
  // 1. The filter matched nothing. The run HAPPENED and selected zero tests, so
  //    nothing failed to build and — the green rule being `passed + failed > 0` —
  //    this is emphatically not a pass.
  if (res.filterMatchedNothing === true) {
    output.appendLine(
      `[tdd] the ${framework.displayName} run matched no tests for ${symbolName}; filter was: ${testNames.join(", ")}`,
    );
    void vscode.window.showWarningMessage(
      `Column 80: the test filter matched nothing for ${symbolName} — ${framework.displayName} selected none of ${testNames.join(", ")}. Zero tests ran, so this is not a pass.`,
    );
    return;
  }
  // 2. The run could not START. A missing runtime, an unresolvable import, a
  //    dependency the runner cannot reach offline. Nothing was built, so the word
  //    "compile" must not appear.
  if (res.environmentError !== undefined) {
    output.appendLine(`[tdd] the ${framework.displayName} run could not start for ${symbolName}:\n${res.environmentError}`);
    void vscode.window.showErrorMessage(
      `Column 80: the ${framework.displayName} run could not start — ${firstLine(res.environmentError)}. Nothing was built and no test ran; the full message is in the channel.`,
    );
    return;
  }
  // 3. No result, and no reason either. A module that threw at load, a marked
  //    region declaring no test the runner recognised. Phase 3 made this
  //    deliberately UNCLASSIFIED rather than inventing a bucket for it, so the
  //    honest report is exactly that, with BOTH streams shown: a leg reading one
  //    stream reports a failure with no message at all.
  //
  //    Only for a framework whose parse names its own build errors. cargo's
  //    compile error IS stderr, so Rust never reaches here and keeps its sentence.
  if (framework.classifiesBuildError === true && res.stdout !== undefined) {
    output.appendLine(
      `[tdd] the ${framework.displayName} run produced no result for ${symbolName}.\nstdout:\n${res.stdout || "(empty)"}\nstderr:\n${res.stderr || "(empty)"}`,
    );
    void vscode.window.showWarningMessage(
      `Column 80: ${framework.displayName} produced no result for ${symbolName} — it reported no test, no failure and no reason. What it printed on both streams is in the channel.`,
    );
    return;
  }
  // 4. A real build failure, with the compiler's own message. The one case that
  //    does say "compile".
  const errLine =
    (res.buildError ?? "").split("\n").find((l) => /^\s*error[[:]/.test(l))?.trim() ?? firstLine(res.buildError);
  output.appendLine(`[tdd] tests for ${symbolName} did not compile:\n${res.buildError ?? "(no output)"}`);
  void vscode.window.showErrorMessage(
    `Column 80: the tests did not compile. ${errLine} (full output in the channel).`,
  );
}

function activePreviewKey(): string | undefined {
  const input = vscode.window.tabGroups.activeTabGroup?.activeTab?.input;
  return input instanceof vscode.TabInputTextDiff && input.modified.scheme === PREVIEW_SCHEME
    ? input.modified.toString()
    : undefined;
}

async function closePreviewTabs(previewUri: vscode.Uri): Promise<void> {
  const toClose = vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter(
      (t) =>
        t.input instanceof vscode.TabInputTextDiff &&
        t.input.modified.toString() === previewUri.toString(),
    );
  if (toClose.length > 0) {
    await vscode.window.tabGroups.close(toClose);
  }
}
