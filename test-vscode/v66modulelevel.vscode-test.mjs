// session-v66: the module-level dictated ghost, the landing watch, and Escape, in a real
// extension host. The microphone AND the recogniser are fixtures here (helpers/fake-mic.cjs,
// helpers/fake-recogniser.cjs), so a row dictates any sentence it likes; the FIM model, the
// provider and the editor are real. The editor rule under test (an inline item that ends on an
// empty line is never drawn) is pinned by a probe row with no product code in the loop.
//
// Run, one label at a time, on the LATEST STABLE editor (vscode-test downloads it; nothing here pins
// a version, and neither does the base config, so "the tier's editor" moves with the day):
//   npm run build
//   DISPLAY=:1 npx vscode-test --config test-vscode/v66modulelevel.vscode-test.mjs --label ts
// On the editor installed on this box (whatever `code --version` says today):
//   C80_VSCODE=/usr/share/code/code DISPLAY=:1 npx vscode-test --config test-vscode/v66modulelevel.vscode-test.mjs --label ts
import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const scratch = process.env.C80_SCRATCH ?? path.join(os.tmpdir(), 'c80-v66');
const nativeDir = path.join(scratch, 'native');
fs.mkdirSync(nativeDir, { recursive: true });
// Wrappers rather than copies: the fakes need THIS node, and the host's PATH may not carry it.
for (const [name, script] of [['column80-capture', 'fake-mic.cjs'], ['whisper-server', 'fake-recogniser.cjs']]) {
  const target = path.join(nativeDir, name);
  fs.writeFileSync(target, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(here, 'helpers', script))} "$@"\n`);
  fs.chmodSync(target, 0o755);
}
const model = path.join(scratch, 'fake-model.bin');
fs.writeFileSync(model, 'not a model; the fake recogniser never reads it\n');
const textFile = path.join(scratch, 'heard.txt');
fs.writeFileSync(textFile, '');

const env = {
  C80_SCRATCH: scratch,
  C80_FAKE_TEXT_FILE: textFile,
  C80_FAKE_WAV: path.join(repoRoot, 'test', 'fixtures', 'dictation', 'threat-level-3s.wav'),
  COLUMN80_NATIVE_DIR: nativeDir,
  COLUMN80_WHISPER_MODEL: model,
  COLUMN80_VAD_MODEL: model,
};
const base = {
  extensionDevelopmentPath: repoRoot,
  files: 'v66-module-level.test.js',
  mocha: { ui: 'tdd', timeout: 600000, slow: 30000 },
  ...(process.env.C80_VSCODE ? { useInstallation: { fromPath: process.env.C80_VSCODE } } : {}),
};
const rows = [
  { label: 'ts', workspaceFolder: '/home/utilitydelta/repos/ts-scratch', installExtensions: [], lang: 'ts' },
  { label: 'rust', workspaceFolder: '/home/utilitydelta/repos/rust-scratch', installExtensions: ['rust-lang.rust-analyzer'], lang: 'rust' },
  { label: 'python', workspaceFolder: '/home/utilitydelta/repos/python-scratch', installExtensions: ['ms-python.python', 'ms-python.vscode-pylance'], lang: 'python' },
  { label: 'csharp', workspaceFolder: '/home/utilitydelta/repos/csharp-scratch', installExtensions: ['ms-dotnettools.csharp'], lang: 'csharp' },
  { label: 'go', workspaceFolder: '/home/utilitydelta/repos/go-scratch', installExtensions: ['golang.go'], lang: 'go' },
];
// One channel log per label, so a later label's run does not erase an earlier label's evidence.
export default defineConfig(rows.map((r) => ({ ...base, label: r.label, workspaceFolder: r.workspaceFolder, installExtensions: r.installExtensions, env: { ...env, C80_LANG: r.lang, C80_LOG_FILE: path.join(scratch, `channel-${r.lang}.log`) } })));
