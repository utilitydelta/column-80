# Changelog

## Unreleased

Failure messages stop speaking to the wrong audience. `Error: generation truncated at
num_predict=2048 (done_reason=length)` was a channel line wearing a notification's clothes, and it
was one of six: a reply cut off mid-function, a stray code fence, a reply missing the function you
asked for, an empty reply, a stream that went silent, and a test module the extractor could not
find. Each now says what happened and what to do about it, in a sentence you can act on. The
channel keeps every internal string byte for byte, because that is the half a bug report needs.

Anything still unrecognised gets one line and a pointer. The catch-alls behind function generation,
test generation, Tighten Doc Comment and the first-run download used to forward the whole error
object, `Error:` prefix and all. They now show the first line and say the full message is in the
output channel.

A misbehaving server can no longer flood a notification. An HTTP error body went into the error
string whole, so 100KB of server JSON landed in a toast; the body and the status reason phrase are
both bounded now. And a connection that times out on the way to a remote host is recognised as the
server being unreachable, which is the message with the fix in it, instead of falling through to
the raw error text.

A disabled hardware tier that arrived without a message rendered `Column 80: undefined`. It names
the reason now.

Repair stops interrupting you about work you never asked to watch. Accepting a FIM completion
starts background repair rounds; keep typing and a round loses the version race, which is the
normal case rather than the exception. That discard was a warning notification, followed moments
later by the queued round opening its diff anyway, so the product contradicted itself inside two
seconds. It is a channel line now. A discard on a gesture you invoked still tells you.

Two disabled backends stop pretending. A remote Ollama that answers but has nothing pulled is no
longer treated as ready: the model is checked at the same moment the host is, so a missing model
fails at setup naming the model and the host instead of arriving as an opaque model-not-found on
your first generation. And Tighten Doc Comment consults the hardware tier like every other gesture,
so it can no longer fire rounds through a transport the build had already declared dead.

Rust import hints derive paths `rustc` accepts. The hint walked the file tree while Rust resolves
the module tree, so it named private modules under a header saying those types are already defined.
It now reads the `mod` declarations down the chain, rewrites a private segment to its `pub use`
re-export, and withholds the line when readable source proves the path wrong. A withheld import is
better than one the compiler refuses, and worlds better than one that compiles against the wrong
type of the same name.

## 2.2.0

Function generation can now live on another machine. Point `column80.apiBase` at a GPU box or an
on-prem Ollama and generation stops being gated on this laptop's VRAM: no local hardware probe, no
model override, and when the host does not answer the message names the host instead of blaming a
GPU the request never touched. FIM tab-completion stays on this machine in every configuration,
because it runs a 1.5b model most machines can serve; before this release, pointing `apiBase` away
silently took FIM with it and the ghost text just stopped. The first-run flow now pulls the FIM
model onto the box that will serve it, and reads readiness off the right catalog.

Generation refusals name their real cause. "No function at the cursor" used to cover three
different failures, and the commonest was a missing language server: FIM kept working, the cursor
was in the right place, and the message pointed at the one thing that was not broken. The resolver
now splits the causes, names the language server it expected (rust-analyzer, gopls, Roslyn,
Pylance, the TS server), says so when the tree is still indexing, and logs a `[fngen] refused:`
line for each. The manual's requirements list now says a language server is required, which it
always was.

A hung generation no longer wedges tab-completion. A FIM stream that goes silent is cut, 60
seconds before any data and 20 between lines, and the in-flight slot is released, so a dead
request stops pinning single-flight until a different keystroke happened to free it. A healthy
slow stream is untouched: the bound re-arms on every line, so only silence trips it.

The injected surface is more honest in Rust. Enum variant payload types now join the cross-file
walk, so the types data-oriented Rust keeps its structure in reach the prompt instead of stopping
one hop away. And a standard-library type no longer gets a made-up import line: the path was
derived from the sysroot's file layout, and measured against real `rustc` only 15 of 53 such lines
compiled, 35 failing on private modules. A wrong `use` line under a header that says "these are
already defined" is worse than none, so it is withheld and the channel says which types it
withheld it from.

Repair stops arguing with itself. A generic parameter is no longer resolved as a call owner, the
repair prompt's prose legs no longer spend a disclosure slot on the very function being repaired,
and a crate nested under a plain `[package]` ancestor gets repair back: the diagnostic anchor is
now the nearest manifest declaring `[workspace]`, not whichever ancestor happened to carry a
Cargo.toml. `cargo test` runs with more than one filter now pass them after `--`, where cargo
wants them.

