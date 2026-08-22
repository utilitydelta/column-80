// Blind oracle: the TS surface extractors (the v9 phase 3 surface).
// Black-box contract tests written from the surface ALONE, before the impl
// exists. Covers phase 3:
//   TsLsExtractor    headless transport driven against REAL scratch TS
//                    projects using the repo's own typescript (5.9.3),
//                    symlinked into scratch node_modules / injected via
//                    opts.ts. All six primitives, plus lifecycle: start
//                    version honesty (named rejection with no typescript),
//                    openDocument/applyEdit overlays, dispose bounded.
//   TsCommandExtractor  product transport tested headlessly with a FAKE
//                    runner: dispatch on command id, vscode-shaped fixtures
//                    (completion items with string and object labels, hover
//                    MarkdownString fences, Location AND LocationLink,
//                    auto-import code actions), degrade shapes.
// Locked scope pins: example() always undefined for TS; untyped-JS darkness
// (completeMembers [] on an inferred-any receiver); never throws out of a
// primitive.
// Never read src/**. Expected RED: TsLsExtractor/TsCommandExtractor do not
// exist yet. The guard below keeps the red informative: one failing surface
// test, the rest skip; once the impl lands everything runs.
//
// Run: SKIP_LIVE=1 node --test test/blind-v9-extractor.test.cjs
// (No model/network involvement here: "live" gating never applies, the real
// typescript language service is a local, hermetic dependency.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { bundleCore, sleep } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v9-extractor",
    `export { TsLsExtractor } from "../src/core/tsLsExtractor";\n` +
      `export { TsCommandExtractor } from "../src/vscode/tsExtractor";\n`
  ));
} catch (e) {
  bundleError = e;
  // bundleCore writes its entry file before building; a failed build throws
  // before returning its cleanup, so sweep the leftovers ourselves.
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-v9-extractor.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v9-extractor.bundle.cjs"), { force: true });
  };
}
if (!bundleError && typeof mod.TsLsExtractor !== "function") {
  bundleError = new Error("the bundle built but exports no TsLsExtractor class");
}
if (!bundleError && typeof mod.TsCommandExtractor !== "function") {
  bundleError = new Error("the bundle built but exports no TsCommandExtractor class");
}

const { TsLsExtractor, TsCommandExtractor } = mod;

test("bundle: the v9 extractor surface builds (TsLsExtractor + TsCommandExtractor exported) [surface: 'What phase 3 delivers']", () => {
  if (bundleError) {
    assert.fail(`the surface is not implemented yet: ${bundleError.message}`);
  }
});

// Every other test skips (not fails) while the bundle is broken, so the red
// run stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Position helpers. Coordinates: 0-based line, UTF-16 code-unit column
// [surface: 'The interface being implemented']. Positions are computed from
// the fixture text, never hand-counted.
// ---------------------------------------------------------------------------

// Start position of the nth occurrence of a single-line needle.
const posOf = (text, needle, nth = 0) => {
  let idx = -1;
  for (let i = 0; i <= nth; i++) {
    idx = text.indexOf(needle, idx + 1);
    assert.ok(idx >= 0, `fixture needle not found (occurrence ${i}): ${JSON.stringify(needle)}`);
  }
  const before = text.slice(0, idx);
  const line = (before.match(/\n/g) || []).length;
  const character = idx - (before.lastIndexOf("\n") + 1);
  return { line, character };
};

// Position immediately AFTER the needle (e.g. after a trailing dot).
const posAfter = (text, needle, nth = 0) => {
  const p = posOf(text, needle, nth);
  return { line: p.line, character: p.character + needle.length };
};

// A cursor a step INSIDE an identifier (still on it, never on its edge).
const onIdent = (uri, text, needle, nth = 0) => {
  const p = posOf(text, needle, nth);
  return { uri, line: p.line, character: p.character + 1 };
};

const cursorAt = (uri, p) => ({ uri, line: p.line, character: p.character });

// The text a DefinitionLocation range covers, sliced from the file content.
const sliceRange = (text, r) => {
  const lines = text.split("\n");
  if (r.startLine === r.endLine) return lines[r.startLine].slice(r.startCharacter, r.endCharacter);
  const parts = [lines[r.startLine].slice(r.startCharacter)];
  for (let l = r.startLine + 1; l < r.endLine; l++) parts.push(lines[l]);
  parts.push(lines[r.endLine].slice(0, r.endCharacter));
  return parts.join("\n");
};

const byName = (members, name) => members.find((m) => m.name === name);
const names = (members) => members.map((m) => m.name);

// ---------------------------------------------------------------------------
// Scratch fixture projects, built at run time under a mkdtemp root
// [surface: 'Fixtures the blind tests should build']. The repo's own
// typescript (node_modules/typescript, 5.9.3) is symlinked into the typed
// project; the untyped project gets it via opts.ts instead.
// ---------------------------------------------------------------------------

const REPO_TS_DIR = path.join(__dirname, "..", "node_modules", "typescript");

const STORE_TS = `/** A theme store. */
export class ThemeStore {
  theme: string = "light";
  private secret: number = 1;
  protected inner: number = 2;
  get isDark(): boolean {
    return this.theme === "dark";
  }
  /** Sets the current theme. */
  setTheme(theme: string): void {
    this.theme = theme;
  }
}

export class NightStore extends ThemeStore {
  /** Flips between light and dark. */
  toggle(): void {
    this.setTheme(this.isDark ? "light" : "dark");
  }
}
`;

const UTIL_TS = `/** Adds two numbers. */
export function sum(a: number, b: number): number {
  return a + b;
}
`;

const SHAPES_TS = `export interface Base {
  id: string;
}

export interface Widget extends Base {
  /** Human-readable name. */
  name: string;
  render(depth: number): string;
}
`;

const APP_TS = `import { ThemeStore, NightStore } from "./store";
import * as util from "./util";
import { greet, DepWidget } from "dep-pkg";

export const store = new ThemeStore();
export const night = new NightStore();
export const current = store.theme;
export const flipped = night.isDark;
export const added = util.sum(1, 2);
export const greeting = greet("column");
export const widget: DepWidget = {
  id: "w1",
  spin() {
    return;
  },
};
export const widgetId = widget.id;
store.setTheme("dark");
`;

