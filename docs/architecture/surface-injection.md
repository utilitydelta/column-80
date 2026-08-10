# Surface injection (the compiler-directed loop)

Serves the v2 prompt-identity invariant in [ARCHITECTURE.md](../../ARCHITECTURE.md), and defends invariants 1 (FIM latency) and 4 (repair discipline) while doing it. This is the v2 thesis in one subsystem: local models hallucinate APIs, so resolve the real API from the user's own language server (rust-analyzer, the TS service, Roslyn, Pylance/pyright) and put it in front of the model, directed by what the compiler actually complains about.

Files: `src/core/extraction.ts` (the `SurfaceExtractor` interface + pure render/parse helpers), `src/vscode/raExtractor.ts` (`RaCommandExtractor`, the product transport over the user's rust-analyzer), `src/core/raLspClient.ts` (`RaLspExtractor`, the oracle transport that spawns its own headless RA), `src/core/tsExtraction.ts` / `src/vscode/tsExtractor.ts` / `src/core/tsLsExtractor.ts` (the TS trio: pure helpers, product transport over the user's TS server, headless test transport), `src/core/csExtraction.ts` / `src/vscode/csExtractor.ts` / `src/core/csLspExtractor.ts` (the C# trio over the Roslyn language server, same three roles), `src/core/pyExtraction.ts` / `src/vscode/pyExtractor.ts` / `src/core/pyLspExtractor.ts` (the Python trio over Pylance/pyright, same three roles), `src/core/compilerDirected.ts` (diagnostic classifiers + payload shape rule), `src/core/catalog.ts` (dependency catalog), `src/core/punt.ts` (stub detection), `src/core/fimInject.ts` (FIM candidate injection). Wiring: `src/vscode/extractors.ts` (the registry), `src/vscode/oracleSurface.ts` (the repair path), `src/vscode/fnGen.ts` (round-1 pre-fill), `src/vscode/completionProvider.ts` (the FIM path).

Everything here is gated on `column80.compilerDirectedInjection` (default on). Off, the extension is byte-for-byte v1: the extractor is never constructed, no query fires, the prompt is signature + doc + context blocks and nothing else. That gate is what keeps the frozen v1 oracles green.

## The extraction interface

One `SurfaceExtractor` interface, two transports, so the same decisions run in two worlds:

- **`RaCommandExtractor`** (product) reuses the user's already-running rust-analyzer through the vscode command API (`executeCompletionItemProvider`, `executeHoverProvider`, `executeCodeActionProvider`). It spawns no rival process. This is the shipped path.
- **`RaLspExtractor`** (oracle) spawns its own rust-analyzer over stdio LSP, so the live behavioral oracles run under plain `node --test` with no extension host.

The interface surface: `completeMembers` (a type's valid members at a cursor), `example` (a crate's worked doc example, via `completionItem/resolve`), `qualifyImport` (RA's "Qualify as" assist), `definition`, `hover`. The pure helpers that carry the findings (`renderMemberSignatures`, `parseHover`, `parseMemberLabel`, `toCompletionMember`) live in `src/core/extraction.ts` and are blind-tested headless.

**Transport-divergence hazard (the shipped path is NOT what the headless oracles run).** The two transports can return *different LSP shapes for the same query*, because they advertise different client capabilities, and only `RaLspExtractor` is exercised by `node --test`. So a bug that lives only in `RaCommandExtractor` passes every headless oracle and only surfaces in the real extension. The one that bit (and its class): `definition` returns a plain `Location` (whose `range` is the identifier) to the LSP transport, which advertises no definition `linkSupport`; but VS Code advertises full capabilities, so RA returns a `LocationLink` to the command transport, carrying `targetRange` (the *whole item* — for a doc-commented or attributed type this starts on the `///`/`#[…]` line) alongside `targetSelectionRange` (the identifier). The cross-file resolver (`src/core/crossFileShape.ts`) hovers at `definition().range.start` to read a struct's fields, so returning `targetRange` lands the hover on the doc comment, yields an empty hover, and drops *every* field (methods still resolve — they come from `documentSymbol`, not hover). `RaCommandExtractor.definition` therefore prefers `targetSelectionRange`; regression oracle `test/blind-v7-definition-selrange.test.cjs`. The rule this leaves behind: when a resolver/hover path works in the `.dump-v7-*` scripts or headless live tests but fails in the real editor, suspect a transport divergence (linkSupport, hover markdown shape, resolve caps, or config-dependent hover content) — pin the command mapping with a fake-runner adapter test (`blind6-command-adapter` pattern) *and* confirm against a live output-channel dump. Fields ride HOVER (config-dependent); methods ride `documentSymbol`.

## The reference leg (v29)

The seam's newest optional method, and the first one that answers a question about the REPO
rather than about a type: `references(cursor, query)` returns every place the workspace uses the
symbol at the cursor. It exists because both v29 usage experiments are specified on the reference
PROVIDER rather than text search, and the difference is not stylistic: a Rust and a Python symbol
named only in a sibling's doc comment return nothing here where a `grep` for the name hits, and an
alias, a re-export or a renamed import is seen through where a text search cannot.

The five headless transports implement it; the product transports do not, and that is deliberate
rather than unfinished. The measurements the leg was built for had to run before anything was
wired to a keystroke, because a leg whose arm loses does not ship.

`includeDeclaration` defaults to false: a declaration is not a usage, and the caller is asking how
the symbol is CALLED. Every leg degrades to `[]` on a dead, wedged or malformed answer, like every
other optional leg here. `maxResults` truncates after the reply, because the LSP request carries no
limit.

What a caller has to know before putting this on a latency path, measured live on the production
repos:

- **C# has a fixed floor around 500ms**, warm, and it is not size: 0 hits 1ms, 4 hits 503ms, 26
  hits 503ms, and a hover at the same cursor 1ms. That is Roslyn batching its streaming
  find-references flush, and no request parameter shortens it. A C# references call cannot sit
  synchronously inside the 200ms FIM bar.
- **Roslyn's answer is unstable until the whole solution loads**, and
  `workspace/projectInitializationComplete` is not that signal: the same production query returned
  3, 2 and 0 hits across runs. It also only searches `project/open`ed projects.
- **rust-analyzer needs `whenReady`** (32s cold on acme-db), and repeating a query against an
  unchanged buffer is answered in about 1ms. Asking after an EDIT is a different number: at real
  FIM sites, where every keystroke changes the buffer, the same repo measured p50 86ms and p95
  3.8s, tracking the reference count. See `session-v29/measure-p3.md`.
- **pyright** pays about 600ms on its first query and about 1ms after. **gopls** is module-scoped;
  the TypeScript transport is program-scoped, so a sibling monorepo app is invisible to it.

The leg does NOT retry on an empty answer, unlike `completeMembers`. `[]` is the truthful answer
for a first-use symbol, so a retry loop would spend a second per uncalled symbol to learn nothing.

`src/core/usageWindows.ts` is the other half: it cuts the locations into bounded, deduped,
dedented windows and renders them either as a comment block (the FIM shape) or a fenced labelled
section (the fn-gen shape). Every bound is a caller parameter with no default, because how many
windows and how long is a budget question with a measurable answer.

## The TypeScript extractor (v9 phase 3)

Same interface, second language, same two-transport pattern:

- **`TsCommandExtractor`** (product, `src/vscode/tsExtractor.ts`) reuses the user's running TS server through the same five vscode commands the Rust transport dispatches. The class imports no vscode at all; the runner/text-reader factories live in `src/vscode/extractors.ts`, so the whole transport bundles headless and the blind suite proves the mapping against a fake runner. It inherits the Rust transport's LocationLink lesson wholesale: `definition` prefers `targetSelectionRange`.
- **`TsLsExtractor`** (headless test, `src/core/tsLsExtractor.ts`) owns an in-process language service built from the PROJECT'S OWN `typescript` package, walk-up-resolved from the project root like `tsOracle` resolves its tsc, or injected via `opts.ts`. No resolvable typescript is a named rejection, never a bundled fallback. Never wired into the extension.

The TS-shaped pure helpers (`src/core/tsExtraction.ts`) sit BESIDE the Rust ones in `extraction.ts`, never inside them: quickinfo/hover parsing (`parseTsHover`), member rendering (`renderTsMemberSignature` slices the member's own declaration out of the quickinfo display; unlike Rust, properties render `name: Type` signatures too), and the kind/role tables (TS types are Class=4/Enum=9/Interface=10 where Rust containers are Struct=22/Enum=9). The `membersFromDocumentSymbols` descent skeleton is shared; `membersOfType` on the headless transport upgrades to the checker's `getPropertiesOfType`, so extends chains contribute inherited members and private/protected are excluded.

Three TS-specific rules, all contract:

- **`example()` is always dark.** Signatures-only injection is the locked scope decision (the JS/TS ecosystem lacks Rust's doc-example culture; structural typing makes the member set carry the anti-hallucination weight). The product method performs no command call at all.
- **Untyped-JS darkness.** At an inferred-`any` receiver the language service emits loose suggestions (every identifier in the file, kind `warning`); the transport filters them so the member surface is honestly `[]`, while a JSDoc-typed receiver in the same project keeps its real members.
- **`qualifyImport` is the auto-import code fix**, single-candidate-module, single-file, single-edit, else `undefined`. Unlike Rust's in-span "Qualify as" rewrite, the edit lands at the top of the file (outside the accepted span); applying it is the phase 4 consumer's problem, the primitive just reports it. The headless path gates on a real TS2304/TS2552 diagnostic first, because `getCodeFixesAtPosition` happily offers import fixes for names that already resolve.

## The C# extractor (v10)

Same interface, same trio: `CsCommandExtractor` (product, over the user's Roslyn language server via the vscode command API) and `CsLspExtractor` (headless stdio transport, `src/core/csLspExtractor.ts`), with the pure helpers in `src/core/csExtraction.ts`. The Roslyn-specific mechanics, proven against a live server probe: the signature rides the completion item's *documentation* (not `detail`), and resolving costs ~10ms per item, so the FIM signature block carries only the top resolved members and the tail degrades to bare names - the enforcement gate keys on names, which every member carries. `example()` is dark (metadata-as-source carries no examples); `qualifyImport` rides Roslyn's fully-qualify code fix, accepting only a bare dotted-path title (a missed fix is safe, a wrong edit is not).

## The Python extractor (v11)

`PyCommandExtractor` (product, over Pylance) and `PyLspExtractor` (headless, over the bundled pyright language server), helpers in `src/core/pyExtraction.ts`. The rules Python adds:

- **Dunders dropped, sunders kept.** `__init__`-style members are noise at a `.` site; single-underscore `_private` members are real API and stay. The locked rule's worst case is an Enum receiver's metaclass internals - a dogfood-ledger item, not a code rule.
- **Honest-dark is the premise, measured.** A receiver pyright resolves to `Unknown`/`Any` yields an empty surface; the dark-site evidence line counts distinct dark sites per session so the darkness (11-52% of member sites depending on the repo's annotation culture) is a number, not a fear.
- **Python has a real `example()`** - docstring examples parse through `parsePyDoctest` - unlike the always-dark TS/C# example paths.
- **The import ladder.** Python's deterministic import fix cannot always be an in-span rewrite; the ladder prefers the owned-import spine and broadens `QualifyEdit` to a deterministic imports-region edit (see the revised qualify ADR below).
- **Enum variants (session-v40, item 4, REASONED not PROVEN — no corpus, no ceiling row).** pyright hovers a class as `(class) LodBand`, identical text whether the class is plain, a dataclass, or an `Enum`/`IntEnum` subclass, so `renderMethods` drops every variant and the type ships member-dark — the same hole C#'s `enumMemberLine` hook fills by reading `enum Atlas.LodBand` off Roslyn's hover. Python has no such hover text. A live probe considered documentSymbol's `kind` (Constant vs Variable) as a substitute and killed it: it is pyright's own ALL_CAPS naming heuristic, not an Enum signal — a plain class's `MAX_RETRIES = 3` and a real Enum's lowercase `continental = 0` both land on the WRONG side of it. `pyShapeHooks.enumMemberLine` (`crossFileShape.ts`) instead reads the declaration SOURCE the walk already has open, via `pyEnumBaseDecl` (`pyExtraction.ts`): a `class LodBand(IntEnum):` header, checked textually. Verified live against the dogfood repo (`~/repos/python-scratch/atlas_py/_core.py`) both directions — `LodBand`'s four variants render `LodBand.VARIANT`, `StripeSummary`'s dataclass fields render nothing rather than a misleading `StripeSummary.field`.

Why rust-analyzer and not rustdoc JSON: RA resolves types on a broken, unsaved buffer that does not compile (the exact mid-edit state where rustdoc JSON has nothing), macro-resolved, 5-15ms warm. rustdoc JSON is an optional bulk path behind the same interface, generated locally (`cargo doc --output-format=json`, which wants nightly) or dodged entirely by parsing the on-disk crate source with `syn`; it is the one place nightly would appear and it is off the core path.

Both the RA path and the rustdoc-JSON fallback read the crate source that is already on disk under `~/.cargo/registry/src/`. The offline invariant in [ARCHITECTURE.md](../../ARCHITECTURE.md) governs this subsystem hard: a `docs.rs`-prebuilt path was considered and rejected because it reaches the network at runtime. The examples are local; the only real problem is reading them reliably, never fetching them.

## Payload shape: example or signatures, the compiler decides

The naive plan was "dump the API signatures into the prompt." The scout falsified it as a standalone mechanism: enumerated signatures did nothing for a builder chain and collapsed the model onto a confident-wrong `.build()` it invented despite the correct chain sitting in the prompt. Piling signatures onto a working example made it worse.

The rule that survived is shape-dependent and picked by the diagnostic, not a heuristic:

- **A worked example** when the crate has one and the failure is builder-shaped. The example fixes the construction the model cannot guess; the model supplies the obvious operations itself.
- **Signatures** when correct use is a direct method call on a nameable type.
- **Never both.** More context is distraction, not help.

## The three hallucination classes

`cargo check` names the failure; `classifyHallucination` maps it to an injection:

| rustc code | what the model did | injection |
|---|---|---|
| E0599 | called a method/assoc fn that does not exist | the receiver's real surface (example or signatures) |
| E0432 (multi-segment) | invented a type inside a real crate (`use fastbloom::Bloom`) | the crate's surface |
| E0432 (single-segment) / E0433 | reached for a crate that is not a dependency | the installed-crate catalog (see below) |

The single-vs-multi-segment split on E0432 is load-bearing and was found on the human's own box: `use fastbloom::Bloom` with fastbloom present is a wrong item inside a real crate; `use fastbloom::...` with fastbloom absent from Cargo.toml is a missing dependency. Same code, opposite fix. The missing-dependency case is caught at the document level before any repair round is spent.

Each language carries its own classifier sibling in `compilerDirected.ts` - `classifyTsHallucination` (TS codes), `classifyCsHallucination` (CS0246/CS0234/CS0103 route to qualify; a truly invented type is honest-dark), and the Python qualify-class cursor over pyright's `rule` field. The rustc classifier reads no foreign codes and vice versa; a language's classifier only ever fires behind its own oracle.

C# CS0019 (`Operator '==' cannot be applied to operands of type 'int' and 'LodBand'`) classifies as `operand-mismatch`. It resolves no block of its own, because an operator site has no receiver to enumerate members at; what it contributes is its two operand types, which reach the model through the span's types-in-play. It also carries the one steer measured necessary beyond disclosure: with both operand types named AND both surfaces in the prompt, the 30b still would not swap the member the compiler did not name, so the surface additionally says which disclosed member IS that type (`Members in scope whose type is \`LodBand\`: Tile.Band`).

## Where it plugs in

**fn-gen repair** (`oracleSurface.ts`). A repair round's surface has two legs, and the order matters.

First the SPAN's types-in-play (`spanTypesInPlay`, `repairTypes.ts`): the types the failing span's signature, body, doc comment and diagnostics name, resolved through the same `resolveCrossFileShape` engine round-1 generation uses. Disclosure follows the QUESTION, not the diagnostic. The model is asked to repair a span, so the span's types are what it needs; keying the surface to the one type a round's diagnostic happened to name is what let a capture repair `LodBand.Region` correctly while never learning that `Tile.Band` exists (session-v28).

Then the diagnostic-keyed blocks (`resolveSurfaceInjection`), minus any type the span leg already disclosed, resolving example-else-signatures with the compiler-named type as the example's `prefer` hint. ONE firm instruction closes the whole surface, naming every type that rendered: an instruction scoped to one type while another type's block sits above it cannot be obeyed and satisfied at once, and the model splits the difference by inventing.

Two payloads keep their own contract against all of this: the installed-crate catalog and the enable-this-feature steer are injected ALONE, because until the crate is a dependency its methods cannot resolve and a manifest edit is not an API the model got wrong.

Repair output is then GATED (`undisclosedMemberRefusal`, `repairGate.ts`) wherever a surface was injected: a reply naming a member a disclosed type does not have, or naming a disclosed type as if it were a member of a value, is refused with the reason logged and never reaches the consent gate. The gate refuses only against a member list that is COMPLETE, which in practice means a closed set: an enum's variants. A class's enumerated members are not complete (nested types, extension members, generic statics, partial declarations), and refusing against them was measured to refuse correct repairs. A refusal returns to the round table rather than ending the session, so the cap decides what happens next and the give-up path still tells the human what is left in their file.

All of this rides the same `RepairSession` cap, routing, and span scoping as any repair round (see [compiler-oracle](compiler-oracle.md)); injection changes the prompt, not the state machine.

**fn-gen round 1** (`fnGen.ts`). Before the first generation, `resolvePrefill` resolves an example for the types named in the signature and doc comment and passes it as `injectedSurface`. Conservative by design: example only, never the wide member set, so a bare type reference that resolves nothing stays blind and the loop recovers.

**Deterministic import qualify** (the pre-pass). An unresolved-but-resolvable name (a missing import) is not a model problem. RA's "Qualify as" assist rewrites the bare name to its full path in place (`fastbloom::BloomFilter`), which preserves the function-boundary invariant (no top-level `use` write, no carve-out) with zero model rounds. It runs before any repair round, through the single write path.

**Dependency-catalog steering** (`catalog.ts`). When the model reaches for an uninstalled crate, injecting the crate's surface is impossible (it is not there). Instead inject a capability catalog of the INSTALLED direct deps (name plus one-line purpose from `cargo metadata`) so the model re-picks from what is available. Fires only on the unresolved-crate error, never as a blanket allowlist; if nothing installed steers, fall back to "add it to Cargo.toml."

**Punt mitigation** (`punt.ts`). Small models give up: they stub the body (`todo!`, `unimplemented!`, `Err("... not implemented")`) and return something that compiles. The first prompt carries a no-punt instruction; a post-generation `looksLikePunt` check triggers one circle-back round demanding a real implementation with the injected surface.

**FIM candidate injection** (`fimInject.ts`). The FIM path is the one place injection sits before a latency bar, so it plays by different rules; the mechanics are in [fim-completion](fim-completion.md#candidate-injection). In short: at a `.`/`::` site, inject the receiver's real signatures so the 1.5b completes a member that exists, raced against a 50ms deadline so a cold RA never blows the 200ms TTFT bar.

## What the injected surface actually carries, per language

Measured e2e in a real extension host against the real servers, one 16-member type transliterated four ways (scout-v21 langs arm). **The surface is complete in exactly two of the eight language-and-path combinations, and only Rust marks where it truncated.**

At a MEMBER site (`receiver.`):

| language | members resolved | of which real | block |
|---|---|---|---|
| TypeScript | 16 | 16 | 16 lines, complete |
| Python | 16 | 16 | 16 lines, complete |
| C# | 34 | 16 | 31 lines, half of it `object` and extension-on-`object` noise |
| Rust | 16 | 16 | 11 lines, all methods (measured); fields now render as `name: Type`, count not re-measured |

A Rust field is a member with a type. rust-analyzer serves that type in `detail` and in `labelDetails.description` (measured 12/12 same-file, 2/2 cross-crate), the same channel a method's `fn`-shaped detail rides; the difference is the SHAPE of the detail, not its presence. `toCompletionMember` renders a callable by splicing the name over the `fn` and a field as `name: Type` (`renderFieldSignature`), which keeps a function-TYPED field honest: `on_tick: fn(u64) -> bool` is data, and calling it is `(x.on_tick)(..)`, not `x.on_tick(..)`.

C# filters members declared on `object` — the four universal ones and any extension method hung on `object`, which in one project was fourteen from the Cosmos SDK. Keyed on the DECLARING TYPE Roslyn renders into the signature, never on a name list: the noise floor is per-project, and a name list cannot tell an inherited `object.ToString()` from the developer's own override. A filtered member keeps its NAME and loses its SIGNATURE, so it leaves the block (a line needs a signature) while the enforcement gate still travels on every name and an incomplete block can never suppress a valid completion.

WHERE THE FILTER RUNS, and it differs by transport. On the headless LSP transport (`CsLspExtractor`) the filter runs BEFORE the resolve budget is spent, so the noise never costs a resolve slot and every real property can carry a signature. On the vscode command transport (`CsCommandExtractor`, the one a user runs) it cannot: `executeCompletionItemProvider` resolves the first N of the SERVER's list positionally, the transport can neither reorder nor skip, and the declaring type the filter reads arrives WITH the resolve. There the filter buys resolve slots back only for the members Roslyn already described in `detail` or `labelDetails.description` before any resolve, and how often Roslyn does that is UNMEASURED. Run `column80.dumpCompletionItems` at a real member site to settle it. Until then, `MEMBER_RESOLVE_CAP` is 32, members that miss the resolve are dropped from the block, and at a real 49-property entity 69 members resolved, 32 got signatures and **22 real properties were silently gone**, cut alphabetically.

At a WHOLE-BLOCK site (empty body over a cross-file signature), the budget is 1200 chars (`DATASHAPE_TOTAL_TOK * 4`). session-v21 item 8 measured each language's surface and fixed each; this table is the BEFORE state, and each mechanism below it was corrected:

| language | shown / real | block chars | mechanism (since fixed) | marked |
|---|---|---|---|---|
| Rust | 5 / 16 | 488 | rust-analyzer `hover.show.fields` (out of item-8 scope) | yes, `/* … */` |
| TypeScript | 8 / 16 | 362 | the product's own `HOVER_SIGNATURE_CAP` = 8 | no |
| Python | **0 / 16** | 102 | cold-touch fan-out artifact, NOT a missing hover | no |
| C# | 49 / 49 | **1826** | header + `// ` prefixes charged after the budget | n/a |

Item 8's fixes, all whole-block-only, all in `renderWholeBlockInjection` / `membersWithHoverSignatures` / `membersWithSettle`:

- **TypeScript.** `HOVER_SIGNATURE_CAP` is the product's own cap (tsserver answers documentSymbol with `detail: ""`, so signatures come from a hover fan-out), not the server's. It is raised from 8 to 32, so the surface is bounded by the 1200-char budget and the 50ms fan-out, not an unmeasured constant. The count cap is called only from `membersOfType` (whole-block), never `completeMembers` (member site). The WARM delivered-count at a large TypeScript type is latency-bound (tsserver serves hovers serially, ~1.4ms each) and owed a live-tier measurement.
- **Python.** pyright's hover DOES carry fields, properties and methods, and the backfill delivers them - the earlier claim that it carried none was wrong. The 0/16 was a cold-first-touch artifact: the 50ms fan-out cut all but `__init__`, which `renderMethods` drops as the constructor. `membersWithSettle` now re-polls while a callable is still pending (never on a settled field-only set, which would burn 120ms for nothing), and the fan-out deals its bounded slots round-robin between callables and fields so a type with methods always shows one.
- **C#.** `renderWholeBlockInjection` charges the header and every `// ` prefix against the budget (no more overrun), keeps each struct def atomic (never split mid-body), and places each root's methods after the def whose NAME is that root - so a member named identically on two types attributes to its own type. The function being written is not listed as a type in play.
- **Rust** whole-block stays methods-only here: the field cap is the user's rust-analyzer `hover.show.fields` (offered a one-click lift, above), and whole-block field rendering was left out of item 8's scope.

One trade item 8 did NOT settle: after the field cap is lifted, `renderWholeBlockInjection`'s 1200-char budget evicts method signature lines to make room for fields, and whether the evicted methods were worth more than the fields is unmeasured. Deciding it needs a method-recall oracle - completions at sites whose body CALLS a method - run against the live model; the field-recall corpus is blind to the trade by construction. Delegated, not built on faith.

The 50ms `INJECTION_DEADLINE_MS` is NOT the problem and should not be raised. Warm, every language clears it (p50 6-20ms, p95 12-27ms, zero of twenty samples over 50 in any language). What bites is the window before warm, where the resolver returns zero or a partial set: TypeScript 2.0s, Python 2.1s, Rust 4.9s, **C# 6.7s** because Roslyn loads projects lazily.

## Decisions

**ADR: payload shape is chosen by the diagnostic, not up front.**
Context: enumerated signatures are a weak standalone mechanism (0/10 on the fastbloom builder chain, and they collapse output onto a confident-wrong pattern), but they work for direct-method APIs; a worked example moves the builder case. There is no single best payload.
Decision: render both behind the extractor and let the compiler-directed loop pick by the error class and crate shape. Example for builder/multi-type chains, signatures for direct methods, never both.
Consequence: the selection problem dissolves into the classifier. The cost is that a crate with no doc example on a builder API degrades to signatures, which is the command-transport gap tracked for v2.x.

**ADR: steer to the catalog only on an unresolved-crate error, never as an allowlist.**
Context: injecting "use only these crates" as a blanket prompt instruction backfires: it took a std-correct task from 8/8 to 0/8 by forcing an unwanted crate in. But when a dep IS needed and the model reaches for an unavailable one, it fails every time with no help.
Decision: the compiler-directed loop is the arbiter. Cargo.toml is a source for the extractor, not a usage instruction. Inject the capability catalog only when the compiler reports an unresolved crate; inject a crate's surface only on an unresolved method inside it.
Consequence: no steering on tasks that do not need a dep, real steering on tasks that do. An invented dep is already a deterministic E0432/E0433, so the loop has a clean trigger.

**ADR: deterministic import fixes - in place where the language allows, imports-region where it does not.**
Context: an unimported dependency type is resolvable deterministically, no LLM needed. Rust and C# have inline fully-qualified syntax, so the fix can stay inside the function span ("Qualify as" / Roslyn fully-qualify). Python (and Go, per its scout) structurally cannot inline-qualify everything; their deterministic fix is an import line at the top of the file.
Decision: prefer the in-span qualify wherever the language allows it. Where it does not, `QualifyEdit` carries a deterministic imports-region edit - compiler-derived, never model-written, through the same consent gate.
Consequence: the function-boundary invariant keeps its spirit (no MODEL write outside the span; the imports-region edit is deterministic and consented) rather than its Rust-shaped letter. Rust generated code still carries fully-qualified paths, never a `use` line the human did not write.

## Trait recovery, alias tiers, and the example gate (v41)

Three additions from session-v41, one theme: the resolution residual. After v39 recovered what the
hover elided and v40 stopped oversized defs from vanishing, the remaining "injected nothing" rows
were traits (the server answers a bare head and no members), type aliases (the hover says
everything and nothing was read from it), and a worked-example leg quoting other types' docs.

- **Trait surfaces come from the definition source** (`recoverTraitSurface`,
  `src/core/rustHoverRecovery.ts`): method signatures, associated types and consts, supertrait
  bounds; default bodies contribute signatures only. The trigger (`isBareTraitHover` + empty
  member list, wired in `crossFileShape.ts`) fires only for WORKSPACE-defined traits - sysroot and
  cargo-registry defs refuse on provenance (`isCargoRegistryDef`), because external traits touched
  zero failing corpus rows and moved passing ones. Any parse doubt refuses whole; the fallback is
  the pre-v41 nothing.
- **Aliases inject in two tiers** (`aliasDeclAnatomy` and the chase in `crossFileShape.ts`): the
  alias's one-line hover always injects (it names the target, which is most of what the model
  needs), and a workspace-defined target is chased one hop - never transitively - into the normal
  walk, rendered under BOTH names because the v22 measurement showed a block naming only the
  target scores zero at alias call sites. The `=` that splits the decl is depth-aware: a generic
  parameter default (`type Cache<K = MyKey> = Store<K>`) is never read as the target.
- **The example gate** (`exampleNamesItsType`, `src/core/extraction.ts`, enforced in
  `assembleSurfacePayload` so fn-gen and repair pass one seam): an example block whose code never
  names its headed type is refused - word-boundary on the last path segment - and the render falls
  back to signatures. Generic parameters of the enclosing impl are refused as example candidates
  (`enclosingImplGenericParams`, scope-aware over scrubbed source).

Census over the 237-row corpus, three points (before / after recovery+aliases / after the gate):
types injecting nothing 53 -> 3 -> 2; example blocks 47 -> 7 -> 0, junk 38 -> 7 -> 0. Supersessions
S13 and S14 record the two frozen rows this deliberately reversed.

## The C# budget, and why the cap was the wrong knob (v45)

C#'s binding stage is the AGGREGATE RENDER BUDGET, not the type cap - the opposite of Go's answer, and
the reason is a language fact rather than a tuning accident. A Roslyn member list per type is far larger
than a Go hover or a Rust def, so C# exhausts a shared TOKEN budget long before it exhausts a SLOT
count.

Measured over 465 authored-doc C# rows on five pinned OSS repos, four arms, one knob at a time:

| arm | got a slot | injected |
|---|---|---|
| cap 4, budget 300 (shipped) | 47.8% | 16.4% |
| cap 8, budget 300 | 92.6% | 20.2% |
| cap 4, budget 900 | 47.8% | 31.6% |
| cap 8, budget 900 | 92.6% | 38.8% |

Raising the CAP alone relocates the loss instead of removing it: types-that-got-a-slot nearly doubles,
injection moves under four points, and loss AFTER the cap RISES from 65.7% to 78.2%, because every type
the cap stopped evicting arrives at a budget that was already the binding constraint. Raising the BUDGET
alone nearly doubles injection with the cap evicting the identical 52.1%.

`CS_BUDGET_FACTOR` (fnGen.ts) is the mechanism, currently 1, so it is arithmetically a no-op. It is a
MULTIPLE of the shared budget rather than an absolute for a measurement reason: the rig patches the
shared constant to run a ladder, and a sentinel form (`=== 300 ? value : ...`) cannot tell unpatched
from patched-to-300, which would make the baseline rung - the one every other rung is compared against
- the single value a C# ladder could not express. The value it should carry is a GENERATION question and
is deliberately unanswered here; the only thing standing behind the shipped 300 is a "~350-token codegen
knee" that session-v30 recorded as coming from external literature rather than from this product
(roadmap item 41a).

Three properties of that funnel are worth keeping, because each one changes how the table reads:

- **The doc/backtick leg is not a hole.** Parsed 99.9%, candidate 99.8%. The taught gesture works.
- **The stages are NOT strictly nested.** A type can be injected without ever holding a cap slot,
  because another type's data-shape walk reaches it and renders it as a nested shape. In the shipped
  configuration that is 46 of 220 injected types - **20.9%** - so a fifth of the surface C# receives is
  a side effect of nested walking rather than of the candidate-and-cap machinery. At cap 8 plus budget
  900 it collapses to 1.5%, because nearly everything holds a slot directly.
- **A knob that raises the cap and not the budget** moves C# to the worst of the four arms above
  (S45-8). That finding is why `column80.injectedSurface` was replaced: it raised exactly that one
  number. `column80.injectedContext` moves the cap and the budget together (supersession S16).

## The Go cap, and the authored-doc population (v42)

The prefill type cap was per-language from v42 to v48: `GO_PREFILL_TYPE_CAP = 8`, everything else 4.
Since session-v48 it is the context stop's `rootCap` and every language reads the same number, with
Go's measured 8 as the install default for all five (supersession S16). The constant survives in one
place only, and it is not a live exception: the internal `shipped` stop replays the pre-dial point
for measurement, and the pre-dial point gave Go 8 (`PrefillLang.shippedRootCap`, applied in
`prefillRootCap`). A `shipped` Go prompt built on 4 roots would be a before-side that never shipped -
1204 bytes against HEAD's 2116. The
number is not taste - it is the knee of a cap ladder measured over 907 script-authored
backtick-doc functions on a six-repo corpus, where the cap was the funnel's binding stage (in-cap
50.9% -> 78.8%, injected 34.8% -> 53.9%). Rust keeps 4 because its own 4->12 ladder measured flat.
The population is deliberately the TAUGHT one: column80 users doc-comment the target function, so
the authored funnel, not committed-doc frequency, is the product's measurement. Generation arms:
inject 13.6% vs dark 4.9% compiled (+8.7, ~2.8x). Supersession S15 records the nine frozen
global-cap rows this reversed. Qualified-usage mining for Go and C# refuses a name immediately
followed by `(` before any workspace/symbol lookup fires (a call, never a type) - live round trips
per row halved.
