"""One-click PDF report for a run (Phase 7A): reportlab for the layout, matplotlib for the charts.

Sections: cover (name, config, date) -> sensor charts with fault periods shaded -> faults, labels and RUL ->
station health -> quality (synthetic runs: compared with the physics run of the same scenario) -> PdM predictions
(newest saved fault / RUL model). Every optional section is wrapped so one failure never loses the whole report.
"""
from __future__ import annotations

import io
from datetime import datetime
from typing import Any

import matplotlib

matplotlib.use("Agg")                       # no display needed on a server
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .simulator import SENSORS, LineSimulator, SimConfig, build_injector

GREEN, TEAL, RUST, SAGE, MINT, INK = "#174135", "#1F8A82", "#9B4630", "#7F9783", "#B9CAC7", "#1E1B10"
MAX_POINTS = 1800
PAGE_W = A4[0] - 4 * cm

_ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=_ss["Heading1"], fontName="Helvetica-Bold", fontSize=17, textColor=colors.HexColor(GREEN), spaceAfter=8)
H2 = ParagraphStyle("H2", parent=_ss["Heading2"], fontName="Helvetica-Bold", fontSize=12.5, textColor=colors.HexColor(GREEN), spaceBefore=10, spaceAfter=5)
BODY = ParagraphStyle("Body", parent=_ss["BodyText"], fontName="Helvetica", fontSize=9.5, leading=13, textColor=colors.HexColor(INK), alignment=TA_LEFT)
SMALL = ParagraphStyle("Small", parent=BODY, fontSize=8, leading=10.5, textColor=colors.HexColor("#5A625C"))


# ------------------------------------------------------------------ helpers
def _png(fig) -> io.BytesIO:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    buf.seek(0)
    return buf


def _img(fig, width: float = PAGE_W) -> Image:
    buf = _png(fig)
    w, h = fig.get_size_inches() if False else (None, None)
    from PIL import Image as PILImage  # pillow ships with matplotlib
    iw, ih = PILImage.open(buf).size
    buf.seek(0)
    return Image(buf, width=width, height=width * ih / iw)


def _down(df: pd.DataFrame, n: int = MAX_POINTS) -> pd.DataFrame:
    return df if len(df) <= n else df.iloc[:: int(np.ceil(len(df) / n))].reset_index(drop=True)


def _spans(t: np.ndarray, flags: np.ndarray) -> list[tuple[float, float]]:
    out, start = [], None
    for i, on in enumerate(flags.astype(bool)):
        if on and start is None:
            start = t[i]
        if not on and start is not None:
            out.append((start, t[i - 1]))
            start = None
    if start is not None:
        out.append((start, t[-1]))
    return out


def _shade(ax, t, fa) -> None:
    for a, b in _spans(t, fa):
        ax.axvspan(a, max(b, a + (t[-1] - t[0]) * 0.004), color=RUST, alpha=0.16, lw=0)


def _style(ax) -> None:
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color("#B8C4C2")
    ax.tick_params(labelsize=6.5, colors="#5A625C", length=2)
    ax.grid(axis="y", color="#E4EBEA", lw=0.5)


def _fig_sensors(df: pd.DataFrame, specs: list) -> Any:
    d = _down(df)
    t = d["t_s"].to_numpy(float) / 60.0
    fa = d["fault_active"].to_numpy() if "fault_active" in d else np.zeros(len(d))
    fig, axes = plt.subplots(len(specs), 1, figsize=(7.2, 1.15 * len(specs)), sharex=True)
    for ax, s in zip(np.atleast_1d(axes), specs):
        ax.plot(t, d[s.key].to_numpy(float), color=TEAL, lw=0.8)
        _shade(ax, t, fa)
        ax.set_ylabel(f"{s.label}\n({s.unit})", fontsize=6.3, color=INK, rotation=0, ha="right", va="center", labelpad=6)
        _style(ax)
    np.atleast_1d(axes)[-1].set_xlabel("time (min)", fontsize=7, color="#5A625C")
    fig.tight_layout(h_pad=0.4)
    return fig


def _table(rows: list[list[Any]], widths: list[float] | None = None, header: bool = True) -> Table:
    t = Table(rows, colWidths=widths, hAlign="LEFT", repeatRows=1 if header else 0)
    st = [("FONT", (0, 0), (-1, -1), "Helvetica", 8.5), ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor(INK)),
          ("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [colors.white, colors.HexColor("#F1F5F6")]),
          ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#D6E0E2")), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
          ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5)]
    if header:
        st += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(GREEN)), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
               ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5)]
    t.setStyle(TableStyle(st))
    return t


def _fmt(v: Any, d: int = 2) -> str:
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return "-"
    if isinstance(v, float):
        return f"{v:.{d}f}"
    return str(v)


