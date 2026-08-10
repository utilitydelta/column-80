"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// test/.adv-attack.entry.ts
var adv_attack_entry_exports = {};
__export(adv_attack_entry_exports, {
  declarationHeadLine: () => declarationHeadLine,
  fimMemberSite: () => fimMemberSite,
  memberSiteFor: () => memberSiteFor,
  pyFindTypeAnchorInText: () => pyFindTypeAnchorInText,
  pyMemberSite: () => pyMemberSite,
  pyTypesInPlay: () => pyTypesInPlay,
  pyWholeBlockSite: () => pyWholeBlockSite,
  recordDarkSite: () => recordDarkSite,
  wholeBlockSiteFor: () => wholeBlockSiteFor
});
module.exports = __toCommonJS(adv_attack_entry_exports);

// src/core/compilerDirected.ts
var PRELUDE_TYPES = /* @__PURE__ */ new Set([
  "String",
  "Vec",
  "Option",
  "Result",
  "Box",
  "Self",
  "Some",
  "None",
  "Ok",
  "Err",
  "Rc",
  "Arc",
  "Cell",
  "RefCell",
  "Cow",
  "HashMap",
  "HashSet",
  "BTreeMap",
  "BTreeSet",
  "VecDeque"
]);
function typesNamedIn(signature, docComment) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const take = (name) => {
    if (PRELUDE_TYPES.has(name) || seen.has(name)) {
      return;
    }
    seen.add(name);
    out.push(name);
  };
  for (const m of signature.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    take(m[1]);
  }
  if (docComment !== void 0) {
    for (const m of docComment.matchAll(/`([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)`/g)) {
      const seg = m[1].split("::").pop();
      if (seg !== void 0 && /^[A-Z]/.test(seg)) {
        take(seg);
      }
    }
  }
  return out;
}

// src/core/extraction.ts
var UNIVERSAL_TRAITS = /* @__PURE__ */ new Set([
  "Clone",
  "Copy",
  "ToOwned",
  "Borrow",
  "BorrowMut",
  "AsRef",
  "AsMut",
  "From",
  "Into",
  "TryFrom",
  "TryInto",
  "PartialEq",
  "Eq",
  "PartialOrd",
  "Ord",
  "Hash",
  "Default",
  "Deref",
  "DerefMut"
]);
var CONSTRUCTION_TRAITS = /* @__PURE__ */ new Set(["From", "TryFrom", "Default"]);
var EXAMPLE_NOISE_TRAITS = new Set(
  [...UNIVERSAL_TRAITS].filter((t) => !CONSTRUCTION_TRAITS.has(t))
);

// src/core/tsExtraction.ts
var TS_LANGUAGE_IDS = /* @__PURE__ */ new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);
var TS_STD_TYPE_NAMES = /* @__PURE__ */ new Set([
  "Array",
  "ReadonlyArray",
  "Promise",
  "PromiseLike",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Record",
  "Partial",
  "Required",
  "Readonly",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "NonNullable",
  "Parameters",
  "ReturnType",
  "InstanceType",
  "ThisType",
  "Awaited",
  "Iterable",
  "Iterator",
  "AsyncIterable",
  "AsyncIterator",
  "Generator",
  "AsyncGenerator",
  "Date",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
  "Object",
  "Function",
  "Boolean",
  "Number",
  "String",
  "Symbol",
  "BigInt",
  "JSON",
  "Math",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int8Array",
  "Uint16Array",
  "Int16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "URL",
  "URLSearchParams",
  "Buffer"
]);

