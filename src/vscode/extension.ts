import * as vscode from "vscode";
import { CompletionService } from "../core/completionService";
import { ContextBlockStore } from "../core/contextBlocks";
import { generateFim, hasModel, listModels } from "../core/ollama";
import { DEFAULT_PROBE_TIMEOUT_MS, ProbeCommandFn, probeCommandRunner } from "../core/hardware";
import { sessionSuppressions } from "../core/suppressionLedger";
import { readConfig, readOracleConfig } from "./config";
import { registerDictation } from "./dictation";
import { DOCUMENT_SCHEMES, canMintEntries, isDocumentScheme } from "./documentSchemes";
import { FimCompletionProvider, REAL_SCOPE_HOOKS } from "./completionProvider";
import { registerContextPanel } from "./contextPanel";
import { offerRaHoverCapFix, offerRaSnippetFix, registerFirstRun, startOllamaTerminal } from "./firstRun";
import { registerCriticize } from "./criticize";
import { registerCriticizeAdvise } from "./criticizeAdviseCommand";
import { registerFnGen, resolveFunctionAtCursor, resolvePrefill } from "./fnGen";
import { extractorFor } from "./extractors";
import { registerOracleSurface } from "./oracleSurface";

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel("Column 80");
  context.subscriptions.push(channel);
  // With C80_LOG_FILE set, every channel line is also appended to that file.
  // The VS Code integration tier runs in a separate extension host whose
  // output channel no test can read, so without this a failing gesture there
  // reports only that nothing landed - never which of the provider's several
  // silent refusals produced the silence. Off unless the variable is set, and
  // failures to write are swallowed: a broken log path must not break FIM.
  const logFile = process.env.C80_LOG_FILE;
  const output: vscode.OutputChannel = logFile
    ? new Proxy(channel, {
        get(target, prop) {
          if (prop === "appendLine") {
            return (line: string) => {
              target.appendLine(line);
              try {
                require("fs").appendFileSync(logFile, `${line}\n`);
              } catch {
                /* a log path that cannot be written is not worth a keystroke */
              }
            };
          }
          const v = Reflect.get(target, prop, target);
          return typeof v === "function" ? v.bind(target) : v;
        },
      })
    : channel;

  const log = (line: string) => output.appendLine(line);
  // The session's suppression ledger is handed in, not owned by the service:
  // this factory runs again on every settings change, and a count that zeroed
  // itself whenever the human touched a knob would be useless at exactly the
  // moment they are reading it. The provider counts its in-comment suppressions
  // against the same ledger.
  const newService = () => new CompletionService(readConfig(), generateFim, log, sessionSuppressions);

  // The service snapshots its config at construction, so a settings change
  // must swap in a fresh instance or the old model/apiBase would stick until
  // reload. The provider reaches the current one through the getter.
  let service = newService();
  // The rust-analyzer snippet nudge fires from the provider's member-site path
  // because that is the only place with evidence rust-analyzer is actually
  // running. It settles itself after one answer, and a rejected promise here
  // must never reach the completion path, which is why it is caught rather than
  // awaited.
  const provider = new FimCompletionProvider(
    () => service,
    output,
    (languageId) => {
      // The hover nudge waits for the snippet offer to SETTLE, and the await is
      // the whole point: both are modeless toasts, and launching them in the
      // same tick puts two questions about rust-analyzer's configuration on
      // screen at once. The snippet nudge goes first because it is about the
      // gesture the developer is in the middle of; this one is about what the
      // block carries.
      //
      // Each keeps its own catch, so a snippet failure does not swallow the
      // hover offer, and neither can reach the completion path.
      void offerRaSnippetFix(context, languageId, output)
        .catch((err) => output.appendLine(`[carve] ra snippet nudge failed: ${String(err)}`))
        .then(() =>
          offerRaHoverCapFix(context, languageId, output).catch((err) =>
            output.appendLine(`[carve] ra hover cap nudge failed: ${String(err)}`),
          ),
        );
    },
    {
      ...REAL_SCOPE_HOOKS,
      // The passive preselect's window has closed. Nothing re-invokes an
      // inline provider on the passage of time, so the expired ghost would
      // stay on screen until the next keystroke; this asks the editor for the
      // request that swaps it back to the unscoped completion. The provider
      // marks that one request as its own so it is not dispatched as a manual
      // fan-out.
      //
      // HIDE, then trigger, and the hide is what makes the swap possible.
      // `inlineSuggest.trigger` is VS Code's EXPLICIT trigger: it re-runs the
      // providers, but it also preserves the currently DRAWN item by
      // identity, prepends it at index 0 and re-selects it - so a bare
      // trigger here re-renders the very scoped ghost the expiry exists to
      // replace, with the unscoped answer parked at index 1 behind Alt+]
      // (VS Code 1.130, inlineCompletionsSource.ts L672-686 /
      // inlineCompletionsModel.ts L553-570; live-verified - the full source
      // chain and the live arm table are in docs/architecture/vscode-layer.md,
      // "The explicit trigger preserves the drawn item"). Hiding first leaves
      // nothing to
      // preserve. Two costs, both owned: with a ghost on screen the hide
      // files a real REJECTED end-of-life for it - defensible, the window
      // elapsed without a Tab, which is as close to a rejection as this
      // gesture has - and the swap costs a blink. On the zero-serve
      // hand-back path that shares this hook, nothing is drawn and the hide
      // is a no-op REJECTED-wise: `stop('explicitCancel')` files Rejected
      // only when an inlineCompletion exists (inlineCompletionsModel.ts
      // L507-519).
      //
      // A failed hide does not cancel the trigger. Worst case it degrades to
      // the ghost not swapping; skipping the re-render as well loses the
      // request that a working hide needs.
      onExpired: () => {
        void Promise.resolve(vscode.commands.executeCommand("editor.action.inlineSuggest.hide"))
          .then(undefined, (err) => output.appendLine(`[fim] scope re-render hide failed: ${String(err)}`))
          .then(() => vscode.commands.executeCommand("editor.action.inlineSuggest.trigger"))
          .then(undefined, (err) =>
            output.appendLine(`[fim] scope re-render failed: ${String(err)}`),
          );
      },
      // Gates the second-Escape keybinding. Fired only on a change, so this is
      // a command round trip per transition rather than per keystroke.
      onScopedGhost: (visible) => {
        void Promise.resolve(
          vscode.commands.executeCommand("setContext", "column80.scopedGhost", visible),
        ).then(undefined, (err) => output.appendLine(`[fim] scope context key failed: ${String(err)}`));
      },
    },
  );

  // One shared store: the panel mutates it, fn-gen reads it at generate
  // time. It outlives config-change service rebuilds on purpose — a
  // settings tweak must not silently drop the user's chosen context.
  const store = new ContextBlockStore(log);
  const modelGestures = registerFnGen(context, output, store);
  registerContextPanel(context, store);
  // Criticize: one command, no default keybinding, and it PROPOSES A DIFF. It
  // reaches the tier gate, the transport, the in-flight registry AND THE ONE
  // PRESENTER through the record `registerFnGen` hands back, so the explainer
  // sits behind the SAME fail-closed consult every other model-call gesture
  // makes, this file takes no second copy of that decision, and the gesture
  // becomes the third caller of the extension's single document write rather
  // than a fourth write path. It wrote nothing in v61 and this comment said so;
  // the human reversed that ruling in v62 and a stale claim above the call that
  // hands over the write is worse than no claim at all.
  registerCriticize(context, output, {
    resolveFunction: resolveFunctionAtCursor,
    // THE SAME TYPE RESOLVE REPAIR IS HANDED, and it is what turns the fix
    // sentence from a restatement of the signature into advice about this
    // codebase: `shard: u64` is already on the head, and whether `Budget` is a
    // struct with three fields or a newtype over `u64` is what decides whether
    // "make them newtypes" is right here. Both are optional on the record, so a
    // registration that omitted them would still ship a complete card and a
    // complete comment - one block shorter.
    resolvePrefill,
    // GATED THE WAY EVERY OTHER RESOLVE IS. `injectionEnabled` is the switch
    // that keeps the v2 compiler-directed extractor dark, and a gesture that
    // reached past it would point a language-server query at a document the
    // human turned that off for.
    extractorFor: (languageId) =>
      readOracleConfig().injectionEnabled ? extractorFor(languageId) : undefined,
    ...modelGestures,
  });
  // THE MODEL-AUTHORED PATH, as a SECOND command on the SAME wiring record.
  // Sharing the record is the point: both gestures resolve the function the same
  // way, consult the same tier gate, read the same transport and go through the
  // same presenter, so a comparison between them is a comparison of the ROUND in
  // the middle and not of two different products. It ships alongside the rubric
  // rather than replacing it until a measurement says which plants the better
  // comment.
  registerCriticizeAdvise(context, output, {
    resolveFunction: resolveFunctionAtCursor,
    resolvePrefill,
    extractorFor: (languageId) =>
      readOracleConfig().injectionEnabled ? extractorFor(languageId) : undefined,
    ...modelGestures,
  });
  registerOracleSurface(context, output);
  registerFirstRun(context, output);
  // Dictate-then-FIM: the resident recogniser starts here (after the model's ratified
  // download), and the gesture arms one intent on the provider per press.
  registerDictation(context, output, { armIntent: (intent) => provider.armIntent(intent) });

  context.subscriptions.push(
    // Cross-file staleness: an edit in a REAL document evicts OTHER files'
    // cached completions and injection blocks (a member rename in one file
    // must not leave another file's ghost offering the old name). The edited
    // file's own entries stay - version keys and the prefix-walk own those.
    // Allowlisted to documents that can actually MINT an entry, both halves:
    // SCM commit boxes and the other non-document buffers fire this event and
    // change no completable surface, and since v29 neither does a markdown or
    // JSON buffer, which passes the scheme half (documentSchemes.ts).
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (
        e.contentChanges.length > 0 &&
        canMintEntries(e.document.uri.scheme, e.document.languageId, () => readConfig().fimLanguages)
      ) {
        const uri = e.document.uri.toString();
        service.onDocumentChanged(uri);
        provider.onDocumentChanged(uri);
      }
    }),
    // A passive preselect's window is armed with a timer, and a cursor move
    // provokes no completion request, so nothing else would ever tell the
    // provider the site it is holding is behind the user. Same scheme
    // allowlist as the edit hook above, for the same reason.
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (isDocumentScheme(e.textEditor.document.uri.scheme)) {
        const at = e.selections[0]?.active;
        if (at) {
          provider.onCursorMoved(e.textEditor.document.uri.toString(), at.line, at.character);
        }
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("column80")) {
        service.dispose();
        service = newService();
        output.appendLine("[fim] config changed, service rebuilt");
      }
    }),
    // Real document schemes only: `pattern: "**"` alone matches every
    // scheme, which fed the FIM model SCM commit boxes, output views, and
    // other non-document buffers. The SAME list drives eviction above.
    vscode.languages.registerInlineCompletionItemProvider(
      DOCUMENT_SCHEMES.map((scheme) => ({ scheme })),
      provider,
    ),
    // The second Escape. The first closed the suggest widget and left the ghost
    // scoped to the highlighted member; this one drops that scope and asks for
    // the provider's own completion instead, which is the 1500ms window's fast
    // path. Bound to Escape behind `column80.scopedGhost`, so it is reachable
    // only in the state it is about.
    //
    // A false return means the keybinding fired against a scope that had
    // already gone (an expiry, an edit, a race with the context key). The
    // developer pressed Escape and must get the Escape they pressed, so it
    // falls through to the editor's own dismissal rather than eating the key.
    vscode.commands.registerCommand("column80.dismissScopedGhost", async () => {
      const dismissed = provider.dropScope();
      try {
        if (!dismissed) {
          await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");
          return;
        }
        // Two things are on screen and BOTH have to go before the re-render.
        //
        // The scoped ghost, first: an explicit trigger preserves whatever is
        // currently drawn (`onExpired` above spells out the mechanism), so
        // without this the ghost the developer is asking to drop is re-selected
        // and the unscoped one lands at index 1. It goes before the widget
        // close because closing the widget can itself provoke a re-invocation,
        // and a hide issued after that one can land on the ghost this gesture
        // exists to produce.
        //
        // Then the widget: VS Code draws an inline ghost while the suggest
        // widget is open only if that ghost EXTENDS the highlighted item. The
        // unscoped completion names a different member entirely, so a widget
        // still up - or one that re-opens during the round trip - makes the
        // editor drop the item without a word.
        //
        // A failed hide is logged and swallowed rather than abandoning the
        // gesture: the developer pressed Escape and still gets the request they
        // pressed it for, degraded at worst to the ghost not swapping.
        try {
          await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");
        } catch (err) {
          output.appendLine(`[fim] scope dismissal hide failed: ${String(err)}`);
        }
        await vscode.commands.executeCommand("hideSuggestWidget");
        await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
      } catch (err) {
        output.appendLine(`[fim] scope dismissal failed: ${String(err)}`);
      }
    }),
    // A DIAGNOSTIC, not a feature. VS Code derives `selectedCompletionInfo` from
    // the highlighted suggest item, and when it cannot, it stops re-requesting
    // inline completions as the user arrows - the provider is simply never
    // invoked and there is nothing for the product to log. That failure is
    // invisible from inside the product and it is language-server specific: the
    // same editor re-invokes for rust-analyzer and not for a C# session where
    // the widget is demonstrably open and moving.
    //
    // This dumps what the language server actually returns at the cursor, in the
    // shape that governs that decision: a snippet insertText, an item whose
    // range does not start at the word being typed, or a lazily-resolved item
    // are each a reason the adaptor gives up.
    vscode.commands.registerCommand("column80.dumpCompletionItems", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined) {
        output.appendLine("[diag] no active editor");
        return;
      }
      const pos = editor.selection.active;
      try {
        const list = await vscode.commands.executeCommand<vscode.CompletionList>(
          "vscode.executeCompletionItemProvider", editor.document.uri, pos, ".",
        );
        const items = list?.items ?? [];
        output.appendLine(
          `[diag] ${editor.document.languageId} at ${pos.line}:${pos.character}` +
            ` — ${items.length} items, incomplete=${(list as { isIncomplete?: boolean })?.isIncomplete}`,
        );
        for (const item of items.slice(0, 25)) {
          const label = typeof item.label === "string" ? item.label : item.label.label;
          const insert = item.insertText;
          const insertKind =
            insert === undefined ? "none" : typeof insert === "string" ? "string" : "SnippetString";
          const insertText =
            insert === undefined ? "" : typeof insert === "string" ? insert : insert.value;
          const r = item.range;
          const range =
            r === undefined
              ? "none"
              : "start" in r
                ? `${r.start.character}-${r.end.character}`
                : `ins ${r.inserting.start.character}-${r.inserting.end.character}` +
                  ` rep ${r.replacing.start.character}-${r.replacing.end.character}`;
          output.appendLine(
            `[diag]   ${JSON.stringify(label)} kind=${vscode.CompletionItemKind[item.kind ?? 0]}` +
              ` insert=${insertKind}:${JSON.stringify(insertText)} range=${range}` +
              ` filter=${JSON.stringify(item.filterText ?? null)}` +
              ` command=${item.command?.command ?? "none"}` +
              ` extraEdits=${item.additionalTextEdits?.length ?? 0}`,
          );
        }
        output.show(true);
      } catch (err) {
        output.appendLine(`[diag] completion dump failed: ${String(err)}`);
      }
    }),
    vscode.commands.registerCommand("column80.toggle", async () => {
      const c = vscode.workspace.getConfiguration("column80");
      // Write to the scope that currently controls the effective value —
      // a Global write under a workspace override is a silent no-op.
      const info = c.inspect<boolean>("enabled");
      const target =
        info?.workspaceFolderValue !== undefined
          ? vscode.ConfigurationTarget.WorkspaceFolder
          : info?.workspaceValue !== undefined
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
      const currentlyEnabled = c.get<boolean>("enabled", true);
      // On-but-silent is the confusing state: a plain flip here just turns a
      // non-working feature off, so reaching the "start the server" prompt took
      // a second toggle. Instead, offer the fix in one press; only proceed to
      // disable if the user asks for it (or autocomplete is actually working).
      if (currentlyEnabled) {
        const decision = await resolveToggleWhileEnabled(output);
        if (decision === "leave-enabled") {
          return; // fix offered or dismissed — the setting stays on, no write
        }
      }
      const next = !currentlyEnabled;
      try {
        await c.update("enabled", next, target);
      } catch (err) {
        output.appendLine(
          `[fim] toggle failed: could not write 'enabled' at ${vscode.ConfigurationTarget[target]}: ${String(err)}`,
        );
        return;
      }
      // Log the effective value after the write, not the intent before it.
      const effective = vscode.workspace
        .getConfiguration("column80")
        .get<boolean>("enabled", true);
      if (effective === next) {
        output.appendLine(
          `[fim] autocomplete ${effective ? "enabled" : "disabled"} (${vscode.ConfigurationTarget[target]})`,
        );
      } else {
        output.appendLine(
          `[fim] toggle wrote ${next} at ${vscode.ConfigurationTarget[target]} but effective value is ${effective} (overridden in another scope)`,
        );
      }
      // Enabling from off is only half the story: with no server or no model,
      // the setting is true but no ghost ever appears. Check readiness now and
      // offer the fix, so "enabled but silent" is never a mystery.
      if (effective === true && next === true) {
        await warnIfFimNotReady(output);
      }
    }),
    { dispose: () => service.dispose() },
  );

  output.appendLine("[fim] extension activated");
  // A freshness + config beacon: seeing this line on activation confirms the
  // Extension Host is running THIS build, and whether v2 injection is on.
  output.appendLine(
    `[oracle] compiler-directed injection: ${
      readOracleConfig().injectionEnabled ? "ON" : "off"
    } (v2: surface injection, in-span qualify, missing-dependency guard)`,
  );
}

