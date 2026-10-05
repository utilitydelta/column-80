"use strict";
// The session-v77 rewording of the failure-toast sentences, as old -> new pairs.
// Rows that compare the product against a frozen git tree (which still renders the
// old text) compare against that text rewritten pair by pair.
const V77_TEXT = [
  ["Column 80: the model's reply was cut off mid-function, so nothing was written - run the gesture again.", "Column 80: the model's reply was cut off mid-function, so nothing was written. Try again."],
  ["Column 80: the model wrapped its reply in markdown that cannot land in source code, so nothing was written - run the gesture again.", "Column 80: the model replied with markdown instead of code, so nothing was written. Try again."],
  ["Column 80: the model answered with something other than the requested function, so nothing was written - run the gesture again.", "Column 80: the model wrote something other than the requested function, so nothing was written. Try again."],
  ["Column 80: the model's reply contained no usable code, so nothing was written - run the gesture again.", "Column 80: the model's reply had no usable code, so nothing was written. Try again."],
  ["Column 80: the model server went silent mid-reply, so nothing was written - check the server, then run the gesture again.", "Column 80: the model server stopped answering mid-reply, so nothing was written. Check the server, then try again."],
  ["Column 80: the model's reply contained no usable tests, so nothing was written - run the gesture again.", "Column 80: the model's reply had no usable tests, so nothing was written. Run \"Column 80: Generate Tests (TDD)\" again."],
  ["Column 80: Claude Code is not logged in, so nothing was written - run `claude` in a terminal, then `/login`, and run the gesture again.", "Column 80: Claude Code is not logged in, so nothing was written. Run \"claude\" in a terminal, then \"/login\", and try again."],
  [" Put `claude` on PATH, then run the gesture again.", " Put \"claude\" on PATH, then try again."],
  [" Reload the window, then run the gesture again.", " Reload the window, then try again."],
  ["Column 80: Claude Code could not start, so nothing was written - the full message is in the output channel.", "Column 80: Claude Code could not start, so nothing was written. The full message is in the output channel."],
  ["Column 80: Claude Code is rate limited or its provider is having trouble, so nothing was written - wait, then run the gesture again. The full message is in the output channel.", "Column 80: Claude Code is rate limited or its provider is having trouble, so nothing was written. Wait, then try again. The full message is in the output channel."],
  ["Column 80: Claude Code did not answer in time, so nothing was written - run the gesture again, or check that the CLI still responds.", "Column 80: Claude Code did not answer in time, so nothing was written. Try again, or check that \"claude\" still responds in a terminal."],
  ["Column 80: the Claude Code CLI failed, so nothing was written - the full message is in the output channel.", "Column 80: the Claude Code CLI failed, so nothing was written. The full message is in the output channel."],
  ["Column 80: the local model server refused the request as unauthorised, so nothing was written - check the server's own authentication. The full message is in the output channel.", "Column 80: the model server refused the request as unauthorised, so nothing was written. Check the server's authentication. The full message is in the output channel."],
  ["Column 80: the model provider refused the API key, so nothing was written - check `column80.cloudApiKey`, then run the gesture again. The full message is in the output channel.", "Column 80: the model provider refused the API key, so nothing was written. Check column80.cloudApiKey, then try again. The full message is in the output channel."],
  ["Column 80: the model provider is rate limiting these requests, so nothing was written - wait, then run the gesture again. The full message is in the output channel.", "Column 80: the model provider is rate limiting these requests, so nothing was written. Wait, then try again. The full message is in the output channel."],
  ["Column 80: the model provider is having trouble, so nothing was written - try again shortly. The full message is in the output channel.", "Column 80: the model provider is having trouble, so nothing was written. Try again shortly. The full message is in the output channel."],
  ["Column 80: function generation failed - ", "Column 80: function generation failed: "],
];
// A catch-all toast quotes the error's own text as its detail, so only its head
// is product wording; the detail is left as the error said it.
const CATCH_ALL = /^Column 80: (function|test) generation failed - /;
const v77 = (t) => {
  if (typeof t !== "string") return t;
  if (CATCH_ALL.test(t)) return t.replace(CATCH_ALL, "Column 80: $1 generation failed: ");
  return V77_TEXT.reduce((acc, [a, b]) => acc.split(a).join(b), t);
};

module.exports = { V77_TEXT, v77 };
