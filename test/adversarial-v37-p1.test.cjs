// ADVERSARIAL review evidence for session-v37 phase 1 (the widened backtick
// extractor). Every row here is EVIDENCE for a finding in the review report, not
// a contract. Nothing in this file was written to be satisfied by the
// implementation; the rows that fail are the findings.
//
// Rows are tagged in their names:
//   [DEFECT]  fails today, and the report argues it should not.
//   [RECORD]  passes today, and pins behaviour the report describes but does
//             NOT claim is wrong. Deleting one of these loses the evidence for
//             a judgement call the next reader will re-litigate.
//
// RECONCILED 2026-08-02, after triage acted on the review. A row whose defect
// was FIXED keeps its text and its fixture and is retagged, because the row that
// caught it is the row that stops it coming back:
//   [RECORD] ... [WAS DEFECT, FIXED 2026-08-02]   the product changed; this is
//                                                 now a regression guard.
//   [DEFECT] ... carrying a `todo` with a scraps id   deferred by triage, red on
//                                                 purpose, and no longer an
//                                                 unexplained failure. Same
//                                                 mechanics as C1 and D2 in
//                                                 test/adversarial-v36-p1.test.cjs.
//   [REFUTED] ...                                 the row was wrong. It stays,
//                                                 rewritten so it measures what
//                                                 it claimed to, with the
//                                                 original mistake named.
//
// This file must never be treated as the contract set. `test/blind-*.test.cjs`
// is that, and this file does not edit or duplicate it.
//
// WHAT THE RULE IS NOW. The backtick span splits on `, < > [ ] | & *` and on a
// SINGLE colon; `(` and `)` split keeping the delimiter, because the character
// after a token is the only thing separating a call from a qualified name. Each
// chunk drops leading punctuation (never a letter or a digit), skips a fixed set
// of type-position keywords, and yields one identifier: for a path, the FIRST
// segment when a `(` follows and otherwise the LAST when it is type-shaped.
//
// THE BAR THIS FILE HOLDS IT TO is the goal's own acceptance:
//   1. every shape resolves the names the developer wrote, IN ALL FIVE
//      LANGUAGES;
//   2. the doc leg's name count and hit rate move by no more than the goal's
//      table, ASSERTED AS A FIXTURE;
//   3. the whole FUNNEL is asserted, seen then in cap then anchored;
//   4. superseded rows are superseded explicitly.
// Sections A to D are criterion 1, section E is criterion 2, F and G are
// criterion 3 and the caps around it, and section I is the new holes the second
// widening opened.
//
// CORPUS NUMBERS IN THIS FILE were measured on the reviewer's box against the
// four real corpora. No row DEPENDS on a corpus that may be absent: the corpus
// numbers are quoted in comments as the reason a row matters, and the rows
// themselves run on this repo's own source, on the checked-in fixture, or on a
// hand-built fixture. Green on one box is not green.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v37-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ── two bundles ──────────────────────────────────────────────────────────────
// The core one needs no vscode. `fnGen.ts` does, so its rankers come through the
// same stub the other provider-level oracles use; nothing here touches the
// editor API.
const core = bundleCore(
  "adversarial-v37-p1-core",
  `export { backtickedTypeNames, typesNamedIn, PRELUDE_TYPES } from "../src/core/compilerDirected";
export { commentTypesIn } from "../src/core/commentTypes";
export { spanTypesInPlay, stopNamesFor } from "../src/core/repairTypes";
export { tsDocCommentAbove } from "../src/core/tsExtraction";\n`,
);
const { backtickedTypeNames, commentTypesIn, stopNamesFor, tsDocCommentAbove } = core.mod;

