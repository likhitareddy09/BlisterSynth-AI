import { corrColor, diffColor, duplicateColumns, featureLabel, fmtP, formatBytes, gaugeVerdict, imbalanceRows, isCsvFile, ksSummary, maxAbs, mergeDist,
  missingSensors, normalizeRows, pct, rocAuc, SENSOR_KEYS, setMapping, shareColor, shortSensor, toXY, utilityText } from "./metrics";
import { makeReport } from "../test/fixtures";

describe("colour scales", () => {
  it("positive correlation is teal, negative is blue, stronger = more opaque", () => {
    expect(corrColor(0.9)).toContain("31, 158, 147");
    expect(corrColor(-0.9)).toContain("91, 127, 166");
    const alpha = (c: string) => Number(c.match(/, ([\d.]+)\)$/)![1]);
    expect(alpha(corrColor(0.9))).toBeGreaterThan(alpha(corrColor(0.2)));
    expect(alpha(corrColor(-1))).toBeCloseTo(alpha(corrColor(1)));
  });
  it("is transparent for missing values", () => {
    expect(corrColor(null)).toBe("transparent");
    expect(corrColor(NaN)).toBe("transparent");
    expect(diffColor(undefined)).toBe("transparent");
  });
  it("clamps out-of-range values", () => expect(corrColor(5)).toBe(corrColor(1)));
  it("difference scale saturates at maxAbs", () => expect(diffColor(0.5, 0.2)).toBe(diffColor(0.2, 0.2)));
  it("share colour grows with the share", () => {
    const alpha = (c: string) => Number(c.match(/, ([\d.]+)\)$/)![1]);
    expect(alpha(shareColor(1))).toBeGreaterThan(alpha(shareColor(0.1)));
    expect(alpha(shareColor(2))).toBe(alpha(shareColor(1)));
  });
  it("maxAbs has a floor so an all-zero matrix never divides by 0", () => {
    expect(maxAbs([[0, 0], [0, 0]])).toBe(0.05);
    expect(maxAbs([[0, -0.4], [0.1, 0]])).toBe(0.4);
  });
});

describe("matrix helpers", () => {
  it("normalizeRows makes every non-empty row sum to 1", () => {
    const n = normalizeRows([[2, 2], [1, 3], [0, 0]]);
    expect(n[0]).toEqual([0.5, 0.5]);
    expect(n[1][1]).toBeCloseTo(0.75);
    expect(n[2]).toEqual([0, 0]);
  });
  it("shortSensor drops the unit suffix", () => {
    expect(shortSensor("sealing_pressure_bar")).toBe("sealing pressure");
    expect(shortSensor("vib_x_mm_s")).toBe("vib x");
    expect(shortSensor("film_tension_instability")).toBe("film tension instability");
  });
  it("featureLabel splits sensor and statistic", () => {
    expect(featureLabel("vib_x_mm_s__std")).toBe("vib_x_mm_s (std)");
    expect(featureLabel("plain")).toBe("plain");
  });
});

