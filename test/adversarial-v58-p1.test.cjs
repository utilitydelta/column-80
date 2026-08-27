// Adversarial review: session-v58 phase 1, the channel keeps the raw body
// (roadmap item 69, first shape; bound to the phase-1 contract).
//
// Written AFTER the implementation and after the blind oracle
// (test/blind-v58-p1-raw-channel.test.cjs, 50 rows green). Its job is the
// opposite of the oracle's: every row here is an attempt to break the thing,
// and a row that stays green is a claim of CLEAN, not decoration.
//
// WHAT THE ORACLE COULD NOT SEE, and what this file goes after
//
//   * C5 IS DERIVED, NOT SNAPSHOTTED. The oracle rebuilds its expectation at
//     run time out of the product's own `boundBody` and a live `Response`, so a
//     bound that changed on BOTH surfaces at once would move the expectation
//     with it and stay green. Here the four throw strings are LITERALS captured
//     from the branch point (`6861edd`) in a `git worktree`, driven against the
//     same server shapes. Ten body shapes x four arms were diffed
//     tree-against-tree before these literals were written down; the diff was
//     zero, and these rows are what keeps it zero.
//   * THE DEGENERATE READ. The oracle drives bodies the server actually sends.
//     A body that cannot be read at all is the interesting one, because the
//     channel line states a character count and the readers answer a torn
//     socket with a nine-character placeholder.
//   * THE LINE IS NOT A LINE. `channelBodyLine` interpolates a server-
//     controlled string into one `log()` call. The sink is
//     `OutputChannel.appendLine`, which renders one row per break. Everything
//     the oracle asserts is about ONE array element; the channel sees as many
//     rows as the server chose.
//   * THE FOURTH CALLER. `streamGenerate` has two callers, not one, and the
//     contract's site list names the throw site rather than the callers.
//   * THE ARITY DODGE. `pullModel`'s sink is `log: (line) => void = () =>
//     undefined` so `Function.length` stays 4. The other three sites are `?.`.
//     That is one site whose degenerate-input behaviour can drift from the
//     other three without the type saying so, and C6 is about exactly that.
//   * THE PROSE. C2 has a docs clause the oracle cannot assert, a dead export
//     can recommend itself, and a comment can name a channel tag the product
//     does not write.
//
// STATE. Three passes. The first found six defects; triage took six fixes, one
// deferral and two deletions. Re-cutting against those fixes found a seventh -
// the escaping was applied outside the cap, so a server picking U+2028 over LF
// bought a sixfold channel row - and that fix landed too. Every row that caught
// something is KEPT and re-cut against the new behaviour rather than deleted:
// each is now a guard on a closed hole, and the section header above it says
// what it used to catch, because a fix nobody can see failing is a fix that
// comes back.
//
// Everything is green except one row, `DEFERRED S58-1 [ollama-fim]`, which is
// skipped with its deferral written out above it.
//
// TWO TRADES ARE PINNED AS ACCEPTED rather than left to be rediscovered as
// bugs, both in the escaping section: a literal backslash-n in a body is
// indistinguishable from an escaped break, and on a break-carrying body the
// line's two numbers are in different units. Each has a row saying so and
// asserting what must hold instead.
//
// Run: node --test test/adversarial-v58-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const CORE = path.join(SRC, "core");

const core = bundleCore(
  "adv-v58-p1",
  `export * from "../src/core/errorBound";\n` +
    `export { generateInstruct, generateFim, pullModel } from "../src/core/ollama";\n` +
    `export { makeAnthropicInstruct } from "../src/core/anthropicInstruct";\n` +
    `export { makeCloudInstruct } from "../src/core/cloudInstruct";\n`,
);
const {
  ERROR_BODY_CHARS,
  CHANNEL_BODY_CHARS,
  boundChannel,
  generateInstruct,
  generateFim,
  pullModel,
  makeAnthropicInstruct,
  makeCloudInstruct,
} = core.mod;

test.after(() => core.cleanup());

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const plain = (status, body) => (_req, res) => {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
};

/** Headers promise a body, the socket dies before it arrives. `text()` rejects. */
const torn = (_req, res) => {
  res.writeHead(500, { "Content-Type": "text/plain", "Content-Length": "1000" });
  res.write("partial-");
  setTimeout(() => res.socket.destroy(), 10);
};

const PARAMS = (base) => ({
  apiBase: base,
  model: "test-model",
  prompt: "write a function",
  maxTokens: 64,
  temperature: 0,
  signal: new AbortController().signal,
});

