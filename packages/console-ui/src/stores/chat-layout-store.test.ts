import { describe, it, expect, beforeEach } from "vitest";
import { createChatLayoutStore, countLeaves, collectPaneIds, type LayoutNode } from "./chat-layout-store";

let testId = 0;

describe("chat-layout-store", () => {
  let store: ReturnType<typeof createChatLayoutStore>;

  beforeEach(() => {
    testId++;
    store = createChatLayoutStore(`test-project-${testId}`);
  });

  describe("initial state", () => {
    it("starts with a single pane", () => {
      const s = store.getState();
      expect(s.layout).toEqual({ type: "leaf", paneId: "pane-1" });
      expect(Object.keys(s.panes)).toEqual(["pane-1"]);
      expect(s.focusedPaneId).toBe("pane-1");
    });
  });

  describe("countLeaves", () => {
    it("counts a single leaf", () => {
      expect(countLeaves({ type: "leaf", paneId: "p1" })).toBe(1);
    });

    it("counts split with two leaves", () => {
      const node: LayoutNode = {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        children: [
          { type: "leaf", paneId: "p1" },
          { type: "leaf", paneId: "p2" },
        ],
      };
      expect(countLeaves(node)).toBe(2);
    });

    it("counts nested splits", () => {
      const node: LayoutNode = {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        children: [
          {
            type: "split",
            direction: "horizontal",
            ratio: 0.5,
            children: [
              { type: "leaf", paneId: "p1" },
              { type: "leaf", paneId: "p2" },
            ],
          },
          { type: "leaf", paneId: "p3" },
        ],
      };
      expect(countLeaves(node)).toBe(3);
    });
  });

  describe("collectPaneIds", () => {
    it("collects from single leaf", () => {
      expect(collectPaneIds({ type: "leaf", paneId: "p1" })).toEqual(["p1"]);
    });

    it("collects in order from split", () => {
      const node: LayoutNode = {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        children: [
          { type: "leaf", paneId: "p1" },
          { type: "leaf", paneId: "p2" },
        ],
      };
      expect(collectPaneIds(node)).toEqual(["p1", "p2"]);
    });
  });

  describe("splitPane", () => {
    it("splits the focused pane vertically", () => {
      store.getState().splitPane("pane-1", "vertical");
      const s = store.getState();
      expect(s.layout.type).toBe("split");
      expect(countLeaves(s.layout)).toBe(2);
      expect(Object.keys(s.panes).length).toBe(2);
    });

    it("splits again to create 3 panes", () => {
      store.getState().splitPane("pane-1", "vertical");
      const ids = collectPaneIds(store.getState().layout);
      store.getState().splitPane(ids[1]!, "horizontal");
      expect(countLeaves(store.getState().layout)).toBe(3);
    });

    it("respects max 4 panes", () => {
      store.getState().splitPane("pane-1", "vertical");
      let ids = collectPaneIds(store.getState().layout);
      store.getState().splitPane(ids[0]!, "horizontal");
      ids = collectPaneIds(store.getState().layout);
      store.getState().splitPane(ids[0]!, "vertical");
      expect(countLeaves(store.getState().layout)).toBe(4);

      // 5th split should be no-op
      ids = collectPaneIds(store.getState().layout);
      store.getState().splitPane(ids[0]!, "vertical");
      expect(countLeaves(store.getState().layout)).toBe(4);
    });
  });

  describe("closePane", () => {
    it("does not close the last pane", () => {
      store.getState().closePane("pane-1");
      expect(countLeaves(store.getState().layout)).toBe(1);
    });

    it("closes a pane from a split", () => {
      store.getState().splitPane("pane-1", "vertical");
      const ids = collectPaneIds(store.getState().layout);
      const newPaneId = ids[1]!;
      store.getState().closePane(newPaneId);
      expect(countLeaves(store.getState().layout)).toBe(1);
      // Only pane-1 remains
      const remainingIds = collectPaneIds(store.getState().layout);
      expect(remainingIds).toEqual(["pane-1"]);
    });

    it("updates focus when focused pane is closed", () => {
      store.getState().splitPane("pane-1", "vertical");
      const ids = collectPaneIds(store.getState().layout);
      const newPaneId = ids[1]!;
      store.getState().setFocusedPane(newPaneId);
      store.getState().closePane(newPaneId);
      // Focus should move to a remaining pane
      const remaining = collectPaneIds(store.getState().layout);
      expect(remaining).toContain(store.getState().focusedPaneId);
    });
  });

  describe("setSessionForPane", () => {
    it("assigns a session to a pane", () => {
      store.getState().setSessionForPane("pane-1", "session-abc");
      expect(store.getState().panes["pane-1"]?.sessionId).toBe("session-abc");
    });
  });

  describe("setSplitRatio", () => {
    it("updates the ratio of a split", () => {
      store.getState().splitPane("pane-1", "vertical");
      const layout = store.getState().layout;
      expect(layout.type).toBe("split");
      store.getState().setSplitRatio([], 0.7);
      const updated = store.getState().layout;
      expect(updated.type).toBe("split");
      if (updated.type === "split") {
        expect(updated.ratio).toBe(0.7);
      }
    });

    it("clamps ratio to [0.1, 0.9]", () => {
      store.getState().splitPane("pane-1", "vertical");
      store.getState().setSplitRatio([], 0.05);
      const layout = store.getState().layout;
      if (layout.type === "split") {
        expect(layout.ratio).toBe(0.1);
      }
    });
  });

  describe("resetLayout", () => {
    it("resets to single pane", () => {
      store.getState().splitPane("pane-1", "vertical");
      store.getState().resetLayout();
      expect(store.getState().layout).toEqual({ type: "leaf", paneId: "pane-1" });
      expect(Object.keys(store.getState().panes)).toEqual(["pane-1"]);
    });
  });

  describe("validateSessions", () => {
    it("nullifies invalid session IDs", () => {
      store.getState().setSessionForPane("pane-1", "session-abc");
      store.getState().validateSessions(new Set(["session-xyz"]));
      expect(store.getState().panes["pane-1"]?.sessionId).toBeNull();
    });

    it("keeps valid session IDs", () => {
      store.getState().setSessionForPane("pane-1", "session-abc");
      store.getState().validateSessions(new Set(["session-abc"]));
      expect(store.getState().panes["pane-1"]?.sessionId).toBe("session-abc");
    });
  });
});
