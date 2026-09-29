// The macro-member fallback remembers its answer per server session, keyed on
// the def file and type name, checked against the def file's current text,
// and expired after 30s.
//
// Why: the fallback runs on FIM's keystroke path. Without the memo every walk
// that reaches a macro-generated type re-asks references() and completion, and
// a references() cancelled by the next edit came back empty and printed a false
// "no path" line. With it, a repeat walk costs nothing and an empty answer is
// reported as unavailable, never remembered.
//
// White-box over `macroMembersViaPath` with a hand-built fake extractor that
// counts its asks. Each row makes its own extractor, because the memo is
// per extractor.
//
// Run: node --test test/impl-v76-p2-macro-memo.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v76-p2-memo",
  `export { macroMembersViaPath, macroGeneratedLine } from "../src/core/macroMembers";\n`,
);
test.after(cleanup);

const DEF = "file:///ids.rs";
const USE = "file:///key.rs";
const DEF_TEXT = "newtype_id!(TenantId);\n";
const USE_TEXT = "fn f() { let t = TenantId::new(1); }\n";
const DEF_CURSOR = { uri: DEF, line: 0, character: 12 };
const DECL = { uri: DEF, line: 0, character: 12, endLine: 0, endCharacter: 20 };
const PATH_REF = { uri: USE, line: 0, character: 17, endLine: 0, endCharacter: 25 };
const NEW = { name: "new", signature: "new(v: u128) -> TenantId", kind: "function" };

// refs: what each references() call answers, in order; the last one repeats.
function fakeWorld({ refs, files = { [DEF]: DEF_TEXT, [USE]: USE_TEXT } }) {
  const calls = { references: 0, completeMembers: 0 };
  const extractor = {
    async references() {
      const answer = refs[Math.min(calls.references, refs.length - 1)];
      calls.references++;
      return answer;
    },
    async completeMembers() {
      calls.completeMembers++;
      return [NEW];
    },
  };
  const openFile = async (uri) => files[uri];
  return { extractor, calls, files, openFile };
}

const ask = (w, now) => mod.macroMembersViaPath(w.extractor, DEF_CURSOR, "TenantId", w.openFile, now);

test("a second walk with the def file unchanged makes zero references() and completion asks", async () => {
  const w = fakeWorld({ refs: [[DECL, PATH_REF]] });
  const first = await ask(w);
  assert.deepEqual(first.members.map((m) => m.name), ["new"], "the first walk found the member through the path");
  assert.deepEqual(w.calls, { references: 1, completeMembers: 1 });
  const second = await ask(w);
  assert.deepEqual(second.members.map((m) => m.name), ["new"], "the memo answers with the same members");
  assert.deepEqual(w.calls, { references: 1, completeMembers: 1 }, "the repeat walk asked the server again");
});

test("a changed def file text re-asks", async () => {
  const w = fakeWorld({ refs: [[DECL, PATH_REF]] });
  await ask(w);
  w.files[DEF] = "newtype_id!(TenantId);\nnewtype_id!(StreamId);\n";
  await ask(w);
  assert.deepEqual(w.calls, { references: 2, completeMembers: 2 }, "an edited def file must not be answered from the memo");
});

test("a separate extractor (another server session) does not share the memo", async () => {
  const a = fakeWorld({ refs: [[DECL, PATH_REF]] });
  const b = fakeWorld({ refs: [[DECL, PATH_REF]] });
  await ask(a);
  await ask(b);
  assert.equal(b.calls.references, 1);
});

test("an empty references() reports unavailable, is not memoized, and the next ask gets the real answer", async () => {
  const w = fakeWorld({ refs: [[], [DECL, PATH_REF]] });
  const cancelled = await ask(w);
  assert.equal(cancelled.unavailable, true, "the declaration is always a reference, so empty means cancelled or failed");
  assert.equal(cancelled.pathAt, undefined);
  assert.equal(cancelled.searched, 0);
  assert.equal(w.calls.completeMembers, 0);
  const line = mod.macroGeneratedLine({ ...cancelled, memberCount: 0 });
  assert.match(line, /macro-generated/);
  assert.match(line, /TenantId/);
  assert.doesNotMatch(line, /no `TenantId::` path exists/, `an unavailable answer must not claim there is no path; got: ${line}`);

  const real = await ask(w);
  assert.equal(real.unavailable, undefined);
  assert.deepEqual(real.members.map((m) => m.name), ["new"]);
  assert.equal(w.calls.references, 2, "the empty answer was served from the memo");
});

test("a throwing references() is unavailable too, and not memoized", async () => {
  let n = 0;
  const w = fakeWorld({ refs: [[DECL, PATH_REF]] });
  const inner = w.extractor.references;
  w.extractor.references = async (...a) => {
    if (n++ === 0) throw new Error("content modified");
    return inner(...a);
  };
  assert.equal((await ask(w)).unavailable, true);
  assert.deepEqual((await ask(w)).members.map((m) => m.name), ["new"]);
});

test("a no-path answer is kept for 30s, then re-asked so a `Type::` written later is found", async () => {
  const w = fakeWorld({ refs: [[DECL], [DECL, PATH_REF]] });
  let clock = 1_000_000;
  const now = () => clock;
  const none = await ask(w, now);
  assert.equal(none.pathAt, undefined);
  assert.equal(none.unavailable, undefined, "a declaration-only answer is a genuine no-path");

  clock += 29_000;
  assert.equal((await ask(w, now)).pathAt, undefined);
  assert.equal(w.calls.references, 1, "inside the window the no-path answer comes from the memo");

  clock += 2_000;
  const later = await ask(w, now);
  assert.equal(w.calls.references, 2, "past the window the no-path answer expired");
  assert.deepEqual(later.members.map((m) => m.name), ["new"]);
});

test("an answer with a path expires after 30s", async () => {
  const w = fakeWorld({ refs: [[DECL, PATH_REF]] });
  let clock = 0;
  const now = () => clock;
  await ask(w, now);
  clock = 29_999;
  await ask(w, now);
  assert.equal(w.calls.references, 1, "inside the window the memo answers");
  clock = 30_000;
  await ask(w, now);
  assert.equal(w.calls.references, 2, "a macro body or impl edited elsewhere must be seen within 30s");
});

test("the key has no position: the same type after an edit above it hits once the text settles", async () => {
  const w = fakeWorld({ refs: [[DECL, PATH_REF]] });
  await ask(w);
  w.files[DEF] = "// moved\n" + DEF_TEXT;
  const moved = { uri: DEF, line: 1, character: 12 };
  await mod.macroMembersViaPath(w.extractor, moved, "TenantId", w.openFile);
  await mod.macroMembersViaPath(w.extractor, moved, "TenantId", w.openFile);
  assert.equal(w.calls.references, 2, "one re-ask for the changed text, then the memo answers");
});
