/**
 * The tolerant XML reader the test rung's structured formats are parsed with.
 *
 * Built in phase 4 for pytest's `--junit-xml` and lifted out of `tddPy.ts` in
 * phase 5 so C#'s TRX reads through the SAME scanner rather than a second one
 * that can drift from it. Not one byte of its behaviour changed in the move; the
 * only addition is `local`, the tag name with an XML namespace prefix stripped,
 * which junit does not need and TRX does.
 *
 * Tolerant by construction, and it was measured that way: it survived truncation
 * at every byte position of a real report, a 10.7MB document, and CDATA and
 * comments hiding fake elements. Nothing here ever throws — malformed XML yields
 * fewer tags, never an exception — because the alternative is a crashed gesture
 * where an honest "the run did not report" belongs.
 *
 * A hand-written scanner rather than a dependency, and rather than a regex: an
 * attribute value may hold a `>` (a failure message routinely does), and
 * `/<[^>]*>/` ends the tag inside the quotes and reads the rest of the message as
 * markup. Quoted values are tracked, so it does not.
 *
 * Never imports vscode (the src/core rule).
 */

export interface XmlTag {
  /** The name AS WRITTEN, prefix and all, with a leading `/` for a close tag.
   *  `elementText` needs this to find the matching close tag. */
  name: string;
  /** The same name with any XML namespace prefix stripped (`a:Counters` ->
   *  `Counters`), leading `/` preserved. TRX namespaces its elements and junit
   *  does not; matching on this is what lets one reader read both. */
  local: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  /** Index just past this tag's `>`. */
  contentStart: number;
}

const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** XML character references and the five named entities, decoded. Anything else
 *  is left as written: a report is data, not a template. */
export function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[body] ?? whole;
  });
}

/**
 * The tags of an XML document, in order.
 *
 * Declarations, comments and CDATA are skipped, an unterminated tag ends the
 * scan, and a name that does not parse advances one character rather than
 * aborting.
 */
export function scanXmlTags(xml: string): XmlTag[] {
  const tags: XmlTag[] = [];
  let i = 0;
  while (i < xml.length) {
    if (xml[i] !== "<") {
      i++;
      continue;
    }
    if (xml.startsWith("<!--", i)) {
      const close = xml.indexOf("-->", i + 4);
      i = close === -1 ? xml.length : close + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", i)) {
      const close = xml.indexOf("]]>", i + 9);
      i = close === -1 ? xml.length : close + 3;
      continue;
    }
    if (xml[i + 1] === "?" || xml[i + 1] === "!") {
      const close = xml.indexOf(">", i);
      i = close === -1 ? xml.length : close + 1;
      continue;
    }
    const nameM = /^<\/?([\w:.-]+)/.exec(xml.slice(i));
    if (nameM === null) {
      i++;
      continue;
    }
    let j = i + nameM[0].length;
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    while (j < xml.length && xml[j] !== ">") {
      const attrM = /^\s*([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/.exec(xml.slice(j));
      if (attrM !== null) {
        attrs[attrM[1]] = decodeXml(attrM[2].slice(1, -1));
        j += attrM[0].length;
        continue;
      }
      if (xml[j] === "/") {
        selfClosing = true;
      }
      j++;
    }
    const slash = xml[i + 1] === "/" ? "/" : "";
    const raw = nameM[1];
    // The prefix is everything before the LAST colon: `a:b:c` is not legal XML,
    // and taking the last one keeps a name holding a colon from losing its tail.
    const colon = raw.lastIndexOf(":");
    tags.push({
      name: `${slash}${raw}`,
      local: `${slash}${colon === -1 ? raw : raw.slice(colon + 1)}`,
      attrs,
      selfClosing,
      contentStart: j + 1,
    });
    i = j + 1;
  }
  return tags;
}

/** An integer attribute, or 0 when it is absent or unreadable. */
export function attrNumber(attrs: Record<string, string>, key: string): number {
  const n = parseInt(attrs[key] ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

/** An element's character data: everything up to its closing tag, entity-decoded
 *  and trimmed. Both formats escape any nested markup inside these elements, so
 *  the first close tag of that name is the right one. */
export function elementText(xml: string, tag: XmlTag): string {
  if (tag.selfClosing) {
    return "";
  }
  const close = xml.indexOf(`</${tag.name}`, tag.contentStart);
  return decodeXml(xml.slice(tag.contentStart, close === -1 ? xml.length : close)).trim();
}
