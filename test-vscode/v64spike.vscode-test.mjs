// TEMPORARY: session-v64 phase-5 spike only. Points the outgoing-call probe at a
// REAL repository instead of a dogfood workspace. Loads ONLY the probe file, so
// nothing else in the tier runs and the shared config is not edited. Delete when
// the spike is written up.
import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

export default defineConfig([
  {
    extensionDevelopmentPath: repoRoot,
    files: 'v64-outgoing-probe.test.js',
    mocha: { ui: 'tdd', timeout: 900000, slow: 30000 },
    label: 'realrust',
    workspaceFolder: '/home/utilitydelta/work/celeriant/celeriant-db',
    installExtensions: ['rust-lang.rust-analyzer'],
    env: {
      C80_LANG: 'rust',
      C80_V64_TAG: 'real-rust',
      C80_V64_WS: '/home/utilitydelta/work/celeriant/celeriant-db',
      C80_V64_ROOTS: JSON.stringify([
        {
          id: 'warm_fs_metadata',
          file: 'celeriant/src/fs_warmup.rs',
          needle: 'pub fn warm_fs_metadata(',
          nameAt: 'pub fn '.length,
          note: 'the exact function session-v64 goal.md quotes its symptom comment from',
        },
        {
          id: 'startup_with_extension',
          file: 'celeriant/src/lib.rs',
          needle: 'pub fn startup_with_extension(',
          nameAt: 'pub fn '.length,
          note: 'a real startup path that calls in-repo domain functions',
        },
      ]),
    },
  },
]);