const CARD_TSX = `export interface CardProps {
  title: string;
  count: number;
  onSelect(id: string): void;
}

export function Card(props: CardProps) {
  const heading = props.title;
  return <section title={heading}>{props.count}</section>;
}
`;

// qualifyImport shapes: one sole provider, one two-provider ambiguity.
const SOLEPROVIDER_TS = `export const soleExport: number = 42;\n`;
const NEEDSIMPORT_TS = `export const one = 1;\nexport const useSole = soleExport + one;\n`;
const DUAL_A_TS = `export const dualExport = "a";\n`;
const DUAL_B_TS = `export const dualExport = "b";\n`;
const NEEDSDUAL_TS = `export const useDual = dualExport;\n`;

// Overlay target: on disk, then openDocument/applyEdit replace it in memory.
const LIVE_TS = `import { ThemeStore } from "./store";\n\nexport const live = new ThemeStore();\nexport const marker = 1;\n`;
const LIVE_OVERLAY = `import { ThemeStore } from "./store";\n\nexport const live = new ThemeStore();\nexport const flagged: boolean = true;\n`;
const LIVE_EDITED = `import { ThemeStore } from "./store";\n\nexport const live = new ThemeStore();\nexport const renamed: string = "x";\n`;

const DEP_DTS = `/** Greets a name. */
export declare function greet(who: string): string;

export interface DepWidget {
  id: string;
  spin(): void;
}
`;

const MAIN_JS = `function show(item) {
  return item.length;
}

module.exports = { show };
`;

const writeTree = (root, files) => {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
};

let fx;
const fixtures = () => {
  if (fx) return fx;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v9-extractor-"));

  // Typed project: real tsconfig, real sources, a hand-made node_modules dep,
  // and the repo's typescript symlinked in (version honesty resolution path).
  const typed = path.join(root, "typed");
  writeTree(typed, {
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "es2020",
          module: "commonjs",
          moduleResolution: "node",
          jsx: "preserve",
          noEmit: true,
        },
        include: ["src"],
      },
      null,
      2
    ),
    "src/store.ts": STORE_TS,
    "src/util.ts": UTIL_TS,
    "src/shapes.ts": SHAPES_TS,
    "src/app.ts": APP_TS,
    "src/card.tsx": CARD_TSX,
    "src/soleprovider.ts": SOLEPROVIDER_TS,
    "src/needsimport.ts": NEEDSIMPORT_TS,
    "src/dualA.ts": DUAL_A_TS,
    "src/dualB.ts": DUAL_B_TS,
    "src/needsdual.ts": NEEDSDUAL_TS,
    "src/live.ts": LIVE_TS,
    "node_modules/dep-pkg/package.json": JSON.stringify(
      { name: "dep-pkg", version: "1.0.0", main: "index.js", types: "index.d.ts" },
      null,
      2
    ),
    "node_modules/dep-pkg/index.d.ts": DEP_DTS,
    "node_modules/dep-pkg/index.js": `exports.greet = (who) => "hi " + who;\n`,
  });
  fs.symlinkSync(REPO_TS_DIR, path.join(typed, "node_modules", "typescript"), "dir");

  // Plain untyped JS project: no checkJs, no JSDoc types. typescript is NOT
  // installed here; opts.ts injects the repo's module instead.
  const untyped = path.join(root, "untyped");
  writeTree(untyped, {
    "tsconfig.json": JSON.stringify(
      { compilerOptions: { allowJs: true, noEmit: true }, include: ["src"] },
      null,
      2
    ),
    "src/main.js": MAIN_JS,
  });

  // Fresh clone shape: tsconfig, no typescript anywhere up the walk.
  const bare = path.join(root, "bare");
  writeTree(bare, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }, null, 2),
    "src/lone.ts": "export const lone = 1;\n",
  });

  fx = { root, typed, untyped, bare };
  return fx;
};

const typedUri = (rel) => pathToFileURL(path.join(fixtures().typed, ...rel.split("/"))).href;

// Shared extractor over the typed project: started once, resolution via the
// SYMLINKED node_modules/typescript (no opts.ts) - the walk-up honesty path.
let typedExP;
let typedDisposed = false;
const typedEx = () =>
  (typedExP ||= (async () => {
    const ex = await TsLsExtractor.start({ projectRoot: fixtures().typed });
    await ex.whenReady();
    return ex;
  })());

// Untyped-project extractor: typescript injected via opts.ts (the other
// sanctioned path; the scratch project has no node_modules at all).
let untypedExP;
const untypedEx = () =>
  (untypedExP ||= (async () => {
    const ex = await TsLsExtractor.start({ projectRoot: fixtures().untyped, ts: require(REPO_TS_DIR) });
    await ex.whenReady();
    return ex;
  })());

test.after(async () => {
  try {
    if (typedExP && !typedDisposed) (await typedExP).dispose();
  } catch {}
  try {
    if (untypedExP) (await untypedExP).dispose();
  } catch {}
  if (fx) fs.rmSync(fx.root, { recursive: true, force: true });
  cleanup();
});

// ===========================================================================
// TsLsExtractor: construction and lifecycle. [surface: 'Construction and
// lifecycle' - 'TsLsExtractor (headless)']
// ===========================================================================

gtest("headless start: resolves over the project's symlinked typescript, carries the six primitives + lifecycle methods [surface: 'TsLsExtractor (headless)']", async () => {
  const ex = await typedEx();
  for (const m of ["completeMembers", "hoverSurface", "definition", "example", "qualifyImport", "membersOfType"]) {
    assert.strictEqual(typeof ex[m], "function", `SurfaceExtractor primitive: ${m}`);
  }
  for (const m of ["openDocument", "applyEdit", "whenReady", "dispose"]) {
    assert.strictEqual(typeof ex[m], "function", `lifecycle method: ${m}`);
  }
});

gtest("headless start: no resolvable typescript and none injected REJECTS with a named error, never a bundled fallback [surface: 'TsLsExtractor' 'start REJECTS with a named error']", async () => {
  await assert.rejects(
    TsLsExtractor.start({ projectRoot: fixtures().bare }),
    (e) => {
      assert.ok(e instanceof Error, "the rejection is an Error");
      assert.ok(typeof e.name === "string" && e.name.length > 0, "the error is named");
      assert.ok(
        e.name !== "Error" || /typescript/i.test(String(e.message)),
        `a NAMED error (custom name, or at least a message naming typescript), got name=${e.name} message=${e.message}`
      );
      return true;
    }
  );
});

