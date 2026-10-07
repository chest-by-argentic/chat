import { useEffect, useState } from "react";
import type { NotifySetting } from "../shared/types.js";
import { channelName, maxAbout, resolvedNotify } from "../shared/rules.js";
import { nameOf, titleOf, useActions, useStore, useWords } from "./context.js";
import { Avatar, Icon, Presence } from "./bits.js";
import { Text } from "./Text.js";
import { ApiError } from "./api.js";

// A conversation's details: what it is about, who is in it, what is
// pinned, how the member is notified, and what they may do with it.
export function DetailsPane() {
  const w = useWords();
  const a = useActions();
  const open = useStore(s => s.detailsOpen);
  const viewing = useStore(s => s.viewing);
  const details = useStore(s => s.details);
  const pinned = useStore(s => s.pinned);
  const people = useStore(s => s.people);
  const me = useStore(s => s.me);
  const [about, setAbout] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setAbout(null); setName(null); setError(null); }, [viewing?.id]);
  if (!open || !viewing) return null;
  const channel = viewing.kind !== "direct";
  const title = channel ? `#${viewing.name}` : titleOf(viewing, people, me.id, w);
  // Three levels; the kind's own is marked “default”, and choosing it
  // follows the default.
  const fallback = resolvedNotify(viewing.kind, "default");
  const current = resolvedNotify(viewing.kind, viewing.notify);
  const notify = (value: Exclude<NotifySetting, "default">) => void a.settings(viewing.id, { notify: value === fallback ? "default" : value });
  const levels = ([["all", w.notifyAll], ["mentions", w.notifyMentions], ["none", w.notifyNone]] as const).map(([value, label]) => ({ value, label: value === fallback ? w.notifyDefault(label) : label }));
  const rename = async () => {
    if (!name || !channelName.test(name)) return setError(w.nameInvalid);
    try {
      await a.update(viewing.id, { name });
      setName(null);
    } catch (e) { setError(e instanceof ApiError && e.code === "name_taken" ? w.nameTaken : w.failed); }
  };
  return (
    <aside className="details-pane" id="details" aria-labelledby="details-title" onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); a.toggleDetails(false); } }}>
      <header className="pane-head">
        <h2 id="details-title" className="title"><span>{w.details}</span><span className="where">{title}</span></h2>
        <span className="grow" />
        <button type="button" className="icon-button" aria-label={w.close} title={w.close} onClick={() => a.toggleDetails(false)}><Icon name="close" /></button>
      </header>
      <div className="details-scroll">
        {channel ? (
          <section className="detail-section">
            <h3>{w.about}</h3>
            {about === null ? (
              <>
                {details?.about ? <Text text={details.about} /> : <p className="muted">{details?.about === null ? w.noAbout : ""}</p>}
                {viewing.joined && !viewing.archived && details ? <button type="button" className="link" onClick={() => setAbout(details.about ?? "")}>{details.about ? w.editAbout : w.addAbout}</button> : null}
              </>
            ) : (
              <form onSubmit={e => { e.preventDefault(); void a.update(viewing.id, { about }).then(() => setAbout(null), () => a.toast(w.failed)); }}>
                <textarea value={about} maxLength={maxAbout} onChange={e => setAbout(e.target.value)} aria-label={w.about} placeholder={w.aboutPlaceholder} rows={3} autoFocus />
                <div className="form-actions">
                  <button type="button" className="button quiet" onClick={() => setAbout(null)}>{w.cancel}</button>
                  <button type="submit" className="button">{w.save}</button>
                </div>
              </form>
            )}
            {viewing.isDefault ? <p className="muted">{w.defaultChannel}</p> : null}
          </section>
        ) : null}

        <section className="detail-section">
          <h3>{w.notifications}</h3>
          <fieldset className="choices" disabled={!viewing.joined}>
            <legend className="sr-only">{w.notifications}</legend>
            {levels.map(l => (
              <label key={l.value}>
                <input type="radio" name="notify" value={l.value} checked={current === l.value} onChange={() => notify(l.value)} />
                <span>{l.label}</span>
              </label>
            ))}
          </fieldset>
          <p className="muted">{w.notifyHint}</p>
        </section>

        <section className="detail-section">
          <h3>{w.people} <span className="count">{details?.memberCount ?? ""}</span></h3>
          {channel && viewing.joined && !viewing.archived ? (
            <button type="button" className="button quiet small" onClick={() => a.openDialog({ kind: "add", conversation: viewing.id })}><Icon name="plus" size={16} />{w.addPeople}</button>
          ) : null}
          {details?.groups.length ? (
            <ul className="people">
              {details.groups.map(g => (
                <li key={g.id}>
                  <Icon name="people" size={20} /><span className="grow">{g.name}</span>
                  {details.canManage ? <button type="button" className="link" onClick={() => void a.removeGroup(viewing.id, g.id)}>{w.remove}</button> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="people">
            {(details?.members ?? viewing.people).map(id => (
              <li key={id}>
                <Avatar person={people[id]} size={24} />
                <span className="grow">{nameOf(people[id], w)}{id === me.id ? ` ${w.youSuffix}` : ""}</span>
                <Presence id={id} />
                {channel && details?.canManage && id !== me.id && !viewing.isDefault ? <button type="button" className="link" onClick={() => void a.removeMember(viewing.id, id)}>{w.remove}</button> : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="detail-section">
          <h3>{w.pinnedMessages}</h3>
          {pinned?.length ? (
            <ul className="pinned">
              {pinned.map(m => (
                <li key={m.id}>
                  <a href={`/chest/c/${m.conversation}?m=${m.id}`} onClick={e => { e.preventDefault(); void a.go({ view: "conversation", id: m.conversation, thread: null, message: m.id }); }}>
                    <span className="author">{nameOf(people[m.author], w)}</span>
                    {m.text ? <Text text={m.text.slice(0, 280)} /> : <span className="muted">{w.sealedMessage}</span>}
                  </a>
                </li>
              ))}
            </ul>
          ) : <p className="muted">{pinned ? w.noPinned : ""}</p>}
        </section>

        {channel ? (
          <section className="detail-section actions">
            {details?.canManage && !viewing.archived ? (
              name === null ? <button type="button" className="action-row" onClick={() => setName(viewing.name ?? "")}><Icon name="edit" size={18} />{w.rename}</button> : (
                <form onSubmit={e => { e.preventDefault(); void rename(); }}>
                  <label className="field"><span>{w.nameLabel}</span><input value={name} onChange={e => { setName(e.target.value.toLowerCase()); setError(null); }} maxLength={80} autoFocus aria-describedby="rename-hint" /></label>
                  <p id="rename-hint" className="muted">{error ?? w.nameHint}</p>
                  <div className="form-actions">
                    <button type="button" className="button quiet" onClick={() => setName(null)}>{w.cancel}</button>
                    <button type="submit" className="button">{w.save}</button>
                  </div>
                </form>
              )
            ) : null}
            {details?.canManage && !viewing.isDefault ? (
              <button type="button" className="action-row" onClick={() => viewing.archived
                ? void a.update(viewing.id, { archived: false })
                : a.openDialog({ kind: "confirm", text: w.confirmArchive(viewing.name ?? ""), action: w.archive, run: () => a.update(viewing.id, { archived: true }) })}>
                <Icon name="archive" size={18} />{viewing.archived ? w.unarchive : w.archive}
              </button>
            ) : null}
            {viewing.joined && !viewing.isDefault ? (
              <button type="button" className="action-row" onClick={() => a.openDialog({ kind: "confirm", text: w.confirmLeave(viewing.name ?? ""), action: w.leave, run: () => a.leave(viewing.id) })}><Icon name="back" size={18} />{w.leave}</button>
            ) : null}
          </section>
        ) : null}
      </div>
    </aside>
  );
}
