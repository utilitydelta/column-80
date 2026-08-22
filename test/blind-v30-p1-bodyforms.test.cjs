// BLIND ORACLE - session-v30 phase 1: the body scan sees the type a developer
// wrote down, in every form a developer writes it.
//
// Written from goal item 1b and the scout table it cites (finding 4), BEFORE
// the implementation existed. Nothing here has read src/core/repairTypes.ts,
// fimWholeBlock.ts, crossFileShape.ts, csExtraction.ts, goExtraction.ts or
// tsExtraction.ts. The only contract in hand is the exported signature of
// `spanTypesInPlay` and the four-leg priority order the goal states.
//
// THIS FILE IS NEVER EDITED TO MAKE AN IMPLEMENTATION PASS. A row here is a
// claim about what the product owes a repair round. Fix the product, or argue
// the row down in the session folder and delete it on the record.
//
// STATE AT WRITING. Section A is the six defect rows and every one of them is
// RED by design: the scout ran the shipped legs over each form and pinned the
// miss. Section B is the forms the same scout run reported as already seen, so
// they are pins against a fix that trades one form for another. Section C is
// the over-correction guard, because every fix in section A adds candidates and
// a candidate costs a resolver round trip and a slot in a bounded surface.
//
// `Cursor` is the receiver of the failing call throughout, the way it is in the
// scout's five reproductions. It is named in exactly one place in each fixture,
// so a passing row cannot be passing for a second reason.
//
// Run: SKIP_LIVE=1 node --test test/blind-v30-p1-bodyforms.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v30-p1-bodyforms",
  `export { spanTypesInPlay } from "../src/core/repairTypes";\n`,
);
const { spanTypesInPlay } = mod;
test.after(cleanup);

const show = (v) => JSON.stringify(v);

// ===========================================================================
// Fixtures. One span shape per language, the scout's chain without the domain:
// a Ledger hands out a wrapped Shard, the Shard's Meta owns the Cursor, and the
// Cursor owns the call being repaired. The declaration line is the dial. Every
// other line is held constant so a row measures one form and nothing else.
// ===========================================================================

const SPANS = {
  rust: {
    signature: "fn shard_manifest(ledger: &Ledger, last_enrolled: u64, last_flushed: u64) -> Manifest",
    span: (decl) => `fn shard_manifest(ledger: &Ledger, last_enrolled: u64, last_flushed: u64) -> Manifest {
    let shard = ledger.active_shard.value();
    ${decl}
    cursor.to_manifest(shard.meta.mirror.as_ref(), last_enrolled, last_flushed)
}`,
  },
  go: {
    signature: "func ShardManifest(ledger *Ledger, lastEnrolled uint64, lastFlushed uint64) *Manifest",
    span: (decl) => `func ShardManifest(ledger *Ledger, lastEnrolled uint64, lastFlushed uint64) *Manifest {
	shard := ledger.ActiveShard.Value()
	${decl}
	return cursor.ToManifest(shard.Meta.Mirror, lastEnrolled, lastFlushed)
}`,
  },
  csharp: {
    signature: "public Manifest ShardManifest(Ledger ledger, long lastEnrolled, long lastFlushed)",
    span: (decl) => `public Manifest ShardManifest(Ledger ledger, long lastEnrolled, long lastFlushed)
{
    var shard = ledger.ActiveShard.Value();
    ${decl}
    return cursor.ToManifest(shard.Meta.Mirror, lastEnrolled, lastFlushed);
}`,
  },
  typescript: {
    signature: "export function shardManifest(ledger: Ledger, lastEnrolled: number, lastFlushed: number): Manifest",
    span: (decl) => `export function shardManifest(ledger: Ledger, lastEnrolled: number, lastFlushed: number): Manifest {
  const shard = ledger.activeShard.value();
  ${decl}
  return cursor.toManifest(shard.meta.mirror, lastEnrolled, lastFlushed);
}`,
  },
  python: {
    signature: "def shard_manifest(ledger: Ledger, last_enrolled: int, last_flushed: int) -> Manifest:",
    span: (decl) => `def shard_manifest(ledger: Ledger, last_enrolled: int, last_flushed: int) -> Manifest:
    shard = ledger.active_shard.value()
    ${decl}
    return cursor.to_manifest(shard.meta.mirror, last_enrolled, last_flushed)`,
  },
};

