# Persona research: the market around column-80

Mined 2026-07-24 from Reddit via the Arctic Shift archive API (search + comment trees,
two research agents working thread lists serially), extended 2026-07-27 with r/LocalLLM.
Every quote is verbatim with a permalink; spot-check before trusting any single one.
Thread ids at the bottom.
Hunt: switching stories, workarounds, complaints, work-in-context, vocabulary -
around the competition (Copilot, Cursor, agents, local stacks), not around this
product. Claims are tagged observed (quoted evidence) or assumed (my inference).

## Behavioural clusters

Segmented by what people do and want, not demographics. Six clusters observed.

### A. The flow guardian

Knows the syntax by muscle memory; experiences inline AI as interference. Wants
completion that is instant, deterministic, silent.

- "IntelliSense used to feel instant and invisible. Now half the time I'm fighting an AI ghost typing over my shoulder." - https://reddit.com/r/vscode/comments/1tn6pxd/copilot_is_breaking_the_intellisense_so_annoying/oofc6ck/
- "Sometimes you do not want 'AI pair programming,' you just want normal deterministic IntelliSense without fighting ghost text predictions for basic syntax you already know by muscle memory." - https://reddit.com/r/vscode/comments/1tn6pxd/copilot_is_breaking_the_intellisense_so_annoying/oo0ztah/
- Silent model switching as trust killer: "i've had it swap mid-edit while i was working on some jax kernels for a policy run and it just hallucinated away my custom shape checks like it was doing me a favor." - https://reddit.com/r/cursor/comments/1t2gjtl/cursor_silently_switched_models_while_i_was_deep/ojqk8a2/
- Suspicion the editor itself is complicit: "vscode has straight up decided to stop intellisense by default with new releases... they just wanna push people to use AI" - https://reddit.com/r/vscode/comments/1tn6pxd/copilot_is_breaking_the_intellisense_so_annoying/onruf2c/

Personal-goal violation observed: loss of control and trust, not lack of capability.

### B. The recovering agent user

Went deep on agents, hit quality/atrophy/joy loss, deliberately stepped back.
Addiction vocabulary is theirs, unprompted.

- Thread title: "Went back to Autocomplete after Claude Code & Codex! Agentic AI really is a trap!" - https://reddit.com/r/ExperiencedDevs/comments/1tc14n5/
- "I've found my productivity has gone way up since I stopped using agents so much... I've been coding for 30 years now and while using agents was fun and futuristic, the quality generally isn't good enough for my day job." - https://reddit.com/r/LocalLLaMA/comments/1pgwznn/non_agentic_uses_of_llms_for_coding/nsujpn8/
- Relapse cycle: "but after a while i fell in the same trap again and again. That's why i tried not to use AI after my thesis to write code." - https://reddit.com/r/cscareerquestions/comments/1saidpf/ai_made_me_faster_but_also_a_worse_developer/odwd9gr/
- Joy loss: "my love for programming is building by hand solving problems on my own etc. I feel like ai took much of that love away." - https://reddit.com/r/cscareerquestions/comments/1sa0hez/how_to_switch_to_non_agentic_workflow_at_new_job/odshfd5/
- "writing the code myself provides a dopamine boost" - https://reddit.com/r/cscareerquestions/comments/1t6amyc/how_to_you_handle_skill_and_knowledge_atrophy/okgy5z5/

Not anti-AI: they want a bounded tool that cannot become the agent again.

### C. The scoped delegator

Never surrendered. Draws an explicit line: design and hard parts by hand, mechanical
filling delegated. Their self-imposed rules read like this product's spec.

- TODO-scaffold: "write the first pass yourself, but sprinkle TODO comments liberally in place of any bits of code you want the AI to write. Then ask it to fill in those gaps. This keeps you in a position where you control and understand the code." - https://reddit.com/r/ExperiencedDevs/comments/1uzfvrq/how_to_find_joy_in_modern_software_development/oy95vhq/
- "i still write the hard parts myself and use it for the boring scaffolding. you keep the skill by staying the one who understands the code, not the one who just accepts it" - https://reddit.com/r/cscareerquestions/comments/1u3ntir/for_seniors_how_do_you_avoid_deskilling_in_the/or773ms/
- "The actual business logic is always done by me without AI." - https://reddit.com/r/learnprogramming/comments/1usui74/finalyear_cs_student_confused_about_how_much_i/owr7r17/
- Exploration-only boundary: "ask 'where is this functionality located'... though again, generally I write all my own code once I know where to look." - https://reddit.com/r/LocalLLaMA/comments/1pgwznn/non_agentic_uses_of_llms_for_coding/nsuntsc/
- Small-model-suffices-when-scoped (direct support for the function unit): "An 80b model isn't that much 'smarter' than a 31b. The code they produce is honestly about the same. What a bigger model gets you... is better awareness about the larger project. A 27b will write fine code when you scope it small - individual functions" - https://reddit.com/r/LocalLLaMA/comments/1ubpdyn/can_i_realistically_get_close_to_claudecodex/ot1avv2/

### D. The cost-walled local runner

Metered pricing burned them or their employer; local is the only spend they control.
The addiction framing of subsidized-then-metered pricing is theirs.