// ===========================================================================
// TsLsExtractor: completeMembers. [surface: '1. completeMembers']
// ===========================================================================

gtest("headless completeMembers: kinds, TS-shaped signatures, visibility filtering at a '.' site [surface: 'completeMembers' kinds/signature/visibility]", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/app.ts");
  const members = await ex.completeMembers(cursorAt(uri, posAfter(APP_TS, "store.")));
  assert.ok(Array.isArray(members), "completeMembers resolves an array");

  const setTheme = byName(members, "setTheme");
  assert.ok(setTheme, `setTheme is offered, got ${JSON.stringify(names(members))}`);
  assert.strictEqual(setTheme.kind, "method", "a class method is kind 'method'");
  assert.ok(
    typeof setTheme.signature === "string" && setTheme.signature.includes("setTheme(theme: string): void"),
    `method signature carries name(param: Type): Ret, got ${JSON.stringify(setTheme.signature)}`
  );

  const theme = byName(members, "theme");
  assert.ok(theme, "the typed property is offered");
  assert.strictEqual(theme.kind, "field", "a typed property is kind 'field'");
  assert.ok(
    typeof theme.signature === "string" && theme.signature.includes("theme: string"),
    `property signature carries name: Type, got ${JSON.stringify(theme.signature)}`
  );

  const isDark = byName(members, "isDark");
  assert.ok(isDark, "the getter is offered");
  assert.strictEqual(isDark.kind, "field", "a getter is kind 'field'");
  assert.ok(
    typeof isDark.signature === "string" && isDark.signature.includes("isDark: boolean"),
    `getter signature carries the property type, got ${JSON.stringify(isDark.signature)}`
  );

  assert.strictEqual(byName(members, "secret"), undefined, "private member invisible outside the class");
  assert.strictEqual(byName(members, "inner"), undefined, "protected member invisible outside the class");
  for (const m of members) {
    assert.strictEqual(m.viaTrait, undefined, `viaTrait is never set for TS (member ${m.name})`);
  }
});

gtest("headless completeMembers: inherited members appear at a derived-class '.' site [surface: 'completeMembers' 'Inherited members ARE in the set']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/app.ts");
  const members = await ex.completeMembers(cursorAt(uri, posAfter(APP_TS, "night.")));
  const got = names(members);
  assert.ok(byName(members, "toggle"), `the derived class's own method appears, got ${JSON.stringify(got)}`);
  assert.strictEqual(byName(members, "toggle").kind, "method");
  for (const inherited of ["theme", "isDark", "setTheme"]) {
    assert.ok(byName(members, inherited), `base member ${inherited} is inherited into the set, got ${JSON.stringify(got)}`);
  }
  assert.strictEqual(byName(members, "secret"), undefined, "base private stays out");
  assert.strictEqual(byName(members, "inner"), undefined, "base protected stays out");
});

gtest("headless completeMembers: a function member is kind 'function' (namespace-import '.' site) [surface: 'completeMembers' 'functions -> function']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/app.ts");
  const members = await ex.completeMembers(cursorAt(uri, posAfter(APP_TS, "util.")));
  const sum = byName(members, "sum");
  assert.ok(sum, `sum is offered, got ${JSON.stringify(names(members))}`);
  assert.strictEqual(sum.kind, "function");
  assert.ok(
    typeof sum.signature === "string" && sum.signature.includes("sum(a: number, b: number): number"),
    `function signature carries name(params): Ret, got ${JSON.stringify(sum.signature)}`
  );
});

gtest("headless completeMembers: a hand-made node_modules dependency's .d.ts members complete [surface: 'Fixtures' 'its members complete']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/app.ts");
  const members = await ex.completeMembers(cursorAt(uri, posAfter(APP_TS, "widget.")));
  const id = byName(members, "id");
  const spin = byName(members, "spin");
  assert.ok(id, `dep interface field completes, got ${JSON.stringify(names(members))}`);
  assert.strictEqual(id.kind, "field");
  assert.ok(spin, "dep interface method completes");
  assert.strictEqual(spin.kind, "method");
});

gtest("headless completeMembers: .tsx props complete (typescriptreact path) [surface: 'Fixtures' 'a .tsx component file']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/card.tsx");
  const members = await ex.completeMembers(cursorAt(uri, posAfter(CARD_TSX, "props.")));
  const got = names(members);
  for (const want of ["title", "count", "onSelect"]) {
    assert.ok(byName(members, want), `CardProps member ${want} completes in the tsx file, got ${JSON.stringify(got)}`);
  }
  assert.strictEqual(byName(members, "onSelect").kind, "method");
});

gtest("headless completeMembers: untyped-JS darkness - an inferred-any receiver resolves [] [surface: 'Typed-only honesty' + 'completeMembers' degrade]", async () => {
  const ex = await untypedEx();
  const uri = pathToFileURL(path.join(fixtures().untyped, "src", "main.js")).href;
  const members = await ex.completeMembers(cursorAt(uri, posAfter(MAIN_JS, "item.")));
  assert.deepStrictEqual(members, [], "no checkJs, no JSDoc: member surfaces come back EMPTY - no guessing, no fabricated members");
});

// ===========================================================================
// TsLsExtractor: hoverSurface. [surface: '2. hoverSurface']
// ===========================================================================

gtest("headless hoverSurface: signature + doc; example ALWAYS undefined [surface: 'hoverSurface' + 'Signatures-only injection']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/app.ts");
  const h = await ex.hoverSurface(onIdent(uri, APP_TS, "setTheme"));
  assert.ok(h, "a documented method hover resolves a surface");
  assert.ok(typeof h.signature === "string" && h.signature.length > 0, "signature is the quickinfo text");
  assert.ok(h.signature.includes("setTheme"), `the signature contains the symbol's name, got ${JSON.stringify(h.signature)}`);
  assert.ok(h.signature.includes("void"), `the signature contains the type shape, got ${JSON.stringify(h.signature)}`);
  assert.ok(typeof h.doc === "string" && h.doc.includes("Sets the current theme"), `doc carries the JSDoc text, got ${JSON.stringify(h.doc)}`);
  assert.strictEqual(h.example, undefined, "example is ALWAYS undefined for TS (signatures-only)");
});