// The whole span, signature included, the way the document holds it.
function typesFor(languageId, decl) {
  const fixture = SPANS[languageId];
  return spanTypesInPlay({
    languageId,
    signature: fixture.signature,
    code: fixture.span(decl),
  });
}

// Every fixture keeps the signature's own types, so a row that loses them is
// reporting a regression in leg 1 rather than an answer about leg 2.
function assertSignatureTypesSurvive(out) {
  for (const type of ["Ledger", "Manifest"]) {
    assert.ok(
      out.includes(type),
      `leg 1 owes the signature's own types whatever leg 2 does; ${type} missing from ${show(out)}`,
    );
  }
}

// ===========================================================================
// A. THE SIX DEFECT ROWS. Each one is a developer writing the receiver's type
// down in an explicit type position, and the span surface not seeing it. The
// repair round then runs with no signature for the call it must fix, which is
// the capture that opened this session.
// ===========================================================================

test("A1 [rust]: `let cursor: &Cursor` names Cursor, and a borrow is the common case", () => {
  const out = typesFor("rust", "let cursor: &Cursor = shard.meta.head();");
  assert.ok(
    out.includes("Cursor"),
    `the annotation position must tolerate a leading & the way every other position does. A borrowed local is how Rust is written; got ${show(out)}`,
  );
  assertSignatureTypesSurvive(out);
});

test("A2 [rust]: `let cursor: &mut Cursor` names Cursor", () => {
  const out = typesFor("rust", "let cursor: &mut Cursor = shard.meta.head_mut();");
  assert.ok(
    out.includes("Cursor"),
    `\`&mut\` between the colon and the type is still an annotation naming that type; got ${show(out)}`,
  );
  assertSignatureTypesSurvive(out);
});

test("A3 [rust]: `let cursor: atlas::Cursor` names Cursor, and the lowercase crate does not kill it", () => {
  const out = typesFor("rust", "let cursor: atlas::Cursor = shard.meta.head().clone();");
  assert.ok(
    out.includes("Cursor"),
    `a path-qualified annotation names one type spelled the long way. A crate name is lowercase by convention, so requiring uppercase after the colon rejects every cross-crate type; got ${show(out)}`,
  );
  assert.ok(!out.includes("atlas"), `the crate segment resolves to nothing and is not a candidate; got ${show(out)}`);
  assertSignatureTypesSurvive(out);
});

test("A4 [go]: `var cursor atlas.Cursor` names Cursor", () => {
  const out = typesFor("go", "var cursor atlas.Cursor = shard.Meta.Head");
  assert.ok(
    out.includes("Cursor"),
    `a package qualifier before the type is the norm in Go, not a corner. Requiring uppercase immediately after the variable name misses the majority case; got ${show(out)}`,
  );
  assert.ok(!out.includes("atlas"), `the package segment is not a candidate; got ${show(out)}`);
  assertSignatureTypesSurvive(out);
});

test("A5 [go]: `var cursor *atlas.Cursor` names Cursor", () => {
  const out = typesFor("go", "var cursor *atlas.Cursor = shard.Meta.Head");
  assert.ok(
    out.includes("Cursor"),
    `a pointer to a package-qualified type is the same type; got ${show(out)}`,
  );
  assertSignatureTypesSurvive(out);
});

test("A6 [csharp]: `Cursor? cursor = f();` names Cursor", () => {
  const out = typesFor("csharp", "Cursor? cursor = shard.Meta.Head;");
  assert.ok(
    out.includes("Cursor"),
    `the ? is nullability, not part of the name. Nullable reference types are on by default in modern C#, so this is the ordinary declaration and not the exception; got ${show(out)}`,
  );
  assertSignatureTypesSurvive(out);
});

test("A7 [python]: `cursor = Cursor()` names Cursor", () => {
  const out = typesFor("python", "cursor = Cursor()");
  assert.ok(
    out.includes("Cursor"),
    `Python has no \`new\`, so a constructor call is the only place the type gets written. Textually it is a call, which is why the goal asks for a decision rather than a reflex; the decision the goal takes is that it counts; got ${show(out)}`,
  );
  assertSignatureTypesSurvive(out);
});

test("A8 [csharp]: `Atlas.Cursor cursor` names Cursor and does not leak the namespace", () => {
  const out = typesFor("csharp", "Atlas.Cursor cursor = shard.Meta.Head;");
  assert.ok(out.includes("Cursor"), `the tail of the path is the type; got ${show(out)}`);
  assert.ok(
    !out.includes("Atlas"),
    `a two-segment path leaks its namespace where a three-segment path does not. A namespace resolves to nothing and holds a slot in a bounded surface; got ${show(out)}`,
  );
  assertSignatureTypesSurvive(out);
});

