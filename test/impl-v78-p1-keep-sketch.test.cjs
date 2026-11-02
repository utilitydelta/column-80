// keepSketch: the developer's sketch comments survive fn-gen's reply.
//
// White-box over the pure step. Every row runs through one contract helper
// that checks the invariants that hold for any input (round trip as an
// in-order subsequence, the reply untouched, idempotence, line endings), then
// the row asserts its own exact text. A seeded generator at the bottom states
// the same laws over replies built by dropping, reordering and rewording
// sketch lines.
//
// Run: SKIP_LIVE=1 node --test test/impl-v78-p1-keep-sketch.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v78-p1-keep-sketch",
  [
    `export { keepSketch } from "../src/core/scaffoldKeep";`,
    `export { harvestBodyComments, bodyTextOfSpan } from "../src/core/scaffold";`,
    "",
  ].join("\n"),
);
test.after(cleanup);

const { keepSketch, harvestBodyComments, bodyTextOfSpan } = mod;

function harvestOf(text, languageId, bodyOnly, bodyIndent) {
  return harvestBodyComments(bodyTextOfSpan(text, languageId, bodyOnly ?? false), languageId, bodyIndent ?? "")
    .comments;
}

// `hay` with the in-order occurrences of `needle` taken out.
function withoutInOrder(hay, needle) {
  const out = [];
  let j = 0;
  for (const line of hay) {
    if (j < needle.length && line === needle[j]) {
      j++;
    } else {
      out.push(line);
    }
  }
  return out;
}

function isSubsequence(needle, hay) {
  let j = 0;
  for (const line of hay) {
    if (j < needle.length && line === needle[j]) {
      j++;
    }
  }
  return j === needle.length;
}

// Splits keeping the terminator, so a CRLF line and an LF line differ.
function linesOf(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}
function contentOf(line) {
  return line.replace(/\r?\n$/, "");
}

// Runs keepSketch and asserts every law that holds regardless of the row.
function keep(input) {
  const result = keepSketch(input);
  const { languageId, originalSpan, reply, bodyOnly, bodyIndent } = input;
  const sketch = harvestOf(originalSpan, languageId, bodyOnly, bodyIndent);
  const label = JSON.stringify(input);

  assert.deepStrictEqual(result.stripped, [], `rule 5, stripped is always empty: ${label}`);
  if (sketch.length === 0) {
    assert.strictEqual(result.text, reply, `rule 1: ${label}`);
    assert.strictEqual(result.keptByModel, 0);
    assert.deepStrictEqual(result.placedByTool, []);
    assert.deepStrictEqual(result.unplaced, []);
    return result;
  }
  // Rule 9: unplaced lines are a slotless reply's, and leave the text alone.
  assert.ok(isSubsequence(result.unplaced, sketch), `rule 9, unplaced is part of the sketch: ${label}`);
  if (result.unplaced.length > 0) {
    assert.strictEqual(result.text, reply, `rule 9, an unplaced line leaves the text as the reply: ${label}`);
    assert.deepStrictEqual(result.placedByTool, [], `rule 9, no slot means nothing placed: ${label}`);
  }
  const landing = withoutInOrder(sketch, result.unplaced);
  const harvest = harvestOf(result.text, languageId, bodyOnly, bodyIndent);
  assert.ok(isSubsequence(landing, harvest), `rule 2: ${JSON.stringify({ landing, harvest, text: result.text })}`);
  assert.strictEqual(
    result.keptByModel + result.placedByTool.length + result.unplaced.length,
    sketch.length,
    `kept + placed + unplaced = sketch: ${label}`,
  );

  // Rule 6: the reply's lines are an in-order subsequence of the result's, byte
  // for byte, and every other result line is a placed comment line.
  const replyLines = linesOf(reply).map(contentOf);
  const textLines = linesOf(result.text).map(contentOf);
  const added = [];
  let r = 0;
  for (const line of textLines) {
    if (r < replyLines.length && line === replyLines[r]) {
      r++;
    } else {
      added.push(line);
    }
  }
  if (r === replyLines.length) {
    assert.deepStrictEqual(
      harvestBodyComments(added.join("\n"), languageId, "").comments,
      result.placedByTool,
      `rule 6, the added lines are exactly the placed comments: ${JSON.stringify(added)}`,
    );
  } else {
    // Rule 9 revised: a slot was made by line breaks. Without the placed comment
    // lines, no non-whitespace character of the reply changed.
    let k = 0;
    const rest = textLines.filter((line) => {
      const c = harvestBodyComments(line, languageId, "").comments;
      if (k < result.placedByTool.length && c.length === 1 && c[0] === result.placedByTool[k]) {
        k++;
        return false;
      }
      return true;
    });
    assert.strictEqual(k, result.placedByTool.length, `rule 6, every placed line is a line of its own: ${JSON.stringify(result.text)}`);
    assert.strictEqual(
      rest.join("").replace(/\s+/g, ""),
      reply.replace(/\s+/g, ""),
      `rule 6 revised, only whitespace of the reply changed: ${JSON.stringify(result.text)}`,
    );
  }

  // Rule 8.
  if (reply.includes("\r\n")) {
    assert.ok(!/[^\r]\n/.test(result.text) && !result.text.startsWith("\n"), `rule 8, CRLF throughout: ${label}`);
  }

  // Rule 7.
  const again = keepSketch({ ...input, reply: result.text });
  assert.deepStrictEqual(
    again,
    {
      text: result.text,
      keptByModel: sketch.length - result.unplaced.length,
      placedByTool: [],
      stripped: [],
      unplaced: result.unplaced,
    },
    `rule 7, a second run is a no-op: ${label}`,
  );
  return result;
}

