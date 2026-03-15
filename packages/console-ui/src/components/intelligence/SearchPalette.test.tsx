import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

vi.mock("../../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: [], error: null, status: 200 }),
  BASE_URL: "http://localhost:42888",
}));

import { SearchPalette } from "./SearchPalette";

function renderPalette(projectId: string | null = "proj-1") {
  return render(
    <MemoryRouter>
      <SearchPalette projectId={projectId} />
    </MemoryRouter>,
  );
}

describe("SearchPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no projectId", () => {
    const { container } = renderPalette(null);
    expect(container.innerHTML).toBe("");
  });

  it("renders search button", () => {
    renderPalette();
    expect(screen.getByLabelText("Search (Cmd+K)")).toBeTruthy();
  });

  it("opens palette on button click", () => {
    renderPalette();
    fireEvent.click(screen.getByLabelText("Search (Cmd+K)"));
    expect(screen.getByPlaceholderText("Search sessions, observations, prompts...")).toBeTruthy();
    expect(screen.getByText("Start typing to search")).toBeTruthy();
  });

  it("opens palette with Cmd+K", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText("Search sessions, observations, prompts...")).toBeTruthy();
  });

  it("closes palette with Escape", () => {
    renderPalette();
    fireEvent.click(screen.getByLabelText("Search (Cmd+K)"));
    expect(screen.getByPlaceholderText("Search sessions, observations, prompts...")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Search sessions, observations, prompts...")).toBeNull();
  });

  it("shows 'View all results' link when user types", async () => {
    renderPalette();
    fireEvent.click(screen.getByLabelText("Search (Cmd+K)"));
    const input = screen.getByPlaceholderText("Search sessions, observations, prompts...");
    fireEvent.change(input, { target: { value: "test query" } });
    // The "View all results" link should appear immediately since query is not empty
    expect(screen.getByText("View all results →")).toBeTruthy();
  });
});
