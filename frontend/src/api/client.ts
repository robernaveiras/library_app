import type {
  Bookcase,
  BookcaseCreateInput,
  BookcaseUpdateInput,
  ConfigStatus,
  Shelf,
  ShelfCreateInput,
  ShelfUpdateInput,
} from "../types/library";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body?.detail)) {
        detail = body.detail.map((e: { msg?: string }) => e.msg ?? "Dato inválido").join(", ");
      }
    } catch {
      // ignore non-json error response
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  getConfigStatus: () => request<ConfigStatus>("/api/config/status"),

  listBookcases: () => request<Bookcase[]>("/api/bookcases"),

  createBookcase: (payload: BookcaseCreateInput) =>
    request<Bookcase>("/api/bookcases", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateBookcase: (id: number, payload: BookcaseUpdateInput) =>
    request<Bookcase>(`/api/bookcases/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteBookcase: (id: number) =>
    request<void>(`/api/bookcases/${id}`, {
      method: "DELETE",
    }),

  createShelf: (bookcaseId: number, payload: ShelfCreateInput) =>
    request<Shelf>(`/api/bookcases/${bookcaseId}/shelves`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateShelf: (shelfId: number, payload: ShelfUpdateInput) =>
    request<Shelf>(`/api/shelves/${shelfId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteShelf: (shelfId: number) =>
    request<void>(`/api/shelves/${shelfId}`, {
      method: "DELETE",
    }),

  reorderShelves: (bookcaseId: number, shelfIds: number[]) =>
    request<Bookcase>(`/api/bookcases/${bookcaseId}/shelves/reorder`, {
      method: "PUT",
      body: JSON.stringify({ shelf_ids: shelfIds }),
    }),
};