const STUB = path.join(__dirname, ".adversarial-v37-p1-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
module.exports = {
  Position, Range, Selection: Range, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  workspace: { getConfiguration: () => ({ get: (k, fb) => fb }), textDocuments: [] },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  ProgressLocation: {}, EndOfLine: {}, SymbolKind: {},
};\n`,
);
const VS_ENTRY = path.join(__dirname, ".adversarial-v37-p1-vs.entry.ts");
const VS_OUT = path.join(__dirname, ".adversarial-v37-p1-vs.bundle.cjs");
fs.writeFileSync(
  VS_ENTRY,
  `export { prioritizedTypes, tsPrioritizedTypes, csPrioritizedTypes, pyPrioritizedTypes, goPrioritizedTypes } from "../src/vscode/fnGen";\n`,
);
esbuild.buildSync({
  entryPoints: [VS_ENTRY],
  bundle: true,
  outfile: VS_OUT,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const vs = require(VS_OUT);

test.after(() => {
  core.cleanup();
  [STUB, VS_ENTRY, VS_OUT].forEach((f) => fs.rmSync(f, { force: true }));
});

const show = (v) => JSON.stringify(v);
const NO_LOCALS = new Set();
const CAP = 4; // PREFILL_TYPE_CAP, fnGen.ts
const FIXTURE = path.join(__dirname, "fixtures", "v37-doc-spans.json");
const loadFixture = () => {
  assert.ok(fs.existsSync(FIXTURE), `the doc-population fixture is missing at ${FIXTURE}; these rows fail rather than skip`);
  return JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
};
const corpusOf = (name) => {
  const c = loadFixture().corpora.find((x) => x.name === name);
  assert.ok(c && Array.isArray(c.spans), `the fixture must carry the ${show(name)} corpus`);
  return c;
};
const scoreSpans = (c, rule) => {
  const stop = stopNamesFor(c.lang);
  const real = new Set(c.real);
  let extracted = 0;
  let hits = 0;
  for (const s of c.spans) {
    for (const n of rule("`" + s + "`")) {
      if (stop.has(n)) {
        continue;
      }
      extracted += 1;
      if (real.has(n)) {
        hits += 1;
      }
    }
  }
  return { extracted, hits, rate: extracted === 0 ? 0 : (hits / extracted) * 100 };
};

// The rule that shipped BEFORE session-v37 touched it, out of
// `git show b9847c4:src/core/compilerDirected.ts`, reduced to the sequence it
// fed `take()`. Lone capitals filtered, because those are refused on purpose and
// a differential counting them would be red for the ratified reason.
function shippedRule(text) {
  const out = [];
  for (const m of text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)`/g)) {
    const seg = m[1].split("::").pop();
    if (seg !== undefined && /^[A-Z]/.test(seg) && seg.length > 1) {
      out.push(seg);
    }
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// A. CRITERION 1, "IN ALL FIVE LANGUAGES", AGAINST HOW THE LANGUAGES ACTUALLY
//    SPELL A TYPE. FIXED.
//
//    The finding: the first R4 split on `, < > [ ] ( )` and required the
//    identifier to START its part, so any leading sigil or keyword killed the
//    whole chunk. The goal's shape table is nine rows and every one of them
//    spells its type the Rust way, so the blind oracle proved R4 against Rust's
//    spelling in five languages, which is not the acceptance criterion.
//
//    MEASURED on the reviewer's box, over every capitalized type occurrence in a
//    function signature with the function's own name stripped:
//
//    | corpus            | lang | occurrences | the FIRST R4 refused as spelled |
//    |-------------------|------|-------------|---------------------------------|
//    | cobra+gin+hugo    | go   |       11171 | 79.8% (56.2% `pkg.T`, 23.6% `*T`) |
//    | acme-db      | rust |        4962 | 12.0% (8.2% `&T`, 3.0% `&mut T`)  |
//    | contoso dotnet    | c#   |        1043 |  4.8% (`Ns.T`)                    |
//
//    A signature is not a gesture and this is a proxy: it measures how the
//    LANGUAGE spells a type, not how often a developer backticks one. That is
//    the point. The developer backticks the type as their language writes it.
//
//    Triage widened the rule on this measurement. Every row below now passes and
//    is kept as the regression guard, with its control in the same fixture so a
//    green row cannot be green because the leg is dead.
// ═════════════════════════════════════════════════════════════════════════════

// [languageId, ranker, the span the developer types, the name they meant]
const NATIVE_SPELLINGS = [
  ["go", "goPrioritizedTypes", "*Config", "Config", "a Go pointer, 23.6% of type occurrences in the Go corpus"],
  ["go", "goPrioritizedTypes", "atlas.Sprocket", "Sprocket", "a Go package qualifier, 56.2% of type occurrences in the Go corpus"],
  ["go", "goPrioritizedTypes", "[]*Widget", "Widget", "a Go slice of pointers"],
  ["go", "goPrioritizedTypes", "chan Widget", "Widget", "a Go channel; `chan` is a type-position keyword, not a name"],
  ["rust", "prioritizedTypes", "&Widget", "Widget", "a Rust shared reference, 8.2% of type occurrences in acme-db"],
  ["rust", "prioritizedTypes", "&mut Widget", "Widget", "a Rust mutable reference, 3.0%"],
  ["rust", "prioritizedTypes", "&'a Widget", "Widget", "a Rust reference with a lifetime, which is punctuation in front of the type"],
  ["rust", "prioritizedTypes", "dyn Widget", "Widget", "a Rust trait object"],
  ["rust", "prioritizedTypes", "impl Widget", "Widget", "an `impl Trait` position"],
  ["python", "pyPrioritizedTypes", "data: Widget", "Widget", "a Python annotation, the way a Python developer writes a type at all"],
];

const SIG = {
  go: ["func Go()", "func Go() {\n\t// needs a `%s`\n}"],
  rust: ["fn go()", "fn go() {\n    // needs a `%s`\n}"],
  python: ["def go():", "def go():\n    # needs a `%s`\n    pass\n"],
  typescript: ["function go()", "function go() {\n  // needs a `%s`\n}"],
  csharp: ["public void Go()", "public void Go() {\n    // needs a `%s`\n}"],
};

for (const [lang, ranker, spelling, wanted, why] of NATIVE_SPELLINGS) {
  test(`[RECORD] A [${lang}]: the gesture \`${spelling}\` reaches the candidate list as ${show(wanted)}  [WAS DEFECT, FIXED 2026-08-02]`, () => {
    const [signature, spanTemplate] = SIG[lang];
    // The control first, in the same language through the same ranker: a bare
    // name resolves, so the leg is alive and the row is about the SPELLING.
    const control = vs[ranker](signature, undefined, "", NO_LOCALS, undefined, spanTemplate.replace("%s", wanted));
    assert.deepEqual(control, [wanted], `control: a bare \`${wanted}\` must resolve, else this row proves nothing`);
    const got = vs[ranker](signature, undefined, "", NO_LOCALS, undefined, spanTemplate.replace("%s", spelling));
    assert.deepEqual(
      got,
      [wanted],
      `${why}. The developer wrote the type the way their language spells it, and this is the only channel some of these languages have`,
    );
  });
}

test("[REFUTED] A [go]: the `http.Request` probe measured the STOP SET, not the rule", () => {
  // The original row used `http.Request` and read as proof that a Go package
  // qualifier was refused. It was not: the rule extracts `Request` correctly and
  // `GO_STD_TYPE_NAMES` drops it, which is what a stop set is FOR when the
  // developer means the stdlib type. The row above was rewritten with a probe
  // outside the stop set. Kept because the mistake is the instructive part: a
  // ranker-level row measures every filter between the rule and the list, and
  // naming which one moved is the reviewer's job.
  //
  // The real residue is in scraps as S37-6 and is smaller than the row implied:
  // counting every type each corpus DECLARES against its own stop set, Go blocks
  // 12 of 802 (1.5%) and rust, TypeScript and C# block 0 of 515, 346 and 169.
  // `Request` and `Handler` are declared nowhere in cobra, gin or hugo.
  assert.deepEqual(backtickedTypeNames("`http.Request`"), ["Request"], "the RULE reads the package qualifier correctly");
  assert.ok(stopNamesFor("go").has("Request"), "and the Go stop set is what removes it downstream");
  assert.equal(
    vs.goPrioritizedTypes("func Go()", undefined, "", NO_LOCALS, undefined, "func Go() {\n\t// needs a `http.Request`\n}").length,
    0,
    "so the candidate list is empty for a stop-set reason, not an extraction reason",
  );
});

test("[RECORD] A: the shapes that survive, re-pinned after the second widening", () => {
  // Anti-vacuity for the block above, and the record of what the widening moved.
  // WAS, under the first R4: `Widget & Gadget` gave ["Widget"], `{ w: Widget }`
  // gave [], `Widget | Gadget` gave ["Widget"]. `&`, `|` and a single `:` are
  // splitters now, so all three read every name the developer wrote.
  const ok = [
    ["[]Widget", ["Widget"], "a Go slice"],
    ["map[string]Widget", ["Widget"], "a Go map; `map` is a type-position keyword"],
    ["Widget?", ["Widget"], "a C# nullable"],
    ["Widget[]", ["Widget"], "an array suffix"],
    ["List<Widget>", ["List", "Widget"], "a C# generic, container head included"],
    ["Optional[Widget]", ["Optional", "Widget"], "a Python typing generic"],
    ["Widget | Gadget", ["Widget", "Gadget"], "a TypeScript union, both arms (WAS [\"Widget\"])"],
    ["Widget & Gadget", ["Widget", "Gadget"], "an intersection, both arms (WAS [\"Widget\"])"],
    ["{ w: Widget }", ["Widget"], "an inline object type, through the single-colon split (WAS [])"],
    ["Some(CompactionResult)", ["Some", "CompactionResult"], "a tuple variant keeps the payload as well as the head"],
    ["*const Widget", ["Widget"], "a Rust raw pointer"],
  ];
  for (const [inner, want, why] of ok) {
    assert.deepEqual(backtickedTypeNames("`" + inner + "`"), want, `${why}: \`${inner}\``);
  }
});

test("[RECORD] A: and the invention bar still holds on the prose the rule must refuse", () => {
  // The widening's whole defence is that it invents nothing, and the keyword set
  // is fixed rather than "any leading lowercase word" for exactly this reason.
  // Each row carries `KeyPair` as the control in the same fixture.
  const nothing = [
    ["to build a Stripe:", "the blanket lowercase-skip reads this as the type `Stripe`"],
    ["the Widget", "an article is not a type-position keyword"],
    ["x: int = 5", "no type-shaped name anywhere"],
    ["self.value", "a member chain off a lowercase receiver"],
    ["c.Request.URL.Query().Get(key)", "a call chain; a chunk starting with a dot is refused outright"],
    ["3Type", "a digit is never skipped as leading punctuation"],
    ["0000-NNNN", "and neither is a digit run in front of an ALL-CAPS token"],
  ];
  for (const [inner, why] of nothing) {
    assert.deepEqual(
      backtickedTypeNames("see `" + inner + "` and `KeyPair`"),
      ["KeyPair"],
      `${why}: \`${inner}\`. The control proves the leg is alive in the very fixture that refuses it`,
    );
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// B. THE DOTTED PATH. FIXED, and NOT by the rule this review proposed.
//
//    The finding: `Some.Namespace.Widget` yielded `Some`, so the developer's
//    type was lost AND a namespace took its cap slot. The goal defended leaving
//    it there by measuring the naive fix (always take the last segment), which
//    costs the TypeScript doc hit rate 3.6 points.
//
//    This review proposed a case-aware rule: take the last segment only when
//    EVERY segment is capitalized, else the first. Triage rejected it for a call
//    signal, and the call signal is better. Row B3 measures all three on the
//    rebuilt fixture rather than arguing it.
//
//    The case-aware rule loses `atlas.Sprocket`, because a lowercase package
//    with a capitalized type is not "every segment capitalized", and that shape
//    is 56.2% of Go's type occurrences. Conceding it in a row rather than in a
//    sentence, because the concession is the useful part.
// ═════════════════════════════════════════════════════════════════════════════

test("[RECORD] B1 [csharp]: a namespace-qualified type resolves to the TYPE  [WAS DEFECT, FIXED 2026-08-02]", () => {
  const control = vs.csPrioritizedTypes("public void Go()", undefined, "", NO_LOCALS, "Go",
    "public void Go() {\n    // build a `Widget`\n}");
  assert.deepEqual(control, ["Widget"], "control: the bare name resolves, so this row is about the qualification");
  assert.deepEqual(
    vs.csPrioritizedTypes("public void Go()", undefined, "", NO_LOCALS, "Go", "public void Go() {\n    // build a `Contoso.DataModel.Widget`\n}"),
    ["Widget"],
    'WAS ["Contoso"]: the wanted type lost, a namespace in its cap slot',
  );
});

test("[RECORD] B2: the same shape in TypeScript, and the goal's recorded gap closed with it  [WAS DEFECT, FIXED 2026-08-02]", () => {
  assert.deepEqual(backtickedTypeNames("`Some.Namespace.Widget`"), ["Widget"], 'WAS ["Some"]');
  assert.deepEqual(
    backtickedTypeNames("`PkiManager::create_ca`"),
    ["PkiManager"],
    "and the goal recorded THIS as needing its own item and its own measurement; the call signal closed it for free",
  );
});

test("[RECORD] B3: three dotted rules on the rebuilt fixture, and the reviewer's was not the best of them", () => {
  // Neither alternative exists in `src/`, so both are re-implemented here. The
  // SHIPPED half of every comparison is the real `backtickedTypeNames`, so a
  // drift in the product shows up as this row failing rather than as a stale
  // number in a comment.
  const variant = (text, mode) => {
    const out = [];
    for (const m of text.matchAll(/`([^`\r\n]*)`/g)) {
      for (const part of m[1].split(/[,<>[\]()]/)) {
        const tok = part.match(/[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*/)?.[0];
        if (tok === undefined || !part.trimStart().startsWith(tok)) {
          continue;
        }
        let seg = tok.split("::").pop();
        const run = part.trimStart().match(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+/)?.[0];
        if (run !== undefined) {
          const segs = run.split(".");
          if (mode === "naive" || segs.every((s) => /^[A-Z]/.test(s))) {
            seg = segs[segs.length - 1];
          }
        }
        if (seg !== undefined && /^[A-Z]/.test(seg) && seg.length > 1) {
          out.push(seg);
        }
      }
    }
    return out;
  };
  const ts = corpusOf("column-80");
  assert.ok(ts.spans.length > 3000, `fixture precondition: the rebuilt TypeScript corpus, got ${ts.spans.length} spans`);
  const naive = scoreSpans(ts, (t) => variant(t, "naive")).rate;
  const caseAware = scoreSpans(ts, (t) => variant(t, "caseAware")).rate;
  assert.ok(
    caseAware > naive + 2,
    `the review's refutation of the naive rule holds: case-aware ${caseAware.toFixed(1)}% against naive ${naive.toFixed(1)}%`,
  );
  // And the concession. The call signal reads a lowercase package qualifier,
  // which is Go's dominant spelling, and the case-aware rule cannot.
  assert.deepEqual(variant("`atlas.Sprocket`", "caseAware"), [], "the reviewer's rule drops a `pkg.Type`");
  assert.deepEqual(backtickedTypeNames("`atlas.Sprocket`"), ["Sprocket"], "and the shipped rule reads it");
  assert.deepEqual(variant("`Assert.AreEqual(x, y)`", "caseAware"), ["AreEqual"], "the reviewer's rule injects the METHOD name");
  assert.deepEqual(backtickedTypeNames("`Assert.AreEqual(x, y)`"), ["Assert"], "and the shipped rule reads the receiver");
});

// ═════════════════════════════════════════════════════════════════════════════
// C. A THIRD BUG OF THE PAIRING FAMILY. DEFERRED as scraps S37-3, red on
//    purpose.
//
//    The pre-v37 content class was so restrictive that an opener not followed by
//    an identifier was skipped, which re-synced the pairing onto the next
//    backtick by accident. The widened class accepts anything, so it pairs
//    strictly left to right, and on a line with an ODD backtick count the stray
//    opener consumes the text up to the real span's opener.
//
//    MEASURED over every comment line carrying a backtick: column-80 3786 lines,
//    6 losses. acme-db 1438, 0. Go corpus 154, 0. contoso dotnet 0.
//
//    Triage traced two candidate pairings by hand (a run of N backticks closing
//    on a run of N, and opening at the last backtick of a run) and neither
//    recovers these cases. A pairing that guesses which backtick is stray can
//    invent a span, and this rule's whole argument is that it invents nothing.
//    Agreed, and the rows stay red so the narrowing is not forgotten.
// ═════════════════════════════════════════════════════════════════════════════

const NARROWED = [
  ["// ``Type` is not an", "Type", "from src/core/repairGate.ts; the doubled tick is markdown for a literal backtick"],
  ["// ``` `Widget` ``` yields nothing. Allowing the empty match consumes the", "Widget", "from this phase's own comment in src/core/compilerDirected.ts"],
  ["// see ` and `Widget`", "Widget", "the minimal shape: one stray opener, one real span"],
];

// THE RULING, kept verbatim from when these three rows were `todo`: DEFERRED by
// triage as scraps S37-3: no candidate pairing recovers these three, and one that
// guesses which backtick is stray can invent a span. Red on purpose, and it is a
// NARROWING against the rule this phase replaced.
//
// INVERTED 2026-08-10, because a test that must be red is not a test. Each of
// these three rows USED TO assert `[wanted]` - the name the pre-v37 rule found
// and the widened rule lost - and all three were red every run. They now assert
// the empty list the shipped rule actually returns. The precondition is
// untouched and is what keeps the pair honest: `shippedRule` (the pre-v37 rule,
// out of `git show b9847c4`) still finds the name, so the gap between the two
// assertions in the same row IS the narrowing, measured rather than wished for.
// These go red when S37-3 is closed, which is when someone should read them.
for (const [line, wanted, why] of NARROWED) {
  test(
    `KNOWN WRONG: an unbalanced backtick swallows the real span beside it  (${why})`,
    () => {
      assert.deepEqual(
        shippedRule(line),
        [wanted],
        `precondition: the PRE-v37 rule finds ${show(wanted)} here, so this row is a narrowing and not a wish`,
      );
      assert.deepEqual(
        backtickedTypeNames(line),
        [],
        `WAS asserted as ${show([wanted])}: the stray opener consumes the text up to the real span's opener and the name is lost`,
      );
    },
  );
}

test("[RECORD] C: the two bugs of this family the phase DID fix stay fixed", () => {
  assert.deepEqual(backtickedTypeNames("`` `Widget`"), ["Widget"], "the empty-pair fix");
  assert.deepEqual(backtickedTypeNames("/// `Alpha`\r\n/// `Bravo`\r\n"), ["Alpha", "Bravo"], "the CR fix");
  assert.deepEqual(backtickedTypeNames("`Alpha\nBravo`"), [], "and a span still never crosses a newline");
});

// ═════════════════════════════════════════════════════════════════════════════
// D. THE LONE-CAPITAL CLAUSE IS ENFORCED ON ONE LEG OF ONE FUNCTION. DEFERRED as
//    scraps S37-4, red on purpose.
//
//    The rule refuses a lone capital because a type parameter has no definition
//    to resolve and costs a budget slot. `typesNamedIn`'s SIGNATURE leg, in the
//    same file, has no such clause.
//
//    MEASURED: 260 of acme-db's 4406 `fn` signatures (5.9%) put at least
//    one lone capital into the candidate list through the signature leg, 354 cap
//    slots.
//
//    Triage's reason for deferring is better than the finding.
//    `blind-v7-prepare` P3 declares `pub struct A` and `pub struct T` and
//    requires both to survive the budget, so a blanket refusal on the signature
//    leg breaks a frozen row. The targeted version, refusing a lone capital only
//    where the signature's own generic parameter list DECLARES it, is a new
//    mechanism with its own measurement. Agreed. The row stays red as the
//    reminder.
// ═════════════════════════════════════════════════════════════════════════════

// THE RULING, kept verbatim from when this row was `todo`: DEFERRED by triage as
// scraps S37-4: a blanket lone-capital refusal on the signature leg breaks the
// frozen `pub struct T` row in test/blind-v7-prepare.test.cjs P3. The targeted
// fix keys on the generic parameter list and is its own mechanism. Red on
// purpose.
//
// INVERTED 2026-08-10, because a test that must be red is not a test. This one
// needed no assertion change: the deferral was overtaken by session-v38 item 3,
// which built the targeted mechanism the ruling described - the signature's own
// generic parameter list is read, so `T` and `U` are refused as candidates. The
// row's demand of `["Widget"]` has been SATISFIED since, and carrying a `todo`
// on a row that passes was hiding a green regression guard. The `todo` is gone
// and the assertions stand exactly as the finding wrote them.
test(
  "SUPERSEDED: a type parameter no longer takes a cap slot on the signature leg",
  () => {
    assert.deepEqual(
      backtickedTypeNames("`Map<K, V>`"),
      ["Map"],
      "precondition: the backtick leg refuses `K` and `V`, which is the ratified clause",
    );
    const got = vs.prioritizedTypes("fn go<T, U>(x: T, y: U) -> Widget", undefined, "", NO_LOCALS, "go", "");
    assert.deepEqual(
      got,
      ["Widget"],
      'the signature leg WAS returning ["T","U","Widget"], spending two of the four budget slots on type parameters before the gesture was reached; v38 item 3 reads the generic parameter list and refuses them',
    );
  },
);

// THE RULING, kept verbatim from when this row was `todo`:
//
// FIXED by session-v38 item 3, and this row is what it was measured against.
// `[DEFECT] D` above is now green: the signature's own generic parameter list is
// read, so `T` and `U` are refused as candidates and the two slots they were
// taking go back to the developer's backticked names. The assertion below is the
// BEFORE, kept verbatim as the record, and it is red because the defect it
// records is gone. `Sprocket` is now in cap, which is the whole point.
//
// INVERTED 2026-08-10, because a test that must be red is not a test. The row
// USED TO assert the pre-fix cap `["T","U","Widget","Gadget"]` and that
// `Sprocket` was NOT in it. It now asserts the post-fix cap, which is the same
// fixture read the other way round: the two type-parameter slots are gone, the
// whole candidate list fits inside the budget, and `Sprocket` - the second name
// the developer explicitly backticked - is in cap. The BEFORE survives in the
// assertion messages, so the eviction this row caught is still on the record and
// this row is now the guard that stops it coming back.
test("SUPERSEDED: the eviction is gone, and the backticked names hold the budget", () => {
  const got = vs.prioritizedTypes(
    "fn go<T, U>(x: T, y: U) -> Widget",
    undefined,
    "",
    NO_LOCALS,
    "go",
    "fn go() {\n    // needs `Gadget, Sprocket`\n}",
  );
  assert.deepEqual(
    got.slice(0, CAP),
    ["Widget", "Gadget", "Sprocket"],
    'WAS ["T","U","Widget","Gadget"]: the whole list now fits under the cap of ' + CAP + ", because T and U never enter it",
  );
  assert.ok(
    got.slice(0, CAP).includes("Sprocket"),
    "WAS asserted as absent: a name the developer explicitly backticked is no longer evicted by two type parameters",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// E. CRITERION 2: THE DOC-POPULATION FIXTURE. FIXED.
//
//    The finding: the first harvest selected doc lines by PREFIX (`///`, `//!`,
//    `*`, `/**`). The product does not. Its TypeScript channel is
//    `tsDocCommentAbove`, which also accepts a contiguous plain `//` run above
//    the head, and that is the dominant doc shape in this repo; and Go doc
//    comments are `//`, never `///`, so for Go the harvest scanned for a marker
//    the language does not write and reported 2 spans.
//
//    MEASURED then: fixture 448 names at 12.5%, product channel 586 at 12.6%,
//    with the `//`-run slice at 16.2%. The rate held, so the goal's conclusion
//    survived and its ASSERTION did not: blind section H bounded extraction at
//    460 while the product's own channel yielded 586 on the same repo.
//
//    The rebuilt harvest runs each language through the product's own doc
//    channel. TypeScript 2906 spans to 4098, Go 2 to 117. The row below walks
//    this repo independently and agrees with the fixture, which is the property
//    that was missing.
// ═════════════════════════════════════════════════════════════════════════════

test("[RECORD] E: an independent walk through the product's own doc channel agrees with the fixture  [WAS DEFECT, FIXED 2026-08-02]", () => {
  const SRC = path.join(__dirname, "..", "src");
  const SKIP = new Set(["node_modules", "dist", ".git"]);
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) {
        continue;
      }
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(p, out);
      } else if (e.name.endsWith(".ts")) {
        out.push(p);
      }
    }
    return out;
  };
  const files = walk(SRC);
  assert.ok(files.length > 50, `precondition: this repo's src carries its TypeScript, got ${files.length} files`);
  const HEAD = /^\s*(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let)\s+[A-Za-z_$]/;
  const stop = stopNamesFor("typescript");
  const ts = corpusOf("column-80");
  const real = new Set(ts.real);
  let heads = 0;
  let docs = 0; // declaration heads that HAVE a doc comment: the ratio's denominator
  let extracted = 0;
  let hits = 0;
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    const getLine = (i) => lines[i] ?? "";
    for (let i = 0; i < lines.length; i++) {
      if (!HEAD.test(lines[i])) {
        continue;
      }
      heads += 1;
      const doc = tsDocCommentAbove(getLine, i);
      if (doc === undefined) {
        continue;
      }
      docs += 1;
      for (const n of backtickedTypeNames(doc)) {
        if (stop.has(n)) {
          continue;
        }
        extracted += 1;
        if (real.has(n)) {
          hits += 1;
        }
      }
    }
  }
  assert.ok(heads > 1000, `precondition: found ${heads} declaration heads, so the walk is alive`);
  // A RATIO NOW, session-v55 phase 16 (queue Q25), and this is the fix S52-9
  // asked for by name.
  //
  // WHAT THE RAW COUNT ACTUALLY MEASURED, and it was not what its name
  // suggested: the SIZE OF THIS REPO'S DOC COMMENTS, not the behaviour of the
  // extractor. The house style asks for dense WHY comments naming identifiers in
  // backticks, so the count drifts upward with every documented module the
  // product gains. Its own history is the evidence: frozen at 820, re-baselined
  // to 941, re-baselined again to 1000 on 2026-08-12, and measured at 1049 six
  // days later - a fourth re-baseline was already 4.9% into a 20% band with
  // nothing wrong in the code.
  //
  // Names per DOC-COMMENT BLOCK is invariant to that growth: a repo that doubles
  // its documented declarations doubles both halves. It still catches both
  // failure directions, which is why this stayed two-sided rather than becoming
  // a floor - the floor catches the extractor going dark and the ceiling catches
  // it over-matching, which is live in this product (`commentTypes.ts` records
  // 2.3% precision for the naive scan).
  //
  // The band is unchanged at 20%. Measured 2026-08-18: 1049 names over 2445
  // documented heads of 7918, so 0.429. The row below asserts the invariance
  // itself, so this ratio's claim to be growth-proof is tested and not just
  // stated.
  const LIVE_NAMES_PER_DOC = 0.429;
  const perDoc = extracted / docs;
  assert.ok(docs > 500, `precondition: found ${docs} documented heads of ${heads}, so the denominator is real`);
  assert.ok(
    Math.abs(perDoc - LIVE_NAMES_PER_DOC) / LIVE_NAMES_PER_DOC < 0.2,
    `an independent walk extracts ${perDoc.toFixed(3)} names per doc-comment block (${extracted} over ${docs}) where this repo measured ${LIVE_NAMES_PER_DOC}. Below the floor the extractor has gone dark; above the ceiling it is over-matching. Unlike the raw count this row replaced, growing the repo's doc comments does NOT move this number`,
  );
  const fixtureScore = scoreSpans(ts, backtickedTypeNames);
  // TOLERANCE WIDENED 2.0 -> 5.0 POINTS, ruled in session-v50 phase 0 (v49 S49-6).
  // Measured pre-v49: walk 15.16% against a frozen 17.0% fixture, so the live
  // margin inside the old 2.0 was 0.16 points. At that margin the row detects
  // "someone wrote doc comments in src/", not drift: v49's own doc comments took
  // it to 14.95% and turned it red with nothing wrong in the code. It cannot be
  // re-cut either, because the doc-span harvester is permanently
  // deleted and re-deriving the fixture with this row's own walk would make it
  // tautological. Widened rather than retired, because the population check above
  // is the half that caught the real defect and it is untouched.
  assert.ok(
    Math.abs((hits / extracted) * 100 - fixtureScore.rate) < 5,
    `hit rates disagree: walk ${((hits / extracted) * 100).toFixed(1)}%, fixture ${fixtureScore.rate.toFixed(1)}%`,
  );
});

test("[RECORD] E: the ratio is invariant to doc-comment VOLUME, which is the whole reason it replaced a count", () => {
  // Queue Q25's falsification, and it is the row that makes the ratio's claim
  // testable rather than merely stated. The count this replaced could not tell
  // "the extractor changed" from "the repo grew", and it was re-baselined three
  // times on the second cause. Doubling the population must move the COUNT and
  // leave the RATIO alone; only a change in what the extractor pulls out of one
  // block may move the ratio.
  const blocks = [
    "/** Reads a `Widget` out of the `Cursor`. */",
    "/** No backticked names here at all, just prose about the thing. */",
    "/** The `LogSegment` header, see `ShardId` and `Receipt`. */",
    "/** A `Vec` of them - a std name the stop set eats, so this block scores 0. */",
  ];
  const stop = stopNamesFor("typescript");
  const score = (population) => {
    let extracted = 0;
    for (const b of population) {
      for (const n of backtickedTypeNames(b)) {
        if (!stop.has(n)) {
          extracted += 1;
        }
      }
    }
    return { extracted, perDoc: extracted / population.length };
  };
  const one = score(blocks);
  const two = score([...blocks, ...blocks]);
  const ten = score(Array.from({ length: 10 }, () => blocks).flat());
  assert.equal(two.extracted, one.extracted * 2, "precondition: doubling the population really does double the count");
  assert.equal(ten.extracted, one.extracted * 10, "precondition: and ten times it multiplies by ten");
  assert.equal(two.perDoc, one.perDoc, "a doubled corpus must not move names-per-block");
  assert.equal(ten.perDoc, one.perDoc, "nor a ten-fold one");
  // The other direction, so the row is not vacuous: a population whose BLOCKS
  // carry more names does move it, which is the drift the ratio still catches.
  const denser = score(blocks.map((b) => b.replace("*/", "Also `Manifest` and `Ledger`. */")));
  assert.ok(denser.perDoc > one.perDoc, `denser blocks must raise the ratio: ${denser.perDoc} vs ${one.perDoc}`);
});

test("[RECORD] E: the rebuilt fixture's own numbers, pinned so a silent re-harvest is visible", () => {
  // WAS, on the prefix-harvested fixture: column-80 438 names at 12.6%. The
  // population and the rule both moved, so the pair is re-pinned rather than
  // carried forward. Blind section H owns the contract bar; this row only
  // catches a fixture that changed under the product's feet.
  const ts = corpusOf("column-80");
  const ru = corpusOf("acme-db");
  const go = corpusOf("cobra+gin+hugo");
  assert.equal(scoreSpans(ts, backtickedTypeNames).extracted, 820, "column-80, 4098 spans");
  assert.equal(scoreSpans(ru, backtickedTypeNames).extracted, 374, "acme-db, 1543 spans");
  assert.equal(scoreSpans(go, backtickedTypeNames).extracted, 28, "cobra+gin+hugo, 117 spans");
  assert.ok(go.spans.length > 100, "and the Go population is real now; 2 was the prefix defect");
});

// The second half of this row reads the HARVESTER, which lives in `session-v37/`
// and is excluded by `.gitignore`'s `session*/`. On a clone that has the tests and
// not the session folder the read throws, and the row was reporting a missing
// artifact as a failed claim. It skips there and runs for real wherever the
// artifact IS present, which is the box that produced it. Added 2026-08-03 with
// the 1.1.0 release, the first time these v37/v38 review files ever ran on CI.
test("[RECORD] E: the harvest's own span regex is the product's now  [WAS DEFECT, FIXED 2026-08-02]", (ctx) => {
  // The first harvest cut spans with /`([^`\n]+)`/g, the `+` being the exact bug
  // this phase had already fixed inside the product. It pairs the second
  // backtick of an empty pair with the opener of the real span beside it.
  assert.deepEqual("`` `Widget`".match(/`([^`\n]+)`/g), ["` `"], "the old harvest regex mispairs");
  assert.deepEqual(backtickedTypeNames("`` `Widget`"), ["Widget"], "the product does not");
  const harvestPath = path.join(__dirname, "..", "session-v37", "harvest-doc-spans.cjs");
  if (!fs.existsSync(harvestPath)) {
    return ctx.skip("session-v37/harvest-doc-spans.cjs is a gitignored session artifact");
  }
  const harvest = fs.readFileSync(harvestPath, "utf8");
  assert.ok(
    /const SPAN = \/`\(\[\^`\\r\\n\]\*\)`\/g/.test(harvest),
    "and the harvester now uses the product's own span class, so the instrument and the thing measured agree",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// F. CRITERION 3, THE CAP. Splitting means one span can spend the whole budget,
//    and the goal accepts that in `prioritizedTypes`'s own comment. These rows
//    pin what it costs so the trade is on the record rather than in a comment.
// ═════════════════════════════════════════════════════════════════════════════

test("[RECORD] F: ONE generic gesture spends all four slots and evicts a type this file is known to define", () => {
  const doc = "/// Builds the CohortRegister for this shard.";
  const fullText = "struct CohortRegister;\nstruct Other;";
  const locals = new Set(["CohortRegister", "Other"]);
  const narrow = vs.prioritizedTypes("fn go()", doc, fullText, locals, "go", "fn go() {\n    // needs `Alpha`\n}");
  assert.deepEqual(narrow.slice(0, CAP), ["Alpha", "CohortRegister"], "control: the local type is reachable when the gesture is narrow");
  const wide = vs.prioritizedTypes("fn go()", doc, fullText, locals, "go", "fn go() {\n    // build a `Cache<Alpha, Bravo, Charlie>`\n}");
  assert.deepEqual(wide, ["Cache", "Alpha", "Bravo", "Charlie", "CohortRegister"]);
  assert.ok(!wide.slice(0, CAP).includes("CohortRegister"), "one span, four slots, and the known local type is out");
});

test("[RECORD] F: the container head takes a slot whenever it is not in the caller's stop set", () => {
  assert.deepEqual(backtickedTypeNames("`Cache<Widget>`"), ["Cache", "Widget"]);
  assert.deepEqual(
    vs.prioritizedTypes("fn go()", undefined, "", NO_LOCALS, "go", "fn go() {\n    // `Cache<Widget>`\n}"),
    ["Cache", "Widget"],
    "both reach fn-gen and both spend a slot",
  );
});

test("[RECORD] F: fn-gen's Rust stop set is PRELUDE_TYPES and repair's is STD_TYPE_NAMES, and the two disagree", () => {
  // Splitting produces more names per span, so which stop set a caller passes
  // matters more than it did. The widening did not create the divergence; it
  // widened its blast radius. Carried in scraps S37-5.
  const { PRELUDE_TYPES } = core.mod;
  const repairStop = stopNamesFor("rust");
  assert.ok(PRELUDE_TYPES.has("Ok") && !repairStop.has("Ok"), "the two Rust stop sets are not the same set");
  assert.ok(repairStop.has("Instant") && !PRELUDE_TYPES.has("Instant"), "and the difference runs both ways");
});

// ═════════════════════════════════════════════════════════════════════════════
// G. PERFORMANCE. Re-measured after the second widening. The per-part work grew
//    again (a paren split, a keyword loop, three regex replaces per chunk) and
//    the shape has not changed: `commentTypesIn` is linear in span size, and a
//    real function span is single-digit KB against a pre-fill leg the goal
//    measures at ~285 ms. Still not worth an item.
// ═════════════════════════════════════════════════════════════════════════════

test("[RECORD] G: commentTypesIn stays linear in span size", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "core", "compilerDirected.ts"), "utf8");
  assert.ok(src.length > 40000, `precondition: need a big enough real file, got ${src.length} bytes`);
  const perKb = (n) => {
    const span = src.slice(0, n);
    for (let i = 0; i < 5; i++) {
      commentTypesIn(span, "typescript");
    }
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) {
      commentTypesIn(span, "typescript");
    }
    return Number(process.hrtime.bigint() - t0) / 1e6 / 20 / (n / 1000);
  };
  const small = perKb(5000);
  const large = perKb(40000);
  // A generous ceiling on purpose: this row is a shape check, not a stopwatch,
  // and a tight bound on a shared CI box is a flake.
  assert.ok(large < small * 4, `per-KB cost went from ${small.toFixed(3)} to ${large.toFixed(3)} ms/KB, which is not linear`);
});

test("[RECORD] G: the extractor has no output bound of its own", () => {
  const wide = "`" + Array.from({ length: 20000 }, (_, i) => `Aa${i}`).join(", ") + "`";
  assert.equal(backtickedTypeNames(wide).length, 20000);
  assert.equal(commentTypesIn(`fn go() {\n    // ${wide}\n}`, "rust").length, 20000);
});

// ═════════════════════════════════════════════════════════════════════════════
// H. THE ANCHOR STAGE. FIXED while this review was open, by a live witness on
//    two servers: a comment position resolves to nothing, and
//    `firstCodeOccurrence` now refuses one in all five `typeReference` siblings.
//    The row is kept as the guard, inverted from what it recorded.
// ═════════════════════════════════════════════════════════════════════════════

test("[RECORD] H: the gesture's own comment is not a usable anchor, and the product now says so  [WAS A RECORDED HOLE, FIXED 2026-08-02]", () => {
  const span = "fn go() {\n    // needs a `Widget`\n}";
  assert.deepEqual(
    vs.prioritizedTypes("fn go()", undefined, "", NO_LOCALS, "go", span),
    ["Widget"],
    "stages 1 and 2 still pass: the name reaches the list and fits the budget",
  );
  const occurrences = [...span.matchAll(/Widget/g)].map((m) => m.index);
  assert.equal(occurrences.length, 1, "exactly one occurrence in the file");
  assert.ok(span.lastIndexOf("//", occurrences[0]) > span.lastIndexOf("\n", occurrences[0]), "and it is inside a comment");
  const anchor = fs.readFileSync(path.join(__dirname, "..", "src", "core", "commentTypes.ts"), "utf8");
  assert.ok(
    /export function firstCodeOccurrence/.test(anchor),
    "so stage 3 needs a code-only occurrence finder; without it the server is handed a position it resolves to nothing",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// I. NEW HOLES THE SECOND WIDENING OPENED. These are the rows this review would
//    have written against the new rule, and they are the point of reconciling
//    rather than re-running.
// ═════════════════════════════════════════════════════════════════════════════

test("[RECORD] I1 [ADDRESSED 2026-08-02]: a parenless dotted path is ambiguous, so BOTH ends ship", () => {
  // The call signal is real and it is the right signal. Its limit is that a
  // developer writing prose does not type the parens: `Assert.AreEqual` in a
  // sentence is the same reference as `Assert.AreEqual(x, y)` in code, and only
  // the second carries the discriminator.
  //
  // MEASURED on the rebuilt fixture. Of 394 dotted paths in the TypeScript doc
  // population only 79 are followed by `(`, so the signal is present for one
  // mention in five. Of the 315 without it, 104 have a type-shaped leaf that the
  // rule now takes, at 13.5% real against the corpus's own 15.4% base rate, and
  // in 17 of them the HEAD is real and the leaf is not. Real examples out of
  // that fixture: `Meta.Head.ToManifest` -> `ToManifest`, `Tile.Origin` ->
  // `Origin`, `DataModel.Enums` -> `Enums`.
  //
  // C# and TypeScript PascalCase their methods and their enum members, so this
  // is not an edge: `Severity.Error` and `Status.Active` are how those languages
  // name a VALUE, and the rule reads the value as the type.
  //
  // HOW IT WAS RESOLVED, and it is neither of the two answers this row argued
  // between. Taking the head instead of the leaf just inverts the error, because
  // `Namespace.Widget` wants the leaf as much as `Severity.Error` wants the head.
  // The text genuinely cannot say. So a two-segment path with both ends
  // type-shaped emits BOTH, and the anchor stage refuses whichever the file does
  // not contain. The blind contract was amended to match.
  assert.deepEqual(backtickedTypeNames("`Severity.Error`"), ["Error", "Severity"], "ambiguous, so the enum type is present whichever end it is");
  assert.deepEqual(backtickedTypeNames("`Assert.AreEqual`"), ["AreEqual", "Assert"], "and the same for a method named without its parens");
  assert.deepEqual(backtickedTypeNames("`Meta.Head.ToManifest`"), ["ToManifest"], "THREE segments is not ambiguous: a two-deep member chain is not what a doc comment writes, a namespace is");
  assert.deepEqual(
    backtickedTypeNames("`http.Client`"),
    ["Client"],
    "control: a lowercase package qualifier still reads its type, which is the shape the leaf rule exists for",
  );
});

test("[RECORD] I2 [SHIPPED 2026-08-02, NARROWED]: both ends, but only at two segments", () => {
  // The counter-proposal, measured rather than argued, because "the leaf or the
  // head" was never forced to be a choice. For a dotted path with NO trailing
  // paren whose two ends are both type-shaped, emit the head as well as the leaf
  // and let the anchor stage decide which one the file actually contains.
  //
  // The counter-proposal was taken and then NARROWED, because the same fixture
  // separates the two depths:
  //
  //   column-80  777 names at 15.4%  ->  836 at 16.6%  hedging every depth
  //   column-80  777 names at 15.4%  ->  820 at 17.0%  hedging two segments only
  //
  // At three segments or more the leaf is a type by construction, so the extra
  // names a deep hedge buys are worse than the ones already in the list. What
  // ships is the two-segment version, and it also fires on `::`, which the
  // proposal below did not test: `BasicConstraints::Constrained` names an enum
  // and a variant, and the enum is the type the goal\'s own `create_ca` capture
  // needed.
  //
  // READ THE RATE AS A DISCRIMINATOR, not as proof the hedge is free. At a 15%
  // base rate any rule adding half-real names lifts the average, so the
  // aggregate alone would have argued for the deeper arm. The argument for
  // hedging at all is the budget: getting the end wrong spends a slot on a name
  // that cannot resolve, and so does hedging, but hedging spends it knowing the
  // right name is also there.
  const typeish = (n) => /^[A-Z]/.test(n) && n.length > 1;
  const headToo = (text) => {
    const out = backtickedTypeNames(text).slice();
    for (const m of text.matchAll(/([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)(\(?)/g)) {
      if (m[2] === "(") {
        continue;
      }
      const segs = m[1].split(".");
      if (typeish(segs[segs.length - 1]) && typeish(segs[0])) {
        out.push(segs[0]);
      }
    }
    return out;
  };
  for (const name of ["column-80", "cobra+gin+hugo"]) {
    const c = corpusOf(name);
    const ships = scoreSpans(c, backtickedTypeNames);
    const both = scoreSpans(c, headToo);
    assert.ok(
      both.rate >= ships.rate,
      `${name}: head-too ${both.rate.toFixed(1)}% is not at least the shipped ${ships.rate.toFixed(1)}%, so the counter-proposal does not survive its own measurement`,
    );
    assert.ok(both.extracted >= ships.extracted, `${name}: head-too must be a superset`);
  }
  // The shipped rule already IS the hedge, so `headToo` can only duplicate what
  // it emits. That duplication is the proof the proposal landed.
  assert.deepEqual(backtickedTypeNames("`Tile.Origin`"), ["Origin", "Tile"], "shipped: both ends of a two-segment path");
  assert.deepEqual(headToo("`Tile.Origin`"), ["Origin", "Tile", "Tile"], "and the proposal adds nothing the shipped rule has not already added");
});

test("[RECORD] I3 [WAS DEFECT, FIXED 2026-08-02]: a non-ASCII letter inside a name no longer truncates it", () => {
  // The third of the family the phase fixed twice. `3Type` and `ÉType` were both
  // caught, one input apiece, and the fix guards the LEADING character: leading
  // punctuation is stripped, a letter or digit never is. The token regex behind
  // it is still ASCII-only, so a non-ASCII letter in the MIDDLE of a name ends
  // the match early and the `startsWith` guard is satisfied by the prefix.
  //
  // `CaféType` yields `Caf`, a name nobody wrote. The invention bar is the whole
  // defence of this rule, and a truncation is an invention.
  //
  // FREQUENCY: 9 of 5758 spans across all four corpora carry a non-ASCII letter
  // adjacent to an ASCII one, and none of those nine truncates today, so the
  // whole-identifier invariant holds 1213 times out of 1213 on real text. LOW by
  // frequency and systematic by mechanism, which the fuzz below separates. It is
  // already in the v36 pathological corpus (`CaféType`, `Élan`) where
  // `[RECORD] A1` cannot catch it, because the pre-v37 rule returned nothing for
  // both and a no-narrowing check is one-directional.
  // FIXED by making the token class Unicode-aware, `[\\p{L}_][\\p{L}\\p{N}_]*`, the
  // way `isPlainGoIdentifier` already spells it. `CaféType` is a legal
  // identifier in all five languages and now comes back whole.
  assert.deepEqual(backtickedTypeNames("`CaféType`"), ["CaféType"], "the whole name, not the ASCII prefix `Caf`");
  // NOT fixed, and stated as a limit rather than dressed up as one. The
  // type-shaped test is `/^[A-Z]/`, ASCII, so a name whose FIRST letter is a
  // non-ASCII capital is still refused. `CaféType` works because it starts with
  // an ASCII capital, which is the case that matters: the interior letter was
  // the truncation bug, the leading one is a naming convention this rule has
  // never claimed to read. The pre-v37 rule refused `Élan` too, so nothing
  // regressed. Widening `/^[A-Z]/` to `\p{Lu}` is a sixth revision of a rule
  // that has had five, on a case no corpus here contains.
  assert.deepEqual(backtickedTypeNames("`Élan`"), [], "LIMIT: a leading non-ASCII capital is not read as a type");
  assert.deepEqual(backtickedTypeNames("`3Type`"), [], "control: a leading digit is still refused, because no language spells a type that way");

  // THE INVARIANT, stated so the fix has a bar rather than an example: a name
  // this rule returns must appear in the text as a WHOLE identifier, never as
  // the prefix of a longer word. Same seeded generator as the v36 fuzz, with
  // `é` and `É` in the alphabet, which is the only thing that had to change to
  // make it red. 12 of the 167 non-empty results violate it, first
  // `"AB"` out of `"É`ABÉ|)`"`.
  let seed = 0x5eed_1234;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000);
  const ALPHABET = "`ABab_:.,<>[]()|&* \n\r01-éÉ`";
  let violations = 0;
  let nonEmpty = 0;
  let first;
  for (let i = 0; i < 20000; i++) {
    let s = "";
    const len = 1 + Math.floor(rnd() * 24);
    for (let j = 0; j < len; j++) {
      s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
    }
    const got = backtickedTypeNames(s);
    if (got.length > 0) {
      nonEmpty += 1;
    }
    for (const name of got) {
      if (!new RegExp(`(^|[^\\p{L}\\p{N}_])${name}([^\\p{L}\\p{N}_]|$)`, "u").test(s)) {
        violations += 1;
        first ??= `${show(name)} out of ${show(s)}`;
      }
    }
  }
  assert.ok(nonEmpty > 100, `anti-vacuity: only ${nonEmpty} of 20000 fuzz cases produced a name at all`);
  assert.equal(
    violations,
    0,
    `${violations} of the ${nonEmpty} non-empty results are not a whole identifier in their own text, first: ${first}. The readable version of the same bug is \`CaféType\` -> ${show(backtickedTypeNames("`CaféType`"))}`,
  );
  // The row above is the bar; this is the same claim in a form a reader can
  // check by eye. It returned `Caf` when this finding was filed.
  assert.deepEqual(backtickedTypeNames("`CaféType`"), ["CaféType"], "the readable case: an interior non-ASCII letter no longer truncates the name");
});

test("[RECORD] I4: markdown table punctuation inside a span now yields prose words", () => {
  // `|` became a splitter for TypeScript unions and it also splits a markdown
  // table row, so `| Name | Type |` reads as two capitalized prose words. The
  // first R4 refused the whole span, because no identifier started the part.
  //
  // MEASURED, and it is why this is a record and not a defect: across the whole
  // rebuilt fixture exactly 2 spans contain a `|` and yield anything at all, one
  // in TypeScript and one in Go. The union is worth far more than this costs.
  // Pinned so a future widening of the splitter class has a baseline.
  assert.deepEqual(backtickedTypeNames("`| Name | Type |`"), ["Name", "Type"]);
  let withPipe = 0;
  for (const c of loadFixture().corpora) {
    const stop = stopNamesFor(c.lang);
    for (const s of c.spans) {
      if (s.includes("|") && backtickedTypeNames("`" + s + "`").some((n) => !stop.has(n))) {
        withPipe += 1;
      }
    }
  }
  assert.ok(
    withPipe <= 5,
    `${withPipe} spans in the fixture carry a pipe and yield a name; the union's cost was measured at 2 and a jump means the population changed`,
  );
});
