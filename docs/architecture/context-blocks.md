# Context blocks

The product's identity feature, serving product invariant 3 in [ARCHITECTURE.md](../../ARCHITECTURE.md): a removed block never reaches a prompt, and the panel shows exactly what the model will see. The mechanism is dumb by design; trust comes from how little it does.

Files: `src/core/contextBlocks.ts` (store, anchor rule, row/toast shapes), `src/core/contextGestures.ts` (pure gesture math), `src/vscode/blockReader.ts` (the payload reader, vscode-free). Panel and gestures: `src/vscode/contextPanel.ts`, covered structurally in [vscode-layer](vscode-layer.md).

## The identity claim: the lines you chose, as they read now

A block is a live RANGE over a live document. At generate time the model gets what those lines say NOW, not what they said when the block was added. Add a block over a function, type an `if` into it, fill the body, generate: the prompt carries the implementation.

The older claim was the opposite (*the snapshot you saw is the snapshot the model gets*) and it was reversed on purpose. See `docs/supersessions.md` S4 for what that cost in frozen oracles. Under frozen semantics the product flagged an edited block stale and sent the old bytes anyway, which is a warning icon attached to a lie.

What this trades away: reproducibility of the exact bytes. Two generations minutes apart can differ because you typed in between. The panel rendering the current range and the current text is what keeps that inspectable.

A block is live, or it is LOST. Lost is terminal: only remove or a fresh add clears it, nothing heals on its own, and no prompt ever carries it. There is no stale state left, because there is nothing for it to mean.

## Store semantics

`ContextBlockStore` is an ordered list of entries with monotonic never-reused ids. An entry is `(id, uri, range, text, addedAtVersion)` plus the optional `lapsed` and `lost` flags, absent on a healthy block rather than present-and-false. Add appends verbatim (no trimming, no EOL normalization, no size cap, no dedup: twice in the list means twice in the prompt, and the human curates). Remove, clear, move, list; a synchronous `subscribe` drives the panel.

`text` is the LAST KNOWN slice, not the payload. It earns its keep in exactly two places that are not the prompt: the panel preview, which has to render without an await, and the re-adoption audit after a document closes. It is refreshed on every change event and at every resolve, so a block the human is actively editing previews correct.

`toPromptBlocks()` keeps its old shape and its synchronous last-known semantics for the headless callers and the prompt-identity oracle that ride it. Nothing that reaches a model rides it. Ids, versions and health never enter a prompt.

No persistence. The store dies with the extension host, and an empty panel after reload is honest; silently rehydrated context the user forgot about is precisely the invisible inclusion this feature exists to prevent.

## The anchor: shift, resize, or lost

`reanchorRange` is pure and replays the editor's own change events. Every change in an event is classified against the block's PRE-EVENT range, so the answer cannot depend on arrival order (the editor delivers changes in descending document order, and nothing here may notice).

| the change is | answer |
|---|---|
| entirely above | shift both bounds by its line delta |
| entirely below | ignored |
| entirely inside | resize: the end moves by the line delta, the start does not |
| crossing either boundary | **lost** |

`lost` wins: one crossing change in an event of twenty loses the block. An empty change list is a shift with the range unchanged, never a loss, because every edit in every language fires a second event at the same version carrying zero changes. Reading that as "something I cannot model" would flag every block on every save.

Two rules that look like details and are not:

- A change is `above` when it ends strictly before the block's first line, or ends at character 0 of it. That is what makes "press Enter at the start of the block" a shift rather than an intrusion. `inside` is a LINE test, so selecting the block's own lines and retyping them resizes rather than losing.
- A change ending at character 0 of the line AFTER the block is charged for a line boundary that is not the block's to lose. The line goes back unless the replacement re-supplies the boundary itself, which is what the `endsAtLineStart` bit on the change reports. Without the correction, putting the cursor at the end of a function's closing brace and pressing Delete hands the model a function with no `}`.

There is no clamp. A change that overlaps a boundary is refused rather than trimmed, and the cost is one re-add. A spike built the clamp first, got the very first measured case wrong, and its expectation was wrong differently: two independent wrong answers to one small arithmetic question is the argument for having no arithmetic.

`ContextBlockStore.reanchor(uri, changes, version, text?)` applies the rule per entry and returns `{moved, lost}`. A shifted or resized entry is replaced in place with its new range and version, keeping id, list position and text. A lost entry keeps its old range and text so the panel can still say where the block used to be. An entry already lost is skipped, never re-reported. One event bumps the version once however many changes it carries.

## `resolveForPrompt` is the payload path

`resolveForPrompt(read)` walks the live list, slices each entry's current range out of whatever `read` returns for its uri, refreshes the cached text, and returns the `{uri, range, text}` projection prompt assembly already consumes. Lost entries are excluded and never read. A read answering `undefined` makes the entry `lost: "deleted"`. A range that slices to nothing is `lost: "crossed"`, because a resolved range with no text in it is not a block.

**It lives on the store rather than in the fn-gen command, and that is structural.** Bar 3 hangs on the prompt being assembled from the live list at generate time. Move the walk out of the store and the guarantee moves with it.

Async payload resolution costs two mechanisms the sync path never needed, and both were found missing by review rather than reasoned about up front:

