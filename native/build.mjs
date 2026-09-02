// Build and stage the native binaries for THIS box's platform.
//
//   node native/build.mjs            configure, build, install into native/bin/<platform>-<arch>/
//   node native/build.mjs --clean    remove the build tree first
//
// The staged directory is what the vsix carries for that target, and what the extension looks
// up at runtime (src/vscode/dictationNative.ts). Nothing here is platform-branched except the
// binary suffix; the per-OS work is cmake's.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = `${process.platform}-${process.arch}`;
const buildDir = join(here, "build");
const stageDir = join(here, "bin", target);
const jobs = String(Math.max(2, (await import("node:os")).cpus().length));

if (process.argv.includes("--clean") && existsSync(buildDir)) rmSync(buildDir, { recursive: true });

const run = (args) => execFileSync("cmake", args, { stdio: "inherit", cwd: here });
run(["-S", here, "-B", buildDir, "-DCMAKE_BUILD_TYPE=Release"]);
run(["--build", buildDir, "--config", "Release", "--target", "column80-capture", "whisper-server", "-j", jobs]);

// Multi-config generators (Visual Studio) nest a Release/ directory; single-config ones do not.
// Searching by name covers both without a generator branch.
function find(dir, name) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "_deps" || entry === "CMakeFiles") continue;
    if (statSync(full).isDirectory()) {
      const hit = find(full, name);
      if (hit) return hit;
    } else if (entry === name) return full;
  }
  return undefined;
}
const exe = process.platform === "win32" ? ".exe" : "";
mkdirSync(stageDir, { recursive: true });
for (const name of [`column80-capture${exe}`, `whisper-server${exe}`]) {
  const built = find(buildDir, name);
  if (!built) throw new Error(`${name} was not produced under ${buildDir}`);
  copyFileSync(built, join(stageDir, name));
  console.log(`staged ${name} from ${built}`);
}
console.log(`staged ${target} in ${stageDir}`);
