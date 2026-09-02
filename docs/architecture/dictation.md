# Dictate the next block

Say what the next line or small block does, and the FIM ghost writes it. The comment the
developer used to type above the cursor, and then delete, is spoken instead; it rides into one
FIM request as a virtual comment and never touches the file. Session-v65 built it; the rulings
it follows are in that session's goal and are restated where they bind below.

Files: `src/core/dictation.ts` (the cleaner, the backtick matcher, the virtual comment, the
timing line, the refusal sentences), `src/core/dictationGesture.ts` (the gesture as a pure
reducer), `src/core/dictationNames.ts` (the name harvest), `src/core/recogniser.ts` (the resident
whisper.cpp server), `src/core/capture.ts` (the recorder child), `src/core/speakerMute.ts`,
`src/core/modelFile.ts` (the two model files and their download), `src/core/nativeLayout.ts`,
`src/vscode/dictation.ts` (the adapter), the `intent` seam in `src/core/completionService.ts`
and `armIntent` in `src/vscode/completionProvider.ts`, and `native/` (the two binaries).

## The gesture

One shortcut (`shift+alt+d` by default; the Keyboard Shortcuts editor is the setting) toggles
the microphone. The first press opens the capture stream and mutes the speakers; the recording
indicator turns on when the FIRST AUDIO BUFFER arrives, not when the command fires, because
quick-speech sometimes lost the first word and the user has to be able to see the mic go live
before speaking. While talking, a trailing six-second window is decoded every 300ms and the
partial transcript renders on the cursor line. The second press closes the mic, decodes the
whole take once, cleans it, backticks the names the buffer spells, renders the comment in the
language's own line-comment token, and fires one FIM request with it. The gesture then commits the
ghost itself through the editor's own inline-suggest commit (the path Tab takes, so no new write
path), the ghost carrying its own line break and the block's indent, so the code is in the file
and the cursor is on a fresh line with nothing pressed; the heard sentence lingers as a label
for a moment. `column80.dictation.autoAccept` off leaves the ghost for Tab or Escape.
A press while a ghost shows dismisses it and re-records. Each press is its own comment: nothing
is carried to the next request.

At MODULE LEVEL the fresh line is withheld and the caret stays at the end of the landed text,
one Enter away. The editor never renders an inline item that ends on an empty line (measured
with a bare provider, no product code in the loop, on VS Code 1.132.0 and 1.135.0; the row is
`test-vscode/v66-module-level.test.js` A), so a fresh line with no indent would lose the whole
item silently. `freshLineAfter` in `src/core/dictationDoc.ts` is the one place that decides it,
for the line ghost and the declaration ghost alike. The human found this on 3.2.0's release day:
a dictated `export type Point = {...};` at the last line of a file served, committed to nothing,
and left the "heard:" label on the status bar (session-v66).

A commit that lands nothing ends the gesture. After the auto-commit resolves the adapter waits
300ms for the site's edit, retries the commit twice (a busy host renders the item later than
the first commit; measured with Pylance), and only then hides whatever the editor holds and
dispatches `nothing-landed`: idle, indicator off, `nothing landed: the editor drew no ghost for
the item` on the channel and one sentence on the status bar. An edit that reaches the site
with no accept command behind it gets one more grace and then ends the gesture the same way
(`an edit landed on the site but no accept arrived`). With keystroke FIM on, a keystroke
request that follows the dictated one at the site owns whatever the editor draws, and the
gesture refuses to commit it (`superseded by a keystroke request`). The editor can drop an
item for reasons this session did not meet; the state machine survives every one.

Escape cancels at every point. While the mic is arming or open the take is aborted, the
speakers put back, nothing requested (`cancelled by Escape after <n>ms`). While the take
decodes or the request is in flight the gesture goes idle, the armed intent is disarmed
(`intent disarmed`), and the late transcript or served answer is ignored on the record. Over a
drawn ghost it dismisses. The two bindings for the mic-open and in-flight phases
(`column80.recording`, `column80.dictationBusy`) do NOT require editor focus, because the human
reads the Output panel while talking; the ghost binding does. Escape is not the shortcut: a
press while recording still stops and generates. A vim keymap's Escape leaves insert mode and
wins.