- "Now we have to pay for our heroine addiction" - https://reddit.com/r/GithubCopilot/comments/1u549bd/what_happened_to_github_copilot_ai_credits_model/ormnu6m/
- "'tech opioid epidemic' My next tattoo. Thanks." - https://reddit.com/r/ExperiencedDevs/comments/1tesidz/token_based_billing_changes_june_1/ombwe6p/
- Enterprise budget cut, team of pros: "we have a budget of about 100 dollars a month... For daily tasks, have resorted to caveman coding." - https://reddit.com/r/GithubCopilot/comments/1tvjxzu/my_big_enterprise_employer_have_just_disabled_the/opj7gq4/
- Local as planned exit: "an anthropic subscription can easily add up to a nice computer after a year or so... qwen3.6 35B is already reaching a good level locally" - https://reddit.com/r/GithubCopilot/comments/1sqyypi/they_are_digging_the_grave_of_github_copilot/ohd4zn9/
- Runaway-cost trust break: "If i can't trust that taking a bath while sending a task won't cost me 2k dollars, then the tool i am using is terrible" - https://reddit.com/r/cursor/comments/1szupca/agent_got_stuck_in_a_loop_and_spent_over_2000_in/oj5165q/
- Privacy variant of the same control need: "You never know what might happen, especially with sensitive code... I would be very careful editing company's secret sauce with them." - https://reddit.com/r/LocalLLaMA/comments/1pgwznn/non_agentic_uses_of_llms_for_coding/nsv0d8r/

Hardware observed: 5070 Ti, paired 16GB V100s ("to run local models fully offline",
110 tk/s on Qwen3.6-35B-A3B Q4), 24GB Macs, 16GB-class throughout. Qwen names recur
as the default local coding family. Speed is the adoption barrier people cite:
"it will run at 5tk/s... impossible to use." - https://reddit.com/r/LocalLLaMA/comments/1pg76jo/why_local_coding_models_are_less_popular_than/nsrd5sf/

### E. The atrophy-afraid learner

Students and juniors who feel the dependence and fear the moment they must perform
without it. They impose discipline on themselves because no tool does it for them.

- "6 months into my first swe job i rely on ai" fixed by ritual: "setting a timer for 45 minutes where i don't touch any AI at all... my brain started building the pathways to solve problems without reaching for the agent first." - https://reddit.com/r/learnprogramming/comments/1uin40h/6_months_into_my_first_swe_job_i_rely_on_ai/ougynij/
- "It's just a bit of punch in the gut seeing your peers get internship by building projects they don't fully understand." - https://reddit.com/r/learnprogramming/comments/1usui74/finalyear_cs_student_confused_about_how_much_i/owqy2s6/
- "if someone put me in front of a whiteboard and asked me to write a sorting algorithm I'd probably embarrass myself." - https://reddit.com/r/cscareerquestions/comments/1saidpf/ai_made_me_faster_but_also_a_worse_developer/odyfmdp/
- Comprehension-without-production: "My brothers grew up around two parents that spoke Arabic, but they would answer in English... People understanding but lacking the ability to effectively write their own code." - https://reddit.com/r/learnprogramming/comments/1usui74/finalyear_cs_student_confused_about_how_much_i/owr7meff/
- A manager observing it from above: "When they do that, I have told them 'I can ask the AI myself. I didn't need you for that.'" - https://reddit.com/r/learnprogramming/comments/1usui74/finalyear_cs_student_confused_about_how_much_i/owubk64/

### F. The burned reviewer

Seniors and leads drowning in AI PRs from authors who cannot explain them. The
richest single thread mined (1560 pts, 406 comments).

- "The real problem is you became the sole owner of code you didn't write from people who don't understand it. That's not a review process, that's you doing unpaid QA for AI output." - https://reddit.com/r/ExperiencedDevs/comments/1towli9/today_i_announced_that_i_wont_be_reviewing_ai/ook1e9z/
- "The rule has always been, if you can't explain the code you PR, then it's a problem." - https://reddit.com/r/ExperiencedDevs/comments/1towli9/today_i_announced_that_i_wont_be_reviewing_ai/oob7xft/
- "Difficult to review a 10k+ PR, or as others in my team say 'ask copilot to review it for you'. Which begs the question, WTF are we doing?" - https://reddit.com/r/ExperiencedDevs/comments/1toznia/ai_impacts_the_quality_of_my_work_severely/oo7bado/
- "Today in a similar pr I commented a question, and I can tell even the answer to the question was AI generated" - https://reddit.com/r/ExperiencedDevs/comments/1towli9/today_i_announced_that_i_wont_be_reviewing_ai/ooe1f3u/
- "multiple people says they feel more tired when working with AI." - https://reddit.com/r/ExperiencedDevs/comments/1towli9/today_i_announced_that_i_wont_be_reviewing_ai/oogbjiu/
- The pressure comes from above, not below: "My director instructed us to have Claude write tests, code, open PRs, and review PRs. We were basically just overseers." - https://reddit.com/r/ExperiencedDevs/comments/1uzfvrq/how_to_find_joy_in_modern_software_development/oy7u005/
- Token use as a KPI, gamed in both directions: "we're measured by how much we use... I've been spinning random shit to waste tokens" - https://reddit.com/r/ExperiencedDevs/comments/1tcvc5t/developers_are_measured_by_tokens/olqvdaa/

## Switching stories, condensed

- Copilot -> Codex/Claude/cancel: push is billing changes and model removal, not
  capability. "I pay my $10/month and have done happily for years... now that the model
  is removed completely the value is gone." - https://reddit.com/r/GithubCopilot/comments/1srj6xi/github_copilot_is_not_the_same_product_you_signed/ohhrqn8/
