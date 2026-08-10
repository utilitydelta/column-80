// The product-transport contract, asserted against a real editor.
//
// Every SurfaceExtractor primitive that the product ships rides
// `vscode.commands.executeCommand`. This file asserts what those six commands
// actually deliver over the four dogfood repos, so a transport built on them
// can be held to something measured rather than to a module header.
//
// The axis is IDENTITY, not presence. v15 shipped a payload that arrived, was
// well-formed, and belonged to the wrong type. Assertions that only ask
// "did something come back" would have passed while that bug shipped, so every
// test below names the type it asked for and refuses answers belonging to a
// sibling container.
//
// Absence and wrongness are separated on purpose. A server that never answers
// is an absent instrument and skips. A server that answers with the wrong
// thing fails.

'use strict';

const assert = require('assert');
const path = require('path');
const vscode = require('vscode');
const P = require('./helpers/probe');
const { SPECS, MIN_CONTRACT_PASSES } = require('./helpers/specs');

const LANG = P.LANG;
const S = SPECS[LANG];
if (!S) throw new Error(`C80_LANG must be one of ${Object.keys(SPECS).join(', ')}, got ${LANG}`);

const memo = new Map();
const once = (k, fn) => {
  if (!memo.has(k)) memo.set(k, fn());
  return memo.get(k);
};

const defFileBase = path.basename(S.defFile);

// --- shared probes -----------------------------------------------------------

// Symbol tree of the file that DEFINES the type under test.
const defSymbols = () => once('defSymbols', async () => {
  const doc = await P.open(S, S.defFile);
  const r = await P.settled(() => P.symbols(doc.uri));
  return { doc, ...r };
});

// Goto-definition from a bare `Tile` type reference in a different file.
// The widened window: on a cold workspace gopls serves COMPLETIONS seconds
// before DEFINITIONS (measured on this box: completions at ~1.5s, the first
// definition answer past the 8s default), and this memoized result seeds the
// whole documentSymbol/definition ladder — a stable-empty here darkens six
// tests. One 30s ceiling on this single probe; a row whose server never
// answers still times out to the same honest skip.
const defResult = () => once('defResult', async () => {
  const doc = await P.open(S, S.typeRef.file);
  const pos = P.cursorAt(doc, S.typeRef);
  const r = await P.settled(() => P.definitions(doc.uri, pos), {
    ready: (v) => normLocs(v).length > 0,
    key: (v) => JSON.stringify(normLocs(v)),
    timeoutMs: 30_000,
  });
  return { doc, pos, locs: normLocs(r.value), settled: r.settled, ms: r.ms };
});

function normLocs(v) {
  return (Array.isArray(v) ? v : v ? [v] : []).map((l) => {
    const uri = l.targetUri || l.uri;
    const range = l.targetSelectionRange || l.targetRange || l.range;
    return { uri, scheme: uri && uri.scheme, fsPath: uri && uri.fsPath, start: range && range.start };
  }).filter((l) => l.uri && l.start);
}

