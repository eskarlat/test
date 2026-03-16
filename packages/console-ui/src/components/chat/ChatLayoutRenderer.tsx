/**
 * ChatLayoutRenderer — recursively renders LayoutNode tree into nested
 * SplitContainer + ChatPane components.
 * ADR-052 §2.3
 */

import { useCallback } from "react";
import type { LayoutNode, PaneState } from "../../stores/chat-layout-store";
import { SplitContainer } from "./SplitContainer";
import { ChatPane } from "./ChatPane";

interface ChatLayoutRendererProps {
  node: LayoutNode;
  panes: Record<string, PaneState>;
  focusedPaneId: string;
  /** Path from root to current node (indices into children arrays) */
  path: number[];
  onSplitRatio: (path: number[], ratio: number) => void;
  onFocusPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onSessionChange: (paneId: string, sessionId: string) => void;
  canClose: boolean;
}

export function ChatLayoutRenderer({
  node,
  panes,
  focusedPaneId,
  path,
  onSplitRatio,
  onFocusPane,
  onClosePane,
  onSessionChange,
  canClose,
}: ChatLayoutRendererProps) {
  if (node.type === "leaf") {
    const pane = panes[node.paneId];
    return (
      <ChatPane
        paneId={node.paneId}
        sessionId={pane?.sessionId ?? null}
        isFocused={focusedPaneId === node.paneId}
        canClose={canClose}
        onFocus={() => onFocusPane(node.paneId)}
        onClose={() => onClosePane(node.paneId)}
        onSessionChange={(sid) => onSessionChange(node.paneId, sid)}
      />
    );
  }

  // Split node — render a SplitContainer with two recursive children
  const handleRatioChange = useCallback(
    (ratio: number) => onSplitRatio(path, ratio),
    [path, onSplitRatio],
  );

  return (
    <SplitContainer
      direction={node.direction}
      ratio={node.ratio}
      onRatioChange={handleRatioChange}
    >
      <ChatLayoutRenderer
        node={node.children[0]}
        panes={panes}
        focusedPaneId={focusedPaneId}
        path={[...path, 0]}
        onSplitRatio={onSplitRatio}
        onFocusPane={onFocusPane}
        onClosePane={onClosePane}
        onSessionChange={onSessionChange}
        canClose={canClose}
      />
      <ChatLayoutRenderer
        node={node.children[1]}
        panes={panes}
        focusedPaneId={focusedPaneId}
        path={[...path, 1]}
        onSplitRatio={onSplitRatio}
        onFocusPane={onFocusPane}
        onClosePane={onClosePane}
        onSessionChange={onSessionChange}
        canClose={canClose}
      />
    </SplitContainer>
  );
}