def _note(text: str) -> Paragraph:
    return Paragraph(text, SMALL)


# ------------------------------------------------------------------ sections
def _cover_table(run: dict) -> list:
    c = run.get("config", {})
    rows = [["Setting", "Value"],
            ["Run id", run["id"]], ["Kind", run["kind"]], ["Created", str(run["created_at"])[:19].replace("T", " ") + " UTC"],
            ["Duration", f"{run['duration_s'] / 3600:.2f} h ({run['n_rows']:,} samples)"],
            ["Sample rate", f"{_fmt(c.get('sample_rate_hz'))} Hz"], ["Seed", _fmt(c.get("seed"))],
            ["Nominal speed", f"{_fmt(c.get('nominal_speed_bpm'), 0)} blisters/min"],
            ["Noise / drift scale", f"{_fmt(c.get('noise_scale'))} / {_fmt(c.get('drift_scale'))}"],
            ["Start-up / shut-down", f"{'yes' if c.get('include_startup') else 'no'} / {'yes' if c.get('include_shutdown') else 'no'}"]]
    if run["kind"] == "generative":
        rows.append(["Generator", f"{c.get('model_kind', '?')} ({c.get('model_id', '?')})"])
    rows.append(["Faults injected", str(len(c.get("faults", [])))])
    return [Paragraph("Configuration", H2), _table(rows, [4.5 * cm, PAGE_W - 4.5 * cm])]


def _sensor_section(df: pd.DataFrame) -> list:
    out: list = [PageBreak(), Paragraph("Sensor traces", H1),
                 _note("Shaded red bands mark periods where a fault is active (ground-truth label). Each chart shows one sensor over the whole run.")]
    half = (len(SENSORS) + 1) // 2
    out += [Spacer(1, 6), _img(_fig_sensors(df, SENSORS[:half])), PageBreak(), _img(_fig_sensors(df, SENSORS[half:]))]
    return out


def _fault_section(run: dict, df: pd.DataFrame) -> list:
    out: list = [PageBreak(), Paragraph("Faults, labels and remaining useful life", H1)]
    faults = run.get("config", {}).get("faults", [])
    if faults:
        rows = [["Fault", "Station", "Profile", "Onset (min)", "Ramp (min)", "Repair (min)", "Intensity"]]
        for f in faults:
            rows.append([str(f.get("type", "-")).replace("_", " "), str(f.get("station", "-")), str(f.get("profile") or "default"),
                         _fmt(f.get("onset_s", 0) / 60, 1), _fmt(f["ramp_s"] / 60, 1) if f.get("ramp_s") else "to end",
                         _fmt(f["end_s"] / 60, 1) if f.get("end_s") else "-", _fmt(f.get("intensity"), 1)])
        out.append(_table(rows))
    else:
        out.append(Paragraph("No faults were injected: this is a healthy run.", BODY))
    lab = run.get("summary", {}).get("labels", {}) or {}
    if lab:
        rows = [["Label summary", "Value"], ["Fraction of time a fault is active", f"{100 * (lab.get('active_fraction') or 0):.1f} %"],
                ["First fault becomes active", f"{_fmt(lab.get('first_active_s'), 0)} s" if lab.get("first_active_s") is not None else "-"],
                ["Fault segments", _fmt(lab.get("n_segments"))],
                ["Smallest remaining useful life", f"{_fmt(lab.get('min_rul_s'), 0)} s" if lab.get("min_rul_s") is not None else "-"]]
        for k, v in (lab.get("rows_by_type") or {}).items():
            rows.append([f"Rows labelled {k.replace('_', ' ')}", f"{v:,}"])
        out += [Spacer(1, 8), _table(rows, [8 * cm, PAGE_W - 8 * cm])]
    if "rul_s" in df and np.isfinite(df["rul_s"].to_numpy(float)).any():
        d = _down(df)
        t, rul = d["t_s"].to_numpy(float) / 60, d["rul_s"].to_numpy(float)
        fig, ax = plt.subplots(figsize=(7.2, 1.8))
        ax.plot(t, rul / 60, color=RUST, lw=1.1)
        ax.set_ylabel("RUL (min)", fontsize=7)
        ax.set_xlabel("time (min)", fontsize=7)
        _style(ax)
        out += [Paragraph("Remaining useful life (ground truth)", H2), _img(fig),
                _note("RUL = time left until the fault reaches failure. It is undefined (blank) while no fault is active.")]
    return out


