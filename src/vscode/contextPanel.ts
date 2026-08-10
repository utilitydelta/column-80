import * as vscode from "vscode";
import {
  blockRowShape,
  clampedLineSpan,
  ContextBlockEntry,
  ContextBlockStore,
  decorationLineSpans,
  fileLabel,
  lostToastMessage,
} from "../core/contextBlocks";
import {
  ChainRange,
  chooseChainBlock,
  looksBinary,
  orderedCursors,
  orderedNonEmptySelections,
  selectionLineRange,
  symbolBlockRange,
  truncatePreview,
} from "../core/contextGestures";
import { ContextBlockRange } from "../core/prompt";
import { resolveBlockAtCursor } from "./fnGen";

/**
 * The visible half of the trust feature: a tree view showing which lines the
 * model will see, in prompt order, with the lost ones called out in red.
 * Mechanism only — a dumb list render over the store; the store owns state and
 * [ctx] evidence, this file owns gestures and pixels. Every rendering DECISION
 * lives in core (`blockRowShape`, `lostToastMessage`) so it is testable without
 * an extension host; this file turns those answers into pixels and nothing
 * else. UX feel is a standing human F5 delegate.
 */

// Tooltips preview the block's LAST KNOWN text so the user can see roughly what
// they pointed at without opening the file. Roughly, not exactly: the payload
// is re-read at generate time, and this preview is refreshed on each change
// event rather than on each keystroke of an unrelated document. Capped because
// a whole-file block can be megabytes and a tooltip is a preview, not the
// contract.
const TOOLTIP_TEXT_CAP = 2000;

export class ContextBlockTreeProvider implements vscode.TreeDataProvider<ContextBlockEntry> {
  private readonly changeEmitter = new vscode.EventEmitter<
    ContextBlockEntry | undefined | null | void
  >();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly store: ContextBlockStore) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  getTreeItem(entry: ContextBlockEntry): vscode.TreeItem {
    const label = fileLabel(entry.uri);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.id = entry.id;
    const rangeLabel = `L${entry.range.startLine}-L${entry.range.endLine}`;

    // Every decision here was made in core. No probe of the open document, no
    // staleness: the range is live and the payload is read at generate time, so
    // a row is either a plain file row or a red lost one.
    const shape = blockRowShape(entry);
    item.description = shape.description;
    item.iconPath = new vscode.ThemeIcon(
      shape.icon,
      shape.color === undefined ? undefined : new vscode.ThemeColor(shape.color),
    );

    const clipped = truncatePreview(entry.text, TOOLTIP_TEXT_CAP);
    const preview =
      clipped.length < entry.text.length
        ? `${clipped}\n… (${entry.text.length} chars total)`
        : entry.text;
    // The model gets these LINES as they read at generate time, which is why
    // the healthy tooltip promises the range rather than the bytes below it.
    // A lost block promises nothing: it names what went wrong and what the
    // lines said the last time anyone could see them. Copy is the human's to
    // rewrite in the F5 pass.
    //
    // Branched on the ICON, which is the field that already decided the row is
    // red, so the row and its tooltip cannot disagree about one entry. Branching
    // on `reason` instead made a lost block with no sentence behind its reason
    // paint red and then promise the human the model gets these lines.
    item.tooltip =
      shape.icon === "error"
        ? `${entry.uri}#${rangeLabel}\n\nLost${shape.reason === undefined ? "" : `: ${shape.reason}`}, so this block reaches no prompt. Remove it, or select the lines again. Last seen:\n\n${preview}`
        : `${entry.uri}#${rangeLabel}\n\nThe model gets these lines as they read at generate time. Last seen:\n\n${preview}`;
    item.command = {
      command: "column80.contextReveal",
      title: "Reveal Context Block",
      arguments: [entry],
    };
    return item;
  }

  getChildren(entry?: ContextBlockEntry): ContextBlockEntry[] {
    // Leaf-only tree: the panel is the list, in prompt order.
    return entry ? [] : [...this.store.list()];
  }
}

