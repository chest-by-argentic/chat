import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "./bits.js";

export type MenuItem = { label: string; run: () => void; icon?: IconName };

// A button that opens a list of actions: arrows move, Enter runs, Escape
// closes and gives the focus back, a click outside closes.
export function Menu({ label, icon, items, onOpen }: { label: string; icon: IconName; items: MenuItem[]; onOpen?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const toggle = (next: boolean) => {
    setOpen(next);
    onOpen?.(next);
    if (!next) button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) {
        setOpen(false);
        onOpen?.(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const keys = (e: KeyboardEvent) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); buttons[(at + 1) % buttons.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); buttons[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); buttons.at(-1)?.focus(); }
    else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); toggle(false); }
  };
  return (
    <span className="menu">
      <button ref={button} type="button" className="icon-button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => toggle(!open)}>
        <Icon name={icon} size={16} />
      </button>
      {open ? (
        <ul ref={list} id={id} role="menu" aria-label={label} className="menu-list" onKeyDown={keys}>
          {items.map(item => (
            <li key={item.label} role="none">
              <button type="button" role="menuitem" tabIndex={-1}
                onClick={() => { toggle(false); item.run(); }}>
                {item.icon ? <Icon name={item.icon} size={16} /> : null}{item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
