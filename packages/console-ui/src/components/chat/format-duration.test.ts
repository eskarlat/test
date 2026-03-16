import { describe, it, expect } from "vitest";
import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it("formats sub-second durations as milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(1)).toBe("1ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats durations under a minute as seconds with one decimal", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(30000)).toBe("30.0s");
    expect(formatDuration(59999)).toBe("60.0s");
  });

  it("formats durations of a minute or more as minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(90000)).toBe("1m 30s");
    expect(formatDuration(120000)).toBe("2m 0s");
    expect(formatDuration(125000)).toBe("2m 5s");
    expect(formatDuration(3661000)).toBe("61m 1s");
  });
});
