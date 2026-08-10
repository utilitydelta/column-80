// The product transports themselves, run inside a real extension host.
//
// Its sibling `contract.test.js` measures what the four language servers send.
// This file measures what `src/vscode/*Extractor.ts` MAKES of it: the same
// `extractorFor` the extension calls, anchored by the same
// `findTypeAnchorInText` the completion provider calls, driven through
// `definition()` and `membersOfType()` on the real object.
//
// That distinction is the whole point. A harness that reimplements the descent
// tests its own copy, and when the copy and the product disagree the harness
// reports a defect the product does not have. Everything below rides product
// code, so a break in `membersOfType` shows up here and nowhere else in this
// repo.
//
// The bundle is built by `npm run build` (esbuild, cjs, `vscode` external) and
// only the host can satisfy that external, which is why this cannot move into
// the headless suite.

'use strict';

const assert = require('assert');
const vscode = require('vscode');
const P = require('./helpers/probe');
const { SPECS, SIGNATURE_CHROME } = require('./helpers/specs');
const {
  extractorFor, findTypeAnchorInText, pyFindTypeAnchorInText, goFindTypeAnchorInText, renderMemberSignatures,
} = require('./.build/product');

// How many arguments a rendered signature says a caller must supply: the
// contents of its first balanced parenthesis group, split on the commas that
// are not inside a nested group. Generic arguments and tuple types carry commas
// of their own, so a bare `split(',')` would over-count `Dict[str, int]`.
//
// `<` and `>` are counted as brackets because a generic argument list is where
// most of those stray commas live. That makes the ARROWS ambiguous: the `>` of
// a TypeScript `=>` and of a Rust/Python `->` are not closes, and treating them
// as such ends the scan early. `on(cb: (x: number) => void, once: boolean)`
// counted 1 argument instead of 2 — the oracle under-counting exactly the
// signatures whose arity is hardest to guess.
function paramCount(line) {
  const open = line.indexOf('(');
  if (open < 0) return undefined;
  let depth = 0;
  let params = 0;
  let sawContent = false;
  for (let i = open; i < line.length; i++) {
    const c = line[i];
    const prev = line[i - 1];
    if (c === '<' && line[i + 1] === '=') continue; // a comparison, not a generic open
    if (c === '>' && (prev === '=' || prev === '-')) continue; // the tail of `=>` or `->`
    if (c === '(' || c === '[' || c === '<' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '>' || c === '}') {
      depth--;
      if (depth === 0) return sawContent ? params + 1 : 0;
    } else if (c === ',' && depth === 1) params++;
    else if (depth === 1 && c.trim().length > 0) sawContent = true;
  }
  return undefined;
}

// The oracle's own arity reader, graded. A construction-arity assertion is only
// as good as the counter behind it, and this one silently under-counted every
// callback-taking signature. Declared cases rather than a live payload, because
// the shapes that break it are the ones the dogfood repos happen not to contain.
const PARAM_COUNT_CASES = [
  ['constructor Tile(mortonCode: number, lod: number): Tile', 2],
  ['Tile(int mortonCode, int lod)', 2],
  ['__init__(morton_code: int, lod: int)', 2],
  ['from_morton(morton_code: u64, lod: u8) -> Tile', 2],
  ['encloses(other: Tile) -> bool', 1],
  ['subtendedChildren(): Tile[]', 0],
  ['merge(a: Map<string, number>, b: Set<Tile>): void', 2],
  ['partition(by: Dict[str, int]) -> None', 1],
  // The arrows. Each of these read 1 before the fix.
  ['on(cb: (x: number) => void, once: boolean): void', 2],
  ['map(f: impl Fn(u8) -> u8, n: u8)', 2],
  ['reduce(fn: (a: T, b: T) => T, seed: T, tag: string): T', 3],
];

