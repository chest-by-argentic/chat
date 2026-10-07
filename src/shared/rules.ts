// The rules both sides keep: the page to say them before sending, the
// server to refuse what breaks them.

// A message's text, in characters (Slack's bound).
export const maxText = 40000;
// A channel's description.
export const maxAbout = 1000;
// A channel's name: lowercase letters, digits, - and _.
export const channelName = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
// The people of a direct conversation, the member included.
export const maxDirect = 9;
// Files sent with one message.
export const maxFiles = 10;
// An upload, in bytes: the manifest's largest object.
export const maxUpload = 100 << 20;
// A page of messages.
export const pageSize = 50;
// Unread counts stop here ("99+").
export const unreadCap = 100;
// How long a page says someone is typing after their last sign.
export const typingFor = 5000;
// How often a page says it is typing, at most.
export const typingEvery = 3000;
// A reaction: one emoji (a few code points: skin tones, joiners).
const maxEmoji = 32;

export const memberId = /^mbr_[a-z2-7]{26}$/u;
export const groupId = /^grp_[a-z2-7]{26}$/u;

// normalize is a text as search compares it: lowercase, without accents,
// spaces folded.
export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ");
}

// isEmoji says a reaction is one emoji grapheme.
export function isEmoji(text: string): boolean {
  if (typeof text !== "string" || text.length === 0 || text.length > maxEmoji) return false;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)];
  return graphemes.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text);
}

// resolvedNotify is a notification setting as it applies to a kind of
// conversation: "default" is all for direct messages, mentions for
// channels.
export function resolvedNotify(kind: "public" | "private" | "direct", notify: "default" | "all" | "mentions" | "none"): "all" | "mentions" | "none" {
  return notify !== "default" ? notify : kind === "direct" ? "all" : "mentions";
}
