// session-v78 phase 2, falsifier 6, in a REAL extension host: the human's
// sketch comments survive Generate Function into the document after Accept.
//
// The human wrote this stub and ran Generate Function; the body did all four
// steps and all four comments were gone (session-v78/goal.md Part A):
//
//   fn main() {
//   // say hello world
//   // get two numbers from user
//   // use the add function to add the numbers together
//   // dump the output to console
//   }
//
// What is real here: rust-analyzer's symbol provider resolves the function, the
// product's own presenter opens the diff, the human's Accept splices it into the
// buffer. What is scripted: the model. A fake ollama on a loopback port answers
// every /api/generate with a body that does all four steps and DROPS all four
// comments, which is the reply that caused the defect. The row then reads the
// document, not the channel: the sketch must be in the function, in order.
//
// The fixture lives in crates/playground/src/bin/ so cargo and rust-analyzer
// treat it as a binary (a `fn main` belongs there) without editing any manifest.
// It is written, driven and DELETED; the four settings it needs are written to
// the test instance's GLOBAL settings and restored.
//
// Run:  npm run test:vscode -- --label rust --grep V78SKETCH
//       (headless: npm run test:vscode:ci -- --label rust --grep V78SKETCH)

'use strict';

const assert = require('assert');
const vscode = require('vscode');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { LANG, settled, symbols, report, sleep } = require('./helpers/probe');

const EXT_ID = 'utilitydelta.column-80';
const MODEL = 'fake-v78-sketch:30b';

const SKETCH = [
  '// say hello world',
  '// get two numbers from user',
  '// use the add function to add the numbers together',
  '// dump the output to console',
];

// Two helpers above main so the generated body compiles and the post-accept
// check has nothing to repair.
const FIXTURE_TEXT =
  '// Column 80 session-v78 host row. Written and deleted by the test.\n' +
  '\n' +
  'fn add(a: i64, b: i64) -> i64 {\n' +
  '    a + b\n' +
  '}\n' +
  '\n' +
  'fn read_number() -> i64 {\n' +
  '    2\n' +
  '}\n' +
  '\n' +
  'fn main() {\n' +
  SKETCH.join('\n') +
  '\n}\n';

const REPLY =
  '```rust\n' +
  'fn main() {\n' +
  '    println!("hello world");\n' +
  '    let a = read_number();\n' +
  '    let b = read_number();\n' +
  '    let sum = add(a, b);\n' +
  '    println!("{}", sum);\n' +
  '}\n' +
  '```';

function startFakeOllama() {
  const srv = { prompts: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: MODEL, model: MODEL }] }));
        return;
      }
      if (req.url === '/api/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '0.33.0' }));
        return;
      }
      if (req.url === '/api/generate') {
        srv.prompts.push(String(body.prompt ?? ''));
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write(JSON.stringify({ response: REPLY }) + '\n');
        res.write(JSON.stringify({ response: '', done: true, done_reason: 'stop' }) + '\n');
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      srv.apiBase = `http://127.0.0.1:${server.address().port}`;
      srv.close = () => new Promise((r) => server.close(r));
      resolve(srv);
    });
  });
}

// The lines of main's body, read off the document as it stands.
function mainBody(text) {
  const head = text.indexOf('fn main() {');
  if (head < 0) return undefined;
  const end = text.indexOf('\n}', head);
  return text.slice(head + 'fn main() {'.length, end).split('\n');
}

const SETTINGS = ['fnGenProvider', 'apiBase', 'fnGenModel', 'fnGenFallbackModel', 'enabled', 'repairEnabled'];

