// Harness for the product-transport contract tier.
//
// Two jobs. First, get a real language server to a SETTLED answer: servers here
// answer provisionally while they index, so a first non-empty response proves
// nothing. `settled` keeps sampling after the first hit and only returns once
// the shape stops changing. Second, present a vscode payload as plain data the
// assertions can read, without a serialization step - `JSON.stringify` on a
// documentSymbol drops `children` and `detail`, which are the two fields the
// whole contract rests on.

'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const POLL_MS = 1000;
const SETTLE_GAP_MS = 1500;

// An absent server must report in seconds, not minutes. The ready-poll below is
// the only unbounded wait in the tier, and at the 180s it used to default to a
// row with no language server took forty minutes to admit it. Every healthy row
// answers inside two seconds, so this is slack, not a deadline.
const READY_TIMEOUT_MS = 8000;

function uriOf(spec, rel) {
  return vscode.Uri.file(path.join(spec.repo, rel));
}

async function open(spec, rel) {
  const uri = uriOf(spec, rel);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  return doc;
}

// Locate a cursor by text rather than by line/column, so the coordinate cannot
// rot into pointing at a different token than the one the test names.
function cursorAt(doc, site) {
  const text = doc.getText();
  const idx = text.indexOf(site.needle);
  if (idx < 0) throw new Error(`needle not found in ${doc.uri.fsPath}: ${JSON.stringify(site.needle)}`);
  return doc.positionAt(idx + site.at);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Distinct from every key `keyOf` can produce, which are strings.
const NEVER_EQUAL = Symbol('unsettled');

// Poll until `ready`, then keep sampling until `key` repeats. Returns
// { value, ms, settled, samples } and NEVER throws on a timeout - "the server
// never answered" is a skip decision for the caller, not a contract failure.
async function settled(call, { ready, key, timeoutMs = READY_TIMEOUT_MS } = {}) {
  const isReady = ready || ((v) => Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null);
  const keyOf = key || ((v) => JSON.stringify(shapeKey(v)));
  const started = Date.now();
  let value;
  while (Date.now() - started < timeoutMs) {
    value = await call();
    if (isReady(value)) break;
    await sleep(POLL_MS);
  }
  if (!isReady(value)) return { value, ms: Date.now() - started, settled: false, samples: 0 };

  let last = keyOf(value);
  let samples = 1;
  for (let i = 0; i < 12; i++) {
    await sleep(SETTLE_GAP_MS);
    const next = await call();
    samples++;
    if (!isReady(next)) {
      // A server that flaps ready/absent/ready has not stabilised. Forgetting
      // the last key stops the two ready samples either side of the gap from
      // being read as consecutive.
      last = NEVER_EQUAL;
      continue;
    }
    const k = keyOf(next);
    value = next;
    if (k === last) return { value, ms: Date.now() - started, settled: true, samples };
    last = k;
  }
  return { value, ms: Date.now() - started, settled: false, samples };
}

function shapeKey(v) {
  if (Array.isArray(v)) return v.map(shapeKey);
  if (v && typeof v === 'object') {
    if (Array.isArray(v.items)) return v.items.map(shapeKey);
    const out = {};
    if (v.name !== undefined) out.n = String(v.name);
    if (v.label !== undefined) out.n = typeof v.label === 'string' ? v.label : String(v.label.label);
    if (v.detail !== undefined) out.d = String(v.detail);
    if (Array.isArray(v.children)) out.c = v.children.map(shapeKey);
    return out;
  }
  return String(v);
}

// --- vscode command wrappers -------------------------------------------------

// The resolve count is an argument of the completion and code-action commands,
// and the product always passes one. A probe that omits it asks the server not
// to resolve, gets an item with no edit and no detail, and reports that as a
// product defect. So the caps come from the transports themselves: rename or
// retune ACTION_RESOLVE_CAP and the tier fails loudly instead of measuring a
// number the product stopped using.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TRANSPORTS = ['src/vscode/csExtractor.ts', 'src/vscode/tsExtractor.ts', 'src/vscode/pyExtractor.ts'];

// `test-vscode/.build/product.js` is the product code this tier grades, and
// only `npm run build` refreshes it. `vscode-test` does not, so a bare
// invocation grades whatever src/ looked like the last time someone built, and
// passes. Absence would be loud; staleness is silent, which makes it the worse
// failure. This runs at require time, before any test, and throws.
const BUNDLE = path.join(__dirname, '..', '.build', 'product.js');

function newestUnder(dir) {
  let newest = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const at = e.isDirectory() ? newestUnder(full) : fs.statSync(full).mtimeMs;
    if (at > newest) newest = at;
  }
  return newest;
}

function assertBundleFresh() {
  if (!fs.existsSync(BUNDLE)) {
    throw new Error(`${BUNDLE} does not exist. The tier has no product bundle to grade. Run \`npm run build\`.`);
  }
  const built = fs.statSync(BUNDLE).mtimeMs;
  const newestSrc = newestUnder(path.join(REPO_ROOT, 'src'));
  if (newestSrc > built) {
    throw new Error(
      'the product bundle test-vscode/.build/product.js is STALE: src/ changed at '
      + `${new Date(newestSrc).toISOString()}, the bundle was built at ${new Date(built).toISOString()}. `
      + 'Every product-row result would grade dead code and pass. Run `npm run build`, '
      + 'or use `npm run test:vscode`, which chains it.',
    );
  }
}

