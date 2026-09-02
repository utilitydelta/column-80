# Changelog

## 3.3.0

**A dictated ghost at module level lands, and Escape is the way out.**

The editor never draws an inline item that ends on an empty line, and a dictated ghost outside
any block ended on one (its fresh line carried no indent), so a type alias, a `struct Foo;` or
any head that opens no body served, committed to nothing, and left the "heard:" label on the
status bar. Now the fresh line is withheld at module level and the caret stays at the end of
the landed code, one Enter away. A commit that lands nothing ends the gesture on its own,
retrying the commit twice for a slow host first, and says so on the status bar. Escape cancels
dictation at every point: mic open, decoding, generating, or over the ghost, with the Output
panel focused or not. A dictated head reads through the attribute or decorator lines the
model puts above it (`#[derive(Debug)]`, `[Serializable]`, `@dataclass`) instead of landing the
doc comment over a bare attribute. A C# positional record ending in `;` no longer gets a body.

## 3.2.0

**Dictate a declaration, and the sentence stays as the doc comment.**

On a blank line that is not inside a function body (module level, inside a struct, impl, class
or interface, an empty file) dictation keeps what you said: it lands as the doc comment in the
language's own form (`///`, `//`, `/** */`, or a Python docstring inside the body), the model
writes the declaration head under it, the body's first line and closer land where the head opens
one, and the caret is inside. One accept, the same write path as a line. The compiler check and
repair on the head and the body generated from the doc comment are the second half, roadmap 78.


**Say what the next block does, and the ghost writes it.**

`shift+alt+d` opens the microphone, the same chord closes it, and what you said rides into one
FIM request as a comment the file never sees. The generated line goes straight into the file
and the cursor drops onto a fresh line at the block's indent, with nothing pressed; Ctrl+Z takes
it back. What was heard shows on the line as a label while the code lands. Names your buffer
already spells are matched by fold and backticked into the comment; single English words are
never matched inside a sentence. The recogniser is whisper.cpp `base.en`, vendored per platform
and resident from activation, local like everything else; the model downloads after you click
Download, the way the ollama models do.

Settings: `column80.dictation.shortcut` picks the chord (five offered, or `none` to bind
`column80.dictate` yourself), `column80.dictation.microphone` with a Select Microphone picker,
`column80.dictation.muteSpeakers` (Linux and macOS), `column80.dictation.partials` (what is
being heard, live on the cursor line), `column80.dictation.autoAccept` (off leaves a ghost for
Tab), `column80.dictation.surfaces` (below), `column80.dictation.enabled`. Keystroke FIM off
(`column80.enabled`) keeps dictation on. New: `column80.checkOnFimAccept` turns the compiler
check and repair after an accepted ghost off, so a Tab can be just a Tab.

Measured on 360 authored sites across two private corpora before it was built: the spoken
intent moved the first line of the ghost from 34.4% to 43.6% under the product's bound (46.1%
typed). Then measured again through the product's own code after it was built: the cleaner and
the backticks change nothing at the ghost (157 of 360 either way, noise floor 5), and resolving
the spoken type names into surfaces above the comment COSTS 12 to 15 first lines at every
budget. The surface leg ships switchable (`column80.dictation.surfaces`); read the manual before
leaving it on. What the manual also says, measured on the first live gestures: say what the
line does in plain words, not its syntax; and where the code below the cursor repeats a pattern
(four `from_le_bytes` reads), the 1.5b copies it over anything the sentence says unless the
sentence names the qualified call and says what not to do.

Under the hood: FIM now pins ollama's context window at 8192 on every request, so a bigger
prompt cannot be cut in silence, and a dictated request races its type resolver at 400ms
instead of 50. The vsix is now built per platform (Linux x64, macOS arm64 and x64, Windows x64)
because it carries two native binaries; macOS and Windows are built but not yet proven on real
hardware. A default keybinding ships, the first since v32 ruled none; it is a setting.

## 3.0.0

**Two ways to have a function reviewed, and they are not versions of each other.**

**Column 80: Criticize Function** is the rubric: deterministic detectors, fixed words, the same answer
twice. **Column 80: Review Function (model)** is new: a model reads the function and writes the
comments itself, in your identifiers and about your actual failure modes. Both ship enabled, on
whatever model you have configured, and the manual has a table telling you which to reach for.

Use Criticize when you want the same answer twice - grading, a refactor backlog, a pre-commit check.
Use Review when you want something specific to this function, and read every comment before accepting
it.

### The model writes the review, and cannot write it about code you do not have

