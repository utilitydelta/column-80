// ADVERSARIAL REVIEW - session-v62 phase 3: the gesture proposes.
//
// Fresh eyes over `src/vscode/criticize.ts`, `src/core/criticizeGesture.ts` and
// the presenter seam in `src/vscode/fnGen.ts`. This is the phase that puts a
// THIRD caller on the extension's single document write path, so every row here
// is written against one question: what bytes can this gesture put in a
// person's file that nobody asked for?
//
// The file drives the REAL command through a structural `vscode`, with a fake
// presenter that replays `present()`'s own guards and splice arithmetic. A
// source pin can prove the presenter is reached; only a run can prove what it is
// handed.
//
// RED ROWS ARE FINDINGS, not flake. Each one names its severity and whether it
// is a product defect, a test defect or a contract gap. Sections 5 and 6 are
// GREEN on purpose: they are the attacks that found nothing, kept so the next
// change to this path has to keep them green.
//
// Run: node --test test/adversarial-v62-p3.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");
const { bundleWithVscodeStub } = require("./.vscode-stub.cjs");

// ---------------------------------------------------------------------------
// Two bundles: the pure planner half, and the command itself over a stub host.
// ---------------------------------------------------------------------------

const core = bundleCore(
  "adv-v62-p3-core",
  `export { planInjection } from "../src/core/criticizePlan";
export { scoreFunction, DEFAULT_ELEVATION } from "../src/core/criticizeScore";
export { sliceFunction } from "../src/core/criticizeSlice";
export { criticizeLangFor } from "../src/core/criticizeLang";
export * from "../src/core/criticizeGesture";\n`,
);
const host = bundleWithVscodeStub(
  "adv-v62-p3-host",
  `export { registerCriticize, CRITICIZE_COMMAND_ID } from "../src/vscode/criticize";\n`,
);
test.after(() => {
  core.cleanup();
  host.cleanup();
});

const {
  planInjection,
  scoreFunction,
  DEFAULT_ELEVATION,
  sliceFunction,
  criticizeLangFor,
  injectionRegion,
  scoringView,
  viewLineAtOrAfter,
  viewLineAtOrBefore,
  cardInDocumentLines,
} = core.mod;
const RUST = criticizeLangFor("rust");
const vscode = host.vscode;

const readSrc = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

// ---------------------------------------------------------------------------
// The host harness.
//
// A document whose TEXT AND VERSION CAN MOVE, because the whole staleness
// contract is about a document that moved. The presenter is a faithful replay
// of `present()`: the two pre-consent guards, then `spliceSpan`'s arithmetic on
// the CURRENT text. Nothing here is more forgiving than the real one.
// ---------------------------------------------------------------------------

