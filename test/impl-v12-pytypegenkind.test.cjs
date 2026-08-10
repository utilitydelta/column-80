// Implementer oracle (v12 Phase 2): pyTypeGenKind LEXER EDGES, on top of the
// blind contract (blind-v12-typegen-python.test.cjs) which pins the happy shapes
// and the name-vs-base trap. This suite reaches the edges only the internals
// invite (the impl-derust-localsyms pattern): dotted enum bases, generic
// subscripts with commas in the base list, keyword args, malformed/unterminated
// headers, and empty input. The invariant throughout: classify on the BASE list,
// soundly, and never throw.
//
// Run: SKIP_LIVE=1 node --test test/impl-v12-pytypegenkind.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v12-pytypegenkind",
  `export { pyTypeGenKind } from "../src/core/pyExtraction";\n`,
);
const { pyTypeGenKind } = mod;
test.after(cleanup);

const CASES = [
  // --- dotted / qualified enum bases (the final component decides) ---------
  { header: ["class C(enum.Enum):"], want: "enum", why: "dotted base enum.Enum -> Enum" },
  { header: ["class C(enum.IntEnum):"], want: "enum", why: "dotted base enum.IntEnum" },
  { header: ["class C(mypkg.mod.StrEnum):"], want: "enum", why: "deeply dotted base, final component StrEnum" },
  { header: ["class C(enum.Flag):"], want: "enum", why: "dotted Flag" },

  // --- generic subscripts in the base list (commas inside []) -------------
  { header: ["class C(Mapping[str, int]):"], want: "class", why: "a generic base with an internal comma is not an enum" },
  { header: ["class C(Generic[T], Enum):"], want: "enum", why: "an enum base after a generic base still classifies enum" },
  { header: ["class C(Dict[str, int], Base):"], want: "class", why: "generic-with-comma plus a non-enum base stays a class" },

  // --- keyword args in the base list --------------------------------------
  { header: ["class C(Base, metaclass=ABCMeta):"], want: "class", why: "a metaclass kwarg is not a base and is skipped" },
  { header: ["class C(metaclass=EnumMeta):"], want: "class", why: "a kwarg VALUE ending in Meta/containing Enum is NOT a base — skip kwargs" },

  // --- near-miss names (read the base, never the class name) --------------
  { header: ["class Enumeration(object):"], want: "class", why: "class name contains 'Enum' but base is object" },
  { header: ["class C(Enumerable):"], want: "class", why: "base 'Enumerable' does not end in 'Enum'" },
  { header: ["class C(EnumBaseKind):"], want: "class", why: "'Enum' in the MIDDLE of a base name is not the convention (must END in 'Enum')" },
  { header: ["class C(ColorEnum):"], want: "enum", why: "documented convention: a base ending in 'Enum' is treated as an enum base" },

  // --- malformed / degenerate input: never throw, sensible default --------
  { header: [], want: "class", why: "empty header lines -> class (no base list)" },
  { header: ["class C"], want: "class", why: "no colon, no base list -> class" },
  { header: ["class C(Enum"], want: "enum", why: "unterminated base list still finds the enum base" },
  { header: ["", "class C(Enum):"], want: "enum", why: "a leading blank header line is tolerated" },
  { header: ["   ", "class C:"], want: "class", why: "whitespace-only leading line, plain class" },
];

for (const c of CASES) {
  test(`pyTypeGenKind(${JSON.stringify(c.header)}) === "${c.want}" — ${c.why}`, () => {
    let got;
    assert.doesNotThrow(() => {
      got = pyTypeGenKind(c.header);
    }, "pyTypeGenKind must never throw, even on malformed input");
    assert.strictEqual(got, c.want, `${c.why}: expected "${c.want}", got ${JSON.stringify(got)}`);
  });
}
