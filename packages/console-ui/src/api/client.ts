import { useConnectionStore } from "../stores/connection-store";

// Auto-detect worker port from current URL origin (since worker serves the SPA),
// or default to 42888 in dev mode.
function getWorkerBaseUrl(): string {
  if (typeof window !== "undefined") {
    const { port, hostname, protocol } = window.location;
    // If running on a non-standard port (e.g. 5173 in dev), fall back to 42888
    if (port === "5173" || port === "3000") {
      return "http://localhost:42888";
    }
    if (port) {
      return `${protocol}//${hostname}:${port}`;
    }
    return `${protocol}//${hostname}`;
  }
  return "http://localhost:42888";
}

export const BASE_URL = getWorkerBaseUrl();

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

async function handleResponse<T>(response: Response): Promise<ApiResponse<T>> {
  if (response.ok) {
    useConnectionStore.getState().setStatus("connected");
    try {
      const data = (await response.json()) as T;
      return { data, error: null, status: response.status };
    } catch {
      return { data: null, error: "Invalid JSON response", status: response.status };
    }
  }

  if (response.status === 503) {
    useConnectionStore.getState().setStatus("disconnected");
    return { data: null, error: "Server unavailable", status: 503 };
  }

  const text = await response.text().catch(() => "Unknown error");
  return { data: null, error: text, status: response.status };
}

async function executeFetch<T>(url: string, init: RequestInit): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(url, init);
    useConnectionStore.getState().setStatus("connected");
    return handleResponse<T>(response);
  } catch (err) {
    useConnectionStore.getState().setStatus("disconnected");
    return {
      data: null,
      error: err instanceof Error ? err.message : "Connection refused",
      status: 0,
    };
  }
}

export function apiGet<T>(path: string): Promise<ApiResponse<T>> {
  return executeFetch<T>(`${BASE_URL}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
}

export function apiPost<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  return executeFetch<T>(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  return executeFetch<T>(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<ApiResponse<T>> {
  return executeFetch<T>(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
}
