/**
 * What is running, and how to stop it.
 *
 * THIS IS THE RULED REPLACEMENT FOR A WATCHDOG, not a convenience beside one.
 * Roadmap item 67 asked whether fn-gen should cut a server that goes quiet, and
 * the answer on 2026-08-22 was no: users run different hardware, so any silence
 * bound is a guess about someone else's machine and a wrong guess kills a
 * generation the user asked for. What replaces it is this - the in-flight state
 * visible for as long as it lasts, and cancel one obvious action away.
 *
 * THE DEFECT THAT MAKES IT NECESSARY. Before this, cancel lived only inside the
 * four `withProgress` notifications, each wiring an `AbortController` to its
 * cancellation token. A notification is dismissable. Dismiss it and the cancel
 * goes with it: the generation runs on against a hung server, nothing on screen
 * says so, and there is no way to stop it - which is exactly the state a
 * watchdog was proposed to rescue. Cancellation only replaces a watchdog if it
 * outlives the notification, so this lives in the status bar instead.
 *
 * A LEAF, deliberately. `fnGen.ts` registers the gestures and `extension.ts`
 * registers `fnGen`, so anything both of them touch must take an edge from
 * neither. This imports `vscode` and nothing of ours.
 */

import * as vscode from "vscode";

/** What one caller gives up when its work ends, however it ends. Idempotent:
 *  calling it twice releases one claim, not two, so a `finally` beside an early
 *  return cannot double-release and retire the item while work is still live. */
export interface InFlightClaim {
  release(): void;
}

/** The command a click on the item runs, and the one a user may bind to a key.
 *  Exported so the registration and the item's `command` cannot drift apart. */
export const CANCEL_COMMAND = "column80.cancelGeneration";

/** Whether a throw is the user's own cancellation rather than a failure.
 *
 *  NAME ONLY, deliberately. `firstRun.ts`'s private `isAbort` also runs
 *  `/abort/i` over the whole message, which means a server whose error body
 *  says "aborted upstream" is classified as a user cancellation and the failure
 *  disappears with no toast at all. A new check must not copy that: the name
 *  is the reliable signal, the message is the server's.
 *
 *  `DOMException` with `name === "AbortError"` is what `fetch` rejects with, and
 *  what the transports' own `abortError()` helpers construct. */
