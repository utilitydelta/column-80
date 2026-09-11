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

/**
 * The PROJECT facts a testability verdict depends on, resolved before the
 * classifier runs. The classifier stays pure over this: a rung that read the
 * filesystem itself could not be tested without one, and a rung whose verdict
 * moved with the disk under a pure-looking call is the worst of both.
 */
export interface TestabilityContext {
  /** C#: does the test assembly see `internal` members? */
  internalsVisible?: boolean;
  /** ADDED session-v68 phase 5. How a generated test DRIVES an async target in
   *  THIS project, or absent when nothing here can.
   *
   *  Three of the six framework legs need no detection at all — C#, the two
   *  TypeScript frameworks and python/unittest all await natively — so they
   *  fill this unconditionally. The two that need it are the two where lifting
   *  the rung without the machinery would swap an honest refusal for a red
   *  test: Rust needs a runtime attribute off `Cargo.toml`, and pytest needs a
   *  plugin the interpreter is ASKED about. */
  asyncTest?: AsyncTestSupport;
  /** What was looked for when `asyncTest` is absent, so the refusal NAMES it
   *  instead of repeating a blanket sentence. */
  asyncLookedFor?: string;
  /** ADDED session-v68 phase 6. Can a test CONSTRUCT this target's receiver —
   *  does the enclosing type's resolved surface carry something that produces
   *  one?
   *
   *  It skips the fixture rung and NOTHING else, so the reason underneath is
   *  reported truthfully: an async method still says `async`, a method with no
   *  doc comment still says `underspecified`.
   *
   *  The gate asks the classifier TWICE, and the order is the whole design.
   *  Resolving the enclosing type's surface costs a real pre-fill, so it must
   *  not be paid before the honest-failure gate: that would charge every refusal
   *  for it, including the 68.4% of real functions with no doc comment. So the
   *  gate classifies as normal, and only for a `needs-fixture` verdict asks
   *  again with this flag set. A refusal underneath means the fixture is not the
   *  only blocker and nothing is resolved. `testable` means the receiver is the
   *  single thing in the way, and only THEN is the surface worth paying for. */
  receiverConstructible?: boolean;
  /** ADDED session-v68 phase 6 (adversarial review F9). Is the enclosing TYPE
   *  reachable from the test site — exported, public, importable?
   *
   *  TypeScript needs it and no other language does. A class member is reached
   *  through its class rather than through an import of its own, so lifting the
   *  fixture rung has to lift `not-exported` with it or the member lands on a
   *  rung it was never standing on. But the member's SIGNATURE cannot say
   *  whether the CLASS is exported, and assuming it is admits a target whose
   *  test cannot import anything. So the answer is resolved where the document
   *  is, and absent means "not established", which keeps the refusal. */
  receiverExported?: boolean;
}

/** How a generated test drives an async target here. */
export interface AsyncTestSupport {
  /** The prompt fragment naming the shape: `#[tokio::test]`,
   *  `@pytest.mark.asyncio`, `unittest.IsolatedAsyncioTestCase`,
   *  `public async Task`, an `async` callback. */
  readonly shape: string;
}

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
export const FUTURE_RETURN = /\bimpl\s+Future\b|\bPin\s*<\s*Box\s*<\s*dyn\s+Future\b|\bBoxFuture\b/;

/**
 * Classify a Rust function as a blind-unit-test target or an honest failure.
 * First-match-wins over a FIXED precedence so the reported reason is stable:
 * async → io → needs-fixture → underspecified → else testable. Pure; never throws.
 */
export function classifyTestability(
  signature: string,
  docComment?: string,
  ctx?: TestabilityContext,
): TestabilityVerdict {
  const sig = signature ?? "";
  // Everything after `->` up to the body brace (or end) is the return type.
  const returnType = /->\s*([^{]*)/.exec(sig)?.[1]?.trim();

  // 1. async. ADMITTED (session-v68 phase 5) when this project has a runtime a
  //    generated test can carry: `#[tokio::test]` and friends, resolved from
  //    Cargo.toml by `rustTestabilityContext` and handed in.
  //
  //    Rust is the language with no stdlib answer here. Lifting the rung with
  //    no runtime detected would swap an honest refusal for a test that does not
  //    compile, which is worse than both, so the refusal instead NAMES the three
  //    runtimes it looked for. A developer with an in-house runtime hands over a
  //    test-function template as a context block; that reaches the PROMPT and
  //    deliberately never reaches this classifier, because a rung whose verdict
  //    moves with what is staged is a rung whose refusals shift under the human
  //    without warning.
  if (/\basync\s+fn\b/.test(sig) || (returnType !== undefined && FUTURE_RETURN.test(returnType))) {
    if (ctx?.asyncTest === undefined) {
      return {
        testable: false,
        reason: "async",
        detail:
          ctx?.asyncLookedFor ??
          "async fn, and no async test runtime found in Cargo.toml — looked for tokio, async-std and smol",
      };
    }
  }

  // 2. io — a closed IO/network marker anywhere in the signature (params or return).
  if (IO_MARKER.test(sig)) {
    return { testable: false, reason: "io", detail: "IO/network in the signature — integration territory, not a blind unit test" };
  }

  // 3. needs-fixture — a `self` receiver: constructing a meaningful receiver state
  //    is the fixture problem the buildable half does not attempt, UNLESS the
  //    enclosing type's resolved surface carries something that produces one
  //    (session-v68 phase 6). The flag skips this rung and nothing else, so an
  //    async method still reports async and an undocumented one still reports
  //    underspecified.
  if (RECEIVER.test(sig) && ctx?.receiverConstructible !== true) {
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
