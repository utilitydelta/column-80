// BLIND ORACLE - session-v30 phase 2, the five diagnostic classifiers.
//
// Written from session-v30/goal.md and the scout's real captures
// (session-v30/scout/captures/*.txt) BEFORE the implementation existed. Nothing
// here was read out of src/core/compilerDirected.ts. Every diagnostic string
// below is verbatim from a real checker run or from the frozen row of an
// existing test file, so a row cannot be wrong about the shape.
//
// This file is FROZEN. Fix the implementation, never the row.
//
// What it pins:
//   P. classifyPyHallucination      NEW. pyright rule names arrive as `code`.
//   G. classifyGoHallucination      NEW. go emits no codes, so the message is
//                                   the only key, and GoOracle has already
//                                   folded go's indented have/want lines in.
//   A. arity-mismatch               NEW class, all five languages. The scout
//                                   measured class=none five for five.
//   U. the smart-pointer unwrap     E0609 reduces a KNOWN wrapper to what it
//                                   wraps. Bounded list, so HashMap<K, V> is
//                                   left alone.
//   R. regressions                  rust, typescript and c# unchanged.
//
// Run: SKIP_LIVE=1 node --test test/blind-v30-p2-classifiers.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Harness. Two of the five exports do not exist yet, so the bundle throws. A
// throw here must name what is missing rather than take the whole run down: a
// crashed file proves nothing, one loud red row proves exactly one thing.
// ===========================================================================

const TAG = "blind-v30-p2-classifiers";
const ENTRY = `export {
  classifyHallucination,
  classifyTsHallucination,
  classifyCsHallucination,
  classifyPyHallucination,
  classifyGoHallucination,
} from "../src/core/compilerDirected";\n`;

let mod = {};
let bundleErr;
let cleanup = () => {
  for (const f of [path.join(__dirname, `.${TAG}.entry.ts`), path.join(__dirname, `.${TAG}.bundle.cjs`)]) {
    fs.rmSync(f, { force: true });
  }
};
try {
  const built = bundleCore(TAG, ENTRY);
  mod = built.mod;
  cleanup = built.cleanup;
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());

const WANTED = [
  "classifyHallucination",
  "classifyTsHallucination",
  "classifyCsHallucination",
  "classifyPyHallucination",
  "classifyGoHallucination",
];
const missing = WANTED.filter((n) => typeof mod[n] !== "function");

if (bundleErr || missing.length > 0) {
  test("session-v30 phase 2: compilerDirected must export a classifier for every language", () => {
    assert.fail(
      `the contract needs all five classifiers exported from src/core/compilerDirected.\n` +
        `  missing or not a function: ${missing.length > 0 ? missing.join(", ") : "(bundle never built)"}\n` +
        (bundleErr ? `  bundle error: ${bundleErr.message}` : ""),
    );
  });
  return;
}

const classifyRs = mod.classifyHallucination;
const classifyTs = mod.classifyTsHallucination;
const classifyCs = mod.classifyCsHallucination;
const classifyPy = mod.classifyPyHallucination;
const classifyGo = mod.classifyGoHallucination;

// ===========================================================================
// Shared fixtures. A primary span at line 17, column 17 in the checker's own
// 1-based coordinates, so the derived cursor is { line: 16, character: 16 }.
// ===========================================================================

const span = (over = {}) => ({
  fileName: "src/repair_receiver.rs",
  byteStart: 0,
  byteEnd: 0,
  lineStart: 17,
  lineEnd: 17,
  columnStart: 17,
  columnEnd: 20,
  isPrimary: true,
  ...over,
});
const CURSOR = { line: 16, character: 16 };

const diag = (over = {}) => ({
  kind: "compile-error",
  level: "error",
  code: undefined,
  message: "",
  spans: [span()],
  suggestions: [],
  ...over,
});

// A span at the checker's own reported position, for the rows that replay a
// real capture line and column.
const at = (line, column) => [span({ lineStart: line, lineEnd: line, columnStart: column, columnEnd: column + 1 })];
const cursorAt = (line, column) => ({ line: line - 1, character: column - 1 });

const show = (v) => JSON.stringify(v);

// A class with an absent optional field and a class carrying that field as
// undefined are the same thing downstream: neither reaches types-in-play. The
// comparison drops undefined-valued keys so a row cannot fail on that
// distinction alone.
const dropUndefined = (o) => {
  if (o === undefined || o === null || typeof o !== "object") return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
};
const sameClass = (actual, expected, why) => assert.deepEqual(dropUndefined(actual), expected, `${why}; got ${show(actual)}`);

