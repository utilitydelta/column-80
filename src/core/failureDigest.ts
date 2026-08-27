/**
 * What a repair round is SHOWN about a failing test run.
 *
 * PRICED on 40 real failures from a seeded defect in a production Rust crate,
 * tokens at chars/4:
 *
 *   the runner's output verbatim        4682
 *   all 40 test bodies                 24358
 *   test names plus doc comments        1268
 *   test names only                      442
 *   deduped shapes plus the location      60
 *
 * `injectedContext` stops are 600 / 1200 / 2400 / 4000, so the raw output fits
 * at NO stop and bodies are never affordable. The committed capture at
 * test/fixtures/rustc/assertion-panic.txt shows why the 60-token form loses
 * almost nothing: four distinct tests fail with the byte-identical message
 * `not implemented` from the byte-identical location `src/task10.rs:6:63`, and
 * every block repeats a `note: run with RUST_BACKTRACE` line that says nothing
 * about the code.
 *
 * THE ADAPTIVE RULE, which is what stops this being a fixed template: the richer
 * the failure message, the less the test source is worth. Spend on BREADTH of
 * distinct failures first and DEPTH on any one failure last.
 */

/** Where a failure surfaced, as the runner spelled it. */
export interface FailureLocation {
  /** Usually relative to the run root; kept exactly as the runner wrote it. */
  filePath: string;
  /** 1-based, as every runner reports it. */
  line: number;
  /** 1-based, when the runner gave one. */
  column?: number;
}

/** Per-framework: pull the failure LOCATION out of the free-text message.
 *  Declining is normal and SAFE. A wrong location is worse than none, because
 *  the renderer quotes the source line it names. */
export type LocationExtractor = (message: string) => FailureLocation | undefined;

/** Per-framework: drop the harness's OWN frames, leaving what the code under
 *  test said. Identity is a valid implementation. */
export type FrameStripper = (message: string) => string;

export interface FailureShape {
  /** The normalised key that grouped these. Not for display. */
  shape: string;
  /** One representative message, stripped, verbatim, for display. */
  representative: string;
  /** How many failing tests produced this shape. */
  count: number;
  /** The failing test names carrying this shape, in arrival order. */
  names: string[];
  /** Set ONLY when every failure in the shape agreed on one location. */
  location?: FailureLocation;
  /** The DISTINCT locations the members of this shape reported, in arrival
   *  order, capped. Present whenever at least one member yielded a location, so
   *  a shape whose members disagree still names WHERE it happened.
   *
   *  MEASURED on the committed capture: five failures share the message
   *  `not implemented` and come from TWO product lines, `src/task10.rs:6:63`
   *  and `src/task15.rs:8:41`. Keying the shape on the location would have split
   *  one bug report into two and, on the 40-failure corpus where every failure
   *  shares one line, changed nothing; withdrawing the location entirely, which
   *  the single-location rule does on its own, threw away the most useful field
   *  in the record. Both are kept: `location` for the unambiguous case that the
   *  renderer can quote a source line for, `locations` so a disagreeing shape is
   *  still placed. */
  locations?: FailureLocation[];
}

/** Two messages agreeing for this many characters are one shape for this
 *  purpose, and a key longer than this costs more to carry than it discriminates. */
const SHAPE_KEY_MAX = 400;

/** Distinct locations kept per shape. Three names the common disagreement (one
 *  message reached from a handful of product lines) without letting a message
 *  shared by forty different lines spend the breadth pass on addresses. */
const LOCATIONS_PER_SHAPE = 3;

/** A hook that throws is DECLINING, not failing the digest. A per-framework
 *  extractor is free text parsing over output nobody controls; one bad regex
 *  must not cost the whole round its evidence. */
function tryHook<T>(fn: (() => T) | undefined, fallback: T): T {
  if (fn === undefined) {
    return fallback;
  }
  try {
    const out = fn();
    return out === undefined ? fallback : out;
  } catch {
    return fallback;
  }
}