async function caught(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

// The four HTTP-status sites the contract names, each reduced to "point it at
// this base, hand it this sink, make it fail".
const ARMS = [
  {
    name: "ollama-generate",
    drive: (base, log) => generateInstruct({ ...PARAMS(base), log }),
  },
  {
    name: "ollama-pull",
    drive: (base, log) =>
      pullModel(base, "test-model", new AbortController().signal, () => undefined, log),
  },
  {
    name: "anthropic",
    drive: (base, log) => makeAnthropicInstruct({ baseUrl: base, apiKey: "k", log })(PARAMS(base)),
  },
  {
    name: "cloud",
    drive: (base, log) => makeCloudInstruct({ baseUrl: base, apiKey: "k", log })(PARAMS(base)),
  },
];

/** Drive one arm against `handler`; collect the sink's calls and the throw. */
async function run(arm, handler) {
  const srv = await serve(handler);
  const lines = [];
  let err;
  try {
    err = await caught(() => arm.drive(srv.base, (line) => lines.push(String(line))));
  } finally {
    await srv.close();
  }
  return { err, lines };
}

/** The raw-body line, located the way the oracle locates it: by the bounded
 *  body it must carry, excluding the anthropic arm's own echo of the throw. */
function rawLine(lines, body, err) {
  const want = boundChannel(body);
  const echo = err instanceof Error ? err.message : undefined;
  const hits = lines.filter((l) => l.includes(want) && !(echo && l.includes(echo)));
  assert.ok(hits.length >= 1, `no raw-body line among ${JSON.stringify(lines.map((l) => l.slice(0, 120)))}`);
  return hits[0];
}

// ===========================================================================
// C5, SNAPSHOTTED. Literals captured from the branch point 6861edd, checked
// out into a `git worktree`, bundled and driven against these exact server
// shapes. Nothing below is rebuilt from ERROR_BODY_CHARS, boundBody or a live
// Response: a phase that moved the bound on both surfaces at once would slide
// the oracle's derivation along with it and stay green here it cannot.
//
// Provenance: ten shapes (empty, 200 chars, exactly 400, 401 over budget,
// 102400, surrogate straddling the cut, a 6000-char reason phrase, an
// unlearnable 400, a lying Content-Length, a chunked body cut short) driven
// against both trees, four arms each, forty comparisons, zero diffs.
// ===========================================================================

const SNAP_HEAD = {
  "ollama-generate": "Error: Ollama 500 ",
  "ollama-pull": "Error: Ollama 500 ",
  anthropic: "Error: Anthropic 500 ",
  cloud: "Error: Cloud 500 ",
};
const REASON = "Internal Server Error: ";

// [label, handler, expected tail after the snapshotted head + reason phrase]
const SNAPSHOTS = [
  ["an empty body", plain(500, ""), () => ""],
  ["a 200-char body", plain(500, "s".repeat(200)), () => "s".repeat(200)],
  // 400 exactly: the branch point cut nothing here, and neither may this tree.
  ["a body exactly at the toast budget", plain(500, "q".repeat(400)), () => "q".repeat(400)],
  [
    "a 102400-char body",
    plain(500, "x".repeat(102400)),
    () => `${"x".repeat(400)} [+102000 chars elided]`,
  ],
  // The pair straddles the cut: 399 'a', one emoji (two code units), 50 'b'.
  // The branch point dropped the orphaned high surrogate, so 399 chars survive
  // out of 451 and the note reads 52, not 51.
  [
    "a surrogate pair straddling the cut",
    plain(500, `${"a".repeat(399)}\u{1F600}${"b".repeat(50)}`),
    () => `${"a".repeat(399)} [+52 chars elided]`,
  ],
  // The socket dies mid-body. Both trees name it rather than leaving it blank.
  ["an unreadable body", torn, () => "<no body>"],
];

for (const arm of ARMS) {
  for (const [label, handler, tail] of SNAPSHOTS) {
    test(`CLEAN C5 [${arm.name}]: String(err) matches the 6861edd snapshot, ${label}`, async () => {
      const { err } = await run(arm, handler);
      assert.ok(err !== undefined, "the arm must still throw");
      assert.strictEqual(
        String(err),
        `${SNAP_HEAD[arm.name]}${REASON}${tail()}`,
        "C5: this phase adds a channel line and rewords NOTHING. The expectation here is a literal " +
          "captured from the branch-point tree, not a value rebuilt from the product's own bound.",
      );
    });
  }

  // statusText is server-controlled and unbounded on the wire; both halves of
  // the string are bounded, and the branch point bounded them the same way.
  test(`CLEAN C5 [${arm.name}]: a 6000-char reason phrase matches the 6861edd snapshot`, async () => {
    const { err } = await run(arm, (_req, res) => {
      res.writeHead(500, "R".repeat(6000), { "Content-Type": "text/plain" });
      res.end("body");
    });
    assert.strictEqual(
      String(err),
      `${SNAP_HEAD[arm.name]}${"R".repeat(400)} [+5600 chars elided]: body`,
    );
  });
}

// ===========================================================================
// WAS DEFECT 1, NOW CLEAN. The channel used to invent a server body it never
// read: `rawText` answers a torn socket with the nine-character string
// "<no body>", and the line then read `server body (9 chars): <no body>` -
// byte-identical to the line a server that really sent those nine bytes
// produces, with a character count for bytes that never arrived.
//
// Fixed by splitting the read (`readBody`, which says whether it read) from the
// rendering (`channelUnreadLine`). These rows keep the falsifier: the two cases
// must stay distinguishable, and the unread case must state no length at all,
// because a length is the thing that was fabricated.
// ===========================================================================

for (const arm of ARMS) {
  test(`CLEAN [${arm.name}]: an unreadable body is named unread, not logged as a 9-char server body`, async () => {
    const tornRun = await run(arm, torn);
    const fakeRun = await run(arm, plain(500, "<no body>"));

    const tornLine = tornRun.lines.find((l) => l.startsWith("[http-body]"));
    const fakeLine = fakeRun.lines.find((l) => l.startsWith("[http-body]"));
    assert.ok(tornLine && fakeLine, "both drives must produce a raw-body line");

    assert.notStrictEqual(
      tornLine,
      fakeLine,
      "the channel must tell 'the provider hung up mid-answer' from 'the provider sent nine bytes'; " +
        `they want opposite next actions. Both read:\n  ${tornLine}`,
    );
    assert.ok(
      !/\(\d+ chars\)/.test(tornLine),
      `an unread body has no length to state, and stating one is what made the two lines the same: ${tornLine}`,
    );
    assert.ok(
      /\(9 chars\)/.test(fakeLine),
      `a body that really arrived still states its length: ${fakeLine}`,
    );
    // And the throw is untouched by the split - C5 again, on the degenerate read.
    assert.strictEqual(
      String(tornRun.err),
      `${SNAP_HEAD[arm.name]}${REASON}<no body>`,
      "the toast keeps the branch point's wording; only the channel learned the difference",
    );
  });
}

// ===========================================================================
// WAS DEFECT 2, NOW CLEAN. A server body used to be able to forge product
// channel lines.
//
// `channelBodyLine` puts up to 16384 characters of server-controlled text into
// ONE `log()` call. Every real sink on this path is
// `vscode.OutputChannel.appendLine` (`firstRun.ts:297`, and the `[fngen]` sink
// `fnGenService` hands the local transport), which renders a break as a row
// break. So an unescaped dump let a 500 body write its own channel rows, tags
// and all, with nothing marking where the dump ended.
//
// The fix escapes the break set instead of framing the dump, and that is the
// stronger of the two: a server can forge an end marker, it cannot forge a row
// break that is not there. These rows pin the property the fix claims, and then
// attack it - the whole break set, CRLF, an all-breaks body, and a body that
// already contains a literal backslash-n.
//
// NOTE ON WHY THE SUITE COULD NOT SEE THE ORIGINAL DEFECT, and still cannot see
// a regression unless a row looks for it: a test sink collects ONE array
// element per log() call, while the channel renders one row per break. Every
// line-counting row in the suite (blind-v44-anthropic.test.cjs:239,
// adversarial-v44-p3.test.cjs:107) is measuring a different thing from what a
// user sees. `rows()` below is the channel's model, not the sink's.
// ===========================================================================

// The set `escapeBreaks` covers, written the way an OutputChannel splits.
// Built from code points rather than pasted, so the file stays greppable and
// no literal separator can hide inside a string in it.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const NEL = String.fromCharCode(0x0085);
const BREAK_SPLIT = new RegExp("\\r\\n|\\r|\\n|\\u2028|\\u2029|\\u0085");
/** What the OutputChannel actually renders for one `appendLine` call. */
const rows = (s) => s.split(BREAK_SPLIT);

/** The oracle's own statement of the escaping, so the rows do not have to trust
 *  the product's private helper. Order matters only for CR before LF; both are
 *  replaced independently, so CRLF becomes two escapes rather than one. */
const escapeBreaks = (s) =>
  s
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/\u0085/g, "\\u0085");

