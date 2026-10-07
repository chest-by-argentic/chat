// The text of a message, read as the light markdown members write — the
// same on the server (mentions, search) and in the page (rendering). It
// never produces HTML: the page renders the tree as React elements, so a
// member's text is always text.
//
// Blocks: ``` fenced code ```, "> " quotes, "- " / "* " / "1. " lists,
// paragraphs (line breaks kept). Inline: `code`, *bold* (**bold**),
// _italic_, ~strike~ (~~strike~~), [label](https://…), bare https:// and
// http:// links, and the tokens the composer writes: <@mbr_…> (a member),
// <#12> (a channel), <!channel>, <!here>.

export type Inline =
  | string
  | { t: "b" | "i" | "s"; c: Inline[] }
  | { t: "code"; text: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "mention"; id: string }
  | { t: "channel"; id: number }
  | { t: "special"; kind: "channel" | "here" }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "pre"; text: string }
  | { t: "quote"; c: Block[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] };

// The tokens a composer writes, as they are stored.
const token = /^<(@mbr_[a-z2-7]{26}|#[1-9][0-9]{0,17}|!channel|!here)>/u;
// A link a page may open: the web and mail, nothing else (no javascript:,
// no data:).
const safeHref = /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"@]+@[^\s<>"]+)$/iu;
const bareUrl = /^https?:\/\/[^\s<>"]+/iu;

// parse reads a message's text into blocks.
export function parse(text: string): Block[] {
  return blocks(text.replace(/\r\n?/gu, "\n").split("\n"));
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push({ t: "p", c: lineBreaks(paragraph) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trimStart().startsWith("```")) {
      flush();
      const first = line.trimStart().slice(3);
      // ```code``` on one line
      const inline = first.indexOf("```");
      if (inline >= 0) {
        out.push({ t: "pre", text: first.slice(0, inline) });
        continue;
      }
      const code: string[] = first.trim() && !/^[a-z0-9+#-]{1,20}$/iu.test(first.trim()) ? [first] : [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const end = lines[j]!.indexOf("```");
        if (end >= 0) {
          if (lines[j]!.slice(0, end)) code.push(lines[j]!.slice(0, end));
          break;
        }
        code.push(lines[j]!);
      }
      out.push({ t: "pre", text: code.join("\n") });
      i = j;
      continue;
    }
    if (/^>\s?/u.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length && /^>\s?/u.test(lines[i]!); i++) quoted.push(lines[i]!.replace(/^>\s?/u, ""));
      i--;
      out.push({ t: "quote", c: blocks(quoted) });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/u.exec(line);
    const ordered = /^\s*([0-9]{1,9})[.)]\s+(.*)$/u.exec(line);
    if (bullet || ordered) {
      flush();
      const items: Inline[][] = [];
      const kind = bullet ? "ul" : "ol";
      const start = ordered ? Number(ordered[1]) : 1;
      for (; i < lines.length; i++) {
        const b = /^\s*[-*•]\s+(.*)$/u.exec(lines[i]!), o = /^\s*[0-9]{1,9}[.)]\s+(.*)$/u.exec(lines[i]!);
        const item = kind === "ul" ? b : o;
        if (!item) break;
        items.push(inline(item[1]!));
      }
      i--;
      out.push(kind === "ul" ? { t: "ul", items } : { t: "ol", start, items });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out;
}

function lineBreaks(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((line, i) => {
    if (i) out.push({ t: "br" });
    out.push(...inline(line));
  });
  return out;
}

// A delimiter opens after the start, a space or punctuation, before a
// non-space; it closes after a non-space, before the end, a space or
// punctuation: "2*3*4" and "snake_case_name" stay text.
const boundary = /[\s([{"'«“‘\-–—/:;,.!?…]/u;
const after = /[\s)\]}"'»”’\-–—/:;,.!?…]/u;
const marks: Record<string, "b" | "i" | "s"> = { "*": "b", "_": "i", "~": "s" };
// Emphasis nests this deep at most; deeper delimiters stay text. A member's
// text is any text: the tree stays shallow and the parse linear.
const maxDepth = 8;

export function inline(text: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  // Where a delimiter was found to have no closing on the rest of the
  // line: a later one of the same kind has none either.
  const unclosed = new Map<string, number>();
  const push = (node: Inline) => {
    if (plain) out.push(plain);
    plain = "";
    out.push(node);
  };
  for (let i = 0; i < text.length;) {
    const rest = text.slice(i);
    const ch = text[i]!;
    const prev = i === 0 ? " " : text[i - 1]!;
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        push({ t: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "<") {
      const m = token.exec(rest);
      if (m) {
        const body = m[1]!;
        push(body.startsWith("@") ? { t: "mention", id: body.slice(1) } : body.startsWith("#") ? { t: "channel", id: Number(body.slice(1)) } : { t: "special", kind: body === "!here" ? "here" : "channel" });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]\n]{1,500})\]\(([^)\s]{1,2000})\)/u.exec(rest);
      if (m && safeHref.test(m[2]!)) {
        push({ t: "link", href: m[2]!, c: inline(m[1]!, depth + 1) });
        i += m[0].length;
        continue;
      }
    }
    if ((ch === "h" || ch === "H") && boundary.test(prev)) {
      const m = bareUrl.exec(rest);
      if (m) {
        // Punctuation that ends a sentence is not part of the link.
        let url = m[0].replace(/[.,;:!?…'"’”]+$/u, "");
        if (url.endsWith(")") && !url.includes("(")) url = url.slice(0, -1);
        push({ t: "link", href: url, c: [url] });
        i += url.length;
        continue;
      }
    }
    const kind = marks[ch];
    if (kind && depth < maxDepth && boundary.test(prev)) {
      const double = text[i + 1] === ch && ch !== "_";
      const width = double ? 2 : 1;
      const open = i + width;
      const known = unclosed.get(ch + width);
      if (open < text.length && !/\s/u.test(text[open]!) && (known === undefined || open < known)) {
        const close = closing(text, open, ch, width);
        if (close > open) {
          push({ t: kind, c: inline(text.slice(open, close), depth + 1) });
          i = close + width;
          continue;
        }
        unclosed.set(ch + width, open);
      }
    }
    plain += ch;
    i++;
  }
  if (plain) out.push(plain);
  return out;
}

// closing finds where a delimiter opened at from closes: -1 when it does
// not, on this line.
function closing(text: string, from: number, ch: string, width: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === "`") {
      const end = text.indexOf("`", j + 1);
      if (end > j) j = end;
      continue;
    }
    if (text[j] !== ch || (width === 2 && text[j + 1] !== ch)) continue;
    const next = text[j + width];
    if (!/\s/u.test(text[j - 1]!) && (next === undefined || after.test(next))) return j;
  }
  return -1;
}

