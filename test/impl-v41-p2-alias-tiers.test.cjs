// WHITE-BOX, session-v41 phase 2. Written against the tier-2 alias chase in
// `src/core/crossFileShape.ts` after reading it (aliasChaseHead,
// aliasTargetCursor, the viaAlias queue rule, the post-walk method copy-up).
// The black-box contract is test/blind-v41-p2-alias-tiers.test.cjs, which
// drives resolvePrefill; this file drives the WALK directly and inspects the
// shape, because the chase decisions live there and a payload assertion cannot
// tell which seam made them.
//
// Run: SKIP_LIVE=1 node --test test/impl-v41-p2-alias-tiers.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v41-p2-alias-tiers",
  `export { resolveCrossFileShape } from "../src/core/crossFileShape";\n`,
);
const { resolveCrossFileShape } = mod;
test.after(cleanup);

const WS = "file:///work/iv41p2";
const SYSROOT =
  "file:///home/user/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/core/src/time.rs";

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

// Same shapes as the blind harness: definition resolves the word under the
// cursor; membersOfType answers ONLY in the type's own def file (spike-3b's
// proven server shape - the def-site hop is the only road to a method list).
function makeExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
  const typeAt = (c) => {
    const w = wordAt(files[c.uri], c);
    return w && known.has(w) ? w : undefined;
  };
  return {
    definition: async (c) => {
      const t = typeAt(c);
      if (!t) return undefined;
      const uri = defTypes[t].uri;
      const lines = (files[uri] || "").split("\n");
      let ln = lines.findIndex((l) => new RegExp(`\\b(?:type|struct|enum|trait)\\s+${t}\\b`).test(l));
      if (ln < 0) ln = 0;
      const ch = Math.max(0, lines[ln].indexOf(t));
      return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
    },
    hoverSurface: async (c) => {
      const t = typeAt(c);
      return t && defTypes[t].hover ? { signature: defTypes[t].hover } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAt(c);
      if (!t) return [];
      return c.uri === defTypes[t].uri ? defTypes[t].members || [] : [];
    },
  };
}

// Walk from a reference to `rootName` in a one-line main file.
async function walk(rootName, types) {
  const mainUri = `${WS}/main.rs`;
  const main = `pub fn use_it(x: ${rootName}) -> u32 {\n    todo!()\n}\n`;
  const files = { [mainUri]: main };
  const defTypes = {};
  for (const t of types) {
    files[t.uri] = t.src;
    defTypes[t.name] = t;
  }
  const openFile = async (uri) => files[uri];
  const rootSite = { uri: mainUri, line: 0, character: main.indexOf(rootName) };
  return resolveCrossFileShape(makeExtractor(files, defTypes), rootSite, { D_MAX: 2, N_MAX: 8 }, openFile);
}

const TARGET = {
  name: "Target",
  uri: `${WS}/target.rs`,
  hover: ["pub struct Target {", "    pub width: u32,", "}"].join("\n"),
  src: [
    "pub struct Target {",
    "    pub width: u32,",
    "}",
    "impl Target {",
    "    pub fn grow(&mut self, by: u32) {}",
    "}",
    "",
  ].join("\n"),
  members: [{ name: "grow", kind: "method", signature: "grow(&mut self, by: u32)" }],
};

// ===========================================================================
// 1. HEAD PARSING EDGES. Each row states what the chase must and must not take.
// ===========================================================================