Where the cursor may be: anywhere on the line. An empty line generates the line; a partly
written line has its rest filled, and there the ghost carries no line break, because the
auto-closed `)` or `"` after the caret would otherwise ride onto the fresh line. Inside a
comment the press refuses before the mic opens, on the same identity argument FIM's own
in-comment rule makes.

The gesture is a reducer (`reduce(state, event)` in `dictationGesture.ts`) and the adapter only
executes its actions, which is what lets the whole thing be swept headless: 96 blind rows
including three seeds of 2000 random events hold four invariants (no second `start-capture`
without a stop between, every way back to idle unmutes once and turns the indicator off, and so
on). Two ordering facts the adapter carries because the editor imposes them: the accept's
cursor move reaches the adapter BEFORE the accept command does, so a move off the site line is
held for 300ms after an edit on it; and a caret that wandered during the take goes back to the
press line before the trigger, because the intent is keyed on that line.

## The comment is the engine

The scout measured 360 authored sites on two private corpora, product FIM shape and bound: the
first line of the ghost within 0.9 of the committed line moved from 124 (bare) to 166 (typed
intent) to 157 (the intent spoken by a synthetic voice and heard by base.en). The recogniser
costs 9 of the 42 sites the comment gains. Backticks and injected surfaces added nothing on top
at this model (168, 169), and a file-scoped recogniser prompt fixed transcripts without moving
the ghost. So the comment leg ships and everything else is measured before it is spent on.

