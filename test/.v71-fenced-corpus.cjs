// The fenced-reply corpus generator, session-v71.
//
// In `test/` and not in `session-v71/` because `session*/` is gitignored.
//
// A VERBATIM COPY of lines 842-984 of `test/impl-v70-p3-counting-lens.test.cjs`
// (the `[v70 P3 differential]` corpora), lifted so the measurement scripts in
// this folder can run the same 1050 replies without importing a test file or
// refactoring a pinned one. If the two ever disagree, the test file is the
// original and this is the copy.
//
// 210 replies per language x 5 languages. `cleanBody` hides no test shape in any
// literal or comment; `plant` puts one in every reply.

const L = (...lines) => lines.join("\n");
const FENCE = "```";
const BT = "`";
const fenced = (tag, body) => `${FENCE}${tag}\n${body}\n${FENCE}\n`;

const FILLER = {
  csharp: (i) => [`    var n${i} = ${i};`, `    Assert.True(n${i} >= 0);`],
  go: (i) => [`\tn${i} := ${i}`, `\tif n${i} < 0 {`, "\t\tt.Fatal(n" + i + ")", "\t}"],
  python: (i) => [`    n${i} = ${i}`, `    assert n${i} >= 0`],
  typescript: (i) => [`  const n${i} = ${i};`, `  expect(n${i}).toBeGreaterThanOrEqual(0);`],
  rust: (i) => [`        let n${i} = ${i};`, `        assert!(n${i} >= 0);`],
};

// A test case of index i, with `extra` lines dropped into the first body.
const cleanBody = (id, i) => {
  const f = FILLER[id](i);
  if (id === "csharp") {
    return L(
      "[Fact]",
      `public void Case${i}A()`,
      "{",
      ...f,
      `    Assert.Equal(${i}, ShardOf(${i}));`,
      "}",
      "",
      i % 3 === 0 ? "[Theory]" : "[Fact]",
      ...(i % 3 === 0 ? [`[InlineData(${i})]`] : []),
      `public void Case${i}B(${i % 3 === 0 ? "int n" : ""})`,
      "{",
      `    Assert.NotNull(ShardOf(${i}));`,
      "}"
    );
  }
  if (id === "go") {
    return L(
      `func TestCase${i}A(t *testing.T) {`,
      ...f,
      `\tif got := ShardOf(${i}); got != ${i} {`,
      "\t\tt.Errorf(" + JSON.stringify(`case ${i}: got %v`) + ", got)",
      "\t}",
      "}",
      "",
      `func TestCase${i}B(t *testing.T) {`,
      `\tif ShardOf(${i}) < 0 {`,
      "\t\tt.Fatal(" + JSON.stringify(`case ${i}`) + ")",
      "\t}",
      "}"
    );
  }
  if (id === "python") {
    return L(
      `def test_case_${i}_a():`,
      ...f,
      `    assert shard_of(${i}) == ${i}`,
      "",
      "",
      `def test_case_${i}_b():`,
      `    assert shard_of(${i}) >= 0`
    );
  }
  if (id === "rust") {
    return L(
      "#[cfg(test)]",
      "mod tests {",
      "    use super::*;",
      "",
      "    #[test]",
      `    fn case_${i}_a() {`,
      ...f,
      `        assert_eq!(shard_of(${i}), ${i});`,
      "    }",
      "",
      "    #[test]",
      `    fn case_${i}_b() {`,
      `        assert!(shard_of(${i}) >= 0);`,
      "    }",
      "}"
    );
  }
  return L(
    `it(${JSON.stringify(`case ${i} a`)}, () => {`,
    ...f,
    `  expect(shardOf(${i})).toBe(${i});`,
    "});",
    "",
    `it(${JSON.stringify(`case ${i} b`)}, () => {`,
    `  expect(shardOf(${i})).toBeGreaterThanOrEqual(0);`,
    "});"
  );
};