- The walk tracks entries VISITED BY ID and picks the first unvisited entry in the live list each iteration. An integer cursor carried across an await cannot express a list the human is mutating: two removals in one gesture skip a healthy neighbour, and a move emits a block twice. By id and not by object identity, because every uri-level method replaces the frozen entry in place, so identity reads a re-frozen entry as a brand new one and re-reads it without bound.
- The returned projection is built at the END by walking the live list and taking each surviving entry's block. Emitting as you go leaks a block removed after its own read, which is the exact failure the product exists not to have. The same post-walk settles order, so a move mid-resolve reorders the prompt the way it reordered the panel.

The resolved payload is LF text with no trailing newline, folded out of whatever the document uses.

## The reader seam

`makeBlockReader(deps)` ships in its own module and imports no vscode at all, so it unit-tests headless against hand-built fakes. Its whole dependency is "the open documents" and "open one without showing it".

- Open document: `getText()`, so UNSAVED edits count. This is the case that matters.
- Closed document: open it without showing it, the same call the Add File gesture already makes.
- Unreadable, gone, or a uri that will not even parse: `undefined`. Never an empty string, which would silently send an empty section.

Stateless and cache-free on purpose. Two reads in one resolve are two reads, measured at 0.005ms per read plus slice (0.030ms on a 211KB file), and a cache would be a second source of truth about a document VS Code already owns.

## Lapse and re-adoption

The range is exact by construction only while the store sees every change event. Exactly one thing breaks that, and it is not ours to control: the editor owns a document's lifetime and may scuttle it at any time. Measured here the document survived closing every editor on it, in all five languages, with its version intact. Rare is not never.

So a close is not a loss. `onDidCloseTextDocument` marks the uri's blocks `lapsed`, and the next resolve audits them: slice the recorded range out of the reopened document and compare it to the last known text under the canonical rule (CRLF folded, at most one trailing newline stripped). Identical adopts and carries on. Different is `lost: "lapsed"`. A lapsed block renders exactly like a healthy one until that audit rules, because a warning on every tab close is the noise this design removes.

That comparison is the surviving auditor of the old staleness check, moved to the one place where it still means something. Everywhere else the text is SUPPOSED to differ.

## Rename and delete

`onDidRenameFiles` moves a block's uri to follow its file: range, text, id, list position and health are untouched, because a rename moves a block's address, not its health. Without it, renaming a file orphans every block in it while the panel still lists them, which is this session's failure wearing a different hat. `onDidDeleteFiles` loses the blocks and says so.

Saving an untitled buffer closes the untitled document and opens a file document under a different uri, so blocks added from an untitled buffer go lost there. Named, not built for.

## No content search, in either direction

Banned, not merely absent. Re-adoption checks the recorded range and nothing else; a block that moved while nobody was watching is lost, never hunted for. The one argument for a search was that a format-on-save would contain and destroy every block, and it does not: five formatters were measured, Prettier included, and every one emits minimal character-level edits. None contained a block, none produced a whole-document change.

A search would also make the panel a liar in the direction that matters. It would silently repoint a block at lines the human never chose.

## The bar-3 guarantee, structurally

The store is the single source of truth, and the fn-gen command awaits `store.resolveForPrompt(reader)` in the generate path rather than holding any earlier copy. The oracle is byte-level: after remove, the assembled prompt is byte-identical to a run where the block was never added.

Three wiring facts keep the guarantee from regressing:

- `registerFnGen` requires the store parameter with no default. A call site that omits the shared store is a compile error, not a silent second store showing the user context the model never sees.
- The store is created once in `extension.ts` and outlives config-change service rebuilds; a settings tweak must not drop chosen context.
- The repair seam resolves per round rather than once up front. Resolving up front would hand a repair round blocks captured at accept time, which is exactly the window bar 3 is about.

The temporal boundary, stated: remove and clear are honored by every generate that starts after them, including one whose resolve is already suspended on an await. A generation already in flight keeps the prompt it sent, and its pending preview survives store mutation; the proposal being judged was built from the context that existed when the human asked. Second thoughts have two levers that always work: cancel the generation, or reject the preview.

## Ordering

Prompt sections render in `list()` order, and the panel displays that same order. Move gestures reorder both identically; after a move, the prompt is byte-identical to a store built in that order from scratch.

## What loss looks like

Every rendering decision is a pure function in core (`blockRowShape`, `lostToastMessage`); the vscode layer turns the answers into pixels and nothing else.

- The tree row's description is the CURRENT range and moves as the block does. A healthy block never carries a warning again.
- A lost row is an error icon in `list.errorForeground`, `(lost)` on the description, and a tooltip naming which of the three reasons fired: an edit crossed its boundary, its file was deleted or cannot be read, or its document closed and the lines no longer match.
- ONE toast per change EVENT however many blocks it took, naming each as its row reads, with `Remove` (by id, so a block the human already cleared cannot turn the button into a surprise) and `Show`. A refactor crossing three blocks throws one notification, not three.
- A lost block DROPS OUT of the generation and never refuses one. The generation proceeds, a warning names the lost blocks once per gesture, and `[ctx] lost id=… reason=…` landed on the channel at the moment of loss. The loss toast and the generate-time warning are not duplicates: one says this block is gone, the other says your prompt did not include it.

## Known residual

Block text containing a triple-backtick line rides into the prompt verbatim (the panel shows one text, the model sees the same text; escaping would break that). A fence-bearing block can make the model's reply fence-parse ambiguous, but the fn-gen producer guards refuse any output that would splice markdown structure into source. Worst case is a rejected generation with an honest error, never a corrupted splice.
