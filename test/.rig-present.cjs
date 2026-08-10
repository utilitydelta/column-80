// IS THE MEASUREMENT RIG CHECKED OUT BESIDE THE PRODUCT?
//
// The harness and its session archives live in a separate PRIVATE repository
// (column-80-working, split out 2026-08-10), because they carry corpora taken
// against private client code and cannot be published. A public clone of this
// repo therefore has no `session-complxity-research/`, and the rows that
// exercise the rig have no subject.
//
// Those rows SKIP here rather than pass. A test that quietly goes green when the
// thing it tests is absent is the false green this suite exists to prevent, and
// this repo has been bitten by exactly that before: a differential row survived
// on an object that merely happened to be reachable, and died the moment the
// history changed. Where a baseline can be vendored as a fixture, vendor it and
// do not use this; use this only where the subject itself is the rig.
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const SPIKES = path.join(__dirname, "..", "session-complxity-research", "spikes");
const RIG_PRESENT = fs.existsSync(SPIKES);
const SKIP_REASON = "the measurement rig is not checked out beside the product (it lives in the private column-80-working repo)";

/** `test`, but skipped with a stated reason when the rig is absent. */
const rigTest = (name, fn) =>
  RIG_PRESENT ? test(name, fn) : test(name, { skip: SKIP_REASON }, () => {});

module.exports = { RIG_PRESENT, SKIP_REASON, SPIKES, rigTest };
