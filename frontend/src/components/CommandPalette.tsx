import { CornerDownLeft, Search, Syringe, Zap, FileText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { buildCommands, FALLBACK_FAULTS, groupCommands, searchCommands, type Command, type CommandGroup } from "../lib/palette";
import { Modal } from "./ui";

const GROUP_ICON: Record<CommandGroup, typeof Search> = { Pages: FileText, Actions: Zap, "Inject fault": Syringe };

interface Props {
  open: boolean;
  onClose: () => void;
  pages: { to: string; label: string }[];
  /** Called with the chosen command; the shell decides what it does (navigate, send to the stream, toggle theme...). */
  onRun: (cmd: Command) => void;
}

/** Ctrl/Cmd+K palette: type to fuzzy-search pages and actions, arrows to move, Enter to run, Esc to close. */
export default function CommandPalette({ open, onClose, pages, onRun }: Props) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [faults, setFaults] = useState(FALLBACK_FAULTS);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The fault list comes from the backend catalogue (so new fault types appear automatically); built-in list until then.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.faultCatalog().then((c) => { if (alive && c.fault_types.length) setFaults(c.fault_types.map((f) => ({ key: f.key, label: f.label }))); }).catch(() => undefined);
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ(""); setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 30);      // after the Modal has moved focus to the dialog
    return () => clearTimeout(t);
  }, [open]);

  const all = useMemo(() => buildCommands(pages, faults), [pages, faults]);
  // With no query, show pages + actions only (8 fault commands would bury them); typing searches everything.
  const results = useMemo(() => (q.trim() ? searchCommands(all, q) : all.filter((c) => c.group !== "Inject fault")), [all, q]);
  const groups = useMemo(() => (q.trim() ? [{ group: "Results" as const, items: results }] : groupCommands(results)), [q, results]);
  const flat = results;

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [active]);

  const run = (c: Command | undefined) => { if (c) { onClose(); onRun(c); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (flat.length ? (i + 1) % flat.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(flat[active]); }
  };

  let index = -1;
  return (
    <Modal open={open} onClose={onClose} title="Command palette" size="lg" top bare>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="h-4 w-4 shrink-0 text-soft" aria-hidden />
        <input ref={inputRef} role="combobox" aria-expanded aria-controls="palette-list" aria-autocomplete="list"
          aria-activedescendant={flat[active] ? `cmd-${flat[active].id}` : undefined} aria-label="Search pages and actions"
          className="h-14 w-full bg-transparent text-base text-ink outline-none placeholder:text-soft/70" placeholder="Search pages and actions..."
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        <kbd className="hidden rounded-md border border-line bg-tint px-1.5 py-0.5 text-[11px] text-soft sm:block">Esc</kbd>
      </div>
      <ul id="palette-list" ref={listRef} role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto p-2">
        {groups.map((g) => {
          const Icon = g.group === "Results" ? Search : GROUP_ICON[g.group];
          return (
            <li key={g.group} role="presentation">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-soft">{g.group}</p>
              <ul role="presentation">
                {g.items.map((c) => {
                  index += 1;
                  const i = index;
                  const on = i === active;
                  const CIcon = GROUP_ICON[c.group] ?? Icon;
                  return (
                    <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={on} data-active={on}
                      onMouseMove={() => setActive(i)} onClick={() => run(c)}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${on ? "bg-primary text-on-primary" : "hover:bg-tint"}`}>
                      <CIcon className={`h-4 w-4 shrink-0 ${on ? "" : "text-primary"}`} aria-hidden />
                      <span className="flex-1 truncate">{c.title}</span>
                      {c.hint && <span className={`hidden truncate text-xs sm:block ${on ? "text-on-primary/80" : "text-soft"}`}>{c.hint}</span>}
                      {on && <CornerDownLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
        {flat.length === 0 && <li className="px-3 py-6 text-center text-sm text-soft" role="presentation">No commands match &ldquo;{q}&rdquo;.</li>}
      </ul>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-soft">
        <span><kbd className="rounded border border-line bg-tint px-1">&uarr;</kbd> <kbd className="rounded border border-line bg-tint px-1">&darr;</kbd> move</span>
        <span><kbd className="rounded border border-line bg-tint px-1">Enter</kbd> run</span>
        <span className="ml-auto">Ctrl K / Cmd K</span>
      </div>
    </Modal>
  );
}
