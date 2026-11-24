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
  suggested_models: string[];
}

export interface ProviderModelOption {
  id: string;
  display_name?: string | null;
}

export interface ProviderModelsResponse {
  provider: string;
  ok: boolean;
  models: ProviderModelOption[];
  error?: string | null;
}

export interface AISelection {
  provider: string;
  model: string;
}

export interface ConfigStatus {
  default_provider: string;
  providers: AIProviderStatus[];
  google_books_api_key_configured: boolean;
}

export type ReadingStatus = "unknown" | "unread" | "reading" | "read";
export type BookOrientation = "vertical" | "horizontal";
export type EnrichmentStatus = "enriched" | "pending" | "not_found";

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

export interface BookTagBrief {
  id: number;
  name: string;
  color_hex: string;
  source: string;
}

export interface BookPlacementInfo {
  placement_id: number;
  bookcase_id: number;
  bookcase_name: string;
  shelf_id: number;
  shelf_label: string;
  position_index: number;
  orientation: BookOrientation;
  row_depth: number;
  confidence: number | null;
}

export interface Book {
  id: number;
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
  genre: string | null;
  subgenre: string | null;
  series_name: string | null;
  series_index: number | null;
  reading_status: ReadingStatus;
  extra_attributes: Record<string, unknown>;
  placement: BookPlacementInfo | null;
  tags: BookTagBrief[];
  enrichment_status: EnrichmentStatus;
  needs_enrichment: boolean;
  created_at: string;
  updated_at: string;
}

export interface BookCreateInput {
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
  genre?: string | null;
  subgenre?: string | null;
  series_name?: string | null;
  series_index?: number | null;
  reading_status: ReadingStatus;
  shelf_id?: number | null;
  orientation?: BookOrientation;
}

export interface BookUpdateInput {
  title?: string;
  subtitle?: string | null;
  authors?: string[];
  publisher?: string | null;
  published_year?: number | null;
  language?: string | null;
  isbn_10?: string | null;
  isbn_13?: string | null;
  page_count?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  cover_url?: string | null;
  synopsis?: string | null;
  genre?: string | null;
  subgenre?: string | null;
  series_name?: string | null;
  series_index?: number | null;
  reading_status?: ReadingStatus;
  shelf_id?: number | null;
  orientation?: BookOrientation;
}

export interface EnrichBookResponse {
  book: Book;
  matched: boolean;
  source: string | null;
  updated_fields: string[];
}

export interface BatchEnrichResponse {
  processed: number;
  enriched: number;
  not_found: number;
  skipped: number;
  errors: number;
}

export interface InventoryStats {
  total_books: number;
  placed_books: number;
  enriched_books: number;
  needs_enrichment_count: number;
  not_found_enrichment_count: number;
  unread_count: number;
  reading_count: number;
  read_count: number;
  estimated_linear_meters: number;
  languages: string[];
  genres: string[];
}

export interface BookListParams {
  q?: string;
  bookcase_id?: number;
  shelf_id?: number;
  reading_status?: string;
  genre?: string;
  language?: string;
  tag_id?: number;
  enrichment?: "all" | "enriched" | "pending" | "not_found" | "missing_metadata";
  sort_by?: "location" | "title" | "author" | "year" | "pages" | "created_at";
  sort_dir?: "asc" | "desc";
}

export interface Tag {
  id: number;
  name: string;
  description: string | null;
  color_hex: string;
  ai_rule_prompt: string | null;
  book_count: number;
  created_at: string;
}

export interface TagCreateInput {
  name: string;
  description?: string | null;
  color_hex: string;
  ai_rule_prompt?: string | null;
}

export interface TagUpdateInput {
  name?: string;
  description?: string | null;
  color_hex?: string;
  ai_rule_prompt?: string | null;
}

export interface TagMatchProposal {
  book_id: number;
  title: string;
  authors: string[];
  confidence: number;
  reason: string | null;
  already_assigned: boolean;
}

export interface TagEvaluationResponse {
  tag_id: number;
  tag_name: string;
  rule_used: string;
  ai_provider: string;
  ai_model: string;
  evaluated_books: number;
  proposals: TagMatchProposal[];
  applied_count: number;
}

