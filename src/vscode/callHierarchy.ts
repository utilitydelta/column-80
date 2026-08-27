/**
 * The call-hierarchy TRANSPORT: the only file in the discovery feature that
 * imports vscode. It supplies `walkCallers`' injected edges and nothing else, so
 * the walk itself stays pure and testable without a host.
 *
 * MEASURED IN THE REAL HOST (session-v60/progress.md, Phase 0 item 3), against
 * VS Code 1.134.0 with Pylance active rather than the headless pyright:
 *
 *   Python  prepareCallHierarchy 1 item in 226ms, incoming calls resolve, names
 *           BARE, TEST-level granularity, the authored graph reproduced depth
 *           for depth with the unrelated test correctly absent.
 *   TypeScript  same commands work, but the test callers COLLAPSE INTO ONE ITEM
 *           whose kind is `Module` and whose name is the FILE's basename. That
 *           is not an artefact of the headless probe - the vscode command does
 *           it too, which is what puts TypeScript at file granularity.
 */

import * as fs from "fs";
import * as vscode from "vscode";
import { CallerNode } from "../core/callWalk";

/** vscode's own item, recovered from a node's opaque handle. */
function itemOf(node: CallerNode): vscode.CallHierarchyItem | undefined {
  const handle = node.handle;
  // A duck check rather than `instanceof`: the command returns plain objects
  // across the extension-host boundary in some hosts, and an `instanceof` that
  // fails there would silently report "no callers" for every node.
  if (
    handle !== null &&
    typeof handle === "object" &&
    "uri" in handle &&
    "range" in handle &&
    "selectionRange" in handle
  ) {
    return handle as vscode.CallHierarchyItem;
  }
  return undefined;
}

function toNode(item: vscode.CallHierarchyItem): CallerNode {
  return {
    name: item.name,
    filePath: item.uri.fsPath,
    line: item.range.start.line,
    nameLine: item.selectionRange.start.line,
    handle: item,
  };
}

/**
 * The call-hierarchy root for the function at `position`.
 *
 * `undefined` is a RESULT, not an error: it means this server could not place
 * that cursor, and the honest report is that discovery found nothing because it
 * could not start, which is a different sentence from "no test calls this".
 */
export async function prepareCallRoot(
  document: vscode.TextDocument,
  position: vscode.Position,
  log?: (line: string) => void,
): Promise<CallerNode | undefined> {
  let items: vscode.CallHierarchyItem[] | undefined;
  try {
    items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[] | undefined>(
      "vscode.prepareCallHierarchy",
      document.uri,
      position,
    );
  } catch (err) {
    log?.(`[walk] prepareCallHierarchy failed: ${String(err)}`);
    return undefined;
  }
  if (!items || items.length === 0) {
    log?.(`[walk] prepareCallHierarchy returned nothing for ${document.uri.fsPath}:${position.line + 1}`);
    return undefined;
  }
  // The first item is the innermost the server placed at that position. Servers
  // return more than one only for overload sets, and walking every overload
  // would spend the request budget proving the same callers twice.
  return toNode(items[0]);
}

/** `walkCallers`' resolveCallers edge. Never throws: the walk survives a
 *  rejection, but reporting a transport bug AS a server answer would let a
 *  type confusion read as "this function has no callers". */
export function makeResolveCallers(
  log?: (line: string) => void,
): (node: CallerNode) => Promise<readonly CallerNode[]> {
  return async (node) => {
    const item = itemOf(node);
    if (item === undefined) {
      log?.(`[walk] no call-hierarchy handle for ${node.name}; treating as no callers`);
      return [];
    }
    let calls: vscode.CallHierarchyIncomingCall[] | undefined;
    try {
      calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[] | undefined>(
        "vscode.provideIncomingCalls",
        item,
      );
    } catch (err) {
      log?.(`[walk] incoming calls failed for ${node.name}: ${String(err)}`);
      return [];
    }
    return (calls ?? []).map((c) => toNode(c.from));
  };
}

/**
 * A per-gesture cached line reader for classification and exclusion.
 *
 * An OPEN document wins over the file on disk. That is not a nicety: the
 * developer who just added `#[ignore]` to a test and has not saved yet must have
 * THAT read, or the product runs a test its own report says it excluded. Same
 * rule as the block reader, for the same reason.
 *
 * Cached per path because a 300-test discovered set concentrated in a handful of
 * files would otherwise re-read and re-split each file once per test.
 */
export function makeLineReader(): (filePath: string) => readonly string[] | undefined {
  const cache = new Map<string, readonly string[] | undefined>();
  return (filePath) => {
    if (cache.has(filePath)) {
      return cache.get(filePath);
    }
    let lines: readonly string[] | undefined;
    try {
      const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === filePath);
      const text = open ? open.getText() : undefined;
      if (text !== undefined) {
        lines = text.split(/\r?\n/);
      } else {
        // Synchronous by design: classification runs inside the walk's own
        // per-node loop, and an await per node would turn one bounded pass into
        // hundreds of interleaved microtask hops for no gain.
        lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
      }
    } catch {
      // A deleted file, a permission error, a binary path. `undefined` rather
      // than `[]`: the classifier reads `undefined` as "could not be read" and
      // answers from the name alone where a language allows it, while `[]` would
      // read as "an empty file", which is a different and false claim.
      lines = undefined;
    }
    cache.set(filePath, lines);
    return lines;
  };
}
