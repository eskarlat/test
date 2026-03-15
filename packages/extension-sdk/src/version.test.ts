import { describe, it, expect } from "vitest";
import { SDK_VERSION } from "./version.js";

describe("extension-sdk", () => {
  it("exports SDK_VERSION as a valid semver string", () => {
    expect(SDK_VERSION).toBe("0.1.0");
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
