# Column 80: user manual

Column 80 is a VS Code extension that does two things with a model: ghost text as you type, and a whole function body when you ask for one. Both run on your own box through Ollama unless you point generation at a cloud yourself. No chat panel, no agent mode, no repo indexing, no telemetry. The prompt is your cursor plus whatever you put in the context panel, and nothing sneaks in behind your back.

You design, it types. That's the deal.

Five languages get the full kit: **Rust, Go, TypeScript/JavaScript, C# and Python**. Anything else gets autocomplete at most, and only if you ask for it.

## Getting set up

### Requirements

- **Ollama** on `http://localhost:11434`. Autocomplete always runs against this machine, even if your big model lives on another one.
- **VS Code 1.85 or newer.** Make it 1.130 or newer if you want the scoped ghost (below) in C# and TypeScript.
- **Your language's toolchain**: `cargo`, `go`, a project-local `node_modules/typescript`, `dotnet`. Python's checker ships inside the extension, but it wants a `.venv` or `venv` beside your project, or you'll cop a storm of missing-import errors.
- **Your language server extension, installed and switched on**: rust-analyzer for Rust, the Go extension, the C# extension, Pylance for Python. TypeScript and JavaScript use the one VS Code ships. Everything past autocomplete asks the language server where your functions are, so without it generate, repair and tests all refuse. Autocomplete keeps working, which is why a missing server looks like a working install. Check this first.

### The hardware tiers

On first run Column 80 looks at your GPU and memory and picks a tier. The tier decides which model writes function bodies.

| Tier | Hardware | Generation model |
|---|---|---|
| `24gb` | 20GB+ VRAM, or a 20GB+ Apple Silicon Mac | `qwen3.8:27b` (`qwen3.8:27b-mlx` on a Mac). Provisional: never tested on a real 24GB card |
| `16gb-large-ram` | 16GB VRAM and 32GB+ RAM | `qwen3-coder:30b`, with its GPU layers capped so both models fit |
| `16gb-low-ram` | 12 to 16GB VRAM, or a 16GB Apple Silicon Mac | `qwen2.5-coder:14b-instruct-q4_K_M`, about 9GB |
| `below-12gb` | under 12GB, or no GPU it can see | none, autocomplete only |

