// session-v75: the gate rig's own host. Loads ONLY `v75-gate.test.js`.
//
// The workspace is the private Rust corpus the dictation items were harvested
// from, so the junk names a talkative proposer offers really exist there and
// the existence gate faces the hard case. Its path is an ENVIRONMENT VARIABLE
// with no default: it is a client repo, it is never named in this repo, and a
// run without it should fail loudly rather than quietly grade a playground.
//
// Run:
//   npm run build
//   C80_RUST_CORPUS=<the corpus> C80_GATE_REPLIES=$PWD/session-v75/rig/logs \
//     C80_GATE_OUT=$PWD/session-v75/rig/logs DISPLAY=:1 \
//     npx vscode-test --config test-vscode/v75gate.vscode-test.mjs --label v75gate
//
// rust-analyzer has to finish loading 22 crates before the first row means
// anything, so the suite blocks on a symbol probe rather than on a sleep, and
// the mocha timeout is sized for the whole population after it.

import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const workspace = process.env.C80_RUST_CORPUS;
if (!workspace) {
  throw new Error('C80_RUST_CORPUS must point at the Rust corpus the dictation items were harvested from');
}

export default defineConfig([
  {
    extensionDevelopmentPath: repoRoot,
    files: 'v75-gate.test.js',
    mocha: { ui: 'tdd', timeout: 7200000, slow: 60000 },
    label: 'v75gate',
    workspaceFolder: workspace,
    installExtensions: ['rust-lang.rust-analyzer'],
    env: {
      C80_LANG: 'rust',
      C80_GATE_REPLIES: process.env.C80_GATE_REPLIES ?? path.join(repoRoot, 'session-v75', 'rig', 'logs'),
      C80_GATE_OUT: process.env.C80_GATE_OUT ?? path.join(repoRoot, 'session-v75', 'rig', 'logs'),
      ...(process.env.C80_GATE_ARMS ? { C80_GATE_ARMS: process.env.C80_GATE_ARMS } : {}),
      ...(process.env.C80_GATE_POPULATIONS ? { C80_GATE_POPULATIONS: process.env.C80_GATE_POPULATIONS } : {}),
      ...(process.env.C80_GATE_LIMIT ? { C80_GATE_LIMIT: process.env.C80_GATE_LIMIT } : {}),
      ...(process.env.C80_GATE_TAG ? { C80_GATE_TAG: process.env.C80_GATE_TAG } : {}),
      ...(process.env.C80_GATE_IN_TAG ? { C80_GATE_IN_TAG: process.env.C80_GATE_IN_TAG } : {}),
      ...(process.env.C80_GATE_TARGET ? { C80_GATE_TARGET: process.env.C80_GATE_TARGET } : {}),
      // No default here either: the probe names a symbol of a client repo.
      C80_GATE_PROBE: process.env.C80_GATE_PROBE ?? '',
    },
  },
]);