export function isCancellation(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * The registry. One per extension activation, disposed with it.
 *
 * Counts CLAIMS rather than tracking a single current generation, because two
 * gestures can hold one at the same moment even though the service behind them
 * is single-flight: starting a second generation aborts the first at the
 * transport, and the first's `finally` then runs a beat later. The item must
 * survive that overlap and retire only when the last claim goes.
 */
export class InFlightRegistry {
  /** Undefined when the host has no status bar, and cleared if it turns out to
   *  have a broken one. See the constructor and `render`. */
  private item: vscode.StatusBarItem | undefined;
  private readonly live = new Map<number, { label: string; controller: AbortController }>();
  private nextId = 1;

  constructor(
    private readonly log?: (line: string) => void,
    item?: vscode.StatusBarItem,
  ) {
    // DEFENSIVE about the host, on the precedent three functions away:
    // `withVerifyStatus` in `fnGen.ts` guards its own status-bar use with
    // "Defensive for headless stubs that do not implement setStatusBarMessage".
    //
    // It is not only about stubs, which is why it is a guard rather than a test
    // accommodation. A host that does not implement `createStatusBarItem` must
    // not lose FUNCTION GENERATION over a missing badge, and the degradation is
    // honest: without an item there is no click target, but the command still
    // exists, is still bindable, and `cancelAll` still aborts everything in
    // flight. The affordance loses its most visible surface and keeps its
    // function.
    //
    // Right-aligned with a high priority so it sits near the language and
    // problem indicators rather than out past every other extension's badge.
    // The item this product needs a user to FIND is not one to hide.
    if (item !== undefined) {
      this.item = item;
    } else if (
      typeof vscode.window.createStatusBarItem === "function" &&
      vscode.StatusBarAlignment
    ) {
      this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    } else {
      this.item = undefined;
      // Said once, at construction, rather than per generation: a host without
      // a status bar produces this line once and never mentions it again.
      this.log?.("[cancel] no status bar on this host; cancel is command-only");
    }
    if (this.item !== undefined) {
      this.item.command = CANCEL_COMMAND;
      // Named, so the "Manage status bar items" menu lists it as itself. An
      // item whose whole job is to be FOUND by a user should not appear in the
      // menu that hides and shows it under a generic label.
      this.item.name = "Column 80 Generation";
    }
  }

  /** Announce work. The returned claim must be released in a `finally`: a
   *  gesture that throws still has to give the item back, and a throw is the
   *  ordinary way a failed generation ends. */
  begin(label: string, controller: AbortController): InFlightClaim {
    const id = this.nextId++;
    this.live.set(id, { label, controller });
    this.render();
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.live.delete(id);
        this.render();
      },
    };
  }

  /** Stop everything in flight. What the command and a click both call.
   *
   *  Aborting is all this does: each caller's own `finally` releases its claim,
   *  so the item retires through the ordinary path rather than being hidden
   *  here. Hiding it directly would leave the item gone while the work was
   *  still unwinding, which is the same lie the dismissable notification told.
   *
   *  Returns how many were cancelled, so a caller can tell "nothing to do" from
   *  "stopped two" without reading private state. */
  cancelAll(): number {
    const claims = [...this.live.values()];
    if (claims.length === 0) {
      // Not a warning and not a toast: a user who binds this to a key will
      // press it with nothing running, and that is not a mistake worth a
      // notification.
      this.log?.("[cancel] nothing in flight");
      return 0;
    }
    this.log?.(`[cancel] cancelling ${claims.length}: ${claims.map((c) => c.label).join(", ")}`);
    for (const claim of claims) {
      claim.controller.abort();
    }
    return claims.length;
  }

  /** How many claims are live. For tests and for a caller deciding whether to
   *  say anything. */
  count(): number {
    return this.live.size;
  }

  dispose(): void {
    this.item?.dispose();
  }

  private render(): void {
    const item = this.item;
    if (item === undefined) {
      // No status bar on this host. The claims are still tracked and
      // `cancelAll` still works; there is simply nothing to draw.
      return;
    }
    try {
      this.draw(item);
    } catch {
      // TRY/CATCH OVER THE USE, not a wider `typeof` probe, and the difference
      // is the point. The constructor checks `createStatusBarItem` and
      // `StatusBarAlignment`; this method also needs `MarkdownString`. Probing
      // that too would just move the boundary to whichever API is added next.
      //
      // What this protects is not the badge, it is the GENERATION. `begin` is
      // called inside every gesture's `withProgress` callback, so a throw from
      // here kills the generation and toasts a failure - on a host that merely
      // lacks a drawing API. And a throw between `live.set` and the returned
      // handle would strand the claim forever: the count never returns to zero,
      // the item never retires, and `cancelAll` keeps aborting a dead
      // controller.
      //
      // So the item is dropped and the registry degrades to exactly the
      // command-only behaviour a host with no status bar already gets. Said
      // once, because the item is gone after the first failure and every later
      // render takes the no-item path above.
      this.item = undefined;
      this.log?.("[cancel] status bar unusable on this host; cancel is command-only");
      try {
        item.dispose();
      } catch {
        // A host that cannot draw may not be able to dispose either. Nothing
        // downstream depends on it.
      }
    }
  }

  private draw(item: vscode.StatusBarItem): void {
    const claims = [...this.live.values()];
    if (claims.length === 0) {
      item.hide();
      return;
    }
    // `$(sync~spin)` on the product's own precedent, `withVerifyStatus`. The
    // spinner is what says the work is still alive; a static icon beside a hung
    // server would read as a stuck badge rather than a running generation.
    const head = claims[0].label;
    const more = claims.length > 1 ? ` +${claims.length - 1}` : "";
    item.text = `$(sync~spin) Column 80: ${head}${more}`;
    // BOTH halves, and the second is a ruling. The v32 ruling forbids shipping
    // a default keybinding, and the human's suggestion of Escape is served by
    // making the command bindable and saying so. There is nowhere in
    // `contributes.commands` to say it - the manifest has a title and no
    // description - so it is said here, which is where a user stands at the
    // moment they want to stop something.
    item.tooltip = new vscode.MarkdownString(
      `${claims.map((c) => `Column 80: ${c.label}`).join("\n\n")}\n\n` +
        "Click to cancel. You can also bind `Column 80: Cancel Generation` to a keyboard shortcut.",
    );
    item.show();
  }
}
