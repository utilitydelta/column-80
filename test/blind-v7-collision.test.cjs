// v7 phase-1 regression oracle for the wrong-type inject (review finding 1). The
// committed fidelity fixture has no name collisions, so it is structurally blind
// to a resolver that re-anchors recursion by first-textual-occurrence of a type
// name. This fixture has TWO `Widget` types (inner::Widget first textually, the
// crate-level Widget second) and a `Container.widget: Widget` field typed as the
// crate-level one. A resolver anchoring at the field's OWN type token resolves
// the crate-level Widget; one doing a bare-name search walks into inner::Widget
// and emits ITS shape - the zero-tolerance invention bar. Also probes the
// string/comment decoy (finding 3).
//
// Run live: node --test --test-concurrency=1 test/blind-v7-collision.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 180_000;
const READY_TIMEOUT = 120_000;

const { mod, cleanup } = bundleCore(
  "blind-v7-collision",
  `export { resolveCrossFileShape } from "../src/core/crossFileShape";
export { RaLspExtractor } from "../src/core/raLspClient";\n`
);
const { resolveCrossFileShape, RaLspExtractor } = mod;
test.after(cleanup);

const FIXTURE = path.join(__dirname, "fixtures", "autocontext-collision");

const scratchCopy = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v7-coll-"));
  fs.cpSync(FIXTURE, dir, { recursive: true, filter: (s) => !s.split(path.sep).includes("target") });
  return dir;
};

const fieldNames = (t) => (t ? t.fields.map((f) => f.name) : []);

test(
  "collision: Container.widget resolves the CRATE-level Widget, not inner::Widget (no wrong-type inject)",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    process.env.CARGO_NET_OFFLINE = "true";
    const workspaceRoot = scratchCopy();
    const consumerPath = path.join(workspaceRoot, "consumer.rs");
    const uri = pathToFileURL(consumerPath).href;
    const text = fs.readFileSync(consumerPath, "utf8");

    const extractor = await RaLspExtractor.start({ workspaceRoot });
    try {
      extractor.openDocument(uri, text);
      await extractor.whenReady(READY_TIMEOUT);
      const openFile = async (u) => {
        const p = new URL(u).pathname;
        let t;
        try { t = fs.readFileSync(p, "utf8"); } catch { return undefined; }
        extractor.openDocument(u, t);
        return t;
      };
      // Anchor on `Container` in `read_container(c: &Container)`.
      const lines = text.split("\n");
      const li = lines.findIndex((l) => l.includes("read_container") && l.includes("&Container"));
      const ch = lines[li].indexOf("Container", lines[li].indexOf("&Container"));
      const shape = await resolveCrossFileShape(extractor, { uri, line: li, character: ch }, { D_MAX: 2, N_MAX: 6 }, openFile);

      const dump = JSON.stringify([...shape.types.entries()].map(([n, t]) => ({ n, f: t.fields.map((x) => x.name), m: t.methods })), null, 2);

      const widget = shape.types.get("Widget");
      assert.ok(widget, `crate-level Widget must resolve. Derived:\n${dump}`);
      // The crate-level Widget's real members - proof the RIGHT type was walked.
      assert.ok(
        fieldNames(widget).includes("crate_widget_field"),
        `Widget must be the CRATE-level type (field crate_widget_field), got fields ${JSON.stringify(fieldNames(widget))}.\n${dump}`,
      );
      assert.ok(
        widget.methods.some((m) => m.startsWith("crate_widget_method")),
        `Widget must carry crate_widget_method, got ${JSON.stringify(widget.methods)}.\n${dump}`,
      );
      // The wrong-type trap: inner::Widget's members must appear NOWHERE.
      assert.ok(
        !fieldNames(widget).includes("inner_only_field"),
        `WRONG-TYPE INJECT: Widget carries inner::Widget's field inner_only_field.\n${dump}`,
      );
      assert.ok(
        !widget.methods.some((m) => m.startsWith("inner_only_method")),
        `WRONG-TYPE INJECT: Widget carries inner::Widget's method inner_only_method.\n${dump}`,
      );

      // Panel resolves despite the comment/string decoy (finding 3).
      const panel = shape.types.get("Panel");
      assert.ok(panel, `Panel must resolve despite comment/string decoys.\n${dump}`);
      assert.ok(
        fieldNames(panel).includes("outer_only_field"),
        `Panel must be the real struct (outer_only_field), got ${JSON.stringify(fieldNames(panel))}.\n${dump}`,
      );
    } finally {
      extractor.dispose();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }
);
