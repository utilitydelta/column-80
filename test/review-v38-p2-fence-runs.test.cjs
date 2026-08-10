// Adversarial review: session-v38 item 2, CommonMark fence runs in
// src/core/instructPostprocess.ts.
//
// Every row here ran. Rows tagged [DEFECT] are RED against the shipped change
// and each one is a claim the change makes about itself. Rows tagged [FINE]
// are green and exist so a later edit cannot quietly take them away.
//
// Run: SKIP_LIVE=1 node --test test/review-v38-p2-fence-runs.test.cjs

// THE MEASUREMENT RIG LIVES IN A DIFFERENT REPOSITORY (2026-08-10). It and the
// session archives were split into a private repo because they carry corpora
// taken against private client code and cannot be published, so a public clone
// has no `session-complxity-research/` and the rows below have no subject.
//
// The whole file skips, with the reason on the channel. It SKIPS rather than
// passing vacuously: a row that goes green when the thing it tests is absent is
// the false green this suite exists to prevent. Where a baseline can be
// vendored instead, vendor it (see test/fixtures/prompt) and do not use this.
const { RIG_PRESENT, SKIP_REASON } = require("./.rig-present.cjs");
if (!RIG_PRESENT) {
  require("node:test")("rig-dependent rows", { skip: SKIP_REASON }, () => {});
  return;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v38-p2",
  `export { extractFirstCodeBlock, postprocessInstructOutput, extractTestModule, extractTestFunctions, extractRequestedFunction } from "../src/core/instructPostprocess";\n`
);
const {
  extractFirstCodeBlock,
  postprocessInstructOutput,
  extractTestModule,
  extractTestFunctions,
  extractRequestedFunction,
} = mod;
test.after(cleanup);

const DATA = path.join(__dirname, "..", "session-complxity-research", "data");
// Every capture this file scores lives under `session-complxity-research/`, which
// `.gitignore`'s `session*/` excludes: roughly 700KB of measurement output that
// does not belong in the extension. A clone therefore has the row and not its
// evidence, and the read throws, which reports a missing artifact as a failed
// claim. `needsCapture` skips there and runs for real wherever the capture IS
// present. Added 2026-08-03 with the 1.1.0 release, the first time these v37/v38
// review files ever ran on CI.
const needsCapture = (ctx, ...files) =>
  files.some((f) => !fs.existsSync(path.join(DATA, f)))
    ? (ctx.skip(`capture(s) absent (gitignored session artifact): ${files.join(", ")}`), true)
    : false;

// The fn-gen service's code-fence guard, copied verbatim from
// src/core/fnGenService.ts (the `text.split("\n").some(...)` line).
const fenceGuardRefuses = (text) => text.split("\n").some((line) => /^(```|~~~)/.test(line.trim()));

// The opening run on a trimmed line, or null.
const runOf = (trimmed) => {
  const m = /^(`{3,}|~{3,})/.exec(trimmed);
  return m ? m[1] : null;
};

// Walk one captured reply and return its (openLen/closeLen) pairs. A closer
// here is a bare run of the SAME character of ANY length, so BOTH directions
// of mismatch are visible. This is the method; the denominator is stated at
// each use.
function fencePairs(s) {
  const out = [];
  let open = null;
  for (const line of s.split("\n")) {
    const t = line.trim();
    const r = runOf(t);
    if (open === null) {
      if (r) open = r;
    } else if (r && r[0] === open[0] && t.length === r.length) {
      out.push(`${open[0]}${open.length}/${r.length}`);
      open = null;
    }
  }
  return out;
}

function everyStringIn(v, sink) {
  if (typeof v === "string") sink(v);
  else if (Array.isArray(v)) v.forEach((x) => everyStringIn(x, sink));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => everyStringIn(x, sink));
}

