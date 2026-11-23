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