What lands in your file survives the trip. On a CRLF document a generated body no longer arrives
with mixed line endings or a doubled doc comment: replies are normalised once at the core, and the
document's own ending goes back on at the write. In C#, a verbatim string nested inside an
interpolation hole keeps its value through re-indentation - the scanner's string state is a stack
now, and the defect was measured by compiling and running the result, 84 wrong values in a
300-case population. In Rust, a `'"'` character literal no longer opens a phantom string that
swallowed every comment after it, which had been silently disabling the backtick gesture for the
rest of the span. And a context block whose text contains a code fence can no longer mangle the
prompt: fences adapt to their content everywhere the product emits one.

Small and worth having: `column80.debounceMs` now carries a schema minimum, because zero silently
disabled the debounce and issued a full resolver call per keystroke; and repeated accepts in one
crate no longer re-spawn `cargo metadata` - it is memoized per crate root and invalidated when
Cargo.toml changes.

## 2.1.0

You cannot say a backtick. Dictate a doc comment and the mic drops one long line into the buffer
with no paragraph breaks and none of the gestures that put a type's real surface in front of the
model, so the comment-named-type leg is not degraded, it is lost outright.
`Column 80: Tighten Doc Comment` repairs that, and it never writes a word of its own.

It breaks the prose into paragraphs and wraps it under 80 columns without changing a word. The
guarantee is mechanical rather than reviewed: strip the whitespace and the backticks from the
comment before and after, and the two strings are equal byte for byte. Press it twice and nothing
moves, not the bytes and not the indentation. Five languages, and a Python docstring stays inside
the body where it belongs.

Then it asks a model which spans of your prose are type names, and throws most of the answer away.
A backtick on a type the prompt already carries is not free: the type cap is four, the
comment-backtick tier outranks two others, and a redundant gesture evicts a type the file is known
to define. Measured on this repository's own TypeScript, the backticks developers write by hand
cost 32% of the injected surface, 177,152 bytes against 261,578, and on 11 of 187 targets they
cost all of it. So the command proposes only what is absent from the surface function generation
would already build. Across 60 live rows it proposed nothing that was already there.

Every surviving backtick is checked against the language server before you see it. One that
resolves nowhere is stripped, with a channel line naming the word and the tier that refused it,
because a silent removal is the one behaviour this must not have. A type that exists in the
workspace but is not imported into this file carries its import path with it, per language, since
injecting a surface with no way to reach the type manufactures the very failure it was meant to
prevent. Graded by `cargo check`, `go list`, the CPython interpreter, `tsc` and a live Roslyn
server, every import line it emits compiles, on all five.

Two flags, both raised and neither filled. A term the comment uses in an instruction and never
defines, which is the defect that produced a silent off-by-four in the write-up's own experiment.
And a restated span, offered for deletion, because a deletion cannot introduce a claim. The
undefined-term flag fires on 0.7% of 17,774 real doc comments, so it is quiet enough to be worth
reading when it is not.

The command is manual, has no keybinding, and is in no automatic path. It applies to whatever
comment the cursor is in: the product never sees your microphone, and it does not pretend to.
Nothing about function generation, repair or tab completion changes.

## 2.0.1

Function generation against OpenAI's reasoning models failed on the first
request. Those models renamed `max_tokens` to `max_completion_tokens` and take
no temperature but their own, and the client sent the old body regardless.
It now reads which parameter the provider objected to, corrects the body, and
re-sends. What it learns it keeps per model, so a model costs one rejected round
trip the first time you use it and nothing after. No setting, and no model list
here to go stale.

## 2.0.0

C# stops paying for a data shape with a member list you already had. C# is the
one language whose member blocks come out of the same per-prompt budget its data
shape blocks come out of, and the shape blocks spent it first. A fat graph could
take the member list a type had before the shape block existed, and one type
could end up in the prompt with neither. The prompt now prices every member block
before it renders anything, and a shape block may only spend what is left over
plus what its own shedding will pay back. A shape block that cannot pay for
itself is refused and says so on the channel, naming the setting that buys it
back.

Measured over 1120 shapes of prompt: no prompt loses a member block, where 433
of them did before. It costs 28% of the data shape blocks and 5.7% of
the prompt bytes. That trade is deliberate. A data shape is new surface; the
member list is surface you already read.

The hover fan-out cap is two numbers instead of one. Tab completion still stops
at 32 members, because it spends its time against your next keystroke and
anything that arrives late is wasted. Function generation now goes to 48, because
you asked for it and are waiting on it. Nothing about tab completion moves.

