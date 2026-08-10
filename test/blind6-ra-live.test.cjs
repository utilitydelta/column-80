// Blind oracle: RaLspExtractor against REAL rust-analyzer on the extraction
// fixture. This is the live proof of slice 1's ground truth [surface: 'The
// fixture' + 'Falsification bars']: selection accuracy with zero invented
// names, macro-resolved hover, broken-buffer resolution, and warm latency.
//
// The oracle owns the RA lifecycle: start -> openDocument -> whenReady ->
// query -> applyEdit -> dispose. It copies the committed fixture to an OS tmp
// scratch dir and runs RA there, so RA's target/ writes never mutate the repo
// fixture [surface: 'copies fixture crates to scratch dirs']. It runs offline
// (CARGO_NET_OFFLINE=true; deps are vendored in the cargo registry cache).
//
// Cursor sites are located on CODE lines only (comment lines are skipped): the
// fixture's comments name the same identifiers on purpose, and a hover/complete
// on a comment line returns nothing - matching a comment is a real bug.
//
// Live only. SKIP_LIVE=1 skips it. Cold index is paid once; warm queries are
// single-digit ms. The implementer runs this live; a SKIP_LIVE run confirms it
// is authored and skips cleanly.
//
// Run live: node --test --test-concurrency=1 test/blind6-ra-live.test.cjs

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
  "blind6-ra-live",
  `export { RaLspExtractor } from "../src/core/raLspClient";
export { renderMemberSignatures } from "../src/core/extraction";\n`
);
const { RaLspExtractor, renderMemberSignatures } = mod;
test.after(cleanup);

const FIXTURE = path.join(__dirname, "fixtures", "extraction");

// Scratch copy per run; the repo fixture is read-only donor material. Skip the
// committed target/ so RA indexes cleanly from source in the scratch dir.
const scratchCopy = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blind6-ra-"));
  fs.cpSync(FIXTURE, dir, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes("target"),
  });
  return dir;
};

// Cursor at the character right AFTER `needle`, on the first CODE line that
// contains it. Used for the `.`/`::` completion sites: put the cursor on the
// dot/colon boundary. Comment lines (trimmed start "//") are skipped.
const siteAfter = (text, needle) => {
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    if (lines[line].trim().startsWith("//")) continue;
    const at = lines[line].indexOf(needle);
    if (at >= 0) return { line, character: at + needle.length };
  }
  assert.fail(`no code line contains ${JSON.stringify(needle)}`);
};

// Cursor INSIDE `ident` (start + 2), on the first CODE line that contains it.
// Used for hover: the cursor must land on the identifier, not before it.
const siteInside = (text, ident) => {
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    if (lines[line].trim().startsWith("//")) continue;
    const at = lines[line].indexOf(ident);
    if (at >= 0) return { line, character: at + 2 };
  }
  assert.fail(`no code line contains ${JSON.stringify(ident)}`);
};

const names = (members) => members.map((m) => m.name);