suite('the oracle\'s own arity reader', function () {
  for (const [line, want] of PARAM_COUNT_CASES) {
    test(`paramCount: ${line}`, function () {
      assert.strictEqual(
        paramCount(line), want,
        `paramCount read ${paramCount(line)} arguments from ${JSON.stringify(line)}, which declares ${want}. ` +
        'The construction-arity assertion below is built on this, so a miscount here is a green over a block ' +
        'that states the wrong number of arguments.',
      );
    });
  }
});

const LANG = P.LANG;
const S = SPECS[LANG];
if (!S) throw new Error(`C80_LANG must be one of ${Object.keys(SPECS).join(', ')}, got ${LANG}`);

suite(`product transport, driven [${LANG}]`, function () {
  this.timeout(600000);

  test('extractorFor(language) returns a transport for this row', function () {
    const ex = extractorFor(S.languageId);
    P.report(`extractorFor(${JSON.stringify(S.languageId)})`, [
      ex ? `${ex.constructor.name}` : 'undefined',
    ]);
    assert.ok(ex, `extractorFor(${S.languageId}) is undefined, so the product ships no transport for this row`);
  });

  test('the real anchor, definition and membersOfType deliver the type\'s members', async function () {
    const ex = extractorFor(S.languageId);
    assert.ok(ex, `extractorFor(${S.languageId}) is undefined`);

    const doc = await P.open(S, S.typeRef.file);
    const text = doc.getText();
    // The product picks its own anchor. Handing the transport a coordinate the
    // test chose would leave the anchor untested and could ask at a site the
    // product never asks at.
    const anchor = S.languageId === 'python'
      ? pyFindTypeAnchorInText(text, S.typeName)
      : S.languageId === 'go'
        ? goFindTypeAnchorInText(text, S.typeName)
        : findTypeAnchorInText(text, S.typeName);
    assert.ok(
      anchor,
      `findTypeAnchorInText found no safe \`${S.typeName}\` anchor in ${S.typeRef.file}, ` +
      'so the product has nowhere to ask definition() from',
    );
    const cursor = { uri: doc.uri.toString(), line: anchor.line, character: anchor.character };

    const r = await P.settled(
      async () => {
        const def = await ex.definition(cursor);
        if (!def) return undefined;
        const members = await ex.membersOfType({
          uri: def.uri,
          line: def.range.startLine,
          character: def.range.startCharacter,
        });
        return { def, members };
      },
      {
        ready: (v) => !!v && v.members.length > 0,
        key: (v) => (v ? v.members.map((m) => m.name).sort().join(',') : ''),
      },
    );

    const anchorLine = text.split('\n')[anchor.line];
    P.report('the product ladder', [
      `anchor      = ${anchor.line}:${anchor.character} in ${S.typeRef.file}  -> ${JSON.stringify(anchorLine.trim())}`,
      `definition  = ${r.value ? `${r.value.def.uri} @ ${r.value.def.range.startLine}:${r.value.def.range.startCharacter}` : 'undefined'}`,
      `members     = ${r.value ? r.value.members.map((m) => `${m.kind} ${m.name}${m.signature ? ` ${m.signature}` : ''}`).join(' | ') : '(none)'}`,
      `settled=${r.settled} after ${r.ms}ms`,
    ]);

    assert.ok(r.value, `the product's definition() resolved nothing from the \`${S.typeName}\` anchor for ${LANG}`);
    assert.ok(
      r.value.members.length > 0,
      `the product's membersOfType returned nothing for \`${S.typeName}\` on ${LANG}, ` +
      `descending from ${r.value.def.uri} @ ${r.value.def.range.startLine}:${r.value.def.range.startCharacter}`,
    );
    assert.ok(r.settled, `the product's member set never stopped changing for ${LANG}`);

    const names = new Set(r.value.members.map((m) => P.bareName(m.name)));
    const missing = S.required.filter((n) => !names.has(n));
    assert.deepStrictEqual(
      missing, [],
      `the product's membersOfType(${S.typeName}) is missing ${missing.join(', ')}. Got: ${[...names].join(', ') || '(nothing)'}`,
    );

    const leaked = S.forbidden.filter((f) => names.has(f));
    assert.deepStrictEqual(
      leaked, [],
      `the product's membersOfType(${S.typeName}) returned ${leaked.join(', ')}, which belong to a DIFFERENT container. ` +
      'That is the v15 defect, measured on the code that shipped it.',
    );

    // The other half of the v15 defect. Names alone let a member set arrive
    // looking healthy while the argument-type block it feeds renders `new
    // Tile(` with no arity.
    const callable = r.value.members.filter((m) => m.kind === 'method' || m.kind === 'function');
    const bare = callable.filter((m) => !m.signature || !m.signature.trim());
    P.report('signatures on the product member set', [
      `${callable.length - bare.length}/${callable.length} callable members carry a non-empty signature`,
      ...callable.map((m) => `${m.kind} ${m.name} -> signature=${JSON.stringify(m.signature)}`),
    ]);

    if (!S.productSignatures.delivered) {
      // Not a skip. A skip is silence, and silence over a missing signature is
      // exactly how v15 shipped.
      P.report(`PENDING [${LANG}] the product path delivers no signatures`, [
        S.productSignatures.pending,
        `measured now: ${callable.length - bare.length}/${callable.length} callable members carry one`,
      ]);
      return;
    }
    assert.ok(
      callable.length > 0,
      `the product's membersOfType(${S.typeName}) returned no callable member at all on ${LANG}, ` +
      'so there is nothing whose signature could be asserted',
    );
    assert.deepStrictEqual(
      bare.map((m) => m.name), [],
      `the product's membersOfType(${S.typeName}) returned ${bare.map((m) => m.name).join(', ')} with no signature on ` +
      `${LANG}. specs.js declares this row delivers them. A member with a name and no argument list is half the ` +
      'v15 defect: the injected block names a callable it cannot show you how to call.',
    );

    // Everything above grades PRESENCE. A signature can be present and still be
    // about the wrong symbol, or carry the server's UI chrome, or state an
    // arity the caller must not supply. The model believes whatever this block
    // says, so from here the rendered TEXT is what is graded, through the same
    // `renderMemberSignatures` the injector calls. Rendering one member at a
    // time is what pairs each line back to the member that produced it; the
    // injector's own render is that same map with the empties dropped.
    const rendered = r.value.members
      .map((m) => ({ member: m, line: renderMemberSignatures([m]).trim() }))
      .filter((x) => x.line.length > 0);
    P.report('the block as the model reads it', rendered.map((x) => x.line));
    assert.ok(
      rendered.length > 0,
      `renderMemberSignatures dropped every member of \`${S.typeName}\` on ${LANG}, so the injected block is empty`,
    );

    const unnamed = rendered
      .filter((x) => !x.line.includes(P.bareName(x.member.name)))
      .map((x) => `${x.member.name} -> ${JSON.stringify(x.line)}`);
    assert.deepStrictEqual(
      unnamed, [],
      `on ${LANG} a rendered line does not name the member it was built from: ${unnamed.join(' ; ')}. ` +
      'A signature about some other symbol is worse than no signature, because the block is read as fact.',
    );

    const chromed = [];
    for (const x of rendered) {
      for (const c of SIGNATURE_CHROME) {
        if (x.line.includes(c.text)) chromed.push(`${JSON.stringify(x.line)} carries ${JSON.stringify(c.text)} (${c.reason})`);
      }
    }
    assert.deepStrictEqual(
      chromed, [],
      `on ${LANG} the injected block leaks language-server UI chrome: ${chromed.join(' ; ')}. ` +
      'The model imitates this text, and none of these spellings are the language.',
    );

    const qualified = rendered
      .filter((x) => x.line.includes(`${S.typeName}.`) && !S.selfQualified.includes(P.bareName(x.member.name)))
      .map((x) => `${x.member.name} -> ${JSON.stringify(x.line)}`);
    assert.deepStrictEqual(
      qualified, [],
      `on ${LANG} the injected block qualifies an instance member with its own type: ${qualified.join(' ; ')}. ` +
      `\`${S.typeName}.x\` is not a name that can be typed at a receiver site, and specs.js declares this member ` +
      'is not static.',
    );

    // PROVENANCE. Everything above can pass over a line that describes a
    // DIFFERENT symbol: `band` rendered as `band: number` is correctly named,
    // chrome-free, unqualified and correctly arity'd, and states the wrong type
    // for a real member. The product's own guard only requires the member name
    // to appear as a whole token, so a hover taken at a position the code chose
    // can substitute another symbol's declaration and pass every axis.
    //
    // The independent reading is the type's OWN SOURCE. Each member's
    // declaration head is its contract text on disk, and a rendered line built
    // from that member cannot name an identifier its declaration does not.
    //
    // The HEAD, not the whole documentSymbol range: a method's range covers its
    // body, and grading against the body admitted every identifier the body
    // happened to use. `constructor Tile(mortonCode: MAX_LOD, lod: Math): Tile`
    // passed both this axis and the arity axis on real ts-scratch source, which
    // is an oracle grading the wrong text rather than a weak one.
    const defDoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(r.value.def.uri));
    const declaredAt = new Map();
    for (const node of P.typeNodes((await P.settled(() => P.symbols(defDoc.uri))).value || [], S.typeName)) {
      for (const child of node.children || []) {
        const key = P.bareName(child.name);
        const head = P.declarationHead(defDoc, child);
        if (head !== undefined && !declaredAt.has(key)) declaredAt.set(key, head);
      }
    }
    P.report(`\`${S.typeName}\`'s own declarations in ${r.value.def.uri.split('/').pop()}`, [
      `${declaredAt.size} member declarations read from source: ${[...declaredAt.keys()].join(', ') || '(none)'}`,
    ]);
    assert.ok(
      declaredAt.size > 0,
      `no declaration text could be read for any member of \`${S.typeName}\` on ${LANG}, so provenance is ungraded. ` +
      'The tier would report a clean run over a block it never checked.',
    );

    const foreign = rendered
      .filter((x) => !declaredAt.has(P.bareName(x.member.name)))
      .map((x) => `${x.member.name} -> ${JSON.stringify(x.line)}`);
    assert.deepStrictEqual(
      foreign, [],
      `on ${LANG} the injected block names ${foreign.join(' ; ')} under a \`${S.typeName}\` header, and no such ` +
      `member is declared in ${S.typeName}'s own source. Declared: ${[...declaredAt.keys()].join(', ')}. ` +
      'That is the v15 defect exactly: a real-looking surface belonging to some other container.',
    );

    // The member's own name and the type's name are always admissible: a
    // renderer may anchor a constructor line as `constructor Tile(...)` where the
    // declaration says only `constructor`. Anything else must come from the
    // declaration.
    //
    // A declaration that names nothing but the member itself is UNGRADED, not
    // passed. Python's `self._morton_code = morton_code` gives that attribute a
    // documentSymbol range covering the bare name, and the server infers `int`
    // from elsewhere; the source states no type, so it can neither confirm nor
    // contradict one. Counting those as clean would let the whole axis go quiet
    // on a language whose members are mostly inferred, so they are reported.
    const identifiers = (s) => s.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    const straysIn = (line, bare, source) => {
      const allowed = new Set([bare, S.typeName, ...(S.provenanceAllow || [])]);
      const fromSource = new Set(identifiers(source));
      return identifiers(line).filter((t) => !allowed.has(t) && !fromSource.has(t));
    };
    const invented = [];
    const ungraded = [];
    for (const x of rendered) {
      const bare = P.bareName(x.member.name);
      const source = declaredAt.get(bare);
      if (identifiers(source).every((t) => t === bare)) {
        ungraded.push(`${x.member.name} (declared as ${JSON.stringify(source.trim())})`);
        continue;
      }
      const strays = straysIn(x.line, bare, source);
      if (strays.length) {
        invented.push(`${x.member.name} -> ${JSON.stringify(x.line)} names ${strays.join(', ')}, absent from ${JSON.stringify(source.split('\n')[0].trim())}`);
      }
    }
    P.report('provenance against the type\'s own source', [
      `graded: ${rendered.length - ungraded.length} of ${rendered.length} rendered lines`,
      `UNGRADED (declaration names no type of its own): ${ungraded.join(' ; ') || '(none)'}`,
    ]);
    assert.deepStrictEqual(
      invented, [],
      `on ${LANG} a rendered line states something the member's own declaration does not say: ${invented.join(' ; ')}. ` +
      'The block is read by the model as this member\'s declaration, so a type or parameter that appears here and ' +
      'not in the source is a statement about a different symbol.',
    );
    assert.ok(
      ungraded.length < rendered.length,
      `on ${LANG} every one of the ${rendered.length} rendered lines is ungraded for provenance, so this axis ` +
      'measured nothing at all on this row.',
    );

    // The grader, graded. Every assertion above reports a clean row when it is
    // reading the wrong text, which is exactly what happened while provenance
    // read the method BODY. specs.js declares a fabricated line built from
    // identifiers the body mentions and the declaration does not, beside the
    // true line, both against this repo's own source. The pair fails in both
    // directions: a grader reading too much text accepts the fabrication, and
    // one reading too little rejects the truth.
    const fab = S.provenanceFabrication;
    if (fab) {
      const source = declaredAt.get(fab.member);
      assert.ok(source, `provenanceFabrication names \`${fab.member}\`, which has no declaration head on ${LANG}`);
      const onRefused = straysIn(fab.refused, fab.member, source);
      const onAccepted = straysIn(fab.accepted, fab.member, source);
      P.report('provenance grading its own fabricated line', [
        `graded against: ${JSON.stringify(source.trim())}`,
        `refuses ${JSON.stringify(fab.refused)} -> ${onRefused.join(', ') || '(nothing, WRONG)'}`,
        `accepts ${JSON.stringify(fab.accepted)} -> ${onAccepted.join(', ') || '(nothing)'}`,
      ]);
      assert.ok(
        onRefused.length > 0,
        `on ${LANG} provenance accepts ${JSON.stringify(fab.refused)} against ${JSON.stringify(source.trim())}. ` +
        'The graded text is wider than the declaration, so identifiers from elsewhere in the source pass as ' +
        'parameter types and the axis reports clean over a fabricated signature.',
      );
      assert.deepStrictEqual(
        onAccepted, [],
        `on ${LANG} provenance refuses the TRUE line ${JSON.stringify(fab.accepted)} against ` +
        `${JSON.stringify(source.trim())}, naming ${onAccepted.join(', ')}. The graded text is narrower than the ` +
        'declaration, so the axis now fails correct signatures.',
      );
    }

    // The whole argument-type feature exists so the model writes `Tile(1, 0)`
    // and not `Tile(1)`. Exactly one member can say that, and it has to both be
    // in the block and state the right number. A row with NO construction
    // claim (Go: the builder is package-level, outside the ratified join
    // contract) skips the axis loudly instead of grading a line that cannot
    // exist.
    if (!S.construction) {
      P.report('construction axis skipped', [`${LANG} declares no construction member (see specs.js row comment)`]);
      return this.skip();
    }
    const built = rendered.find((x) => P.bareName(x.member.name) === S.construction.member);
    assert.ok(
      built,
      `on ${LANG} the injected block for \`${S.typeName}\` has no \`${S.construction.member}\` line, so it cannot ` +
      `state how to build a ${S.typeName}. Rendered: ${rendered.map((x) => x.line).join(' | ') || '(nothing)'}`,
    );
    assert.strictEqual(
      paramCount(built.line), S.construction.arity,
      `on ${LANG} the construction line ${JSON.stringify(built.line)} states ${paramCount(built.line)} arguments, ` +
      `but \`${S.typeName}\` takes ${S.construction.arity}. A block under a "to build a ${S.typeName}" header that ` +
      'states the wrong arity is the v15 defect with a signature attached.',
    );
  });
});
