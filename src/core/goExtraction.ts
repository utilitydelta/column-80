/**
 * Go-shaped pure extraction helpers, the Go siblings of tsExtraction/
 * pyExtraction (extraction.ts's Rust parsers are pinned and never grow
 * language branches). Two jobs:
 *
 * 1. THE TWO-RULE FILTER (goMemberFromCompletionItem): gopls contaminates a
 *    member-site completion list with exactly two mechanically-separable
 *    shapes — postfix snippets (kind=Snippet, `var!`/`print!` labels) and
 *    deep completions (dotted/called labels like `band.Ceiling`,
 *    `NewStripe().Enroll`). Drop both; what remains is the complete member
 *    set (proven through embedded promotion, interface receivers,
 *    same-package unexported, third-party and stdlib on a broken unsaved
 *    buffer — gopls v0.23.0).
 *
 * 2. THE RECEIVER-SIBLING JOIN (goMembersFromDocumentSymbols): gopls names
 *    methods as TOP-LEVEL `(*Widget).Resize` documentSymbols, not children
 *    of their type. Parse the receiver out of the name prefix and join —
 *    Rust's sibling-join with a different name-parse. Fields are children
 *    of the struct node; interface methods are children of the interface.
 *
 * 3. THE COLUMN PAIR (reindentGoBody / dedentGoBody): the Go legs of the
 *    place-at-the-target's-column rule every other language already held.
 *    Go had neither, so a nested Go target took a flush-left body straight
 *    from the model, and Go repair only looked right by cancellation (the
 *    prompt showed file-indented code, the model echoed it, placement was a
 *    no-op). Fixing one direction without the other turns that cancellation
 *    into a visible bug, so both land together.
 */

import type { CompletionMember, DocumentSymbolLite, MemberKind, SourceCursor, TypeNameHint } from "./extraction";
import { dedentToZeroBase, replyBaseIndent, withoutBase } from "./reindent";

/** LSP CompletionItemKind values the mapper cares about. */
const COMPLETION_KIND_METHOD = 2;
const COMPLETION_KIND_FUNCTION = 3;
const COMPLETION_KIND_FIELD = 5;
const COMPLETION_KIND_SNIPPET = 15;

/** LSP SymbolKind values for the join. */
const SYMBOL_KIND_CLASS = 5;
const SYMBOL_KIND_METHOD = 6;
const SYMBOL_KIND_FIELD = 8;
const SYMBOL_KIND_INTERFACE = 11;
const SYMBOL_KIND_STRUCT = 23;

/** Go std-library type names the type-harvest scans stop at, spelled as the
 *  BARE last segment because that is what the PascalCase harvest yields from
 *  a qualified `time.Time`. Curated like TS_STD_TYPE_NAMES: the types real
 *  Go signatures actually carry, not the whole standard library — a name
 *  here can never be pre-filled as a user type, so breadth costs recall on
 *  user types that happen to share a std name. Single-letter names need no
 *  entry (the harvest excludes them wholesale). */
export const GO_STD_TYPE_NAMES = new Set<string>([
  // time
  "Time", "Duration", "Location", "Timer", "Ticker",
  // sync / sync-adjacent
  "Mutex", "RWMutex", "WaitGroup", "Once", "Cond", "Pool", "Locker",
  // context
  "Context", "CancelFunc",
  // io / bufio / bytes / strings
  "Reader", "Writer", "Closer", "ReadWriter", "ReadCloser", "WriteCloser",
  "ReadWriteCloser", "ReadSeeker", "Seeker", "Buffer", "Scanner", "Builder",
  // os / fs
  "File", "FileInfo", "FileMode", "DirEntry",
  // net / net/http / net/url
  "Conn", "Listener", "Addr", "IP", "Request", "Response", "Client",
  "Server", "Handler", "HandlerFunc", "ResponseWriter", "Cookie", "URL",
  // regexp / testing
  "Regexp",
]);

/** A bare Go identifier: unicode letter or `_` first, letters/digits/`_`
 *  after. Anything else — dotted, called, bang-suffixed, parenthesized —
 *  is not a member NAME and the gate must never present it as one. */
export function isPlainGoIdentifier(label: string): boolean {
  return /^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(label);
}

function mapGoCompletionKind(kind: number | undefined): MemberKind {
  switch (kind) {
    case COMPLETION_KIND_METHOD:
      return "method";
    case COMPLETION_KIND_FUNCTION:
      return "function";
    case COMPLETION_KIND_FIELD:
      return "field";
    default:
      return "other";
  }
}

/** `Enroll` + `func(byLod map[uint8][]Tile) (uint32, error)` renders as the
 *  member's own one-line declaration — name spliced over the `func` keyword
 *  so the injection payload never carries a bare name. A field's detail is
 *  its type; Go idiom is Name Type. */
function renderGoSignature(name: string, detail: string | undefined): string | undefined {
  if (detail === undefined || detail.length === 0) {
    return undefined;
  }
  const oneLine = detail.replace(/\s+/g, " ").trim();
  if (oneLine.startsWith("func(") || oneLine.startsWith("func (")) {
    return `${name}${oneLine.slice("func".length).trimStart()}`;
  }
  if (oneLine.startsWith("func[")) {
    // generic signature: func[T any](x T) T
    return `${name}${oneLine.slice("func".length)}`;
  }
  return `${name} ${oneLine}`;
}

