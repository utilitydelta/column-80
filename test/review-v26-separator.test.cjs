// Adversarial review tests for session-v26 phases 3+4 (review agent's file,
// not the implementer's). Attack surface: the isLoneSeparator exemption in
// dropDuplicatedHead (src/core/postprocess.ts) - breadth (which one-char junk
// the old rule killed does the exemption resurrect?), the identical-separator
// rule, and composition with the same file's other suffix filters
// (dropDuplicatedHead runs FIRST in dropSuffixRepeats, then the char-level
// overlap trim, then the line-level repeat).
//
// Tests that PIN a hazard rather than a contract say so in their name; the
// findings live in session-v26/review-p34.md.
//
// Run: SKIP_LIVE=1 node --test test/review-v26-separator.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v26-separator",
  `export { dropDuplicatedHead, postprocess } from "../src/core/postprocess";\n`
);
test.after(cleanup);

const { dropDuplicatedHead, postprocess } = mod;

const table = (rows, run) => {
  const bad = [];
  for (const row of rows) {
    try {
      run(row);
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
  }
  if (bad.length) assert.fail(`${bad.length}/${rows.length} cases failed:\n  - ${bad.join("\n  - ")}`);
};

// ---------------------------------------------------------------------------
// R1. Breadth: the junk one-char ghosts the old rule killed must STAY killed.
// The exemption's regex is closer-runs plus one trailing `;`/`,` - openers,
// dots, operators, identifiers, and quote runs are all outside it, so the
// fuzzy drop still owns them.
// ---------------------------------------------------------------------------

test("R1. non-separator one-char ghosts within edit distance 1 still drop: `{` `(` `.` `+` `x` and quote runs", () => {
  table(
    [
      { name: "lone `{` vs `}`", text: "{", suffix: "\n}" },
      { name: "lone `(` vs `)`", text: "(", suffix: "\n)" },
      { name: "lone `.` vs `,`", text: ".", suffix: "\n," },
      { name: "lone `+` vs `)`", text: "+", suffix: "\n)" },
      { name: "one-char identifier `x` vs `y`", text: "x", suffix: "\ny" },
      { name: "double separator `;;` vs `;` (distance 1, regex allows at most one trailing `;`)", text: ";;", suffix: "\n;" },
      { name: "quote run `\"` vs `}` stays with the char-level filter, fuzzy drop keeps it dead here", text: '"', suffix: "\n}" },
      { name: "separator after code `x;` vs `x}` is not separator-only", text: "x;", suffix: "\nx}" },
    ],
    ({ text, suffix }) => {
      assert.strictEqual(dropDuplicatedHead(text, suffix), "");
    },
  );
});

// ---------------------------------------------------------------------------
// R2. The identical-separator rule: a ghost that re-spells the suffix's next
// line byte-for-byte (modulo whitespace, which the compare trims) still
// drops, for every separator shape the exemption admits.
// ---------------------------------------------------------------------------

test("R2. identical separators still drop: `}` `;` `,` `)` `);` `])` against themselves, indentation trimmed", () => {
  table(
    [
      { name: "`}` vs `}`", text: "}", suffix: "\n}" },
      { name: "`;` vs `;`", text: ";", suffix: "\n;" },
      { name: "`,` vs `,`", text: ",", suffix: "\n," },
      { name: "`)` vs `)`", text: ")", suffix: "\n)" },
      { name: "`);` vs `);`", text: ");", suffix: "\n);" },
      { name: "`])` vs `])`", text: "])", suffix: "\n])" },
      { name: "indented ghost `    }` vs `}` (trim makes them identical)", text: "    }", suffix: "\n}" },
      { name: "ghost `}` vs indented suffix `        }`", text: "}", suffix: "\n        }" },
    ],
    ({ text, suffix }) => {
      assert.strictEqual(dropDuplicatedHead(text, suffix), "");
    },
  );
});

// ---------------------------------------------------------------------------
// R3. Flipped 2026-07-26 under triage ruling 3 (review-p34.md finding 3; the
// reviewer pre-announced the flip), then re-scoped by the TRIAGE re-ruling
// 2026-07-26 (loop 3) to the final predicate: a lone separator SHARING a
// character with the suffix line's leading closer run, with no leading `}`
// cross-scope marker, is a genuine double-close and drops. The two rows here
// share `)` with the buffer's own closer (`);` over `)` double-closes the
// call) and stay dead.
// ---------------------------------------------------------------------------

test("R3. shared-character harm shapes stay dropped: `);` over `)` and `),` over `))` end empty", () => {
  const ctx = (suffix) => ({ suffix, currentLinePrefix: "  ", multiline: true });
  table(
    [
      { name: "`);` vs next line `)` drops (double-close harm)", text: ");", suffix: "\n)" },
      { name: "`),` vs next line `))` drops", text: "),", suffix: "\n))" },
    ],
    ({ text, suffix }) => {
      assert.strictEqual(postprocess(text, ctx(suffix)), "",
        "pipeline-level: a separator sharing a character with the buffer's own closer run must not be spared");
    },
  );
});

// Flipped back under TRIAGE re-ruling 2026-07-26 (loop 3): no character
// duplicated, same structural class as the ratified capture row
// (capture-2026-07-26.md invocation 3); the dedup drops duplication, not
// wrongness; contract outranks an unmeasured review row.
test("R3. disjoint lone separator serves: `;` over next line `,` shares no character with the closer run", () => {
  const ctx = (suffix) => ({ suffix, currentLinePrefix: "  ", multiline: true });
  assert.strictEqual(postprocess(";", ctx("\n,")), ";",
    "no character of the ghost appears in the suffix line's leading closer run, so nothing is duplicated");
});

test("R3b. the ladders the OTHER filters still catch: brace-led and paren-led near-miss runs end empty, not served", () => {
  const ctx = (suffix) => ({ suffix, currentLinePrefix: "  ", multiline: true });
  table(
    [
      // limitToEnclosingBlock cuts `})` to `}`, then the char-level trim eats
      // the whole-completion overlap of the suffix head.
      { name: "`})` vs next line `}]` ends empty", text: "})", suffix: "\n}]" },
      { name: "`}}}` vs next line `}}` ends empty", text: "}}}", suffix: "\n}}" },
      // The char-level trim peels the paren run to nothing.
      { name: "`))` vs next line `)]` ends empty", text: "))", suffix: "\n)]" },
    ],
    ({ text, suffix }) => {
      assert.strictEqual(postprocess(text, ctx(suffix)), "");
    },
  );
});

// ---------------------------------------------------------------------------
// R4. Composition with the char-level trim: where the exemption keeps a
// separator whose text IS the suffix's head, the char-level filter still eats
// it, so the pipeline cannot double-serve a character the buffer already has
// at the cursor. (dropDuplicatedHead runs first; dropCharLevelSuffixOverlap
// consumes a whole-completion overlap unconditionally.)
// ---------------------------------------------------------------------------

test("R4. exemption-then-char-level: a separator the buffer already owns at the cursor still ends empty, not doubled", () => {
  const ctx = (suffix) => ({ suffix, currentLinePrefix: "  ", multiline: true });
  table(
    [
      // dropDuplicatedHead: `}` vs `};` is distance 1, exempted (non-identical).
      // Char-level: completion `}` is a whole-completion overlap of suffix head
      // `};` - eaten. Net "" either way, never a doubled `}`.
      { name: "`}` vs suffix head `};`", text: "}", suffix: "};", want: "" },
      // Same shape one closer deeper.
      { name: "`)` vs suffix head `),`", text: ")", suffix: "),", want: "" },
    ],
    ({ text, suffix, want }) => {
      assert.strictEqual(postprocess(text, ctx(suffix)), want);
    },
  );
});

// ---------------------------------------------------------------------------
// R5. Multi-line reach: the compare concatenates up to 3 lines, so a ghost
// whose HEAD LINES are all closers reads as one "lone separator" even split
// across lines. The measured class is single-line; this pins how far past it
// the exemption reaches, both directions.
// ---------------------------------------------------------------------------

// Flipped 2026-07-26 under triage ruling 3 (pre-announced by the reviewer),
// grounding re-stated on the final predicate (TRIAGE re-ruling, loop 3): the
// `}\n)` ladder concatenates to `})`, which shares `}` with the suffix
// line's leading closer run `}]` - a duplicated character - and its own `}`
// disqualifies the cross-scope clause, so neither exempt shape reaches it.
test("R5. multi-line closer ladders: identical ladders still drop, and a `}`-carrying near-miss ladder now drops too", () => {
  table(
    [
      // Concatenated identical: `}` + `)` both sides -> `})` === `})` -> drops.
      { name: "ghost `}\\n)` vs suffix `}\\n)` drops (identical concat)", text: "}\n)", suffix: "\n}\n)", want: "" },
      // Concatenated near-miss: `})` vs `}]` distance 1, but the ghost carries
      // `}` and the exemption no longer reaches it.
      { name: "ghost `}\\n)` vs suffix `}\\n]` drops (ghost contains `}`)", text: "}\n)", suffix: "\n}\n]", want: "" },
    ],
    ({ text, suffix, want }) => {
      assert.strictEqual(dropDuplicatedHead(text, suffix), want);
    },
  );
});

// ---------------------------------------------------------------------------
// R6. The four measured shapes plus the healthy control, driven through the
// FULL pipeline in the member-site request shape (multiline false, injection
// block present) - the exemption must survive composition with the
// single-line collapse and the injection-echo strip, not just the bare
// filter. Mirrors the capture context byte shapes from measure-emptyserve.md.
// ---------------------------------------------------------------------------

test("R6. measured shapes survive the full member-site pipeline (single-line collapse + injected block present)", () => {
  const ctx = (suffix) => ({
    suffix,
    currentLinePrefix: "            metadata.log_id",
    multiline: false,
    injectedBlock: "// available here (use one of these exact names, do not invent):\n// log_id: u64",
  });
  table(
    [
      { name: "`;` vs `}`", raw: ";", suffix: "\n}", want: ";" },
      { name: "`,` vs `}`", raw: ",", suffix: "\n}", want: "," },
      { name: "`)` vs deep-indented `}`", raw: ")", suffix: "\n                }", want: ")" },
      { name: "`);` vs `});`", raw: ");", suffix: "\n});", want: ");" },
      // Flipped back under TRIAGE re-ruling 2026-07-26 (loop 3): the `,`
      // shares no character with the suffix line's leading closer run `)`,
      // so nothing is duplicated and the disjoint clause serves it - the
      // invocation-3 capture's own class (the intermediate `}`-only
      // narrowing had dropped it).
      { name: "separator then more code collapses to the separator line (capture class)", raw: ",\n            metadata.read,", suffix: "\n\n        )", want: "," },
    ],
    ({ raw, suffix, want }) => {
      assert.strictEqual(postprocess(raw, ctx(suffix)), want);
    },
  );
});
