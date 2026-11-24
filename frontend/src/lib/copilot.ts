// Small pure helpers for the Scenario Copilot page (kept out of the component so they can be unit-tested).
import type { CopilotError } from "../api/types";

/** The five example prompt chips. All of them parse cleanly with the rule-based parser. */
export const EXAMPLE_PROMPTS: { label: string; prompt: string }[] = [
  { label: "Bearing wear, high severity", prompt: "Generate 2 hours of data with bearing wear starting at minute 40, high severity" },
  { label: "Heater fails, then repair", prompt: "Simulate 3 hours with a gradual sealing heater degradation from minute 20, repaired at minute 120" },
  { label: "Sudden vacuum leak", prompt: "90 minutes of data with a sudden vacuum leak at minute 30, extreme severity, seed 7" },
  { label: "Two faults", prompt: "Run 4 hours: mild film tension instability from the start and a punch dulling at minute 90, severe" },
  { label: "Healthy baseline", prompt: "A healthy 1 hour run at 2 Hz with low noise" },
];

export type JsonDraft = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

/** Parse the text of the editable JSON box. Returns a readable message (with line/column when the engine gives one). */
export function parseJsonDraft(text: string): JsonDraft {
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "The request must be a JSON object { ... }" };
    return { ok: true, value: v as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message.replace(/^JSON\.parse: /, "")}` };
  }
}

export const prettyJson = (v: unknown) => JSON.stringify(v, null, 2);

/** "faults.0.onset_s" -> "Fault 1 - onset_s"; "config.duration_s" -> "Config - duration_s"; "" -> "Request". */
export function describeLoc(loc: string): string {
  if (!loc) return "Request";
  const parts = loc.split(".");
  if (parts[0] === "faults" && parts.length >= 2 && /^\d+$/.test(parts[1])) {
    return parts.length > 2 ? `Fault ${Number(parts[1]) + 1} - ${parts.slice(2).join(".")}` : `Fault ${Number(parts[1]) + 1}`;
  }
  if (parts[0] === "config" && parts.length > 1) return `Config - ${parts.slice(1).join(".")}`;
  return parts.join(" - ");
}

/** For each top-level section, the errors that belong to it (so a card can mark its own fields). */
export function errorsBySection(errors: CopilotError[]): Record<"config" | "faults" | "other", CopilotError[]> {
  const out: Record<"config" | "faults" | "other", CopilotError[]> = { config: [], faults: [], other: [] };
  for (const e of errors) out[e.loc.startsWith("config") ? "config" : e.loc.startsWith("faults") ? "faults" : "other"].push(e);
  return out;
}

/** Zero-based line numbers of pretty-printed JSON that mention a field named in an error path (best effort, for line highlights). */
export function errorLines(text: string, errors: CopilotError[]): number[] {
  const lines = text.split("\n");
  const hit = new Set<number>();
  for (const e of errors) {
    const parts = e.loc.split(".").filter(Boolean);
    const field = parts[parts.length - 1];
    if (!field || /^\d+$/.test(field)) continue;
    const wantIndex = parts[0] === "faults" && /^\d+$/.test(parts[1] ?? "") ? Number(parts[1]) : null;
    let faultIdx = -1, inFaults = false;
    lines.forEach((ln, i) => {
      if (/^\s{2}"faults"\s*:/.test(ln)) inFaults = true;
      else if (inFaults && /^\s{4}\{/.test(ln)) faultIdx += 1;
      if (new RegExp(`"${field}"\\s*:`).test(ln)) {
        if (wantIndex !== null ? inFaults && faultIdx === wantIndex : !inFaults || parts[0] !== "faults") hit.add(i);
      }
    });
  }
  return [...hit].sort((a, b) => a - b);
}
