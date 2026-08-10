/**
 * Punt detection and mitigation. Small instruct models give up: they return a
 * stub - todo!(), unimplemented!(), an error that says "not implemented", or a
 * comment promising a real implementation later - which COMPILES, so the
 * post-accept oracle (which only fires on compile errors) never catches it.
 * Two levers: nudge the first prompt away from punting, and circle back when it
 * punts anyway, regenerating with the stub shown and a firm instruction.
 */

/** The firm directive appended to a prompt to discourage a stub. These are the
 *  original Rust bytes, pinned byte-exact by the blind punt suite's rust anchor;
 *  non-Rust languages go through noPuntInstructionFor so a Python prompt never
 *  names todo!(). */
export const NO_PUNT_INSTRUCTION =
  "Implement the described behaviour fully and for real. Do not return a placeholder or stub, do not use todo!(), unimplemented!(), or panic!(), and do not return an error that merely says the work is not implemented.";

/** The no-stub directive in the language's own idiom. Rust keeps the pinned
 *  bytes above; Python/C# name their idiomatic stub; everything else (the TS
 *  ids, unknown languages) gets the neutral form with no stub-idiom name to
 *  ban — TS has no canonical one beyond the error-message phrasing. */
export function noPuntInstructionFor(languageId: string | undefined): string {
  if (languageId === "rust") {
    return NO_PUNT_INSTRUCTION;
  }
  if (languageId === "python") {
    return "Implement the described behaviour fully and for real. Do not return a placeholder or stub, do not raise NotImplementedError, and do not raise or return an error that merely says the work is not implemented.";
  }
  if (languageId === "csharp") {
    return "Implement the described behaviour fully and for real. Do not return a placeholder or stub, do not throw NotImplementedException, and do not throw or return an error that merely says the work is not implemented.";
  }
  if (languageId === "go") {
    // panic("unimplemented") is what gopls's own stub generator emits, so it
    // is the stub a Go-trained model reaches for.
    return 'Implement the described behaviour fully and for real. Do not return a placeholder or stub, do not panic("unimplemented"), and do not panic or return an error that merely says the work is not implemented.';
  }
  return "Implement the described behaviour fully and for real. Do not return a placeholder or stub, and do not throw or return an error that merely says the work is not implemented.";
}

// High-confidence stub markers. Kept tight so a legitimate function is not
// re-generated for merely mentioning an error: the macros are near-certain, and
// the phrases are the ones a punting model actually writes.
const PUNT_MARKERS: RegExp[] = [
  /\btodo!\s*\(/,
  /\bunimplemented!\s*\(/,
  // The C# and Python stub idioms. Anchored on `throw new` / `raise` so a catch
  // clause or a bare type mention never trips; prose that embeds the anchored
  // form itself (a docstring saying "raise NotImplementedError to opt out")
  // still does - the anchor narrows the blast radius, it does not close it.
  /\bthrow\s+new\s+(System\.)?NotImplementedException\b/,
  /\braise\s+NotImplementedError\b/,
  /\bpanic!\s*\(\s*["'][^"']*\b(not implemented|unimplemented|todo|placeholder)/i,
  /\bnot implemented\b/i,
  /\bunimplemented\b/i,
  /\bplaceholder\b/i,
  /in a real implementation/i,
  /would (typically|normally|actually) (be|use|need|call|do|require)/i,
  /can(?:no|')t (?:actually )?implement/i,
];

/** True when the generated code reads as a stub that dodges the work. */
export function looksLikePunt(code: string): boolean {
  return PUNT_MARKERS.some((re) => re.test(code));
}

/** The circle-back re-prompt: the prompt the stub came out of, plus the stub
 *  and a demand for a real implementation. Deterministic; goes through the same
 *  generateRaw pipeline as a repair round. */
export function assembleAntiPuntReprompt(input: {
  signature: string;
  docComment?: string;
  punted: string;
  languageId?: string;
  injectedSurface?: string;
  /** The prompt the punted attempt actually ran on, verbatim. Carried so the
   *  retry keeps the context blocks, the injected surface and the file the
   *  first attempt had. A retry assembled fresh is doomed by construction: the
   *  capture measured one at 3432 bytes against an original of 41789, and it
   *  produced a second stub. Absent (a caller with no prompt to hand) keeps the
   *  prior minimal bytes. */
  originalPrompt?: string;
}): string {
  const fence = "```";
  const sections: string[] = [];
  if (input.originalPrompt) {
    sections.push(input.originalPrompt);
  }
  sections.push(
    "Your previous attempt was a stub: it returned a placeholder or said the work was not implemented, instead of doing it. Implement it for real this time.",
    noPuntInstructionFor(input.languageId),
  );
  // The surface already rides the original prompt; repeating it would double
  // the injected bytes for nothing.
  if (input.injectedSurface && !input.originalPrompt) {
    sections.push(input.injectedSurface);
  }
  sections.push(`Your previous stub:\n${fence}${input.languageId ?? ""}\n${input.punted}\n${fence}`);
  const doc = input.docComment ? input.docComment.replace(/\n+$/, "") + "\n" : "";
  const sig = input.signature.endsWith("\n") ? input.signature : input.signature + "\n";
  sections.push(`Now implement it fully:\n${fence}${input.languageId ?? ""}\n${doc}${sig}${fence}`);
  return sections.join("\n\n");
}

// The prose a punting model leaves behind: comment lines, and the message
// inside a stub macro or exception. `#` excludes `#[...]` so a Rust attribute is
// never mistaken for a remark.
const PUNT_PROSE_LINE = /^\s*(?:\/\/\/?|\/\*+|\*(?!\/)|#(?!\[)|--)\s*(.+?)\s*(?:\*\/)?$/;
const PUNT_STUB_MESSAGE =
  /(?:todo!|unimplemented!|panic!|NotImplementedException|NotImplementedError)\s*[(\s]\s*["']([^"']{4,})["']/;

/**
 * The model's own account of why it punted, lifted out of the stub it returned.
 * In the capture this was the correct diagnosis ("we don't have access to the
 * actual cache state") and it died in the channel; the human is owed it, because
 * a generic "generation failed" says nothing about what to add to the context.
 * Undefined when the stub explained nothing.
 */
export function puntDiagnosis(code: string): string | undefined {
  const parts: string[] = [];
  for (const line of code.split("\n")) {
    const prose = PUNT_PROSE_LINE.exec(line);
    if (prose && /[A-Za-z]/.test(prose[1])) {
      parts.push(prose[1]);
    }
  }
  const stubMessage = PUNT_STUB_MESSAGE.exec(code);
  if (stubMessage) {
    parts.push(stubMessage[1]);
  }
  const text = parts.join(" ").trim();
  return text.length > 0 ? text : undefined;
}