suite(`V78SKETCH the sketch survives Generate Function into the document [${LANG}]`, function () {
  let srv;
  let fileUri;
  let binDirCreated = false;
  let ready = false;
  const prior = {};

  suiteSetup(async function () {
    if (LANG !== 'rust') return;
    this.timeout(180000);
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'the tier must run rooted at a workspace folder');
    const binDir = path.join(folders[0].uri.fsPath, 'crates', 'playground', 'src', 'bin');
    binDirCreated = !fs.existsSync(binDir);
    fs.mkdirSync(binDir, { recursive: true });
    fileUri = vscode.Uri.file(path.join(binDir, 'c80_v78_sketch.rs'));
    fs.writeFileSync(fileUri.fsPath, FIXTURE_TEXT);

    srv = await startFakeOllama();
    const cfg = vscode.workspace.getConfiguration('column80');
    for (const k of SETTINGS) prior[k] = cfg.inspect(k)?.globalValue;
    // vscode-test keeps its user-data-dir between runs, and an earlier tier row
    // (v43/v44) can leave fnGenProvider=claude-code behind. Pin ollama so the
    // gesture reaches the fake and never spends a real CLI call.
    await cfg.update('fnGenProvider', 'ollama', vscode.ConfigurationTarget.Global);
    await cfg.update('apiBase', srv.apiBase, vscode.ConfigurationTarget.Global);
    await cfg.update('fnGenModel', MODEL, vscode.ConfigurationTarget.Global);
    await cfg.update('fnGenFallbackModel', MODEL, vscode.ConfigurationTarget.Global);
    // FIM off keeps per-keystroke requests away from the fake; repair off keeps
    // the post-accept check from spending a round on a body that compiles.
    await cfg.update('enabled', false, vscode.ConfigurationTarget.Global);
    await cfg.update('repairEnabled', false, vscode.ConfigurationTarget.Global);

    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
    await sleep(3000);

    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc, { preview: false });
    const tree = await settled(() => symbols(fileUri), {
      ready: (v) => Array.isArray(v) && JSON.stringify(v).includes('"main"'),
      timeoutMs: 60000,
    });
    ready = Array.isArray(tree.value) && JSON.stringify(tree.value).includes('"main"');
    report('V78SKETCH setup', [`fake ollama at ${srv.apiBase}`, `symbols settled=${tree.settled} ms=${tree.ms} ready=${ready}`]);
  });

  suiteTeardown(async function () {
    if (LANG !== 'rust') return;
    try {
      await vscode.commands.executeCommand('column80.proposalReject');
    } catch {}
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.isDirty && fileUri && doc.uri.toString() === fileUri.toString()) {
        try {
          await doc.save();
        } catch {}
      }
    }
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    } catch {}
    const cfg = vscode.workspace.getConfiguration('column80');
    for (const k of SETTINGS) {
      try {
        await cfg.update(k, prior[k], vscode.ConfigurationTarget.Global);
      } catch {}
    }
    if (fileUri) fs.rmSync(fileUri.fsPath, { force: true });
    if (binDirCreated && fileUri) fs.rmSync(path.dirname(fileUri.fsPath), { recursive: true, force: true });
    if (srv) await srv.close();
  });

  test('the human\'s four sketch lines are in main after Accept, in order, around the generated code', async function () {
    if (LANG !== 'rust' || !ready) return this.skip();
    this.timeout(180000);
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const at = doc.getText().indexOf(SKETCH[0]);
    editor.selection = new vscode.Selection(doc.positionAt(at), doc.positionAt(at));

    // Not awaited: the command waits on the preview's verdict.
    const running = vscode.commands.executeCommand('column80.generateFunction');
    Promise.resolve(running).catch(() => {});

    // Accept the preview the way a human does once it is open: the diff tab's
    // modified side is the proposal.
    const deadline = Date.now() + 120000;
    let landed = false;
    while (Date.now() < deadline) {
      if (doc.getText().includes('let sum = add(a, b);')) {
        landed = true;
        break;
      }
      if (srv.prompts.length > 0) {
        const diffTab = vscode.window.tabGroups.all
          .flatMap((g) => g.tabs)
          .find((t) => t.input instanceof vscode.TabInputTextDiff);
        try {
          if (diffTab) await vscode.commands.executeCommand('column80.proposalAccept', diffTab.input.modified);
        } catch {}
      }
      await sleep(500);
    }
    const text = doc.getText();
    report('V78SKETCH after accept', [`prompts=${srv.prompts.length}`, ...text.split('\n').map((l) => `  | ${l}`)]);
    assert.ok(srv.prompts.length > 0, 'the fake model was never asked; the gesture did not reach the transport');
    assert.ok(srv.prompts[0].includes('say hello world'), `the prompt must carry the sketch:\n${srv.prompts[0]}`);
    assert.ok(landed, `the generated body never landed in the document:\n${text}`);

    const body = mainBody(text);
    assert.ok(body, `main is gone from the document:\n${text}`);
    let cursor = -1;
    for (const s of SKETCH) {
      const i = body.findIndex((l, j) => j > cursor && l.trim() === s);
      assert.ok(i > cursor, `"${s}" is missing from main, or out of order, after Accept:\n${text}`);
      cursor = i;
    }
    for (const code of ['println!("hello world");', 'let sum = add(a, b);', 'println!("{}", sum);']) {
      assert.ok(body.some((l) => l.trim() === code), `the generated line "${code}" is missing:\n${text}`);
    }
  });
});
