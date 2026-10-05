// session-v77 blind oracle: every string a user can see is written for the user.
//
// Contract (session-v77/goal.md "The rules for a user-facing string", rulings R1, R7, R8):
// no user-visible string literal carries
//   - an em dash (U+2014),
//   - an en dash (U+2013) used as punctuation (a digit range like 1–5 is allowed),
//   - a spaced ASCII hyphen used as a sentence dash (" - " between words, R1),
//   - a session artifact reference: session-vNN, scraps, goal.md, roadmap, SNN-N, PROVEN, REASONED.
//
// Output channel lines (appendLine) are a log the user opens on purpose. goal.md puts them in
// scope only for dashes and session references (R7), so the spaced-hyphen rule does not apply
// to them.
//
// The scanner reads src/**/*.ts with the TypeScript parser, so comments are never scanned.
// It collects string and template literals from these shapes:
//   - arguments to showInformationMessage / showWarningMessage / showErrorMessage /
//     setStatusBarMessage / showQuickPick / showInputBox / createQuickPick / createInputBox
//   - withProgress options and progress.report payloads (title, message)
//   - `.text =` / `.tooltip =` / `.placeholder =` / `.title =` assignments on a status bar
//     item or quick pick (receiver name matches ITEM_RECEIVER)
//   - appendLine arguments (channel rules)
//   - any function or const whose name ends in Toast, Message, Refusal, Reason or Detail:
//     the literals it returns or holds
// Identifiers and same-file function calls inside those expressions are followed to their
// declaration in the same file. Imports are not followed; the name-suffix rule covers the
// shared builders.
//
// Run: node --test test/blind-v77-user-strings.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

// Prompt text sent to a model is not user-visible (R8). Each identifier listed here is skipped
// even though its name matches the helper suffix rule. Any prompt-looking helper name that is
// not listed fails the "every prompt-looking helper is classified" test below.
const SKIP = [
  // none yet: promptRefusalMessage is a refusal shown to the user, so it is scanned.
];
const SKIP_NAMES = new Set(SKIP.map((s) => s.name));

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

const TOAST_CALLS = new Set([
  "showInformationMessage", "showWarningMessage", "showErrorMessage", "setStatusBarMessage",
  "showQuickPick", "showInputBox", "createQuickPick", "createInputBox",
]);
const PROGRESS_CALLS = new Set(["withProgress", "report"]);
const CHANNEL_CALLS = new Set(["appendLine"]);
const VISIBLE_KEYS = new Set([
  "title", "message", "placeHolder", "placeholder", "prompt", "label", "description", "detail",
  "text", "tooltip",
]);
const ITEM_RECEIVER = /item|bar|status|pick|input|qp/i;
const ASSIGNED_KEYS = new Set(["text", "tooltip", "placeholder", "title"]);
const HELPER_SUFFIX = /(Toast|Message|Refusal|Reason|Detail)$/;
const PROMPT_LIKE = /prompt|system|instruction/i;
const VISIBLE_SUFFIX = /(Refusal|Message|Toast)$/;
// Method calls whose arguments are never shown: lookups, tests, command ids.
const NON_TEXT_CALLS = new Set([
  "includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "split", "match", "matchAll",
  "test", "exec", "search", "get", "has", "set", "getConfiguration", "executeCommand",
  "registerCommand", "require", "localeCompare", "padStart", "padEnd", "inspect", "update",
  "createOutputChannel", "createStatusBarItem", "parse", "stringify",
]);

