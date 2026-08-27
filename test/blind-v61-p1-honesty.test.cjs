// BLIND ORACLE - session-v61 phase 1: the detector seam and the honesty block.
//
// Bound ONLY to session-v61/contracts/phase1-detector-seam.md. Nothing in this
// file was written against an implementation; the modules under test did not
// exist when it was authored. Where the contract is silent this file asserts
// nothing, and where the contract states a behaviour this file asserts the
// exact behaviour, not a range.
//
// The fixtures are function slices written the way a developer writes them, in
// all five languages, DOC COMMENT FIRST. That last part is load-bearing: the
// contract records that the scout's second rig sliced from the declaration head
// and read a real detector as 0.0%, and a slice that starts at the head cannot
// tell a doc example from a body statement.
//
// Three families of row, in order of how much they matter:
//
//   RECALL   - each of the four honesty dimensions firing in each of the five
//              languages. Twenty cells, one finding each, exact line and exact
//              evidence.
//   PRECISION- the same spellings buried in a line comment, a block comment, a
//              string literal and a doc example. All must be CLEAN. A detector
//              set that cannot stay quiet here is worthless at 3.6% signal.
//   QUIET    - the log writes. `println!`, `console.log`, `print(`,
//              `fmt.Println`, `Console.WriteLine`, `logger.info` are NOT world
//              reads. The contract measures "writes a log" at 16.1% of Python
//              functions and rules it out of the frame by name; if dimension 4
//              fires on one, the Python leg spends its whole budget telling
//              people their scripts print.
//
// And an ANTI-COLLAPSE CONTROL at the end, because a detector set reaches
// perfect quiet by doing nothing: a function that is blatantly dishonest in all
// four ways at once must flag all four, in every language.
//
// Run: node --test test/blind-v61-p1-honesty.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// Namespace imports rather than named re-exports: the contract assigns
// `docLines` to no module by name, so the seam is resolved by NAME across the
// three modules instead of by guessing which one holds it.
const { mod, cleanup } = bundleCore(
  "blind-v61-p1",
  `import * as criticizeTypes from "../src/core/criticizeTypes";
import * as criticizeLang from "../src/core/criticizeLang";
import * as criticizeHonesty from "../src/core/criticizeHonesty";
export { criticizeTypes, criticizeLang, criticizeHonesty };\n`,
);
test.after(cleanup);

const NAMESPACES = [mod.criticizeTypes, mod.criticizeLang, mod.criticizeHonesty];

function fromSeam(name) {
  for (const ns of NAMESPACES) {
    if (ns && ns[name] !== undefined) return ns[name];
  }
  throw new Error(`the detector seam exports no \`${name}\``);
}

const criticizeLangFor = fromSeam("criticizeLangFor");
const maskLine = fromSeam("maskLine");
const maskedBody = fromSeam("maskedBody");
const docLines = fromSeam("docLines");
const HONESTY_DETECTORS = fromSeam("HONESTY_DETECTORS");

// ===========================================================================
// Fixture machinery
// ===========================================================================

const LANGS = ["rust", "typescript", "csharp", "python", "go"];
const DISPLAY = {
  rust: "Rust",
  typescript: "TypeScript",
  csharp: "C#",
  python: "Python",
  go: "Go",
};
const HONESTY_DIMS = ["clock", "prng", "env", "world"];

const ALL_UNITS = [];

const at = (lines, re, what) => {
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) throw new Error(`fixture marker (${what}) not found: ${re}`);
  return i;
};

/**
 * Builds a FunctionUnderReview and checks the contract's own invariants on it,
 * so a broken fixture fails loudly here rather than showing up as a detector
 * defect three tests later.
 */
function mk(o) {
  const { languageId, name, lines, head, body, startLine, hit } = o;
  const headIndex = at(lines, head, "head");
  const bodyIndex = at(lines, body, "body");
  if (!(headIndex >= 0 && headIndex < bodyIndex && bodyIndex <= lines.length)) {
    throw new Error(`fixture ${name} violates 0 <= headIndex < bodyIndex <= lines.length`);
  }
  const u = { languageId, name, lines, startLine, headIndex, bodyIndex };
  u.hitIndex = hit === undefined ? -1 : at(lines, hit, "hit");
  ALL_UNITS.push(u);
  return u;
}

/** The plain FunctionUnderReview, with the fixture's own bookkeeping stripped. */
const unitOf = (u) => ({
  languageId: u.languageId,
  name: u.name,
  lines: u.lines,
  startLine: u.startLine,
  headIndex: u.headIndex,
  bodyIndex: u.bodyIndex,
});

function langFor(languageId) {
  const lang = criticizeLangFor(languageId);
  assert.ok(lang, `no CriticizeLang profile registered for ${languageId}`);
  return lang;
}

function detectorFor(dimension) {
  const found = HONESTY_DETECTORS.filter((d) => d.dimension === dimension);
  assert.equal(found.length, 1, `exactly one detector must own dimension ${dimension}`);
  return found[0];
}

function run(dimension, u) {
  return detectorFor(dimension).run(unitOf(u), langFor(u.languageId));
}

const show = (o) => JSON.stringify(o);

/**
 * Every structural rule the contract puts on DimensionOutcome and
 * DetectorFinding, applied to a single outcome. Called from every row.
 */
function assertOutcomeShape(outcome, dimension, u) {
  const where = `${DISPLAY[u.languageId]} ${u.name} / ${dimension}`;
  assert.ok(outcome && typeof outcome === "object", `${where}: outcome must be an object`);
  assert.ok(
    ["clean", "flagged", "blind"].includes(outcome.state),
    `${where}: state must be clean|flagged|blind, got ${show(outcome.state)}`,
  );

  if (outcome.state === "blind") {
    // The contract permits no blind leg in the honesty block, but if one ever
    // appears it refuses BY NAME or it is a defect.
    assert.equal(typeof outcome.reason, "string", `${where}: blind must carry a reason`);
    assert.ok(outcome.reason.trim().length > 0, `${where}: a blind outcome with an empty reason is a defect`);
    assert.ok(
      outcome.reason.includes(DISPLAY[u.languageId]),
      `${where}: a blind reason names the language, got ${show(outcome.reason)}`,
    );
    assert.ok(
      outcome.reason.trim().split(/\s+/).length >= 5,
      `${where}: a blind reason is a sentence naming the cause, got ${show(outcome.reason)}`,
    );
    return;
  }

  if (outcome.state === "clean") {
    assert.equal(outcome.findings, undefined, `${where}: a clean outcome carries no findings`);
    return;
  }

  const fs = outcome.findings;
  assert.ok(Array.isArray(fs), `${where}: flagged must carry a findings array`);
  assert.ok(fs.length > 0, `${where}: flagged with zero findings is a defect`);

  const seen = new Set();
  let previous = -Infinity;
  for (const f of fs) {
    assert.equal(f.dimension, dimension, `${where}: a finding carries its own dimension`);

    // line is a 1-based DOCUMENT line, and it lands inside the slice.
    assert.equal(typeof f.line, "number", `${where}: line is a number`);
    assert.ok(Number.isInteger(f.line), `${where}: line is an integer, got ${f.line}`);
    const index = f.line - u.startLine;
    assert.ok(
      index >= 0 && index < u.lines.length,
      `${where}: line ${f.line} is outside the slice [${u.startLine}, ${u.startLine + u.lines.length - 1}]`,
    );

    // None of the four reads the doc block. All four read maskedBody only, so
    // no honesty finding can sit above bodyIndex.
    assert.ok(
      index >= u.bodyIndex,
      `${where}: line ${f.line} sits at slice index ${index}, above bodyIndex ${u.bodyIndex} - dimensions 1-4 read maskedBody only`,
    );

    // evidence is the offending line itself, trimmed, never a summary.
    assert.equal(typeof f.evidence, "string", `${where}: evidence is a string`);
    assert.ok(f.evidence.length > 0, `${where}: empty evidence is never valid`);
    assert.equal(
      f.evidence,
      u.lines[index].trim(),
      `${where}: evidence must be the offending line trimmed`,
    );

    // detail: one line, lower case, no advice, never names a fix.
    assert.equal(typeof f.detail, "string", `${where}: detail is a string`);
    assert.ok(f.detail.trim().length > 0, `${where}: empty detail is not a detector's words`);
    assert.ok(!f.detail.includes("\n"), `${where}: detail is ONE line, got ${show(f.detail)}`);
    assert.equal(f.detail, f.detail.toLowerCase(), `${where}: detail is lower case, got ${show(f.detail)}`);
    assert.ok(
      !/\bshould\b|\bconsider\b|\buse |\binstead\b/i.test(f.detail),
      `${where}: detail never names a fix, got ${show(f.detail)}`,
    );

    // ordering and dedup
    assert.ok(f.line >= previous, `${where}: findings are ordered by line ascending, got ${show(fs.map((x) => x.line))}`);
    previous = f.line;
    const key = `${f.dimension}:${f.line}`;
    assert.ok(!seen.has(key), `${where}: a repeated (dimension, line) pair appears once, ${key} appears twice`);
    seen.add(key);
  }
}

