# Perfect functions

Column 80 generates functions, repairs functions, and will soon criticize functions. The
manifesto already says the function is the unit of generation. This document says what a
good one looks like, where that idea came from, and which parts of the tradition this
product accepts and rejects. It is the research canon for the perfection-audit feature
(the craft half of Criticize). It is not the final authority on taste: that is a
human-dictated journey, still to be written, and where the two disagree the human's
wording wins.

The immediate trigger was Logan Smith's video "How to write the perfect function"
(youtube.com/watch?v=2OMRWPOSw9s, 2026). Nothing in it is new, which is its virtue: it is
a working developer's compression of fifty-plus years of prior art into one usable frame.
The full evaluation against our literature canon lives in
`session-v60/research-canon.md` section 5.

## The frame

Four ideas from the video, restated as this repo would state them.

**Honest and dishonest functions.** An honest function touches the world only through its
signature: it reads nothing and writes nothing the caller did not hand it. This is purity
with the religion removed. An in-place sort is honest, it mutates only what you gave it
and says so. `getTime()` is dishonest, its signature is a lie of omission, the real input
is the state of the universe. Honest functions can be tested, reasoned about locally, and
stepped through with confidence. Dishonesty is infectious upward: one dishonest call makes
the caller dishonest too. So the architecture follows: build the core out of honest
functions and inject the dishonesty (I/O, clock, randomness, screen) at the topmost level,
passed in as arguments. The PRNG example is the canonical one: a function that seeds and
reads a global generator is untestable and unreproducible; the same function taking the
generator as a parameter is both, and costs one argument.

**Signature empathy.** The signature is used first by a human. Six positional arguments
with implicit conversions is hostile; an args struct or strong types is kind. Demanding a
`vector<int>` when the body only iterates is over-constraining: ask for the weakest thing
the body actually needs. And when the body genuinely requires an invariant, put the
invariant in the parameter type (a `NormalizedVec3`, not a `Vec3` plus a comment), so the
compiler enforces the contract and the caller, who has the context, pays for establishing
it once. That is Alexis King's parse-don't-validate, arrived at independently. The
proof-token pattern rides the same rail: if B is only legal after A, have A return a
receipt type that B requires, and the ordering bug becomes a compile error.

**One level of abstraction.** Every line of a body should sit at the same altitude. If
reading the function means zooming into character codes, back out to business logic, then
into a hand-rolled binary search, the function is mixing bricks with brick-making. Comments
that label sections ("// convert to lowercase") are the tell: each labelled section wanted
to be a function. The payoff is a body that reads as a high-level series of obvious steps,
where correctness is believable at a glance because every step is a named, tested brick.

**Write the function you wish existed.** When mid-thought you need capability you do not
have, call the function you wish existed, with the signature you would want as a caller,
and implement it later. The call site designs the interface. This is the June parable from
Tony Van Eerd's talk that opens the video, and it is also why the product's fn-gen gesture
starts from a signature and doc comment: the wish is the spec.

## Fifty years of prior art

The lineage, one surviving idea per entry. Aye, people have been circling this same island
since before structured programming had a name.

- **1968, Dijkstra, "Go To Statement Considered Harmful."** Control flow must be simple
  enough that a human can map the program text to its runtime behavior. The whole
  fits-in-your-head tradition starts here.
- **1969, Hoare, "An Axiomatic Basis for Computer Programming."** Preconditions and
  postconditions: a function is a contract, not a ritual.
- **1971, Wirth, "Program Development by Stepwise Refinement."** Write the outline, then
  refine each step. The direct ancestor of one-level-of-abstraction.
- **1972, Parnas, "On the Criteria to Be Used in Decomposing Systems into Modules."**
  Hide a design decision, not a step of the flowchart. Decompose around what might change.
- **1974, Kernighan and Plauger, "The Elements of Programming Style."** "Write clearly,
  don't be too clever." Still the shortest complete style guide ever published.
- **1974-79, Constantine and Yourdon, structured design.** Coupling and cohesion: the
  vocabulary for why some extractions help and others just scatter one idea across five
  functions.