function makeDoc(text, languageId = "rust") {
  const state = { text, version: 1, closed: false };
  const doc = {
    uri: vscode.Uri.parse("file:///adv/p.rs"),
    fileName: "/adv/p.rs",
    languageId,
    eol: 1,
    get version() {
      return state.version;
    },
    get isClosed() {
      return state.closed;
    },
    get lineCount() {
      return state.text.split("\n").length;
    },
    getText: () => state.text,
    positionAt: (off) => {
      const lines = state.text.split("\n");
      let o = 0;
      for (let l = 0; l < lines.length; l++) {
        if (off <= o + lines[l].length) return new vscode.Position(l, off - o);
        o += lines[l].length + 1;
      }
      return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
    },
    offsetAt: (p) => {
      const lines = state.text.split("\n");
      let o = 0;
      for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
      return Math.min(o + p.character, state.text.length);
    },
    lineAt: (arg) => {
      const lines = state.text.split("\n");
      const t = lines[typeof arg === "number" ? arg : arg.line] ?? "";
      const m = t.match(/\S/);
      return {
        text: t,
        range: new vscode.Range(0, 0, 0, t.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m,
      };
    },
  };
  return { doc, state };
}

/**
 * Presses the gesture once.
 *
 * `duringResolve` runs INSIDE the symbol-provider await, which is the window
 * `resolveFunctionAtCursor` really occupies: the offsets it returns describe the
 * text the provider saw, and anything the user typed since is already in the
 * buffer by the time the gesture resumes.
 */
async function press(source, { duringResolve, decide = "accept", languageId = "rust" } = {}) {
  const { doc, state } = makeDoc(source, languageId);
  const lines = source.split("\n");
  const headLine = lines.findIndex((l) => /\b(pub fn|fn |def )/.test(l)) + 1;
  const endLine = lines.findIndex((l) => l === "    }" || l === "}") + 1;
  let headOffset = 0;
  for (let i = 0; i < headLine - 1; i++) headOffset += lines[i].length + 1;
  headOffset += lines[headLine - 1].search(/\S/);
  let spanEnd = 0;
  for (let i = 0; i < endLine - 1; i++) spanEnd += lines[i].length + 1;
  spanEnd += lines[endLine - 1].length;

  globalThis.__C80_ACTIVE__ = { document: doc, selection: { active: new vscode.Position(headLine - 1, 0) } };
  globalThis.__C80_WARNINGS__ = [];
  globalThis.__C80_COMMANDS__ = {};
  const channel = [];
  const output = {
    name: "adv",
    appendLine: (l) => channel.push(l),
    append() {},
    show() {},
    hide() {},
    clear() {},
    dispose() {},
  };
  const presented = [];
  const presenter = {
    present: async (request) => {
      presented.push(request);
      if (request.document.isClosed) return "discarded";
      if (request.document.version !== request.versionAtResolve) {
        request.outcome = "discarded";
        return "discarded";
      }
      const current = request.document.getText();
      request.spliced =
        current.slice(0, request.span.start) + request.text + current.slice(request.span.end);
      request.outcome = decide;
      request.service.logOutcome(decide === "accept" ? "accept" : "reject",
        decide === "accept" ? undefined : { refusedBy: "human-gesture", offered: request.text });
      return decide;
    },
  };

  host.mod.registerCriticize({ subscriptions: [] }, output, {
    resolveFunction: async () => {
      const resolved = {
        span: { start: headOffset, end: spanEnd },
        headOffset,
        signature: lines[headLine - 1].trim(),
        symbolName: (/\b(?:fn|def)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[headLine - 1]) ?? [])[1] ?? "f",
        languageId,
        kind: "function",
        bodyOnly: false,
        headerIndent: (lines[headLine - 1].match(/^[ \t]*/) ?? [""])[0],
      };
      if (duringResolve !== undefined) {
        // A real await: the user's keystroke lands here, between the provider
        // reading the text and the gesture resuming.
        await new Promise((r) => setTimeout(r, 1));
        duringResolve(state);
      }
      return resolved;
    },
    // The gate is shut, so the explainer never touches a transport. Nothing on
    // this path depends on prose.
    tierGate: async () => ({ allowed: false, reason: "tier-disabled" }),
    tierMessage: () => "the hardware tier disables function generation",
    transport: () => async () => ({ text: "" }),
    presenter: () => presenter,
  });
  await globalThis.__C80_COMMANDS__[host.mod.CRITICIZE_COMMAND_ID]();
  return { channel, presented, state, doc };
}

const METHOD = [
  "use std::time::Instant;",
  "impl Parser {",
  "    /// Parses a header.",
  "    pub fn parse_header(&self, raw: &str, flag: bool) -> Header {",
  "        let started = Instant::now();",
  "        Header::from(raw, started, flag)",
  "    }",
  "}",
].join("\n");

// ---------------------------------------------------------------------------
// 1. THE STALENESS ANCHOR IS CAPTURED ONE AWAIT TOO LATE.
//
// HIGH. PRODUCT DEFECT in `src/vscode/criticize.ts`.
//
// `scoredAtVersion` is read AFTER `await wiring.resolveFunction(...)`. The span
// and the head offset are offsets into the text the SYMBOL PROVIDER saw, so a
// keystroke that lands during resolution moves the bytes those offsets point at
// and the version they belong to is the one BEFORE the keystroke. Capturing
// after the await stamps the proposal with the version the buffer has AFTER it,
// which is the one number `present()`'s guard blesses.
//
// fn-gen has this exact comment at its own capture site, and captures BEFORE:
//
//     // The staleness anchor, captured BEFORE the symbol-provider await:
//     // spans are offsets into the text the provider saw, and an edit
//     // landing during resolution would otherwise produce garbage offsets
//     // every later guard blesses.
//
// In v61 this cost a wrong card. In v62 it costs wrong bytes.
// ---------------------------------------------------------------------------