const RULES = [
  { id: "em-dash", channel: true, test: (s) => /—/.test(s) },
  { id: "en-dash", channel: true, test: (s) => /–/.test(s.replace(/\d–\d/g, "")) },
  { id: "spaced-hyphen", channel: false, test: (s) => /\S - \S/.test(s) || /^ - $/.test(s) },
  { id: "session-ref", channel: true, test: (s) => /session-v\d+/i.test(s) },
  { id: "scraps", channel: true, test: (s) => /\bscraps\b/i.test(s) },
  { id: "goal.md", channel: true, test: (s) => /goal\.md/.test(s) },
  { id: "roadmap", channel: true, test: (s) => /\broadmap\b/i.test(s) },
  { id: "scrap-id", channel: true, test: (s) => /\bS\d\d-\d/.test(s) },
  { id: "PROVEN", channel: true, test: (s) => /\bPROVEN\b/.test(s) },
  { id: "REASONED", channel: true, test: (s) => /\bREASONED\b/.test(s) },
];

function walkTs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walkTs(p);
    return p.endsWith(".ts") && !p.endsWith(".d.ts") ? [p] : [];
  });
}

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => "${…}" + s.literal.text).join("");
  }
  return undefined;
}

function declName(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  return undefined;
}

// Scan one source text. Returns { literals: [{line, text, kind, via}], unclassified: [...] }.
function scanSource(text, fileName) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Map(); // pos -> record; a ui kind wins over a channel kind
  const unclassified = [];
  const skipped = [];

  // Same-file declarations by name, for following identifiers and calls.
  const decls = new Map();
  (function index(n) {
    const name = declName(n);
    if (name) {
      if (!decls.has(name)) decls.set(name, []);
      decls.get(name).push(n);
    }
    ts.forEachChild(n, index);
  })(sf);

  function record(node, kind, via) {
    const t = literalText(node);
    if (t === undefined) return;
    const pos = node.getStart(sf);
    const prev = found.get(pos);
    if (prev && (prev.kind === "ui" || kind === "channel")) return;
    const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
    found.set(pos, { line, text: t, kind, via });
  }

  function isSkippedName(name) {
    if (SKIP_NAMES.has(name)) {
      skipped.push(name);
      return true;
    }
    return false;
  }

  // Collect the literals that reach the user from a value expression.
  function values(node, kind, via, seen, depth) {
    if (!node || depth > 8) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return record(node, kind, via);
    if (ts.isTemplateExpression(node)) {
      record(node, kind, via);
      for (const s of node.templateSpans) values(s.expression, kind, via, seen, depth + 1);
      return;
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) ||
        ts.isTypeAssertionExpression(node) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(node)) ||
        ts.isAwaitExpression(node) || ts.isSpreadElement(node)) {
      return values(node.expression, kind, via, seen, depth + 1);
    }
    if (ts.isConditionalExpression(node)) {
      values(node.whenTrue, kind, via, seen, depth + 1);
      values(node.whenFalse, kind, via, seen, depth + 1);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
        values(node.left, kind, via, seen, depth + 1);
        values(node.right, kind, via, seen, depth + 1);
      } else if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        values(node.right, kind, via, seen, depth + 1);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const e of node.elements) values(e, kind, via, seen, depth + 1);
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p) && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
            VISIBLE_KEYS.has(p.name.text)) {
          values(p.initializer, kind, via, seen, depth + 1);
        } else if (ts.isShorthandPropertyAssignment(p) && VISIBLE_KEYS.has(p.name.text)) {
          values(p.name, kind, via, seen, depth + 1);
        } else if (ts.isSpreadAssignment(p)) {
          values(p.expression, kind, via, seen, depth + 1);
        }
      }
      return;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      return fnReturns(node, kind, via, seen, depth + 1);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = calleeName(node.expression);
      if (name && NON_TEXT_CALLS.has(name)) return;
      if (ts.isPropertyAccessExpression(node.expression) &&
          ["join", "concat", "trim", "trimEnd", "trimStart", "replace", "replaceAll", "map", "filter", "slice"].includes(name)) {
        values(node.expression.expression, kind, via, seen, depth + 1);
      }
      const args = node.arguments ? [...node.arguments] : [];
      const start = name === "replace" || name === "replaceAll" ? 1 : 0;
      for (const a of args.slice(start)) values(a, kind, via, seen, depth + 1);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) follow(node.expression.text, kind, via, seen, depth);
      return;
    }
    if (ts.isIdentifier(node)) return follow(node.text, kind, via, seen, depth);
  }

  // Follow a name to its same-file declaration(s).
  function follow(name, kind, via, seen, depth) {
    if (seen.has(name) || !decls.has(name)) return;
    if (PROMPT_LIKE.test(name) && !VISIBLE_SUFFIX.test(name) && isSkippedName(name)) return;
    seen.add(name);
    for (const d of decls.get(name)) {
      if (ts.isVariableDeclaration(d)) values(d.initializer, kind, via, seen, depth + 1);
      else fnReturns(d, kind, via, seen, depth + 1);
    }
  }

  // The literals a function returns, including through locals it returns.
  function fnReturns(fn, kind, via, seen, depth) {
    if (!fn.body) return;
    if (!ts.isBlock(fn.body)) return values(fn.body, kind, via, seen, depth);
    (function walk(n) {
      if (n !== fn.body && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
          ts.isMethodDeclaration(n))) return;
      if (ts.isReturnStatement(n) && n.expression) values(n.expression, kind, via, seen, depth);
      ts.forEachChild(n, walk);
    })(fn.body);
  }

  (function visit(n) {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression);
      if (name && TOAST_CALLS.has(name)) {
        for (const a of n.arguments) values(a, "ui", name, new Set(), 0);
      } else if (name && PROGRESS_CALLS.has(name)) {
        const opts = n.arguments[0];
        if (opts && ts.isObjectLiteralExpression(opts)) values(opts, "ui", name, new Set(), 0);
      } else if (name && CHANNEL_CALLS.has(name)) {
        for (const a of n.arguments) values(a, "channel", name, new Set(), 0);
      }
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(n.left) && ASSIGNED_KEYS.has(n.left.name.text)) {
      const recv = n.left.expression.getText(sf);
      const hasLiteral = /["'`]/.test(n.right.getText(sf));
      if (ITEM_RECEIVER.test(recv)) values(n.right, "ui", `.${n.left.name.text} =`, new Set(), 0);
      else if (hasLiteral) {
        unclassified.push({
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          note: `assignment to ${recv}.${n.left.name.text} with a literal; receiver is not a status bar item, not scanned`,
        });
      }
    }
    const name = declName(n);
    if (name && HELPER_SUFFIX.test(name)) {
      if (PROMPT_LIKE.test(name) && !VISIBLE_SUFFIX.test(name) && isSkippedName(name)) {
        // skipped by R8, listed in SKIP
      } else if (ts.isVariableDeclaration(n)) {
        values(n.initializer, "ui", name, new Set([name]), 0);
      } else {
        fnReturns(n, "ui", name, new Set([name]), 0);
      }
    }
    ts.forEachChild(n, visit);
  })(sf);

  return { literals: [...found.values()].sort((a, b) => a.line - b.line), unclassified, skipped };
}

