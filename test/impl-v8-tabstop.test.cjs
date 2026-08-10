// Implementer test for P3 (on top of the blind oracle blind-v8-tabstop): the
// triaged review fix DO-1 — the variable-branch placeholder escapes VS Code
// snippet metacharacters in the embedded type string, so a rust-analyzer type
// like `{unknown}` does not close the `${N:…}` placeholder early and corrupt the
// snippet. The blind oracle's `holes === count("${")` invariant cannot see this.
//
// Run: SKIP_LIVE=1 node --test test/impl-v8-tabstop.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v8-tabstop",
  `export { renderBlankValue } from "../src/core/tabstop";\n`
);
const { renderBlankValue } = mod;
test.after(cleanup);

// A parser for VS Code placeholder integrity: after the leading `${N:`, the FIRST
// unescaped `}` must be the LAST char. If a metachar leaked, an inner unescaped
// `}` closes early and this finds it.
function placeholderClosesOnce(rhs) {
  const m = /^\$\{\d+:/.exec(rhs);
  if (!m) return false;
  const body = rhs.slice(m[0].length);
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") { i++; continue; } // skip escaped char
    if (body[i] === "}") return i === body.length - 1; // first unescaped } must be the terminator
  }
  return false;
}

test("a `{unknown}` return type does not corrupt the placeholder (inner } escaped)", () => {
  const { rhs, holes } = renderBlankValue("{unknown}");
  assert.strictEqual(holes, 1);
  assert.ok(placeholderClosesOnce(rhs), `placeholder must close exactly once at the end: ${JSON.stringify(rhs)}`);
  assert.ok(rhs.includes("\\}"), "the inner } from the type is escaped");
});

test("a closure-shaped type `[closure@x] -> ()` degrades safely to one intact hole", () => {
  const { rhs, holes } = renderBlankValue("impl Fn() -> ()");
  assert.strictEqual(holes, 1);
  assert.ok(placeholderClosesOnce(rhs), `placeholder intact: ${JSON.stringify(rhs)}`);
});

test("a `$` in the type text is escaped, not read as a snippet variable", () => {
  const { rhs } = renderBlankValue("Weird$Type");
  assert.ok(rhs.includes("\\$"), "a literal $ in the type is escaped");
  assert.ok(placeholderClosesOnce(rhs));
});

test("a variable-form type with no metachars is UNCHANGED (escaping is a no-op)", () => {
  // Option/Result stay variable (variant choice is the answer), so the type text is
  // reproduced verbatim with no escaping. Collections now scaffold and are pinned in
  // blind-v8-tabstop; here we only assert the escape path is inert without metachars.
  assert.strictEqual(renderBlankValue("Option<i32>").rhs, "${1:/* Option<i32> */}");
  assert.strictEqual(renderBlankValue("Result<String, Error>").rhs, "${1:/* Result<String, Error> */}");
});
