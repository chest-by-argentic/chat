import assert from "node:assert/strict";
import { test } from "node:test";
import * as u from "../dist/test/units.js";

const id = "mbr_camilleaaaaaaaaaaaaaaaaaaa";

test("markdown: emphasis only at word boundaries, code untouched", () => {
  assert.deepEqual(u.parse("a *b* _c_ ~d~ **e**"), [{ t: "p", c: ["a ", { t: "b", c: ["b"] }, " ", { t: "i", c: ["c"] }, " ", { t: "s", c: ["d"] }, " ", { t: "b", c: ["e"] }] }]);
  assert.deepEqual(u.parse("2*3*4 snake_case_name"), [{ t: "p", c: ["2*3*4 snake_case_name"] }]);
  assert.deepEqual(u.parse("`*not bold*`"), [{ t: "p", c: [{ t: "code", text: "*not bold*" }] }]);
  assert.deepEqual(u.parse("```\nlet x = *y*;\n```"), [{ t: "pre", text: "let x = *y*;" }]);
});

test("markdown: blocks — quotes, lists, line breaks", () => {
  assert.deepEqual(u.parse("> quoted\nplain"), [{ t: "quote", c: [{ t: "p", c: ["quoted"] }] }, { t: "p", c: ["plain"] }]);
  assert.deepEqual(u.parse("- one\n- two"), [{ t: "ul", items: [["one"], ["two"]] }]);
  assert.deepEqual(u.parse("3. three\n4. four"), [{ t: "ol", start: 3, items: [["three"], ["four"]] }]);
  assert.deepEqual(u.parse("a\nb"), [{ t: "p", c: ["a", { t: "br" }, "b"] }]);
});

test("markdown: only web and mail links, punctuation left out", () => {
  assert.deepEqual(u.parse("see https://example.com/a."), [{ t: "p", c: ["see ", { t: "link", href: "https://example.com/a", c: ["https://example.com/a"] }, "."] }]);
  assert.deepEqual(u.parse("[x](javascript:alert(1))"), [{ t: "p", c: ["[x](javascript:alert(1))"] }]);
  assert.deepEqual(u.parse("[x](data:text/html,1)"), [{ t: "p", c: ["[x](data:text/html,1)"] }]);
  assert.equal(u.parse("[docs](https://example.com)")[0].c[0].href, "https://example.com");
  assert.equal(u.parse("<img src=x onerror=alert(1)>")[0].c[0], "<img src=x onerror=alert(1)>");
});

test("markdown: any text parses in linear time, nesting bounded", () => {
  for (const text of ["*a ".repeat(13333), "*_~".repeat(1600) + "x" + "~_*".repeat(1600), "**".repeat(20000), "[a](".repeat(10000)]) {
    const started = performance.now();
    u.mentions(text);
    const tree = u.parse(text);
    assert.ok(performance.now() - started < 500, `${text.slice(0, 6)}… took too long`);
    let depth = 0;
    const walk = (nodes, d) => { for (const n of nodes) if (typeof n !== "string" && "c" in n) { depth = Math.max(depth, d + 1); walk(n.c, d + 1); } };
    for (const b of tree) if (b.t === "p") walk(b.c, 0);
    assert.ok(depth <= 9, "nesting stays shallow");
  }
});

test("mentions: members, @channel, @here, never inside code", () => {
  const found = u.mentions(`<@${id}> <!here> \`<!channel>\` <#12>`);
  assert.deepEqual(found, { members: [id], channel: false, here: true, channels: [12] });
  assert.equal(u.mentions("<@mbr_notanid>").members.length, 0);
  assert.equal(u.plain(`hi <@${id}> *there*`, { member: () => "Camille", channel: () => "", special: k => k }), "hi @Camille there");
});

test("emoji: a message of emoji only is shown large; a reaction is one emoji", () => {
  assert.equal(u.onlyEmoji("🎉👍"), true);
  assert.equal(u.onlyEmoji("ok 🎉"), false);
  assert.equal(u.isEmoji("👍🏽"), true);
  assert.equal(u.isEmoji("🧑‍💻"), true);
  assert.equal(u.isEmoji("ab"), false);
  assert.equal(u.isEmoji("👍👍"), false);
  assert.equal(u.emojiByName("tada"), "🎉");
  assert.ok(u.findEmoji("fete").some(e => e.emoji === "🎉"), "found by its French words, without accents");
});

test("search: words, phrases and filters", () => {
  assert.deepEqual(u.parseQuery('Budget "Q4 draft" in:#board from:@sam has:file is:thread before:2026-10-01 after:2026-09-01 x:y'), {
    words: ["budget", "q4 draft", "x:y"], conversation: null, conversationName: "board", authors: [], authorNames: ["sam"],
    hasFile: true, inThread: true, before: "2026-10-01", after: "2026-09-01",
  });
  assert.equal(u.normalize("Élégant  CAFÉ"), "elegant cafe");
});

test("routes: every page's address reads back as itself", () => {
  for (const route of [
    { view: "conversation", id: 12, thread: null, message: null },
    { view: "conversation", id: 12, thread: 340, message: null },
    { view: "conversation", id: 12, thread: null, message: 345 },
    { view: "threads" }, { view: "mentions" }, { view: "saved" }, { view: "drafts" }, { view: "browse" },
    { view: "search", q: "in:#design tiles" },
  ]) {
    const path = u.pathOf(route);
    const url = new URL(path, "http://x");
    assert.deepEqual(u.routeOf(url.pathname, url.searchParams), route, path);
  }
  assert.equal(u.routeOf("/chest/c/abc", new URLSearchParams()), null);
  assert.equal(u.routeOf("/chest/nothing", new URLSearchParams()), null);
});

test("times: numbers from Intl, words from the catalogue, in the member's zone", () => {
  const at = "2026-10-05T12:05:00Z";
  assert.equal(u.time(at, "Europe/Paris", u.en), "2:05 PM");
  assert.equal(u.time(at, "Europe/Paris", u.fr), "14:05");
  assert.equal(u.time(at, "America/New_York", u.en), "8:05 AM");
  const now = new Date("2026-10-07T10:00:00Z");
  assert.equal(u.day(at, "Europe/Paris", u.en, now), "Monday, October 5");
  assert.equal(u.day(at, "Europe/Paris", u.fr, now), "Lundi 5 octobre");
  assert.equal(u.day("2026-10-06T22:30:00Z", "Europe/Paris", u.en, now), "Today", "after midnight in Paris");
  assert.equal(u.day("2025-01-01T12:00:00Z", "UTC", u.fr, now), "Mercredi 1er janvier 2025");
  assert.equal(u.size(1_400_000, u.fr), "1,4 MB");
});

test("words: French has every word, and a language the tool does not speak falls back to English", () => {
  assert.deepEqual(Object.keys(u.fr).sort(), Object.keys(u.en).sort());
  for (const [key, value] of Object.entries(u.fr)) assert.equal(typeof value, typeof u.en[key], key);
  assert.equal(u.words("fr-CA").title, u.fr.title);
  assert.equal(u.words("de"), u.en);
  assert.equal(u.resolvedNotify("direct", "default"), "all");
  assert.equal(u.resolvedNotify("public", "default"), "mentions");
});

test("a notice's preview: about 120 characters, cut between two words", () => {
  assert.equal(u.previewCut("short"), "short");
  const long = u.previewCut("word ".repeat(40).trim());
  assert.ok(long.length <= 121 && long.endsWith("word…"), long);
  const one = u.previewCut("x".repeat(300));
  assert.equal(one.length, 121, "a single long word is cut where it must be");
});
