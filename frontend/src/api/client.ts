import type {
  AICategorizeResponse,
  AISuggestResponse,
  BatchEnrichResponse,
  Book,
  Bookcase,
  BookcaseCreateInput,
  BookcaseUpdateInput,
  BookCreateInput,
  BookListParams,
  BookUpdateInput,
  ConfigStatus,
  ConfirmScanBookItem,
  ConfirmScanResponse,
  EnrichBookResponse,
  InventoryStats,
  IsbnLookupResult,
  OrganizationCriteria,
  OrganizationPreviewResponse,
  PlanDetail,
  PlanSummary,
  ProviderModelsResponse,
  Shelf,
  ShelfBook,
  ShelfCreateInput,
  ShelfScan,
  ShelfScanSummary,
  ShelfUpdateInput,
  Tag,
  TagCreateInput,
  TagEvaluationResponse,
  TagUpdateInput,
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

  listProviderModels: (provider: string) =>
    request<ProviderModelsResponse>(
      `/api/config/models?provider=${encodeURIComponent(provider)}`
    ),

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

  uploadShelfScan: async (
    shelfId: number,
    file: File,
    provider?: string,
    model?: string
  ): Promise<ShelfScan> => {
    const formData = new FormData();
    formData.append("file", file);
    if (provider) {
      formData.append("provider", provider);
    }
    if (model && model.trim()) {
      formData.append("model", model.trim());
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

  getInventoryStats: () => request<InventoryStats>("/api/books/stats"),

  listBooks: (params?: BookListParams) => {
    const sp = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") {
          sp.set(k, String(v));
        }
      }
    }
    const qs = sp.toString();
    return request<Book[]>(`/api/books${qs ? `?${qs}` : ""}`);
  },

  createBook: (payload: BookCreateInput) =>
    request<Book>("/api/books", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateBook: (bookId: number, payload: BookUpdateInput) =>
    request<Book>(`/api/books/${bookId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteBook: (bookId: number) =>
    request<void>(`/api/books/${bookId}`, {
      method: "DELETE",
    }),

  enrichBook: (bookId: number, overwrite = false) =>
    request<EnrichBookResponse>(`/api/books/${bookId}/enrich`, {
      method: "POST",
      body: JSON.stringify({ overwrite }),
    }),

  enrichBooksBatch: (options?: { book_ids?: number[]; only_missing?: boolean; overwrite?: boolean }) =>
    request<BatchEnrichResponse>("/api/books/enrich-batch", {
      method: "POST",
      body: JSON.stringify({
        only_missing: true,
        overwrite: false,
        ...(options ?? {}),
      }),
    }),

  listTags: () => request<Tag[]>("/api/tags"),

  createTag: (payload: TagCreateInput) =>
    request<Tag>("/api/tags", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateTag: (tagId: number, payload: TagUpdateInput) =>
    request<Tag>(`/api/tags/${tagId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteTag: (tagId: number) =>
    request<void>(`/api/tags/${tagId}`, {
      method: "DELETE",
    }),

  listTagBookIds: (tagId: number) => request<number[]>(`/api/tags/${tagId}/books`),

  assignTagBooks: (
    tagId: number,
    payload: {
      add_book_ids?: number[];
      remove_book_ids?: number[];
      source?: "manual" | "ai_confirmed";
    }
  ) =>
    request<Tag>(`/api/tags/${tagId}/assign`, {
      method: "POST",
      body: JSON.stringify({
        add_book_ids: payload.add_book_ids ?? [],
        remove_book_ids: payload.remove_book_ids ?? [],
        source: payload.source ?? "manual",
      }),
    }),

  setBookTags: (bookId: number, tagIds: number[]) =>
    request<Book>(`/api/books/${bookId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tag_ids: tagIds }),
    }),

  evaluateTagWithAi: (
    tagId: number,
    options?: {
      provider?: string;
      model?: string;
      rule_override?: string;
      auto_apply?: boolean;
    }
  ) =>
    request<TagEvaluationResponse>(`/api/tags/${tagId}/evaluate`, {
      method: "POST",
      body: JSON.stringify({
        auto_apply: false,
        ...(options ?? {}),
      }),
    }),

  categorizeBooksWithAi: (options?: {
    provider?: string;
    model?: string;
    only_missing?: boolean;
    overwrite?: boolean;
  }) =>
    request<AICategorizeResponse>("/api/books/categorize-ai", {
      method: "POST",
      body: JSON.stringify({
        only_missing: true,
        overwrite: false,
        ...(options ?? {}),
      }),
    }),

  suggestOrganization: (options?: { provider?: string; model?: string; user_goal?: string }) =>
    request<AISuggestResponse>("/api/organization/suggest", {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    }),

  previewOrganization: (criteria: OrganizationCriteria) =>
    request<OrganizationPreviewResponse>("/api/organization/preview", {
      method: "POST",
      body: JSON.stringify(criteria),
    }),

  listOrganizationPlans: () => request<PlanSummary[]>("/api/organization/plans"),

  createOrganizationPlan: (payload: {
    name?: string;
    description?: string | null;
    criteria: OrganizationCriteria;
  }) =>
    request<PlanDetail>("/api/organization/plans", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getOrganizationPlan: (planId: number) =>
    request<PlanDetail>(`/api/organization/plans/${planId}`),

  updatePlanStepProgress: (planId: number, stepId: string, done: boolean) =>
    request<PlanDetail>(`/api/organization/plans/${planId}/steps`, {
      method: "PATCH",
      body: JSON.stringify({ step_id: stepId, done }),
    }),

  applyOrganizationPlan: (planId: number) =>
    request<PlanDetail>(`/api/organization/plans/${planId}/apply`, {
      method: "POST",
    }),

  deleteOrganizationPlan: (planId: number) =>
    request<void>(`/api/organization/plans/${planId}`, {
      method: "DELETE",
    }),
};
