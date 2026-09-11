// ADVERSARIAL REVIEW of session-v68 phase 3, the dead-column REFUSAL
// [session-v68/contracts/P3-knob-lint.md]. Every row is an attack with a
// runnable input; a row that FAILS is a defect claim with its evidence in it.
//
// Run: SKIP_LIVE=1 node --test test/review-v68-p3.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "review-v68-p3",
    `export { tddLangFor } from "../src/core/tddLang";\n` +
      `export { assignedTupleTables } from "../src/core/tddTable";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const { tddLangFor, assignedTupleTables } = mod;
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle row");
    return fn(ctx);
  });
const dead = (id, text) => tddLangFor(id).deadTableColumns(text);

test("bundle: the P3 surface builds", () => {
  assert.strictEqual(bundleError, undefined, `bundle failed: ${bundleError}`);
  assert.strictEqual(typeof tddLangFor, "function");
});

// ---------------------------------------------------------------------------
// CONTROLS. These pass today and are here so a regression in the rung itself is
// distinguishable from the attacks below.
// ---------------------------------------------------------------------------

gtest("control: the measured Go defect still fires [P3 rule 9]", () => {
  const text = `
func TestAdd(t *testing.T) {
	cases := []struct {
		a, b     int
		want     int
		maxBytes int
	}{
		{1, 2, 3, 10},
	}
	for _, tt := range cases {
		if got := Add(tt.a, tt.b); got != tt.want {
			t.Errorf("Add() over maxBytes = %d", got)
		}
	}
}
`;
  assert.deepStrictEqual(dead("go", text), ["maxBytes"]);
});

gtest("control: a correct table in each shape reports nothing [P3 rule 10]", () => {
  assert.deepStrictEqual(
    dead("rust", `
#[cfg(test)]
mod tests {
    #[test]
    fn table() {
        let cases = [(1, 2, 3), (2, 3, 5)];
        for (a, b, want) in cases {
            assert_eq!(add(a, b), want);
        }
    }
}
`),
    []
  );
  assert.deepStrictEqual(
    dead("typescript", `
it.each([
  [1, 2, 3],
])("add", (a, b, want) => {
  expect(add(a, b)).toBe(want);
});
`),
    []
  );
});

// ---------------------------------------------------------------------------
// ATTACK 1 — FALSE REFUSALS. The expensive direction.
// ---------------------------------------------------------------------------

gtest(
  "go-1 RE-CUT: two inline `range []struct{…}{…}` tables, each reading every column it binds [P3 rule 10]",
  () => {
    // THE DEFECT THIS CAUGHT WAS REAL and is fixed: `goWalkerAfter` took the
    // first `range` AFTER the table literal, so with the inline form — where the
    // `range` sits BEFORE the table — table one's body was bounded to table
    // two's loop and `a`, `b` and `want` all came back dead.
    //
    // The fixture is re-cut because its first table also declared a `name`
    // column and never passed it to `t.Run`, which is a genuinely dead column:
    // a row value there changes nothing. Reporting it was right, so the row now
    // uses the idiomatic `t.Run(tt.name, …)` and the unread case is asserted
    // separately below, where it belongs.
    const text = `
func TestAdd(t *testing.T) {
	for _, tt := range []struct {
		name string
		a, b int
		want int
	}{
		{"one", 1, 2, 3},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := Add(tt.a, tt.b); got != tt.want {
				t.Errorf("Add() = %d", got)
			}
		})
	}
}

func TestMul(t *testing.T) {
	for _, c := range []struct {
		name       string
		x, y, prod int
	}{
		{"two", 2, 3, 6},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := Mul(c.x, c.y); got != c.prod {
				t.Errorf("Mul() = %d", got)
			}
		})
	}
}
`;
    assert.deepStrictEqual(
      dead("go", text),
      [],
      "both tables read every column they bind; the first must not be bounded to the second's loop"
    );
  }
);

gtest("go-1b: the unread label column the re-cut fixture used to carry IS reported [P3 rule 11]", () => {
  const text = `
func TestAdd(t *testing.T) {
	for _, tt := range []struct {
		name string
		a, b int
		want int
	}{
		{"one", 1, 2, 3},
	} {
		if got := Add(tt.a, tt.b); got != tt.want {
			t.Errorf("Add() = %d", got)
		}
	}
}
`;
  assert.deepStrictEqual(
    dead("go", text),
    ["name"],
    "a `name` column never passed to t.Run is dead: the row value changes nothing and the subtests are unnamed"
  );
});

gtest("DEFECT go-2: any unrelated `range` between the table and its loop bounds the wrong body [P3 rule 10]", () => {
  const text = `