The model answers with the LINE IT IS TALKING ABOUT, quoted. The product finds that text in your
function and plants the comment above it. A quote that matches nothing is dropped; one that matches
two lines is dropped unless the model also says which. So a comment can only ever land where its own
quoted text really is, and the output channel names every block that was dropped and why.

Measured on twenty real production functions, blind, against the rubric's fixed phrases with the judge
never told which side was which: Opus won 19-1, GPT-5.6 12-8, a local 27B 10-10. All three placed
their comments about equally well, so **a review that lands cleanly is no evidence it is right.** The
manual says that in as many words, along with three real examples of confidently wrong advice.

It is also not repeatable: two presses on unchanged code produced the same set of dimensions three
times in fifteen. Criticize is the one that does not do that.

### The four honesty dimensions stopped being a list of spellings

`clock`, `prng`, `env` and `world` were 67 hardcoded patterns naming library calls someone had thought
to write down. A row reading `clean` meant "none of my patterns matched" while it read to you as "this
function is honest". Those patterns are gone; a model reads the function instead.

Against the patterns it replaced, on 92 real functions: it found twenty things they could not see -
a project's own `unix_epoch_now_ms()` helper, a shell-out through `Command::new("ssh")`, a
`Guid.NewGuid()` read as randomness, and two findings reached THROUGH a callee - and missed **nothing**
they caught. With no model, those four rows come back `blind` with the reason, never `clean`.

### The rubric got smaller, on purpose

**If your linter already answers it, this no longer asks.** Measured, one fixture per dimension per
language, run through each language's own checker:

- **`unused-param` is DELETED.** TypeScript reports it with no `tsconfig` at all, and clippy reports
  it out of the box. Fifteen dimensions are now fourteen.
- **`undocumented` now REFUSES in Rust, C# and Python**, naming the rule that answers it -
  `missing_docs`, CS1591, `D103` - so you learn where to turn the real check on. It still asks in Go
  and TypeScript, where nothing in either toolchain reports a missing doc comment.
- **`param-count` and `nesting` stay, and the audit strengthened their case.** At this product's
  thresholds nothing in any of the five languages says a word: clippy's `too_many_arguments` fires at
  8 where this fires at 5, and ruff's nesting rule is preview-gated and fires at 6 where this fires
  at 4.

### Safety

A model's sentence can no longer carry control characters, zero-width characters or a bidirectional
override into your source file. U+202E is the Trojan Source shape - the line you review is not the
line the compiler reads - and a tool whose whole gesture is "accept this diff" is the worst possible
place for it. Also closed: a homoglyph walking a banned word past the voice rules, and a leading
bracket or list number walking a description past the imperative-mood check.

### Local models

The default stays `qwen3-coder:30b`. A dense 8B was measured faster and better on the review path and
then generated **zero of twelve** compiling C# functions against the MoE's four, so it did not ship:
review performance does not transfer to code generation.

The 24GB tier moves to `qwen3.8:27b`, which ties on generation and is the only local model measured to
reach the cloud tier's placement rate on the review path.

**`column80.fnGenThinking`** is new, and off by default because reasoning is billed to the same token
budget as the answer. At the shipped cap a reasoning model thinks until the budget is gone and the
code is truncated before it is written; raising the cap fixes that and it still compiles no better
while taking **eleven times longer**. It is a free string, not a drop-down, because the vocabulary
belongs to the model: one afternoon measured four different answers across four models.


## 2.5.0

A rubric that hands you a diff. **Column 80: Criticize Function** scores the function under your
cursor against fifteen named dimensions of craft, prints a card, and offers you the function back
with a blunt comment planted above every line that failed. Accept and the comments land in your
source. Reject and nothing was written.

    // C80 clock: reads the wall clock through Instant::now. Hidden wall-clock
    //     read. Untestable. Pass it in.
    let start = Instant::now();

The words are fixed, one phrase per dimension, and no model writes them. They are short and
deliberately rude: name the defect, name what it costs, give the order. There are no citations in
your source file, no second person, and no "you might consider". The card in the panel keeps the
principle and the teaching; the comment in your code keeps the instruction.

**Press it again and it replaces its own comments rather than stacking them**, so you can criticize,
fix half of it, and criticize again without cleaning up after the tool. It strips only what it wrote:
your own notes survive, including one that starts with the same marker.

Nothing moves until you accept. It goes through the same preview-and-confirm gate that function
generation and repair already use, so it adds no new way for this extension to write to your files,
and it still publishes nothing to the Problems panel.

