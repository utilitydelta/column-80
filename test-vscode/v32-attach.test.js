// session-v32 item 1 and item 4, against REAL language servers.
//
// The headless files encode what each server was MEASURED to do with a doc
// comment (scout finding 1: rust-analyzer includes it in `symbol.range`, the
// other four exclude it). Those fixtures are only as true as the day they were
// written, and the thing they model is not ours. This file asks the live server
// instead, and it grades the PRODUCT's own resolver rather than re-deriving a
// mapping beside it.
//
// Three questions per language:
//
//   A. Does a cursor in a function's doc comment resolve to that function?
//      Item 1's whole claim. Four of the five languages go from a REFUSAL to a
//      target and C# goes from the WRONG target to the right one, so the row
//      records what it got, not just pass/fail.
//   B. Does a cursor in a CLASS's own doc comment still resolve to the class?
//      The regression the attachment pass can cause.
//   C. Does the symbol's range END include a TRAILING comment at the end of the
//      body? MEASUREMENT ONLY, and it is the open question the adversarial
//      review left: if a server EXCLUDES it, a trailing `# TODO` sits outside
//      every function, and in Python (which has no closing brace to stop the
//      trivia walk) it can attach to the NEXT declaration. `REVIEW 5` in
//      test/review-v32-p1.test.cjs is red pending this number.
//
// Plus item 4: the block a cursor's symbol produces must START AT THE DOC
// COMMENT in all five languages, not only in the one whose server puts it inside
// the range.
//
// Fixtures are written into the dogfood repo, opened, measured, and DELETED. No
// dogfood repo carries a line for this file's benefit.
//
// Run:  npm run test:vscode -- --label python --grep V32ATTACH

'use strict';

const assert = require('assert');
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { SPECS } = require('./helpers/specs');
const { LANG, settled, symbols, report, bareName } = require('./helpers/probe');

const { resolveFunctionAtCursor, resolveBlockAtCursor } = require('./.build/product');

// probe's report() takes (label, lines); this file only ever has a label.
const note = (label) => report(label, []);

const spec = SPECS[LANG];

