// session-v64 phase 4: the capture rig pointed at REAL REPOSITORIES.
//
// WHY THIS FILE EXISTS. `.vscode-test.mjs` roots each label at a dogfood
// workspace, and those five repos were authored as FIM fixtures. This session
// has already caught them flattering a measurement once: the outgoing-call
// spike read 97.6% callee doc coverage in the dogfood repos against 2.5% to
// 41.5% on production code. An arms table built only on `playground/fns.go`
// would be a fact about the fixtures, so the same capture runs again over real
// repositories and writes to a SEPARATE directory, `session-v64/captures-real`,
// where nothing can average the two populations together.
//
// It loads ONLY the capture file, so nothing else in the tier runs, and it
// edits no shared config. Same shape as `v64spike.vscode-test.mjs`, which the
// phase 5 spike used for the same reason.
//
// The bounds are wider than the dogfood run's: these repos are two orders
// larger, their servers take minutes rather than seconds to index, and a walk
// that stopped on the dogfood clock would report a thin capture as a fact about
// the repository.
//
// Run, ONE LABEL AT A TIME:
//   npm run build
//   DISPLAY=:1 npx vscode-test --config test-vscode/v64capture.vscode-test.mjs --label realrust   --grep V64CAPTURE
//   DISPLAY=:1 npx vscode-test --config test-vscode/v64capture.vscode-test.mjs --label realts     --grep V64CAPTURE
//   DISPLAY=:1 npx vscode-test --config test-vscode/v64capture.vscode-test.mjs --label realcsharp --grep V64CAPTURE
//   DISPLAY=:1 npx vscode-test --config test-vscode/v64capture.vscode-test.mjs --label realpython --grep V64CAPTURE
//   DISPLAY=:1 npx vscode-test --config test-vscode/v64capture.vscode-test.mjs --label realgo     --grep V64CAPTURE
// THE CORPUS PATHS COME FROM THE ENVIRONMENT, AND THAT IS NOT A CONVENIENCE.
//
// CAPTURE CORPORA ARE NOT NAMED HERE. Three of the five rows point at private
// client repositories, and a checked-in absolute path names the client in a
// public repository as surely as the word would. Set C80_CAPTURE_RUST,
// C80_CAPTURE_TS and C80_CAPTURE_CSHARP to run those rows; leave them unset and
// the row has no workspace and does not run.
//
// The two OSS rows keep their paths because naming a public repository is not a
// disclosure.
import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const base = {
  extensionDevelopmentPath: repoRoot,
  files: 'v64-capture.test.js',
  mocha: { ui: 'tdd', timeout: 2400000, slow: 60000 },
};

// Wider than the dogfood defaults, and the reason is per-bound. FILE_CAP: a
// 1786-file repository needs a sample spread over more than forty files or
// every row comes from one corner of it. SERVER_READY_MS: rust-analyzer on a
// 475-file cargo workspace and Roslyn on a real solution both index for
// minutes. WALK_MS: the budget has to outlast the index.
const env = {
  C80_CAPTURE_DIR: 'captures-real',
  // NOT A SAMPLE CAP. `findFiles` returns the FIRST n matches in its own
  // traversal order, so a small number here biases the corpus to whatever the
  // search happened to reach first - the first realrust capture took all 24 of
  // its rows from one crate that way. The whole list is fetched and the STRIDE
  // does the sampling, which spans the repository instead of its head.
  C80_FILE_CAP: '4000',
  C80_FUNCTION_CAP: '400',
  C80_ROW_TARGET: '24',
  C80_SERVER_READY_MS: '600000',
  C80_WALK_MS: '1500000',
};

export default defineConfig([
  {
    ...base,
    label: 'realrust',
    workspaceFolder: process.env.C80_CAPTURE_RUST ?? '',
    installExtensions: ['rust-lang.rust-analyzer'],
    env: { ...env, C80_LANG: 'rust' },
  },
  {
    ...base,
    label: 'realts',
    workspaceFolder: process.env.C80_CAPTURE_TS ?? '',
    env: { ...env, C80_LANG: 'ts' },
  },
  {
    ...base,
    label: 'realcsharp',
    workspaceFolder: process.env.C80_CAPTURE_CSHARP ?? '',
    installExtensions: ['ms-dotnettools.csharp'],
    env: { ...env, C80_LANG: 'csharp' },
  },
  {
    ...base,
    label: 'realpython',
    workspaceFolder: '/home/utilitydelta/repos/external/manim',
    installExtensions: ['ms-python.python', 'ms-python.vscode-pylance'],
    env: { ...env, C80_LANG: 'python' },
  },
  {
    ...base,
    label: 'realgo',
    workspaceFolder: '/home/utilitydelta/repos/external/defradb',
    installExtensions: ['golang.go'],
    env: { ...env, C80_LANG: 'go' },
  },
]);