// The hiding places, one per index so the corpus covers every form. Each entry
// is [name, lines] and every one puts the language's own test shape inside a
// literal or a comment.
const HIDERS = {
  csharp: [
    ["regular string", (i) => [`    var e${i} = "[Fact] public void Ghost${i}() { }";`]],
    ["verbatim multi-line", (i) => [`    var e${i} = @"`, "[Fact]", `public void Ghost${i}() { }`, '";']],
    ["verbatim trailing backslash", (i) => [`    var e${i} = @"C:\\dir${i}\\";`]],
    ["verbatim doubled quote", (i) => [`    var e${i} = @"the ""[Fact]"" attribute";`]],
    ["interpolated", (i) => [`    var e${i} = $"[Fact] public void Ghost{${i}}() {{ }}";`]],
    ["line comment", (i) => [`    // [Fact] public void Ghost${i}() { }`]],
    ["block comment", (i) => [`    /* [Fact] public void Ghost${i}() { } */`]],
  ],
  go: [
    ["string", (i) => [`\te${i} := "func TestGhost${i}(t *testing.T) {}"`]],
    ["raw backtick", (i) => ["\te" + i + " := " + BT + `func TestGhost${i}(t *testing.T) {}` + BT]],
    ["raw backtick multi-line", (i) => ["\te" + i + " := " + BT, `func TestGhost${i}(t *testing.T) {`, "}", BT]],
    ["line comment", (i) => [`\t// func TestGhost${i}(t *testing.T) {}`]],
    ["block comment", (i) => ["\t/*", `func TestGhost${i}(t *testing.T) {`, "}", "\t*/"]],
  ],
  python: [
    ["triple single", (i) => ["EXAMPLE = '''", `def test_ghost_${i}(x):`, "    pass", "'''"]],
    ["triple double", (i) => ['EXAMPLE = """', `def test_ghost_${i}(x):`, "    pass", '"""']],
    ["raw triple single", (i) => ["EXAMPLE = r'''", `def test_ghost_${i}(x):`, "    pass", "'''"]],
    ["f triple single", (i) => ["EXAMPLE = f'''", `def test_ghost_${i}(x):`, "    pass", "'''"]],
    ["comment", (i) => [`# def test_ghost_${i}(x):`]],
  ],
  typescript: [
    ["single-quoted", (i) => [`  const e${i} = 'it("ghost${i}", () => {});';`]],
    ["double-quoted", (i) => [`  const e${i} = "it(\\"ghost${i}\\", () => {});";`]],
    ["template", (i) => ["  const e" + i + " = " + BT + `it("ghost${i}", () => {});` + BT + ";"]],
    ["template multi-line", (i) => ["  const e" + i + " = " + BT, `it("ghost${i}", () => {});`, BT + ";"]],
    ["line comment", (i) => [`  // it("ghost${i}", () => {});`]],
    ["block comment", (i) => ["  /*", `  it("ghost${i}", () => {});`, "  */"]],
  ],
  rust: [
    ["string", (i) => [`        let e${i} = "#[test] fn ghost${i}() {}";`]],
    ["raw string", (i) => [`        let e${i} = r#"#[test] fn ghost${i}() {}"#;`]],
    ["line comment", (i) => [`        // #[test] fn ghost${i}() {}`]],
    ["nested block comment", (i) => [`        /* outer /* in */ #[test] fn ghost${i}() {} */`]],
  ],
};

// Plant the hider's lines into the body, just after the first opening line of
// the first test (or at module level for Python, whose shape is line-anchored).
const plant = (id, i, lines) => {
  const body = cleanBody(id, i).split("\n");
  if (id === "python") {
    return L(...lines, "", "", ...body);
  }
  const at = body.findIndex((l) => l.includes("{")) + 1;
  return L(...body.slice(0, at), ...lines, ...body.slice(at));
};

const FENCE_TAG = { csharp: "csharp", go: "go", python: "python", typescript: "typescript", rust: "rust" };
const CORPUS_IDS = ["csharp", "go", "python", "typescript", "rust"];
const PER_LANG = 210;

module.exports = { L, BT, fenced, FILLER, cleanBody, HIDERS, plant, FENCE_TAG, CORPUS_IDS, PER_LANG };