const PRODUCT_TAG = /^\[(fngen|carve|anthropic|claude-code|http-body|fim|ctx)\]/;

/** The raw-body line by its tag. Locating it by the body no longer works: the
 *  logged copy is escaped, which is the point of the fix. */
function bodyLine(lines) {
  const hits = lines.filter((l) => l.startsWith("[http-body]"));
  assert.ok(hits.length >= 1, `no [http-body] line among ${JSON.stringify(lines.map((l) => l.slice(0, 120)))}`);
  return hits[0];
}

const FORGERY = `{"error":"real"}\n[fngen] outcome=ok\r\n[carve] pull done model=evil ms=1${LS}[anthropic] model=x round=1${PS}[claude-code] round=failed${NEL}[ctx] tail`;

for (const arm of ARMS) {
  test(`CLEAN [${arm.name}]: a 500 body carrying every break renders as ONE channel row, forged tags inert`, async () => {
    const { lines } = await run(arm, plain(500, FORGERY));
    const line = bodyLine(lines);
    const rendered = rows(line);

    assert.strictEqual(
      rendered.length,
      1,
      "one log() call must render as one channel row, or the server writes its own rows:\n" +
        rendered.map((p, i) => `  [${i}] ${p.slice(0, 100)}`).join("\n"),
    );
    // Belt and braces: even if the split model above ever drifted from VS Code's,
    // no rendered row past the first may begin with a product tag.
    assert.deepStrictEqual(
      rendered.slice(1).filter((p) => PRODUCT_TAG.test(p)),
      [],
      "a rendered row wearing a product tag is the server talking",
    );
    // The body must still be READABLE, not merely safe. An escape that dropped
    // the breaks would pass the row count and lose the diagnostic.
    assert.ok(
      line.endsWith(escapeBreaks(FORGERY)),
      `the escaped body must be the whole body with its breaks made visible: ${line.slice(-160)}`,
    );
    // And recoverable: this body carries no literal backslash, so un-escaping is
    // exact and the channel really does hold what the server sent.
    assert.ok(!FORGERY.includes("\\"), "precondition: the fixture has no literal backslash");
    const recovered = line
      .slice(line.indexOf("): ") + 3)
      .replace(/\\u0085/g, NEL)
      .replace(/\\u2029/g, PS)
      .replace(/\\u2028/g, LS)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r");
    assert.strictEqual(recovered, FORGERY, "the server's body is recoverable from the escaped copy");
    // The count is of what the server SENT, not of the escaped rendering.
    assert.strictEqual(
      Number(/\((\d+) chars\)/.exec(line)[1]),
      FORGERY.length,
      "the stated length must survive the escaping unchanged",
    );
  });
}

test("CLEAN [escapeBreaks]: every member of the break set is escaped, one at a time, including CRLF", async () => {
  const cases = [
    ["LF", "\n"],
    ["CR", "\r"],
    ["CRLF", "\r\n"],
    ["LS", LS],
    ["PS", PS],
    ["NEL", NEL],
  ];
  for (const [label, ch] of cases) {
    const body = `head${ch}[fngen] outcome=ok`;
    const { lines } = await run(ARMS[0], plain(500, body));
    const line = bodyLine(lines);
    assert.strictEqual(rows(line).length, 1, `${label} still breaks the row: ${JSON.stringify(line)}`);
    assert.ok(
      line.includes(escapeBreaks(body)),
      `${label} must render as its visible escape: ${JSON.stringify(line.slice(-60))}`,
    );
  }
  // CRLF is the one with a trap: two replacements in sequence must not eat one
  // another and leave a bare LF behind.
  const { lines } = await run(ARMS[0], plain(500, "a\r\nb"));
  assert.ok(bodyLine(lines).endsWith("a\\r\\nb"), "CRLF renders as both escapes, in order");
});

// --- The all-breaks body, after the order changed. -------------------------
//
// This row used to pin `kept + elided === N`, and that half is deliberately
// gone. `channelBodyLine` now escapes BEFORE bounding, so the cap applies to
// what the channel renders rather than to the body behind it. The trade, taken
// on 2026-08-22 after the six-times measurement below: a hard ceiling on the
// row beats a checkable identity between the two numbers, because the row is
// the surface the constant is named for and the multiplier was the server's to
// choose. What replaces the identity is not nothing - it is the same identity
// in the other unit, which the second row here pins exactly.

/** The parts of a raw-body line, for the rows that do arithmetic on it. */
function parts(line) {
  const at = line.indexOf("): ");
  const rendered = line.slice(at + 3);
  const note = / \[\+(\d+) chars elided\]$/.exec(rendered);
  return {
    stated: Number(/\((\d+) chars\)/.exec(line)[1]),
    kept: note ? rendered.length - note[0].length : rendered.length,
    elided: note ? Number(note[1]) : undefined,
  };
}

const BREAK_SET = [
  ["LF", "\n"],
  ["CR", "\r"],
  ["LS", LS],
  ["PS", PS],
  ["NEL", NEL],
];

test("CLEAN [escapeBreaks]: an all-breaks body is one row AND hard-bounded at the cap, for every break", async () => {
  // The assertion the six-times row wanted. Under the old order this failed at
  // 98372 characters for U+2028; measured now, every break lands within 73
  // characters of the cap, because the escape is charged against it.
  const widths = [];
  for (const [label, ch] of BREAK_SET) {
    const body = ch.repeat(CHANNEL_BODY_CHARS * 3 + 1);
    const line = bodyLine((await run(ARMS[0], plain(500, body))).lines);
    assert.strictEqual(rows(line).length, 1, `${label}: the degenerate body must not become N channel rows`);
    assert.ok(
      line.length <= CHANNEL_BODY_CHARS + 128,
      `${label}: the rendered row is ${line.length} chars against a ${CHANNEL_BODY_CHARS}-char cap. The ` +
        "cap is named for the channel and the channel's surface is the row; a break the server chooses " +
        "must not buy it more room than any other character.",
    );
    widths.push(line.length);
  }
  // The crisp form: the cheapest escape (2 chars) and the dearest (6) produce
  // the same row width. That is what "charged against the cap" means, and it is
  // the property a future edit to escapeBreaks would break first.
  assert.ok(
    Math.max(...widths) - Math.min(...widths) <= 8,
    `every break must cost the same at the ceiling, got ${JSON.stringify(widths)}`,
  );
});

