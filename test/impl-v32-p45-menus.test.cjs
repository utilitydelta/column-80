// The package.json contribution rows (session-v32 phase 5, goal item 6,
// decisions 3, 4, 5 and 6).
//
// A menu contribution has no other test layer. It is not code, a menu click
// cannot be driven headlessly, and every failure mode here is silent: an entry
// in the wrong place is a gesture the human cannot reach, and a `when` clause on
// the wrong command is a feature that vanishes in the files it was built for.
// So the manifest itself is the thing under test.
//
// Four rulings are pinned here, and each one has a way of being quietly undone:
//
//   Decision 3  NO new default keybinding, ever, and no `ctrl+alt+<key>` at all.
//               Ctrl+Alt is AltGr; on German and Nordic layouts AltGr+8 is `[`,
//               and taking a bracket away from someone writing code is about as
//               bad as a keystroke claim gets.
//   Decision 4  The add-to-context gestures sit at the TOP LEVEL of every menu
//               they appear in, never under the Column 80 submenu. The human's
//               words: burying it is time consuming and takes mouse dexterity.
//   Decision 5  The context gestures are NEVER language-gated, on any surface.
//               A build that adds a clause for symmetry with the generate family
//               has broken the feature.
//   Decision 6  generate, repair and run-tests are HIDDEN in unsupported files,
//               via `when` on the menu contribution, not `enablement`.
//
// Run: SKIP_LIVE=1 node --test test/impl-v32-p45-menus.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const menus = manifest.contributes.menus;
const commands = manifest.contributes.commands;

// The eight ids the TDD gestures already carried, and the set decision 6 reuses.
const GATED_IDS = [
  "rust",
  "go",
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "python",
  "csharp",
];

// The gestures that put something in the panel. Decision 5's subject.
const CONTEXT_ADD = [
  "column80.contextAddSelection",
  "column80.contextAddSymbol",
  "column80.contextAddBlock",
  "column80.contextAddFile",
];

// The gestures that WRITE code, so the file extension really does constrain them.
const GENERATE = [
  "column80.generateFunction",
  "column80.repairFunction",
  "column80.generateTests",
  "column80.runTddTests",
];

const entriesFor = (menu) => menus[menu] ?? [];
const findEntry = (menu, command) => entriesFor(menu).find((e) => e.command === command);

test("every command in the manifest is registered under the Column 80 category", () => {
  // The whole of the discovery story: typing "column 80" in Keyboard Shortcuts
  // lists them all, and binding one is a right-click. Decision 3 rests on this.
  const uncategorized = commands.filter((c) => c.category !== "Column 80").map((c) => c.command);
  assert.deepStrictEqual(
    uncategorized,
    ["column80.dumpCompletionItems"],
    "only the diagnostic dump is allowed outside the category",
  );
});

// ===========================================================================
// Decision 4: top level, on three surfaces
// ===========================================================================

test("the four add-to-context gestures sit at the TOP LEVEL of editor/context", () => {
  for (const command of CONTEXT_ADD) {
    const entry = findEntry("editor/context", command);
    assert.ok(entry, `${command} is missing from editor/context`);
    assert.ok(
      !entriesFor("column80.editorContext").some((e) => e.command === command),
      `${command} is still buried in the submenu`,
    );
  }
});

test("the explorer tree and the editor tab can both add a file, at top level", () => {
  for (const menu of ["explorer/context", "editor/title/context"]) {
    const entry = findEntry(menu, "column80.contextAddFile");
    assert.ok(entry, `contextAddFile is missing from ${menu}`);
    assert.ok(entry.group, `${menu} entry has no group, so it scatters`);
  }
});

test("the add-to-context gestures cluster in ONE group so they do not scatter", () => {
  const groups = new Set();
  for (const menu of ["editor/context", "explorer/context", "editor/title/context"]) {
    for (const entry of entriesFor(menu)) {
      if (CONTEXT_ADD.includes(entry.command)) {
        groups.add(String(entry.group).split("@")[0]);
      }
    }
  }
  assert.strictEqual(groups.size, 1, `expected one group name, got ${[...groups].join(", ")}`);
});

test("the generate family stays in the submenu, which decision 4 did not touch", () => {
  const sub = entriesFor("column80.editorContext").map((e) => e.command);
  for (const command of GENERATE) {
    assert.ok(sub.includes(command), `${command} left the submenu; decision 4 covers the ADD gestures only`);
  }
  assert.ok(
    !entriesFor("editor/context").some((e) => GENERATE.includes(e.command)),
    "a generate gesture was promoted to top level, which nobody asked for",
  );
});

