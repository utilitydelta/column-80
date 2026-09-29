// session-v75 phase 7: the hero row, in a C# host with a real Roslyn.
//
// Same test file as the Rust gate rig; a different workspace, a different
// language and a population of two. The point is the DELTA gate, which the
// corpus run could not reach: the hero take runs Tighten Doc Comment after the
// dictation has written the three type names into the declaration, and a
// backtick for a type already in the pre-fill's surface is an eviction.
//
// Run:
//   npm run build
//   node session-v75/rig/hero-population.cjs
//   C80_HERO_APP=~/repos/demo-csharp-app DISPLAY=:1 \
//     npx vscode-test --config test-vscode/v75hero.vscode-test.mjs --label v75hero
//
// The target file is REWRITTEN by the run and restored in teardown. It is the
// demo app's own `Reordering.cs`, which starts as an empty static class, so the
// restore is exact.

import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const workspace = process.env.C80_HERO_APP;
if (!workspace) {
  throw new Error('C80_HERO_APP must point at the demo C# app that RECORDING.md describes');
}

export default defineConfig([
  {
    extensionDevelopmentPath: repoRoot,
    files: 'v75-gate.test.js',
    mocha: { ui: 'tdd', timeout: 1800000, slow: 60000 },
    label: 'v75hero',
    workspaceFolder: workspace,
    installExtensions: ['ms-dotnettools.csharp'],
    env: {
      C80_LANG: 'csharp',
      C80_GATE_LANG: 'csharp',
      C80_GATE_TARGET: 'Reordering.cs',
      C80_GATE_PROBE: 'StockLine',
      C80_GATE_ARMS: 'live',
      C80_GATE_POPULATIONS: 'hero',
      C80_GATE_IN_TAG: 'hero',
      C80_GATE_TAG: 'hero',
      C80_GATE_REPLIES: path.join(repoRoot, 'session-v75', 'rig', 'logs'),
      C80_GATE_OUT: path.join(repoRoot, 'session-v75', 'rig', 'logs'),
    },
  },
]);