export function deactivate(): void {}

/** Why enabled FIM autocomplete still produces no ghost text: the server is
 *  down, or it is up but the FIM model is not pulled. null means ready. */
type FimIssue = { kind: "server-down" } | { kind: "model-missing"; model: string };

/** One listModels call answers both "is the server up" and "is the FIM model
 *  pulled" — the readiness the ghost-text path depends on. */
async function fimReadiness(list: typeof listModels): Promise<FimIssue | null> {
  const cfg = readConfig();
  const models = await list(cfg.apiBase);
  if (models === undefined) {
    return { kind: "server-down" };
  }
  return hasModel(models, cfg.model) ? null : { kind: "model-missing", model: cfg.model };
}

/** After FIM autocomplete is enabled from off, verify the pieces that make
 *  ghost text appear and offer the fix for whichever is missing. Server down →
 *  the same "Start ollama serve" gesture the first-run and generate paths use;
 *  server up but the FIM model absent → point at the ratified download. All
 *  quiet when everything is ready. */
export async function warnIfFimNotReady(
  output: vscode.OutputChannel,
  list: typeof listModels = listModels,
  ollamaCheck: ProbeCommandFn = probeCommandRunner(DEFAULT_PROBE_TIMEOUT_MS),
): Promise<void> {
  const issue = await fimReadiness(list);
  if (issue === null) {
    return;
  }
  if (issue.kind === "server-down") {
    output.appendLine("[fim] enabled but server unreachable; offering start");
    const choice = await vscode.window.showWarningMessage(
      "Column 80: FIM autocomplete is on, but the Ollama server isn't running — no ghost text will appear until it is.",
      "Start ollama serve",
    );
    if (choice === "Start ollama serve") {
      await startOllamaTerminal(output, ollamaCheck);
    }
    return;
  }
  output.appendLine(`[fim] enabled but model ${issue.model} not installed; pointing at download`);
  void vscode.window.showInformationMessage(
    `Column 80: FIM autocomplete is on, but its model (${issue.model}) isn't installed. Run "Column 80: Select Hardware Tier" to download it.`,
  );
}