The full stop `cleanTranscript` appends is load-bearing: a comment without one made the model
continue the prose instead of writing code, twice. The cleaner also strips whisper's noise
markers from a CLOSED list (`[BLANK_AUDIO]`, `[Music]`, `♪` and the like; a spoken aside in
parentheses is the user's words and stays), the filler words, capitalises the first letter, and
turns a trailing comma into a full stop. A sentence with no letter or digit left is nothing
said, and the gesture refuses with `heard nothing` rather than sending `// ...` to the model.

## The backtick matcher and its refusal rule

`backtickSpokenNames` folds every 1 to 6 word window of the sentence against a name population
and replaces exact fold matches with the identifier in its own spelling, backticked. No plural
stripping, no edit distance, no phonetics: the ASR spike found the fuzzy matcher fires on 18 to
20 of 40 plain English sentences when a one-word match is allowed mid-sentence, and 0 or 1 when
it is not. That is the refusal rule: a one-word window matches only when the whole utterance is
one word, and the refusal is on the channel. Two identifiers with one fold key (`ClientSet`
beside `client_set`, 87 of 5,645 keys on the Rust corpus, every one a type against a snake
name) are resolved by kind, and only a type wins; two types refuse as ambiguous.

The population is what the buffer spells that a mouth could say (`harvestSpokenNames`: two or
more spoken words, `HTTPServer` included, `MAX_RETRIES` labelled a constant). Single-word names
are never harvested because the refusal rule would decline them inside a sentence anyway. A
word with a non-ASCII letter never matches, because the fold is ASCII-only by design.

## The pipeline, and where the surfaces go

Ruled order: dictation, backtick parser, resolver, prompt. The ticked names of kind `type` go
to `resolveWholeBlock` as the FIRST roots, above the signature's types, at both places the
budget bites: the root list and the render. A dictated request resolves even where the cursor
is not at a whole-block site, since a mid-body cursor is the common dictation site, and it
neither reads nor fills the per-file-version injection cache (its roots are the spoken names,
not the signature's, and the next keystroke must not be answered with them). The comment goes
in LAST, closest to the cursor, under whatever surface landed. `DICTATION_SURFACE_TOK` (300)
is the render budget for a dictated request and the seam the measurement rig patches.

**Measured, and it loses.** Phase 7 drove this pipeline through the product's own bundled code
on the scout's 360 sites with the whisper transcript as the heard text (`session-v65/measure/
pipeline-arms.md`). Read the noise floor first: the scout's arm B repeated at the same settings
lands 169 against 166, five sites flipping, so a five-site delta is one draw. Then: the
transcript through the product's cleaner and backticker with no surfaces (arm E) lands 157 of
360, exactly the scout's heard figure, 12 sites moving each way; 410 backticks changed nothing
at the ghost. With the surfaces (P300 / P600 / P1200) it lands 145 / 143 / 142: a net loss of
12 to 15 sites, three times the floor, on both corpora and in every block class, and the dose
curve is flat to downward (85 of the 161 surfaced sites render the same block at 300 and 1200
because the walk had nothing more to say). Read by hand, the losses are the surface being a
stronger prior than the sentence (the sentence named `PkiError`, the line was an `fs::write`),
a spoken name that is a string-typed property so the walk rendered `System.String`'s overloads,
and the injection header echoed by the model. Under the product's own 400ms intent deadline
45 of the 168 resolves would not land and the product serves E there; that reading is 155
against 157, inside noise. A 74-word rambling comment (arm L) costs 4 sites, inside noise. The
chain sites do not move in any arm (9 of 35 on the base population; on the 40-site authored
chain row bare 12, comment 11, surfaces 10), so roadmap item 10's mechanism stands. The 40
authored Rust enum `match`-arm sites are where the comment earns most and the surfaces cost
most: bare 18 of 40, comment 24, with surfaces 16 at 300 and 18 at 1200, below bare. No C#
enum row exists: the Contoso tree has no `case Enum.Member:` arm anywhere.

So the wiring ships as ruled, `column80.dictation.surfaces` switches it off, and the decision
whether the default stays on is the human's (session-v65 hand-back). FIM does not join the
`injectedContext` dial: the curve gave it nothing to dial.

Three things on the service's `intent` seam, each measured against a defect: the request skips
the debounce (a human pressed a key and waited); it is never served from the cache and never
fills it; and it keys the in-flight registry on the comment, so a plain keystroke in flight at
the same cursor is superseded rather than joined. The injection race is 400ms for a dictated
request against 50ms for a keystroke, because the bar is a second from mic close to ghost and
the surfaces are the point of the pipeline ruling.

`num_ctx` is pinned at 8192 on EVERY FIM request, not only the dictated ones. Unpinned, ollama's
default window took a 3,369-token prompt whole and cut a 5,000-token one to 2,050 on this box,
and truncation eats the head of the prefix, where the surface and the comment sit. Pinned per
request only on dictation, the server would reload the model between the two shapes; the host
tier measured that reload at about two seconds when another client of the same model on the
box was still sending the default.

## The recogniser and the recorder

whisper.cpp's `whisper-server`, vendored per platform and pinned by tarball hash, resident from
activation on a free loopback port. Resident is the whole design: a per-gesture spawn pays 0.5
to 0.7s of model load and misses the bar; warm, a six second take decodes in about 250ms on the
reference box and the server itself comes up in about 80ms because it maps the model. Beam 5 on
every request, because greedy decoding turned "threat level" into "THREKT LEVEL" on a clean
fixture and beam 5 cost nothing measurable. Silero VAD rides along when its 0.9MB file is
present, because three seconds of digital silence decoded to "You" without it and to nothing
with it. The decoder is not run-to-run stable on identical bytes at eight threads ("two"
against "2" alternated on one fixture); nothing in the product asserts on exact transcript text.

The model (`ggml-base.en.bin`, 148MB, sha256 pinned) downloads through a ratified toast like
every ollama model: `[dictate] model offered`, `ratified` before the request starts,
`declined`, `done`, `failed`. It streams to a `.part` file and renames on success; presence is
checked by size, not by hash, on every activation.

`column80-capture` is one C program over miniaudio: `--list` prints the capture devices as
JSON, otherwise it streams 16kHz mono s16le on stdout until stdin closes and drains its ring
once more after the device stops, so the last word is never the one lost. It links libc and
libm only; miniaudio loads the OS backend at runtime. The null backend is compiled out, so a
box with no audio stack exits 2 with a sentence instead of capturing silence. A named
`--device` that is not present exits 5; there is no silent fall-back to the default. Measured on
this box from the extension: press to first buffer 39 to 170ms, higher on the first spawn of a
session; chunks every 20ms.

The speakers are muted for the take and restored only if this muted them: `wpctl` then `pactl`
on Linux, `osascript` on macOS, nothing yet on Windows (the channel says so). Setting
`column80.dictation.muteSpeakers`, default on.

## Gesture 2, first half: dictate a declaration

`src/core/dictationDoc.ts`. At a blank line that fn-gen's resolver says is not inside a function
(`resolveFunctionAtCursor` returns nothing), the sentence is the doc comment and stays. The model
sees it above the cursor in the language's doc form (`docCommentAbove`: `///` for Rust and C#,
`//` for Go, `/** */` for the TypeScript family; Python's docstring goes inside the body, so the
model sees the line comment there). The served head is dressed by `declarationGhost` into one
item: the doc comment, the head, and where the head opens a body an empty body line at one more
indent unit plus the closer (a docstring line in Python), with the caret offset the accept
command then honours. One accept, one write path, the comment kept because it is part of the
ghost. The scout's measurement on 100 documented Rust heads (doc comment present: 81 declare,
31 name right, 16 whole head within 0.9) is the ceiling this half ships at.