function offences(literals) {
  const out = [];
  for (const l of literals) {
    for (const r of RULES) {
      if (l.kind === "channel" && !r.channel) continue;
      if (r.test(l.text)) out.push({ ...l, rule: r.id });
    }
  }
  return out;
}

function report(rel, bad) {
  return bad.map((b) => `  ${rel}:${b.line} [${b.rule}] (${b.kind}, via ${b.via}) ${JSON.stringify(b.text)}`).join("\n");
}

// package.json contributes: every string a user reads in the palette, settings UI, menus, views.
const PKG_VISIBLE_KEYS = new Set([
  "title", "shortTitle", "category", "description", "markdownDescription", "enumDescriptions",
  "markdownEnumDescriptions", "deprecationMessage", "markdownDeprecationMessage", "contents",
  "name", "label", "enumItemLabels",
]);
const PKG_SCOPE = new Set(["commands", "configuration", "menus", "views", "viewsWelcome", "viewsContainers", "keybindings"]);

function pkgStrings(contributes) {
  const out = [];
  (function walk(v, p, visibleKey) {
    if (typeof v === "string") {
      if (visibleKey) out.push({ path: p, text: v });
      return;
    }
    if (Array.isArray(v)) return v.forEach((e, i) => walk(e, `${p}[${i}]`, visibleKey));
    if (v && typeof v === "object") {
      for (const [k, e] of Object.entries(v)) walk(e, `${p}.${k}`, PKG_VISIBLE_KEYS.has(k) && (typeof e === "string" || Array.isArray(e)));
    }
  })(Object.fromEntries(Object.entries(contributes).filter(([k]) => PKG_SCOPE.has(k))), "contributes", false);
  return out;
}

