**_ WARNING LLM GENERATED [TODO REWRITE] _**

# Column 80: user manual

Column 80 is a VS Code extension with two model paths and nothing else: FIM tab-completion as you type, and per-function generation on demand. Both run against local models through Ollama by default. Nothing is indexed, nothing is retrieved behind your back, and no prompt sails to a cloud unless you set a cloud provider yourself.

You design, it types. The tool is constrained on purpose so you never stop being the person who understands the code.

What it will not do, ever: agent mode, chat panel, MCP, repo indexing, automatic context retrieval, telemetry. The prompt is a deterministic function of your cursor and the context blocks you added by hand.

Five languages ride the full stack: **Rust, Go, TypeScript/JavaScript, C#, Python**.

## Find what you need

| You want | Go to |
|---|---|
| Get it running from zero | [Install and first run](#install-and-first-run) |
| Nothing is happening | [It is not working](#it-is-not-working) |
| Understand the ghost text | [FIM tab-completion](#fim-tab-completion) |
| Generate a function body | [Function generation](#function-generation) |
| Control what the model sees | [Context blocks](#context-blocks) |
| Compile errors and auto-repair | [Compiler check and repair](#compiler-check-and-repair) |
| Make the model match your codebase style | [Refine](#refine-repair-on-a-clean-build) |
| Generate unit tests | [TDD tests](#tdd-tests) |
| Use Claude/GPT/Gemini instead of local | [Cloud function generation](#cloud-function-generation) |
| Use your Claude subscription, no API key | [Claude Code](#claude-code-subscription-not-an-api-key) |
| Read the logs | [The output channel](#the-output-channel) |
| Every setting | [Settings](#settings) |
| Every command | [Commands and keys](#commands-and-keys) |
| What is broken or missing | [Known limits](#known-limits) |

## What runs where

Per language, so you know what you get before you install.

| | Rust | Go | TS/JS | C# | Python |
|---|---|---|---|---|---|
| FIM ghost text | yes | yes | yes | yes | yes |
| Surface injection (real members in the prompt) | yes | yes | yes | yes | yes |
| Member-name output gate | no | no | yes | yes | yes |
| Function generation | yes | yes | yes | yes | yes |
| Type generation (struct/enum/class/interface) | yes | yes | yes | yes | yes |
| Compiler check after accept | `cargo check` | `go build` | project's `tsc` | `dotnet build` | bundled pyright |
| Gated repair | yes | partial (see limits) | yes | yes | yes |
| TDD test generation | yes | yes | yes | yes | yes |
| Test runner rung | libtest | `go test` | vitest, jest | MSTest, xUnit, NUnit | pytest, unittest |

Any other language: FIM only, and only if you add its language id to `column80.fimLanguages`. See [Where FIM runs](#where-fim-runs).

## Install and first run

### Requirements

- [Ollama](https://ollama.com) on `http://localhost:11434` (`column80.apiBase` moves it).
- VS Code 1.85 or newer to install. **1.130 or newer** if you want the scoped-ghost gesture in C# and TypeScript: 1.124 never re-requests inline completions when the suggest selection changes, so the gesture is silently dead there.
- An NVIDIA GPU for function generation. No GPU still gets you FIM, labelled honestly.
- Your language's own toolchain for the compiler check: `cargo`, `go`, a project-local `node_modules/typescript`, `dotnet`. Python needs no pyright install, it ships inside the extension, but it does want a `.venv` or `venv` beside your project root. Without one the check falls back to system python and you get a missing-imports storm.

### The first-run flow

On activation the extension probes your hardware and offers a tier. Nothing downloads without your click.

1. **Probe.** One `nvidia-smi` spawn plus a RAM read, SIGKILLed at 3 seconds so activation cannot hang. No GPU, no driver, WSL without passthrough: all land on the FIM-only tier instead of guessing.
2. **Tier offer.** A picker with the detected tier preselected and every tier available as an override. Take the default and `hardwareTier` stays `auto`, so new hardware re-adapts. Pick explicitly and it persists.
3. **Ratified downloads.** One click per model your tier needs and your disk lacks. Decline and nothing changes; the message names what stays disabled and that **Column 80: Select Hardware Tier** is the way back.

If Ollama is down the flow offers to run `ollama serve` in a visible terminal, then tells you to re-run Select Hardware Tier once it is up. That command re-runs everything, any time.

FIM completion is **on by default** (`column80.enabled: true`). With no model pulled and no Ollama running it stays silent rather than erroring at you.

### The tiers

| Tier | Hardware | Function-generation model | Notes |
|---|---|---|---|
| `24gb` | 20GB+ VRAM | `qwen3-coder:30b` | Both models fully on GPU, no carve. **Provisional**: never validated on real 24GB hardware, and the picker says so. |
| `16gb-large-ram` | 16GB VRAM, 32GB+ RAM | `qwen3-coder:30b`, layer-capped at `num_gpu=30` | The reference config and the only spike-proven row. FIM holds 102-109ms TTFT during alternation, the 30b holds 34.6 tok/s, zero model evictions. |
| `16gb-low-ram` | 12-16GB VRAM, or 16GB VRAM with low RAM | `qwen2.5-coder:14b-instruct-q4_K_M` (~9GB) | Both models fit resident, no carve needed. Weaker than the 30b, and real. |
| `below-12gb` | Under 12GB VRAM, or no usable GPU | disabled | FIM only, with an honest message instead of silent thrashing. |

FIM always uses `qwen2.5-coder:1.5b-base` on every tier.

**Why the carve exists.** On a 16GB card, default Ollama scheduling thrashes when a small FIM model and a big instruct model alternate: 2 to 4.6 second reloads per swap, measured. Over-allocating the big model is worse, because it silently pushes the FIM model to CPU, which looks like it works while destroying the latency. The tier computes an explicit GPU layer cap so both stay resident. There is no `num_gpu` setting, deliberately: a manual knob is an invitation to the exact silent-CPU-spill failure the tiers exist to prevent.

Set `fnGenModel` yourself and you take the carve with it: an explicitly set tag wins and drops the carve, because a layer count tuned for the 30b means nothing on a foreign tag.

**When you report a tier problem, name the quant.** These are Ollama's default tags. A bug report saying "16GB tier" is not checkable; "16GB tier, `qwen3-coder:30b` at Ollama's default quant" is.

**The probe reads total VRAM, never free.** A game or another LLM holding half your card still gets a carve sized for an empty card, and Ollama degrades with no warning from here. Free the VRAM or override the tier down.

### It is not working

In order, cheapest first.

1. Open the **Column 80** output channel (View > Output > Column 80). Every path logs. Silence there means the provider was never asked.
2. `[fim] no ghost: languageId=cpp is not code Column 80 understands` means your language is not served. Add its id to `column80.fimLanguages`.
3. `[fim] no ghost: the cursor is inside a <kind> comment` is the rule that keeps the model out of your specs. Working as designed.
4. No `[fim]` lines at all: `column80.enabled` is off, or another inline provider (Continue, Copilot) won the ghost slot. There is no detection for that yet.
5. Function generation refuses with a tier message: run **Column 80: Select Hardware Tier**.
6. Everything is slow: check `[fim] ttft=` in the channel. Warm TTFT consistently past 200ms usually means the FIM model got pushed off the GPU. Something else is eating VRAM, or the tier is wrong for the card's current free memory.
7. Set `column80.fimModel` to a chat model and you get garbage and lag. It must be a **FIM-capable base model**, not `-instruct`. A big chat model does not speak the FIM tokens.

## FIM tab-completion

Ghost text as you type, from the 1.5b base model. Always local, no cloud path, ever.

### Where FIM runs

Rust, C#, Python, Go and the TypeScript family (`typescript`, `typescriptreact`, `javascript`, `javascriptreact`). That list is exactly the languages carrying an oracle or a surface extractor, which is this product's own definition of "we understand this". Everything else, markdown and JSON and YAML and code in an unlisted language, is dark before any model call. Writing prose should not spend a model call per keystroke.

`column80.fimLanguages` widens the list and can never narrow it. Use VS Code language ids, not extensions: `cpp`, not `.cpp`. You get plain FIM there. The oracle, repair and surface injection stay dark, because there is nothing behind them for that language.

One caveat before you widen. The rule that keeps ghost text out of your comments reads a per-language comment table. That table is wide (C, C++, Java, Kotlin, Swift, Scala, PHP, Dart, Ruby, the shells, Lua, SQL, Haskell, Clojure and more) but it has not met everything. Widen to a language it has not met and you get FIM with comment protection off. The channel says so once:

```
[fim] comment rules dark: no comment syntax mapped for languageId=zig, so the in-comment refusal cannot run here
```

### How it behaves

- **Debounce.** A request fires 150ms after your last keystroke (`debounceMs`). Newer keystrokes cancel older pending requests; at most one model request is in flight.
- **Speed.** Measured floor on the reference box (RTX 5080): 103ms time-to-first-token, 140ms total. The bar is sub-200ms warm at 2-4K context.
- **Typing through is free.** Type the characters of a shown suggestion and each keystroke re-hits a local cache instead of the model. `cacheCapacity: 0` turns that off if you want every keystroke observable on its own.
- **Context window.** The last 3000 characters before your cursor and the first 1000 after (`prefixChars` / `suffixChars`). Never the whole file.
- **Manual trigger.** VS Code's **Trigger Inline Suggestion** (Alt+\ by default) skips the debounce.

### The bound: why ghosts are short

Plain FIM continues the line you are typing. It does not author a body.

Measured over 850 real sites in the five shipped languages: 83% of unbounded plain ghosts were multi-line, and of the 7,397 lines served past line 1, 208 were right and 7,189 were wrong. So a plain ghost is now cut to one content line, extended to the end of an unterminated statement or of a construct that line opens, capped at four content lines, and never cut at a dangling tail.

A declaration head is the visible case: at `fn parse(` the ghost serves the rest of the signature and stops on the open `{`, instead of writing you a whole function. That change alone took pooled p90 from 231ms to 186ms.

Two sites are exempt and may go multi-line, because they have real facts in front of them: a member site, and a whole-block site (empty function body) where injection resolved.

`[fim] ttft=... bound=<rule> kept=N dropped=N appended=N` on the channel tells you the bound fired. An exempt site says so, so a long ghost there reads as the exemption working.

### The length floor

A ghost too short to be worth reading is not shown. `minGhostChars` (8) and `minGhostAlnum` (2) carry JetBrains' published numbers. Over 750 real sites the floor refused 7 of 710 served ghosts (1.0%), and none of the 7 matched what the developer went on to write. A ghost ending on a block opener is exempt on length, since that is exactly the signature shape the bound produces. Set `minGhostChars: 0` to see everything.

### Comment rules

Two rules, both structural.

- **The ghost never introduces a comment.** A comment-led line cuts the ghost before it; a trailing comment is cut off and the code kept.
- **Inside a comment there is no ghost.** Your doc comment is your spec, and a model writing your spec is the one thing this product refuses. It runs before the service is asked, so it costs no model call.

### Injection: real facts in the prompt

At three site kinds the extension asks your already-running language server for the truth and puts it in the model's prefix. No rival server is ever spawned.

- **Member site** (right after `.` or `::`): the receiver's real member signatures, narrowed to what you have typed, capped so a 100-candidate firehose is skipped rather than injected as noise.
- **Whole-block site** (cursor in an empty function body): the types-in-play struct graph, so a generated body uses real field and method names.
- **Enum-RHS site** (C# only today, `t.Band == `): the enum's variant list, so the model writes `LodBand.Regional` instead of inventing `Band.Regional`.

Every query is raced against a **50ms deadline**. A cold or busy language server loses and the path falls back to plain FIM rather than blow the latency bar. The wait is folded into the reported TTFT, so the numbers stay honest.

**Backtick a type name in any comment and Column 80 resolves its surface into the prompt. Without backticks it is prose and is left alone.**

Write the type the way your language spells it. `` `*Config` ``, `` `&'a Config` ``, `` `dyn Storage` ``, `` `chan Event` ``, `` `http.Client` ``, `` `Contoso.DataModel.Widget` ``, `` `Alpha | Bravo` ``, `` `data: Widget` `` and `` `IsCa, KeyPair, DnType` `` all resolve. A leading `*` or `&`, a package or namespace qualifier, a keyword like `dyn` or `chan`, and a comma list are all read. `` `Assert.AreEqual(x, y)` `` resolves `Assert`, because a call names its receiver. A lone capital is not read, since `T` in `Map<K, V>` is a type parameter with no definition to look up.

This one is not an inline-completion site. It runs on the generate and repair gestures, in doc comments and body comments, in all five languages, and no FIM path reads it. It is opt-in because a scan that guesses is worse than nothing: across 6,856 comment lines of real code, an unbackticked PascalCase scan admitted 5,232 names and 122 of them were types. The rest is sentence-initial English, and under a type cap that binds, junk does not just waste bytes, it evicts the types you needed.

**Usage examples** (`fimUsageExamples`, on by default) go one further: under the signature block, at a member site whose name your buffer already spells, it shows the model real call sites of that member from your own workspace, found through find-references so aliases and re-exports are seen through. Measured on 40 real Rust member sites: continuations that do not type-check drop from 8 in 40 to 3. It runs on whatever is left of the 50ms budget, so in C# it will rarely appear at all: Roslyn's find-references has a fixed half-second floor.

### The gates: what gets thrown away

- **Member-name gate** (`fimMemberGate`, on): where the language server's member list is complete (TypeScript, C#, Python), a ghost naming a member that is not in the list is dropped before you see it, and an alternate promoted if one exists. An empty list never gates: absence of evidence is not evidence. Rust is exempt, because rust-analyzer serves keyword and postfix completions (`.await`) that make its list structurally incomplete.
- **Enum-RHS value gate** (C#): a ghost that opens a string literal at a resolved enum comparison is refused. A C# enum can never equal a string, so there is no false-positive surface.

Every suppression carries a reason on the channel and a session count. `[fim] dropped:` means you got nothing. `[fim] trimmed:` means you got something shorter. `[fim] refused:` means a candidate died but you were served anyway.

### The scoped ghost: composing with the suggest widget

VS Code's native completion dropdown gives you a member name. The model gives you the rest of the statement. Column 80 composes them rather than fighting for the slot.

The gesture is **arrow, Escape, Tab**:

1. Arrow through the widget. The ghost re-scopes to whichever member is highlighted, so you see the whole call for the member you are looking at.
2. Escape dismisses the widget. The scope is remembered, because Escape does not put the member name in your buffer, so the ghost has to carry the whole thing.
3. Tab accepts.

Two kinds of highlight, treated differently. A member you **arrowed to** is a choice and holds the ghost until you move. The widget's own **auto-preselect** holds it for 1500ms, measured from the request that served the ghost so a slow generation does not eat the window.

**Second Escape** drops the scope, closes the widget and re-renders unscoped, so the model works on what you actually want. A dismissed member stays dismissed at that cursor. If you use a vim keymap, your Escape leaves insert mode instead, and there is no alternative binding yet.

### Alternatives

`fimAlternatives` (3) generates that many completions on a **manual** trigger only (Alt+\), cycled with Alt+] and Alt+[. Automatic ghost text always generates one: the latency bar is not for sale. The gesture waits for the slowest run, and on an Ollama with `num_parallel=1` (common for large models) the runs serialize, so expect roughly three times one generation.

## Function generation

The unit of generation is the function. Never the file, never the module. Generation is structurally incapable of touching bytes outside the target span: the accept path is the extension's only proposal write, and it splices exactly the span you saw in the preview.

### The workflow

1. Write the signature and the doc comment.
2. Curate context blocks if the function needs them ([Context blocks](#context-blocks)).
3. Put the cursor in the function and run **Column 80: Generate Function Body** (editor right-click > Column 80, or the palette).
4. A diff preview opens: your document left, the proposal right. Warm generation is 4 to 8 seconds for a typical function. The first request after a cold start pays a model load measured in tens of seconds.
5. **Accept** or **Reject**: the check and close buttons in the diff's title bar, `Enter` to accept, `Escape` to reject. Closing the tab is a reject. Nothing is inserted without your accept.

```mermaid
flowchart TD
    A["Signature + doc comment"] --> B["Curate context blocks"]
    B --> C["Generate Function Body"]
    C --> D["Model call, 4-8s warm"]
    D --> E[Diff preview]
    E -->|Reject or close tab| F[Document untouched]
    E -->|Accept| G["Body spliced into the span"]
    G --> H{Language has an oracle?}
    H -->|no| I[Done]
    H -->|yes| J["Compiler check, scoped to the project"]
    J --> K["Check summary at the edit site"]
    K --> L{"Eligible errors + repair on?"}
    L -->|no| I
    L -->|yes| M["Repair proposal, same diff, max 2 rounds"]
    M --> E
```

### The doc comment is the instruction

This is the part worth internalising. The prompt is: your context blocks, a fixed instruction line, then the doc comment and signature. No surrounding code, no imports, no file contents, no system message. Your doc comment is the only place your intent lives, so write it like a spec.

```rust
/// Parse a duration string like "1h30m45s" into total seconds.
/// Units h, m, s may appear in any order but at most once each.
/// Rejects empty input, unknown units, and values over u32::MAX
/// with a `ParseError` naming the offending token.
fn parse_duration(input: &str) -> Result<u64, ParseError> {
    todo!()
}
```

A vague comment gets you a plausible body that does something. A comment naming edge cases, error behaviour and invariants gets you the function you meant. Whatever body was there is irrelevant, it is replaced.

Backtick a type name in any comment and Column 80 resolves its surface into the prompt. Without backticks it is prose and is left alone. `ParseError` is backticked above by convention, though the signature names it too, so it resolves either way. The backticks are what matter for a type you mention only in prose.

In Python the **docstring** is that channel, and it is preserved outside the generated span. Two shapes are refused rather than half-eaten: a docstring on the header line (`def f(): "d"`), and an implicitly concatenated one (`"a " "b"`). Both messages tell you what to change.

### Sketch the body in comments

Write the steps as comments and generation reads them:

```go
func mergeGaps(gaps []Gap) []Gap {
    // sort by start
    // walk pairs, extend when they touch
    // drop the swallowed one
}
```

Only comments at the function body's own depth are harvested. A comment inside an `if` or a `for` is commentary on code that already exists, at a different granularity, so it stays out. The channel names what it took: `[fngen] scaffold comments: harvested 3 of 4`.

Backtick a type name in any comment and Column 80 resolves its surface into the prompt. Without backticks it is prose and is left alone. Name a type in one of these steps and backtick it: `GapRun`, not GapRun. The model then gets that type's real fields and methods instead of a guess at what a word in your sentence meant. Type names are read from every comment in the span, not only the ones at body depth, because a type mentioned inside an `if` is still a real type.

Test generation never sees these. `// loop backwards to avoid index shift` is an algorithm note, and a test written from it couples to the algorithm instead of the behaviour.

### Types, not just functions

Put the cursor on a `struct`, `enum`, `class`, `record` or `interface` header and the same gesture generates its body from the doc comment. Bodyless shapes refuse plainly: an interface member or an abstract method has no body to generate.

A cursor **inside the doc comment** counts as being on the thing it documents. Four of the five language servers exclude the comment from the symbol range, so this is handled here rather than left to the server.

### Regeneration

Run the command again and the old body is **not in the prompt**. Regeneration is a fresh ask from signature, doc comment and blocks. If the previous body matters as a starting point, select it and add it as a context block first. Your doc comments and attributes above the function are never part of the span, so regeneration can never eat them.

### When it says no

- **No function at the cursor**: the language needs a hierarchical document symbol provider. Flat `SymbolInformation` resolves to "no function here" rather than guessing a span.
- **Generation discarded**: you edited the document while the model was generating or while the preview was open. Any change discards rather than risking a mis-splice. Re-run.
- **Failed: truncated**: the reply hit the token budget. On a local model the fix is a smaller
  function, not a bigger budget: the ceiling is 2048 tokens and it shares the context window with
  the prompt. On a cloud model the ceiling is 64000 and this should be rare; if you see it there,
  the model is spending the budget on reasoning rather than on your function, and a narrower
  function is still the lever.
- **Failed: fence contamination**: the reply carried markdown fence structure that could not be spliced safely. Regenerate. A function that legitimately needs a line starting with three backticks is un-generatable.
- **Came back as a stub twice**: the model wrote `todo!()` (or its idiom) and the anti-stub re-prompt did not shift it. The preview is that stub, said out loud rather than dressed up.

## Context blocks

The **Model Context** panel in the Explorer sidebar is the identity feature. It shows exactly what the model will see, in exactly the order it will see it. Nothing is included automatically. Ever.

### Gestures

| Gesture | What it adds |
|---|---|
| **Add File to Model Context** | The clicked file, or the whole tree multi-selection, or the active document from the palette. One unreadable file in a selection of six adds the other five and names the one it skipped. |
| **Add Selection to Model Context** | Every non-empty selection, one block each, in document order. Multi-cursor works. |
| **Add Enclosing Symbol to Model Context** | The whole function, method or type the cursor sits in. The symbol tree picks the lines, so no off-by-a-brace. |
| **Add Enclosing Block to Model Context** | The tightest block around the cursor (an `if`, a `for`, a closure) via the language server's selection ranges. No usable answer falls back to the enclosing symbol. |
| **Remove / Move Up / Move Down** | Per item, inline icons or right-click. Panel order is prompt order. |
| **Clear Model Context** | Empties the list. |

Right-click in the editor for the four add gestures, right-click a file in the Explorer for Add File. Neither AST gesture is language-gated: what you may show the model is not the same question as where code may be generated.

### The rules that make it trustworthy

- **Blocks are live.** A block is a line range, not a copy of text. At generate time the model gets what those lines say right then. Add a block over a function, type an `if` into it, fill the body, generate: the implementation is in the prompt.
- **Edit inside a block and it grows with you.** Insert three lines inside it and the block is three lines longer. Edit above it and it slides down. The panel description is always the current range, and the tooltip previews the current text, so a block you are working in reads correct.
- **A healthy block never warns.** There is no stale icon any more, because there is nothing left for it to mean. Editing your source is not a problem to be flagged; it is the point.
- **Lost is the only failure, and it is loud.** A block goes red with `(lost)` and the tooltip names why: an edit crossed its boundary, its file was deleted, or its document closed and the lines no longer matched when the extension next looked. Losing one takes a deliberately destructive edit, like pasting over a region that spans out of the block. Remove it, or select the lines again.
- **A lost block drops out of the generation. It never refuses one.** The generation runs without it and a warning names what it left out, once per gesture. A block the panel still lists silently missing from a prompt is the thing this feature exists not to do, so three surfaces stand in the way: the red row, the toast, and the warning at generate time.
- **One toast per edit, not per block.** An edit that crosses three blocks throws one warning naming all three, with **Remove** to clear exactly those and **Show** to reveal the panel.
- **Rename a file and its blocks follow it. Delete it and they are lost.** Renaming the folder it sits in does not carry them, and blocks added from an unsaved untitled buffer go lost when you save it, because saving swaps the document for a new one under a real path.
- **Removed means gone.** The prompt is assembled from the live store at the moment you invoke generation. A block you removed cannot reach any generation started after the removal, including one already reading its blocks. Zero tolerance, pinned in the test suite.
- **What you trade for live text is exact repeatability.** Generate twice, minutes apart, having typed in between, and the two prompts differ. The panel showing the live range and the live text is what keeps that honest rather than mysterious.
- **No dedup, no caps.** Add the same region twice and it appears twice. The panel shows the truth; you curate.
- A generation already in flight keeps the prompt it sent. Changing blocks mid-flight affects the next one.

Blocks do not survive a window reload. An empty panel after reload is honest; silently rehydrated context you forgot about is exactly what this feature exists to prevent. Blocks you left behind walk the plank, and that is the point.

FIM never sees context blocks. They feed function generation only.

## Compiler check and repair

After you accept a generation (or a FIM completion) in a served language, the extension runs that language's own compiler against disk and shows you the truth.

| Language | Command | Root |
|---|---|---|
| Rust | `cargo check --message-format=json` | nearest `Cargo.toml` |
| Go | `go build -o /dev/null ./...` | nearest `go.mod` |
| TypeScript/JS | the project's own `tsc --noEmit` | nearest `tsconfig.json` |
| C# | `dotnet build` with SARIF, `--no-restore` | nearest `.csproj` |
| Python | bundled pyright `--outputjson`, against the project's own interpreter | nearest project root with a venv |

You get an inline summary at the edit site (`cargo check: 1 error(s), 0 warning(s)`) with full rendered diagnostics on hover. The document is saved first, because compilers read disk.

Column 80 publishes nothing to the Problems panel. That panel belongs to your language server, which reports these errors already and clears them as you type.

Three things worth knowing. TypeScript never uses a bundled, global or npx `tsc`: version honesty, and npx can reach the network. A TS green must be earned, so a file the project does not actually load (a `.js` without `checkJs`, an excluded `.ts`) is reported honestly inapplicable rather than green. `dotnet build` never restores for you; a restore is your gesture.

The compiler's own output is the input of record. VS Code's diagnostics API is never read back into the loop.

### Repair

`repairEnabled` (default on) lets the function-generation model propose fixes when the check fails. The boundaries are hard:

- **At most 2 rounds, structurally.** The round counter cannot represent a third model call. No reset, no second counter.
- **Only errors touching your function.** Diagnostics are scoped to the accepted function's byte range. Pre-existing errors elsewhere are surfaced, never fed to the model.
- **Never assertion failures.** Wrong-value repair measured useless even at 30B, so anything assertion-shaped is refused with a logged reason, always.
- **Never warnings, never span-less diagnostics.**
- **Same consent gate.** Every repair proposal goes through the identical diff preview. Reject ends the session and the remaining diagnostics stay on screen. Repair has no insertion path of its own.

Routing is measured, not taste. A FIM-sourced failure crosses to the big model first (same-model self-repair is dead below ~30B), then self-repairs once. A generation-sourced failure gets one self-repair round and then surfaces.

After every accepted repair the check re-runs, because compilers suppress later error waves while earlier ones stand: fixing a name error can unmask a borrow error. Waves are handled inside the same 2-round cap.

With `compilerDirectedInjection` on (default), a repair round leads with the real API surface the compiler's error class points at, resolved from your language server: the crate's worked example or real signatures on a hallucinated method, the installed-dependency catalog on a reach for a package you do not have. A missing-but-resolvable import is qualified in place (`fastbloom::BloomFilter`) rather than injected as a `use` line you did not write. Every injected block is a labelled, visible section in the previewed prompt.

Turning `repairEnabled` off disables repair only. Check-and-surface always runs.

Two things stated plainly. On an eligible failure the repair **model call happens before you are asked anything**: consent gates the splice, not the generation. And a FIM accept on a dirty file forces a save you did not explicitly ask for, because the check reads disk.

### Refine: repair on a clean build

Run **Repair Function Body** when the build is already green and it does the other thing you might have wanted. It finds real call sites of the methods and types your function uses, through your language server's find-references, shows them to the model, and asks it to rewrite your function the way the rest of your repo writes code.

Only on the **command**. An automatic post-accept check that comes back green stays silent.

- **Its own budget: one round.** It never touches the two rounds reserved for the compiler.
- **Every example is visible**, as a labelled section in the previewed prompt and a `[repair] refine window <file>#L...` line on the channel.
- **No usage means nothing happens.** A function whose symbols your repo calls nowhere else gets a message and no model call. It will not inject something adjacent and hope.
- **Read the diff.** The check runs after you accept, not before, because checking a candidate first would mean writing code you have not consented to. If the refine introduces a compile error you get a warning naming the count and the first error, and the editor's own undo takes it back. Measured on 14 real C# methods: 5 proposed a change, 1 of those 5 broke the build, and 1 more compiled cleanly while quietly changing a field mapping. This is a gesture to read, not to wave through.

## TDD tests

**Column 80: Generate Tests (TDD)** authors unit tests **blind of any implementation**. The model gets the signature, the doc comment and the resolved callee surface, never a reference body, so the red signal survives as the deliverable.

Then it blanks every expected value. The model's guessed value is never inserted. You Tab through the holes and type each assertion yourself. That is the whole point: a test whose expected value the model wrote is a test that agrees with the code rather than with you.

### Where the tests land

| Language | File | Reach into private code |
|---|---|---|
| Rust | same file, `#[cfg(test)] mod tests` | `use super::*` |
| Go | sibling `foo_test.go`, same package | same package, so unexported functions are first-class targets |
| TypeScript/JS | sibling `foo.test.ts` under the nearest `package.json` | import only, so a non-exported function is refused |
| Python | `test_foo.py` in pytest's `testpaths`, else `tests/`, else beside the source | no privacy in Python, so nothing is out of reach |
| C# | `<Stem>Tests.cs` inside a **found** test project | assembly reference, so a private method is refused unless `InternalsVisibleTo` says otherwise |

The test file is created if it does not exist. This is the extension's one file-creating path, and it is not exempt from consent: the whole new file is previewed as a diff against empty, with the expected values blank in the preview as well as in the buffer. Reject writes nothing and leaves no file behind. It creates a test **file** only, never a project, a config, a manifest or a package install. C#'s test project is found, never created.

### Running them

**Column 80: Run TDD Tests** runs exactly the tests generated for the function under your cursor.

| Language | Runner | Parsed from |
|---|---|---|
| Rust | `cargo test --lib` | libtest output |
| Go | `go test` | JSON output |
| TypeScript/JS | the **local** vitest, else the local jest, never `npx` | JSON reporter |
| Python | pytest, else unittest | `--junit-xml`, never the text |
| C# | `dotnet test` with MSTest, xUnit or NUnit | TRX |

A project with no configured framework stays honest-dark and names every framework it looked for. Nothing is ever installed for you.

Text output is parsed only where it cannot be forged. A `print()` in the code under test lands at column 0 in pytest's captured-stdout section, so a text parser sees a phantom test and a forged count; the XML attributes cannot be reached from inside a test. The same reasoning killed `--nocapture` on the Rust rung.

Four no-run outcomes are reported as themselves rather than as a pass: the tests failed, the tests did not compile, the filter matched nothing (exit 0, the silent false green), and the runtime is missing. A skipped-everything run says so instead of implying a full run.

### When it refuses

Refusal is the feature. From the signature and doc comment alone, a function is classified and the reason surfaced: async, IO, needs-fixture, underspecified, not-exported, no return value to assert. You get the reason, not a hollow or mocked test.

**Expect a lot of refusals, and know the numbers before you judge it.** Measured on real corpora: 7 of 89 Python functions survived; the TypeScript corpus refused every one of its 157 functions, mostly because it documents 7% of them; the C# corpus refused all 251, because the clearest test targets there are private and the solution has no `InternalsVisibleTo`. All four legs ship exactly as specified. Relaxing a leg to manufacture survivors is a human decision, not a tuning.

Wrong-value repair from a red test is banned. Test-repair is banned. A wrong test is a human re-type.

## Cloud function generation

Function generation can run against a cloud frontier model instead of your local Ollama. It is off by default, and turning it on is the only way any code leaves your machine. Two ways in: an API key with any of the four providers below, or your existing Claude Code subscription with [no key at all](#claude-code-subscription-not-an-api-key).

**What gets sent:** the assembled prompt only. Signature, doc comment, your selected context blocks, any surface the tool injected. That is the same prompt the local model would have seen. Nothing else, ever. Not the rest of your file, not FIM keystrokes, not compiler output. **FIM stays 100% local no matter what this is set to.**

Set:

- `column80.fnGenProvider`: `openai`, `anthropic`, `xai`, `gemini`, or `openai-compatible`. Leave it `ollama` for local.
- `column80.cloudApiKey`: your key. Sent as a Bearer token, except on `anthropic`, whose native API takes it as `x-api-key`. Blank leaves generation disabled with a message; it never fires a keyless request.
- `column80.fnGenModel`: the provider's model id. The default `qwen3-coder:30b` is an Ollama tag and draws an "unknown model" error from a provider. Get the current id from the provider, not from here.

Three of the four named providers ride one OpenAI-compatible surface (Gemini through its compatibility endpoint), so there is one code path and one behaviour. For anything else speaking OpenAI chat-completions (OpenRouter, Groq, DeepSeek, a self-hosted vLLM), pick `openai-compatible` and set `column80.cloudApiBase` to its base URL up to `/chat/completions`.

**`anthropic` is the exception, and it is the exception on purpose.** It speaks the native Messages API, because the thing worth having there does not exist on the compatibility surface: prompt caching. Column 80 re-sends your context blocks on every generation, and without a cache marker you pay full price for the same bytes every time. So one breakpoint is placed after your blocks, with a one-hour lifetime, and a second generation against the same blocks reads them instead of re-sending them. Nothing to configure. Change a block, or add or remove one, and the next generation simply writes a new entry.

OpenAI and Gemini need no marker; they match prefixes implicitly. They get the same benefit for free as long as your blocks do not change, because the prompt is assembled deterministically and the blocks always lead it.

The channel prints what happened, from the provider's own accounting rather than from our arithmetic. The fields, in order:

```
[anthropic] model=<id> cache-mark=<yes|no> ttft=<n>ms total=<n>ms in=<n> out=<n> cwrite=<n> cread=<n> ttl=<1h|5m|mixed|none|?> billed-eq=<n>
```

`cache-mark` is what was sent. `cwrite` and `cread` are what the provider did with it: a large `cread` beside a near-zero `cwrite` is a round that paid almost nothing for its context. `billed-eq` puts the round in one number, in base-input-token equivalents, using Anthropic's published multipliers (a one-hour cache write costs 2x base input, a read 0.1x). It is a cost figure, not a token count, and it is arithmetic on their numbers rather than a bill.

On an API key that arithmetic is what you pay. **On the Claude Code backend it is not**: that path bills a subscription, where there is an allowance rather than a price, and nothing measured so far shows how a cache-read token counts against that allowance. Read `billed-eq` there as a comparison between rounds, not as a quota saving.

A field reading `?` means the provider did not report it. It never means zero.

What changes: no hardware tier, no carve, no download for that path. A weak laptop gets the same frontier model a workstation does. You still need the FIM model pulled locally.

What does not change: same doc-comment-as-spec prompt, same diff preview, same span guarantee, same compiler check and gated repair. Errors surface with the provider's own message.

Cost and privacy are yours to own. Every generation is a billed API call and your prompt leaves your machine. That is the trade you are opting into, said plainly.

### Claude Code: subscription, not an API key

Already paying for Claude Code? Point function generation at the CLI you have installed and skip the API key entirely. Generation is billed to your subscription.

```jsonc
"column80.fnGenProvider": "claude-code",
"column80.fnGenModel": "claude-sonnet-4-5"   // optional
```

Leave `fnGenModel` at its Ollama default and no model id is sent at all: the CLI picks, and the channel says `model=cli-default`. On the reference box that default resolved to **Opus**, which is a lot of model for a function body. Name the one you want and it is passed straight through. `cloudApiKey` and `cloudApiBase` are ignored here.

You need `claude` on your PATH and logged in. Not installed, and generation is disabled with a message naming the fix, FIM untouched. Logged out is not checked up front, because a login probe would spend quota every time you change a setting, so you find out on your first generation and the message tells you to run `claude` then `/login`.

**Where it runs, and why you should care.** The CLI is spawned in an empty product-owned directory under the extension's global storage, never your workspace. Run it in your workspace and it would quietly pull your `CLAUDE.md`, your project memory and your MCP servers into a generation the context panel never showed you. That breaks the one rule this tool has, so it fails closed rather than ever falling back to your workspace. Your project context never sails with it.

What that does not buy you: the CLI's own agent harness loads on every call, plus whatever sits in your global `~/.claude`. That is quota spent before your prompt is read.

Most of it was Claude Code's built-in tool definitions, so the tools are turned off. A generation cannot use Read, Write or Bash, and you should not pay for their definitions on every call. Measured on claude 2.1.224, same prompt, byte-identical generated code:

| | input context carried |
|---|---|
| with the toolbelt | 23,217 |
| tools off (what ships) | 3,471 |

Your prompt and any injected surface sit on top of that, so a big generation costs more than the floor. What remains is Claude Code's system prompt, which is not removed: a flag exists, but changing what the model expects from this transport for a further few thousand tokens is not a trade worth making blind.

And the per-call dollar figures the CLI reports are API prices, notional under a subscription; what they tell you is that you reach a usage ceiling faster than your prompt sizes alone suggest.

**Your context blocks are sent once, not once per function.** The CLI puts its only cache breakpoint at the end of the turn, which is the wrong end for this product: change the signature at the bottom of a prompt and the 39KB of pinned context above it is re-sent in full. So Column 80 sends your blocks as their own turn first, gets a one-word reply, and forks every generation off that checkpoint. The blocks are then read from cache instead of re-written, with a one-hour lifetime.

You pay for this once per block set. The first generation after you pin, edit, add, remove or reorder a block does an extra round trip, 2 to 12 seconds, and the channel calls it `cache-mode=warmed`. Every generation after that is `cache-mode=forked`. Repairs and refines of the same function reach the same checkpoint rather than building a second one.

Measured through the product on claude-sonnet-4-5, with a 10,443-byte file pinned as one block:

```
[claude-code] turn1=warmed session=b73b53d6 bytes=10698 total=6508ms in=10 out=140 cwrite=12065 cread=2302 ttl=1h billed-eq=24370
[claude-code] fence-strip=yes num_turns=1 model=claude-sonnet-4-5 cache-mode=forked ttft=6487ms total=6487ms cli-ttft=5243ms cli-total=5265ms in=10 out=283 cwrite=133 cread=14367 ttl=1h billed-eq=1713
```

Building the checkpoint cost 24,370. Generating a completely different function against it cost 1,713, of which 133 tokens were written and 14,367 were read. Without the fork you would pay something close to that first number on every generation, because the CLI would re-send the block every time.

The one-hour lifetime is real and it is the provider's, not ours. Two runs twenty minutes apart shared a checkpoint payload: the second run's turn 1 reported `cwrite=0 cread=14367`, so building it the second time cost nothing at all.

The checkpoint is keyed on the exact bytes of your blocks, and that is a correctness rule, not an optimisation. Blocks are read live: edit inside a pinned range and the next generation builds a new checkpoint, because a cache that served the old text while you believed it saw the new one would produce plausible, wrong code. Edit the same file OUTSIDE every pinned range and the cache holds, which is what makes the feature worth having: writing the function you are working on does not throw away the reference material you pinned.

Nothing is ever warmed in the background. Pinning a block is not a request for a model call, and this product does not make cloud calls you did not ask for. The extra turn happens on your first generation and nowhere else.

If anything about the checkpoint goes wrong, the generation still happens. A missing, expired or unforkable session falls back to sending the whole prompt, and the channel says `cache-mode=degraded` with the reason. A cache miss is never a failed round.

One thing to know about disk: the CLI writes a transcript per session under `~/.claude/projects/`, keyed on the directory it ran in. Column 80's runs land in their own folder there and it grows with use. The product does not delete anything in it, because that is the CLI's own state and guessing at its layout to prune it is how you delete someone else's transcripts.

Latency lands between 3.5 and 12 seconds per round on the reference box, cold start included. The channel prints two numbers and they differ on purpose:

```
[claude-code] fence-strip=yes num_turns=1 model=cli-default ttft=3464ms total=3464ms cli-ttft=2048ms cli-total=2083ms
```

That capture predates the cache work. A round now also carries `cache-mode=` after `model=`, and the same `in= out= cwrite= cread= ttl= billed-eq=` accounting the Anthropic backend prints, at the end of the line.

`total` is what you waited. `cli-total` is what Claude Code says it spent. The gap, about 1.3 seconds, is the process spawn plus the CLI boot plus that global context reload. Anyone benchmarking this against Ollama wants the first number.

`fence-strip=yes` means the reply arrived wrapped in a code fence and the wrapper was removed. Claude does this regardless of being told not to. Normal, and worth knowing your generation went through one normalization step the Ollama path does not.

FIM stays local, as ever. Twelve seconds per keystroke would be daft, and the CLI has no infill mode to complete into anyway.

## The output channel

**Column 80** in the Output panel is the evidence trail. A path is finished when it emits evidence, not when it compiles.

| Prefix | Owner |
|---|---|
| `[fim]` | completion round trips, cache hits, drops, injection |
| `[fngen]` | generation rounds, guard rejections, accept/reject/discarded |
| `[ctx]` | every context-store mutation |
| `[oracle]` | check runs, skips, parse drops, queue events |
| `[repair]` | eligibility refusals with reasons, rounds, refine windows |
| `[carve]` | probe, tier, pull offered/ratified/declined/done |
| `[claude-code]` | one line per round on the Claude Code backend: fence strip, turns, both latencies, cache mode, token accounting |
| `[anthropic]` | one line per round on the native Anthropic backend: whether a cache marker was sent, and the same accounting |
| `[tdd]` | test generation, testability refusals, insertion, run verdicts |
| `[diag]` | `Dump Completion Items At Cursor`, on demand only |

```
[fim] invoked automatic selection=none at 42:18
[fim] ttft=104ms total=139ms len=42 bound=statement kept=1 dropped=3
[fim] cache hit len=37
[fim] usage injected for enroll_tile: windows=2 of 7 references, ms=31
[fim] dropped: ghost names no resolved member of `stripe`
[fngen] gen model=qwen3-coder:30b promptBytes=1843 blocks=2 span=512-1298
[fngen] scaffold comments: harvested 3 of 4: sort by start | walk pairs | drop swallowed
[fngen] ttft=612ms total=5210ms len=387
[fngen] outcome=accept
[ctx] add id=b3 range=L10-L42 bytes=980 version=7 uri=file:///...
[oracle] check crate=/path/to/crate file=/path/to/file.rs
[oracle] check done ms=1180 errors=1 warnings=0 success=false
[repair] decision round=1/2 route=self-repair source=fngen eligible=1
[repair] ineligible code=E0080 reason=assertion-failure
[carve] tier=16gb-large-ram reason=auto vram=16303 ram=61826 numGpu=30 provisional=false
[carve] pull ratified model=qwen3-coder:30b
```

Habits worth having: `promptBytes` and `blocks` tell you what a generation actually cost in context. `[repair] ineligible ... reason=` explains why a diagnostic was not auto-fixed. Every model download is preceded by its own `pull ratified` line, so a pull with no ratify above it is by definition a bug worth reporting.

`column80.logPrompts` dumps the full assembled prompt, byte for byte, including injected surface, between begin/end markers. It fires on FIM too, so it is very verbose. Leave it off for normal use.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `column80.enabled` | `true` | FIM autocomplete on/off. |
| `column80.apiBase` | `http://localhost:11434` | Ollama base URL. |
| `column80.fimModel` | `qwen2.5-coder:1.5b-base` | FIM model. Must be a FIM-capable **base** model, not `-instruct`. |
| `column80.fimLanguages` | `[]` | Extra VS Code language ids to serve FIM in. Widens, never narrows. |
| `column80.fimUsageExamples` | `true` | Show real call sites of a member under its signatures at member sites. |
| `column80.fimMemberGate` | `true` | Drop member-site ghosts naming an unresolved member (TS, C#, Python). |
| `column80.fimAlternatives` | `3` | Completions generated on a manual trigger. Automatic always generates one. |
| `column80.minGhostChars` | `8` | Shortest ghost worth showing. `0` disables the floor. |
| `column80.minGhostAlnum` | `2` | Alphanumerics a ghost must carry. Refuses pure punctuation like `);`. |
| `column80.cacheCapacity` | `100` | FIM cache entries. `0` sends every keystroke to the model. |
| `column80.maxTokens` | `256` | FIM tokens per completion. |
| `column80.temperature` | `0.01` | FIM sampling temperature. |
| `column80.debounceMs` | `150` | Keystroke-to-request delay for FIM. |
| `column80.prefixChars` | `3000` | FIM context before the cursor. Floored at 10. |
| `column80.suffixChars` | `1000` | FIM context after the cursor. |
| `column80.fnGenModel` | `qwen3-coder:30b` | Function-generation model. An Ollama tag locally, the provider's id on cloud. Setting it explicitly overrides the tier and drops the carve. |
| `column80.fnGenFallbackModel` | `qwen2.5-coder:14b-instruct-q4_K_M` | Function-generation model for the `16gb-low-ram` tier. |
| `column80.fnGenProvider` | `ollama` | Local, `claude-code` for your Claude subscription, or one of `openai`/`anthropic`/`xai`/`gemini`/`openai-compatible` with a key. FIM is local regardless. |
| `column80.cloudApiKey` | `""` | Key for the cloud backend: a Bearer token, or `x-api-key` on `anthropic`. Blank keeps cloud generation disabled. Ignored by `claude-code`. |
| `column80.cloudApiBase` | `""` | Endpoint for the cloud backend. Required for `openai-compatible`. Ignored by `claude-code`. |
| `column80.hardwareTier` | `auto` | `auto` probes on activation; a tier id skips the probe. |
| `column80.repairEnabled` | `true` | Gated compiler-error repair after accepted generations. Off: surface only. |
| `column80.injectedContext` | `small` | How much of your own code goes into the function-generation prompt. Pick the row that matches the model you generate with: `small` (a 30B-class local model), `medium`, `large` (a large local model or a cheap cloud one), `frontier` (Opus and Fable class). Moving it up widens four things at once - how many of your types are injected, how far each is followed, how many types in total, and the byte budget they share - so a higher setting means a larger prompt, a slower first token and more language-server lookups. It widens the repair prompt too. Note what it does NOT reach: Go, Python and C# inject member signatures rather than data shapes, so for those three the setting moves how many types are injected and how many members each shows, and nothing else - the extension says which numbers are in force, per language, on its output channel. Replaced `column80.injectedSurface`, which moved one of those four and so could not change the prompt on its own. |
| `column80.compilerDirectedInjection` | `true` | Inject the real API surface the compiler's error points at, and qualify missing imports in place. Off returns diagnostics-only repair. |
| `column80.repairUsageWindows` | `false` | Inject call sites into compiler repair rounds. Off by default: it lost its measurement, scoring no better than the control and costing 2.6s per round. |
| `column80.logPrompts` | `false` | Dump every assembled prompt to the channel. Very verbose. |

No `num_gpu` setting, deliberately. See [the carve](#the-tiers).

## Commands and keys

Every command is under the **Column 80** category in the palette.

| Command | Where else |
|---|---|
| Toggle FIM Autocomplete | palette |
| Generate Function Body | editor right-click > Column 80 |
| Repair Function Body | editor right-click > Column 80 |
| Generate Tests (TDD) | editor right-click > Column 80 |
| Run TDD Tests | editor right-click > Column 80 |
| Select Hardware Tier | palette |
| Add File to Model Context | editor right-click, Explorer right-click, editor tab right-click, panel title |
| Add Selection to Model Context | editor right-click (with a selection), panel title |
| Add Enclosing Symbol to Model Context | editor right-click |
| Add Enclosing Block to Model Context | editor right-click |
| Remove / Move Up / Move Down | panel item, inline icons or right-click |
| Clear Model Context | panel title |
| Dump Completion Items At Cursor | palette, diagnostic only |

Three keybindings ship, all three lifecycle:

| Key | When |
|---|---|
| `Enter` | accept, in a Column 80 diff preview |
| `Escape` | reject, in a Column 80 diff preview (defers to the find widget or a selection first) |
| `Escape` | dismiss the scoped ghost, when one is in force and the suggest widget is closed |

The gestures ship with no default keybindings. Bind the ones you use through **Preferences: Open Keyboard Shortcuts** and search `column80`.

## Known limits

Stated plainly. Most have the fix direction already recorded.

**Hardware and setup**

- **Total-VRAM probe.** Tier selection reads total card memory, never free. A contended card gets a carve sized for an empty one, and Ollama degrades with no warning from here.
- **NVIDIA only.** AMD and Intel GPUs, and Apple Silicon, land on the FIM-only tier. Manual `hardwareTier` override is the workaround.
- **The 24GB tier is provisional.** Expected to work, never validated on real 24GB hardware.
- **No landing-rate counter.** Nobody knows how often injection actually reaches the model on a given machine. The only signal is a channel line. On a slower box injection could be silently off forever and you would not know.

**FIM**

- **Injection dies under CPU load.** Measured under 28 CPU spinners, facts reaching the model: C# 20/20, TypeScript 17/20, Rust 3/20, Python 0/20. Two different causes (request count, and receiver-resolve cost eating the whole 50ms window), and both are open.
- **The gate never sees line 2.** The member-name gate runs at member sites only, so a plain continuation can invent a member mid-ghost and nothing checks it. Rust has injection with no gate at all.
- **The second call in a chain generates blind.** Injection keys on the first dot of a statement, so in `results.iter().map(|r| r.` the closure receiver's members are never injected.
- **Widening a language turns comment protection off** if the comment table has never met it. The channel says so once.
- **Whole-block injection needs a concrete type in the signature.** Real code often reaches its types through an alias, an interface or dependency injection, and those sites get nothing.
- **No rival-provider detection.** Continue or Copilot silently wins the ghost slot, and it reads as breakage.

**Generation and repair**

- **CRLF quirks.** Generated bodies are LF; splicing into a CRLF document produces mixed line endings, and a CRLF-formatted reply can duplicate the doc comment on splice.
- **Fence-bearing context blocks** go into bare triple-backtick fences unescaped and can mangle the prompt.
- **Go repair rides the Rust classifier**, which never fires on `go build` diagnostics, so Go gets check-and-surface plus generic repair but no compiler-directed surface injection.
- **Workspace-member gap.** A standalone crate nested under an unrelated ancestor manifest (fixture crates, `examples/` layouts) can lose repair entirely.
- **fn-gen quits repair early.** A generation-sourced failure gets exactly one self-repair round. If that round shrinks the errors without clearing them, the loop stops anyway.
- **Rust oracle blind spot.** `cargo check` runs without `--all-targets`, so code under `#[cfg(test)]` is outside its sight. Only the accepted document is saved before a check; other dirty buffers are checked as they sit on disk.
- **No context persistence.** Blocks die with the window, deliberately.
- **Cancelling a Claude Code generation leaves orphans.** Escape kills the `claude` process, not its process group, so any tool subprocess it already spawned runs to completion. A process-group kill is not portable to Windows, so this ships as a known gap rather than a half-fix. Nothing has been observed writing into the CLI's working directory, which is checked and empty after every round measured so far.
- **A block whose file changed while its document was closed is lost, not re-found.** The extension re-checks the recorded lines when it next reads them and gives up if they no longer match. There is no content search anywhere, in either direction, so a block that drifted while nobody was watching is never hunted for. Renames are the exception that is handled: a block follows its file. Deletes lose it, and so does saving an untitled buffer.

**Tests**

- **Refusal rates are high on real code**, and that is the design. See [when it refuses](#when-it-refuses).
- **Nothing measures what the ratified tests miss.** No coverage, no mutation testing. A green suite can be hollow.
- **A failing test does not drive repair.** The strongest oracle in the product is report-only, on purpose, until the blame-assignment design lands.
- **Rust test filters are substring, not exact**, so `tests::add` also runs `tests::add_more`.

**Editor**

- **VS Code 1.124 kills the scoped-ghost gesture in C# and TypeScript.** The provider is never invoked, so nothing is logged and it looks like you never arrowed. Pin your editor version before believing any gesture behaviour.
- **Vim keymap users have no second Escape.** Theirs leaves insert mode.
- **Language-gated commands still appear in every editor's context menu**, so a click in an unsupported file ends in a refusal toast.