func TestAdd(t *testing.T) {
	cases := []struct {
		name string
		a, b int
		want int
	}{
		{"one", 1, 2, 3},
	}
	for _, s := range []string{"warm"} {
		_ = s
	}
	for _, tt := range cases {
		if got := Add(tt.a, tt.b); got != tt.want {
			t.Errorf("Add(%s) = %d", tt.name, got)
		}
	}
}
`;
  assert.deepStrictEqual(dead("go", text), []);
});

gtest("DEFECT ts-1: a test TITLE containing `=>` bounds the callback body to the title string [P3 rule 10]", () => {
  // callbackBody scans elements of the second call and takes the first `=>` it
  // sees INSIDE an element — the title literal is element 0.
  const text = `
it.each([
  [1, 2, 3],
])("add(%i, %i) => %i", (a, b, want) => {
  expect(add(a, b)).toBe(want);
});
`;
  assert.deepStrictEqual(dead("typescript", text), []);
});

gtest("DEFECT rust-1: an unrelated destructuring `for` before the walker invents a column and calls it dead [P3 rule 10]", () => {
  // walkerAfter stops at the first `for` whose ` in cases` is within 200 chars
  // ANYWHERE later in the text, then slices the header across both loops.
  const text = `
#[cfg(test)]
mod tests {
    #[test]
    fn table() {
        let cases = [(1, 2, 3), (2, 3, 5)];
        let names = ["one", "two"];
        for (i, item) in names.iter().enumerate() {
            assert!(!item.is_empty(), "{}", i);
        }
        for (a, b, want) in cases {
            assert_eq!(add(a, b), want);
        }
    }
}
`;
  assert.deepStrictEqual(dead("rust", text), [], "reports `i`, which is not a column of any table");
});

gtest("DEFECT cs-1: a tuple return type is read as the parameter list, so `int` is refused as a column [P3 rule 10]", () => {
  const text = `
public class T
{
    [Theory]
    [InlineData(1, 2, 3)]
    public (int, int) Add_Works(int a, int b, int want)
    {
        Assert.Equal(want, Calc.Add(a, b));
        return (a, b);
    }
}
`;
  assert.deepStrictEqual(dead("csharp", text), [], "reports `int`, which is a TYPE, not a bound column");
});

// ---------------------------------------------------------------------------
// ATTACK 4 — the Python body runs to end of text. Proven under-report.
// ---------------------------------------------------------------------------

gtest("DEFECT py-1: a second parametrized test masks the first test's dead column [P3 rule 11]", () => {
  // pyDefBody's suite ends at end-of-text, so `want` read by test_mul counts as
  // a read for test_add. Two parametrized tests in one reply is the normal shape.
  const text = `
import pytest


@pytest.mark.parametrize("a,b,want", [
    (1, 2, 3),
])
def test_add(a, b, want):
    assert add(a, b) == 3


@pytest.mark.parametrize("x,y,want", [
    (2, 3, 6),
])
def test_mul(x, y, want):
    assert mul(x, y) == want
`;
  assert.deepStrictEqual(dead("python", text), ["want"], "test_add binds `want` and never reads it");
});

// ---------------------------------------------------------------------------
// ATTACK 6 — interaction with phase 2's locator.
// ---------------------------------------------------------------------------

gtest("DEFECT rust-2: the new `_` filter + unconditional return makes phase 2 lose the table entirely", () => {
  // walkerAfter now RETURNS on the first `for` with ` in cases` nearby even when
  // its header yields no names, and drops `_`. findAssignedTupleTable then skips
  // the table, so its rows are never blanked and the blanker falls back to the
  // inline locator. Before phase 3, destructuredKnobs kept looking / returned "_".
  const text = `
#[cfg(test)]
mod tests {
    #[test]
    fn table() {
        let cases = [(1, 2, 3), (2, 3, 5)];
        for _ in cases {
        }
        for (a, b, want) in cases {
            assert_eq!(add(a, b), want);
        }
    }
}
`;
  const tables = assignedTupleTables(text, undefined);
  assert.strictEqual(tables.length, 1, "the table is invisible to the phase 2 locator");
});
