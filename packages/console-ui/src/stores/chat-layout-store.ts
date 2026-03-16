/**
 * Chat layout store — manages split pane layout tree and pane→session mapping.
 * ADR-052 §2.1, §2.3, §2.4
 *
 * Uses a binary tree of SplitNode/LeafNode to represent flexible splits.
 * All state is JSON-serializable (Record, not Map) for Zustand persist.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SplitDirection = "horizontal" | "vertical";

export interface PaneState {
  id: string;
  sessionId: string | null;
}

export interface SplitNode {
  type: "split";
  direction: SplitDirection;
  ratio: number; // 0.0–1.0, position of the divider
  children: [LayoutNode, LayoutNode];
}

export interface LeafNode {
  type: "leaf";
  paneId: string;
}

export type LayoutNode = SplitNode | LeafNode;

const MAX_PANES = 4;

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/** Count the number of leaf panes in the layout tree. */
export function countLeaves(node: LayoutNode): number {
  if (node.type === "leaf") return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

/** Collect all pane IDs from the layout tree in left-to-right order. */
export function collectPaneIds(node: LayoutNode): string[] {
  if (node.type === "leaf") return [node.paneId];
  return [...collectPaneIds(node.children[0]), ...collectPaneIds(node.children[1])];
}

/** Replace a leaf with a split containing the original leaf + a new leaf. */
function splitLeaf(
  node: LayoutNode,
  targetPaneId: string,
  direction: SplitDirection,
  newPaneId: string,
): LayoutNode {
  if (node.type === "leaf") {
    if (node.paneId === targetPaneId) {
      return {
        type: "split",
        direction,
        ratio: 0.5,
        children: [
          { type: "leaf", paneId: targetPaneId },
          { type: "leaf", paneId: newPaneId },
        ],
      };
    }
    return node;
  }
  return {
    ...node,
    children: [
      splitLeaf(node.children[0], targetPaneId, direction, newPaneId),
      splitLeaf(node.children[1], targetPaneId, direction, newPaneId),
    ],
  };
}

/** Remove a leaf from the tree. Returns the sibling if the parent split becomes trivial. */
function removeLeaf(node: LayoutNode, targetPaneId: string): LayoutNode | null {
  if (node.type === "leaf") {
    return node.paneId === targetPaneId ? null : node;
  }
  const left = removeLeaf(node.children[0], targetPaneId);
  const right = removeLeaf(node.children[1], targetPaneId);
  if (left === null) return right;
  if (right === null) return left;
  return { ...node, children: [left, right] };
}

/** Update the split ratio at a given path (array of 0/1 child indices). */
function updateRatio(node: LayoutNode, path: number[], ratio: number): LayoutNode {
  if (path.length === 0 && node.type === "split") {
    return { ...node, ratio };
  }
  if (node.type === "leaf" || path.length === 0) return node;
  const [idx, ...rest] = path;
  if (idx === undefined || idx < 0 || idx > 1) return node;
  const children: [LayoutNode, LayoutNode] = [...node.children];
  const child = children[idx as 0 | 1];
  children[idx as 0 | 1] = updateRatio(child, rest, ratio);
  return { ...node, children };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface ChatLayoutState {
  layout: LayoutNode;
  panes: Record<string, PaneState>;
  focusedPaneId: string;

  // Actions
  splitPane(paneId: string, direction: SplitDirection): void;
  closePane(paneId: string): void;
  setSessionForPane(paneId: string, sessionId: string): void;
  setFocusedPane(paneId: string): void;
  setSplitRatio(splitNodePath: number[], ratio: number): void;
  resetLayout(): void;
  validateSessions(validSessionIds: Set<string>): void;
}

let paneCounter = 1;

function nextPaneId(): string {
  paneCounter += 1;
  return `pane-${paneCounter}`;
}

// ---------------------------------------------------------------------------
// Store factory — per-project (projectId is provided externally)
// ---------------------------------------------------------------------------

export function createChatLayoutStore(projectId: string) {
  return create<ChatLayoutState>()(
    persist(
      (set, get) => ({
        layout: { type: "leaf", paneId: "pane-1" } as LayoutNode,
        panes: { "pane-1": { id: "pane-1", sessionId: null } } as Record<string, PaneState>,
        focusedPaneId: "pane-1",

        splitPane: (paneId, direction) => {
          const { layout, panes } = get();
          if (countLeaves(layout) >= MAX_PANES) return;
          const newId = nextPaneId();
          const newLayout = splitLeaf(layout, paneId, direction, newId);
          set({
            layout: newLayout,
            panes: { ...panes, [newId]: { id: newId, sessionId: null } },
          });
        },

        closePane: (paneId) => {
          const { layout, panes, focusedPaneId } = get();
          if (countLeaves(layout) <= 1) return; // Can't close last pane
          const newLayout = removeLeaf(layout, paneId);
          if (!newLayout) return;
          const rest = Object.fromEntries(
            Object.entries(panes).filter(([id]) => id !== paneId),
          );
          const remainingIds = collectPaneIds(newLayout);
          const newFocused = remainingIds.includes(focusedPaneId)
            ? focusedPaneId
            : remainingIds[0] ?? "pane-1";
          set({ layout: newLayout, panes: rest, focusedPaneId: newFocused });
        },

        setSessionForPane: (paneId, sessionId) => {
          set((s) => ({
            panes: {
              ...s.panes,
              [paneId]: { ...s.panes[paneId]!, sessionId },
            },
          }));
        },

        setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

        setSplitRatio: (path, ratio) => {
          const clamped = Math.max(0.1, Math.min(0.9, ratio));
          set((s) => ({ layout: updateRatio(s.layout, path, clamped) }));
        },

        resetLayout: () => set({
          layout: { type: "leaf", paneId: "pane-1" },
          panes: { "pane-1": { id: "pane-1", sessionId: null } },
          focusedPaneId: "pane-1",
        }),

        validateSessions: (validSessionIds) => {
          set((s) => {
            const validated: Record<string, PaneState> = {};
            for (const [id, pane] of Object.entries(s.panes)) {
              validated[id] = {
                ...pane,
                sessionId: pane.sessionId && validSessionIds.has(pane.sessionId)
                  ? pane.sessionId
                  : null,
              };
            }
            return { panes: validated };
          });
        },
      }),
      {
        name: `renre-chat-layout:${projectId}`,
        partialize: (state) => ({
          layout: state.layout,
          panes: state.panes,
          // focusedPaneId excluded — transient
        }),
      },
    ),
  );
}

// ---------------------------------------------------------------------------
// Singleton store map — one store per project
// ---------------------------------------------------------------------------

const storeMap = new Map<string, ReturnType<typeof createChatLayoutStore>>();

export function useChatLayoutStore(projectId: string): ReturnType<typeof createChatLayoutStore> {
  let store = storeMap.get(projectId);
  if (!store) {
    store = createChatLayoutStore(projectId);
    storeMap.set(projectId, store);
  }
  return store;
}
