// Layout discipline oracle: src/core is pure — it never imports vscode, so
// every core module stays bundleable into headless tests. Also proves the
// .mjs leg of the node:test harness works.
//
// Run: npm test

import test from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const coreDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "core");

test("no src/core file imports vscode", () => {
  const offenders = readdirSync(coreDir)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => /from\s+["']vscode["']|require\(["']vscode["']\)/.test(readFileSync(join(coreDir, f), "utf8")));
  assert.deepStrictEqual(offenders, []);
});