// ---------------------------------------------------------------------------
// ROW 1 [DEFECT, HIGH]. "ZERO are mismatched in either direction ... The shape
// the leniency protected has never been observed." It has. Exactly one captured
// reply in the corpus opens with a longer run than it closes with, and it is in
// repair-v38-fence.json — the very file the change was measured from.
// ---------------------------------------------------------------------------
test("[DEFECT] the change's 'zero mismatched' claim: a 4/3 reply exists in the item-2 capture file", {
  todo:
    "FIXED by the phase-2 loop-back. The false census this row refutes has been rewritten in " +
    "src/core/instructPostprocess.ts with its method and unit stated next to the number, and with the " +
    "three observed open-4/close-3 replies named as the reason the leniency is kept. The row is left " +
    "unedited because it is the record of the claim having been wrong.",
}, () => {
  const rows = JSON.parse(fs.readFileSync(path.join(DATA, "repair-v38-fence.json"), "utf8"));
  const mismatched = [];
  for (const r of rows) {
    for (const [i, rd] of (r.rounds ?? []).entries()) {
      if (typeof rd.raw !== "string") continue;
      for (const p of fencePairs(rd.raw)) {
        const [a, b] = p.slice(1).split("/");
        if (a !== b) mismatched.push(`${r.id} round ${i}: ${p}`);
      }
    }
  }
  assert.deepEqual(mismatched, [], "no captured reply may open with a run it does not close with");
});

// ---------------------------------------------------------------------------
// ROW 2 [DEFECT, HIGH]. The concrete cost of ROW 1: that reply was ACCEPTED at
// HEAD and is REFUSED by the change. A complete 42-line function is thrown away.
// ---------------------------------------------------------------------------
test("[DEFECT] the 4/3 capture: HEAD extracts a complete function, the change hands the guard the whole reply", (ctx) => {
  if (needsCapture(ctx, "repair-v38-fence.json")) {
    return;
  }
  const rows = JSON.parse(fs.readFileSync(path.join(DATA, "repair-v38-fence.json"), "utf8"));
  const row = rows.find((r) => r.id.includes("capture_replication_snapshot"));
  assert.ok(row, "the capture_replication_snapshot row must still be in the data");
  const raw = row.rounds[0].raw;
  const fences = raw.split("\n").filter((l) => runOf(l.trim())).map((l) => l.trim());
  assert.deepEqual(fences, ["````rust", "```"], "this is the open-4 / close-3 shape");
  assert.equal(
    fenceGuardRefuses(postprocessInstructOutput(raw)),
    false,
    "a real captured repair that HEAD accepted is now refused by the fence guard",
  );
});

// ---------------------------------------------------------------------------
// ROW 3 [DEFECT, HIGH]. Frequency, stated on the population the rule actually
// governs. Conditional on a run-4 opener, the mismatch rate in the capture file
// is 1 in 17, not zero. "Never observed" is only true against a denominator
// that drowns the run-4 population in run-3 replies.
// ---------------------------------------------------------------------------
test("[DEFECT] mismatch rate CONDITIONAL on a run-4 opener is 1/17 in the capture file, not 0", {
  todo:
    "FIXED by the phase-2 loop-back. The false census this row refutes has been rewritten in " +
    "src/core/instructPostprocess.ts with its method and unit stated next to the number, and with the " +
    "three observed open-4/close-3 replies named as the reason the leniency is kept. The row is left " +
    "unedited because it is the record of the claim having been wrong.",
}, () => {
  const rows = JSON.parse(fs.readFileSync(path.join(DATA, "repair-v38-fence.json"), "utf8"));
  let run4Openers = 0;
  let run4Mismatched = 0;
  for (const r of rows) {
    for (const rd of r.rounds ?? []) {
      if (typeof rd.raw !== "string") continue;
      for (const p of fencePairs(rd.raw)) {
        const [a, b] = p.slice(1).split("/");
        if (Number(a) >= 4) {
          run4Openers++;
          if (a !== b) run4Mismatched++;
        }
      }
    }
  }
  assert.equal(run4Openers, 17, "denominator: fenced blocks in this file opened with a run of 4+");
  assert.equal(run4Mismatched, 0, `mismatch rate conditional on a run-4 opener: ${run4Mismatched}/${run4Openers}`);
});