// src/core/csExtraction.ts
var CS_STD_TYPE_NAMES = /* @__PURE__ */ new Set([
  "String",
  "Object",
  "Boolean",
  "Char",
  "Byte",
  "SByte",
  "Int16",
  "UInt16",
  "Int32",
  "UInt32",
  "Int64",
  "UInt64",
  "Single",
  "Double",
  "Decimal",
  "Void",
  "Guid",
  "DateTime",
  "DateTimeOffset",
  "TimeSpan",
  "Uri",
  "Type",
  "Exception",
  "Task",
  "ValueTask",
  "List",
  "Dictionary",
  "HashSet",
  "Queue",
  "Stack",
  "IEnumerable",
  "IList",
  "ICollection",
  "IDictionary",
  "IReadOnlyList",
  "IReadOnlyCollection",
  "IReadOnlyDictionary",
  "KeyValuePair",
  "Array",
  "Span",
  "ReadOnlySpan",
  "Memory",
  "Nullable",
  "Tuple",
  "ValueTuple",
  "Func",
  "Action",
  "Predicate",
  "Comparer",
  "StringBuilder",
  "Stream",
  "CancellationToken"
]);

// src/core/crossFileShape.ts
var STD_TYPE_NAMES = /* @__PURE__ */ new Set([
  "String",
  "Vec",
  "Box",
  "Option",
  "Result",
  "Rc",
  "Arc",
  "Cell",
  "RefCell",
  "Mutex",
  "RwLock",
  "Cow",
  "HashMap",
  "HashSet",
  "BTreeMap",
  "BTreeSet",
  "VecDeque",
  "BinaryHeap",
  "LinkedList",
  "Range",
  "RangeInclusive",
  "Duration",
  "Instant",
  "PathBuf",
  "Path",
  "OsString",
  "OsStr",
  "Weak",
  "Pin",
  "Ordering",
  "PhantomData",
  "NonZero",
  "NonZeroU8",
  "NonZeroU16",
  "NonZeroU32",
  "NonZeroU64",
  "NonZeroUsize"
]);
var PY_STD_TYPE_NAMES = /* @__PURE__ */ new Set([
  "None",
  "True",
  "False",
  "Any",
  "Optional",
  "Union",
  "List",
  "Dict",
  "Set",
  "Tuple",
  "FrozenSet",
  "Type",
  "Callable",
  "Sequence",
  "Iterable",
  "Iterator",
  "Mapping",
  "MutableMapping",
  "Generator",
  "Awaitable",
  "Coroutine",
  "AsyncIterator",
  "AsyncIterable",
  "Literal",
  "Final",
  "ClassVar",
  "Annotated",
  "TypeVar",
  "Generic",
  "Protocol",
  "NamedTuple",
  "TypedDict",
  "Self",
  "Never",
  "NoReturn",
  "Object"
]);