describe("report maths", () => {
  it("formats p-values", () => {
    expect(fmtP(0.0000001)).toBe("<0.001");
    expect(fmtP(0.0421)).toBe("0.042");
    expect(fmtP(0.5)).toBe("0.50");
    expect(fmtP(null)).toBe("-");
  });
  it("formats percentages", () => {
    expect(pct(0.5367)).toBe("54%");
    expect(pct(0.5367, 1)).toBe("53.7%");
    expect(pct(null)).toBe("-");
  });
  it("gauge verdict thresholds", () => {
    expect(gaugeVerdict(90)).toBe("good");
    expect(gaugeVerdict(75)).toBe("good");
    expect(gaugeVerdict(60)).toBe("fair");
    expect(gaugeVerdict(20)).toBe("poor");
    expect(gaugeVerdict(null)).toBe("n/a");
  });
  it("counts passing sensors", () => expect(ksSummary([{ pass: true }, { pass: false }, { pass: true }])).toEqual({ passed: 2, total: 3 }));
  it("trapezoid AUC: diagonal = 0.5, perfect = 1, unsorted input is handled", () => {
    expect(rocAuc([[0, 0], [1, 1]])).toBeCloseTo(0.5);
    expect(rocAuc([[0, 0], [0, 1], [1, 1]])).toBeCloseTo(1);
    expect(rocAuc([[1, 1], [0, 0], [0.5, 0.5]])).toBeCloseTo(0.5);
  });
  it("utilityText explains TSTR / TRTR", () => {
    expect(utilityText(makeReport().tstr)).toBe("TSTR 0.53 / TRTR 0.60 = 89%");
    expect(utilityText({ available: false, reason: "no faults" })).toBe("no faults");
  });
  it("toXY converts point pairs", () => expect(toXY([[1, 2]])).toEqual([{ x: 1, y: 2 }]));
});

describe("mergeDist", () => {
  it("puts the histogram bin under each KDE grid point", () => {
    const rows = mergeDist({ x: [0.5, 1.5, 2.5], real_hist: [1, 2, 3], syn_hist: [3, 2, 1], kde_x: [0.5, 1.5, 2.5], real_kde: [9, 9, 9], syn_kde: [8, 8, 8] });
    expect(rows.map((r) => r.real_hist)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.syn_hist)).toEqual([3, 2, 1]);
    expect(rows[0].real_kde).toBe(9);
  });
  it("never indexes outside the histogram", () => {
    const rows = mergeDist({ x: [0, 1], real_hist: [5, 6], syn_hist: [7, 8], kde_x: [-10, 10], real_kde: [0, 0], syn_kde: [0, 0] });
    expect(rows.map((r) => r.real_hist)).toEqual([5, 6]);
  });
});

describe("imbalance rows", () => {
  it("sorts by improvement and prettifies names", () => {
    const rows = imbalanceRows({ model_id: "m", real_only: {} as never, real_plus_synthetic: {} as never, setup: {},
      improvement: { macro_f1_delta: 0.5, macro_f1_relative: 1, classes_improved: 2, classes_worse: 0, headline: "h", note: "n",
        classes: [{ class: "vacuum_leak", recall_real: 0, recall_aug: 1, delta: 1 }, { class: "none", recall_real: 1, recall_aug: 1, delta: 0 }, { class: "bearing_wear", recall_real: 0.1, recall_aug: 0.5, delta: 0.4 }] } });
    expect(rows.map((r) => r.name)).toEqual(["vacuum leak", "bearing wear", "none"]);
  });
});

describe("Data Lab mapping helpers", () => {
  const full = Object.fromEntries(SENSOR_KEYS.map((k) => [k, k.toUpperCase()]));
  it("finds missing sensors", () => {
    expect(missingSensors(full)).toEqual([]);
    expect(missingSensors({ ...full, vacuum_kpa: "" })).toEqual(["vacuum_kpa"]);
    expect(missingSensors({})).toHaveLength(14);
  });
  it("finds duplicated columns", () => {
    expect(duplicateColumns(full)).toEqual([]);
    expect(duplicateColumns({ a: "X", b: "X", c: "Y" })).toEqual(["X"]);
  });
  it("setMapping sets and clears without mutating", () => {
    const m = { a: "1" };
    const n = setMapping(m, "b", "2");
    expect(n).toEqual({ a: "1", b: "2" });
    expect(m).toEqual({ a: "1" });
    expect(setMapping(n, "a", "")).toEqual({ b: "2" });
  });
  it("formats sizes and recognises csv files", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(isCsvFile({ name: "Data.CSV" })).toBe(true);
    expect(isCsvFile({ name: "x.txt", type: "text/csv" })).toBe(true);
    expect(isCsvFile({ name: "x.xlsx", type: "application/vnd.ms-excel" })).toBe(false);
  });
});