assertBundleFresh();

function productCap(name) {
  const found = TRANSPORTS.map((rel) => {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const m = new RegExp(`^const ${name} = (\\d+);`, 'm').exec(src);
    if (!m) throw new Error(`${name} is not declared in ${rel}; the tier's resolve caps are stale`);
    return Number(m[1]);
  });
  const agreed = new Set(found);
  if (agreed.size !== 1) {
    throw new Error(`the product transports disagree on ${name}: ${TRANSPORTS.map((r, i) => `${r}=${found[i]}`).join(', ')}`);
  }
  return found[0];
}

const MEMBER_RESOLVE_CAP = productCap('MEMBER_RESOLVE_CAP');
const ACTION_RESOLVE_CAP = productCap('ACTION_RESOLVE_CAP');

const symbols = (uri) => vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
const completions = (uri, pos, trigger, resolve = MEMBER_RESOLVE_CAP) =>
  vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, pos, trigger, resolve);
const definitions = (uri, pos) => vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, pos);
const hovers = (uri, pos) => vscode.commands.executeCommand('vscode.executeHoverProvider', uri, pos);
const wsSymbols = (query) => vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', query);
const codeActions = (uri, range, resolve = ACTION_RESOLVE_CAP) =>
  vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, range, undefined, resolve);

// --- symbol-tree reading -----------------------------------------------------

const symRange = (s) => s && (s.range || (s.location && s.location.range));

// The DECLARATION HEAD of a symbol: its range, cut at the first `{` that opens
// the body or at the end of the line the symbol's own name sits on, whichever
// comes first.
//
// Provenance grades a rendered signature against the member's source text, and
// a method's documentSymbol range spans its whole BODY. Every identifier the
// body happens to mention is then admissible as a parameter type, so a
// fabricated `constructor Tile(mortonCode: MAX_LOD, lod: Math): Tile` passes
// provenance and arity together purely because the constructor body uses
// `MAX_LOD` and `Math`. The head is the part of the range that states the
// contract; the body is not evidence about it.
//
// The cut is taken at or after the name so a return type written BEFORE the
// name survives - C# declares `public bool Encloses(Tile other)`, and starting
// at `selectionRange` would drop the `bool` the rendered line legitimately
// carries.
//
// `symRange` is left as it is: `chainAt` uses it for positional containment,
// where the full body range is the correct answer.
function declarationHead(doc, sym) {
  const range = symRange(sym);
  if (!range) return undefined;
  const text = doc.getText(range);
  const nameStart = sym.selectionRange
    ? doc.offsetAt(sym.selectionRange.start) - doc.offsetAt(range.start)
    : 0;
  const from = Math.max(0, nameStart);
  const cuts = [text.indexOf('{', from), text.indexOf('\n', from)].filter((i) => i >= 0);
  return cuts.length ? text.slice(0, Math.min(...cuts)) : text;
}

function contains(range, pos) {
  if (!range) return false;
  if (typeof range.contains === 'function') return range.contains(pos);
  const { start, end } = range;
  if (pos.line < start.line || pos.line > end.line) return false;
  if (pos.line === start.line && pos.character < start.character) return false;
  if (pos.line === end.line && pos.character > end.character) return false;
  return true;
}

// The chain of symbols whose ranges enclose `pos`, outermost first. The LAST
// entry is the innermost container, which is the identity the v15 defect got
// wrong: it descended from a cursor sitting inside `Fim`, not inside `Tile`.
function chainAt(syms, pos) {
  const chain = [];
  let level = syms || [];
  for (;;) {
    const hit = level.find((s) => contains(symRange(s), pos));
    if (!hit) return chain;
    chain.push(hit);
    level = Array.isArray(hit.children) ? hit.children : [];
    if (!level.length) return chain;
  }
}

// Every symbol in the tree carrying a given name, at any depth.
function findByName(syms, name, out = []) {
  for (const s of syms || []) {
    if (s.name === name) out.push(s);
    if (Array.isArray(s.children)) findByName(s.children, name, out);
  }
  return out;
}

// What `membersOfType` is contractually supposed to produce: the direct child
// symbols of a container, name plus signature.
const membersOf = (sym) =>
  (Array.isArray(sym && sym.children) ? sym.children : []).map((c) => ({
    name: c.name,
    detail: c.detail === undefined ? undefined : String(c.detail),
    kind: kindName(c.kind),
  }));

const KINDS = Object.keys(vscode.SymbolKind).filter((k) => isNaN(Number(k)));
const kindName = (k) => KINDS.find((n) => vscode.SymbolKind[n] === k) || String(k);

// --- completion reading ------------------------------------------------------