function outcome(dimension, u) {
  const o = run(dimension, u);
  assertOutcomeShape(o, dimension, u);
  return o;
}

function assertClean(dimension, u, why) {
  const o = outcome(dimension, u);
  assert.equal(
    o.state,
    "clean",
    `${DISPLAY[u.languageId]} ${u.name}: ${dimension} must be clean - ${why} - got ${show(o)}`,
  );
}

function assertAllFourClean(u, why) {
  for (const dim of HONESTY_DIMS) assertClean(dim, u, why);
}

/** The single-finding recall shape: exactly one finding, on the hit line. */
function assertSingleHit(dimension, u) {
  const o = outcome(dimension, u);
  assert.equal(o.state, "flagged", `${DISPLAY[u.languageId]} ${u.name}: ${dimension} must fire - got ${show(o)}`);
  assert.equal(o.findings.length, 1, `${DISPLAY[u.languageId]} ${u.name}: exactly one ${dimension} finding, got ${show(o.findings)}`);
  const f = o.findings[0];
  assert.equal(f.line, u.startLine + u.hitIndex, `${DISPLAY[u.languageId]} ${u.name}: the finding's DOCUMENT line`);
  assert.equal(f.evidence, u.lines[u.hitIndex].trim(), `${DISPLAY[u.languageId]} ${u.name}: the finding's evidence`);
  for (const other of HONESTY_DIMS) {
    if (other !== dimension) assertClean(other, u, `only ${dimension} is present in this slice`);
  }
}

// ===========================================================================
// RECALL FIXTURES - 4 dimensions x 5 languages
// ===========================================================================

const clockRust = mk({
  languageId: "rust",
  name: "session_age",
  startLine: 41,
  lines: [
    "/// Returns how long the session has been open, in whole seconds.",
    "///",
    "/// The caller is expected to be holding the session lock.",
    "pub fn session_age(session: &Session) -> u64 {",
    "    let now = Instant::now();",
    "    now.duration_since(session.opened_at).as_secs()",
    "}",
  ],
  head: /^pub fn session_age/,
  body: /^    let now = Instant/,
  hit: /Instant::now/,
});

const clockTs = mk({
  languageId: "typescript",
  name: "stamp",
  startLine: 88,
  lines: [
    "/**",
    " * Stamps a raw event with the moment the gateway accepted it.",
    " *",
    " * @param event the event exactly as it arrived on the wire",
    " */",
    "export function stamp(event: RawEvent): StampedEvent {",
    "  const receivedAt = Date.now();",
    "  return { ...event, receivedAt };",
    "}",
  ],
  head: /^export function stamp/,
  body: /const receivedAt/,
  hit: /Date\.now/,
});

const clockCs = mk({
  languageId: "csharp",
  name: "Stamp",
  startLine: 210,
  lines: [
    "/// <summary>",
    "/// Stamps the audit row with the moment the change was accepted.",
    "/// </summary>",
    "public AuditRow Stamp(ChangeRequest change)",
    "{",
    "    var acceptedAt = DateTime.UtcNow;",
    "    return new AuditRow(change.Id, change.Author, acceptedAt);",
    "}",
  ],
  head: /^public AuditRow Stamp/,
  body: /var acceptedAt/,
  hit: /DateTime\.UtcNow/,
});

const clockPy = mk({
  languageId: "python",
  name: "session_age",
  startLine: 15,
  lines: [
    "def session_age(session):",
    '    """Return how long the session has been open, in whole seconds."""',
    "    now = datetime.now(timezone.utc)",
    "    return int((now - session.opened_at).total_seconds())",
  ],
  head: /^def session_age/,
  body: /^    now = datetime/,
  hit: /datetime\.now/,
});

const clockGo = mk({
  languageId: "go",
  name: "SessionAge",
  startLine: 33,
  lines: [
    "// SessionAge returns how long the session has been open, in whole seconds.",
    "func SessionAge(s *Session) int64 {",
    "\treturn time.Now().Unix() - s.OpenedAt.Unix()",
    "}",
  ],
  head: /^func SessionAge/,
  body: /return time\.Now/,
  hit: /time\.Now/,
});

const prngRust = mk({
  languageId: "rust",
  name: "pick_shard",
  startLine: 12,
  lines: [
    "/// Picks the shard that will take the next write.",
    "pub fn pick_shard(shards: &[Shard]) -> &Shard {",
    "    let index = thread_rng().gen_range(0..shards.len());",
    "    &shards[index]",
    "}",
  ],
  head: /^pub fn pick_shard/,
  body: /let index = thread_rng/,
  hit: /thread_rng/,
});

const prngTs = mk({
  languageId: "typescript",
  name: "correlationId",
  startLine: 5,
  lines: [
    "/** Returns a correlation id for a request that arrived without one. */",
    "export function correlationId(prefix: string): string {",
    "  const suffix = Math.random().toString(36).slice(2, 10);",
    '  return prefix + "-" + suffix;',
    "}",
  ],
  head: /^export function correlationId/,
  body: /const suffix/,
  hit: /Math\.random/,
});

const prngCs = mk({
  languageId: "csharp",
  name: "RetryDelay",
  startLine: 77,
  lines: [
    "/// <summary>Chooses a jittered retry delay so retries do not synchronise.</summary>",
    "public TimeSpan RetryDelay(int attempt)",
    "{",
    "    var jitter = new Random(attempt).NextDouble();",
    "    return TimeSpan.FromMilliseconds(100 * attempt * (1 + jitter));",
    "}",
  ],
  head: /^public TimeSpan RetryDelay/,
  body: /var jitter/,
  hit: /new Random/,
});

const prngPy = mk({
  languageId: "python",
  name: "pick_shard",
  startLine: 61,
  lines: [
    "def pick_shard(shards):",
    '    """Return the shard that will take the next write."""',
    "    return random.choice(shards)",
  ],
  head: /^def pick_shard/,
  body: /return random\.choice/,
  hit: /random\.choice/,
});

const prngGo = mk({
  languageId: "go",
  name: "PickShard",
  startLine: 90,
  lines: [
    "// PickShard returns the shard that will take the next write.",
    "func PickShard(shards []Shard) Shard {",
    "\treturn shards[rand.Intn(len(shards))]",
    "}",
  ],
  head: /^func PickShard/,
  body: /rand\.Intn/,
  hit: /rand\.Intn/,
});

const envRust = mk({
  languageId: "rust",
  name: "cache_dir",
  startLine: 7,
  lines: [
    "/// Resolves the directory the parse cache is written to.",
    "pub fn cache_dir() -> PathBuf {",
    '    let base = env::var("XDG_CACHE_HOME").unwrap_or_else(|_| "/tmp".to_owned());',
    '    PathBuf::from(base).join("column80")',
    "}",
  ],
  head: /^pub fn cache_dir/,
  body: /let base = env::var/,
  hit: /env::var/,
});

const envTs = mk({
  languageId: "typescript",
  name: "workspaceRoot",
  startLine: 120,
  lines: [
    "/** Resolves the workspace root the indexer should walk. */",
    "export function workspaceRoot(configured: string | undefined): string {",
    "  const fromEnvironment = process.env.COLUMN80_ROOT;",
    "  return configured ?? fromEnvironment ?? homedir();",
    "}",
  ],
  head: /^export function workspaceRoot/,
  body: /const fromEnvironment/,
  hit: /process\.env/,
});