/** The two-rule filter over one raw LSP completion item. undefined means
 *  DROPPED: a postfix snippet or a non-identifier label. Everything kept is
 *  a real member of the receiver — the complete-set property is what lets
 *  the member gate arm for Go at all. */
export function goMemberFromCompletionItem(item: {
  label: string;
  kind?: number;
  detail?: string;
}): CompletionMember | undefined {
  if (item.kind === COMPLETION_KIND_SNIPPET) {
    return undefined;
  }
  if (!isPlainGoIdentifier(item.label)) {
    return undefined;
  }
  return {
    name: item.label,
    signature: renderGoSignature(item.label, item.detail),
    kind: mapGoCompletionKind(item.kind),
  };
}

/** vscode CompletionItemKind -> the raw LSP number the two-rule filter speaks.
 *  vscode renumbers the LSP enum ONE LOWER across the board (Snippet 14 vs 15,
 *  Method 1 vs 2, Function 2 vs 3, Field 4 vs 5), so the product transport
 *  bridges through this and both transports share the ONE filter — a second
 *  vscode-numbered filter would be the drift the parity bar forbids. */
export function goVscodeCompletionKind(kind: unknown): number | undefined {
  return typeof kind === "number" ? kind + 1 : undefined;
}

/** `(*Stripe).Enroll` -> { receiver: "Stripe", member: "Enroll" };
 *  `(Tile).SubtendedChildren` -> { receiver: "Tile", ... };
 *  `(*Cache[K, V]).Get` -> { receiver: "Cache", ... }.
 *  undefined for anything that is not a parenthesized-receiver method name. */
export function parseGoReceiverSymbol(name: string): { receiver: string; member: string } | undefined {
  const m = /^\(\s*\*?\s*([\p{L}_][\p{L}\p{Nd}_]*)(?:\[[^\]]*\])?\s*\)\.(.+)$/u.exec(name);
  if (!m) {
    return undefined;
  }
  return { receiver: m[1], member: m[2] };
}

/** gopls hover markdown: a ```go fence holding the signature, then `---`
 *  separated prose, then (sometimes) a pkg.go.dev link section. The link is
 *  navigation, not doc prose — it never reaches a prompt. */
export function parseGoHover(markdownValue: string): { signature: string; doc?: string } | undefined {
  const fence = /```go\n([\s\S]*?)```/.exec(markdownValue);
  if (!fence) {
    return undefined;
  }
  const signature = fence[1].trim();
  if (signature.length === 0) {
    return undefined;
  }
  const afterFence = markdownValue.slice(fence.index + fence[0].length);
  const sections = afterFence
    .split(/\n-{3,}\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/pkg\.go\.dev/.test(s));
  const doc = sections.join("\n\n");
  return doc.length > 0 ? { signature, doc } : { signature };
}

/** What a Go documentSymbol node is to the receiver-sibling join. The
 *  DEFAULT speaks LSP SymbolKind (the headless gopls transport); the vscode
 *  product transport passes its own mapper because vscode renumbers the
 *  enum (Method 5, Struct 22, Interface 10 — off by one from LSP). */
export type GoSymbolRole = "container" | "method" | "field" | "other";

export function goLspSymbolRole(kind: unknown): GoSymbolRole {
  switch (typeof kind === "number" ? kind : -1) {
    case SYMBOL_KIND_STRUCT:
    case SYMBOL_KIND_INTERFACE:
    case SYMBOL_KIND_CLASS:
      return "container";
    case SYMBOL_KIND_METHOD:
      return "method";
    case SYMBOL_KIND_FIELD:
      return "field";
    default:
      return "other";
  }
}

/** vscode SymbolKind (0-indexed, the LSP number MINUS ONE) -> GoSymbolRole:
 *  the mapper the product transport passes, the pyVscodeSymbolRole sibling.
 *  Struct=22, Interface=10, and Class=4 (gopls's kind for a named non-struct
 *  type) are containers; Method=5; Field=7. No Property row for the same
 *  reason goLspSymbolRole has none — Go has no properties and gopls never
 *  reports the kind. */
export function goVscodeSymbolRole(kind: unknown): GoSymbolRole {
  switch (typeof kind === "number" ? kind : -1) {
    case 22: // Struct
    case 10: // Interface
    case 4: // Class
      return "container";
    case 5: // Method
      return "method";
    case 7: // Field
      return "field";
    default:
      return "other";
  }
}

/** The receiver-sibling join over a gopls documentSymbol response: the
 *  members of the type whose definition encloses `cursor`. Fields (and an
 *  interface's method set) are the container's children; methods are
 *  top-level `(*Type).Member` symbols joined by receiver name. gopls fills
 *  `detail` on both, so no hover fan-out is ever needed (the C# property). */
