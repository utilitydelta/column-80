import * as vscode from "vscode";
import { SurfaceExtractor } from "../core/extraction";
import { TS_LANGUAGE_IDS } from "../core/tsExtraction";
import { RaCommandExtractor, createRaCommandRunner, createRaTextReader } from "./raExtractor";
import { TsCommandExtractor, TsCommandRunner, TsSymbolRunner, TsTextReader } from "./tsExtractor";
import { CsCommandExtractor, CsCommandRunner, CsSymbolRunner, CsTextReader } from "./csExtractor";
import { PyCommandExtractor, PyCommandRunner, PySymbolRunner, PyTextReader } from "./pyExtractor";
import { GoCommandExtractor, GoCommandRunner, GoSymbolRunner, GoTextReader } from "./goExtractor";

/**
 * The extractor registry: surface injection's analog of core's oracleFor.
 * A language can carry an oracle (check/repair) before it has an extractor
 * (resolution), so every injection gate keys on THIS registry, never on
 * oracleFor — a language with a checker but no resolver keeps the injection
 * gesture dark instead of pointing a foreign language server query at the
 * document. Extractors are cheap to build (they hold no process), so a
 * fresh instance per call is fine.
 */

// TS_LANGUAGE_IDS covers the four ids the TS server serves. Untyped-JS honesty
// is NOT gated here: javascript/javascriptreact get the extractor, and an
// inferred-any receiver legitimately resolves an empty surface (the
// transport's darkness pin).
export function extractorFor(languageId: string): SurfaceExtractor | undefined {
  if (languageId === "rust") {
    return new RaCommandExtractor(createRaCommandRunner(), createRaTextReader());
  }
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return new TsCommandExtractor(createTsCommandRunner(), createTsTextReader(), createTsSymbolRunner());
  }
  if (languageId === "csharp") {
    // Registered atomically with the gesture wiring, so C# never runs
    // half-wired on a Rust default. Distinct class from RaCommandExtractor,
    // never the Rust fallthrough.
    return new CsCommandExtractor(createCsCommandRunner(), createCsTextReader(), createCsSymbolRunner());
  }
  if (languageId === "python") {
    // Registered atomically with the gesture wiring (the memberSite dispatch,
    // the names-only gate, the out-of-span import routing), so Python never
    // runs half-wired on the Rust/undefined default. Distinct class, never the
    // Rust fallthrough.
    return new PyCommandExtractor(createPyCommandRunner(), createPyTextReader(), createPySymbolRunner());
  }
  if (languageId === "go") {
    // Registered atomically with the gesture wiring (the memberSite dispatch,
    // the armed member gate, the out-of-span import routing), so Go never runs
    // half-wired on the Rust/undefined default. Distinct class, never the Rust
    // fallthrough.
    return new GoCommandExtractor(createGoCommandRunner(), createGoTextReader(), createGoSymbolRunner());
  }
  return undefined;
}

/** The product Go runner: dispatch an extraction command against the user's
 *  running gopls (via the golang.go extension) through the vscode command API.
 *  Dispatch is identical to the TS/C#/Python runners: a code-action call passes
 *  a Range (cursor..endCursor), everything else a Position, and the resolve
 *  count reaches edit-carrying actions (completion needs none — gopls's
 *  signature rides the item's `detail`). */
export function createGoCommandRunner(): GoCommandRunner {
  return (command, cursor, opts) => {
    const uri = vscode.Uri.parse(cursor.uri);
    const target = opts?.endCursor
      ? new vscode.Range(
          new vscode.Position(cursor.line, cursor.character),
          new vscode.Position(opts.endCursor.line, opts.endCursor.character),
        )
      : new vscode.Position(cursor.line, cursor.character);
    return Promise.resolve(
      vscode.commands.executeCommand(command, uri, target, undefined, opts?.resolveCount),
    );
  };
}

/** Reads an open document's text for the Go member-site gate and
 *  qualifyImport's identifier widening. Returns undefined when the document is
 *  not open. */
export function createGoTextReader(): GoTextReader {
  return (uri) => vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)?.getText();
}

/** The product Go workspace-symbol runner: dispatch a bare NAME query against
 *  the user's running gopls (via the golang.go extension) via
 *  vscode.executeWorkspaceSymbolProvider, for the by-name resolution leg — the
 *  createCsSymbolRunner sibling. */
