// session-v65: the dictate-then-FIM gesture, end to end, in a real extension host.
//
// Loads ONLY the dictation file. The microphone is a fixture (helpers/fake-mic.cjs) reached
// through COLUMN80_NATIVE_DIR, which the test builds as a temp dir holding the fake under the
// capture binary's name and a link to the REAL whisper-server. The recogniser and the FIM
// model are real; nothing about the transcript or the ghost is faked.
//
// Needs: `npm run native:build` done, ollama up with qwen2.5-coder:1.5b-base, the speech model
// at $COLUMN80_WHISPER_MODEL (defaults below to the session's downloaded copy), and a focused
// display. Run, one label at a time:
//   npm run build
//   DISPLAY=:1 npx vscode-test --config test-vscode/v65dictate.vscode-test.mjs --label rust
//   DISPLAY=:1 npx vscode-test --config test-vscode/v65dictate.vscode-test.mjs --label ts
//   DISPLAY=:1 npx vscode-test --config test-vscode/v65dictate.vscode-test.mjs --label python
//   DISPLAY=:1 npx vscode-test --config test-vscode/v65dictate.vscode-test.mjs --label csharp
//   DISPLAY=:1 npx vscode-test --config test-vscode/v65dictate.vscode-test.mjs --label go
import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const base = {
  extensionDevelopmentPath: repoRoot,
  files: 'v65-dictate.test.js',
  mocha: { ui: 'tdd', timeout: 600000, slow: 30000 },
};

const scratch = process.env.C80_SCRATCH ?? path.join(os.tmpdir(), 'c80-v65');
// The fake microphone dir is built HERE, before the host launches, because the extension
// starts its recogniser at activation and a binary that appears later would cost the first
// press a refusal.
const nativeDir = path.join(scratch, 'native');
fs.mkdirSync(nativeDir, { recursive: true });
fs.copyFileSync(path.join(here, 'helpers', 'fake-mic.cjs'), path.join(nativeDir, 'column80-capture'));
fs.chmodSync(path.join(nativeDir, 'column80-capture'), 0o755);
const realServer = path.join(repoRoot, 'native', 'bin', `${process.platform}-${process.arch}`, 'whisper-server');
try { fs.unlinkSync(path.join(nativeDir, 'whisper-server')); } catch {}
if (fs.existsSync(realServer)) fs.symlinkSync(realServer, path.join(nativeDir, 'whisper-server'));
try { fs.unlinkSync(path.join(scratch, 'channel.log')); } catch {}

// The dev box keeps the two speech models here; CI has none and the rows skip.
const speechDir = path.join(os.homedir(), '.cache', 'column80', 'speech');
const env = {
  C80_LOG_FILE: process.env.C80_LOG_FILE ?? path.join(scratch, 'channel.log'),
  COLUMN80_NATIVE_DIR: nativeDir,
  COLUMN80_WHISPER_MODEL: process.env.COLUMN80_WHISPER_MODEL ?? path.join(speechDir, 'ggml-base.en.bin'),
  COLUMN80_VAD_MODEL: process.env.COLUMN80_VAD_MODEL ?? path.join(speechDir, 'ggml-silero-v5.1.2.bin'),
  C80_SCRATCH: scratch,
};

const rows = [
  { label: 'rust', workspaceFolder: '/home/utilitydelta/repos/rust-scratch', installExtensions: ['rust-lang.rust-analyzer'], lang: 'rust' },
  { label: 'ts', workspaceFolder: '/home/utilitydelta/repos/ts-scratch', installExtensions: [], lang: 'ts' },
  { label: 'python', workspaceFolder: '/home/utilitydelta/repos/python-scratch', installExtensions: ['ms-python.python', 'ms-python.vscode-pylance'], lang: 'python' },
  { label: 'csharp', workspaceFolder: '/home/utilitydelta/repos/csharp-scratch', installExtensions: ['ms-dotnettools.csharp'], lang: 'csharp' },
  { label: 'go', workspaceFolder: '/home/utilitydelta/repos/go-scratch', installExtensions: ['golang.go'], lang: 'go' },
];

export default defineConfig(rows.map((r) => ({
  ...base,
  label: r.label,
  workspaceFolder: r.workspaceFolder,
  installExtensions: r.installExtensions,
  env: { ...env, C80_LANG: r.lang },
})));