test("CLEAN [escapeBreaks]: the stated length is raw, the note is escaped, and the second identity is exact", async () => {
  // ACCEPTED DIVERGENCE, pinned so the next reader finds the trade recorded
  // instead of rediscovering it as a bug. On a break-carrying body the line
  // carries two numbers in two units: `(N chars)` is what the SERVER sent, the
  // note is characters of the ESCAPED rendering that did not fit. So
  // `kept + elided === N` is false here, on purpose.
  //
  // It is not replaced by nothing. The identity still closes in the note's own
  // unit, and that is what makes the note checkable rather than decorative.
  const body = LS.repeat(CHANNEL_BODY_CHARS + 37);
  const line = bodyLine((await run(ARMS[0], plain(500, body))).lines);
  const p = parts(line);

  assert.strictEqual(p.stated, body.length, "`(N chars)` is still what the server sent, unescaped");
  assert.ok(p.elided !== undefined, `the cut must still be noted: ${line.slice(-80)}`);
  assert.notStrictEqual(
    p.kept + p.elided,
    p.stated,
    "precondition: this row exists to pin a DIVERGENCE. If the two numbers agree here, the order went " +
      "back to bound-first and the six-times ceiling came back with it.",
  );
  assert.strictEqual(
    p.kept + p.elided,
    escapeBreaks(body).length,
    "the note must close exactly against the ESCAPED length. Different units is the accepted cost; an " +
      "uncheckable number would not be, and a note nobody can verify is how a wrong one survives.",
  );
  assert.strictEqual(p.kept, CHANNEL_BODY_CHARS, "and what is kept is exactly the cap's worth of rendering");
});

test("CLEAN [escapeBreaks]: the common path keeps both numbers in the same unit", async () => {
  // The divergence above must not leak into the case that actually happens. A
  // real `{"error":...}` envelope carries no raw breaks, the escape is the
  // identity on it, and the two numbers agree exactly as they did before the
  // order changed.
  const body = JSON.stringify({ error: { message: "m".repeat(CHANNEL_BODY_CHARS * 2) } });
  assert.ok(!BREAK_SPLIT.test(body), "precondition: a JSON envelope carries no raw break");
  const line = bodyLine((await run(ARMS[0], plain(500, body))).lines);
  const p = parts(line);
  assert.strictEqual(p.stated, body.length);
  assert.strictEqual(
    p.kept + p.elided,
    p.stated,
    "on the common path the reader can still add the two numbers and get the body back",
  );
  assert.strictEqual(p.kept, CHANNEL_BODY_CHARS);
});

test("CLEAN [escapeBreaks]: the cut is not escape-aware, and that costs nothing that matters", async () => {
  // A consequence of the new order, found while re-cutting. The cap now falls
  // inside the ESCAPED string, so it can land mid-sequence: `U+2028` cut to
  // `\u20`, or a lone trailing backslash before the note. `boundTo` guards a
  // split surrogate pair and has no analogous guard here.
  //
  // Judged acceptable and pinned rather than fixed. A split escape renders as
  // legible ASCII immediately followed by the elision note, so it reads as what
  // it is - a cut - and it cannot do the two things that matter: it cannot
  // break the row and it cannot produce a product tag. Making the cut
  // escape-aware means teaching boundTo the escape vocabulary, which is more
  // machinery than a cosmetic tail is worth.
  let sawSplit = false;
  for (const [label, ch, width] of [["LF", "\n", 2], ["LS", LS, 6]]) {
    for (let off = 0; off < width; off++) {
      const body = "a".repeat(off) + ch.repeat(CHANNEL_BODY_CHARS);
      const line = bodyLine((await run(ARMS[0], plain(500, body))).lines);
      const p = parts(line);
      const tail = line.slice(line.indexOf("): ") + 3).replace(/ \[\+\d+ chars elided\]$/, "");
      if (tail.endsWith("\\") || /\\u\d{0,3}$/.test(tail)) {
        sawSplit = true;
      }
      assert.strictEqual(rows(line).length, 1, `${label} off=${off}: a split escape must not break the row`);
      assert.deepStrictEqual(
        rows(line).slice(1).filter((r) => PRODUCT_TAG.test(r)),
        [],
        `${label} off=${off}: a split escape must not produce a product tag`,
      );
      assert.ok(p.elided !== undefined, `${label} off=${off}: the cut is still announced`);
    }
  }
  assert.ok(
    sawSplit,
    "the row is vacuous unless the cut really does land mid-escape somewhere in the sweep; if this " +
      "fails, either boundTo grew an escape-aware guard (good, delete this row) or the sweep missed it",
  );
});

test("CLEAN [escapeBreaks]: a literal backslash-n is ambiguous with an escaped break, and costs no row", async () => {
  // The accepted cost of escaping without escaping the escape character. A body
  // containing the two characters \ and n renders identically to a body
  // containing a real newline. Escaping backslashes too would double every
  // `\"` and `\n` in the JSON error envelopes this line exists to show, which
  // is a worse trade for the diagnostic. What must NOT happen is a row break.
  const literal = await run(ARMS[0], plain(500, "A\\n[fngen] outcome=ok"));
  const real = await run(ARMS[0], plain(500, "A\n[fngen] outcome=ok"));
  const a = bodyLine(literal.lines);
  const b = bodyLine(real.lines);
  assert.strictEqual(rows(a).length, 1, "the literal case must not break the row either");
  assert.strictEqual(
    a.slice(a.indexOf("): ")),
    b.slice(b.indexOf("): ")),
    "documented: the escaped copies are identical, so a reader cannot tell the two bodies apart from " +
      "the text alone. The stated length differs by one (21 vs 20), which is a tell but not a reliable " +
      "one. Accepted: the property the escaping defends is the row count, and it holds in both.",
  );
});

// ===========================================================================
// WAS A DEFECT, NOW CLEAN. The escaped line could reach SIX times the cap.
//
// The first version of the escaping bounded the body and then escaped it, so
// the escape ran outside the cap. `\r` and `\n` cost two characters each, which
// is where the code's own "roughly twice" came from; U+2028, U+2029 and NEL
// cost SIX. Driven: a 16385-character all-U+2028 body produced a
// 98372-character single channel row from a 16384-character cap, a multiplier
// the server picks by choosing which break to send.
//
// Fixed by reversing the order rather than by correcting the comment, which is
// the right call: the constant is named for the channel, the channel's surface
// is the row, and a cap the row can exceed sixfold is the code not meaning its
// own name. The row is kept as the regression guard, because the failing
// direction is invisible from the source - both orders read as one expression.
// ===========================================================================

