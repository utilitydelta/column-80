// Implementer oracle: postprocess edges the blind contract set cannot see
// from the surface doc — CRLF handling, sub-line overlap boundaries, the
// repetitive-block guard rails. Complements test/blind-postprocess.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-postprocess",
  `export {
  trimStopTokens,
  toSingleLine,
  dropDuplicateSuffixLines,
  limitScopeByIndentation,
  removeRepetitiveBlocks,
  postprocess,
  trailingOverlapLength,
} from "../src/core/postprocess";\n`
);
const {
  trimStopTokens,
  toSingleLine,
  dropDuplicateSuffixLines,
  limitScopeByIndentation,
  removeRepetitiveBlocks,
  postprocess,
} = mod;
test.after(cleanup);

// ---- <|cursor|> leak: qwen base emits the literal marker (not one of its own
// specials) mid-completion; trim it like any stop token. Live regression: the
// ghost text landed `mod tests {<|cursor|>` in the buffer.

test("trimStopTokens cuts at a leaked <|cursor|> marker", () => {
  assert.strictEqual(trimStopTokens("mod tests {<|cursor|>"), "mod tests {");
  assert.strictEqual(trimStopTokens("keep();<|cursor|>drop();"), "keep();");
});

test("postprocess drops everything from a <|cursor|> leak", () => {
  const ctx = { suffix: "\n}", currentLinePrefix: "mod tests {", multiline: true };
  assert.ok(!postprocess("<|cursor|>\n}", ctx).includes("<|cursor|>"));
});

// ---- toSingleLine + CRLF (surface ruling 3: strip the trailing \r)

