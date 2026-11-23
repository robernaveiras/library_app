export interface Shelf {
  id: number;
  bookcase_id: number;
  label: string;
  position_index: number;
  width_cm: number;
  height_cm: number;
  depth_cm: number | null;
  notes: string | null;
  book_count: number;
  used_width_cm: number;
  created_at: string;
  updated_at: string;
}

export interface Bookcase {
  id: number;
  name: string;
  location: string | null;
  notes: string | null;
  shelves: Shelf[];
  total_books: number;
  total_width_cm: number;
  created_at: string;
  updated_at: string;
}

export interface QuickShelfConfig {
  count: number;
  width_cm: number;
  height_cm: number;
  depth_cm?: number | null;
}

export interface BookcaseCreateInput {
  name: string;
  location?: string | null;
  notes?: string | null;
  initial_shelves?: QuickShelfConfig | null;
}

export interface BookcaseUpdateInput {
  name?: string;
  location?: string | null;
  notes?: string | null;
}

export interface ShelfCreateInput {
  label: string;
  width_cm: number;
  height_cm: number;
  depth_cm?: number | null;
  notes?: string | null;
  position_index?: number;
}

export interface ShelfUpdateInput {
  label?: string;
  width_cm?: number;
  height_cm?: number;
  depth_cm?: number | null;
  notes?: string | null;
  position_index?: number;
}

export interface AIProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  model: string;
}

export interface ConfigStatus {
  default_provider: string;
  providers: AIProviderStatus[];
  google_books_api_key_configured: boolean;
}

export type ReadingStatus = "unknown" | "unread" | "reading" | "read";
export type BookOrientation = "vertical" | "horizontal";

export interface DetectedBookCandidate {
  position_index: number;
  title: string;
  authors: string[];
  publisher: string | null;
  language: string | null;
  orientation: BookOrientation;
  confidence: number;
  notes: string | null;
  bbox: number[] | null;
}

export interface ShelfScan {
  id: number;
  shelf_id: number;
  image_url: string;
  ai_provider: string;
  ai_model: string;
  status: string;
  candidates: DetectedBookCandidate[];
  created_at: string;
}

export interface ShelfScanSummary {
  id: number;
  shelf_id: number;
  image_url: string;
  ai_provider: string;
  ai_model: string;
  status: string;
  candidate_count: number;
  created_at: string;
}

export interface ConfirmScanBookItem {
  title: string;
  subtitle?: string | null;
  authors: string[];
  publisher?: string | null;
  published_year?: number | null;
  language?: string | null;
  isbn_10?: string | null;
  isbn_13?: string | null;
  page_count?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  dimensions_source?: string | null;
  cover_url?: string | null;
  synopsis?: string | null;
  reading_status: ReadingStatus;
  orientation: BookOrientation;
  row_depth?: number;
  confidence?: number | null;
  bbox?: number[] | null;
}

export interface ShelfBook {
  book_id: number;
  placement_id: number;
  shelf_id: number;
  position_index: number;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  published_year: number | null;
  language: string | null;
  isbn_10: string | null;
  isbn_13: string | null;
  page_count: number | null;
  width_mm: number | null;
  height_mm: number | null;
  dimensions_source: string | null;
  cover_url: string | null;
  reading_status: ReadingStatus;
  orientation: BookOrientation;
  confidence: number | null;
}

export interface ConfirmScanResponse {
  scan_id: number;
  shelf_id: number;
  confirmed_count: number;
  books: ShelfBook[];
}

export interface IsbnLookupResult {
  isbn: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  published_year: number | null;
  language: string | null;
  isbn_10: string | null;
  isbn_13: string | null;
  page_count: number | null;
  width_mm: number | null;
  height_mm: number | null;
  dimensions_source: string | null;
  cover_url: string | null;
  synopsis: string | null;
  source: string;
}