test("CLEAN [channelBodyLine]: the six-times overshoot is closed - no break buys extra room", async () => {
  const worst = LS.repeat(CHANNEL_BODY_CHARS + 1);
  const line = bodyLine((await run(ARMS[0], plain(500, worst))).lines);
  assert.strictEqual(rows(line).length, 1, "precondition: the escaping still holds, this row is about size");

  // The old failure, at its own numbers, so a regression reports as itself.
  assert.ok(
    line.length < CHANNEL_BODY_CHARS * 2,
    `the all-U+2028 row is ${line.length} chars against a ${CHANNEL_BODY_CHARS}-char cap. Bound-first ` +
      "renders this at six times the cap; escape-first renders it at one. If this is failing, the two " +
      "calls in channelBodyLine have swapped back.",
  );

  // The dear escape and the cheap one must land in the same place. A ceiling
  // that only held for LF would pass the assertion above and still let U+2028
  // through.
  const benign = "\n".repeat(CHANNEL_BODY_CHARS + 1);
  const benignLine = bodyLine((await run(ARMS[0], plain(500, benign))).lines);
  assert.ok(
    Math.abs(line.length - benignLine.length) <= 8,
    `a 6-char escape and a 2-char escape must produce the same row width, got ${line.length} vs ` +
      `${benignLine.length}. Different widths mean the escape is being paid for outside the cap again.`,
  );
});

// ===========================================================================
// DEFERRED, scrap S58-1. The generate throw site has TWO callers and only one
// is wired.
//
// THE DEFERRAL, written out rather than pointed at, because a deferral that is
// only a pointer loses its finding. Triage ruled this out of session-v58 on
// 2026-08-22 for four reasons, all of which I accept: the FIM path raises no
// toast promising the channel has more, so no user-facing sentence is false;
// `[fim] request failed:` already carries the bounded copy, so the failure is
// not invisible, only shortened; `goal.md`'s "what this session deliberately
// does not touch" list fences the FIM path, and a phase that reaches into it
// has misread its goal; and the wiring is small enough (a `log` on
// `FimGenerateParams`, one forward through `streamGenerate`'s seventh
// parameter, one call site in the FIM caller - three edits in two files) that
// deferring it costs the next session almost nothing.
//
// WHAT A LATER SESSION HAS TO KNOW. `generateFim` (`ollama.ts:94`) and
// `generateInstruct` (`:183`) both call `streamGenerate`, which owns the status
// throw the contract lists as `ollama.ts:317`. `generateInstruct` forwards
// `params.log` into the seventh parameter; `generateFim` passes nothing, so the
// sink is undefined and the raw body is dropped where the instruct path keeps
// it. The contract's site list names the throw statement, which made it read
// like one site; it is one statement with two callers. Anything that audits
// "every HTTP status site logs its raw body" by walking throw sites will keep
// reporting this one as done.
//
// SKIPPED, NOT INVERTED. Pinning today's behaviour ("the FIM path logs nothing")
// would turn red the day someone wires it, which punishes the fix. The
// assertion below is left exactly as it was written, so unskipping the row is
// the whole of the change when the wiring lands.
//
// The contract lists four sites, one of which is `ollama.ts:317`, inside
// `streamGenerate`. `streamGenerate` is reached from `generateInstruct` (which
// forwards `params.log`) and from `generateFim` (which does not). An ollama 500
// during FIM throws the identical string and leaves NOTHING on the channel.
//
// Lower stakes than the fn-gen path - a FIM failure raises no toast promising
// the channel has more - but C1 is unqualified about what an HTTP transport
// does with a non-ok response, and this is the same throw statement.
// ===========================================================================

test("WAS DEFERRED S58-1 [ollama-fim]: the FIM caller of the same throw site writes no raw-body line", async () => {
  const srv = await serve(plain(500, "fim-body-the-channel-never-sees"));
  const lines = [];
  let err;
  try {
    err = await caught(() =>
      generateFim({
        apiBase: srv.base,
        model: "fim-model",
        prefix: "let x = ",
        suffix: ";",
        maxTokens: 32,
        temperature: 0,
        signal: new AbortController().signal,
        log: (l) => lines.push(String(l)),
      }),
    );
  } finally {
    await srv.close();
  }
  assert.ok(String(err).includes("Ollama 500"), "precondition: the FIM path reached the status site");
  assert.ok(
    lines.some((l) => l.includes("fim-body-the-channel-never-sees")),
    "generateFim reaches the SAME throw statement generateInstruct does (streamGenerate's `if " +
      "(!res.ok)`), but passes no sink to streamGenerate, so the raw body is dropped on the floor. " +
      `The sink saw ${lines.length} line(s). One site, two callers, one of them wired.`,
  );
});

// ===========================================================================
// WAS DEFECT 4, NOW CLEAN. The arity dodge used to narrow C6 at one site.
//
// `pullModel`'s sink is a DEFAULTED parameter, not an optional one, so
// `Function.length` stays 4 for `blind5-pull.test.cjs:224`. A default fires for
// `undefined` and NOT for `null`, so with a bare `log(...)` one of the four
// sites turned a degenerate sink into a TypeError that REPLACED the server's
// own error - "log is not a function" instead of "Ollama 500 ...". C6: "the
// raw-body log is a best-effort diagnostic, never a dependency."
//
// Fixed by optional-chaining the defaulted parameter, which keeps the arity and
// removes the asymmetry. The row stays because the asymmetry is invisible from
// the type - `log` is not declared optional at this site and only this site -
// so the next edit here can reintroduce it without noticing.
// ===========================================================================

test("CLEAN [ollama-pull]: a null sink cannot destroy the server's error at any of the four sites", async () => {
  const srv = await serve(plain(500, "the provider's own words"));
  const results = {};
  try {
    results.generate = String(await caught(() => generateInstruct({ ...PARAMS(srv.base), log: null })));
    results.anthropic = String(
      await caught(() => makeAnthropicInstruct({ baseUrl: srv.base, apiKey: "k", log: null })(PARAMS(srv.base))),
    );
    results.cloud = String(
      await caught(() => makeCloudInstruct({ baseUrl: srv.base, apiKey: "k", log: null })(PARAMS(srv.base))),
    );
    results.pull = String(
      await caught(() => pullModel(srv.base, "m", new AbortController().signal, () => undefined, null)),
    );
  } finally {
    await srv.close();
  }
  // The three optional-chained sites: unchanged behaviour, as C6 requires.
  for (const site of ["generate", "anthropic", "cloud"]) {
    assert.ok(
      results[site].includes("the provider's own words"),
      `precondition [${site}]: the optional-chained sites keep the server's error: ${results[site]}`,
    );
  }
  assert.ok(
    results.pull.includes("the provider's own words"),
    "pullModel's sink is `log: (line) => void = () => undefined` so pullModel.length stays 4 for " +
      "blind5-pull.test.cjs's never-auto-pull row. A default fires on undefined and not on null, and " +
      "the call site is `log(...)` not `log?.(...)`, so this one site of the four loses the server's " +
      `error entirely: ${results.pull}. The other three, same input, same server, are fine. If the ` +
      "arity number must stay 4, `log?.()` at the call site costs nothing and removes the asymmetry.",
  );
});

