// Blind oracle (v7 phase 1): resolver-fidelity contract test for
// resolveCrossFileShape against REAL rust-analyzer on the autocontext-scout
// fixture. This is the black-box grading of the ONE cross-file/cross-crate
// shape resolver: anchored at a type reference in consumer.rs, it must derive
// the cross-file shape of `Order` to walk depth D_MAX=2 (Order -> Customer ->
// Address, plus Order/Customer/LineItem methods) WITHOUT any of those defs
// living in consumer.rs, and it must invent NOTHING.
//
// The contract graded here is test/fixtures/autocontext-scout/
// expected-derivation.json (anchor[0]): every `must_derive` field and method
// is a superset requirement; every `must_not_invent` name must appear NOWHERE
// in the derived shape. The resolver interface is src/core/crossFileShape.ts.
//
// The oracle owns the RA lifecycle: start -> openDocument(consumer.rs) ->
// whenReady -> resolveCrossFileShape -> dispose. domain.rs is opened by the
// resolver itself through the `openFile` callback this test provides. It copies
// the committed fixture to an OS tmp scratch dir and runs RA there, so RA's
// target/ writes never mutate the repo fixture. It runs offline
// (CARGO_NET_OFFLINE=true).
//
// Blind-oracle discipline: this test never reads src/** contents; the resolver
// is a throwing stub today and running RED against it is the correct, expected
// state. A SKIP_LIVE=1 run confirms the file is authored and skips cleanly.
//
// Run live: node --test --test-concurrency=1 test/blind-v7-resolver-fidelity.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL, fileURLToPath } = require("url");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 180_000;
const READY_TIMEOUT = 120_000;

const { mod, cleanup } = bundleCore(
  "blind-v7-resolver-fidelity",
  `export { resolveCrossFileShape } from "../src/core/crossFileShape";
export { RaLspExtractor } from "../src/core/raLspClient";\n`
);
const { resolveCrossFileShape, RaLspExtractor } = mod;
test.after(cleanup);

const FIXTURE = path.join(__dirname, "fixtures", "autocontext-scout");
const EXPECTED = JSON.parse(
  fs.readFileSync(path.join(FIXTURE, "expected-derivation.json"), "utf8")
);

// Scratch copy per run; the repo fixture is read-only donor material. Skip any
// committed target/ so RA indexes cleanly from source in the scratch dir.
const scratchCopy = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v7-ra-"));
  fs.cpSync(FIXTURE, dir, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes("target"),
  });
  return dir;
};

// Cursor INSIDE the `ident` token on the first CODE line that also contains
// `lineNeedle`. Anchoring by a second needle disambiguates: `Order` appears on
// the `use` line too, but we want the reference in the distinct_locales
// signature. start+2 lands the cursor inside the identifier, not before it.
const siteInIdentOnLine = (text, lineNeedle, ident) => {
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    if (lines[line].trim().startsWith("//")) continue;
    if (!lines[line].includes(lineNeedle)) continue;
    const at = lines[line].indexOf(ident);
    assert.ok(
      at >= 0,
      `line containing ${JSON.stringify(lineNeedle)} has no ${JSON.stringify(ident)}: ${JSON.stringify(lines[line])}`
    );
    return { line, character: at + 2 };
  }
  assert.fail(`no code line contains both ${JSON.stringify(lineNeedle)} and ${JSON.stringify(ident)}`);
};

// The "head" type of an expected field type string: unwrap a single generic
// wrapper so `Vec<LineItem>` -> `LineItem`, while `Customer`/`String` pass
// through. Matches crossFileShape.ts's DerivedType.typeName ("parsed head type
// name, e.g. LineItem for entries: Vec<LineItem>").
const headType = (typeStr) => typeStr.replace(/^\w+<(.+)>$/, "$1").trim();

// Split an expected field spec "placed_by: Customer" into { name, head }.
const parseField = (spec) => {
  const idx = spec.indexOf(":");
  return { name: spec.slice(0, idx).trim(), head: headType(spec.slice(idx + 1)) };
};

// The method NAME from a rendered signature or expected spec: everything before
// the first "(", whitespace-trimmed. "net_minor_units(&self) -> u64" -> "net_minor_units".
const methodName = (sig) => {
  const p = sig.indexOf("(");
  return (p >= 0 ? sig.slice(0, p) : sig).trim();
};

// Compact dump of a derived type for self-explanatory failure messages.
const dumpType = (dt) =>
  dt
    ? `{ fields: [${dt.fields.map((f) => `${f.name}: ${f.typeName}`).join(", ")}], methods: [${dt.methods.join(" | ")}], methodsResolved: ${dt.methodsResolved} }`
    : "<missing>";

