/**
 * Every sentence the Run Covering Tests gesture can say, built here and pure, so
 * the WORDING is testable without a host.
 *
 * The honest contract sentence bounds all of it: this gesture finds what the
 * repo's oracles can witness. It does not certify correctness. Each rule below
 * exists to stop one specific false claim, and none of them is a stylistic
 * preference:
 *
 * - A ZERO IS SAID, NEVER GREEN. "0 failed" is a pass shape, and a function no
 *   test reaches has not been checked at all.
 * - A BOUNDED ZERO IS A DIFFERENT SENTENCE from a proven one. Stating a budget
 *   truncation in the words of a fact is the worst thing this file could do.
 * - DISTANCE IS CONFIDENCE. Graded against execution on a real 534-test crate,
 *   every test the walk selected at distance 2 really ran the target and
 *   precision settles near 89% deeper. The report says the distance and lets the
 *   developer read certainty from it, rather than inventing a narrow answer that
 *   is not there.
 */

import { TestOracleResult } from "./compilerOracle";
import { DiscoveryReport } from "./testDiscovery";
import { RunnableTest } from "./testRunGroup";

export interface GroupOutcome {
  key: string;
  /** What the runner said. Undefined when the run did not happen at all. */
  result?: TestOracleResult;
  /** Present when the group could not be run: a spawn failure, a cancel. */
  failure?: string;
  tests: readonly RunnableTest[];
  frameworkName: string;
  /** Does this framework's parse name its own build errors? Decides which
   *  no-run sentence applies, exactly as the shipped `reportNoRun` decides it. */
  classifiesBuildError?: boolean;
}

export interface RunTestsReport {
  /** The channel transcript, many lines. */
  channel: string;
  /** The single toast. As short as honesty allows, and never a newline. The
   *  no-run paths carry a "this is not a pass" clause that makes them three
   *  sentences, and that clause is required rather than optional: without it a
   *  run that executed nothing reads exactly like a run that passed. */
  toast: string;
  severity: "info" | "warning" | "error";
}

export interface RunTestsReportInput {
  symbolName: string;
  languageId: string;
  discovery: DiscoveryReport;
  outcomes: readonly GroupOutcome[];
  /** The scope word for this language: "crate", "module", "project", "package". */
  scopeWord: string;
}

/**
 * The FOURTH no-run outcome: the run produced no result and named no reason.
 * Not a build error, not a filter miss, not an environment error.
 *
 * `runRung` fills `stdout`/`stderr` only when the parse classified nothing, so
 * their presence IS the tell. The second half matters because Rust's parse never
 * fills `buildError` itself and the rung falls back to stderr: a real cargo
 * compile failure therefore arrives here WITH a message and must keep its own
 * "did not compile" sentence. What must not happen is the shape the blind oracle
 * caught - a run with both streams captured and no compiler message at all being
 * reported as "the tests did not compile" followed by "(no output)", which sends
 * the developer hunting a compile error that does not exist.
 *
 * `classifiesBuildError`, when the caller supplies it, is the framework's own
 * answer and wins.
 */
function unclassifiedNoResult(outcome: GroupOutcome, res: TestOracleResult): boolean {
  if (res.stdout === undefined) {
    return false;
  }
  if (outcome.classifiesBuildError === true) {
    return true;
  }
  return (res.buildError ?? "").trim().length === 0;
}

/** Why a walk stopped, in the developer's words and naming the DIAL, so the
 *  sentence points at something they could turn. */
function stopReason(stoppedBy: string): string {
  switch (stoppedBy) {
    case "requests":
      return "the search hit its request cap before the caller graph ran out";
    case "nodes":
      return "the search hit its cap on how many callers it may hold at once";
    case "depth":
      return "the search hit its depth cap with callers still unexplored";
    case "cancelled":
      return "you cancelled the search";
    case "hang-guard":
      return "the language server stopped answering and the hang guard fired";
    default:
      return `the search stopped early (${stoppedBy})`;
  }
}

function pathText(path: readonly string[]): string {
  return path.join(" -> ");
}

/** TypeScript is RULED at FILE granularity. tsserver answers a call-hierarchy
 *  query with the FILE, measured in the real host as a `Module` item named for
 *  the file, so there is no individual test to name and no call path that ends
 *  at one. The report says files, and says what that costs. */
function isFileGranular(languageId: string): boolean {
  return languageId === "typescript" || languageId === "typescriptreact" || languageId === "javascript" || languageId === "javascriptreact";
}