// ===========================================================================
// P. PYTHON. classifyPyHallucination over pyright's real output.
//
// Capture: session-v30/scout/captures/python-v0.txt and python-v1.txt, run as
// `npx pyright playground/repair_receiver.py`. pyright puts its rule name where
// every other checker puts a code, and wraps the detail onto a second line.
// ===========================================================================

const PY_ATTR_MSG = 'Cannot access attribute "mirror" for class "Boxed[Shard]"\n    Attribute "mirror" is unknown';

test("P1 [python]: reportAttributeAccessIssue is the member class, naming the member and the class pyright named", () => {
  const cls = classifyPy(diag({ code: "reportAttributeAccessIssue", message: PY_ATTR_MSG, spans: at(28, 54) }));
  sameClass(
    cls,
    { kind: "unresolved-method", member: "mirror", type: "Boxed[Shard]", cursor: cursorAt(28, 54) },
    "the python-v0 capture is a member miss and carries pyright's own bracketed generic",
  );
});

test("P2 [python]: the same rule without pyright's indented second line classifies identically", () => {
  const cls = classifyPy(diag({ code: "reportAttributeAccessIssue", message: 'Cannot access attribute "mirror" for class "Boxed[Shard]"' }));
  sameClass(cls, { kind: "unresolved-method", member: "mirror", type: "Boxed[Shard]", cursor: CURSOR }, "the first line carries both names, so the continuation is not load-bearing");
});

test("P3 [python]: a plain class name survives, generics are not required", () => {
  const cls = classifyPy(diag({ code: "reportAttributeAccessIssue", message: 'Cannot access attribute "head" for class "Cursor"' }));
  sameClass(cls, { kind: "unresolved-method", member: "head", type: "Cursor", cursor: CURSOR }, "the ordinary case");
});

test("P4 [python]: reportCallIssue is the arity class, and pyright names NO type to carry", () => {
  const cls = classifyPy(diag({ code: "reportCallIssue", message: 'Arguments missing for parameters "last_enrolled", "last_flushed"', spans: at(43, 12) }));
  sameClass(
    cls,
    { kind: "arity-mismatch", member: "", cursor: cursorAt(43, 12) },
    "pyright names the PARAMETERS, not their types and not the receiver, so type is absent and member is empty",
  );
});

test("P5 [python]: reportUndefinedVariable is the QUALIFY class, owned by pyUnresolvedNameCursor, and injects nothing here", () => {
  assert.equal(
    classifyPy(diag({ code: "reportUndefinedVariable", message: '"Cursor" is not defined' })),
    undefined,
    "same standing as TS2304 for typescript: the qualify pass owns it",
  );
});

for (const [code, message] of [
  ["reportGeneralTypeIssues", 'Expression of type "None" cannot be assigned to parameter of type "int"'],
  ["reportArgumentType", 'Argument of type "Tile" cannot be assigned to parameter "n" of type "int"'],
  ["reportOptionalMemberAccess", '"head" is not a known attribute of "None"'],
  ["reportIndexIssue", '__getitem__ method not defined on type "Cursor"'],
  ["reportRedeclaration", 'Class declaration "Cursor" is obscured by a declaration of the same name'],
  ["reportMissingImports", 'Import "atlas_py" could not be resolved'],
]) {
  test(`P6 [python]: ${code} is outside the classified set and stays undefined`, () => {
    assert.equal(classifyPy(diag({ code, message })), undefined, "one new classifier must not classify everything");
  });
}

test("P7 [python]: a diagnostic with no rule name at all classifies to undefined", () => {
  assert.equal(classifyPy(diag({ code: undefined, message: PY_ATTR_MSG })), undefined, "the rule name is the key; without it there is nothing to key on");
});

for (const [name, spans] of [
  ["no spans at all", []],
  ["only a non-primary span", [span({ isPrimary: false })]],
]) {
  test(`P8 [python, ${name}]: no primary span means no cursor, so no class`, () => {
    assert.equal(classifyPy(diag({ code: "reportAttributeAccessIssue", message: PY_ATTR_MSG, spans })), undefined);
  });
}

// ===========================================================================
// G. GO. classifyGoHallucination over `go build -o /dev/null ./...` output.
//
// Capture: session-v30/scout/captures/go-v0.txt and go-v1.txt. Go emits NO
// diagnostic codes, so `code` is undefined on every row here and the message
// text is the only key. GoOracle folds go's indented have/want continuation
// lines into the message with a single space, which is why the arity message
// arrives as one line.
// ===========================================================================

