import type {
  Bookcase,
  BookcaseCreateInput,
  BookcaseUpdateInput,
  ConfigStatus,
  ConfirmScanBookItem,
  ConfirmScanResponse,
  IsbnLookupResult,
  Shelf,
  ShelfBook,
  ShelfCreateInput,
  ShelfScan,
  ShelfScanSummary,
  ShelfUpdateInput,
} from "../types/library";

async function parseError(response: Response): Promise<string> {
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
  return detail;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
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

  uploadShelfScan: async (shelfId: number, file: File, provider?: string): Promise<ShelfScan> => {
    const formData = new FormData();
    formData.append("file", file);
    if (provider) {
      formData.append("provider", provider);
    }
    const response = await fetch(`/api/shelves/${shelfId}/scans`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return (await response.json()) as ShelfScan;
  },

  listShelfScans: (shelfId: number) =>
    request<ShelfScanSummary[]>(`/api/shelves/${shelfId}/scans`),

  getScan: (scanId: number) => request<ShelfScan>(`/api/scans/${scanId}`),

  deleteScan: (scanId: number) =>
    request<void>(`/api/scans/${scanId}`, {
      method: "DELETE",
    }),

  confirmScan: (scanId: number, replaceExisting: boolean, books: ConfirmScanBookItem[]) =>
    request<ConfirmScanResponse>(`/api/scans/${scanId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        replace_existing: replaceExisting,
        books,
      }),
    }),

  listShelfBooks: (shelfId: number) => request<ShelfBook[]>(`/api/shelves/${shelfId}/books`),

  lookupIsbn: (isbn: string) =>
    request<IsbnLookupResult>(`/api/isbn/${encodeURIComponent(isbn.trim())}`),
};
