// Blind oracle, session-v26 defect class 3: a lone sub-line separator ghost
// (`,` `;` `)` `);`) is the completion honestly finishing the statement, and
// is EXEMPT from the fuzzy head-duplicate drop (edit-distance threshold
// max(1, 0.05*len) against the suffix's first non-blank line). A ghost that
// genuinely re-spells the next suffix line still drops. Written against
// session-v26/goal.md (defect class 3) and session-v26/measure-emptyserve.md
// only; never read src/**.
//
// Binding choice: the bundle re-exports everything from src/core/postprocess
// and the surface is discovered at runtime. Two pipeline-level candidates
// exist, `postprocess` and `postprocessBounded`; `postprocess` is driven
// because the measured drops are member-site serves logged "dropped: empty
// after postprocess" (the base entry), while the bounded variant is the v25
// plain-FIM path, not the captured one. Individual filters (whatever their
// names) are deliberately not driven: the contract is what survives the
// whole pipeline, not which stage does the sparing. Validated pre-fix: the
// current bundle reproduces the measurement byte for byte - the six fix rows
// are red, every control row is green.
//
// Expected red until the v26 exemption ships: the four "captured shape" rows
// drop to "" today (that is the measured bug). The keep-surviving and
// still-drops rows pass today and must stay green.
//
// Run: node --test test/blind-v26-separator.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v26-separator",
  `export * from "../src/core/postprocess";\n`
);
test.after(cleanup);

const exportedFns = Object.keys(mod).filter((k) => typeof mod[k] === "function");

test(`exported surface includes the pipeline entry "postprocess" [discovered: ${exportedFns.join(", ")}]`, () => {
  assert.ok(
    exportedFns.includes("postprocess"),
    `expected an exported "postprocess" among: ${exportedFns.join(", ")}`
  );
});

const postprocess = mod.postprocess;

// Cursor mid-statement inside a block, multi-line generation allowed - the
// scoped member-site request shape the measurement drove.
const ctx = (suffix) => ({ suffix, currentLinePrefix: "  ", multiline: true });

// ---- table: (ghost, suffix, survives?, expected serve when surviving) ----
// Sources: measure-emptyserve.md verbatim captures and bundle verification.

const ROWS = [
  // The four captured shapes: today all drop to "", the fix makes them serve.
  {
    name: "lone ';' finishing a statement survives a '}' next line (TS getter capture)",
    ghost: ";",
    suffix: "\n}",
    survives: true,
    expect: ";",
  },
  {
    name: "lone ',' finishing a field survives a '}' next line",
    ghost: ",",
    suffix: "\n}",
    survives: true,
    expect: ",",
  },
  {
    name: "lone ')' closing an argument list survives a '}' next line (Rust tuple capture)",
    ghost: ")",
    suffix: "\n}",
    survives: true,
    expect: ")",
  },
  {
    name: "lone ');' survives a '});' next line (distance 1 at len 2, today's drop)",
    ghost: ");",
    suffix: "\n});",
    survives: true,
    expect: ");",
  },

  // Keep-surviving controls: these serve today and must not regress.
  {
    name: "lone ';' against a LONG next line keeps surviving (never was a near-duplicate)",
    ghost: ";",
    suffix: "\nconst next = computeNext(alpha, beta);",
    survives: true,
    expect: ";",
  },
  {
    name: "lone ',' against a long struct-field next line keeps surviving (healthy Rust capture)",
    ghost: ",",
    suffix: '\n    "aggregateType": entry.aggregate_type,',
    survives: true,
    expect: ",",
  },
  {
    name: "lone ');' against a bare '}' next line keeps surviving (distance 2, above threshold)",
    ghost: ");",
    suffix: "\n}",
    survives: true,
    expect: ");",
  },
  {
    name: "separator with trailing newline ',\\n' serves the cleaned ','",
    ghost: ",\n",
    suffix: "\n}",
    survives: true,
    expect: ",",
  },

  // Still-drops controls: the rule's real job is untouched.
  {
    name: "ghost '}' that re-spells the '}' next line still drops",
    ghost: "}",
    suffix: "\n}",
    survives: false,
  },
  {
    name: "full duplicated statement line still drops (exact re-type of the suffix)",
    ghost: "return sum;",
    suffix: "\nreturn sum;\n}",
    survives: false,
  },
  {
    name: "fuzzy near-duplicate statement still drops (distance 1 at len 16)",
    ghost: "return this.sum;",
    suffix: "\nreturn this._sum;\n}",
    survives: false,
  },
  {
    name: "non-separator one-character ghost near a similar line keeps today's drop",
    ghost: "x",
    suffix: "\ny",
    survives: false,
  },
];

for (const row of ROWS) {
  test(row.name, () => {
    const out = postprocess(row.ghost, ctx(row.suffix));
    if (row.survives) {
      assert.strictEqual(
        out,
        row.expect,
        `row "${row.name}": ghost ${JSON.stringify(row.ghost)} vs suffix ` +
          `${JSON.stringify(row.suffix)} must serve ${JSON.stringify(row.expect)}, got ${JSON.stringify(out)}`
      );
    } else {
      assert.strictEqual(
        out,
        "",
        `row "${row.name}": ghost ${JSON.stringify(row.ghost)} vs suffix ` +
          `${JSON.stringify(row.suffix)} must still drop to "", got ${JSON.stringify(out)}`
      );
    }
  });
}

// ---- the captured multi-line raw: separator first, real code behind it ----
// measure-emptyserve.md, TS `_mortonCode` capture: raw was ";\n  }\n\n  /**..."
// and the serve was "". After the fix the separator head must survive; the
// suffix-echoing tail behind it stays subject to the other filters, so the
// serve leads with ";" and never re-types the doc comment below the cursor.

test("multi-line raw with a separator head serves the separator, not empty (mortonCode capture)", () => {
  const raw = ";\n}\n\n/** Whether this tile's Morton code is a prefix */";
  const out = postprocess(raw, ctx("\n}"));
  assert.notStrictEqual(out, "", "the measured empty serve: separator head must not be dropped");
  assert.strictEqual(out.split("\n")[0], ";", `serve must lead with the separator, got ${JSON.stringify(out)}`);
  assert.ok(!out.includes("Morton"), "code already below the cursor must not be re-typed");
});

// ---- idempotence of the exemption: serving the separator twice is stable ----

test("a surviving separator serve is idempotent through the pipeline", () => {
  const once = postprocess(";", ctx("\n}"));
  assert.strictEqual(postprocess(once, ctx("\n}")), once);
});

// Added under TRIAGE authority 2026-07-26: capture invocation 3's real site
// shape, goal.md acceptance bar "arrow to a valid field, see nothing is the
// state being outlawed."
test("capture invocation 3: lone ',' survives a suffix opening with a blank line then '        )'", () => {
  const out = postprocess(",", ctx("\n\n        )"));
  assert.strictEqual(
    out,
    ",",
    `the arrowed log_id comma at its real site shape must serve, got ${JSON.stringify(out)}`
  );
});