test("HIGH: a keystroke during resolution splices the declaration in half", async () => {
  // Five characters deleted on a line ABOVE the function, which is what a
  // developer tidying an import does. The head offset now points five columns
  // to the right of the head, past the indent and into `pub`, so the region
  // opens mid-token and the head-line comment is planted inside the keyword.
  const run = await press(METHOD, {
    duringResolve: (state) => {
      state.text = state.text.replace("std::time", "time");
      state.version = 2;
    },
  });
  assert.equal(run.presented.length, 1, "the gesture reached the consent gate");
  const request = run.presented[0];
  assert.notEqual(
    request.outcome,
    "accept",
    "a document that moved during resolution must DISCARD, and this one spliced:\n" +
      String(request.spliced),
  );
  assert.ok(
    !/pub f\/\/ C80/.test(String(request.spliced)),
    "the accepted text cuts `pub fn` in half:\n" + String(request.spliced),
  );
});

test("HIGH: versionAtResolve is the version the OFFSETS belong to, not the one after", async () => {
  let versionAtProviderRead;
  const run = await press(METHOD, {
    duringResolve: (state) => {
      versionAtProviderRead = 1;
      state.text = state.text.replace("std::time", "time");
      state.version = 2;
    },
  });
  assert.equal(run.presented.length, 1);
  assert.equal(
    run.presented[0].versionAtResolve,
    versionAtProviderRead,
    "the span came from version 1's text; stamping the proposal with version 2 " +
      "makes every later guard bless offsets into a text that no longer exists",
  );
});

test("HIGH: the capture sits below the resolve await, and fn-gen's sits above its own", () => {
  const source = readSrc("vscode", "criticize.ts");
  const resolveAt = source.indexOf("await wiring.resolveFunction(");
  const captureAt = source.indexOf("const scoredAtVersion = document.version;");
  assert.ok(resolveAt > 0 && captureAt > 0, "both sites must exist for this row to mean anything");
  assert.ok(
    captureAt < resolveAt,
    "the staleness anchor must be captured BEFORE the symbol-provider await, " +
      "the way `src/vscode/fnGen.ts` captures its own",
  );
});

// ---------------------------------------------------------------------------
// 2. THE STRIP DELETES TEXT IT DOES NOT COUNT, AND TEXT THAT IS NOT A COMMENT.
//
// MED. PRODUCT DEFECT in `src/core/criticizePlan.ts`, reachable only now that
// phase 3 gives the strip a write path.
//
// `stripC80` removes any line whose trimmed text starts with `// C80 `, and
// counts it only when what follows is one of the fifteen dimension ids. So a
// line the product did not plant is deleted and reported as nothing, and the
// offered line the human reads before opening the diff under-reports the
// deletion they are being asked to approve.
//
// The trailing-comment branch is quote-aware for exactly this reason - the
// module's own comment says "cutting a string literal is a broken build" - and
// the whole-line branch has no such guard.
// ---------------------------------------------------------------------------

function planFor(lines, headLine, endLine, name) {
  const text = lines.join("\n");
  const unit = sliceFunction(lines, headLine, endLine, name, RUST);
  assert.ok(unit !== undefined, "the fixture must slice");
  const card = scoreFunction(unit, RUST, DEFAULT_ELEVATION);
  let head = 0;
  for (let i = 0; i < headLine - 1; i++) head += lines[i].length + 1;
  head += lines[headLine - 1].search(/\S/);
  let end = 0;
  for (let i = 0; i < endLine - 1; i++) end += lines[i].length + 1;
  end += lines[endLine - 1].length;
  const region = injectionRegion(text, head, end, "rust");
  return { text, region, plan: planInjection(region.lines, region.startLine, card, DEFAULT_ELEVATION) };
}