// ---------------------------------------------------------------------------
// The harvest's own behaviour on trailing comments, pinned here because the
// placement logic treats a trailing-comment line as code that carries a kept
// sketch line.
// ---------------------------------------------------------------------------

const TRAILING = {
  rust: "fn f() {\n    let a = compute(); // trailing note\n}",
  typescript: "function f() {\n  const a = compute(); // trailing note\n}",
  javascript: "function f() {\n  const a = compute(); // trailing note\n}",
  csharp: "void F()\n{\n    var a = Compute(); // trailing note\n}",
  go: "func F() {\n\ta := compute() // trailing note\n}",
  python: "def f():\n    a = compute() # trailing note\n",
};
for (const [languageId, span] of Object.entries(TRAILING)) {
  test(`${languageId}: the harvest picks up a trailing comment on a body-depth code line`, () => {
    assert.deepStrictEqual(harvestOf(span, languageId), ["trailing note"]);
  });
}

// ---------------------------------------------------------------------------
// The flagship: four steps sketched, the model writes the body.
// ---------------------------------------------------------------------------

const RUST_SKETCH =
  "fn main() {\n// say hello world\n// get two numbers from user\n// use the add function\n// dump the output\n}";

test("rust: a reply that kept every sketch line verbatim comes back byte-identical", () => {
  const reply =
    "fn main() {\n    // say hello world\n    println!(\"hello\");\n    // get two numbers from user\n    let a = read();\n    let b = read();\n    // use the add function\n    let c = add(a, b);\n    // dump the output\n    println!(\"{}\", c);\n}";
  const r = keep({ languageId: "rust", originalSpan: RUST_SKETCH, reply });
  assert.deepStrictEqual(r, { text: reply, keptByModel: 4, placedByTool: [], stripped: [], unplaced: [] });
});

test("rust: a reply that dropped every comment gets all four stacked above the first statement, original bytes", () => {
  const reply = "fn main() {\n    println!(\"hello\");\n    let c = add(read(), read());\n    println!(\"{}\", c);\n}";
  const r = keep({ languageId: "rust", originalSpan: RUST_SKETCH, reply });
  assert.strictEqual(
    r.text,
    "fn main() {\n    // say hello world\n    // get two numbers from user\n    // use the add function\n    // dump the output\n    println!(\"hello\");\n    let c = add(read(), read());\n    println!(\"{}\", c);\n}",
  );
  assert.strictEqual(r.keptByModel, 0);
  assert.deepStrictEqual(r.placedByTool, [
    "say hello world",
    "get two numbers from user",
    "use the add function",
    "dump the output",
  ]);
});

test("rust: a missing middle line lands before the first statement after the previous kept line", () => {
  const reply =
    "fn main() {\n    // say hello world\n    // greeting done\n    println!(\"hello\");\n    let a = read();\n    // use the add function\n    let c = add(a, a);\n    // dump the output\n    println!(\"{}\", c);\n}";
  const r = keep({ languageId: "rust", originalSpan: RUST_SKETCH, reply });
  assert.strictEqual(
    r.text,
    "fn main() {\n    // say hello world\n    // greeting done\n    // get two numbers from user\n    println!(\"hello\");\n    let a = read();\n    // use the add function\n    let c = add(a, a);\n    // dump the output\n    println!(\"{}\", c);\n}",
  );
  assert.strictEqual(r.keptByModel, 3);
});