test(
  "resolver fidelity: cross-file shape of Order at depth 2, superset of must_derive, invents nothing",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    // Vendored deps only (none here); no network reach during indexing.
    process.env.CARGO_NET_OFFLINE = "true";

    const anchor = EXPECTED.anchors[0];
    assert.ok(anchor, "expected-derivation.json must define anchors[0]");

    const workspaceRoot = scratchCopy();
    const consumerPath = path.join(workspaceRoot, "consumer.rs");
    const consumerUri = pathToFileURL(consumerPath).href;
    const consumerText = fs.readFileSync(consumerPath, "utf8");

    const extractor = await RaLspExtractor.start({ workspaceRoot });
    try {
      extractor.openDocument(consumerUri, consumerText);
      await extractor.whenReady(READY_TIMEOUT);

      // Anchor ON the `Order` token in `distinct_locales(orders: &[Order])`.
      // "orders" is lowercase so indexOf("Order") lands on the type reference.
      const site = siteInIdentOnLine(consumerText, "distinct_locales", "Order");
      const rootSite = { uri: consumerUri, ...site };

      // The resolver opens domain.rs itself via this callback. openDocument is
      // idempotent-safe; a file it cannot read is a stop edge (undefined), not
      // a throw.
      const openFile = async (uri) => {
        try {
          const filePath = fileURLToPath(uri);
          const text = fs.readFileSync(filePath, "utf8");
          extractor.openDocument(uri, text);
          return text;
        } catch {
          return undefined;
        }
      };

      const shape = await resolveCrossFileShape(
        extractor,
        rootSite,
        { D_MAX: 2, N_MAX: 6 },
        openFile
      );

      assert.ok(shape && shape.types instanceof Map, `resolver must return { types: Map, dropped }, got ${JSON.stringify(shape)}`);

      const derivedKeys = [...shape.types.keys()].join(", ");

      // ---- must_derive: every listed type present; every field name present
      // with the right head typeName; every method name present in methods[].
      for (const [typeName, want] of Object.entries(anchor.must_derive)) {
        const dt = shape.types.get(typeName);
        assert.ok(
          dt,
          `must_derive: type ${typeName} missing from derived shape. Derived types: [${derivedKeys}]`
        );

        for (const fieldSpec of want.fields) {
          const { name, head } = parseField(fieldSpec);
          const got = dt.fields.find((f) => f.name === name);
          assert.ok(
            got,
            `must_derive: ${typeName}.${name} (from "${fieldSpec}") missing from fields. Derived ${typeName} = ${dumpType(dt)}`
          );
          // Tolerant on wrapper: accept either the unwrapped head ("LineItem")
          // or a typeName that still carries the wrapper ("Vec<LineItem>").
          const tn = got.typeName || "";
          assert.ok(
            tn === head || tn.includes(head),
            `must_derive: ${typeName}.${name} typeName head mismatch: expected head "${head}" (from "${fieldSpec}"), got typeName "${tn}"`
          );
        }

        for (const methodSpec of want.methods) {
          const wantName = methodName(methodSpec);
          const hit = dt.methods.some((m) => methodName(m) === wantName);
          assert.ok(
            hit,
            `must_derive: ${typeName} method "${wantName}" (from "${methodSpec}") not present. Derived ${typeName} methods = [${dt.methods.join(" | ")}], methodsResolved=${dt.methodsResolved}`
          );
        }
      }

      // ---- must_not_invent: NO field name and NO method name across ANY
      // derived type may EXACTLY equal an invented name. Exact-name match:
      // "display_name" must not trip on "name".
      const invented = new Set(anchor.must_not_invent);
      for (const [typeName, dt] of shape.types) {
        for (const f of dt.fields) {
          assert.ok(
            !invented.has(f.name),
            `must_not_invent: derived ${typeName} has invented field name "${f.name}". This name is a hallucination guard tripwire; the resolver must only emit RA-resolved real names. ${typeName} = ${dumpType(dt)}`
          );
        }
        for (const m of dt.methods) {
          const mn = methodName(m);
          assert.ok(
            !invented.has(mn),
            `must_not_invent: derived ${typeName} has invented method name "${mn}" (from "${m}"). ${typeName} = ${dumpType(dt)}`
          );
        }
      }

      // ---- Depth bound: Region (depth 3, via Address.region) is NOT required
      // to be a key. We do not assert its presence or absence. But Address must
      // still LIST `region` as a field (already asserted in must_derive above),
      // proving the bound stops the WALK, not the field enumeration of the
      // last in-bound type.
      const addr = shape.types.get("Address");
      assert.ok(addr, "Address (depth 2) must be a derived key");
      assert.ok(
        addr.fields.some((f) => f.name === "region"),
        `depth bound: Address must still list its real field 'region' even though Region (depth 3) is beyond D_MAX. Address = ${dumpType(addr)}`
      );
    } finally {
      extractor.dispose();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }
);
