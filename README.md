# column-80

**local · offline · ast driven · compiler checked**

## dumb model + right context + compiler == smart harness

column-80 is a vscode extension that runs local models on your box. keeps you in your flow state. no chat window. no changes the model can't fit on a single monitor. you are in control.

This page is written by a human. Say no to letting LLMs write on your behalf.

## 01 Why this extension

CLI tools like Claude Code take spec files and implement autonomously. For complex, high-risk software this is overreach. Software engineers still need to be in the loop, because code is the design, a vague spec file is not enough.

Agentic tooling also requires large, expensive frontier models to work well. For those who work in air-gapped environments or in orgs with IP concerns, or students in low-income regions of the world, using cloud-based frontier models is impossible.

Use frontier models for low-risk dark-factory stuff, when you can afford it, and it's not IP sensitive. For high risk, hardcore engineering and learning to code on the cheap, use column-80.

## 02 How it works

Using small models to write code works if the model gets the right context and the right feedback loop. And it keeps us close to the code, which is where the real software design is.

**AST based context injection**
Small models hallucinate fields and method names. Column-80 uses the abstract syntax tree to mine your code for real data structures and methods, recursively. It injects them automatically into the prompt. No grepping.

**The compiler is the reviewer**
On an accepted generation the language's own toolchain checks it. No broken autocomplete output. Function generation gets a repair round.

**A closed prompt**
The prompt is your doc comment, your signature, and the context you picked. Nothing else, the same bytes every time. No repo scraping, no hidden window.

**Actually useful autocomplete**
Constrained, intelligent autocomplete that avoids getting in your way. Small model, sub 200ms on most machines. Works with Ctrl+Space, as you up/down through members.

## 03 No chat, manual context management

No chat panel. Either generate fresh, or repair one function or structure at a time. Chat windows take devs away from the code. Don't negotiate with the model. Stay in your flow state. You hold the design and intent, the model just speeds up the typing.

For context outside of AST injected members and methods, you must add it yourself. Add a block (eg. a function, a struct) or include specific code by line or by file. Manually add your skill.md files and anything else the model needs.

## 04 Two models, one GPU

Function generation runs `qwen3-coder:30b`. It's a mixture-of-experts model, so you get a large model that easily runs on VRAM constrained GPUs.

Autocomplete runs a separate 1.5B FIM model so it stays sub 200ms. Both models can fit on a 16GB card at the same time. Run it on a MacBook Pro with 36GB RAM no problems.

On a RTX 5080 (16GB VRAM) you'll get autocomplete latency around 100ms, and the 30b MoE model generates at 35 tokens a second.

