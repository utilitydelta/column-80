#!/usr/bin/env node
// A microphone for the host tier: the shape of column80-capture, fed by a fixture.
//   --list          two devices, exit 0
//   otherwise       stream the PCM body of $C80_FAKE_WAV (bytes after 44) to stdout in 640-byte
//                   slices every 20ms (real time at 16kHz s16le); zeros once the file is spent;
//                   one more slice after stdin closes, then exit 0.
// $C80_FAKE_MIC_DELAY_MS (default 40) delays the first slice, so press-to-first-buffer is a
// number the channel can report rather than 0.
"use strict";
const fs = require("fs");
const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  process.stdout.write(JSON.stringify([{ name: "Fixture Microphone", default: true }, { name: "Silent Microphone", default: false }]) + "\n");
  process.exit(0);
}
process.stderr.write(`capturing device=fixture argv=${JSON.stringify(argv)}\n`);
const wav = process.env.C80_FAKE_WAV;
const body = wav ? fs.readFileSync(wav).subarray(44) : Buffer.alloc(0);
const SLICE = 640;
let at = 0;
let closing = false;
const slice = () => {
  if (at < body.length) {
    const out = body.subarray(at, Math.min(body.length, at + SLICE));
    at += SLICE;
    return out;
  }
  return Buffer.alloc(SLICE);
};
let timer;
process.stdin.on("end", () => {
  closing = true;
  clearInterval(timer);
  process.stdout.write(slice(), () => process.exit(0));
});
process.stdin.on("error", () => undefined);
process.stdin.resume();
setTimeout(() => {
  if (closing) return;
  process.stdout.write(slice());
  timer = setInterval(() => {
    if (!closing) process.stdout.write(slice());
  }, 20);
}, Number(process.env.C80_FAKE_MIC_DELAY_MS || 40));
