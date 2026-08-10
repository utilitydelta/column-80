/**
 * The blank-value tabstop rule: turn a rust-analyzer-resolved RETURN TYPE
 * into the VS Code snippet scaffold for the expected value — the holes the
 * human Tabs through and TYPES. The model's guessed value is never used; the
 * human owns the value (blank-the-value, the measured automation-bias fix).
 *
 * Scaffold what the TYPE determines (visible in the signature, no contract leak);
 * keep as ONE hole what the CONTRACT determines (leaking it defeats blank-value).
 */

export interface StructFieldShape {
  name: string;
  typeName: string;
}

export interface BlankValueResult {
  /** The expected-value RHS as a VS Code snippet: literal text with ${N} holes. */
  rhs: string;
  /** Count of holes emitted, so the caller can number the next assertion. */
  holes: number;
}

// A Rust primitive scalar: one hole, never scaffolded further.
const SCALAR = /^(i(8|16|32|64|128|size)|u(8|16|32|64|128|size)|f32|f64|bool|char)$/;

// std containers whose CONSTRUCTOR is type-determined (leaks no value) but whose
// CONTENTS — how many elements and which — are contract-determined. Scaffold the
// constructor, keep the contents as ONE hole hinting the element type: the same
// leak boundary as every other branch. Option/Result are deliberately absent — the
// variant choice (Some/None, Ok/Err) IS the answer, so they stay a single hole.
// Every name here has a `From<[T; N]>` impl, so `::from([…])` compiles for both the
// empty case (the human leaves the `/* T */` comment, i.e. `[]`) and the filled one.
const SEQ_CONTAINERS = new Set(["VecDeque", "HashSet", "BTreeSet", "BinaryHeap"]);
const MAP_CONTAINERS = new Set(["HashMap", "BTreeMap"]);

// `Path::To::Name<A, B>` -> { path: "Path::To::Name", name: "Name", args: ["A", "B"] }.
// undefined when the type is not a single generic application (no `<`, or not
// `>`-terminated) — those keep the earlier precedence or fall to variable.
function parseGeneric(ty: string): { path: string; name: string; args: string[] } | undefined {
  const lt = ty.indexOf("<");
  if (lt === -1 || !ty.endsWith(">")) {
    return undefined;
  }
  const path = ty.slice(0, lt).trim();
  if (path.length === 0) {
    return undefined;
  }
  return { path, name: path.split("::").pop() ?? path, args: splitTopLevel(ty.slice(lt + 1, -1)) };
}

// Escape VS Code snippet metacharacters before splicing a type string into a
// `${N:/* … */}` placeholder. rust-analyzer emits types like `{unknown}` and
// `[closure@…]`; an unescaped `}` would close the placeholder early and corrupt
// the snippet the human sees. Backslash first so the escapes we add are not
// re-escaped. `{` is safe inside a placeholder and is left alone.
//
// Exported so every language's blank-value renderer escapes its type hints the
// same way. Go needs it as much as Rust: `map[string]struct{}` carries the `}`.
export function escapeSnippet(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/}/g, "\\}");
}

// Split on TOP-LEVEL commas, respecting `<>`, `()`, `[]` nesting, so a tuple's
// element count is the real arity (`(i32, Vec<u8, A>)` is 2 elements, not 3).
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<" || c === "(" || c === "[") {
      depth++;
    } else if (c === ">" || c === ")" || c === "]") {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Render the blank-value RHS for a resolved return type: scaffold what the TYPE
 * determines (no contract leak) and keep as ONE hole what the CONTRACT determines
 * (a leak would defeat blank-value). Precedence scalar → tuple → array → fixed
 * struct → std collection → variable. Pure; never throws.
 */
export function renderBlankValue(
  returnType: string,
  opts?: { structFields?: StructFieldShape[]; startHole?: number },
): BlankValueResult {
  const start = opts?.startHole ?? 1;
  const ty = (returnType ?? "").trim();
  const hole = (i: number) => `\${${start + i}}`;

  // The whole value is one hole, the type shown as a placeholder comment so the
  // human sees what shape to type. The honest fallback for every non-fixed shape.
  const variable = (): BlankValueResult => ({ rhs: `\${${start}:/* ${escapeSnippet(ty)} */}`, holes: 1 });

  // 1. scalar → one hole, no scaffold.
  if (SCALAR.test(ty)) {
    return { rhs: hole(0), holes: 1 };
  }

  // 2. tuple → one hole per TOP-LEVEL element.
  if (ty.startsWith("(") && ty.endsWith(")")) {
    const elems = splitTopLevel(ty.slice(1, -1));
    if (elems.length > 0) {
      return { rhs: `(${elems.map((_, i) => hole(i)).join(", ")})`, holes: elems.length };
    }
    // `()` unit has no elements — fall through (it is not a value to assert).
  }

  // 3. array `[T; K]` with a LITERAL K → K holes. A const-generic length is not
  //    scaffoldable and falls through to variable.
  const arr = /^\[.+;\s*(\d+)\s*\]$/.exec(ty);
  if (arr) {
    const k = parseInt(arr[1], 10);
    if (k > 0) {
      return {
        rhs: `[${Array.from({ length: k }, (_, i) => hole(i)).join(", ")}]`,
        holes: k,
      };
    }
  }

  // 4. fixed struct → scaffold the named literal, one hole per field in order.
  //    The struct NAME is visible in the signature already, so this leaks no value.
  const fields = opts?.structFields;
  if (fields && fields.length > 0) {
    const body = fields.map((f, i) => `${f.name}: ${hole(i)}`).join(", ");
    return { rhs: `${ty} { ${body} }`, holes: fields.length };
  }

  // 5. std collection → scaffold the type-determined constructor; the contents
  //    (count + values, contract-determined) stay ONE hole hinting the element
  //    type. Empty is expressed by leaving the hole's `/* T */` comment in place,
  //    which reads as `[]` / `vec![]`. Vec uses the prelude `vec!` macro (always in
  //    scope); the others use their own path's `::from`, safe unqualified or not.
  const generic = parseGeneric(ty);
  if (generic) {
    const hint = (t: string) => `\${${start}:/* ${escapeSnippet(t)} */}`;
    if (generic.name === "Vec" && generic.args.length === 1) {
      return { rhs: `vec![${hint(generic.args[0])}]`, holes: 1 };
    }
    if (SEQ_CONTAINERS.has(generic.name) && generic.args.length === 1) {
      return { rhs: `${generic.path}::from([${hint(generic.args[0])}])`, holes: 1 };
    }
    if (MAP_CONTAINERS.has(generic.name) && generic.args.length === 2) {
      return { rhs: `${generic.path}::from([${hint(`(${generic.args[0]}, ${generic.args[1]})`)}])`, holes: 1 };
    }
  }

  // 6. variable / unknown → one hole.
  return variable();
}
