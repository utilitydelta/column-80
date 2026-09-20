// Blind oracle for session-v74 phase 2: the target block carries a label
// [session-v74/contracts/p2-target-label.md]. Written from the contract and
// session-v74/goal.md alone. src/** was NOT read: not prompt.ts, not one line,
// not one grep into it. Every fact below about the assembler comes from the
// contract text or from calling the exported functions black-box.
//
// Surface, all bundled through the public module seam:
//   assembleFnGenPrompt, fnGenPromptShare, assembleTestGenPrompt,
//   targetLabel, renderContextPrefix, SECTION_SEPARATOR   ../src/core/prompt
//
// What a file written blind CANNOT do: diff the assembled bytes against the
// assembler as it stood before the contract. Rule 1 ("no moved bytes") is
// therefore bound STRUCTURALLY instead — with no injected surface there must be
// no label section anywhere in the prompt and targetLabel must be undefined —
// plus the three-way identity of omitted / undefined / "" that any widening of
// the gate would break. Named as a choice in the report, not hidden here.
//
// Two rules were amended during the build and the rows follow the amendments,
// not the superseded text:
//   - Rule 6 is WITHDRAWN by amendment 1. The R6-A1 rows bind the amendment
//     (the test-gen prompt stays unlabelled). Reasoning is at those rows.
//   - Rule 4 is REPLACED by amendment 4. The label names no header and forbids
//     nothing. The R4-A4 rows pin the two measured defects of the superseded
//     wording shut. Amendment 3 types `kind`, so `method` gets no noun row.
//
// Run: SKIP_LIVE=1 node --test test/blind-v74-p2-target-label.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v74-p2-target-label",
    `export { assembleFnGenPrompt, fnGenPromptShare, assembleTestGenPrompt, targetLabel, renderContextPrefix, SECTION_SEPARATOR } from "../src/core/prompt";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const {
  assembleFnGenPrompt,
  fnGenPromptShare,
  assembleTestGenPrompt,
  targetLabel,
  renderContextPrefix,
  SECTION_SEPARATOR,
} = mod;

// ===========================================================================
// Fixtures.
//
// Deliberate fixture property: no part of any input contains a blank line, so
// splitting on SECTION_SEPARATOR yields exactly one array entry per section.
// The index arithmetic in rule 2 depends on it.
// ===========================================================================

const SEP = SECTION_SEPARATOR;

// The shape of the real defect from goal.md: a labelled API surface sitting
// between the instruction and the target block.
const SURFACE = "API surface for `ClientError`:\nfn from_error_response(e: ErrorResponse) -> Self";

const CTX_BLOCKS = [
  { uri: "file:///w/src/pool.rs", range: { startLine: 4, endLine: 5 }, text: "const CTX_SENTINEL_V74: usize = 1;" },
  { uri: "file:///w/src/other.rs", range: { startLine: 9, endLine: 9 }, text: "type CTX_SENTINEL_V74_B = u8;" },
];
const SCAFFOLD = ["increment the gate counter", "return the pool-timeout error"];
const LOCALS = ["AtomicU64", "ClientError"];

// The six shapes rule 3 enumerates. `kind: undefined` is the function shape.
// Amendment 3 types `kind` as function | struct | enum | class | interface and
// makes no promise about anything else, so `method` gets no noun row (it is
// still swept by rule 1, where the contract does constrain it).
//
// `noun` is rule 3's shape-aware clause. The contract's rule 3 quotes it ending
// in a period; amendment 4 replaces the period with ", after the reference
// material above." and appends a second sentence, so the clause is held here
// WITHOUT its terminator and the full label is assembled from the amendment's
// template below.
const SHAPES = [
  {
    name: "function",
    noun: "The function to implement is below",
    second: "Write that one function.",
    input: { languageId: "rust", languageName: "Rust", signature: "fn err_pool_timeout(&self, gate: &AtomicU64) -> ClientError", docComment: "/// A wait on a semaphore expired." },
  },
  {
    name: "struct",
    noun: "The struct to complete is below",
    second: "Complete that one struct.",
    input: { kind: "struct", languageId: "rust", languageName: "Rust", signature: "pub struct ShardConfig", docComment: "/// Configuration for one shard." },
  },
  {
    name: "enum",
    noun: "The enum to complete is below",
    second: "Complete that one enum.",
    input: { kind: "enum", languageId: "rust", languageName: "Rust", signature: "pub enum DialOutcome", docComment: "/// What a dial attempt produced." },
  },
  {
    name: "class",
    noun: "The class to complete is below",
    second: "Complete that one class.",
    input: { kind: "class", languageId: "python", languageName: "Python", signature: "class ShardConfig:", docComment: "Configuration for one shard." },
  },
  {
    name: "interface",
    noun: "The interface to complete is below",
    second: "Complete that one interface.",
    input: { kind: "interface", languageId: "typescript", languageName: "TypeScript", signature: "export interface ShardConfig", docComment: "/** Configuration for one shard. */" },
  },
  {
    name: "bodyOnly (Python fork A)",
    noun: "The documented header to implement a body for is below",
    second: "Write that one body.",
    input: { bodyOnly: true, languageId: "python", languageName: "Python", signature: "def dial(self, addr: str) -> Shard:", docComment: "Dial one shard by address." },
  },
];

// Amendment 4's template, quoted from the contract:
//   "<noun> is below, after the reference material above. <Write|Complete> that
//    one <noun>."
const MIDDLE = ", after the reference material above. ";
const labelFor = (shape) => `${shape.noun}${MIDDLE}${shape.second}`;

// The label's structural fingerprint. Deliberately wider than either wording:
// the superseded sentence ended "is below." and amendment 4's ends "is below,",
// so matching the phrase itself catches a label written either way, or in some
// third way a later rewrite invents. Verified to have ZERO hits across 240
// no-surface fn-gen prompts and every test-gen prompt, so it is not vacuous and
// it does not collide with anything the assembler already said.
const LABEL_SHAPE = /\bis below\b/;

const sectionsOf = (prompt) => prompt.split(SEP);

const show = (why, prompt) => `${why}\n---- PROMPT ----\n${prompt}\n---- END ----`;

// Every combination rule 1 has to survive: shape x bodyOnly x the three
// developer-supplied legs that could be mistaken for reference material.
function noSurfaceInputs() {
  const out = [];
  const kinds = [undefined, "function", "struct", "enum", "class", "interface", "method"];
  const langs = [
    { languageId: "rust", languageName: "Rust", signature: "fn f(&self) -> u8", docComment: "/// One line." },
    { languageId: "go", languageName: "Go", signature: "func F() (uint8, error)", docComment: "// One line." },
    { languageId: "typescript", languageName: "TypeScript", signature: "export function f(): number", docComment: "/** One line. */" },
    { languageId: "python", languageName: "Python", signature: "def f(self) -> int:", docComment: "One line." },
    { languageId: "csharp", languageName: "C#", signature: "public int F()", docComment: "/// <summary>One line.</summary>" },
  ];
  const extras = [
    { label: "bare", over: {} },
    { label: "contextBlocks", over: { contextBlocks: CTX_BLOCKS } },
    { label: "scaffoldComments", over: { scaffoldComments: SCAFFOLD } },
    { label: "localSymbols", over: { localSymbols: LOCALS } },
    { label: "all three legs", over: { contextBlocks: CTX_BLOCKS, scaffoldComments: SCAFFOLD, localSymbols: LOCALS } },
  ];
  for (const kind of kinds) {
    for (const lang of langs) {
      for (const bodyOnly of [false, true]) {
        for (const extra of extras) {
          out.push({
            label: `kind=${kind ?? "(absent)"} lang=${lang.languageId} bodyOnly=${bodyOnly} ${extra.label}`,
            input: { ...lang, kind, bodyOnly, ...extra.over },
          });
        }
      }
    }
  }
  return out;
}

// ===========================================================================
// Harness sanity. A bundling failure would make every row below a harness bug
// rather than a contract finding, so it is said once, out loud.
// ===========================================================================

test("[BLIND-V74-P2 R0] the P2 surface bundles and exports the five functions the contract names", () => {
  assert.equal(bundleError, undefined, `the bundle failed, so nothing below is a contract finding: ${bundleError && bundleError.message}`);
  assert.equal(typeof assembleFnGenPrompt, "function", "assembleFnGenPrompt(input) => string");
  assert.equal(typeof fnGenPromptShare, "function", "fnGenPromptShare(input) => { developerChars, injectedChars, fixedChars }");
  assert.equal(typeof assembleTestGenPrompt, "function", "assembleTestGenPrompt(input) => string");
  assert.equal(typeof targetLabel, "function", "targetLabel(input) => string | undefined is the contract's named seam for the label");
  assert.equal(typeof renderContextPrefix, "function", "renderContextPrefix(blocks) => string, rule 8's cached HEAD");
  assert.equal(typeof SECTION_SEPARATOR, "string", "SECTION_SEPARATOR is 'the ordinary section separator' rule 2 joins with");
});

test("[BLIND-V74-P2 R0] LABEL_SHAPE really matches a real label, so every absence row below can fail", () => {
  // Rule 1 and the R6-A1 rows assert that NOTHING matches LABEL_SHAPE. If the
  // wording drifted out from under the pattern, all of them would pass while
  // checking nothing. This row is what stops that: the pattern must match the
  // label the assembler actually produces, for every shape, and it must match
  // the superseded wording too so a revert cannot slip past the absence rows.
  for (const shape of SHAPES) {
    const label = targetLabel({ ...shape.input, injectedSurface: SURFACE });
    assert.match(label, LABEL_SHAPE, `${shape.name}: the label detector does not match the real label, so every absence assertion in this file is vacuous: ${JSON.stringify(label)}`);
  }
  assert.match(
    "The function to implement is below. The data shapes and API surfaces above are reference material about other code; do not implement anything from them.",
    LABEL_SHAPE,
    "the detector must also catch the wording amendment 4 superseded, or a revert would read as 'no label'"
  );
});

// ===========================================================================
// Rule 1. No reference material, no label, and no moved bytes.
// ===========================================================================

test("[BLIND-V74-P2 R1] no injected surface means no label section and no targetLabel, across every kind, bodyOnly, and developer leg", () => {
  const cases = noSurfaceInputs();
  assert.ok(cases.length >= 300, `fixture sanity: ${cases.length} no-surface inputs is too thin to call this rule bound`);
  for (const { label, input } of cases) {
    const prompt = assembleFnGenPrompt(input);
    const offending = sectionsOf(prompt).filter((s) => LABEL_SHAPE.test(s));
    assert.deepEqual(
      offending,
      [],
      show(
        `${label}: a label sentence reached a prompt with NO reference material. Rule 1: the label answers a question a prompt with no reference material never raises, and rule 4's sentence claims data shapes are above when none are, which is a lie to the model.\n  offending section(s): ${JSON.stringify(offending)}`,
        prompt
      )
    );
    assert.equal(
      targetLabel(input),
      undefined,
      `${label}: targetLabel must be undefined with no injectedSurface, got ${JSON.stringify(targetLabel(input))}`
    );
  }
});

