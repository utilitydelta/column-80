// IMPLEMENTER tests — session-v24 phase 1, the receiver type injects first.
// These complement the blind oracle (test/blind-v24-p1-receiver.test.cjs), which
// black-boxes the returned surface across the five languages. What it cannot see
// from outside is the two halves of the answer in isolation — what a SIGNATURE
// says about the target's job, and what the pre-fill does with the container the
// SYMBOL TREE hands back — plus the budget arithmetic, which needs widths a
// contract file has no business pinning.
//
// Nothing here reads file text to find a container, because nothing in the
// implementation does: the earlier round's scanner tables (headers inside
// comments, string and raw-string literals, regex literals, brace-parity traps)
// are vacuous under a tree-driven design and are gone with it.
//
// Run: SKIP_LIVE=1 node --test test/impl-v24-p1-receiver.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v24-p1",
  `export { RECEIVER_RULES, producesType, receiverNameOffset } from "../src/core/receiver";
export { keepAtConstructionTarget } from "../src/core/crossFileShape";
export { findEnclosingContainer } from "../src/core/extraction";\n`,
);
const { RECEIVER_RULES, producesType, keepAtConstructionTarget, receiverNameOffset, findEnclosingContainer } = mod;
test.after(cleanup);

// A parameterized table: one test per invariant, one row per case, each row
// naming itself in the failure message.
const table = (name, cases, run) =>
  test(name, () => {
    for (const c of cases) {
      run(c);
    }
  });

// ===========================================================================
// DETECTION. The resolved signature answers "is there a receiver", and it is
// the WHOLE answer — no file text, no tree. Each row is a real declaration head
// as its language's resolver hands it over.
// ===========================================================================

const RECEIVER_CASES = [
  ["rust", "fn absorb(&self, w: Widget) -> u32", true],
  ["rust", "fn absorb(&mut self, w: Widget) -> u32", true],
  ["rust", "fn into_parts(self) -> (u32, u32)", true],
  ["rust", "fn drain(mut self) -> Vec<u32>", true],
  ["rust", "fn borrow(&'a self) -> &'a u32", true],
  ["rust", "pub async fn absorb(&self) -> u32", true],
  ["rust", "fn new(w: Widget) -> Owner", false],
  ["rust", "fn tally(w: Widget) -> u32", false],
  // `selfish` starts with the same four letters and is an ordinary binding.
  ["rust", "fn take(selfish: u32) -> u32", false],
  // A generic argument's comma must not split the parameter list early.
  ["rust", "fn merge(&self, m: HashMap<u32, Vec<u64>>) -> u32", true],
  ["python", "def absorb(self, w: Widget) -> int", true],
  ["python", "def create(w: Widget) -> Owner", false],
  // `cls` is NOT a receiver; a classmethod reaches case B by its return type.
  ["python", "def parse(cls, w: Widget) -> Optional[Owner]", false],
  ["python", "def tally(selfish: int) -> int", false],
  ["csharp", "public int Absorb(Widget w)", true],
  ["csharp", "public Owner Clone()", true],
  ["csharp", "public static Owner Create(Widget w)", false],
  ["csharp", "internal static async Task<Owner> Parse(Widget w)", false],
  ["typescript", "absorb(w: Widget): number", true],
  ["typescript", "static create(w: Widget): Owner", false],
  // A free function is not static either; it resolves no container instead.
  ["typescript", "export function absorb(w: Widget): number", true],
  ["go", "func (o *Owner) Absorb(w Widget) uint32", true],
  ["go", "func (o Owner) Absorb(w Widget) uint32", true],
  ["go", "func (o *Owner[T]) Absorb(w Widget) uint32", true],
  ["go", "func NewOwner(w Widget) *Owner", false],
  // The trap: a plain func whose FIRST PARAMETER is a value of the type. Its
  // first paren group is parameters, not a receiver clause.
  ["go", "func Absorb(o Owner, w Widget) uint32", false],
];

table("detection: a receiver is read off the signature, per language", RECEIVER_CASES, ([lang, signature, expected]) => {
  assert.strictEqual(
    RECEIVER_RULES[lang].hasReceiver(signature),
    expected,
    `[${lang}] ${JSON.stringify(signature)} must ${expected ? "" : "NOT "}carry a receiver`,
  );
});

const GO_RECEIVER_TYPE_CASES = [
  ["func (o *Owner) Absorb(w Widget) uint32", "Owner"],
  ["func (o Owner) Absorb(w Widget) uint32", "Owner"],
  ["func (o *Owner[T]) Absorb(w Widget) uint32", "Owner"],
  ["func (o *store.Owner) Absorb(w Widget) uint32", "Owner"],
  ["func NewOwner(w Widget) *Owner", undefined],
];

table(
  "detection [go]: the receiver's TYPE comes from the same clause, which is why Go needs no tree",
  GO_RECEIVER_TYPE_CASES,
  ([signature, expected]) => {
    assert.strictEqual(RECEIVER_RULES.go.receiverType(signature), expected, `[go] ${JSON.stringify(signature)}`);
  },
);

test("detection [go]: the receiver's name offset lands on the type token, not on a same-named parameter", () => {
  const signature = "func (o *Owner) Absorb(other Owner) uint32";
  const at = receiverNameOffset(signature, "Owner");
  assert.strictEqual(signature.slice(at, at + 5), "Owner");
  assert.ok(at < signature.indexOf("Absorb"), `the anchor must be in the receiver clause, got column ${at}`);
});

// ===========================================================================
// CASE B. No receiver, but the return type NAMES the enclosing type or `Self`.
// The rule is that it NAMES it, not that it equals it: the wrapper shapes are
// the common constructor form.
// ===========================================================================