for (const [input, expected] of [
  ["a\r\nb", "a"],
  ["only\r", "only"],
  ["\r\ntail", ""],
]) {
  test(`toSingleLine strips the CR of a CRLF break: ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
    assert.strictEqual(toSingleLine(input), expected);
  });
}

// ---- trimStopTokens edges

test("trimStopTokens with the token at position 0 returns empty", () => {
  assert.strictEqual(trimStopTokens("<|fim_middle|>rest"), "");
});

test("trimStopTokens on empty input returns empty", () => {
  assert.strictEqual(trimStopTokens(""), "");
});

// ---- dropDuplicateSuffixLines boundary discipline

test("sub-line overlap fragment (lone ';') is NOT dedup: the completion is finishing the statement", () => {
  assert.strictEqual(dropDuplicateSuffixLines("foo();", ";\n// end\n"), "foo();");
});

test("an overlap consuming the whole completion is removed even without a newline boundary", () => {
  assert.strictEqual(dropDuplicateSuffixLines("return sum;", "return sum;\n}"), "");
});

test("overlap starting mid-line is kept; the same text at a line boundary is removed", () => {
  const suffix = "\nreturn done;\n}";
  assert.strictEqual(
    dropDuplicateSuffixLines("x = 1; return done;", suffix),
    "x = 1; return done;",
    "mid-line tail is not a boundary"
  );
  assert.strictEqual(
    dropDuplicateSuffixLines("x = 1;\nreturn done;", suffix),
    "x = 1;\n",
    "line-boundary tail is duplication"
  );
});

test("line-level repeat with different indentation than the suffix SURVIVES: not the same token stream", () => {
  const text = "a();\n      return x;\n}";
  assert.strictEqual(dropDuplicateSuffixLines(text, "\nreturn x;\n  }\nrest();"), text);
});

test("line-level repeat with identical raw lines is still cut", () => {
  const out = dropDuplicateSuffixLines("a();\nreturn x;\n  }", "\nreturn x;\n  }\nrest();");
  assert.strictEqual(out.trimEnd(), "a();");
});

test("an indented inner closer survives dedup against a shallower suffix closer", () => {
  const out = postprocess("doIt();\n  }", { suffix: "\n}\n", currentLinePrefix: "  ", multiline: true });
  assert.strictEqual(out, "doIt();\n  }");
});

// ---- bracket-run overlap (auto-closed characters) vs lone terminators

test("mid-line bracket-run overlap ('\");' class) unmatched in the completion is removed: auto-closed chars stay in the buffer once", () => {
  // The completion closes a string and call opened BEFORE the cursor; the
  // buffer already holds those closers.
  assert.strictEqual(
    dropDuplicateSuffixLines('hello");', '");\n// more\n'),
    "hello"
  );
});

test("mid-line closing-paren overlap unmatched in the completion is removed", () => {
  assert.strictEqual(dropDuplicateSuffixLines("a, b)", ")\n"), "a, b");
});

// ---- F18: bracket-balance awareness — completion-internal closers are never stripped

test("trailing closers matched by opens inside the completion survive intact", () => {
  const text = "arr.map(x => f(x))";
  assert.strictEqual(dropDuplicateSuffixLines(text, ");\n"), text);
});

test("fixpoint never strips a balanced remainder: nested closers survive whole", () => {
  const text = "g(f(h(x)))";
  assert.strictEqual(dropDuplicateSuffixLines(text, ")\n"), text);
});

test("a mixed run (some closers internal) is kept whole, not partially stripped", () => {
  const text = 'f("x");';
  assert.strictEqual(dropDuplicateSuffixLines(text, '");\n'), text);
});

test("balanced completion beside an abandoned auto-close pair is kept (the F2 doubling case moved to the provider range)", () => {
  const text = 'append("hello");';
  assert.strictEqual(dropDuplicateSuffixLines(text, '");\n// more\n'), text);
});

test("a closer on its own indented line is NOT a bracket-run overlap", () => {
  assert.strictEqual(dropDuplicateSuffixLines("doIt();\n  }", "}\n"), "doIt();\n  }");
});

test("a lone terminator is still not stripped headlessly", () => {
  assert.strictEqual(dropDuplicateSuffixLines("foo();", ";\n// end\n"), "foo();");
});

// ---- dropDuplicated: head fuzzy-match against the suffix drops the whole completion

test("a completion whose opening lines fuzzy-match the suffix head then diverge is dropped whole", () => {
  const out = postprocess(
    "  return totals / values.length;\n}\nfunction extra() {\n  mutate();\n}",
    {
      suffix: "\n  return total / values.length;\n}\n",
      currentLinePrefix: "  ",
      multiline: true,
    }
  );
  assert.strictEqual(out, "", "re-typed buffer with a divergent tail is dropped whole");
});

test("a non-duplicate completion head passes the dropDuplicated gate", () => {
  const out = postprocess("total += v;\n  count += 1;", {
    suffix: "\n  return total / values.length;\n}\n",
    currentLinePrefix: "  ",
    multiline: true,
  });
  assert.strictEqual(out, "total += v;\n  count += 1;");
});

test("empty completion and empty suffix pass through", () => {
  assert.strictEqual(dropDuplicateSuffixLines("", "anything"), "");
  assert.strictEqual(dropDuplicateSuffixLines("code();", ""), "code();");
  assert.strictEqual(dropDuplicateSuffixLines("code();", "   \n  "), "code();");
});

// ---- limitScopeByIndentation edges

test("tab indentation: tabs count as depth like spaces", () => {
  const out = limitScopeByIndentation("done();\n\t\tdeeper();\nescape();", "\t\t");
  assert.ok(out.includes("deeper();"));
  assert.ok(!out.includes("escape();"));
});

test("multi-char closer lines ('});', ']') count as block closers", () => {
  const out = limitScopeByIndentation("cb();\n});\nnext();", "  ");
  assert.strictEqual(out, "cb();\n});");
});

test("depth-zero cursor never cuts anything", () => {
  const text = "a();\nb();\nc();";
  assert.strictEqual(limitScopeByIndentation(text, ""), text);
});

test("single-line completion is untouched regardless of depth", () => {
  assert.strictEqual(limitScopeByIndentation("anything at all", "        "), "anything at all");
});

// ---- removeRepetitiveBlocks guard rails

test("a single line repeated 6x is truncated to at most 2", () => {
  const line = "list.push(item);";
  const out = removeRepetitiveBlocks(Array(6).fill(line).join("\n"));
  const count = out.split("\n").filter((l) => l === line).length;
  assert.ok(count <= 2, `kept ${count} repeats`);
});

test("a brace ladder is legitimate code, not run-on: left alone", () => {
  const text = "  }\n  }\n  }\n  }";
  assert.strictEqual(removeRepetitiveBlocks(text), text);
});

test("exactly 2 consecutive repeats are below the trigger: left alone", () => {
  const text = "count += 1;\nlist.push(count);\ncount += 1;\nlist.push(count);";
  assert.strictEqual(removeRepetitiveBlocks(text), text);
});

test("repetition is truncated even when trailing text follows the run", () => {
  const block = "value += step;\ntotals.push(value);\n";
  const input = block.repeat(5) + "return totals;";
  const out = removeRepetitiveBlocks(input);
  assert.ok(!out.includes(block.repeat(3)), "run truncated");
  assert.ok(out.length < input.length);
});

// ---- postprocess pathological inputs

test("postprocess of newline soup is empty", () => {
  assert.strictEqual(postprocess("\n\n\r\n\n", { suffix: "", currentLinePrefix: "", multiline: true }), "");
});

test("postprocess keeps interior blank lines, trims only the tail", () => {
  const out = postprocess("a();\n\nb();\n\n\n", { suffix: "", currentLinePrefix: "", multiline: true });
  assert.strictEqual(out, "a();\n\nb();");
});

test("postprocess single-line mode composes with suffix dedup on the remaining line", () => {
  // toSingleLine first cuts to "return x;", then the whole-line duplicate of
  // the suffix head is dropped -> nothing survives.
  const out = postprocess("return x;\nmore();", {
    suffix: "return x;\n}",
    currentLinePrefix: "",
    multiline: false,
  });
  assert.strictEqual(out, "");
});

// ---- F18: trailingOverlapLength applies the same balance rule

const trailingOverlapLength = mod.trailingOverlapLength;

test("trailingOverlapLength: closer matched inside the completion does not extend the range", () => {
  assert.strictEqual(trailingOverlapLength("arr.map(x => f(x))", ");"), 0);
});

test("trailingOverlapLength: lone terminator still extends", () => {
  assert.strictEqual(trailingOverlapLength("foo();", ";"), 1);
});

test("trailingOverlapLength: unmatched closer still extends", () => {
  assert.strictEqual(trailingOverlapLength("a, b)", ")"), 1);
});

// ---- F20: CRLF/LF parity for line-level dedup and head-drop

test("line-level dedup fires identically for CRLF and LF suffixes", () => {
  const completion = "let t = 0;\n  return t;\n}";
  const lf = dropDuplicateSuffixLines(completion, "\n  return t;\n}\nmore();");
  const crlf = dropDuplicateSuffixLines(completion, "\r\n  return t;\r\n}\r\nmore();");
  assert.strictEqual(lf.trimEnd(), "let t = 0;");
  assert.strictEqual(crlf, lf, "CRLF twin cuts the same as LF");
});

test("head-drop fires identically for CRLF and LF suffixes", () => {
  const raw = "  return totals / values.length;\n}\nfunction extra() {\n  mutate();\n}";
  const mk = (suffix) => postprocess(raw, { suffix, currentLinePrefix: "  ", multiline: true });
  const lf = mk("\n  return total / values.length;\n}\n");
  const crlf = mk("\r\n  return total / values.length;\r\n}\r\n");
  assert.strictEqual(lf, "", "LF twin drops whole (round-1 F7 proof)");
  assert.strictEqual(crlf, lf, "CRLF twin drops whole too");
});