test("MED: a hand-written `// C80 ...` note is deleted and counted as nothing", () => {
  const lines = [
    "impl P {",
    "    /// Doc.",
    "    pub fn f(&self, flag: bool) -> u32 {",
    "        // C80 is the column limit we keep to",
    "        let n = 1;",
    "        n",
    "    }",
    "}",
  ];
  const { plan } = planFor(lines, 3, 7, "f");
  assert.ok(plan.planted > 0, "the fixture must produce a proposal, or nothing is offered at all");
  const kept = plan.text.includes("the column limit we keep to");
  assert.ok(
    kept || plan.stripped > 0,
    "the line was deleted and `stripped` reports " +
      plan.stripped +
      ", so the channel says `stripping 0 stale comments` while the diff removes a " +
      "line the product never wrote",
  );
});

// DEFERRED as scrap S62-9, and this row now pins the DEFERRED BEHAVIOUR rather
// than sitting red forever. It is the same treatment S62-3 got in the phase 1
// file: a known hole stays executable and named, so nobody has to rediscover it
// and nobody mistakes a red suite for a broken build.
//
// F3's fix ("delete only what you count") was expected to shrink this to almost
// nothing, and it did: the surviving case is a string literal containing a
// literal `// C80 <dimension-id>: ` head, which is byte-for-byte the shape the
// product emits. `clock` is one of the fifteen ids, so the strip counts it and
// therefore deletes it.
//
// Closing it needs multi-line string state across four grammars (Rust `r#""#`,
// Python triple quotes, Go backticks, C# `@"`). The two cheaper ideas both
// fail: matching the head against the frozen VOICE phrase, or requiring the
// head's indent to match the following code line, each break the deliberate
// tolerance for comments planted by an older build.
test("MED, DEFERRED S62-9: a `// C80 <dimension>: ` line inside a raw string literal is still deleted", () => {
  const lines = [
    "impl P {",
    "    /// Doc.",
    "    pub fn f(&self, flag: bool) -> String {",
    '        let s = r#"',
    "// C80 clock: this is documentation, not criticism",
    '"#;',
    "        s.to_string()",
    "    }",
    "}",
  ];
  const { plan } = planFor(lines, 3, 8, "f");
  assert.ok(
    !plan.text.includes("this is documentation, not criticism"),
    "S62-9 has been CLOSED: the strip pass now leaves a C80-shaped line inside a " +
      "string literal alone. Good. Delete this row, strike S62-9 in scraps.md, and " +
      "note which of the four grammars the fix covers.",
  );
});

// ---------------------------------------------------------------------------
// 3. THE RULED IDEMPOTENCE MEASUREMENT IS FALSE AT THE SECOND PRESS.
//
// HIGH, and ALREADY RECORDED as scrap S62-7. Kept here as an executable
// witness, with two facts the scrap does not carry: the drift reaches a
// FIXPOINT at press three, and the false `undocumented` finding is on the CARD
// as well as in the diff, so the panel lies too.
//
// goal.md: "Run the gesture twice, accept both times, and the function has the
// same number of comments it had after the first accept."
//
// PHASE 4a, 2026-08-28: the product was fixed and this witness went on failing,
// because the loop below re-derived the coordinate mapping instead of using the
// product's. `planFor` slices the document as it stands and plans against the
// region's own document line, which is precisely the pair the fix replaced, so a
// harness holding it can never see the fix land. The FIXTURE and both assertions
// are untouched; only the four lines that stand in for `src/vscode/criticize.ts`
// now do what that file does - build the scoring view, slice it, and plan on the
// region's first STRIPPED line. `planFor` itself is left alone, because two
// other findings in this file still ride on it.
// ---------------------------------------------------------------------------