const RETURN_NAMES_CASES = [
  ["rust", "fn new(w: Widget) -> Owner", true],
  ["rust", "fn from_widget(w: Widget) -> Result<Self, ParseError>", true],
  ["rust", "fn maybe(w: Widget) -> Option<Owner>", true],
  ["rust", "fn tally(w: Widget) -> u32", false],
  ["rust", "fn take(o: Owner) -> u32", false], // a PARAMETER of the type is not a return
  // A closure parameter's own arrow must not be read as the return arrow.
  ["rust", "fn fold(f: fn(u32) -> u32) -> u32", false],
  ["rust", "fn build(f: fn(u32) -> u32) -> Owner", true],
  ["python", "def create(w: Widget) -> Owner", true],
  ["python", "def parse(cls, w: Widget) -> Optional[Owner]", true],
  ["python", "def build(cls, w: Widget) -> int", false],
  ["csharp", "public static Owner Create(Widget w)", true],
  ["csharp", "public static Task<Owner> Parse(Widget w)", true],
  ["csharp", "public static int Tally(Widget w)", false],
  ["typescript", "static create(w: Widget): Owner", true],
  ["typescript", "static parse(w: Widget): Promise<Owner>", true],
  ["typescript", "static tally(w: Widget): number", false],
  // Go has no case B at all: a package-level constructor has nothing enclosing it.
  ["go", "func NewOwner(w Widget) *Owner", false],
];

table(
  "case B: the return type naming the enclosing type (or Self) is what makes a target a builder",
  RETURN_NAMES_CASES,
  ([lang, signature, expected]) => {
    assert.strictEqual(
      RECEIVER_RULES[lang].returnNames(signature, "Owner"),
      expected,
      `[${lang}] ${JSON.stringify(signature)} must ${expected ? "" : "NOT "}name the enclosing type in its return`,
    );
  },
);

// The PRODUCER test, asked of a rendered CALLABLE only. An unreadable return
// clause is a keep: an unannotated factory is ordinary Python and TypeScript,
// and dropping a real producer is the direction no oracle catches.
const PRODUCER_CASES = [
  // [style, rendered callable, produces Owner?]
  ["arrow", "new(w: Widget) -> Owner", true],
  ["arrow", "from_widget(w: Widget) -> Result<Self, ParseError>", true],
  ["arrow", "with_slots(self, n: u32) -> Self", true], // a self-consuming builder
  ["arrow", "roll_active(&self) -> u64", false],
  ["arrow", "slots_of(&self) -> u32", false],
  ["arrow", "owner_of(&self, o: Owner) -> u32", false], // the type in a PARAMETER produces nothing
  // The return clause is DELIMITED: a `where` constraint naming the type is a
  // bound on a parameter, not what the member hands back.
  ["arrow", "cmp(&self, other: &Owner) -> Ordering where Self: Sized", false],
  ["arrow", "from_ids(it: I) -> u32 where I: IntoIterator<Item = Owner>", false],
  // No readable return clause at all: kept, per the unannotated-factory rule.
  ["arrow", "make(w)", true],
  ["colon", "Create(Widget): Owner", true],
  ["colon", "Parse(Widget): Task<Owner>", true],
  ["colon", "RollActive(): long", false],
  ["colon", "SlotsOf(): int", false],
  ["colon", "make(w: Widget)", true],
  // A type predicate returns a boolean. It names the type in the return
  // position and produces nothing.
  ["colon", "isOwner(x: unknown): x is Owner", false],
];

table("case B: the producer test reads a DELIMITED return clause, and keeps what it cannot read", PRODUCER_CASES, ([style, rendered, produces]) => {
  assert.strictEqual(
    producesType(rendered, "Owner", style),
    produces,
    `${JSON.stringify(rendered)} must ${produces ? "" : "NOT "}count as a producer of Owner`,
  );
});

// The MEMBER-level filter, which is where the producer test is actually
// applied. It answers from the member's KIND and NAME, never from the shape of
// its rendered text: a field whose type is a function renders with parens and
// an arrow and is still data a constructor has to fill.
const M = (name, signature) => ({ name, signature, kind: "method" });
const F = (name, signature) => ({ name, signature, kind: "field" });

const CONSTRUCTION_MEMBER_CASES = [
  // [style, member, kept?]
  ["arrow", F("slots", "slots: u32"), true], // a data member: what the constructor fills
  ["arrow", F("on_tick", "on_tick: fn(u64) -> bool"), true], // callable-shaped DATA
  ["arrow", M("new", "new(w: Widget) -> Owner"), true],
  ["arrow", M("roll_active", "roll_active(&self) -> u64"), false],
  ["colon", F("Slots", "Slots: int"), true],
  ["colon", F("OnTick", "OnTick: Func<long, bool>"), true],
  ["colon", F("onTick", "onTick: (n: number) => boolean"), true],
  ["colon", M("Create", "Create(Widget): Owner"), true],
  ["colon", M("RollActive", "RollActive(): long"), false],
  // The language's own construction member, which no return-type test can see:
  // a C# constructor has none, `constructor` is a keyword, `__init__` is None.
  ["colon", M("Owner", "Owner(int slots)"), true],
  ["colon", M("constructor", "constructor(slots: number)"), true],
  ["arrow", M("__init__", "__init__(self, slots: int) -> None"), true],
  // A dunder is member-site noise and `__init__` is the exception, not the rule.
  ["arrow", M("__repr__", "__repr__(self) -> str"), false],
];

table(
  "case B: only the members that can PRODUCE the type survive, plus its data members",
  CONSTRUCTION_MEMBER_CASES,
  ([style, member, kept]) => {
    assert.strictEqual(
      keepAtConstructionTarget(member, "Owner", style),
      kept,
      `${JSON.stringify(member.signature)} (kind ${member.kind}) must be ${kept ? "kept" : "dropped"} at a construction target`,
    );
  },
);

// The attribute strip, both spellings. An attribute with arguments owns the
// first `(` in the string, so every parameter-list read below it is wrong until
// the attribute is gone.
const ATTRIBUTE_CASES = [
  ["rust", "hasReceiver", "#[cfg(test)] pub fn absorb(&self) -> u32", true],
  ["rust", "hasReceiver", "#[inline] pub fn absorb(&self) -> u32", true],
  ["rust", "hasReceiver", "#[cfg(test)] pub fn make(w: Widget) -> Owner", false],
  ["rust", "returnNames", "#[cfg(test)] pub fn make(w: Widget) -> Owner", true],
  ["csharp", "returnNames", "[Owner] public static void Configure()", false],
  ["csharp", "hasReceiver", "[Auditable] public int Absorb(Widget w)", true],
];