const envCs = mk({
  languageId: "csharp",
  name: "ReportingConnection",
  startLine: 44,
  lines: [
    "/// <summary>Resolves the connection string for the reporting database.</summary>",
    "public string ReportingConnection()",
    "{",
    '    var overridden = Environment.GetEnvironmentVariable("REPORTING_CONNECTION");',
    "    return overridden ?? _options.DefaultConnection;",
    "}",
  ],
  head: /^public string ReportingConnection/,
  body: /var overridden/,
  hit: /Environment\.GetEnvironmentVariable/,
});

const envPy = mk({
  languageId: "python",
  name: "workspace_root",
  startLine: 8,
  lines: [
    "def workspace_root(configured=None):",
    '    """Return the directory the indexer should walk."""',
    '    from_environment = os.environ.get("COLUMN80_ROOT")',
    "    return configured or from_environment or str(Path.home())",
  ],
  head: /^def workspace_root/,
  body: /from_environment = os\.environ/,
  hit: /os\.environ/,
});

const envGo = mk({
  languageId: "go",
  name: "WorkspaceRoot",
  startLine: 51,
  lines: [
    "// WorkspaceRoot returns the directory the indexer should walk.",
    "func WorkspaceRoot() string {",
    '\tif root := os.Getenv("COLUMN80_ROOT"); root != "" {',
    "\t\treturn root",
    "\t}",
    "\treturn defaultRoot",
    "}",
  ],
  head: /^func WorkspaceRoot/,
  body: /os\.Getenv/,
  hit: /os\.Getenv/,
});

const worldRust = mk({
  languageId: "rust",
  name: "manifest_file",
  startLine: 63,
  lines: [
    "/// Opens the manifest that describes the workspace.",
    "pub fn manifest_file(root: &Path) -> Result<File, ConfigError> {",
    '    File::open(root.join("manifest.toml")).map_err(ConfigError::Io)',
    "}",
  ],
  head: /^pub fn manifest_file/,
  body: /File::open/,
  hit: /File::open/,
});

const worldTs = mk({
  languageId: "typescript",
  name: "loadConfig",
  startLine: 140,
  lines: [
    "/** Reads the on-disk config, or the defaults when there is no file. */",
    "export async function loadConfig(configPath: string): Promise<Config> {",
    '  const text = await fs.readFile(configPath, "utf8");',
    "  return JSON.parse(text) as Config;",
    "}",
  ],
  head: /^export async function loadConfig/,
  body: /fs\.readFile/,
  hit: /fs\.readFile/,
});

const worldCs = mk({
  languageId: "csharp",
  name: "StatementTemplate",
  startLine: 301,
  lines: [
    "/// <summary>Reads the handlebars template used to render a statement.</summary>",
    "public string StatementTemplate(string templateName)",
    "{",
    '    var path = Path.Combine(_templateRoot, templateName + ".hbs");',
    "    return File.ReadAllText(path);",
    "}",
  ],
  head: /^public string StatementTemplate/,
  body: /var path = Path\.Combine/,
  hit: /File\.ReadAllText/,
});