// ---------------------------------------------------------------------------
// ROW 3b [DEFECT, HIGH]. The post-fix validation run is ALREADY producing the
// shape. repair-v38-fence-fixed.json is being written live by the in-flight
// repair arm; at the snapshot I took (18 rows, 45 raw replies) it carried a
// SECOND, distinct open-4 / close-3 reply on
// acme_shard/src/shard_wal.rs:validate_and_prepare_write, 77 lines, and
// the row's own recorded outcome is repair_rejected with rejectWhy = the fence
// guard. That row is the change's new failure mode, recorded by the run meant
// to demonstrate the change works. This row re-derives it from the file, so it
// goes green if and only if the shape stops appearing.
// ---------------------------------------------------------------------------
test("[DEFECT] the post-fix re-run file already carries its own open-4 / close-3 rejection", {
  todo:
    "FIXED by the phase-2 loop-back, and this row records what it caught. The first cut of the change was " +
    "strict CommonMark; the shipped rule is a strict SUPERSET of HEAD (a closer is a bare run of the same " +
    "character of length 3 OR the opener's length), so the shape this row names is no longer refused. The " +
    "assertion still describes the first cut and is left unedited on purpose. Definitive replay on the " +
    "shipped rule: 151 of 151 captured replies survive the guard, against 110 of 151 at HEAD.",
}, () => {
  const rows = JSON.parse(fs.readFileSync(path.join(DATA, "repair-v38-fence-fixed.json"), "utf8"));
  const mismatched = [];
  for (const r of rows) {
    for (const [i, rd] of (r.rounds ?? []).entries()) {
      if (typeof rd.raw !== "string") continue;
      for (const p of fencePairs(rd.raw)) {
        const [a, b] = p.slice(1).split("/");
        if (a !== b) mismatched.push(`${r.id} round ${i}: ${p} rejectWhy=${r.rejectWhy}`);
      }
    }
  }
  assert.deepEqual(mismatched, []);
});

// ---------------------------------------------------------------------------
// ROW 4 [DEFECT, MEDIUM]. The numbers in the doc comment and in the blind
// oracle's header do not reproduce. Stated method: every distinct string value,
// recursively, in all 86 json files under session-complxity-research/data/.
// ---------------------------------------------------------------------------
test("[DEFECT] the corpus numbers: 1184 blocks / 1173 3-3 / 11 4-4 / 0 mismatched do not reproduce", {
  todo:
    "FIXED by the phase-2 loop-back. The false census this row refutes has been rewritten in " +
    "src/core/instructPostprocess.ts with its method and unit stated next to the number, and with the " +
    "three observed open-4/close-3 replies named as the reason the leniency is kept. The row is left " +
    "unedited because it is the record of the claim having been wrong.",
}, () => {
  const files = fs.readdirSync(DATA).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 86, "the '86 corpus files' denominator does check out");
  const seen = new Set();
  for (const f of files) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
    } catch {
      continue;
    }
    everyStringIn(j, (s) => seen.add(s));
  }
  const tally = {};
  let blocks = 0;
  for (const s of seen) {
    for (const p of fencePairs(s)) {
      blocks++;
      tally[p] = (tally[p] ?? 0) + 1;
    }
  }
  assert.deepEqual(
    { blocks, ...tally },
    { blocks: 1184, "`3/3": 1173, "`4/4": 11 },
    "the claimed corpus tally",
  );
});

// ---------------------------------------------------------------------------
// ROW 5 [DEFECT, MEDIUM]. The blind oracle's own per-file count, quoted in its
// header as "repair-v38-fence.json, 34 raw replies: 24 are 3/3 and 10 are 4/4,
// none mismatched", is wrong on every figure.
// ---------------------------------------------------------------------------
test("[DEFECT] the blind oracle's per-file count (34 replies, 24 3-3, 10 4-4, none mismatched)", {
  todo:
    "FIXED by the phase-2 loop-back. The false census this row refutes has been rewritten in " +
    "src/core/instructPostprocess.ts with its method and unit stated next to the number, and with the " +
    "three observed open-4/close-3 replies named as the reason the leniency is kept. The row is left " +
    "unedited because it is the record of the claim having been wrong.",
}, () => {
  const rows = JSON.parse(fs.readFileSync(path.join(DATA, "repair-v38-fence.json"), "utf8"));
  const raws = [];
  for (const r of rows) for (const rd of r.rounds ?? []) if (typeof rd.raw === "string") raws.push(rd.raw);
  const tally = {};
  for (const s of raws) for (const p of fencePairs(s)) tally[p] = (tally[p] ?? 0) + 1;
  assert.deepEqual({ replies: raws.length, ...tally }, { replies: 34, "`3/3": 24, "`4/4": 10 });
});

