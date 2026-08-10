# Marketing

How to position, talk about, and grow this tool without betraying what it is. It is free, so the
currency is trust and adoption, not dollars - but the funnel principles still hold, and the identity
constraints bind harder than they would for a paid product, because the moment the marketing lies,
the personas who carry it defect.

Grounded in [personas.md](personas.md), the moat read in [vs-code-competitor.md](vs-code-competitor.md),
and the governing principles in [roadmap.md](roadmap.md). Read those first; this turns them into
words on a page.

## The positioning, in one line

A dumb local model, made to write correct code by everything wrapped around it - and it refuses to do
your thinking for you.

It runs a small model on hardware you own, engineers exactly what goes in, senses exactly what comes
out, loops until the compiler proves it, and stops short of the one thing it will not automate: the
design judgement that is yours. The whole pitch: **a weak local model made trustworthy, without
making you dependent.**

## The moat - a dumb local model made smart, without cognitive surrender

Say the hard truth first: **local is not the moat by itself.** Local model completion is commoditised
- Twinny, Continue, Tabby, Cline, the official Ollama extension, and VS Code's own chat all do it. One
company bet the business on local-first (Continue) and got acquired into a cloud IDE. Positioning on
"local" or "private" as the headline puts you in a crowded room selling what everyone has.

The moat is what turns a DUMB local model into one that writes CORRECT code. A frontier cloud model is
often smart enough unaided; a small local model is not - it invents field names. Four mechanisms close
that gap, and together they ARE the product:

- **Better context in.** Before the model generates, the real member set - fields, methods,
  constructors, resolved across files and crates - is pulled from the language server and injected. It
  completes against names it could not have guessed, not against its own imagination.
- **Better sensors out.** After it generates, the compiler and the tests judge the output.
  Hallucinated APIs do not survive `cargo check`; wrong behaviour does not survive `cargo test`. The
  sensors are deterministic, not another model's opinion.
- **Prompt engineering.** The prompt is a closed, deterministic composition - doc comment, signature,
  ratified context, nothing else. Same input, same bytes. No hidden scraping.
- **The agentic loop.** On a failed sensor, a compiler-directed repair round feeds the exact error
  back and converges, the way a human iterates against a red build.

Together they make a model that runs on a student's 16GB card produce output competitive with a
frontier cloud model, because the intelligence lives in the deterministic tooling, not the weights.
Dumb model, smart system. And the moat holds even as local models improve - the sensors help any
model, frontier included, so the role shifts from crutch to verification but never disappears.

**The fifth pillar, and the one competitors cannot copy: it refuses to think for you.** The design is
built AGAINST cognitive surrender. The clearest instance: after the model scaffolds a test, it BLANKS
the assertion values and makes YOU type them, because deciding what "correct" means is the design act,
and handing that to the model is exactly the dependency that makes submissions greener while vivas get
worse. The tool removes the typing; it refuses to remove the thinking. That refusal is a moat, because
the agent-first competitors cannot match it without contradicting their own pitch - their promise is
that the AI does more for you, and this product's promise is that it does none of your thinking.

So the marketing job in one sentence: **the competition owns "local"; make this product own "a local
model made correct, that keeps you sharp instead of dependent."**

## Differentiators

Against cloud agents (Copilot, Cursor, the agent-host crowd):
- They negotiate in a chat panel; this is a keystroke on a visible diff. No thread to manage.
- They insert plausibly and hope; this proves the diff against the compiler before you read it.
- They touch whatever the task needs; this never edits outside the target function.
- They ship your code to a vendor; this has no cloud path to ship it through.
- They do the thinking and leave you unable to explain the diff in review or a viva; this hands the
  design decision back to you - you type the assertion values, so you can always defend the code.

Against local-completion tools (Twinny, Continue, Tabby):
- They complete; this completes AND verifies. Same latency class, different guarantee.
- They free-form the right-hand side and invent field names; this injects the real member set from
  the language server, so the completion uses names it could not have guessed.
- They are a model in a box; this is a model wrapped in oracles.

The single demo that wins: a doc comment becomes a function that COMPILES and PASSES the ratified
test on the first read. Plausible-looking output is everywhere; proven-correct output is the thing
no one else puts on screen.

## Required pivots

1. **Headline: "local/private" to "verified/correct."** Local drops from the pitch to the supporting
   evidence. Lead with what the oracle proves; mention local as how it earns the trust, not as the
   reason to care.
2. **Frame: "AI assistant" to "verified generation."** Do not stand in the assistant/copilot/agent
   category - it is crowded and it is the category the senior persona distrusts. Stand in a category
   of one: generation the compiler checks.
3. **Org story: features to guarantees.** For teams and educators, stop listing capabilities and list
   promises: nothing leaves the building, diffs stay reviewable, no telemetry, no procurement, no
   per-seat. Guarantees are what the org channels adopt on; features are noise to them.
4. **The anti-pivot to refuse: never add telemetry or dashboards to "serve" orgs.** The instant you
   ship adoption metrics to win a tech lead, you betray the two primaries whose trust is the whole
   product. Serve orgs with guarantees, never with reports. This is a marketing temptation and a
   permanent no.

## Language to use, and language to ban

Use - it is precise and it is the truth:
- verified, proven, correct, the compiler is the judge, proven before you read it
- a dumb local model made smart, context in and sensors out, the intelligence is in the tooling
- you hold the design, removes the typing not the thinking, the doc comment is the spec, you write
  what "correct" means, it keeps you sharp
