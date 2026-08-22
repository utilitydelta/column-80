// Implementer tests for session-v26 phase 3: the lone-separator exemption in
// dropDuplicatedHead (src/core/postprocess.ts). The measured defect
// (`docs/architecture/fim-completion.md`, "The empty-serve separator, and the
// burden of proof on dropping"): at 47 real scoped member sites, all 4
// empty serves had the exact correct separator as the raw stream's first line
// and dropDuplicatedHead deleted it - the fuzzy threshold floors at 1 and
// `;` `,` `)` are each edit distance 1 from `}`. The four captured shapes must
// now survive; an identical separator (a genuine re-spelling of the buffer)
// must still drop; non-separator behavior is untouched.
//
// Run: SKIP_LIVE=1 node --test test/impl-v26-separator.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v26-separator",
  `export { dropDuplicatedHead, postprocess } from "../src/core/postprocess";\n`
);
test.after(cleanup);

const { dropDuplicatedHead, postprocess } = mod;

// Table runner: one body, many cases, each failure named.
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

test("the four captured lone-separator shapes survive the fuzzy duplicate judgement", () => {
  // Each row is one of the 4/47 measured empty serves: the correct separator
  // as the whole ghost, a short closing line as the suffix head, edit
  // distance 1, previously dropped to "".
  table(
    [
      { name: "`;` against `}` (TS getter, 3 of the 4 empties)", text: ";", suffix: "\n}" },
      { name: "`,` against `}`", text: ",", suffix: "\n}" },
      { name: "`)` against `}` (rust tuple close)", text: ")", suffix: "\n                }" },
      { name: "`);` against `});`", text: ");", suffix: "\n});" },
    ],
    ({ text, suffix }) => {
      assert.strictEqual(dropDuplicatedHead(text, suffix), text);
    },
  );
});

test("an identical separator is a genuine re-spelling and still drops", () => {
  table(
    [
      { name: "`}` against `}`", text: "}", suffix: "\n}" },
      { name: "`;` against `;`", text: ";", suffix: ";\n" },
      { name: "`);` against `);`", text: ");", suffix: "\n);" },
      { name: "`)` against indented `)` (trim makes them identical)", text: ")", suffix: "\n        )" },
    ],
    ({ text, suffix }) => {
      assert.strictEqual(dropDuplicatedHead(text, suffix), "");
    },
  );
});

test("controls around the exemption: long lines, near-miss distances, non-separators", () => {
  table(
    [
      // Already passing before the exemption; pins that the change reaches
      // only the fuzzy-drop branch.
      {
        name: "`;` against a long next line keeps passing (distance above threshold)",
        text: ";",
        suffix: '\n            "aggregateType": b.aggregate_type,',
        want: ";",
      },
      {
        name: "`,` against a long next line keeps passing (healthy class-a serve)",
        text: ",",
        suffix: '\n            "aggregateVersion": b.aggregate_version,',
        want: ",",
      },
      {
        name: "`);` against `}` keeps passing (distance 2, never in the fuzzy branch)",
        text: ");",
        suffix: "\n}",
        want: ");",
      },
      // The fuzzy drop itself is untouched for anything that is not a lone
      // separator: a re-typed code line within threshold still dies whole.
      {
        name: "a non-separator head within distance 1 still drops",
        text: "foo(bar);",
        suffix: "\nfoo(bar)",
        want: "",
      },
      {
        name: "a re-typed two-line head within the length-scaled threshold still drops whole",
        text: "const value = compute(a, b);\nreturn value;",
        suffix: "const value = compute(a, b)\nreturn value\n",
        want: "",
      },
    ],
    ({ text, suffix, want }) => {
      assert.strictEqual(dropDuplicatedHead(text, suffix), want);
    },
  );
});

test("a trailing newline or a tail behind the separator does not defeat the exemption", () => {
  table(
    [
      // The filter compares heads and returns the TEXT untouched when exempt;
      // a `,\n` ghost keeps its newline for the filters downstream.
      { name: "`,\\n` against `}`", text: ",\n", suffix: "\n}", want: ",\n" },
      // 3 of the 4 measured raws were "exact correct separator first, then
      // more code". Against a one-line suffix the compared head is the
      // separator line alone, and the exemption keeps the whole completion.
      {
        name: "`,` then more code against `}`",
        text: ",\n        )",
        suffix: "\n}",
        want: ",\n        )",
      },
    ],
    ({ text, suffix, want }) => {
      assert.strictEqual(dropDuplicatedHead(text, suffix), want);
    },
  );
});