gtest("headless hoverSurface: no symbol at the cursor degrades to undefined [surface: 'hoverSurface' degrade]", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/app.ts");
  // Line 3 of app.ts is blank (between the imports and the consts).
  assert.strictEqual(await ex.hoverSurface({ uri, line: 3, character: 0 }), undefined);
});

// ===========================================================================
// TsLsExtractor: definition. [surface: '3. definition']
// ===========================================================================

gtest("headless definition: the NAME span of the declaration, not the body or doc comment [surface: 'definition' 'range is the NAME span']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/app.ts");
  const def = await ex.definition(onIdent(uri, APP_TS, "setTheme"));
  assert.ok(def, "a resolvable usage yields a location");
  assert.ok(def.uri.startsWith("file://"), `uri is a file:// URI string, got ${JSON.stringify(def.uri)}`);
  assert.ok(
    fileURLToPath(def.uri).endsWith(path.join("src", "store.ts")),
    `the declaration lives in store.ts, got ${def.uri}`
  );
  assert.strictEqual(sliceRange(STORE_TS, def.range), "setTheme", "the range covers exactly the declared identifier");
});

gtest("headless definition: a dependency symbol resolves INTO the package's .d.ts under node_modules [surface: 'definition' 'Cross-package']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/app.ts");
  const def = await ex.definition(onIdent(uri, APP_TS, `greet("column")`));
  assert.ok(def, "the dep symbol resolves");
  const p = fileURLToPath(def.uri);
  assert.ok(p.includes(path.join("node_modules", "dep-pkg")), `definition lands inside the dep package, got ${p}`);
  assert.ok(p.endsWith(".d.ts"), `definition lands in the .d.ts, got ${p}`);
  assert.strictEqual(sliceRange(DEP_DTS, def.range), "greet", "the range is the declared name span in the .d.ts");
});

gtest("headless definition: unresolvable degrades to undefined [surface: 'definition' degrade]", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/app.ts");
  assert.strictEqual(await ex.definition({ uri, line: 3, character: 0 }), undefined);
});

// ===========================================================================
// TsLsExtractor: example - always dark. [surface: '4. example']
// ===========================================================================

gtest("headless example: ALWAYS undefined, prefer ignored, even on a documented symbol with members [surface: 'example - always dark for TS']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/app.ts");
  const cur = onIdent(uri, APP_TS, "setTheme");
  assert.strictEqual(await ex.example(cur), undefined, "no prefer: undefined");
  assert.strictEqual(await ex.example(cur, "doc"), undefined, "prefer is ignored: still undefined");
  assert.strictEqual(await ex.example(onIdent(uri, APP_TS, `greet("column")`), "any"), undefined, "dep symbol too");
});

// ===========================================================================
// TsLsExtractor: qualifyImport. [surface: '5. qualifyImport']
// ===========================================================================

gtest("headless qualifyImport: a single-provider unresolved name yields ONE same-file edit [surface: 'qualifyImport' 'a SINGLE text edit in the SAME file']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/needsimport.ts");
  const edit = await ex.qualifyImport(onIdent(uri, NEEDSIMPORT_TS, "soleExport"));
  assert.ok(edit, "one provider: the fix is deterministic, so it is reported");
  assert.ok(typeof edit.newText === "string" && edit.newText.includes("soleExport"), `the edit imports the name, got ${JSON.stringify(edit.newText)}`);
  assert.ok(edit.newText.includes("soleprovider"), `the edit names the providing module, got ${JSON.stringify(edit.newText)}`);
  for (const k of ["startLine", "startCharacter", "endLine", "endCharacter"]) {
    assert.strictEqual(typeof edit.range[k], "number", `range.${k} is a number`);
  }
  const identLine = posOf(NEEDSIMPORT_TS, "soleExport").line;
  assert.ok(edit.range.startLine <= identLine, "the edit applies at/above the identifier (top-of-file import position)");
});

gtest("headless qualifyImport: two providers is ambiguous - undefined [surface: 'qualifyImport' 'Deterministic means UNAMBIGUOUS']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/needsdual.ts");
  assert.strictEqual(
    await ex.qualifyImport(onIdent(uri, NEEDSDUAL_TS, "dualExport")),
    undefined,
    "dualA and dualB both export the name: never pick one"
  );
});

gtest("headless qualifyImport: a name that already resolves is undefined [surface: 'qualifyImport' 'A name that already resolves']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/app.ts");
  assert.strictEqual(await ex.qualifyImport(onIdent(uri, APP_TS, `greet("column")`)), undefined, "already imported: no fix to report");
});

// ===========================================================================
// TsLsExtractor: membersOfType. [surface: '6. membersOfType']
// ===========================================================================

gtest("headless membersOfType: definition() roundtrip into a class - public members, getter-as-field, private/protected excluded [surface: 'membersOfType' + 'the location definition() returns']", async () => {
  const ex = await typedEx();
  const appUri = typedUri("src/app.ts");
  const def = await ex.definition(onIdent(appUri, APP_TS, "ThemeStore()"));
  assert.ok(def, "the type name resolves to its declaration");
  assert.strictEqual(sliceRange(STORE_TS, def.range), "ThemeStore");

  const members = await ex.membersOfType({ uri: def.uri, line: def.range.startLine, character: def.range.startCharacter });
  const got = names(members);
  const setTheme = byName(members, "setTheme");
  assert.ok(setTheme, `setTheme in the type's member set, got ${JSON.stringify(got)}`);
  assert.strictEqual(setTheme.kind, "method");
  const isDark = byName(members, "isDark");
  assert.ok(isDark, "the getter is a member");
  assert.strictEqual(isDark.kind, "field", "getters count as 'field' members");
  assert.ok(
    typeof isDark.signature === "string" && isDark.signature.includes("isDark: boolean"),
    `getter carries its property type, got ${JSON.stringify(isDark.signature)}`
  );
  assert.ok(byName(members, "theme"), "the typed property is a member");
  assert.strictEqual(byName(members, "secret"), undefined, "private is EXCLUDED");
  assert.strictEqual(byName(members, "inner"), undefined, "protected is EXCLUDED");
});