// documentSymbol names are not bare identifiers everywhere. TypeScript renders
// accessors as "(get) band", C# renders a property as "MortonCode : int" and a
// method as "Encloses(Tile) : bool", and workspace symbols arrive as
// "enrollTile()". Strip the decoration so an identity check compares
// identifiers to identifiers; the raw string stays in the reports.
const bareName = (n) =>
  String(n).replace(/^\((get|set)\)\s*/, '').replace(/\(.*$/, '').replace(/\s*:.*$/, '').trim();

// Every node that speaks for a type. Rust splits a type across a `Tile` struct
// node holding the fields and a sibling `impl Tile` node holding the methods,
// so "the members of Tile" is a union, not one node's children.
const CONTAINER_KINDS = ['Class', 'Struct', 'Interface', 'Enum', 'Object', 'Module'];
const typeNodes = (syms, name) => {
  const all = flatten(syms);
  const containers = all.filter((s) =>
    CONTAINER_KINDS.includes(kindName(s.kind)) &&
    bareName(String(s.name).replace(/^impl\s+/, '')) === name);
  // Go declares methods as TOP-LEVEL `(*Recv).Name` Method symbols, never as
  // children of their type. Fold the receiver's methods in as one synthetic
  // container (each child renamed to its bare member) so provenance grading
  // sees the type's whole surface — the same normalization the
  // `impl Recv` replace above does for Rust.
  const receiverMethods = all
    .map((s) => {
      const m = /^\(\s*\*?\s*([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\s*\)\.(.+)$/.exec(String(s.name));
      return m && m[1] === name && kindName(s.kind) === 'Method' ? { ...s, name: m[2] } : undefined;
    })
    .filter(Boolean);
  return receiverMethods.length > 0 ? [...containers, { children: receiverMethods }] : containers;
};

function flatten(syms, out = []) {
  for (const s of syms || []) {
    out.push(s);
    if (Array.isArray(s.children)) flatten(s.children, out);
  }
  return out;
}

// Apply a probe edit to a real dogfood file, run `fn`, then always revert.
// Nothing is ever saved: the servers see a dirty buffer, which is exactly what
// they see while a human types.
async function withInsertion(spec, ins, fn) {
  const doc = await open(spec, ins.file);
  // Full pristine text, not just the inserted range: a drive can COMMIT a
  // ghost (Tab) outside the probe's own insert, and the product's accept
  // path SAVES the buffer before its oracle check — so `files.revert` (the
  // old finally) would "restore" to a disk state the drive itself had just
  // polluted. Measured in session-v23: a half-committed multi-line ghost
  // (dangling `EnrollBatch([]atlas.Tile{`) reached disk this way, broke the
  // whole Go package, and darkened every later suite's type-level probes.
  const pristine = doc.getText();
  const wasDirty = doc.isDirty;
  const anchorIdx = pristine.indexOf(ins.anchor);
  if (anchorIdx < 0) throw new Error(`anchor not found in ${ins.file}: ${JSON.stringify(ins.anchor)}`);
  const base = anchorIdx + ins.anchor.length;
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, doc.positionAt(base), ins.insert);
  try {
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('applyEdit refused the probe edit');
    return await fn(doc, base);
  } finally {
    await vscode.window.showTextDocument(doc, { preview: false });
    if (doc.getText() !== pristine) {
      const restore = new vscode.WorkspaceEdit();
      restore.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), pristine);
      await vscode.workspace.applyEdit(restore);
      // Write the pristine bytes back only when a mid-drive save dirtied the
      // DISK; a buffer that was clean-on-disk throughout just reverts.
      if (!wasDirty) await doc.save();
    }
  }
}

const itemsOf = (list) => (list && Array.isArray(list.items) ? list.items : Array.isArray(list) ? list : []);

const labelOf = (it) => (typeof it.label === 'string' ? it.label : it.label && it.label.label) || '';

// Everything the editor exposes about one completion, flattened. The v15
// argument-type feature needs a PARAMETER TYPE from here; which field carries
// it is per-server, so the assertion looks across all of them rather than
// picking one and calling the rest folklore.
function textOf(it) {
  const bits = [labelOf(it)];
  if (it.label && typeof it.label === 'object') bits.push(it.label.detail || '', it.label.description || '');
  bits.push(it.detail || '');
  const d = it.documentation;
  if (typeof d === 'string') bits.push(d);
  else if (d && typeof d.value === 'string') bits.push(d.value);
  return bits.filter(Boolean).join(' | ');
}

// --- reporting ---------------------------------------------------------------

const LANG = process.env.C80_LANG;

function report(label, lines) {
  const body = (Array.isArray(lines) ? lines : [lines]).map((l) => `    ${l}`).join('\n');
  console.log(`\n  [OBSERVED ${LANG}] ${label}\n${body}`);
}

module.exports = {
  LANG, uriOf, open, cursorAt, settled, sleep, report,
  MEMBER_RESOLVE_CAP, ACTION_RESOLVE_CAP,
  symbols, completions, definitions, hovers, wsSymbols, codeActions,
  symRange, declarationHead, contains, chainAt, findByName, membersOf, kindName, bareName, typeNodes, withInsertion,
  itemsOf, labelOf, textOf,
};