test("alias with an old-style where-clause before `=` still chases the RHS head", async () => {
  const alias = {
    name: "Frozen",
    uri: `${WS}/frozen.rs`,
    hover: "pub type Frozen<T> where T: Clone = Target",
    src: ["pub type Frozen<T> where T: Clone = Target;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Frozen", [alias, TARGET]);
  assert.equal(shape.types.get("Frozen")?.aliasTarget, "Target", "the where-clause sits between name and `=` and must not defeat the decl parse");
  assert.ok(shape.types.has("Target"), "the target entered the walk");
});

test("alias to a tuple type has no head to chase: tier-1 line only, no aliasTarget", async () => {
  const alias = {
    name: "Pair",
    uri: `${WS}/pair.rs`,
    hover: "pub type Pair = (u32, u64)",
    src: ["pub type Pair = (u32, u64);", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Pair", [alias]);
  const t = shape.types.get("Pair");
  assert.equal(t?.signature, "pub type Pair = (u32, u64)", "the one-line hover is the surface");
  assert.equal(t?.aliasTarget, undefined, "a tuple RHS opens with `(`; there is no ident to chase");
});

test("alias to a generic with NESTED angle brackets chases the outer head only", async () => {
  const inner = {
    name: "Inner",
    uri: `${WS}/inner.rs`,
    hover: "pub struct Inner {\n    pub leaf: u8,\n}",
    src: "pub struct Inner {\n    pub leaf: u8,\n}\n",
    members: [],
  };
  const outer = {
    name: "Outer",
    uri: `${WS}/outer.rs`,
    hover: "pub struct Outer<A, B> {\n    pub first: u32,\n}",
    src: "pub struct Outer<A, B> {\n    pub first: u32,\n}\n",
    members: [],
  };
  const alias = {
    name: "Deep",
    uri: `${WS}/deep.rs`,
    hover: "pub type Deep = Outer<Inner<u8>, u32>",
    src: ["pub type Deep = Outer<Inner<u8>, u32>;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Deep", [alias, outer, inner]);
  assert.equal(shape.types.get("Deep")?.aliasTarget, "Outer", "the head, not a generic argument");
  assert.ok(shape.types.has("Outer"), "the outer target resolved");
  // Inner may only arrive via Outer's OWN field edges (it has none here) -
  // never via the alias chase reading inside the angle brackets.
  assert.ok(!shape.types.has("Inner"), "a generic ARGUMENT is not the chase target");
});

test("a generic-parameter DEFAULT does not fool the `=` cut: the REAL target is chased, not the default", async () => {
  // `pub type Cache<K = MyKey> = Store<K>` carries TWO `=`; the decl's own is
  // the one at angle depth zero. Cutting at the first chases MyKey and the
  // copy-up hands Cache MyKey's methods (adversarial W1).
  const myKey = {
    name: "MyKey",
    uri: `${WS}/my_key.rs`,
    hover: "pub struct MyKey {\n    pub raw: u64,\n}",
    src: "pub struct MyKey {\n    pub raw: u64,\n}\n",
    members: [{ name: "hash_hint", kind: "method", signature: "hash_hint(&self) -> u64" }],
  };
  const store = {
    name: "Store",
    uri: `${WS}/store.rs`,
    hover: "pub struct Store<K> {\n    pub len: usize,\n}",
    src: "pub struct Store<K> {\n    pub len: usize,\n}\n",
    members: [{ name: "insert", kind: "method", signature: "insert(&mut self, key: K)" }],
  };
  const alias = {
    name: "Cache",
    uri: `${WS}/cache_def.rs`,
    hover: "pub type Cache<K = MyKey> = Store<K>",
    src: ["pub type Cache<K = MyKey> = Store<K>;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Cache", [alias, myKey, store]);
  const cache = shape.types.get("Cache");
  assert.equal(cache?.aliasTarget, "Store", "the depth-zero `=` is the declaration's cut");
  assert.ok(shape.types.has("Store"), "the real target entered the walk");
  assert.ok(!shape.types.has("MyKey"), "the default type is not the chase target");
  assert.ok(
    cache?.methods.some((m) => /insert\(/.test(m)) && !cache?.methods.some((m) => /hash_hint/.test(m)),
    `the copy-up carries Store's surface, never MyKey's: ${JSON.stringify(cache?.methods)}`,
  );
});

test("a const-generic default's `=` is inside the brackets too: `type Fixed<const N: usize = 4> = Grid<N>` chases Grid", async () => {
  const grid = {
    name: "Grid",
    uri: `${WS}/grid.rs`,
    hover: "pub struct Grid<const N: usize> {\n    pub cells: u32,\n}",
    src: "pub struct Grid<const N: usize> {\n    pub cells: u32,\n}\n",
    members: [],
  };
  const alias = {
    name: "Fixed",
    uri: `${WS}/fixed.rs`,
    hover: "pub type Fixed<const N: usize = 4> = Grid<N>",
    src: ["pub type Fixed<const N: usize = 4> = Grid<N>;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Fixed", [alias, grid]);
  assert.equal(shape.types.get("Fixed")?.aliasTarget, "Grid");
  assert.ok(shape.types.has("Grid"), "the const default did not terminate the LHS early");
});

test("an RHS that IS the alias's own generic parameter stays tier 1 (`pub type Chan<Fut2> = Fut2`)", async () => {
  // Multi-character, so the single-capital skip cannot stop it; the param
  // list off the decl must (adversarial W5). The "definition" of Fut2 is the
  // alias's own line and its hover is chrome - walking it emits a junk def.
  const alias = {
    name: "Chan",
    uri: `${WS}/chan.rs`,
    hover: "pub type Chan<Fut2> = Fut2",
    src: ["pub type Chan<Fut2> = Fut2;", ""].join("\n"),
    members: [],
  };
  const param = { name: "Fut2", uri: `${WS}/chan.rs`, hover: "Fut2", src: alias.src, members: [] };
  const shape = await walk("Chan", [alias, param]);
  const chan = shape.types.get("Chan");
  assert.equal(chan?.signature, "pub type Chan<Fut2> = Fut2", "tier-1 line survives");
  assert.equal(chan?.aliasTarget, undefined, "the alias's own parameter is never its target");
  assert.ok(!shape.types.has("Fut2"), "no chrome hover enters the shape");
});

test("a single-letter RHS head is a generic parameter, never chased", async () => {
  const alias = {
    name: "Id",
    uri: `${WS}/id.rs`,
    hover: "pub type Id<V> = V",
    src: ["pub type Id<V> = V;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Id", [alias]);
  assert.equal(shape.types.get("Id")?.aliasTarget, undefined, "`V` is the alias's own parameter; chasing it spends a definition round trip on nothing");
});

// ===========================================================================
// 2. DECL-SITE EDGES.
// ===========================================================================

test("alias declared inside a module: the chase cursor anchors on the indented decl line", async () => {
  const alias = {
    name: "ModCache",
    uri: `${WS}/mod_cache.rs`,
    hover: "pub type ModCache = Target",
    src: ["mod caches {", "    pub type ModCache = Target;", "}", ""].join("\n"),
    members: [],
  };
  const shape = await walk("ModCache", [alias, TARGET]);
  assert.equal(shape.types.get("ModCache")?.aliasTarget, "Target");
  assert.ok(shape.types.has("Target"), "the indented decl line still carries the `=` and the ident");
});

test("a multi-line alias decl (RHS not on the name's line) skips the chase, keeps tier 1", async () => {
  const alias = {
    name: "Wrapped",
    uri: `${WS}/wrapped.rs`,
    hover: "pub type Wrapped = Target",
    src: ["pub type Wrapped =", "    Target;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Wrapped", [alias, TARGET]);
  const t = shape.types.get("Wrapped");
  assert.equal(t?.signature, "pub type Wrapped = Target", "tier 1 is the hover line, chase or no chase");
  assert.equal(t?.aliasTarget, undefined, "the ident is not on the decl line; refuse-unless-proven skips the hop");
});

// ===========================================================================
// 3. PROVENANCE, not names. The predicate is the def's path - the one thing a
//    project shadow and the real std type do not share.
// ===========================================================================

test("an RHS head that shadows a std name but is PROJECT-defined is chased (provenance decides, the name set cannot)", async () => {
  const duration = {
    name: "Duration",
    uri: `${WS}/duration.rs`,
    hover: "pub struct Duration {\n    pub frames: u32,\n}",
    src: "pub struct Duration {\n    pub frames: u32,\n}\n",
    members: [],
  };
  const alias = {
    name: "Window",
    uri: `${WS}/window.rs`,
    hover: "pub type Window = Duration",
    src: ["pub type Window = Duration;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Window", [alias, duration]);
  assert.equal(shape.types.get("Window")?.aliasTarget, "Duration");
  assert.ok(shape.types.has("Duration"), "the project-defined shadow is a project target");
});

test("the same alias with Duration resolving into the sysroot is refused on provenance", async () => {
  const duration = {
    name: "Duration",
    uri: SYSROOT,
    hover: "pub struct Duration {\n    secs: u64,\n}",
    src: "pub struct Duration {\n    secs: u64,\n}\n",
    members: [{ name: "as_secs", kind: "method", signature: "as_secs(&self) -> u64" }],
  };
  const alias = {
    name: "Window",
    uri: `${WS}/window.rs`,
    hover: "pub type Window = Duration",
    src: ["pub type Window = Duration;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Window", [alias, duration]);
  assert.ok(!shape.types.has("Duration"), "a sysroot def is not a project target; the chase is refused");
  assert.ok(shape.dropped.includes("Duration"), "the refusal is recorded, never silent");
  assert.equal(shape.types.get("Window")?.methods.length, 0, "no std members may ride up through the copy-up");
});

// ===========================================================================
// 4. SINGLE HOP AND THE COPY-UP.
// ===========================================================================

test("alias-to-alias stops after one hop: the second alias is never chased", async () => {
  const first = {
    name: "First",
    uri: `${WS}/first.rs`,
    hover: "pub type First = Second",
    src: ["pub type First = Second;", ""].join("\n"),
    members: [],
  };
  const second = {
    name: "Second",
    uri: `${WS}/second.rs`,
    hover: "pub type Second = Target",
    src: ["pub type Second = Target;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("First", [first, second, TARGET]);
  assert.equal(shape.types.get("First")?.aliasTarget, "Second", "the first hop runs");
  assert.equal(shape.types.get("Second")?.aliasTarget, undefined, "a target reached via an alias is never chased again");
  assert.ok(!shape.types.has("Target"), "the terminal type is two hops away and must not resolve");
});

test("the copy-up: an alias's methods are its chased target's, resolved at the target's def site", async () => {
  const alias = {
    name: "Grower",
    uri: `${WS}/grower.rs`,
    hover: "pub type Grower = Target",
    src: ["pub type Grower = Target;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Grower", [alias, TARGET]);
  const a = shape.types.get("Grower");
  const t = shape.types.get("Target");
  assert.ok(t && t.methods.length > 0, "precondition: the target's def-site hop resolved members");
  assert.deepEqual(a?.methods, t.methods, "a value of the alias type calls exactly the target's methods");
  assert.equal(a?.methodsResolved, true, "the copy carries the resolution claim with the list");
});