Two ways to read one card. Read the whole roster and it tells you which of fifteen questions your
function answers badly, which is what you want when you are learning the craft. Read the elevated
rows and stop, and it is a worklist. Each dimension names the principle behind it rather than the
line alone: command-query separation, Meyer 1988, a function answers a question or changes the world
and never both. Rust, Go, TypeScript, JavaScript, C# and Python.

**Nine of the dimensions carry a blast radius.** The honest fix for "this reads the wall clock"
changes the signature, and a signature change edits every call site, so those rows walk the call
hierarchy one level up and report what a fix would reach. When the walk cannot finish you get no line
rather than a zero: "touches 0 call sites" is a claim the walk never made, and you cannot tell a
measured zero from an unmeasured one.

**The findings are not the model's, and it cannot make them be.** Every finding comes from a
deterministic detector reading your code, so pressing the gesture twice on bytes you have not touched
gives you the same card and the same diff twice. An earlier build let a model decide what the
findings were and it never produced the same list twice on unchanged code: three functions,
temperature zero, three runs each, zero agreements, and on one function ten findings a run with not
one appearing in all three. What the model does now is explain ONE finding a detector already made,
in the panel only. It sees that finding and nothing else, and it can neither add a row nor remove
one. If your tier has model calls off, or the call fails, the card is complete without it.

Every refusal names its cause. An unregistered language is refused by name. A cursor outside a
function is refused rather than quietly scoring the file. A dimension the language cannot answer
reports as blind with its reason and never as clean: TypeScript has no checked exceptions, so "can it
fail in a way the signature never admits" has no answer there and says so, and Python's optional type
hints make two dimensions report a coverage gap rather than a pass. A function with nothing above the
bar gets no diff at all, and the channel says which of the two reasons that was.

What was measured, and what was not, stated plainly because a grading tool that overclaims is worse
than none. All fifteen dimensions are graded against a 138-row hand-labelled set. Fourteen of the
fifteen produce no false positive on it, and eleven also find everything they should, scoring 100%
precision and 100% recall. The rest are the honest weak half: the world detector at 100% precision and
60% recall, the unadmitted-failure detector at 100% and 64%, the command/query detector at 100% and
29%, and the pass-through detector at 86% and 50%, which owns the set's single false positive.
Precision is the strong half and recall is the weak one, so a row that fires is worth acting on and a
row that stays quiet is not a result. The set is thin in places, resting on as few as four positive
examples for some dimensions.

The honesty question is also not answered whole: the detectors read text, not types, so they do not
find a function reading a variable bound outside itself, and they miss a clock reached through an
aliased import or a field. On the product's own canonical dishonest function they catch the clock
read and miss both the module-state read and write. One dimension, the section comment as a tell for
mixed abstraction levels, ships scored but never elevated at a measured 31.0% firing rate on real
Rust, pending a decision about whose bar applies. One other, the unenforced-precondition detector,
does elevate but cannot tell an obligation on the caller from a description of the function's own
behaviour; it refuses rather than reporting clean when it cannot attribute the wording, and a quiet
result from it is not evidence a contract is enforced.

The gesture is driven end to end in a real editor on TypeScript, Rust, Go and C#: the diff appears,
the buffer does not move before Accept, Accept plants the comments and touches no other byte, a
second Accept leaves the file identical, and the comment lands on the line the card named. **Python's
editor rows did not run**, because Pylance would not start in the test profile; Python is covered
headless at every layer but the live-server seam is unproven for it.

Also in this release: the preview tab's buttons read Accept Proposal and Reject Proposal rather than
naming a generated body, which they did for all three gestures that share them.

## 2.4.0

Your own tests now drive repair. The compiler oracle cannot see a failing test, so a generated
function could write DER where every test reads PEM and the product would report success. That hole
is closed, on a manual gesture and nowhere else.

**Column 80: Run Covering Tests** walks the call hierarchy upward from the function under your cursor
and runs the tests in your repo that actually reach it. Not a name match and not a body search: an
AST call walk through your language server, so a test that gets there through five layers of shared
harness is found and one that merely looks related is not. It reports how many hops away each test
is, because that distance is a readout of your own design rather than a detail. Rust, Go, C# and
Python. TypeScript and JavaScript are refused by name, and that refusal is the honest answer:
tsserver resolves the query to a file rather than a test, so the walk cannot name a TypeScript test
at all, and reporting an empty walk as "no test calls this" would be a false claim in the one place
this design exists to refuse one.

**Run Repair Function Body on the same function and the failures go into the prompt**, digested down
to the assertion that failed and the source line it sits on. The tests then run again, automatically,
and the compiler is re-checked alongside them so a repair that fixes an assertion and breaks the build
is never reported as green.