test("HIGH (S62-7): the second accept moves the body comment above the declaration", () => {
  let text = [
    "impl P {",
    "    /// Doc.",
    "    pub fn f(&self, flag: bool) -> u64 {",
    "        let t = Instant::now();",
    "        t.elapsed().as_secs()",
    "    }",
    "}",
  ].join("\n");
  const presses = [];
  for (let n = 0; n < 2; n++) {
    const lines = text.split("\n");
    const headLine = lines.findIndex((l) => l.includes("pub fn f")) + 1;
    const endLine = lines.findIndex((l) => l === "    }") + 1;
    const view = scoringView(lines, "rust");
    const unit = sliceFunction(
      view.lines,
      viewLineAtOrAfter(view, headLine),
      viewLineAtOrBefore(view, endLine),
      "f",
      RUST,
    );
    const scored = scoreFunction(unit, RUST, DEFAULT_ELEVATION);
    const card = cardInDocumentLines(scored, view);
    let head = 0;
    for (let i = 0; i < headLine - 1; i++) head += lines[i].length + 1;
    head += lines[headLine - 1].search(/\S/);
    let end = 0;
    for (let i = 0; i < endLine - 1; i++) end += lines[i].length + 1;
    end += lines[endLine - 1].length;
    const region = injectionRegion(text, head, end, "rust");
    const plan = planInjection(
      region.lines,
      viewLineAtOrAfter(view, region.startLine),
      scored,
      DEFAULT_ELEVATION,
    );
    presses.push({
      planted: plan.planted,
      elevated: card.rows.filter((r) => r.elevated).map((r) => r.dimension),
    });
    text = text.slice(0, region.start) + plan.text + text.slice(region.end);
  }
  const body = text.split("\n");
  const headAt = body.findIndex((l) => l.includes("pub fn f"));
  const clockAt = body.findIndex((l) => l.includes("C80 clock:"));
  assert.ok(
    clockAt > headAt,
    "the clock finding is on a body line and its comment belongs in the body; " +
      "after the second accept it sits above the declaration. Elevated per press: " +
      JSON.stringify(presses),
  );
  assert.ok(
    !presses[1].elevated.includes("undocumented"),
    "a function carrying `/// Doc.` scored as undocumented on press two, because " +
      "the planted block blinds the doc harvester: " + JSON.stringify(presses[1].elevated),
  );
});

// ---------------------------------------------------------------------------
// 4. THE CONSENT GATE'S BUTTONS STILL SAY "GENERATED BODY".
//
// MED. CONTRACT GAP: the contract named the diff TITLE and stopped there, and
// the title is not the affordance the human presses.
//
// The rubric preview opens under `column80-fngen`, which is what puts the
// accept and reject buttons on its title bar. Those commands are titled
// "Accept Generated Body" and "Reject Generated Body", so the human reads
// `parse_header: rubric (preview)` on the tab and is asked to accept a
// generated body - for a gesture whose whole point is that it generates nothing.
// ---------------------------------------------------------------------------

test("MED: the accept button names a generated body, on a tab titled `rubric (preview)`", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const accept = pkg.contributes.commands.find((c) => c.command === "column80.proposalAccept");
  assert.ok(accept !== undefined, "the gesture surface must exist");
  assert.ok(
    !/generated body/i.test(accept.title),
    `the one consent gate now serves three gestures and its button says "${accept.title}"`,
  );
});

// ---------------------------------------------------------------------------
// 4b. THE POST-ACCEPT DISCARD TOAST STILL SAYS "GENERATION DISCARDED".
//
// MED. CONTRACT GAP: the contract routed the PRE-consent discard to the channel
// precisely so criticize would not say "generation discarded" for a gesture that
// generates nothing, and left the post-Accept discards on the shared toast,
// which says exactly that. The human accepts a rubric proposal, the file moved
// while the diff was open, and the product tells them their generation was
// discarded. `[critique] outcome=discarded` is all the channel gets: the five
// product-prose reasons pass no `detail`, so the REASON exists only in the toast
// that misnames the gesture.
// ---------------------------------------------------------------------------