// One fixture per language, written as a fresh file so the geometry is exactly
// what this file describes. Each carries, in order: a documented top-level
// function, a documented container with a documented member, and a function
// whose body ENDS with a comment followed immediately by the next declaration.
const FIXTURES = {
  ts: {
    rel: 'src/c80_v32_attach_probe.ts',
    text: `/**
 * Fan out the stripe totals.
 */
export function v32TopLevel(): number {
  return 0;
}

/**
 * Audits stripe bands.
 */
export class V32Auditor {
  /**
   * Audit one band.
   */
  auditBand(): number {
    return 1;
  }
}

export function v32Trailing(): number {
  const total = 2;
  return total;
  // trailing note, deliberately the last line of the body
}

export function v32AfterTrailing(): number {
  return 3;
}
`,
    topLevel: 'v32TopLevel',
    container: 'V32Auditor',
    member: 'auditBand',
    trailing: 'v32Trailing',
    afterTrailing: 'v32AfterTrailing',
    docNeedle: ' * Fan out the stripe totals.',
    docFirstNeedle: '/**',
    containerDocNeedle: ' * Audits stripe bands.',
    memberDocNeedle: '   * Audit one band.',
    trailingNeedle: '  // trailing note, deliberately the last line of the body',
  },
  csharp: {
    rel: 'C80V32AttachProbe.cs',
    text: `namespace Playground;

public class V32Probe
{
    /// <summary>Fan out the stripe totals.</summary>
    public static int V32TopLevel()
    {
        return 0;
    }

    /// <summary>Audits stripe bands.</summary>
    public class V32Auditor
    {
        /// <summary>Audit one band.</summary>
        public int AuditBand()
        {
            return 1;
        }
    }

    public static int V32Trailing()
    {
        var total = 2;
        return total;
        // trailing note, deliberately the last line of the body
    }

    public static int V32AfterTrailing()
    {
        return 3;
    }
}
`,
    topLevel: 'V32TopLevel',
    container: 'V32Auditor',
    member: 'AuditBand',
    trailing: 'V32Trailing',
    afterTrailing: 'V32AfterTrailing',
    docNeedle: '/// <summary>Fan out the stripe totals.</summary>',
    containerDocNeedle: '/// <summary>Audits stripe bands.</summary>',
    memberDocNeedle: '/// <summary>Audit one band.</summary>',
    trailingNeedle: '        // trailing note, deliberately the last line of the body',
  },
  python: {
    rel: 'c80_v32_attach_probe.py',
    text: `# fan out the stripe totals
def v32_top_level() -> int:
    return 0


# audits stripe bands
class V32Auditor:
    # audit one band
    def audit_band(self) -> int:
        return 1


def v32_trailing() -> int:
    total = 2
    return total
    # trailing note, deliberately the last line of the body
def v32_after_trailing() -> int:
    return 3
`,
    topLevel: 'v32_top_level',
    container: 'V32Auditor',
    member: 'audit_band',
    trailing: 'v32_trailing',
    afterTrailing: 'v32_after_trailing',
    docNeedle: '# fan out the stripe totals',
    containerDocNeedle: '# audits stripe bands',
    memberDocNeedle: '    # audit one band',
    trailingNeedle: '    # trailing note, deliberately the last line of the body',
  },
  rust: {
    rel: 'src/c80_v32_attach_probe.rs',
    text: `/// Fan out the stripe totals.
pub fn v32_top_level() -> u32 {
    0
}

/// Audits stripe bands.
pub struct V32Auditor {
    /// The low band.
    pub lo: u32,
}

pub fn v32_trailing() -> u32 {
    let total = 2;
    total
    // trailing note, deliberately the last line of the body
}

pub fn v32_after_trailing() -> u32 {
    3
}
`,
    topLevel: 'v32_top_level',
    container: 'V32Auditor',
    member: undefined, // a struct field is never a resolution target
    trailing: 'v32_trailing',
    afterTrailing: 'v32_after_trailing',
    docNeedle: '/// Fan out the stripe totals.',
    containerDocNeedle: '/// Audits stripe bands.',
    memberDocNeedle: undefined,
    trailingNeedle: '    // trailing note, deliberately the last line of the body',
  },
  go: {
    rel: 'c80_v32_attach_probe.go',
    text: `package main

// v32TopLevel fans out the stripe totals.
func v32TopLevel() uint32 {
	return 0
}

// V32Auditor audits stripe bands.
type V32Auditor struct {
	Lo uint32
}

func v32Trailing() uint32 {
	total := uint32(2)
	return total
	// trailing note, deliberately the last line of the body
}

func v32AfterTrailing() uint32 {
	return 3
}
`,
    topLevel: 'v32TopLevel',
    container: 'V32Auditor',
    member: undefined,
    trailing: 'v32Trailing',
    afterTrailing: 'v32AfterTrailing',
    docNeedle: '// v32TopLevel fans out the stripe totals.',
    containerDocNeedle: '// V32Auditor audits stripe bands.',
    memberDocNeedle: undefined,
    trailingNeedle: '\t// trailing note, deliberately the last line of the body',
  },
};

const fixture = FIXTURES[LANG];

// The line holding `needle`, so nothing here is a hardcoded coordinate.
function lineOf(doc, needle) {
  const idx = doc.getText().indexOf(needle);
  assert.ok(idx >= 0, `needle not found in the probe fixture: ${JSON.stringify(needle)}`);
  return doc.positionAt(idx).line;
}

// A position on `needle`'s line, at its first non-whitespace character plus an
// offset, which is where a human's cursor actually sits.
function cursorOn(doc, needle, offset = 1) {
  const line = doc.lineAt(lineOf(doc, needle));
  return new vscode.Position(line.lineNumber, Math.min(line.firstNonWhitespaceCharacterIndex + offset, line.text.length));
}

let doc;
let uri;
let ready = false;