table("detection: leading attribute groups are stripped before anything parses", ATTRIBUTE_CASES, ([lang, rule, signature, expected]) => {
  assert.strictEqual(
    RECEIVER_RULES[lang][rule](signature, "Owner"),
    expected,
    `[${lang}] ${rule}(${JSON.stringify(signature)}) must be ${expected}`,
  );
});

// The return clause is a clause, not a suffix. Each row is a real declaration
// shape that reads as a constructor to a test that takes the rest of the string.
const RETURN_CLAUSE_CASES = [
  ["rust", "pub fn map_all<F: Fn(u32) -> Owner>(f: F) -> u32", false], // the arrow is inside a bound
  ["rust", "pub fn from_ids<I>(it: I) -> u32 where I: IntoIterator<Item = Owner>", false],
  ["rust", "fn tally(w: Widget) -> u32 where Self: Sized", false],
  ["rust", "pub fn build(f: fn(u32) -> u32) -> Owner", true],
  ["csharp", "public static void Register<Owner>()", false], // a type PARAMETER named Owner
  ["csharp", "public static Owner Create(Widget w)", true],
  ["csharp", "public static Task<Owner> Parse<T>(Widget w)", true],
  ["typescript", "static isOwner(x: unknown): x is Owner", false], // a predicate returns a boolean
  ["typescript", "static create(w: Widget): Owner", true],
];

table("case B: the return clause is delimited, so a bound, a constraint or a predicate is not a return", RETURN_CLAUSE_CASES, ([lang, signature, expected]) => {
  assert.strictEqual(
    RECEIVER_RULES[lang].returnNames(signature, "Owner"),
    expected,
    `[${lang}] ${JSON.stringify(signature)} must ${expected ? "" : "NOT "}read as producing Owner`,
  );
});

// The Go anchor. A named binding longer than one letter is ordinary Go, and it
// carries the type's own letters, so an indexOf over the whole signature lands
// inside the binding and resolves a local variable. A binding named for its own
// type is the case no word search can survive: both tokens are the whole word.
const GO_OFFSET_CASES = [
  ["func (myOwner *Owner) Absorb(w Widget) uint32", 15],
  ["func (theOwner Owner) Absorb()", 15],
  ["func (o *Owner) Absorb(w Widget) uint32", 9],
  ["func (o Owner) Absorb(w Widget) uint32", 8],
  ["func (Owner *Owner) Absorb()", 13],
  ["func (Owner Owner) Absorb()", 12],
  ["func (o *Owner[T]) Absorb()", 9],
  ["func NewOwner(w Widget) *Owner", undefined],
  ["func (o *Widget) Absorb()", undefined], // the clause names another type
];

table("detection [go]: the receiver anchor is computed inside the captured clause", GO_OFFSET_CASES, ([signature, expected]) => {
  const at = receiverNameOffset(signature, "Owner");
  assert.strictEqual(at, expected, `${JSON.stringify(signature)} anchors at ${at}, expected ${expected}`);
  if (expected !== undefined) {
    assert.strictEqual(signature.slice(at, at + 5), "Owner", `the anchor must sit on the type token, not inside the binding`);
  }
});

// ===========================================================================
// THE CONTAINER NAME. A symbol node's name reduced to a type name, or nothing.
// Rust is the only language whose container node carries a whole header.
// ===========================================================================

const CONTAINER_NAME_CASES = [
  ["rust", "impl Owner", "Owner"],
  ["rust", "impl Persist for Owner", "Owner"], // the self type, never the trait
  ["rust", "impl<T> Owner<T>", "Owner"],
  ["rust", "impl<T: Into<String>> Owner<T>", "Owner"],
  ["rust", "impl crate::store::Owner", "Owner"],
  ["rust", "impl dyn Persist", "Persist"],
  // An associated-type projection names no type this can resolve. A miss costs
  // one absent block; a wrong name costs a prompt slot and a confident line.
  ["rust", "impl <T as Trait>::Assoc", undefined],
  ["rust", "Owner", "Owner"], // a trait's own symbol stands for itself
  ["csharp", "Owner", "Owner"],
  ["csharp", "Owner<T>", "Owner"],
  ["typescript", "Owner", "Owner"],
  ["python", "Owner", "Owner"],
  // Go reports a method as a top-level symbol named after its receiver. It is
  // not a container node and the Go arm never asks the tree anything.
  ["go", "(*Owner).Absorb", undefined],
];

table("resolution: a container symbol's name reduced to a type name", CONTAINER_NAME_CASES, ([lang, name, expected]) => {
  assert.strictEqual(RECEIVER_RULES[lang].containerName(name), expected, `[${lang}] ${JSON.stringify(name)}`);
});

// ===========================================================================
// THE WALK. Kinds only, ranges only. The vscode SymbolKind numbering, which is
// what the pre-fill passes.
// ===========================================================================

const KIND = { Namespace: 2, Class: 4, Method: 5, Field: 7, Function: 11, Object: 18, Struct: 22 };
const CONTAINER_KINDS = new Set([KIND.Class, KIND.Struct, 10 /* Interface */, 9 /* Enum */, KIND.Object]);
const role = (kind) => (CONTAINER_KINDS.has(kind) ? "container" : "method");
const node = (name, kind, fromLine, toLine, children = []) => ({
  name,
  kind,
  range: { start: { line: fromLine, character: 0 }, end: { line: toLine, character: 200 } },
  selectionRange: { start: { line: fromLine, character: 5 }, end: { line: fromLine, character: 10 } },
  children,
});
const walk = (nodes, line) =>
  findEnclosingContainer(nodes, { uri: "file:///w/x", line, character: 4 }, role)?.container?.name;

test("the walk returns the innermost TYPE-kind container, and a non-type container is not one", () => {
  const tree = [
    node("P", KIND.Namespace, 0, 40, [
      node("Owner", KIND.Class, 2, 20, [node("Absorb", KIND.Method, 4, 8)]),
      node("Widget", KIND.Class, 22, 30),
    ]),
    node("free", KIND.Function, 42, 46),
  ];
  assert.strictEqual(walk(tree, 5), "Owner", "a method's own node is not the container; the class above it is");
  assert.strictEqual(walk(tree, 25), "Widget", "a sibling class is found on its own range");
  assert.strictEqual(walk(tree, 44), undefined, "a free function encloses the cursor and is not a type");
  assert.strictEqual(walk(tree, 1), undefined, "a NAMESPACE contains the cursor and is never the receiver");
});