gtest("headless membersOfType: interface extends chain - inherited members included [surface: 'membersOfType' 'inherited members (extends chains) are included']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/shapes.ts");
  const members = await ex.membersOfType(onIdent(uri, SHAPES_TS, "Widget"));
  const got = names(members);
  assert.ok(byName(members, "name"), `own member 'name', got ${JSON.stringify(got)}`);
  assert.ok(byName(members, "render"), "own method 'render'");
  assert.strictEqual(byName(members, "render").kind, "method");
  assert.ok(byName(members, "id"), "member inherited from Base via extends");
  assert.strictEqual(byName(members, "id").kind, "field");
});

gtest("headless membersOfType: a class extends chain inherits too [surface: 'membersOfType' 'inherited members ... included']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/store.ts");
  const members = await ex.membersOfType(onIdent(uri, STORE_TS, "NightStore"));
  assert.ok(byName(members, "toggle"), "own method");
  assert.ok(byName(members, "setTheme"), "inherited base method");
  assert.ok(byName(members, "isDark"), "inherited base getter");
  assert.strictEqual(byName(members, "secret"), undefined, "inherited private stays excluded");
});

gtest("headless membersOfType: outside a type declaration resolves [] [surface: 'membersOfType' degrade 'cursor not within a type declaration']", async () => {
  const ex = await typedEx();
  assert.deepStrictEqual(
    await ex.membersOfType(onIdent(typedUri("src/util.ts"), UTIL_TS, "sum")),
    [],
    "a function declaration is not a type declaration"
  );
  assert.deepStrictEqual(
    await ex.membersOfType({ uri: typedUri("src/app.ts"), line: 3, character: 0 }),
    [],
    "a blank line is not a type declaration"
  );
});

// ===========================================================================
// TsLsExtractor: degradation shapes + overlays + dispose bounds.
// [surface: 'Degradation contract' + 'Construction and lifecycle']
// ===========================================================================

gtest("headless degradation: every primitive at a dead cursor resolves its empty shape, never throws [surface: 'Degradation contract']", async () => {
  const ex = await typedEx();
  const dead = { uri: typedUri("src/app.ts"), line: 3, character: 0 };
  assert.deepStrictEqual(await ex.completeMembers(dead), [], "completeMembers -> []");
  assert.deepStrictEqual(await ex.membersOfType(dead), [], "membersOfType -> []");
  assert.strictEqual(await ex.hoverSurface(dead), undefined, "hoverSurface -> undefined");
  assert.strictEqual(await ex.definition(dead), undefined, "definition -> undefined");
  assert.strictEqual(await ex.example(dead), undefined, "example -> undefined");
  assert.strictEqual(await ex.qualifyImport(dead), undefined, "qualifyImport -> undefined");
});

gtest("headless overlays: openDocument makes buffer content visible to queries; applyEdit replaces it [surface: 'TsLsExtractor' 'openDocument overlays buffer content over the disk state']", async () => {
  const ex = await typedEx();
  const uri = typedUri("src/live.ts");

  // Disk state first: the overlay target is a real file.
  const before = await ex.hoverSurface(onIdent(uri, LIVE_TS, "marker"));
  assert.ok(before && before.signature.includes("marker"), "the disk file is visible WITHOUT openDocument");

  ex.openDocument(uri, LIVE_OVERLAY);
  const overlaid = await ex.hoverSurface(onIdent(uri, LIVE_OVERLAY, "flagged"));
  assert.ok(overlaid, "the overlay symbol resolves");
  assert.ok(overlaid.signature.includes("flagged"), `the overlay text won over the disk text, got ${JSON.stringify(overlaid.signature)}`);
  assert.ok(overlaid.signature.includes("boolean"), "the overlay's type shape is live");

  ex.applyEdit(uri, LIVE_EDITED);
  const edited = await ex.hoverSurface(onIdent(uri, LIVE_EDITED, "renamed"));
  assert.ok(edited && edited.signature.includes("renamed"), "applyEdit replaced the overlay content");
  assert.ok(edited.signature.includes("string"), "the edited type shape is live");
});

// ---------------------------------------------------------------------------
// (dispose-bounds test lives at the end of the file: it kills the shared
// typed-project extractor, so it must run after every other headless test.)
// ---------------------------------------------------------------------------

// ===========================================================================
// TsCommandExtractor: product transport with a FAKE runner. No vscode, no
// TS server: dispatch on the command id, answer vscode-shaped fixtures.
// [surface: 'TsCommandExtractor (product)']
// ===========================================================================

const CMD = {
  complete: "vscode.executeCompletionItemProvider",
  hover: "vscode.executeHoverProvider",
  definition: "vscode.executeDefinitionProvider",
  codeAction: "vscode.executeCodeActionProvider",
  docSymbol: "vscode.executeDocumentSymbolProvider",
};

const FAKE_URI = "file:///fake/src/app.ts";
const FAKE_CUR = { uri: FAKE_URI, line: 6, character: 28 };

// A vscode.Uri stand-in: the command API answers Uri objects, not strings.
const uriLike = (u) => ({
  scheme: "file",
  fsPath: fileURLToPath(u),
  toString: () => u,
});

// A vscode Range stand-in.
const vr = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });

// A vscode WorkspaceEdit stand-in: entries() -> [ [Uri, TextEdit[]], ... ].
const wsEdit = (entries) => ({ entries: () => entries });

// A vscode DocumentSymbol stand-in.
const dsym = (name, kind, range, children = [], detail = "") => ({
  name,
  detail,
  kind,
  range,
  selectionRange: vr(range.start.line, range.start.character, range.start.line, range.start.character + name.length),
  children,
});

// Fake runner: per-command handlers, calls recorded.
const runnerFor = (handlers) => {
  const calls = [];
  const run = async (command, cursor, opts) => {
    calls.push({ command, cursor, opts });
    const h = handlers[command];
    if (h === undefined) return undefined;
    return typeof h === "function" ? h(cursor, opts) : h;
  };
  return { run, calls };
};

// ---------------------------------------------------------------------------
// completeMembers over executeCompletionItemProvider.
// ---------------------------------------------------------------------------

