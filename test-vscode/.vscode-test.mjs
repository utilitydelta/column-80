// The VS Code integration tier: one real extension host per language, each
// rooted at that language's dogfood repo with that language's real server
// installed. `C80_LANG` selects the spec row inside the test file.
//
// This tier holds product-transport payload tests and nothing else. The 198
// `node --test` files stay where they are; @vscode/test-cli is Mocha-only with
// the `tdd` UI, so the two suites cannot merge.
//
// Run:  npm run test:vscode
//       npm run test:vscode -- --label csharp
// A bare `vscode-test` invocation skips `npm run build`, so it would grade a
// stale `.build/product.js`. The tier refuses to start when that bundle is
// older than src/ rather than trusting the caller to remember.
// Needs a display. On a headless box: npm run test:vscode:ci (xvfb-run).
//
// xvfb-run is NOT installed on the reference box, so test:vscode:ci fails there.
// What works instead, proven in session-v33 across all five labels: a display is
// already up on :1, so drive vscode-test directly and skip the npm script.
//
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label ts
//
// Two agents have independently rediscovered this, which is why it is written
// down here rather than in a session folder that gets deleted.
//
// A DISPLAY IS NOT ENOUGH: THE SESSION MUST BE UNLOCKED. Every row that arrows
// through the completion widget needs a FOCUSED window, and a locked session can
// never give one, so `window.state.focused` reads false,
// `selectedCompletionInfo.text` is null and the widget walk is empty. Those rows
// then fail in a way that reads exactly like a product defect. PROVEN in
// session-v34: with the screen locked the python label ran 38 passing / 15
// failing, and on the identical code with it unlocked, 45 passing / 8 failing -
// seven rows flipped on the unlock alone. Check it before believing a number:
//
//   loginctl show-session <id> -p LockedHint     # LockedHint=no
//
// Two more preconditions from the same session, for the same reason - a count
// from this tier means nothing without them:
//   - NOTHING ELSE ON THE GPU, including other agent sessions. The rows that Tab
//     in a MODEL's answer (the v20 preselect pair) did NOT flip on the unlock,
//     because a generation was saturating the card. Those are the rows a busy box
//     breaks, and they are a different set from the ones a lock breaks.
//   - ONE LABEL AT A TIME, and a timeout well above 900s. Five back-to-back got
//     the `go` label killed mid-test with no summary printed, which reads as
//     failure and is not.
//
// The host is also NOT a clean environment: GitHub Copilot loads into it, and its
// `refactor.rewrite.copilot` action was the ONLY code action offered on a row that
// wanted pyright's add-import. Rule out the neighbours before blaming the product.
//
// A row that drives column80.generateFunction must NOT await the command when no
// model is reachable: with ollama down the command ends on an AWAITED error toast
// with a button, so its promise never settles until someone dismisses it. Fire the
// command, wait for the prompt on the channel, then clear notifications. Prompt
// assertions need no model, because fnGenService logs the assembled prompt before
// the request leaves.

import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const base = {
  extensionDevelopmentPath: repoRoot,
  files: '*.test.js', // globbed relative to THIS config file's directory
  mocha: { ui: 'tdd', timeout: 600000, slow: 30000 },
};

export default defineConfig([
  {
    ...base,
    label: 'ts',
    workspaceFolder: '/home/utilitydelta/repos/ts-scratch',
    env: { C80_LANG: 'ts' },
  },
  {
    ...base,
    label: 'csharp',
    workspaceFolder: '/home/utilitydelta/repos/csharp-scratch',
    installExtensions: ['ms-dotnettools.csharp'],
    env: { C80_LANG: 'csharp' },
  },
  {
    ...base,
    label: 'python',
    workspaceFolder: '/home/utilitydelta/repos/python-scratch',
    installExtensions: ['ms-python.python', 'ms-python.vscode-pylance'],
    env: { C80_LANG: 'python' },
  },
  {
    ...base,
    label: 'rust',
    workspaceFolder: '/home/utilitydelta/repos/rust-scratch',
    installExtensions: ['rust-lang.rust-analyzer'],
    env: { C80_LANG: 'rust' },
  },
  {
    ...base,
    label: 'go',
    workspaceFolder: '/home/utilitydelta/repos/go-scratch',
    // Installs into vscode-test's ISOLATED extensions dir, never the user's
    // editor (the golang.go prerequisite in goal.md is about the human's own
    // editor; this tier carries its own). golang.go manages gopls itself —
    // record the version it runs beside the headless v0.23.0 (day-one skew).
    installExtensions: ['golang.go'],
    env: { C80_LANG: 'go' },
  },
]);