// ---- self-test -------------------------------------------------------------------------------

test("self-test: the scanner catches a planted em dash and session ref, and ignores comments", () => {
  const snippet = [
    "import * as vscode from 'vscode';",
    "// Column 80: this is a comment — see session-v12 and scraps",
    "/* vscode.window.showWarningMessage(\"Column 80: commented — session-v12\"); */",
    "export function run(detail: string) {",
    "  vscode.window.showWarningMessage(`Column 80: no test framework — ${detail}.`);",
    "  const msg = \"Column 80: see session-v12 for why\";",
    "  vscode.window.showInformationMessage(msg);",
    "  out.appendLine(\"plain diagnostic - with a hyphen\");",
    "}",
  ].join("\n");
  const { literals } = scanSource(snippet, "synthetic.ts");
  const bad = offences(literals);
  const lines = bad.map((b) => `${b.line}:${b.rule}`).sort();
  assert.deepStrictEqual(lines, ["5:em-dash", "6:session-ref"], report("synthetic.ts", bad));
  assert.ok(literals.some((l) => l.kind === "channel" && l.line === 8), "the channel line is collected");
  assert.ok(!literals.some((l) => l.line <= 3), "nothing on comment lines is collected");
});

// ---- the source tree -------------------------------------------------------------------------

const scans = walkTs(SRC).map((abs) => {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  return { rel, ...scanSource(fs.readFileSync(abs, "utf8"), abs) };
});

for (const s of scans.filter((x) => x.literals.length > 0)) {
  test(`user-visible strings in ${s.rel} carry no dash or session artifact`, () => {
    const bad = offences(s.literals);
    assert.strictEqual(bad.length, 0, `${bad.length} offending literal(s):\n${report(s.rel, bad)}`);
  });
}

test("every prompt-looking helper name is classified (scanned or listed in SKIP)", () => {
  const unlisted = [];
  for (const s of scans) {
    const sf = ts.createSourceFile(s.rel, fs.readFileSync(path.join(ROOT, s.rel), "utf8"), ts.ScriptTarget.Latest, true);
    (function visit(n) {
      const name = declName(n);
      if (name && HELPER_SUFFIX.test(name) && PROMPT_LIKE.test(name) && !VISIBLE_SUFFIX.test(name) && !SKIP_NAMES.has(name)) {
        unlisted.push(`${s.rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${name}`);
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  assert.deepStrictEqual(unlisted, [], "prompt-looking helpers that are neither scanned nor listed in SKIP");
});

test("package.json contributes strings carry no dash or session artifact", () => {
  const raw = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
  const pkg = JSON.parse(raw);
  const strings = pkgStrings(pkg.contributes || {});
  assert.ok(strings.length > 0, "found the contributes strings");
  const bad = [];
  for (const s of strings) {
    for (const r of RULES) {
      if (!r.test(s.text)) continue;
      const at = raw.indexOf(JSON.stringify(s.text).slice(1, -1));
      const line = at < 0 ? 0 : raw.slice(0, at).split("\n").length;
      bad.push(`  package.json:${line} [${r.id}] ${s.path} ${JSON.stringify(s.text)}`);
    }
  }
  assert.strictEqual(bad.length, 0, `${bad.length} offending string(s):\n${bad.join("\n")}`);
});