Remember to install [ollama](https://ollama.com/) on your box.

You can still use frontier models via an API key if your machine is under-spec'd. Just remember you sacrifice your privacy and might leak your company's IP.

## 05 Languages

Column-80 relies heavily on language toolchains to make these dumb models actually work smart.

Column-80 supports Rust, .Net/C#, Python, Typescript and Go. If your language of choice is not supported it can be added. If you want to build it and submit a PR you can, but please follow [contributor guidelines](https://github.com/utilitydelta/column-80/blob/main/CONTRIBUTING.md).

## 06 How to use it

### 1. Set up once

1. Install [Ollama](https://ollama.com) and the Column 80 extension. VS Code 1.85+; an NVIDIA GPU for function generation or a MacBook.
2. First activation probes your card, picks a tier, and offers the models that tier needs for a one-click download. It never pulls a model without your click. `Column 80: Select Hardware Tier` re-runs the flow any time.

### 2. Autocomplete

1. Just type. Ghost text keeps up as you go; press <kbd>Tab</kbd> to accept. At a member access it uses the real members from your language server instead of guessing.
2. Ghosts stay short on purpose. You get the line you were writing, not a huge function block.

### 3. Add context

1. The Model Context panel in your Explorer sidebar shows everything the model will see. It starts empty and stays empty until you put something in it.
2. Right-click in the editor to add the current selection, the enclosing function, or the enclosing block. Right-click a file in the Explorer to add the whole file. Reorder and remove in the panel, and panel order is prompt order.
3. Blocks are resolved at prompt time. If you add an <kbd>if {}</kbd> block to context and it expands later, the extra code gets included too.

### 4. Generate a body

1. Write the signature and a doc comment that spells out the edge cases, the errors and the invariants. That doc comment and your context blocks are the entire prompt.
2. Run `Column 80: Generate Function Body`. A diff opens. <kbd>Enter</kbd> accepts, <kbd>Esc</kbd> rejects. Nothing lands without your accept.
3. The same gesture on a struct, enum, class or interface header generates the type from its doc comment.

### 5. Repair

1. On accept your own compiler runs against the change.
2. Any compile errors trigger a repair round and get a fix proposed through the same diff mechanism. Repair rounds carry better context due to extra types introduced in the first round. Two rounds maximum.
3. Run `Column 80: Repair Function Body` at any time and it finds real call site examples of the types and methods you used, shows them to the model, and asks it to rewrite your function the way the rest of your repo is written.

### 6. Decide what correct means

1. Run `Column 80: Generate Tests (TDD)`. It writes tests blind of your implementation and blanks every expected value.
2. Tab through the holes and type each answer yourself. The model's guess is never inserted.
3. Run `Column 80: Run TDD Tests`. Green, or the failing assertions in your own words.

### 7. Let your own tests drive the repair

1. Run `Column 80: Run Covering Tests`. It walks the call hierarchy upward from your function and runs the tests in your repo that actually reach it. No name matching, and it tells you how many hops away each one is.
2. Run `Column 80: Repair Function Body` on the same function. The failing assertions go into the prompt with the source lines they sit on, and the tests run again straight after.
3. Only your function is ever rewritten. Tests are never edited, by any gesture.

### 8. Get told what is wrong with it

1. Run `Column 80: Criticize Function`. Fourteen named dimensions of craft, scored by deterministic detectors rather than by a model, so the same bytes give the same answer twice.
2. Read the card in the panel for the principle behind each one, or read the diff it offers you: your function with a short, blunt comment above every line that failed. `// C80 clock: hidden wall-clock read. Untestable. Pass it in.`
3. Accept and the comments land. Reject and nothing was written. Press it again after fixing half of them and it replaces its own comments rather than stacking them.

That is the whole tool. No chat thread, no history, no agent to babysit. Every model write goes through a diff you accept.

The [user manual](https://github.com/utilitydelta/column-80/blob/main/docs/user-manual.md) covers the rest, including every setting, every command, and the known limits.

### 9. Say it

Cursor where the next statement goes, `shift+alt+d`, say what it does, `shift+alt+d` again. The
sentence rides into one FIM request as a comment the file never sees; Tab takes the ghost and
drops the cursor onto a fresh line. Local whisper.cpp, downloaded on first use like the models.
Rebind `column80.dictate` if the chord is taken.

## 07 Get it

Released under Apache-2.0. No sign-up, no data exfiltration.

Get it from the [VS Code marketplace](https://marketplace.visualstudio.com/items?itemName=UtilityDelta.column-80) or clone it down, npm install and hit F5 to run.

https://github.com/utilitydelta/column-80

Reach me on [LinkedIn](https://www.linkedin.com/in/tyson-brown-208b88b6/).

## 08 AI Provenance Statement

Initial 1.0 version built in ~30 sessions, over two weeks with Opus & Fable models using my [build-method:implementation-loop](https://github.com/utilitydelta/build-method) skill.

Full vscode+ollama e2e test harness, Ubuntu x86 with RTX 5080.

I read the code :)

---

// Understand every line you ship.

// Code is the design.

// Your code is not their training data.

// Your editor should not have a bill.

---

Local by architecture. No account, no telemetry, no bill. Apache-2.0
