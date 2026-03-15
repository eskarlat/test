import { describe, it, expect, beforeEach } from "vitest";
import { getServerPort, setServerPort } from "./server-port.js";

describe("server-port", () => {
  beforeEach(() => {
    // Reset to default
    setServerPort(42888);
  });

  it("default port is 42888", () => {
    expect(getServerPort()).toBe(42888);
  });

  it("setServerPort changes the port", () => {
    setServerPort(3000);
    expect(getServerPort()).toBe(3000);
  });

  it("getServerPort returns the most recently set value", () => {
    setServerPort(8080);
    setServerPort(9090);
    expect(getServerPort()).toBe(9090);
  });

  it("can set port to any of the fallback range", () => {
    for (const port of [42888, 42889, 42890, 42898]) {
      setServerPort(port);
      expect(getServerPort()).toBe(port);
    }
  });
});