Two things had to both be true before a failing test could reach a model at all: you invoked the
gesture on this target, and the failing test is in the walk's discovered set for it. A red test
elsewhere in your repo is not your function's problem and authorises nothing. The automatic repair
after an accept still cannot reach this class of failure, structurally. The two-round cap is
unchanged and now shared: compiler rounds and the test leg are mutually exclusive, so one press is
still at most two model calls.

Test-repair stays banned. No gesture edits a test.

Some of your tests are refused before they run. Discovered tests are whatever your repo happens to
contain, and this gesture runs them and then runs them again. On one real C# corpus 45 of 257 tests
sit in a class whose shared fixture drops tables in a live Postgres and recursively deletes a
hardcoded path inside the user's home directory. A test carrying that kind of marker is discovered,
reported with the marker that gave it away, and left alone. The filter reads declarations, so treat
it as a floor: a test that quietly binds a socket with nothing in its declaration to say so still
runs.

**Run TDD Tests stops dead-ending.** It runs the tests you ratified, found by the fence Generate
Tests wrote, and on a function whose tests you wrote by hand there is no fence. It used to answer
that with "run Generate Tests (TDD) first", which is wrong advice for someone who already has tests.
It now names Run Covering Tests as well, and only in languages where that gesture actually works.

## 2.3.0

The output channel keeps what the server actually said. Every unknown-error notification ends "The
full message is in the output channel", and that had quietly stopped being true: once the width
bound moved into one place, both surfaces got the same 400 characters and the channel had nothing
the toast did not. Each backend now writes the server's raw answer to the channel the moment it
arrives, before anything shortens it, up to 16 KiB with a note when it cuts.

A compiler diagnostic is one line in a notification and all of it in the channel. A TypeScript
assignability error is multi-line by construction, and the two repair notifications interpolated it
whole, so a normal type error filled the corner of your screen. Both are one line now, both point at
the channel, and the refine notification keeps its "undo it with the editor's own undo" clause,
which is the half you act on.

A reply that dies halfway is no longer offered to you as a finished function. Only one of the three
backends could tell that a stream had ended early; the other two returned whatever text had arrived
and the service accepted it. All three notice now, and all three say the same thing.

When a provider puts its failure inside a successful response, you read the provider's reason. A 200
carrying an error frame was parsed, matched nothing, and vanished - so you were told the model
produced nothing usable while the provider was saying it was overloaded.

You can stop a generation that is going nowhere. Cancelling lived inside the progress notification,
so dismissing that notification took the only way out with it and left the work running against a
server that had stopped answering. There is a status-bar item now for as long as work is in flight,
naming what it belongs to; clicking it cancels, and it does not go away when you dismiss the
notification. There is a `Column 80: Cancel Generation` command behind it, with no default key
binding - bind it to whatever you like, and the item's tooltip says so. Repair and refine rounds
are cancellable too, which they never were.

The Claude Code backend explains itself. It put the CLI's own output straight into notifications,
so you read `Claude Code exited 1: Error: connection closed`. It now says whether you need to log
in, whether the backend could not start and why, whether the provider is throttling, or whether the
CLI failed and the channel has the rest. The CLI's words go to the channel, not to your screen. This
also fixes something nobody had noticed: a Claude Code failure could be reported to you in a
completely different failure's words, if the CLI happened to print them.

An HTTP status says what to do about it. A 401, a 429 and a 503 are three different problems and all
three used to arrive as a wall of the provider's JSON. Now: the key was refused, the provider is
throttling, the provider is having trouble - each with what to do next, and the provider's own JSON
in the channel where it belongs.

Where the product does not recognise a status, it says nothing clever. An unrecognised status keeps
showing you the provider's own message, because that message is usually the answer: a 404 tells you
the model is not pulled, a 400 tells you the prompt was too long. A tidy sentence with a number in
it would have been worse.

A misbehaving server can no longer flood a notification on any backend. The bound started on the
local path and left the Anthropic and cloud clients with byte-identical unbounded copies, so a 500
with a 100KB body put the whole 100KB in a toast: measured at 102437 characters. The bound is one
piece of code now and all three clients use it, on the body and on the HTTP reason phrase.

The same is true of text that arrives inside a successful response. A model server can answer 200 and
put its error in the stream, which never passed through an error body and so was never bounded.
Three such sites are bounded now, and so is the model download's progress line, which is not an
error at all and which a server could still make 100,000 characters wide.