test("[BLIND-V74-P2 R1] injectedSurface omitted, undefined and \"\" assemble the same bytes, and none of them carries a label", () => {
  for (const { name, input } of SHAPES) {
    const omitted = assembleFnGenPrompt(input);
    assert.equal(
      assembleFnGenPrompt({ ...input, injectedSurface: undefined }),
      omitted,
      `${name}: injectedSurface: undefined moved a byte against omitting the field. Rule 1 says an input with no injected surface assembles byte-for-byte what it assembled before.`
    );
    assert.equal(
      assembleFnGenPrompt({ ...input, injectedSurface: "" }),
      omitted,
      `${name}: injectedSurface: "" moved a byte against omitting the field. An empty surface is no reference material, so it raises no question for a label to answer.`
    );
    assert.equal(targetLabel({ ...input, injectedSurface: "" }), undefined, `${name}: an empty surface must not produce a label`);
    assert.equal(targetLabel({ ...input, injectedSurface: undefined }), undefined, `${name}: an undefined surface must not produce a label`);
  }
});

// ===========================================================================
// Rule 2. With an injected surface, exactly one new section, in one place.
// ===========================================================================

test("[BLIND-V74-P2 R2] the label is the second-to-last section, the injected surface the one before THAT, and everything above is unmoved", () => {
  for (const { name, input } of SHAPES) {
    const withSurface = { ...input, injectedSurface: SURFACE, contextBlocks: CTX_BLOCKS, scaffoldComments: SCAFFOLD, localSymbols: LOCALS };
    const bare = { ...input, contextBlocks: CTX_BLOCKS, scaffoldComments: SCAFFOLD, localSymbols: LOCALS };

    const prompt = assembleFnGenPrompt(withSurface);
    const secs = sectionsOf(prompt);
    const bareSecs = sectionsOf(assembleFnGenPrompt(bare));
    const n = secs.length;
    const m = bareSecs.length;

    // Exactly one new section beyond the injected surface's own.
    assert.equal(
      n,
      m + 2,
      show(
        `${name}: an injected surface must add exactly two sections to this prompt, the surface itself and the ONE new label. Got ${n} sections against ${m} bare.\n  sections: ${JSON.stringify(secs.map((s) => s.slice(0, 60)))}`,
        prompt
      )
    );

    // The order, by index, bottom up.
    assert.equal(
      secs[n - 1],
      bareSecs[m - 1],
      show(`${name}: the final fenced target block changed when a surface was injected. Rule 2: same target block.`, prompt)
    );
    assert.equal(
      secs[n - 2],
      targetLabel(withSurface),
      show(
        `${name}: the section immediately before the final fenced block is not the label targetLabel() reports.\n  got:      ${JSON.stringify(secs[n - 2])}\n  expected: ${JSON.stringify(targetLabel(withSurface))}`,
        prompt
      )
    );
    assert.ok(
      secs[n - 3].includes(SURFACE),
      show(
        `${name}: the injected surface must be the section before the label. Section [${n - 3}] is ${JSON.stringify(secs[n - 3])}`,
        prompt
      )
    );

    // Nothing above moved: same sections, same order, same bytes.
    assert.deepEqual(
      secs.slice(0, n - 3),
      bareSecs.slice(0, m - 1),
      show(
        `${name}: injecting a surface moved something above it. Rule 2: same instruction, same scaffold comments, same local symbols, same order.`,
        prompt
      )
    );

    // The joint is the ordinary separator, not a bespoke one.
    assert.ok(
      prompt.includes(`${SEP}${targetLabel(withSurface)}${SEP}${secs[n - 1]}`),
      show(`${name}: the label is not joined to its neighbours by SECTION_SEPARATOR`, prompt)
    );
  }
});