test("the walk misses honestly: outside every range, and inside a container the tree no longer has", () => {
  const tree = [node("Owner", KIND.Class, 2, 20, [node("Absorb", KIND.Method, 4, 8)])];
  assert.strictEqual(walk(tree, 30), undefined, "below every symbol");
  assert.strictEqual(walk([], 5), undefined, "an empty tree");
  // The measured mid-edit shapes: the container truncated to its header line,
  // and the container deleted outright. Both are a miss, never a fallback.
  const truncated = [{ ...tree[0], range: { start: { line: 2, character: 0 }, end: { line: 2, character: 30 } } }];
  assert.strictEqual(walk(truncated, 5), undefined, "a range that stops at the header line");
  assert.strictEqual(walk([node("VALUES", 13 /* Constant */, 0, 0)], 5), undefined, "the collapsed-tree shape");
});

// ===========================================================================
// resolvePrefill mechanics the returned surface does not show: WHICH cursor the
// receiver is anchored at, and the drop accounting.
// ===========================================================================

const STUB = path.join(__dirname, ".impl-v24-p1-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (arg) => (typeof arg === "string" ? arg : (arg && arg.toString ? arg.toString() : String(arg)));
module.exports = {
  Position, Range, Selection: Range, WorkspaceEdit: class {}, EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: {}, EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: {},
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__IMPL_V24P1_FILES__ || {};
      return Promise.resolve({ uri: mkUri(keyOf(arg)), getText: () => files[keyOf(arg)] });
    },
  },
};
`,
);
const ENTRY = path.join(__dirname, ".impl-v24-p1-v.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v24-p1-v.bundle.cjs");
fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { resolvePrefill } = require(OUTFILE);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return { uri: { toString: () => uriStr }, offsetAt, positionAt, getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text) };
}

// The impl node as rust-analyzer reports it: an untyped Object symbol whose name
// is the raw header and whose selectionRange points at the SELF TYPE.
function implNode(src, header, lastLine) {
  const line = src.split("\n").findIndex((l) => l.includes(header));
  const at = src.split("\n")[line].indexOf("Owner");
  return {
    name: header.trim(),
    kind: 18,
    range: { start: { line, character: 0 }, end: { line: lastLine, character: 0 } },
    selectionRange: { start: { line, character: at }, end: { line, character: at + 5 } },
    children: [],
  };
}

const XURI = "file:///w/i24/x.rs";
// Owner is declared in ANOTHER file and named nowhere in this one but the impl
// header, so the only cursor that can resolve it is the header's own.
const XSRC = `impl Owner {
    /// Absorb.
    fn absorb(&self, g: Ghost) -> u32 {
        todo!()
    }
}
`;
const DURI = "file:///w/i24/domain.rs";
const DSRC = `pub struct Owner {
    pub slots: u32,
}
`;

function ownerExtractor(calls) {
  const isOwner = (uri, c) => {
    const line = ({ [XURI]: XSRC, [DURI]: DSRC })[uri]?.split("\n")[c.line] ?? "";
    return /\bOwner\b/.test(line);
  };
  return {
    definition: async (c) => {
      calls.definition.push(c);
      return isOwner(c.uri, c) ? { uri: DURI, range: { startLine: 0, startCharacter: 11, endLine: 0, endCharacter: 16 } } : undefined;
    },
    hoverSurface: async (c) => (isOwner(c.uri, c) ? { signature: "pub struct Owner { pub slots: u32 }" } : undefined),
    membersOfType: async (c) => (isOwner(c.uri, c) ? [{ name: "roll", signature: "roll(&self) -> u64", kind: "method" }] : []),
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

async function runX(signature, docComment, opts = {}) {
  const start = XSRC.indexOf("fn absorb");
  const resolved = {
    span: { start, end: XSRC.indexOf("todo!()") + 7 },
    signature,
    docComment,
    symbolName: "absorb",
    languageId: "rust",
    kind: opts.kind || "function",
    symbols: opts.noTree ? undefined : [implNode(XSRC, "impl Owner {", 5)],
  };
  const calls = { definition: [] };
  const logs = [];
  globalThis.__IMPL_V24P1_FILES__ = { [XURI]: XSRC, [DURI]: DSRC };
  let out;
  try {
    out = await resolvePrefill(ownerExtractor(calls), makeDoc(XSRC, XURI), resolved, (l) => logs.push(l));
  } finally {
    delete globalThis.__IMPL_V24P1_FILES__;
  }
  return { out: out || "", logs, calls };
}

test("the receiver is anchored at the tree's own name token, not at anything in the span", async () => {
  const r = await runX("fn absorb(&self, g: Ghost) -> u32", "/// Absorb.");
  const header = r.calls.definition.filter((c) => c.line === 0);
  assert.ok(header.length >= 1, `definition() must be called at the impl header line; got ${JSON.stringify(r.calls.definition)}`);
  assert.strictEqual(
    XSRC.split("\n")[0].slice(header[0].character, header[0].character + 5),
    "Owner",
    `the anchor must sit on the type name; got column ${header[0].character}`,
  );
  assert.ok(r.out.includes("roll("), `the receiver's members ride the block:\n${r.out}`);
});

test("no tree, no receiver: the same fixture resolves nothing and asks the extractor nothing about it", async () => {
  const r = await runX("fn absorb(&self, g: Ghost) -> u32", "/// Absorb.", { noTree: true });
  assert.ok(!r.out.includes("Owner"), `the container is unknowable without the tree:\n${r.out}`);
  assert.deepStrictEqual(
    r.calls.definition.filter((c) => c.line === 0),
    [],
    "nothing may be anchored at the container header when no tree named one",
  );
  assert.deepStrictEqual(r.logs.filter((l) => /receiver/.test(l)), [], `the miss is silent: ${JSON.stringify(r.logs)}`);
});