// ===========================================================================
// WAS DEFECT 5, NOW CLEAN. errorBound's own doc used to send the next
// transport back into the bug.
//
// `safeText` is called by nothing in src/. Its doc block used to say it "stays
// exported because ... the next transport should take it rather than write a
// fourth copy". A transport that takes it reads the body ALREADY BOUNDED at 400
// and has nothing raw left to log - precisely the state C1 exists to end. The
// advice and the contract pointed in opposite directions, and the advice was
// the one sitting in the file a new transport author opens.
//
// Now the block names itself as the wrong shape and spells out the three-call
// recipe instead. The row stays as a live guard on a dead export: an unused
// function that recommends itself is how the defect comes back.
// ===========================================================================

test("CLEAN [errorBound]: the unused safeText no longer recommends itself to the next transport", () => {
  const leaf = fs.readFileSync(path.join(CORE, "errorBound.ts"), "utf8");
  const callers = fs
    .readdirSync(CORE)
    .filter((f) => f.endsWith(".ts") && f !== "errorBound.ts")
    .filter((f) => /\bsafeText\s*\(/.test(fs.readFileSync(path.join(CORE, f), "utf8")));
  assert.deepStrictEqual(callers, [], "precondition: nothing in src/core calls safeText any more");

  assert.ok(
    !/the next transport should take it/.test(leaf),
    "safeText is unreachable from every transport and its doc block still nominates it as the reader " +
      "the next transport should use. A transport that follows that advice bounds the body at " +
      `${ERROR_BODY_CHARS} chars at the READ and can never write the raw copy C1 requires - the exact ` +
      "defect roadmap item 69 just closed. The leaf's advice for a new HTTP transport is rawText + " +
      "channelBodyLine + boundBody, in that order.",
  );
});

// ===========================================================================
// WAS DEFECT 6, NOW CLEAN, AND WIDENED. firstRun's comment used to point a
// maintainer at a `[ollama-pull] http ...` channel line; the transport writes
// `[http-body] ollama-pull <status> server body (...)`. Nothing in the product
// ever emitted a line beginning `[ollama-pull]`.
//
// Re-cut to the general form the row was really after, because the narrow
// version only ever catches the cite it was written for. The vscode layer is
// the half that TELLS a support case which channel line to look for, and core
// is the half that writes them; a comment there naming a tag core does not emit
// is a stale cite whoever wrote it could not see. This version catches the next
// one too.
// ===========================================================================

test("CLEAN [src/vscode]: every channel tag a comment names is a tag some non-comment line in src emits", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.name.endsWith(".ts")) {
        files.push(p);
      }
    }
  };
  walk(SRC);

  const isComment = (line) => /^\s*(\/\/|\/?\*)/.test(line);
  // A tag is a bracketed lower-case token. The lookbehind drops the shapes that
  // are not channel tags and do occur in this repo's prose: a Rust attribute
  // (`#[attr]`), an escaped bracket, an index or a member access.
  const TAG = /(?<![#$\\\w.])\[([a-z][a-z0-9-]{2,})\]/g;

  // What the product can actually put at the head of a channel line: a bracketed
  // token at the START of a string or template literal, on a non-comment line.
  // Anchored to the quote deliberately - a looser scan swallows regex character
  // classes and index expressions, and an over-large "emitted" set is what would
  // let a genuinely stale cite through.
  const emitted = new Set();
  for (const p of files) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      if (isComment(line)) {
        continue;
      }
      for (const m of line.matchAll(/["'`]\[([a-z][a-z0-9-]{2,})\]/g)) {
        emitted.add(m[1]);
      }
    }
  }
  assert.ok(emitted.has("http-body"), `precondition: the scan found real emitters, got ${emitted.size}`);
  // The bound moves only when the PRODUCT gains a real channel tag, and by
  // exactly one when it does. Session-v61 added `[critique]`, so 19 became 20 and
  // the bound 20 became 21: the scan keeps the same one slot of slack it was
  // written with, and a loosened regex still trips it.
  assert.ok(
    emitted.size < 21,
    `precondition: the emitter scan must stay tight or the row cannot fail, got ${JSON.stringify([...emitted].sort())}`,
  );

  const stale = [];
  for (const p of files.filter((f) => f.includes(`${path.sep}vscode${path.sep}`))) {
    const rel = path.relative(ROOT, p);
    fs.readFileSync(p, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!isComment(line)) {
          return;
        }
        for (const m of line.matchAll(TAG)) {
          if (!emitted.has(m[1])) {
            stale.push(`${rel}:${i + 1} names [${m[1]}] - ${line.trim().slice(0, 110)}`);
          }
        }
      });
  }

  assert.deepStrictEqual(
    stale,
    [],
    "A comment in the vscode layer names a channel tag no non-comment line in src/ emits. That comment " +
      "is what a maintainer or a support case greps for, and it points at nothing:\n  " +
      stale.join("\n  ") +
      `\n\nTags the product really emits: ${JSON.stringify([...emitted].sort())}`,
  );
});

// ===========================================================================
// CLEAN probes. Every row below came back green; a clean probe is a result.
// ===========================================================================

// --- C2's docs clause, which the oracle explicitly could not assert. --------

test("CLEAN C2 [docs]: constants.md carries the cap, its real value, and admits it is a judgement call", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs", "constants.md"), "utf8");
  const row = doc.split("\n").find((l) => l.includes("`CHANNEL_BODY_CHARS`"));
  assert.ok(row, "C2 requires the value and its provenance in docs/constants.md");
  assert.ok(
    row.includes(String(CHANNEL_BODY_CHARS)),
    `the doc row must state the product's own value (${CHANNEL_BODY_CHARS}): ${row.slice(0, 200)}`,
  );
  assert.ok(/JUDGEMENT CALL/.test(row), "C2: 'it is a judgement call and must say so'");
  assert.ok(
    /NOTHING MEASURED IT|no corpus/i.test(row),
    "and the provenance must not overclaim: nothing on this box measured a real error-body distribution",
  );
});

// --- The dialect learn. The seam this phase could most easily have broken. --

