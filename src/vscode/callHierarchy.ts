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
import { CalleeDoc, CallSiteLine, calleeDoc } from "../core/criticizeFix";
import { CriticizeLang } from "../core/criticizeLang";

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

/**
 * The real upstream CALL LINES for the function at `position`.
 *
 * THE COUNT WAS ALREADY THERE AND THE LINES WERE THROWN AWAY. `blastRadius`
 * drives `walkCallers` over the same two commands and keeps a number, because a
 * number is all the comment's blast clause can spend. But `6 call sites ride on
 * this signature` is the weakest form of the evidence: three lines reading
 * `warm_fs_metadata(lod, shard)` are the transposition argument itself, and a
 * model asked for a fix cannot make that argument from a count.
 *
 * `fromRanges` IS THE POINT. An incoming call names the CALLER, and its
 * `fromRanges` are the ranges of the individual calls INSIDE that caller - so a
 * caller that invokes the target three times contributes three lines rather
 * than one. A caller that arrives with no ranges contributes nothing: its
 * declaration line is not a call site, and printing it as one would put a
 * sentence in front of a model that is not true of the code.
 *
 * `callWalk.ts` IS NOT TOUCHED. It is shared with test discovery, its walk is
 * recursive and bounded for a different job, and widening its node shape to
 * carry call text would put this leg's needs inside a module that discovery
 * depends on. This is one prepare and one incoming-calls request, at the root
 * only, and it answers a different question.
 *
 * BEST EFFORT AND NEVER THROWS. An empty array means the server placed no root,
 * answered with nothing, or gave ranges nothing could be read at - all of which
 * degrade to a prompt with no call-site block, which is arm C.
 */
