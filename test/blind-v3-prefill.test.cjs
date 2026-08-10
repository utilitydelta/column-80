// Blind oracle: round-1 pre-fill input broadening (goal item 4). typesNamedIn
// now also mines backtick-quoted PATHS in the doc (`fastbloom::BloomFilter` ->
// BloomFilter), and the new typesFromUses mines types brought in by `use`
// statements - the second pre-fill input so a type the signature/doc does not
// name but the file imports is still surfaced. Pure over strings; never read
// src/**.
//
// Run: SKIP_LIVE=1 node --test test/blind-v3-prefill.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v3-prefill",
  `export { typesNamedIn, typesFromUses } from "../src/core/compilerDirected";\n`
);
const { typesNamedIn, typesFromUses } = mod;
test.after(cleanup);

// --- typesNamedIn doc-path broadening (signature behavior unchanged) ---------
const namedCases = [
  {
    name: "doc backtick PATH -> final PascalCase segment (the type)",
    sig: "fn f() -> bool",
    doc: "Build a filter. Use `fastbloom::BloomFilter`.",
    expected: ["BloomFilter"],
  },
  {
    name: "doc bare backtick PascalCase still works",
    sig: "fn f()",
    doc: "Returns a `Widget`.",
    expected: ["Widget"],
  },
  {
    name: "doc bare lowercase backtick (a crate, not a type) -> nothing",
    sig: "fn f() -> bool",
    doc: "Use `fastbloom` for this.",
    expected: [],
  },
  {
    name: "signature PascalCase still primary; prelude excluded",
    sig: "fn f(x: BloomFilter) -> Vec<u8>",
    doc: undefined,
    expected: ["BloomFilter"],
  },
  {
    name: "deep path -> last segment",
    sig: "fn f()",
    doc: "See `tokio::sync::mpsc::Sender`.",
    expected: ["Sender"],
  },
];
for (const { name, sig, doc, expected } of namedCases) {
  test(`typesNamedIn: ${name}`, () => {
    assert.deepStrictEqual(typesNamedIn(sig, doc), expected);
  });
}

// --- typesFromUses ----------------------------------------------------------
const useCases = [
  {
    name: "single use -> the imported type",
    src: "use fastbloom::BloomFilter;\nfn f() {}",
    expected: ["BloomFilter"],
  },
  {
    name: "grouped use -> each type in the group",
    src: "use foo::{Alpha, Beta};",
    expected: ["Alpha", "Beta"],
  },
  {
    name: "aliased use -> both the real type and the alias (either is a cursor)",
    src: "use foo::Bar as Baz;",
    expected: ["Bar", "Baz"],
  },
  {
    name: "prelude types excluded (HashMap)",
    src: "use std::collections::HashMap;",
    expected: [],
  },
  {
    name: "lowercase-only use (crate/module, no type) -> nothing",
    src: "use fastbloom::prelude::*;",
    expected: [],
  },
  {
    name: "non-use lines ignored; first-seen order, deduped",
    src: "// a comment naming BloomFilter\nuse a::Widget;\nlet x = Widget::new();\nuse b::Widget;",
    expected: ["Widget"],
  },
  {
    name: "empty / no uses -> empty",
    src: "fn main() {}",
    expected: [],
  },
  {
    name: "pub use re-export -> the type (dominant lib.rs shape)",
    src: "pub use crate::filter::BloomFilter;",
    expected: ["BloomFilter"],
  },
  {
    name: "pub(crate) use -> the type",
    src: "pub(crate) use foo::Bar;",
    expected: ["Bar"],
  },
  {
    name: "rustfmt multi-line grouped import -> each type (continuation lines mined)",
    src: "use foo::{\n    Alpha,\n    Beta,\n};",
    expected: ["Alpha", "Beta"],
  },
  {
    name: "two multi-line grouped blocks, prelude excluded",
    src: "use std::collections::{\n  HashMap,\n};\nuse foo::{\n  Alpha,\n  Beta,\n};",
    expected: ["Alpha", "Beta"],
  },
];
for (const { name, src, expected } of useCases) {
  test(`typesFromUses: ${name}`, () => {
    assert.deepStrictEqual(typesFromUses(src), expected);
  });
}