const GO_MEMBER_MSG = "shard.Mirror undefined (type *atlas.Boxed[*atlas.Shard] has no field or method Mirror)";
const GO_ARITY_MSG =
  "not enough arguments in call to shard.Value().Meta.Head.ToManifest have (uint64) want (*atlas.Cursor, uint64, uint64)";

test("G1 [go]: `X.Y undefined (type Z has no field or method Y)` is the member class, with no code to help", () => {
  const cls = classifyGo(diag({ code: undefined, message: GO_MEMBER_MSG, spans: at(23, 50) }));
  sameClass(
    cls,
    { kind: "unresolved-method", member: "Mirror", type: "Boxed", cursor: cursorAt(23, 50) },
    "the go-v0 capture: the receiver reduces to a bare type NAME, so the pointer, the instantiation and the package all come off",
  );
});

// The reduction, form by form. A resolver is handed a NAME, so anything that is
// not part of the name has to go, and nothing that is part of it may.
for (const [named, want, why] of [
  ["Cursor", "Cursor", "already bare"],
  ["*Cursor", "Cursor", "a pointer receiver is the common go case"],
  ["&Cursor", "Cursor", "an address-of prefix comes off too"],
  ["atlas.Cursor", "Cursor", "a cross-package type is the norm in go, and the package is not part of the name"],
  ["*atlas.Cursor", "Cursor", "pointer and package together"],
  ["Boxed[Shard]", "Boxed", "the instantiation is dropped, the generic itself is the type"],
  ["*atlas.Boxed[*atlas.Shard]", "Boxed", "the whole capture form"],
  ["atlas.Boxed[atlas.Shard, atlas.Meta]", "Boxed", "two type arguments are still one instantiation"],
]) {
  test(`G2 [go]: receiver \`${named}\` reduces to \`${want}\` (${why})`, () => {
    const cls = classifyGo(diag({ code: undefined, message: `shard.Head undefined (type ${named} has no field or method Head)` }));
    sameClass(cls, { kind: "unresolved-method", member: "Head", type: want, cursor: CURSOR }, why);
  });
}

// G3-G5 were written believing go's `want` list names the receiver. It does not:
// `want` is the PARAMETER list, and a method's receiver never appears in it. The
// scout's capture hid that because ToManifest's first parameter happened to be
// the same type as its receiver. Verified against go1.26.5; the reasoning lives
// beside GO_ARITY in compilerDirected.ts and in supersessions.md S7. Go carries
// no `type` at an arity error, same as python two rows up.
test("G3 [go]: `not enough arguments in call to ...` is the arity class, and the callee's last segment is the member", () => {
  const cls = classifyGo(diag({ code: undefined, message: GO_ARITY_MSG, spans: at(34, 44) }));
  sameClass(
    cls,
    { kind: "arity-mismatch", member: "ToManifest", cursor: cursorAt(34, 44) },
    "the member is the last segment of the callee; the receiver's type is nowhere in the text, so nothing is guessed at",
  );
});

test("G4 [go]: `too many arguments in call to ...` takes the same shape and classifies the same way", () => {
  const cls = classifyGo(
    diag({
      code: undefined,
      message:
        "too many arguments in call to shard.Value().Meta.Head.ToManifest have (*atlas.Cursor, uint64, uint64, uint64) want (*atlas.Cursor, uint64, uint64)",
    }),
  );
  sameClass(cls, { kind: "arity-mismatch", member: "ToManifest", cursor: CURSOR }, "one arity class, both directions");
});

test("G5 [go]: an unqualified callee still yields its member name", () => {
  const cls = classifyGo(diag({ code: undefined, message: "not enough arguments in call to ToManifest have (uint64) want (*atlas.Cursor, uint64, uint64)" }));
  sameClass(cls, { kind: "arity-mismatch", member: "ToManifest", cursor: CURSOR }, "no dots to walk, the callee IS the member");
});

test("G6 [go]: a module-level verdict carries no span and classifies to undefined", () => {
  assert.equal(
    classifyGo({ kind: "compile-error", level: "error", code: undefined, message: "inconsistent vendoring in /m:", spans: [], suggestions: [] }),
    undefined,
    "a verdict about the module has nowhere to point an extractor",
  );
});

for (const message of [
  "undefined: Wombat",
  "cannot use lastEnrolled (variable of type uint64) as string value in argument to ToManifest",
  "declared and not used: cursor",
  "missing return",
  "no required module provides package example.com/x; to add it: go get example.com/x",
  "shard.Mirror undefined",
]) {
  test(`G7 [go]: \`${message.slice(0, 44)}\` is not a classified shape`, () => {
    assert.equal(classifyGo(diag({ code: undefined, message })), undefined, "unrecognised go text is never guessed at");
  });
}