// The documentSymbol container the definition cursor lands inside. This is
// exactly the descent `membersOfType` performs.
const containerAtDef = () => once('containerAtDef', async () => {
  const { locs } = await defResult();
  if (!locs.length) return null;
  const target = locs[0];
  const doc = await vscode.workspace.openTextDocument(target.uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  const r = await P.settled(() => P.symbols(target.uri));
  const chain = P.chainAt(r.value || [], target.start);
  return { target, syms: r.value || [], chain, settled: r.settled };
});

// Completions at a freshly typed `receiver.` where the receiver is a `Tile`.
//
// The dot is INSERTED rather than borrowed from an existing call, because the
// site shapes the answer: asked at `t.<cursor>subtended_children()`,
// rust-analyzer reads a method-call context and withholds the struct's fields
// entirely. The product asks at a dot the human just typed with nothing after
// it, so that is what this asks too. The edit is reverted, never saved.
const memberCompletions = () => once('memberCompletions', () =>
  P.withInsertion(S, S.dotSite, async (doc, base) => {
    const pos = doc.positionAt(base + S.dotSite.insert.length);
    const r = await P.settled(() => P.completions(doc.uri, pos, '.'), {
      ready: (v) => P.itemsOf(v).length > 0,
      key: (v) => P.itemsOf(v).map(P.labelOf).sort().join(','),
    });
    return { items: P.itemsOf(r.value), settled: r.settled, ms: r.ms };
  }));

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Hover text at one position, flattened. `P.settled` is the wrong instrument
// here: it costs 3s per call at its settle gap, and this runs once per member.
// The symbol tree has already settled by the time anything calls this, so a
// short retry is enough to cover a server that is momentarily busy.
async function hoverTextAt(uri, pos) {
  for (let i = 0; i < 4; i++) {
    const hs = (await P.hovers(uri, pos)) || [];
    const text = hs
      .flatMap((h) => (h.contents || []).map((c) => (typeof c === 'string' ? c : c.value || '')))
      .join('\n')
      .trim();
    if (text.length > 0) return text;
    await P.sleep(500);
  }
  return '';
}

// Names that came back for `Tile` and are neither Tile's own members nor a
// declared sibling nor a declared known leak. The leak tests below assert
// against `forbidden` only, so this is how `specs.js`'s `knownLeaks` stays
// checkable against what the servers actually send. Callers assert the result
// is empty: a new member arriving under a `Tile` header is the defect class
// this tier exists to catch, and printing its name is not catching it.
function reportUndeclared(where, names) {
  const declared = new Set([
    ...S.required, ...S.forbidden, ...(S.ownExtras || []), ...(S.knownLeaks || []), S.typeName,
  ]);
  const undeclared = [...new Set(names)].filter((n) => n && !declared.has(n));
  P.report(`${where}: names outside \`Tile\`'s own members`, [
    `declared knownLeaks present: ${(S.knownLeaks || []).filter((k) => names.includes(k)).join(', ') || '(none)'}`,
    `UNDECLARED: ${undeclared.join(', ') || '(none)'}`,
  ]);
  return undeclared;
}

function assertAllDeclared(where, undeclared) {
  assert.deepStrictEqual(
    undeclared, [],
    `${where} returned ${undeclared.join(', ')} for \`${S.typeName}\` on ${LANG}, which no list in specs.js ` +
    'classifies. Resolve it by adding the name to `knownLeaks` or `ownExtras` with a reason, ' +
    'not by moving it into `forbidden`.',
  );
}

// --- tests -------------------------------------------------------------------

suite(`product transport contract [${LANG}]`, function () {
  this.timeout(600000);

  // A row whose server never loaded skips every test, and mocha exits on the
  // failure count, so silence would read as success. Two floors guard that,
  // and they catch different failures. The pass total catches a row that
  // measured almost nothing. The per-capability count catches ONE server
  // capability going dark while the rest carry the row over the total: lose
  // completions and 11 of 14 still pass, on the axis this tier exists to
  // measure.
  let passed = 0;
  const executed = new Map();
  const capOf = new Map();

  // Registers a test against the server capability it interrogates. Grouping
  // lives at the definition site so a new test cannot land uncounted.
  const capTest = (capability, title, fn) => {
    capOf.set(title, capability);
    if (!executed.has(capability)) executed.set(capability, 0);
    test(title, fn);
  };

  teardown(function () {
    const t = this.currentTest;
    if (!t) return;
    if (t.state === 'passed') passed++;
    // A runtime `this.skip()` leaves the test pending, which is the silence
    // being counted; only a verdict counts as executed.
    if (t.state === 'passed' || t.state === 'failed') {
      const cap = capOf.get(t.title);
      if (cap) executed.set(cap, executed.get(cap) + 1);
    }
  });

  capTest('documentSymbol/definition', 'documentSymbol answers over the file that defines the type', async function () {
    const { value, settled, ms } = await defSymbols();
    if (!value || !value.length) return this.skip();
    assert.ok(settled, `the documentSymbol tree over ${defFileBase} never stopped changing for ${LANG}`);
    const top = value.map((s) => `${s.name} (${P.kindName(s.kind)}) children=${Array.isArray(s.children) ? s.children.length : 'ABSENT'} detail=${JSON.stringify(s.detail)}`);
    P.report(`documentSymbol over ${defFileBase} after ${ms}ms (settled=${settled})`, top);
    assert.ok(value.length > 0, 'documentSymbol returned nothing over the definition file');
    assert.ok(
      P.findByName(value, S.typeName).length > 0,
      `no symbol named ${S.typeName} anywhere in the tree of ${defFileBase}; ` +
      `membersOfType has nothing to descend into. Top-level: ${value.map((s) => s.name).join(', ')}`,
    );
  });

  capTest('documentSymbol/definition', 'documentSymbol nodes expose children, the field membersOfType descends', async function () {
    const { value } = await defSymbols();
    if (!value || !value.length) return this.skip();
    const type = P.findByName(value, S.typeName)[0];
    if (!type) return this.skip();
    P.report('the type node itself', [
      `${type.name}: children=${Array.isArray(type.children) ? type.children.length : 'ABSENT'} detail=${JSON.stringify(type.detail)} kind=${P.kindName(type.kind)}`,
    ]);
    assert.ok(
      Array.isArray(type.children),
      `${S.typeName}'s documentSymbol node has no \`children\` array at all; membersOfType cannot descend`,
    );
    assert.ok(
      type.children.length > 0,
      `${S.typeName}'s documentSymbol node has children=[] over ${defFileBase}, so membersOfType is structurally dark for ${LANG}`,
    );
  });

  capTest('documentSymbol/definition', 'definition of a bare type reference lands in the defining file, not at the reference', async function () {
    const { doc, pos, locs, ms, settled } = await defResult();
    if (!locs.length) return this.skip();
    assert.ok(settled, `the definition of \`${S.typeName}\` never stopped moving for ${LANG}`);
    P.report(`definition of \`${S.typeName}\` after ${ms}ms (settled=${settled})`, locs.map(
      (l) => `${l.scheme}: ${l.fsPath} @ ${l.start.line}:${l.start.character}`,
    ));
    const target = locs[0];
    assert.strictEqual(
      path.basename(target.fsPath), defFileBase,
      `definition of \`${S.typeName}\` landed in ${path.basename(target.fsPath)}, expected ${defFileBase}`,
    );
    const sameSpot = target.uri.toString() === doc.uri.toString() && target.start.line === pos.line;
    assert.ok(
      !sameSpot,
      'the server answered the reference with the reference\'s OWN position; ' +
      'membersOfType from here descends into the enclosing container, which is the v15 defect',
    );
    assert.strictEqual(target.scheme, 'file', `definition uri scheme is ${target.scheme}, not file`);
  });

  capTest('documentSymbol/definition', 'the innermost container at the definition cursor IS the requested type', async function () {
    const c = await containerAtDef();
    if (!c) return this.skip();
    if (!c.syms.length) return this.skip();
    P.report('container chain at the definition cursor', [
      c.chain.length
        ? c.chain.map((s) => `${s.name} (${P.kindName(s.kind)})`).join('  >  ')
        : `EMPTY - no symbol range contains ${c.target.start.line}:${c.target.start.character}`,
      `top-level names: ${c.syms.map((s) => s.name).join(', ')}`,
    ]);
    assert.ok(c.chain.length > 0, `no documentSymbol range contains the definition cursor for ${S.typeName}`);
    const innermost = c.chain[c.chain.length - 1];
    assert.strictEqual(
      innermost.name, S.typeName,
      `the definition cursor for \`${S.typeName}\` sits innermost inside \`${innermost.name}\`. ` +
      `membersOfType would return ${innermost.name}'s members under a ${S.typeName} header.`,
    );
  });

  capTest('documentSymbol/definition', 'membersOfType returns the requested type\'s own members', async function () {
    const c = await containerAtDef();
    if (!c || !c.syms.length) return this.skip();
    assert.ok(c.settled, `the documentSymbol tree at the definition never settled for ${LANG}`);
    // Every node that speaks for the type. This APPROXIMATES the product's
    // union (`implSelfType` in src/core/extraction.ts) and is not the same
    // function: `P.typeNodes` strips a leading `impl` with a regex, so it
    // diverges on `impl Trait for Tile` (the product resolves the self type
    // after `for`, this reads the trait name), on `impl<T> Tile<T>` (the
    // product strips leading generics first), and on a module-nested type (the
    // product gathers impls at the container's own sibling level, this
    // flattens the whole tree). All three agree on today's fixtures.
    const nodes = P.typeNodes(c.syms, S.typeName);
    if (!nodes.length) return this.skip();
    const members = nodes.flatMap(P.membersOf);
    P.report(`membersOfType(${S.typeName}) from ${nodes.length} node(s) named ${S.typeName}`,
      members.length ? members.map((m) => `${m.kind} ${m.name}  detail=${JSON.stringify(m.detail)}`) : ['(empty)']);
    const names = new Set(members.map((m) => P.bareName(m.name)));
    const missing = S.required.filter((r) => !names.has(r));
    assert.deepStrictEqual(
      missing, [],
      `membersOfType(${S.typeName}) is missing ${missing.join(', ')}. Got: ${[...names].join(', ') || '(nothing)'}`,
    );
  });

  // Companion to the test above. When the strict descent comes up short, this
  // says where the rest of the members actually are, so the red is a recipe
  // rather than a mystery. Rust is the case that needs it: `Tile` (Struct)
  // holds the fields and a SIBLING node called `impl Tile` holds the methods,
  // so a transport that descends only the container at the definition cursor
  // is dark for every Rust method.
  capTest('documentSymbol/definition', 'every member is reachable once sibling impl blocks are unioned in', async function () {
    const c = await containerAtDef();
    if (!c || !c.syms.length) return this.skip();
    const nodes = P.typeNodes(c.syms, S.typeName);
    if (!nodes.length) return this.skip();
    const members = nodes.flatMap(P.membersOf);
    P.report(`nodes speaking for ${S.typeName}`, [
      ...nodes.map((n) => `${JSON.stringify(n.name)} (${P.kindName(n.kind)}) -> ${P.membersOf(n).map((m) => P.bareName(m.name)).join(', ') || '(none)'}`),
    ]);
    const names = new Set(members.map((m) => P.bareName(m.name)));
    const missing = S.required.filter((r) => !names.has(r));
    assert.deepStrictEqual(
      missing, [],
      `even unioned across ${nodes.length} node(s), ${missing.join(', ')} is unreachable from documentSymbol for ${LANG}`,
    );
  });

  capTest('documentSymbol/definition', 'membersOfType leaks no DOGFOOD SIBLING container\'s members', async function () {
    const c = await containerAtDef();
    if (!c || !c.syms.length) return this.skip();
    const nodes = P.typeNodes(c.syms, S.typeName);
    if (!nodes.length) return this.skip();
    const names = nodes.flatMap(P.membersOf).map((m) => P.bareName(m.name));
    assertAllDeclared('membersOfType', reportUndeclared('membersOfType', names));
    const leaked = S.forbidden.filter((f) => names.includes(f));
    assert.deepStrictEqual(
      leaked, [],
      `membersOfType(${S.typeName}) returned ${leaked.join(', ')}, which belong to a DIFFERENT container. ` +
      'A wrong member set rendered under a "to build a Tile:" header is worse than an empty one.',
    );
  });

  capTest('documentSymbol/definition', 'membersOfType carries SIGNATURES, not bare names', async function () {
    const c = await containerAtDef();
    if (!c || !c.syms.length) return this.skip();
    // Same member set as the tests above. Exact-name matching would ask this
    // question of Rust's two struct fields alone and never look at a method,
    // which says nothing about argument arity.
    const nodes = P.typeNodes(c.syms, S.typeName);
    if (!nodes.length) return this.skip();
    const members = nodes.flatMap(P.membersOf);
    if (!members.length) return this.skip();
    const callable = members.filter((m) => /Method|Function|Constructor|Property|Field/.test(m.kind));
    const withSig = callable.filter((m) => m.detail && m.detail.trim().length > 0);
    P.report('signature availability on the member set', [
      `${withSig.length}/${callable.length} callable members carry a non-empty detail`,
      ...callable.slice(0, 12).map((m) => `${m.name} -> detail=${JSON.stringify(m.detail)}`),
    ]);
    assert.ok(
      callable.length > 0 && withSig.length === callable.length,
      `the contract says membersOfType returns members WITH SIGNATURES, but ${callable.length - withSig.length}/` +
      `${callable.length} carry an empty or absent detail for ${LANG}. ` +
      'A transport reading detail alone renders names with no argument list.',
    );
  });

  capTest('completions', 'completeMembers at a member site returns the receiver type\'s members', async function () {
    const { items, ms, settled } = await memberCompletions();
    if (!items.length) return this.skip();
    assert.ok(settled, `the completion list at a \`${S.typeName}\` receiver never settled for ${LANG}`);
    const labels = items.map((it) => P.bareName(P.labelOf(it)));
    P.report(`completion at a typed \`${S.dotSite.insert.trim()}\` after ${ms}ms (settled=${settled}), ${items.length} items`, [
      ...items.slice(0, 15).map((it) => `${P.labelOf(it)}  ::  ${P.textOf(it).slice(0, 120)}`),
      `all labels: ${labels.join(', ')}`,
    ]);
    const missing = S.required.filter((r) => !labels.includes(r));
    assert.deepStrictEqual(
      missing, [],
      `completions at a \`${S.typeName}\` receiver are missing ${missing.join(', ')}. Got: ${labels.slice(0, 40).join(', ')}`,
    );
    // Presence of the right NAMES is not proof a language server answered.
    // With every extension disabled, vscode's word-based suggest provider
    // returns the same identifiers scraped out of the buffer, carrying a label
    // and nothing else, and this test passed against it. A member the server
    // typed for us carries something past its own name.
    const typed = S.required
      .map((r) => items.find((it) => P.bareName(P.labelOf(it)) === r))
      .filter((it) => it && P.textOf(it) !== P.labelOf(it));
    assert.ok(
      typed.length > 0,
      `every completion at a \`${S.typeName}\` receiver is a bare label with no detail, documentation or type. ` +
      'That is what the word-based suggest provider returns when no language server is running.',
    );
  });

  capTest('completions', 'completeMembers at a Tile receiver leaks no DOGFOOD SIBLING container\'s members', async function () {
    const { items } = await memberCompletions();
    if (!items.length) return this.skip();
    const labels = items.map((it) => P.bareName(P.labelOf(it)));
    assertAllDeclared('completeMembers', reportUndeclared('completeMembers', labels));
    const leaked = S.forbidden.filter((f) => labels.includes(f));
    assert.deepStrictEqual(
      leaked, [],
      `a \`${S.typeName}\` receiver offered ${leaked.join(', ')}, which are not ${S.typeName}'s members`,
    );
  });

  capTest('completions', 'a member completion exposes the parameter TYPE its argument takes', async function () {
    const doc = await P.open(S, S.argSite.file);
    const pos = P.cursorAt(doc, S.argSite);
    const r = await P.settled(() => P.completions(doc.uri, pos, '.'), {
      ready: (v) => P.itemsOf(v).some((it) => P.bareName(P.labelOf(it)) === S.argSite.argMember),
      key: (v) => P.itemsOf(v).map((it) => P.textOf(it)).sort().join('|'),
    });
    const items = P.itemsOf(r.value);
    if (!items.length) return this.skip();
    assert.ok(r.settled, `the completion list at the argument site never settled for ${LANG}`);
    const hit = items.find((it) => P.bareName(P.labelOf(it)) === S.argSite.argMember);
    if (!hit) {
      P.report('argument-type probe', [`no completion labelled ${S.argSite.argMember}; got ${items.map(P.labelOf).slice(0, 20).join(', ')}`]);
      assert.fail(`the receiver offered no member called ${S.argSite.argMember}`);
    }
    const text = P.textOf(hit);
    P.report(`argument-type payload for ${S.argSite.argMember}`, [
      `label       = ${JSON.stringify(hit.label)}`,
      `detail      = ${JSON.stringify(hit.detail)}`,
      `doc         = ${JSON.stringify(typeof hit.documentation === 'string' ? hit.documentation : hit.documentation && hit.documentation.value).slice(0, 300)}`,
      `flattened   = ${text.slice(0, 300)}`,
    ]);
    assert.ok(
      new RegExp(`\\b${S.typeName}\\b`).test(text),
      `nothing the editor exposes about \`${S.argSite.argMember}\` names its parameter type \`${S.typeName}\`. ` +
      'The argument-type injection leg cannot know which type to build. Saw: ' + text.slice(0, 200),
    );
  });

  // Named for the SERVER capability, not for a product method. The by-name
  // resolution leg this measures the raw material for
  // (`resolveTypeCursorByName`) exists on the C# transport alone, so a test
  // named after it and green on four rows would report three implementations
  // that do not exist.
  capTest('workspaceSymbol', 'workspaceSymbol resolves a bare type name to a file-scheme type in the defining file', async function () {
    const r = await P.settled(() => P.wsSymbols(S.typeName), {
      ready: (v) => Array.isArray(v) && v.some((s) => s.name === S.typeName),
      key: (v) => (v || []).map((s) => `${s.name}@${s.location && s.location.uri && s.location.uri.scheme}`).sort().join(','),
    });
    const all = r.value || [];
    if (!all.length) return this.skip();
    assert.ok(r.settled, `the workspaceSymbol result for \`${S.typeName}\` never settled for ${LANG}`);
    P.report(`workspaceSymbol("${S.typeName}") -> ${all.length} results`, all.slice(0, 15).map(
      (s) => `${s.name} (${P.kindName(s.kind)}) container=${JSON.stringify(s.containerName)} ${s.location && s.location.uri && s.location.uri.scheme}:${s.location && s.location.uri && s.location.uri.fsPath}`,
    ));
    const exact = all.filter((s) => P.bareName(s.name) === S.typeName);
    assert.ok(exact.length > 0, `workspaceSymbol("${S.typeName}") returned no EXACT-name match; got ${all.map((s) => s.name).slice(0, 20).join(', ')}`);
    const typeKinds = [vscode.SymbolKind.Class, vscode.SymbolKind.Struct, vscode.SymbolKind.Interface, vscode.SymbolKind.Enum];
    const asType = exact.filter((s) => typeKinds.includes(s.kind));
    assert.ok(asType.length > 0, `no exact \`${S.typeName}\` match is a TYPE kind; kinds seen: ${exact.map((s) => P.kindName(s.kind)).join(', ')}`);
    const inRepo = asType.filter((s) => s.location && s.location.uri && s.location.uri.scheme === 'file' && s.location.uri.fsPath.startsWith(S.repo));
    assert.ok(
      inRepo.length > 0,
      'every exact type match sits at a non-file or out-of-workspace location, so resolveTypeCursorByName cannot ' +
      `prefer a non-metadata one. Saw: ${asType.map((s) => `${s.location && s.location.uri && s.location.uri.scheme}`).join(', ')}`,
    );
    assert.strictEqual(
      path.basename(inRepo[0].location.uri.fsPath), defFileBase,
      `the preferred \`${S.typeName}\` sits in ${path.basename(inRepo[0].location.uri.fsPath)}, not ${defFileBase}`,
    );
  });

  capTest('hover', 'hoverSurface at a typed receiver names that receiver\'s type', async function () {
    const doc = await P.open(S, S.memberSite.file);
    const at = P.cursorAt(doc, S.memberSite);
    const pos = at.translate(0, -2); // onto the receiver identifier, before the dot
    const r = await P.settled(() => P.hovers(doc.uri, pos), { ready: (v) => Array.isArray(v) && v.length > 0 });
    const hs = r.value || [];
    if (!hs.length) return this.skip();
    assert.ok(r.settled, `the hover over the \`${S.typeName}\` receiver never settled for ${LANG}`);
    const text = hs.flatMap((h) => (h.contents || []).map((c) => (typeof c === 'string' ? c : c.value || ''))).join('\n');
    P.report('hover on the receiver', [text.slice(0, 400).replace(/\n/g, '\n    ')]);
    assert.ok(
      new RegExp(`\\b${S.typeName}\\b`).test(text),
      `hover on a \`${S.typeName}\` receiver does not name the type. hoverSurface has no type to report. Saw: ${text.slice(0, 200)}`,
    );
  });

  // The single position the whole signature backfill depends on. TypeScript and
  // Python documentSymbol carry no `detail`, so the transports recover a
  // member's argument list by asking hover AT that member's own name token in
  // the definition file, and whatever comes back is parsed into the block the
  // model reads. Nothing captured that payload: the tier logged hover at a
  // typed RECEIVER, which is a different position answered by a different
  // format. A drift in either server's member-hover spelling would have been
  // reported by no oracle in this repo.
  capTest('hover', 'hover answers AT a member\'s own name token, and names that member', async function () {
    const { value } = await defSymbols();
    if (!value || !value.length) return this.skip();
    const type = P.findByName(value, S.typeName).find((s) => Array.isArray(s.children) && s.children.length > 0);
    if (!type) return this.skip();
    const doc = await P.open(S, S.defFile);

    const captures = [];
    for (const child of type.children) {
      // `selectionRange` is the NAME token; `range` is the whole declaration
      // including its body, whose start is the modifier or decorator. The
      // transports ask at the name, so this asks there too.
      const sel = child.selectionRange || P.symRange(child);
      if (!sel) continue;
      captures.push({
        name: child.name,
        detail: child.detail === undefined ? undefined : String(child.detail),
        hover: await hoverTextAt(doc.uri, sel.start),
      });
    }

    P.report(`hover AT each member name token of \`${S.typeName}\` in ${defFileBase}`, captures.map((c) =>
      `${c.name}  detail=${JSON.stringify(c.detail)}\n      hover=${JSON.stringify(c.hover)}`));

    const answered = captures.filter((c) => c.hover.length > 0);
    assert.ok(
      answered.length > 0,
      `no member of \`${S.typeName}\` answered hover at its own name token on ${LANG}, over ${captures.length} ` +
      'members. The signature backfill asks at exactly this position, so it has nothing to parse and every ' +
      'member renders as a bare name.',
    );

    // Provenance at the source. A hover that does not name the member it was
    // asked about is describing some OTHER symbol, and the backfill would hand
    // that text to the renderer as this member's declaration. A block under a
    // "to build a Tile" header stating another symbol's shape is the v15 defect.
    const misnamed = answered
      .filter((c) => !new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(P.bareName(c.name))}([^A-Za-z0-9_]|$)`).test(c.hover))
      .map((c) => `${c.name} -> ${JSON.stringify(c.hover.slice(0, 160))}`);
    assert.deepStrictEqual(
      misnamed, [],
      `on ${LANG} hover at a member's own name token answered about a different symbol: ${misnamed.join(' ; ')}. ` +
      'The signature backfill reads this position, so the injected block would state that symbol as the member.',
    );
  });

  capTest('codeAction', 'qualifyImport: a code action offers the missing import for an in-repo name', async function () {
    const probed = await P.withInsertion(S, S.unimported, async (doc, base) => {
      // Sit the request ON the unresolved identifier: a quickfix is offered
      // against the diagnostic's own span, not anywhere on the line.
      const probeIdx = base + S.unimported.insert.indexOf(S.unimported.probe);
      const range = new vscode.Range(doc.positionAt(probeIdx), doc.positionAt(probeIdx + S.unimported.probe.length));
      // Roslyn has to raise the diagnostic before it will offer the quickfix,
      // so this one waits longer than the shared ready budget. It is still
      // short enough that a row with no server admits it inside the minute.
      const r = await P.settled(() => P.codeActions(doc.uri, range), {
        ready: (v) => Array.isArray(v) && v.length > 0,
        key: (v) => (v || []).map((a) => a.title).sort().join(','),
        timeoutMs: 20000,
      });
      return { actions: r.value || [], settled: r.settled };
    });
    const actions = probed.actions;
    P.report(`code actions over the unresolved \`${S.unimported.probe}\` (${actions.length})`,
      actions.length ? actions.slice(0, 15).map((a) => `${a.title}  kind=${a.kind && a.kind.value}  hasEdit=${!!a.edit} hasCommand=${!!a.command}`) : ['(none)']);
    if (!actions.length) return this.skip();
    assert.ok(probed.settled, `the code-action list over \`${S.unimported.probe}\` never settled for ${LANG}`);
    const importish = actions.filter((a) => /\b(import|using|use)\b/i.test(a.title));
    assert.ok(
      importish.length > 0,
      `no code action mentions an import for the unresolved name. Titles: ${actions.map((a) => a.title).join(' / ')}`,
    );
    assert.ok(
      importish.some((a) => a.edit || a.command),
      'the import action carries neither a WorkspaceEdit nor a resolving command, so qualifyImport has no edit to return',
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const silent = [...executed].filter(([, n]) => n === 0).map(([cap]) => cap);
    assert.deepStrictEqual(
      silent, [],
      `[${LANG}] every test for ${silent.join(', ')} skipped, so that capability answered nothing and ` +
      'this row reports neither a pass nor a red on it.',
    );
    assert.ok(
      passed >= MIN_CONTRACT_PASSES,
      `[${LANG}] only ${passed} of at least ${MIN_CONTRACT_PASSES} contract tests passed. ` +
      `The ${LANG} language server did not answer, so this row measured nothing.`,
    );
  });
});