test("runTddTests finally has the menu entry it never had", () => {
  // The gesture the human runs in a LOOP had no menu at all (finding 8).
  const entry = findEntry("column80.editorContext", "column80.runTddTests");
  assert.ok(entry, "runTddTests has no editorContext entry");
});

// ===========================================================================
// Decision 5: the context gestures are never language-gated
// ===========================================================================

test("no add-to-context gesture carries a language clause, on any surface", () => {
  for (const [menu, entries] of Object.entries(menus)) {
    for (const entry of entries) {
      if (!CONTEXT_ADD.includes(entry.command)) {
        continue;
      }
      const when = entry.when ?? "";
      assert.ok(
        !when.includes("resourceLangId"),
        `${entry.command} in ${menu} has a resourceLangId clause: ${when}`,
      );
    }
  }
});

test("no add-to-context COMMAND carries an enablement clause", () => {
  // `enablement` would grey it in every menu AND hide it from the palette, which
  // is the same feature loss by another mechanism.
  for (const command of commands) {
    if (CONTEXT_ADD.includes(command.command)) {
      assert.strictEqual(command.enablement, undefined, `${command.command} has an enablement clause`);
    }
  }
});

test("no add-to-context gesture is hidden from the palette", () => {
  for (const entry of entriesFor("commandPalette")) {
    if (CONTEXT_ADD.includes(entry.command)) {
      assert.notStrictEqual(entry.when, "false", `${entry.command} is hidden from the palette`);
    }
  }
});

test("markdown, yaml, json and a log are all addable, which is the whole of decision 5", () => {
  // A clause-free entry is visible in every language by construction, so the
  // assertion is the absence of any clause that could mention these. Spelled out
  // as its own row because the reason matters: these are not second-class
  // context, they are often the entire point.
  const clauses = [];
  for (const entries of Object.values(menus)) {
    for (const entry of entries) {
      if (CONTEXT_ADD.includes(entry.command) && entry.when) {
        clauses.push(entry.when);
      }
    }
  }
  // Two clauses are allowed and neither is about content. `editorHasSelection`
  // is what stops the top-level selection entry being noise when nothing is
  // selected; `view ==` scopes the panel's own title buttons to the panel.
  assert.deepStrictEqual(
    [...new Set(clauses)].sort(),
    ["editorHasSelection", "view == column80.contextBlocks"],
  );
});

// ===========================================================================
// Decision 6: hide generate and repair in unsupported files
// ===========================================================================

test("generate, repair and both TDD gestures carry the language `when` on their menu entry", () => {
  for (const command of GENERATE) {
    const entry = findEntry("column80.editorContext", command);
    assert.ok(entry, `${command} has no submenu entry`);
    assert.ok(entry.when, `${command} has no when clause, so it is a dead click in a .java file`);
    for (const id of GATED_IDS) {
      assert.ok(
        entry.when.includes(`resourceLangId == ${id}`),
        `${command}'s when clause omits ${id}`,
      );
    }
  }
});

test("the gate is a `when` on the menu, not an `enablement` swap", () => {
  // They are not interchangeable and the build must not substitute one for the
  // other. `enablement` GREYS a menu entry and HIDES it from the palette; hiding
  // it from a menu takes a `when` on the contribution. Decision 6 is the `when`.
  for (const command of ["column80.generateFunction", "column80.repairFunction"]) {
    const entry = findEntry("column80.editorContext", command);
    assert.ok(entry.when.includes("resourceLangId"), `${command} needs a when, not an enablement`);
  }
  // generateTests and runTddTests keep the enablement they already shipped with.
  for (const command of ["column80.generateTests", "column80.runTddTests"]) {
    const declared = commands.find((c) => c.command === command);
    assert.ok(declared.enablement, `${command} lost its enablement clause`);
  }
});

test("per language, menu visibility matches the gate in BOTH directions", () => {
  // The row the gate decision implies: present in the five supported ids,
  // absent otherwise. Evaluated by reading the clause rather than by driving a
  // menu, which cannot be done headlessly.
  const supported = ["rust", "go", "typescript", "python", "csharp"];
  const unsupported = ["java", "ruby", "markdown", "json", "yaml", "plaintext"];
  const mentions = (when, id) => when.split("||").some((c) => c.trim() === `resourceLangId == ${id}`);
  for (const command of GENERATE) {
    const when = findEntry("column80.editorContext", command).when;
    for (const id of supported) {
      assert.ok(mentions(when, id), `${command} must be VISIBLE in ${id}`);
    }
    for (const id of unsupported) {
      assert.ok(!mentions(when, id), `${command} must be ABSENT in ${id}`);
    }
  }
  // And the context gestures are the mirror image: visible in all twelve.
  for (const command of CONTEXT_ADD) {
    const when = findEntry("editor/context", command).when ?? "";
    for (const id of [...supported, ...unsupported]) {
      assert.ok(!when.includes(id), `${command} must be visible in ${id}`);
    }
  }
});