- local by architecture, nothing leaves your machine, no account, no telemetry, honest about your
  hardware
- flow-state, a keystroke on a visible diff, function-scoped, reviewable, you see exactly what the
  model gets

Ban - it either lies, over-hypes, or plants you in the wrong category:
- pair programmer, copilot, autopilot, agent, assistant that writes your code
- 10x, magic, effortless, revolutionary, disruptive, let the AI handle it, vibe
- does it for you, hands-free, sit back and let it code (this is anti-cognitive-surrender - never
  imply the tool removes the thinking)
- "just describe what you want" (that is the chat/agent framing, and this is not that)
- "private" as the headline word (support only - it is commodity ground)
- any invented benchmark or adoption number. If you have the figure, cite it; if not, do not print it.

Tagline candidates in the right register:
- "The local AI that has to be right."
- "Proven, not plausible."
- "The compiler checks its work."
- "Removes the typing. Never the thinking."
- "A local model, made right by the compiler."

## What to do

- **Show the oracle on screen.** The transparency IS the marketing: what the model was given, and the
  compiler's verdict on what it produced. Screenshots of the evidence beat adjectives.
- **Make honesty a feature.** The hardware tier tells the truth about a user's box; FIM-only mode on
  a weak machine is honest, not degraded. Say so. Honesty is rare enough to be a differentiator.
- **Target the human who holds the design.** Speak to the person who wants the mechanical typing
  gone, not the person who wants the thinking gone. The right user self-selects on that sentence.
- **Let the guarantees sell the org.** Write the compliance story once - local-only, no telemetry, no
  DPA, reviewable diffs - and let educators and leads forward it.
- **Put discoverability where it belongs: first-run and empty states.** The senior persona wants
  silence at runtime; the student needs to find the gesture unprompted. Resolve it in the docs and
  the onboarding, never in a runtime nag.

## What not to do

- **Do not market to the vibe coder.** "Build me the feature" is the anti-persona; friction to them is
  deliberate. Chasing them dilutes the message and attracts the churn.
- **Do not compete on "local" or on latency.** Both are parity ground. Compete on verified output.
- **Do not overclaim capability.** One toy behaviour - a doubled bracket, a mangled brace - and the
  senior persona uninstalls and tells the team. Under-promise the model; the oracle is the promise.
- **Do not add usage tracking, ever, even to prove traction.** No telemetry is an identity
  commitment. Prove traction with testimonials and visible adoption, never with a dashboard.
- **Do not call it AI that codes for you.** It removes typing, not thinking. The distinction is the
  brand.

## The funnel - two tracks, free-tool currency

Free means the conversion is not a payment, it is activation and advocacy for developers, and
standardisation for orgs. The stages still gate.

### Developer track (the student and the senior engineer)

- **Awareness.** They hear "the local AI whose output the compiler proves," not "another AI coding
  tool." The differentiated hook is the whole job here - if the first sentence sounds like Copilot,
  the senior persona scrolls past and the student cannot tell it apart. Channels: where developers
  vet tools (developer forums, word of mouth, a README that leads with the oracle).
- **Interest.** The landing page shows the loop: doc comment in, proven function out, the compiler's
  verdict visible. Show what the model sees. The transparency is the pitch.
- **Trial.** First-run must work first try on their real hardware and tell the truth about it. The
  tier honesty is the trust handshake. If setup takes an evening, the student is gone.
- **Activation (the aha).** Name it and engineer toward it: the first doc comment that generates a
  function which compiles and passes the ratified test - or the first FIM completion that uses a real
  field name it "should not" have known. That single moment is when "plausible" flips to "proven" in
  their head. The second aha is authorship: typing the assertion value the model left blank, and
  realising the tool made them faster without taking the decision that was theirs. Everything before
  these is setup; get them there fast.
- **Retention.** Stay in flow, never break the design thread, never ship a toy behaviour. Reliability
  IS retention here - the senior persona's loyalty is one mangled brace deep.
- **Advocacy.** The senior engineer recommends it to the team; the student shows classmates. They
  advocate because the guarantees held and because "nothing leaves your machine, no telemetry" is a
  trust story worth repeating. Give them the shareable line.

### Organisation track (the educator and the tech lead)

- **Awareness.** Different hook per channel. The educator hears "students still design every function
  and can defend every line." The lead hears "diffs stay reviewable and nothing proprietary leaves
  the building." Both are pedagogy/integrity stories, not capability stories.
- **Consideration.** Hand them the guarantees, not a feature grid: local-only, no telemetry, no DPA
  to negotiate, no per-seat, no procurement, function-scoped reviewable output. These remove
  objections; features do not move them.
- **Activation.** A lab or a team pilots it and the guarantees hold - submissions improve without the
  viva collapsing; PRs stay small and owned. The proof is that the promise survived contact.
- **Standardisation and advocacy.** They endorse or standardise because the promises held. Serve this
  entirely through guarantees. The moment you reach for a usage dashboard to win them, you have lost
  the primaries - so win them by keeping promises, and let them be the amplifier the personas doc
  says they are.

## The one rule over all of it

Every persona adopts for a different reason - cost, trust, integrity, IP - but all of it rests on the
tool being exactly what it says. The marketing cannot promise what the product will not do (it will
not think for you, it will not touch code you did not target, it will not phone home) and it cannot
undersell the one thing it uniquely does (prove the output correct before you read it). Market the
trust, sell the verification, and never say a word the product would make into a lie.