// ---------------------------------------------------------------------------
// ROW 6 [DEFECT, MEDIUM]. A NEW failure mode, and it is worse in kind than the
// one being fixed. A bare run-4 line at column 0 inside a run-3 block now
// closes it early. The extractor returns a truncated function, the fence guard
// does NOT fire (there is no fence line left in the truncation), and
// extractRequestedFunction keeps the tail unjudged, so the broken text reaches
// the splice. HEAD returned the whole function. Refusal became silent damage.
// ---------------------------------------------------------------------------
test("[DEFECT] a bare run-4 line inside a run-3 block silently truncates the function into the splice", {
  todo:
    "FIXED by the phase-2 loop-back, and it is the reason the shipped rule is not CommonMark. A longer " +
    "run no longer closes a shorter opener, so a run-4 line inside a run-3 block is content exactly as at " +
    "HEAD and this silent truncation cannot occur. The assertion is left describing the first cut.",
}, () => {
  const reply = '```rust\nfn f() -> &\'static str {\n    r#"\n````\nexample\n````\n"#\n}\n```';
  const whole = "fn f() -> &'static str {\n    r#\"\n````\nexample\n````\n\"#\n}";
  assert.equal(extractFirstCodeBlock(reply), whole, "the block must not stop at the interior run-4 line");
  const text = postprocessInstructOutput(reply);
  assert.equal(fenceGuardRefuses(text), false, "and the guard does not catch the truncation either way");
  assert.equal(
    extractRequestedFunction(text, "fn f() -> &'static str {").text,
    whole,
    "so a truncated, unterminated function is what gets spliced",
  );
});

// ---------------------------------------------------------------------------
// ROW 7 [DEFECT, MEDIUM]. extractFirstCodeBlock has three callers and the
// measurement exercised one. extractTestModule loses the same leniency, and
// the message it produces then LIES: the reply plainly contains a test module.
// ---------------------------------------------------------------------------
test("[DEFECT] caller 2, extractTestModule: an open-4 / close-3 test module is now 'not a test module'", () => {
  const reply = "````rust\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn a() { assert!(true); }\n}\n```";
  assert.deepEqual(
    extractTestModule(reply),
    { text: "#[cfg(test)]\nmod tests {\n    #[test]\n    fn a() { assert!(true); }\n}", testCount: 1 },
    "HEAD extracted this; the change rejects it and fnGenService reports no test module",
  );
});

test("[DEFECT] caller 3, extractTestFunctions: same loss on the four non-Rust languages", () => {
  const reply = '````go\nfunc TestA(t *testing.T) { t.Log("x") }\n```';
  assert.deepEqual(
    extractTestFunctions(reply, "go"),
    { text: 'func TestA(t *testing.T) { t.Log("x") }', testCount: 1 },
    "HEAD extracted this; the change rejects it",
  );
});

// ---------------------------------------------------------------------------
// ROW 8 [DEFECT, MEDIUM]. The doc comment sells run-length as "what makes
// nesting work at all". Nesting works — and it delivers markdown fence lines
// straight into the test-file splice, which has NO fence guard (the guard in
// fnGenService lives only in the non-test branch). The change makes the leak
// strictly larger: HEAD stopped at the inner closer, the change keeps it.
// ---------------------------------------------------------------------------
test("[DEFECT] the nesting payoff pushes MORE markdown into the test path, which has no fence guard", {
  todo:
    "DEFERRED by triage as scraps S38-6. Under the shipped rule the leak returns to HEAD's one fence " +
    "line, so it is no longer a regression. The real defect it points at, that the TEST-file splice path " +
    "has no fence guard at all, is pre-existing and out of scope for phase 2.",
}, () => {
  const reply =
    "````markdown\n```rust\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn a() { assert!(true); }\n}\n```\n````";
  const got = extractTestModule(reply);
  assert.ok(got, "sanity: the module is found");
  assert.equal(
    got.text.split("\n").filter((l) => runOf(l.trim())).length,
    0,
    "no fence line may reach a test-file splice; HEAD leaked 1, the change leaks 2",
  );
});