- **1976, McCabe, cyclomatic complexity.** The first attempt to measure "too branchy."
  Useful as a test-count floor, misleading as a readability score; Sonar's cognitive
  complexity (2017) fixed the nesting blindness.
- **1977, Backus, "Can Programming Be Liberated from the von Neumann Style?"** The Turing
  lecture that founded the functional tradition. We take the diagnosis (state everywhere
  makes reasoning impossible) and decline the prescription (see boundaries below).
- **1978, McIlroy, the Unix philosophy.** Do one thing well; compose through a universal
  interface. The pipe is signature empathy at operating-system scale.
- **1984, Knuth, literate programming.** Code is written for humans to read, and
  incidentally for machines to execute.
- **1988, Meyer, "Object-Oriented Software Construction."** Design by contract, and
  command-query separation: a function either answers a question or changes the world,
  never both in secret. We keep CQS and the contracts; the inheritance lattices stay in
  the eighties.
- **1999, Fowler, "Refactoring."** Named the smells and made extract-function a
  repeatable discipline instead of an instinct.
- **2007, Carmack, the inlined-code email.** The counter-testimony: sometimes the honest
  form of a function is long and sequential, because splitting it hides state transitions
  and invites callers to call the pieces out of order. A long function you can F10
  through beats a constellation of tiny ones you cannot.
- **2008, Martin, "Clean Code."** The small-functions gospel. We keep the defensible core
  (one level of abstraction, honest names) and treat "extract until nothing is
  extractable" as refuted by the next two entries.
- **2013, Sean Parent, "C++ Seasoning."** No raw loops: a loop with a non-trivial body is
  an algorithm without a name yet.
- **2014, Acton, "Data-Oriented Design and C++."** See boundaries below; the talk that
  anchors this repo's anti-OO stance.
- **2018, Ousterhout, "A Philosophy of Software Design."** Deep functions: simple
  interface, substantial implementation. Over-decomposition is real and causes
  entanglement. Define errors out of existence. Comments state what the code cannot.
- **2019, King, "Parse, Don't Validate."** Make illegal states unrepresentable at the
  boundary; the type system carries the invariant so the body never re-checks it.
- **2022, Gross, grugbrain.dev.** The working developer's summary of the entire lineage:
  complexity very, very bad. This repo's CLAUDE.md speaks grug for a reason.
- **2024-25, the Ousterhout-Martin written debate.** Function length is contested canon.
  Both sides agree over-decomposition harms; Martin's own showcase decomposition
  introduced a measured 3-4x performance regression. Consequence for this product: never
  auto-split a function, ever.

## House boundaries

Two traditions get shown the door, and it be worth writing down exactly why, because both
knock politely and carry good references.

### No object-oriented world modeling

Mike Acton's CppCon 2014 talk (transcript at
`~/work/utilitydelta/personal/talks/Mike-Acton-data-driven-design.txt`) names the three
lies: that software is a platform, that code should be designed around a model of the
world, and that code is more important than data. The second lie is the one that ruins
functions. World modeling says a chair is a chair, so `Chair` gets a class; the reality is
a static chair, a physics chair, and a breakable chair share almost nothing in how their
data is transformed, and the inheritance link between them is storytelling, not
engineering. Acton's sharper points survive at function granularity:

- The purpose of every function is to transform data from one form to another. If you do
  not understand the data, you do not understand the problem.
- Where there is one, there are many. If the common case is a batch, the honest signature
  takes the batch, not one element wrapped in a loop of virtual calls.
- Last-minute decision-making is a smell: a bool checked deep inside a hot function is a
  decision the caller already knew, paid for on every element. Separate the states and
  let the caller pick the function.
- The best code is code that does not need to exist. Precompute, do it offline, push it
  back in time.

Consequence for a perfect function here: it takes the data it transforms as plain
arguments, it does not reach through a `this` graph to find its inputs, and free functions
over data structures beat methods on world-model objects wherever the language allows.
Christer Ericson's line from the same talk stands as the epitaph for the pattern
industry: design patterns are spoon-fed material for programmers incapable of independent
thought.

### No hardcore functional programming