test("CLEAN [cloud]: a 400 that TEACHES the dialect logs no channel line, and the retry still learns", async () => {
  // A bounded read here would hand the JSON parse a truncated document; a log
  // placed at the read would put a successful probe on the channel as a failure.
  const complaint = JSON.stringify({
    error: {
      message: "Unsupported parameter: 'max_tokens' is not supported with this model.",
      param: "max_tokens",
      echo: "p".repeat(ERROR_BODY_CHARS * 3),
    },
  });
  assert.ok(complaint.length > ERROR_BODY_CHARS, "the row is worthless unless the 400 is over budget");

  const bodies = [];
  const lines = [];
  const srv = await serve((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      if (bodies.length === 1) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(complaint);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n` +
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  try {
    await makeCloudInstruct({ baseUrl: srv.base, apiKey: "k", log: (l) => lines.push(String(l)) })(
      PARAMS(srv.base),
    );
  } finally {
    await srv.close();
  }
  assert.strictEqual(bodies.length, 2, "the 400 must still be retried in a learned dialect");
  assert.ok("max_completion_tokens" in bodies[1], "and the learn must survive the unbounded read");
  assert.deepStrictEqual(
    lines.filter((l) => l.startsWith("[http-body]")),
    [],
    "a dialect probe is not a failure; a channel line per successful probe is noise, not diagnostics",
  );
});

test("CLEAN [cloud]: a learnable 400 followed by a real 500 logs ONCE, and logs the SECOND body", async () => {
  const teach = JSON.stringify({ error: { message: "use max_completion_tokens", param: "max_tokens" } });
  const real = "the-second-failure-body";
  let n = 0;
  const lines = [];
  const srv = await serve((req, res) => {
    req.resume();
    req.on("end", () => {
      n += 1;
      if (n === 1) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(teach);
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(real);
    });
  });
  let err;
  try {
    err = await caught(() =>
      // A fresh model id, so the module-level learned-dialect cache cannot make
      // this row depend on which other row ran first.
      makeCloudInstruct({ baseUrl: srv.base, apiKey: "k", log: (l) => lines.push(String(l)) })({
        ...PARAMS(srv.base),
        model: `two-rejections-${Date.now()}`,
      }),
    );
  } finally {
    await srv.close();
  }
  assert.strictEqual(n, 2, "precondition: the provider rejected twice");
  const bodyLines = lines.filter((l) => l.startsWith("[http-body]"));
  assert.strictEqual(bodyLines.length, 1, `exactly one raw-body line: ${JSON.stringify(bodyLines)}`);
  assert.ok(bodyLines[0].includes(real), "and it is the SECOND, unlearnable body");
  assert.ok(!bodyLines[0].includes("max_completion_tokens"), "the teaching probe stays off the channel");
  assert.ok(String(err).includes(real), "the throw is the second failure too");
});

// --- The tag collision the phase changed [<transport>] to [http-body] for. --

test("CLEAN [anthropic]: the raw-body line does not join the per-round accounting count", async () => {
  const { lines } = await run(ARMS[2], plain(500, "z".repeat(2000)));
  const rounds = lines.filter((l) => l.trimStart().startsWith("[anthropic]"));
  assert.strictEqual(
    rounds.length,
    1,
    "blind-v44-anthropic.test.cjs:239 pins exactly one [anthropic] evidence line per round; a body " +
      `dump wearing that tag would be counted as a round. Got ${JSON.stringify(lines.map((l) => l.slice(0, 90)))}`,
  );
  assert.ok(lines.some((l) => l.startsWith("[http-body]")), "and the diagnostic is still there, under its own tag");
});

// --- The new params field, and where it must not go. -----------------------

test("CLEAN [all]: the log sink never reaches a request body", async () => {
  // A function on a params object that gets JSON.stringify'd is a silent drop;
  // one that reaches a provider is a shape error on every round.
  const seen = [];
  const srv = await serve((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push(raw);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("x");
    });
  });
  try {
    for (const arm of ARMS) {
      await caught(() => arm.drive(srv.base, () => undefined));
    }
  } finally {
    await srv.close();
  }
  assert.strictEqual(seen.length, ARMS.length, "every arm sent its request");
  for (const raw of seen) {
    assert.ok(!/"log"/.test(raw), `the sink leaked into a request body: ${raw.slice(0, 300)}`);
    const parsed = JSON.parse(raw);
    assert.ok(!("log" in parsed), `the sink leaked into a request body: ${raw.slice(0, 300)}`);
  }
});

test("CLEAN [params]: nothing in src serializes or deep-compares InstructGenerateParams", () => {
  // The field is a closure. JSON.stringify would drop it silently; a structural
  // equality would start failing. Neither happens: every body builder names its
  // fields explicitly rather than spreading params.
  const files = ["ollama.ts", "cloudInstruct.ts", "anthropicInstruct.ts", "claudeCodeInstruct.ts"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(CORE, f), "utf8");
    assert.ok(!/JSON\.stringify\(\s*params\s*\)/.test(src), `${f} serializes the params object wholesale`);
    assert.ok(!/\.\.\.\s*params\b/.test(src), `${f} spreads params into another object`);
  }
});

// --- The happy path the oracle skipped on the anthropic arm. ---------------

test("CLEAN [anthropic]: a successful Messages stream puts no response body on the channel", async () => {
  const SENTINEL = "ZZTOP-SENTINEL-anthropic-9f2c";
  const frames = [
    ["message_start", { message: { usage: { input_tokens: 1, output_tokens: 0 } } }],
    ["content_block_delta", { index: 0, delta: { type: "text_delta", text: SENTINEL } }],
    ["message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }],
    ["message_stop", {}],
  ];
  const srv = await serve((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [type, obj] of frames) {
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`);
    }
    res.end();
  });
  const lines = [];
  let out;
  try {
    out = await makeAnthropicInstruct({ baseUrl: srv.base, apiKey: "k", log: (l) => lines.push(String(l)) })(
      PARAMS(srv.base),
    );
  } finally {
    await srv.close();
  }
  assert.strictEqual(out.text, SENTINEL, "precondition: the happy path really ran");
  assert.deepStrictEqual(
    lines.filter((l) => l.includes(SENTINEL)),
    [],
    "a diagnostic that fires on every 200 is a worse channel than no diagnostic",
  );
});

// --- The cap's own arithmetic, past the oracle's one-over row. -------------

