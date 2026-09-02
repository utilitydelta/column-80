#!/usr/bin/env node
// Fake column80-capture for the phase 3 blind rows. Three behaviours:
//   --list      print a fixed device array and exit 0
//   --exit N    exit with code N at once
//   otherwise   echo argv to stderr as one line, then stream the PCM body
//               (bytes after 44) of threat-level-3s.wav to stdout in 640-byte
//               slices every 20ms (real time for 16kHz s16le). When the file
//               runs out the slices are zeros. When stdin closes, write one
//               more slice and exit 0.
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);

if (argv.includes("--list")) {
  const devices = [
    { name: "Built-in Microphone", default: true },
    { name: "USB Headset", default: false },
  ];
  process.stdout.write(JSON.stringify(devices) + "\n");
  process.exit(0);
}

const exitAt = argv.indexOf("--exit");
if (exitAt >= 0) process.exit(Number(argv[exitAt + 1]));

process.stderr.write("argv " + JSON.stringify(argv) + "\n");

const body = fs.readFileSync(path.join(__dirname, "threat-level-3s.wav")).subarray(44);
const SLICE = 640;
let offset = 0;

function nextSlice() {
  const out = Buffer.alloc(SLICE);
  const n = Math.max(0, Math.min(SLICE, body.length - offset));
  if (n > 0) body.copy(out, 0, offset, offset + n);
  offset += SLICE;
  return out;
}

// The parent may kill us mid-write; a broken pipe is not an error here.
process.stdout.on("error", () => process.exit(0));

const timer = setInterval(() => process.stdout.write(nextSlice()), 20);

process.stdin.resume();
process.stdin.on("end", () => {
  clearInterval(timer);
  process.stdout.write(nextSlice(), () => process.exit(0));
});