test("G8 [go]: rustc's own wording under the go classifier is not a go message", () => {
  assert.equal(
    classifyGo(diag({ code: "E0609", message: "no field `cursor` on type `Ref<'_, Rc<LogSegmentFile>>`" })),
    undefined,
    "the go hooks key on go's text; a rust message reaching them is not a class",
  );
});

for (const [name, spans] of [
  ["no spans at all", []],
  ["only a non-primary span", [span({ isPrimary: false })]],
]) {
  test(`G9 [go, ${name}]: the arity message with no primary span classifies to undefined`, () => {
    assert.equal(classifyGo(diag({ code: undefined, message: GO_ARITY_MSG, spans })), undefined);
  });
}

// ===========================================================================
// A. THE ARITY CLASS, FIVE FOR FIVE.
//
// Scout finding 2: E0061, TS2554, CS7036, reportCallIssue and go's "not enough
// arguments" all came back class=none. The class resolves no block of its own.
// It exists so the round stops reading class=none, and so any type it DOES name
// reaches the span's types-in-play. How much the compiler gives away varies by
// language, and the rows below say exactly how much, per scout finding 3.
// ===========================================================================

const arityRows = [
  {
    lang: "rust",
    classify: (d) => classifyRs(d),
    diagnostic: diag({ code: "E0061", message: "this method takes 3 arguments but 1 argument was supplied" }),
    expected: { kind: "arity-mismatch", member: "", cursor: CURSOR },
    why: "rustc's MESSAGE names neither the receiver nor the member. The rendered block carries the missing argument types; this classifier reads message",
  },
  {
    lang: "typescript",
    classify: (d) => classifyTs(d),
    diagnostic: diag({ code: "TS2554", message: "Expected 3 arguments, but got 1." }),
    expected: { kind: "arity-mismatch", member: "", cursor: CURSOR },
    why: "tsc prints a count and nothing else, so there is no type and no member to carry",
  },
  {
    lang: "csharp",
    classify: (d) => classifyCs(d),
    diagnostic: diag({
      code: "CS7036",
      message: "There is no argument given that corresponds to the required parameter 'lastEnrolled' of 'Cursor.ToManifest(Cursor?, long, long)'",
    }),
    expected: { kind: "arity-mismatch", member: "ToManifest", type: "Cursor", cursor: CURSOR },
    why: "roslyn prints the whole qualified signature, so the receiver is already in the text and needs no resolve",
  },
  {
    lang: "python",
    classify: (d) => classifyPy(d),
    diagnostic: diag({ code: "reportCallIssue", message: 'Arguments missing for parameters "last_enrolled", "last_flushed"' }),
    expected: { kind: "arity-mismatch", member: "", cursor: CURSOR },
    why: "pyright names the parameters, not their types and not the receiver",
  },
  {
    lang: "go",
    classify: (d) => classifyGo(d),
    diagnostic: diag({ code: undefined, message: GO_ARITY_MSG }),
    expected: { kind: "arity-mismatch", member: "ToManifest", cursor: CURSOR },
    why: "go names the callee only; its want list is the PARAMETER list and never the receiver",
  },
];

for (const { lang, classify, diagnostic, expected, why } of arityRows) {
  test(`A1 [${lang}]: the arity diagnostic classifies to arity-mismatch (${why})`, () => {
    sameClass(classify(diagnostic), expected, "class=none on an arity error is the state this phase removes");
  });

  test(`A2 [${lang}]: the arity diagnostic with no primary span classifies to undefined`, () => {
    assert.equal(classify({ ...diagnostic, spans: [] }), undefined, "no primary span, no cursor, no class - for every class, always");
  });
}

test("A3 [csharp]: the C# arity type comes from the QUALIFIED member name, not from the parameter list", () => {
  const cls = classifyCs(
    diag({
      code: "CS7036",
      message: "There is no argument given that corresponds to the required parameter 'count' of 'Ledger.Enrol(int, long)'",
    }),
  );
  sameClass(cls, { kind: "arity-mismatch", member: "Enrol", type: "Ledger", cursor: CURSOR }, "'Ledger.Enrol' is receiver then member, and the parameters are neither");
});

// ===========================================================================
// U. THE SMART-POINTER UNWRAP (goal, "While you are in there").
//
// The live capture: rustc named `Ref<'_, Rc<LogSegmentFile>>` and the leg went
// looking for the shape of Ref. Nothing can resolve that. The reduction is
// bounded to a KNOWN wrapper list precisely because HashMap<K, V> is not a
// wrapper and its shape is not V's.
// ===========================================================================