test(
  "live ground truth: real member sets, macro-resolved hover, broken-buffer resolution, warm latency",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    // Vendored deps only; no network reach during indexing.
    process.env.CARGO_NET_OFFLINE = "true";

    const workspaceRoot = scratchCopy();
    const mainPath = path.join(workspaceRoot, "src", "main.rs");
    const uri = pathToFileURL(mainPath).href;
    const text = fs.readFileSync(mainPath, "utf8");

    const extractor = await RaLspExtractor.start({ workspaceRoot });
    try {
      extractor.openDocument(uri, text);
      await extractor.whenReady(READY_TIMEOUT);

      // ---- Site A: `filter.` resolves the fastbloom inherent methods, zero
      // invented names [surface: falsification bar 1 + Site A].
      const siteA = siteAfter(text, "filter.");
      const membersA = await extractor.completeMembers({ uri, ...siteA });
      const namesA = names(membersA);
      for (const real of [
        "insert", "contains", "clear", "insert_hash", "contains_hash",
        "num_bits", "num_hashes", "union", "intersect", "insert_all", "as_slice",
      ]) {
        assert.ok(namesA.includes(real), `site A must contain the real method ${real}, got ${JSON.stringify(namesA)}`);
      }
      for (const invented of ["new", "add", "check", "build"]) {
        assert.ok(!namesA.includes(invented), `site A must NOT contain the invented name ${invented}`);
      }
      const hashMember = membersA.find((m) => m.name === "contains_hash");
      assert.ok(hashMember && hashMember.signature, "members carry rendered signatures from the detail form");

      // ---- Site B: `BloomFilter::` resolves the real constructors [Site B].
      const siteB = siteAfter(text, "BloomFilter::");
      const namesB = names(await extractor.completeMembers({ uri, ...siteB }));
      for (const ctor of ["with_num_bits", "with_false_pos", "from_vec"]) {
        assert.ok(namesB.includes(ctor), `site B must contain the constructor ${ctor}, got ${JSON.stringify(namesB)}`);
      }

      // ---- Site D: `widget.` renders the local inherent signatures; the
      // universal into/try_into members drop out of the payload [Site D].
      const siteD = siteAfter(text, "widget.");
      const membersD = await extractor.completeMembers({ uri, ...siteD });
      const payloadD = renderMemberSignatures(membersD);
      assert.ok(payloadD.includes("render(&self) -> String"), `site D payload must render render/1, got ${JSON.stringify(payloadD)}`);
      assert.ok(payloadD.includes("relabel(&mut self, u64)"), `site D payload must render relabel/1, got ${JSON.stringify(payloadD)}`);
      assert.ok(!/\binto\b/.test(payloadD), "the universal into member is dropped from the payload");
      assert.ok(!payloadD.includes("try_into"), "the universal try_into member is dropped from the payload");

      // ---- Hover on BloomFilter: the resolved struct decl, not the bare path
      // [falsification bar 2 + Hover on BloomFilter].
      const hoverStruct = await extractor.hoverSurface({ uri, ...siteInside(text, "BloomFilter") });
      assert.ok(hoverStruct, "BloomFilter hover resolves");
      assert.ok(hoverStruct.signature.startsWith("pub struct BloomFilter"), `got ${JSON.stringify(hoverStruct.signature)}`);
      assert.notStrictEqual(hoverStruct.signature, "fastbloom", "never the bare crate path");
      assert.match(hoverStruct.doc, /member/i, "the struct doc mentions membership");

      // ---- Hover on with_num_bits: the macro-resolved signature + example
      // [falsification bar 2 + Hover on with_num_bits].
      const hoverMethod = await extractor.hoverSurface({ uri, ...siteInside(text, "with_num_bits") });
      assert.ok(hoverMethod, "with_num_bits hover resolves");
      assert.strictEqual(hoverMethod.signature, "pub fn with_num_bits(num_bits: usize) -> BuilderWithBits");
      assert.ok(hoverMethod.example, "the method hover carries an example");
      assert.match(hoverMethod.example, /with_num_bits\(1024\)/, "the ground-truth example line is present");

      // ---- Broken buffer: didChange to a non-compiling body ending in `f.`;
      // members still resolve, warm [falsification bar 3 + Broken buffer].
      const brokenText = [
        "use fastbloom::BloomFilter;",
        "",
        "fn use_bloom() {",
        "    let f = BloomFilter::with_num_bits(1024).expected_items(2);",
        "    f.",
        "}",
        "",
        "fn main() {",
        "    use_bloom();",
        "}",
        "",
      ].join("\n");
      extractor.applyEdit(uri, brokenText);
      const brokenLines = brokenText.split("\n");
      const fLine = brokenLines.findIndex((l) => l.trim() === "f.");
      assert.ok(fLine >= 0, "the broken buffer has the `f.` completion site");
      const brokenSite = { uri, line: fLine, character: brokenLines[fLine].length };

      // didChange propagation can lag; poll briefly for the members to appear.
      let membersBroken = [];
      for (let i = 0; i < 40; i++) {
        membersBroken = await extractor.completeMembers(brokenSite);
        if (membersBroken.length > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const brokenNames = names(membersBroken);
      for (const real of ["insert", "contains", "clear"]) {
        assert.ok(brokenNames.includes(real), `broken buffer must resolve ${real} on a non-compiling buffer, got ${JSON.stringify(brokenNames)}`);
      }

      // ---- Warm latency: after ready, a warm completeMembers query is well
      // under the 200ms FIM bar [falsification bar 5].
      const t0 = performance.now();
      await extractor.completeMembers(brokenSite);
      const warmMs = performance.now() - t0;
      assert.ok(warmMs < 200, `warm query took ${warmMs.toFixed(1)}ms, over the 200ms bar`);
    } finally {
      extractor.dispose();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }
);
