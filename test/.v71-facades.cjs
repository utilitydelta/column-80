// Three copies of `instructPostprocess` side by side, session-v71.
//
// The fenced count is the ruler the roadmap arms are measured with, so a change
// to it has to be reported as a MOVE against the two commits that matter:
//
//   1fb757f  3.5.0, the S35 measurement baseline. Stays the baseline.
//   a81e986  3.5.1, the shipped counter today. Added BESIDE 1fb757f, not instead.
//   (work)   the working tree.
//
// Built the way `test/blind-v70-p3-counting-lens.test.cjs` builds its facade:
// `git archive <ref> src` into a scratch tree, then esbuild. Read-only; nothing
// here touches the index or the working tree.
//
// It lives in `test/` and not in `session-v71/` because `session*/` is
// gitignored: a committed row that requires a gitignored helper is green on this
// box and missing on the runner.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const esbuild = require("esbuild");

const REPO = path.join(__dirname, "..");
const REF_350 = "1fb757f415b7dd1f9f956d0b761dfbcd78750ebb";
const REF_351 = "a81e986";

const EXPORTS =
  `export { extractTestModule, extractTestFunctions, extractRequestedFunction, postprocessInstructOutput } from `;

function bundleFrom(entryModule, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `c80-v71-${tag}-`));
  const entry = path.join(dir, "entry.ts");
  fs.writeFileSync(entry, `${EXPORTS}${JSON.stringify(entryModule)};\n`);
  const outfile = path.join(dir, "bundle.cjs");
  esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node" });
  return { mod: require(outfile), dir };
}

function facadeAt(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `c80-v71-src-${ref.slice(0, 7)}-`));
  const tar = execFileSync("git", ["-C", REPO, "archive", ref, "src"], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  const built = bundleFrom(path.join(dir, "src", "core", "instructPostprocess"), ref.slice(0, 7));
  return { ...built.mod, __dir: dir };
}

function facadeWorking() {
  return bundleFrom(path.join(REPO, "src", "core", "instructPostprocess"), "work").mod;
}

/** The one call the counter is reached through, per languageId. Rust has its own
 *  extractor and the other four share `extractTestFunctions`; production picks
 *  the same way. */
const callOn = (impl, id, reply) =>
  id === "rust" ? impl.extractTestModule(reply) : impl.extractTestFunctions(reply, id);

/** Two answers are the same when both are undefined, or both carry the same cut
 *  text and the same count. A text move with an equal count is still a move. */
const same = (a, b) =>
  (a === undefined && b === undefined) ||
  (a !== undefined && b !== undefined && a.text === b.text && a.testCount === b.testCount);

const show = (r) => (r === undefined ? "REFUSED" : `count=${r.testCount}`);

module.exports = { REPO, REF_350, REF_351, facadeAt, facadeWorking, callOn, same, show };
