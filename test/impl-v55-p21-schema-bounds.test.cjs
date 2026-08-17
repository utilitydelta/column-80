"use strict";
// session-v55 phase 21, queue Q2. `column80.debounceMs` shipped with no schema
// minimum, so the settings editor accepted a negative delay and offered no hint
// that 0 means "no debounce at all". The code has always read 0 that way
// deliberately (`completionService.ts:464` guards on `debounceMs > 0`), so the
// fix is the bound plus a description that says what the bound costs, not the
// removal of the escape hatch.
//
// These rows read the PACKAGED schema rather than the config reader, because
// the schema is the only thing the settings UI ever sees. A minimum that lives
// in code and not in package.json does not stop anyone typing -50 into the
// editor.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const props = pkg.contributes.configuration.properties;

test("Q2: column80.debounceMs declares a schema minimum, and its description says what the floor means", () => {
  const schema = props["column80.debounceMs"];
  assert.strictEqual(schema.type, "number");
  assert.strictEqual(schema.default, 150);
  assert.strictEqual(schema.minimum, 0, "without this the settings editor accepts a negative delay");
  assert.match(
    schema.description,
    /\b0\b/,
    "0 is a real mode (no debounce), so the description has to name it rather than leave a user to discover it"
  );
});

test("every numeric FIM setting that has a floor declares it in the schema, not only in code", () => {
  // The ones that carry a bound today. This row exists so a later edit cannot
  // quietly drop one: a floor that only lives in the reader is invisible to the
  // settings UI, which is where the wrong value gets typed.
  const bounded = {
    "column80.debounceMs": 0,
    "column80.prefixChars": 10,
    "column80.cacheCapacity": 0,
    "column80.minGhostChars": 0,
    "column80.minGhostAlnum": 0,
  };
  for (const [key, min] of Object.entries(bounded)) {
    assert.ok(props[key], `${key} is missing from the packaged schema`);
    assert.strictEqual(props[key].minimum, min, `${key} lost its schema minimum`);
  }
});

test("no numeric setting declares a minimum above its own default", () => {
  // A floor above the default ships a product whose out-of-the-box value the
  // settings editor flags as invalid. Cheap to check, and it catches the whole
  // class rather than one setting.
  for (const [key, schema] of Object.entries(props)) {
    if (schema.type !== "number" || schema.minimum === undefined || schema.default === undefined) {
      continue;
    }
    assert.ok(
      schema.default >= schema.minimum,
      `${key}: default ${schema.default} is below its own minimum ${schema.minimum}`
    );
  }
});
