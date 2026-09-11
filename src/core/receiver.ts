/**
 * What a generation target is doing at the type that encloses it, read from the
 * resolved SIGNATURE.
 *
 * The signature already carries the receiver in every language — it is taken
 * from the declaration the symbol provider resolved, never scanned out of
 * arbitrary file text — so detection needs no parser and no brace counter:
 * `fn absorb(&self, …)`, `def absorb(self, …)`, `func (o *Owner) Absorb(…)`,
 * `public int Absorb(…)`, `absorb(w: Widget): number`. A static, associated or
 * free function differs in exactly that string.
 *
 * Two jobs, two surfaces. A receiver means the body CALLS INTO a value, so the
 * enclosing type's whole surface applies. No receiver but a return type naming
 * the enclosing type (or `Self`) means the body BUILDS one, so only its fields
 * and the members that can produce it apply — an instance method is noise at a
 * construction target and costs contended budget. Neither means nothing applies.
 *
 * Only Go's signature carries the receiver's TYPE as well as its presence
 * (`func (o *Owner) Absorb`). Everywhere else the type comes from the document
 * symbol tree, which is this module's `containerName` half: the name a symbol
 * node carries, reduced to a type name. Nothing here reads file text.
 */

import { implSelfType } from "./extraction";

/** Why the enclosing type is being injected: the target calls into a value of
 *  it, or the target builds one. */
export type ReceiverJob = "call" | "build";

/** How a language spells a return type in a RENDERED member signature: after a
 *  `->`, or after the parameter list's `:`. C# renders colon-styled even though
 *  its own declarations write the return type before the member name; the
 *  declaration form is `csReturnClause`'s job, not this one's. */
export type ReturnStyle = "arrow" | "colon";

/** The per-language reading of a resolved signature. One object per language,
 *  wired into the pre-fill's language table. */
export interface SignatureRules {
  /** Does this signature carry a receiver — the case-A test. */
  hasReceiver(signature: string): boolean;
  /** The receiver's own type, for the one language whose signature names it.
   *  Undefined everywhere else, which is what sends resolution to the tree. */
  receiverType?(signature: string): string | undefined;
  /** Does the return type name `typeName` (or `Self`) — the case-B test. */
  returnNames(signature: string, typeName: string): boolean;
  /** How this language's RENDERED member signatures spell a return type. */
  memberReturn: ReturnStyle;
  /** The type name a container symbol node carries, or undefined when the node
   *  names no single type (an associated-type projection, a Go method symbol). */
  containerName(symbolName: string): string | undefined;
}

// Leading attribute groups, both spellings: Rust's `#[cfg(test)]` and C#'s
// `[Owner]`. They must go before anything else reads the signature — an
// attribute with arguments owns the first `(`, so the parameter list is read out
// of the attribute, and an attribute naming a type puts that name in what C#
// treats as its return clause. Bracket-balanced, repeated, and an unbalanced
// group is left alone (a half-typed header parses to nothing either way).
function stripAttributes(signature: string): string {
  let rest = signature.trimStart();
  while (rest.startsWith("[") || rest.startsWith("#[") || rest.startsWith("#![")) {
    const open = rest.indexOf("[");
    let depth = 0;
    let i = open;
    for (; i < rest.length; i++) {
      if (rest[i] === "[") {
        depth++;
      } else if (rest[i] === "]") {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }
    if (i >= rest.length) {
      return rest;
    }
    rest = rest.slice(i + 1).trimStart();
  }
  return rest;
}

// The parameter list: between the first `(` and its matching `)`. Depth-tracked,
// so a parameter that is itself a callable (`cb: fn(u32) -> u32`) does not end
// the list early. undefined when the signature has no balanced list, which is a
// half-typed header — detection then answers no, the cheap direction.
function paramList(signature: string): string | undefined {
  const open = signature.indexOf("(");
  if (open < 0) {
    return undefined;
  }
  let depth = 0;
  for (let i = open; i < signature.length; i++) {
    const c = signature[i];
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) {
        return signature.slice(open + 1, i);
      }
    }
  }
  return undefined;
}

// The first parameter, split on the first TOP-LEVEL comma so a generic argument
// list (`w: HashMap<u32, Vec<u64>>`) is not split through the middle.
function firstParam(signature: string): string {
  const params = paramList(signature) ?? "";
  let depth = 0;
  for (let i = 0; i < params.length; i++) {
    const c = params[i];
    if (c === "<" || c === "(" || c === "[") {
      depth++;
    } else if (c === ">" || c === ")" || c === "]") {
      depth--;
    } else if (c === "," && depth === 0) {
      return params.slice(0, i);
    }
  }
  return params;
}