const fieldMiss = (field, type) => `no field \`${field}\` on type \`${type}\``;
const fieldClass = (message) => classifyRs(diag({ code: "E0609", message }));
const nameOf = (cls) => (cls && (cls.member !== undefined ? cls.member : cls.field));

test("U1 [rust]: the live capture, `Ref<'_, Rc<LogSegmentFile>>`, reduces to LogSegmentFile", () => {
  const cls = fieldClass(fieldMiss("cursor", "Ref<'_, Rc<LogSegmentFile>>"));
  assert.equal(cls && cls.kind, "unresolved-field", `still the field class; got ${show(cls)}`);
  assert.equal(cls.type, "LogSegmentFile", `the wrapper the resolver cannot shape is reduced to the type it wraps; got ${show(cls && cls.type)}`);
  assert.equal(nameOf(cls), "cursor", "the invented field name is unchanged");
  assert.deepEqual(cls.cursor, CURSOR, "the cursor is still the primary span");
});

const WRAPPERS = ["Ref", "RefMut", "RefCell", "Rc", "Arc", "Box", "Cell", "MutexGuard", "RwLockReadGuard", "RwLockWriteGuard", "Pin", "Option"];

for (const w of WRAPPERS) {
  test(`U2 [rust]: \`${w}<Order>\` is a known wrapper and reduces to Order`, () => {
    const cls = fieldClass(fieldMiss("city", `${w}<Order>`));
    assert.equal(cls && cls.kind, "unresolved-field", `got ${show(cls)}`);
    assert.equal(cls.type, "Order", `${w} is on the bounded wrapper list; got ${show(cls && cls.type)}`);
  });
}

for (const [named, why] of [
  ["Ref<'_, Order>", "an anonymous lifetime argument is skipped"],
  ["RefMut<'a, Order>", "a named lifetime argument is skipped too"],
]) {
  test(`U3 [rust]: \`${named}\` reduces to Order (${why})`, () => {
    assert.equal(fieldClass(fieldMiss("city", named)).type, "Order", why);
  });
}

for (const [named, why] of [
  ["Arc<Box<Order>>", "two wrappers deep"],
  ["Option<Rc<RefCell<Order>>>", "three wrappers deep, the shape real rust code actually writes"],
  ["Box<Arc<Ref<'_, Order>>>", "a lifetime in the middle of the chain does not stop the walk"],
  ["Rc<RefCell<Rc<RefCell<Order>>>>", "the walk repeats until the outer position is not a wrapper"],
]) {
  test(`U4 [rust]: \`${named}\` unwraps all the way to Order (${why})`, () => {
    assert.equal(fieldClass(fieldMiss("city", named)).type, "Order", why);
  });
}

// The whole reason the list is bounded. A container's shape is not its type
// argument's shape, and a resolver handed `V` would inject the wrong thing.
for (const [named, why] of [
  ["HashMap<K, V>", "a map is not a wrapper and its shape is never V's"],
  ["BTreeMap<String, Order>", "same for an ordered map"],
  ["Vec<Order>", "a vec's own methods are the ones the model got wrong"],
  ["Result<Order, Error>", "Result is not on the list, so it is left alone"],
  ["Boxed<Shard>", "a user generic that merely looks like Box is not Box"],
  ["HashSet<Order>", "not on the list"],
]) {
  test(`U5 [rust]: \`${named}\` is NOT a known wrapper and is left exactly as rustc named it`, () => {
    const cls = fieldClass(fieldMiss("city", named));
    assert.equal(cls && cls.kind, "unresolved-field", `got ${show(cls)}`);
    assert.equal(cls.type, named, `unchanged, because the bounded list is the whole point; got ${show(cls && cls.type)}`);
  });
}

for (const [named, want, why] of [
  ["Order", "Order", "a bare type keeps working exactly as it does today"],
  ["&Order", "Order", "a leading borrow still comes off, as it does today"],
  ["&mut Order", "Order", "and a mutable borrow"],
  ["&Boxed<Shard>", "Boxed<Shard>", "the rust-v0 capture: the borrow comes off, the non-wrapper generic stays"],
  ["Arc<HashMap<K, V>>", "HashMap<K, V>", "the wrapper comes off and the container it wrapped is kept whole"],
  ["&Arc<Order>", "Order", "borrow first, then the wrapper"],
]) {
  test(`U6 [rust]: \`${named}\` yields \`${want}\` (${why})`, () => {
    assert.equal(fieldClass(fieldMiss("city", named)).type, want, why);
  });
}