export function goMembersFromDocumentSymbols(
  symbols: unknown,
  cursor: SourceCursor,
  role: (kind: unknown) => GoSymbolRole = goLspSymbolRole,
): CompletionMember[] {
  if (!Array.isArray(symbols)) {
    return [];
  }
  const top = symbols as DocumentSymbolLite[];
  const container = top.find(
    (s) => s && role(s.kind) === "container" && (rangeContains(s.range, cursor) || rangeContains(s.selectionRange, cursor)),
  );
  if (!container || typeof container.name !== "string") {
    return [];
  }
  const typeName = container.name;
  const out: CompletionMember[] = [];
  for (const child of container.children ?? []) {
    if (!child || typeof child.name !== "string") {
      continue;
    }
    const childRole = role(child.kind);
    const detail = typeof child.detail === "string" ? child.detail : undefined;
    out.push({
      name: child.name,
      signature: renderGoSignature(child.name, detail),
      kind: childRole === "method" ? "method" : childRole === "field" ? "field" : "other",
    });
  }
  for (const s of top) {
    if (!s || typeof s.name !== "string" || role(s.kind) !== "method") {
      continue;
    }
    const parsed = parseGoReceiverSymbol(s.name);
    if (!parsed || parsed.receiver !== typeName) {
      continue;
    }
    const detail = typeof s.detail === "string" ? s.detail : undefined;
    out.push({
      name: parsed.member,
      signature: renderGoSignature(parsed.member, detail),
      kind: "method",
    });
  }
  return out;
}

function rangeContains(
  range: DocumentSymbolLite["range"],
  cursor: SourceCursor,
): boolean {
  if (!range) {
    return false;
  }
  const { start, end } = range;
  if (cursor.line < start.line || cursor.line > end.line) {
    return false;
  }
  if (cursor.line === start.line && cursor.character < start.character) {
    return false;
  }
  if (cursor.line === end.line && cursor.character > end.character) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The workspace-symbol resolution leg: a bare type NAME -> the cursor at its
// definition's name token, the anchor half. gopls's workspace/symbol answers
// the same shape Roslyn's does for C# (proven live against cobra: querying
// "Command" returns the struct at command.go:53, kind 23, first of 100 fuzzy
// hits) — but its containerName is NOT a display string the way Roslyn's is. It
// is the real Go import PATH ("github.com/spf13/cobra"), so unlike
// selectCsTypeCursor this never needs a hover round trip to disambiguate: the
// containerName already IS the thing a hint would otherwise be spent
// recovering.
// ---------------------------------------------------------------------------

/** One workspace/symbol hit reduced to what the by-name resolution leg needs.
 *  The Go sibling of CsSymbolCandidate — `containerName` differs in kind, not
 *  just in value: it is gopls's own import-path string, not a project display
 *  line, so it can be compared for equality directly wherever C#'s needs a
 *  hover first. */
export interface GoSymbolCandidate {
  name: string;
  role: GoSymbolRole;
  containerName: string;
  uri: string;
  line: number;
  character: number;
}

/** The exact-name TYPE hits (role "container": struct/interface/named
 *  non-struct type) among fuzzy workspace-symbol candidates, gopls's own
 *  ranking order preserved. Shared by the single-answer selection and the
 *  hint-disambiguated one, the CsSymbolCandidate sibling's shape. */
export function exactGoTypeHits(candidates: GoSymbolCandidate[], name: string): GoSymbolCandidate[] {
  return candidates.filter((c) => c.name === name && c.role === "container");
}

/** Pick the def cursor for a bare type NAME from workspace-symbol candidates.
 *  gopls's workspace/symbol is fuzzy the same way Roslyn's is — a query for
 *  "Command" also returns `getCommand`, `TestChildCommand`, every test naming
 *  it — so this narrows to the exact-name TYPE first. AMBIGUITY IS FATAL, not
 *  tiebroken, the same law selectCsTypeCursor enforces and for the same
 *  reason: two packages each declaring a same-named type have no textual way
 *  to say which one the caller meant, and guessing is the worse failure.
 *  Distinct packages are read directly off containerName, which for Go IS the
 *  import path — no display-string ambiguity to launder. undefined when no
 *  exact-name type exists or the name is genuinely ambiguous. */
export function selectGoTypeCursor(candidates: GoSymbolCandidate[], name: string): SourceCursor | undefined {
  const exact = exactGoTypeHits(candidates, name);
  if (exact.length === 0) {
    return undefined;
  }
  const packages = new Set(exact.map((c) => c.containerName));
  if (packages.size > 1) {
    return undefined; // ambiguous across packages — degrade, never guess
  }
  const chosen = exact[0];
  return { uri: chosen.uri, line: chosen.line, character: chosen.character };
}

/** `selectGoTypeCursor`, and then the ambiguity it refuses decided by
 *  EVIDENCE — the resolveCsTypeCursorWithHint sibling, cheaper: Go's
 *  containerName is already a real import path, so a hint is applied by
 *  direct comparison, never a hover fan-out.
 *
 *  `hint.container`: a package path (or its trailing segment, `spf13/cobra`
 *  for `github.com/spf13/cobra`) the caller already saw the name qualified
 *  by. `hint.fileText`: the buffer the name was written in — its own import
 *  block says which of the ambiguous packages it can even reach, the same
 *  reachability argument csFileReachesContainer makes for C#'s `using`s.
 *  Either way the survivors must agree on ONE package or this refuses,
 *  exactly as the selection would have. */
export function resolveGoTypeCursorWithHint(
  candidates: GoSymbolCandidate[],
  name: string,
  hint: TypeNameHint | undefined,
): SourceCursor | undefined {
  const unambiguous = selectGoTypeCursor(candidates, name);
  if (unambiguous !== undefined) {
    return unambiguous;
  }
  const hits = exactGoTypeHits(candidates, name);
  if (hits.length < 2) {
    return undefined;
  }
  const container = hint?.container;
  const fileText = hint?.fileText;
  if (container === undefined && fileText === undefined) {
    return undefined;
  }
  const reachablePaths = fileText !== undefined ? goImportedPackagePaths(fileText) : undefined;
  const survivors = hits.filter((h) => {
    if (container !== undefined && container !== "") {
      return h.containerName === container || h.containerName.endsWith(`/${container}`);
    }
    return reachablePaths !== undefined && reachablePaths.has(h.containerName);
  });
  const packages = new Set(survivors.map((s) => s.containerName));
  return packages.size === 1 ? { uri: survivors[0].uri, line: survivors[0].line, character: survivors[0].character } : undefined;
}

// ---------------------------------------------------------------------------
// The Go import block, parsed once and read two ways: the candidate half wants
// the local QUALIFIER a `pkg.Type` selector could mean (goImportedPackageNames);
// the anchor half above wants the real PACKAGE PATH a hint's own import block
// can reach (goImportedPackagePaths). One walk, both readers, so they can never
// disagree about what a file imports.
// ---------------------------------------------------------------------------

/** One import spec: the local alias if the source wrote one explicitly, and
 *  the package PATH gofmt always keeps quoted and alone on its own line
 *  inside a grouped `import ( ... )` block — unlike a Rust `use` group or a
 *  TS `import` clause, a Go import spec never wraps across lines, so no
 *  continuation-joining is needed here the way v34 had to add for those two. */
export interface GoImportSpec {
  /** The explicit local name (`flag` in `flag "github.com/spf13/pflag"`), or
   *  the side-effect/dot markers `_` / `.`. undefined means no alias was
   *  written and the default (the path's own last segment) applies. */
  alias?: string;
  path: string;
}

const GO_IMPORT_SPEC = /^\s*([A-Za-z_][A-Za-z0-9_]*|_|\.)?\s*"([^"]+)"/;

