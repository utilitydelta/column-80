// Implementer oracles for the v9 phase 3 TS extractors: the internals the
// blind contract suite cannot reach from outside the seam. Pins the pure
// helper corners (signature slicing, hover-fence parsing, the kind/role
// tables), the loose-suggestion filter's PRECISION (a JSDoc-typed receiver in
// an untyped-JS project keeps its real members while the any receiver stays
// dark), the hoisted-monorepo typescript walk-up, overlay-only documents, and
// the product transport's tolerance corners (bare-array completions, single
// hover object, LocationLink without a selection range, foreign-file edits).
//
// Run: SKIP_LIVE=1 node --test test/impl-v9-tsextractor.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v9-tsextractor",
  `export { TsLsExtractor } from "../src/core/tsLsExtractor";\n` +
    `export { TsCommandExtractor } from "../src/vscode/tsExtractor";\n` +
    `export { renderTsMemberSignature, toTsCompletionMember, tsElementMemberKind, tsVscodeMemberKind, tsVscodeSymbolRole, parseTsHover } from "../src/core/tsExtraction";\n`,
);
const {
  TsLsExtractor,
  TsCommandExtractor,
  renderTsMemberSignature,
  toTsCompletionMember,
  tsElementMemberKind,
  tsVscodeMemberKind,
  tsVscodeSymbolRole,
  parseTsHover,
} = mod;
test.after(cleanup);

const REPO_TS_DIR = path.join(__dirname, "..", "node_modules", "typescript");

// ---------------------------------------------------------------------------
// renderTsMemberSignature: slice the member's own declaration from quickinfo.
// ---------------------------------------------------------------------------

test("renderTsMemberSignature slices the member declaration; invariant: chrome and qualifiers never reach the prompt", () => {
  const cases = [
    // [name, display, expected]
    ["setTheme", "(method) ThemeStore.setTheme(theme: string): void", "setTheme(theme: string): void"],
    ["isDark", "(property) ThemeStore.isDark: boolean", "isDark: boolean"],
    ["sum", "function sum(a: number, b: number): number", "sum(a: number, b: number): number"],
    ["title", "(property) CardProps.title?: string", "title?: string"],
    ["wrap", "(method) Box.wrap<T>(value: T): T", "wrap<T>(value: T): T"],
    // function-TYPED properties (MobX arrow actions) render call-shaped so
    // arity reads as arity in the injected line
    ["toggle", "(property) ThemeStore.toggle: () => void", "toggle(): void"],
    ["setTheme", '(property) ThemeStore.setTheme: (theme: "light" | "dark") => void', 'setTheme(theme: "light" | "dark"): void'],
    // optional function properties: BOTH real displays (TS 5.9). Non-strict
    // projects print the bare arrow; strict projects (the overwhelming
    // default) print the `(...) | undefined` union wrapper, whose undefined
    // the `?` head already carries - so exactly that wrapper strips and the
    // one function inside call-shapes.
    ["onPick", "(property) Panel.onPick?: (index: number) => void", "onPick?(index: number): void"],
    ["onPick", "(property) Panel.onPick?: ((index: number) => void) | undefined", "onPick?(index: number): void"],
    ["onDone", "(property) Panel.onDone?: (() => void) | undefined", "onDone?(): void"],
    // NOT call-shaped: a union containing a function, and a generic arrow -
    // both stay verbatim (the rewrite only fires on one top-level (params) => ret)
    ["maybeRun", "(property) Job.maybeRun: (() => void) | undefined", "maybeRun: (() => void) | undefined"],
    ["lift", "(property) Box.lift: <T>(value: T) => T", "lift: <T>(value: T) => T"],
    // strict optional over a REAL union of two functions: stripping the
    // wrapper exposes a union, not one function - verbatim
    ["pick", "(property) P.pick?: ((() => void) | ((x: string) => void)) | undefined", "pick?: ((() => void) | ((x: string) => void)) | undefined"],
    // a string-literal type carrying a paren poisons the depth walk: verbatim
    // passthrough, never a fabricated signature (the quote guard; a literal
    // WITHOUT parens, like setTheme's above, still call-shapes)
    ["s", '(property) X.s: (s: ") => x", t: number) => void', 's: (s: ") => x", t: number) => void'],
    // a same-named receiver qualifier must not win the slice
    ["theme", "(property) theme.theme: string", "theme: string"],
    // no declaration-style occurrence: the service's real text passes through
    ["weird", "import weird", "import weird"],
    // no display at all: signature-less, never invented
    ["bare", undefined, undefined],
  ];
  for (const [name, display, expected] of cases) {
    assert.strictEqual(renderTsMemberSignature(name, display), expected, `${name} <- ${JSON.stringify(display)}`);
  }
});

