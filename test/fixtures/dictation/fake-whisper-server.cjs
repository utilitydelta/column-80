#!/usr/bin/env node
// Fake whisper-server for the phase 3 blind rows. It takes the real server's
// argv shape. The file given to -m is a JSON config (it must exist, which is
// what the model-missing rule wants anyway):
//   mode        "serve" (default) | "exit" | "hang"
//   exitCode    for mode exit (default 7); stderr gets two lines first
//   argvFile    argv is written here as JSON, whatever the mode
//   pidFile     our pid is written here
//   rootStatus  status for GET / (default 200)
//   fieldsFile  each POST /inference writes its parsed multipart here
//   delayFile   if this file exists, /inference waits its content in ms
//   text        the text field of the /inference answer
// GET /quit makes the process exit with code 3, so a test can watch a
// recogniser die on its own.
const fs = require("fs");
const http = require("http");

const argv = process.argv.slice(2);
const arg = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(arg("-m"), "utf8"));
} catch {
  cfg = {};
}
if (cfg.argvFile) fs.writeFileSync(cfg.argvFile, JSON.stringify(argv));
if (cfg.pidFile) fs.writeFileSync(cfg.pidFile, String(process.pid));

const mode = cfg.mode || "serve";
if (mode === "exit") {
  process.stderr.write("loading model\nfatal: model file is garbage\n");
  process.exit(cfg.exitCode ?? 7);
}
if (mode === "hang") {
  setInterval(() => {}, 1000);
} else {
  serve();
}

function parseMultipart(buf, contentType) {
  const m = /boundary=("?)([^";]+)\1/.exec(contentType || "");
  if (!m) return { error: "no boundary in " + contentType };
  const delim = Buffer.from("--" + m[2]);
  const fields = {};
  let pos = buf.indexOf(delim);
  while (pos >= 0) {
    let start = pos + delim.length;
    if (buf.subarray(start, start + 2).toString() === "--") break;
    start += 2;
    const next = buf.indexOf(delim, start);
    if (next < 0) break;
    const part = buf.subarray(start, next - 2);
    const hdrEnd = part.indexOf("\r\n\r\n");
    const headers = part.subarray(0, hdrEnd).toString();
    const content = part.subarray(hdrEnd + 4);
    const name = (/name="([^"]*)"/.exec(headers) || [])[1];
    const filename = (/filename="([^"]*)"/.exec(headers) || [])[1];
    if (filename !== undefined) {
      fields[name] = {
        filename,
        bytes: content.length,
        head: content.subarray(0, 4).toString("latin1"),
      };
    } else {
      fields[name] = content.toString("utf8");
    }
    pos = next;
  }
  return fields;
}

function serve() {
  const host = arg("--host") || "127.0.0.1";
  const port = Number(arg("--port"));
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/inference") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const fields = parseMultipart(Buffer.concat(chunks), req.headers["content-type"]);
        if (cfg.fieldsFile) fs.writeFileSync(cfg.fieldsFile, JSON.stringify(fields));
        let delay = 0;
        if (cfg.delayFile && fs.existsSync(cfg.delayFile)) delay = Number(fs.readFileSync(cfg.delayFile, "utf8")) || 0;
        setTimeout(() => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ text: cfg.text ?? "  Fake heard this. \n" }));
        }, delay);
      });
      return;
    }
    if (req.url === "/quit") {
      res.end("bye");
      setTimeout(() => process.exit(3), 10);
      return;
    }
    res.statusCode = cfg.rootStatus ?? 200;
    res.end("fake whisper");
  });
  server.listen(port, host);
}
