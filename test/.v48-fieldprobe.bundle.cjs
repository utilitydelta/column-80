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

// test/.v48-fieldprobe.entry.ts
var v48_fieldprobe_entry_exports = {};
__export(v48_fieldprobe_entry_exports, {
  csShapeHooks: () => csShapeHooks,
  goShapeHooks: () => goShapeHooks,
  pyShapeHooks: () => pyShapeHooks,
  tsShapeHooks: () => tsShapeHooks
});
module.exports = __toCommonJS(v48_fieldprobe_entry_exports);

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
function splitTsMembers(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "<" || c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ">" || c === ")" || c === "]" || c === "}") {
      depth--;
    } else if ((c === ";" || c === "," || c === "\n") && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}
function tsBraceBody(text, open, requireSole) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        if (requireSole && text.slice(i + 1).trim().length > 0) {
          return void 0;
        }
        return text.slice(open + 1, i);
      }
    }
  }
  return void 0;
}
function tsHoverObjectBody(signature) {
  const isAlias = /^\s*(?:export\s+)?(?:declare\s+)?type\b/.test(signature);
  let depth = 0;
  for (let i = 0; i < signature.length; i++) {
    const c = signature[i];
    if (c === "=" && signature[i + 1] === ">") {
      i++;
      continue;
    }
    if (c === "=" && depth === 0 && isAlias) {
      const rhs = signature.slice(i + 1);
      const open = rhs.search(/\S/);
      if (open < 0 || rhs[open] !== "{") {
        return void 0;
      }
      return tsBraceBody(rhs, open, true);
    }
    if (c === "<" || c === "(" || c === "[" || c === "{") {
      if (c === "{" && depth === 0 && !isAlias) {
        return tsBraceBody(signature, i, false);
      }
      depth++;
    } else if (c === ">" || c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  return void 0;
}
function parseTsHoverFields(signature) {
  if (!signature) {
    return [];
  }
  const body = tsHoverObjectBody(signature);
  if (body === void 0) {
    return [];
  }
  const fields = [];
  for (const part of splitTsMembers(body)) {
    const t = part.trim();
    if (t.length === 0) {
      continue;
    }
    const m = /^(?:(?:public|protected|private)\s+)?(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:\s*([\s\S]+)$/.exec(t);
    if (m) {
      fields.push({ name: m[1], typeName: m[2].trim() });
    }
  }
  return fields;
}
var escapeTsRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function tsFieldTypeCursor(lines, range, fieldName, candType) {
  const fieldRe = new RegExp(`(?:^|[{;,\\s])(?:readonly\\s+)?${escapeTsRe(fieldName)}\\s*\\??\\s*:`);
  const candRe = new RegExp(`\\b${escapeTsRe(candType)}\\b`);
  for (let i = range.open; i <= range.close; i++) {
    const line = lines[i];
    const fm = fieldRe.exec(line);
    if (!fm) {
      continue;
    }
    const colon = line.indexOf(":", fm.index + fm[0].length - 1);
    const searchFrom = colon >= 0 ? colon + 1 : fm.index + fm[0].length;
    const cm = candRe.exec(line.slice(searchFrom));
    if (cm) {
      return { line: i, character: searchFrom + cm.index };
    }
    return void 0;
  }
  return void 0;
}
function tsRenderDerivedDef(t) {
  if (t.signature.length > 0) {
    return t.signature;
  }
  const fields = t.fields.map((f) => f.typeName.length > 0 ? `  ${f.name}: ${f.typeName};` : `  ${f.name};`).join("\n");
  return `interface ${t.name} {
${fields}
}`;
}

// src/core/csExtraction.ts
function csStaticQualifier(defSignature) {
  const hover = (defSignature ?? "").trim();
  const m = /(?:^|\s)(?:class|struct|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*(<[^<>]*>)?/.exec(hover);
  if (!m) {
    return void 0;
  }
  const last = m[1].split(".").pop();
  return last === void 0 || last === "" ? void 0 : `${last}${m[2] ?? ""}`;
}
var CS_STATIC_MODIFIER = /(?:^|\s)static\s/;
function csQualifyStatics(members, defSignature, defLines) {
  const qualifier = csStaticQualifier(defSignature);
  if (qualifier === void 0) {
    return [...members];
  }
  return members.map((member) => {
    const line = member.declLine;
    if (member.signature === void 0 || line === void 0 || line < 0 || line >= defLines.length || !CS_STATIC_MODIFIER.test(defLines[line]) || !new RegExp(`(?:^|\\W)${escapeCsName(member.name)}(?:\\W|$)`).test(defLines[line]) || member.signature.startsWith(`${qualifier}.`)) {
      return member;
    }
    return { ...member, signature: `${qualifier}.${member.signature}` };
  });
}
var escapeCsName = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
function csSignatureRefTypes(signatures) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const sig of signatures) {
    const body = sig.replace(/^\s*[A-Za-z_][A-Za-z0-9_]*/, "");
    for (const m of body.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
      const t = m[1];
      if (/^\.[A-Za-z_]/.test(body.slice((m.index ?? 0) + m[0].length))) {
        continue;
      }
      if (seen.has(t) || CS_STD_TYPE_NAMES.has(t) || /^[A-Z]$/.test(t)) {
        continue;
      }
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// src/core/pyExtraction.ts
var PY_ENUM_BASE_NAMES = /* @__PURE__ */ new Set(["Enum", "IntEnum", "StrEnum", "Flag", "IntFlag", "ReprEnum"]);
function pyEnumBaseDecl(defLines, typeName) {
  const escaped = typeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^\\s*class\\s+${escaped}\\s*\\(([^)]*)\\)\\s*:`);
  for (const line of defLines) {
    const match = header.exec(line);
    if (!match) {
      continue;
    }
    const bases = match[1].split(",").map((b) => b.trim().replace(/^enum\./, ""));
    return bases.some((b) => PY_ENUM_BASE_NAMES.has(b));
  }
  return false;
}

// src/core/goExtraction.ts
function advanceGoLineScan(line, s) {
  const n = line.length;
  let i = 0;
  while (i < n) {
    if (s.block) {
      const end = line.indexOf("*/", i);
      if (end < 0) {
        return -1;
      }
      s.block = false;
      i = end + 2;
      continue;
    }
    if (s.raw) {
      const end = line.indexOf("`", i);
      if (end < 0) {
        return -1;
      }
      s.raw = false;
      i = end + 1;
      continue;
    }
    const c = line[i];
    const c2 = line[i + 1];
    if (c === "/" && c2 === "/") {
      return i;
    }
    if (c === "/" && c2 === "*") {
      s.block = true;
      i += 2;
      continue;
    }
    if (c === "`") {
      s.raw = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n) {
        if (line[i] === "\\") {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return -1;
}
var bytes = (s) => Buffer.byteLength(s, "utf8");
function goElideDef(signature) {
  const before = bytes(signature);
  const lines = signature.split("\n");
  const kept = [];
  const scan = { raw: false, block: false };
  let chromeBytes = 0;
  let proseBytes = 0;
  let proseLines = 0;
  let blankBytes = 0;
  const cost = (line, index) => bytes(line) + (index === lines.length - 1 ? 0 : 1);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inBlockComment = scan.block;
    const at = advanceGoLineScan(line, scan);
    const trimmed = line.trim();
    const blockClose = inBlockComment ? line.indexOf("*/") : -1;
    const wholeLineComment = inBlockComment && (blockClose < 0 || line.slice(blockClose + 2).trim().length === 0) || trimmed.startsWith("//") || trimmed.startsWith("/*") && scan.block;
    if (wholeLineComment) {
      proseBytes += cost(line, i);
      proseLines++;
      while (kept.length > 0 && kept[kept.length - 1].trim().length === 0) {
        blankBytes += bytes(kept.pop()) + 1;
      }
      continue;
    }
    if (at < 0) {
      kept.push(line);
      continue;
    }
    const comment = line.slice(at);
    const head = line.slice(0, at).replace(/\s+$/, "");
    const dropped = bytes(line.slice(0, at)) - bytes(head) + bytes(comment);
    if (/^\/\/\s*size=/.test(comment)) {
      chromeBytes += dropped;
    } else {
      proseBytes += dropped;
      proseLines++;
    }
    kept.push(head);
  }
  const text = kept.join("\n");
  const keptBodyLines = kept.slice(1).filter((l) => l.trim().length > 0 && l.trim() !== "}").length;
  return {
    text,
    beforeBytes: before,
    afterBytes: bytes(text),
    chromeBytes,
    proseBytes,
    proseLines,
    blankBytes,
    keptBodyLines
  };
}

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
function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<" || c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ">" && (s[i - 1] === "-" || s[i - 1] === "=")) {
    } else if (c === ">" || c === ")" || c === "]" || c === "}") {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}
function parseStructHoverFields(signature) {
  if (!signature) {
    return [];
  }
  const open = signature.indexOf("{");
  const close = signature.lastIndexOf("}");
  if (open < 0 || close < 0 || close <= open) {
    return [];
  }
  const body = signature.slice(open + 1, close);
  const fields = [];
  for (const part of splitTopLevelCommas(body)) {
    const t = part.trim();
    if (t.length === 0) {
      continue;
    }
    const m = /^(?:pub\s*(?:\([^)]*\))?\s+)?([A-Za-z_]\w*)\s*:\s*([\s\S]+)$/.exec(t);
    if (m) {
      fields.push({ name: m[1], typeName: m[2].trim() });
    }
  }
  return fields;
}
var tsShapeHooks = {
  parseHoverFields: parseTsHoverFields,
  fieldTypeCursor: tsFieldTypeCursor,
  renderDef: tsRenderDerivedDef,
  stdTypeNames: TS_STD_TYPE_NAMES,
  // tsserver quickinfo for a type parameter is chrome, not TS syntax; emitting
  // it as a def pollutes the injected block.
  refuseHover: (signature) => signature.startsWith("(type parameter)"),
  skipCandidate: (name) => /^[A-Z]$/.test(name)
};
var csShapeHooks = {
  parseHoverFields: () => [],
  fieldTypeCursor: () => void 0,
  renderDef: (t) => t.signature,
  stdTypeNames: CS_STD_TYPE_NAMES,
  // C# has no field body to walk, so its collaborator graph is projected through
  // member SIGNATURES instead: the types named in return/param/property positions,
  // anchored cross-project via the extractor's resolveTypeCursorByName. Only C#
  // sets this hook, so only C# gets signature-edge recursion.
  signatureRefTypes: csSignatureRefTypes,
  // Roslyn hovers an enum as `enum Atlas.LodBand` and returns its variants as
  // signature-less fields. `Type.Variant` is what the model has to type, and it
  // is exactly the shape the diagnostic-keyed leg already renders for the same
  // enum, so the two surfaces read alike wherever both can fire.
  enumMemberLine: (member, typeName, typeSignature) => /^enum\b/.test((typeSignature ?? "").trim()) && member.signature === void 0 ? `${typeName}.${member.name}` : void 0,
  // A static is not callable by its bare name, and Roslyn's documentSymbol does
  // not say which members are static. The modifier is on the declaration line,
  // which the visibility pass already reads out of the same def text.
  rewriteMembers: csQualifyStatics
};
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
var pyShapeHooks = {
  parseHoverFields: () => [],
  fieldTypeCursor: () => void 0,
  renderDef: (t) => t.signature,
  stdTypeNames: PY_STD_TYPE_NAMES,
  // An Enum's variants resolve with no signature, same hole C# fills with
  // `enumMemberLine` — but pyright's hover never names the base class
  // (`(class) LodBand`, plain class or Enum subclass alike) and its
  // documentSymbol kind for a member turned out to be an ALL_CAPS naming
  // heuristic, not an Enum signal (pyExtraction.ts's pyEnumBaseDecl doc
  // comment has the live evidence). Only the declaration source says the
  // truth, so this reads `defLines` for `class LodBand(IntEnum):` and renders
  // every no-signature member as `Type.Variant` when it finds one — otherwise
  // undefined, same as an ordinary field staying dark.
  enumMemberLine: (member, typeName, _typeSignature, defLines) => member.signature === void 0 && pyEnumBaseDecl(defLines, typeName) ? `${typeName}.${member.name}` : void 0
};
var goShapeHooks = {
  parseHoverFields: parseStructHoverFields,
  fieldTypeCursor,
  renderDef: (t) => (
    // A hover-less type names itself and claims nothing about its shape. The
    // Rust default synthesizes `struct X { }` here, which for Go would be an
    // invented declaration in another language's syntax.
    t.signature.length > 0 ? goElideDef(t.signature).text : `type ${t.name}`
  ),
  stdTypeNames: STD_TYPE_NAMES,
  skipCandidate: (name, fieldType) => {
    if (!/^[A-Z]$/.test(name)) {
      return false;
    }
    return fieldType === void 0 || new RegExp(`(^|[^.\\w])${name}\\b`).test(fieldType);
  }
};
var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function fieldTypeCursor(lines, range, fieldName, candType) {
  const fieldRe = new RegExp(`^\\s*(?:pub\\s*(?:\\([^)]*\\))?\\s+)?${escapeRe(fieldName)}\\s*:`);
  const candRe = new RegExp(`\\b${escapeRe(candType)}\\b`);
  for (let i = range.open; i <= range.close; i++) {
    const line = lines[i];
    const fm = fieldRe.exec(line);
    if (!fm) {
      continue;
    }
    const colon = line.indexOf(":", fm[0].length - 1);
    const searchFrom = colon >= 0 ? colon + 1 : fm[0].length;
    const cm = candRe.exec(line.slice(searchFrom));
    if (cm) {
      return { line: i, character: searchFrom + cm.index };
    }
    return void 0;
  }
  return void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  csShapeHooks,
  goShapeHooks,
  pyShapeHooks,
  tsShapeHooks
});