test("[BLIND-V74-P2 R2] the label appears exactly once in the assembled prompt", () => {
  for (const { name, input } of SHAPES) {
    const withSurface = { ...input, injectedSurface: SURFACE };
    const prompt = assembleFnGenPrompt(withSurface);
    const label = targetLabel(withSurface);
    assert.ok(typeof label === "string" && label.length > 0, `${name}: targetLabel returned ${JSON.stringify(label)} for an input WITH an injected surface`);
    const hits = sectionsOf(prompt).filter((s) => s === label).length;
    assert.equal(hits, 1, show(`${name}: the label section appears ${hits} times, not once`, prompt));
  }
});

// ===========================================================================
// Rule 3. The label is shape-aware.
// ===========================================================================

for (const shape of SHAPES) {
  const { name, noun, input } = shape;
  test(`[BLIND-V74-P2 R3] the noun for ${name} is exactly ${JSON.stringify(noun)}`, () => {
    const withSurface = { ...input, injectedSurface: SURFACE };
    const label = targetLabel(withSurface);
    assert.ok(typeof label === "string", `${name}: no label at all for an input with an injected surface`);
    const first = label.slice(0, noun.length);
    assert.equal(
      first,
      noun,
      `${name}: the label's first clause must name what is being asked for.\n  got:      ${JSON.stringify(label)}\n  expected it to start: ${JSON.stringify(noun)}`
    );
    const prompt = assembleFnGenPrompt(withSurface);
    assert.ok(prompt.includes(noun), show(`${name}: the noun clause never reached the assembled prompt`, prompt));
  });
}