test("MED: the shared discard toast names a generation, for three gestures", () => {
  const source = readSrc("vscode", "fnGen.ts");
  const toasts = source.match(/Column 80: generation discarded[^`]*/g) ?? [];
  assert.deepEqual(
    toasts,
    [],
    "present() is the one consent gate for fn-gen, repair and now criticize; its " +
      "discard sentence is fn-gen's alone: " + JSON.stringify(toasts),
  );
});

// ---------------------------------------------------------------------------
// 5. LOW: a comment in `extension.ts` still calls the gesture read-only.
//
// The contract required the module header be fixed and it was. The wiring site
// carries the same claim and was missed.
// ---------------------------------------------------------------------------

test("LOW: the wiring site no longer calls criticize READ ONLY", () => {
  const source = readSrc("vscode", "extension.ts");
  const at = source.indexOf("registerCriticize(context");
  const preamble = source.slice(Math.max(0, at - 600), at);
  assert.ok(
    !/READ ONLY/i.test(preamble),
    "extension.ts still introduces the gesture as READ ONLY, one line above the " +
      "call that hands it the extension's only document write",
  );
});

// ---------------------------------------------------------------------------
// 6. ATTACKED AND FOUND SOUND.
//
// Green rows. Each one is an attack that failed, kept so the next change has to
// keep it failing.
// ---------------------------------------------------------------------------

test("the region's bytes are exactly the lines the planner is handed", () => {
  const { text, region } = planFor(
    METHOD.split("\n"),
    4,
    7,
    "parse_header",
  );
  assert.equal(text.slice(region.start, region.end), region.lines.join("\n"));
  assert.equal(region.lines[0], "    pub fn parse_header(&self, raw: &str, flag: bool) -> Header {");
  assert.equal(region.lines[region.lines.length - 1], "    }");
});

test("the span end is exclusive and everything past it survives the splice", async () => {
  const run = await press(METHOD);
  assert.equal(run.presented.length, 1);
  const request = run.presented[0];
  const tail = METHOD.slice(request.span.end);
  assert.equal(tail, "\n}", "the closing brace of the impl block is outside the region");
  assert.ok(String(request.spliced).endsWith(tail));
  assert.ok(String(request.spliced).startsWith(METHOD.slice(0, request.span.start)));
});

test("the first press reconstructs a file whose non-comment lines are untouched", async () => {
  const run = await press(METHOD);
  const spliced = String(run.presented[0].spliced);
  const code = spliced.split("\n").filter((l) => !l.trim().startsWith("//"));
  assert.deepEqual(
    code,
    METHOD.split("\n").filter((l) => !l.trim().startsWith("//")),
    "the splice may add comment lines and may move nothing else",
  );
});

test("nothing above the bar opens no diff, and the card still renders", async () => {
  const clean = [
    "impl P {",
    "    /// Adds two bounds.",
    "    pub fn add(&self, first: i32, second: i64) -> i32 {",
    "        first + second as i32",
    "    }",
    "}",
  ].join("\n");
  const run = await press(clean);
  assert.equal(run.presented.length, 0, "an empty diff tab is worse than no diff tab");
  assert.ok(run.channel.some((l) => l.includes("nothing to propose")), run.channel.join("\n"));
  assert.ok(run.channel.some((l) => l.includes("Criticize rubric for add")), "the card is the product");
  assert.ok(run.channel.some((l) => l.includes("The rubric, all fifteen dimensions")));
});

test("nothing planted but something stale IS a proposal, and the card still renders", async () => {
  const stale = [
    "impl P {",
    "    /// Adds two bounds.",
    "    pub fn add(&self, first: i32, second: i64) -> i32 {",
    "        // C80 clock: reads the wall clock. Hidden wall-clock read.",
    "        first + second as i32",
    "    }",
    "}",
  ].join("\n");
  const run = await press(stale);
  assert.equal(run.presented.length, 1, "the criticism was addressed and the comment should come out");
  assert.ok(
    run.channel.some((l) => l === "[critique] proposing 0 comments over 0 dimensions, stripping 1 stale comment"),
    run.channel.join("\n"),
  );
  assert.ok(run.channel.some((l) => l.includes("Criticize rubric for add")));
  assert.ok(!String(run.presented[0].spliced).includes("C80 clock"));
});

test("every channel line the gesture writes is [critique] or another gesture's own prefix", async () => {
  const run = await press(METHOD);
  for (const line of run.channel) {
    assert.ok(
      !line.includes("[fngen]"),
      `fn-gen's accept/reject evidence is measured and oracles match outcome= whole: ${line}`,
    );
  }
  assert.ok(run.channel.includes("[critique] outcome=accept"));
  assert.ok(
    run.channel.some((l) => /^\[critique\] proposing \d+ comments over \d+ dimensions, stripping \d+ stale comments?$/.test(l)),
    run.channel.join("\n"),
  );
});