// ===========================================================================
// R. NOTHING ELSE MOVES. Rust, TypeScript and C# regressions, message strings
// taken from the frozen rows of blind7-classify, blind-v3-classify,
// impl7-hardening, impl-v5-repairleg, impl-v9-repair, impl-v10-gestures and
// blind-v28-p1-spansurface, plus the two v30 captures.
// ===========================================================================

// --- rust -----------------------------------------------------------------

const rustRows = [
  {
    name: "E0599 method phrasing -> unresolved-method with the generic-carrying type",
    diagnostic: diag({ code: "E0599", message: "no method named `add` found for struct `BloomFilter<S>` in the current scope" }),
    expected: { kind: "unresolved-method", member: "add", type: "BloomFilter<S>", cursor: CURSOR },
  },
  {
    name: "E0599 associated-function phrasing -> unresolved-assoc",
    diagnostic: diag({ code: "E0599", message: "no associated function or constant named `new` found for struct `BloomFilter<S>`" }),
    expected: { kind: "unresolved-assoc", member: "new", type: "BloomFilter<S>", cursor: CURSOR },
  },
  {
    name: "E0432 single-segment import -> unresolved-crate, a whole missing crate",
    diagnostic: diag({ code: "E0432", message: "unresolved import `fastbloom`" }),
    expected: { kind: "unresolved-crate", crate: "fastbloom", cursor: CURSOR },
  },
  {
    name: "E0432 multi-segment import -> wrong-item, first segment crate, last segment item",
    diagnostic: diag({ code: "E0432", message: "unresolved import `fastbloom::Bloom`" }),
    expected: { kind: "wrong-item", crate: "fastbloom", item: "Bloom", cursor: CURSOR },
  },
  {
    name: "E0432 deeper path -> wrong-item, still first and last",
    diagnostic: diag({ code: "E0432", message: "unresolved import `fastbloom::sub::Bloom`" }),
    expected: { kind: "wrong-item", crate: "fastbloom", item: "Bloom", cursor: CURSOR },
  },
  {
    name: "E0425 `in crate` -> wrong-item",
    diagnostic: diag({ code: "E0425", message: "cannot find type `InventedType` in crate `fastbloom`" }),
    expected: { kind: "wrong-item", crate: "fastbloom", item: "InventedType", cursor: CURSOR },
  },
  {
    name: "E0609 plain receiver -> unresolved-field, untouched by the unwrap",
    diagnostic: diag({ code: "E0609", message: "no field `city` on type `Order`" }),
    expectedKind: "unresolved-field",
    expectedType: "Order",
  },
  {
    name: "E0599 trait-bound refusal -> undefined, the bounds-unmet form rides plain repair",
    diagnostic: diag({ code: "E0599", message: "the method `frobnicate` exists for struct `CohortRegister`, but its trait bounds were not satisfied" }),
    expected: undefined,
  },
  {
    name: "E0596 borrow error -> undefined",
    diagnostic: diag({ code: "E0596", message: "cannot borrow `result` as mutable, as it is not declared as mutable" }),
    expected: undefined,
  },
  {
    name: "E0308 type mismatch -> undefined",
    diagnostic: diag({ code: "E0308", message: "mismatched types" }),
    expected: undefined,
  },
  {
    name: "a classified code with no primary span -> undefined",
    diagnostic: diag({ code: "E0599", message: "no method named `add` found for struct `BloomFilter<S>` in the current scope", spans: [] }),
    expected: undefined,
  },
];

for (const { name, diagnostic, expected, expectedKind, expectedType } of rustRows) {
  test(`R1 [rust]: ${name}`, () => {
    const cls = classifyRs(diagnostic);
    if (expectedKind !== undefined) {
      assert.equal(cls && cls.kind, expectedKind, `got ${show(cls)}`);
      assert.equal(cls.type, expectedType, `got ${show(cls && cls.type)}`);
      return;
    }
    sameClass(cls, expected, "the existing rust classification is unchanged by phase 2");
  });
}

test("R2 [rust]: an E0599 phrasing the classifier has never seen still steers to the receiver's member surface", () => {
  const cls = classifyRs(diag({ code: "E0599", message: "`CohortRegister` is not an iterator" }));
  assert.equal(cls && cls.kind, "unresolved-method", `E0599 keys on the code, not on an enumeration of wordings; got ${show(cls)}`);
  assert.equal(cls.type, "CohortRegister", `got ${show(cls && cls.type)}`);
});

