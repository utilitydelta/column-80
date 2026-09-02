/**
 * Mute the speakers for the length of a take, and put them back exactly as they were.
 *
 * quick-speech's lesson: music bleeds into the transcript otherwise. The rule that matters is
 * "restore only what this muted": a user who had the speakers muted already keeps them muted
 * after the take. Nothing here rejects; a platform with no lever says so in `reason` and the
 * gesture goes on without it.
 */
import { execFile } from "node:child_process";

export interface MuteHandle {
  applied: boolean;
  reason?: string;
  restore(): Promise<void>;
}

export type Runner = (cmd: string, args: string[]) => Promise<{ code: number | null; stdout: string }>;

const defaultRun: Runner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => {
      const code = err !== null && typeof (err as { code?: unknown }).code === "number"
        ? ((err as { code: number }).code)
        : err !== null ? null : 0;
      resolve({ code, stdout: typeof stdout === "string" ? stdout : String(stdout ?? "") });
    });
  });

const noop: MuteHandle = { applied: false, restore: async () => undefined };

async function tryLever(
  run: Runner,
  read: [string, string[]],
  isMuted: (stdout: string) => boolean,
  mute: [string, string[]],
  unmute: [string, string[]],
): Promise<MuteHandle | undefined> {
  let state: { code: number | null; stdout: string };
  try {
    state = await run(read[0], read[1]);
  } catch {
    return undefined;
  }
  if (state.code !== 0) {
    return undefined;
  }
  if (isMuted(String(state.stdout ?? ""))) {
    return { ...noop, reason: `speakers were already muted (${read[0]})` };
  }
  let applied: { code: number | null };
  try {
    applied = await run(mute[0], mute[1]);
  } catch {
    return undefined;
  }
  if (applied.code !== 0) {
    return undefined;
  }
  return {
    applied: true,
    restore: async () => {
      try {
        await run(unmute[0], unmute[1]);
      } catch {
        // Nothing to do: the speakers stay muted and the user has the OS lever.
      }
    },
  };
}

export async function muteSpeakers(platform: string, run: Runner = defaultRun): Promise<MuteHandle> {
  if (platform === "linux") {
    const wp = await tryLever(
      run,
      ["wpctl", ["get-volume", "@DEFAULT_AUDIO_SINK@"]],
      (out) => out.includes("[MUTED]"),
      ["wpctl", ["set-mute", "@DEFAULT_AUDIO_SINK@", "1"]],
      ["wpctl", ["set-mute", "@DEFAULT_AUDIO_SINK@", "0"]],
    );
    if (wp !== undefined) {
      return wp;
    }
    const pa = await tryLever(
      run,
      ["pactl", ["get-sink-mute", "@DEFAULT_SINK@"]],
      (out) => /\byes\b/i.test(out),
      ["pactl", ["set-sink-mute", "@DEFAULT_SINK@", "1"]],
      ["pactl", ["set-sink-mute", "@DEFAULT_SINK@", "0"]],
    );
    if (pa !== undefined) {
      return pa;
    }
    return { ...noop, reason: "no speaker mute: neither wpctl nor pactl answered" };
  }
  if (platform === "darwin") {
    const mac = await tryLever(
      run,
      ["osascript", ["-e", "output muted of (get volume settings)"]],
      (out) => out.trim() === "true",
      ["osascript", ["-e", "set volume output muted true"]],
      ["osascript", ["-e", "set volume output muted false"]],
    );
    return mac ?? { ...noop, reason: "no speaker mute: osascript did not answer" };
  }
  return { ...noop, reason: `no speaker mute on ${platform} yet` };
}