gtest("product completeMembers: string + object labels, CompletionItemKind mapping, keyword/snippet/text never members [surface: 'TsCommandExtractor' completion-items bullet]", async () => {
  const list = {
    isIncomplete: false,
    items: [
      { label: "setTheme", kind: 1, detail: "(method) ThemeStore.setTheme(theme: string): void" }, // Method=1
      { label: { label: "isDark", description: "ThemeStore" }, kind: 9, detail: "(property) ThemeStore.isDark: boolean" }, // Property=9, object label
      { label: "theme", kind: 4, detail: "(property) ThemeStore.theme: string" }, // Field=4
      { label: "sum", kind: 2, detail: "function sum(a: number, b: number): number" }, // Function=2
      { label: "lazyBare", kind: 1 }, // detail not resolved: still a member
      { label: "abstract", kind: 13 }, // Keyword=13: never a member
      { label: "log-snippet", kind: 14 }, // Snippet=14: never a member
      { label: "plaintext", kind: 0 }, // Text=0: never a member
    ],
  };
  const { run, calls } = runnerFor({ [CMD.complete]: list });
  const ex = new TsCommandExtractor(run);
  const members = await ex.completeMembers(FAKE_CUR);

  const completeCalls = calls.filter((c) => c.command === CMD.complete);
  assert.ok(completeCalls.length >= 1, "dispatches on vscode.executeCompletionItemProvider");
  assert.deepStrictEqual(
    { uri: completeCalls[0].cursor.uri, line: completeCalls[0].cursor.line, character: completeCalls[0].cursor.character },
    FAKE_CUR,
    "the cursor passes through to the runner"
  );

  const setTheme = byName(members, "setTheme");
  assert.ok(setTheme, `string label becomes the name, got ${JSON.stringify(names(members))}`);
  assert.strictEqual(setTheme.kind, "method", "CompletionItemKind.Method (1) -> 'method'");
  assert.ok(
    typeof setTheme.signature === "string" && setTheme.signature.includes("setTheme(theme: string): void"),
    `the resolved detail feeds the signature, got ${JSON.stringify(setTheme.signature)}`
  );

  const isDark = byName(members, "isDark");
  assert.ok(isDark, "object label { label } becomes the name");
  assert.strictEqual(isDark.kind, "field", "CompletionItemKind.Property (9) -> 'field'");
  assert.ok(isDark.signature.includes("isDark: boolean"), `got ${JSON.stringify(isDark.signature)}`);

  assert.strictEqual(byName(members, "theme").kind, "field", "CompletionItemKind.Field (4) -> 'field'");
  assert.strictEqual(byName(members, "sum").kind, "function", "CompletionItemKind.Function (2) -> 'function'");

  const lazyBare = byName(members, "lazyBare");
  assert.ok(lazyBare, "an item without detail is still a member");
  assert.ok(
    lazyBare.signature === undefined || typeof lazyBare.signature === "string",
    "an unrendered signature may be undefined, never invented"
  );

  for (const never of ["abstract", "log-snippet", "plaintext"]) {
    assert.strictEqual(byName(members, never), undefined, `${never} (keyword/snippet/text) is never a member`);
  }
  for (const m of members) {
    assert.strictEqual(m.viaTrait, undefined, `viaTrait never set for TS (member ${m.name})`);
  }
});

// ---------------------------------------------------------------------------
// hoverSurface over executeHoverProvider.
// ---------------------------------------------------------------------------

gtest("product hoverSurface: the ```typescript fence carries the signature, prose below is doc, example undefined [surface: 'TsCommandExtractor' hover bullet]", async () => {
  const value =
    "```typescript\n(method) ThemeStore.setTheme(theme: string): void\n```\nSets the current theme.\n";
  const { run, calls } = runnerFor({ [CMD.hover]: [{ contents: [{ value }] }] });
  const ex = new TsCommandExtractor(run);
  const h = await ex.hoverSurface(FAKE_CUR);
  assert.ok(calls.some((c) => c.command === CMD.hover), "dispatches on vscode.executeHoverProvider");
  assert.ok(h, "a hover with a quickinfo fence resolves a surface");
  assert.strictEqual(h.signature, "(method) ThemeStore.setTheme(theme: string): void", "the fence body, verbatim");
  assert.ok(typeof h.doc === "string" && h.doc.includes("Sets the current theme."), `prose below the fence is doc, got ${JSON.stringify(h.doc)}`);
  assert.strictEqual(h.example, undefined, "example is ALWAYS undefined for TS");
});

gtest("product hoverSurface: fence-only hover has no doc; empty/undefined hover degrades to undefined [surface: hover bullet + 'Degrade']", async () => {
  const fenceOnly = "```typescript\nconst total: number\n```\n";
  {
    const { run } = runnerFor({ [CMD.hover]: [{ contents: [{ value: fenceOnly }] }] });
    const h = await new TsCommandExtractor(run).hoverSurface(FAKE_CUR);
    assert.ok(h, "signature-only hover still resolves");
    assert.strictEqual(h.signature, "const total: number");
    assert.strictEqual(h.doc, undefined, "no prose: doc is absent");
  }
  {
    const { run } = runnerFor({ [CMD.hover]: [] });
    assert.strictEqual(await new TsCommandExtractor(run).hoverSurface(FAKE_CUR), undefined, "no hovers -> undefined");
  }
  {
    const { run } = runnerFor({});
    assert.strictEqual(await new TsCommandExtractor(run).hoverSurface(FAKE_CUR), undefined, "runner resolves undefined -> undefined");
  }
});

// ---------------------------------------------------------------------------
// definition over executeDefinitionProvider: Location AND LocationLink.
// ---------------------------------------------------------------------------

gtest("product definition: a plain Location maps to the DefinitionLocation shape [surface: 'TsCommandExtractor' definition bullet]", async () => {
  const target = "file:///fake/node_modules/dep-pkg/index.d.ts";
  const { run, calls } = runnerFor({
    [CMD.definition]: [{ uri: uriLike(target), range: vr(1, 24, 1, 29) }],
  });
  const ex = new TsCommandExtractor(run);
  const def = await ex.definition(FAKE_CUR);
  assert.ok(calls.some((c) => c.command === CMD.definition), "dispatches on vscode.executeDefinitionProvider");
  assert.ok(def, "a Location answer resolves");
  assert.strictEqual(def.uri, target, "the Uri round-trips to the file:// string");
  assert.deepStrictEqual(def.range, { startLine: 1, startCharacter: 24, endLine: 1, endCharacter: 29 });
});

