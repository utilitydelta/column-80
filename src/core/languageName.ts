/**
 * A VS Code language id as a person names the language. A toast that says
 * "typescriptreact" or "plaintext" shows the user an internal key; the names
 * here are the ones VS Code's own language picker shows. An id not listed is
 * returned as it is: a wrong capitalisation is cheaper than a wrong name.
 */
const NAMES: Readonly<Record<string, string>> = {
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  go: "Go",
  html: "HTML",
  java: "Java",
  javascript: "JavaScript",
  javascriptreact: "JavaScript React",
  json: "JSON",
  jsonc: "JSON with Comments",
  kotlin: "Kotlin",
  markdown: "Markdown",
  php: "PHP",
  plaintext: "plain text",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  shellscript: "shell script",
  sql: "SQL",
  swift: "Swift",
  toml: "TOML",
  typescript: "TypeScript",
  typescriptreact: "TypeScript React",
  xml: "XML",
  yaml: "YAML",
};

export function languageName(languageId: string): string {
  return NAMES[languageId] ?? languageId;
}

/** The languages every model command serves, in the order the toasts list them. */
export const SERVED_LANGUAGES = "Rust, TypeScript, JavaScript, C#, Python and Go";

/** One sentence for a command pressed in a file it does not serve, without the
 *  "Column 80: " prefix, so a caller that adds its own prefix does not double it.
 *  Every command's unsupported-language refusal goes through here, so they keep
 *  one shape. `worksIn` is the command's own list: Run Covering Tests serves
 *  fewer languages than generation does. */
export function notServedSentence(command: string, languageId: string, worksIn = SERVED_LANGUAGES): string {
  return `${command} does not work in ${languageName(languageId)} files. It works in ${worksIn}.`;
}

/** The same sentence as a toast, for callers that show it as it is. Here and
 *  not in `toastText.ts`, which must import nothing. */
export function unsupportedLanguageToast(command: string, languageId: string, worksIn = SERVED_LANGUAGES): string {
  return `Column 80: ${notServedSentence(command, languageId, worksIn)}`;
}
