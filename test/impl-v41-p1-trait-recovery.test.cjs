// WHITE-BOX, session-v41 phase 1. Written against `src/core/rustHoverRecovery.ts`
// after reading it, so it names the decisions that file makes rather than the
// behaviour a caller can see. The black-box contract for the same change is
// test/blind-v41-p1-trait-recovery.test.cjs, which read none of it.
//
// What this file is FOR: the trait parser's edge cases (braces hidden in
// literals, comments carrying `fn`, stacked attributes, where-clauses) and
// every refusal branch in `traitItems`/`traitItemLine` the goal did not spell
// out. The recovery's whole value is that it refuses; a refusal path with no
// test is a refusal path that quietly stops refusing.
//
// Imports through crossFileShape on purpose: that pins the facade re-export
// the walk's consumers use.
//
// Run: SKIP_LIVE=1 node --test test/impl-v41-p1-trait-recovery.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v41-p1-trait-recovery",
  `export { isBareTraitHover, recoverTraitSurface, parseStructHoverFields, resolveCrossFileShape } from "../src/core/crossFileShape";\n`,
);
const { isBareTraitHover, recoverTraitSurface, parseStructHoverFields, resolveCrossFileShape } = mod;
test.after(cleanup);

const dump = (out) => `\n  GOT:\n${out}`;
const braces = (s, ch) => s.split(ch).length - 1;

// ===========================================================================
// 1. BRACES THE STRUCTURE SCAN MUST NOT SEE. Default bodies are dropped by
//    brace matching over the SCRUBBED copy, where every literal is blanked.
// ===========================================================================