test("toTsCompletionMember renders signatures for EVERY kind (property signatures are contract for TS) and never sets viaTrait", () => {
  const field = toTsCompletionMember("theme", "(property) ThemeStore.theme: string", "field");
  assert.deepStrictEqual(field, { name: "theme", kind: "field", signature: "theme: string" });
  const method = toTsCompletionMember("setTheme", undefined, "method");
  assert.deepStrictEqual(method, { name: "setTheme", kind: "method" }, "no display -> no signature key at all");
});

// ---------------------------------------------------------------------------
// Kind and role tables (amendments 4 and 6).
// ---------------------------------------------------------------------------

test("tsElementMemberKind: warning (loose suggestion) and keyword drop; getter/setter/property are fields; unknown kinds are other", () => {
  const cases = [
    ["warning", undefined],
    ["keyword", undefined],
    ["method", "method"],
    ["property", "field"],
    ["getter", "field"],
    ["setter", "field"],
    ["function", "function"],
    ["const", "other"],
    ["var", "other"],
  ];
  for (const [kind, expected] of cases) {
    assert.strictEqual(tsElementMemberKind(kind), expected, `element kind ${kind}`);
  }
});

test("tsVscodeMemberKind: Text/Keyword/Snippet drop, Method/Function/Field/Property map, everything else is other", () => {
  const cases = [
    [0, undefined], [13, undefined], [14, undefined],
    [1, "method"], [2, "function"], [4, "field"], [9, "field"],
    [3, "other"], [12, "other"], [undefined, "other"], ["method", "other"],
  ];
  for (const [kind, expected] of cases) {
    assert.strictEqual(tsVscodeMemberKind(kind), expected, `vscode completion kind ${String(kind)}`);
  }
});

test("tsVscodeSymbolRole: Class/Enum/Interface contain; Method/Function/Property/Field are members; a function is NOT a container", () => {
  const cases = [
    [4, "container"], [9, "container"], [10, "container"],
    [5, "method"], [11, "function"], [6, "field"], [7, "field"],
    [12, "other"], [22, "other"], // vscode Struct=22 is the RUST table's container, not TS's
  ];
  for (const [kind, expected] of cases) {
    assert.strictEqual(tsVscodeSymbolRole(kind), expected, `vscode symbol kind ${kind}`);
  }
});

// ---------------------------------------------------------------------------
// parseTsHover corners beyond the blind fixtures.
// ---------------------------------------------------------------------------

test("parseTsHover: fence-language tolerance, first-fence-wins, prose-only degrade", () => {
  const cases = [
    {
      why: "a ```tsx fence is a signature fence too",
      md: "```tsx\nfunction Card(props: CardProps): JSX.Element\n```\nRenders a card.",
      expect: { signature: "function Card(props: CardProps): JSX.Element", doc: "Renders a card." },
    },
    {
      why: "the FIRST fence is the signature; a later fence's CODE is not doc prose (doc carries prose only)",
      md: "```typescript\nconst a: number\n```\ndocs\n```typescript\nconst b: number\n```\n",
      expect: { signature: "const a: number", doc: "docs" },
    },
    {
      why: "prose with no fence is not a surface",
      md: "Just some markdown prose.",
      expect: undefined,
    },
    {
      why: "an empty fence is not a surface",
      md: "```typescript\n```\nprose",
      expect: undefined,
    },
    {
      why: "a foreign-language fence is not the quickinfo block",
      md: "```python\ndef f(): ...\n```\n",
      expect: undefined,
    },
  ];
  for (const c of cases) {
    const got = parseTsHover(c.md);
    if (c.expect === undefined) {
      assert.strictEqual(got, undefined, c.why);
    } else {
      assert.strictEqual(got.signature, c.expect.signature, c.why);
      assert.strictEqual(got.doc, c.expect.doc, c.why);
      assert.strictEqual(got.example, undefined, "example is never parsed for TS");
    }
  }
});