// src/core/fimWholeBlock.ts
function wholeBlockSite(prefix) {
  let depth = 0;
  let openIdx = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === "}") {
      depth++;
    } else if (c === "{") {
      if (depth === 0) {
        openIdx = i;
        break;
      }
      depth--;
    }
  }
  if (openIdx < 0) {
    return void 0;
  }
  if (/\S/.test(prefix.slice(openIdx + 1))) {
    return void 0;
  }
  const before = prefix.slice(0, openIdx);
  let fnIdx = -1;
  for (const m of before.matchAll(/\bfn\b/g)) {
    fnIdx = m.index ?? -1;
  }
  if (fnIdx < 0) {
    return void 0;
  }
  const signature = before.slice(fnIdx).trim();
  if (/[{}]/.test(signature) || !signature.includes("(") || !signature.includes(")")) {
    return void 0;
  }
  const types = typesInPlay(signature);
  if (types.length === 0) {
    return void 0;
  }
  return { signature, types };
}
function genericClauseNames(signature) {
  const names = /* @__PURE__ */ new Set();
  const fnm = /\bfn\s+[A-Za-z_]\w*\s*</.exec(signature);
  if (!fnm) {
    return names;
  }
  let i = fnm.index + fnm[0].length - 1;
  let depth = 0;
  const start = i + 1;
  for (; i < signature.length; i++) {
    if (signature[i] === "<") {
      depth++;
    } else if (signature[i] === ">") {
      depth--;
      if (depth === 0) {
        break;
      }
    }
  }
  for (const m of signature.slice(start, i).matchAll(/[A-Za-z_]\w*/g)) {
    names.add(m[0]);
  }
  return names;
}
function typesInPlay(signature) {
  const generic = genericClauseNames(signature);
  return typesNamedIn(signature).filter(
    (t) => !STD_TYPE_NAMES.has(t) && !generic.has(t) && !/^[A-Z]$/.test(t)
  );
}
var TS_NON_BODY_KEYWORDS = /* @__PURE__ */ new Set(["if", "for", "while", "switch", "catch", "with"]);
function tsTypesInPlay(signature, genericNames) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of signature.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    const t = m[1];
    if (seen.has(t)) {
      continue;
    }
    seen.add(t);
    if (TS_STD_TYPE_NAMES.has(t) || genericNames?.has(t) || /^[A-Z]$/.test(t)) {
      continue;
    }
    out.push(t);
  }
  return out;
}
function tsWholeBlockSite(prefix) {
  let depth = 0;
  let openIdx = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === "}") {
      depth++;
    } else if (c === "{") {
      if (depth === 0) {
        openIdx = i;
        break;
      }
      depth--;
    }
  }
  if (openIdx < 0) {
    return void 0;
  }
  if (/\S/.test(prefix.slice(openIdx + 1))) {
    return void 0;
  }
  let header = prefix.slice(0, openIdx).trimEnd();
  const isArrow = header.endsWith("=>");
  if (isArrow) {
    header = header.slice(0, -2).trimEnd();
  }
  let closeIdx;
  if (header.endsWith(")")) {
    closeIdx = header.length - 1;
  } else {
    const lastClose = header.lastIndexOf(")");
    if (lastClose < 0 || !/^\s*:\s*[^{};]*$/.test(header.slice(lastClose + 1))) {
      return void 0;
    }
    closeIdx = lastClose;
  }
  let parenDepth = 0;
  let openParen = -1;
  for (let i = closeIdx; i >= 0; i--) {
    if (header[i] === ")") {
      parenDepth++;
    } else if (header[i] === "(") {
      parenDepth--;
      if (parenDepth === 0) {
        openParen = i;
        break;
      }
    }
  }
  if (openParen < 0) {
    return void 0;
  }
  let nameEnd = openParen;
  while (nameEnd > 0 && /\s/.test(header[nameEnd - 1])) {
    nameEnd--;
  }
  const genericNames = /* @__PURE__ */ new Set();
  if (header[nameEnd - 1] === ">") {
    let genericDepth = 0;
    let genericStart = -1;
    for (let i = nameEnd - 1; i >= 0; i--) {
      if (header[i] === ">") {
        genericDepth++;
      } else if (header[i] === "<") {
        genericDepth--;
        if (genericDepth === 0) {
          genericStart = i;
          break;
        }
      }
    }
    if (genericStart < 0) {
      return void 0;
    }
    for (const m of header.slice(genericStart + 1, nameEnd - 1).matchAll(/[A-Za-z_$][\w$]*/g)) {
      genericNames.add(m[0]);
    }
    nameEnd = genericStart;
  }
  const nameMatch = /([A-Za-z_$][\w$]*)$/.exec(header.slice(0, nameEnd));
  const name = nameMatch?.[1];
  if (!isArrow) {
    if (name === void 0) {
      return void 0;
    }
    const keywordName = name === "await" ? /([A-Za-z_$][\w$]*)\s*$/.exec(header.slice(0, nameEnd - name.length))?.[1] ?? name : name;
    if (TS_NON_BODY_KEYWORDS.has(keywordName)) {
      return void 0;
    }
    if (name === "extends" || /\bextends\s*$/.test(header.slice(0, nameEnd - name.length))) {
      return void 0;
    }
  }
  const sigStart = name !== void 0 ? nameEnd - name.length : openParen;
  const stmt = header.slice(0, sigStart);
  const stmtHead = stmt.slice(Math.max(stmt.lastIndexOf(";"), stmt.lastIndexOf("}")) + 1);
  const headWords = stmtHead.match(/[A-Za-z_$][\w$]*/g) ?? [];
  let hw = 0;
  while (hw < headWords.length && (headWords[hw] === "export" || headWords[hw] === "declare")) {
    hw++;
  }
  if (headWords[hw] === "type" || headWords[hw] === "interface") {
    return void 0;
  }
  let stmtDepth = 0;
  for (let i = stmt.length - 1; i >= 0; i--) {
    const c = stmt[i];
    if (c === "}") {
      stmtDepth++;
    } else if (c === "{") {
      if (stmtDepth > 0) {
        stmtDepth--;
        continue;
      }
      const before = stmt.slice(0, i);
      if (/\bsatisfies\s*$/.test(before)) {
        return void 0;
      }
      const encHead = before.slice(Math.max(before.lastIndexOf(";"), before.lastIndexOf("}")) + 1);
      const encWords = encHead.match(/[A-Za-z_$][\w$]*/g) ?? [];
      let ew = 0;
      while (ew < encWords.length && (encWords[ew] === "export" || encWords[ew] === "declare")) {
        ew++;
      }
      if (encWords[ew] === "type" || encWords[ew] === "interface") {
        return void 0;
      }
    }
  }
  const signature = header.slice(sigStart).trim();
  const types = tsTypesInPlay(header.slice(openParen), genericNames);
  if (types.length === 0) {
    return void 0;
  }
  return { signature, types };
}
var CS_NON_BODY_KEYWORDS = /* @__PURE__ */ new Set([
  "if",
  "for",
  "foreach",
  "while",
  "switch",
  "catch",
  "using",
  "lock",
  "fixed",
  "do",
  "else"
]);
function csTypesInPlay(signature, genericNames) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of signature.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    const t = m[1];
    if (seen.has(t)) {
      continue;
    }
    seen.add(t);
    if (CS_STD_TYPE_NAMES.has(t) || genericNames?.has(t) || /^[A-Z]$/.test(t)) {
      continue;
    }
    out.push(t);
  }
  return out;
}
function csWholeBlockSite(prefix) {
  let depth = 0;
  let openIdx = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === "}") {
      depth++;
    } else if (c === "{") {
      if (depth === 0) {
        openIdx = i;
        break;
      }
      depth--;
    }
  }
  if (openIdx < 0) {
    return void 0;
  }
  if (/\S/.test(prefix.slice(openIdx + 1))) {
    return void 0;
  }
  const header = prefix.slice(0, openIdx).trimEnd();
  if (!header.endsWith(")")) {
    return void 0;
  }
  let parenDepth = 0;
  let openParen = -1;
  for (let i = header.length - 1; i >= 0; i--) {
    if (header[i] === ")") {
      parenDepth++;
    } else if (header[i] === "(") {
      parenDepth--;
      if (parenDepth === 0) {
        openParen = i;
        break;
      }
    }
  }
  if (openParen < 0) {
    return void 0;
  }
  let nameEnd = openParen;
  while (nameEnd > 0 && /\s/.test(header[nameEnd - 1])) {
    nameEnd--;
  }
  const genericNames = /* @__PURE__ */ new Set();
  if (header[nameEnd - 1] === ">") {
    let genericDepth = 0;
    let genericStart = -1;
    for (let i = nameEnd - 1; i >= 0; i--) {
      if (header[i] === ">") {
        genericDepth++;
      } else if (header[i] === "<") {
        genericDepth--;
        if (genericDepth === 0) {
          genericStart = i;
          break;
        }
      }
    }
    if (genericStart < 0) {
      return void 0;
    }
    for (const m of header.slice(genericStart + 1, nameEnd - 1).matchAll(/[A-Za-z_][\w]*/g)) {
      genericNames.add(m[0]);
    }
    nameEnd = genericStart;
  }
  const nameMatch = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(header.slice(0, nameEnd));
  const name = nameMatch?.[1];
  if (name === void 0) {
    return void 0;
  }
  if (CS_NON_BODY_KEYWORDS.has(name)) {
    return void 0;
  }
  const stmt = header.slice(0, nameEnd - name.length);
  const boundary = Math.max(
    stmt.lastIndexOf(";"),
    stmt.lastIndexOf("{"),
    stmt.lastIndexOf("}"),
    stmt.lastIndexOf("\n")
  );
  const signature = header.slice(boundary + 1).trim();
  const returnRegion = header.slice(boundary + 1, nameEnd - name.length).replace(/\[[^\]]*\]/g, " ");
  const seen = /* @__PURE__ */ new Set();
  const types = [];
  for (const t of [...csTypesInPlay(returnRegion, genericNames), ...csTypesInPlay(header.slice(openParen), genericNames)]) {
    if (!seen.has(t)) {
      seen.add(t);
      types.push(t);
    }
  }
  if (types.length === 0) {
    return void 0;
  }
  return { signature, types };
}
function pyTypesInPlay(signature) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of signature.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    const t = m[1];
    if (seen.has(t)) {
      continue;
    }
    seen.add(t);
    if (PY_STD_TYPE_NAMES.has(t) || /^[A-Z]$/.test(t)) {
      continue;
    }
    out.push(t);
  }
  return out;
}
function pyWholeBlockSite(prefix) {
  const trimmed = prefix.replace(/\s+$/, "");
  if (!trimmed.endsWith(":")) {
    return void 0;
  }
  const colonIdx = trimmed.length - 1;
  let depth = 0;
  let logicalStart = 0;
  let quote;
  for (let i = 0; i < colonIdx; i++) {
    const c = prefix[i];
    if (quote !== void 0) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (prefix.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = void 0;
      }
      continue;
    }
    if (c === "#") {
      const nl = prefix.indexOf("\n", i);
      if (nl === -1) {
        break;
      }
      i = nl - 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = prefix.startsWith(c + c + c, i);
      quote = triple ? c + c + c : c;
      if (triple) {
        i += 2;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1);
    } else if (c === "\n" && depth === 0) {
      logicalStart = i + 1;
    }
  }
  if (depth !== 0 || quote !== void 0) {
    return void 0;
  }
  const logicalLine = prefix.slice(logicalStart, colonIdx + 1).replace(/^\s+/, "");
  if (!/^(?:async\s+)?def\s/.test(logicalLine)) {
    return void 0;
  }
  const signature = logicalLine.replace(/\s+/g, " ").trim();
  const parenIdx = signature.indexOf("(");
  const types = pyTypesInPlay(parenIdx >= 0 ? signature.slice(parenIdx) : signature);
  if (types.length === 0) {
    return void 0;
  }
  return { signature, types };
}
function wholeBlockSiteFor(languageId) {
  if (languageId === "rust") {
    return wholeBlockSite;
  }
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return tsWholeBlockSite;
  }
  if (languageId === "csharp") {
    return csWholeBlockSite;
  }
  if (languageId === "python") {
    return pyWholeBlockSite;
  }
  return void 0;
}
function pyFindTypeAnchorInText(text, type) {
  if (type.length === 0) {
    return void 0;
  }
  const lines = text.split("\n");
  const word = new RegExp(`\\b${type}\\b`);
  const importLine = /^(?:from\s+\S+\s+import\b|import\s)/;
  for (let i = 0; i < lines.length; i++) {
    if (importLine.test(lines[i].trim())) {
      const m = word.exec(lines[i]);
      if (m) {
        return { line: i, character: m.index };
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("#")) {
      continue;
    }
    const m = word.exec(lines[i]);
    if (m) {
      return { line: i, character: m.index };
    }
  }
  return void 0;
}

// src/core/fimInject.ts
function fimMemberSite(prefix, lineComments = ["//"]) {
  const currentLine = prefix.slice(prefix.lastIndexOf("\n") + 1).trimStart();
  if (lineComments.some((token) => currentLine.startsWith(token))) {
    return void 0;
  }
  const m = /(?:\.|::)([A-Za-z_][A-Za-z0-9_]*)?$/.exec(prefix);
  if (!m) {
    return void 0;
  }
  if (prefix[m.index] === ".") {
    const before = prefix[m.index - 1] ?? "";
    if (/[0-9.]/.test(before)) {
      return void 0;
    }
  }
  return { partial: m[1] ?? "" };
}
function pyMemberSite(prefix) {
  const currentLine = prefix.slice(prefix.lastIndexOf("\n") + 1);
  if (currentLine.trimStart().startsWith("#")) {
    return void 0;
  }
  const m = /\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(prefix);
  if (!m) {
    return void 0;
  }
  const before = prefix[m.index - 1] ?? "";
  if (/[0-9.]/.test(before)) {
    return void 0;
  }
  return { partial: m[1] ?? "" };
}
function memberSiteFor(languageId) {
  if (languageId === "python") {
    return pyMemberSite;
  }
  return (prefix) => fimMemberSite(prefix);
}
function recordDarkSite(seen, key) {
  const firstSeen = !seen.has(key);
  if (firstSeen) {
    seen.add(key);
  }
  return { firstSeen, sessionCount: seen.size };
}

// src/core/symbols.ts
function declarationHeadLine(getLine, startLine, nameLine, lineComments = []) {
  let line = startLine;
  let inBlockComment = false;
  let construct;
  while (line < nameLine) {
    const text = getLine(line).trim();
    if (inBlockComment) {
      if (text.includes("*/")) {
        inBlockComment = false;
      }
      line++;
      continue;
    }
    if (construct) {
      scanLine(text, construct.state, construct.allEnclosures);
      if (construct.state.depth <= 0 && construct.state.literal === void 0) {
        construct = void 0;
      }
      line++;
      continue;
    }
    if (text === "" || text.startsWith("//")) {
      line++;
      continue;
    }
    if (text.startsWith("/*")) {
      if (!text.includes("*/")) {
        inBlockComment = true;
      }
      line++;
      continue;
    }
    if (text.startsWith("#[") || text.startsWith("#![") || text.startsWith("[")) {
      construct = openConstruct(text, false);
      line++;
      continue;
    }
    if (lineComments.some((token) => text.startsWith(token))) {
      line++;
      continue;
    }
    if (text.startsWith("@")) {
      construct = openConstruct(text, true);
      line++;
      continue;
    }
    break;
  }
  const candidate = Math.min(line, nameLine);
  if (candidate < nameLine && /^[)\]}]/.test(getLine(candidate).trim())) {
    return nameLine;
  }
  return candidate;
}
function openConstruct(text, allEnclosures) {
  const state = { depth: 0, literal: void 0 };
  scanLine(text, state, allEnclosures);
  return state.depth > 0 || state.literal !== void 0 ? { state, allEnclosures } : void 0;
}
function scanLine(text, state, allEnclosures) {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (state.literal !== void 0) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === state.literal) {
        state.literal = void 0;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      state.literal = ch;
    } else if (allEnclosures) {
      if (ch === "(" || ch === "{" || ch === "[") state.depth++;
      else if (ch === ")" || ch === "}" || ch === "]") state.depth--;
    } else {
      if (ch === "[") state.depth++;
      else if (ch === "]") state.depth--;
    }
    i++;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  declarationHeadLine,
  fimMemberSite,
  memberSiteFor,
  pyFindTypeAnchorInText,
  pyMemberSite,
  pyTypesInPlay,
  pyWholeBlockSite,
  recordDarkSite,
  wholeBlockSiteFor
});
