import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { emoji, find } from "../shared/emoji.js";
import { useWords } from "./context.js";

// Choose an emoji: search by its words (English or French), or move in the
// grid with the arrows; Enter picks, Escape closes.
export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const w = useWords();
  const [q, setQ] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const shown = q.trim() ? find(q.trim(), 64).map(e => e.emoji) : null;
  const nameOf = (e: string) => emoji.find(x => x.emoji === e)?.name.replace(/_/gu, " ") ?? e;
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    const cells = [...(panel.current?.querySelectorAll<HTMLButtonElement>(".emoji-cell") ?? [])];
    const at = cells.indexOf(document.activeElement as HTMLButtonElement);
    const columns = 8;
    const move = (to: number) => { e.preventDefault(); cells[Math.max(0, Math.min(cells.length - 1, to))]?.focus(); };
    if (e.key === "ArrowDown") move(at < 0 ? 0 : at + columns);
    else if (e.key === "ArrowUp" && at >= 0) at < columns ? (e.preventDefault(), input.current?.focus()) : move(at - columns);
    else if (e.key === "ArrowRight" && at >= 0) move(at + 1);
    else if (e.key === "ArrowLeft" && at >= 0) move(at - 1);
    else if (e.key === "Enter" && at < 0 && cells[0]) { e.preventDefault(); onPick(cells[0].dataset["emoji"]!); }
  };
  const cell = (e: string) => (
    <button key={e} type="button" className="emoji-cell" data-emoji={e} aria-label={nameOf(e)} title={`:${nameOf(e).replace(/ /gu, "_")}:`} onClick={() => onPick(e)}>{e}</button>
  );
  return (
    <div ref={panel} className="emoji-picker" role="dialog" aria-label={w.emoji} onKeyDown={keys}>
      <input ref={input} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={w.emojiSearch} aria-label={w.emojiSearch} />
      <div className="emoji-grid">
        {shown ? (shown.length ? <div className="emoji-row">{shown.map(cell)}</div> : <p className="empty">{w.emojiNone}</p>)
          : <div className="emoji-row">{emoji.map(e => cell(e.emoji))}</div>}
      </div>
    </div>
  );
}