/** Every import spec in the file, single-line (`import "fmt"` /
 *  `import alias "path"`) and grouped (`import (\n\t"fmt"\n\tflag "..."\n)`)
 *  alike, in source order. */
export function goImportSpecs(fullText: string): GoImportSpec[] {
  const specs: GoImportSpec[] = [];
  const addSpec = (line: string) => {
    const m = GO_IMPORT_SPEC.exec(line);
    if (!m) {
      return;
    }
    specs.push(m[1] !== undefined ? { alias: m[1], path: m[2] } : { path: m[2] });
  };
  const lines = fullText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^import\s*\(/.test(trimmed)) {
      let j = i + 1;
      for (; j < lines.length && !lines[j].trim().startsWith(")"); j++) {
        addSpec(lines[j]);
      }
      i = j;
      continue;
    }
    const single = /^import\s+(.+)$/.exec(trimmed);
    if (single) {
      addSpec(single[1]);
    }
  }
  return specs;
}

/** The full package PATHS this file imports — what a hint's own buffer can
 *  actually reach (`resolveGoTypeCursorWithHint`'s fileText leg). Blank (`_`)
 *  and dot (`.`) imports still name a real path the file depends on, so they
 *  stay in — only the QUALIFIER leg below has a reason to drop them. */
export function goImportedPackagePaths(fullText: string): Set<string> {
  return new Set(goImportSpecs(fullText).map((s) => s.path));
}

/** The local identifiers a `pkg.Type` selector in this file could legally
 *  mean, one per import: the explicit alias when the source wrote one, else
 *  the path's own default — its last `/`-segment, skipping a bare major-
 *  version segment (`.../chroma/v2` -> `chroma`, the Go modules spec's own
 *  convention for a `/vN` suffix) and a `gopkg.in`-style `name.vN` leaf
 *  (`yaml.v2` -> `yaml`). A blank (`_`) or dot (`.`) import contributes no
 *  qualifier: a `_`-imported package is never referenced by name, and a dot
 *  import puts its names in scope UNQUALIFIED, a different (unsupported) leg.
 *
 *  This is the piece typesFromUses / tsTypesFromImports have no Go/C# analog
 *  for: a Go import spells a PATH, never a type, so nothing here yields a
 *  type name by itself. It only answers "is this qualifier real", which is
 *  what goTypesFromQualifiedUsage needs to tell a real package selector
 *  (`cobra.Command`) from a local variable's field (`resp.StatusCode`). */
export function goImportedPackageNames(fullText: string): Set<string> {
  const names = new Set<string>();
  for (const spec of goImportSpecs(fullText)) {
    if (spec.alias === "_" || spec.alias === ".") {
      continue;
    }
    if (spec.alias !== undefined) {
      names.add(spec.alias);
      continue;
    }
    const segs = spec.path.split("/");
    let last = segs[segs.length - 1];
    if (segs.length > 1 && /^v[2-9][0-9]*$/.test(last)) {
      last = segs[segs.length - 2];
    }
    const gopkgVersioned = /^([A-Za-z][A-Za-z0-9]*)\.v[0-9]+$/.exec(last);
    names.add(gopkgVersioned ? gopkgVersioned[1] : last);
  }
  return names;
}

