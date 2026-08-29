// The model-authored review's own host config.
//
// SEPARATE FROM THE MAIN TIER on purpose. `.vscode-test.mjs` globs every
// `*.test.js` in this directory, so running it to exercise one new suite spends
// ten minutes on nineteen unrelated rows and then hits its own timeout before
// reaching the new ones. That is exactly what happened on the first attempt.
//
// Run: DISPLAY=:1 npx vscode-test --config test-vscode/v64advise.vscode-test.mjs --label ts
import { defineConfig } from '@vscode/test-cli';

const base = {
  extensionDevelopmentPath: new URL('..', import.meta.url).pathname,
  files: 'v64-advise.test.js',
  mocha: { ui: 'tdd', timeout: 900000, slow: 60000 },
};

export default defineConfig([
  { ...base, label: 'ts', workspaceFolder: '/home/utilitydelta/repos/ts-scratch', env: { C80_LANG: 'ts', C80_LOG_FILE: '/tmp/c80-v64-advise-ts.log' } },
  { ...base, label: 'rust', workspaceFolder: '/home/utilitydelta/repos/rust-scratch', installExtensions: ['rust-lang.rust-analyzer'], env: { C80_LANG: 'rust', C80_LOG_FILE: '/tmp/c80-v64-advise-rust.log' } },
  { ...base, label: 'python', workspaceFolder: '/home/utilitydelta/repos/python-scratch', installExtensions: ['ms-python.python', 'ms-python.vscode-pylance'], env: { C80_LANG: 'python', C80_LOG_FILE: '/tmp/c80-v64-advise-python.log' } },
  { ...base, label: 'go', workspaceFolder: '/home/utilitydelta/repos/go-scratch', installExtensions: ['golang.go'], env: { C80_LANG: 'go', C80_LOG_FILE: '/tmp/c80-v64-advise-go.log' } },
  { ...base, label: 'csharp', workspaceFolder: '/home/utilitydelta/repos/csharp-scratch', installExtensions: ['ms-dotnettools.csharp'], env: { C80_LANG: 'csharp', C80_LOG_FILE: '/tmp/c80-v64-advise-csharp.log' } },
]);