// Everything before the parameter list: the modifiers, and (C#) the return type.
const declarationHead = (signature: string): string => {
  const open = signature.indexOf("(");
  return open < 0 ? signature : signature.slice(0, open);
};

// The return clause after a top-level `->`: a DELIMITED clause, not the rest of
// the string. Depth tracks `<>` as well as the paren and bracket pairs, so a
// bound's own arrow (`map_all<F: Fn(u32) -> Owner>`) is inside the generic list
// and not the return; a `>` closing an arrow is not a closer, the same guard
// `stripLeadingGenerics` uses. The clause then ends at a top-level `where`,
// which is a constraint list and not part of the returned type.
function afterArrow(signature: string): string {
  let depth = 0;
  for (let i = 0; i < signature.length; i++) {
    const c = signature[i];
    if (c === "-" && signature[i + 1] === ">") {
      if (depth === 0) {
        return beforeWhere(signature.slice(i + 2));
      }
      i++; // the arrow's `>` is not a closer
    } else if (c === "(" || c === "[" || c === "<") {
      depth++;
    } else if (c === ")" || c === "]" || c === ">") {
      depth--;
    }
  }
  return "";
}

// A clause cut at its top-level `where`. `-> u32 where I: IntoIterator<Item =
// Owner>` returns `u32`: the type named in the constraint is a bound on a
// parameter, and reading it as the return type makes every generic function
// with a `where` clause look like a constructor.
function beforeWhere(clause: string): string {
  let depth = 0;
  for (let i = 0; i < clause.length; i++) {
    const c = clause[i];
    if (c === "(" || c === "[" || c === "<") {
      depth++;
    } else if (c === ")" || c === "]") {
      depth--;
    } else if (c === ">") {
      if (clause[i - 1] !== "-") {
        depth--;
      }
    } else if (depth === 0 && /\s/.test(c) && /^where\b/.test(clause.slice(i + 1))) {
      return clause.slice(0, i);
    }
  }
  return clause;
}

// The return clause after the parameter list's `:` (TypeScript's spelling, and
// the rendered member form C# and TypeScript both use).
function afterParamsColon(signature: string): string {
  const open = signature.indexOf("(");
  if (open < 0) {
    return "";
  }
  let depth = 0;
  for (let i = open; i < signature.length; i++) {
    if (signature[i] === "(") {
      depth++;
    } else if (signature[i] === ")") {
      depth--;
      if (depth === 0) {
        const colon = signature.indexOf(":", i);
        return colon < 0 ? "" : signature.slice(colon + 1);
      }
    }
  }
  return "";
}

// C#'s return clause. C# writes the return type before the member name, so the
// declaration head carries it — along with the modifiers, the member name and
// the member's own generic parameter list, none of which are the return type.
// `Register<Owner>` declares a type PARAMETER named Owner and produces nothing.
function csReturnClause(signature: string): string {
  const head = stripTrailingGenerics(declarationHead(stripAttributes(signature)).trimEnd());
  return head.replace(/[A-Za-z_][A-Za-z0-9_.]*\s*$/, "");
}

// A trailing generic argument list, matched from the closing `>` back to its
// opener so a nested list (`Register<Cache<T>>`) is removed whole.
function stripTrailingGenerics(head: string): string {
  if (!head.endsWith(">")) {
    return head;
  }
  let depth = 0;
  for (let i = head.length - 1; i >= 0; i--) {
    if (head[i] === ">") {
      depth++;
    } else if (head[i] === "<") {
      depth--;
      if (depth === 0) {
        return head.slice(0, i);
      }
    }
  }
  return head;
}

// A TypeScript type predicate (`x is Owner`, `asserts x is Owner`) returns a
// boolean. It names the type in the position a return clause is read from and
// produces nothing.
const TYPE_PREDICATE = /^\s*(?:asserts\s+)?[A-Za-z_$][\w$]*\s+is\b/;

// A return clause NAMES a type when the bare name appears in it as a word, which
// is what makes `-> Result<Self, E>`, `-> Task<Owner>` and `-> *Owner` all count:
// the contract's rule is that the return type names the type, not that it equals
// it. `Self` counts everywhere it can be written.
function namesType(clause: string, typeName: string): boolean {
  if (TYPE_PREDICATE.test(clause)) {
    return false;
  }
  return new RegExp(`\\b(?:${typeName}|Self)\\b`).test(clause);
}