- Cursor -> anywhere: push is cost catastrophe plus refusal to refund ("Fuck Cursor,
  I moved to Codex" after a $128 message). Anxiety: unbounded spend.
- Agents -> plain autocomplete (cluster B): push is quality and ownership, pull is
  flow and joy. Habit force is real - relapse is described repeatedly.
- Cloud -> local stack: pull is control, privacy, fixed cost. Continue.dev is the
  incumbent and is bleeding: "Continue is not even in the conversation. They've lost
  their minds and made it too bloated and difficult to use." - https://reddit.com/r/LocalLLaMA/comments/1p6nf1r/how_i_replaced_gemini_cli_copilot_with_a_local/nqtd0fx/
  Also: "Continue was never really good at that, but I feel it is getting worse lately.
  Very unreliable, just ig[nores]" - thread https://reddit.com/r/LocalLLaMA/comments/1p183dv/

## Workarounds read as unserved goals

Each is a behaviour, not an opinion; each maps to a design commitment here.

1. TODO-scaffold gap-filling -> the per-function generation unit, human-owned structure.
2. 45-minute AI-free timers, boilerplate-only rules, hard-parts-by-hand -> a tool
   whose boundaries are structural, so discipline is not willpower.
3. settings.json surgery to stop Copilot fighting IntelliSense -> silence and
   determinism as defaults, not options.
4. Plan-with-big-model, implement-with-local -> local implementation is already
   trusted for scoped work.
5. Refuse-to-fix / rewrite-from-scratch review policies -> function-scoped diffs
   with a human owner per line.

## Vocabulary (theirs, verbatim)

slop / slopify; vibecoding (pejorative among pros); enshittification; nerfed;
ghost text / ghost typing; caveman coding; de-skilling; the muscle / keep the reps
up; cold turkey; rusty; unpaid QA for AI output; ticket taker mentality; non-agentic
vs agentic (load-bearing distinction in r/LocalLLaMA); harness; trap.

## Suggestions (mine, not evidence)

Checked against docs/personas.md as written today:

- **Priya: confirmed, observed.** Clusters A and C are her, in the wild, in her own
  words. The TODO-scaffold quote is the closest thing to an external spec of the
  function-generation gesture. Her "hates" list matches the complaint corpus almost
  item for item (silent insertion, non-determinism, interruption).
- **Sam: half-confirmed, needs a correction.** The cost wall is observed (cluster D)
  but mostly among professionals and enterprises. The observed student driver is
  atrophy fear and integrity anxiety (cluster E) - the viva fear the persona already
  names, which the evidence makes primary, with cost second. Consider reweighting
  Sam's goal toward "able to perform without it" over "afford it".
- **Marcus: confirmed, observed (cluster F), with one correction.** The persona casts
  him as the tooling gatekeeper; the evidence shows the mandate often comes from
  above him (directors requiring AI use, token KPIs). His fight is defensive. The
  metrics-manager anti-persona is strongly confirmed as a real, present adversary.
- **Dr. Okafor: still assumed.** No lecturers observed. Nearest evidence is managers
  observing juniors who cannot explain their own work. Keep the assumption flag.
- **Candidate secondary worth writing: the recovering agent user (cluster B).**
  Distinct from Priya - they surrendered, paid for it, and came back. They adopt
  bounded tools as relapse prevention and they evangelize loudly. Possibly the
  loudest early-adopter channel this product has.
- **Anti-persona confirmation.** The vibe coder is real and self-identified; pros use
  "vibecoding" as a slur. No change needed.
- **Two product-thesis confirmations worth carrying into goals:** small local models
  hold up when generation is scoped to a function (the 27b quote, cluster C), and
  completion speed is the local adoption barrier people actually cite (5 tk/s quote,
  cluster D) - the FIM latency invariant is the right hill to defend.

## YouTube findings

Mined 2026-07-24 via yt-dlp: search discovery, minute-marked transcripts (7 videos
deep-read: 2 conference talks, 1 TED research talk, 3 experience reports, 1 rant),
and comment sections of 10 videos (the audience testimony, not the creators').
Sources typed; creator commentary quoted only for first-person experience. Incentive
tells noted inline - several "quit AI" creators sell courses or are sponsored.

### The line people draw, in their own words

- "LLMs are at their best when used as a typing slave. They are at their worst when you become their thinking slave." - comment, 2 likes, https://youtube.com/watch?v=MzbhGaXGltc
- "I'm personally okay with letting AI type for you, but I'm not okay with letting AI think for you. Because the moment you let AI think for you, you're useless." - The Coding Sloth (500+ hours report; sponsored by JetBrains), https://youtu.be/91B_v-wOaws?t=423
- "I still have to figure out the solution. I just don't type it out." - same video, https://youtu.be/91B_v-wOaws?t=363
- "I find that the best way to use AI is to have it write individual functions with known parameters, leaving you to manage the architecture of the code yourself. This way, it's a consultant automaton instead of an engineer." - comment, https://youtube.com/watch?v=91utXFqgSok
- "The smaller the task, the better the results. And if you can't break it down, you don't understand the problem well enough yet." - https://youtu.be/91B_v-wOaws?t=363
- Even the leading agentic-conf talk agrees on the thinking: "Do not outsource the thinking. AI cannot replace thinking. It can only amplify the thinking you have done or the lack of thinking you have done." - Dex Horthy, AI Engineer conf (pitches his own agentic IDE at close), https://youtu.be/rmvDxxNubIg?t=558

### Flow, predictability, joy

- "One of the reasons I like programming is because it is predictable... when we're working with AI, it's not predictable... you can use the exact same prompt and get a different response every single time." - CJ, "AI Coding Sucks" rant, announcing a month AI-free, https://youtu.be/0ZUkQF6boNg?t=61
- "I have worked so hard at crafting like the perfect claude.md and the perfect cursor rules. But still every now and then the AI will drift... I have no fix for this." - https://youtu.be/0ZUkQF6boNg?t=305
- "At Google, the absolute worst part of the job was writing docs and reviewing code... Managing these AI agents, the worst part of my job, is now the job." - SimonDev (20yr veteran), https://youtu.be/2dTENijF30c?t=1032
- "The peak dev experience is to wait anxiously like a junior dev, wondering if your changes will make the LLM do what you expected or not." - experience report, https://youtu.be/DLwyGjFsPPM?t=181
- Audience: "one of the big problems with AI is that it disallows us to experience flow state" / "That little dopamine hit... is the feeling of self-esteem... You can't give people self-esteem, it has to be earned" / "I don't like this profession anymore, I want to be a farmer" - comments on rgiuaJbyUyU, 0ZUkQF6boNg, 91utXFqgSok
- Employer mandate is a recurring force: "my company is pushing me to use AI and had me install codex.. just writing prompts and having AI write code for you is the most boring thing I have ever experienced" - comment, https://youtube.com/watch?v=91utXFqgSok

### Research-grade atrophy evidence (TED, Microsoft Research)

Advait Sarkar, MSR: "I've become a professional validator of a robot's opinions" -
https://youtu.be/3lPnN8omdPA?t=65 - citing studies: AI-assisted knowledge workers
produce a smaller range of ideas, "reported that they put less effort into critical
thinking... and this effect was greater when they had greater confidence in AI"
(https://youtu.be/3lPnN8omdPA?t=186), remember less of what they wrote, and "when we
don't use our brains, they get worse at brain things." His closing question is this
product's pitch: "What would you rather have? A tool that thinks for you, or a tool
that makes you think?" (https://youtu.be/3lPnN8omdPA?t=856)

### Local setup pain (tutorial comment sections)

The local aspiration is real and the current experience is bad - the gap is the
opportunity. Observed: "the Continue extension that enables this has been mediocre
at best - or even disappointing"; context-length errors on a 28KB file; agent modes
that cannot edit files across 3 different rigs; "3 minutes is too much... time is
money"; "I only spent $3000 to save $0.49"; "not sure I'd like having a jet engine
running for a whole working day"; "For anyone thinking this is viable, just stop!
Local AI is nowhere near where clickbaity youtubers want you to think it is." - all
comments on MzbhGaXGltc / 2qFcbRK1qDE / GImq1WL9OJQ. Hardware named by commenters:
RTX 4050 laptops, 16GB RAM boxes, M2 Airs, GTX 1650 4GB hopefuls. Cost framing:
"every time i type something, money leaves my bank account" (15 likes, the highest-
liked mined comment on any local video).

### The evangelist camp, in its own words

The counter-position exists and is winning conference stages. Its concessions are
the interesting part: "It can become quite addictive... the bills do tend to stack
up" and "I run six windows with agents... that's sort of where I found my cognitive
limit" (Stensby, NDC London, https://youtu.be/NbenxkeJkEA?t=437 and ?t=3476), and
Horthy's own market read: "staff engineers don't adopt AI because it doesn't make
them that much faster... and the senior engineers hate it more and more every week
because they're cleaning up slop that was shipped by cursor the week before"
(https://youtu.be/rmvDxxNubIg?t=1162).

### YouTube deltas to the suggestions above (mine, not evidence)

- Priya's determinism need is now directly observed (CJ's predictability rant,
  drift-despite-claude.md). The closed prompt composition is the answer to a
  complaint people are making out loud.
- Sam/Okafor's atrophy stance gets research backing (Sarkar/MSR), not just anecdote.
- Cluster D nuance: local's observed blockers are setup pain, speed, thermals, and
  honest-cost - the tier system and FIM latency bar target the exact complaints.
  Sticker-shock quotes argue for keeping the 16GB default honest and loud.
- The "typing slave / thinking slave" comment and the individual-functions comment
  are the two strongest external formulations of the product thesis found in any
  source so far; worth quoting in marketing.md.

## r/LocalLLM findings

Mined 2026-07-27, Arctic Shift again, ~45 threads from r/LocalLLM covering 2026-07-06
to 2026-07-26. This sub was untouched by the earlier pass, which worked r/LocalLLaMA.
It is a different crew: less ideology, more receipts. People here post configs,
tok/s numbers and hardware bills.

Read the contamination warning before you trust any single quote below.

### Contamination warning: this sub is half slop

A large share of r/LocalLLM posts are LLM-written, and the sub knows it. The
hostility is the strongest signal in the corpus, and it fires on exactly the
artifacts column-80 would produce, so it doubles as a warning about how to publish.

- "You know it's slop when it's a massive wall of text but outdated models." - https://reddit.com/r/LocalLLM/comments/1v3imb2/comment/oz38yjz/
- "jus the title alone screams llm generated wall of text incoming" - https://reddit.com/r/LocalLLM/comments/1v3imb2/comment/oz3c91q/
- "You are lazy to format the AI-slop text for real humans and drop all the blablablah from it -> We are lazy to read through it." - https://reddit.com/r/LocalLLM/comments/1v3imb2/comment/oz3geo8/
- "You can tell Claude wrote this because it's "honest"." - https://reddit.com/r/LocalLLM/comments/1v4lol2/comment/ozbywro/

Practical consequence: several polished first-person experience reports in this sub
cannot be verified as human-written. Where a finding rests on a single post's
narrative rather than on a config, a number, or a reply from another user, it is
tagged **unverified authorship** below. Configs and hardware complaints are safe;
tidy stories with round numbers are not.

### The anchor thread: a 35B model failed, and the sub diagnosed the harness

The thread you sent, "Serious question: Are <= 35B local models really good enough?"
(48 comments), is the closest thing to a live experiment on the column-80 thesis.
OP ran Qwen3.6 and Ornith at 27B-35B on 16GB VRAM against unscoped app-scaffolding
work: build me a WinUI 3 GUI for llama.cpp, now read gguf metadata. Six hours lost,
then Cursor fixed it in two prompts.

His own summary: "What took me maybe 6 hours to do I managed to do in 10 minutes in
Cursor." - https://reddit.com/r/LocalLLM/comments/1v754yo/

Nobody told him the model was fine. Nobody told him local was a mistake. Forty
strangers told him he used it wrong, and the correction they gave is this product's
spec:

- "One Shot is not possible with models that size. You need to be very precise with your prompts and break the tasks down so they are small enough for the local model to handle." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozvj5pr/
- "Do not expect any sort of vibe coding with <=35B" - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozvpgzd/
- "Qwen3.6-35B-A3B works great if you give it clear, small coding task one at a time." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozxrphw/
- "So yeah, they work well, but you need to find the workflow that lets them be successful. And it's usually a somewhat contained workflow. I don't think you'll be doing a project from scratch with them." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozvz0wb/
- The compiler-as-reviewer argument, unprompted, from the thread's best answer: "pair good static analysis checks to keep the output on-rails" and "models are much, much more capable when given deterministic verifier test gates." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozviuj5/

One reply cut past context size to the real failure: OP picked a stack the model has
barely seen. "No window size fixes missing knowledge." -
https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozx3h7f/

Read the whole thread as one finding: the local community's own remedy for a weak
model is to shrink the unit of work and put a deterministic checker behind it. That
is observed, repeatedly, by people with no stake in this product.

### Harness beats model, with numbers

Two threads carry measurements that argue for closed, minimal prompt composition
better than any manifesto line.

"Same model, 3 harnesses: opencode is 2x slower - and it's the harness, not the
model" (81 comments). Same llama-server, same Qwen3.6-35B-A3B-MTP quant, same repo,
same prompt. 2:00 for the lean in-app chat, 2:30 for Qwen Code, 7:57 for opencode.
Generation throughput was identical at ~46 t/s across all three; opencode's context
ballooned to 105-109k tokens because it re-sends a large system prompt and the full
tool schema every turn.

- OP: "For local agentic work, wall-clock is dominated by how much context the harness pushes and how many tool turns it takes - not raw t/s." - https://reddit.com/r/LocalLLM/comments/1v2cvhc/
- The number that matters, from a reply: "Opencode`s system prompt is like 14,000+ tokens, Pi`s is 1000-ish" - https://reddit.com/r/LocalLLM/comments/1v2cvhc/comment/oyx6xod/

Second, an independent prefill measurement that indicts bloated harness prompts
directly: "Measured on an M5 Pro: 27B dense does 114 tok/s prefill vs 730 for
35B-A3B, so with Copilot's 41.7k-token system prompt the dense model needs 6+
minutes before the first token." -
https://reddit.com/r/LocalLLM/comments/1v58zsb/comment/ozhzll2/

Copilot's 41.7k-token system prompt is the competitor's tax, measured by a stranger
on his own laptop. Column-80's prompt is a deterministic function of the cursor
window. That gap is the product.

Also observed, and useful for the generation path: reasoning hurts on scoped coding
work. "With smaller models specifically I've learned that reasoning off is better for
coding tasks. You use reasoning for research, log hunting, spec writing, but coding,
just execute." - https://reddit.com/r/LocalLLM/comments/1uyukbe/comment/oy2ujwf/
Thinking budgets are the workaround people reach for: a budget "prevents the "but
wait" loops" - https://reddit.com/r/LocalLLM/comments/1uyukbe/comment/oy4k236/

### How the sub savages a speed claim

The reaction to that harness benchmark is a warning worth more than the benchmark.
The sub tore it apart for measuring latency without measuring quality, and the
top-voted objections were not from cranks.

- "SPEED vs QUALITY How are you measuring quality?" - https://reddit.com/r/LocalLLM/comments/1v2cvhc/comment/oyu5bu9/
- "This is pointless slop without an assessment of quality since we know the harness hugely affects quality." - https://reddit.com/r/LocalLLM/comments/1v2cvhc/comment/oyvnm64/
- "A proper experiment holds variables constant, to focus on what you are measuring. If you aren't holding quality constant, then any speed difference is meaningless" - https://reddit.com/r/LocalLLM/comments/1v2cvhc/comment/oyvly48/
- And a joke that landed on 21 points: "- I'm very fast at math. - Yeah? Well, how much is 23 time 47? - (answers instantly) 8 - That's not the correct answer! - But it was fast." - https://reddit.com/r/LocalLLM/comments/1v2cvhc/comment/oyvb7if/

Any latency figure column-80 publishes without an acceptance-rate figure beside it
gets this treatment. Aye, they'll keelhaul it. The FIM latency invariant is right;
publishing it alone is not.

### The vacated slot: nobody serves local inline completion

The biggest finding in this sub is an absence. Searches for FIM, autocomplete, ghost
text, inline suggestion, tab completion and code completion across the sub's whole
history return almost nothing. r/LocalLLM discourse is agentic end to end: harnesses,
sub-agents, orchestration, tool calls. Inline completion is not a topic here.

That is opportunity and risk in the same fact. Uncontested, and undemanded.

The few people who do want it are unserved and say so plainly. The clearest single
post in the entire corpus for this product, "Continue.Dev just seems broken":

> "I'm having the biggest headache trying alternatives to github copilot. I found
> continue.dev, but I simply cannot get it to work reliably... Do not bother
> recommending any CLI tools or agent focused tools like Cline, I have absolutely no
> interest in agentic tools." - https://reddit.com/r/LocalLLM/comments/1u7a9nx/

Three replies. None solved it. Same shape from a student-and-coding post: "for the
coding part I'm not looking for an "automate everything" agentic vibe; I just need
help with snippets, debugging, and logging." -
https://reddit.com/r/LocalLLM/comments/1v7b3aa/

The incumbent has left the field. Continue was already bleeding in the earlier
research; in this sub it is spoken of in the past tense. Tagged **unverified claim**,
though three separate users say it independently:

- "I believe Continue ran out of money a day or two ago" - https://reddit.com/r/LocalLLM/comments/1u7a9nx/comment/orys5z2/
- "Don't use Continue.dev Its by far the worst harness I've ever used. buggy as hell. try opencode." - https://reddit.com/r/LocalLLM/comments/1upq1ta/comment/ow6yc5g/
- "Also Continue.dev is deprecated." - https://reddit.com/r/LocalLLM/comments/1upq1ta/comment/ow1xzfp/
- "I migrated to opencode after continue.dev discontinued." - https://reddit.com/r/LocalLLM/comments/1upq1ta/comment/ow27jxn/

Note the migration path: Continue users are being pushed to opencode, an agentic CLI
with a 14k-token system prompt. Nobody is catching the people who wanted completion.

What remains for FIM is llama-vscode, and the setup tax is visible inside a single
thread. The recommendation: "Takes a bit of fiddling to setup but it used to work
fairly well with Qwen3-Coder-30b. Perhaps not as good as copilot but extremely fast.
In particular you'll want to start llama-server with --cache-reuse 256 for
efficiency." - https://reddit.com/r/LocalLLM/comments/1r9rmuv/comment/o6efny3/
The result, from the same asker two comments later, after pasting a full llama-server
invocation: "when I start typing, nothing happens" -
https://reddit.com/r/LocalLLM/comments/1r9rmuv/comment/o6eo8nw/

And the load-bearing piece of knowledge that separates working local completion from
garbage sits at 1 upvote, in a thread with 1 comment:

> "for inline completion you want a small fim model not a big chat one, qwen2.5-coder
> 1.5b or 3b is what Continue actually recommends and it auto detects the fim
> template, a 32b chat model doesnt speak the fim tokens so it just spits garbage and
> lags" - https://reddit.com/r/LocalLLM/comments/1uc431m/comment/ot1516r/

FIM-versus-chat is tribal knowledge in a sub that lives on model configs. Most people
asking for local completion are pointing a 27B chat model at it and concluding local
completion is bad.

One competitor exists and got zero traction: Axiom, a VS Code OSS fork with Electron
stripped out, local autocomplete, BYOK, and hard token limits, posted 2026-07-06 to
zero comments. https://reddit.com/r/LocalLLM/comments/1up75pa/ The memory-bloat pitch
is real and the market did not react.

### The 16GB question, answered honestly

For agentic work the sub's floor is 24GB and rising, stated bluntly:

- "If you do not have at least 24gb you will be disappointed..... Believe me..." - https://reddit.com/r/LocalLLM/comments/1v3tzsg/comment/ozdia8j/
- "I'm already paying +140€/month in subscriptions and hitting limits. But yeah, at least 24/32gb VRAM or not worth it." - https://reddit.com/r/LocalLLM/comments/1v3tzsg/comment/ozdi952/
- "You're gonna need at least 32GB of VRAM for this model for agentic coding at the necessary quantization and speed" - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozviuj5/

That floor is a floor for context, not for capability. The KV cache eats it: one
detailed reply works out that 20 layers on GPU at 500K context is ~10GB of KV in
VRAM before weights, "so it isn't the total that breaks, it's that both sides are
tight at once" - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozx3h7f/

Scoped completion does not carry a 100k-token context, which is why the same sub
describes small hardware positively the moment the unit of work shrinks:

> "In the 6GB VRAM bracket, you're not looking for a "coder," you're looking for a
> "sophisticated autocomplete." Qwen 2.5 Coder 3B is the right starting point, but
> don't expect it to reason - expect it to guess the next three lines of
> boilerplate." - https://reddit.com/r/LocalLLM/comments/1uv7rol/comment/ox9dlve/

That is column-80's bottom tier, described approvingly by someone who thinks he is
lowering expectations.

Quantization is the other axis, and it is contested with feeling. Code output is
where Q4 breaks first:

- "Q4 is dumb as shit." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozvd7w0/
- "Q8 is really what you need if you're using that model for code generation. I found Q4 to often fail at outputting something that actually runs without multiple iterations." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozviuj5/
- "Switching from Q4 to Q5 was eyes opening." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozvmz9n/
- And the reproducibility problem underneath the whole sub: "One person can be running the BF16 weights and another some random q4 or worse quant and have completely opposite experiences: they aren't the same model at all at that point." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozvz70j/

That last one is a hazard for column-80's own measurements and for every bug report
it will ever receive. A tier recommendation that names a parameter count without
naming a quant is not a recommendation.

### The ops tax nobody warns you about

The strongest unserved goal in the sub is not tokens per second. It is that going
local makes you the operator.

> "the big one nobody warns you about is you become the ops team. no more someone
> else's uptime. driver and runtime version skew will eat afternoons, a model that ran
> last month wont load after an update, and you own all of it now. worth it for a lot
> of us but it's a real tax, not just "slower."" -
> https://reddit.com/r/LocalLLM/comments/1uwob7v/comment/oxmgk3r/

Corroborated by behaviour, not just opinion: "It took me three months of trial and
error to get there. Just trying to save you some pain."
(https://reddit.com/r/LocalLLM/comments/1v58zsb/comment/oziuhp0/), a thread titled
"Llama.cpp / LM Studio refuses to load a model anymore", and half the sub's traffic
being chat-template jinja fixes, `--fit` flags, `n-cpu-moe` regexes and MTP builds.

MTP speculative decoding is the recurring speed unlock and it is passed around like
folklore: 8 to 20 t/s on one setup, 9 to 30 t/s on another after a stranger's config
was pasted in ("this is life changing for me" -
https://reddit.com/r/LocalLLM/comments/1v3tzsg/comment/ozv9ck1/). Configuration
literacy is the barrier to local adoption, and it is a bigger barrier than model
quality.

### The hybrid ritual, hardened into scripts

The plan-with-cloud, implement-with-local split from the earlier research now shows
up as built infrastructure rather than a habit. This is the top workaround in the sub.

- "Sonnet give works to Qwen3.6 (locally) and validate the works done after. This way the higher capable model design and verify. The less capable modèle do the works." - https://reddit.com/r/LocalLLM/comments/1v57bcv/comment/ozgo2hj/
- Same user, the mechanism: "It setup up a script that wrap opencode and produce a diff at the end... Claude produce a task file for qwen that I review, Claude start qwen with the task file on my approval." - https://reddit.com/r/LocalLLM/comments/1v57bcv/comment/ozhm9xh/
- "Use SpecKit or OpenSpec with Sonnet 4.5 to make plan, write spec, prepare tasks - Implement coding tasks with Qwen3.6-35B-A3B Q4" - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozxrphw/
- The frontier model as harness author: "I'm using Kimi to create workflows/harnesses for Qwen 3.6 27B. I have it watch 27B work through a use case and apply harness level adjustments to help it along." - https://reddit.com/r/LocalLLM/comments/1v3be35/comment/ozb4unr/

Read as an unserved goal: people are hand-building a scoping layer between a designer
and a local implementer, and paying a frontier subscription to author it. Column-80
makes the human the designer and deletes the layer. Nobody in this sub has considered
that option, because inline completion is not in their vocabulary.

Also observed, and it is the manifesto in someone else's words: check whether the job
needs a model at all. "before you move the QA gates to a local model, ask which of
them need a model at all. Running the tests, diffing the scope of a change, checking
the build - deterministic, free, and they should fire before any LLM reviewer burns a
token." - https://reddit.com/r/LocalLLM/comments/1uwob7v/comment/oxmdkvp/ The same
reflex fires on an automation question: "Yes but your LLM isn't relevant here … this
is a deterministic flow." -
https://reddit.com/r/LocalLLM/comments/1uz29gw/comment/oy3z9md/

### Dissent worth carrying, because it is not stupid

Four positions in this sub cut against column-80. None of them are held by fools.

1. **Latency does not matter.** "Isnt the point for xoding that you have better output instead of a speed? Some comments are about speed but for coding you need quality. You give an excelent prompt, than wait, make some cofee, when result comes, you verify it. Speed is not secondary, it is terciary." - https://reddit.com/r/LocalLLM/comments/1v57x7x/comment/ozibe2d/ This is coherent for batch agentic work and irrelevant for per-keystroke completion. It is the same person who would never install column-80, which makes them a clean anti-persona rather than a threat.
2. **Small models are toys.** "35b and less models are just toys. After you start going to 300b and up is where they start to get useful for most things." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozwoe4c/ Sharper version: "Yeah. It'll destroy your codebase. What it's really good for is recon. You gotta front some money or wait a year." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozxwt6y/ Both are judgments about autonomous multi-file work, and both are probably right about it.
3. **Free frontier models killed the cost argument.** "And then Deepseek V4 Flash released, which is literally free on places like opencode zen. My argument for them have been gone unless you need true privacy, or want to mess around." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozvr411/ Backed by arithmetic elsewhere: "if my napkin math is correct, Deepseek v4 Flash API is cheaper for me than electricity for GPU inference of Qwen." - https://reddit.com/r/LocalLLM/comments/1v7642y/comment/ozwjr15/ Cost is a weakening leg. Privacy, offline capability and no-rate-limit hold, and they are what people actually cite when describing work code: "vs code, open code, qwen3.6 27b - helps me a lot for code that is not allowed to be in any cloud" (https://reddit.com/r/LocalLLM/comments/1ur6h0p/comment/owdmp01/), "I usually use local models when Im using real credentials that I dont want going to whoknowswhere APIs" (https://reddit.com/r/LocalLLM/comments/1v57bcv/comment/ozgj98g/), and regulated data named outright, "safeguard the privacy of the things we want the AI to interact with (e.g. Patient data)" (https://reddit.com/r/LocalLLM/comments/1ur6h0p/comment/owdjy3g/). Cluster D's spine is control, not price, and the marketing should say so.
4. **Local models are weak on C#.** "What I found, was that most models are not well versed on dotnet. They understand it, but they lack architectural knowledge, so when it gets a bit more complex, they fail." - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozwn6ye/ Partly countered by "Qwen3.6-27b Q6 codes C# pretty well" (https://reddit.com/r/LocalLLM/comments/1v67kwp/comment/ozodjwh/). The anchor thread's whole failure was C# WinUI. Since column-80 ships a C# leg, this is a measurement to run, not a quote to trust either way.

### The pride, which is the sales pitch

The human-in-the-loop position is popular here and stated with swagger, not anxiety.

- "An intelligent human with Qwen3.6 is a demigod." - https://reddit.com/r/LocalLLM/comments/1ur6h0p/comment/owe4tsg/
- "What the world needs are better ideas, not better models." - https://reddit.com/r/LocalLLM/comments/1v3be35/comment/oz1swtw/
- "I have been able to improve the environment the model operates in to improve the quality of output to the point where I can't see the point in a bigger model anymore." - https://reddit.com/r/LocalLLM/comments/1v3be35/comment/oz2eb2v/
- "You can replicate the results, for some of the tasks, but ita a lot more handhold, which i think actually makes of better engineering. The lure of ease of vibe code is too big." - https://reddit.com/r/LocalLLM/comments/1v57bcv/comment/ozh3ngm/
- "It's a waste of money and resources using the most powerful models to bang out boilerplate code, use the correct tool for the job." - https://reddit.com/r/LocalLLM/comments/1v3be35/comment/oz2nir8/
- And the local advantage nobody in the cloud has: "with local usage I don't really care because I have infinite tokens to just iterate" - https://reddit.com/r/LocalLLM/comments/1v754yo/comment/ozvfm9p/

One experience report, tagged **unverified authorship**, is worth reading whole
anyway because its conclusions match the configs elsewhere in the sub. Three weeks
fully local on an M4 Max, 40 tasks from real git history: 19 of 40 first try versus
33 for the cloud model, 27 of 40 with test-output iteration. Failure modes: diffs
stop applying past ~30k tokens of context, wrong-neighbouring-file edits about one in
eight, no sense of done, two minutes of prefill. The fix: "most of the fix was
harness work, not model work. feed functions instead of whole files, run tests
automatically and feed back only the failures." And the reason to bother: "local
fails slowly and in front of me. the api failed instantly and for everyone at once.
only one of those is something i can fix on a saturday." -
https://reddit.com/r/LocalLLM/comments/1v79qny/

"Feed functions instead of whole files" is the function-generation unit, arrived at
independently under measurement pressure.

### Vocabulary added by this sub

MTP (speculative decoding, the universal speed unlock); prefill and TTFT as the
metric that actually hurts; harness (fully load-bearing here, and a quality claim not
just a plumbing one); n-cpu-moe and offload; the quant ladder spoken as identity
(Q4/Q5/Q8/iq3/iq4xs/NVFP4/BF16); dense versus MoE; reasoning budget; slopmaxx; grunt
work; implementation slave; caveman-adjacent "recon" for read-only model use.

### Deltas to the suggestions above (mine, not evidence)

- **The persona this sub reveals is not new, it is cluster D with an ops problem.** The cost-walled local runner is here in volume, but their live pain is configuration and operations, not price. Reweight Sam or whoever inherits cluster D toward "I do not want to become the ops team" and away from "I cannot afford it". The three-months-of-trial-and-error quote and the jinja-template traffic are the evidence.
- **Zero-config is a bigger wedge than latency.** Latency is the invariant column-80 must not lose. Setup is the reason people never get far enough to notice it. Anything that makes a first working completion happen without a llama-server command line is worth more than another 20ms.
- **Publish acceptance rate beside every latency number.** This sub reflexively destroys speed-only claims, and it destroys them correctly. See the savaging section.
- **Name the quant in every tier recommendation.** "16GB tier" means nothing. "16GB, Qwen3.6 27B at iq4xs, this many tokens of window" is a claim someone can check. The BF16-versus-random-q4 quote says the sub cannot compare experiences without it, and code is the workload where Q4 breaks first.
- **The competitive slot is genuinely empty and that is a demand risk, not a demand signal.** Continue is spoken of as deprecated or out of money, its refugees are being routed to agentic CLIs, llama-vscode works but demands llama-server literacy, and Axiom launched to silence. Nobody is fighting for this user. Very few users are asking. Column-80 will have to create the gesture's demand, not capture it.
- **Stop leaning on cost in marketing.** Free frontier flash models plus electricity math have holed that leg below the waterline in this sub. Privacy, offline, no rate limits, no vendor yanking a model mid-refactor, and understanding your own code are the legs that hold.
- **Measure the C# leg against the anchor thread's failure.** The one thread where a local model comprehensively failed was C# scaffolding, and the sub's read is missing architectural knowledge of dotnet rather than context size. Column-80 generates function bodies at a call site with types in the prompt, which is a much narrower ask, and that difference is exactly what a measurement should isolate.
- **Two quotes to steal for marketing.md**, alongside the typing-slave pair already there: "sophisticated autocomplete... expect it to guess the next three lines of boilerplate" (the 6GB tier, described by a skeptic) and "wall-clock is dominated by how much context the harness pushes and how many tool turns it takes - not raw t/s" (the closed-prompt argument, measured by a stranger).

## Provenance

Reddit threads mined: 1tesidz, 1srj6xi, 1tvjxzu, 1tcvc5t, 1tj1qv4, 1tc14n5, 1toznia,
1u1xbl8, 1szupca, 1t2gjtl, 1sqyypi, 1nbudf2, 1p6nf1r, 1p183dv, 1tn6pxd, 1u549bd,
1pgwznn, 1pg76jo, 1tw94fn, 1ubpdyn, 1ujhtl9, 1uu2p7b, 1uin40h, 1usui74, 1saidpf,
1u3ntir, 1sa0hez, 1ugaqo5, 1uzfvrq, 1t6amyc, 1towli9.
Searched with low yield: r/csMajors, r/programming (generic), plus assorted queries
that returned product spam rather than users.
YouTube transcripts: rmvDxxNubIg, 2dTENijF30c, 91B_v-wOaws, 3lPnN8omdPA, NbenxkeJkEA,
0ZUkQF6boNg, DLwyGjFsPPM. Comment sections: those plus rgiuaJbyUyU, ya6520zh4pQ,
91utXFqgSok, 5-tzLvOu9lo, 2qFcbRK1qDE, T_arXqLvOKs, MzbhGaXGltc, GImq1WL9OJQ.
Low signal: T_arXqLvOKs (3 comments), 5-tzLvOu9lo (off-topic - Office Copilot, not
coding - plus affiliate spam bots).

r/LocalLLM threads mined 2026-07-27: 1v754yo (anchor), 1v79qny, 1v2cvhc, 1v3tzsg,
1uyukbe, 1ur6h0p, 1v57x7x, 1v58zsb, 1v3be35, 1v57bcv, 1v7642y, 1v67kwp, 1v72a5h,
1v7b3aa, 1uwob7v, 1uxuygw, 1uwbi7y, 1uv7rol, 1v08ir3, 1ux1hwk, 1uz29gw, 1utjs20,
1u7a9nx, 1uc431m, 1r9rmuv, 1upq1ta, 1up75pa, 1ux69qt, 1v3imb2, 1v4lol2, 1v4ng5g,
1v59914, 1v6lkk7, 1v6f5b5, 1v6xlot, 1v74f2l, 1v3dvsy.
Discovery queries with near-zero yield, and the absence is itself the finding: FIM,
autocomplete, ghost text, inline suggestion, inline completion, tab completion, code
completion, tabby, copilot alternative. Junk yield: 1v6xlot (meme thread), 1v59914 and
1v4lol2 (LLM-written posts, comments are pile-ons), 1v3imb2 (same, useful only as slop
evidence).