// ---------------------------------------------------------------------------
// Headless transport: scratch-project pins the blind suite does not cover.
// ---------------------------------------------------------------------------

const writeTree = (root, files) => {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
};

test("typescript walk-up: a nested package resolves the HOISTED node_modules/typescript (monorepo shape)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-tswalk-"));
  try {
    writeTree(root, {
      "packages/app/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }),
      "packages/app/src/lib.ts": "export const answer: number = 42;\n",
    });
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.symlinkSync(REPO_TS_DIR, path.join(root, "node_modules", "typescript"), "dir");
    const ex = await TsLsExtractor.start({ projectRoot: path.join(root, "packages", "app") });
    try {
      const uri = pathToFileURL(path.join(root, "packages", "app", "src", "lib.ts")).href;
      const h = await ex.hoverSurface({ uri, line: 0, character: 14 });
      assert.ok(h && h.signature.includes("answer"), `the hoisted-install service resolves, got ${JSON.stringify(h)}`);
    } finally {
      ex.dispose();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("loose-suggestion filter is PRECISE: in one untyped-JS project, a JSDoc-typed receiver keeps real members while the any receiver stays dark", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-tsjs-"));
  try {
    const MAIN = [
      "class Cart {",
      "  constructor() { this.total = 0; }",
      "  addItem(price) { this.total += price; }",
      "}",
      "/** @param {Cart} cart */",
      "function checkout(cart) {",
      "  return cart.total;",
      "}",
      "function show(item) {",
      "  return item.length;",
      "}",
      "module.exports = { checkout, show };",
      "",
    ].join("\n");
    writeTree(root, {
      "tsconfig.json": JSON.stringify({ compilerOptions: { allowJs: true, noEmit: true }, include: ["src"] }),
      "src/main.js": MAIN,
    });
    const ex = await TsLsExtractor.start({ projectRoot: root, ts: require(REPO_TS_DIR) });
    try {
      const uri = pathToFileURL(path.join(root, "src", "main.js")).href;
      const typedDot = MAIN.indexOf("cart.total") + "cart.".length;
      const typedLine = MAIN.slice(0, typedDot).split("\n").length - 1;
      const typedChar = typedDot - (MAIN.lastIndexOf("\n", typedDot - 1) + 1);
      const typed = await ex.completeMembers({ uri, line: typedLine, character: typedChar });
      const names = typed.map((m) => m.name).sort();
      assert.deepStrictEqual(names, ["addItem", "total"], "JSDoc-recovered types keep their REAL members");
      assert.ok(!names.includes("checkout") && !names.includes("show"), "loose file-identifier suggestions never leak in");

      const anyDot = MAIN.indexOf("item.length") + "item.".length;
      const anyLine = MAIN.slice(0, anyDot).split("\n").length - 1;
      const anyChar = anyDot - (MAIN.lastIndexOf("\n", anyDot - 1) + 1);
      assert.deepStrictEqual(await ex.completeMembers({ uri, line: anyLine, character: anyChar }), [], "the any receiver stays dark");
    } finally {
      ex.dispose();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("openDocument of a uri NOT on disk is queryable (a never-saved buffer)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-tsnew-"));
  try {
    writeTree(root, {
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }),
      "src/seed.ts": "export const seed = 1;\n",
    });
    const ex = await TsLsExtractor.start({ projectRoot: root, ts: require(REPO_TS_DIR) });
    try {
      const uri = pathToFileURL(path.join(root, "src", "fresh.ts")).href;
      ex.openDocument(uri, "export const freshValue: string = \"hi\";\n");
      const h = await ex.hoverSurface({ uri, line: 0, character: 14 });
      assert.ok(h, "the overlay-only file resolves");
      assert.ok(h.signature.includes("freshValue") && h.signature.includes("string"), `got ${JSON.stringify(h.signature)}`);
    } finally {
      ex.dispose();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("start rejects an injected non-typescript module with the named error (garbage opts.ts never half-constructs)", async () => {
  await assert.rejects(TsLsExtractor.start({ projectRoot: os.tmpdir(), ts: { not: "typescript" } }), (e) => {
    assert.strictEqual(e.name, "TsResolveError");
    assert.match(String(e.message), /typescript/i);
    return true;
  });
});

// ---------------------------------------------------------------------------
// Product transport tolerance corners (amendment 5's permitted-but-not-
// contractual shapes, and the same-file edit guard).
// ---------------------------------------------------------------------------

const CUR = { uri: "file:///fake/src/app.ts", line: 1, character: 5 };

test("product completeMembers accepts a BARE ARRAY completion result (permitted alongside CompletionList)", async () => {
  const run = async () => [{ label: "setTheme", kind: 1, detail: "(method) T.setTheme(x: string): void" }];
  const members = await new TsCommandExtractor(run).completeMembers(CUR);
  assert.strictEqual(members.length, 1);
  assert.strictEqual(members[0].signature, "setTheme(x: string): void");
});

test("product hoverSurface accepts a SINGLE hover object (not wrapped in an array)", async () => {
  const run = async () => ({ contents: [{ value: "```typescript\nconst x: number\n```\n" }] });
  const h = await new TsCommandExtractor(run).hoverSurface(CUR);
  assert.ok(h);
  assert.strictEqual(h.signature, "const x: number");
});

test("product definition: a LocationLink WITHOUT a selection range falls back to the target range", async () => {
  const run = async () => [
    {
      targetUri: { toString: () => "file:///fake/src/store.ts" },
      targetRange: { start: { line: 2, character: 0 }, end: { line: 8, character: 1 } },
    },
  ];
  const def = await new TsCommandExtractor(run).definition(CUR);
  assert.ok(def, "a link with only targetRange still resolves");
  assert.deepStrictEqual(def.range, { startLine: 2, startCharacter: 0, endLine: 8, endCharacter: 1 });
});

test("product qualifyImport refuses an edit whose single file is NOT the cursor's own", async () => {
  const foreign = {
    entries: () => [
      [{ toString: () => "file:///fake/src/other.ts" }, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "import { x } from \"./x\";\n" }]],
    ],
  };
  const run = async (command) => (command === "vscode.executeCodeActionProvider" ? [{ title: 'Add import from "./x"', edit: foreign }] : undefined);
  assert.strictEqual(await new TsCommandExtractor(run).qualifyImport(CUR), undefined, "same-file is part of the single-edit contract");
});

test("product qualifyImport dedup: two IDENTICAL auto-import actions are ONE fix (offer); two DISTINCT modules stay ambiguous", async () => {
  // The sole-provider shape: the service repeats an identical fix per
  // triggering code. Ambiguity counts DISTINCT identities (the title carries
  // the module), aligning the headless transport's distinct-description gate.
  const IMPORT_TEXT = 'import { missingThing } from "./order";\n';
  const sameEdit = () => ({
    entries: () => [
      [{ toString: () => CUR.uri }, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: IMPORT_TEXT }]],
    ],
  });
  const actionsFor = (titles) => titles.map((title) => ({ title, edit: sameEdit() }));
  const runWith = (actions) => async (command) => (command === "vscode.executeCodeActionProvider" ? actions : undefined);
  const offered = await new TsCommandExtractor(
    runWith(actionsFor(['Add import from "./order"', 'Add import from "./order"'])),
  ).qualifyImport(CUR);
  assert.ok(offered, "the duplicate identical pair is ONE fix - the sole-provider mainline must not go dark");
  assert.strictEqual(offered.newText, IMPORT_TEXT, "the offer carries the fix's own edit");
  assert.strictEqual(
    await new TsCommandExtractor(
      runWith(actionsFor(['Add import from "./order"', 'Add import from "./legacy/order"'])),
    ).qualifyImport(CUR),
    undefined,
    "two candidate modules are real ambiguity: no offer",
  );
});