def _health_section(run: dict, df: pd.DataFrame) -> list:
    cols = [c for c in df.columns if c.startswith("health_")]
    if not cols:
        return []
    d = _down(df)
    t = d["t_s"].to_numpy(float) / 60
    fig, ax = plt.subplots(figsize=(7.2, 2.2))
    for i, c in enumerate(cols):
        ax.plot(t, d[c].to_numpy(float), lw=0.9, label=c.removeprefix("health_"), color=plt.cm.viridis(i / max(1, len(cols) - 1)))
    ax.set_ylim(0, 102)
    ax.set_ylabel("station health (0-100)", fontsize=7)
    ax.set_xlabel("time (min)", fontsize=7)
    ax.legend(fontsize=6, ncol=4, frameon=False, loc="lower left")
    _style(ax)
    out: list = [Paragraph("Station health", H2), _img(fig)]
    st = run.get("summary", {}).get("stations") or {}
    if st:
        rows = [["Station", "Mean health", "Minimum health", "Worst status"]] + [[k, _fmt(v.get("mean_health"), 1), _fmt(v.get("min_health"), 1), str(v.get("status"))] for k, v in st.items()]
        out += [Spacer(1, 6), _table(rows)]
    return out


def _quality_section(run: dict, df: pd.DataFrame) -> list:
    from .pdm.quality import compare_runs
    out: list = [Paragraph("Synthetic data quality", H2)]
    if run["kind"] != "generative":
        out.append(Paragraph("This is a physics-simulator run, i.e. the reference that synthetic runs are compared against. "
                             "Open the Quality page to score a generator against it.", BODY))
        return out
    cfg = SimConfig.from_dict(run["config"])
    faults = run["config"].get("faults", [])
    inj = build_injector(faults, cfg.duration_s) if faults else None
    ref, _ = LineSimulator(cfg, modifiers=[inj] if inj else None).run()
    res = compare_runs(ref, df)
    out.append(Paragraph(f"Fidelity score against the physics run of the same scenario: <b>{res['score']:.1f} / 100</b>", BODY))
    rows = [["Component", "Score (0-1)"]] + [[k, _fmt(v, 3)] for k, v in res["components"].items()]
    out += [Spacer(1, 4), _table(rows, [6 * cm, 3 * cm])]
    worst = sorted(res["sensors"].items(), key=lambda kv: -kv[1]["ks"])[:6]
    rows = [["Sensor (6 largest KS)", "KS statistic", "Std ratio", "Mean error (sd)"]] + [[k, _fmt(v["ks"], 3), _fmt(v["std_ratio"], 2), _fmt(v["mean_err_sd"], 2)] for k, v in worst]
    out += [Spacer(1, 6), _table(rows), _note("KS statistic: 0 = identical distributions. Std ratio: synthetic / physics standard deviation (1 = same spread).")]
    return out


def _pdm_section(run: dict, df: pd.DataFrame) -> list:
    from .pdm import models as pm
    from .pdm import store
    out: list = [Paragraph("Predictive-maintenance models", H2)]
    metas = store.list_models()
    newest = {t: next((m for m in metas if m["task"] == t), None) for t in ("fault", "rul")}
    if not any(newest.values()):
        out.append(Paragraph("No PdM models have been trained yet (PdM page), so there are no predictions to show.", BODY))
        return out
    nominal = float(run["config"].get("nominal_speed_bpm", 220.0))
    d_fa = df["fault_active"].to_numpy() if "fault_active" in df else np.zeros(len(df))
    t_all = df["t_s"].to_numpy(float)
    onset = float(t_all[np.argmax(d_fa == 1)]) if (d_fa == 1).any() else None
    if newest["fault"]:
        m = newest["fault"]
        try:
            pr = pm.predict_run(store.load(m["id"]), df, nominal)
            t, p = np.array(pr["t_s"]) / 60, np.array(pr["p_fault"])
            fig, ax = plt.subplots(figsize=(7.2, 2.2))
            ax.plot(t, p, color=RUST, lw=1.1)
            ax.axhline(0.5, color=SAGE, lw=0.6, ls="--")
            _shade(ax, df["t_s"].to_numpy(float) / 60, d_fa)
            ax.set_ylim(0, 1.02)
            ax.set_ylabel("P(fault)", fontsize=7)
            ax.set_xlabel("time (min)", fontsize=7)
            _style(ax)
            flagged = np.flatnonzero(p > 0.5)
            first = float(pr["t_s"][flagged[0]]) if len(flagged) else None
            txt = f"Fault classifier <b>{m['name']}</b> ({m['id']}): peak P(fault) {p.max():.2f}. "
            if onset is not None and first is not None:
                txt += f"First alarm at {first / 60:.1f} min; the labelled fault becomes active at {onset / 60:.1f} min."
            elif onset is None and first is None:
                txt += "No alarm was raised on this healthy run (no false alarm)."
            elif onset is None:
                txt += f"An alarm at {first / 60:.1f} min on a run without faults = false alarm."
            else:
                txt += "No alarm was raised although a fault was active."
            out += [Paragraph(txt, BODY), _img(fig)]
        except Exception as exc:                      # noqa: BLE001 - report must not fail because of one model
            out.append(Paragraph(f"Fault model {m['id']} could not be applied: {exc}", BODY))
    if newest["rul"]:
        m = newest["rul"]
        try:
            pr = pm.predict_run(store.load(m["id"]), df, nominal)
            fig, ax = plt.subplots(figsize=(7.2, 2.2))
            ax.plot(np.array(pr["t_s"]) / 60, np.array(pr["rul_s"]) / 60, color=TEAL, lw=1.1, label="predicted RUL")
            if "rul_s" in df and np.isfinite(df["rul_s"].to_numpy(float)).any():
                ax.plot(t_all / 60, np.minimum(df["rul_s"].to_numpy(float), pr["rul_cap_s"]) / 60, color=INK, lw=0.8, ls="--", label="true RUL (capped)")
            ax.legend(fontsize=6.5, frameon=False)
            ax.set_ylabel("RUL (min)", fontsize=7)
            ax.set_xlabel("time (min)", fontsize=7)
            _style(ax)
            out += [Paragraph(f"RUL regressor <b>{m['name']}</b> ({m['id']}). RUL is capped at {pr['rul_cap_s'] / 60:.0f} min.", BODY), _img(fig)]
        except Exception as exc:                      # noqa: BLE001
            out.append(Paragraph(f"RUL model {m['id']} could not be applied: {exc}", BODY))
    return out