// ===========================================================================
// Rule 4, as amended. Amendment 4 REPLACES rule 4. The label is now:
//
//   "<noun> is below, after the reference material above. <Write|Complete>
//    that one <noun>."
//
// The superseded second sentence ("The data shapes and API surfaces above are
// reference material about other code; do not implement anything from them")
// died on two measured defects, and the R4-A4 rows below pin both shut, because
// they are what comes back if somebody rewrites this sentence again.
// ===========================================================================

for (const shape of SHAPES) {
  const { name, noun, input } = shape;
  test(`[BLIND-V74-P2 R4] the whole label for ${name} is amendment 4's template, verbatim`, () => {
    const withSurface = { ...input, injectedSurface: SURFACE };
    const label = targetLabel(withSurface);
    assert.equal(
      label,
      labelFor(shape),
      `${name}: amendment 4 fixes the whole label.\n  got:      ${JSON.stringify(label)}\n  expected: ${JSON.stringify(labelFor(shape))}`
    );
    const prompt = assembleFnGenPrompt(withSurface);
    assert.ok(prompt.includes(labelFor(shape)), show(`${name}: the label never reached the assembled prompt verbatim`, prompt));
  });
}

test("[BLIND-V74-P2 R4] the label points at the reference material by POSITION: everything it calls \"above\" really is above it", () => {
  // The positive form's whole claim is positional, so that is what gets bound:
  // whatever was injected sits between the instruction and the label, and the
  // target sits after it. Three surfaces, including the example-only leg.
  const dataShape = "Data shape of `ShardConfig`:\nstruct ShardConfig { id: u32 }";
  const example = "Usage example for `ShardConfig`:\nlet c = ShardConfig::new(7);";
  for (const surface of [dataShape, SURFACE, example, `${dataShape}\n${SURFACE}`]) {
    const input = { ...SHAPES[0].input, injectedSurface: surface };
    const prompt = assembleFnGenPrompt(input);
    const label = targetLabel(input);
    const idx = prompt.indexOf(label);
    assert.ok(idx > 0, show(`the label is missing from the prompt for surface ${JSON.stringify(surface.slice(0, 30))}`, prompt));
    assert.ok(
      prompt.slice(0, idx).includes(surface),
      show(`the label says the reference material is ABOVE it, and the injected surface is not above it`, prompt)
    );
    assert.ok(
      prompt.slice(idx + label.length).includes(input.signature),
      show(`the label says the target is BELOW it, and the signature is not below it`, prompt)
    );
  }
});