test("rust: a missing line never jumps past the next kept sketch line, even with no statement between", () => {
  const span = "fn f() {\n    // a\n    // x\n    // b\n}";
  const reply = "fn f() {\n    // a\n    // b\n    go();\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.strictEqual(r.text, "fn f() {\n    // a\n    // x\n    // b\n    go();\n}");
});

test("rust: out-of-order lines keep the longest in-order run and place the rest", () => {
  const span = "fn f() {\n    // one\n    // two\n    // three\n}";
  const reply = "fn f() {\n    // three\n    a();\n    // one\n    b();\n    // two\n    c();\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.strictEqual(r.keptByModel, 2);
  assert.deepStrictEqual(r.placedByTool, ["three"]);
  assert.strictEqual(
    r.text,
    "fn f() {\n    // three\n    a();\n    // one\n    b();\n    // two\n    // three\n    c();\n}",
  );
});

test("rust: no statement after the previous sketch line places at the end of the body, at the code indent", () => {
  const span = "fn f() {\n  // build\n  // finish\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply: "fn f() {\n    let x = 1; // build\n}" });
  assert.strictEqual(r.text, "fn f() {\n    let x = 1; // build\n    // finish\n}");
  assert.strictEqual(r.keptByModel, 1);
});

test("rust: an empty reply body takes the original comment indent", () => {
  const span = "fn f() {\n  // only\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply: "fn f() {\n}" });
  assert.strictEqual(r.text, "fn f() {\n  // only\n}");
});

test("rust: a comment nested in a block is not a kept sketch line, and is left alone", () => {
  const span = "fn f() {\n    // check\n}";
  const reply = "fn f() {\n    if ok() {\n        // check\n        go();\n    }\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.strictEqual(r.text, "fn f() {\n    // check\n    if ok() {\n        // check\n        go();\n    }\n}");
  assert.strictEqual(r.keptByModel, 0);
});

test("python: a continuation line inside brackets is not a placement target, the next statement is", () => {
  const span = "def f():\n    # one\n    # two\n";
  const reply = "def f():\n    x = g(  # one\n    1)\n    y = 2\n";
  const r = keep({ languageId: "python", originalSpan: span, reply });
  assert.strictEqual(r.text, "def f():\n    x = g(  # one\n    1)\n    # two\n    y = 2\n");
});

test("typescript: a template literal's inner line is not a placement target", () => {
  const span = "function f() {\n  // one\n  // two\n}";
  const reply = "function f() {\n  const s = g(1) + `a ${x} // one\n  b`;\n  y();\n}";
  const r = keep({ languageId: "typescript", originalSpan: span, reply });
  // `// one` sits inside the literal, so nothing is kept and both stack above
  // the first statement; the literal's second line is never chosen.
  assert.strictEqual(r.text, "function f() {\n  // one\n  // two\n  const s = g(1) + `a ${x} // one\n  b`;\n  y();\n}");
  assert.strictEqual(r.keptByModel, 0);
});

test("typescript: a sketch line kept after a multi-line statement anchors past the statement's inner lines", () => {
  const span = "function f() {\n  // one\n  // two\n}";
  const reply = "function f() {\n  const s = `a\n  b`; // one\n  y();\n}";
  const r = keep({ languageId: "typescript", originalSpan: span, reply });
  assert.strictEqual(r.text, "function f() {\n  const s = `a\n  b`; // one\n  // two\n  y();\n}");
});

test("rust: a sketch line kept as a trailing comment counts as kept and anchors the next one", () => {
  const span = "fn f() {\n    // read\n    // write\n}";
  const reply = "fn f() {\n    let x = read(); // read\n    write(x);\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.strictEqual(r.text, "fn f() {\n    let x = read(); // read\n    // write\n    write(x);\n}");
  assert.strictEqual(r.keptByModel, 1);
});

test("rust: a sketch typed as a trailing comment is placed as the comment alone, not the code", () => {
  const span = "fn f() {\n    todo!(); // the plan\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply: "fn f() {\n    go();\n}" });
  assert.strictEqual(r.text, "fn f() {\n    // the plan\n    go();\n}");
});

// ---------------------------------------------------------------------------
// Rule 5: the model's own comments stay, and a reworded line does not count.
// ---------------------------------------------------------------------------

test("rust: a comment the model added stays where it is and is not reported", () => {
  const span = "fn f() {\n    // read it\n}";
  const reply = "fn f() {\n    // read it\n    let x = read();\n    // model note\n    use_it(x); // trailing model note\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.deepStrictEqual(r, { text: reply, keptByModel: 1, placedByTool: [], stripped: [], unplaced: [] });
});

test("rust: a reworded sketch line counts as not kept; the original is placed and the reword stays", () => {
  const span = "fn f() {\n    // read the input\n}";
  const reply = "fn f() {\n    // Read the input.\n    let x = read();\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.strictEqual(r.text, "fn f() {\n    // Read the input.\n    // read the input\n    let x = read();\n}");
  assert.deepStrictEqual(r.placedByTool, ["read the input"]);
});

test("rust: decoration differences still match, because the comparison is on the harvest's rendering", () => {
  const span = "fn f() {\n    //   step one  \n}";
  const reply = "fn f() {\n    /// step one\n    go();\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.strictEqual(r.text, reply);
  assert.strictEqual(r.keptByModel, 1);
});

// ---------------------------------------------------------------------------
// Rule 1.
// ---------------------------------------------------------------------------

const NO_SKETCH = [
  ["rust", "fn f() {\n    todo!()\n}", "fn f() {\n    // model\n    go();\n}"],
  ["typescript", "function f() {\n  if (x) {\n    // nested only\n  }\n}", "function f() {\n  // model\n}"],
  ["python", "def f():\n    pass\n", "def f():\n    # model\n    return 1\n"],
  ["go", "func F() {\n}", "func F() {\n\t// model\n}"],
  ["csharp", "void F()\n{\n}", "void F()\n{\n    // model\n}"],
];
for (const [languageId, originalSpan, reply] of NO_SKETCH) {
  test(`${languageId}: no sketch returns the reply byte-identical, comments and all`, () => {
    assert.deepStrictEqual(keep({ languageId, originalSpan, reply }), {
      text: reply,
      keptByModel: 0,
      placedByTool: [],
      stripped: [],
      unplaced: [],
    });
  });
}

// ---------------------------------------------------------------------------
// Per-language shapes.
// ---------------------------------------------------------------------------

const PER_LANGUAGE = [
  {
    name: "typescript",
    languageId: "typescript",
    originalSpan: "function f(a: number): number {\n  // double it\n  // return\n}",
    reply: "function f(a: number): number {\n  const b = a * 2;\n  return b;\n}",
    want: "function f(a: number): number {\n  // double it\n  // return\n  const b = a * 2;\n  return b;\n}",
  },
  {
    name: "javascript",
    languageId: "javascript",
    originalSpan: "function f(a) {\n  // double it\n}",
    reply: "function f(a) {\n  return `x\n${a}`;\n}",
    want: "function f(a) {\n  // double it\n  return `x\n${a}`;\n}",
  },
  {
    name: "go with tabs",
    languageId: "go",
    originalSpan: "func F(a int) int {\n\t// double it\n\t// return\n}",
    reply: "func F(a int) int {\n\t// double it\n\tb := a * 2\n\treturn b\n}",
    want: "func F(a int) int {\n\t// double it\n\t// return\n\tb := a * 2\n\treturn b\n}",
  },
  {
    name: "csharp, brace on its own line",
    languageId: "csharp",
    originalSpan: "public int F(int a)\n{\n    // double it\n}",
    reply: "public int F(int a)\n{\n    var b = a * 2;\n    return b;\n}",
    want: "public int F(int a)\n{\n    // double it\n    var b = a * 2;\n    return b;\n}",
  },
  {
    name: "csharp, a block comment sketch placed as written",
    languageId: "csharp",
    originalSpan: "void F()\n{\n        /* first\n         * second */\n}",
    reply: "void F()\n{\n    Go();\n}",
    want: "void F()\n{\n    /* first\n     * second */\n    Go();\n}",
  },
  {
    name: "python full span, docstring stays first",
    languageId: "python",
    originalSpan: "def f(a):\n    # double it\n    # return\n",
    reply: "def f(a):\n    \"\"\"Doubles.\n    Really.\n    \"\"\"\n    b = a * 2\n    return b\n",
    want: "def f(a):\n    \"\"\"Doubles.\n    Really.\n    \"\"\"\n    # double it\n    # return\n    b = a * 2\n    return b\n",
  },
  {
    name: "python full span, end of body with no trailing newline",
    languageId: "python",
    originalSpan: "def f(a):\n    # setup\n    # finish\n",
    reply: "def f(a):\n    b = a  # setup",
    want: "def f(a):\n    b = a  # setup\n    # finish",
  },
  {
    name: "python bodyOnly with bodyIndent",
    languageId: "python",
    bodyOnly: true,
    bodyIndent: "        ",
    originalSpan: "        # double it\n        # return\n",
    reply: "        b = a * 2\n        if b:\n            c = 1\n        return b\n",
    want: "        # double it\n        # return\n        b = a * 2\n        if b:\n            c = 1\n        return b\n",
  },
  {
    name: "python bodyOnly, derived indent, middle line placed",
    languageId: "python",
    bodyOnly: true,
    originalSpan: "    # one\n    # two\n",
    reply: "    # one\n    y = 2\n",
    want: "    # one\n    # two\n    y = 2\n",
  },
];
for (const row of PER_LANGUAGE) {
  test(`${row.name}: placed lines land at body depth, at the target line's indent`, () => {
    const { name, want, ...input } = row;
    assert.strictEqual(keep(input).text, want);
  });
}

test("rust: CRLF replies keep CRLF on every line, inserted ones included", () => {
  const span = "fn f() {\r\n    // a\r\n    // b\r\n}";
  const reply = "fn f() {\r\n    // a\r\n    x();\r\n    y();\r\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.strictEqual(r.text, "fn f() {\r\n    // a\r\n    // b\r\n    x();\r\n    y();\r\n}");
});

test("rust: a block-comment sketch partly echoed is placed whole", () => {
  const span = "fn f() {\n    /* a\n       b */\n}";
  const reply = "fn f() {\n    // b\n    go();\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.strictEqual(r.keptByModel, 0);
  assert.deepStrictEqual(r.placedByTool, ["a", "b"]);
});

// ---------------------------------------------------------------------------
// Generated: the laws over replies built from the sketch by dropping,
// reordering, rewording and adding comments. Seeded, so a failure replays.
// ---------------------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const SHAPES = {
  rust: { open: "fn f() {", close: "}", indent: "    ", c: "//", stmt: (i) => `let v${i} = g(${i});`, nest: (i) => [`if v${i} > 0 {`, `    // inner ${i}`, `    h();`, `}`] },
  go: { open: "func F() {", close: "}", indent: "\t", c: "//", stmt: (i) => `v${i} := g(${i})`, nest: (i) => [`if v${i} > 0 {`, `\t// inner ${i}`, `\th()`, `}`] },
  python: { open: "def f():", close: null, indent: "    ", c: "#", stmt: (i) => `v${i} = g(${i})`, nest: (i) => [`if v${i}:`, `    # inner ${i}`, `    h()`] },
  csharp: { open: "void F() {", close: "}", indent: "    ", c: "//", stmt: (i) => `var v${i} = G(${i});`, nest: (i) => [`if (v${i} > 0) {`, `    // inner ${i}`, `    H();`, `}`] },
};

for (const [languageId, shape] of Object.entries(SHAPES)) {
  test(`${languageId}: generated replies hold rules 2, 5, 6, 7 and 8`, () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rand = rng(seed * 7919 + languageId.length);
      const n = 1 + Math.floor(rand() * 5);
      const steps = Array.from({ length: n }, (_, i) => `step ${i} do thing`);
      const eol = rand() < 0.2 ? "\r\n" : "\n";
      const body = steps.map((s) => `${shape.indent}${shape.c} ${s}`);
      const originalSpan = [shape.open, ...body, ...(shape.close ? [shape.close] : [])].join(eol);
      // The model's comment sequence: a shuffled, thinned, partly reworded copy.
      const echoed = steps
        .filter(() => rand() < 0.6)
        .map((s) => (rand() < 0.15 ? s.toUpperCase() : s));
      if (rand() < 0.3 && echoed.length > 1) {
        echoed.reverse();
      }
      const lines = [];
      let k = 0;
      for (let i = 0; i < 6; i++) {
        if (k < echoed.length && rand() < 0.6) {
          lines.push(`${shape.indent}${shape.c} ${echoed[k++]}`);
        }
        if (rand() < 0.2) {
          lines.push(`${shape.indent}${shape.c} model extra ${i}`);
        }
        if (rand() < 0.25) {
          lines.push(...shape.nest(i).map((l) => shape.indent + l));
        } else {
          lines.push(shape.indent + shape.stmt(i) + (rand() < 0.15 ? ` ${shape.c} trailing ${i}` : ""));
        }
      }
      while (k < echoed.length) {
        lines.push(`${shape.indent}${shape.c} ${echoed[k++]}`);
      }
      const reply = [shape.open, ...lines, ...(shape.close ? [shape.close] : [])].join(eol);
      try {
        keep({ languageId, originalSpan, reply });
      } catch (e) {
        e.message = `seed ${seed}: ${e.message}`;
        throw e;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Rows that pin the edges the placement relies on.
// ---------------------------------------------------------------------------

test("python: a nested line after the anchor is not a target; the next body-indent statement is", () => {
  const span = "def f():\n    # one\n    # two\n";
  const reply = "def f():\n    if x:  # one\n        y()\n    z()\n";
  const r = keep({ languageId: "python", originalSpan: span, reply });
  assert.strictEqual(r.text, "def f():\n    if x:  # one\n        y()\n    # two\n    z()\n");
});

test("rust: a closing brace inside a string literal is not the body's end", () => {
  const span = "fn f() {\n    // a\n    // b\n}";
  const reply = "fn f() {\n    let s = \"}\"; // a\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.strictEqual(r.text, "fn f() {\n    let s = \"}\"; // a\n    // b\n}");
});

test("rust: two kept lines sharing one line leave no slot between them, so every line is placed by the tool", () => {
  const span = "fn f() {\n    // a\n    // x\n    // b\n}";
  const reply = "fn f() {\n    /* a */ go(); // b\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.strictEqual(r.text, "fn f() {\n    // a\n    // x\n    // b\n    /* a */ go(); // b\n}");
  assert.strictEqual(r.keptByModel, 0);
  assert.deepStrictEqual(r.placedByTool, ["a", "x", "b"]);
});

// ---------------------------------------------------------------------------
// Rule 9 revised: a reply whose body shares a line with its opener gets a slot
// made by line breaks. Each row asserts the exact text; `keep` asserts the
// round trip, that only whitespace of the reply changed, and that a second
// pass is byte-identical.
// ---------------------------------------------------------------------------

const ADD_SPAN = (lang) =>
  ({
    rust: "fn add(a: i32, b: i32) -> i32 {\n    // add them\n    // return\n}",
    typescript: "function add(a: number, b: number): number {\n  // add them\n  // return\n}",
    go: "func add() int {\n\t// add them\n\t// return\n}",
    csharp: "int Add(int a, int b)\n{\n    // add them\n    // return\n}",
    python: "def add():\n    # add them\n    # return\n",
  })[lang];

const SLOT_MADE = [
  { name: "rust one-line body", languageId: "rust", reply: "fn f() -> i32 { a + b }", text: "fn f() -> i32 {\n    // add them\n    // return\n    a + b\n}" },
  { name: "go one-line body: the developer's tab column", languageId: "go", reply: "func f() int { return 1 }", text: "func f() int {\n\t// add them\n\t// return\n\treturn 1\n}" },
  { name: "typescript one-line body: the developer's two-space column", languageId: "typescript", reply: "function f() { return a }", text: "function f() {\n  // add them\n  // return\n  return a\n}" },
  { name: "csharp one-line block body", languageId: "csharp", reply: "int F() { return 1; }", text: "int F() {\n    // add them\n    // return\n    return 1;\n}" },
  { name: "rust: text after the closing brace stays after it", languageId: "rust", reply: "fn f() { a } // note", text: "fn f() {\n    // add them\n    // return\n    a\n} // note" },
  {
    name: "rust: an indented method takes the developer's body and closing columns",
    languageId: "rust",
    span: "fn add() {\n        // add them\n        // return\n    }",
    reply: "    fn f() { a }",
    text: "    fn f() {\n        // add them\n        // return\n        a\n    }",
  },
  {
    name: "rust: a flush sketch in an indented method falls back to the closing column plus one level",
    languageId: "rust",
    span: "fn add() {\n// add them\n// return\n    }",
    reply: "    fn f() { a }",
    text: "    fn f() {\n        // add them\n        // return\n        a\n    }",
  },
  {
    name: "rust: a sketch line on the opener line is not a column, the slot falls back to the closing column plus one level",
    languageId: "rust",
    span: "fn add() { // add them\n    // return\n}",
    reply: "fn f() { a + b }",
    text: "fn f() {\n    // add them\n    // return\n    a + b\n}",
  },
  { name: "python one-liner", languageId: "python", reply: "def f(): return 1", text: "def f():\n    # add them\n    # return\n    return 1" },
  { name: "python one-liner continued in brackets", languageId: "python", reply: "def f(): return g(\n    1)", text: "def f():\n    # add them\n    # return\n    return g(\n    1)" },
  { name: "python one-liner with two statements", languageId: "python", reply: "def f(): a(); return b", text: "def f():\n    # add them\n    # return\n    a(); return b" },
  {
    name: "python one-liner in a tab-indented class takes the sketch's own column",
    languageId: "python",
    span: "def add(self):\n\t\t# add them\n\t\t# return\n",
    reply: "\tdef f(self): return 1\n",
    text: "\tdef f(self):\n\t\t# add them\n\t\t# return\n\t\treturn 1\n",
  },
  { name: "csharp expression body, one line", languageId: "csharp", reply: "int Add(int a, int b) => a + b;", text: "int Add(int a, int b) =>\n    // add them\n    // return\n    a + b;" },
  { name: "csharp switch expression on one line: nothing between its arms", languageId: "csharp", reply: 'string N(int k) => k switch { 1 => "one", _ => "many" };', text: 'string N(int k) =>\n    // add them\n    // return\n    k switch { 1 => "one", _ => "many" };' },
  { name: "csharp expression body already split", languageId: "csharp", reply: "int Add(int a, int b) =>\n    a + b;", text: "int Add(int a, int b) =>\n    // add them\n    // return\n    a + b;" },
  { name: "typescript concise arrow", languageId: "typescript", reply: "const add = (a: number, b: number): number => a + b;", text: "const add = (a: number, b: number): number =>\n  // add them\n  // return\n  a + b;" },
  { name: "typescript concise arrow under a function-type annotation", languageId: "typescript", reply: "const f: (a: number) => number = (a) => a + 1;", text: "const f: (a: number) => number = (a) =>\n  // add them\n  // return\n  a + 1;" },
];
for (const row of SLOT_MADE) {
  test(`${row.name}: a slot is made by a line break and the sketch lands in it`, () => {
    const input = { languageId: row.languageId, originalSpan: row.span ?? ADD_SPAN(row.languageId), reply: row.reply };
    const r = keep(input);
    assert.deepStrictEqual(r, { text: row.text, keptByModel: 0, placedByTool: ["add them", "return"], stripped: [], unplaced: [] });
  });
}

test("csharp: an expression body whose expression starts on the `=>` line breaks there, never between its arms", () => {
  const span = "string Name(int k)\n{\n    // map the kind\n}";
  const reply = 'string Name(int k) => k switch\n{\n    1 => "one",\n    _ => "many",\n};';
  const r = keep({ languageId: "csharp", originalSpan: span, reply });
  assert.strictEqual(r.text, 'string Name(int k) =>\n    // map the kind\n    k switch\n{\n    1 => "one",\n    _ => "many",\n};');
  assert.deepStrictEqual(r.placedByTool, ["map the kind"]);
});

// Nothing to break: no code after the opener. These stay unplaced, the text
// is the reply, and phase 2 refuses to present them.
const NO_BODY = [
  { name: "empty reply", languageId: "rust", reply: "" },
  { name: "signature only", languageId: "rust", reply: "fn f();" },
  { name: "empty body on one line", languageId: "rust", reply: "fn f() {}" },
  { name: "python header with nothing after it", languageId: "python", reply: "def f():" },
];
for (const row of NO_BODY) {
  test(`${row.name}: nothing to make a slot from, so the sketch is unplaced and the text is the reply`, () => {
    const input = { languageId: row.languageId, originalSpan: ADD_SPAN(row.languageId), reply: row.reply };
    const r = keep(input);
    assert.deepStrictEqual(r, { text: row.reply, keptByModel: 0, placedByTool: [], stripped: [], unplaced: ["add them", "return"] });
  });
}

test("bodyTextOfSpan: a C# expression-bodied stub with sketch lines after `=>` harvests them", () => {
  const span = "int Add(int a, int b) =>\n    // add them\n    // return\n    a + b;";
  assert.deepStrictEqual(harvestOf(span, "csharp"), ["add them", "return"]);
});

test("bodyTextOfSpan: a TypeScript concise arrow with no comments harvests nothing", () => {
  assert.deepStrictEqual(harvestOf("const f = (a: number) => a + 1;", "typescript"), []);
  assert.strictEqual(bodyTextOfSpan("const f = (a: number) => a + 1;", "typescript"), " a + 1;");
});

test("rust: an empty body still has a slot on its closing brace's own line", () => {
  const r = keep({ languageId: "rust", originalSpan: "fn f() {\n    // only\n}", reply: "fn f() {\n}" });
  assert.deepStrictEqual(r, {
    text: "fn f() {\n    // only\n}",
    keptByModel: 0,
    placedByTool: ["only"],
    stripped: [],
    unplaced: [],
  });
});

test("rust: a closing brace on the header line with lines after it gets its slot inside the first function", () => {
  const span = "fn f() {\n    // only\n}";
  const reply = "fn f() { go() }\nfn g() {\n    h();\n}";
  const r = keep({ languageId: "rust", originalSpan: span, reply });
  assert.deepStrictEqual(r.unplaced, []);
  assert.strictEqual(r.text, "fn f() {\n    // only\n    go()\n}\nfn g() {\n    h();\n}");
});

// ---------------------------------------------------------------------------
// Python: code after the header's `:` is a one-liner, however many lines its
// brackets run on. A header tail that is only a comment still opens a suite.
// ---------------------------------------------------------------------------

test("python: a one-liner continued in brackets moves down whole, its continuation lines untouched", () => {
  const span = "def f():\n    # build it\n";
  const reply = "def f(): return g(\n    1,\n)\n";
  const r = keep({ languageId: "python", originalSpan: span, reply });
  assert.deepStrictEqual(r, {
    text: "def f():\n    # build it\n    return g(\n    1,\n)\n",
    keptByModel: 0,
    placedByTool: ["build it"],
    stripped: [],
    unplaced: [],
  });
});

test("python: a header ending in a comment still opens a body, and the sketch lands in it", () => {
  const span = "def f():\n    # build it\n";
  const reply = "def f():  # note\n    return 1\n";
  const r = keep({ languageId: "python", originalSpan: span, reply });
  assert.deepStrictEqual(r, {
    text: "def f():  # note\n    # build it\n    return 1\n",
    keptByModel: 0,
    placedByTool: ["build it"],
    stripped: [],
    unplaced: [],
  });
});

// ---------------------------------------------------------------------------
// The body opener per language. A TypeScript `{` in a type position is not the
// body; a C# `=>` first means an expression body with no block at all.
// ---------------------------------------------------------------------------

const TS_TYPED_HEADERS = [
  "async function f(): Promise<{ ok: boolean }> {",
  "function f(): { ok: boolean } {",
  "const f = (): { ok: boolean } => {",
  "function f<T = {}>(x: T) {",
  "function f(): A | { b: 1 } {",
];
for (const header of TS_TYPED_HEADERS) {
  test(`typescript: \`${header}\` opens the body at the last brace, so the sketch is harvested and kept`, () => {
    const originalSpan = `${header}\n  // step one\n  // step two\n}`;
    assert.deepStrictEqual(
      harvestOf(originalSpan, "typescript"),
      ["step one", "step two"],
      "the prompt path reads the sketch",
    );
    const reply = `${header}\n  const a = 1;\n  return a;\n}`;
    const r = keep({ languageId: "typescript", originalSpan, reply });
    assert.strictEqual(r.text, `${header}\n  // step one\n  // step two\n  const a = 1;\n  return a;\n}`);
    assert.deepStrictEqual(r.placedByTool, ["step one", "step two"]);
    assert.strictEqual(keepSketch({ languageId: "typescript", originalSpan, reply: r.text }).text, r.text);
  });
}

const STILL_HARVESTS = [
  ["typescript", "function f({ a, b }: Props) {\n  // step one\n}"],
  ["typescript", "const f = () => {\n  // step one\n}"],
  ["javascript", "const f = ({ a }) => {\n  // step one\n}"],
  ["csharp", "public static bool operator ==(A a, A b)\n{\n    // step one\n}"],
  ["csharp", "public bool Ge(int a, int b)\n{\n    // step one\n    return a >= b;\n}"],
];
// The type-group test reads code only: a colon inside a comment before an
// Allman brace does not make the body a braced type.
const TS_COMMENT_HEADS = [
  "function f(a: number) /* returns: */\n{\n  // step one\n}",
  "function f(a: number) // TODO:\n{\n  // step one\n}",
  "function f(): { a: number } // note\n{\n  // step one\n}",
];
for (const span of TS_COMMENT_HEADS) {
  test(`typescript: \`${span.split("\n")[0]}\` with an Allman brace still has its body`, () => {
    assert.deepStrictEqual(harvestOf(span, "typescript"), ["step one"]);
  });
}

for (const [languageId, span] of STILL_HARVESTS) {
  test(`${languageId}: \`${span.split("\n")[0]}\` still harvests its body`, () => {
    assert.deepStrictEqual(harvestOf(span, languageId), ["step one"]);
  });
}

