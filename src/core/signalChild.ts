/**
 * The one direct `kill()` on a child in `src/`.
 *
 * Node keeps a ChildProcess whose spawn failed open until the `error` event lands on the next
 * tick, and never writes a pid into it. `kill()` on that handle reaches the kernel with
 * whatever bytes sat in the pid field: measured `kill(995632904, SIGKILL)` under strace, and
 * once it landed on the test runner itself. A pid is set only for a spawn that succeeded, so
 * a missing pid means there is nothing to signal.
 */
import type { ChildProcess } from "node:child_process";

/** True when the signal was sent to the child. */
export function signalChild(child: ChildProcess, signal?: NodeJS.Signals): boolean {
  if (child.pid === undefined) {
    return false;
  }
  return child.kill(signal);
}