test("default body with nested control-flow braces: signatures only, the method after survives", () => {
  const src = [
    "pub trait Backoff {",
    "    fn base_ms(&self) -> u64;",
    "    fn next(&self, attempt: u32) -> u64 {",
    "        if attempt == 0 {",
    "            0",
    "        } else {",
    "            loop {",
    "                break self.base_ms() * u64::from(attempt);",
    "            }",
    "        }",
    "    }",
    "    fn cap(&self) -> u64;",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Backoff", src);
  assert.ok(/fn next\(&self, attempt: u32\)\s*->\s*u64\s*;/.test(out), dump(out));
  assert.ok(/fn cap\(&self\)\s*->\s*u64\s*;/.test(out), `the method after the nested body.${dump(out)}`);
  assert.ok(!/break|else/.test(out), `body tokens leaked.${dump(out)}`);
  assert.equal(braces(out, "{"), 1, dump(out));
  assert.equal(braces(out, "}"), 1, dump(out));
});

// One parameterized table for every literal that can hide a brace or a quote.
// The invariant is the same in each row: the body is dropped whole and the
// following required method still parses.
for (const [label, bodyLines] of [
  ["plain string with braces and quotes", ['        let s = "a { b } \\" c";', "        s"]],
  ["raw string with braces", ['        let s = r#"{ "k": 1 }"#;', "        s.to_string()"]],
  ["char literal closing brace", ["        let c = '}';", "        c.to_string()"]],
  ["escaped char literal", ["        let c = '\\}';", "        c.to_string()"]],
]) {
  test(`literal in a default body (${label}) closes nothing`, () => {
    const src = [
      "pub trait Render {",
      "    fn template(&self) -> String {",
      ...bodyLines,
      "    }",
      "    fn name(&self) -> String;",
      "}",
    ].join("\n");
    const out = recoverTraitSurface("pub trait Render", src);
    assert.ok(/fn template\(&self\)\s*->\s*String\s*;/.test(out), `${label}.${dump(out)}`);
    assert.ok(/fn name\(&self\)\s*->\s*String\s*;/.test(out), `${label}: the trailing method dropped means the body's brace closed the trait early.${dump(out)}`);
    assert.ok(!out.includes('"') && !out.includes("let "), `${label}: body text leaked.${dump(out)}`);
  });
}

// ===========================================================================
// 2. HEADS. Where-clauses, unsafe, generics with lifetimes.
// ===========================================================================

test("a multi-line where-clause on the trait head collapses onto the rendered head line", () => {
  const src = [
    "pub trait Store<K>",
    "where",
    "    K: Ord + Clone,",
    "{",
    "    fn get(&self, key: &K) -> Option<u64>;",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Store<K>", src);
  assert.ok(/pub trait Store<K> where K: Ord \+ Clone/.test(out), dump(out));
  assert.ok(/fn get\(&self, key: &K\)\s*->\s*Option<u64>\s*;/.test(out), dump(out));
});

test("a where-clause on a default-body METHOD stays inside that method's signature", () => {
  const src = [
    "pub trait Sink {",
    "    fn push_all<I>(&mut self, items: I) where I: IntoIterator<Item = u8> {",
    "        for _ in items {}",
    "    }",
    "    fn flush(&mut self);",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Sink", src);
  assert.ok(
    /fn push_all<I>\(&mut self, items: I\) where I: IntoIterator<Item = u8>\s*;/.test(out),
    dump(out),
  );
  assert.ok(/fn flush\(&mut self\)\s*;/.test(out), dump(out));
  assert.ok(!/for _/.test(out), dump(out));
});

test("`pub unsafe trait` triggers as a bare hover and renders its unsafe head from source", () => {
  assert.equal(isBareTraitHover("pub unsafe trait Zeroable"), true);
  const src = ["pub unsafe trait Zeroable {", "    fn zero(&mut self);", "}"].join("\n");
  const out = recoverTraitSurface("pub unsafe trait Zeroable", src);
  assert.ok(/pub unsafe trait Zeroable/.test(out), dump(out));
  assert.ok(/fn zero\(&mut self\)\s*;/.test(out), dump(out));
});

test("lifetimes survive: 'a is not a char literal and the signature keeps it", () => {
  const src = [
    "pub trait Lender {",
    "    fn get<'a>(&'a self) -> &'a str;",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Lender", src);
  assert.ok(/fn get<'a>\(&'a self\)\s*->\s*&'a str\s*;/.test(out), dump(out));
});

test("`;` inside an array type splits no item; `async fn` and an assoc const default render as declared", () => {
  const src = [
    "pub trait Hasher {",
    "    const BLOCK: usize = 64;",
    "    fn digest(&self) -> [u8; 32];",
    "    async fn digest_stream(&mut self) -> [u8; 32];",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Hasher", src);
  assert.ok(/const BLOCK: usize = 64\s*;/.test(out), `an assoc const default is part of "as declared".${dump(out)}`);
  assert.ok(/fn digest\(&self\)\s*->\s*\[u8; 32\]\s*;/.test(out), dump(out));
  assert.ok(/async fn digest_stream\(&mut self\)\s*->\s*\[u8; 32\]\s*;/.test(out), dump(out));
});

// ===========================================================================
// 3. COMMENTS AND ATTRIBUTES. Both are blanked before the parser looks, so a
//    `fn` inside one is not an item and a `;` inside one splits nothing.
// ===========================================================================

test("comments containing `fn` are not items, in any comment form", () => {
  const src = [
    "pub trait Audit {",
    "    // fn ghost(&self); a removed method, kept for archaeology",
    "    /* fn ghost2(&self); */",
    "    /// call fn record before fn commit",
    "    fn record(&self, line: &str);",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Audit", src);
  assert.ok(/fn record\(&self, line: &str\)\s*;/.test(out), dump(out));
  assert.ok(!/ghost|archaeology|before fn commit/.test(out), dump(out));
  // One `fn` line: the three commented ones parsed as nothing.
  assert.equal(out.match(/\bfn /g).length, 1, dump(out));
});

test("stacked attributes on one item are blanked, and a `;` inside an attribute string splits nothing", () => {
  const src = [
    "pub trait Api {",
    "    #[must_use]",
    '    #[deprecated(note = "old; call fetch_v2 { instead }")]',
    "    fn fetch(&self) -> u8;",
    "    fn fetch_v2(&self) -> u16;",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Api", src);
  assert.ok(/fn fetch\(&self\)\s*->\s*u8\s*;/.test(out), dump(out));
  assert.ok(/fn fetch_v2\(&self\)\s*->\s*u16\s*;/.test(out), dump(out));
  assert.ok(!/deprecated|must_use|instead/.test(out), dump(out));
});

// ===========================================================================
// 4. THE CFG SCAN'S SPAN. The attribute binds above the item's head, so the
//    scan runs over the signature span only, and neighbours stay unharmed.
// ===========================================================================

test("a cfg-gated FIRST item omits itself only; the boundary scan stops at the previous item", () => {
  const src = [
    "pub trait Router {",
    "    #[cfg(test)]",
    "    fn route_fixed(&self) -> u32;",
    "    fn route(&self, key: &[u8]) -> u32;",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Router", src);
  assert.ok(!/route_fixed/.test(out), dump(out));
  assert.ok(/fn route\(&self, key: &\[u8\]\)\s*->\s*u32\s*;/.test(out), `the sibling AFTER the gated item must not inherit its cfg.${dump(out)}`);
});

test("a #[cfg] nested inside a DROPPED default body gates nothing: the item stays", () => {
  const src = [
    "pub trait Telemetry {",
    "    fn emit(&self) {",
    "        #[cfg(feature = \"tracing\")]",
    "        {",
    "            let _span = 1;",
    "        }",
    "    }",
    "    fn flush(&self);",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Telemetry", src);
  assert.ok(/fn emit\(&self\)\s*;/.test(out), `the cfg lives in the body being dropped; the METHOD itself is unconditional.${dump(out)}`);
  assert.ok(/fn flush\(&self\)\s*;/.test(out), dump(out));
});

test("a cfg on the PREVIOUS top-level item does not refuse the trait: the boundary scan stops at that item's end", () => {
  const src = [
    "#[cfg(test)]",
    "fn helper() {}",
    "",
    "pub trait Clean {",
    "    fn run(&self);",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Clean", src);
  assert.ok(/fn run\(&self\)\s*;/.test(out), `the cfg gates `+"`helper`"+`, whose \`}\` is the boundary.${dump(out)}`);
});

// ===========================================================================
// 5. REFUSALS the blind contract does not reach.
// ===========================================================================

// Each row is one refusal branch; the assertion is always "unchanged".
for (const [label, src] of [
  [
    "an item head the parser has not accounted for (a nested `impl`) refuses whole",
    ["pub trait Odd {", "    fn ok(&self);", "    impl Odd for () {}", "}"].join("\n"),
  ],
  [
    "a trailing item with no terminator refuses whole",
    ["pub trait Odd {", "    fn ok(&self);", "    fn unfinished(&self)", "}"].join("\n"),
  ],
  [
    "a macro metavariable in an item refuses whole",
    ["pub trait Odd {", "    fn take(&self, v: $t);", "}"].join("\n"),
  ],
  [
    "duplicate declarations refuse on COUNT even when they agree (blind Q4)",
    [
      "pub trait Odd {",
      "    fn ok(&self);",
      "}",
      "mod inner {",
      "    pub trait Odd {",
      "        fn ok(&self);",
      "    }",
      "}",
    ].join("\n"),
  ],
  [
    "const-generic braces in a signature are beyond this parser and refuse whole",
    // `Matrix<{ N }>`'s brace reads as a default body opening; the leftover
    // `>` then fails item classification. Refusal, not a mangled surface.
    ["pub trait Odd {", "    fn shape(&self) -> Matrix<{ N }>;", "}"].join("\n"),
  ],
]) {
  test(label, () => {
    const sig = "pub trait Odd";
    assert.equal(recoverTraitSurface(sig, src), sig);
  });
}

test("a doc comment above the head that MENTIONS #[cfg( refuses: over-refusal is the chosen direction", () => {
  // The decoration span is scanned as raw bytes, so prose naming the attribute
  // is indistinguishable from the attribute. Refusing costs the prompt nothing
  // it had before; rendering a trait that might be gated would be the lie.
  const src = [
    "/// Wrap in #[cfg(feature = \"x\")] when porting.",
    "pub trait Documented {",
    "    fn run(&self);",
    "}",
  ].join("\n");
  const sig = "pub trait Documented";
  assert.equal(recoverTraitSurface(sig, src), sig);
});

// ===========================================================================
// 5b. PROVENANCE ON THE TRIGGER (goal decision rule 4). External traits ship
//     DARK: a def in the cargo registry (or sysroot) refuses recovery even
//     when its source is readable, and degrades to the pre-session bare head.
//     Driven through the WALK because the gate lives in the wiring, not the
//     pure function.
// ===========================================================================

test("trait recovery fires for a WORKSPACE def and refuses a cargo-registry def (externals stay dark)", async () => {
  const REGISTRY =
    "file:///home/user/.cargo/registry/src/index.crates.io-6f17d22bba15001f/base64-0.21.7/src/engine/mod.rs";
  const WS = "file:///work/iv41p1";
  const TRAIT_SRC = [
    "pub trait Engine {",
    "    fn encode(&self, input: &[u8]) -> String;",
    "}",
    "",
  ].join("\n");
  const wordAt = (text, cursor) => {
    const line = (text || "").split("\n")[cursor.line] ?? "";
    const isWord = (c) => /[A-Za-z0-9_]/.test(c);
    let s = Math.min(cursor.character, line.length);
    let e = s;
    while (s > 0 && isWord(line[s - 1])) s--;
    while (e < line.length && isWord(line[e])) e++;
    return line.slice(s, e) || undefined;
  };
  const walkFrom = async (defUri) => {
    const mainUri = `${WS}/main.rs`;
    const main = "pub fn run(e: Engine) -> u32 {\n    todo!()\n}\n";
    const files = { [mainUri]: main, [defUri]: TRAIT_SRC };
    const extractor = {
      definition: async (c) => {
        if (wordAt(files[c.uri], c) !== "Engine") return undefined;
        const ln = TRAIT_SRC.split("\n").findIndex((l) => /trait Engine/.test(l));
        const ch = TRAIT_SRC.split("\n")[ln].indexOf("Engine");
        return { uri: defUri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + 6 } };
      },
      hoverSurface: async (c) =>
        wordAt(files[c.uri], c) === "Engine" ? { signature: "pub trait Engine" } : undefined,
      membersOfType: async () => [],
    };
    const rootSite = { uri: mainUri, line: 0, character: main.indexOf("Engine") };
    const shape = await resolveCrossFileShape(extractor, rootSite, { D_MAX: 2, N_MAX: 8 }, async (u) => files[u]);
    return shape.types.get("Engine")?.signature;
  };
  assert.match(
    (await walkFrom(`${WS}/engine.rs`)) ?? "",
    /fn encode\(&self, input: &\[u8\]\)\s*->\s*String\s*;/,
    "a workspace-defined trait recovers its surface",
  );
  assert.equal(
    await walkFrom(REGISTRY),
    "pub trait Engine",
    "a registry def refuses recovery even with readable source: externals are dark pending their own measurement (decision rule 4)",
  );
});

// ===========================================================================
// 6. THE TRIGGER'S EDGES beyond the blind rows.
// ===========================================================================

test("trigger: pub(crate) visibility and a leading path line still read as a bare head", () => {
  assert.equal(isBareTraitHover("pub(crate) trait Internal"), true);
  assert.equal(isBareTraitHover("acme_db::validate\n\npub trait Validate"), true);
});

test("trigger: an empty-braced trait hover does not trigger (blind Q3, pinned here, not in the oracle)", () => {
  // Any brace means the server rendered a body; `pub trait Marker {}` already
  // IS the whole surface, so there is nothing bare to recover.
  assert.equal(isBareTraitHover("pub trait Marker {}"), false);
});

// ===========================================================================
// 7. NO PHANTOM FIELDS. The walk runs parseFields over the RECOVERED signature
//    (crossFileShape.ts), so a trait surface must parse to zero fields. That
//    holds only because splitTopLevelCommas skips a return arrow's `>`;
//    without the guard, depth goes negative at the first `->` and param-list
//    commas split at "depth 0" (session-v41 adversarial rows P1-P3).
// ===========================================================================

test("a recovered trait surface with multi-parameter arrow methods parses to ZERO fields", () => {
  const src = [
    "pub trait Store {",
    "    fn get(&self, key: &str) -> Option<Payload>;",
    "    fn put(&self, key: &str, value: Payload) -> Result<Receipt, StoreError>;",
    "    async fn evict(&self, key: &str, force: bool) -> bool;",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Store", src);
  assert.notEqual(out, "pub trait Store", `precondition: the trait recovers.${dump(out)}`);
  assert.deepEqual(parseStructHoverFields(out), [], `phantom fields off method params.${dump(out)}`);
});

test("the arrow guard also fixes STRUCT parsing: a field after an `Fn(..) -> T` field still splits", () => {
  // Before the guard the arrow's `>` closed a bracket it never opened, the
  // real `>` drove depth to -1, and the comma after `f` was no longer "top
  // level" - `g` fused into `f`'s type.
  const fields = parseStructHoverFields(
    "pub struct S {\n    pub f: Box<dyn Fn(u8) -> u16>,\n    pub g: u32,\n}",
  );
  assert.deepEqual(fields, [
    { name: "f", typeName: "Box<dyn Fn(u8) -> u16>" },
    { name: "g", typeName: "u32" },
  ]);
});

// ===========================================================================
// 8. END TO END THROUGH THE PRE-FILL GATE. The gate (fnGen.ts, admitsEmptyShape
//    seam) must admit a recovered trait: methods and fields are BOTH empty by
//    the trigger's own precondition, so without the admission the surface is
//    built and then dropped to "nothing renderable". Bundled with the vscode
//    stub, the adversarial-v38-p1 harness pattern.
// ===========================================================================

const STUB = path.join(__dirname, ".impl-v41-p1-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
  with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(p) {
    const ps = p.start ? p.start : p, pe = p.end ? p.end : p;
    const geS = ps.line > this.start.line || (ps.line === this.start.line && ps.character >= this.start.character);
    const leE = pe.line < this.end.line || (pe.line === this.end.line && pe.character <= this.end.character);
    return geS && leE;
  }
  with(s, e) { return new Range(s || this.start, e || this.end); }
}
class Selection extends Range {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__IV41P1_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".impl-v41-p1-prefill.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v41-p1-prefill.bundle.cjs");
let resolvePrefill;
let prefillBundleErr;
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ resolvePrefill } = require(OUTFILE));
} catch (e) {
  prefillBundleErr = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("prefill bundle guard: resolvePrefill builds headless against the vscode stub", () => {
  if (prefillBundleErr) assert.fail(`bundle failed to build: ${prefillBundleErr.message}`);
  assert.equal(typeof resolvePrefill, "function");
});
const ptest = (name, fn) =>
  test(name, (ctx) => {
    if (prefillBundleErr) return ctx.skip("prefill bundle broken; see its guard");
    return fn(ctx);
  });

const WS = "file:///work/iv41p1";

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new V.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new V.Position(lines.length - 1, 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

function makeExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    const on = [...known].filter((t) => new RegExp(`\\b${t}\\b`).test(line));
    return on.length === 1 ? on[0] : undefined;
  };
  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (c) => {
      const t = typeAtCursor(c.uri, c);
      const h = t ? defTypes[t].hover : undefined;
      return h ? { signature: h } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return (t && defTypes[t].members) || [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

// One rust target function taking the types as params, prefilled end to end.
async function runRustPrefill(types) {
  const mainUri = `${WS}/main.rs`;
  const names = types.map((t) => t.name);
  const signature = `pub fn decide(${names.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`;
  const src = `/// Decide the outcome.\n${signature} {\n    todo!()\n}\n`;
  const files = { [mainUri]: src };
  const defTypes = {};
  for (const t of types) {
    const uri = `${WS}/${t.name.toLowerCase()}.rs`;
    files[uri] = t.src;
    defTypes[t.name] = { uri, hover: t.hover, members: t.members || [] };
  }
  const record = {
    span: { start: src.indexOf(signature), end: src.length - 1 },
    signature,
    docComment: "Decide the outcome.",
    symbolName: "decide",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  const ext = makeExtractor(files, defTypes);
  globalThis.__IV41P1_FILES__ = files;
  try {
    const out = await resolvePrefill(ext, makeDoc(src, mainUri), record, () => {});
    return out || "";
  } finally {
    delete globalThis.__IV41P1_FILES__;
  }
}

const TRAIT_SRC = [
  "/// Validates a raw event payload.",
  "pub trait Validate {",
  "    fn validate(&self, event_value: &[u8]) -> Result<(), String>;",
  "}",
  "",
].join("\n");

ptest("a bare-hover trait renders END TO END: recovery fires in the walk and the gate admits the surface", async () => {
  const text = await runRustPrefill([
    { name: "Validate", hover: "pub trait Validate", src: TRAIT_SRC },
  ]);
  assert.ok(
    /pub trait Validate \{/.test(text),
    `the recovered surface must survive the admitsEmptyShape gate into the prompt.${dump(text)}`,
  );
  assert.ok(
    /fn validate\(&self, event_value: &\[u8\]\)\s*->\s*Result<\(\), String>\s*;/.test(text),
    `the method signature is the payload the admission exists to deliver.${dump(text)}`,
  );
});

ptest("a bare trait whose recovery REFUSED does not render a shape block (the fastbloom bar holds)", async () => {
  // Duplicate declarations force the refusal; the signature stays four words,
  // which has no body and must fail the admission - falling through exactly as
  // it did before phase 1.
  const dupSrc = [
    "pub trait Validate {",
    "    fn a(&self);",
    "}",
    "mod inner {",
    "    pub trait Validate {",
    "        fn b(&self);",
    "    }",
    "}",
    "",
  ].join("\n");
  const text = await runRustPrefill([
    { name: "Validate", hover: "pub trait Validate", src: dupSrc },
  ]);
  assert.ok(
    !/pub trait Validate \{/.test(text) && !/fn a\(&self\)/.test(text),
    `a refused recovery must not inject a guessed surface.${dump(text)}`,
  );
});