/** The toggle press while autocomplete is ALREADY enabled. When it is working,
 *  honour the turn-off. When it is on-but-silent (server down / model missing),
 *  a press is almost certainly "make it work", not "turn it off" — so surface
 *  the fix in one press and keep disabling reachable via a second button,
 *  instead of the old flip-to-off that forced a second toggle to reach the
 *  prompt. Returns whether the caller should proceed to write enabled=false. */
export async function resolveToggleWhileEnabled(
  output: vscode.OutputChannel,
  list: typeof listModels = listModels,
  ollamaCheck: ProbeCommandFn = probeCommandRunner(DEFAULT_PROBE_TIMEOUT_MS),
): Promise<"disable" | "leave-enabled"> {
  const issue = await fimReadiness(list);
  if (issue === null) {
    return "disable"; // functioning normally → a toggle press means turn it off
  }
  if (issue.kind === "server-down") {
    output.appendLine("[fim] toggled while on-but-server-down; offering start or disable");
    const choice = await vscode.window.showWarningMessage(
      "Column 80: FIM autocomplete is on, but the Ollama server isn't running — no ghost text appears. Start the server, or turn autocomplete off?",
      "Start ollama serve",
      "Disable autocomplete",
    );
    if (choice === "Start ollama serve") {
      await startOllamaTerminal(output, ollamaCheck);
      return "leave-enabled";
    }
    return choice === "Disable autocomplete" ? "disable" : "leave-enabled";
  }
  output.appendLine(`[fim] toggled while on-but-model-${issue.model}-missing; offering disable`);
  const choice = await vscode.window.showWarningMessage(
    `Column 80: FIM autocomplete is on, but its model (${issue.model}) isn't installed — no ghost text appears. Run "Column 80: Select Hardware Tier" to download it, or turn autocomplete off?`,
    "Disable autocomplete",
  );
  return choice === "Disable autocomplete" ? "disable" : "leave-enabled";
}