test("[BLIND-V74-P2 R4-A4] the label NAMES no header: no \"Data shape\", \"data shapes\" or \"API surface\" substring, for any shape", () => {
  // Defect 1 of the superseded wording, pinned shut. "The data shapes and API
  // surfaces above" is FALSE on Rust's example-fallback leg, where resolvePrefill
  // yields a surface whose only header is "Usage example for `X`". A label that
  // names headers has to be re-audited every time the injector grows a new one,
  // and the failure is silent: the model is told to look at something that is
  // not there, and a usage example is runnable code, exactly what a displaced
  // model reaches for.
  const banned = ["Data shape", "data shape", "Data shapes", "data shapes", "API surface", "api surface", "API surfaces", "Usage example", "usage example"];
  for (const shape of SHAPES) {
    const label = targetLabel({ ...shape.input, injectedSurface: SURFACE });
    for (const b of banned) {
      assert.ok(
        !label.includes(b),
        `${shape.name}: the label names the header ${JSON.stringify(b)}. Amendment 4: the label names nothing above it, because the set of headers an injected surface can carry is not fixed.\n  label: ${JSON.stringify(label)}`
      );
    }
  }
});

test("[BLIND-V74-P2 R4-A4] the label FORBIDS nothing: no \"do not\", \"don't\" or \"never\", for any shape", () => {
  // Defect 2 of the superseded wording, pinned shut. "Do not implement anything
  // from them", read literally on the prompt this session came out of, bans the
  // TARGET: the injected surface for the enclosing type lists
  // err_pool_timeout(&self, &AtomicU64) -> ClientError, the function being asked
  // for. A pointer that contradicts itself on the one prompt it was built for is
  // not a pointer. Any prohibition reintroduces the contradiction, so the whole
  // class is banned rather than the one sentence.
  const prohibitions = [/\bdo not\b/i, /\bdon't\b/i, /\bdoes not\b/i, /\bnever\b/i, /\bavoid\b/i, /\bmust not\b/i];
  for (const shape of SHAPES) {
    const label = targetLabel({ ...shape.input, injectedSurface: SURFACE });
    for (const rx of prohibitions) {
      assert.ok(
        !rx.test(label),
        `${shape.name}: the label carries a prohibition matching ${rx}. Amendment 4: the label forbids nothing, because the target itself appears in the injected surface on the motivating prompt, so a prohibition bans the thing being asked for.\n  label: ${JSON.stringify(label)}`
      );
    }
  }
});

test("[BLIND-V74-P2 R4-A4] the example-fallback leg: an injected surface whose only header is \"Usage example for `X`\" still gets a label, in the right place, naming nothing", () => {
  // The shape that made the superseded wording false. A surface with no data
  // shape and no API surface in it at all.
  const EXAMPLE_ONLY = "Usage example for `ShardConfig`:\nlet cfg = ShardConfig::new(7);\nassert_eq!(cfg.id(), 7);";
  for (const shape of SHAPES) {
    const input = { ...shape.input, injectedSurface: EXAMPLE_ONLY };
    const prompt = assembleFnGenPrompt(input);
    const label = targetLabel(input);

    assert.equal(
      label,
      labelFor(shape),
      `${shape.name}: an example-only surface must get the same label as any other surface.\n  got:      ${JSON.stringify(label)}\n  expected: ${JSON.stringify(labelFor(shape))}`
    );

    const secs = sectionsOf(prompt);
    const n = secs.length;
    assert.equal(
      secs[n - 2],
      label,
      show(`${shape.name}: the label is not the section immediately above the target block on the example-fallback leg. Section [${n - 2}] is ${JSON.stringify(secs[n - 2])}`, prompt)
    );
    assert.ok(
      secs[n - 3].includes(EXAMPLE_ONLY),
      show(`${shape.name}: the example surface is not the section above the label. Section [${n - 3}] is ${JSON.stringify(secs[n - 3])}`, prompt)
    );

    // The falsifier for the superseded wording: on this prompt neither named
    // string exists anywhere, so a label that named them pointed at nothing.
    assert.ok(
      !prompt.includes("Data shape of"),
      show(`${shape.name}: this fixture must carry NO "Data shape of" header, or it cannot stand for the example-fallback leg`, prompt)
    );
    assert.ok(
      !prompt.includes("API surface for"),
      show(`${shape.name}: this fixture must carry NO "API surface for" header, or it cannot stand for the example-fallback leg`, prompt)
    );
  }
});

// ===========================================================================
// Rule 5. Accounting stays exact, and the label is fixed.
// ===========================================================================

test("[BLIND-V74-P2 R5] developerChars + injectedChars + fixedChars === assembleFnGenPrompt(input).length, label present and absent", () => {
  const inputs = [];
  for (const { name, input } of SHAPES) {
    for (const surface of [undefined, "", SURFACE, `${SURFACE}\nfn other(x: u8) -> u8`]) {
      for (const over of [
        {},
        { contextBlocks: CTX_BLOCKS },
        { scaffoldComments: SCAFFOLD },
        { localSymbols: LOCALS },
        { contextBlocks: CTX_BLOCKS, scaffoldComments: SCAFFOLD, localSymbols: LOCALS },
      ]) {
        inputs.push({ label: `${name} surface=${surface === undefined ? "absent" : JSON.stringify(surface.slice(0, 20))} ${JSON.stringify(Object.keys(over))}`, input: { ...input, injectedSurface: surface, ...over } });
      }
    }
  }
  for (const { label, input } of inputs) {
    const share = fnGenPromptShare(input);
    const len = assembleFnGenPrompt(input).length;
    const sum = share.developerChars + share.injectedChars + share.fixedChars;
    assert.equal(
      sum,
      len,
      `${label}: the three shares must account for every character of the prompt. ${share.developerChars} + ${share.injectedChars} + ${share.fixedChars} = ${sum}, prompt length ${len}, off by ${sum - len}.`
    );
  }
});

test("[BLIND-V74-P2 R5] the label's characters are charged to fixed: developer unchanged, injected grows by the surface, fixed grows by the label and its joint", () => {
  for (const { name, input } of SHAPES) {
    const bare = { ...input, contextBlocks: CTX_BLOCKS, scaffoldComments: SCAFFOLD, localSymbols: LOCALS };
    const withSurface = { ...bare, injectedSurface: SURFACE };
    const b = fnGenPromptShare(bare);
    const w = fnGenPromptShare(withSurface);
    const label = targetLabel(withSurface);

    assert.equal(
      w.developerChars,
      b.developerChars,
      `${name}: the label is not the developer's bytes, so developerChars must not move (${b.developerChars} -> ${w.developerChars})`
    );
    assert.equal(
      w.injectedChars - b.injectedChars,
      SURFACE.length,
      `${name}: injectedChars must grow by exactly the injected surface and nothing else. The label is structure, not the injected surface's bytes. Grew by ${w.injectedChars - b.injectedChars}, surface is ${SURFACE.length} characters.`
    );
    assert.equal(
      w.fixedChars - b.fixedChars,
      SEP.length + SEP.length + label.length,
      `${name}: fixedChars must absorb the whole of the new label section: the joint before the injected surface (${SEP.length}), the joint before the label (${SEP.length}), and the label itself (${label.length}). Grew by ${w.fixedChars - b.fixedChars}, expected ${SEP.length * 2 + label.length}.`
    );
  }
});

// ===========================================================================
// Rule 6, as amended. The contract's rule 6 ("the test-gen assembler gets the
// same treatment, gated on calleeSurface, with its own noun") is WITHDRAWN by
// Amendment 1 of p2-target-label.md. The test-gen half deliberately does not
// ship, for two reasons and the second is the binding one:
//
//   - it would break the S31 rendering pin (test/review-v31-phase6.test.cjs,
//     "the RUST branch's RENDERING is byte-identical to the pre-phase-6
//     assembler"), which makes it a supersession, and
//   - session-v74 measured the displacement on the GENERATION path only, so
//     that supersession would be bought with speculation.
//
// The shape is real and unsettled: the test-gen prompt still has a labelled
// collaborator surface sitting above an unlabelled target, which is exactly the
// shape that failed 3 of 3 on the generation path. It is carried as D1 in
// session-v74/scraps.md, with session-v74/rig/run-arms.cjs named as the
// instrument that could settle it. That is where the open question lives.
//
// The rows below therefore bind the AMENDMENT, not the withdrawn rule: the
// test-gen prompt must carry NO label, and its final section must still be the
// bare fenced target block. They are the pin on the decision not to ship, so a
// later build cannot ship the test-gen label by accident and call it green.
// Withdrawal is recorded in supersessions.md and scraps.md, not by leaving a
// row permanently red.
// ===========================================================================

const TESTGEN_LANGS = [
  { languageId: "rust", languageName: "Rust", signature: "fn err_pool_timeout(&self, gate: &AtomicU64) -> ClientError", docComment: "/// A wait on a semaphore expired." },
  { languageId: "go", languageName: "Go", signature: "func FetchShard(key string) (Shard, error)", docComment: "// FetchShard dials one shard." },
  { languageId: "typescript", languageName: "TypeScript", signature: "export function fetchShard(key: string): Shard", docComment: "/** Dials one shard. */" },
  { languageId: "python", languageName: "Python", signature: "def fetch_shard(key: str) -> Shard:", docComment: "Dials one shard." },
  { languageId: "csharp", languageName: "C#", signature: "public Shard FetchShard(string key)", docComment: "/// <summary>Dials one shard.</summary>" },
];

test("[BLIND-V74-P2 R6-A1] no calleeSurface means no label section and no moved bytes in the test-gen prompt", () => {
  for (const lang of TESTGEN_LANGS) {
    const omitted = assembleTestGenPrompt(lang);
    const offending = sectionsOf(omitted).filter((s) => LABEL_SHAPE.test(s));
    assert.deepEqual(offending, [], show(`${lang.languageId}: a label reached a test-gen prompt with no callee surface: ${JSON.stringify(offending)}`, omitted));
    assert.equal(
      assembleTestGenPrompt({ ...lang, calleeSurface: undefined }),
      omitted,
      `${lang.languageId}: calleeSurface: undefined moved a byte against omitting the field`
    );
    assert.equal(
      assembleTestGenPrompt({ ...lang, calleeSurface: "" }),
      omitted,
      `${lang.languageId}: calleeSurface: "" moved a byte against omitting the field`
    );
  }
});

test("[BLIND-V74-P2 R6-A1] the test-gen prompt carries NO label, with a calleeSurface or without one", () => {
  // Amendment 1: assembleTestGenPrompt keeps its unlabelled target block. A
  // label appearing here is not an improvement that slipped through, it is an
  // unratified supersession of the S31 rendering pin, bought with a measurement
  // nobody has taken. If this row goes red because the label shipped, the fix
  // is to settle scraps D1 on the rig first, not to edit this row.
  for (const lang of TESTGEN_LANGS) {
    for (const calleeSurface of [undefined, "", SURFACE, `${SURFACE}\nfn other(x: u8) -> u8`]) {
      const prompt = assembleTestGenPrompt({ ...lang, calleeSurface });
      const offending = sectionsOf(prompt).filter((s) => LABEL_SHAPE.test(s));
      assert.deepEqual(
        offending,
        [],
        show(
          `${lang.languageId} calleeSurface=${calleeSurface === undefined ? "absent" : JSON.stringify(calleeSurface.slice(0, 24))}: a target label reached the test-gen prompt. Rule 6 is WITHDRAWN (Amendment 1): shipping it supersedes the S31 rendering pin in test/review-v31-phase6.test.cjs on speculation. The open question is scraps D1.\n  offending section(s): ${JSON.stringify(offending)}`,
          prompt
        )
      );
    }
  }
});

test("[BLIND-V74-P2 R6-A1] the test-gen final section is still the bare fenced target block, straight after the collaborator surface", () => {
  for (const lang of TESTGEN_LANGS) {
    const withSurface = { ...lang, calleeSurface: SURFACE };
    const prompt = assembleTestGenPrompt(withSurface);
    const secs = sectionsOf(prompt);
    const n = secs.length;
    const bareSecs = sectionsOf(assembleTestGenPrompt(lang));
    const m = bareSecs.length;

    // Exactly one new section, the collaborator surface, and nothing beside it.
    assert.equal(
      n,
      m + 1,
      show(
        `${lang.languageId}: a callee surface must add exactly ONE section, itself. Got ${n} sections against ${m} bare, so something else was inserted.\n  sections: ${JSON.stringify(secs.map((s) => s.slice(0, 60)))}`,
        prompt
      )
    );
    assert.ok(
      secs[n - 2].includes(SURFACE),
      show(
        `${lang.languageId}: the collaborator surface must sit immediately above the target block, with nothing between them. Section [${n - 2}] is ${JSON.stringify(secs[n - 2])}`,
        prompt
      )
    );

    // The target block itself: bare, fenced, unchanged by the surface.
    const last = secs[n - 1];
    assert.equal(last, bareSecs[m - 1], show(`${lang.languageId}: the final fenced target block changed when a callee surface was supplied`, prompt));
    const lines = last.split("\n");
    assert.match(lines[0], /^(```|~~~)/, show(`${lang.languageId}: the final section does not open with a fence: ${JSON.stringify(lines[0])}`, prompt));
    assert.equal(lines[lines.length - 1], lines[0].slice(0, 3), show(`${lang.languageId}: the final section does not close with its own fence`, prompt));
    assert.ok(last.includes(lang.signature), show(`${lang.languageId}: the signature is not inside the final fenced block`, prompt));
    assert.ok(last.includes(lang.docComment), show(`${lang.languageId}: the doc comment is not inside the final fenced block`, prompt));
  }
});

// ===========================================================================
// Rule 7. The target block is untouched.
// ===========================================================================

test("[BLIND-V74-P2 R7] the final section is still the fenced target block, with the doc comment and signature inside it, label or no label", () => {
  for (const { name, input } of SHAPES) {
    for (const surface of [undefined, SURFACE]) {
      const prompt = assembleFnGenPrompt({ ...input, injectedSurface: surface });
      const secs = sectionsOf(prompt);
      const last = secs[secs.length - 1];
      const lines = last.split("\n");
      const open = lines[0];
      assert.match(
        open,
        /^(```|~~~)/,
        show(`${name} surface=${!!surface}: the final section does not open with a fence: ${JSON.stringify(open)}`, prompt)
      );
      const fence = open.slice(0, 3);
      assert.equal(
        lines[lines.length - 1],
        fence,
        show(`${name} surface=${!!surface}: the final section does not close with its own fence: ${JSON.stringify(lines[lines.length - 1])}`, prompt)
      );
      assert.ok(
        last.includes(input.signature),
        show(`${name} surface=${!!surface}: the signature is not inside the final fenced block`, prompt)
      );
      assert.ok(
        last.includes(input.docComment),
        show(`${name} surface=${!!surface}: the doc comment is not inside the final fenced block`, prompt)
      );
      assert.ok(!prompt.endsWith("\n"), show(`${name} surface=${!!surface}: a trailing newline appeared after the target block`, prompt));
    }
  }
});