export function renderRunTestsReport(input: RunTestsReportInput): RunTestsReport {
  const { symbolName, discovery, outcomes, scopeWord } = input;
  const fileGranular = isFileGranular(input.languageId);
  const unit = fileGranular ? "test file" : "test";
  const lines: string[] = [];
  lines.push(`[tests] covering ${unit}s for ${symbolName}`);

  // --- The zero cases, which are the two most dangerous sentences here. -----
  if (discovery.discovered.length === 0) {
    if (discovery.provenZero) {
      // The strongest sentence this product makes, and the ONLY one licensed to
      // state a zero as a fact: the walk completed, every node it was allowed to
      // visit was visited, and no request failed.
      lines.push(
        `no ${unit} in this ${scopeWord} calls ${symbolName}, directly or through any caller I could reach.`,
      );
      lines.push(
        `Nothing was run, so this run proved nothing about whether ${symbolName} behaves correctly.`,
      );
      if (discovery.walk.outOfScope > 0) {
        lines.push(
          `${discovery.walk.outOfScope} caller(s) outside this ${scopeWord} were not followed, which is the intended scope.`,
        );
      }
      return {
        channel: lines.join("\n"),
        toast:
          `Column 80: no ${unit} calls ${symbolName} in this ${scopeWord}. Nothing ran, so nothing about its behaviour was checked.`,
        // Warning, never info: an info toast on a zero reads like a pass, and a
        // function no test reaches is the opposite of a checked one.
        severity: "warning",
      };
    }
    // A budget truncation is NOT the sentence above. It names what cut it, so
    // the developer can tell "there are none" from "I stopped looking".
    const why =
      discovery.walk.stoppedBy !== undefined
        ? stopReason(discovery.walk.stoppedBy)
        : `${discovery.walk.failedRequests} caller lookup(s) failed, so part of the graph was never seen`;
    lines.push(`I found no covering ${unit} for ${symbolName}, but the search did not finish: ${why}.`);
    lines.push(
      `That is not the same as there being none. ${discovery.walk.requests} caller lookup(s) were made and ${discovery.walk.nodesAdmitted} caller(s) examined.`,
    );
    return {
      channel: lines.join("\n"),
      toast: `Column 80: found no covering ${unit} for ${symbolName}, but the search did not finish - ${why}. See the output channel.`,
      severity: "warning",
    };
  }

  // --- What was found, nearest first, with the distance and the path. ------
  const runnable = discovery.discovered.filter((d) => d.excluded === undefined && d.unrunnable === undefined);
  const excluded = discovery.discovered.filter((d) => d.excluded !== undefined);
  const unrunnable = discovery.discovered.filter((d) => d.excluded === undefined && d.unrunnable !== undefined);

  lines.push(
    `found ${discovery.discovered.length} covering ${unit}(s); nearest first, and the distance is how many calls separate the ${unit} from ${symbolName}.`,
  );
  for (const entry of discovery.discovered) {
    const label = fileGranular ? entry.filePath : entry.name;
    // A call path ending at a test NAME is meaningless when the item IS a file,
    // so the file-granular report prints the distance and nothing that pretends
    // to name a test.
    const trail = fileGranular ? "" : `  [${pathText(entry.path)}]`;
    lines.push(`  d${entry.distance}  ${label}${trail}`);
  }
  if (fileGranular) {
    lines.push(
      `TypeScript's language server answers this query with the FILE rather than the test, so these are files. A file listed here may also contain tests that never reach ${symbolName}.`,
    );
  }
  if (discovery.walk.stoppedBy !== undefined) {
    lines.push(
      `The search did not finish: ${stopReason(discovery.walk.stoppedBy)}. There may be more covering ${unit}s than these.`,
    );
  }

  if (excluded.length > 0) {
    lines.push(`FOUND BUT NOT RUN (${excluded.length}):`);
    for (const entry of excluded) {
      const where = entry.excluded?.where === "declaration" ? "on the test itself" : entry.excluded?.where === "enclosing" ? "on the type around it" : "on the file";
      lines.push(`  ${fileGranular ? entry.filePath : entry.name}: ${entry.excluded?.marker} (${where})`);
    }
    // Said ONCE, and said whenever anything was excluded: the developer is
    // entitled to know the filter's reach, not just its verdicts.
    lines.push(
      `That filter reads DECLARATION TEXT only. It is a floor, not a guarantee: a test that reaches the network, a shared database or a fixed path without saying so in its declaration is still run.`,
    );
  }
  if (unrunnable.length > 0) {
    lines.push(`FOUND BUT COULD NOT BE RUN (${unrunnable.length}):`);
    for (const entry of unrunnable) {
      lines.push(`  ${fileGranular ? entry.filePath : entry.name}: ${entry.unrunnable}`);
    }
  }

  // --- What happened when they ran. ----------------------------------------
  let passed = 0;
  let failed = 0;
  let ranAnything = false;
  const problems: string[] = [];
  for (const outcome of outcomes) {
    const names = outcome.tests.map((t) => t.filter).join(", ");
    if (outcome.failure !== undefined) {
      lines.push(`  ${outcome.frameworkName}: ${outcome.failure}`);
      problems.push(outcome.failure);
      continue;
    }
    const res = outcome.result;
    if (res === undefined) {
      lines.push(`  ${outcome.frameworkName}: the run did not happen, and named no reason.`);
      problems.push(`${outcome.frameworkName} did not run`);
      continue;
    }
    // The four shipped no-run outcomes keep their own vocabulary rather than a
    // second one being invented beside `reportNoRun`.
    if (!res.ran) {
      if (res.filterMatchedNothing === true) {
        lines.push(
          `  ${outcome.frameworkName}: the filter matched nothing; it selected none of ${names}. Zero tests ran, so this is not a pass.`,
        );
        problems.push(`${outcome.frameworkName} matched no tests`);
      } else if (res.environmentError !== undefined) {
        lines.push(`  ${outcome.frameworkName}: the run could not start.\n${res.environmentError}`);
        problems.push(`${outcome.frameworkName} could not start`);
      } else if (unclassifiedNoResult(outcome, res)) {
        lines.push(
          `  ${outcome.frameworkName}: produced no result, and reported no test, no failure and no reason.\nstdout:\n${res.stdout || "(empty)"}\nstderr:\n${res.stderr || "(empty)"}`,
        );
        problems.push(`${outcome.frameworkName} produced no result`);
      } else {
        lines.push(`  ${outcome.frameworkName}: the tests did not compile.\n${res.buildError ?? "(no output)"}`);
        problems.push(`the tests did not compile`);
      }
      continue;
    }
    ranAnything = true;
    passed += res.passed;
    failed += res.failed;
    if (res.failed > 0) {
      lines.push(`  ${outcome.frameworkName}: ${res.failed} failed, ${res.passed} passed.`);
      for (const failure of res.failures) {
        lines.push(`    ${failure.name}:\n${failure.message.replace(/^/gm, "      ")}`);
      }
    } else if (res.passed + res.failed === 0) {
      lines.push(`  ${outcome.frameworkName}: every selected test was SKIPPED. Nothing passed and nothing failed.`);
      problems.push(`${outcome.frameworkName} skipped everything`);
    } else {
      lines.push(`  ${outcome.frameworkName}: ${res.passed} passed.`);
    }
  }

  if (failed > 0) {
    const near = runnable.length > 0 ? Math.min(...runnable.map((t) => t.distance)) : undefined;
    return {
      channel: lines.join("\n"),
      toast:
        `Column 80: ${failed} covering test(s) failed for ${symbolName} (${passed} passed` +
        `${near === undefined ? "" : `, nearest at distance ${near}`}). See the output channel.`,
      severity: "warning",
    };
  }
  if (!ranAnything) {
    return {
      channel: lines.join("\n"),
      toast: `Column 80: no covering ${unit} actually ran for ${symbolName} - ${problems[0] ?? "the runner produced no result"}. This is not a pass. See the output channel.`,
      severity: "error",
    };
  }
  // A green run states what passed and how far away it was, and stops there. It
  // does not say the function is correct: the tests that passed are the tests
  // that were found, and finding them is not the same as covering the behaviour.
  const distances = runnable.map((t) => t.distance);
  const nearest = distances.length > 0 ? Math.min(...distances) : undefined;
  const farthest = distances.length > 0 ? Math.max(...distances) : undefined;
  lines.push(
    `${passed} covering ${unit}(s) passed. They are what this ${scopeWord}'s own tests reach; passing is not a statement that ${symbolName} is right.`,
  );
  const spread =
    nearest === undefined
      ? ""
      : nearest === farthest
        ? ` at distance ${nearest}`
        : ` at distances ${nearest} to ${farthest}`;
  return {
    channel: lines.join("\n"),
    toast:
      `Column 80: ${passed} covering ${unit}(s) passed for ${symbolName}${spread}` +
      `${excluded.length > 0 ? `; ${excluded.length} found but not run` : ""}.`,
    severity: "info",
  };
}
