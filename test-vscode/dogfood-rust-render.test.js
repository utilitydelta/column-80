// The Rust injection block as the MODEL receives it.
//
// Provenance: a dogfood session on rust-scratch, 2026-07-20. The user typed at
// `let _ = s.` on a `Stripe` receiver and the extension injected this:
//
//   // available here (use one of these exact names, do not invent):
//   // into()(self) -> T
//   // aggregate_fanout()(&self) -> u32
//   // enroll_tile(…)(&mut self, Tile)
//   // partition_by_lod()(&self) -> HashMap<u8, Vec<&Tile, Global>, RandomState, Global>
//   // rehome_by_lod(…)(&mut self, HashMap<u8, Vec<Tile, Global>, RandomState, Global>) -> u32
//   // try_into()(self) -> Result<T, <Self as TryInto<T>>::Error>
//   // type_id()(&self) -> TypeId
//
// The FIM model then wrote `s.into()`, and on the next attempt
// `s.aggregate_fanout()`. Those are items #1 and #2 of that list. The model did
// exactly what the header told it to do; the list was wrong at the top.
//
// Why this file exists rather than an entry in `specs.js`'s `knownLeaks`:
// `into`, `try_into` and `type_id` ARE declared there today, with the reasoning
// that member-list noise is "tracked as its own work" and that asserting on it
// "would make this tier red for a defect it was not built to report". That was
// a fair call while the noise was believed cosmetic. The dogfood run refutes it.
// A name the model picks first is not cosmetic, so this row grades it.
//
// The axis is the RENDERED TEXT, not member presence. v16's lesson was that an
// oracle can sit on exactly the right area and the wrong axis: the tier asserted
// signatures were PRESENT while the rendered block was wrong in two languages.
// Every assertion below reads the string the model would have read.

'use strict';

const assert = require('assert');
const P = require('./helpers/probe');
const { SPECS } = require('./helpers/specs');
const { extractorFor, renderFimCandidates } = require('./.build/product');

const LANG = P.LANG;
const S = SPECS[LANG];

// Blanket impls every Rust type grows from `Into`, `TryInto` and `Any`. They are
// never the member a user reached for at a `.` site, and rust-analyzer returns
// them ahead of the type's own methods.
const BLANKET_IMPLS = ['into', 'try_into', 'type_id'];

// Generic parameters rust-analyzer prints that the source never wrote. They are
// defaults (`HashMap`'s hasher and both allocators), so they carry no
// information and they cost the reader the part that does. In the dogfood run
// they hid a real mismatch: `partition_by_lod` returns `Vec<&Tile>` while
// `rehome_by_lod` takes `Vec<Tile>`, and both repair rounds failed to bridge it.
const HIDDEN_DEFAULTS = ['Global', 'RandomState'];

// The dogfood site itself: a bare `s.` on a `Stripe`, in the function the user
// was editing. Written here rather than in `specs.js` because it is a
// reproduction of one report, not a shared fixture the other rows read.
const DOT_SITE = {
  file: 'crates/playground/src/fim.rs',
  anchor: 'let by_lod = HashMap::new();',
  insert: '\n    let _ = s.',
};

suite(`dogfood: the rust injection block as the model reads it [${LANG}]`, function () {
  this.timeout(120000);

  let block;

  suiteSetup(async function () {
    // rust-analyzer specific: the blanket impls, the label/detail overlap and
    // the printed defaults are all rust-analyzer's rendering. C# has the same
    // CLASS of leak (`Equals`, `GetHashCode`, `GetType`, `ToString`) and is not
    // graded here, because no dogfood run has shown a model picking one.
    if (LANG !== 'rust') this.skip();

    // A BARE `s.` with nothing after it, inserted, exactly as the dogfood user
    // typed it. Probing the existing `s.enroll_tile` call instead does not
    // reproduce: rust-analyzer renders a completion label WITHOUT call parens
    // when an identifier already follows the dot, and WITH them
    // (`enroll_tile(…)`) when it is completing into empty space. The first
    // version of this file probed the existing call, and the doubled-paren row
    // passed while the user's editor was plainly showing the defect. Site
    // choice was the difference, not configuration.
    const extractor = extractorFor(S.languageId);
    await P.withInsertion(S, DOT_SITE, async (doc, base) => {
      const pos = doc.positionAt(base + DOT_SITE.insert.length);
      const cursor = { uri: doc.uri.toString(), line: pos.line, character: pos.character };

      // Settle rather than sample once: a cold rust-analyzer answers an empty
      // set first and this row would then grade nothing and pass.
      const { value: members } = await P.settled(() => extractor.completeMembers(cursor));
      assert.ok(
        members && members.length > 0,
        'rust-analyzer returned no members for the `Stripe` receiver, so there is no block to grade. ' +
        'That is an instrument failure, not a product verdict.',
      );

      block = renderFimCandidates(members, '', '//');
      assert.ok(
        typeof block === 'string' && block.length > 0,
        'the receiver rendered no block at all, so this row cannot grade its text.',
      );
      P.report('the block the model reads at a bare `s.`', block.split('\n'));
    });
  });

  test('no blanket-impl method reaches the block', function () {
    // Matched as a whole rendered name, so a real member whose name merely
    // CONTAINS one of these is not falsely accused.
    const present = BLANKET_IMPLS.filter((n) => new RegExp(`^//\\s*${n}\\s*\\(`, 'm').test(block));
    assert.deepStrictEqual(
      present, [],
      `the block offers ${present.join(', ')} on \`Stripe\`. These are blanket impls from Into/TryInto/Any, ` +
      'not members of the type the user reached for. The header tells the model to use one of these exact ' +
      'names, and in the dogfood run of 2026-07-20 it picked `into` first and `aggregate_fanout` second, ' +
      'because they were rendered first and second.',
    );
  });

  test('every rendered signature carries exactly one parameter list', function () {
    // rust-analyzer's completion LABEL already carries the call parens
    // (`enroll_tile(…)`, `aggregate_fanout()`) and its `detail` carries the
    // real parameter list (`(&mut self, Tile)`). Concatenating them yields
    // `enroll_tile(…)(&mut self, Tile)`, which is not a signature any Rust
    // parser or model would accept.
    const doubled = block.split('\n').filter((l) => /\)\s*\(/.test(l));
    assert.deepStrictEqual(
      doubled, [],
      `${doubled.length} rendered signature(s) carry two parameter lists:\n${doubled.join('\n')}\n` +
      "rust-analyzer's completion label already includes the call parens, so appending `detail` doubles " +
      'them. The model is being handed signatures that do not parse.',
    );
  });

  test('no generic default the source never wrote reaches the block', function () {
    const noisy = block
      .split('\n')
      .filter((l) => HIDDEN_DEFAULTS.some((d) => new RegExp(`\\b${d}\\b`).test(l)));
    assert.deepStrictEqual(
      noisy, [],
      `${noisy.length} rendered signature(s) print generic defaults the source never wrote:\n${noisy.join('\n')}\n` +
      'These are `HashMap`\'s default hasher and the global allocator. They carry no information and they ' +
      'bury the part that does: in the dogfood run they obscured that `partition_by_lod` returns ' +
      '`Vec<&Tile>` while `rehome_by_lod` takes `Vec<Tile>`, and both repair rounds burned on that mismatch.',
    );
  });
});
