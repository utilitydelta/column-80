/**
 * The honest-failure classifier. Blind unit-test generation fits a MINORITY
 * of real functions; the feature must fail plainly on the rest rather than
 * emit a hollow or mocked test. This pure classifier decides, from the
 * signature + doc comment ALONE, whether a function is a valid BLIND-UNIT-TEST
 * target, and when not, which honest-failure category to surface.
 *
 * It does NOT judge test-worthiness, and it does NOT detect "already a test" — the
 * detect-and-extend path (never clobber an existing test module) owns that.
 *
 * RUST-ONLY: every marker below reads Rust syntax (`-> ` returns, `self`
 * receivers, `io::` paths). The TDD gesture gates on languageId before calling
 * this; handing it a TS/C#/Python signature yields nonsense verdicts.
 */

/**
 * `not-exported` fires only where the test reaches the unit through an IMPORT and
 * the unit is not visible to importers: TypeScript without `export`, C# private
 * or internal without InternalsVisibleTo. Rust never produces it (`use super::*`
 * sees private items), Go never does (the `_test.go` sibling declares the same
 * package), and Python must never do (a leading underscore is convention, not
 * privacy). The classifier below is Rust's, so it can never return this member.
 */
export type TestabilityReason = "async" | "io" | "needs-fixture" | "underspecified" | "not-exported";

export interface TestabilityVerdict {
  testable: boolean;
  /** Present exactly when !testable. */
  reason?: TestabilityReason;
  /** Short human-facing detail naming the specific trigger. */
  detail?: string;
}

// A `self` receiver in the FIRST parameter slot: `(self`, `(&self`, `(&mut self`,
// `(mut self`, and the lifetime-annotated borrow forms `(&'a self` / `(&'a mut self`
// (common in a lifetime-heavy codebase), with any spacing. `\bself\b`
// (case-sensitive) so `Self` (a type) and `selfish` (a name) never match — only the
// lowercase receiver keyword.
const RECEIVER = /\(\s*&?\s*('[a-z_]\w*\s+)?(mut\s+)?self\b/;

// The closed IO/network marker set. Case-sensitive,
// word-bounded type names so `Profile`/`MyTcpStream` never trip `File`/`TcpStream`;
// `\bio::` matches the std `io` module path segment (`std::io::Result`) but not
// `bio::`. Path/PathBuf are DELIBERATELY absent — pure path work is testable.
const IO_MARKER = /\b(File|OpenOptions|TcpStream|TcpListener|UdpSocket)\b|\bio::|\b(impl|dyn)\s+(Read|Write)\b/;

// A future-shaped return: `impl Future`, `Pin<Box<dyn Future…`, or `BoxFuture`.
const FUTURE_RETURN = /\bimpl\s+Future\b|\bPin\s*<\s*Box\s*<\s*dyn\s+Future\b|\bBoxFuture\b/;

/**
 * Classify a Rust function as a blind-unit-test target or an honest failure.
 * First-match-wins over a FIXED precedence so the reported reason is stable:
 * async → io → needs-fixture → underspecified → else testable. Pure; never throws.
 */
export function classifyTestability(signature: string, docComment?: string): TestabilityVerdict {
  const sig = signature ?? "";
  // Everything after `->` up to the body brace (or end) is the return type.
  const returnType = /->\s*([^{]*)/.exec(sig)?.[1]?.trim();

  // 1. async — an `async fn`, or a return that names a future.
  if (/\basync\s+fn\b/.test(sig) || (returnType !== undefined && FUTURE_RETURN.test(returnType))) {
    return { testable: false, reason: "async", detail: "async fn or a future-returning fn — a blind unit test cannot drive it" };
  }

  // 2. io — a closed IO/network marker anywhere in the signature (params or return).
  if (IO_MARKER.test(sig)) {
    return { testable: false, reason: "io", detail: "IO/network in the signature — integration territory, not a blind unit test" };
  }

  // 3. needs-fixture — a `self` receiver: constructing a meaningful receiver state
  //    is the fixture problem the buildable half does not attempt.
  if (RECEIVER.test(sig)) {
    return { testable: false, reason: "needs-fixture", detail: "method with a `self` receiver — needs a constructed fixture" };
  }

  // 4. underspecified — no contract to author from, or nothing to assert.
  if (docComment === undefined || docComment.trim() === "") {
    return { testable: false, reason: "underspecified", detail: "no doc comment — no contract to author a blind test from" };
  }
  // Unit return: no `->` at all, `-> ()`, or `-> Result<(), _>` (the value is `()`).
  const unitReturn =
    returnType === undefined ||
    /^\(\s*\)$/.test(returnType) ||
    /^Result\s*<\s*\(\s*\)\s*,/.test(returnType);
  if (unitReturn) {
    return { testable: false, reason: "underspecified", detail: "no return value to assert — side-effect only" };
  }

  // 5. Otherwise a valid blind-unit-test target.
  return { testable: true };
}