/** rustc, gotest, pytest and dotnet all put the location in a header or a frame
 *  the extractor has already read. Removing it before keying stops two failures
 *  at different lines from looking like different SHAPES when the only thing
 *  that differs is where they happened. */
const LOCATION_HEADER = /^\s*thread\s+'[^']*'(?:\s*\([^)]*\))?\s+panicked at\s+\S+?:\d+:\d+:\s*$/gm;

/** The shape key: the message with the noise that varies per RUN removed.
 *  Digits go because a count, an id, a pid and a byte offset are the things that
 *  differ between two instances of one bug. Nothing else is normalised: two
 *  messages differing in a WORD are two different failures, and collapsing them
 *  would hide the second one from the model entirely. */
function shapeKeyOf(stripped: string): string {
  const key = stripped
    .replace(LOCATION_HEADER, "")
    .replace(/0x[0-9a-fA-F]+/g, "0xH")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return key.length > SHAPE_KEY_MAX ? key.slice(0, SHAPE_KEY_MAX) : key;
}

function sameLocation(a: FailureLocation | undefined, b: FailureLocation | undefined): boolean {
  if (a === undefined || b === undefined) {
    return false;
  }
  return a.filePath === b.filePath && a.line === b.line && a.column === b.column;
}

export function digestFailures(
  failures: readonly { name: string; message: string }[],
  opts?: { strip?: FrameStripper; locate?: LocationExtractor },
): FailureShape[] {
  interface Bucket {
    shape: string;
    representative: string;
    names: string[];
    firstIndex: number;
    location: FailureLocation | undefined;
    /** False once two members disagree, which permanently withdraws the single
     *  location. The distinct list below survives the disagreement. */
    locationAgrees: boolean;
    locations: FailureLocation[];
  }
  const buckets = new Map<string, Bucket>();

  failures.forEach((failure, index) => {
    const raw = failure.message ?? "";
    // BOTH hooks read the RAW message, and they are independent transforms of
    // it. The extractor's job is to find the location wherever the runner put
    // it, and libtest puts it INSIDE the harness header that the stripper's job
    // is to remove: `thread 'x' (3740764) panicked at src/task15.rs:26:9:`.
    // Running the extractor on the stripped text made those two jobs fight, and
    // the loser was whichever one ran second.
    const location = tryHook<FailureLocation | undefined>(
      opts?.locate === undefined ? undefined : () => opts.locate!(raw),
      undefined,
    );
    const stripped = tryHook(opts?.strip === undefined ? undefined : () => opts.strip!(raw), raw);
    const shape = shapeKeyOf(stripped);
    const existing = buckets.get(shape);
    if (existing === undefined) {
      buckets.set(shape, {
        shape,
        representative: stripped,
        names: [failure.name],
        firstIndex: index,
        location,
        locationAgrees: true,
        locations: location === undefined ? [] : [location],
      });
      return;
    }
    existing.names.push(failure.name);
    if (
      location !== undefined &&
      existing.locations.length < LOCATIONS_PER_SHAPE &&
      !existing.locations.some((l) => sameLocation(l, location))
    ) {
      existing.locations.push(location);
    }
    if (existing.locationAgrees && !sameLocation(existing.location, location)) {
      // Two tests failing with the same message at DIFFERENT lines have no
      // single location, and naming one would point the model at a line that
      // is not where most of the failures came from. Withdrawn, not averaged.
      existing.locationAgrees = false;
      existing.location = undefined;
    }
  });

  return [...buckets.values()]
    .sort((a, b) => b.names.length - a.names.length || a.firstIndex - b.firstIndex)
    .map((b) => {
      const shape: FailureShape = {
        shape: b.shape,
        representative: b.representative,
        count: b.names.length,
        names: b.names,
      };
      if (b.locationAgrees && b.location !== undefined) {
        shape.location = b.location;
      }
      if (b.locations.length > 0) {
        shape.locations = b.locations;
      }
      return shape;
    });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface FailureEvidenceInput {
  shapes: readonly FailureShape[];
  /** The whole block's token allowance. */
  tokMax: number;
  /** The source line a location points at, plus a little context. Absent means
   *  locations are NAMED but never quoted. */
  readSourceLine?: (loc: FailureLocation) => { line: string; before?: string; after?: string } | undefined;
  /** A failing test's own doc comment, for priority 4. */
  docCommentFor?: (testName: string) => string | undefined;
  /** How many tests ran and how many passed, for the honest header. */
  ran: number;
  passed: number;
}

export type EvidencePriority = "shapes" | "locations" | "names" | "docs" | "body";

export interface FailureEvidence {
  /** The rendered section, or "" when there is nothing to say. */
  section: string;
  /** Estimated tokens spent, chars/4, the estimator the rest of the prompt uses. */
  spentTok: number;
  /** Failing test names the budget could not name. */
  droppedNames: number;
  /** Which priorities were reached, for the log line. */
  reached: EvidencePriority[];
}

/** chars/4, the same estimator every other budget in this codebase uses. */
const tok = (text: string): number => Math.ceil(text.length / 4);

/** A representative message is display detail, and one pathological panic dump
 *  must not eat the breadth pass it shares a budget with. */
const REPRESENTATIVE_MAX_CHARS = 600;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+$/, "");
  return t.length <= max ? t : `${t.slice(0, max)}\n... (truncated)`;
}

