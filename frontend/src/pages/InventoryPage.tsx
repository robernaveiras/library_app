import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BookMarked,
  BookOpen,
  Bookmark,
  CheckCircle2,
  Clock,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  Plus,
  Ruler,
  Search,
  Sparkles,
} from "lucide-react";
import { api } from "../api/client";
import { BookDetailModal } from "../components/BookDetailModal";
import { useTasks } from "../context/TaskContext";
import type {
  Book,
  BookListParams,
  Bookcase,
  EnrichmentStatus,
  InventoryStats,
  ReadingStatus,
  Tag,
} from "../types/library";

interface InventoryPageProps {
  bookcases: Bookcase[];
  initialFilter?: { genre?: string; tagId?: number } | null;
  onClearInitialFilter?: () => void;
  onBookcasesChanged: () => Promise<void>;
}

const STATUS_BADGE: Record<ReadingStatus, { label: string; className: string }> = {
  unknown: { label: "Sin definir", className: "bg-stone-100 text-stone-600" },
  unread: { label: "Pendiente", className: "bg-amber-100 text-amber-900" },
  reading: { label: "Leyendo", className: "bg-sky-100 text-sky-900" },
  read: { label: "Leído", className: "bg-emerald-100 text-emerald-900" },
};

const DIM_ORIGIN_SHORT: Record<string, string> = {
  api: "API",
  visual_calibration: "Foto",
  estimated: "Est.",
  manual: "Manual",
};

const ENRICHMENT_BADGE: Record<
  EnrichmentStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  enriched: {
    label: "Enriquecido",
    className: "bg-emerald-50 text-emerald-800 border-emerald-200",
    icon: CheckCircle2,
  },
  pending: {
    label: "Sin enriquecer",
    className: "bg-amber-50 text-amber-900 border-amber-200",
    icon: Clock,
  },
  not_found: {
    label: "Sin coincidencia",
    className: "bg-stone-100 text-stone-600 border-stone-200",
    icon: AlertCircle,
  },
};