// ===========================================================================
// B. THE FORMS THAT ALREADY WORK. The scout ran every one of these and got a
// hit. They are here so a fix to section A cannot be paid for out of a form
// that was already right.
// ===========================================================================

const ALREADY_SEEN = [
  ["rust", "let cursor: Cursor = f();", "let cursor: Cursor = shard.meta.head();"],
  ["rust", "let cursor: Option<Cursor> = f();", "let cursor: Option<Cursor> = shard.meta.head();"],
  ["rust", "let cursor = Cursor::new();", "let cursor = Cursor::new(shard.meta.offset);"],
  ["go", "var cursor Cursor = f()", "var cursor Cursor = shard.Meta.Head"],
  ["go", "var cursor *Cursor = f()", "var cursor *Cursor = shard.Meta.Head"],
  ["go", "cursor := atlas.Cursor{}", "cursor := atlas.Cursor{}"],
  ["go", "cursor := &atlas.Cursor{}", "cursor := &atlas.Cursor{}"],
  ["csharp", "Cursor cursor = f();", "Cursor cursor = shard.Meta.Head;"],
  ["csharp", "var cursor = new Cursor();", "var cursor = new Cursor(shard.Meta.Offset);"],
  ["typescript", "const cursor: Cursor = f();", "const cursor: Cursor = shard.meta.head;"],
  ["typescript", "const cursor: Cursor | null = f();", "const cursor: Cursor | null = shard.meta.head;"],
  ["typescript", "const cursor = new Cursor();", "const cursor = new Cursor(shard.meta.offset);"],
  ["python", "cursor: Cursor = f()", "cursor: Cursor = shard.meta.head()"],
  ["python", "cursor: Cursor | None = f()", "cursor: Cursor | None = shard.meta.head()"],
];

for (const [languageId, form, decl] of ALREADY_SEEN) {
  test(`B [${languageId}]: \`${form}\` was already seen and stays seen`, () => {
    const out = typesFor(languageId, decl);
    assert.ok(
      out.includes("Cursor"),
      `this form is measured green today. A fix to another form must not cost it; got ${show(out)}`,
    );
    assertSignatureTypesSurvive(out);
  });
}

// ===========================================================================
// C. THE OVER-CORRECTION GUARD. Every row in section A widens what counts as a
// type position. A widened position that also swallows a property name, a
// prelude value, a constant or a commented-out line spends the round's budget
// on names that resolve to nothing, and a bounded surface drops a real
// collaborator to pay for them.
// ===========================================================================

test("C1 [rust]: a prelude value in a let is not a type in play", () => {
  const out = spanTypesInPlay({
    languageId: "rust",
    signature: "fn describe(&self, ledger: &Ledger) -> Manifest",
    code: `fn describe(&self, ledger: &Ledger) -> Manifest {
    let label: Option<String> = None;
    let seen = Some(ledger.count());
    Manifest::new(label.unwrap_or_default(), seen.unwrap_or(0))
}`,
  });
  for (const prelude of ["None", "Option", "String", "Some"]) {
    assert.ok(
      !out.includes(prelude),
      `${prelude} is in every Rust file's prelude. Resolving it costs a round trip and teaches the model nothing it does not already know; got ${show(out)}`,
    );
  }
  assert.ok(out.includes("Ledger") && out.includes("Manifest"), `the real collaborators survive; got ${show(out)}`);
});

test("C2 [csharp]: an object initializer's property names are not types in play", () => {
  const out = spanTypesInPlay({
    languageId: "csharp",
    signature: "public Manifest BuildManifest(Ledger ledger)",
    code: `public Manifest BuildManifest(Ledger ledger)
{
    var manifest = new Manifest
    {
        HeadOffset = ledger.HeadOffset,
        LastEnrolled = ledger.LastEnrolled,
        LastFlushed = ledger.LastFlushed,
        MirrorPath = ledger.MirrorPath,
        RetiredAt = ledger.RetiredAt,
    };
    return manifest;
}`,
  });
  for (const property of ["HeadOffset", "LastEnrolled", "LastFlushed", "MirrorPath", "RetiredAt"]) {
    assert.ok(
      !out.includes(property),
      `${property} is a property being assigned. A PascalCase name at the head of a comma-terminated line is the single largest junk class this scan has produced; got ${show(out)}`,
    );
  }
  assert.ok(out.includes("Ledger") && out.includes("Manifest"), `the real collaborators survive; got ${show(out)}`);
});