test("R3 [rust]: localDefs still reclassifies an in-crate miss to local-symbol", () => {
  const d = diag({ code: "E0425", message: "cannot find type `CohortRegister` in crate `atlas`" });
  sameClass(
    classifyRs(d, undefined, new Set(["CohortRegister"])),
    { kind: "local-symbol", name: "CohortRegister", cursor: CURSOR },
    "the third argument keeps its meaning",
  );
  sameClass(
    classifyRs(d, undefined, new Set(["SomethingElse"])),
    { kind: "wrong-item", crate: "atlas", item: "CohortRegister", cursor: CURSOR },
    "a non-matching set is a no-op",
  );
});

// --- typescript -----------------------------------------------------------

const tsDiag = (code, message, spans) => diag({ code, message, spans: spans ?? [span({ fileName: "src/app.ts" })] });

test("R4 [typescript]: TS2339 -> unresolved-method, member and receiver from the quoted names", () => {
  const cls = classifyTs(tsDiag("TS2339", "Property 'city' does not exist on type 'Order'."));
  sameClass(cls, { kind: "unresolved-method", member: "city", type: "Order", cursor: CURSOR }, "unchanged");
});

test("R5 [typescript]: TS2339 on the v30 capture receiver keeps the generic whole", () => {
  const cls = classifyTs(tsDiag("TS2339", "Property 'mirror' does not exist on type 'Boxed<Shard>'.", at(27, 51)));
  sameClass(cls, { kind: "unresolved-method", member: "mirror", type: "Boxed<Shard>", cursor: cursorAt(27, 51) }, "the typescript-v0 capture");
});

test("R6 [typescript]: TS2305 -> wrong-item with tsc's module quotes stripped and no suggestion", () => {
  const cls = classifyTs(tsDiag("TS2305", `Module '"./order"' has no exported member 'missingThing'.`));
  assert.equal(cls && cls.kind, "wrong-item", `got ${show(cls)}`);
  assert.equal(cls.crate, "./order");
  assert.equal(cls.item, "missingThing");
  assert.equal(cls.suggestion, undefined);
});

test("R7 [typescript]: TS2724 with a did-you-mean carries the suggestion", () => {
  const cls = classifyTs(tsDiag("TS2724", `'"./order"' has no exported member named 'Orderr'. Did you mean 'Order'?`));
  assert.equal(cls && cls.kind, "wrong-item", `got ${show(cls)}`);
  assert.equal(cls.crate, "./order");
  assert.equal(cls.item, "Orderr");
  assert.equal(cls.suggestion, "Order");
});

test("R8 [typescript]: TS2724 without a did-you-mean leaves the suggestion undefined", () => {
  const cls = classifyTs(tsDiag("TS2724", `'"./order"' has no exported member named 'Orderr'.`));
  assert.equal(cls && cls.kind, "wrong-item", `got ${show(cls)}`);
  assert.equal(cls.item, "Orderr");
  assert.equal(cls.suggestion, undefined);
});

test("R9 [typescript]: TS2551's did-you-mean tail never leaks into the receiver type", () => {
  const cls = classifyTs(tsDiag("TS2551", "Property 'setTeme' does not exist on type 'ThemeStore'. Did you mean 'setTheme'?"));
  assert.equal(cls && cls.kind, "unresolved-method", `got ${show(cls)}`);
  assert.equal(cls.member, "setTeme");
  assert.equal(cls.type, "ThemeStore");
});

for (const [code, message, why] of [
  ["TS2304", "Cannot find name 'soleExport'.", "the qualify class never injects"],
  ["TS2552", "Cannot find name 'themeStor'. Did you mean 'themeStore'?", "also qualify"],
  ["TS2322", "Type 'string' is not assignable to type 'number'.", "not a hallucinated surface"],
  ["TS2345", "Argument of type 'Tile' is not assignable to parameter of type 'number'.", "an argument TYPE mismatch is not an arity mismatch"],
]) {
  test(`R10 [typescript]: ${code} stays undefined (${why})`, () => {
    assert.equal(classifyTs(tsDiag(code, message)), undefined, why);
  });
}

test("R11 [typescript]: TS2339 with no quoted names is never a guess, and a span-less one has nowhere to point", () => {
  assert.equal(classifyTs(tsDiag("TS2339", "some unexpected wording")), undefined);
  assert.equal(classifyTs(tsDiag("TS2339", "Property 'x' does not exist on type 'Y'.", [])), undefined);
});

// --- csharp ---------------------------------------------------------------