test("[BLIND-V74-P2 R7] the target block is byte-identical with and without the label", () => {
  for (const { name, input } of SHAPES) {
    const bare = { ...input, contextBlocks: CTX_BLOCKS, scaffoldComments: SCAFFOLD, localSymbols: LOCALS };
    const withSurface = { ...bare, injectedSurface: SURFACE };
    const a = sectionsOf(assembleFnGenPrompt(bare)).pop();
    const b = sectionsOf(assembleFnGenPrompt(withSurface)).pop();
    assert.equal(b, a, `${name}: the fenced target block changed when the label was added. Rule 7: fence choice, dedent, language tag, trailing newline, all exactly as before.\n  without label: ${JSON.stringify(a)}\n  with label:    ${JSON.stringify(b)}`);
  }
});

test("[BLIND-V74-P2 R7] the fence still adapts when the doc comment contains a fence, with the label present", () => {
  const fenced = [
    { languageId: "rust", languageName: "Rust", signature: "fn f() -> u8", docComment: "Example:\n```\nf()\n```" },
    { languageId: "python", languageName: "Python", signature: "def f(a: int) -> int:", docComment: "Example:\n```\nf(1)\n```" },
  ];
  for (const input of fenced) {
    for (const surface of [undefined, SURFACE]) {
      const prompt = assembleFnGenPrompt({ ...input, injectedSurface: surface });
      const last = sectionsOf(prompt).pop();
      const open = last.split("\n")[0];
      assert.ok(
        !open.startsWith("```"),
        show(`${input.languageId} surface=${!!surface}: the doc comment carries a bare \`\`\` fence and the block still opens with \`\`\`, so the block closes early: ${JSON.stringify(open)}`, prompt)
      );
      assert.ok(open.startsWith("~~~") || /^`{4,}/.test(open), show(`${input.languageId}: the adapted fence is not a longer or alternate fence: ${JSON.stringify(open)}`, prompt));
      const fence = open.replace(/[a-z#+]*$/i, "");
      assert.equal(last.split("\n").pop(), fence, show(`${input.languageId}: the closing fence does not match the adapted opening fence`, prompt));
      assert.ok(last.includes(input.docComment), show(`${input.languageId}: the fenced doc comment did not survive into the block`, prompt));
    }
  }
});

// ===========================================================================
// Rule 8. The cached prompt HEAD is untouched.
// ===========================================================================

test("[BLIND-V74-P2 R8] renderContextPrefix(blocks) + SECTION_SEPARATOR is still a prefix of the assembled prompt, label or no label", () => {
  for (const { name, input } of SHAPES) {
    for (const surface of [undefined, SURFACE]) {
      const full = { ...input, contextBlocks: CTX_BLOCKS, scaffoldComments: SCAFFOLD, localSymbols: LOCALS, injectedSurface: surface };
      const head = renderContextPrefix(CTX_BLOCKS) + SEP;
      const prompt = assembleFnGenPrompt(full);
      assert.ok(
        prompt.startsWith(head),
        show(
          `${name} surface=${!!surface}: the Claude Code backend checks that the prompt starts with the rendered context head. It does not.\n  expected head: ${JSON.stringify(head)}\n  got:           ${JSON.stringify(prompt.slice(0, head.length))}`,
          prompt
        )
      );
    }
  }
});

test("[BLIND-V74-P2 R8] renderContextPrefix renders context blocks only: no label byte reaches the cached head", () => {
  const prefix = renderContextPrefix(CTX_BLOCKS);
  assert.ok(!LABEL_SHAPE.test(prefix), `the label leaked into the cached head: ${JSON.stringify(prefix)}`);
  assert.equal(renderContextPrefix([]), "", "no blocks renders no bytes");
  assert.equal(renderContextPrefix(undefined), "", "an absent block list renders no bytes");
  for (const b of CTX_BLOCKS) {
    assert.ok(prefix.includes(b.text), `the staged block ${JSON.stringify(b.text)} is missing from the prefix`);
  }
  // The head must not move when a surface is injected below it.
  const input = { ...SHAPES[0].input, contextBlocks: CTX_BLOCKS };
  const a = assembleFnGenPrompt(input);
  const b = assembleFnGenPrompt({ ...input, injectedSurface: SURFACE });
  const head = prefix + SEP;
  assert.equal(b.slice(0, head.length), a.slice(0, head.length), "the cached head differs between the labelled and unlabelled prompt");
});