const worldPy = mk({
  languageId: "python",
  name: "load_config",
  startLine: 22,
  lines: [
    "def load_config(config_path):",
    '    """Return the parsed config, or the defaults when the file is absent."""',
    '    with open(config_path, encoding="utf-8") as handle:',
    "        return json.load(handle)",
  ],
  head: /^def load_config/,
  body: /with open\(/,
  hit: /with open\(/,
});

const worldGo = mk({
  languageId: "go",
  name: "LoadConfig",
  startLine: 180,
  lines: [
    "// LoadConfig returns the config parsed from the file at path.",
    "func LoadConfig(path string) (*Config, error) {",
    "\traw, err := os.ReadFile(path)",
    "\tif err != nil {",
    "\t\treturn nil, err",
    "\t}",
    "\tcfg := &Config{}",
    "\treturn cfg, json.Unmarshal(raw, cfg)",
    "}",
  ],
  head: /^func LoadConfig/,
  body: /os\.ReadFile/,
  hit: /os\.ReadFile/,
});

const RECALL = {
  clock: { rust: clockRust, typescript: clockTs, csharp: clockCs, python: clockPy, go: clockGo },
  prng: { rust: prngRust, typescript: prngTs, csharp: prngCs, python: prngPy, go: prngGo },
  env: { rust: envRust, typescript: envTs, csharp: envCs, python: envPy, go: envGo },
  world: { rust: worldRust, typescript: worldTs, csharp: worldCs, python: worldPy, go: worldGo },
};

// ===========================================================================
// PRECISION FIXTURES - the same spellings, masked
// ===========================================================================

const commentRust = mk({
  languageId: "rust",
  name: "normalise",
  startLine: 200,
  lines: [
    "/// Normalises a header row.",
    "pub fn normalise(row: &str) -> String {",
    "    // the first cut called Instant::now() here to time the parse,",
    "    // and seeded a thread_rng() from it,",
    '    // and read env::var("COLUMN80_DEBUG") and File::open(path) besides.',
    "    row.trim().to_ascii_lowercase()",
    "}",
  ],
  head: /^pub fn normalise/,
  body: /^    \/\/ the first cut/,
});

const commentTs = mk({
  languageId: "typescript",
  name: "normalise",
  startLine: 200,
  lines: [
    "/** Normalises a header row. */",
    "export function normalise(row: string): string {",
    "  // the first cut called Date.now() here to time the parse,",
    "  // and seeded it from Math.random(),",
    "  // and read process.env.DEBUG and fs.readFile(path) besides.",
    "  return row.trim().toLowerCase();",
    "}",
  ],
  head: /^export function normalise/,
  body: /^  \/\/ the first cut/,
});

const commentCs = mk({
  languageId: "csharp",
  name: "Normalise",
  startLine: 200,
  lines: [
    "/// <summary>Normalises a header row.</summary>",
    "public string Normalise(string row)",
    "{",
    "    // the first cut called DateTime.UtcNow here to time the parse,",
    "    // and seeded new Random() from it,",
    '    // and read Environment.GetEnvironmentVariable("DEBUG") and File.ReadAllText(path).',
    "    return row.Trim().ToLowerInvariant();",
    "}",
  ],
  head: /^public string Normalise/,
  body: /^    \/\/ the first cut/,
});

const commentPy = mk({
  languageId: "python",
  name: "normalise",
  startLine: 200,
  lines: [
    "def normalise(row):",
    '    """Return the row trimmed and lower-cased."""',
    "    # the first cut called datetime.now() here to time the parse,",
    "    # and seeded random.seed() from it,",
    '    # and read os.environ["DEBUG"] and open(path) besides.',
    "    return row.strip().lower()",
  ],
  head: /^def normalise/,
  body: /^    # the first cut/,
});

const commentGo = mk({
  languageId: "go",
  name: "Normalise",
  startLine: 200,
  lines: [
    "// Normalise returns the row trimmed and lower-cased.",
    "func Normalise(row string) string {",
    "\t// the first cut called time.Now() here to time the parse,",
    "\t// and seeded rand.Intn() from it,",
    '\t// and read os.Getenv("DEBUG") and os.ReadFile(path) besides.',
    "\treturn strings.ToLower(strings.TrimSpace(row))",
    "}",
  ],
  head: /^func Normalise/,
  body: /the first cut/,
});

const LINE_COMMENT_MASKED = [commentRust, commentTs, commentCs, commentPy, commentGo];

const blockRust = mk({
  languageId: "rust",
  name: "checksum",
  startLine: 400,
  lines: [
    "/// Returns a stable checksum for the payload.",
    "pub fn checksum(bytes: &[u8]) -> u32 {",
    "    /* the first cut seeded this from the wall clock:",
    "           let seed = Instant::now().elapsed().as_nanos() as u32;",
    "           let mut rng = thread_rng();",
    '           let salt = env::var("COLUMN80_SALT").unwrap();',
    '           let extra = File::open("salt.bin").unwrap();',
    "       which made the checksum differ between two runs of the same input. */",
    "    bytes.iter().fold(17u32, |acc, b| acc.wrapping_mul(31).wrapping_add(u32::from(*b)))",
    "}",
  ],
  head: /^pub fn checksum/,
  body: /the first cut seeded/,
});

const blockTs = mk({
  languageId: "typescript",
  name: "checksum",
  startLine: 400,
  lines: [
    "/** Returns a stable checksum for the payload. */",
    "export function checksum(bytes: Uint8Array): number {",
    "  /* the first cut seeded this from the wall clock:",
    "         const seed = Date.now();",
    "         const jitter = Math.random();",
    "         const salt = process.env.COLUMN80_SALT;",
    '         const extra = await fs.readFile("salt.bin");',
    "     which made the checksum differ between two runs of the same input. */",
    "  let acc = 17;",
    "  for (const b of bytes) acc = Math.imul(acc, 31) + b;",
    "  return acc >>> 0;",
    "}",
  ],
  head: /^export function checksum/,
  body: /the first cut seeded/,
});

const blockCs = mk({
  languageId: "csharp",
  name: "Checksum",
  startLine: 400,
  lines: [
    "/// <summary>Returns a stable checksum for the payload.</summary>",
    "public uint Checksum(byte[] bytes)",
    "{",
    "    /* the first cut seeded this from the wall clock:",
    "           var seed = DateTime.UtcNow.Ticks;",
    "           var jitter = new Random().Next();",
    '           var salt = Environment.GetEnvironmentVariable("COLUMN80_SALT");',
    '           var extra = File.ReadAllText("salt.bin");',
    "       which made the checksum differ between two runs of the same input. */",
    "    uint acc = 17;",
    "    foreach (var b in bytes) acc = (acc * 31) + b;",
    "    return acc;",
    "}",
  ],
  head: /^public uint Checksum/,
  body: /the first cut seeded/,
});

const blockGo = mk({
  languageId: "go",
  name: "Checksum",
  startLine: 400,
  lines: [
    "// Checksum returns a stable checksum for the payload.",
    "func Checksum(b []byte) uint32 {",
    "\t/* the first cut seeded this from the wall clock:",
    "\t       seed := time.Now().UnixNano()",
    "\t       nonce := rand.Int63()",
    '\t       salt := os.Getenv("COLUMN80_SALT")',
    '\t       extra, _ := os.ReadFile("salt.bin")',
    "\t   which made the checksum differ between two runs of the same input. */",
    "\tvar acc uint32 = 17",
    "\tfor _, c := range b {",
    "\t\tacc = acc*31 + uint32(c)",
    "\t}",
    "\treturn acc",
    "}",
  ],
  head: /^func Checksum/,
  body: /the first cut seeded/,
});

// Python has no block comment. Its equivalent shape is a string literal, and
// that is the string-literal row below, so nothing is asserted for it here.
const BLOCK_COMMENT_MASKED = [blockRust, blockTs, blockCs, blockGo];

const stringRust = mk({
  languageId: "rust",
  name: "explain",
  startLine: 500,
  lines: [
    "/// Returns the help text shown by the `--explain` flag.",
    "pub fn explain() -> String {",
    '    "column80 never calls Instant::now(), thread_rng(), env::var(SALT) or File::open(p)".to_owned()',
    "}",
  ],
  head: /^pub fn explain/,
  body: /column80 never calls/,
});

const stringTs = mk({
  languageId: "typescript",
  name: "explain",
  startLine: 500,
  lines: [
    "/** Returns the help text shown by the --explain flag. */",
    "export function explain(): string {",
    '  return "column80 never calls Date.now(), Math.random(), process.env.X or fs.readFile(p)";',
    "}",
  ],
  head: /^export function explain/,
  body: /column80 never calls/,
});

const stringCs = mk({
  languageId: "csharp",
  name: "Explain",
  startLine: 500,
  lines: [
    "/// <summary>Returns the help text shown by the --explain flag.</summary>",
    "public string Explain()",
    "{",
    '    return "column80 never calls DateTime.UtcNow, new Random(), Environment.GetEnvironmentVariable or File.ReadAllText";',
    "}",
  ],
  head: /^public string Explain/,
  body: /column80 never calls/,
});

const stringPy = mk({
  languageId: "python",
  name: "explain",
  startLine: 500,
  lines: [
    "def explain():",
    '    """Return the help text shown by the --explain flag."""',
    '    return "column80 never calls datetime.now(), random.choice(), os.environ or open(p)"',
  ],
  head: /^def explain/,
  body: /column80 never calls/,
});

const stringGo = mk({
  languageId: "go",
  name: "Explain",
  startLine: 500,
  lines: [
    "// Explain returns the help text shown by the --explain flag.",
    "func Explain() string {",
    '\treturn "column80 never calls time.Now(), rand.Intn(), os.Getenv or os.ReadFile"',
    "}",
  ],
  head: /^func Explain/,
  body: /column80 never calls/,
});

const STRING_MASKED = [stringRust, stringTs, stringCs, stringPy, stringGo];

const docExampleRust = mk({
  languageId: "rust",
  name: "trim_row",
  startLine: 600,
  lines: [
    "/// Trims a row.",
    "///",
    "/// # Examples",
    "///",
    "/// ```",
    "/// let started = Instant::now();",
    "/// let nonce = thread_rng().gen::<u64>();",
    '/// let root = env::var("COLUMN80_ROOT").unwrap();',
    '/// let handle = File::open("rows.csv").unwrap();',
    '/// assert_eq!(trim_row(" a "), "a");',
    "/// ```",
    "pub fn trim_row(row: &str) -> String {",
    "    row.trim().to_owned()",
    "}",
  ],
  head: /^pub fn trim_row/,
  body: /row\.trim\(\)\.to_owned/,
});

const docExampleTs = mk({
  languageId: "typescript",
  name: "trimRow",
  startLine: 600,
  lines: [
    "/**",
    " * Trims a row.",
    " *",
    " * @example",
    " * const started = Date.now();",
    " * const nonce = Math.random();",
    " * const root = process.env.COLUMN80_ROOT;",
    ' * const raw = await fs.readFile(root, "utf8");',
    " */",
    "export function trimRow(row: string): string {",
    "  return row.trim();",
    "}",
  ],
  head: /^export function trimRow/,
  body: /return row\.trim/,
});

const docExampleCs = mk({
  languageId: "csharp",
  name: "TrimRow",
  startLine: 600,
  lines: [
    "/// <summary>Trims a row.</summary>",
    "/// <example>",
    "/// <code>",
    "/// var started = DateTime.UtcNow;",
    "/// var nonce = new Random().Next();",
    '/// var root = Environment.GetEnvironmentVariable("COLUMN80_ROOT");',
    "/// var raw = File.ReadAllText(root);",
    "/// </code>",
    "/// </example>",
    "public string TrimRow(string row)",
    "{",
    "    return row.Trim();",
    "}",
  ],
  head: /^public string TrimRow/,
  body: /return row\.Trim/,
});

const docExamplePy = mk({
  languageId: "python",
  name: "trim_row",
  startLine: 600,
  lines: [
    "def trim_row(row):",
    '    """Trim a row.',
    "",
    "    Example:",
    "        >>> started = datetime.now(timezone.utc)",
    "        >>> nonce = random.random()",
    '        >>> root = os.environ["COLUMN80_ROOT"]',
    "        >>> handle = open(root)",
    '    """',
    "    return row.strip()",
  ],
  head: /^def trim_row/,
  body: /return row\.strip/,
});

const docExampleGo = mk({
  languageId: "go",
  name: "TrimRow",
  startLine: 600,
  lines: [
    "// TrimRow trims a row.",
    "//",
    "// Example:",
    "//",
    "//\tstarted := time.Now()",
    "//\tnonce := rand.Int63()",
    '//\troot := os.Getenv("COLUMN80_ROOT")',
    "//\traw, _ := os.ReadFile(root)",
    "func TrimRow(row string) string {",
    "\treturn strings.TrimSpace(row)",
    "}",
  ],
  head: /^func TrimRow/,
  body: /strings\.TrimSpace/,
});

const DOC_EXAMPLE_MASKED = [docExampleRust, docExampleTs, docExampleCs, docExamplePy, docExampleGo];

// ===========================================================================
// QUIET FIXTURES - log writes are not world reads
// ===========================================================================

const logRust = mk({
  languageId: "rust",
  name: "report_progress",
  startLine: 700,
  lines: [
    "/// Reports progress to the terminal and the log.",
    "pub fn report_progress(done: usize, total: usize) {",
    '    println!("{} of {} rows done", done, total);',
    '    eprintln!("still working");',
    '    log::info!("progress done={} total={}", done, total);',
    "}",
  ],
  head: /^pub fn report_progress/,
  body: /println!/,
});

const logTs = mk({
  languageId: "typescript",
  name: "reportProgress",
  startLine: 700,
  lines: [
    "/** Reports progress to the console and the output channel. */",
    "export function reportProgress(done: number, total: number): void {",
    '  console.log("%d of %d rows done", done, total);',
    '  console.error("still working");',
    '  logger.info("progress", { done, total });',
    "}",
  ],
  head: /^export function reportProgress/,
  body: /console\.log/,
});

const logCs = mk({
  languageId: "csharp",
  name: "ReportProgress",
  startLine: 700,
  lines: [
    "/// <summary>Reports progress to the console and the log.</summary>",
    "public void ReportProgress(int done, int total)",
    "{",
    '    Console.WriteLine($"{done} of {total} rows done");',
    '    Console.Error.WriteLine("still working");',
    '    _logger.LogInformation("progress {Done}/{Total}", done, total);',
    "}",
  ],
  head: /^public void ReportProgress/,
  body: /Console\.WriteLine/,
});

// The 16.1% row. "writes a log" is 16.1% of Python functions and the contract
// rules it out of the honesty frame by name; if dimension 4 fires here the
// Python leg spends its entire budget telling people their scripts print.
const logPy = mk({
  languageId: "python",
  name: "report_progress",
  startLine: 700,
  lines: [
    "def report_progress(done, total):",
    '    """Report progress to stdout and the log."""',
    '    print(f"{done} of {total} rows done")',
    '    logger.info("progress done=%s total=%s", done, total)',
    '    log.debug("still working")',
  ],
  head: /^def report_progress/,
  body: /print\(f/,
});

const logGo = mk({
  languageId: "go",
  name: "ReportProgress",
  startLine: 700,
  lines: [
    "// ReportProgress reports progress to stdout and the log.",
    "func ReportProgress(done, total int) {",
    '\tfmt.Println(done, "of", total, "rows done")',
    '\tfmt.Printf("%d/%d rows done\\n", done, total)',
    '\tlog.Printf("progress done=%d total=%d", done, total)',
    "}",
  ],
  head: /^func ReportProgress/,
  body: /fmt\.Println/,
});

const LOG_WRITERS = { rust: logRust, typescript: logTs, csharp: logCs, python: logPy, go: logGo };

// ===========================================================================
// DOC HARVESTER FIXTURES
// ===========================================================================

const docPyInsideBody = mk({
  languageId: "python",
  name: "settle_rows",
  startLine: 800,
  lines: [
    "def settle_rows(rows, ledger):",
    '    """Settle every row against the ledger.',
    "",
    "    Args:",
    "        rows: the rows to settle, oldest first.",
    "        ledger: the ledger they settle against.",
    "",
    "    Returns:",
    "        The rows that could not be settled.",
    '    """',
    "    unsettled = [row for row in rows if not ledger.accepts(row)]",
    "    return unsettled",
  ],
  head: /^def settle_rows/,
  body: /unsettled = \[row/,
});

const docPyOneLine = mk({
  languageId: "python",
  name: "pick_shard_doc",
  startLine: 810,
  lines: [
    "def pick_shard_doc(shards):",
    '    """Return the shard that will take the next write."""',
    "    return shards[0]",
  ],
  head: /^def pick_shard_doc/,
  body: /return shards\[0\]/,
});

// A `#` comment above a `def` is NOT a Python doc comment. A harvester that
// walks up from the signature finds nothing 68% of the time, and the zero it
// produces looks exactly like a real one - so the fixture that proves it does
// NOT walk up has to have something up there to find.
const docPyCommentAbove = mk({
  languageId: "python",
  name: "_normalise_rows",
  startLine: 820,
  lines: [
    "# Internal helper. Callers outside this module must not reach for it.",
    "def _normalise_rows(rows):",
    "    return [row.strip() for row in rows]",
  ],
  head: /^def _normalise_rows/,
  body: /return \[row\.strip/,
});

const docRust = mk({
  languageId: "rust",
  name: "settle_rows",
  startLine: 830,
  lines: [
    "/// Settles every row against the ledger.",
    "///",
    "/// Returns the rows that could not be settled.",
    "pub fn settle_rows(rows: &[Row], ledger: &Ledger) -> Vec<Row> {",
    "    rows.iter().filter(|r| !ledger.accepts(r)).cloned().collect()",
    "}",
  ],
  head: /^pub fn settle_rows/,
  body: /rows\.iter/,
});

const docTs = mk({
  languageId: "typescript",
  name: "settleRows",
  startLine: 840,
  lines: [
    "/**",
    " * Settles every row against the ledger.",
    " *",
    " * @returns the rows that could not be settled",
    " */",
    "export function settleRows(rows: Row[], ledger: Ledger): Row[] {",
    "  return rows.filter((row) => !ledger.accepts(row));",
    "}",
  ],
  head: /^export function settleRows/,
  body: /return rows\.filter/,
});

const docCs = mk({
  languageId: "csharp",
  name: "SettleRows",
  startLine: 850,
  lines: [
    "/// <summary>",
    "/// Settles every row against the ledger.",
    "/// </summary>",
    "/// <returns>The rows that could not be settled.</returns>",
    "public IReadOnlyList<Row> SettleRows(IReadOnlyList<Row> rows, Ledger ledger)",
    "{",
    "    return rows.Where(row => !ledger.Accepts(row)).ToList();",
    "}",
  ],
  head: /^public IReadOnlyList<Row> SettleRows/,
  body: /return rows\.Where/,
});

const docGo = mk({
  languageId: "go",
  name: "SettleRows",
  startLine: 860,
  lines: [
    "// SettleRows settles every row against the ledger and returns the rows",
    "// that could not be settled.",
    "func SettleRows(rows []Row, ledger *Ledger) []Row {",
    "\tvar unsettled []Row",
    "\tfor _, row := range rows {",
    "\t\tif !ledger.Accepts(row) {",
    "\t\t\tunsettled = append(unsettled, row)",
    "\t\t}",
    "\t}",
    "\treturn unsettled",
    "}",
  ],
  head: /^func SettleRows/,
  body: /var unsettled/,
});

// Go's doc is the comment IMMEDIATELY above, with no blank line between.
const docGoBlankLine = mk({
  languageId: "go",
  name: "Touch",
  startLine: 870,
  lines: [
    "// A note about the package that belongs to nothing in particular.",
    "",
    "func Touch(counter *int64) {",
    "\t*counter++",
    "}",
  ],
  head: /^func Touch/,
  body: /\*counter\+\+/,
});

const docNoneRust = mk({
  languageId: "rust",
  name: "touch",
  startLine: 880,
  lines: [
    "pub fn touch(counter: &mut u64) {",
    "    *counter += 1;",
    "}",
  ],
  head: /^pub fn touch/,
  body: /\*counter \+= 1/,
});

// ===========================================================================
// ORDERING, DEDUP AND PRECISION-OF-NAME FIXTURES
// ===========================================================================

const twoClocksOneLine = mk({
  languageId: "rust",
  name: "timed_parse",
  startLine: 900,
  lines: [
    "/// Parses the source and reports how long it took.",
    "pub fn timed_parse(src: &str) -> (Ast, Duration) {",
    "    let (start, checkpoint) = (Instant::now(), Instant::now());",
    "    let ast = parse(src);",
    "    (ast, checkpoint.duration_since(start))",
    "}",
  ],
  head: /^pub fn timed_parse/,
  body: /let \(start, checkpoint\)/,
  hit: /let \(start, checkpoint\)/,
});

const threeClocksThreeLines = mk({
  languageId: "rust",
  name: "timed_run",
  startLine: 910,
  lines: [
    "/// Runs both halves of the job and records when each one happened.",
    "pub fn timed_run(job: &Job) -> Timings {",
    "    let started = Instant::now();",
    "    job.first_half();",
    "    let midpoint = SystemTime::now();",
    "    job.second_half();",
    "    let finished = Instant::now();",
    "    Timings::new(started, midpoint, finished)",
    "}",
  ],
  head: /^pub fn timed_run/,
  body: /let started = Instant/,
});

const randomThingPy = mk({
  languageId: "python",
  name: "pick_with",
  startLine: 920,
  lines: [
    "def pick_with(rows, random_thing):",
    '    """Return the row the caller-supplied chooser selects."""',
    "    random_choice = random_thing(rows)",
    "    return random_choice",
  ],
  head: /^def pick_with/,
  body: /random_choice = random_thing/,
});

const randomThingRust = mk({
  languageId: "rust",
  name: "pick_with",
  startLine: 930,
  lines: [
    "/// Returns the row the caller-supplied chooser selects.",
    "pub fn pick_with(rows: &[Row], random_thing: impl Fn(&[Row]) -> usize) -> &Row {",
    "    let random_index = random_thing(rows);",
    "    &rows[random_index]",
    "}",
  ],
  head: /^pub fn pick_with/,
  body: /let random_index/,
});

// A URL inside a string literal contains `//`. A masker that treats the first
// `//` on the line as the start of a line comment blanks the rest of the line
// and the real clock read on it disappears.
const urlThenClockGo = mk({
  languageId: "go",
  name: "NewRequest",
  startLine: 940,
  lines: [
    "// NewRequest builds the outbound request for the reporting endpoint.",
    "func NewRequest(body []byte) *Request {",
    '\treturn New("http://reports.internal/v1/ingest", body, time.Now())',
    "}",
  ],
  head: /^func NewRequest/,
  body: /return New\(/,
  hit: /return New\(/,
});

// ===========================================================================
// ANTI-COLLAPSE CONTROL - dishonest in all four ways at once
// ===========================================================================

const collapseRust = mk({
  languageId: "rust",
  name: "build_report",
  startLine: 1000,
  lines: [
    "/// Builds the report for the current run.",
    "pub fn build_report(name: &str) -> Report {",
    "    let started = Instant::now();",
    "    let nonce = thread_rng().gen::<u64>();",
    '    let root = env::var("COLUMN80_ROOT").unwrap();',
    '    let template = File::open(Path::new(&root).join("report.hbs")).unwrap();',
    "    Report::new(name, started, nonce, template)",
    "}",
  ],
  head: /^pub fn build_report/,
  body: /let started = Instant/,
});

const collapseTs = mk({
  languageId: "typescript",
  name: "buildReport",
  startLine: 1000,
  lines: [
    "/** Builds the report for the current run. */",
    "export async function buildReport(name: string): Promise<Report> {",
    "  const startedAt = Date.now();",
    "  const nonce = Math.random();",
    '  const root = process.env.COLUMN80_ROOT ?? ".";',
    '  const template = await fs.readFile(root + "/report.hbs", "utf8");',
    "  return new Report(name, startedAt, nonce, template);",
    "}",
  ],
  head: /^export async function buildReport/,
  body: /const startedAt/,
});

const collapseCs = mk({
  languageId: "csharp",
  name: "BuildReport",
  startLine: 1000,
  lines: [
    "/// <summary>Builds the report for the current run.</summary>",
    "public Report BuildReport(string name)",
    "{",
    "    var startedAt = DateTime.UtcNow;",
    "    var nonce = new Random().Next();",
    '    var root = Environment.GetEnvironmentVariable("COLUMN80_ROOT") ?? ".";',
    '    var template = File.ReadAllText(Path.Combine(root, "report.hbs"));',
    "    return new Report(name, startedAt, nonce, template);",
    "}",
  ],
  head: /^public Report BuildReport/,
  body: /var startedAt/,
});

const collapsePy = mk({
  languageId: "python",
  name: "build_report",
  startLine: 1000,
  lines: [
    "def build_report(name):",
    '    """Build the report for the current run."""',
    "    started_at = datetime.now(timezone.utc)",
    "    nonce = random.random()",
    '    root = os.environ.get("COLUMN80_ROOT", ".")',
    '    with open(os.path.join(root, "report.hbs"), encoding="utf-8") as handle:',
    "        return Report(name, started_at, nonce, handle.read())",
  ],
  head: /^def build_report/,
  body: /started_at = datetime/,
});

const collapseGo = mk({
  languageId: "go",
  name: "BuildReport",
  startLine: 1000,
  lines: [
    "// BuildReport builds the report for the current run.",
    "func BuildReport(name string) (*Report, error) {",
    "\tstartedAt := time.Now()",
    "\tnonce := rand.Int63()",
    '\troot := os.Getenv("COLUMN80_ROOT")',
    '\ttemplate, err := os.ReadFile(filepath.Join(root, "report.hbs"))',
    "\tif err != nil {",
    "\t\treturn nil, err",
    "\t}",
    "\treturn NewReport(name, startedAt, nonce, template), nil",
    "}",
  ],
  head: /^func BuildReport/,
  body: /startedAt := time\.Now/,
});

const COLLAPSE = {
  rust: collapseRust,
  typescript: collapseTs,
  csharp: collapseCs,
  python: collapsePy,
  go: collapseGo,
};

// ===========================================================================
// THE SEAM
// ===========================================================================

test("seam: the five names the contract puts on the surface are exported and callable", () => {
  assert.equal(typeof criticizeLangFor, "function", "criticizeLangFor");
  assert.equal(typeof maskLine, "function", "maskLine");
  assert.equal(typeof maskedBody, "function", "maskedBody");
  assert.equal(typeof docLines, "function", "docLines");
  assert.ok(Array.isArray(HONESTY_DETECTORS), "HONESTY_DETECTORS is an array");
});

// ===========================================================================
// THE REGISTRY
// ===========================================================================

test("registry: five profiles register, with the display names the contract spells", () => {
  for (const id of LANGS) {
    const lang = criticizeLangFor(id);
    assert.ok(lang, `${id} must register a profile`);
    assert.equal(lang.displayName, DISPLAY[id], `${id} displayName`);
    assert.ok(Array.isArray(lang.languageIds), `${id} languageIds is an array`);
    assert.ok(lang.languageIds.includes(id), `${id} languageIds contains its own id`);
  }
});

test("registry: an unregistered languageId returns undefined so the caller can refuse by name", () => {
  for (const id of ["ruby", "java", "swift", "plaintext", "kotlin"]) {
    assert.equal(criticizeLangFor(id), undefined, `${id} must not resolve to a profile`);
  }
});

test("registry: javascript, typescriptreact and javascriptreact resolve to the TypeScript profile", () => {
  const base = criticizeLangFor("typescript");
  assert.ok(base, "typescript resolves");
  for (const alias of ["javascript", "typescriptreact", "javascriptreact"]) {
    const lang = criticizeLangFor(alias);
    assert.ok(lang, `${alias} must resolve`);
    assert.equal(lang.displayName, "TypeScript", `${alias} resolves to the TypeScript profile`);
    assert.deepEqual(
      [...lang.languageIds].sort(),
      [...base.languageIds].sort(),
      `${alias} and typescript share one profile`,
    );
  }
  for (const alias of ["typescript", "javascript", "typescriptreact", "javascriptreact"]) {
    assert.ok(base.languageIds.includes(alias), `the TypeScript profile claims ${alias}`);
  }
});

test("registry: every profile carries four non-empty honesty tables and a logWrites table", () => {
  for (const id of LANGS) {
    const lang = langFor(id);
    assert.ok(lang.honesty && typeof lang.honesty === "object", `${id} has an honesty table`);
    for (const dim of HONESTY_DIMS) {
      const table = lang.honesty[dim];
      assert.ok(Array.isArray(table), `${id}.honesty.${dim} is an array`);
      assert.ok(table.length > 0, `${id}.honesty.${dim} is not empty`);
      for (const re of table) {
        assert.ok(re instanceof RegExp, `${id}.honesty.${dim} holds RegExps, got ${show(re)}`);
      }
    }
    assert.ok(Array.isArray(lang.logWrites), `${id}.logWrites is an array`);
    assert.ok(lang.logWrites.length > 0, `${id}.logWrites is not empty`);
    for (const re of lang.logWrites) {
      assert.ok(re instanceof RegExp, `${id}.logWrites holds RegExps, got ${show(re)}`);
    }
  }
});

test("registry: lineComment is `#` for Python and `//` for the other four", () => {
  for (const id of LANGS) {
    const lang = langFor(id);
    assert.equal(lang.lineComment, id === "python" ? "#" : "//", `${id} lineComment`);
  }
});

// ===========================================================================
// THE DETECTOR SET
// ===========================================================================

test("detectors: HONESTY_DETECTORS is exactly the four honesty dimensions, once each", () => {
  const dims = HONESTY_DETECTORS.map((d) => d.dimension);
  assert.equal(HONESTY_DETECTORS.length, 4, `four honesty detectors, got ${show(dims)}`);
  assert.deepEqual([...dims].sort(), [...HONESTY_DIMS].sort(), "the four dimension ids");
});

test("detectors: every detector names its curriculum line and its axis", () => {
  for (const d of HONESTY_DETECTORS) {
    assert.equal(typeof d.source, "string", `${d.dimension}: source is a string`);
    assert.ok(d.source.trim().length > 0, `${d.dimension}: source is never empty`);
    assert.ok(
      ["safer", "understandable", "both"].includes(d.axis),
      `${d.dimension}: axis must be safer|understandable|both, got ${show(d.axis)}`,
    );
    assert.equal(typeof d.run, "function", `${d.dimension}: run is a function`);
  }
});

// ===========================================================================
// RECALL - 20 cells
// ===========================================================================

for (const dim of HONESTY_DIMS) {
  for (const id of LANGS) {
    const u = RECALL[dim][id];
    test(`recall: dimension ${dim} fires in ${DISPLAY[id]} (${u.name})`, () => {
      assertSingleHit(dim, u);
    });
  }
}

test("recall: the finding's line is a DOCUMENT line, so a slice moved down the file moves with it", () => {
  const low = clockRust;
  const high = { ...unitOf(clockRust), startLine: 12_040 };
  const lowLine = outcome("clock", low).findings[0].line;
  assert.equal(lowLine, low.startLine + low.hitIndex, "the slice at line 41");

  const o = detectorFor("clock").run(high, langFor("rust"));
  assert.equal(o.state, "flagged", "the same slice 12,000 lines down still fires");
  assert.equal(o.findings.length, 1, "still exactly one finding");
  assert.equal(o.findings[0].line, 12_040 + clockRust.hitIndex, "the line moved with startLine");
  assert.equal(o.findings[0].line - lowLine, 12_040 - low.startLine, "the offset is the startLine delta");
});

// ===========================================================================
// PRECISION - masking decides this whole subsystem
// ===========================================================================

for (const u of LINE_COMMENT_MASKED) {
  test(`masking: a clock/prng/env/world spelling inside a LINE COMMENT is clean (${DISPLAY[u.languageId]})`, () => {
    assertAllFourClean(u, "the spellings sit inside line comments");
  });
}

for (const u of BLOCK_COMMENT_MASKED) {
  test(`masking: spellings inside a multi-line BLOCK COMMENT are clean (${DISPLAY[u.languageId]})`, () => {
    assertAllFourClean(u, "the spellings sit inside a block comment that spans lines");
  });
}

for (const u of STRING_MASKED) {
  test(`masking: spellings inside a STRING LITERAL are clean (${DISPLAY[u.languageId]})`, () => {
    assertAllFourClean(u, "the spellings sit inside a string literal");
  });
}

for (const u of DOC_EXAMPLE_MASKED) {
  test(`masking: spellings inside a DOC EXAMPLE are clean (${DISPLAY[u.languageId]})`, () => {
    assertAllFourClean(u, "the spellings sit in the doc example, and dimensions 1-4 read maskedBody only");
  });
}

test("masking: a `//` inside a URL string does not swallow the real clock read on the same line", () => {
  assertSingleHit("clock", urlThenClockGo);
});

test("maskLine: a line comment is blanked and the column positions survive", () => {
  const rust = langFor("rust");
  const line = "    let rows = parse(src); // seeded from Instant::now() in the first cut";
  const masked = maskLine(line, rust);
  assert.equal(masked.length, line.length, "column width is preserved");
  assert.ok(!/Instant/.test(masked), `the comment text is gone, got ${show(masked)}`);
  assert.ok(masked.includes("let rows = parse(src);"), `the code before the comment survives, got ${show(masked)}`);
});

test("maskLine: a string literal is blanked and the code around it survives", () => {
  const rust = langFor("rust");
  const line = '    let message = "call Instant::now() for the time";';
  const masked = maskLine(line, rust);
  assert.equal(masked.length, line.length, "column width is preserved");
  assert.ok(!/Instant/.test(masked), `the string body is gone, got ${show(masked)}`);
  assert.ok(masked.includes("let message ="), `the code survives, got ${show(masked)}`);
});

test("maskLine: a char literal does not open a string and swallow the rest of the line", () => {
  const rust = langFor("rust");
  const line = "    let sep = ';'; let now = Instant::now();";
  const masked = maskLine(line, rust);
  assert.equal(masked.length, line.length, "column width is preserved");
  assert.ok(/Instant::now/.test(masked), `the code after the char literal survives, got ${show(masked)}`);
  assert.ok(!/;'/.test(masked.slice(16, 19)), `the char literal's own body is blanked, got ${show(masked)}`);
});

test("maskLine: Python's line comment is `#`, and `//` in Python is a floor division", () => {
  const py = langFor("python");
  const commented = '    rows = load(src)  # reads os.environ["DEBUG"] in the first cut';
  const maskedComment = maskLine(commented, py);
  assert.equal(maskedComment.length, commented.length, "column width is preserved");
  assert.ok(!/os\.environ/.test(maskedComment), `the comment is gone, got ${show(maskedComment)}`);
  assert.ok(maskedComment.includes("rows = load(src)"), "the code survives");

  const division = "    midpoint = (lo + hi) // 2 + int(time.time())";
  const maskedDivision = maskLine(division, py);
  assert.equal(maskedDivision.length, division.length, "column width is preserved");
  assert.ok(/time\.time/.test(maskedDivision), `\`//\` is not a comment in Python, got ${show(maskedDivision)}`);
});

test("maskedBody: index i corresponds to lines[bodyIndex + i], and the doc is not in it", () => {
  for (const u of [clockRust, clockTs, clockCs, clockPy, clockGo, docExamplePy]) {
    const body = maskedBody(unitOf(u), langFor(u.languageId));
    assert.ok(Array.isArray(body), `${DISPLAY[u.languageId]}: maskedBody returns an array`);
    assert.equal(
      body.length,
      u.lines.length - u.bodyIndex,
      `${DISPLAY[u.languageId]} ${u.name}: one masked line per body line`,
    );
    for (let i = 0; i < body.length; i += 1) {
      assert.equal(
        body[i].length,
        u.lines[u.bodyIndex + i].length,
        `${DISPLAY[u.languageId]} ${u.name}: masked line ${i} keeps its column width`,
      );
    }
  }
});

test("precision: a variable literally named `random_thing` is not a PRNG read", () => {
  assertAllFourClean(randomThingPy, "`random_thing` and `random_choice` are names, not `random.` calls");
  assertAllFourClean(randomThingRust, "`random_thing` and `random_index` are names, not `rand::random`");
});

// ===========================================================================
// QUIET - log writes are never world reads
// ===========================================================================

for (const id of LANGS) {
  const u = LOG_WRITERS[id];
  test(`quiet: a function that only writes a log never fires dimension world (${DISPLAY[id]})`, () => {
    assertClean("world", u, "a log write is not a world read; the contract rules it out by name");
    assertAllFourClean(u, "writing a log is not a dishonest signature in any dimension");
  });
}

test("quiet: the six log spellings the contract names are all silent", () => {
  const spellings = [
    ["rust", "println!", logRust],
    ["typescript", "console.log", logTs],
    ["python", "print(", logPy],
    ["go", "fmt.Println", logGo],
    ["csharp", "Console.WriteLine", logCs],
    ["typescript", "logger.info", logTs],
    ["python", "logger.info", logPy],
  ];
  for (const [id, spelling, u] of spellings) {
    assert.ok(
      u.lines.some((l) => l.includes(spelling)),
      `the ${DISPLAY[id]} fixture must actually contain \`${spelling}\` or this row proves nothing`,
    );
    assertClean("world", u, `\`${spelling}\` writes a log`);
  }
});

// ===========================================================================
// ORDERING AND DEDUP
// ===========================================================================

test("ordering: findings come back sorted by line ascending", () => {
  const o = outcome("clock", threeClocksThreeLines);
  assert.equal(o.state, "flagged", `three clock reads must fire - got ${show(o)}`);
  assert.equal(o.findings.length, 3, `one finding per clock line, got ${show(o.findings)}`);
  const lines = o.findings.map((f) => f.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b), `sorted ascending, got ${show(lines)}`);
  assert.deepEqual(
    lines,
    [
      threeClocksThreeLines.startLine + 2,
      threeClocksThreeLines.startLine + 4,
      threeClocksThreeLines.startLine + 6,
    ],
    "the three document lines",
  );
});

test("dedup: two clock reads on ONE line are one (dimension, line) pair", () => {
  assertSingleHit("clock", twoClocksOneLine);
  const evidence = outcome("clock", twoClocksOneLine).findings[0].evidence;
  assert.equal(
    (evidence.match(/Instant::now/g) || []).length,
    2,
    "the evidence still quotes the whole line, both reads included",
  );
});

// ===========================================================================
// THE DOC HARVESTER
// ===========================================================================

test("docLines: Python reads DOWNWARD - a docstring inside the body is the doc", () => {
  const docs = docLines(unitOf(docPyInsideBody), langFor("python"));
  assert.ok(Array.isArray(docs), "docLines returns an array");
  assert.ok(docs.length > 0, "a function with a docstring has a non-empty doc");
  const joined = docs.join("\n");
  assert.ok(joined.includes("Settle every row against the ledger"), `the summary line, got ${show(joined)}`);
  assert.ok(joined.includes("The rows that could not be settled"), `the Returns section, got ${show(joined)}`);
  for (const line of docs) {
    assert.ok(!line.includes('"""'), `the quote markers are stripped, got ${show(line)}`);
  }
});

test("docLines: a single-line Python docstring is harvested", () => {
  const docs = docLines(unitOf(docPyOneLine), langFor("python"));
  assert.equal(docs.length, 1, `one doc line, got ${show(docs)}`);
  assert.equal(docs[0].trim(), "Return the shard that will take the next write.", "the docstring text, markers stripped");
});

test("docLines: Python does NOT walk up - a `#` comment above the def is not the doc", () => {
  const docs = docLines(unitOf(docPyCommentAbove), langFor("python"));
  assert.deepEqual(
    [...docs],
    [],
    `a comment above a def is not a Python doc comment, got ${show(docs)}`,
  );
});

test("docLines: Rust reads UPWARD from `///`, markers stripped", () => {
  const docs = docLines(unitOf(docRust), langFor("rust"));
  assert.equal(docs.length, 3, `one entry per /// line, got ${show(docs)}`);
  assert.equal(docs[0].trim(), "Settles every row against the ledger.", "the summary line");
  assert.equal(docs[2].trim(), "Returns the rows that could not be settled.", "the closing line");
  for (const line of docs) assert.ok(!line.includes("///"), `markers stripped, got ${show(line)}`);
});

test("docLines: TypeScript reads UPWARD from `/** */`, markers and leading stars stripped", () => {
  const docs = docLines(unitOf(docTs), langFor("typescript"));
  assert.ok(docs.length > 0, "a /** */ block is a doc");
  const joined = docs.join("\n");
  assert.ok(joined.includes("Settles every row against the ledger."), `the summary line, got ${show(joined)}`);
  assert.ok(joined.includes("@returns the rows that could not be settled"), `the tag line, got ${show(joined)}`);
  for (const line of docs) {
    assert.ok(!line.includes("/**") && !line.includes("*/"), `block markers stripped, got ${show(line)}`);
    assert.ok(!line.trimStart().startsWith("*"), `the leading star is stripped, got ${show(line)}`);
  }
});

test("docLines: C# reads UPWARD from `///`, markers stripped and the XML kept", () => {
  const docs = docLines(unitOf(docCs), langFor("csharp"));
  assert.ok(docs.length > 0, "a /// block is a doc");
  const joined = docs.join("\n");
  assert.ok(joined.includes("Settles every row against the ledger."), `the summary text, got ${show(joined)}`);
  assert.ok(joined.includes("<summary>"), `the XML survives marker stripping, got ${show(joined)}`);
  for (const line of docs) assert.ok(!line.includes("///"), `markers stripped, got ${show(line)}`);
});

test("docLines: Go reads UPWARD from `//` immediately above the func", () => {
  const docs = docLines(unitOf(docGo), langFor("go"));
  assert.equal(docs.length, 2, `one entry per // line, got ${show(docs)}`);
  assert.ok(docs[0].trim().startsWith("SettleRows settles every row"), `the doc convention line, got ${show(docs[0])}`);
  for (const line of docs) assert.ok(!line.includes("//"), `markers stripped, got ${show(line)}`);
});

test("docLines: a Go comment separated from the func by a blank line is not its doc", () => {
  const docs = docLines(unitOf(docGoBlankLine), langFor("go"));
  assert.deepEqual([...docs], [], `a blank line severs the doc, got ${show(docs)}`);
});

test("docLines: a function with no doc at all returns []", () => {
  assert.deepEqual([...docLines(unitOf(docNoneRust), langFor("rust"))], [], "Rust with headIndex 0");
  assert.equal(docNoneRust.headIndex, 0, "headIndex 0 means no doc comment above");
});

// ===========================================================================
// ANTI-COLLAPSE CONTROL
// ===========================================================================
// A detector set reaches perfect quiet by doing nothing. Every precision row
// above passes on an empty implementation. These rows do not.

for (const id of LANGS) {
  const u = COLLAPSE[id];
  test(`anti-collapse: a function dishonest in all four ways flags all four (${DISPLAY[id]})`, () => {
    const flagged = [];
    for (const dim of HONESTY_DIMS) {
      const o = outcome(dim, u);
      assert.equal(
        o.state,
        "flagged",
        `${DISPLAY[id]} ${u.name}: ${dim} reads the ${dim} on its own line and must fire - got ${show(o)}`,
      );
      assert.ok(o.findings.length >= 1, `${DISPLAY[id]}: ${dim} flagged with a finding`);
      flagged.push(dim);
    }
    assert.deepEqual([...flagged].sort(), [...HONESTY_DIMS].sort(), "all four dimensions fired");
  });
}

test("anti-collapse: across every fixture in this file the detector set is neither silent nor indiscriminate", () => {
  let flaggedUnits = 0;
  let cleanUnits = 0;
  for (const u of ALL_UNITS) {
    let anyFlagged = false;
    for (const dim of HONESTY_DIMS) {
      if (outcome(dim, u).state === "flagged") anyFlagged = true;
    }
    if (anyFlagged) flaggedUnits += 1;
    else cleanUnits += 1;
  }
  // 25 recall + ordering/dedup + url + anti-collapse fixtures must flag;
  // every masking, log-write and doc fixture must not. Both halves must be
  // non-trivial or the set is doing nothing, or flagging everything.
  assert.ok(flaggedUnits >= 25, `the set must fire on the dishonest fixtures, fired on ${flaggedUnits}`);
  assert.ok(cleanUnits >= 25, `the set must stay quiet on the masked fixtures, quiet on ${cleanUnits}`);
});

// ===========================================================================
// GLOBAL SHAPE SWEEP
// ===========================================================================

test("shape: every outcome from every detector on every fixture honours the contract", () => {
  let checked = 0;
  for (const u of ALL_UNITS) {
    for (const dim of HONESTY_DIMS) {
      assertOutcomeShape(run(dim, u), dim, u);
      checked += 1;
    }
  }
  assert.equal(checked, ALL_UNITS.length * 4, "every fixture ran against all four detectors");
  assert.ok(ALL_UNITS.length >= 50, `the fixture set is the population under test, got ${ALL_UNITS.length}`);
});

test("shape: the honesty block never refuses - all four legs answer in all five languages", () => {
  // The contract's `blind` example is dimension 14 in TypeScript. Dimensions
  // 1 to 4 are Tier A: one build, five tables, and nothing in them can be
  // language-blind. A blind honesty outcome is a defect, and if one ever
  // appears assertOutcomeShape has already checked that it at least refuses
  // by name.
  for (const id of LANGS) {
    for (const dim of HONESTY_DIMS) {
      const o = run(dim, RECALL[dim][id]);
      assert.notEqual(
        o.state,
        "blind",
        `${DISPLAY[id]} ${dim}: the honesty block is Tier A and has no blind leg - got ${show(o)}`,
      );
    }
  }
});