export async function callSiteLines(
  document: vscode.TextDocument,
  position: vscode.Position,
  cap: number,
  log?: (line: string) => void,
): Promise<readonly CallSiteLine[]> {
  if (!Number.isInteger(cap) || cap <= 0) {
    return [];
  }
  const root = await prepareCallRoot(document, position, log);
  if (root === undefined) {
    return [];
  }
  const item = itemOf(root);
  if (item === undefined) {
    log?.(`[walk] no call-hierarchy handle for ${root.name}; no call lines`);
    return [];
  }
  let calls: vscode.CallHierarchyIncomingCall[] | undefined;
  try {
    calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[] | undefined>(
      "vscode.provideIncomingCalls",
      item,
    );
  } catch (err) {
    log?.(`[walk] incoming calls failed for ${root.name}: ${String(err)}`);
    return [];
  }
  // ONE READER FOR THE WHOLE PASS, so a file holding four of the six call sites
  // is read and split once. It prefers an OPEN document over the bytes on disk,
  // for the same reason discovery does: the caller the developer is editing
  // right now is the one they want quoted.
  const read = makeLineReader();
  const out: CallSiteLine[] = [];
  const seen = new Set<string>();
  for (const call of calls ?? []) {
    const from = call?.from;
    if (from === undefined || from.uri === undefined) {
      continue;
    }
    const lines = read(from.uri.fsPath);
    const file = workspaceRelative(from.uri);
    const ranges = Array.isArray(call.fromRanges) ? call.fromRanges : [];
    for (const range of ranges) {
      if (out.length >= cap) {
        return out;
      }
      const index = range?.start?.line;
      if (typeof index !== "number" || index < 0) {
        continue;
      }
      const text = (lines?.[index] ?? "").trim();
      if (text === "") {
        continue;
      }
      // Two calls on one line, or a server that reports a caller twice, are one
      // piece of evidence. A prompt that shows the same line three times spends
      // the cap proving one thing.
      const key = `${file}:${index}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({ file, line: index + 1, text });
    }
  }
  return out;
}

/**
 * A path a reader recognises, rather than one that starts at `/home`.
 *
 * The absolute path spends prompt characters on the machine the developer is
 * sitting at, and every one of those characters is budget that could have been
 * a call line. `asRelativePath` falls back to the absolute path itself for a
 * file outside every workspace folder, which is the honest answer there.
 */
export function workspaceRelative(uri: vscode.Uri): string {
  try {
    return vscode.workspace.asRelativePath(uri, false);
  } catch {
    // A host whose workspace API is not available (or a uri it will not take).
    // The basename is still a name a reader can place, and it is never a throw
    // on a best-effort leg.
    return uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
  }
}

/**
 * The function's downstream callees, IN THIS WORKSPACE, with whatever contract
 * each one publishes.
 *
 * THE PROVIDER WAS NEVER THE RISK; THE PAYLOAD IS. Session-v64's phase 5 spike
 * measured `vscode.provideOutgoingCalls` on all five servers: implemented
 * everywhere, nothing threw, 1ms to 27ms warm. Then it pointed the same probe at
 * a real 475-file Rust workspace and the goal's own example function came back
 * with 18 callees, every single one of them `std`, carrying 13,249 bytes of
 * standard-library rustdoc and not one sentence about the codebase. A second
 * root returned 70 callees of which 48 were `std`, `clap` or a logging crate.
 *
 * So the three rules below are the leg, and the leg is worthless without them.
 *
 * FILTER TO THE WORKSPACE. A callee outside every workspace folder is dropped.
 * That is the difference between 70 callees and 22, and what it drops is
 * training data the model already has: nothing about `Option::and_then` is
 * news, and every byte of it crowds out the type shapes and the call lines that
 * arms C and D earned.
 *
 * CAP THE PAYLOAD, both the number of callees and the doc text per callee.
 * `calleeDoc` takes the first two lines, which is the summary sentence in all
 * five languages by convention.
 *
 * SAY NOTHING WHEN THERE IS NOTHING. A function whose callees are all external
 * hands back an empty array, and `buildFixPrompt` then emits no block at all -
 * never a heading with nothing under it, which would read as a measurement of
 * an empty answer rather than as an absence.
 *
 * BEST EFFORT AND NEVER THROWS, like every other leg in the context.
 */
export async function calleeDocs(
  document: vscode.TextDocument,
  position: vscode.Position,
  cap: number,
  lang: CriticizeLang,
  log?: (line: string) => void,
): Promise<readonly CalleeDoc[]> {
  if (!Number.isInteger(cap) || cap <= 0) {
    return [];
  }
  const root = await prepareCallRoot(document, position, log);
  if (root === undefined) {
    return [];
  }
  const item = itemOf(root);
  if (item === undefined) {
    log?.(`[walk] no call-hierarchy handle for ${root.name}; no callees`);
    return [];
  }
  let calls: vscode.CallHierarchyOutgoingCall[] | undefined;
  try {
    calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[] | undefined>(
      "vscode.provideOutgoingCalls",
      item,
    );
  } catch (err) {
    log?.(`[walk] outgoing calls failed for ${root.name}: ${String(err)}`);
    return [];
  }
  const read = makeLineReader();
  const out: CalleeDoc[] = [];
  const seen = new Set<string>();
  let external = 0;
  for (const call of calls ?? []) {
    const to = call?.to;
    if (to === undefined || to.uri === undefined) {
      continue;
    }
    if (!inWorkspace(to.uri)) {
      external++;
      continue;
    }
    // THE ROOT IS NOT ITS OWN CALLEE. A recursive function reports itself, and
    // handing the model this function's own doc comment back as a downstream
    // contract is a whole cap slot spent on nothing.
    if (to.uri.fsPath === root.filePath && to.selectionRange?.start?.line === root.nameLine) {
      continue;
    }
    const name = typeof to.name === "string" ? to.name.trim() : "";
    if (name === "") {
      continue;
    }
    // A callee invoked three times in one body is one contract.
    const key = `${to.uri.fsPath}:${name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    // `selectionRange`, NEVER `range`. Some servers put a leading comment
    // inside `range`, so a doc reader starting there would step into the
    // comment it is looking for and report every callee as documented. The
    // spike recorded this as the one trap in counting these.
    const declLine = to.selectionRange?.start?.line ?? to.range?.start?.line;
    const source = read(to.uri.fsPath);
    const doc = typeof declLine === "number" ? calleeDoc(source ?? [], declLine, name, lang) : "";
    // THE DECLARATION LINE ITSELF, not the server's `detail`. Servers disagree
    // wildly about what `detail` holds - a container name, a type, an empty
    // string - while the line the selection range points at is the signature
    // the developer wrote, in every language.
    const signature = typeof declLine === "number" ? (source?.[declLine] ?? "").trim() : "";
    out.push(signature === "" ? { name, doc } : { name, doc, signature });
    if (out.length >= cap) {
      break;
    }
  }
  if (out.length === 0 && external > 0) {
    // NAMED, because a zero here is a fact worth reading: the function's whole
    // downstream is the standard library, and arm E has nothing to add about
    // it. That is the measured common case on leaf functions, which are exactly
    // the functions the signature-level detectors fire on.
    log?.(`[walk] every callee of ${root.name} is outside the workspace (${external}); no callee block`);
  }
  return out;
}

/** Whether a file belongs to a folder the human opened. `getWorkspaceFolder` is
 *  the API's own answer and it handles a multi-root workspace, which a prefix
 *  test against one root does not. */
function inWorkspace(uri: vscode.Uri): boolean {
  try {
    return vscode.workspace.getWorkspaceFolder(uri) !== undefined;
  } catch {
    // No workspace API to ask. Refusing everything is the safe direction: the
    // leg contributes nothing rather than contributing 13KB of rustdoc.
    return false;
  }
}
