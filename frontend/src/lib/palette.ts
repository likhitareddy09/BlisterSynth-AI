// Pure logic behind the Ctrl/Cmd+K command palette: the list of commands and the fuzzy search over them.

export type CommandGroup = "Pages" | "Actions" | "Inject fault";

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** Extra words that should find this command ("dark mode" finds "Toggle theme"). */
  keywords?: string[];
  hint?: string;
}

/** The 8 fault types of the backend catalogue (used when the catalogue has not loaded yet). */
export const FALLBACK_FAULTS: { key: string; label: string }[] = [
  { key: "bearing_wear", label: "Main drive bearing wear" },
  { key: "sealing_heater_degradation", label: "Sealing heater degradation" },
  { key: "seal_pressure_leak", label: "Sealing pressure leak" },
  { key: "vacuum_leak", label: "Forming vacuum leak" },
  { key: "film_tension_instability", label: "Film tension instability" },
  { key: "cooling_blockage", label: "Cooling water blockage" },
  { key: "punch_dulling", label: "Punching tool dulling" },
  { key: "pocket_feeder_jam", label: "Tablet feeder jamming" },
];

/**
 * Fuzzy score of `query` against `text`. 0 = no match. Higher = better.
 *  - every query letter must appear in order (a "subsequence"), so "bwr" finds "Bearing wear"
 *  - bonuses for: a match at the very start, letters that start a word, and letters that follow each other
 *  - a plain substring match always beats a scattered one
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const t = text.toLowerCase();
  if (!q) return 1;
  const sub = t.replace(/\s+/g, " ").indexOf(query.toLowerCase().trim());
  if (sub >= 0) return 1000 - sub - t.length * 0.01 + (sub === 0 ? 200 : 0);
  let score = 0, ti = 0, prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    let s = 1;
    if (found === 0 || /[\s\-_/]/.test(t[found - 1])) s += 8;       // start of a word
    if (found === prev + 1) s += 5;                                  // consecutive letters
    score += s - Math.min(3, (found - ti) * 0.2);                    // small penalty for long gaps
    prev = found; ti = found + 1;
  }
  return Math.max(1, score);
}

/** Commands matching `query`, best first. An empty query returns everything in the given order. */
export function searchCommands(commands: Command[], query: string): Command[] {
  const q = query.trim();
  if (!q) return commands;
  return commands
    .map((c, i) => {
      const own = fuzzyScore(q, c.title);
      const kw = Math.max(0, ...(c.keywords ?? []).map((k) => fuzzyScore(q, k))) * 0.6;
      const group = fuzzyScore(q, c.group) * 0.3;
      return { c, i, score: Math.max(own, kw, group) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.c);
}

/** Group results in display order (Pages, Actions, Inject fault) while keeping the ranking inside each group. */
export function groupCommands(commands: Command[]): { group: CommandGroup; items: Command[] }[] {
  const order: CommandGroup[] = ["Pages", "Actions", "Inject fault"];
  return order
    .map((g) => ({ group: g, items: commands.filter((c) => c.group === g) }))
    .filter((g) => g.items.length > 0);
}

/** Build the full command list. `faults` come from /api/faults/catalog; the built-in 8 are used until it loads. */
export function buildCommands(
  pages: { to: string; label: string }[],
  faults: { key: string; label: string }[] = FALLBACK_FAULTS,
): Command[] {
  const pageCmds: Command[] = pages.map((p) => ({ id: `page:${p.to}`, title: p.label, group: "Pages", hint: "Go to page", keywords: ["open", "go to", "navigate"] }));
  const actions: Command[] = [
    { id: "action:new-simulation", title: "New simulation", group: "Actions", keywords: ["run", "simulate", "generate", "create"], hint: "Opens the Simulator" },
    { id: "action:start-stream", title: "Start live stream", group: "Actions", keywords: ["play", "resume", "stream", "websocket", "digital twin"], hint: "Opens Live and starts the twin" },
    { id: "action:repair", title: "Repair all faults", group: "Actions", keywords: ["fix", "clear", "maintenance"], hint: "On the Live page" },
    { id: "action:toggle-theme", title: "Toggle theme", group: "Actions", keywords: ["dark mode", "light mode", "appearance", "night"], hint: "Dark / light" },
    { id: "action:start-demo", title: "Start demo mode", group: "Actions", keywords: ["viva", "presentation", "auto play", "showcase"], hint: "3-4 minute guided tour" },
    { id: "action:tour", title: "Take the product tour", group: "Actions", keywords: ["help", "onboarding", "guide", "walkthrough"] },
  ];
  const inject: Command[] = faults.map((f) => ({
    id: `inject:${f.key}`, title: `Inject ${f.label.toLowerCase()}`, group: "Inject fault",
    keywords: ["fault", "break", "fail", f.key.replace(/_/g, " ")], hint: "Live stream",
  }));
  return [...pageCmds, ...actions, ...inject];
}

// ---------------------------------------------------------------------------------------------- what a command DOES
/** The effect of running a command. The shell (AppShell) carries it out; keeping this pure makes it unit-testable. */
export type PaletteEffect =
  | { kind: "navigate"; to: string }
  | { kind: "live"; to: string; msg: Record<string, unknown> }   // go to the Live page, then send this WebSocket message
  | { kind: "theme" }
  | { kind: "demo" }
  | { kind: "tour" };

export function resolveCommand(cmd: Pick<Command, "id">): PaletteEffect | null {
  const [kind, ...rest] = cmd.id.split(":");
  const arg = rest.join(":");
  if (kind === "page" && arg.startsWith("/app")) return { kind: "navigate", to: arg };
  if (kind === "inject" && arg) return { kind: "live", to: "/app/live", msg: { action: "inject", fault: { type: arg, onset_s: 0, intensity: 1 } } };
  switch (cmd.id) {
    case "action:new-simulation": return { kind: "navigate", to: "/app/simulator" };
    case "action:start-stream": return { kind: "live", to: "/app/live", msg: { action: "resume" } };
    case "action:repair": return { kind: "live", to: "/app/live", msg: { action: "repair" } };
    case "action:toggle-theme": return { kind: "theme" };
    case "action:start-demo": return { kind: "demo" };
    case "action:tour": return { kind: "tour" };
    default: return null;
  }
}