test("a non-function target consults no tree at all: its surface equals the run with no tree", async () => {
  // Type generation targets the type itself, so there is no enclosing type to
  // work against. The signature here is a method's, which is the point: only the
  // generation kind can tell the two apart.
  for (const kind of ["struct", "enum", "class", "interface", "record"]) {
    const typed = await runX("fn absorb(&self, g: Ghost) -> u32", "/// Absorb.", { kind });
    const bare = await runX("fn absorb(&self, g: Ghost) -> u32", "/// Absorb.", { kind, noTree: true });
    assert.strictEqual(typed.out, bare.out, `[${kind}] the tree contributed to a non-function target's surface`);
    assert.deepStrictEqual(
      typed.calls.definition.filter((c) => c.line === 0),
      [],
      `[${kind}] nothing may be anchored at the container header when the target is not a function`,
    );
    assert.deepStrictEqual(typed.logs.filter((l) => /receiver/.test(l)), [], `[${kind}] and nothing may claim a receiver`);
  }
});

test("a signature that names no resolvable type still yields the receiver's block (the list is not empty-shortcircuited)", async () => {
  const r = await runX("fn absorb(&self) -> u32", undefined);
  assert.ok(r.out.includes("pub struct Owner"), `the receiver alone is a full prefill:\n${r.out}`);
  assert.ok(
    r.logs.some((l) => /receiver `Owner`/.test(l) && /first/.test(l)),
    `detection is logged: ${JSON.stringify(r.logs)}`,
  );
});

test("the detection line tells the two jobs apart, so a channel reader can check the block against the type", async () => {
  const call = await runX("fn absorb(&self) -> u32", undefined);
  const build = await runX("fn make(g: Ghost) -> Owner", undefined);
  const lineOf = (r) => r.logs.find((l) => /receiver `Owner`/.test(l));
  assert.ok(lineOf(call) && lineOf(build), `both jobs log a detection line: ${JSON.stringify([call.logs, build.logs])}`);
  assert.notStrictEqual(lineOf(call), lineOf(build), "the two jobs must not log the same line");
  assert.match(lineOf(build), /constructs/, `the build line says so: ${lineOf(build)}`);
  assert.doesNotMatch(lineOf(call), /constructs/, `the call line does not: ${lineOf(call)}`);
});

test("the drop accounting balances: kept minus injected equals the no-block lines", async () => {
  const r = await runX("fn absorb(&self, g: Ghost) -> u32", "/// Absorb.");
  const acct = r.logs.find((l) => /accounting/.test(l));
  assert.ok(acct, `an accounting line is owed once a candidate goes dark: ${JSON.stringify(r.logs)}`);
  const [, kept, injected, noBlock] = /kept=(\d+) injected=(\d+) no-block=(\d+)/.exec(acct).map(Number);
  const dropLines = r.logs.filter((l) => /injected nothing/.test(l));
  assert.strictEqual(kept - injected, noBlock, `kept ${kept} minus injected ${injected} must equal ${noBlock}`);
  assert.strictEqual(dropLines.length, noBlock, "one line per dark candidate, no more");
  assert.ok(/\bGhost\b/.test(dropLines[0]), `the drop line names the type: ${dropLines[0]}`);
});

test("a prefill where every kept candidate renders stays silent on accounting (the frozen free-function log identity)", async () => {
  const r = await runX("fn absorb(&self) -> u32", undefined);
  assert.deepStrictEqual(
    r.logs.filter((l) => /accounting|injected nothing/.test(l)),
    [],
    `nothing to account for means no accounting line: ${JSON.stringify(r.logs)}`,
  );
});

// ===========================================================================
// A WIDTH-PARAMETERIZED PREFILL. Everything below turns on how many chars a
// type's def costs against the two data-shape budgets (per-walk TOK_MAX*4 and
// the shared per-prompt total), so the fixture takes field COUNT and derives
// its own char widths rather than asserting a number a reader has to trust.
// `moduleScope` is the control arm: the same signature as a free function, with
// no container in the tree and therefore no receiver.
// ===========================================================================

const WURI = "file:///w/i24/wide.rs";
const WDEF = "file:///w/i24/wide_defs.rs";
const SIBS = ["Alpha", "Beta", "Gamma", "Delta"];

// The hover the resolver derives its fields from, and (verbatim) the def the
// data-shape walk charges to both budgets. Field names are realistic width on
// purpose: both budgets are CHAR budgets, so a two-char field name puts them out
// of reach at any field count a human would write and the fixture measures
// nothing.
const hoverOf = (name, fields) =>
  `pub struct ${name} { ${Array.from({ length: fields }, (_, i) => `descriptive_field_${String(i).padStart(2, "0")}: u32`).join(", ")} }`;

// Owner's member surface, split so a construction target can be measured
// against a call target: the members that can PRODUCE an Owner, and the
// instance methods that cannot.
const OWNER_PRODUCERS = [
  { name: "new", signature: "new(seed: u32) -> Owner", kind: "method" },
  { name: "from_widget", signature: "from_widget(w: Widget) -> Result<Self, ParseError>", kind: "method" },
  { name: "with_slots", signature: "with_slots(self, n: u32) -> Self", kind: "method" },
];
const OWNER_INSTANCE = [
  { name: "roll", signature: "roll(&self) -> u64", kind: "method" },
  { name: "slots_of", signature: "slots_of(&self) -> u32", kind: "method" },
  { name: "drain_into", signature: "drain_into(&mut self, sink: u32) -> u64", kind: "method" },
];

// `target`: "call" (a &self method), "build" (an associated fn returning Owner),
// or "free" (module scope, no container at all).
function wideFixture({ receiverFields, sibFields, sibCount, target = "call" }) {
  const sibs = SIBS.slice(0, sibCount);
  const params = sibs.map((s, i) => `p${i}: ${s}`).join(", ");
  const signature =
    target === "call"
      ? `fn absorb(&self${params ? `, ${params}` : ""}) -> u32`
      : target === "build"
        ? `fn absorb(${params}) -> Owner`
        : `fn absorb(${params}) -> u32`;
  const src =
    target === "free"
      ? `/// Absorb.\n${signature} {\n    todo!()\n}\n`
      : `impl Owner {\n    /// Absorb.\n    ${signature} {\n        todo!()\n    }\n}\n`;
  const symbols =
    target === "free"
      ? [
          {
            name: "absorb",
            kind: 11,
            range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } },
            selectionRange: { start: { line: 1, character: 3 }, end: { line: 1, character: 9 } },
            children: [],
          },
        ]
      : [implNode(src, "impl Owner {", 5)];
  const defs = ["Owner", ...sibs].map((n) => `pub struct ${n} {}`).join("\n") + "\n";
  const hovers = { Owner: hoverOf("Owner", receiverFields) };
  for (const s of sibs) {
    hovers[s] = hoverOf(s, sibFields);
  }
  return { src, defs, hovers, signature, sibs, symbols };
}

