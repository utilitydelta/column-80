/**
 * The transport for `criticizeReach`: ask the language server where each name
 * the body uses is actually defined.
 *
 * THE SPLIT THIS FILE COMPLETES. `criticizeReach.ts` decides which positions are
 * worth asking about, from a text scan of the masked body. This file asks, and
 * the SERVER answers. Text picks the questions; the symbol tree gives the facts.
 * That is the opposite of a name table, where text would decide the answer.
 *
 * WHY IT EXISTS, in one measured sentence: a blind head-to-head of model-written
 * review comments lost 7-13 on a 27B whose commonest error was inventing a
 * failure mode for a call whose signature says it cannot fail. The signature is
 * a fact. This is where it comes from.
 *
 * EVERY QUERY IS BEST EFFORT AND EACH ONE FAILS ALONE. A server that will not
 * answer for one name costs that name's fact and costs the other twenty-three
 * nothing. A name that does not resolve is reported `unresolved` and is then
 * OMITTED from the prompt: a server that did not answer is not evidence that a
 * name is foreign, and saying so would be the false certainty this whole leg
 * exists to remove.
 */

import * as vscode from "vscode";
import { ReachFact, ReachQuery, ReachWhere } from "../core/criticizeReach";
import { CriticizeLang } from "../core/criticizeLang";
import { calleeDoc } from "../core/criticizeFix";
import { makeLineReader, workspaceRelative } from "./callHierarchy";

/** How long the whole reach pass may take.
 *
 *  A BOUND ON THE PASS, not on each query. Twenty-four sequential round trips at
 *  a bad server's worst latency is a wait a developer would notice, and this
 *  gesture already spends a model round. When it fires the caller gets the facts
 *  gathered so far, which is a shorter prompt rather than a failure. CHOSEN,
 *  recorded in docs/constants.md. */
export const REACH_BUDGET_MS = 4000;

/** Whether a uri sits inside an open workspace folder. */
function inWorkspace(uri: vscode.Uri): boolean {
  return vscode.workspace.getWorkspaceFolder(uri) !== undefined;
}

/** The first definition location a server offers, normalised across the two
 *  shapes providers return. */
function firstTarget(
  answer: unknown,
): { uri: vscode.Uri; line: number } | undefined {
  const list = Array.isArray(answer) ? answer : [];
  for (const item of list) {
    const asLink = item as { targetUri?: vscode.Uri; targetSelectionRange?: vscode.Range; targetRange?: vscode.Range };
    if (asLink?.targetUri !== undefined) {
      const range = asLink.targetSelectionRange ?? asLink.targetRange;
      if (range !== undefined) {
        return { uri: asLink.targetUri, line: range.start.line };
      }
    }
    const asLoc = item as { uri?: vscode.Uri; range?: vscode.Range };
    if (asLoc?.uri !== undefined && asLoc.range !== undefined) {
      return { uri: asLoc.uri, line: asLoc.range.start.line };
    }
  }
  return undefined;
}

/**
 * Resolve every query, within the budget.
 *
 * `fnRange` is the function under review, as 1-based document lines, so a name
 * defined INSIDE it can be told apart from one defined elsewhere in the same
 * file. That distinction is the whole point: a local variable is not evidence
 * about anything, and a helper three functions down the file is.
 */
export async function resolveReach(
  document: vscode.TextDocument,
  queries: readonly ReachQuery[],
  fnRange: { from: number; to: number },
  lang: CriticizeLang,
  log?: (line: string) => void,
): Promise<readonly ReachFact[]> {
  const read = makeLineReader();
  const deadline = Date.now() + REACH_BUDGET_MS;
  const out: ReachFact[] = [];
  let ranOut = false;

  for (const query of queries) {
    if (Date.now() > deadline) {
      ranOut = true;
      break;
    }
    let answer: unknown;
    try {
      answer = await vscode.commands.executeCommand(
        "vscode.executeDefinitionProvider",
        document.uri,
        new vscode.Position(query.line - 1, query.character),
      );
    } catch (err) {
      // One name's query failing is not the pass failing.
      log?.(`[critique] reach: ${query.name} did not resolve (${String(err).split("\n")[0]})`);
      out.push({ name: query.name, line: query.line, where: "unresolved" });
      continue;
    }

    const target = firstTarget(answer);
    if (target === undefined) {
      out.push({ name: query.name, line: query.line, where: "unresolved" });
      continue;
    }

    const sameFile = target.uri.fsPath === document.uri.fsPath;
    const targetLine = target.line + 1;
    let where: ReachWhere;
    if (sameFile && targetLine >= fnRange.from && targetLine <= fnRange.to) {
      where = "this-function";
    } else if (sameFile) {
      where = "this-file";
    } else if (inWorkspace(target.uri)) {
      where = "this-workspace";
    } else {
      where = "external";
    }

    // THE DECLARATION LINE ITSELF, not a hover. Hover text is prose a server
    // composes and varies wildly between the five; the line the definition
    // points at is what the developer wrote, in every language.
    const source = read(target.uri.fsPath);
    const signature = (source?.[target.line] ?? "").trim();
    const doc = source === undefined ? "" : calleeDoc(source, target.line, query.name, lang);

    out.push({
      name: query.name,
      line: query.line,
      where,
      ...(signature === "" ? {} : { signature }),
      ...(where === "this-workspace" ? { definedIn: workspaceRelative(target.uri) } : {}),
      ...(doc.trim() === "" ? {} : { doc }),
    });
  }

  if (ranOut) {
    // NAMED, because a short evidence block and an exhausted budget are
    // different events and a reader of the channel cannot tell them apart
    // otherwise.
    log?.(
      `[critique] reach: the ${REACH_BUDGET_MS}ms budget ran out after ${out.length} of ${queries.length} names; the block is short, not empty`,
    );
  }
  return out;
}
