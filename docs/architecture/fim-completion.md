# FIM completion

Serves product invariant 1 in [ARCHITECTURE.md](../../ARCHITECTURE.md): warm TTFT under 200ms at 2-4K context. Everything in this subsystem exists to hit that bar without wasting model calls.

Files: `src/core/completionService.ts` (pipeline), `src/core/cache.ts`, `src/core/postprocess.ts`, `src/core/ollama.ts` (FIM leg), `src/core/config.ts` (defaults). The editor adapter is `src/vscode/completionProvider.ts`, covered in [vscode-layer](vscode-layer.md).

## Pipeline

`CompletionService.complete`, in order: truncate to the config windows (prefix keeps its last `prefixChars`, suffix its first `suffixChars`; defaults 3000/1000), cache lookup, debounce, single-flight gate, model call, postprocess, cache fill.

Order matters in two places:

- **Cache before debounce.** Typing through a suggestion must not stutter, so a hit resolves immediately.
- **Newest call wins everywhere.** A new call supersedes a pending debounce wait (the older call resolves `undefined`, never reaching the model). A new call with a different key aborts the in-flight request. A call with the same key joins the in-flight request instead: one model call, shared result, but the joiner's own abort signal cancels the joiner alone.

Failures degrade to `undefined`, no suggestion. A keystroke does not need an error dialog; the reason lands on the `[fim]` channel. This is the deliberate opposite of fn-gen, which rejects with the reason because a human asked explicitly.

## Ollama FIM leg

One POST to `/api/generate` with the `suffix` param. Passing `suffix` makes ollama apply the model's native FIM template; the client never builds `<|fim_prefix|>`-style prompts and there is no template module. Streaming is newline-delimited JSON; TTFT is measured at the first non-empty chunk, which is what makes the latency invariant testable per request. `keep_alive` is 1800 seconds so the model stays resident.

## Cache

LRU keyed on the `(prefix, suffix)` pair, with two non-obvious properties:

- **Windowed keys.** The prefix component of every key keeps only its last `prefixChars` characters, and the service hands the cache a flat copy of at most `prefixChars + 50` characters. Entry memory and lookup cost are bounded by the config windows, never by document size (V8 slices are views that would otherwise root the whole document string; `completionService.ts` unroots them).
- **Prefix walk.** If the user has typed the first N characters of a cached suggestion (N up to 50, Tabby's forwarding window), the lookup finds the entry stored at the earlier cursor position and returns the remainder. Each keystroke that matches the suggestion re-hits the cache with no model call. The walk recomputes each candidate's window, which is what keeps hits alive across the window shift a keystroke causes.

Trade accepted: cache identity is the model's input window, so documents that agree on the whole window share entries.

## Postprocess

Raw infill goes through a fixed filter pipeline; every filter is pure and idempotent, and an empty result means no ghost text shown. Order: stop-token trim, injection-echo strip, the plain-continuation bound (or the single-line cap where the bound does not apply), repetitive-block removal, indentation-scope limit, enclosing-block limit, the bound's seal, duplicated-head drop, duplicate-suffix-line drop, trailing-whitespace cleanup, and a retract-only re-seal.

The seal sits between the reshaping filters and the suffix ones because the two halves want different things. Above it, a filter that shortens the text at a line boundary can leave the dangling tail the safety rule exists to refuse, so the seal retracts and re-balances. Below it, the suffix filters are the only ones that know which closers the buffer already owns; rule 6 cannot see a suffix, so re-balancing after them puts a dropped `}` straight back as a duplicate that lands in the buffer on accept. The retract still runs, because a line-boundary cut can still dangle.

The filters with teeth:

- **Suffix dedup** never re-types code already below the cursor, with bracket-balance awareness: closers the completion itself opened are kept, closer-runs that only match pre-cursor opens are stripped (the auto-closed-characters case, which must not double on accept).
- **Scope limit** cuts a multi-line completion before it escapes the block the cursor is in, keeping at most one closing line. The anchor falls back to the nearest non-blank line above when the cursor line is blank.
- **Duplicated-head drop** fuzzy-matches the completion's first lines against the suffix and drops the whole completion on a match; whatever follows a re-typed head is unanchored.
- **Repetitive-block removal** truncates the degenerate run-on mode of small FIM models.

Provenance: the filter set is ported from TabbyML/tabby's golden-tested postprocess and the bracket-matching idea from continuedev/continue; debounce semantics follow Continue's `AutocompleteDebouncer`. Lifted files keep their attribution headers. Port, don't invent, was the rule; the donors had this solved.

## Where FIM runs

FIM runs on code, and only on code. `src/core/fimLanguages.ts` is the registry and the provider consults it first, before the comment scan, the debounce, the cache and any model call. An unserved keystroke costs the configuration read the enabled gate already paid, one set lookup, and one channel line per session per (language, setting) pair. The cross-file eviction hook in `extension.ts` asks the same question through `canMintEntries`, and it has to: a `file:`-scheme markdown buffer passes the scheme allowlist, and without the language half a paragraph of prose wipes every other file's caches per keystroke, which is precisely the defect that allowlist was written against.

The default set is exactly the languages carrying a registered oracle or extractor - rust, csharp, python, go and the TypeScript family - because that list is already the product's own definition of "we understand this". `column80.fimLanguages` widens it and can never narrow it, for the human writing C++ or Java, which the product has no oracle or extractor for and which therefore go dark by default. This is a deliberate cost, not an oversight: plain FIM works in those languages.

It keys on `languageId`, never the file extension. Every other registry here does (`oracleFor`, `extractorFor`, `memberSiteFor`, `commentSyntaxFor`), and it is the right answer for a buffer the human has retyped: a scratch file set to Rust is Rust, and a `.txt` full of Python is prose until they say otherwise.

The comment table (`commentSyntaxFor`) is not this list and must not be read as one. It answers how a comment is spelled where FIM runs, and its rows are deliberately wide.

The two halves of the rule come apart in exactly one state, and it is on the record rather than quietly true. Every default-served language has a comment row, so the in-comment refusal always runs there. A language a human widens to that has NO row (zig, f#, ocaml, and the rest the table has never met) gets FIM with the comment rules dark, because `commentSyntaxFor` returning `undefined` is what makes them not run. Serving anyway is the choice: the human named that language explicitly, and refusing their override because a courtesy table lacks a row would be the tool managing them. The channel says what it costs, once per language, and the setting's own description and the manual say it too.

Evidence: `[fim] no ghost: languageId=<id> is not code Column 80 understands; add it to column80.fimLanguages to serve it anyway`, once per language rather than once per keystroke, because a human writing a paragraph of markdown would otherwise get a line per character. It prints ahead of the per-invocation `[fim] invoked` line and replaces it, which is the one place that line's "first, before anything can return" rule is broken, and for the same reason.

## The plain-continuation bound

Plain FIM continues what the human is typing; it never authors a body. Measured on 850 real sites across the five shipped languages, 83% of plain ghosts are multi-line and of the 7,397 lines served past line 1, 208 are right and 7,189 are wrong. `src/core/fimBound.ts` is the bound: one content line by default, extended to the end of an unterminated statement or of a construct the first line opens, capped at four content lines, never cut at a dangling tail, and re-balanced with the closers the served text left open.

A trailing block opener ends the statement, and the ghost keeps it open. At a declaration head the model's first content line is the rest of the signature, ending in an unclosed `{`; while that brace is open nothing can terminate the statement, so the extension used to run to the four-line cap and the balance step then closed the body it had just opened. Live over 750 sites that was 145 of 152 cap-rule sites and 166 ghosts of two or more lines ending in a `}` the bound appended, which is a whole function, small. Serving the signature alone takes those to 6, takes the cap population to 31, and takes pooled p90 from 231ms to 186ms. It is the one place a served ghost may end on an unclosed opener, and only there: one content line, only `{`, and never in Python, where `{` is a dict literal. A trailing `(` stays unsafe because `compute(` balanced to `compute()` changes what the code means.

The bound applies to every plain site in every language FIM serves, which since v29 is code only (see [Where FIM runs](#where-fim-runs)); prose no longer reaches it. The safe-tail rule still has two halves and only one of them travels, because the widening setting can point FIM at a language with no row in the construct and terminator tables. The structural half - an open literal, an opener the served text itself left unclosed, a closer that would land inside a comment - holds anywhere. The DANGLING classes are a statement grammar, measured on the five shipped languages and no other. A widened language therefore keeps the structural half, skips the grammar, and serves one content line.

The paragraph this replaces argued the opposite about prose, and was measured rather than guessed: applied to markdown the dangling classes refused 28 of 28 sites over this repo's own ARCHITECTURE.md, because in prose `.` `,` `:` `?` are how a sentence ends. What it got wrong was the conclusion. Refusing 28 of 28 is a model call per keystroke spent to serve nothing, and it read as a bound working well in prose rather than as prose having no business in this pipeline. The v29 gate is upstream of all of it.

Three seams carry it, and each is where a naive version breaks.

- **The stream, not `options.stop`.** `stopWhen` on `FimGenerateParams` ends the READ on the accumulated text and releases the connection, so ollama stops generating: p50 300ms to 141ms, p90 716ms to 173ms, 26% of plain requests under the 200ms bar to 99%. A stop list cannot express "the first line with content" (100 of 100 generations at `fn f() {|` begin with a newline), and ollama REPLACES the model's own Modelfile stops with a user list rather than merging, which would disarm qwen's FIM specials.
- **The exemption is decided from the request, before the model call.** `bounded = !memberSite && !(wholeBlockSite && resolveInjection)`. Keying it on the injection having RESOLVED would clamp every whole-block site whose resolver misses the 50ms race, deleting the multi-line behaviour v22 measured at 8/8 method recall whenever the language server is cold. The second half is equally load-bearing: a site that can never inject keeps no licence to author.
- **The seal runs after the reshaping filters.** The scope limit and the repetition filter both shorten at a line boundary, and a shortening into a dangling tail undoes the safety rule. `sealCut` retracts and re-balances, idempotently. Past the suffix filters only `retractToSafeCut` runs; see Postprocess above for why the balance step stops there.

`src/core/brackets.ts` holds the one bracket scan, the one literal scanner and the one line-comment test in the codebase, and `postprocess`, `fimBound`, `fimComment` and `scaffold` all import from it. The scan skips per language: string and char literals, line comments, Rust's `'` only where the text has char-literal shape, and - only for a caller that asks for it - block comments. Block-comment state is off by default because the three FIM callers are pinned byte-for-byte by the contract set; the scaffold harvest asks for it, because `/* step 1 { */` is a comment and counting its brace would make every later comment read as nested. A `//` whose preceding character is `/` or `\` is not a comment opener: `/\/\//` is a regex literal containing a literal `//`, and reading it as a comment made `cursorInComment` answer true for `s.split(/\/\//)` - the provider going dark on real code with no model call, which is the one cost the comment rules exist to control - and made the comment cut truncate the regex mid-literal. It is the cheap half of the regex-vs-division test, and `///` is unaffected because its opener is at the first slash. Comment awareness is not cosmetic. An apostrophe in `// it's` opened a literal that swallowed the rest of the scan, and a whole-file oracle over the corpora had 97 of 290 TypeScript files scanning unbalanced for that alone; an unbalanced scan makes the statement look permanently open, so the extension runs to the cap, which is where the p90 latency miss lives.

A cache hit is served without the bound, deliberately: every entry was bounded or exempt at the position that minted it. The prefix walk can serve the remainder of an exempt whole-block ghost at a position that is no longer a whole-block site, which is the ghost the user is already typing through; re-clamping it per keystroke would break typing-through at exactly the site the exemption protects.

Evidence, on the one instrument the product has: a bounded serve extends the `[fim] ttft=` line with `bound=<rule> kept=<n> dropped=<n> appended=<n>`, plus `stopped=true` when the bound cut the read rather than the model finishing. A refusal takes the shared `[fim] dropped:` shape, and an exempt site says so, so a multi-line ghost there reads as the exemption working rather than the bound failing.

## The comment rules

Two rules over one per-language table in `src/core/fimComment.ts`, and neither reuses the two tables that already exist. `maskSpans` hardcodes `#` as a comment opener in every language, so under it the cut would eat a Rust `#[derive]`, a C# `#region` and a TypeScript private `#field`. `lineCommentFor` is `languageId === "python" ? "#" : "//"`, so under it the rules would be silently dead for Ruby, shell, YAML, Perl, R, Elixir, PowerShell, TOML, Lua, SQL, Haskell and Clojure. The table has rows for all of those, which since v29 is a courtesy to whatever a human puts in `column80.fimLanguages` rather than a description of where FIM runs; an unmapped languageId returns `undefined`, the rules do not run, and the provider says so once per session on the channel. Lua's `--[[ ]]` and Ruby's `=begin` are a known, bounded gap.

**The ghost never introduces a comment.** A comment-led content line cuts the ghost before that line, which at the first one means serving nothing; a trailing comment cuts the opener and everything after it and keeps the code. A block opener counts exactly as a line opener does, and Python's `"""` opening a content line is prose by the same argument (16 of 30 Python empty-body ghosts open with one). Both cuts `trimEnd`. It runs at exactly the sites the bound governs, and applies after the bound and before a second `sealCut`: a trailing cut can leave the dangling tail the safety rule exists to refuse (`foo(a, // note` becomes `foo(a,`). The two exempt sites are exempt for their own reasons. A whole-block site is licensed to write a body, a real body carries comments, and a led cut there is a truncation that deletes every line below it. A member site already has the opposite answer pinned: a `/*x*/`-led scoped ghost is repaired to spell the member once and served, and cutting first would turn `. /*c*/ enrollTile(t);` into a bare `.` the landed-name guard then blesses. The measured population is the plain one anyway: 189 of 749 ghosts introduce a comment and 174 of those sit past line 1, so the bound removes 92% and this is the surviving 5 comment-led lines and 10 trailing comments, most of them Python.

**Inside a comment there is no ghost.** Argued on identity, not on the measurement: a doc comment is the developer's spec, and a model writing the spec is the one thing the manifesto forbids. It runs in the provider before the service is asked, so going dark costs no model call and no resolver query. The cost to control is false positives, because going dark on real code is worse than every ghost this removes: the scan reads at most the last 4000 characters and starts at a real line start (`maskSpans` allocates a document-sized array and this runs per keystroke), a line comment is decided on the cursor's own line alone, and a block comment or docstring opened above the window answers `inComment: false` with `windowExhausted: true`. A language with neither a block nor a doc row can never be ambiguous from truncation and never reports exhaustion. Evidence: `[fim] no ghost: the cursor is inside a <kind> comment`, once per comment LINE rather than once per keystroke, because writing a comment moves the column on every character.

## The length floor and the suppression ledger

**A ghost too short to be worth a review is not shown.** JetBrains' full-line completion drops single-token suggestions and asks for eight symbols with two or more alphanumerics; there was no floor here at all, and this product pays the review cost harder than they do because it has no confidence score to fall back on. `column80.minGhostChars` (8) and `column80.minGhostAlnum` (2) carry their numbers, as settings rather than constants because the numbers have to be arguable. `minGhostChars: 0` disables the floor outright.

**A ghost that ends on a block opener is exempt.** The bound makes a declaration head serve the rest of the signature and stop, so the ghost at those sites is `) {`, `Self {`, `self):` - short, punctuation-heavy, and exactly the shape the floor was built to refuse. The two rules were measured apart and compose badly: over the 750 real sites of the verify run that has the declaration bound in it, the bare floor refuses 17 of 710 served ghosts (2.4%) and nine of the seventeen are byte-identical to the line the developer went on to write (seven Go `) {`, a Rust `Self {`, a Python `self):`). The exemption is safe to make language-blind because the floor only runs at bounded sites, and rule 5 lets a `{` or `:` tail stand only where it IS a block opener.

With the exemption: 7 of 710 (1.0%), which lands on JetBrains' published figure of about 1% of valuable suggestions lost, and 0 of the 7 matched what the developer went on to write. The whole refused population is `vec![];`, `e.code;`, `Get()`, `Get()`, `);`, `false`, `+ 9 * 4`. The `);` case is the one that will look wrong in dogfood: it is a genuine statement finisher, and it appeared once, wrong.

The floor is judged on the SERVED text after every other filter, so what it measures is what the human would have seen, and it runs at exactly the sites the bound governs. Not at member sites: a member ghost is usually a short identifier (`len`, `iter`, `Count`) and is already policed by the member-name gate, which refuses on resolved evidence rather than on length. The floor is a substitute for a confidence score at sites that have no other evidence, and member sites have other evidence.

Not on a candidate the comment cut already trimmed, either. `n = 1  # the counter starts at one` is 34 characters and clears the floor; the cut leaves `n = 1` at five and the floor then refuses it, so two rules that suppress nothing on their own compose into a full suppression and two ledger counts for one model failure. The cut has already made a judgement about that ghost.

And not on a cache hit. A walked remainder is the tail of a ghost the human is typing through and has already read, so the floor's "a short ghost costs a full review" does not apply - the review happened at the position that minted it. A walked hit therefore serves a one-character `;` by design, and the consequence is that the floor's fire rate in a live session is unmeasured: the cost harness measures generations, not walks.

**Every suppression carries a session count.** `src/core/suppressionLedger.ts` counts four kinds: `bound-unsafe`, `comment-introduced`, `in-comment`, `below-floor`. The count rides the suppression's own channel line, the way `session dark sites=N` already does, because a line per event answers "why did this keystroke do nothing" and a count answers "how often does this fire". One keystroke is one event however many candidates a fan-out refused; the in-comment count moves per suppressed keystroke while its line still prints once per comment line.

`dropped:` has one meaning across the whole class: the human got nothing. Two lines on this path cannot know that when they fire, because the extras launch before the primary is awaited and a request whose primary was refused can promote an alternate and serve, so both are held until the served text is known. A safety refusal the request served past prints `refused:` and is not counted, because a candidate the human was never going to see lost them nothing. A comment cut whose ghost survived prints `trimmed:` and IS counted, because it changed what the human got. Before this, one keystroke that served four trimmed candidates wrote four `dropped:` lines and four counts for nothing lost, which inflated the denominator of the comment cut's published cost rate.

The ledger is handed to the service by `extension.ts` rather than owned by it: the service is rebuilt on every settings change, so an instance-owned count would zero itself at the moment a human is reading it, and the provider's in-comment suppression never reaches the service at all. A service constructed with no ledger counts its own events, which is what a headless caller means by a session.

A count is not a price. What each suppression costs in valuable suggestions is a measurement against the corpus; this makes it computable and nothing more.

## Candidate injection

The v2 upgrade, and the one part of this subsystem that changes the model's input rather than its output. At a `.`/`::` member site the small base model invents a member it cannot see the receiver for (at `BloomFilter::` with no constructor in view it emits `new`, which fastbloom does not have). rust-analyzer knows the real set at exactly those positions, so inject it. Part of the [surface-injection](surface-injection.md) subsystem; the pieces specific to the latency path live here.

`src/core/fimInject.ts`, three pure functions:

- **`fimMemberSite`** is the trigger gate. Inject only right after `.`/`::` at the end of the prefix; a fresh, unanchored position is never injected into (rust-analyzer would return a 100-plus candidate firehose there, and fresh positions rarely hallucinate a specific library call). It skips the false triggers a naive regex would catch: a `.` inside a line or doc comment, a float literal (`1.`), a range or struct-update (`..`).
- **`renderFimCandidates`** narrows to the already-typed partial, drops signature-less and universal-trait noise, and caps the set (over 40 candidates is a mis-fire resolving a wide scope, so skip rather than inject a wall). Signatures, not bare names: the return type is the load-bearing signal, and bare names the model just ignores.
- **`injectBeforeCursorLine`** places the block on its own lines above the cursor's line with matched indentation, so the model still sees `foo.` immediately before the cursor with the candidate list just above.

The request carries an optional `resolveInjection` closure resolved ONCE after the debounce on the surviving keystroke, so one rust-analyzer query fires per generation, never per pre-debounce keystroke. The cache key stays the plain cursor context, so injection is a transparent generation-time enhancement.

The latency discipline is the reason this lives next to invariant 1. The query sits before the model on the TTFT path, so it is raced against a 50ms deadline: a cold or big-workspace language server loses the race and the path falls back to plain FIM rather than blow the 200ms bar. The injection wait is folded into the reported `ttft`/`total` so the latency numbers stay honest. And a completion that DEGRADED at an injectable site (a cold server produced no candidates) is not cached, or the un-injected guess would be served forever once the server warms.

Member-site detection is registry-dispatched (`memberSiteFor`): the shared C-family detector serves Rust/TS/C# (`.` and `::`), and Python has its own that treats `::` as non-member (it is slice syntax there, `arr[1::2]`) and darkens `#` comment lines.

## Usage examples at a member site

The v29 addition, and the one part of injection that describes the REPO rather than a type. Under
the member signature block, at a site whose name the buffer already spells, the block carries real
call sites of that member: `src/core/usageSurface.ts` resolves them, `src/core/usageWindows.ts`
cuts and renders them.

Measured before it was built (`session-v29/measure-p3.md`), 40 real member sites in acme-db,
scored by rust-analyzer's own diagnostics on the served line: signatures alone leave 8 of 40
continuations type-wrong, signatures plus usage leave 3. The failures it removes are arity and
operand type (`expected 1 argument, found 2`, `expected 4 arguments, found 0`), which is the v22
finding reproducing at a site v22 never measured. v22 tested examples at a site where the model
still had to CHOOSE the member and lost on retrieval; here the member is already chosen, by the
human, and the only thing left is call shape, which is exactly what v22 measured examples lifting.

It is not free, and the cost has one shape: a window from another call site brings that site's
locals with it and the model sometimes reaches for them (`aggregate_client_load_status` took
`&client_key` from a window where the truth was `&mut cache, &client_key`). Three sites lost
against eight won.

Three constraints, and each is where a naive version breaks.

- **The document has to spell the member.** A reference query needs the symbol in the file. At the
  arrowed-with-a-partial state the member name lives in the widget and in the rewritten prompt and
  nowhere in the buffer, and putting it there to ask a question would be a third document write.
  So the leg fires where the human has typed the name, which is the population the arms measured;
  the arrowed state would need a hover-then-declaration-then-references hop that no 50ms budget
  can hold.
- **It runs after the member surface, against what is left of the window.** A references call is
  not a bounded cost: over 60 distinct symbols on a warm rust-analyzer, acme-db gives p50 1ms,
  p90 12ms, p95 1.4s and a 7.9s worst case, because the server memoizes per symbol and a FIM
  session asks a new question every keystroke. Repeating one query on an unchanged buffer answers
  in 1ms and is not the product's question. A leg that loses this race costs the signature block
  nothing, which is `resolveArgTypesInBudget`'s pattern and its reason.
- **In C# it will effectively never fire.** Roslyn has a fixed 500ms floor per references call,
  warm, regardless of hit count, and no request parameter shortens it. The honest outcome there is
  the control arm, which is what a lost race already produces.

Placement is below the signatures, nearest the cursor, and that was measured rather than reasoned:
above and below split 4 to 3 on type-wrong continuations and 33 to 31 on call shape, both inside a
one-site noise floor, so the tie went to the placement that also opened the call at 40 of 40
against 39.

Evidence, either way, because a block the human can see in the prompt dump but not on the channel
is a block they cannot audit: `[fim] usage injected for <member>: windows=N of M references, ms=`,
or `[fim] usage dark for <member>: <reason>`. The reasons are all four honest ones - no reference
leg for this language, no window left, no other call site in the workspace, and every call site
being the cursor's own line. Kill switch: `column80.fimUsageExamples`.

## The member-name output gate

Where the language server's completion list at a `.` site is the COMPLETE legal member set - TS (members only), C# (Roslyn's full set, keyword/snippet kinds dropped), Python (pyright's full set, dunders dropped) - a resolved non-empty list also gates the OUTPUT: a ghost whose completed identifier prefixes no resolved member name is an invention and is dropped before preview, with an alternate promoted when one exists. The gate is positive-evidence only: an empty list never gates, because empty conflates untyped receivers and index-signature types, and suppressing on absence of evidence was a measured footgun. Rust stays ungated - rust-analyzer serves keyword/postfix completions (`.await`) by design, so its list is structurally incomplete and gating on it suppressed real accepts. Python additionally logs a dark-site evidence line once per distinct site whose receiver resolved zero members, the measurement basis for the honest-dark ledger.

The gate asks two questions of the same evidence. **Names**: every member the ghost accesses on the cursor's receiver must be a resolved one - the leading identifier, and every later `receiver.NAME` in the ghost once the provider threads the receiver name through the request. A reference with more ghost after it is a finished name and must match exactly; one running to the end may still be growing, so it may prefix-match. **Arity**: every call the ghost writes must have an argument count some same-named signature accepts. Names alone passed code that does not compile - measured 8/8 correct names against 8/8 wrong constructor arity - because a parameter type is never a receiver and its constructor was never in view. That measurement is why the leg exists; it is not what the shipped leg catches. Argument counting is depth-aware, so commas inside nested calls, generic arguments, brackets, strings and lambdas do not separate arguments. Both legs refuse only what they can prove wrong: an unknown callee, an unclosed argument list, an unparseable signature and an empty signature set are all no opinion, because over-refusal costs a real accept. Two more no-opinion cases are worth naming because they cost real rejections. A comma inside `<>` reads identically in `Map<string, number>` and in the comparison pair `i<n, j>k`, so any call whose arguments hold one is not counted at all. And a signature carrying a collapsed-overload marker suppresses that NAME, because the marker says the accepting signature was folded into text upstream; whether a real TypeScript completion `detail` carries that marker has not been captured, so this case may be dormant in the product.

A call is judged only when its qualifier NAMES the cursor receiver. `receiver.` and `receiver?.` are both ours; another name, and an expression qualifier like `build().` or `items[0].`, all skip, because no other receiver's members were ever resolved. The consequence to know: in a chained ghost like `tiles.filter(...).splice(0)` every call after the leading identifier is skipped. Kill switch: `column80.fimMemberGate` (default on) governs both legs.

Two caveats on reach, and they are large enough that the leg should not be read as general arity checking.

The arity leg fires only where a rendered signature parses. `SIGNATURE_HEAD` wants the callee name with `(` straight after, which is the TypeScript render. C# renders the return type first (`string Greeter.Greet(string name)`) and Python leads with `def`, so both answer no opinion and the leg is silent there. Widening it is not a parser change alone: the C# transport strips the `(+N overloads)` suffix below the markdown fence, so a C# that parsed would gate overloads with the overload evidence already gone. Restore that evidence first.

The constructor case that motivated the leg is not caught in the product. An argument type's members arrive through a documentSymbol descent carrying no signature, so there is no arity to check against. The headless TypeScript transport does resolve signatures, which is why the tests and the scout see the win. The headless C# and Python transports resolve signatures too, but ones the gate's head still cannot parse, so what those transports demonstrate is the injection win, not the gate.

A member site also generates single-line by construction (`MEMBER_SITE_MAX_TOKENS`, multiline forced off, and exempt from the bound so there is only ever one bound in that pipeline), so postprocess collapses the completion before the gate reads it. The multi-reference name check therefore fires on a second reference on the SAME line, and stands as the backstop if that cap is ever relaxed. What the gate wins in production today is that same-line name check plus the TypeScript arity leg.

## Whole-block injection

At a whole-block site (cursor in an empty function body over resolvable types; detection is per-language via `wholeBlockSiteFor` - Rust/TS/C# are brace-shaped, Python is indentation-shaped) the injection upgrades from the receiver's members to the types-in-play struct graph: `src/core/fimWholeBlock.ts` renders the bounded cross-file data-shape walk as a comment block above the cursor so a whole-body completion uses real field and method names. Rides the same 50ms race plus a per-file-version cache, so a slow resolve degrades to plain FIM and never blocks a keystroke.

## Enum-RHS injection

The third site kind, and the smallest surface in the product. At `t.Band == ` the prefix ends in an equality operator whose left side is a member access, so what the human types next is a VALUE of that member's type; detection is per-language via `enumRhsSiteFor` (C# only today, where all three captures are), dark inside comments and strings, and a regex over the cursor's line so the keystroke path pays nothing until it fires. A member site wins wherever both could look plausible: at `t.Band == LodBand.` the human is completing a member and the member leg already answers.

Resolution is a ladder, each rung degrading to dark rather than guessing: hover the member token for its declared type (`memberTypeNameFor`, the leg's other half), anchor that type by reference-then-name, take its shape through `resolveCrossFileShape` bounded to the ONE type, and render the variants only where the hover says `enum`. The block is the variant list as comments under a header naming the type, so the model writes `LodBand.Regional` instead of the `Band.Regional` a captured 1.5b invented. Same 50ms race and same cache as whole-block, keyed on the site rather than the file because two members of one file have different answers.

Policed by ONE rule, and the member-name gate is not it. That gate is receiver-shaped and the ghost here writes a value, not a member on a receiver, so it stays dark at this site.

The rule that does run is the enum-RHS **value gate** (`CompletionService`, beside the member gate so it reaches the served text and the alternates the same way): a ghost whose first value token opens a **string literal** is refused. Armed by the LANDED block, not by the site - the site fires at every `x.Y == ` and 112 of 143 real fires are not enums, where `t.Owner == "acme"` is ordinary C#; the block renders only where the definition hovered as `enum`, so an injected block at this site IS the evidence that the left side is enum-typed. Every C# spelling of a literal is covered (`"x"`, `@"x"`, `$"x"`, `$@"`/`@$"`, `"""x"""`, `$$"""x"""`), because each is a run of `$`/`@` then a quote and nothing else in the language is - `@class` is a verbatim identifier and stays served.

It judges nothing else, deliberately. It does NOT require the ghost to name a disclosed variant: the human may compare against a local, a call, a cast, a parenthesised expression, another member access, `null` for a nullable enum, or the literal `0`, and all of those are served. A C# enum can never equal a string, so the refusal has no false-positive surface; a wider bar would suppress code a human writes. Measured at the `t.Band == ` (trailing-space) state, 5 samples: the model wrote `"LodBand.Regional"` 5/5 with the block in view against 0/5 served by the control, so the leg was turning "nothing" into "something wrong" one keystroke past the captured site. The evidence line names the reason (`[fim] dropped: ghost opens a string literal at an enum-RHS site...`) and the resolver's own line says `string-value gate only`, so a wrong ghost is not read as a gate failing and a refused one is not read as a mystery.

## Cross-file staleness eviction

Both caches (completion and whole-block) tag entries with their document URI. Any edit evicts every entry minted for a DIFFERENT file, so renaming a member in one file cannot leave another file's cache offering the old name; same-file entries persist (version keys and the prefix walk already handle same-file staleness, keeping typing-through warm). Non-document schemes (SCM commit box, comment widgets) are allowlisted out: they neither wipe caches nor feed the model.

## Decisions

**ADR: windowed cache keys over full-document keys.**
Context: the first cut keyed the cache on untruncated document text, which made 100 entries from a 2MB document retain ~200MB and pushed miss-path lookups toward ~13ms.
Decision: window every key's prefix to `prefixChars` and hand the cache a bounded flat copy; the prefix walk recomputes candidate windows so walk hits survive.
Consequence: memory ~2.5MB and ~0.4ms lookups for the same scenario, at the cost of window-level rather than document-level cache identity. The walk margin (50 chars) bounds how far a user can type through a suggestion and still hit.

## Measured records

The runs behind the bounds, the filters and the withdrawn gate legs on this path. They were
recorded in session folders, which a clone does not have.

### The plain-continuation bound: what it costs to stop early

Two populations were driven, both chosen because "one line" is most likely to be wrong there:
chained statements (LINQ, iterator chains, promise chains) and short block constructs (`match`,
`switch`, `if err != nil`, `try`). Four bounds were scored off the SAME generation so no arm got a
luckier draw: `today` (the multiline pipeline), `line`, `stmt` (line, extended while the statement
is unterminated, cap 8) and `block` (line, extended until braces balance or the Python indent
returns, cap 12). Latency per bound came from the newline arrival times of that same stream, so
"what would it have cost to stop there" is a real number rather than a model.

What the corpus looked like first: 83% of plain ghosts are multi-line, median 4 to 14 lines by
language, p90 17 to 32, with Python worst at a median of 24 lines at a `def |` head, so indent
scoping does not save it. Of 7,397 lines served past line 1, 208 are right and 7,189 are wrong.

The three-arm precursor tied in every one of 15 cells: extra lines never rescue a wrong first line,
and bounding never breaks a right one.

The bound run proper: on chained statements a statement bound has the same precision as a line
bound with 2.75x the correct lines. On `match`, `switch` and `if err != nil` a construct bound
keeps every correct line today produces at half the length.

Latency is the other half and it is the larger one. Only 26% of plain requests land under the 200ms
bar today (p50 300ms, p90 716ms). Bounded, 99% do (p50 141ms, p90 173ms). At a block-opening line
end, 100 of 100 generations begin with a newline, so `stop:["\n"]` serves nothing every time;
aborting the read keeps 97 of 100 served at identical correctness at 2 to 3.5x the speed.

`MAX_BOUND_LINES = 4` is backed by the whole-construct rate: seven of the eight whole constructs
the model gets right are 2 to 4 lines, and past four the whole-construct rate is 1 in 73.

The construct-opener table must not be widened without re-measuring: rust `match` / `if let` /
`while let`; go `if err != nil` / `switch` / `select`; csharp `switch` / `try`; ts and js `switch` /
`try`; python `match` / `try`. A trailing `,` is SAFE when there is an unclosed opener, otherwise
the trailing-separator and cap rules compose to suppress every `match` and `switch` longer than the
cap entirely.

### The own-binding suppression leg, and why it was withdrawn

The probe bundled `ghostRefsOwnBinding` and walked a real external-repo corpus. At every `.`
followed by an identifier character the prefix was the file text up to and including the dot,
windowed to `prefixChars`, and the ghost was the author's real remainder of the line. A firing
therefore means dropping code the author shipped. A positive control ran first so the probe could
not be a null: `let rehomedresult = tile.` with ghost `rehome(&rehomedresult);` fires, the same with
an outer `let rehomedresult` one line up does not (the shadowing carve-out is honoured), and
`let x = tile.` with ghost `area();` does not.

| language | sites | false suppressions | rate |
|---|---|---|---|
| Rust | 741,222 | 78 | 0.011% |
| C# | 254,814 | 117 | 0.046% |
| TypeScript | 449,726 | 23 | 0.005% |
| Python | 154,301 | 6 | 0.004% |
| total | 1,600,063 | 224 | 0.014% |

Against no true positive. The C# figure reproduced independently on a file set gathered by a
different walker (116 in 253,233 against 117 in 254,814, both 0.046%).

The firing shapes read by hand: C# is lambdas and switch arms wall to wall
(`conn => ConnectorId.From(conn.ConnectorId)`, `e => Log.Error(e, "...")`, roughly forty
near-identical `v => ...` sites in one repo alone), and every one compiles. Python is keyword
arguments (`dry_run = repo.clone(dry_run=True)`).

The window control is the part worth keeping. At one site with the declaration at char 1674 and the
use at char 5511 (distance 3,837), the leg fires at `prefixChars` 100, 300, 800, 1500 and 3000 and
does NOT fire at 20000. The answer flips on WINDOW SIZE alone with the file, prefix and ghost
identical, and the residual grows 8.7x as `prefixChars` moves down a range the user is allowed to
set.

Fixing forward was refused rather than deferred. Reading `=>` as a binding `=` and Python kwargs are
cheap fixes, but a binding the ghost itself introduces (`let x = xs.iter().find(|x| ...)`) is the
largest correct-code class in Rust and is unreachable by any backwards-looking textual scan. That is
a redesign, not a fix. The standing position behind the withdrawal: a wrong ghost costs one Tab not
pressed, a suppressed ghost costs the whole completion unconditionally.

### The empty-serve separator, and the burden of proof on dropping

At 47 real scoped member sites, all 4 empty serves had the exact correct separator as the raw
stream's first line, and `dropDuplicatedHead` deleted it. The class is empty serves, and it was 4 of
4 of them. The four captured shapes: `;` against `}` (a TypeScript getter, 3 of the 4), `,` against
`}`, and `)` against `}` (a Rust tuple close).

The predicate was re-ruled twice, which is why it reads the way it does. The first narrowing was
`}`-led only, and that REGRESSED the ratified capture itself: a lone `,` sits before a `)`-led
closer, a shape the measured corpus missed because the human wrote the function the same day. The
final predicate is a lone separator AND (the suffix line starts `}` with no `}` in the ghost, OR the
ghost is disjoint from the suffix's leading closer run).

**The standing ruling: a dedup filter drops duplication, not wrongness.** Any future drop in the
disjoint-lone-separator class requires a dogfood capture of a served disjoint lone separator doing
real harm at a real site. The burden lands on the drop side permanently, because that side was wrong
twice on modelled shapes.

The known cost of that ruling: near-identical trailing-separator RUNS are resurrected end to end
(ghost `);` with next line `)`, ghost `;` with next line `,`, ghost `),` with next line `))`). The
escape class is runs whose FINAL character differs from the suffix's first character, so no
downstream filter matches.

### Usage windows at a member site

The site is the shipped scoped-ghost path: the widget is open, the human has arrowed onto a member,
the prefix already ends with that member's name. The model's whole job from there is the CALL, which
is exactly the part an earlier examples spike lifted (arity 84% to 94-100%) and exactly the part of
that spike that was never about retrieval.

Three arms, because a position effect had already been measured at the fn-gen surface (the model
reaches for whatever sits nearest the code) and guessing which way it goes here costs more than
measuring it: `A` today's member signature block only, `B-above` plus usage windows above the
signature block, `B-below` plus usage windows below it, nearest the cursor. Ground truth is the
developer's own call, taken from the untruncated file, over a real Rust corpus with references from
a live rust-analyzer.

| arm | served | opens call | arity ok | shape ok | exact | in scope |
|---|---|---|---|---|---|---|
| A, signatures only | 39/40 | 37 | 34 | 30 | 19 | 34 |
| B-above | 40/40 | 39 | 37 | 33 | 21 | 33 |
| B-below | 40/40 | 40 | 38 | 31 | 21 | 33 |

The below placement is what ships. Window availability: 37 of 40 sites had 3 usage windows, 2 had 2,
1 had none.

One caveat on the record. The type-wrong figure quoted at the call sites (8 of 40 down to 3) came
from a scoring pass that ran rust-analyzer diagnostics over the served line, and that pass's output
no longer exists. The arm table above is the surviving raw run and is scored differently. Re-measure
before leaning on the 8-to-3 figure.

### The one-request downgrade flag

`downgradeNextManual` is a provider-global boolean with no identity and no expiry: it is set in the
expiry timer and consumed by whichever request arrives next, in any file, at any position, after any
delay.

Two directions were probed and the original goal priced the wrong one. It can go stale and mute a
genuine Ctrl+Space fan-out to a single suggestion, which happens when the expiry's own
`inlineSuggest.trigger` produces no request at all (focus in a terminal, an unregistered scheme,
inline suggestions off). Or an unrelated request eats it first, so the provider's own re-trigger
reaches the service `manual: true` and pays the debounce bypass plus the three alternative
generations the flag exists to avoid. The second is the more expensive one and it is the reachable
one.

Blast radius, stated plainly: nothing here produces a wrong ghost. The whole blast radius is one
request's suggestion count.

The prescribed fix is to give the flag identity (a uri, version and position, plus a short freshness
bound, matched and consumed, otherwise leave the user's trigger alone) AND to consume it before the
enabled gate. Only the second half is implemented. Reopen trigger: a dogfood session reporting a
Ctrl+Space that returned one suggestion for no reason.

Three separate findings converge on the same boolean, which is the argument for taking the fix
whole rather than in pieces. A configuration change disposes and rebuilds the service without
touching the provider's record or the context key, and nothing re-invokes an inline provider on a
config change, so the scoped-ghost context key stays true over a disabled extension and leaves the
flag armed indefinitely. `dropScope()` arms the flag synchronously while the consuming request only
arrives after `executeCommand` crosses the extension-host boundary, so typing one character right
after the second Escape eats the flag. That window existed on the timer path too; making the flag
keystroke-triggered raises the rate rather than creating the hole.
