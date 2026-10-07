import { Fragment, useMemo, type ReactNode } from "react";
import { onlyEmoji, parse, type Block, type Inline } from "../shared/markdown.js";
import { nameOf, useStore, useWords } from "./context.js";

// A member's text, rendered as elements from the parsed tree: never as
// HTML. Mentions show the current name; a mention of the member stands
// out; links open in a new tab, without referrer.
export function Text({ text }: { text: string }) {
  const [blocks, jumbo] = useMemo(() => [parse(text), onlyEmoji(text)] as const, [text]);
  return <div className={jumbo ? "text jumbo" : "text"}>{blocks.map((b, i) => <BlockView key={i} block={b} />)}</div>;
}

function BlockView({ block }: { block: Block }) {
  switch (block.t) {
    case "p": return <p>{inlines(block.c)}</p>;
    case "pre": return <pre><code>{block.text}</code></pre>;
    case "quote": return <blockquote>{block.c.map((b, i) => <BlockView key={i} block={b} />)}</blockquote>;
    case "ul": return <ul>{block.items.map((item, i) => <li key={i}>{inlines(item)}</li>)}</ul>;
    case "ol": return <ol start={block.start}>{block.items.map((item, i) => <li key={i}>{inlines(item)}</li>)}</ol>;
  }
}

function inlines(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => <InlineView key={i} node={n} />);
}

function InlineView({ node }: { node: Inline }) {
  if (typeof node === "string") return <>{node}</>;
  switch (node.t) {
    case "b": return <strong>{inlines(node.c)}</strong>;
    case "i": return <em>{inlines(node.c)}</em>;
    case "s": return <s>{inlines(node.c)}</s>;
    case "code": return <code>{node.text}</code>;
    case "br": return <br />;
    case "link": return <a href={node.href} target="_blank" rel="noopener noreferrer nofollow">{inlines(node.c)}</a>;
    case "mention": return <Mention id={node.id} />;
    case "channel": return <ChannelRef id={node.id} />;
    case "special": return <Special kind={node.kind} />;
  }
}

function Mention({ id }: { id: string }) {
  const w = useWords();
  const person = useStore(s => s.people[id]);
  const me = useStore(s => s.me.id);
  return <span className={id === me ? "mention me" : "mention"}>@{nameOf(person, w)}</span>;
}

function Special({ kind }: { kind: "channel" | "here" }) {
  return <span className="mention me">@{kind}</span>;
}

function ChannelRef({ id }: { id: number }) {
  const name = useStore(s => s.conversations.find(c => c.id === id)?.name);
  return name ? <a className="channel-ref" href={`/chest/c/${id}`} data-route>#{name}</a> : <Fragment>#…</Fragment>;
}
