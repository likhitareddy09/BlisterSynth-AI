import { activeBands, column, formatTime, formatValue, linePath, valueRange } from "./chart";

describe("valueRange", () => {
  it("pads the min/max of finite values", () => {
    const [lo, hi] = valueRange([[0, 10, null]]);
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(10);
  });
  it("handles empty and flat series", () => {
    expect(valueRange([[]])).toEqual([0, 1]);
    expect(valueRange([[5, 5]])).toEqual([4, 6]);
  });
});

describe("linePath", () => {
  it("breaks the line at missing values", () => {
    const d = linePath([0, 1, 2, 3], [1, null, 2, 3], 100, 100, [0, 3], [0, 4]);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/L/g)).toHaveLength(1);
  });
  it("returns an empty path for no data", () => {
    expect(linePath([0, 1], [null, NaN], 100, 100, [0, 1], [0, 1])).toBe("");
  });
});

describe("activeBands", () => {
  it("finds contiguous active spans, including one that runs to the end", () => {
    expect(activeBands([0, 1, 2, 3, 4, 5], [0, 1, 1, 0, 1, 1])).toEqual([[1, 2], [4, 5]]);
  });
  it("is empty when nothing is active", () => {
    expect(activeBands([0, 1], [0, null])).toEqual([]);
  });
});

describe("formatting", () => {
  it("formats times", () => {
    expect(formatTime(45)).toBe("45s");
    expect(formatTime(125)).toBe("2m05s");
    expect(formatTime(3725)).toBe("1h02m");
    expect(formatTime(-5)).toBe("0s");
  });
  it("formats values safely", () => {
    expect(formatValue(1.2345, 2)).toBe("1.23");
    expect(formatValue(null)).toBe("-");
    expect(formatValue(NaN)).toBe("-");
  });
  it("extracts numeric columns", () => {
    expect(column([{ a: 1 }, { a: "x" }, {}], "a")).toEqual([1, null, null]);
  });
});
