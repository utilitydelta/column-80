# VS Code as a competitor - where it crosses this extension

Research brief on VS Code's native local-model story and the wider local-ollama extension field,
and an honest read of where it competes with this product and where it does not. Dated 2026-07-16.

## Sources

VS Code native (the four primary links):
- [BYOK language models](https://code.visualstudio.com/docs/agent-customization/language-models#_bring-your-own-language-model-key)
- [Deprecation of the built-in Ollama provider (v1.127)](https://code.visualstudio.com/updates/v1_127#_deprecation-of-the-built-in-ollama-provider)
- [BYOK models in agent host / Copilot sessions, experimental (v1.128)](https://code.visualstudio.com/updates/v1_128#_byok-models-in-agent-host-copilot-sessions-experimental)
- [Configure the default utility model for BYOK (v1.128)](https://code.visualstudio.com/updates/v1_128#_configure-the-default-utility-model-for-byok)

The wider local-ollama extension field:
- [Continue.dev + Ollama setup 2026](https://localaimaster.com/blog/continue-dev-ollama-setup)
- [Local AI in VS Code - Continue, Cline, Twinny](https://local-ai-hub.com/blog/local-ai-vs-code-integration)
- [Twinny: local LLM for VS Code](https://www.solosoft.dev/post/twinny-local-llm-2026/)
- [Set up local LLM code completion with Ollama](https://www.sitepoint.com/local-llm-code-completion-vs-code-ollama/)

## What VS Code natively offers now

- **BYOK, no account required - but chat only.** BYOK models "work without signing into a GitHub
  account and without a Copilot plan." That removes the old subscription wall. The catch is the
  scope: "BYOK applies to the chat experience and utility tasks only."
- **Local inline completion is explicitly blocked.** "Some features still require a GitHub account:
  semantic search, inline suggestions (code completions), and features that rely on embeddings" and
  "Currently, you cannot connect to a local model for inline suggestions." VS Code's ghost-text path
  is cloud-gated and cannot run on a local model. This is the load-bearing fact of the whole brief.
- **Built-in Ollama provider deprecated**, replaced by an official Ollama marketplace extension for
  local models in chat. Local support is not removed, it moved to an extension.
- **Agent host runs BYOK models (experimental).** The agent host embeds Anthropic's Claude Agent SDK;
  BYOK models can drive the autonomous agent (`chat.agentHost.byokModels.enabled`), but it is
  experimental, org-level managed, and restart-gated.
- **Utility model can be BYOK** - a small background model for chat titles and commit messages.

Read plainly: VS Code is building generic plumbing to point a chat box or an autonomous agent at any
model, cloud or local. It is NOT building an oracle-gated, no-chat, local codegen gesture.

## The wider field matters more than VS Code native

The four links are about VS Code itself, but the real head-to-head for the FIM gesture is the
third-party extension ecosystem, which already fills the local-completion gap VS Code leaves open:

- **Twinny** - FIM-optimised local completion, 200-300ms autocomplete that "feels native to typing,"
  lightweight. Direct competitor to the FIM ghost-text gesture, at comparable latency to this
  product's ~200ms TTFT target.
- **Continue** - local FIM tab-completion plus chat, model-per-role. Notable market signal: acquired
  by Cursor in June 2026, the open-source repo is now read-only (v2.0.0 the final release). Still
  works locally, but the leading local-first darling was absorbed by a cloud-IDE company.
- **Tabby** - a dedicated coding-optimised local inference server, an alternative to Ollama's general
  serving.
- **Cline** - agent-style, no inline completion; local-first and actively maintained.
- Plus llama-coder, CodeGPT, and the official Ollama extension.

## Where it crosses / competes

1. **"Local model in the editor" is fully commoditised.** Between VS Code native chat, the official
   Ollama extension, Twinny, Continue, Tabby, Cline, and others, being local is table stakes, not a
   differentiator. This is the uncomfortable truth: the moat is not "local."
2. **The FIM ghost-text gesture is directly contested.** Twinny and Continue do local FIM completion
   today at native-feeling latency. This product's FIM path competes head-on here. VS Code NATIVE
   cannot (local completion is blocked), but the extension field can and does.
3. **"No account / no API key" is no longer unique** (Sam's wall). VS Code BYOK plus the Ollama
   extension gives local chat with no GitHub account. The "you need no key" line alone is commodity.

## Where it does NOT compete - the durable moats

1. **A dumb local model made smart - nobody else does it.** The moat is not "local" and it is not
   "verified" as a standalone virtue; it is the fusion. A frontier cloud model is often smart enough
   unaided, but a small local model invents field names - and this product closes that gap with four
   mechanisms no competitor stacks together: **better context in** (the real member set injected from
   rust-analyzer, resolved across files and crates, so it completes against names it could not guess),
   **better sensors out** (`cargo check` and `cargo test` judge the output; hallucinated APIs and
   wrong behaviour do not survive), **prompt engineering** (a closed deterministic composition, same
   input same bytes), and **the agentic loop** (compiler-directed repair converges on the exact
   error). Every competitor above is "local model to raw completion" - they GENERATE; this VERIFIES.
   The intelligence lives in the deterministic tooling, not the weights, which is why it holds even as
   local models improve (the sensors help any model). And a fifth pillar the agent-first crowd
   structurally cannot copy: it is built AGAINST cognitive surrender - after scaffolding a test it
   BLANKS the assertion values and makes the human type them, because deciding what "correct" means is
   the design act. Their whole pitch is that the AI does more for you; this one's is that it does none
   of your thinking. That is a counter-position, not just a feature.
2. **Local inline completion vs VS Code's cloud gate.** VS Code structurally cannot run ghost text on
   a local model. For anyone who wants completion inside VS Code's own first-party surface without a
   cloud account, this product (and the Twinny-class extensions) own ground VS Code has ceded.
3. **The no-chat, function-scoped trust bet is the opposite product.** Every VS Code path is chat or
   an autonomous agent - exactly what Priya rejects and what the vibe-coder / prompt-negotiator
   anti-personas want. This product is the anti-agent: doc-comment-is-the-instruction, function-scoped
   blast radius, keystroke-on-a-diff. It does not compete with the agent shell; it is a different bet.
4. **Local-only as architecture, not a toggle.** BYOK is bring-your-own-key: the easy default is
   still cloud, local is a configured option. For Marcus and Okafor (IP, integrity, "nothing leaves
   the building" as a GUARANTEE), a tool that architecturally cannot phone home beats one that can but
   is configured not to.

## Honest threats (do not wave these away)

- **Positioning on "local/private" is now weak ground.** It is crowded and commoditised. The
  Continue-to-Cursor acquisition also reads as "local-first alone is not a sustainable business."
- **Default-reach risk.** As VS Code ships native local chat/agent, a user's first instinct for
  "local AI coding" is the built-in thing or the top-ranked extension, not this one. Distribution and
  discoverability is the fight, and this product has to win by being VISIBLY better at a specific job.
- **FIM latency parity.** Twinny already hits 200-300ms local FIM. The FIM gesture cannot win on
  latency or "it's local" - only on the injected-surface quality (real names, no invented fields).
- **The gap could close.** If VS Code or Ollama ever adds a local inline-completion path, moat #2
  narrows. Watch the Ollama extension's roadmap.

## Strategic read

Do not sell "local" alone - a half-dozen tools have it and the one company that bet the business on
it got acquired. But do not sell "verified" as if local were incidental either. Sell the **fusion**:
a dumb local model made to write correct code by better context in, better sensors out, deterministic
prompt engineering, and a compiler-directed loop - the one sentence no competitor can say. Local is
not the compromise you tolerate for privacy; it is the point, because the sensors are what make a
weak local model good enough to replace a frontier cloud model, on hardware the user owns.

The two competitor classes each stay out of this union for structural reasons, not technical ones:
the local-completion tools (Twinny, Continue, Tabby) have no oracle and are stuck with the dumb
model's raw output; the oracle-capable cloud tools (Cursor, Copilot) will not bet on local plus heavy
deterministic tooling because their business is the frontier-model relationship. This product owns the
union: **local AND oracle-gated.**

And carry the anti-cognitive-surrender stance into the pitch, because it is the one differentiator the
agent-first incumbents cannot copy without contradicting themselves. Their promise is that the AI does
more for you; this product's promise is that it makes you faster without doing your thinking - you
still write what "correct" means. Own "a local model made correct, that keeps you sharp instead of
dependent." The competition owns "local"; this product owns that whole sentence.