// ---------------------------------------------------------------------------
// ROW 9 [DEFECT, LOW]. Arithmetic. 32/198 is 16.2%, not 16.7%. The figure is in
// the shipped doc comment and repeated in the blind oracle's header.
// ---------------------------------------------------------------------------
test("[DEFECT] '32 of 198 ... 16.7%' is 16.2%", {
  todo:
    "FIXED by the phase-2 loop-back. The false census this row refutes has been rewritten in " +
    "src/core/instructPostprocess.ts with its method and unit stated next to the number, and with the " +
    "three observed open-4/close-3 replies named as the reason the leniency is kept. The row is left " +
    "unedited because it is the record of the claim having been wrong.",
}, () => {
  assert.equal(((32 / 198) * 100).toFixed(1), "16.7");
});

// ---------------------------------------------------------------------------
// [FINE] rows. Green, and they are the reason the change is still worth
// shipping in some form.
// ---------------------------------------------------------------------------
test("[FINE] the fix is a large net win on the measured rows: 16 rounds recovered, 1 lost", {
  todo:
    "SUPERSEDED by the shipped rule. This row scores the first cut (16 recovered, 1 lost). The " +
    "definitive replay of the shipped rule over both capture files is 151 of 151 surviving the guard " +
    "against 110 of 151 at HEAD: 41 recovered, 0 lost, 0 truncated.",
}, () => {
  const rows = JSON.parse(fs.readFileSync(path.join(DATA, "repair-v38-fence.json"), "utf8"));
  let recovered = 0;
  let lost = 0;
  for (const r of rows) {
    for (const rd of r.rounds ?? []) {
      if (typeof rd.raw !== "string") continue;
      // HEAD's extractor: hard-coded three-character closer.
      const headBlock = (() => {
        const lines = rd.raw.split("\n");
        let openLine = -1;
        let closer = "";
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim();
          if (openLine === -1) {
            if (t.startsWith("```") || t.startsWith("~~~")) {
              openLine = i;
              closer = t.slice(0, 3);
            }
          } else if (t === closer) {
            return lines.slice(openLine + 1, i).join("\n");
          }
        }
        return undefined;
      })();
      const headText = (headBlock !== undefined ? headBlock : rd.raw).replace(/^\s+|\s+$/g, "");
      const headRefused = fenceGuardRefuses(headText);
      const nowRefused = fenceGuardRefuses(postprocessInstructOutput(rd.raw));
      if (headRefused && !nowRefused) recovered++;
      if (!headRefused && nowRefused) lost++;
    }
  }
  assert.equal(recovered, 16);
  assert.equal(lost, 1);
});

test("[FINE] CRLF survives a run-4 fence", () => {
  assert.equal(extractFirstCodeBlock("````rust\r\nfn a() {}\r\n````\r"), "fn a() {}\r");
  assert.equal(postprocessInstructOutput("````rust\r\nfn a() {}\r\n````\r"), "fn a() {}");
});

test("[FINE] a run-4 opener with no closer still returns undefined, not a half block", () => {
  assert.equal(extractFirstCodeBlock("prose\n````rust\nfn a() {}"), undefined);
});

test("[FINE] a tilde run never closes a backtick run and vice versa, at any length", () => {
  assert.equal(extractFirstCodeBlock("````\ncode\n~~~~~"), undefined);
  assert.equal(extractFirstCodeBlock("~~~~\ncode\n`````"), undefined);
});

test("[FINE] the FIM pipeline does not share this function", () => {
  const fim = fs.readFileSync(path.join(__dirname, "..", "src", "core", "postprocess.ts"), "utf8");
  assert.equal(fim.includes("instructPostprocess"), false);
  assert.equal(fim.includes("extractFirstCodeBlock"), false);
});