// Reworked 2026-07-26 under triage ruling 3, final predicate per the TRIAGE
// re-ruling (loop 3): exempt when the ghost shares no character with the
// suffix line's leading closer run (nothing duplicated), or when that line
// leads with `}` and the ghost carries none (cross-scope). The end-to-end
// rows below drive the MEASURED shapes (all 4 empties had `}` as the next
// suffix line); the invocation-3 capture shape serves via the disjoint
// clause and is pinned further down.
test("end to end at the measured member-site shapes: the separator serves through the whole pipeline", () => {
  // Member-site pipeline shape: multiline false, injection block in the
  // prefix, no bound. Previously served "" (`dropped: empty after
  // postprocess`); the separator must come through every filter.
  const ctx = (suffix) => ({
    suffix,
    currentLinePrefix: "            metadata.log_id",
    multiline: false,
    injectedBlock:
      "// available here (use one of these exact names, do not invent):\n// log_id: u64",
  });
  table(
    [
      { name: "raw is the lone separator (`,` before a `}` line)", raw: ",", suffix: "\n}", want: "," },
      {
        name: "raw is the separator then more code (rust tuple-close capture, measure-emptyserve.md)",
        raw: ")\n                }\n                ClientRequestType::Write => {",
        suffix: "\n                }\n            }\n",
        want: ")",
      },
    ],
    ({ raw, suffix, want }) => {
      assert.strictEqual(postprocess(raw, ctx(suffix)), want);
    },
  );
});

// Added 2026-07-26 under triage ruling 3 (review-p34.md finding 3), re-scoped
// by the TRIAGE re-ruling 2026-07-26 (loop 3) to the final predicate: the
// harm class is a lone separator SHARING a character with the suffix line's
// leading closer run and carrying no leading-`}` cross-scope marker - the
// ghost re-closes what the buffer already closes (`);` over a next line `)`
// double-closes the call). These rows keep that class dead.
test("shared-character harm shapes stay empty serves through the whole pipeline (triage ruling 3)", () => {
  const ctx = (suffix) => ({ suffix, currentLinePrefix: "  ", multiline: true });
  table(
    [
      { name: "`);` over next line `)` (double-closes the call)", raw: ");", suffix: "\n)" },
      { name: "`),` over next line `))`", raw: "),", suffix: "\n))" },
    ],
    ({ raw, suffix }) => {
      assert.strictEqual(postprocess(raw, ctx(suffix)), "");
    },
  );
});

// Flipped under TRIAGE re-ruling 2026-07-26 (loop 3): the disjoint lone
// separator serves - no character of the ghost appears in the suffix line's
// leading closer run, so the dedup has no duplication to drop. The first row
// is the invocation-3 capture pin (capture-2026-07-26.md): the arrowed
// `log_id` comma at its REAL site shape, a suffix opening with a blank line
// then the tuple's `        )` - goal.md's "arrow to a valid field, see
// nothing is the state being outlawed". The second is the same structural
// class at the shape the review modeled.
test("disjoint lone separators serve through the whole pipeline (invocation-3 capture pin)", () => {
  const ctx = (suffix) => ({ suffix, currentLinePrefix: "  ", multiline: true });
  table(
    [
      { name: "capture invocation 3: `,` over a blank line then `        )`", raw: ",", suffix: "\n\n        )", want: "," },
      { name: "`;` over next line `,`", raw: ";", suffix: "\n,", want: ";" },
    ],
    ({ raw, suffix, want }) => {
      assert.strictEqual(postprocess(raw, ctx(suffix)), want);
    },
  );
});

test("end to end, the TS getter shape: `;` before a closing `}` serves", () => {
  // The other measured empty-serve shape, 3 of 4: `return this._theme` with
  // `}` as the next line and `;` as the truth.
  const served = postprocess(";\n  }\n\n  /** next member's doc */", {
    suffix: "\n  }\n}\n",
    currentLinePrefix: "    return this._theme",
    multiline: false,
  });
  assert.strictEqual(served, ";");
});