test("a reject writes nothing and gets no toast", async () => {
  const run = await press(METHOD, { decide: "reject" });
  assert.equal(run.presented.length, 1);
  assert.equal(run.presented[0].outcome, "reject");
  assert.equal(run.state.text, METHOD, "the buffer never moved");
  assert.deepEqual(globalThis.__C80_WARNINGS__, [], "the human said no; telling them so is noise");
  assert.ok(run.channel.some((l) => l.startsWith("[critique] outcome=reject refused-by=")));
});

test("the enrichment steps cannot change what the card says", async () => {
  // The proposal is built from the ENRICHED card, and the card was already
  // written to the channel before it. A run that proposes and a run that does
  // not must produce the same card for the same function.
  const run = await press(METHOD);
  // The card reaches the channel as ONE appendLine carrying the whole render.
  const card = run.channel.find((l) => l.startsWith("Criticize rubric")).split("\n");
  assert.ok(card.length > 15, "fifteen dimensions and their headings");
  assert.equal(
    card.filter((l) => l.includes("C80 ")).length,
    0,
    "the proposal writes nothing back onto the card",
  );
});

test("ONE presenter in the extension, and criticize constructs none", () => {
  const all = ["criticize.ts", "fnGen.ts", "oracleSurface.ts", "extension.ts", "tightenDocComment.ts"]
    .map((f) => readSrc("vscode", f))
    .join("\n");
  assert.equal((all.match(/new ProposalPresenter\(/g) ?? []).length, 1);
  assert.ok(!readSrc("vscode", "criticize.ts").includes("new ProposalPresenter"));
});

test("the region never begins below the declaration head", () => {
  // Python's Fork A, driven through the region builder rather than asserted
  // about it: a region built from the writable span has no `def` in it.
  const py = [
    "def probe(first: int, second: int) -> int:",
    '    """Probe."""',
    "    started = time.time()",
    "    return first + second + int(started)",
  ].join("\n");
  const fromHead = injectionRegion(py, py.indexOf("def probe"), py.length, "python");
  const fromSpan = injectionRegion(py, py.indexOf("    started"), py.length, "python");
  assert.ok(fromHead.lines[0].startsWith("def probe"));
  assert.ok(!fromSpan.lines.some((l) => l.includes("def probe")));
});

test("Python's first press keeps the docstring and puts head findings above the def", () => {
  const lines = [
    "import time",
    "",
    "",
    "def parse_header(raw: str, flag: bool) -> str:",
    '    """Parses a header."""',
    "    started = time.time()",
    "    return raw + str(started)",
  ];
  const text = lines.join("\n");
  const PY = criticizeLangFor("python");
  const unit = sliceFunction(lines, 4, 7, "parse_header", PY);
  const card = scoreFunction(unit, PY, DEFAULT_ELEVATION);
  const region = injectionRegion(text, text.indexOf("def parse_header"), text.length, "python");
  const plan = planInjection(region.lines, region.startLine, card, DEFAULT_ELEVATION);
  const out = (text.slice(0, region.start) + plan.text + text.slice(region.end)).split("\n");
  const def = out.findIndex((l) => l.startsWith("def parse_header"));
  const doc = out.findIndex((l) => l.includes('"""Parses a header."""'));
  const clock = out.findIndex((l) => l.includes("# C80 clock:"));
  const boolParam = out.findIndex((l) => l.includes("# C80 bool-param:"));
  assert.ok(doc > def, "Fork A's docstring is preserved and stays under the def");
  assert.ok(boolParam >= 0 && boolParam < def, "a head-line finding lands above the declaration");
  assert.ok(clock > doc, "a body finding lands in the body");
  assert.ok(out.every((l) => !l.includes("// C80")), "Python's comment token is #");
});

test("a CRLF region round-trips through the planner and the document's own EOL", () => {
  const crlf = METHOD.replace(/\n/g, "\r\n");
  const head = crlf.indexOf("    pub fn parse_header");
  const end = crlf.indexOf("    }") + "    }".length;
  const region = injectionRegion(crlf, head, end, "rust");
  for (const line of region.lines) assert.ok(!line.includes("\r"), JSON.stringify(line));
  // What `withDocumentEol` does to the planner's text, done here: the region
  // must come back byte-identical when nothing is planted.
  const rebuilt = region.lines.join("\n").replace(/\r\n|\n/g, "\r\n");
  assert.equal(crlf.slice(region.start, region.end), rebuilt);
});
