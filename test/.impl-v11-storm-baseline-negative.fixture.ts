// tsc NEGATIVE fixture (v11 phase 4 / P2-1): the BaselineCheck newtype's
// type-level refusal. The blind (blind-v11-storm-baseline) flagged that a
// runtime black-box test CANNOT prove the type-level refusal of a raw
// post-accept OracleCheckResult — only `tsc --noEmit` can. This file passes a
// raw OracleCheckResult to isMissingImportsStorm; that line MUST be a COMPILE
// error, so `tsc --noEmit` on this file exits NON-ZERO. A zero exit is the P2-1
// REGRESSION (the newtype guard is gone). Driven by
// test/impl-v11-storm-baseline-negative.test.cjs as a separate expected-fail
// tsc. Dot-prefixed so node --test never tries to execute it as a test, and not
// part of the main build (main tsconfig rootDir is `src`).
import { isMissingImportsStorm, baselineCheck } from "../src/core/pyOracle";
import type { OracleCheckResult } from "../src/core/compilerOracle";

const raw: OracleCheckResult = {
  success: false,
  diagnostics: [],
  durationMs: 0,
  crateRoot: "/proj",
};

// THE REFUSAL: a raw post-accept OracleCheckResult is NOT a BaselineCheck. This
// call MUST NOT compile — that is the whole P2-1 enforcement (a post-generation
// two-hallucination stream can never be classified as a broken environment).
isMissingImportsStorm(raw);

// The positive control: a MINTED pre-generation baseline is accepted. This line
// is well-typed; the compile failure above is the only expected error.
isMissingImportsStorm(baselineCheck(raw));
