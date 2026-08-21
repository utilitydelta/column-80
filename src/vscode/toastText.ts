/** The first non-blank line of a multi-line message, for a one-line toast.
 *
 *  A leaf module on purpose: fnGen, tightenDocComment and firstRun all bound
 *  their toasts with it, and neither tightenDocComment nor firstRun may import
 *  fnGen (fnGen registers both, so a value edge back would be a cycle). */
export function firstLine(s: string | undefined): string {
  return (s ?? "").split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
}