// What a text mentions, outside code: members, and @channel / @here.
export type Mentions = { members: string[]; channel: boolean; here: boolean; channels: number[] };

export function mentions(text: string): Mentions {
  const found: Mentions = { members: [], channel: false, here: false, channels: [] };
  const walk = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (typeof node === "string") continue;
      if (node.t === "mention" && !found.members.includes(node.id)) found.members.push(node.id);
      else if (node.t === "channel" && !found.channels.includes(node.id)) found.channels.push(node.id);
      else if (node.t === "special") found[node.kind] = true;
      else if ("c" in node) walk(node.c);
    }
  };
  const visit = (list: Block[]) => {
    for (const b of list) {
      if (b.t === "p") walk(b.c);
      else if (b.t === "quote") visit(b.c);
      else if (b.t === "ul" || b.t === "ol") b.items.forEach(walk);
    }
  };
  visit(parse(text));
  return found;
}

// plain is a text as words, for a search or a short quote: formatting
// removed, tokens named by the given functions.
export function plain(text: string, name: { member(id: string): string; channel(id: number): string; special(kind: "channel" | "here"): string }): string {
  const words: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (typeof node === "string") words.push(node);
      else if (node.t === "code") words.push(node.text);
      else if (node.t === "mention") words.push("@" + name.member(node.id));
      else if (node.t === "channel") words.push("#" + name.channel(node.id));
      else if (node.t === "special") words.push("@" + name.special(node.kind));
      else if (node.t === "br") words.push(" ");
      else walk(node.c);
    }
  };
  const visit = (list: Block[]) => {
    for (const b of list) {
      if (b.t === "p") walk(b.c);
      else if (b.t === "pre") words.push(b.text);
      else if (b.t === "quote") visit(b.c);
      else b.items.forEach(item => { walk(item); words.push(" "); });
      words.push(" ");
    }
  };
  visit(parse(text));
  return words.join("").replace(/\s+/gu, " ").trim();
}

// onlyEmoji says a text is one to six emoji and nothing else: shown large.
export function onlyEmoji(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 64) return false;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)].map(s => s.segment).filter(s => s.trim());
  return graphemes.length <= 6 && graphemes.every(g => /\p{Extended_Pictographic}/u.test(g));
}