// The same uri twice is one panel entry. Order is the caller's.
function dedupeUris(uris: readonly vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>();
  const out: vscode.Uri[] = [];
  for (const uri of uris) {
    const key = uri.toString();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(uri);
    }
  }
  return out;
}

/**
 * Add one whole document, or refuse it by NAME.
 *
 * Two refusals, and they say different things because they mean different
 * things. Empty: the block would claim the model sees something it does not, and
 * would inject a vacuous fenced section into prompts. Binary: the panel would
 * carry a page of mojibake. Size is NOT refused — truncation is banned outright,
 * because the lines the human chose are the lines the model gets, all of them,
 * so the store logs the byte count and the prompt budget refuses loudly
 * downstream if it must.
 */
function addWholeDocument(
  store: ContextBlockStore,
  document: vscode.TextDocument,
  warn: (message: string) => void,
  label: string,
): void {
  const text = document.getText();
  if (text === "") {
    warn(`${label} is empty; nothing added to model context.`);
    return;
  }
  if (looksBinary(text)) {
    warn(`${label} is not text; nothing added to model context.`);
    return;
  }
  store.add({
    uri: document.uri.toString(),
    range: { startLine: 1, endLine: document.lineCount },
    text,
    version: document.version,
  });
}

// Every cursor, in document order, top of file first. Whatever order the
// cursors were placed in, the panel reads down the file.
function cursorsOf(editor: vscode.TextEditor): vscode.Position[] {
  return orderedCursors(editor.selections.map((s) => s.active));
}

// A selectionRange chain as a flat list, innermost first. The provider hands
// back a linked list through `.parent`; chooseChainBlock wants the array.
function flattenChain(head: vscode.SelectionRange | undefined): ChainRange[] {
  const out: ChainRange[] = [];
  for (let node = head; node; node = node.parent) {
    out.push({
      startLine: node.range.start.line,
      startCharacter: node.range.start.character,
      endLine: node.range.end.line,
      endCharacter: node.range.end.character,
    });
  }
  return out;
}

/**
 * Add whole-line blocks, deduped, with one refusal when nothing resolved.
 *
 * Whole lines, never a partial line: everything downstream slices the document
 * by LINE range, so half a line is a block whose payload can never match what
 * the human pointed at. Two cursors inside the same function collapse to one
 * block rather than putting the same function in the panel twice.
 */