// ===========================================================================
// Decision 3: no new default keybinding
// ===========================================================================

// SUPERSEDED 2026-09-02 (session-v65, S65-5, awaiting ratification): decision 3 stands for
// every gesture this file governs, and the dictation gesture is the one licensed exception,
// because the human ruled it demoable and fast. Five ship: the three lifecycle bindings plus
// the dictation toggle and its Escape.
test("SUPERSEDED: the proposal lifecycle three plus the v65 dictation chords (one live at a time) and its Escape", () => {
  const bindings = manifest.contributes.keybindings;
  const dictate = bindings.filter((b) => b.command === "column80.dictate");
  assert.ok(dictate.length >= 1, "the dictation chords exist");
  for (const b of dictate) {
    assert.match(b.when, /config\.column80\.dictation\.shortcut == '[^']+'/, `${b.key} is gated on the shortcut setting, so only the chosen chord is live`);
    assert.ok(!/ctrl\+alt(?!\+shift)/.test(b.key) || /shift/.test(b.key), `${b.key}: no bare ctrl+alt chord, it is AltGr on Windows`);
  }
  assert.deepStrictEqual(
    [...new Set(bindings.map((b) => b.command))].sort(),
    ["column80.dictate", "column80.dismissDictationGhost", "column80.dismissScopedGhost", "column80.proposalAccept", "column80.proposalReject"],
  );
});

test("no gesture in this session claimed a key, and no binding uses ctrl+alt", () => {
  const bindings = manifest.contributes.keybindings;
  for (const command of [...CONTEXT_ADD, ...GENERATE]) {
    assert.ok(
      !bindings.some((b) => b.command === command),
      `${command} claimed a default key; decision 3 says the user binds what they want`,
    );
  }
  // The rule that outlives this item: Ctrl+Alt is AltGr, and VS Code ships no
  // default ctrl+alt binding on Windows for exactly that reason. A three-modifier
  // ctrl+shift+alt chord is not AltGr and is allowed.
  for (const binding of bindings) {
    assert.ok(
      !/ctrl\+alt/i.test(binding.key.replace(/ctrl\+shift\+alt/i, "")),
      `${binding.command} uses ${binding.key}; no ctrl+alt default, ever, in any later slice`,
    );
  }
});

test("the two proposal-lifecycle bindings are still scoped to the product's own diff", () => {
  // Why the three that DO ship are safe: nothing else runs inside a document
  // the product opened, so `enter` and `escape` are not taken from anyone.
  const bindings = manifest.contributes.keybindings;
  for (const command of ["column80.proposalAccept", "column80.proposalReject"]) {
    const binding = bindings.find((b) => b.command === command);
    assert.ok(
      binding.when.includes("resourceScheme == column80-fngen"),
      `${command} escaped the fngen scheme, so it now competes for a key in a normal editor`,
    );
  }
});

// ===========================================================================
// Registration: every contributed command must actually exist
// ===========================================================================

test("every command a menu references is declared, and every new command is contributed", () => {
  const declared = new Set(commands.map((c) => c.command));
  for (const [menu, entries] of Object.entries(menus)) {
    for (const entry of entries) {
      if (entry.command) {
        assert.ok(declared.has(entry.command), `${menu} references undeclared ${entry.command}`);
      }
    }
  }
  for (const command of ["column80.contextAddSymbol", "column80.contextAddBlock"]) {
    assert.ok(declared.has(command), `${command} is not declared in contributes.commands`);
  }
});

test("the two new gestures are registered by the panel that owns them", () => {
  // A contributed command with no registerCommand is a palette entry that
  // errors when pressed. Read from the source rather than run, because the
  // registration itself is proven end to end in impl-v32-p3-block.
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "contextPanel.ts"), "utf8");
  for (const command of ["column80.contextAddSymbol", "column80.contextAddBlock"]) {
    assert.ok(source.includes(`"${command}"`), `${command} is contributed but never registered`);
  }
});