test("CLEAN [boundChannel]: a surrogate pair straddling the CHANNEL cap leaves no orphaned half", async () => {
  const body = `${"a".repeat(CHANNEL_BODY_CHARS - 1)}\u{1F600}${"b".repeat(50)}`;
  const { err, lines } = await run(ARMS[0], plain(500, body));
  const line = rawLine(lines, body, err);
  assert.ok(/\[\+\d+ chars elided\]/.test(line), "precondition: the cap actually fired");
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = line.charCodeAt(i + 1);
      assert.ok(next >= 0xdc00 && next <= 0xdfff, `orphaned high surrogate at ${i}`);
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      const prev = line.charCodeAt(i - 1);
      assert.ok(prev >= 0xd800 && prev <= 0xdbff, `orphaned low surrogate at ${i}`);
    }
  }
});

test("CLEAN [channelBodyLine]: the stated length is the RAW length, not the kept length", async () => {
  const body = "j".repeat(CHANNEL_BODY_CHARS * 3);
  const { err, lines } = await run(ARMS[0], plain(500, body));
  const line = rawLine(lines, body, err);
  const stated = /\((\d+) chars\)/.exec(line);
  assert.ok(stated, `the line must state a length: ${line.slice(0, 120)}`);
  assert.strictEqual(
    Number(stated[1]),
    body.length,
    "the channel must say how much the server SENT even when the cap ate most of it; a kept-length " +
      "here would make the cap invisible",
  );
  const note = / \[\+(\d+) chars elided\]$/.exec(line);
  assert.ok(note, "and the cut must be noted");
  assert.strictEqual(
    Number(note[1]) + CHANNEL_BODY_CHARS,
    body.length,
    "the note's arithmetic must close against the cap",
  );
});

// --- The arity contract blind5-pull depends on. ----------------------------

test("CLEAN [pullModel]: the published arity is still 4 and the fifth argument is genuinely optional", async () => {
  assert.strictEqual(pullModel.length, 4, "blind5-pull.test.cjs:224 reads this number");
  const srv = await serve(plain(500, "arity-probe"));
  try {
    // Four arguments: the never-auto-pull call shape every existing caller uses.
    const four = await caught(() => pullModel(srv.base, "m", new AbortController().signal, () => undefined));
    assert.ok(String(four).includes("arity-probe"), "the four-arg call still works");
    // Five: the sink runs.
    const lines = [];
    const five = await caught(() =>
      pullModel(srv.base, "m", new AbortController().signal, () => undefined, (l) => lines.push(String(l))),
    );
    assert.strictEqual(String(five), String(four), "the sink changes nothing about the throw");
    assert.ok(lines.some((l) => l.startsWith("[http-body] ollama-pull 500")), "and the sink saw the body");
  } finally {
    await srv.close();
  }
});

// ===========================================================================
// The vscode layer, end to end: the REAL offerModelPull, the REAL pullModel,
// a real 500. This is the only path in the product where the raw-body sink is
// an OutputChannel rather than a test array.
// ===========================================================================

const VS_TAG = "adv-v58-p1-vs";
const vsStub = path.join(__dirname, `.${VS_TAG}.stub.cjs`);
const vsEntry = path.join(__dirname, `.${VS_TAG}.entry.ts`);
const vsOut = path.join(__dirname, `.${VS_TAG}.bundle.cjs`);
let VS = {};
let vsErr;
try {
  const { STUB_SOURCE } = require("./.vscode-stub.cjs");
  fs.writeFileSync(
    vsStub,
    `${STUB_SOURCE}
// offerModelPull needs a ratified click, a progress host and a cancellation
// token; the shared stub has none of the three.
module.exports.ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
module.exports.window.showInformationMessage = async (m) => {
  (globalThis.__C80_INFO__ = globalThis.__C80_INFO__ || []).push(m);
  return globalThis.__C80_INFO_ANSWER__;
};
module.exports.window.withProgress = async (_opts, task) =>
  task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
`,
  );
  fs.writeFileSync(vsEntry, `export { offerModelPull } from "../src/vscode/firstRun";\n`);
  esbuild.buildSync({
    entryPoints: [vsEntry],
    bundle: true,
    outfile: vsOut,
    format: "cjs",
    platform: "node",
    alias: { vscode: vsStub },
    external: [vsStub],
  });
  VS = require(vsOut);
} catch (e) {
  vsErr = e;
}
test.after(() => {
  for (const f of [vsStub, vsEntry, vsOut]) fs.rmSync(f, { force: true });
});

test("CLEAN [firstRun end to end]: a 500 on a ratified pull puts the raw body on the OUTPUT CHANNEL, before the bounded line", async (t) => {
  if (vsErr) {
    assert.fail(`the vscode bundle did not build: ${vsErr}`);
  }
  globalThis.__C80_INFO_ANSWER__ = "Download";
  globalThis.__C80_WARNINGS__ = [];
  const body = `{"error":"${"b".repeat(3000)}"}`;
  const srv = await serve(plain(500, body));
  const lines = [];
  const output = { appendLine: (l) => lines.push(String(l)), append() {}, show() {}, clear() {}, dispose() {} };
  let landed;
  try {
    landed = await VS.offerModelPull(srv.base, "some-model", output, "the tier needs this model");
  } finally {
    await srv.close();
    globalThis.__C80_INFO_ANSWER__ = undefined;
  }
  assert.strictEqual(landed, false, "a failed pull reports the model as not landed");

  const rawIdx = lines.findIndex((l) => l.startsWith("[http-body] ollama-pull 500"));
  const failIdx = lines.findIndex((l) => l.startsWith("[carve] pull failed"));
  assert.ok(rawIdx >= 0, `the raw body must reach the channel: ${JSON.stringify(lines.map((l) => l.slice(0, 80)))}`);
  assert.ok(failIdx >= 0, "and the [carve] line must still be there");
  assert.ok(rawIdx < failIdx, "the transport logs at the moment the body arrives, before the caller's line");
  assert.ok(lines[rawIdx].includes(body), `C4: 3000 chars is inside the ${CHANNEL_BODY_CHARS}-char cap, so whole`);
  // And the toast's promise is now true: the channel outranks the notification.
  assert.ok(
    !lines[failIdx].includes(body),
    "precondition: the [carve] line carries the BOUNDED copy - that is the failure item 69 closes",
  );
  // RE-CUT, session-v59 phase 1. The locator used to be `/download failed/`,
  // which was the whole toast's opening. A 500 is a classified status now and
  // the download surface draws the same crafted sentence every other surface
  // draws for it, so those two words are gone. What this row was ever about is
  // the pointer, and the class sentence still carries it.
  const toast = (globalThis.__C80_WARNINGS__ || []).find((m) => /^Column 80: /.test(String(m)));
  assert.ok(toast && /output channel/.test(String(toast)), `the toast still points at the channel: ${toast}`);
  void t;
});