def _safe(fn, title: str, *args) -> list:
    try:
        return fn(*args)
    except Exception as exc:                          # noqa: BLE001
        return [Paragraph(title, H2), Paragraph(f"This section is unavailable: {type(exc).__name__}: {exc}", BODY)]


# ------------------------------------------------------------------ cover + footer
def _cover(run: dict):
    def draw(canvas, doc):
        w, h = A4
        canvas.saveState()
        canvas.setFillColor(colors.HexColor(GREEN))
        canvas.rect(0, h - 9.2 * cm, w, 9.2 * cm, stroke=0, fill=1)
        canvas.setFillColor(colors.HexColor(MINT))
        canvas.circle(w - 3.2 * cm, h - 4.6 * cm, 2.1 * cm, stroke=0, fill=1)
        canvas.setFillColor(colors.HexColor(SAGE))
        canvas.circle(w - 5.4 * cm, h - 6.4 * cm, 1.2 * cm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica", 10)
        canvas.drawString(2 * cm, h - 2.3 * cm, "BLISTERSYNTH AI  |  RUN REPORT")
        canvas.setFont("Helvetica-Bold", 25)
        name = run["name"] if len(run["name"]) <= 34 else run["name"][:33] + "..."
        canvas.drawString(2 * cm, h - 5.0 * cm, name)
        canvas.setFont("Helvetica", 11)
        canvas.drawString(2 * cm, h - 6.0 * cm, f"{run['kind'].capitalize()} run  |  {run['id']}")
        canvas.drawString(2 * cm, h - 6.8 * cm, f"Generated {datetime.now().strftime('%d %b %Y, %H:%M')}")
        canvas.restoreState()
    return draw


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#5A625C"))
    canvas.drawString(2 * cm, 1.2 * cm, "BlisterSynth AI - synthetic pharma packaging-line sensor data")
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.restoreState()


# ------------------------------------------------------------------ public
def build_run_report(run: dict, df: pd.DataFrame) -> bytes:
    """`run` is a row of the runs table (dict), `df` its full CSV. Returns the PDF bytes."""
    needed = {"t_s"} | {s.key for s in SENSORS}
    if not needed <= set(df.columns):
        raise ValueError("The run file is missing sensor columns, so no report can be made.")
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=1.8 * cm, bottomMargin=1.8 * cm,
                            title=f"{run['name']} - BlisterSynth AI report", author="BlisterSynth AI")
    story: list = [Spacer(1, 7.6 * cm), Paragraph("Summary", H1),
                   Paragraph(f"This report describes the run <b>{run['name']}</b>: {run['n_rows']:,} samples of {len(SENSORS)} sensors "
                             f"over {run['duration_s'] / 3600:.2f} hours, with {len(run.get('config', {}).get('faults', []))} injected fault(s).", BODY)]
    story += _cover_table(run)
    story += _sensor_section(df)
    story += _fault_section(run, df)
    story += _safe(_health_section, "Station health", run, df)
    story += [PageBreak(), Paragraph("Quality and predictive maintenance", H1)]
    story += _safe(_quality_section, "Synthetic data quality", run, df)
    story += _safe(_pdm_section, "Predictive-maintenance models", run, df)
    doc.build(story, onFirstPage=lambda c, d: (_cover(run)(c, d), _footer(c, d)), onLaterPages=_footer)
    return buf.getvalue()