test("product membersOfType: a non-array documentSymbol answer degrades to []", async () => {
  for (const answer of [undefined, null, { not: "symbols" }]) {
    const run = async () => answer;
    assert.deepStrictEqual(await new TsCommandExtractor(run).membersOfType(CUR), [], `answer ${JSON.stringify(answer)}`);
  }
});

// ---------------------------------------------------------------------------
// Phase 3 round-1 fix pins (triage findings 1, 2, 3, 5, 6, 7, 9).
// ---------------------------------------------------------------------------

test("checker membersOfType never fabricates: symbol-keyed members filtered, enum members are the constants (not Number.prototype)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-tsmot-"));
  try {
    writeTree(root, {
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2018" }, include: ["src"] }),
      "src/lib.ts": [
        "export class Bag {",
        "  items: number[] = [];",
        "  add(n: number): void { this.items.push(n); }",
        "  __computedTotal(): number { return this.items.length; }",
        "  [Symbol.iterator]() { return this.items[Symbol.iterator](); }",
        "}",
        "export enum Color { Red, Green = 4 }",
        "",
      ].join("\n"),
    });
    const ex = await TsLsExtractor.start({ projectRoot: root, ts: require(REPO_TS_DIR) });
    try {
      const uri = pathToFileURL(path.join(root, "src", "lib.ts")).href;
      // finding 1: the checker escapes a [Symbol.iterator] member to an
      // internal name (__@iterator@N) that is not a spellable member - it
      // must never reach the member set under "use these real names".
      const bag = await ex.membersOfType({ uri, line: 0, character: 14 });
      const bagNames = bag.map((m) => m.name);
      assert.ok(bagNames.includes("items") && bagNames.includes("add"), `real members stay, got ${JSON.stringify(bagNames)}`);
      // Round-2 minor: the checker's internal name is exactly "__computed";
      // a user member that merely STARTS with it is real and must surface.
      assert.ok(bagNames.includes("__computedTotal"), `legitimate __computed*-named member surfaces, got ${JSON.stringify(bagNames)}`);
      assert.ok(
        !bagNames.some((n) => n.startsWith("__@") || n === "__computed"),
        `no escaped internal name reaches the member set, got ${JSON.stringify(bagNames)}`,
      );
      // finding 2: an enum's declared type is a literal union whose APPARENT
      // properties are Number.prototype; the member surface must be the
      // enum's own constants instead.
      const color = await ex.membersOfType({ uri, line: 6, character: 13 });
      assert.deepStrictEqual(color.map((m) => m.name).sort(), ["Green", "Red"], "the enum constants ARE the member set");
      assert.ok(color.every((m) => m.kind === "field"), "enum constants surface as fields");
      assert.ok(!color.some((m) => m.name === "toFixed" || m.name === "toString"), "Number.prototype never leaks");
    } finally {
      ex.dispose();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("product membersOfType builds through the TS builder (detail renders TS-shaped), filters #-names and KEEPS the constructor", async () => {
  const span = { start: { line: 0, character: 0 }, end: { line: 9, character: 1 } };
  const symbols = [
    {
      name: "ThemeStore",
      kind: 4, // Class (container)
      range: span,
      children: [
        { name: "constructor", kind: 8, range: span, children: [] },
        { name: "#secret", kind: 7, range: span, children: [] },
        { name: "setTheme", kind: 5, detail: "(theme: Theme): void", range: span, children: [] },
        { name: "isDark", kind: 6, detail: "", range: span, children: [] },
      ],
    },
  ];
  const run = async () => symbols;
  const members = await new TsCommandExtractor(run).membersOfType({ uri: "file:///fake/src/app.ts", line: 1, character: 2 });
  // The constructor was filtered here until it was measured: it is the only
  // member carrying the type's construction arity, and a construction surface
  // that cannot state how many arguments the type takes is the defect this
  // member set exists to prevent. `#`-private stays filtered.
  assert.deepStrictEqual(members.map((m) => m.name).sort(), ["constructor", "isDark", "setTheme"], "#secret is never an available member; the constructor is");
  const setTheme = members.find((m) => m.name === "setTheme");
  // finding 3: a detail-carrying provider renders through toTsCompletionMember;
  // the Rust builder's /^fn\b/ gate would have dropped this signature.
  assert.strictEqual(setTheme.signature, "(theme: Theme): void", "TS detail is not lost to the Rust fn-gate");
  const isDark = members.find((m) => m.name === "isDark");
  assert.strictEqual(isDark.signature, undefined, "empty detail (real vscode) delivers names+kinds - the phase3-surface carve-out");
});

test("product completeMembers member-site gate: a readable non-member site refuses without dispatch; dot sites and absent readers proceed", async () => {
  const text = "const store = getStore();\n\nstore.setTh\nconst n = 5;\n";
  const listResult = { items: [{ label: "setTheme", kind: 1, detail: "(method) T.setTheme(x: string): void" }] };
  const cases = [
    { why: "blank line with readable text refuses (the in-scope world is not a member surface)", read: () => text, cursor: { line: 1, character: 0 }, expectNames: [], expectCalls: 0 },
    { why: "statement site with no dot refuses", read: () => text, cursor: { line: 3, character: 11 }, expectNames: [], expectCalls: 0 },
    { why: "dot + partial identifier proceeds (the live FIM shape)", read: () => text, cursor: { line: 2, character: 11 }, expectNames: ["setTheme"], expectCalls: 1 },
    { why: "bare trailing dot proceeds", read: () => text, cursor: { line: 2, character: 6 }, expectNames: ["setTheme"], expectCalls: 1 },
    { why: "no reader proceeds (trust the caller)", read: undefined, cursor: { line: 1, character: 0 }, expectNames: ["setTheme"], expectCalls: 1 },
    { why: "an unreadable document proceeds (trust the caller)", read: () => undefined, cursor: { line: 1, character: 0 }, expectNames: ["setTheme"], expectCalls: 1 },
  ];
  for (const c of cases) {
    let calls = 0;
    const run = async () => {
      calls++;
      return listResult;
    };
    const members = await new TsCommandExtractor(run, c.read).completeMembers({ uri: "file:///fake/src/app.ts", ...c.cursor });
    assert.deepStrictEqual(members.map((m) => m.name), c.expectNames, c.why);
    assert.strictEqual(calls, c.expectCalls, `${c.why} (dispatch count)`);
  }
});

test("start rejects a tsconfig that EXISTS but cannot be read/parsed with TsConfigError; missing tsconfig and empty include still start", async () => {
  const broken = [
    ["syntax error", { "tsconfig.json": '{ "compilerOptions": { "strict": true,, } }' }],
    ["not JSON at all", { "tsconfig.json": "lol this is not json" }],
    ["circular extends", { "tsconfig.json": '{ "extends": "./other.json" }', "other.json": '{ "extends": "./tsconfig.json" }' }],
    ["broken option shape", { "tsconfig.json": '{ "compilerOptions": { "strict": "yes" } }' }],
  ];
  for (const [why, files] of broken) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-tscfg-"));
    try {
      writeTree(root, { "src/a.ts": "export const a = 1;\n", ...files });
      await assert.rejects(
        TsLsExtractor.start({ projectRoot: root, ts: require(REPO_TS_DIR) }),
        (e) => {
          assert.strictEqual(e.name, "TsConfigError", why);
          assert.match(String(e.message), /tsconfig/, why);
          return true;
        },
        why,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  // A MISSING tsconfig keeps the surface's behavior: default options, service
  // answers. TS18003 "no inputs" is a project shape (overlay-only projects
  // are legitimate), never a rejection.
  const survivors = [
    ["missing tsconfig", { "src/a.ts": "export const alive = 1;\n" }],
    ["empty include (TS18003)", { "tsconfig.json": '{ "compilerOptions": { "strict": true }, "include": ["nope"] }' }],
  ];
  for (const [why, files] of survivors) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-tscfg-"));
    try {
      writeTree(root, files);
      const ex = await TsLsExtractor.start({ projectRoot: root, ts: require(REPO_TS_DIR) });
      ex.dispose();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("qualifyImport on TS2662/TS2663 sites (did-you-mean member variants) resolves undefined without crashing the service", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-ts2662-"));
  try {
    const W = [
      "export class Widget {",
      "  static sFlag = 1;",
      "  iFlag = 2;",
      "  useS(): number { return sFlag; }",
      "  useI(): number { return iFlag; }",
      "}",
      "",
    ].join("\n");
    writeTree(root, {
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }),
      "src/w.ts": W,
    });
    const ts = require(REPO_TS_DIR);
    // The fixture must ACTUALLY trigger the excluded codes, else this pins
    // nothing: verify with a plain program first.
    const wPath = path.join(root, "src", "w.ts");
    const program = ts.createProgram([wPath], { strict: true, noEmit: true });
    const codes = program.getSemanticDiagnostics().map((d) => d.code);
    assert.ok(codes.includes(2662), `fixture raises TS2662, got ${JSON.stringify(codes)}`);
    assert.ok(codes.includes(2663), `fixture raises TS2663, got ${JSON.stringify(codes)}`);
    const ex = await TsLsExtractor.start({ projectRoot: root, ts });
    try {
      const uri = pathToFileURL(wPath).href;
      const lines = W.split("\n");
      for (const [line, name] of [
        [3, "sFlag"],
        [4, "iFlag"],
      ]) {
        const character = lines[line].lastIndexOf(name) + 1;
        assert.strictEqual(
          await ex.qualifyImport({ uri, line, character }),
          undefined,
          `${name}: the excluded codes never reach the crash-prone fix path`,
        );
      }
      // The service is still alive afterwards - no crash state.
      const h = await ex.hoverSurface({ uri, line: 1, character: 10 });
      assert.ok(h && h.signature.includes("sFlag"), "the service still answers after the excluded-code sites");
    } finally {
      ex.dispose();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("qualifyImport ambiguity dedup: two IDENTICAL fix descriptions are ONE candidate (an edit); two DISTINCT are ambiguous (undefined)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-tsdedup-"));
  try {
    writeTree(root, {
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }),
      "src/main.ts": "const v = MissingName;\n",
    });
    const realTs = require(REPO_TS_DIR);
    const mainPath = path.join(root, "src", "main.ts");
    const makeFix = (mod) => ({
      fixName: "import",
      description: `Add import from "${mod}"`,
      changes: [
        {
          fileName: mainPath,
          textChanges: [{ span: { start: 0, length: 0 }, newText: `import { MissingName } from "${mod}";\n` }],
        },
      ],
    });
    // The real service, with ONLY getCodeFixesAtPosition scripted: the
    // diagnostic gate (a real TS2304 under the identifier) stays real, while
    // the fix list is controlled so the dedup logic itself is what is pinned.
    // The service repeats an identical fix per triggering code (spiked in
    // phase 3) - raw-fix counting would wrongly call that ambiguous.
    let fixes = [];
    const wrappedTs = {
      ...realTs,
      createLanguageService: (host, registry) => {
        const svc = realTs.createLanguageService(host, registry);
        return { ...svc, getCodeFixesAtPosition: () => fixes };
      },
    };
    const ex = await TsLsExtractor.start({ projectRoot: root, ts: wrappedTs });
    try {
      const uri = pathToFileURL(mainPath).href;
      const cursor = { uri, line: 0, character: 12 }; // inside MissingName
      fixes = [makeFix("./a"), makeFix("./a")];
      const edit = await ex.qualifyImport(cursor);
      assert.ok(edit, "identical duplicates dedup to one candidate - still an edit");
      assert.strictEqual(edit.newText, 'import { MissingName } from "./a";\n');
      assert.deepStrictEqual(edit.range, { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 });
      fixes = [makeFix("./a"), makeFix("./b")];
      assert.strictEqual(await ex.qualifyImport(cursor), undefined, "distinct descriptions are real ambiguity");
    } finally {
      ex.dispose();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