export function InventoryPage({
  bookcases,
  initialFilter,
  onClearInitialFilter,
  onBookcasesChanged,
}: InventoryPageProps) {
  const { dataVersion, isTaskRunning, runTask } = useTasks();

  const [books, setBooks] = useState<Book[]>([]);
  const [stats, setStats] = useState<InventoryStats | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [bookcaseId, setBookcaseId] = useState<string>("");
  const [readingStatus, setReadingStatus] = useState<string>("");
  const [genreFilter, setGenreFilter] = useState<string>(initialFilter?.genre ?? "");
  const [tagFilter, setTagFilter] = useState<string>(
    initialFilter?.tagId != null ? String(initialFilter.tagId) : ""
  );
  const [language, setLanguage] = useState<string>("");
  const [enrichmentFilter, setEnrichmentFilter] = useState<
    "all" | "enriched" | "pending" | "not_found"
  >("all");
  const [sortBy, setSortBy] = useState<BookListParams["sort_by"]>("location");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  useEffect(() => {
    if (!initialFilter) return;
    if (initialFilter.genre !== undefined) setGenreFilter(initialFilter.genre);
    if (initialFilter.tagId !== undefined) setTagFilter(String(initialFilter.tagId));
    onClearInitialFilter?.();
  }, [initialFilter, onClearInitialFilter]);

  // Enrichment states
  const batchEnriching = isTaskRunning("enrich:batch");
  const [enrichingBookId, setEnrichingBookId] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Detail/Create modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<Book | null>(null);

  const loadInventory = useCallback(async () => {
    setError(null);
    try {
      const params: BookListParams = {
        q: search.trim() || undefined,
        bookcase_id: bookcaseId ? Number(bookcaseId) : undefined,
        reading_status: readingStatus || undefined,
        genre: genreFilter || undefined,
        tag_id: tagFilter ? Number(tagFilter) : undefined,
        language: language || undefined,
        enrichment: enrichmentFilter,
        sort_by: sortBy,
      };
      const [booksData, statsData, tagsData] = await Promise.all([
        api.listBooks(params),
        api.getInventoryStats(),
        api.listTags(),
      ]);
      setBooks(booksData);
      setStats(statsData);
      setTags(tagsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el inventario.");
    } finally {
      setLoading(false);
    }
  }, [search, bookcaseId, readingStatus, genreFilter, tagFilter, language, enrichmentFilter, sortBy]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadInventory();
    }, 150);
    return () => clearTimeout(timer);
  }, [loadInventory, dataVersion]);

  const handleSaved = async () => {
    await Promise.all([loadInventory(), onBookcasesChanged()]);
  };

  const handleBatchEnrich = async () => {
    setBanner(null);
    setError(null);
    const pendingCount = stats?.needs_enrichment_count ?? 0;
    const res = await runTask({
      key: "enrich:batch",
      label: `Enriqueciendo ${pendingCount > 0 ? `${pendingCount} libros pendientes` : "inventario"} con Google Books / Open Library...`,
      tab: "inventory",
      run: () => api.enrichBooksBatch({ only_missing: true, overwrite: false }),
      formatSuccess: (out) =>
        `Enriquecimiento terminado: ${out.enriched} enriquecidos, ${out.not_found} sin coincidencia, ${out.skipped} omitidos.`,
      onSuccess: async () => {
        await onBookcasesChanged();
      },
    });
    if (res) {
      setBanner(
        `Enriquecimiento completado: ${res.enriched} enriquecidos, ${res.not_found} sin coincidencia, ${res.skipped} ya procesados.`
      );
    }
  };

  const handleQuickEnrich = async (book: Book, e: React.MouseEvent) => {
    e.stopPropagation();
    setEnrichingBookId(book.id);
    setBanner(null);
    setError(null);
    try {
      const res = await runTask({
        key: `enrich:book:${book.id}`,
        label: `Buscando metadatos de «${book.title}»...`,
        tab: "inventory",
        run: () => api.enrichBook(book.id, false),
        formatSuccess: (out) =>
          out.matched
            ? `«${book.title}» enriquecido (${out.updated_fields.length} campos).`
            : `Sin coincidencia automática para «${book.title}». Prueba buscando su ISBN.`,
        onSuccess: async () => {
          await onBookcasesChanged();
        },
      });
      if (res) {
        setBanner(
          res.matched
            ? `"${book.title}" enriquecido desde ${res.source} (${res.updated_fields.length} campos).`
            : `No se encontraron datos automáticos para "${book.title}". Abre su ficha para buscar por ISBN.`
        );
      }
    } finally {
      setEnrichingBookId(null);
    }
  };

  const handleToggleUnread = async (book: Book, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextStatus: ReadingStatus = book.reading_status === "unread" ? "read" : "unread";
    try {
      await api.updateBook(book.id, { reading_status: nextStatus });
      await loadInventory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el estado.");
    }
  };

  const formatDimensions = (book: Book) => {
    const parts: string[] = [];
    if (book.width_mm != null) parts.push(`${Math.round(book.width_mm)} mm grosor`);
    if (book.height_mm != null) parts.push(`${Math.round(book.height_mm)} mm alto`);
    if (parts.length === 0) return null;
    const origin = book.dimensions_source ? DIM_ORIGIN_SHORT[book.dimensions_source] : null;
    return `${parts.join(" × ")}${origin ? ` (${origin})` : ""}`;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900">Inventario de libros</h2>
          <p className="mt-1 text-sm text-stone-600">
            Enriquece tus libros con Google Books y Open Library, ajusta medidas físicas y marca tus
            pendientes de leer.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {stats && stats.needs_enrichment_count > 0 && (
            <button
              type="button"
              disabled={batchEnriching}
              onClick={() => void handleBatchEnrich()}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-60 cursor-pointer"
            >
              {batchEnriching ? (
                <Loader2 className="h-4 w-4 animate-spin text-amber-800" />
              ) : (
                <Sparkles className="h-4 w-4 text-amber-800" />
              )}
              <span>
                {batchEnriching
                  ? "Enriqueciendo..."
                  : `Enriquecer pendientes (${stats.needs_enrichment_count})`}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setEditingBook(null);
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-medium text-white shadow-xs hover:bg-amber-800 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Añadir libro</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs text-stone-500">
              <BookOpen className="h-4 w-4 text-amber-800" />
              <span>Total inventario</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-stone-900">{stats.total_books}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs text-stone-500">
              <Sparkles className="h-4 w-4 text-emerald-700" />
              <span>Enriquecidos</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-stone-900">
              {stats.enriched_books}
              <span className="text-sm font-normal text-stone-500"> / {stats.total_books}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-stone-500">
              {stats.needs_enrichment_count} pendientes
              {stats.not_found_enrichment_count > 0
                ? ` · ${stats.not_found_enrichment_count} sin coincidencia`
                : ""}
            </p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs text-stone-500">
              <Bookmark className="h-4 w-4 text-amber-700" />
              <span>Pendientes de leer</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-stone-900">{stats.unread_count}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs text-stone-500">
              <Ruler className="h-4 w-4 text-amber-800" />
              <span>Espacio ocupado</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-stone-900">
              {stats.estimated_linear_meters.toFixed(2)}{" "}
              <span className="text-sm font-normal text-stone-500">m</span>
            </p>
          </div>
        </div>
      )}

      {banner && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{banner}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Search & Filters */}
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título, autor, editorial, ISBN o saga..."
              className="w-full rounded-xl border border-stone-300 pl-10 pr-3.5 py-2 text-sm focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/15"
            />
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-stone-100 p-1 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              title="Vista tarjetas"
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
                viewMode === "grid" ? "bg-white text-stone-900 shadow-2xs" : "text-stone-600"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Tarjetas</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              title="Vista lista"
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
                viewMode === "list" ? "bg-white text-stone-900 shadow-2xs" : "text-stone-600"
              }`}
            >
              <List className="h-3.5 w-3.5" />
              <span>Lista</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <select
            value={bookcaseId}
            onChange={(e) => setBookcaseId(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
          >
            <option value="">Todas las estanterías</option>
            {bookcases.map((bc) => (
              <option key={bc.id} value={bc.id}>
                {bc.name}
              </option>
            ))}
          </select>

          <select
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
          >
            <option value="">Todos los géneros</option>
            {(stats?.genres ?? []).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
          >
            <option value="">Todas las categorías</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.book_count})
              </option>
            ))}
          </select>

          <select
            value={readingStatus}
            onChange={(e) => setReadingStatus(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
          >
            <option value="">Cualquier estado</option>
            <option value="unread">Pendiente de leer</option>
            <option value="reading">Leyendo</option>
            <option value="read">Leído</option>
            <option value="unknown">Sin definir</option>
          </select>

          <select
            value={enrichmentFilter}
            onChange={(e) =>
              setEnrichmentFilter(
                e.target.value as "all" | "enriched" | "pending" | "not_found"
              )
            }
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
          >
            <option value="all">Enriquecimiento: todos</option>
            <option value="pending">Sin enriquecer</option>
            <option value="enriched">Enriquecidos</option>
            <option value="not_found">Sin coincidencia</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as BookListParams["sort_by"])}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
          >
            <option value="location">Orden: Ubicación</option>
            <option value="title">Orden: Título A-Z</option>
            <option value="author">Orden: Autor A-Z</option>
            <option value="year">Orden: Año</option>
            <option value="pages">Orden: Páginas</option>
            <option value="created_at">Orden: Recientes</option>
          </select>
        </div>

        {(stats?.languages.length ?? 0) > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] text-stone-500 mr-1">Idioma:</span>
            <button
              type="button"
              onClick={() => setLanguage("")}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium cursor-pointer ${
                language === "" ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-600"
              }`}
            >
              Todos
            </button>
            {(stats?.languages ?? []).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setLanguage(lang)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase cursor-pointer ${
                  language === lang ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-600"
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Book list / grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-36 rounded-2xl border border-stone-200 bg-white p-4 animate-pulse" />
          ))}
        </div>
      ) : books.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-900">
            <BookMarked className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-stone-900">
            {stats && stats.total_books > 0
              ? "Ningún libro coincide con los filtros"
              : "Tu inventario está vacío"}
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
            {stats && stats.total_books > 0
              ? "Prueba a limpiar la búsqueda o cambiar los filtros."
              : "Escanea una balda desde la pestaña Escanear o añade libros manualmente / por ISBN."}
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {books.map((book) => {
            const dimLabel = formatDimensions(book);
            const statusInfo = STATUS_BADGE[book.reading_status];
            const enrichInfo = ENRICHMENT_BADGE[book.enrichment_status ?? "pending"];
            const EnrichIcon = enrichInfo.icon;
            return (
              <article
                key={book.id}
                onClick={() => {
                  setEditingBook(book);
                  setModalOpen(true);
                }}
                className="group rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs hover:border-amber-700/40 hover:shadow-xs transition-all cursor-pointer flex gap-3.5"
              >
                {/* Cover */}
                {book.cover_url ? (
                  <img
                    src={book.cover_url}
                    alt={book.title}
                    loading="lazy"
                    className="h-28 w-19 shrink-0 rounded-lg border border-stone-200 object-cover bg-stone-100"
                  />
                ) : (
                  <div className="flex h-28 w-19 shrink-0 flex-col items-center justify-center rounded-lg border border-stone-200 bg-amber-950/[0.04] px-1.5 text-center">
                    <span className="text-base font-bold text-amber-900/50">
                      {book.title.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                )}

                {/* Content */}
                <div className="min-w-0 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-stone-900 leading-snug line-clamp-2 group-hover:text-amber-900">
                        {book.title}
                      </h3>
                    </div>
                    <p className="mt-0.5 text-xs text-stone-600 truncate">
                      {book.authors.length > 0 ? book.authors.join(", ") : "Autor sin especificar"}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${enrichInfo.className}`}
                      >
                        <EnrichIcon className="h-3 w-3" />
                        <span>{enrichInfo.label}</span>
                      </span>
                      <span className={`rounded-full px-2 py-0.5 font-medium ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                      {book.genre && (
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">
                          {book.genre}
                        </span>
                      )}
                      {book.language && (
                        <span className="rounded bg-stone-100 px-1.5 py-0.5 uppercase font-mono text-[10px] text-stone-600">
                          {book.language}
                        </span>
                      )}
                      {book.tags.map((tag) => (
                        <span
                          key={tag.id}
                          style={{
                            backgroundColor: `${tag.color_hex}18`,
                            color: tag.color_hex,
                            borderColor: `${tag.color_hex}40`,
                          }}
                          className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-stone-100 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-stone-500">
                      <span className="inline-flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 text-amber-800/70 shrink-0" />
                        {book.placement
                          ? `${book.placement.bookcase_name} · ${book.placement.shelf_label} #${book.placement.position_index + 1}`
                          : "Sin ubicar"}
                      </span>
                      {book.page_count && <span className="shrink-0">{book.page_count} p.</span>}
                    </div>

                    {dimLabel && (
                      <p className="text-[11px] text-stone-400 truncate">{dimLabel}</p>
                    )}

                    <div className="flex items-center justify-end gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={(e) => void handleToggleUnread(book, e)}
                        title={
                          book.reading_status === "unread"
                            ? "Marcar como leído"
                            : "Marcar como pendiente de leer"
                        }
                        className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                          book.reading_status === "unread"
                            ? "bg-amber-100 text-amber-950 hover:bg-amber-200"
                            : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                        }`}
                      >
                        {book.reading_status === "unread" ? "✓ Pendiente" : "Pendiente"}
                      </button>

                      {book.enrichment_status !== "enriched" && (
                        <button
                          type="button"
                          disabled={enrichingBookId === book.id}
                          onClick={(e) => void handleQuickEnrich(book, e)}
                          title="Completar datos con Google Books / Open Library"
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 cursor-pointer"
                        >
                          {enrichingBookId === book.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                          <span>
                            {book.enrichment_status === "not_found" ? "Reintentar" : "Enriquecer"}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xs divide-y divide-stone-100">
          {books.map((book) => {
            const statusInfo = STATUS_BADGE[book.reading_status];
            const enrichInfo = ENRICHMENT_BADGE[book.enrichment_status ?? "pending"];
            const EnrichIcon = enrichInfo.icon;
            return (
              <div
                key={book.id}
                onClick={() => {
                  setEditingBook(book);
                  setModalOpen(true);
                }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50/80 transition-colors cursor-pointer"
              >
                {book.cover_url ? (
                  <img
                    src={book.cover_url}
                    alt={book.title}
                    loading="lazy"
                    className="h-12 w-8 shrink-0 rounded border border-stone-200 object-cover"
                  />
                ) : (
                  <div className="h-12 w-8 shrink-0 rounded border border-stone-200 bg-stone-100" />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-sm font-semibold text-stone-900 truncate">{book.title}</h3>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${enrichInfo.className}`}
                    >
                      <EnrichIcon className="h-2.5 w-2.5" />
                      <span>{enrichInfo.label}</span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusInfo.className}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 truncate">
                    {book.authors.length > 0 ? book.authors.join(", ") : "Autor desconocido"}
                    {book.publisher ? ` · ${book.publisher}` : ""}
                    {book.published_year ? ` (${book.published_year})` : ""}
                  </p>
                </div>

                <div className="hidden md:block text-right text-xs text-stone-500 shrink-0">
                  <p>
                    {book.placement
                      ? `${book.placement.bookcase_name} · ${book.placement.shelf_label}`
                      : "Sin ubicar"}
                  </p>
                  <p className="text-[11px] text-stone-400">
                    {book.width_mm ? `${Math.round(book.width_mm)} mm` : "—"} ×{" "}
                    {book.height_mm ? `${Math.round(book.height_mm)} mm` : "—"}
                  </p>
                </div>

                {book.enrichment_status !== "enriched" && (
                  <button
                    type="button"
                    disabled={enrichingBookId === book.id}
                    onClick={(e) => void handleQuickEnrich(book, e)}
                    className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 p-1.5 text-amber-900 hover:bg-amber-100 cursor-pointer"
                    title={
                      book.enrichment_status === "not_found"
                        ? "Reintentar enriquecimiento"
                        : "Enriquecer metadatos"
                    }
                  >
                    {enrichingBookId === book.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <BookDetailModal
        isOpen={modalOpen}
        book={editingBook}
        bookcases={bookcases}
        availableTags={tags}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}