Autocomplete runs `qwen2.5-coder:1.5b-base` on every tier, so an 8GB RTX card still gets it. Function generation is off there because the smallest generation model is about 9GB on its own. Point it at a cloud key or Claude Code instead (see [Cloud generation](#cloud-generation)).

**Apple Silicon.** A Mac counts its whole unified memory as the budget, so a 16GB M-series MacBook gets the 14b and a 20GB-plus Mac gets the 27b. On that top tier it runs the MLX build, which is about twice as fast as the regular build on short prompts and about even on long ones. If the MLX download fails it offers the regular `qwen3.8:27b` once. Intel Macs, AMD and Intel GPUs all land on autocomplete only; `column80.hardwareTier` lets you force a tier if you reckon you know better.

Why cap the layers on a 16GB card? Left alone, Ollama swaps the two models with 2 to 4.6 second reloads, or quietly shoves the small one onto the CPU. Set `column80.fnGenModel` yourself and you lose the cap along with the tier's pick.

### First run

1. It probes the hardware (killed after 3 seconds, so it can't hang).
2. It offers a tier with its own pick preselected. Take the default and it re-checks on new hardware. Pick one and it sticks.
3. It offers each model download, one click each. Nothing downloads without that click.

Ollama not running? It offers to start `ollama serve` in a terminal. **Column 80: Select Hardware Tier** reruns the whole lot any time.

### Nothing's happening

Work down the list.

1. Open **View > Output > Column 80**. Everything logs there.
2. `languageId=cpp is not code Column 80 understands`: add the id to `column80.fimLanguages`.
3. `the cursor is inside a comment`: working as designed. Your comments are yours.
4. No `[fim]` lines at all: `column80.enabled` is off, or Copilot or Continue grabbed the ghost slot first. Column 80 can't detect that yet.
5. Generation refuses with a tier message: run Select Hardware Tier.
6. Everything's sluggish: look at `[fim] ttft=`. Warm and consistently over 200ms usually means the small model got pushed off the GPU.
7. Garbage completions: `column80.fimModel` has to be a FIM **base** model, not an `-instruct` one.

## Autocomplete

Ghost text as you type, from the 1.5b base model. Always local. No cloud path, ever.

It fires 150ms after your last keystroke; on an RTX 5080 the first token lands in about 103ms. **Alt+\\** triggers it by hand and gives you up to three alternatives, cycled with Alt+] and Alt+[.

It only serves the five languages above. `column80.fimLanguages` adds more (language ids like `cpp`, not `.cpp`), and you get plain autocomplete there with none of the extras.

**Ghosts are short on purpose.** Over 850 real sites, long multi-line ghosts were almost all wrong, so a ghost stops at the end of the statement, four lines tops. At `fn parse(` you get the rest of the signature, not a whole function.

**It stays out of your comments.** It never starts a comment and never offers anything inside one. Your doc comment is your spec, and a model writing your spec is the one thing this tool won't do.

**It reads your language server, not its imagination.** Right after `.` or `::` the model gets the receiver's real members. In an empty function body it gets the real shapes of the types in play. All of that is raced against a 50ms deadline, and a slow server just means plain autocomplete. Then a gate throws out any ghost naming a member that doesn't exist (`column80.fimMemberGate`).

**Backtick a type name in any comment** and its real fields and methods go into the prompt for generate and repair. No backticks, it's just English and gets left alone.

**The scoped ghost** works alongside VS Code's suggest dropdown. Arrow to a member and the ghost shows the whole call for that member. **Escape** closes the dropdown and keeps the ghost. **Tab** takes it. A second Escape drops it. Vim users: your Escape leaves insert mode instead, sorry.

## Dictation

Say what the next bit of code does instead of typing a comment you'll only delete. Cursor where the code goes, **Shift+Alt+D**, talk, **Shift+Alt+D** again. The code lands, the cursor drops to a fresh line, and what you said never enters the file. Ctrl+Z takes it back. At module level the cursor stays at the end of the code instead, one Enter away.

Say what the line *does*, like you're explaining it to a mate across the table. Don't dictate syntax. "Make a tile from morton code 42 at LOD 3" worked five times out of five; reading out `Tile::from_morton(42, 3)` as code worked zero times. Numbers are the weak spot, so say "42 and 3". Names already in your file get matched and backticked for the model.

When the code around you repeats a pattern, the small model copies the pattern over whatever you said. Say the exact call, qualified, and say what *not* to do: "use `u32::from_be_bytes`, not little endian".

Where you press decides what happens:

- **Inside a function**: code lands.
- **Outside a function** (module level, inside a struct or class, empty file): what you said becomes the doc comment and stays in the file, and the model writes the declaration head under it. Then run Generate Function Body for the body.
- **Inside a comment**, or after typing `//` (`#` in Python): your words land as a tidy sentence, then **Tighten Doc Comment** offers to wrap it at 80 and backtick the real names.
- **Markdown or plain text**: your words land at the cursor as you said them. No model involved.

Escape cancels at any stage. The speakers mute while the mic is open.

The first press offers the speech model, whisper.cpp `base.en`, 148MB, all local. **Select Microphone** picks a device. If the chord clashes on your box, change `column80.dictation.shortcut`.

## Generate a function body

The unit is one function. Never the file. The only write is the span you saw in the preview, so it can't touch anything else.

1. Write the signature and a doc comment.
2. Add context blocks if the function needs them.
3. Cursor in the function, run **Column 80: Generate Function Body**.
4. A diff opens. Warm, that's 4 to 8 seconds; the first one after a cold start takes a fair bit longer while the model loads.
5. **Enter** accepts, **Escape** rejects. Closing the tab rejects too.

**The doc comment is the prompt.** The model sees your context blocks, one fixed instruction, the doc comment and the signature. No surrounding code, no imports. So write the comment like a spec: edge cases, errors, invariants.

```rust
/// Parse a duration string like "1h30m45s" into total seconds.
/// Units h, m, s may appear in any order but at most once each.
/// Rejects empty input, unknown units, and values over u32::MAX
/// with a `ParseError` naming the offending token.
fn parse_duration(input: &str) -> Result<u64, ParseError> {
    todo!()
}
```

A vague comment gets you something plausible. A comment like that gets you the function you meant. In Python the docstring does the job.

**Sketch the steps as comments** in the body and generation follows them:

```go
func mergeGaps(gaps []Gap) []Gap {
    // sort by start
    // walk pairs, extend when they touch
    // drop the swallowed one
}
```

Only comments at the body's own depth count. If the model drops or rewords a step, Column 80 puts your original back. One wart: a step the model keeps inside a loop can come back twice. Delete the spare.

**Types too.** Put the cursor on a `struct`, `enum`, `class`, `record` or `interface` and the same command fills it from its doc comment.

**Regenerating starts fresh.** The old body isn't in the prompt. Want it there? Add it as a context block first.

When it says no:

- **No function at the cursor**: move into the body or onto the head.
- **No document symbols**: the language server isn't answering. Check it's installed, or give it a sec after opening the window.
- **Generation discarded**: you edited while it worked. Run it again.
- **Truncated**: out of tokens. Locally the cap is 2048, so generate a smaller function.
- **Came back as a stub twice**: the model wrote `todo!()` and wouldn't budge. It shows you the stub rather than dressing it up.

## The Model Context panel

The **Model Context** panel in the Explorer sidebar shows exactly what generation will see, in that order. It starts empty and stays empty until you put something in it.

Right-click in the editor to add a **selection**, the **enclosing symbol** (whole function or type), or the **enclosing block** (the tightest `if`, `for` or closure). Right-click a file in the Explorer to add the whole file. Reorder or remove with the icons on each item.

- **Blocks are live.** A block is a line range, not a copy. Edit inside it and it grows with you; edit above it and it slides down. Generation reads what those lines say right then.
- **Lost blocks go red.** Paste over a block's boundary or delete its file and it's marked `(lost)` with the reason. Generation runs without it and tells you. Rename a file and its blocks follow it.
- **Removed means gone,** even for a generation that's already reading blocks.
- **No dedup, no caps.** Add something twice, it's there twice.
- **Blocks don't survive a window reload.** On purpose. Context you forgot you'd added is exactly what this panel exists to stop.

## Compiler check and repair

Accept a generated body and Column 80 saves the file and runs your own compiler:

| Language | Check |
|---|---|
| Rust | `cargo check --all-targets` (cargo 1.74+) |
| Go | `go test -c` (Go 1.21+), compiles tests, never runs them |
| TypeScript/JS | your project's own `tsc --noEmit`, never a global or npx one |
| C# | `dotnet build --no-restore` |
| Python | bundled pyright, against your project's interpreter |

You get a one-line summary at the edit site, with the details on hover. Heads up: the Rust and Go checks build your tests and examples too, so if those were already broken you'll start seeing it.

**Repair** (`column80.repairEnabled`, on) kicks in when the check fails. At most two rounds, only errors inside your function, never warnings, never test assertions. Every fix comes through the same diff, so nothing lands without your nod. The repair prompt also gets the real API the compiler error points at, so a made-up method gets swapped for one that exists.

Accepting an autocomplete ghost runs nothing. No save, no check, no repair. A Tab is a Tab.

**Repair Function Body** on demand checks and repairs the function at the cursor. Run it on a **clean** build and it **refines** instead: it finds how the rest of your repo calls the same methods and types, and asks the model to match that style. One round. Read that diff properly: in a test on 14 real C# methods, one refine broke the build and another quietly changed a field mapping.

## Tests

### Generate Tests (TDD)

**Column 80: Generate Tests (TDD)** writes tests without ever seeing your implementation. The model gets the signature, the doc comment and the types it calls. Then every expected value is **blanked**. You Tab through the holes and type the answers yourself. A test whose answer the model wrote just agrees with the code, not with you.

| Language | Tests land in |
|---|---|
| Rust | same file, `#[cfg(test)] mod tests` |
| Go | sibling `foo_test.go` |
| TypeScript/JS | sibling `foo.test.ts`; non-exported functions are refused |
| Python | `test_foo.py` under `testpaths`, else `tests/`, else beside the source |
| C# | `<Stem>Tests.cs` in an existing test project; private methods refused |

A new test file is previewed as a whole-file diff. It never creates a project or installs a package.

**Expect refusals.** Async, IO, needs a fixture, not exported, nothing to assert: you get the reason instead of a hollow test. On real code most functions get refused. That's the design, not a bug.

**Run TDD Tests** runs only the tests Column 80 wrote for the function at the cursor. Red means your expected values and the code disagree, and you decide who's wrong. Nothing ever edits a test.

### Run Covering Tests

**Column 80: Run Covering Tests** finds the tests in your repo that actually reach your function, by walking the call hierarchy up through your language server. No name matching. A test five layers of harness away still counts. Rust, Go, C# and Python; not TypeScript yet.

On a real 534-test crate it missed nothing that executes the function; about one in ten it picked only reach it on some branches. Tests with destructive markers (a shared database fixture, say) are skipped and reported. "Nothing ran" is never a pass.

### Repair from a failing test

Run Covering Tests, see a red, then run **Repair Function Body** on the same function. It reruns those tests, hands the model the failing assertion and the line around it, proposes a fix to your function only, and reruns the tests after. Manual only, two model calls max, same diff. A red test somewhere else in the repo isn't your function's problem and doesn't authorise anything.

## Criticize and Review

Two ways to get a function looked at.

**Criticize Function** scores the function against fourteen design questions: hidden clock reads, boolean parameters, too many parameters, deep nesting, a function that both answers a question and changes the world, and so on. It offers a diff with a short, blunt comment above each line that failed:

```
// C80 clock: reads the wall clock through Instant::now. Hidden wall-clock
//     read. Untestable. Pass it in.
let start = Instant::now();
```

The words are fixed, not written by a model. Ten of the fourteen are plain code reading, so the same code gives the same answer every time. The other four (does it read the clock, randomness, environment or files) are a model's call, and say `blind`, never `clean`, with no model. Press again and it replaces its own comments.

The top of the card is your worklist; the rest names the principle behind each question. When a row fires it's very likely right. A quiet row is not a clean bill of health.

**Review Function (model)** hands the function to a model and lets it write the review, in your own identifiers: "make `Shard(u64)` and `Lod(u64)` newtypes so `warm_fs_metadata(lod, shard)` stops compiling". A fixed phrase can't do that. The catch: it can be confidently wrong, it can say something different on a second press, and the model matters heaps. Judged blind on twenty functions against Criticize's phrases, Opus won 19 to 1, and a local 27B was a coin flip at 10 to 10. Read every comment before you accept.

Use Criticize when you want the same answer twice, Review for a second opinion. Neither writes anything until you accept.

## Cloud generation

Function generation can use a cloud model instead of Ollama. It's off by default and it's the only way code ever leaves your machine. Autocomplete stays local no matter what.

What gets sent is the generation prompt and nothing else: signature, doc comment, your context blocks, and any type info Column 80 added. Not the rest of the file, not your keystrokes.

Set `column80.fnGenProvider` to `openai`, `anthropic`, `xai`, `gemini` or `openai-compatible`, put your key in `column80.cloudApiKey`, and set `column80.fnGenModel` to the provider's model id (the default is an Ollama tag and won't work). For OpenRouter, Groq, vLLM and friends, use `openai-compatible` and set `column80.cloudApiBase`. On `anthropic` your context blocks are cached for an hour, so repeat generations against the same blocks cost a fraction. No tier, no download, and the same diff, check and repair as local.

### Claude Code subscription

Already paying for Claude Code? Skip the key:

```jsonc
"column80.fnGenProvider": "claude-code",
"column80.fnGenModel": "claude-sonnet-4-5"   // optional
```

You need `claude` on your PATH and logged in. Leave the model unset and the CLI picks, which on the reference box was Opus: a lot of model for one function body. It runs in an empty folder of its own, so your `CLAUDE.md`, memory and MCP servers don't sneak into the prompt. Context blocks are cached for an hour, so after the first generation the rest are cheap. Expect 3.5 to 12 seconds a round.

## Reasoning models

`column80.fnGenThinking` is **off**, and that's measured, not timid. On twelve C# functions with `qwen3.8:27b`, reasoning off compiled 4 of 12 at 7.7 seconds each. Reasoning on with room to finish compiled 3 of 12 at 86 seconds each. If you turn it on, raise the token budget too or you'll get truncated bodies.

The tier only switches reasoning off when Ollama runs on this machine. With `column80.apiBase` on another box, set `column80.fnGenThinking` to `off` yourself.

## The output channel

**View > Output > Column 80** is where everything leaves a trail. Each line starts with who wrote it: `[fim]` autocomplete, `[fngen]` generation, `[ctx]` context panel, `[oracle]` compiler checks, `[repair]` repair rounds and why something wasn't repaired, `[carve]` hardware and downloads, `[tdd]` tests, `[claude-code]` and `[anthropic]` cloud rounds.

```
[fim] ttft=104ms total=139ms len=42 bound=statement kept=1 dropped=3
[fngen] gen model=qwen3-coder:30b promptBytes=1843 blocks=2 span=512-1298
[repair] ineligible code=E0080 reason=assertion-failure
[carve] tier=16gb-large-ram reason=auto vram=16303 ram=61826 numGpu=30 provisional=false
```

`column80.logPrompts` dumps every full prompt; it's very noisy, so only turn it on to debug.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `column80.enabled` | `true` | Autocomplete on or off. Dictation works either way. |
| `column80.apiBase` | `http://localhost:11434` | Ollama URL for generation. FIM follows it only to a loopback address; a remote host leaves FIM on localhost. |
| `column80.fimModel` | `qwen2.5-coder:1.5b-base` | Autocomplete model. Must be a FIM base model. |
| `column80.fimLanguages` | `[]` | Extra language ids for autocomplete. Adds, never removes. |
| `column80.fimUsageExamples` | `true` | Show the model real call sites of a member. |
| `column80.fimMemberGate` | `true` | Drop ghosts naming a member that doesn't exist. |
| `column80.fimAlternatives` | `3` | Completions on a manual trigger. |
| `column80.minGhostChars` | `8` | Shortest ghost worth showing. `0` shows everything. |
| `column80.minGhostAlnum` | `2` | Letters or digits a ghost needs, so `);` alone is dropped. |
| `column80.cacheCapacity` | `100` | Autocomplete cache size. `0` sends every keystroke. |
| `column80.maxTokens` | `256` | Autocomplete tokens per completion. |
| `column80.temperature` | `0.01` | Autocomplete temperature. |
| `column80.debounceMs` | `150` | Delay after a keystroke before asking. |
| `column80.prefixChars` | `3000` | Characters before the cursor. |
| `column80.suffixChars` | `1000` | Characters after the cursor. |
| `column80.dictation.enabled` | `true` | Dictation on or off. |
| `column80.dictation.microphone` | `""` | Mic by name. Empty is the system default. |
| `column80.dictation.muteSpeakers` | `true` | Mute speakers while the mic is open. Linux and macOS. |
| `column80.dictation.partials` | `true` | Show what's being heard while you talk. |
| `column80.dictation.shortcut` | `shift+alt+d` | The dictation chord, or `none` to bind `column80.dictate` yourself. |
| `column80.dictation.autoAccept` | `true` | Dictated code goes straight in. Off leaves a ghost for Tab. |
| `column80.dictation.surfaces` | `false` | Add spoken type names' real members to the prompt. Measured worse, so off. |
| `column80.fnGenModel` | `qwen3-coder:30b` | Generation model. Setting it overrides the tier. |
| `column80.fnGenFallbackModel` | `qwen2.5-coder:14b-instruct-q4_K_M` | Model for the `16gb-low-ram` tier. |
| `column80.fnGenProvider` | `ollama` | `ollama`, `claude-code`, `openai`, `anthropic`, `xai`, `gemini` or `openai-compatible`. |
| `column80.fnGenThinking` | tier's choice | Reasoning for models that do it. Free text, passed through. |
| `column80.cloudApiKey` | `""` | Cloud key. Blank keeps cloud generation off. |
| `column80.cloudApiBase` | `""` | Cloud endpoint. Needed for `openai-compatible`. |
| `column80.hardwareTier` | `auto` | Force a tier instead of probing. |
| `column80.repairEnabled` | `true` | Repair compile errors, up to two rounds. |
| `column80.injectedContext` | `small` | How much of your own code goes into generation: `small` for a 30B local model, up to `frontier` for Opus-class. Bigger means slower. |
| `column80.compilerDirectedInjection` | `true` | Give repair the real API the compiler error points at. |
| `column80.repairUsageWindows` | `false` | Add call sites to repair rounds. Measured no better, so off. |
| `column80.logPrompts` | `false` | Dump every prompt to the channel. Noisy. |

## Commands and keys

Everything's under **Column 80** in the command palette. The editor right-click menu has Generate Function Body, Repair Function Body, Generate Tests (TDD), Run TDD Tests, Run Covering Tests and the four Add to Model Context commands. Palette only: Toggle FIM Autocomplete, Dictate the Next Block, Select Microphone, Download Speech Model, Tighten Doc Comment, Criticize Function, Review Function (model), Select Hardware Tier, Cancel Running Task (also on the status bar).

Shipped keys: **Enter** and **Escape** accept and reject a diff preview, **Escape** also dismisses a scoped or dictated ghost and cancels dictation, and **Shift+Alt+D** dictates. Nothing else has a default key. Bind what you use in **Preferences: Open Keyboard Shortcuts**, search `column80`.

## Known limits

No point pretending these aren't there.

**Hardware**
- NVIDIA and Apple Silicon only. AMD and Intel GPUs get autocomplete only unless you force a tier.
- The probe reads total VRAM, not free.
- The 24GB tier has never been tested on a real 24GB card.

**Autocomplete**
- Under heavy CPU load the real-member info often misses its 50ms window, worst in Rust and Python.
- In a chain like `results.iter().map(|r| r.` the closure's members aren't looked up.
- No detection when Copilot or Continue takes the ghost slot.

**Dictation**
- Only proven on Linux. macOS and Windows are built and untested, and Windows doesn't mute speakers.
- Doesn't work over Remote.
- The default chord shadows VS Code's "Detect Language from Content".
- At a declaration, a mis-heard word stays in your doc comment. Read it.

**Generation and repair**
- CRLF files can end up with mixed line endings.
- Go repair doesn't get the compiler-directed API info.
- A generation that fails the check gets one repair round, not two.
- Cancelling a Claude Code generation kills `claude` but not anything it already spawned.

**Tests**
- Most functions get refused for TDD on real code. Intended.
- Nothing measures what your tests miss: no coverage, no mutation testing.
- Rust test filters match by substring, so `tests::add` also runs `tests::add_more`.
- Covering tests don't work in TypeScript or JavaScript yet.

**Criticize and Review**
- Review isn't repeatable and its quality tracks the model hard.
- The four model-judged Criticize questions haven't been re-graded since they stopped being pattern lists.

**Editor**
- VS Code 1.124 breaks the scoped ghost in C# and TypeScript.
- Vim users get no second Escape.
- Language-specific commands still show in every editor's right-click menu.

Right, that's the lot. Questions or breakages go to [the issues](https://github.com/utilitydelta/column-80/issues).
