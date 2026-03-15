import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  BASE_URL: "http://localhost:42888",
}));

// Mock the socket store
vi.mock("../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ socket: { emit: vi.fn() } }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

import { apiGet, apiPost, apiPut, apiDelete } from "../api/client";
import { useObservationStore } from "./observation-store";
import type { Observation, ObservationFilter } from "./observation-store";

const mockApiGet = vi.mocked(apiGet);
const mockApiPost = vi.mocked(apiPost);
const mockApiPut = vi.mocked(apiPut);
const mockApiDelete = vi.mocked(apiDelete);

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1",
    projectId: "proj-1",
    content: "User prefers TypeScript",
    category: "preference",
    confidence: 0.9,
    source: "session",
    active: true,
    injectionCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultFilter: ObservationFilter = {
  category: undefined,
  confidence: undefined,
  source: undefined,
  showArchived: undefined,
};

describe("observation-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useObservationStore.setState({
      observations: [],
      loading: false,
      error: null,
      filter: { ...defaultFilter },
    });
  });

  describe("fetchObservations", () => {
    it("shows loading spinner on initial load", async () => {
      const observations = [makeObservation()];
      mockApiGet.mockResolvedValueOnce({ data: observations, error: null, status: 200 });

      const promise = useObservationStore.getState().fetchObservations("proj-1");

      // loading should be true during fetch (initial load with empty observations)
      expect(useObservationStore.getState().loading).toBe(true);

      await promise;

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/observations?active=false");
      expect(useObservationStore.getState().observations).toEqual(observations);
      expect(useObservationStore.getState().loading).toBe(false);
      expect(useObservationStore.getState().error).toBeNull();
    });

    it("does not show loading spinner on refetch", async () => {
      useObservationStore.setState({ observations: [makeObservation()] });
      const observations = [makeObservation(), makeObservation({ id: "obs-2" })];
      mockApiGet.mockResolvedValueOnce({ data: observations, error: null, status: 200 });

      const promise = useObservationStore.getState().fetchObservations("proj-1");

      // loading should NOT be true on refetch (observations already present)
      expect(useObservationStore.getState().loading).toBe(false);

      await promise;

      expect(useObservationStore.getState().observations).toEqual(observations);
    });

    it("sets error on failure", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Server error", status: 500 });

      await useObservationStore.getState().fetchObservations("proj-1");

      expect(useObservationStore.getState().error).toBe("Server error");
      expect(useObservationStore.getState().loading).toBe(false);
    });
  });

  describe("createObservation", () => {
    it("prepends new observation to list", async () => {
      const existing = makeObservation({ id: "obs-1" });
      useObservationStore.setState({ observations: [existing] });

      const created = makeObservation({ id: "obs-2", content: "New observation" });
      mockApiPost.mockResolvedValueOnce({ data: created, error: null, status: 201 });

      await useObservationStore.getState().createObservation("proj-1", {
        content: "New observation",
        category: "preference",
      });

      expect(mockApiPost).toHaveBeenCalledWith("/api/proj-1/observations", {
        content: "New observation",
        category: "preference",
      });
      const observations = useObservationStore.getState().observations;
      expect(observations).toHaveLength(2);
      expect(observations[0]!.id).toBe("obs-2");
    });

    it("does not update list on API failure", async () => {
      useObservationStore.setState({ observations: [makeObservation()] });
      mockApiPost.mockResolvedValueOnce({ data: null, error: "Validation failed", status: 400 });

      await useObservationStore.getState().createObservation("proj-1", {
        content: "Bad",
        category: "x",
      });

      expect(useObservationStore.getState().observations).toHaveLength(1);
    });
  });

  describe("updateObservation", () => {
    it("replaces observation in list", async () => {
      useObservationStore.setState({
        observations: [makeObservation({ id: "obs-1", content: "Old content" })],
      });
      const updated = makeObservation({ id: "obs-1", content: "Updated content" });
      mockApiPut.mockResolvedValueOnce({ data: updated, error: null, status: 200 });

      await useObservationStore.getState().updateObservation("proj-1", "obs-1", {
        content: "Updated content",
      });

      expect(mockApiPut).toHaveBeenCalledWith("/api/proj-1/observations/obs-1", {
        content: "Updated content",
      });
      expect(useObservationStore.getState().observations[0]!.content).toBe("Updated content");
    });

    it("does not update on API failure", async () => {
      useObservationStore.setState({
        observations: [makeObservation({ id: "obs-1", content: "Original" })],
      });
      mockApiPut.mockResolvedValueOnce({ data: null, error: "Not found", status: 404 });

      await useObservationStore.getState().updateObservation("proj-1", "obs-1", {
        content: "Changed",
      });

      expect(useObservationStore.getState().observations[0]!.content).toBe("Original");
    });
  });

  describe("deleteObservation", () => {
    it("removes observation from list", async () => {
      useObservationStore.setState({
        observations: [makeObservation({ id: "obs-1" }), makeObservation({ id: "obs-2" })],
      });
      mockApiDelete.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 204 });

      await useObservationStore.getState().deleteObservation("proj-1", "obs-1");

      expect(mockApiDelete).toHaveBeenCalledWith("/api/proj-1/observations/obs-1");
      const observations = useObservationStore.getState().observations;
      expect(observations).toHaveLength(1);
      expect(observations[0]!.id).toBe("obs-2");
    });

    it("does not remove on API failure", async () => {
      useObservationStore.setState({
        observations: [makeObservation({ id: "obs-1" })],
      });
      mockApiDelete.mockResolvedValueOnce({ data: null, error: "Forbidden", status: 403 });

      await useObservationStore.getState().deleteObservation("proj-1", "obs-1");

      expect(useObservationStore.getState().observations).toHaveLength(1);
    });
  });

  describe("setFilter", () => {
    it("merges partial filter", () => {
      useObservationStore.getState().setFilter({ category: "preference" });

      expect(useObservationStore.getState().filter.category).toBe("preference");
      expect(useObservationStore.getState().filter.confidence).toBeUndefined();
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      useObservationStore.setState({
        observations: [makeObservation()],
        loading: true,
        error: "some error",
        filter: { category: "preference", confidence: "high", source: "session", showArchived: true },
      });

      useObservationStore.getState().reset();

      const state = useObservationStore.getState();
      expect(state.observations).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.filter).toEqual(defaultFilter);
    });
  });
});