Go asks the language server 26% fewer questions per function generation, and
renders exactly what it rendered before, byte for byte. The walk was buying a
hover for every collaborator it found while the render dropped 46% of them, and
31 of the 117 it gathered could never have been rendered at any budget.

Nothing changes for Python in the editor, and here is what it was already worth.
Function generation has always put the type that encloses your function into the
prompt; what did not exist was any way to measure it outside a running editor, so
it had never been graded. It has now. Against a compiler, on real Python, the
enclosing type takes 15 of 40 functions compiling to 35 of 40, and it removes the
failure that matters: of the generations that invented a member that does not
exist, none still invent one. Missing imports are what is left, and the injected
surface carries no imports.

## 1.3.0

Function generation can now run on a Claude subscription instead of an API key.
The new `claude-code` provider drives the Claude Code CLI you already have
signed in, so there is no second bill and no key to paste. The prompt goes to
the CLI on stdin, never on the command line, and the extension spawns it in its
own neutral directory so your workspace's `CLAUDE.md` and MCP servers cannot
change what the model is asked. Missing CLI fails closed with a message naming
the remedy, and FIM keeps working either way. Costs quota, not money, and the
manual says so.

Both off-machine backends now pay for the injected context once instead of once
per function. The stable prefix of the prompt is marked for caching and the
volatile tail is left after it, which is what makes the cache actually hit: a
measured session went from 23,217 context tokens to 3,471, and billed-equivalent
tokens from 24,370 to 1,713.

The output ceiling is no longer one number for every backend. It was 2048,
measured against a local 30B, and it also gated cloud models. On current Claude
models an omitted thinking parameter runs adaptive thinking, and the output cap
bounds thinking and answer together, so 2048 was spent before the model began
answering and the round failed as a truncated generation. Frontier serving now
gets 64000; local serving keeps 2048, where it is the right number and is bounded
by the context window it shares with the prompt.

C# gets its own aggregate context budget rather than the shared one, because a
Roslyn member list per type is far larger than a Go hover or a Rust definition,
so C# exhausted a token budget long before it exhausted a slot count.

Claude-Session note: the tuning constants are now derivations of serving class
and language rather than flat values, with identity defaults, so a replayed
generation produces a byte-identical prompt at the shipped numbers.

Also in this release, from 1.3.0's original scope: a Rust trait injected nothing,
because rust-analyzer answers a trait with a four-word hover and an empty member
list, so a function whose collaborator was a trait generated against a blank. The
extension now recovers the trait's surface from its own definition source.


Go function generation gets room for the types you name. The prompt's injected
surface was capped at four types for every language, a number measured for
Rust and inherited by the rest. Measured on Go with the documented convention -
a doc comment naming the collaborator types in backticks - the cap was the
binding stage of the whole pipeline: the developer's own named types were
parsed, found, and then evicted. Go's cap is now eight, measured at the knee
of a cap ladder over 907 real functions across six open-source repositories;
Rust keeps four because its own ladder measured flat.

What the convention now buys, measured with generation arms on 237 of those
functions, two runs each: with backtick docs and injection, 13.6% of generated
bodies compile against 4.9% with the same docs and no injection - 2.8x, and
the gains concentrate in type-rich code (a database driver +14.6 points, a
storage engine +16.7).

Candidate mining for Go and C# also stops paying for calls: an identifier
immediately followed by `(` is a function, never a type, and no longer burns a
language-server lookup - live lookups per function roughly halved.

Claude-Session note: nine frozen test rows pinning the old single-cap contract
are superseded as S15 with the measurement attached.

A Rust trait injected nothing: rust-analyzer answers a trait with a four-word
hover and an empty member list, so a function whose collaborator was a trait
generated against a blank. The extension now recovers the trait's surface from
its own definition source - method signatures, associated types and consts,
supertrait bounds - refusing whole on any parse doubt, and only for traits the
workspace itself defines. On the 237-row Rust corpus this was the single
largest hole: one trait alone appeared in 22 rows of the "nothing renderable"
channel line.

A type alias injected nothing either, even though its hover already says
everything: `type MemCache = ShardMemCache<CompiledValidator>`. The alias's
one-line hover now always injects, and when the target is a workspace type the
walk continues into it and renders its full surface under both names - the
alias's, because that is what the code at the call site says, and the
target's, because that is where the members live.

