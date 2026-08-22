// The row `2dcf210` shipped without. That commit fixed a real defect on the
// TypeScript by-name leg - `getNavigateToItems` answers the whole DECLARATION
// span, not the name token every workspace/symbol server answers, so
// `export class Tile` resolved character 0, which is the `export` keyword - and
// its only witness was a manual run. Phase 9's fixtures put `location.range` at
// the name token already, so nothing in the suite could exercise the navto
// path, and `membersOfType` survives a keyword cursor by walking up the AST.
//
// Driven against a REAL TypeScript language service, in process, over a real
// tsconfig on disk. A fake cannot produce this defect: navto's span shape IS
// the defect.
//
// The contract asserted is the one a caller depends on: the resolved cursor
// sits on the type's NAME, and a primitive that does not walk up an AST -
// `hoverSurface` - answers about the type there and answers nothing useful at
// the span's start.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v59-p9-navto.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adv-v59-p9-navto",
  `export { TsLsExtractor } from "../src/core/tsLsExtractor";\n`,
);
test.after(() => cleanup());

const REPO_TS_DIR = path.join(__dirname, "..", "node_modules", "typescript");

// Every declaration here carries chrome BEFORE its name, which is the whole
// point: navto's textSpan starts at the declaration, so the further the name
// sits from the span's start, the further a span-start cursor lands from it.
const SOURCE = [
  "export class Tile {",
  "  constructor(public readonly morton: number) {}",
  "  key(): string { return `${this.morton}`; }",
  "}",
  "",
  "export abstract class Slab {",
  "  abstract area(): number;",
  "}",
  "",
  "export default interface Cohort {",
  "  size: number;",
  "}",
  "",
];

const NAME_ROWS = [
  { name: "Tile", line: 0 },
  { name: "Slab", line: 5 },
  { name: "Cohort", line: 9 },
];

let root;
let ex;
let uri;

test.before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v59-navto-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2020" }, include: ["src"] }),
  );
  fs.writeFileSync(path.join(root, "src", "shapes.ts"), SOURCE.join("\n"));
  ex = await mod.TsLsExtractor.start({ projectRoot: root, ts: require(REPO_TS_DIR) });
  uri = pathToFileURL(path.join(root, "src", "shapes.ts")).href;
});

test.after(() => {
  ex?.dispose();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

for (const row of NAME_ROWS) {
  test(`by-name resolution lands on the NAME token, not the declaration span's start: ${SOURCE[row.line]}`, async () => {
    const nameAt = SOURCE[row.line].indexOf(row.name);
    assert.ok(nameAt > 0, "the fixture line must put chrome before the name, or this row proves nothing");

    const cursor = await ex.resolveTypeCursorByName(row.name);
    assert.ok(cursor, `${row.name} must resolve at all`);
    assert.strictEqual(cursor.uri, uri);
    assert.deepStrictEqual(
      { line: cursor.line, character: cursor.character },
      { line: row.line, character: nameAt },
      "the resolved cursor is the name token's own position",
    );

    // The consequence, through a primitive that does NOT walk up an AST.
    const onName = await ex.hoverSurface(cursor);
    assert.ok(
      onName && onName.signature.includes(row.name),
      `a hover at the resolved cursor answers about ${row.name}, got ${JSON.stringify(onName)}`,
    );

    const atSpanStart = await ex.hoverSurface({ uri, line: row.line, character: 0 });
    assert.ok(
      !atSpanStart || !atSpanStart.signature.includes(row.name),
      `character 0 of that line is the ${SOURCE[row.line].split(" ")[0]} keyword and must NOT answer about ${row.name}; ` +
        `got ${JSON.stringify(atSpanStart)}. If this starts passing, navto's span shape changed - re-measure before ` +
        `trusting the row above it.`,
    );
  });
}

test("members still resolve through the moved cursor - the fix must not cost the surface it was protecting", async () => {
  const cursor = await ex.resolveTypeCursorByName("Tile");
  assert.ok(cursor);
  const members = (await ex.membersOfType(cursor)).map((m) => m.name).sort();
  assert.deepStrictEqual(members, ["key", "morton"]);
});