function addLineBlocks(
  store: ContextBlockStore,
  document: vscode.TextDocument,
  blocks: readonly ContextBlockRange[],
  warn: (message: string) => void,
  nothingResolved: string,
): void {
  if (blocks.length === 0) {
    warn(`${nothingResolved}; nothing added to model context.`);
    return;
  }
  const seen = new Set<string>();
  for (const range of blocks) {
    const key = `${range.startLine}:${range.endLine}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const lastLine = Math.min(range.endLine - 1, document.lineCount - 1);
    const text = document.getText(
      new vscode.Range(range.startLine - 1, 0, lastLine, document.lineAt(lastLine).text.length),
    );
    if (text === "") {
      // The same guard the other two add gestures carry: an empty block would
      // claim the model sees something it does not.
      warn(`the block at L${range.startLine}-L${range.endLine} is empty; nothing added to model context.`);
      continue;
    }
    store.add({
      uri: document.uri.toString(),
      range: { startLine: range.startLine, endLine: lastLine + 1 },
      text,
      version: document.version,
    });
  }
}

// Line boundaries a replacement text adds. `\r\n` is one boundary, not two,
// which is why this counts `\n` alone.
function countNewlines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      n++;
    }
  }
  return n;
}

// Re-exported from core, where the rule lives. The tree row, the loss toast and
// the generate-time warning all name a uri through it: a human reading
// "util.rs" in a toast has to be able to find "util.rs" in the tree, and two
// label rules would eventually disagree about one uri.
export { fileLabel };

/**
 * The pairs of ONE rename event, ordered so that no block moves twice.
 *
 * `renameUri` addresses blocks by uri, so applying the pairs in the order VS
 * Code packed them lets a chained rename (`a -> b`, `b -> c`) pick up the block
 * that pair one just moved to `b` and carry it on to `c`, an address its file
 * never had. Moving each destination out of the way first resolves every pair
 * against the uri set as it stood BEFORE the event, which is the
 * order-independence `reanchorRange` was built to have and has no business
 * losing again here.
 */
function orderedRenames(
  files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[],
): [string, string][] {
  const moves = new Map<string, string>();
  for (const { oldUri, newUri } of files) {
    const from = oldUri.toString();
    const to = newUri.toString();
    // First pair wins for a repeated source: one file cannot be renamed twice in
    // one event, so a second answer would be a guess about which is real.
    if (from !== to && !moves.has(from)) {
      moves.set(from, to);
    }
  }
  const ordered: [string, string][] = [];
  const placed = new Set<string>();
  const place = (from: string): void => {
    const to = moves.get(from);
    if (to === undefined || placed.has(from)) {
      return;
    }
    // Marks in-progress as well as done, so a cycle terminates instead of
    // recursing forever.
    placed.add(from);
    place(to);
    ordered.push([from, to]);
  };
  for (const from of moves.keys()) {
    place(from);
  }
  return ordered;
}

/**
 * View + the four gestures (add active file, add selection, remove one,
 * clear) plus reorder, since order is prompt-visible. The store logs the
 * [ctx] evidence itself; handlers only translate editor state into inputs.
 */
export function registerContextPanel(
  context: vscode.ExtensionContext,
  store: ContextBlockStore,
): void {
  const provider = new ContextBlockTreeProvider(store);

  // The in-editor half of the trust feature: LIVE blocks tint green (the
  // diff-inserted theme color, so both themes render it natively). Lost blocks
  // get no tint — the tree's red row carries that story, and tinting lines the
  // model will not be shown would lie about what it sees.
  const blockDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("diffEditor.insertedTextBackground"),
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor("diffEditor.insertedTextBackground"),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  const paintEditors = (): void => {
    for (const editor of vscode.window.visibleTextEditors) {
      const key = editor.document.uri.toString();
      const spans = decorationLineSpans(
        store.list().filter((e) => e.uri === key),
        editor.document.lineCount,
      );
      editor.setDecorations(
        blockDecoration,
        spans.map((s) => new vscode.Range(s.startLine, 0, s.endLine, 0)),
      );
    }
  };

  const repaint = (): void => {
    provider.refresh();
    paintEditors();
  };

  const warn = (message: string) => {
    void vscode.window.showWarningMessage(`Column 80: ${message}`);
  };

  /**
   * ONE toast per EVENT, however many blocks that event took.
   *
   * This is the surface that stops a block dropping out of a prompt in silence.
   * Before it existed, a refactor that crossed a block left nothing behind but a
   * channel line nobody reads, and the human found out at the next generation or
   * never. Per event rather than per block, because a rename that crosses three
   * blocks throwing three notifications is how a human learns to dismiss them.
   *
   * `Remove` clears exactly the blocks this toast NAMED, by id. By id and not by
   * uri, range or "everything lost": the human has had the toast on screen for
   * as long as they liked and may have removed some of them by hand, or lost
   * others since, and neither may turn this button into a surprise. `remove`
   * answers false for an id that is already gone, which is the whole handling
   * that needs.
   */
  const lostToast = (lost: readonly ContextBlockEntry[]): void => {
    if (lost.length === 0) {
      return;
    }
    const ids = lost.map((e) => e.id);
    void (async () => {
      const choice = await vscode.window.showWarningMessage(
        `Column 80: ${lostToastMessage(lost)}`,
        "Remove",
        "Show",
      );
      if (choice === "Remove") {
        for (const id of ids) {
          store.remove(id);
        }
      } else if (choice === "Show") {
        // The view id's own focus command, which VS Code registers for every
        // contributed view. Reveals the panel without stealing the editor.
        await vscode.commands.executeCommand("column80.contextBlocks.focus");
      }
    })().catch(() => {
      // Nothing downstream is left to catch this: the toast is fired without
      // being awaited, because an event handler cannot block the dispatcher on
      // a human. The view's focus command is contributed by VS Code rather than
      // registered here, so a renamed view or an older host makes it reject, and
      // the human's reward for clicking Show would be an unhandled rejection in
      // the host log. There is nothing useful to say: the blocks are already
      // marked and the toast already said so.
    });
  };
  const activeEditor = (): vscode.TextEditor | undefined => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      warn("no active editor.");
    }
    return editor;
  };
  // uri-filtered so unrelated typing does not redraw the tree; a block's range,
  // preview and health can only change for documents the store references.
  const touchesStore = (uri: vscode.Uri): boolean => {
    const key = uri.toString();
    return store.list().some((e) => e.uri === key);
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("column80.contextBlocks", provider),
    blockDecoration,
    { dispose: store.subscribe(() => repaint()) },
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!touchesStore(e.document.uri)) {
        return;
      }
      // Re-anchor first, repaint second, toast third. An edit ABOVE a block
      // moves the lines its anchor names without touching its bytes; an edit
      // ACROSS its boundary loses it. The store owns both decisions; this only
      // translates the event and surfaces the answer.
      const report = store.reanchor(
        e.document.uri.toString(),
        e.contentChanges.map((change) => ({
          startLine: change.range.start.line,
          endLine: change.range.end.line,
          endCharacter: change.range.end.character,
          // \r\n counts once, the same as \n: it is one line boundary.
          newlineCount: countNewlines(change.text),
          // Does the following content still begin on a fresh line? A pure
          // deletion starting at column 0 leaves the next line at a line
          // start; so does any replacement that ends in a newline.
          endsAtLineStart:
            change.text.endsWith("\n") ||
            (change.text.length === 0 && change.range.start.character === 0),
        })),
        e.document.version,
        // The document as it now reads. The store re-slices every surviving
        // block's cached text out of it, which is what the panel previews
        // without an await and what the re-adoption audit compares against
        // after a close. getText() is free next to what this handler already
        // does per keystroke (v33 finding 8).
        e.document.getText(),
      );
      // Unconditional: the preview text can change with no anchor moving.
      repaint();
      // One notification for the whole event. An accept splice is a change
      // event too, and both accept paths stay deliberately quiet about drops,
      // so this is the only surface aimed at a human when an edit crosses a
      // block.
      lostToast(report.lost);
    }),
    // There is no onDidOpenTextDocument subscription any more. It existed to
    // recompute a staleness flag that could only be probed from an OPEN
    // document, and a row is now a pure function of its entry: opening a file
    // changes nothing a human can see. A close still matters, because it is the
    // one thing that can break the anchor's lockstep.
    vscode.workspace.onDidCloseTextDocument((d) => {
      if (touchesStore(d.uri)) {
        // A close is the one thing that can break the anchor's lockstep: the
        // editor owns a document's lifetime and may drop its model, after
        // which the edits we are no longer told about are edits the range
        // cannot follow (v33 finding 7). Not a loss - the blocks get ONE
        // re-adoption audit at the next resolve, and pass it whenever nobody
        // touched the file while it was shut.
        store.markLapsed(d.uri.toString());
        repaint();
      }
    }),
    // A rename moves a block's ADDRESS, not its health. Without this, renaming
    // a file orphans every block in it while the panel goes on listing them,
    // which is the failure this session exists to remove wearing a different
    // hat. A folder rename fires ONE pair for the folder and none for the files
    // under it, so blocks inside a renamed folder do NOT follow: named here,
    // deliberately not built for.
    vscode.workspace.onDidRenameFiles((e) => {
      for (const [from, to] of orderedRenames(e.files)) {
        try {
          // The store notifies (and so repaints) only when something actually
          // moved, so an unrelated rename costs a list scan and nothing else.
          store.renameUri(from, to);
        } catch {
          // A subscriber threw during the repaint the move triggered. The move
          // itself has already landed, and the remaining pairs in this event
          // still have to be applied, so a broken listener cannot be allowed to
          // strand the rest of the event's blocks at addresses that no longer
          // exist (and the throw must not escape into vscode's dispatcher).
        }
      }
    }),
    // The file is gone, so every block in it is lost and said out loud on the
    // channel. Terminal: only remove or a fresh add clears it.
    //
    // A folder delete fires ONE uri, the folder's, and none for the files under
    // it, so blocks in a deleted folder are not marked here. They self-heal at
    // the next resolve: the reader cannot read the file, answers `undefined`,
    // and the block becomes lost:"deleted" there instead. Same limitation the
    // rename handler names, one resolve later.
    vscode.workspace.onDidDeleteFiles((e) => {
      // Accumulated across the whole event, so deleting six files that between
      // them hold four blocks is ONE notification naming four blocks, exactly
      // as a change event is.
      const lost: ContextBlockEntry[] = [];
      for (const uri of e.files) {
        try {
          lost.push(...store.markDeleted(uri.toString()));
        } catch {
          // Same reason as the rename handler: one throwing repaint subscriber
          // must not leave the later files in this event listed as healthy when
          // they are gone. The blocks of the file that threw are already marked
          // (the store mutates before it notifies); what is lost is their names
          // in the toast, which beats stranding the rest of the event.
        }
      }
      lostToast(lost);
    }),
    // A tab/split switch shows an editor the paint loop has not seen;
    // the tree is unaffected, only pixels need refreshing.
    vscode.window.onDidChangeVisibleTextEditors(() => paintEditors()),

    vscode.commands.registerCommand(
      "column80.contextReveal",
      async (entry?: ContextBlockEntry) => {
        if (!entry) {
          return;
        }
        let document: vscode.TextDocument;
        try {
          document = await vscode.workspace.openTextDocument(vscode.Uri.parse(entry.uri));
        } catch {
          warn(`cannot open ${entry.uri}`);
          return;
        }
        const editor = await vscode.window.showTextDocument(document);
        const span = clampedLineSpan(entry.range, document.lineCount);
        if (!span) {
          return;
        }
        const selection = new vscode.Selection(
          span.startLine,
          0,
          span.endLine,
          document.lineAt(span.endLine).text.length,
        );
        editor.selection = selection;
        editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      },
    ),

    // Five surfaces reach this command and they do not agree about what they
    // pass: the palette (nothing), the editor context menu, the panel's own
    // view/title button, the explorer tree, and the editor tab. So it decides on
    // TYPE, never on presence. A `uri ? ... : activeEditor()` branch is how the
    // panel's + button breaks, because it would trust whatever that surface hands
    // over just for being truthy.
    vscode.commands.registerCommand("column80.contextAddFile", async (uri?: unknown, uris?: unknown) => {
      // Arg 2 is the load-bearing one: it carries the FULL tree multi-selection,
      // while arg 1 is only the file the human happened to right-click ON. A
      // build that reads arg 1 alone silently adds one file out of six. Its order
      // is the TREE's, so ctrl-clicking bottom to top still reads top to bottom
      // in the panel.
      const selected = Array.isArray(uris) ? uris.filter((u): u is vscode.Uri => u instanceof vscode.Uri) : [];
      const clicked = uri instanceof vscode.Uri ? [uri] : [];
      const targets = dedupeUris(selected.length > 0 ? selected : clicked);
      if (targets.length === 0) {
        // Nothing usable was passed, which is the palette path and every surface
        // that hands over something other than a Uri. Today's behavior, kept.
        const editor = activeEditor();
        if (editor) {
          addWholeDocument(store, editor.document, warn, "the active document");
        }
        return;
      }
      // Per FILE, never all-or-nothing: one unreadable file in a selection of six
      // adds the other five and names the one it skipped.
      for (const target of targets) {
        let document: vscode.TextDocument;
        try {
          // Supplies text AND version without showing the file, so a block can
          // be added from a file no editor has open and still start life in
          // lockstep with the document's version.
          document = await vscode.workspace.openTextDocument(target);
        } catch {
          warn(`cannot read ${fileLabel(target.toString())}; nothing added for it.`);
          continue;
        }
        addWholeDocument(store, document, warn, fileLabel(target.toString()));
      }
    }),

    vscode.commands.registerCommand("column80.contextAddSelection", () => {
      const editor = activeEditor();
      if (!editor) {
        return;
      }
      // Every non-empty selection becomes a block, in document order:
      // silently keeping only the primary would drop cursors the
      // user explicitly placed, on the feature whose contract is "the
      // human selects everything the model sees".
      const selections = orderedNonEmptySelections(
        editor.selections.map((s) => ({
          startLine: s.start.line,
          startCharacter: s.start.character,
          endLine: s.end.line,
          endCharacter: s.end.character,
        })),
      );
      if (selections.length === 0) {
        // Gesture-level guard: an empty snapshot in the panel would claim
        // the model sees something it does not.
        warn("selection is empty; nothing added to model context.");
        return;
      }
      for (const s of selections) {
        store.add({
          uri: editor.document.uri.toString(),
          range: selectionLineRange(s),
          text: editor.document.getText(
            new vscode.Range(s.startLine, s.startCharacter, s.endLine, s.endCharacter),
          ),
          version: editor.document.version,
        });
      }
    }),

    // The AST gestures. Drag-selecting a function's lines by hand is fiddly,
    // off by a brace, and it pulls the eyes off the code; these two let the
    // symbol tree pick the lines. Neither is language-gated on any surface: the
    // file extension constrains where code may be GENERATED and says nothing
    // about what the human may show the model (goal decision 5).
    vscode.commands.registerCommand("column80.contextAddSymbol", async () => {
      const editor = activeEditor();
      if (!editor) {
        return;
      }
      const blocks: ContextBlockRange[] = [];
      for (const cursor of cursorsOf(editor)) {
        const resolved = await resolveBlockAtCursor(editor.document, cursor);
        if (!resolved) {
          continue;
        }
        blocks.push(symbolBlockRange(resolved.firstLine, resolved.symbol.range.end.line));
      }
      addLineBlocks(store, editor.document, blocks, warn, "no function, type or block at the cursor");
    }),

    vscode.commands.registerCommand("column80.contextAddBlock", async () => {
      const editor = activeEditor();
      if (!editor) {
        return;
      }
      const document = editor.document;
      const cursors = cursorsOf(editor);
      // One round trip for every cursor: the provider takes a position list and
      // answers a chain per position.
      const chains = await vscode.commands.executeCommand<vscode.SelectionRange[] | undefined>(
        "vscode.executeSelectionRangeProvider",
        document.uri,
        cursors,
      );
      const blocks: ContextBlockRange[] = [];
      for (let i = 0; i < cursors.length; i++) {
        const resolved = await resolveBlockAtCursor(document, cursors[i]);
        if (!resolved) {
          continue; // Outside every symbol: never fall back to the file.
        }
        const bound = { firstLine: resolved.firstLine, lastLine: resolved.symbol.range.end.line };
        const chosen = chooseChainBlock(flattenChain(chains?.[i]), bound);
        // No usable node in the chain (or no provider at all) falls back to the
        // enclosing symbol, which is a block the human can still see and remove.
        blocks.push(
          chosen
            ? { startLine: chosen.startLine + 1, endLine: chosen.endLine + 1 }
            : symbolBlockRange(bound.firstLine, bound.lastLine),
        );
      }
      addLineBlocks(store, document, blocks, warn, "no block at the cursor");
    }),

    vscode.commands.registerCommand(
      "column80.contextRemove",
      (entry?: ContextBlockEntry) => {
        if (entry) {
          store.remove(entry.id);
        }
      },
    ),
    vscode.commands.registerCommand("column80.contextClear", () => {
      store.clear();
    }),
    vscode.commands.registerCommand(
      "column80.contextMoveUp",
      (entry?: ContextBlockEntry) => {
        if (entry) {
          store.move(entry.id, "up");
        }
      },
    ),
    vscode.commands.registerCommand(
      "column80.contextMoveDown",
      (entry?: ContextBlockEntry) => {
        if (entry) {
          store.move(entry.id, "down");
        }
      },
    ),
  );

  // Editors open before activation never fire the change events above.
  paintEditors();
}