function locationText(loc: FailureLocation): string {
  return `${loc.filePath}:${loc.line}${loc.column === undefined ? "" : `:${loc.column}`}`;
}

/**
 * The prompt section, spent in strict priority order.
 *
 * BREADTH BEFORE DEPTH, and it is a pass structure rather than a per-shape loop
 * on purpose: every shape gets its count and representative before ANY shape
 * gets its location, and every shape gets its location before any name is
 * listed. A depth-first renderer would spend the whole budget describing the
 * first failure and never mention that there are two others.
 */
export function renderFailureEvidence(input: FailureEvidenceInput): FailureEvidence {
  const reached: EvidencePriority[] = [];
  if (input.shapes.length === 0) {
    // A repair round with no failure evidence is a compiler-only round and must
    // look EXACTLY like one, byte for byte.
    return { section: "", spentTok: 0, droppedNames: 0, reached };
  }

  const failed = input.shapes.reduce((n, s) => n + s.count, 0);
  // States what happened and claims nothing more. It does NOT say the function
  // is wrong: a red test is a divergence between two artefacts and which one is
  // wrong is not something a test run can settle.
  const header =
    `${failed} of ${input.ran} covering test(s) failed (${input.passed} passed). ` +
    `Each distinct failure below is followed by how many tests produced it.`;

  let budget = input.tokMax - tok(header);
  // STRICT priority, and `refused` is what makes it strict. Spending in
  // program order is not enough: once a priority-2 item has been refused for
  // budget, a CHEAPER priority-3 item must not slip in behind it, or the
  // renderer silently reorders the priorities by price. Measured by the blind
  // oracle at tokMax 71: shape 1 got its location and its names while shapes 2
  // and 3 had no location at all, which is exactly the depth-first spend the
  // adaptive rule forbids.
  let refused = false;
  const spend = (text: string): boolean => {
    const cost = tok(text);
    if (refused || cost > budget) {
      refused = true;
      return false;
    }
    budget -= cost;
    return true;
  };
  /** Open the next priority only if the current one completed. */
  const openNextPriority = (): boolean => !refused;

  // --- Priority 1: the distinct SHAPES, with a count each. ------------------
  const bodies = input.shapes.map(() => "");
  let anyShape = false;
  input.shapes.forEach((shape, i) => {
    const text = `\n\n[${shape.count} test(s)] ${clip(shape.representative, REPRESENTATIVE_MAX_CHARS)}`;
    if (spend(text)) {
      bodies[i] = text;
      anyShape = true;
    }
  });
  // A shape refused for budget does not stop the pass: breadth IS priority 1,
  // and the shapes that did fit are the breadth. It stops everything AFTER it.
  if (!anyShape) {
    // Not even one failure fits. Say the count rather than nothing: "3 tests
    // failed and I could not afford to tell you what they said" is honest, and
    // silence here would read as a clean run.
    return { section: header, spentTok: tok(header), droppedNames: failed, reached };
  }
  reached.push("shapes");

  // --- Priority 2: the LOCATION per shape, and the line it points at. -------
  const locations = input.shapes.map(() => "");
  let anyLocation = false;
  const locationsAllowed = openNextPriority();
  input.shapes.forEach((shape, i) => {
    if (!locationsAllowed) {
      return;
    }
    if (bodies[i] === "") {
      return;
    }
    const places = shape.location !== undefined ? [shape.location] : (shape.locations ?? []);
    if (places.length === 0) {
      return;
    }
    // The source line is quoted ONLY for an unambiguous location. With several,
    // naming them is honest and quoting one of them would suggest the failure
    // came from that one.
    const source =
      shape.location === undefined || input.readSourceLine === undefined
        ? undefined
        : tryHook(() => input.readSourceLine!(shape.location!), undefined);
    // Never the whole body, even when the location IS in a test file: one line
    // and a little context is what the location is for.
    const quoted =
      source === undefined
        ? ""
        : `\n${[source.before, source.line, source.after].filter((l) => l !== undefined && l !== "").join("\n")}`;
    const text = `\n  surfaced at ${places.map(locationText).join(", ")}${quoted}`;
    if (spend(text)) {
      locations[i] = text;
      anyLocation = true;
    }
  });
  if (anyLocation) {
    reached.push("locations");
  }

  // --- Priority 3: the NAMES of the failing tests, capped by the budget. ----
  const nameLines = input.shapes.map(() => "");
  let named = 0;
  const namedPerShape = input.shapes.map(() => [] as string[]);
  const namesAllowed = openNextPriority();
  input.shapes.forEach((shapeRow, i) => {
    if (!namesAllowed) {
      return;
    }
    if (bodies[i] === "") {
      return;
    }
    for (const name of shapeRow.names) {
      // Charged exactly as it will RENDER: the prefix once per shape, a comma
      // for every name after the first. An accounting that differs from the
      // render is a budget that does not bound the thing it claims to.
      const text = namedPerShape[i].length === 0 ? `\n  failing: ${name}` : `, ${name}`;
      if (!spend(text)) {
        return;
      }
      namedPerShape[i].push(name);
      named++;
    }
  });
  input.shapes.forEach((_shape, i) => {
    if (namedPerShape[i].length > 0) {
      nameLines[i] = `\n  failing: ${namedPerShape[i].join(", ")}`;
    }
  });
  if (named > 0) {
    reached.push("names");
  }

  // --- Priority 4: doc comments, only if the budget still reaches. ----------
  // 35% of the measured failing tests carry one, median 58 tokens, and a doc
  // comment states intent the name cannot.
  const docLines = input.shapes.map(() => "");
  let anyDoc = false;
  const docsAllowed = openNextPriority();
  if (input.docCommentFor !== undefined && docsAllowed) {
    input.shapes.forEach((_shape, i) => {
      for (const name of namedPerShape[i]) {
        const doc = tryHook<string | undefined>(() => input.docCommentFor!(name), undefined);
        if (doc === undefined || doc.trim().length === 0) {
          continue;
        }
        const text = `\n  ${name}: ${doc.trim().replace(/\s+/g, " ")}`;
        if (!spend(text)) {
          return;
        }
        docLines[i] += text;
        anyDoc = true;
      }
    });
  }
  if (anyDoc) {
    reached.push("docs");
  }

  // --- Priority 5: test BODIES. NOT IMPLEMENTED, deliberately. -------------
  // Measured at 24358 tokens for 40 tests, which fits at no stop, and the
  // adaptive rule says depth on one failure is the last thing worth buying.
  // `reached` can therefore never contain "body".

  const section = input.shapes
    .map((_, i) => (bodies[i] === "" ? "" : bodies[i] + locations[i] + nameLines[i] + docLines[i]))
    .join("");
  const full = header + section;
  const droppedNames = failed - named;
  return { section: full, spentTok: tok(full), droppedNames, reached };
}