gtest("product definition: a LocationLink prefers the SELECTION range over the full range [surface: definition bullet 'landing on a doc comment ... is a known failure']", async () => {
  const target = "file:///fake/src/store.ts";
  const { run } = runnerFor({
    [CMD.definition]: [
      {
        targetUri: uriLike(target),
        targetRange: vr(0, 0, 12, 1), // whole declaration incl. the doc comment
        targetSelectionRange: vr(1, 13, 1, 23), // the identifier
      },
    ],
  });
  const def = await new TsCommandExtractor(run).definition(FAKE_CUR);
  assert.ok(def, "a LocationLink answer resolves");
  assert.strictEqual(def.uri, target);
  assert.deepStrictEqual(
    def.range,
    { startLine: 1, startCharacter: 13, endLine: 1, endCharacter: 23 },
    "the selection range (the name), never the full range"
  );
  assert.notStrictEqual(def.range.startLine, 0, "landing on the doc comment is the failure this avoids");
});

gtest("product definition: no locations degrades to undefined [surface: 'Degrade' row]", async () => {
  const { run } = runnerFor({ [CMD.definition]: [] });
  assert.strictEqual(await new TsCommandExtractor(run).definition(FAKE_CUR), undefined);
});

// ---------------------------------------------------------------------------
// qualifyImport over executeCodeActionProvider.
// ---------------------------------------------------------------------------

const NEEDS_URI = "file:///fake/src/needsimport.ts";
const NEEDS_CUR = { uri: NEEDS_URI, line: 1, character: 25 };
const NEEDS_TEXT = NEEDSIMPORT_TS;
const readNeeds = (uri) => (uri === NEEDS_URI ? NEEDS_TEXT : undefined);

const importEdit = { range: vr(0, 0, 0, 0), newText: 'import { soleExport } from "./soleprovider";\n' };

gtest("product qualifyImport: the Add-import action's single-file single edit becomes the QualifyEdit [surface: 'TsCommandExtractor' code-actions bullet]", async () => {
  const { run, calls } = runnerFor({
    [CMD.codeAction]: [
      { title: "Extract to constant in enclosing scope", edit: wsEdit([[uriLike(NEEDS_URI), [{ range: vr(1, 0, 1, 40), newText: "x" }]]]) },
      { title: 'Add import from "./soleprovider"', edit: wsEdit([[uriLike(NEEDS_URI), [importEdit]]]) },
    ],
  });
  const ex = new TsCommandExtractor(run, readNeeds);
  const edit = await ex.qualifyImport(NEEDS_CUR);
  assert.ok(calls.some((c) => c.command === CMD.codeAction), "dispatches on vscode.executeCodeActionProvider");
  assert.ok(edit, "the auto-import fix is matched by title");
  assert.strictEqual(edit.newText, importEdit.newText, "the text edit passes through verbatim");
  assert.deepStrictEqual(edit.range, { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 });
});

gtest("product qualifyImport: the Update-import title shape is matched too [surface: code-actions bullet 'Add import from \"x\" / Update import from \"x\" shapes']", async () => {
  const upd = { range: vr(0, 9, 0, 21), newText: "{ ThemeStore, NightStore }" };
  const { run } = runnerFor({
    [CMD.codeAction]: [{ title: 'Update import from "./store"', edit: wsEdit([[uriLike(NEEDS_URI), [upd]]]) }],
  });
  const edit = await new TsCommandExtractor(run, readNeeds).qualifyImport(NEEDS_CUR);
  assert.ok(edit, "augmenting an existing import is the other accepted shape");
  assert.strictEqual(edit.newText, upd.newText);
  assert.deepStrictEqual(edit.range, { startLine: 0, startCharacter: 9, endLine: 0, endCharacter: 21 });
});

gtest("product qualifyImport: multi-file, multi-edit, and multi-candidate answers are all undefined [surface: 'single edit' rule + 'Deterministic means UNAMBIGUOUS']", async () => {
  const cases = [
    {
      why: "an edit touching TWO files is refused",
      actions: [
        {
          title: 'Add import from "./soleprovider"',
          edit: wsEdit([
            [uriLike(NEEDS_URI), [importEdit]],
            [uriLike("file:///fake/src/other.ts"), [{ range: vr(0, 0, 0, 0), newText: "export {};\n" }]],
          ]),
        },
      ],
    },
    {
      why: "TWO edits in one file are refused",
      actions: [
        {
          title: 'Add import from "./soleprovider"',
          edit: wsEdit([[uriLike(NEEDS_URI), [importEdit, { range: vr(2, 0, 2, 0), newText: "\n" }]]]),
        },
      ],
    },
    {
      why: "TWO providers (two matching auto-import actions) are ambiguous",
      actions: [
        { title: 'Add import from "./dualA"', edit: wsEdit([[uriLike(NEEDS_URI), [importEdit]]]) },
        { title: 'Add import from "./dualB"', edit: wsEdit([[uriLike(NEEDS_URI), [importEdit]]]) },
      ],
    },
    {
      why: "no auto-import-shaped title at all",
      actions: [{ title: "Convert to template string", edit: wsEdit([[uriLike(NEEDS_URI), [importEdit]]]) }],
    },
    { why: "no actions", actions: [] },
  ];
  for (const c of cases) {
    const { run } = runnerFor({ [CMD.codeAction]: c.actions });
    const ex = new TsCommandExtractor(run, readNeeds);
    assert.strictEqual(await ex.qualifyImport(NEEDS_CUR), undefined, c.why);
  }
});

// ---------------------------------------------------------------------------
// example: no command call, ever.
// ---------------------------------------------------------------------------

gtest("product example: resolves undefined and invokes NO command, prefer ignored [surface: 'example() performs NO command call']", async () => {
  const { run, calls } = runnerFor({
    [CMD.hover]: [{ contents: [{ value: "```typescript\nconst x: number\n```\ndocs" }] }],
  });
  const ex = new TsCommandExtractor(run);
  assert.strictEqual(await ex.example(FAKE_CUR), undefined);
  assert.strictEqual(await ex.example(FAKE_CUR, "doc"), undefined, "prefer is ignored");
  assert.strictEqual(calls.length, 0, "the runner was never invoked");
});

// ---------------------------------------------------------------------------
// membersOfType over executeDocumentSymbolProvider.
// ---------------------------------------------------------------------------