export function createGoSymbolRunner(): GoSymbolRunner {
  return (query) =>
    Promise.resolve(vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", query));
}

/** The product TypeScript workspace-symbol runner: dispatch a bare NAME query
 *  against the user's running TS server via
 *  vscode.executeWorkspaceSymbolProvider, for the by-name resolution leg — the
 *  createCsSymbolRunner sibling. The command is provider-agnostic, so the whole
 *  difference between the four is which extractor it is handed to. */
export function createTsSymbolRunner(): TsSymbolRunner {
  return (query) =>
    Promise.resolve(vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", query));
}

/** The product Python workspace-symbol runner: dispatch a bare NAME query
 *  against the user's running Pylance via
 *  vscode.executeWorkspaceSymbolProvider, for the by-name resolution leg — the
 *  createCsSymbolRunner sibling. */
export function createPySymbolRunner(): PySymbolRunner {
  return (query) =>
    Promise.resolve(vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", query));
}

/** The product Python runner: dispatch an extraction command against the user's
 *  running Pylance via the vscode command API. Dispatch is identical to the
 *  TS/C#/Rust runners: a code-action call passes a Range (cursor..endCursor),
 *  everything else a Position, and the resolve count reaches lazily-resolved
 *  completion documentation (where the Python signature rides) and edit-carrying
 *  actions. */
export function createPyCommandRunner(): PyCommandRunner {
  return (command, cursor, opts) => {
    const uri = vscode.Uri.parse(cursor.uri);
    const target = opts?.endCursor
      ? new vscode.Range(
          new vscode.Position(cursor.line, cursor.character),
          new vscode.Position(opts.endCursor.line, opts.endCursor.character),
        )
      : new vscode.Position(cursor.line, cursor.character);
    return Promise.resolve(
      vscode.commands.executeCommand(command, uri, target, undefined, opts?.resolveCount),
    );
  };
}

/** Reads an open document's text for the Python member-site gate and
 *  qualifyImport's identifier widening. Returns undefined when the document is not
 *  open. */
export function createPyTextReader(): PyTextReader {
  return (uri) => vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)?.getText();
}

/** The product TS runner. Lives here, not in tsExtractor.ts, because that
 *  module must bundle without a vscode stub (the blind suite requires the
 *  whole transport headless); this file is the wiring layer and may touch
 *  vscode. Dispatch is identical to createRaCommandRunner: a code-action call
 *  passes a Range (cursor..endCursor), everything else a Position, and the
 *  resolve count reaches lazily-resolved detail and edit-carrying actions. */
export function createTsCommandRunner(): TsCommandRunner {
  return (command, cursor, opts) => {
    const uri = vscode.Uri.parse(cursor.uri);
    const target = opts?.endCursor
      ? new vscode.Range(
          new vscode.Position(cursor.line, cursor.character),
          new vscode.Position(opts.endCursor.line, opts.endCursor.character),
        )
      : new vscode.Position(cursor.line, cursor.character);
    return Promise.resolve(
      vscode.commands.executeCommand(command, uri, target, undefined, opts?.resolveCount),
    );
  };
}

/** Reads an open document's text for qualifyImport's identifier widening.
 *  Returns undefined when the document is not open (widening is skipped). */
export function createTsTextReader(): TsTextReader {
  return (uri) => vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)?.getText();
}

/** The product C# runner: dispatch an extraction command against the user's
 *  running Roslyn LS via the vscode command API. Dispatch is identical to the
 *  TS/Rust runners: a code-action call passes a Range (cursor..endCursor),
 *  everything else a Position, and the resolve count reaches lazily-resolved
 *  completion documentation (where the C# signature rides) and edit-carrying
 *  actions. */
export function createCsCommandRunner(): CsCommandRunner {
  return (command, cursor, opts) => {
    const uri = vscode.Uri.parse(cursor.uri);
    const target = opts?.endCursor
      ? new vscode.Range(
          new vscode.Position(cursor.line, cursor.character),
          new vscode.Position(opts.endCursor.line, opts.endCursor.character),
        )
      : new vscode.Position(cursor.line, cursor.character);
    return Promise.resolve(
      vscode.commands.executeCommand(command, uri, target, undefined, opts?.resolveCount),
    );
  };
}

/** Reads an open document's text for the C# member-site gate and qualifyImport's
 *  identifier widening. Returns undefined when the document is not open. */
export function createCsTextReader(): CsTextReader {
  return (uri) => vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)?.getText();
}

/** The product C# workspace-symbol runner: dispatch a bare NAME query against the
 *  user's running Roslyn LS via vscode.executeWorkspaceSymbolProvider, for the
 *  by-name resolution leg (a doc-only, cross-file/project collaborator with no
 *  in-span cursor). Returns SymbolInformation[]. */
export function createCsSymbolRunner(): CsSymbolRunner {
  return (query) =>
    Promise.resolve(vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", query));
}