A usage-example block could carry someone else's documentation under a header
claiming "from its docs, this compiles". Measured: 38 of 47 example blocks on
the corpus never named the type they were headed with - one carried the
standard library's cell docs under a project struct's name. A gate at the
shared render seam (function generation and repair both pass through it) now
refuses an example whose code never names its headed type, and generic
parameters of the enclosing impl no longer masquerade as example candidates.

Together on the corpus census: types resolving to nothing fell from 53 per run
to 2, and lying example blocks from 38 to 0. Compile-rate arms against a
same-blob baseline of the previous release scored 57 baseline and 55 to 59
across three treatment runs - flat within the noise floor of 3. Per-row: six
stable wins on trait- and alias-carrying rows, five stable losses on
previously-passing rows (diagnosed and recorded in the session notes; the one
caused by external-crate trait surfaces was fixed by scoping recovery to
workspace-defined traits before release). The honesty fixes ride on their
census and oracle evidence, not the headline.

## 1.2.0

A struct or enum whose own definition did not fit the injection budget used to
vanish from the prompt entirely: not just the fields that didn't fit, the whole
type, name included. Function generation's injected surface for Rust and
TypeScript now truncates a def brace-safe at the field boundary instead,
carrying a `... N more fields` marker for what was cut, the same rule FIM
already applied. Measured on the 237-row Rust corpus against the previous
release's 56 of 237: two runs of this build scored 63 and 66.

Go and C# could name a type from another package or namespace but mostly
couldn't do anything with it: a Go import spells a package path, a C# `using`
spells a namespace, and neither line ever contains a type name, so import
mining (already working for Rust and TypeScript) had nothing to mine. The
extension now reads qualified references straight out of the signature and
body instead (`pkg.Type`, `Namespace.Type`), correlated against the file's own
imports so a look-alike on a local variable is never admitted. Go can now also
look a type up by name across the workspace, the way C# already could,
so a candidate with no local anchor is no longer a dead end. Measured on three
open-source Go projects: how often the type a function actually needs shows up
anywhere in its candidate list went from 5.5% to 7.6% across 2,890 functions.

A Python `Enum`/`IntEnum`/`StrEnum`/`Flag` class hovers identically to an
ordinary class, so its variants carried no information a prompt could use and
were dropped along with everything else that has no callable signature. The
extension now recognises an enum from its own class declaration and renders
each variant as `Type.VARIANT`, the same shape it already uses for C# enums. A
dataclass's plain fields are read the same way pyright reports them and are
left alone.

## 1.1.0

The injected type surface was truncated and the prompt called it exhaustive.
rust-analyzer elides parts of a type's hover, writing `/* … */` where the rest
of a member list would be. The extension injected that text verbatim and then
closed the prompt with "Call ONLY methods and constructors of `X` that appear in
the API surface above": a list the language server had itself marked incomplete,
declared complete, and everything off it forbidden. Measured on a 237-row Rust
corpus, 324 injected blocks carried such a cut across 63 distinct types.

The elided members are now restored from the definition file's own source, which
the extension has already opened. Three losses, one marker, told apart by where
it sits: a tuple variant's payload (recovered since the previous release), a
struct variant's payload, and the whole tail of a member list past the server's
display cap. `NodeStatus` reached the model as five variants with four empty
payloads and now reaches it as seven with their fields intact.

A wrong member is worse than an absent one, because it arrives in the compiler's
voice, so recovery refuses. Any disagreement between the hover and the source,
two declarations of the name that differ, an unreadable file, a `#[cfg]` inside a
payload or a cfg-gated body under a cut, and the hover is returned byte for byte.
Refusal is whole-type, never partial. Checked against 1,979 recoveries across
this project's Rust corpora and 260 crates from the local registry, and
separately against every declaration the corpus run actually rendered: no member
reached a prompt that its own declaration does not contain.

When recovery cannot prove the surface and the marker survives, the type is no
longer named in that ONLY list. An incomplete surface may still be shown; it may
not be declared exhaustive. The instruction itself always ships, and the rule is
per type, so a proven sibling in the same prompt keeps its scope.

Measured end to end on the same corpus: 56 of 237 generated functions compile,
against 47 for the previous release and 43, 42 and 40 for the three before it,
on a noise floor of three rows. Two independent runs of this build both scored
56.

One diagnostic fix rides with it. The output channel reported a type as starved
by the injection budget when an earlier walk in the same prompt had already
emitted it, so its declaration was in the prompt while the channel said it was
missing. Four rows on the measurement corpus, and every zero-byte count in this
project is read off that channel.

## 1.0.4

