// LIVE check — session-v40 item 4: does the shipped `pyShapeHooks.enumMemberLine`
// actually do the right thing against a REAL pyright session, on REAL Python
// source? Runs the product's own `resolveCrossFileShape` walk (not a re-derived
// harness) with a live `PyLspExtractor`, anchored at real usage sites in
// ~/repos/python-scratch/atlas_py/_core.py — the dogfood repo session-v37's
// spike-10/spike-11 already used for Python (no other real corpus on this box).
//
// Two bars, both live:
//   1. `LodBand` (a real `IntEnum`) renders every variant as `LodBand.VARIANT`.
//   2. `StripeSummary` (a real `@dataclass`) renders NO enum-style member lines
//      for its fields — the wrong-is-worse-than-absent bar the goal sets: a
//      dataclass field misrendered as `Type.field` reads as static access and
//      would be actively wrong, worse than the type going member-dark.
//
// READ-ONLY. Only definition/hover/documentSymbol requests; nothing writes
// into ~/repos/python-scratch.
//
// Skips (never fails) when SKIP_LIVE is set or pyright-langserver / the
// dogfood repo isn't present.
//
// Run: node --test test/impl-v40-p4-py-enum-render-live.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP_LIVE = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const SERVER = path.join(__dirname, "..", "node_modules", ".bin", "pyright-langserver");
const serverMissing = !fs.existsSync(SERVER) ? `pyright-langserver not found at ${SERVER}` : undefined;
const WS = path.join(os.homedir(), "repos", "python-scratch");
const FILE = path.join(WS, "atlas_py", "_core.py");
const fixtureMissing = !fs.existsSync(FILE) ? `no dogfood fixture at ${FILE}` : undefined;

const SKIP = SKIP_LIVE || serverMissing || fixtureMissing;

if (SKIP) {
  test(`pyShapeHooks.enumMemberLine live checks (SKIPPED: ${SKIP})`, () => {});
} else {
  const { mod: B, cleanup } = bundleCore(
    "impl-v40-p4-py-enum-render-live",
    `export { PyLspExtractor } from "../src/core/pyLspExtractor";
export { resolveCrossFileShape, pyShapeHooks } from "../src/core/crossFileShape";\n`,
  );
  test.after(cleanup);

  const LIVE_TIMEOUT = 90_000;
  let ex;
  let text;

  test.before(async () => {
    ex = await B.PyLspExtractor.start({ projectRoot: WS, serverPath: SERVER, diagnosticMode: "openFilesOnly" });
    await ex.whenReady(LIVE_TIMEOUT);
    text = fs.readFileSync(FILE, "utf8");
    ex.openDocument(pathToFileURL(FILE).href, text);
    // Let pyright finish its first analysis pass before the first request.
    await new Promise((r) => setTimeout(r, 2000));
  });
  test.after(() => ex?.dispose?.());

  const openFile = async (uri) => {
    if (uri === pathToFileURL(FILE).href) return text;
    try {
      return fs.readFileSync(fileURLToPath(uri), "utf8");
    } catch {
      return undefined;
    }
  };

  // First occurrence of `name` as a whole word OUTSIDE its own `class NAME(...)`
  // declaration line, so the anchor sits on a real TYPE REFERENCE (a use
  // site — a return annotation, a member access, a param type) — the same
  // anchor shape prioritizedTypes hands the walk in the real product.
  function findUseSite(name) {
    const re = new RegExp(`\\b${name}\\b`);
    const declRe = new RegExp(`^\\s*class\\s+${name}\\b`);
    const lines = text.split("\n");
    for (let line = 0; line < lines.length; line++) {
      if (declRe.test(lines[line])) continue;
      const m = re.exec(lines[line]);
      if (m) {
        return { uri: pathToFileURL(FILE).href, line, character: m.index };
      }
    }
    throw new Error(`no use site for ${name} found in ${FILE}`);
  }

  test(
    "LodBand (a real IntEnum): every variant renders as LodBand.VARIANT, live",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const site = findUseSite("LodBand");
      const shape = await B.resolveCrossFileShape(ex, site, { D_MAX: 1, N_MAX: 4 }, openFile, B.pyShapeHooks);
      const lodBand = shape.types.get("LodBand");
      assert.ok(lodBand, "LodBand must resolve — the anchor or the server regressed if not");
      assert.deepEqual(
        [...lodBand.methods].sort(),
        ["LodBand.CONTINENTAL", "LodBand.MUNICIPAL", "LodBand.PARCEL", "LodBand.REGIONAL"],
        `expected all four variants qualified, got: ${JSON.stringify(lodBand.methods)}`,
      );
    },
  );

  test(
    "StripeSummary (a real @dataclass): fields render as NOTHING, never as StripeSummary.field, live",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const site = findUseSite("StripeSummary");
      const shape = await B.resolveCrossFileShape(ex, site, { D_MAX: 1, N_MAX: 4 }, openFile, B.pyShapeHooks);
      const summary = shape.types.get("StripeSummary");
      assert.ok(summary, "StripeSummary must resolve — the anchor or the server regressed if not");
      const misrendered = summary.methods.filter((l) => /^StripeSummary\.(aggregate|tile_tally|bands_touched|label)$/.test(l));
      assert.deepEqual(
        misrendered,
        [],
        `a dataclass field must never render as Type.field (static-access shape); got: ${JSON.stringify(summary.methods)}`,
      );
    },
  );
}
