import { AlertTriangle, Bot, Download, ListChecks, Play, RotateCcw, Send, Sparkles, User } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../api/client";
import type { CopilotError, CopilotParse, RunLabels, RunWithPreview } from "../api/types";
import { ErrorBanner, errMsg, useAction, useLoad } from "../components/common";
import RunView from "../components/RunView";
import { Badge, Button, Card, PageHeader, Toggle } from "../components/ui";
import { describeLoc, errorLines, EXAMPLE_PROMPTS, parseJsonDraft, prettyJson } from "../lib/copilot";

type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; kind: "hello" }
  | { id: number; role: "assistant"; kind: "parsed"; parse: CopilotParse }
  | { id: number; role: "assistant"; kind: "error"; text: string };

/** Which parser made this answer: Claude (with the model name) or the built-in rules. Always visible. */
export function ParserBadge({ parser, model }: { parser: "claude" | "rules"; model?: string | null }) {
  return parser === "claude"
    ? <Badge tone="teal" icon={<Sparkles className="h-3 w-3" aria-hidden />}>Parsed by Claude{model ? ` | ${model}` : ""}</Badge>
    : <Badge tone="neutral" icon={<ListChecks className="h-3 w-3" aria-hidden />}>Parsed by rules</Badge>;
}

/** Editable JSON + live validation + Run button + the charts of the run it creates. */
function ParsedCard({ parse, onRunCreated }: { parse: CopilotParse; onRunCreated: () => void }) {
  const sensors = useLoad(api.sensors);
  const initial = prettyJson(parse.request);
  const [text, setText] = useState(initial);
  const [errors, setErrors] = useState<CopilotError[]>(parse.errors);
  const [syntax, setSyntax] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<RunWithPreview | null>(null);
  const [labels, setLabels] = useState<RunLabels | null>(null);
  const seq = useRef(0);
  const uid = useId();

  // Validate every edit: JSON syntax locally, everything else with the backend's own Pydantic models (debounced).
  useEffect(() => {
    if (text === initial) { setSyntax(null); setErrors(parse.errors); return; }
    const draft = parseJsonDraft(text);
    if (!draft.ok) { setSyntax(draft.error); return; }
    setSyntax(null);
    const mine = ++seq.current;
    setChecking(true);
    const t = setTimeout(() => {
      api.copilotValidate(draft.value)
        .then((v) => { if (mine === seq.current) setErrors(v.errors); })
        .catch((e) => { if (mine === seq.current) setErrors([{ loc: "", msg: errMsg(e) }]); })
        .finally(() => { if (mine === seq.current) setChecking(false); });
    }, 350);
    return () => clearTimeout(t);
  }, [text, initial, parse.errors]);

  const doRun = useCallback(async () => {
    const draft = parseJsonDraft(text);
    if (!draft.ok) throw new Error(draft.error);
    const run = await api.simulate(draft.value as unknown as Parameters<typeof api.simulate>[0]);
    setResult(run);
    const faults = (draft.value.faults as unknown[] | undefined) ?? [];
    setLabels(faults.length ? await api.runLabels(run.id).catch(() => null) : null);
    onRunCreated();
  }, [text, onRunCreated]);
  const [run, busy, runError, clearRun] = useAction(doRun);

  const bad = errorLines(text, errors);
  const blocked = syntax !== null || errors.length > 0 || checking;
  const rows = Math.min(30, Math.max(8, text.split("\n").length + 1));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ParserBadge parser={parse.parser} model={parse.model} />
        {parse.valid && errors.length === 0 && !syntax && <Badge tone="green">valid config</Badge>}
        {(errors.length > 0 || syntax) && <Badge tone="red">{syntax ? "invalid JSON" : `${errors.length} problem${errors.length > 1 ? "s" : ""}`}</Badge>}
      </div>

      {parse.fallback_reason && (
        <div className="flex items-start gap-2 rounded-2xl bg-warn/10 px-3 py-2 text-sm text-warn" role="status" data-testid="fallback-note">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{parse.fallback_reason}</span>
        </div>
      )}
      {parse.notes.length > 0 && (
        <ul className="space-y-0.5 text-sm text-soft">{parse.notes.map((n, i) => <li key={i} className="flex gap-2"><span aria-hidden className="text-teal">&#8226;</span>{n}</li>)}</ul>
      )}
      {parse.warnings.length > 0 && (
        <ul className="space-y-0.5 rounded-2xl bg-warn/10 px-3 py-2 text-sm text-warn" aria-label="Assumptions">
          {parse.warnings.map((n, i) => <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{n}</li>)}
        </ul>
      )}

      <div>
        <label className="label" htmlFor={`${uid}-json`}>Simulation request (editable JSON)</label>
        <div className={`overflow-hidden rounded-2xl border bg-tint ${syntax || errors.length ? "border-rust/60" : "border-line"}`}>
          <div className="relative">
            {/* red bars behind the lines that errors point to */}
            <div className="code-sync pointer-events-none absolute inset-x-0 top-0 px-0 py-3 font-mono text-[13px] leading-[1.55]" aria-hidden>
              {text.split("\n").map((_, i) => <div key={i} className={bad.includes(i) ? "bg-rust/15" : ""}>&nbsp;</div>)}
            </div>
            <textarea id={`${uid}-json`} spellCheck={false} wrap="off" value={text} rows={rows} onChange={(e) => setText(e.target.value)}
              aria-invalid={blocked && !checking} aria-describedby={`${uid}-problems`}
              className="relative block w-full resize-y overflow-x-auto whitespace-pre bg-transparent px-4 py-3 font-mono text-[13px] leading-[1.55] text-ink outline-none" />
          </div>
        </div>
        <div id={`${uid}-problems`} aria-live="polite" className="mt-2 space-y-1">
          {syntax && <p className="flex gap-2 text-sm text-rust" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{syntax}</p>}
          {!syntax && errors.map((e, i) => (
            <p key={i} className="flex gap-2 text-sm text-rust" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span><b className="font-semibold">{describeLoc(e.loc)}:</b> {e.msg}</span></p>
          ))}
          {checking && !syntax && <p className="text-xs text-soft">Checking...</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button loading={busy} disabled={blocked} onClick={() => run()}><Play className="h-4 w-4" aria-hidden />{busy ? "Simulating..." : "Run"}</Button>
        <Button variant="secondary" disabled={text === initial} onClick={() => setText(initial)}><RotateCcw className="h-4 w-4" aria-hidden />Reset JSON</Button>
        {blocked && !checking && <span className="text-xs text-soft">Fix the problems above to enable Run.</span>}
      </div>
      <ErrorBanner error={runError ?? sensors.error} onClose={clearRun} />

      {result && sensors.data && (
        <Card tint="green" title={`Result: ${result.name}`} className="!shadow-none"
          actions={<a className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href={api.downloadUrl(result.id)}><Download className="h-4 w-4" aria-hidden />CSV</a>}>
          <p className="mb-3 text-sm text-soft">{result.n_rows.toLocaleString()} rows | {result.config.faults ? `${(result.config.faults as unknown[]).length} fault(s)` : "healthy"} | id {result.id}</p>
          <RunView preview={result.preview} sensors={sensors.data.sensors} labels={labels} />
        </Card>
      )}
    </div>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  const user = role === "user";
  return (
    <div className={`flex gap-3 ${user ? "flex-row-reverse" : ""}`}>
      <span className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full ${user ? "bg-primary text-on-primary" : "bg-pastel-green text-primary"}`} aria-hidden>
        {user ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </span>
      <div className={`min-w-0 max-w-[min(100%,46rem)] rounded-3xl px-4 py-3 ${user ? "bg-primary text-on-primary" : "w-full bg-surface shadow-card"}`}>{children}</div>
    </div>
  );
}

export default function Copilot({ onRunCreated }: { onRunCreated: () => void }) {
  const status = useLoad(api.copilotStatus);
  const [useClaude, setUseClaude] = useState(true);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, role: "assistant", kind: "hello" }]);
  const seq = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const limit = status.data?.max_prompt_chars ?? 1000;

  const doSend = useCallback(async (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    setInput("");
    setMsgs((m) => [...m, { id: seq.current++, role: "user", text: prompt }]);
    try {
      const parse = await api.copilotParse(prompt, useClaude);
      setMsgs((m) => [...m, { id: seq.current++, role: "assistant", kind: "parsed", parse }]);
    } catch (e) {
      setMsgs((m) => [...m, { id: seq.current++, role: "assistant", kind: "error", text: errMsg(e) }]);
    }
  }, [useClaude]);
  const [send, thinking] = useAction(doSend);

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" }); }, [msgs.length, thinking]);

  const claude = status.data?.claude_available ?? false;
  return (
    <div className="space-y-5">
      <PageHeader title="Scenario Copilot"
        subtitle="Describe a scenario in plain English. The Copilot turns it into a simulation config you can check, edit and run."
        actions={
          <>
            {status.data && (claude
              ? <Badge tone="teal" icon={<Sparkles className="h-3 w-3" aria-hidden />}>Claude connected | {status.data.model}</Badge>
              : <Badge tone="neutral" icon={<ListChecks className="h-3 w-3" aria-hidden />}>Rule-based parser (no ANTHROPIC_API_KEY)</Badge>)}
            {claude && (
              <label className="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs text-soft shadow-card">
                <Toggle checked={useClaude} onChange={setUseClaude} label="Use Claude" /><span>Use Claude</span>
              </label>
            )}
          </>
        } />
      <ErrorBanner error={status.error} />

      <Card padded={false} className="flex min-h-[28rem] flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6" role="log" aria-label="Conversation" aria-live="polite">
          {msgs.map((m) => {
            if (m.role === "user") return <Bubble key={m.id} role="user"><p className="whitespace-pre-wrap text-sm">{m.text}</p></Bubble>;
            if (m.kind === "hello") {
              return (
                <Bubble key={m.id} role="assistant">
                  <p className="text-sm"><b>Hi! Tell me what to simulate.</b> Give a length, the fault(s), when they start and how severe they are. For example:</p>
                  <p className="mt-2 rounded-2xl bg-tint px-3 py-2 text-sm italic text-soft">&ldquo;{EXAMPLE_PROMPTS[0].prompt}&rdquo;</p>
                  <p className="mt-2 text-xs text-soft">I show you the JSON I understood before anything runs, so you stay in control.</p>
                </Bubble>
              );
            }
            if (m.kind === "error") return <Bubble key={m.id} role="assistant"><p className="flex gap-2 text-sm text-rust" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{m.text}</p></Bubble>;
            return <Bubble key={m.id} role="assistant"><ParsedCard parse={m.parse} onRunCreated={onRunCreated} /></Bubble>;
          })}
          {thinking && (
            <Bubble role="assistant"><p className="flex items-center gap-2 text-sm text-soft" role="status"><span className="inline-flex gap-1" aria-hidden>
              {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>Reading your request...</p></Bubble>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-line p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap gap-2" aria-label="Example prompts">
            {EXAMPLE_PROMPTS.map((e) => (
              <button key={e.label} type="button" disabled={thinking} onClick={() => send(e.prompt)} title={e.prompt}
                className="press inline-flex min-h-[40px] items-center rounded-full border border-line bg-surface px-3 text-xs font-medium text-soft transition sm:min-h-0 sm:py-1.5 hover:border-primary/40 hover:bg-tint hover:text-ink disabled:opacity-50">
                {e.label}
              </button>
            ))}
          </div>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea aria-label="Describe a scenario" rows={3} maxLength={limit} value={input} placeholder="e.g. Generate 2 hours of data with bearing wear starting at minute 40, high severity"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              className="field min-h-[4.5rem] flex-1 resize-none sm:min-h-[3rem]" />
            <Button type="submit" loading={thinking} disabled={!input.trim()} aria-label="Send"><Send className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Send</span></Button>
          </form>
          <p className="mt-1.5 text-right text-[11px] text-soft">{input.length}/{limit} | Enter to send, Shift+Enter for a new line</p>
        </div>
      </Card>
    </div>
  );
}
