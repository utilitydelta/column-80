#!/usr/bin/env node
// A recogniser for the host tier: the real whisper-server's argv shape, answering every
// /inference with the text in $C80_FAKE_TEXT_FILE (read per request, so a row can change the
// sentence without restarting the server). $C80_FAKE_DECODE_DELAY_MS (default 0) holds each
// answer, so a row can land Escape inside the decode. `-m` must name an existing file; its
// bytes are not read. GET / answers 200, which is the start handshake.
"use strict";
const fs = require("fs");
const http = require("http");
const argv = process.argv.slice(2);
const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const port = Number(arg("--port"));
const host = arg("--host") || "127.0.0.1";
http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/inference") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let text = "";
      try { text = fs.readFileSync(process.env.C80_FAKE_TEXT_FILE, "utf8"); } catch {}
      let delay = 0;
      try { delay = Number(fs.readFileSync(process.env.C80_FAKE_TEXT_FILE + ".delay", "utf8")) || 0; } catch {}
      setTimeout(() => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ text }));
      }, delay);
    });
    return;
  }
  res.statusCode = 200;
  res.end("ok");
}).listen(port, host);
setInterval(() => {}, 1000);