One failure, one sentence, instead of three. A stream that ends without its terminal marker, and a
response that arrives with no body at all, used to hand you `message_stop` or `response has no body`
depending on which backend you had configured. Those are API vocabulary, not instructions. All of
them now say the model server went silent mid-reply and tell you to check the server before running
the gesture again.

Read that as what the message SAYS, not as coverage. Only the Anthropic client can currently notice
that a stream ended early: the local and cloud clients return whatever text arrived, so a reply cut
in half is still offered to you as a generation. And no function-generation backend has a timeout on
a server that accepts the connection and then goes quiet. Both of those are open.

And the server cannot put words in that sentence's mouth. The failure message was matched on a
substring found anywhere in it, so a server whose error text happened to contain another failure's
wording drew that failure's sentence: a stream error reading "generation was empty after
postprocess" told you the model produced nothing usable. A message that opens with a transport's own
prefix is now treated as carrying the server's text, and nothing inside it is answered as one of
ours.

One message narrowed rather than widened. Anthropic's in-stream error frame is a generic envelope: a
rate limit, an invalid API key and a malformed request all arrive through it. Calling it a silent
server told you to check a server that was fine and took the real reason off the screen. It keeps
the provider's own message, which is the half you can act on.

A disabled Claude Code backend says one line. When it cannot create its working directory the
notification interpolated the raw error object, `Error:` prefix included, with no cut. Every gesture
that reports a disabled tier now shows one line and points at the output channel when there is more
to see.

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

A connection that times out on the way to a remote host is recognised as the server being
unreachable, which is the message with the fix in it, instead of falling through to the raw error
text.

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

One transport failure, one diagnosis, on all three surfaces that report it. Function generation had
been taught to say what a 401, a 429 or a 503 actually means, and the other two surfaces had not: the
model download still showed you the provider's raw JSON, and Tighten Doc Comment still said "the
model could not be reached" for a server that was reached and refused you. All three read the same
table now. The cause is the same sentence everywhere; the consequence is not, because a warning in
the notification that announces a write must not tell you nothing was written.

A server cannot write its own lines into the output channel. A channel row is one line, and any error
text the product interpolated into one carried whatever line breaks the server chose - so a hostile
or merely broken server could forge rows that read like the product's own diagnostics. Every line
carrying server text escapes its breaks now. The same held for the accept/reject accounting line,
whose payload is the model's own generated body: a reply carrying a bare CR, a U+2028, a U+2029 or a
NEL turned one log entry into four channel rows, one of them reading `[fngen] outcome=accept`. And a
model server that answers 200 and then goes quiet mid-reply now leaves the partial text in the
channel, which it never did.

A download can no longer be killed by its own progress line. A pull status arriving as a structure
rather than a string raised "Cannot convert object to primitive value" out of the progress handler.
It renders as text now, whatever the server sends.

Tighten Doc Comment can be cancelled. The gesture built the machinery to stop itself and nothing was
wired to it, so a round against a hung server ran until it gave up. The status-bar item and
`Column 80: Cancel Generation` now reach it, and a round you stopped is recorded as cancelled: no
warning, no diff, nothing written. It is no longer reported back to you as a failure.

A test rung runs the function it names, in Rust and C#. Both filtered by substring, so a rung scoped
to `add` also ran `add_more` and blamed a neighbour's failure on your function. Both now resolve the
full path - the enclosing `mod` chain in Rust, the namespace and type chain in C# - and switch to an
exact filter only when every name is fully qualified. Where the path cannot be resolved the rung
keeps the old substring filter on purpose: running too many tests is recoverable, running none is a
silent green.

The C# re-indent stops emitting C# that does not build. A hole inside a raw interpolated string was
scanned as string text, so a run of quotes inside it closed the literal early and the re-indented
output came back with `error CS8999`. Comments inside a hole were treated as unreadable, which broke
a second shape and could change a string's value on legal code. A hole is C# and takes C# comments;
both are fixed, along with two cases that predate the fix.

Rust strikes invented members, and `.await` still works. Rust was the last language with injection
and no enforcement, carved out because rust-analyzer serves keyword and postfix completions at a dot
and an earlier gate ate `.await` for exactly that reason. The prompt still shows only callable
members - byte for byte what it showed before - while the check now knows about the keyword and
postfix labels the prompt drops, so a method that appears nowhere in the server's answer is
suppressed and a bare `.await` is not.

A type is reached by name in TypeScript and Python. Both could only anchor a collaborator the
language server would point a definition at, so a type defined in the same workspace could be
unreachable. And in C#, asking about a type referenced inside another class handed back the wrong
class's members under a header saying they were the type you asked about - a false statement the
model then followed. It refuses now rather than answering wrong.

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