// definition/hover/members all answer off the type at the cursor: the exact word
// when it is a known type, else the first known type on the cursor's LINE. The
// line fallback is what keeps the assertions from depending on which column the
// implementation hovers at inside a header; the word takes priority because a
// construction target's own signature line names the type it RETURNS as well as
// its parameters.
function wideExtractor(fx) {
  const files = { [WURI]: fx.src, [WDEF]: fx.defs };
  const known = Object.keys(fx.hovers);
  const wordAt = (line, character) => {
    const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
    let s = Math.min(character, line.length);
    let e = s;
    while (s > 0 && isWord(line[s - 1])) s--;
    while (e < line.length && isWord(line[e])) e++;
    return line.slice(s, e);
  };
  const typeAt = (uri, c) => {
    const line = (files[uri] || "").split("\n")[c.line] ?? "";
    const w = wordAt(line, c.character);
    if (known.includes(w)) return w;
    return known.find((t) => new RegExp(`\\b${t}\\b`).test(line));
  };
  return {
    definition: async (c) => {
      const t = typeAt(c.uri, c);
      if (!t) return undefined;
      const ln = fx.defs.split("\n").findIndex((l) => new RegExp(`\\bstruct ${t}\\b`).test(l));
      const ch = fx.defs.split("\n")[ln].indexOf(t);
      return { uri: WDEF, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
    },
    hoverSurface: async (c) => {
      const t = typeAt(c.uri, c);
      return t ? { signature: fx.hovers[t] } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAt(c.uri, c);
      if (!t) return [];
      return t === "Owner" ? [...OWNER_PRODUCERS, ...OWNER_INSTANCE] : [{ name: "roll", signature: `roll(&self) -> u64`, kind: "method" }];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

async function runWide(cfg) {
  const fx = wideFixture(cfg);
  const start = fx.src.indexOf("fn absorb");
  const resolved = {
    span: { start, end: fx.src.indexOf("todo!()") + 7 },
    signature: fx.signature,
    docComment: "/// Absorb.",
    symbolName: "absorb",
    languageId: "rust",
    kind: "function",
    symbols: fx.symbols,
  };
  const logs = [];
  globalThis.__IMPL_V24P1_FILES__ = { [WURI]: fx.src, [WDEF]: fx.defs };
  let out;
  try {
    out = await resolvePrefill(wideExtractor(fx), makeDoc(fx.src, WURI), resolved, (l) => logs.push(l), cfg.opts);
  } finally {
    delete globalThis.__IMPL_V24P1_FILES__;
  }
  return { out: out || "", logs, fx };
}

// Which types kept a data shape, read off the surface by its own header.
const withDataShape = (out) => [...out.matchAll(/Data shape of `(\w+)`/g)].map((m) => m[1]);
// Which types kept a block AT ALL. A type starved of the shared data-shape
// budget still ships its member list; a type evicted by the type cap ships
// nothing, so these two lists tell the soft cost from the hard one.
// Both member-header spellings, because which one renders depends on the
// assembly path and the point here is only whether a block exists.
const withBlock = (out) => [...out.matchAll(/(?:Members of|API surface for) `(\w+)`/g)].map((m) => m[1]);
// One type's member list, read out of its own fenced block — the narrowing is a
// claim about the RECEIVER's members, and every sibling carries members too.
const memberBlock = (out, type) => {
  const m = new RegExp("(?:API surface for|Members of) `" + type + "`[^\\n]*\\n```[a-z]*\\n([\\s\\S]*?)```").exec(out);
  return m ? m[1] : "";
};
const shapeDrops = (logs) => logs.filter((l) => /data-shape walk/.test(l));
const capDrops = (logs) => logs.filter((l) => /lower-priority type\(s\)/.test(l));

test("a receiver whose own def breaches the per-walk budget loses every field, and says so", async () => {
  // 40 fields puts the def past TOK_MAX*4 CHARS, so the walk drops the ROOT and
  // returns an empty block. The member list still renders, so the type counts as
  // injected and the accounting arithmetic cannot see the loss.
  const r = await runWide({ receiverFields: 40, sibFields: 2, sibCount: 1 });
  assert.ok(r.fx.hovers.Owner.length > 800, `fixture precondition: the def must breach TOK_MAX*4; got ${r.fx.hovers.Owner.length}`);
  assert.ok(!withDataShape(r.out).includes("Owner"), `precondition: Owner's data shape is gone:\n${r.out}`);
  assert.ok(r.out.includes("roll("), `the member list still rides the block, so the loss is silent without a line:\n${r.out}`);
  const drops = shapeDrops(r.logs).filter((l) => /`Owner`/.test(l));
  assert.strictEqual(drops.length, 1, `total loss of the data shape must emit exactly one line: ${JSON.stringify(r.logs)}`);
  assert.ok(/\bOwner\b/.test(drops[0]), `the line names the type it lost: ${drops[0]}`);
});

test("a sibling starved of the shared budget by the receiver is reported, not lost silently", async () => {
  // Three siblings at 14 fields each against an 18-field receiver: the receiver
  // takes its slice of the shared total first, and a later sibling's def no
  // longer fits.
  const r = await runWide({ receiverFields: 18, sibFields: 14, sibCount: 3 });
  const kept = withDataShape(r.out);
  assert.ok(kept.includes("Owner"), `the receiver is never evicted:\n${r.out}`);
  const starved = r.fx.sibs.filter((s) => !kept.includes(s));
  assert.ok(starved.length > 0, `fixture precondition: at least one sibling must be starved; kept ${JSON.stringify(kept)}`);
  for (const s of starved) {
    assert.ok(
      shapeDrops(r.logs).some((l) => new RegExp(`\`${s}\``).test(l)),
      `\`${s}\` lost its data shape with no line anywhere: ${JSON.stringify(r.logs)}`,
    );
  }
});

// ===========================================================================
// THE PROMPT-SIZE BAR. The goal requires the receiver's prompt-size cost to be
// measured against the existing budget machinery, so the arms are committed
// here rather than described. Every number the run reports is derived from the
// run, and the assertions pin the SHAPE of the result (who keeps a shape, who
// is displaced, that the control keeps more) rather than a byte count that
// would rot the first time a header word changes. The exact figures are read
// out through `t.diagnostic` so a reader can copy them without re-deriving them.
//
// Two costs, two arms, and they are not the same cost. At three siblings the
// candidate count equals the type cap and the only thing the receiver can take
// is a sibling's data shape. At four it exceeds the cap and a sibling loses its
// entire block. The second arm is the one the contract's worked example names.
// A third arm measures the CONSTRUCTION surface, which is narrower by
// construction and therefore cheaper — measured, never assumed equal.
// ===========================================================================

test("prompt-size: the receiver's cost, and what it displaces at increasing sibling widths", async (t) => {
  const SIB_WIDTHS = [6, 10, 14, 18];
  const RECEIVER_FIELDS = 18;

  const rows = [];
  for (const sibFields of SIB_WIDTHS) {
    const method = await runWide({ receiverFields: RECEIVER_FIELDS, sibFields, sibCount: 3 });
    const control = await runWide({ receiverFields: RECEIVER_FIELDS, sibFields, sibCount: 3, target: "free" });
    rows.push({ sibFields, method, control });
    const displaced = withDataShape(control.out).filter((n) => !withDataShape(method.out).includes(n));
    t.diagnostic(
      `sibs@${sibFields}f: with receiver ${method.out.length}B shapes=[${withDataShape(method.out)}] | ` +
        `without (module scope) ${control.out.length}B shapes=[${withDataShape(control.out)}] | ` +
        `delta ${method.out.length - control.out.length}B | data shapes displaced: ${displaced.length ? displaced.join(", ") : "none"}`,
    );
  }

  // The receiver is never evicted, at any width (contract item 12).
  for (const { sibFields, method } of rows) {
    assert.ok(withDataShape(method.out).includes("Owner"), `the receiver lost its data shape at sibs@${sibFields}f`);
    assert.strictEqual(withDataShape(method.out)[0], "Owner", `the receiver must lead at sibs@${sibFields}f`);
  }

  // The displacement the earlier measurement claimed did not happen. It is a
  // contract-sanctioned cost, so it is recorded, not fixed.
  const starved = rows.map(({ method, control }) => ({
    method: withDataShape(method.out).length,
    control: withDataShape(control.out).length,
  }));
  assert.ok(
    starved.some((s) => s.method - 1 < s.control),
    `at some realistic sibling width the receiver must cost a sibling its data shape, else this fixture proves nothing: ${JSON.stringify(starved)}`,
  );
  // Monotone: a wider sibling never buys a candidate its shape back.
  for (let i = 1; i < starved.length; i++) {
    assert.ok(starved[i].method <= starved[i - 1].method, `widening siblings must not increase the kept-shape count: ${JSON.stringify(starved)}`);
  }
});

test("prompt-size: the CAP arm — the receiver evicts a fifth candidate, which then ships nothing at all", async (t) => {
  // Five candidates (receiver + 4 siblings) against PREFILL_TYPE_CAP = 4. The
  // arm above can never reach this: at three siblings the count equals the cap.
  const SIB_WIDTHS = [6, 10, 14];
  const RECEIVER_FIELDS = 18;

  for (const sibFields of SIB_WIDTHS) {
    const method = await runWide({ receiverFields: RECEIVER_FIELDS, sibFields, sibCount: 4 });
    const control = await runWide({ receiverFields: RECEIVER_FIELDS, sibFields, sibCount: 4, target: "free" });
    t.diagnostic(
      `cap arm, sibs@${sibFields}f: with receiver ${method.out.length}B shapes=[${withDataShape(method.out)}] blocks=[${withBlock(method.out)}] | ` +
        `without (module scope) ${control.out.length}B shapes=[${withDataShape(control.out)}] blocks=[${withBlock(control.out)}] | ` +
        `delta ${method.out.length - control.out.length}B`,
    );

    // The mechanism, not the bytes: the receiver takes a slot, so the lowest
    // priority candidate is dropped before any block is built.
    assert.strictEqual(
      capDrops(method.logs).length,
      1,
      `the method arm must evict exactly one candidate by the cap: ${JSON.stringify(method.logs)}`,
    );
    assert.match(capDrops(method.logs)[0], /dropped 1 lower-priority type\(s\): Delta/);
    assert.deepStrictEqual(capDrops(control.logs), [], `the control has 4 candidates against a cap of 4 and evicts nothing`);

    // Eviction is the harder loss. A starved candidate keeps its member list;
    // this one has no header of any kind in the surface.
    assert.ok(!withBlock(method.out).includes("Delta"), `the evicted type must lose its member list:\n${method.out}`);
    assert.ok(!/\bDelta\b/.test(method.out), `the evicted type must not appear in the surface at all:\n${method.out}`);
    assert.ok(!withDataShape(method.out).includes("Delta"), `the evicted type must lose its data shape:\n${method.out}`);
    assert.ok(withBlock(control.out).includes("Delta"), `fixture precondition: the control must carry Delta's block:\n${control.out}`);
    assert.strictEqual(withDataShape(method.out)[0], "Owner", `the receiver still leads at sibs@${sibFields}f`);
  }
});

test("prompt-size: the CONSTRUCTION surface is measured, not assumed equal to the call surface", async (t) => {
  const SIB_WIDTHS = [6, 14];
  const RECEIVER_FIELDS = 18;

  for (const sibFields of SIB_WIDTHS) {
    const call = await runWide({ receiverFields: RECEIVER_FIELDS, sibFields, sibCount: 3, target: "call" });
    const build = await runWide({ receiverFields: RECEIVER_FIELDS, sibFields, sibCount: 3, target: "build" });
    const control = await runWide({ receiverFields: RECEIVER_FIELDS, sibFields, sibCount: 3, target: "free" });
    t.diagnostic(
      `sibs@${sibFields}f: call ${call.out.length}B (+${call.out.length - control.out.length}B over control) | ` +
        `build ${build.out.length}B (+${build.out.length - control.out.length}B) | ` +
        `build saves ${call.out.length - build.out.length}B against call | ` +
        `call shapes=[${withDataShape(call.out)}] build shapes=[${withDataShape(build.out)}]`,
    );

    assert.strictEqual(withDataShape(build.out)[0], "Owner", `a construction target still leads with the type it builds:\n${build.out}`);
    const buildMembers = memberBlock(build.out, "Owner");
    const callMembers = memberBlock(call.out, "Owner");
    assert.ok(withDataShape(build.out).includes("Owner"), `the fields are what a constructor must fill:\n${build.out}`);
    for (const m of OWNER_PRODUCERS) {
      assert.ok(buildMembers.includes(`${m.name}(`), `the producing member ${m.name} must survive at a construction target:\n${buildMembers}`);
      assert.ok(callMembers.includes(`${m.name}(`), `and the call surface keeps it too — it is the fuller one:\n${callMembers}`);
    }
    for (const m of OWNER_INSTANCE) {
      assert.ok(!buildMembers.includes(`${m.name}(`), `the instance method ${m.name} is noise at a construction target:\n${buildMembers}`);
      assert.ok(callMembers.includes(`${m.name}(`), `fixture precondition: the call surface carries it:\n${callMembers}`);
    }
    assert.ok(
      build.out.length < call.out.length,
      `the construction surface must cost LESS than the call surface, else the narrowing bought nothing: ` +
        `build ${build.out.length}B vs call ${call.out.length}B`,
    );
    // Against the control the cost is a BLOCK, not a byte count: at a width
    // where the receiver displaces a wider sibling's data shape, the whole
    // surface is SMALLER with the receiver in it than without. That is what the
    // diagnostic above records, and it is why nothing here asserts on the delta.
    assert.ok(withBlock(build.out).includes("Owner"), `the receiver's block is what the control does not have:\n${build.out}`);
    assert.ok(!withBlock(control.out).includes("Owner"), `fixture precondition: the control has no receiver:\n${control.out}`);
  }
});

test("the construction narrowing touches the ROOT only, and says how many members it removed", async () => {
  const build = await runWide({ receiverFields: 2, sibFields: 2, sibCount: 2, target: "build" });
  const call = await runWide({ receiverFields: 2, sibFields: 2, sibCount: 2, target: "call" });
  // A sibling reached through the signature carries the same instance method at
  // both targets: it is a collaborator to call into, not the thing being built.
  for (const s of build.fx.sibs) {
    assert.ok(memberBlock(build.out, s).includes("roll("), `sibling ${s} lost a member at a construction target:\n${build.out}`);
    assert.ok(memberBlock(call.out, s).includes("roll("), `fixture precondition: the call arm carries it too:\n${call.out}`);
  }
  const line = build.logs.find((l) => /narrow/i.test(l));
  assert.ok(line, `a construction target that removed members owes an evidence line: ${JSON.stringify(build.logs)}`);
  assert.match(line, new RegExp(`\\b${OWNER_INSTANCE.length}\\b`), `the line must carry the removal count: ${line}`);
  for (const m of OWNER_INSTANCE) {
    assert.ok(line.includes(m.name), `the removed member is named so phase 2 can attach its own reason: ${line}`);
  }
  assert.deepStrictEqual(call.logs.filter((l) => /narrow/i.test(l)), [], `a call target narrows nothing and owes no line`);
});

test("prompt-size: the width at which the receiver's own data shape disappears", async (t) => {
  // The per-walk bound is TOK_MAX*4 CHARS, not a field count. Find the first
  // field count whose def TEXT crosses it, and confirm that is exactly where the
  // shape goes dark.
  let last;
  let firstDark;
  for (let n = 20; n <= 40; n++) {
    const r = await runWide({ receiverFields: n, sibFields: 2, sibCount: 1 });
    const kept = withDataShape(r.out).includes("Owner");
    if (kept) {
      last = { n, chars: r.fx.hovers.Owner.length };
    } else if (firstDark === undefined) {
      firstDark = { n, chars: r.fx.hovers.Owner.length, logs: r.logs };
      break;
    }
  }
  assert.ok(firstDark, "the receiver's data shape must go dark somewhere in this sweep");
  t.diagnostic(
    `receiver data shape: last kept at ${last.n} fields (${last.chars} chars of def text), ` +
      `dark from ${firstDark.n} fields (${firstDark.chars} chars)`,
  );
  assert.ok(firstDark.chars > 800, `the boundary must be the TOK_MAX*4 char bound, got ${firstDark.chars} chars`);
  assert.ok(
    shapeDrops(firstDark.logs).some((l) => /`Owner`/.test(l)),
    `the receiver losing its whole data shape must not be silent: ${JSON.stringify(firstDark.logs)}`,
  );
});

// ===========================================================================
// TEST GENERATION. `resolvePrefill` serves both gestures, and the receiver
// applies to test-gen deliberately: at a method target it is the type the
// generated test must construct to make the call. Pinned here because that is a
// decision, and an undefended decision is one a later phase reverses by accident.
// ===========================================================================

test("test generation keeps the receiver first, and its block carries no method body", async () => {
  const r = await runWide({
    receiverFields: 2,
    sibFields: 2,
    sibCount: 2,
    opts: { forConstruction: true, importTargetPath: "/w/i24/tests/absorb.rs" },
  });
  const shapes = withDataShape(r.out);
  assert.strictEqual(shapes[0], "Owner", `the receiver leads the test-gen surface too:\n${r.out}`);
  assert.ok(
    r.logs.some((l) => /receiver `Owner`/.test(l) && /first/.test(l)),
    `test-gen logs the same detection line: ${JSON.stringify(r.logs)}`,
  );
  // Blind by construction: a data shape and signatures, never an implementation.
  // `todo!()` is the target's own body in the fixture — if it appears, a body leaked.
  assert.ok(!/todo!\(\)/.test(r.out), `the test-gen surface must carry no method body:\n${r.out}`);
  assert.ok(!/\bfn\s+\w+[^;\n]*\{/.test(r.out), `no signature in the surface opens a body:\n${r.out}`);
});