test("C3 [rust]: an ALL_CAPS constant and a bare single letter are never candidates", () => {
  const out = spanTypesInPlay({
    languageId: "rust",
    signature: "fn window<T>(&self, ledger: &Ledger) -> Manifest",
    code: `fn window<T>(&self, ledger: &Ledger) -> Manifest {
    let limit: usize = MAX_WINDOW;
    let head: T = ledger.head();
    Manifest::window(limit, head)
}`,
  });
  assert.ok(!out.includes("MAX_WINDOW"), `an ALL_CAPS name is a constant, not a type; got ${show(out)}`);
  assert.ok(!out.includes("T"), `a bare single letter is a type parameter with no shape to resolve; got ${show(out)}`);
  assert.ok(out.includes("Ledger") && out.includes("Manifest"), `the real collaborators survive; got ${show(out)}`);
});

test("C4 [go]: an ALL_CAPS constant and a bare single letter are never candidates", () => {
  const out = spanTypesInPlay({
    languageId: "go",
    signature: "func (l *Ledger) Window(ledger *Ledger) *Manifest",
    code: `func (l *Ledger) Window(ledger *Ledger) *Manifest {
	var limit uint64 = MAX_WINDOW
	var t T = ledger.head()
	return ledger.window(limit, t)
}`,
  });
  assert.ok(!out.includes("MAX_WINDOW"), `an ALL_CAPS name is a constant; got ${show(out)}`);
  assert.ok(
    !out.includes("T"),
    `Go's var leg is the position row A4 widens, and a single letter sits in it as often as a type does; got ${show(out)}`,
  );
  assert.ok(out.includes("Ledger") && out.includes("Manifest"), `the real collaborators survive; got ${show(out)}`);
});

test("C5 [rust]: the exact form row A3 fixes, inside a comment or a string, is not a candidate", () => {
  const out = spanTypesInPlay({
    languageId: "rust",
    signature: "fn build(&self, ledger: &Ledger) -> Manifest",
    code: `fn build(&self, ledger: &Ledger) -> Manifest {
    // let cursor: &Cursor = shard.meta.head();
    let note = "atlas::Cursor";
    ledger.build(note)
}`,
  });
  assert.ok(
    !out.includes("Cursor"),
    `a widened annotation position reads more text, so it must still read it through the comment and string mask; got ${show(out)}`,
  );
  assert.ok(out.includes("Ledger") && out.includes("Manifest"), `the real collaborators survive; got ${show(out)}`);
});

test("C6 [csharp]: the exact forms rows A6 and A8 fix, inside a comment or a string, are not candidates", () => {
  const out = spanTypesInPlay({
    languageId: "csharp",
    signature: "public Manifest Build(Ledger ledger)",
    code: `public Manifest Build(Ledger ledger)
{
    // Cursor? cursor = shard.Meta.Head;
    var note = "Atlas.Cursor cursor = f();";
    return ledger.Build(note);
}`,
  });
  for (const name of ["Cursor", "Atlas", "Meta", "Head"]) {
    assert.ok(!out.includes(name), `${name} appears only in a comment or a string literal; got ${show(out)}`);
  }
  assert.ok(out.includes("Ledger") && out.includes("Manifest"), `the real collaborators survive; got ${show(out)}`);
});

test("C7 [python]: a local from a plain call, and a local from a constant, name no type", () => {
  const out = spanTypesInPlay({
    languageId: "python",
    signature: "def shard_manifest(ledger: Ledger, last_enrolled: int, last_flushed: int) -> Manifest:",
    code: `def shard_manifest(ledger: Ledger, last_enrolled: int, last_flushed: int) -> Manifest:
    cursor = make_cursor()
    window = DEFAULT_WINDOW
    return cursor.to_manifest(window, last_enrolled, last_flushed)`,
  });
  assert.ok(
    !out.includes("make_cursor"),
    `row A7 counts \`Cursor()\` because the name is PascalCase. A snake_case factory is the same syntax and is not a type; got ${show(out)}`,
  );
  assert.ok(!out.includes("DEFAULT_WINDOW"), `an ALL_CAPS module constant is not a type; got ${show(out)}`);
  assert.ok(out.includes("Ledger") && out.includes("Manifest"), `the real collaborators survive; got ${show(out)}`);
});