The functional tradition diagnosed the disease correctly: unmanaged state destroys
reasoning. This product takes the treatment at the sane dose, honesty as the default,
effects injected at the top, and stops before the religion. Rejected: monad transformer
stacks, point-free style, closures returning closures returning closures, recursion as a
loop replacement, and any construct whose evaluation order cannot be watched in a
debugger. A lambda passed to a filter is fine. A lambda that is the architecture is not.

The dividing line has a name here: **the F10 test**. A perfect function can be stepped
through in a debugger, line by line, watching values change, and the text on screen maps
one-to-one onto what executes next. Acton lists debuggability among the values that
justify the whole approach, and grug devs live by it. Cleverness that defeats the
debugger is not craft, it is dishonesty toward the next reader, who is usually you at
2am with a repro case.

## Per-language aesthetics

Each of the product's five languages has its own idea of a beautiful function, and its
own characteristic temptation. A perfection audit that ignores this flags Rust for not
being Python.

**Rust.** The language enforces honesty mechanically: `&` declares reading, `&mut`
declares mutation, ownership declares who cleans up. A perfect Rust function returns
`Result` and lets no panic cross its boundary; matches exhaustively so new enum variants
break the build instead of the behavior; and spends the newtype pattern freely, because a
zero-cost wrapper that carries an invariant is the cheapest correctness money can buy.
The temptation: generic wonderlands and trait-object soup. If the signature needs three
`where` clauses to say "takes bytes," it has stopped being empathetic.

**TypeScript.** The types are erased at runtime, so honesty must be structural: plain
data in, plain data out, discriminated unions over class hierarchies, and the union's
tag checked with an exhaustive switch. Narrow at the boundary once (parse, don't
validate) so `any` and optional-chaining paranoia never reach the core. The temptation:
class-and-decorator ceremony imported from Java-shaped frameworks, and hiding an `await`
inside a getter. A signature that returns `Promise` is honest about time; one that
secretly blocks is not.

**Python.** The Zen already encodes the aesthetic: flat is better than nested, explicit
is better than implicit, readability counts. A perfect Python function has type hints on
the signature (the honesty line), a doc string stating the contract, one comprehension at
most, and reads aloud as English. The temptation: magic. Decorators that rewrite
semantics, metaclasses, `@property` accessors with side effects, and the clever one-liner
that compresses three ideas into one unreadable expression.

**C#.** The most OO-pressured language of the five; perfection here is mostly resistance.
Static methods over instance state, records and structs for data, no interface with a
single implementation (the mock-industrial complex is world modeling with a test budget).
LINQ is the sanctioned lambda dose, until the query nests closures deep enough to fail
the F10 test, at which point a foreach is the more honest form. Async honestly colored,
all the way down, no `.Result` deadlock bombs.

**Go.** The language is already the style guide, and gofmt ended the formatting argument
permanently. `(T, error)` returns are enforced honesty: every function that can fail says
so in its signature, and the caller must look the failure in the eye. Early returns,
happy path left-aligned, small interfaces declared by the consumer. Clear is better than
clever, per the Go proverbs. The temptation: `interface{}` laundering, and spawning
goroutines inside library functions, which is temporal coupling that leaks scheduling
decisions the caller never agreed to.

## What this means for Criticize

The perfection audit judges functions against this document, in two channels with
different evidence rules:

- **Deterministic detectors carry the audit.** Reads and writes that bypass the signature
  (globals, statics, clock, PRNG, env, singletons), nesting depth, parameter count,
  cognitive complexity, mixed abstraction levels betrayed by section comments. These are
  static facts, reproducible on unchanged bytes, and they map to the honest-function and
  SLAP dimensions directly. This is the deferred e4/e5 content from session-v60.
- **Judgement dimensions are advise-only, forever.** Depth, naming honesty, whether a
  split helps or entangles. The Ousterhout-Martin debate is unresolved among humans;
  a product that auto-splits functions is taking a side with someone else's code.
- **Never optimize for finding count.** Silence on a good function is the correct and
  common verdict. The audit's aesthetic authority is this document plus the
  human-dictated journey, ratified up front as a ruled constraint; measurement applies
  to the detectors' precision, never to whether craft matters.

Understand every line you ship. A perfect function is one where that is easy.