Repair no longer walks your code one indent level deeper every round. The repair
prompt showed the model the failing code exactly as it sits in the file, so its
body carried the file's own column while its signature sat flush. A model echoes
what it was shown, and the placement then added the target's column on top of one
the body already had. Three rounds on a function nested in an `impl` walked its
body from 8 spaces to 12 to 16 while the closing brace went 4 to 8 to 12. Rust
indentation is not semantic, so the code still compiled and nothing flagged it:
the only detector was a human reading the file. The failing code is now
normalised to its own column zero before it enters the prompt, so every reply is
relative and the one placement rule is correct on the generate, repair and refine
paths alike.

The same defect was in the refine gesture, untouched until this release, and it
is fixed with it. Doc comments are normalised the same way, so a prompt no longer
shows a block whose first line is hard left and whose remaining lines hang under
nothing.

Go is now a registered placement language. It never had a leg, so a Go function
generated at a nested target was placed at the wrong column, and Go repair only
looked correct because two errors cancelled.

Function generation gets a second repair round when the error count is still
falling. It previously stopped after one round against a hard cap of two, quitting
while the count was still dropping: one captured function went 12 errors, then 2,
then 1, and stopped. The cap is unchanged at two, and a round that bought nothing
is still refused, now with the reason on the channel.

A compiler diagnostic that the classifier recognised but could not resolve now
falls through to the diagnostic harvest instead of leaving the round with no
surface at all. A harvested name still has to resolve before a byte is injected.

## 1.0.3

Generated code lands at the right column in all five languages. Generation shows
the model code that is already written and asks for what goes under it, and a
model that answers in place, with its lines already indented to sit where they
were shown, was having the target's own column added on top. In Python the body
arrived one level too deep and the file stopped parsing; in C#, TypeScript and
Rust the body and its closing brace sat a level too far in, which compiles, so
nothing ever flagged it. The reply is now placed at the target's column rather
than shifted by it, and generation, repair and refine all place it through one
piece of code instead of three copies. Two smaller ones fall out: a nested Python
function without a docstring no longer splices at the wrong column on repair, and
a `#` comment hanging at some other column no longer decides where a Python body
sits.

Repair and refine work on a documented Python function. They ask the model for a
body, because the docstring stays where you wrote it, and then held the reply to
a declaration head it was told not to write. Every obedient answer was thrown
away, so those two gestures could not fix a Python function with a docstring at
all.

Column 80 no longer publishes diagnostics. It used to mirror its check results
into the Problems panel, and that mirror could only be replaced by the next check
on the same project root: fix the error by hand and it stayed on your Problems
list with nothing able to clear it. Your language server already reports those
errors and clears them as you type. The check still speaks at the edit site, with
the full compiler output on hover, and on the output channel. That annotation now
disappears on your first edit rather than describing text that has moved on.

## 1.0.2

First-run hardware detection now sees Apple Silicon through Rosetta. An M-series
Mac running the x64 build of VS Code under Rosetta 2 reports its process arch as
`x64`, which used to skip the Mac path entirely: the extension probed for an
nvidia-smi that exists on no Mac, the probe failed, and a capable machine dropped
to the no-GPU tier with function generation disabled and no models offered. The
probe now confirms the physical CPU with `hw.optional.arm64`, so the tier select
and model-download flow appear as they should. A genuine Intel Mac is unchanged.

## 1.0.1

Marketplace description only. No code changed.

## 1.0.0

First Marketplace release. A local model writes the code, your own toolchain
checks it, and nothing lands without a diff you accept.

- Autocomplete against a 1.5B FIM model. At a member access the candidates come
  from your language server, so the ghost cannot name a member that does not
  exist.
- `Column 80: Generate Function Body` builds a function from its doc comment,
  its signature, and the context blocks you picked. On accept your compiler runs
  against the change and any errors drive up to two repair rounds.
- `Column 80: Repair Function Body` finds real call sites of the types and
  methods you used and asks the model to rewrite your function the way the rest
  of the repo is written.
- `Column 80: Generate Tests (TDD)` writes tests blind of your implementation
  and blanks every expected value. You Tab through the holes and type the
  answers. The model's guess is never inserted.
- The Model Context panel in the Explorer shows everything the model will see.
  It starts empty. Blocks are live ranges resolved at prompt time, so a block
  that grew while you typed reaches the model as it reads now.
- Rust, Go, TypeScript, Python and C#.
- First activation probes your GPU, picks a tier, and offers the models that
  tier needs. It never pulls a model without your click.