suite(`V32ATTACH doc-comment attachment against the live server [${LANG}]`, function () {
  suiteSetup(async function () {
    uri = vscode.Uri.file(path.join(spec.repo, fixture.rel));
    fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
    fs.writeFileSync(uri.fsPath, fixture.text);
    doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    // Servers answer provisionally while indexing, so wait for a settled tree
    // that actually contains the probe's own symbols.
    const tree = await settled(() => symbols(doc.uri), {
      ready: (v) => Array.isArray(v) && v.length > 0 && JSON.stringify(v).includes(fixture.topLevel),
      timeoutMs: LANG === 'csharp' ? 120000 : 30000,
    });
    ready = tree.settled === true || (Array.isArray(tree.value) && tree.value.length > 0);
    note(`[${LANG}] probe symbol tree settled=${tree.settled} ms=${tree.ms} top=${Array.isArray(tree.value) ? tree.value.length : 'none'}`);
  });

  suiteTeardown(async function () {
    // Never leave a file in a dogfood repo.
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    } catch {}
    fs.rmSync(uri.fsPath, { force: true });
  });

  test('A: a cursor in a top-level function\'s doc comment resolves to that function', async function () {
    if (!ready) return this.skip();
    const resolved = await resolveFunctionAtCursor(doc, cursorOn(doc, fixture.docNeedle), false);
    note(`[${LANG}] A doc-comment cursor -> ${resolved ? resolved.symbolName : 'REFUSED'}`);
    assert.strictEqual(
      resolved && bareName(resolved.symbolName),
      fixture.topLevel,
      `a cursor in ${fixture.topLevel}'s doc comment must resolve to it; got ${resolved ? resolved.symbolName : 'a refusal'}`,
    );
  });

  test('A2: a cursor in a MEMBER\'s doc comment resolves to the member, not its container', async function () {
    if (!ready || !fixture.memberDocNeedle) return this.skip();
    const resolved = await resolveFunctionAtCursor(doc, cursorOn(doc, fixture.memberDocNeedle), true);
    note(`[${LANG}] A2 member-doc cursor -> ${resolved ? resolved.symbolName : 'REFUSED'}`);
    assert.strictEqual(resolved && bareName(resolved.symbolName), fixture.member);
  });

  test('B: a cursor in a container\'s own doc comment still resolves to the container', async function () {
    if (!ready) return this.skip();
    const resolved = await resolveFunctionAtCursor(doc, cursorOn(doc, fixture.containerDocNeedle), true);
    note(`[${LANG}] B container-doc cursor -> ${resolved ? resolved.symbolName : 'REFUSED'}`);
    assert.strictEqual(
      resolved && bareName(resolved.symbolName),
      fixture.container,
      'the container doc comment must not resolve to a member',
    );
  });

  test('C MEASUREMENT: does the symbol range END include a trailing body comment?', async function () {
    if (!ready) return this.skip();
    const tree = await symbols(doc.uri);
    const flat = [];
    const walk = (list) => {
      for (const s of list ?? []) {
        flat.push(s);
        walk(s.children);
      }
    };
    walk(tree);
    const target = flat.find((s) => bareName(s.name) === fixture.trailing);
    assert.ok(target, `${fixture.trailing} missing from the settled tree`);
    const commentLine = lineOf(doc, fixture.trailingNeedle);
    const included = target.range.end.line >= commentLine;
    note(`[${LANG}] C trailing comment on L${commentLine}; ${fixture.trailing}.range = ` +
        `L${target.range.start.line}-L${target.range.end.line}; INCLUDED=${included}`,
    );
    // MEASUREMENT ONLY on the range itself. What is GRADED is the consequence:
    // wherever the range ends, a cursor on that trailing comment must not
    // resolve to the NEXT declaration. That is the shape review finding 6
    // named, and it is the answer that actually matters to a human pressing
    // repair.
    const resolved = await resolveFunctionAtCursor(doc, cursorOn(doc, fixture.trailingNeedle), false);
    note(`[${LANG}] C trailing-comment cursor -> ${resolved ? resolved.symbolName : 'REFUSED'}`);
    assert.notStrictEqual(
      resolved && bareName(resolved.symbolName),
      fixture.afterTrailing,
      `a comment at the END of ${fixture.trailing}'s body must never resolve to ${fixture.afterTrailing}`,
    );
  });

  test('item 4: the block for a documented symbol STARTS AT THE DOC COMMENT', async function () {
    if (!ready) return this.skip();
    // The FIRST line of the doc run, which for a JSDoc is the `/**` opener and
    // not the interior line the cursor needles point at.
    const docLine = lineOf(doc, fixture.docFirstNeedle ?? fixture.docNeedle);
    // The doc-comment cursor, so this row grades the attachment pass and the
    // block extent together, which is how a human meets them.
    const resolved = await resolveBlockAtCursor(doc, cursorOn(doc, fixture.docNeedle));
    assert.ok(resolved, 'the block gesture refused on a documented top-level function');
    note(`[${LANG}] item4 doc starts L${docLine}; block firstLine=L${resolved.firstLine}; ` +
        `symbol.range.start=L${resolved.symbol.range.start.line}`,
    );
    assert.strictEqual(
      resolved.firstLine,
      docLine,
      'the block must begin at the doc comment in every language, not only where the server puts it inside the range',
    );
  });
});