test("C8 [rust]: widening the annotation colon must not open the `::` path", () => {
  const out = spanTypesInPlay({
    languageId: "rust",
    signature: "fn drain(&self, ledger: &Ledger) -> Manifest",
    code: `fn drain(&self, ledger: &Ledger) -> Manifest {
    let cursor: atlas::Cursor = ledger.head();
    match self.tx.try_send(cursor) {
        Ok(()) => self.written.fetch_add(1, Ordering::Relaxed),
        Err(TrySendError::Full(_)) => self.dropped.fetch_add(1, Ordering::SeqCst),
    };
    Manifest::empty()
}`,
  });
  for (const variant of ["Relaxed", "SeqCst", "Full"]) {
    assert.ok(
      !out.includes(variant),
      `${variant} is a variant reached through \`::\`. Row A3 asks the annotation position to accept a path on its RIGHT, not to accept a \`::\` as the annotation itself; got ${show(out)}`,
    );
  }
  assert.ok(!out.includes("Ordering"), `Ordering is std and the prelude set stops it; got ${show(out)}`);
  assert.ok(out.includes("TrySendError"), `the enum owning the path is a real collaborator; got ${show(out)}`);
});

test("C9 [go]: widening the var leg must not read a package function as a type", () => {
  const out = spanTypesInPlay({
    languageId: "go",
    signature: "func Drain(ledger *Ledger) *Manifest",
    code: `func Drain(ledger *Ledger) *Manifest {
	var cursor atlas.Cursor = ledger.Head()
	var err error = fmt.Errorf("drain %v", cursor)
	if err != nil {
		return nil
	}
	return ledger.manifest()
}`,
  });
  assert.ok(
    !out.includes("Errorf"),
    `the type token in a var declaration is \`error\`. A qualified name later on the line is a call, and rows A4 and A5 must not reach past the type to grab it; got ${show(out)}`,
  );
  assert.ok(out.includes("Manifest"), `the signature's return type survives; got ${show(out)}`);
});

test("C10 [csharp]: a `?` that is not nullability does not make the token before it a type", () => {
  const out = spanTypesInPlay({
    languageId: "csharp",
    signature: "public Manifest Pick(Ledger ledger, bool primary)",
    code: `public Manifest Pick(Ledger ledger, bool primary)
{
    var cursor = primary ? ledger.Head : ledger.Mirror;
    return cursor?.ToManifest() ?? Manifest.Empty;
}`,
  });
  for (const name of ["Head", "Mirror", "Empty", "ToManifest"]) {
    assert.ok(
      !out.includes(name),
      `${name} is a member. Row A6 accepts a ? bound to the type token, and a ternary, a null-conditional and a null-coalescing operator all spell ? somewhere else; got ${show(out)}`,
    );
  }
  assert.ok(out.includes("Ledger") && out.includes("Manifest"), `the real collaborators survive; got ${show(out)}`);
});

// ===========================================================================
// D. THE STATED CONTRACT. Garbage in, empty list out, no throw. Repair runs on
// whatever the human has half-typed, so an unparseable span is the normal case
// and not the edge.
// ===========================================================================

test("D [contract]: an unparseable span returns a list and does not throw", () => {
  for (const languageId of ["rust", "csharp", "typescript", "python", "go"]) {
    const out = spanTypesInPlay({ languageId, code: "::<<>>?? ,,, ((( ==" });
    assert.ok(Array.isArray(out), `a list is owed in every case; got ${show(out)}`);
    assert.equal(out.length, 0, `punctuation names nothing; got ${show(out)}`);
  }
});

test("D [contract]: the list is deduped and holds first-seen order", () => {
  const out = spanTypesInPlay({
    languageId: "rust",
    signature: "fn reuse(&self, ledger: &Ledger) -> Manifest",
    code: `fn reuse(&self, ledger: &Ledger) -> Manifest {
    let first: Shard = ledger.head();
    let second: Shard = ledger.tail();
    Manifest::pair(first, second)
}`,
  });
  assert.equal(out.length, new Set(out).size, `a repeated name costs a second round trip for the same answer; got ${show(out)}`);
  assert.ok(
    out.indexOf("Ledger") < out.indexOf("Shard") && out.indexOf("Manifest") < out.indexOf("Shard"),
    `the signature's types are leg 1 and the body's are leg 2, and a bounded surface spends its budget in that order; got ${show(out)}`,
  );
});