test("R12 [csharp]: CS1061 -> unresolved-method naming the receiver and the member", () => {
  const cls = classifyCs(
    diag({
      code: "CS1061",
      message:
        "'Widget' does not contain a definition for 'Frobnicate' and no accessible extension method 'Frobnicate' accepting a first argument of type 'Widget' could be found",
    }),
  );
  assert.equal(cls && cls.kind, "unresolved-method", `got ${show(cls)}`);
  assert.equal(cls.type, "Widget");
  assert.equal(cls.member, "Frobnicate");
  assert.deepEqual(cls.cursor, CURSOR);
});

test("R13 [csharp]: the v30 CS1061 capture, with roslyn's using-directive tail, still names Boxed<Shard>", () => {
  const cls = classifyCs(
    diag({
      code: "CS1061",
      message:
        "'Boxed<Shard>' does not contain a definition for 'Mirror' and no accessible extension method 'Mirror' accepting a first argument of type 'Boxed<Shard>' could be found (are you missing a using directive or an assembly reference?)",
      spans: at(29, 57),
    }),
  );
  assert.equal(cls && cls.kind, "unresolved-method", `got ${show(cls)}`);
  assert.equal(cls.type, "Boxed<Shard>");
  assert.equal(cls.member, "Mirror");
  assert.deepEqual(cls.cursor, cursorAt(29, 57));
});

test("R14 [csharp]: CS0117, the static member miss, is also the member class", () => {
  const cls = classifyCs(diag({ code: "CS0117", message: "'Console' does not contain a definition for 'WritLine'" }));
  assert.equal(cls && cls.kind, "unresolved-method", `got ${show(cls)}`);
  assert.equal(cls.type, "Console");
});

test("R15 [csharp]: CS0019 -> operand-mismatch carrying BOTH operand types", () => {
  const cls = classifyCs(diag({ code: "CS0019", message: "Operator '==' cannot be applied to operands of type 'int' and 'LodBand'" }));
  assert.equal(cls && cls.kind, "operand-mismatch", `got ${show(cls)}`);
  assert.ok(Array.isArray(cls.types), `the operand types ride the class as an array; got ${show(cls)}`);
  assert.deepEqual([...cls.types].sort(), ["LodBand", "int"], `got ${show(cls.types)}`);
  assert.deepEqual(cls.cursor, CURSOR);
});

for (const [code, message, why] of [
  ["CS0246", "The type or namespace name 'Nonexistent' could not be found (are you missing a using directive or an assembly reference?)", "qualify"],
  ["CS0234", "The type or namespace name 'Widgets' does not exist in the namespace 'Live' (are you missing an assembly reference?)", "qualify"],
  ["CS0103", "The name 'Missing' does not exist in the current context", "qualify"],
  ["CS0029", "Cannot implicitly convert type 'int' to 'string'", "a conversion is not a hallucinated surface"],
  ["CS0161", "'Tile.Band': not all code paths return a value", "not a surface at all"],
]) {
  test(`R16 [csharp]: ${code} stays undefined (${why})`, () => {
    assert.equal(classifyCs(diag({ code, message })), undefined, why);
  });
}

test("R17 [csharp]: a span-less CS1061 has nowhere to point the extractor", () => {
  assert.equal(classifyCs(diag({ code: "CS1061", message: "'Widget' does not contain a definition for 'X'", spans: [] })), undefined);
});

// ===========================================================================
// X. THE INVARIANT THAT HOLDS FOR EVERY LANGUAGE AND EVERY CLASS: a diagnostic
// with no primary span classifies to undefined, always.
// ===========================================================================

const spanlessRows = [
  ["rust", classifyRs, diag({ code: "E0609", message: fieldMiss("cursor", "Ref<'_, Rc<LogSegmentFile>>") })],
  ["typescript", classifyTs, diag({ code: "TS2339", message: "Property 'mirror' does not exist on type 'Boxed<Shard>'." })],
  ["csharp", classifyCs, diag({ code: "CS0019", message: "Operator '==' cannot be applied to operands of type 'int' and 'LodBand'" })],
  ["python", classifyPy, diag({ code: "reportAttributeAccessIssue", message: PY_ATTR_MSG })],
  ["go", classifyGo, diag({ code: undefined, message: GO_MEMBER_MSG })],
];

for (const [lang, classify, d] of spanlessRows) {
  test(`X1 [${lang}]: a classified diagnostic whose only span is non-primary classifies to undefined`, () => {
    assert.equal(classify({ ...d, spans: [span({ isPrimary: false })] }), undefined, "the cursor comes from the primary span or the class does not exist");
  });
}
