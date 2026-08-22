// BLIND ORACLE - session-v21 phase 3a, items 1 and 2 of the member-site
// surface. Written from that document ALONE, before the implementation
// exists. This file never reads
// src/core/extraction.ts, src/core/fimInject.ts, src/vscode/raExtractor.ts,
// src/vscode/csExtractor.ts, src/core/csExtraction.ts or
// src/vscode/completionProvider.ts - esbuild resolves them at bundle time only.
// Every assertion below is a promise of the surface doc or a property it names.
//
// What this file pins:
//
//   A. A FIELD IS A MEMBER, AND IT HAS A TYPE [surface §1]. rust-analyzer serves
//      the field's type in `detail` (12/12 same-file, 2/2 cross-crate, as the
//      v21 spike measured); the product throws it away at two predicates.
//      A field whose server gave a type must render a line a consumer can read
//      the NAME and the TYPE off, and that line must sit in the block beside the
//      methods. The name must be exactly what the buffer would have to spell.
//
//   B. THE C# `object` NOISE FILTER [surface §2]. `object`'s own universal
//      members and extension methods DECLARED ON `object` are filtered out of
//      what the block SHOWS - before the resolve budget is spent, keyed on the
//      declaring type rather than on a name list, and without taking a single
//      name away from the enforcement gate.
//
// The dark reason line (surface §3) is a different harness and lives in
// test/blind-v21-p3a-darkreason.test.cjs.
//
// ---------------------------------------------------------------------------
// TWO THINGS THE SURFACE LEAVES TO THE IMPLEMENTER, AND HOW THEY ARE ASSERTED.
//
// 1. The rendered spelling of a field line. The doc says "the exact spelling is
//    the implementer's, but a consumer must be able to read the field's name and
//    its type off it, and the NAME must be exactly what the buffer would have to
//    spell". So nothing here pins a literal like `alpha_code: u64`. What is
//    pinned is the property: the block carries a line that contains the name as
//    a standalone token AND the type text, the name is never call-shaped, and
//    the type is never `fn`-spliced onto the name.
//
// 2. WHERE the `object` filter runs. The observable the surface itself names is
//    the SIGNATURE ("a member that misses [the resolve cap] loses its signature
//    and is dropped at render"), so §B asserts on the rendered block and on
//    signature presence, never on an internal predicate. The member NAMES must
//    survive either way - test/blind-v10-csextractor.test.cjs already freezes
//    "the LS set is returned verbatim (object members included at a member
//    site)", so a filter that DELETES members from completeMembers would break
//    the frozen set. Filtering here means "carries no rendered line".
//
// FIXTURE HONESTY. The C# declaring type is written into `detail`,
// `labelDetails.description` AND the resolved `documentation` first line of each
// completion item, in Roslyn's captured shape (`bool object.Equals(object? obj)`
// - see test/blind-v10-csextractor.test.cjs for the provenance of that form).
// The real server puts it in at least one of those; supplying all three means a
// correct filter can key on whichever channel it reads and a red here is a
// missing filter, not a missing fixture field.
//
// RESOLVE MODEL. The fake runner models `vscode.executeCompletionItemProvider`
// honestly: it attaches the resolved `documentation` only to the first N items
// of the list, where N is the numeric resolve count the extractor passed in its
// options (all of them when no number is passed). That is what the vscode
// command does. If the implementation resolves through some other command, this
// fixture must be extended - report that as a finding rather than editing the
// assertion.
//
// Expected RED on the contract. A BUILD failure or a harness throw is a bug in
// this file.
//
// Run: SKIP_LIVE=1 node --test test/blind-v21-p3a.test.cjs
// (Hermetic: pure functions plus an injected fake command runner. No language
// server, no model, no vscode.)

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// Namespace re-exports, never named ones: a named re-export of a symbol that
// does not exist yet is an esbuild BUILD error, which would collapse every test
// in the file into one harness failure and hide the rest of the contract.
let mod = {};
let cleanup = () => {};
let bundleError;
try {
  const built = bundleCore(
    "blind-v21-p3a",
    `export * as extraction from "../src/core/extraction";\n` +
      `export * as fim from "../src/core/fimInject";\n` +
      `export * as csx from "../src/vscode/csExtractor";\n`
  );
  mod = built.mod;
  cleanup = built.cleanup;
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

test("harness: extraction, fimInject and the C# transport all bundle [harness guard - red here is a build problem, not a contract failure]", () => {
  if (bundleError) assert.fail(`the modules do not build: ${String(bundleError.message).slice(0, 2000)}`);
});

// Resolve every symbol at call time so an absent export is a per-test red that
// names the missing surface, never a module-load crash.
const need = (ns, name) => {
  if (bundleError) assert.fail(`the modules do not build: ${String(bundleError.message).slice(0, 800)}`);
  const bag = mod[ns];
  if (!bag) assert.fail(`the bundle exports no ${ns} namespace`);
  const f = bag[name];
  if (typeof f !== "function") {
    assert.fail(`${ns} exports no ${name}() - the phase 3a surface is absent (got ${typeof f})`);
  }
  return f;
};

// MEMBER_RESOLVE_CAP stays 32 (surface §4). Read it off the bundle when it is
// exported so this file tracks the product rather than a copy of it.
const resolveCap = () => {
  for (const ns of Object.keys(mod)) {
    const bag = mod[ns] || {};
    if (typeof bag.MEMBER_RESOLVE_CAP === "number") return bag.MEMBER_RESOLVE_CAP;
  }
  return 32;
};

// Table runner: one body, many cases, every failure reported together and each
// one named. A table that fails without case identity proves nothing.
const table = async (rows, run) => {
  const bad = [];
  for (const row of rows) {
    try {
      await run(row);
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
  }
  if (bad.length) assert.fail(`${bad.length}/${rows.length} cases failed:\n  - ${bad.join("\n  - ")}`);
};

const lines = (block) => String(block == null ? "" : block).split("\n");
const byName = (members, name) => members.find((m) => m.name === name);
const names = (members) => members.map((m) => m.name);

// A line "names" a member when the identifier occurs as a standalone token.
const tokenRe = (name) => new RegExp(`(^|[^A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_]|$)`);
const linesNaming = (block, name) => lines(block).filter((l) => tokenRe(name).test(l));

// ===========================================================================
// A. A RUST FIELD IS A MEMBER, AND IT HAS A TYPE [surface §1].
//
// The captured items are verbatim from the v21 spike: rust-analyzer's
// field items carry the bare type in `detail`, method items carry an `fn`-shaped
// detail. The difference is the SHAPE of detail, not its presence.
// ===========================================================================

// [label, detail, kind] exactly as the spike recorded them.
const RA_FIELDS = [
  { label: "alpha_code", detail: "u64" },
  { label: "beta_name", detail: "String" },
  { label: "eta_maybe", detail: "Option<u16>" },
  { label: "iota_lines", detail: "Vec<LineItem, Global>" },
  { label: "theta_region", detail: "Region" },
];
const RA_METHODS = [
  { label: "alpha_method", detail: "fn(&self, u64) -> bool", signature: "alpha_method(&self, u64) -> bool" },
  { label: "beta_method", detail: "fn(&mut self, &str) -> Option<u16>", signature: "beta_method(&mut self, &str) -> Option<u16>" },
  { label: "delta_method", detail: "fn(self) -> u32", signature: "delta_method(self) -> u32" },
];

test("A1. a FIELD whose server gave a type carries a signature - today it carries none, which is the whole of item 6 [surface §1 'a FIELD whose server gave a type renders a signature naming that type']", () => {
  const toCompletionMember = need("extraction", "toCompletionMember");
  const bad = [];
  for (const f of RA_FIELDS) {
    const m = toCompletionMember(f.label, f.detail, "field");
    if (typeof m.signature !== "string" || m.signature.length === 0) {
      bad.push(`${f.label} (detail=${JSON.stringify(f.detail)}) -> signature ${JSON.stringify(m.signature)}`);
    }
  }
  if (bad.length) {
    assert.fail(
      `${bad.length}/${RA_FIELDS.length} fields carry no signature, so none of them can reach the block:\n  - ${bad.join("\n  - ")}`
    );
  }
});

test("A2. the field's rendered signature carries its NAME and its TYPE, and the name is exactly what the buffer must spell - the spelling is the implementer's, these two properties are not [surface §1 'a consumer must be able to read the field's name and its type off it, and the NAME must be exactly what the buffer would have to spell']", () => {
  const toCompletionMember = need("extraction", "toCompletionMember");
  return table(
    RA_FIELDS.map((f) => ({ name: `${f.label} : ${f.detail}`, ...f })),
    ({ label, detail }) => {
      const m = toCompletionMember(label, detail, "field");
      assert.strictEqual(m.name, label, `the member NAME is the bare identifier the buffer spells, got ${JSON.stringify(m.name)}`);
      const sig = String(m.signature);
      assert.ok(
        tokenRe(label).test(sig),
        `the field's name must be readable off its signature, got ${JSON.stringify(sig)}`
      );
      assert.ok(
        sig.includes(detail),
        `the field's TYPE must be readable off its signature - the server sent ${JSON.stringify(detail)} and it must not be dropped; got ${JSON.stringify(sig)}`
      );
      assert.ok(
        !new RegExp(`${label}\\s*\\(`).test(sig),
        `a field is not callable: its signature must not spell ${JSON.stringify(label + "(")}; got ${JSON.stringify(sig)}`
      );
    }
  );
});

test("A3. a field whose server gave NO type still contributes its NAME, exactly as today - the gate travels on names and that does not change [surface §1 'still contributes its NAME to the enforcement gate, exactly as it does today']", () => {
  const toCompletionMember = need("extraction", "toCompletionMember");
  const ghostNamesMember = need("fim", "ghostNamesMember");
  const m = toCompletionMember("seed", undefined, "field");
  assert.strictEqual(m.name, "seed", "an untyped field is still a member with a name");
  assert.strictEqual(m.kind, "field", "and its kind is preserved verbatim");
  assert.strictEqual(
    ghostNamesMember("seed;", "", ["seed", "alpha_method"]),
    true,
    "a ghost naming that field is consistent with the resolved set: the gate never needed a signature"
  );
  assert.strictEqual(
    ghostNamesMember("sead;", "", ["seed", "alpha_method"]),
    false,
    "and a ghost naming a member the receiver does not have is still rejected"
  );
});

test("A4. METHODS ARE UNAFFECTED: same names, same signatures, same order [surface §1 'Methods are unaffected: same lines, same order, same rendering as today'] (regression net)", () => {
  const toCompletionMember = need("extraction", "toCompletionMember");
  return table(
    RA_METHODS.map((m) => ({ name: m.label, ...m })),
    ({ label, detail, signature }) => {
      const m = toCompletionMember(label, detail, "method");
      assert.strictEqual(m.signature, signature, `the method render is byte-identical to today`);
      assert.strictEqual(m.kind, "method");
      assert.strictEqual(m.name, label);
    }
  );
});

test("A5. THE fn-POINTER FIELD, which is why the dropping predicate was written: a field whose TYPE IS A FUNCTION TYPE is still a field and is never rendered as callable [surface §1 'A field whose type is itself a function type is a field, not a method, and must not be rendered as though it were callable']", () => {
  const toCompletionMember = need("extraction", "toCompletionMember");
  const renderFimCandidates = need("fim", "renderFimCandidates");
  const FN_FIELDS = [
    { label: "on_tick", detail: "fn(u64) -> bool" },
    { label: "handler", detail: "fn(&self, &str) -> Option<u16>" },
    { label: "boxed_cb", detail: "Box<dyn Fn(u32) -> u32>" },
  ];
  return table(
    FN_FIELDS.map((f) => ({ name: `${f.label} : ${f.detail}`, ...f })),
    ({ label, detail }) => {
      const m = toCompletionMember(label, detail, "field");
      assert.strictEqual(m.kind, "field", "a function-typed field is still a field");
      // The spike is explicit that the fn-pointer comment "is a reason to render
      // fields as `name: Type`, not to drop them", so this field is still a
      // field whose server gave a type: it renders, and it renders as data.
      assert.ok(
        typeof m.signature === "string" && m.signature.length > 0,
        `a function-typed field still has a type the server sent, so it still renders; got ${JSON.stringify(m.signature)}`
      );
      assert.ok(
        m.signature.includes(detail),
        `the function type itself must be readable off the line, got ${JSON.stringify(m.signature)}`
      );
      assert.ok(
        !new RegExp(`^\\s*${label}\\s*\\(`).test(m.signature),
        `${JSON.stringify(m.signature)} reads as a call to ${label}; the buffer would have to spell ${label} and then the CALL, which is not what a field access is`
      );
      const block = renderFimCandidates([toCompletionMember("alpha_method", "fn(&self, u64) -> bool", "method"), m], "");
      for (const l of lines(block)) {
        assert.ok(
          !new RegExp(`${label}\\s*\\(`).test(l),
          `no block line may present ${label} as callable, got ${JSON.stringify(l)}`
        );
      }
    }
  );
});

test("A6. a field and a method SHARING A NAME are not confused: each keeps its own kind and its own rendering [surface §1 'A field named identically to a method is not confused with it']", () => {
  const toCompletionMember = need("extraction", "toCompletionMember");
  const asField = toCompletionMember("render", "String", "field");
  const asMethod = toCompletionMember("render", "fn(&self) -> String", "method");
  assert.strictEqual(asField.kind, "field");
  assert.strictEqual(asMethod.kind, "method");
  assert.strictEqual(asMethod.signature, "render(&self) -> String", "the method still renders as a call, unchanged");
  assert.notStrictEqual(
    asField.signature,
    asMethod.signature,
    "the field and the method must not collapse to the same line: one is a data access, the other a call"
  );
  assert.ok(
    !new RegExp("render\\s*\\(").test(String(asField.signature)),
    `the FIELD render must not be call-shaped, got ${JSON.stringify(asField.signature)}`
  );
  assert.ok(
    String(asField.signature).includes("String"),
    `the field's type must survive, got ${JSON.stringify(asField.signature)}`
  );
});

test("A7. THE BLOCK: at a 16-member struct the fields appear ALONGSIDE the methods - today eleven lines come out and every one is a method [surface §1 'appears in the injected block alongside the methods' + spike-p3 'renders the four real methods ... and NO field']", () => {
  const toCompletionMember = need("extraction", "toCompletionMember");
  const renderFimCandidates = need("fim", "renderFimCandidates");
  const members = [
    ...RA_METHODS.map((m) => toCompletionMember(m.label, m.detail, "method")),
    ...RA_FIELDS.map((f) => toCompletionMember(f.label, f.detail, "field")),
  ];
  const block = renderFimCandidates(members, "");
  assert.ok(block !== undefined, "a receiver with methods AND typed fields must render a block");

  for (const m of RA_METHODS) {
    assert.ok(
      lines(block).some((l) => l.includes(m.signature)),
      `the method line ${JSON.stringify(m.signature)} must be unchanged in the block:\n${block}`
    );
  }
  for (const f of RA_FIELDS) {
    const hits = linesNaming(block, f.label);
    assert.strictEqual(
      hits.length,
      1,
      `the field ${f.label} must contribute exactly one line to the block, got ${hits.length}:\n${block}`
    );
    assert.ok(
      hits[0].includes(f.detail),
      `the field line must carry the type ${JSON.stringify(f.detail)}, got ${JSON.stringify(hits[0])}`
    );
    assert.ok(
      !new RegExp(`${f.label}\\s*\\(`).test(hits[0]),
      `the field line must not read as a call, got ${JSON.stringify(hits[0])}`
    );
  }
});

test("A8. a field-ONLY receiver now injects at all: a struct with twelve typed fields and no method is no longer dark [surface §1 'A Rust struct receiver injects its fields' + spike-p3 'holds only for a field-ONLY struct']", () => {
  const toCompletionMember = need("extraction", "toCompletionMember");
  const renderFimCandidates = need("fim", "renderFimCandidates");
  const members = RA_FIELDS.map((f) => toCompletionMember(f.label, f.detail, "field"));
  const block = renderFimCandidates(members, "");
  assert.ok(
    block !== undefined,
    "a receiver whose every member is a typed field must render a block; undefined here is the site getting plain FIM with no surface"
  );
  for (const f of RA_FIELDS) {
    assert.ok(String(block).includes(f.label), `${f.label} must be in the block:\n${block}`);
  }
});

// ===========================================================================
// B. THE C# `object` NOISE FILTER [surface §2].
//
// The transport under test is CsCommandExtractor, driven by an injected fake
// command runner (the idiom of test/blind-v10-csextractor.test.cjs). Item shapes
// and the "signature rides the resolved documentation first line" convention
// come from that file's captured provenance.
// ===========================================================================

const CMD_COMPLETE = "vscode.executeCompletionItemProvider";

const BUFFER = [
  "using System;",
  "using System.Linq;",
  "",
  "class Caller",
  "{",
  "    public int Use(Stripe stripe)",
  "    {",
  "        return stripe.",
  "    }",
  "}",
  "",
].join("\n");
const FILE_URI = "file:///fake/spike-app/Caller.cs";
const readBuffer = (uri) => (uri === FILE_URI ? BUFFER : undefined);
const MEMBER_CUR = (() => {
  const idx = BUFFER.indexOf("stripe.") + "stripe.".length;
  const before = BUFFER.slice(0, idx);
  return {
    uri: FILE_URI,
    line: (before.match(/\n/g) || []).length,
    character: idx - (before.lastIndexOf("\n") + 1),
  };
})();

// vscode CompletionItemKind (0-indexed): Method=1, Field=4, Property=9.
const K_METHOD = 1;
const K_PROPERTY = 9;

// One completion item. `sig` is the Roslyn-shaped signature line, which names
// the DECLARING TYPE before the member name. It is written into every channel a
// pre-resolve filter could read (detail, labelDetails.description) and into the
// resolved documentation (where the product already reads signatures from).
const item = (label, kind, sig, prose = "Some prose.") => ({
  label,
  kind,
  detail: sig,
  labelDetails: { detail: null, description: sig },
  __doc: `${sig}\r\n${prose}`,
});

// object's own universal members, as Roslyn spells them.
const OBJECT_OWN = [
  item("Equals", K_METHOD, "bool object.Equals(object? obj) (+ 1 overload)"),
  item("GetHashCode", K_METHOD, "int object.GetHashCode()"),
  item("GetType", K_METHOD, "Type object.GetType()"),
  item("ToString", K_METHOD, "string object.ToString()"),
];

// Extension methods DECLARED ON object - the Cosmos LINQ shape. These are the
// fourteen the capture found; the names are this SDK's and another project
// brings its own, which is why the filter may not key on them.
const COSMOS_EXT_NAMES = [
  "AsCosmosDocument", "CosmosPartitionKey", "Field", "FieldOrDefault", "IsCosmosEntity",
  "IsDefined", "StringEquals", "ToCosmosJson", "ToDynamic", "TypeCheck",
  "WhereMatches", "WithEtag", "WithTtl", "AsQueryableEntity",
];
const COSMOS_EXT = COSMOS_EXT_NAMES.map((n) =>
  item(n, K_METHOD, `(extension) TResult object.${n}<TResult>(string name)`)
);

// The receiver's REAL surface: the captured 49-property entity, alphabetical,
// which is the shape that lost 22 properties "cut alphabetically at L".
// `ToString` is the developer's own override and `FieldMappings` resembles the
// filtered `Field`: both exist to prove the filter keys on the declaring type
// rather than on a name list.
const REAL_PROPERTY_NAMES = [
  "AtlasId", "BandCeiling", "BandFloor", "CreatedUtc", "Depth", "DisplayName",
  "EnrolledCount", "Etag", "FieldMappings", "GeoHash", "Height", "IngestBatch",
  "IsSealed", "Kind", "LastTouched", "LodCeiling", "LodFloor", "MortonBase",
  "Name", "OwnerId", "PartitionHint", "Precision", "Provenance", "Quadrant",
  "RegionCode", "Retention", "RevisionNo", "RootTileId", "SchemaVersion",
  "SealedBy", "SealedUtc", "ShardKey", "SourceSystem", "SpanEnd", "SpanStart",
  "State", "Subtype", "Tenant", "TileTally", "Timezone", "Title", "TouchCount",
  "Unit", "UpdatedUtc", "Version", "Visibility", "Weight", "Width", "ZoomHint",
];
const REAL_PROPERTIES = REAL_PROPERTY_NAMES.map((n) =>
  item(n, K_PROPERTY, `int Stripe.${n} { get; set; }`)
);
const prop = (n) => {
  const i = REAL_PROPERTY_NAMES.indexOf(n);
  if (i < 0) throw new Error(`fixture bug: no property named ${n}`);
  return REAL_PROPERTIES[i];
};
const REAL_METHODS = [
  item("EnrollTile", K_METHOD, "bool Stripe.EnrollTile(Tile tile)"),
  item("ToString", K_METHOD, "string Stripe.ToString()"), // the developer's OWN override
  item("WhereLod", K_METHOD, "(extension) IQueryable<Tile> IQueryable<Tile>.WhereLod(int lod)"),
];

// Roslyn returns object's noise interleaved and sorted; putting it AHEAD of the
// real members is what the capture found (cut alphabetically at L) and is the
// arrangement that spends a positional resolve budget on nothing.
const NOISY_LIST = [...OBJECT_OWN, ...COSMOS_EXT, ...REAL_PROPERTIES, ...REAL_METHODS];
const NOISE_ONLY_NAMES = [...OBJECT_OWN, ...COSMOS_EXT].map((i) => i.label).filter((n) => n !== "ToString");
const REAL_NAMES = [...REAL_PROPERTY_NAMES, "EnrollTile", "ToString", "WhereLod"];

// The fake runner. It models the vscode command honestly: `documentation` is
// attached only to the first N items, N being the numeric resolve count the
// caller asked for (every item when no number was passed). Calls are recorded.
const runnerFor = (items) => {
  const calls = [];
  const numberIn = (opts) => {
    if (typeof opts === "number") return opts;
    if (opts && typeof opts === "object") {
      for (const v of Object.values(opts)) if (typeof v === "number") return v;
    }
    return undefined;
  };
  const run = async (command, cursor, opts) => {
    calls.push({ command, cursor, opts });
    if (command !== CMD_COMPLETE) return undefined;
    const n = numberIn(opts);
    const limit = typeof n === "number" && n >= 0 ? n : items.length;
    return {
      isIncomplete: false,
      items: items.map((it, i) => {
        const { __doc, ...rest } = it;
        return i < limit ? { ...rest, documentation: __doc } : { ...rest };
      }),
    };
  };
  return { run, calls };
};

const csExtractor = (items) => {
  if (bundleError) assert.fail(`the modules do not build: ${String(bundleError.message).slice(0, 800)}`);
  const Cls = (mod.csx || {}).CsCommandExtractor;
  if (typeof Cls !== "function") assert.fail("src/vscode/csExtractor exports no CsCommandExtractor class");
  const { run, calls } = runnerFor(items);
  return { ex: new Cls(run, readBuffer), calls };
};

test("B1. THE ENFORCEMENT GATE KEEPS EVERY NAME, filtered ones included - an incomplete block must never be able to suppress a correct completion [surface §2 'The enforcement gate still travels on ALL names, including the filtered ones'] (regression net: blind-v10 already freezes the verbatim LS set)", async () => {
  const { ex } = csExtractor(NOISY_LIST);
  const members = await ex.completeMembers(MEMBER_CUR);
  assert.ok(Array.isArray(members), "completeMembers resolves an array");
  const got = new Set(names(members));
  const missing = [...NOISE_ONLY_NAMES, ...REAL_NAMES].filter((n) => !got.has(n));
  assert.deepStrictEqual(
    missing,
    [],
    `every resolved name must reach the gate, filtered or not; missing ${JSON.stringify(missing)} out of ${NOISY_LIST.length} items`
  );
});

test("B2. THE FILTER RUNS BEFORE THE RESOLVE BUDGET IS SPENT: a receiver carrying more `object` noise than the resolve cap still delivers a signature for every real member - this is the 22-silently-lost-properties case and the part the surface says is easy to get wrong [surface §2 'The filter runs BEFORE the resolve budget is spent ... Filtering after the resolve buys back nothing']", async () => {
  const cap = resolveCap();
  assert.ok(
    OBJECT_OWN.length + COSMOS_EXT.length + REAL_PROPERTIES.length > cap,
    `precondition: the fixture must carry more members than the resolve cap (${cap}); it carries ${NOISY_LIST.length}`
  );
  const { ex } = csExtractor(NOISY_LIST);
  const members = await ex.completeMembers(MEMBER_CUR);
  const unsigned = REAL_PROPERTY_NAMES.filter((n) => {
    const m = byName(members, n);
    return !m || typeof m.signature !== "string" || m.signature.length === 0;
  });
  assert.deepStrictEqual(
    unsigned,
    [],
    `${unsigned.length}/${REAL_PROPERTY_NAMES.length} real properties carry no signature and are therefore dropped at render: ${JSON.stringify(unsigned)}. ` +
      `${OBJECT_OWN.length + COSMOS_EXT.length} noise members sit ahead of them and the resolve cap is ${cap}; spending the budget on noise is exactly the defect`
  );
});

test("B3. WHAT THE BLOCK SHOWS: `object`'s own members and extension methods declared on `object` carry no rendered line, while every real member does [surface §2 'Members that are extension methods declared on object, and object's own universal members, are filtered out of the C# member surface']", async () => {
  const renderFimCandidates = need("fim", "renderFimCandidates");
  // A small receiver, well under any block width cap, so a missing block cannot
  // be the cap's doing: 4 real members against 6 noise ones.
  const small = [
    OBJECT_OWN[0], OBJECT_OWN[1], OBJECT_OWN[2],
    COSMOS_EXT[2], COSMOS_EXT[5], COSMOS_EXT[9],
    prop("FieldMappings"), prop("TileTally"),
    REAL_METHODS[0], REAL_METHODS[2],
  ];
  const { ex } = csExtractor(small);
  const members = await ex.completeMembers(MEMBER_CUR);
  const block = renderFimCandidates(members, "");
  assert.ok(block !== undefined, `a receiver with four real members must render a block; members were ${JSON.stringify(names(members))}`);

  for (const noisy of ["Equals", "GetHashCode", "GetType", "Field", "IsDefined", "TypeCheck"]) {
    assert.deepStrictEqual(
      linesNaming(block, noisy),
      [],
      `${noisy} is declared on object and must not be SHOWN; the block reads:\n${block}`
    );
  }
  for (const real of ["FieldMappings", "TileTally", "EnrollTile", "WhereLod"]) {
    assert.strictEqual(
      linesNaming(block, real).length,
      1,
      `${real} is a real member of the receiver and must be shown exactly once; the block reads:\n${block}`
    );
  }
});

test("B4. THE FILTER KEYS ON THE DECLARING TYPE, NEVER ON A NAME LIST: `Stripe.ToString()` (the developer's own override) is SHOWN while `object.ToString()` is not, and `FieldMappings` survives beside the filtered `Field` [surface §2 'it must key on the DECLARING TYPE being object, never on a list of names']", async () => {
  const renderFimCandidates = need("fim", "renderFimCandidates");
  const small = [
    OBJECT_OWN[3], // string object.ToString()
    COSMOS_EXT[2], // (extension) ... object.Field<T>(...)
    REAL_METHODS[1], // string Stripe.ToString() - the override
    prop("FieldMappings"), // Stripe.FieldMappings
    prop("TileTally"), // Stripe.TileTally
  ];
  const { ex } = csExtractor(small);
  const members = await ex.completeMembers(MEMBER_CUR);
  const block = renderFimCandidates(members, "");
  assert.ok(block !== undefined, `the receiver has real members, so a block must render; got members ${JSON.stringify(names(members))}`);

  const toStringLines = linesNaming(block, "ToString");
  assert.strictEqual(
    toStringLines.length,
    1,
    `exactly one ToString line belongs here - the override declared on Stripe. A name-list filter shows zero, no filter shows two. Block:\n${block}`
  );
  assert.ok(
    !toStringLines[0].includes("object."),
    `the surviving ToString must be the one declared on Stripe, got ${JSON.stringify(toStringLines[0])}`
  );
  assert.strictEqual(
    linesNaming(block, "Field").length,
    0,
    `the object-declared Field extension must be filtered; block:\n${block}`
  );
  assert.strictEqual(
    linesNaming(block, "FieldMappings").length,
    1,
    `FieldMappings is a real property whose name merely resembles a filtered one and must survive; block:\n${block}`
  );
});

test("B5. a real member that happens to be an extension method on a SPECIFIC type is kept - only the blanket `object` ones go [surface §2 'A real member that happens to be an extension method on a specific type is kept']", async () => {
  const renderFimCandidates = need("fim", "renderFimCandidates");
  const small = [COSMOS_EXT[0], COSMOS_EXT[1], REAL_METHODS[2], prop("TileTally")];
  const { ex } = csExtractor(small);
  const members = await ex.completeMembers(MEMBER_CUR);
  const block = renderFimCandidates(members, "");
  assert.ok(block !== undefined, `WhereLod and TileTally are real members, so something must render; got ${JSON.stringify(names(members))}`);
  assert.strictEqual(
    linesNaming(block, "WhereLod").length,
    1,
    `an extension method declared on IQueryable<Tile> is a real member of this receiver and must be shown; block:\n${block}`
  );
  for (const n of ["AsCosmosDocument", "CosmosPartitionKey"]) {
    assert.deepStrictEqual(linesNaming(block, n), [], `the object-declared extension ${n} must not be shown; block:\n${block}`);
  }
});

test("B6. the noise floor is per-PROJECT: a receiver whose object-declared extensions have entirely different names is filtered just the same - nothing here may be keyed to the Cosmos SDK's spelling [surface §2 'those fourteen extensions are the Cosmos SDK's, and another project brings its own']", async () => {
  const renderFimCandidates = need("fim", "renderFimCandidates");
  const otherProject = ["Dehydrate", "Warp", "Zap", "Quantize"].map((n) =>
    item(n, K_METHOD, `(extension) TOut object.${n}<TOut>(int scale)`)
  );
  const small = [...otherProject, prop("TileTally"), REAL_METHODS[0]];
  const { ex } = csExtractor(small);
  const members = await ex.completeMembers(MEMBER_CUR);
  const block = renderFimCandidates(members, "");
  assert.ok(block !== undefined, `the receiver has two real members; got ${JSON.stringify(names(members))}`);
  for (const n of ["Dehydrate", "Warp", "Zap", "Quantize"]) {
    assert.deepStrictEqual(
      linesNaming(block, n),
      [],
      `${n} is declared on object in another project's SDK and must be filtered by its DECLARING TYPE; block:\n${block}`
    );
  }
  assert.strictEqual(linesNaming(block, "TileTally").length, 1, `the real property must survive; block:\n${block}`);
  const got = new Set(names(members));
  for (const n of ["Dehydrate", "Warp", "Zap", "Quantize"]) {
    assert.ok(got.has(n), `${n} must still reach the gate as a name, even though it is not shown`);
  }
});

test("B7. a receiver with NO noise is untouched: every member is shown, exactly as today [surface §2 'Filtering changes what the block SHOWS, never what a valid completion is allowed to be'] (regression net)", async () => {
  const renderFimCandidates = need("fim", "renderFimCandidates");
  const clean = [prop("AtlasId"), prop("TileTally"), REAL_METHODS[0]];
  const { ex } = csExtractor(clean);
  const members = await ex.completeMembers(MEMBER_CUR);
  const block = renderFimCandidates(members, "");
  assert.ok(block !== undefined, "a clean receiver still renders");
  for (const n of ["AtlasId", "TileTally", "EnrollTile"]) {
    assert.strictEqual(linesNaming(block, n).length, 1, `${n} must be shown; block:\n${block}`);
  }
});