// ---------------------------------------------------------------------------
// The Go column pair, modelled on the TS one (advanceTsLineScan) because Go's
// cross-line shapes are the same two: a backtick-delimited literal that CAN
// span lines, and a `/* */` block comment. The differences are small and both
// matter here. Go's block comments do NOT nest (Rust's do), so one boolean is
// enough. An interpreted `"..."` string cannot span a line (a newline inside is
// a compile error), so it carries no cross-line state; a rune literal `'x'`
// closes on its own line for the same reason. Only the raw string freezes a
// line: its bytes, newlines and leading tabs included, are the string's VALUE.
// ---------------------------------------------------------------------------

interface GoLineScan {
  raw: boolean; // inside a `...` raw string literal spanning lines
  block: boolean; // inside a /* ... */ block comment spanning lines
}

// Advances `s` across one line and returns the index where that line's `//`
// comment starts, or -1 when the line carries none. The index is what the def
// elider needs and the re-indenters ignore: both want the SAME scanner, because
// a second one would disagree about a `//` inside a raw-string struct tag.
function advanceGoLineScan(line: string, s: GoLineScan): number {
  const n = line.length;
  let i = 0;
  while (i < n) {
    if (s.block) {
      const end = line.indexOf("*/", i);
      if (end < 0) {
        return -1; // block comment continues to the next line
      }
      s.block = false;
      i = end + 2;
      continue;
    }
    if (s.raw) {
      // A raw string has no escapes at all: the first backtick closes it.
      const end = line.indexOf("`", i);
      if (end < 0) {
        return -1; // raw string continues to the next line
      }
      s.raw = false;
      i = end + 1;
      continue;
    }
    const c = line[i];
    const c2 = line[i + 1];
    if (c === "/" && c2 === "/") {
      return i; // line comment: the rest of the line is inert
    }
    if (c === "/" && c2 === "*") {
      s.block = true;
      i += 2;
      continue;
    }
    if (c === "`") {
      s.raw = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++; // an interpreted string or rune literal closes on this line
      while (i < n) {
        if (line[i] === "\\") {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return -1;
}

/** Re-indent a generated Go definition so a nested target's body lands at the
 *  right column. Same contract as reindentTsBody: line 1 (the header) is kept,
 *  every later code line gets `indent` prepended, a blank line stays blank, a
 *  line inside a raw string is byte-exact, and `indent === ""` (a top-level
 *  target) returns the text unchanged, byte for byte. */
export function reindentGoBody(generated: string, indent: string): string {
  if (indent === "") {
    return generated;
  }
  const lines = generated.split("\n");
  const s: GoLineScan = { raw: false, block: false };
  // The reply's own base column, off before the target's goes on: see reindent.ts.
  const base = replyBaseIndent(lines);
  const out: string[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (s.raw || line.trim() === "") {
      out.push(line);
    } else if (n === 0) {
      out.push(withoutBase(line, base));
    } else {
      out.push(indent + withoutBase(line, base));
    }
    advanceGoLineScan(line, s);
  }
  return out.join("\n");
}

/** Normalise Go code read out of a document to its own column zero, the inverse
 *  of reindentGoBody. A line inside a raw string is byte-exact, decided by the
 *  SAME scan the re-indent leg uses, so the two directions can never disagree
 *  about which bytes are a string's value. */
export function dedentGoBody(code: string, known?: string): string {
  const lines = code.split("\n");
  const s: GoLineScan = { raw: false, block: false };
  const byteExact: boolean[] = [];
  for (const line of lines) {
    // The state ENTERING the line, exactly as reindentGoBody reads it: the scan
    // advances only after the line has been classified.
    byteExact.push(s.raw);
    advanceGoLineScan(line, s);
  }
  return dedentToZeroBase(lines, byteExact, known).join("\n");
}

// ---------------------------------------------------------------------------
// 4. THE DEF ELIDER (goElideDef): what a gopls type hover costs a prompt.
//
// gopls hovers a struct as its declaration WITH the source's own doc comments
// and its own layout chrome appended to the header:
//
//     type Command struct { // size=728 (0x2d8), class=768 (0x300)
//         // Use is the one-line usage message.
//         // Recommended syntax is as follows:
//         ...eight more lines of prose...
//         Use string
//
// Measured on the v23 corpus with a live gopls: `cobra.Command` hovers at 8363
// bytes, of which 6419 are chrome, doc prose and the blank lines that separate
// the prose blocks. The field lines - the only part a model can type against -
// are 1944. Nothing in the prompt reads a byte offset or a struct's size class,
// so the chrome is pure cost.
//
// The elider is LINE-based on purpose. A field whose type is a func carries its
// own commas (`PersistentPreRunE func(cmd *Command, args []string) error`) and
// any comma-splitting parse of a Go struct body cuts that field in half.
// ---------------------------------------------------------------------------

/** What `goElideDef` removed from one hover, in bytes, by class. The three
 *  byte counts sum to `beforeBytes - afterBytes` exactly: an audit of the
 *  diagnostic channel has to be able to add them up. `keptBodyLines` is the
 *  count that says nothing typeable was lost - a field line is never dropped,
 *  so this is a truncation-free elision, not a cut. */
export interface GoDefElision {
  text: string;
  beforeBytes: number;
  afterBytes: number;
  /** gopls's own `// size=...` layout chrome. */
  chromeBytes: number;
  /** Doc comments and trailing field comments: prose. */
  proseBytes: number;
  proseLines: number;
  /** Blank lines that existed only to separate a dropped prose block. */
  blankBytes: number;
  /** Lines kept between the header and the closing brace, blanks excluded. */
  keptBodyLines: number;
}

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

/** Strip a gopls type hover down to its declaration and its field lines.
 *
 *  Removed: the `// size=...` chrome, every whole-line comment, every trailing
 *  `//` comment, and blank lines that only separated a removed comment block.
 *  Kept, byte for byte: every field line, embedded fields, nested anonymous
 *  struct bodies, gopls's own column alignment, and blank lines that separate
 *  fields rather than prose.
 *
 *  A hover with no comments and no chrome comes back byte-identical. */
export function goElideDef(signature: string): GoDefElision {
  const before = bytes(signature);
  const lines = signature.split("\n");
  const kept: string[] = [];
  const scan: GoLineScan = { raw: false, block: false };
  let chromeBytes = 0;
  let proseBytes = 0;
  let proseLines = 0;
  let blankBytes = 0;
  // A dropped line costs its own bytes plus the newline that followed it; the
  // final line of the hover has none. A hover ends with `}`, so this only bites
  // a degenerate input, and it keeps the three counts summing exactly.
  const cost = (line: string, index: number): number => bytes(line) + (index === lines.length - 1 ? 0 : 1);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inBlockComment = scan.block;
    const at = advanceGoLineScan(line, scan);
    const trimmed = line.trim();
    // A `/* ... */` block is prose only while it owns the WHOLE line. A line
    // that closes a block and then declares a field, or opens one after a
    // field, keeps its bytes: leaving a stray comment in is a cost, dropping a
    // field is a lie, and this elider promises no field is ever cut. Go writes
    // doc comments with `//` and every hover measured on the corpus does too,
    // so this branch is the unusual shape, not the common one.
    const blockClose = inBlockComment ? line.indexOf("*/") : -1;
    const wholeLineComment =
      (inBlockComment && (blockClose < 0 || line.slice(blockClose + 2).trim().length === 0)) ||
      trimmed.startsWith("//") ||
      (trimmed.startsWith("/*") && scan.block);
    if (wholeLineComment) {
      proseBytes += cost(line, i);
      proseLines++;
      // The blank line above a doc block belongs to the block. Popping it keeps
      // fields adjacent instead of leaving the gaps the prose used to fill;
      // a blank that separates FIELDS has no comment after it and survives.
      while (kept.length > 0 && kept[kept.length - 1].trim().length === 0) {
        blankBytes += bytes(kept.pop() as string) + 1;
      }
      continue;
    }
    if (at < 0) {
      kept.push(line);
      continue;
    }
    const comment = line.slice(at);
    const head = line.slice(0, at).replace(/\s+$/, "");
    const dropped = bytes(line.slice(0, at)) - bytes(head) + bytes(comment);
    if (/^\/\/\s*size=/.test(comment)) {
      chromeBytes += dropped;
    } else {
      proseBytes += dropped;
      proseLines++;
    }
    kept.push(head);
  }

  const text = kept.join("\n");
  // Body lines: everything kept except the declaration line and the closing
  // brace, blanks excluded. This is the number that says the elision cut no
  // surface, so it counts what is LEFT rather than what went.
  const keptBodyLines = kept
    .slice(1)
    .filter((l) => l.trim().length > 0 && l.trim() !== "}").length;
  return {
    text,
    beforeBytes: before,
    afterBytes: bytes(text),
    chromeBytes,
    proseBytes,
    proseLines,
    blankBytes,
    keptBodyLines,
  };
}

/** The diagnostic-channel line for one elided Go def.
 *
 *  Wording is core's job, not the adapter's, because the line has ONE job
 *  beyond naming the bytes: a reader auditing the channel must be able to tell
 *  it from a truncation. So it says which CLASSES of bytes went, says how many
 *  field lines survived, and never uses the word the caps use when a real
 *  surface is cut - `truncated` in this channel means a cap ate something a
 *  model needed, and grepping for it must not turn up this line. */
export function goElisionLogLine(typeName: string, e: GoDefElision): string {
  return (
    `[go-shape] \`${typeName}\` def elided ${e.beforeBytes - e.afterBytes}B of gopls chrome and doc prose ` +
    `(${e.beforeBytes}B -> ${e.afterBytes}B: chrome ${e.chromeBytes}B, ` +
    `${e.proseLines} comment line(s) ${e.proseBytes}B, blank separators ${e.blankBytes}B); ` +
    `all ${e.keptBodyLines} field line(s) kept, none cut`
  );
}

// ===========================================================================
// 5. THE FIELD LEG (parseGoHoverFields / goFieldTypeCursor). What a gopls
//    struct hover says about the type's SHAPE, and where to stand to follow it.
//
//    Go's fields were never missing from the prompt - `membersOfType` has
//    always delivered them, and they render as member lines. What was missing
//    is the EDGE: the shipped hook ran the Rust parser, which wants
//    name: Type, and a Go field line has no colon, so `fields` came back
//    empty, so `walkDataShape` had nothing to recurse on and Go emitted one
//    type, always. These two functions are the edge.
// ===========================================================================

/** The fenced block of a gopls hover that carries the STRUCT DECLARATION, or
 *  undefined when the hover has no such block.
 *
 *  Scanning for the right fence rather than taking the first one, because gopls
 *  emits MORE THAN ONE and the extra ones are traps. A struct with an embedded
 *  type gets a second ```go block holding gopls's own synthesised promoted-field
 *  table - 27 rows of `Host string // through Config` on ConnConfig - which is
 *  shaped almost exactly like a struct body and is not one. A third block
 *  carries the method list. So the block is chosen by what it CONTAINS, not by
 *  where it sits: the first one declaring a struct.
 *
 *  An unfenced hover falls back to the raw text, which is what a transport that
 *  strips markdown hands over; there is no second fence to confuse in that case
 *  because there are no fences at all. */
function goStructDeclBlock(signature: string): string | undefined {
  const fences = [...signature.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const isDecl = (s: string) => /(^|\n)\s*type\s+[A-Za-z_]\w*(\[[^\]]*\])?\s+struct\s*\{/.test(s);
  const found = fences.find(isDecl);
  if (found !== undefined) {
    return found;
  }
  return fences.length === 0 && isDecl(signature) ? signature : undefined;
}

/** Parse a gopls STRUCT hover into its declared fields, each as
 *  { name, typeName } with the type AS WRITTEN and in declaration order. The
 *  Go sibling of `parseStructHoverFields`, which cannot be reused: Rust writes
 *  name: Type and separates fields with commas, Go writes Name Type one per
 *  line and separates with newlines.
 *
 *  Anything that is not a struct declaration yields [] - an interface, an alias,
 *  a bodyless hover, a Rust hover. That is the honest degrade the walk already
 *  knows how to handle, and it is what keeps this parser from claiming a shape
 *  for a type whose shape it cannot read.
 *
 *  WHAT IT SKIPS, each one a real shape from a real capture (gopls v0.23.0 over
 *  pgx):
 *
 *   - `type Conn struct { // size=304 (0x130), class=320 (0x140)` - gopls's
 *     layout chrome, which sits AFTER the opening brace on the header line and
 *     would otherwise read as the first field.
 *   - whole-line doc comments, and blank separator lines, both of which pgx uses
 *     heavily between field groups.
 *   - a trailing comment on a field line (`config *ConnConfig // config used
 *     when establishing this connection`) - the comment is stripped, the field
 *     is kept.
 *   - EVERYTHING AT BRACE DEPTH > 0. A field whose type is an anonymous inline
 *     struct opens a nested body, and its inner lines are that type's fields,
 *     not this one's. Depth also makes `doneChan chan struct{}` safe, where the
 *     braces open and close on one line and net to zero.
 *
 *  AN EMBEDDED FIELD IS EMITTED UNDER ITS LAST PATH SEGMENT. pgconn.Config
 *  declares no name, and dropping it would lose a real edge - it is how pgx
 *  reaches its whole connection config. The last segment is not a guess or a
 *  convenience: x.Config is exactly how Go spells access to an embedded
 *  pgconn.Config, so the emitted name is the one a caller has to type.
 *
 *  AN ANONYMOUS INLINE STRUCT FIELD keeps its name and gets `struct` as its
 *  written type, which names no PascalCase type, so the walk queues nothing for
 *  it. It is present in the shape and refuses to be an edge - deliberately, not
 *  by omission: there is no name to anchor. */
export function parseGoHoverFields(signature: string | undefined): Array<{ name: string; typeName: string }> {
  const block = signature === undefined ? undefined : goStructDeclBlock(signature);
  if (block === undefined) {
    return [];
  }
  const lines = block.split("\n");
  const headIdx = lines.findIndex((l) => /(^|\s)type\s+[A-Za-z_]\w*(\[[^\]]*\])?\s+struct\s*\{/.test(l));
  if (headIdx < 0) {
    return [];
  }
  const fields: Array<{ name: string; typeName: string }> = [];
  // A ONE-LINE STRUCT puts its whole body on the header line, after the brace:
  // `type Widget struct { Mass uint32 }`, and `struct{ A int; B string }` with
  // the Go statement separator. gopls normally expands a declaration over lines,
  // so every captured hover in the corpus is multi-line — but a one-line struct
  // is ordinary Go, and a parser that reads the body only from the lines BELOW
  // the header silently answers "no fields" for it. That is the worst shape of
  // wrong here: it looks exactly like a type that legitimately has none.
  const headTail = stripGoLineComment(lines[headIdx].slice(lines[headIdx].indexOf("{") + 1)).replace(/\}\s*$/, "");
  for (const piece of headTail.split(";")) {
    const f = goFieldFromBodyLine(piece);
    if (f) {
      fields.push(f);
    }
  }
  // Depth 1 is INSIDE the struct's own body: the header line's `{` opened it.
  let depth = 1;
  for (let i = headIdx + 1; i < lines.length && depth > 0; i++) {
    const raw = lines[i];
    // Strip a trailing line comment before anything else, so a `//` carrying a
    // brace (`// see struct{}`) cannot move the depth count.
    const text = stripGoLineComment(raw);
    const atDepth = depth;
    depth += braceDelta(text);
    if (atDepth !== 1) {
      continue; // inside a nested body: those are another type's fields
    }
    const f = goFieldFromBodyLine(text);
    if (f) {
      fields.push(f);
    }
  }
  return fields;
}

// ONE line of a struct body -> its field, or undefined when the line declares
// none (blank, a closing brace, a whole-line comment). Shared by the one-line
// and the multi-line paths so a struct cannot be read two different ways
// depending on how gopls chose to format it.
function goFieldFromBodyLine(text: string): { name: string; typeName: string } | undefined {
  // NO trailing-brace strip here. A field type may legitimately END in a brace
  // (`doneChan chan struct{}`), and stripping it turns a real anonymous-struct
  // type into the unbalanced `chan struct{`. The ONE-LINE path strips its
  // body's closing brace once, before splitting, which is where that brace
  // actually belongs to the declaration rather than to a type.
  const t = stripGoLineComment(text).trim();
  if (t.length === 0 || t === "}") {
    return undefined;
  }
  // Name Type - the name, then everything after the run of spaces.
  const named = /^([A-Za-z_]\w*)\s+(\S[\s\S]*)$/.exec(t);
  if (named) {
    return { name: named[1], typeName: named[2].trim() };
  }
  // An EMBEDDED field: a lone type, qualified or not, with no name of its own.
  const embedded = /^(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)$/.exec(t);
  return embedded ? { name: embedded[2], typeName: t } : undefined;
}

// The net brace depth a line contributes, ignoring braces inside a string or a
// rune literal. A Go struct tag is a raw string and can carry anything:
// `Name string `json:"{name}"`` must not open a body.
function braceDelta(line: string): number {
  let delta = 0;
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== undefined) {
      if (c === "\\" && quote !== "`") {
        i++;
      } else if (c === quote) {
        quote = undefined;
      }
      continue;
    }
    if (c === '"' || c === "`" || c === "'") {
      quote = c;
    } else if (c === "{") {
      delta++;
    } else if (c === "}") {
      delta--;
    }
  }
  return delta;
}

// A line with its trailing `//` comment removed. Quote-aware for the same reason
// as braceDelta: a `//` inside a struct tag is not a comment.
function stripGoLineComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== undefined) {
      if (c === "\\" && quote !== "`") {
        i++;
      } else if (c === quote) {
        quote = undefined;
      }
      continue;
    }
    if (c === '"' || c === "`" || c === "'") {
      quote = c;
    } else if (c === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

/** A source cursor on the candidate type token WITHIN the parent struct's own
 *  declaration of field `fieldName`, in the DEF SOURCE (not the hover).
 *
 *  The Go sibling of the Rust `fieldTypeCursor`, and it exists because the Rust
 *  one anchors on `^ [pub] name :` and a Go field line has no colon. Run over
 *  the captured pgx source it returned undefined for every field tried, which is
 *  the whole reason Go's hop never happened.
 *
 *  Anchoring at the field's OWN type token, rather than searching the file for
 *  the bare name, is what makes `definition()` resolve the type in the PARENT's
 *  scope - so a same-named type declared elsewhere is never walked into by
 *  accident.
 *
 *  Two line shapes, because Go has two:
 *   - `config *ConnConfig` - the name, then the candidate somewhere after it.
 *   - pgconn.Config - an EMBEDDED field, whose "name" is the type's own last
 *     segment, so there is no name to search past and the candidate is matched
 *     on the line as it stands.
 *
 *  undefined when the field is not found in the body, or when the candidate is
 *  not on the field's own declaration line. That is a STOP EDGE, and the walk
 *  records every one of them rather than dropping it silently. */
export function goFieldTypeCursor(
  lines: string[],
  range: { open: number; close: number },
  fieldName: string,
  candType: string,
): { line: number; character: number } | undefined {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namedRe = new RegExp(`^\\s*${esc(fieldName)}\\s+\\S`);
  const embeddedRe = new RegExp(`^\\s*(?:[A-Za-z_]\\w*\\.)?${esc(fieldName)}\\s*$`);
  const candRe = new RegExp(`\\b${esc(candType)}\\b`);
  for (let i = range.open; i <= range.close && i < lines.length; i++) {
    const line = stripGoLineComment(lines[i]);
    const named = namedRe.exec(line);
    const embedded = named ? null : embeddedRe.exec(line);
    if (!named && !embedded) {
      continue;
    }
    // Search PAST the field name for a named field, so a field whose own name
    // equals the candidate (`Config Config`) anchors on the type and not on the
    // binding. An embedded field is searched whole - the token IS the name.
    const from = named ? named[0].length - 1 : 0;
    const m = candRe.exec(line.slice(from));
    return m ? { line: i, character: from + m.index } : undefined;
  }
  return undefined;
}