The accept runs through `column80.fimAccepted`, so the compiler check and the repair loop
already run on the landed head: on 2026-09-02 the human dictated the doc comment of
`endOfLiteral` in `src/core/brackets.ts`, the head landed, tsc went red on the empty body, and
repair wrote the body. What roadmap item 78 still owes is the dictated name and parameter list
matched rather than guessed, and the fifty-gesture falsifier. A head that opens no body (a type
alias, `struct Foo;`, a trait method) lands with the caret at its end at module level, or on a
fresh line at the block's indent inside a block. A dictated request reads through attribute and
decorator lines (`#[derive(Debug)]`, `[Serializable]`, `@dataclass`) to the head under them
(`headThroughAttributes` on the bound); before session-v66 a dictated Rust enum landed the doc
comment over a bare `#[derive(Debug)]`.

## Refusals

Every refusal is one sentence in the product's voice on the status bar and a `[dictate]
refused: <kind>` line, in this order at the press: Remote (the extension host is the server and
the mic is the client; a `ui`-kind companion extension is the fix and is its own session), no
recorder for this platform, model not downloaded (the toast is re-offered), recogniser not
running, language not served by FIM, no comment syntax for the language, cursor in a comment.
After the take: no device, device would not open, heard nothing. Over Remote the recogniser is
not started and the model is not offered.

## Evidence

`[dictate]` on the channel (session-v66 added `cancelled by Escape ...`, `intent disarmed`,
`commit retried`, `nothing landed: ...`): `press at <uri>:<line>`, `mic live press-to-first-buffer=<n>ms`,
`stop after <n>ms`, `heard: <sentence> (decode=<n>ms, stripped: ...)`, `backticks:
matched=... refused=...`, `intent matched=<n> refused=<n>`, `[fim] intent injected lines=<n>
under surface lines=<n>`, `ghost served` or `no ghost for the intent`, `ghost accepted`, `site
left`, and one `timings` line per gesture: `press-to-first-buffer`, `take`, `decode`, `fim`,
`mic-close-to-ghost`. The falsifier the build inherits reads those: on the first 50 real
gestures on the human's own mic, spoken must beat bare and a spoken miss where typed hit is
charged to the recogniser or cleaner, not to the feature; and mic close to ghost p50 under a
second on the reference box.

## Tests

`test/blind-v66-p1-shape.test.cjs` (no item ends on an empty line, every declaration shape in
five languages), `test/blind-v66-p2-gesture.test.cjs` (cancel and nothing-landed),
`test-vscode/v66-module-level.test.js` (the editor rule with no product in the loop, the
module-level shapes landing, Escape in each phase, a forced no-op commit; the recogniser is
`helpers/fake-recogniser.cjs`, so a row dictates any sentence), and from session-v65:
`test/blind-v65-p2-dictation.test.cjs` (the core contract), `blind-v65-p3-runtime` (the
processes, with a fake recorder and a fake server, plus witness rows on the real binaries when
present), `blind-v65-p4-gesture` (the reducer sweep), `impl-v65-p4-intent-seam` (the service
seam), the three `adversarial-v65-*` files (review evidence, all green), and the host tier
`test-vscode/v65-dictate.test.js` under `v65dictate.vscode-test.mjs`: a fixture microphone
through `COLUMN80_NATIVE_DIR`, the real recogniser, the real FIM model, the real provider, one
label per language, buffer diffed before and after the accept. Green in all five languages on
2026-09-02; the fixture sentence "Add the threat level column to the select list too" became
`columns.push("threat_level".to_string());`, `columns.push("threat_level");`,
`columns.append("threat_level")`, `columns.Add("threat_level");` and
`columns = append(columns, "threat_level")`.

What a test cannot see: the pulse of the indicator, the partial text arriving as the user
talks, the feel of the fresh line landing. Those are in `session-v65/visual-residual.md` for
the human to walk.