// vscode SymbolKind values: Class=4, Method=5, Property=6, Field=7,
// Interface=10, Function=11, Variable=12.
const STORE_SYMBOLS = [
  dsym("ThemeStore", 4, vr(1, 0, 12, 1), [
    dsym("theme", 7, vr(2, 2, 2, 27)),
    dsym("isDark", 6, vr(5, 2, 7, 3)), // the getter surfaces as a property symbol
    dsym("setTheme", 5, vr(9, 2, 11, 3)),
  ]),
  dsym("Widget", 10, vr(14, 0, 18, 1), [
    dsym("name", 6, vr(16, 2, 16, 14)),
    dsym("render", 5, vr(17, 2, 17, 32)),
  ]),
  dsym("helper", 11, vr(20, 0, 24, 1), [dsym("localTotal", 12, vr(21, 2, 21, 24))]),
];

gtest("product membersOfType: document-symbol descent of the enclosing class - declared members, kinds mapped, getter-as-field [surface: 'membersOfType' product transport]", async () => {
  const { run, calls } = runnerFor({ [CMD.docSymbol]: STORE_SYMBOLS });
  const ex = new TsCommandExtractor(run);
  const members = await ex.membersOfType({ uri: FAKE_URI, line: 1, character: 13 });
  assert.ok(calls.some((c) => c.command === CMD.docSymbol), "dispatches on vscode.executeDocumentSymbolProvider");
  const got = names(members);
  assert.ok(byName(members, "setTheme"), `declared method, got ${JSON.stringify(got)}`);
  assert.strictEqual(byName(members, "setTheme").kind, "method");
  assert.ok(byName(members, "theme"), "declared field");
  assert.strictEqual(byName(members, "theme").kind, "field");
  assert.ok(byName(members, "isDark"), "the getter is a member");
  assert.strictEqual(byName(members, "isDark").kind, "field", "getters count as 'field'");
  assert.strictEqual(byName(members, "name"), undefined, "a sibling type's members never leak in");
});

gtest("product membersOfType: an interface declaration works the same way [surface: 'membersOfType' 'interface, class, enum, or type alias']", async () => {
  const { run } = runnerFor({ [CMD.docSymbol]: STORE_SYMBOLS });
  const members = await new TsCommandExtractor(run).membersOfType({ uri: FAKE_URI, line: 15, character: 4 });
  assert.ok(byName(members, "name"), "interface property");
  assert.strictEqual(byName(members, "name").kind, "field");
  assert.ok(byName(members, "render"), "interface method");
  assert.strictEqual(byName(members, "render").kind, "method");
  assert.strictEqual(byName(members, "setTheme"), undefined, "the class's members never leak in");
});

gtest("product membersOfType: outside any type declaration resolves [] - a function body does not count [surface: 'membersOfType' degrade]", async () => {
  const { run } = runnerFor({ [CMD.docSymbol]: STORE_SYMBOLS });
  const ex = new TsCommandExtractor(run);
  assert.deepStrictEqual(await ex.membersOfType({ uri: FAKE_URI, line: 30, character: 0 }), [], "cursor outside every symbol");
  assert.deepStrictEqual(
    await ex.membersOfType({ uri: FAKE_URI, line: 21, character: 4 }),
    [],
    "inside the helper FUNCTION: not a type declaration, its children are not type members"
  );
});

// ---------------------------------------------------------------------------
// Degradation: a throwing or empty runner is swallowed into the shapes.
// ---------------------------------------------------------------------------

gtest("product degradation: a THROWING runner makes completeMembers REJECT (never a false 'definitively empty'); the other five still swallow [surface: 'Amendment 10' + 'a throwing runner is swallowed']", async () => {
  const boom = async () => {
    throw new Error("ts server gone");
  };
  const ex = new TsCommandExtractor(boom, readNeeds);
  // Amendment 10 (dogfood-day M2): [] is load-bearing for the member-site
  // output gate, so a dead TS server must surface as a rejection, not as
  // definitive emptiness that suppresses real ghosts.
  await assert.rejects(ex.completeMembers(FAKE_CUR), (e) => e instanceof Error, "completeMembers -> the rejection propagates to the consumer");
  assert.deepStrictEqual(await ex.membersOfType(FAKE_CUR), [], "membersOfType -> []");
  assert.strictEqual(await ex.hoverSurface(FAKE_CUR), undefined, "hoverSurface -> undefined");
  assert.strictEqual(await ex.definition(FAKE_CUR), undefined, "definition -> undefined");
  assert.strictEqual(await ex.qualifyImport(NEEDS_CUR), undefined, "qualifyImport -> undefined");
  assert.strictEqual(await ex.example(FAKE_CUR), undefined, "example -> undefined");
});

gtest("product degradation: a runner resolving undefined/empty maps to the return-shape table [surface: 'Degrade: runner resolving undefined/empty arrays']", async () => {
  const { run } = runnerFor({});
  const ex = new TsCommandExtractor(run, readNeeds);
  assert.deepStrictEqual(await ex.completeMembers(FAKE_CUR), []);
  assert.deepStrictEqual(await ex.membersOfType(FAKE_CUR), []);
  assert.strictEqual(await ex.hoverSurface(FAKE_CUR), undefined);
  assert.strictEqual(await ex.definition(FAKE_CUR), undefined);
  assert.strictEqual(await ex.qualifyImport(NEEDS_CUR), undefined);
});

// ===========================================================================
// LAST: dispose bounds on the shared headless extractor. [surface:
// 'TsLsExtractor' 'a primitive on a broken/disposed service degrades to
// []/undefined or rejects fast with a named error - never a hanging promise']
// ===========================================================================

gtest("headless dispose: a primitive after dispose degrades or rejects fast, never hangs [surface: 'Bounded behavior']", async () => {
  const ex = await typedEx();
  ex.dispose();
  typedDisposed = true;
  const call = ex
    .completeMembers(cursorAt(typedUri("src/app.ts"), posAfter(APP_TS, "store.")))
    .then((v) => ({ v }), (e) => ({ e }));
  const r = await Promise.race([call, sleep(3000).then(() => ({ timeout: true }))]);
  assert.ok(!r.timeout, "never a hanging promise");
  if ("v" in r) {
    assert.deepStrictEqual(r.v, [], "if it resolves, it is the degrade shape");
  } else {
    assert.ok(r.e instanceof Error, "if it rejects, it rejects with an Error");
    assert.ok(typeof r.e.name === "string" && r.e.name.length > 0, "a NAMED error");
  }
});