export interface AICategorizeResponse {
  ai_provider: string;
  ai_model: string;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  genres_summary: Record<string, number>;
}

export type SortField =
  | "reading_status"
  | "tag"
  | "genre"
  | "subgenre"
  | "language"
  | "author"
  | "series"
  | "title"
  | "published_year"
  | "publisher"
  | "height"
  | "pages"
  | "fiction_vs_nonfiction";

export interface SortRule {
  field: SortField;
  direction: "asc" | "desc";
  tag_id?: number | null;
  priority_value?: string | null;
}

export interface DedicatedSectionRule {
  label: string;
  match_type: "reading_status" | "tag" | "genre" | "language";
  match_value: string;
  target_bookcase_id?: number | null;
  target_shelf_id?: number | null;
  placement_order: "first" | "last";
}

export type PackMode = "balanced" | "compact" | "per_bookcase";

export interface OrganizationCriteria {
  name: string;
  description?: string | null;
  dedicated_sections: DedicatedSectionRule[];
  sort_rules: SortRule[];
  pack_mode: PackMode;
  bookcase_ids?: number[] | null;
  only_occupied_shelves?: boolean;
  free_space_percent: number;
  height_clearance_mm: number;
  keep_series_together: boolean;
  keep_author_together: boolean;
  include_unplaced_books: boolean;
}

export interface VisualBookSlot {
  book_id: number;
  title: string;
  authors: string[];
  genre: string | null;
  series_name: string | null;
  series_index: number | null;
  reading_status: string;
  width_mm: number;
  height_mm: number;
  position_index: number;
  section_label: string;
  section_color: string;
  moved: boolean;
  from_location: string | null;
}

export interface VisualShelfLayout {
  shelf_id: number;
  bookcase_id: number;
  bookcase_name: string;
  label: string;
  position_index: number;
  width_cm: number;
  height_cm: number;
  used_width_mm: number;
  fill_percent: number;
  books: VisualBookSlot[];
}

export interface VisualBookcaseLayout {
  bookcase_id: number;
  name: string;
  location: string | null;
  shelves: VisualShelfLayout[];
}

export interface UnplacedBookWarning {
  book_id: number;
  title: string;
  authors: string[];
  width_mm: number;
  height_mm: number;
  reason: string;
}

export interface MoveStepBookItem {
  book_id: number;
  title: string;
  authors: string[];
  from_label: string | null;
  to_label: string | null;
  section_label: string;
}

export interface MoveStep {
  id: string;
  phase: "clear" | "place";
  title: string;
  description: string;
  shelf_id: number | null;
  shelf_label: string | null;
  books: MoveStepBookItem[];
  done: boolean;
}

export interface SectionLegendItem {
  label: string;
  color_hex: string;
  count: number;
}

export interface OrganizationMetrics {
  total_books: number;
  placed_books: number;
  unplaced_books: number;
  books_moved: number;
  books_unchanged: number;
  shelves_touched: number;
  average_fill_percent: number;
}

export interface OrganizationPreviewResponse {
  criteria: OrganizationCriteria;
  before_bookcases: VisualBookcaseLayout[];
  after_bookcases: VisualBookcaseLayout[];
  legend: SectionLegendItem[];
  move_steps: MoveStep[];
  unplaced_books: UnplacedBookWarning[];
  warnings: string[];
  metrics: OrganizationMetrics;
}

export interface AISuggestionScheme {
  name: string;
  summary: string;
  why_easy_to_find: string;
  pros: string[];
  criteria: OrganizationCriteria;
}

export interface AISuggestResponse {
  ai_provider: string;
  ai_model: string;
  suggestions: AISuggestionScheme[];
}

export interface PlanSummary {
  id: number;
  name: string;
  description: string | null;
  status: string;
  total_steps: number;
  completed_steps: number;
  books_moved: number;
  created_at: string;
  updated_at: string;
}

export interface PlanDetail {
  id: number;
  name: string;
  description: string | null;
  status: string;
  criteria: OrganizationCriteria;
  preview: OrganizationPreviewResponse;
  created_at: string;
  updated_at: string;
}