const RETURN_CLAUSE: Record<ReturnStyle, (s: string) => string> = {
  arrow: afterArrow,
  colon: afterParamsColon,
};

// A bare type name, generic argument list cut off: `Cache<T>` -> `Cache`. Anything
// that is not an identifier-with-optional-generics is not a type name and yields
// undefined — a miss, never a guess.
function bareTypeName(name: string): string | undefined {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:<.*)?$/.exec(name);
  return m ? m[1] : undefined;
}

// Rust: `&self`, `&mut self`, `mut self`, `self`, with an optional lifetime on
// the borrow. An associated function's first parameter is an ordinary binding.
const RUST_SELF = /^\s*(?:&\s*(?:'[A-Za-z_][A-Za-z0-9_]*\s+)?)?(?:mut\s+)?self\b/;

// Go's receiver clause, which sits between `func` and the method name. The
// trailing `(` is what separates `func (o *Owner) Absorb(` from a plain
// `func Absorb(o Owner) error`, whose first paren group is its parameters.
const GO_RECEIVER_CLAUSE = /^\s*func\s*\(([^)]*)\)\s*[A-Za-z_]\w*\s*\(/;
// The receiver's type is the last identifier in the clause, past the binding and
// any pointer star, with a generic argument list allowed after it.
const GO_RECEIVER_TYPE = /([A-Za-z_]\w*)(?:\[[^\]]*\])?\s*$/;

function goReceiverType(signature: string): string | undefined {
  const clause = GO_RECEIVER_CLAUSE.exec(signature);
  if (!clause) {
    return undefined;
  }
  const m = GO_RECEIVER_TYPE.exec(clause[1].trim());
  return m ? m[1] : undefined;
}

// Rust's container node is the `impl` block, whose name is the raw header text.
// The self type is the type the block is FOR, never the trait it implements and
// never a generic argument, which is what `implSelfType` already answers for the
// sibling-impl walk. A node that is not an impl header (a trait's own symbol)
// stands for itself.
function rustContainerName(symbolName: string): string | undefined {
  return /^\s*impl\b/.test(symbolName) ? implSelfType(symbolName) : bareTypeName(symbolName);
}

const RUST_RULES: SignatureRules = {
  hasReceiver: (signature) => RUST_SELF.test(firstParam(stripAttributes(signature))),
  returnNames: (signature, typeName) => namesType(afterArrow(stripAttributes(signature)), typeName),
  memberReturn: "arrow",
  containerName: rustContainerName,
};

// Python: `self` is the receiver; `cls` is NOT. A classmethod reaches the
// construction case through its RETURN type, which is the only honest reading —
// a classmethod that returns an int builds nothing.
const PY_RULES: SignatureRules = {
  hasReceiver: (signature) => /^\s*self\b/.test(firstParam(signature)),
  returnNames: (signature, typeName) => namesType(afterArrow(signature), typeName),
  memberReturn: "arrow",
  containerName: bareTypeName,
};

// C# and TypeScript: the member has a receiver unless it is `static`. A free
// function passes this test and resolves no container, which is the same answer
// by a different route.
const CS_RULES: SignatureRules = {
  hasReceiver: (signature) => !/\bstatic\b/.test(declarationHead(stripAttributes(signature))),
  returnNames: (signature, typeName) => namesType(csReturnClause(signature), typeName),
  memberReturn: "colon",
  containerName: bareTypeName,
};

const TS_RULES: SignatureRules = {
  hasReceiver: (signature) => !/\bstatic\b/.test(declarationHead(signature)),
  returnNames: (signature, typeName) => namesType(afterParamsColon(signature), typeName),
  memberReturn: "colon",
  containerName: bareTypeName,
};

// Go's signature carries both halves of the answer, so this is the one language
// whose receiver resolves with no tree. It has no construction case: case B needs
// an ENCLOSING type, and a Go constructor is a package-level function with
// nothing enclosing it. Its return type is an ordinary signature-named candidate
// and stays one.
const GO_RULES: SignatureRules = {
  hasReceiver: (signature) => goReceiverType(signature) !== undefined,
  receiverType: goReceiverType,
  returnNames: () => false,
  memberReturn: "arrow",
  containerName: () => undefined,
};

export const RECEIVER_RULES = {
  rust: RUST_RULES,
  csharp: CS_RULES,
  typescript: TS_RULES,
  python: PY_RULES,
  go: GO_RULES,
};

/** Where the receiver's type name sits inside a signature that names it (Go),
 *  as an offset from the signature's start. Taken from the position of the same
 *  match `goReceiverType` reads the name out of, so the anchor and the resolved
 *  type can never be two different tokens: `func (Owner *Owner)` binds a value
 *  named `Owner`, and any search for the word lands on the binding. undefined
 *  when the signature carries no receiver clause, and when the clause's type is
 *  not `typeName` — a mismatch is a miss, never a guessed offset. */
export function receiverNameOffset(signature: string, typeName: string): number | undefined {
  const clause = GO_RECEIVER_CLAUSE.exec(signature);
  if (!clause) {
    return undefined;
  }
  const at = GO_RECEIVER_TYPE.exec(clause[1]);
  if (at === null || at[1] !== typeName) {
    return undefined;
  }
  return signature.indexOf("(") + 1 + at.index;
}

/** Can this rendered CALLABLE produce `typeName` — the producer test a case-B
 *  surface keeps its members by. True when the return clause names the type or
 *  `Self` (the associated functions, static factories and self-consuming
 *  builders), and true when there is NO readable return clause at all: an
 *  unannotated factory is the Python and TypeScript norm, and dropping a real
 *  producer costs the model the one call that would have worked, which no oracle
 *  catches. An ordinary instance method reads its own return type and goes.
 *
 *  Callables only. Whether a member IS a callable is its `kind`, never the shape
 *  of its rendered signature — see `keepAtConstructionTarget`. */
export function producesType(rendered: string | undefined, typeName: string, style: ReturnStyle): boolean {
  const clause = RETURN_CLAUSE[style](rendered ?? "");
  return clause.trim().length === 0 || namesType(clause, typeName);
}


/**
 * Does a RENDERED enclosing-type surface carry anything a test could construct
 * one of `typeName` with?
 *
 * The question session-v68 phase 6 asks before lifting the fixture rung, and the
 * asymmetry decides every judgement call in it: a FALSE POSITIVE admits a target
 * whose generated test cannot compile, while a FALSE NEGATIVE only leaves the
 * honest refusal that already stood. So it is deliberately stricter than
 * `producesType`, which answers true for a member with no readable return clause
 * at all — right when the cost is dropping one candidate from a prompt, wrong
 * here.
 *
 * Four things the first cut got wrong, all of them false positives found by the
 * phase 5/6 adversarial review:
 *
 *   - an INSTANCE method returning the type is not a producer. `fn clone(&self)
 *     -> Widget` needs a Widget before it can make one.
 *   - a member merely TAKING the type is not a producer: `void Add(Widget w)`
 *     matched a bare "the name followed by a paren".
 *   - a constructor a test cannot CALL is not a producer: `private Widget()`,
 *     `private constructor()`.
 *   - a mention inside a COMMENT is not a member at all.
 *
 * And one false negative: a GENERIC receiver (`Widget<T>`) could never match,
 * because the name was stripped of its punctuation into `WidgetT`.
 */
export function surfaceProducesType(languageId: string, surface: string, typeName: string): boolean {
  // The base name: `Widget<T>` and `Widget` are the same type to construct.
  const t = typeName.split("<")[0].trim().replace(/[^\w]/g, "");
  if (t.length === 0) {
    return false;
  }
  const namesT = new RegExp(`(^|[^\\w])(?:Self|${t})(\\s*<[^>]*>)?([^\\w]|$)`);
  for (const raw of surface.split(/\r?\n/)) {
    const line = stripSurfaceComment(raw).trim();
    if (line.length === 0) {
      continue;
    }
    if (producesLine(languageId, line, t, namesT)) {
      return true;
    }
  }
  return false;
}

/** A rendered surface carries doc comments beside its members. A mention of the
 *  type inside one is prose, never a callable. */
function stripSurfaceComment(line: string): string {
  const trimmed = line.trim();
  if (/^(\/\/|\/\*|\*|#)/.test(trimmed) || trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
    return "";
  }
  return line.replace(/\/\/.*$/, "");
}

/** The RETURN clause of a rendered member: everything after its top-level
 *  parameter list. undefined when the line declares no callable, so a field or a
 *  property can never be read as a producer by accident. */
function returnClauseOf(line: string): string | undefined {
  const open = line.indexOf("(");
  if (open === -1) {
    return undefined;
  }
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    const c = line[i];
    if (c === "(" || c === "[") {
      depth++;
    } else if (c === ")" || c === "]") {
      depth--;
      if (depth === 0 && c === ")") {
        return line.slice(i + 1);
      }
    }
  }
  return undefined;
}

/** The parameter list of a rendered member. */
function paramsOf(line: string): string {
  const open = line.indexOf("(");
  const rest = returnClauseOf(line);
  if (open === -1 || rest === undefined) {
    return "";
  }
  return line.slice(open + 1, line.length - rest.length - 1);
}

function hasSelfReceiver(params: string): boolean {
  return /^\s*(&\s*)?('\w+\s+)?(mut\s+)?(self|cls)\b/.test(params);
}

function producesLine(languageId: string, line: string, t: string, namesT: RegExp): boolean {
  const ret = returnClauseOf(line);
  const params = paramsOf(line);
  // A "producer" that CONSUMES one is not a starting point. `fn merge(a: Widget,
  // b: Widget) -> Widget`, `static combine(a: Widget, b: Widget): Widget`,
  // `func Clone(w *Widget) *Widget` — every one of them needs a Widget before it
  // can make a Widget, and a blind test starts from nothing. Excluding
  // instance methods closed the same chicken-and-egg in its receiver form; this
  // closes the free-function and static forms of it.
  //
  // `WidgetConfig` is not `Widget`: `namesT` requires a non-word character or
  // the end of the string after the name, so a differently-named type carrying
  // it as a prefix does not exclude anything.
  if (namesT.test(params)) {
    return false;
  }
  const headEnd = line.indexOf("(");
  const head = headEnd === -1 ? line : line.slice(0, headEnd);
  switch (languageId) {
    case "rust":
      // An ASSOCIATED function — no `self` receiver — whose return names the
      // type or `Self`. An instance method returning one needs one already.
      return /\bfn\s/.test(line) && !hasSelfReceiver(params) && ret !== undefined && namesT.test(ret);
    case "csharp": {
      if (ret === undefined || /\b(private|protected)\b/.test(head)) {
        return false;
      }
      // A CONSTRUCTOR: the member's NAME is the type and it declares no return
      // type, so the type sits immediately before the parameter list.
      if (new RegExp(`(^|[^\\w.])${t}\\s*$`).test(head)) {
        return true;
      }
      // A STATIC FACTORY: `public static Widget Create(...)`. C# writes the
      // return type in the HEAD, so drop the member name and look at what is
      // left. The type appearing only in `params` is a taker, not a producer.
      return /\bstatic\b/.test(head) && namesT.test(head.replace(/\b[\w<>]+\s*$/, ""));
    }
    case "typescript":
    case "typescriptreact":
    case "javascript":
    case "javascriptreact": {
      if (/\b(private|protected)\b/.test(head)) {
        return false;
      }
      if (/\bconstructor\s*$/.test(head)) {
        return true;
      }
      // A static factory, whose return annotation follows the parameter list.
      return /\bstatic\b/.test(head) && ret !== undefined && namesT.test(ret);
    }
    case "python":
      // `__init__` is the constructor. Otherwise an annotated return naming the
      // type on something that is not an instance method.
      return (
        /\bdef\s+__init__\s*\(/.test(line) ||
        (/\bdef\s/.test(line) && !hasSelfReceiver(params) && ret !== undefined && namesT.test(ret.replace(/["']/g, "")))
      );
    case "go": {
      // Go has no constructors. A package-level `NewWidget`, or any function
      // whose RESULT names the type. The result is what follows the parameter
      // list; a callback PARAMETER that produces one is not a producer, which is
      // exactly what a naive scan of the whole line reads it as.
      //
      // Go's METHOD receiver is the first paren group, so `returnClauseOf` reads
      // it as the parameter list and `func (w *Widget) WithSize(int) *Widget`
      // looked like a producer. It is an instance method: it needs a Widget to
      // make one.
      if (/^\s*func\s*\(/.test(line)) {
        return false;
      }
      return (
        new RegExp(`\\bfunc\\s+New${t}\\s*\\(`).test(line) ||
        (/\bfunc\s/.test(line) && ret !== undefined && namesT.test(ret))
      );
    }
    default:
      return false;
  }
}
