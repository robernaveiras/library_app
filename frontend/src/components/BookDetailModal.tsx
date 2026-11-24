import { useEffect, useState } from "react";
import { Barcode, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import type {
  Book,
  BookCreateInput,
  BookOrientation,
  BookUpdateInput,
  Bookcase,
  IsbnLookupResult,
  ReadingStatus,
  Tag,
} from "../types/library";
import { IsbnScannerModal } from "./IsbnScannerModal";

interface BookDetailModalProps {
  isOpen: boolean;
  book: Book | null;
  bookcases: Bookcase[];
  availableTags: Tag[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const DIM_SOURCE_LABELS: Record<string, string> = {
  api: "API externa",
  visual_calibration: "Calibrado desde foto",
  estimated: "Estimado por páginas",
  manual: "Medida manual",
};

export function BookDetailModal({
  isOpen,
  book,
  bookcases,
  availableTags,
  onClose,
  onSaved,
}: BookDetailModalProps) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [authorsText, setAuthorsText] = useState("");
  const [publisher, setPublisher] = useState("");
  const [publishedYear, setPublishedYear] = useState("");
  const [language, setLanguage] = useState("");
  const [isbn13, setIsbn13] = useState("");
  const [isbn10, setIsbn10] = useState("");
  const [pageCount, setPageCount] = useState("");
  const [widthMm, setWidthMm] = useState("");
  const [heightMm, setHeightMm] = useState("");
  const [dimensionsSource, setDimensionsSource] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [genre, setGenre] = useState("");
  const [subgenre, setSubgenre] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [seriesIndex, setSeriesIndex] = useState("");
  const [readingStatus, setReadingStatus] = useState<ReadingStatus>("unknown");
  const [shelfId, setShelfId] = useState<string>("");
  const [orientation, setOrientation] = useState<BookOrientation>("vertical");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);

  const [isbnOpen, setIsbnOpen] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hydrateFromBook = (b: Book | null) => {
    setError(null);
    setEnrichMsg(null);
    if (b) {
      setTitle(b.title);
      setSubtitle(b.subtitle ?? "");
      setAuthorsText(b.authors.join(", "));
      setPublisher(b.publisher ?? "");
      setPublishedYear(b.published_year != null ? String(b.published_year) : "");
      setLanguage(b.language ?? "");
      setIsbn13(b.isbn_13 ?? "");
      setIsbn10(b.isbn_10 ?? "");
      setPageCount(b.page_count != null ? String(b.page_count) : "");
      setWidthMm(b.width_mm != null ? String(b.width_mm) : "");
      setHeightMm(b.height_mm != null ? String(b.height_mm) : "");
      setDimensionsSource(b.dimensions_source);
      setCoverUrl(b.cover_url ?? "");
      setSynopsis(b.synopsis ?? "");
      setGenre(b.genre ?? "");
      setSubgenre(b.subgenre ?? "");
      setSeriesName(b.series_name ?? "");
      setSeriesIndex(b.series_index != null ? String(b.series_index) : "");
      setReadingStatus(b.reading_status);
      setShelfId(b.placement ? String(b.placement.shelf_id) : "");
      setOrientation(b.placement?.orientation ?? "vertical");
      setSelectedTagIds(b.tags.map((t) => t.id));
    } else {
      setTitle("");
      setSubtitle("");
      setAuthorsText("");
      setPublisher("");
      setPublishedYear("");
      setLanguage("es");
      setIsbn13("");
      setIsbn10("");
      setPageCount("");
      setWidthMm("");
      setHeightMm("");
      setDimensionsSource(null);
      setCoverUrl("");
      setSynopsis("");
      setGenre("");
      setSubgenre("");
      setSeriesName("");
      setSeriesIndex("");
      setReadingStatus("unknown");
      setShelfId(bookcases[0]?.shelves[0] ? String(bookcases[0].shelves[0].id) : "");
      setOrientation("vertical");
      setSelectedTagIds([]);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    hydrateFromBook(book);
  }, [isOpen, book]);

  if (!isOpen) return null;

  const handleIsbnResult = (res: IsbnLookupResult) => {
    setTitle(res.title);
    if (res.subtitle) setSubtitle(res.subtitle);
    if (res.authors.length > 0) setAuthorsText(res.authors.join(", "));
    if (res.publisher) setPublisher(res.publisher);
    if (res.published_year) setPublishedYear(String(res.published_year));
    if (res.language) setLanguage(res.language);
    if (res.isbn_13) setIsbn13(res.isbn_13);
    if (res.isbn_10) setIsbn10(res.isbn_10);
    if (res.page_count) setPageCount(String(res.page_count));
    if (res.width_mm && dimensionsSource !== "manual") {
      setWidthMm(String(res.width_mm));
      setDimensionsSource(res.dimensions_source);
    }
    if (res.height_mm && dimensionsSource !== "manual") {
      setHeightMm(String(res.height_mm));
      setDimensionsSource(res.dimensions_source);
    }
    if (res.cover_url) setCoverUrl(res.cover_url);
    if (res.synopsis) setSynopsis(res.synopsis);
    setEnrichMsg(`Datos cargados desde ${res.source === "google_books" ? "Google Books" : "Open Library"}.`);
  };

  const handleEnrich = async () => {
    if (!book) return;
    setError(null);
    setEnrichMsg(null);
    setEnriching(true);
    try {
      const res = await api.enrichBook(book.id, false);
      if (!res.matched) {
        setEnrichMsg("No se encontraron coincidencias en Google Books ni Open Library. Prueba con el botón ISBN.");
      } else {
        hydrateFromBook(res.book);
        if (res.updated_fields.length > 0) {
          setEnrichMsg(
            `Enriquecido desde ${res.source} (${res.updated_fields.length} campos actualizados).`
          );
        } else {
          setEnrichMsg("Coincidencia encontrada, pero todos los campos ya estaban completos.");
        }
        await onSaved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enriquecer el libro.");
    } finally {
      setEnriching(false);
    }
  };

  const parseOptionalInt = (val: string): number | null => {
    if (!val.trim()) return null;
    const n = Number.parseInt(val, 10);
    return Number.isFinite(n) ? n : null;
  };

  const parseOptionalFloat = (val: string): number | null => {
    if (!val.trim()) return null;
    const n = Number.parseFloat(val);
    return Number.isFinite(n) ? n : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("El título es obligatorio.");
      return;
    }

    const authors = authorsText
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    const parsedShelfId = shelfId ? Number.parseInt(shelfId, 10) : null;
    const parsedWidth = parseOptionalFloat(widthMm);
    const parsedHeight = parseOptionalFloat(heightMm);

    setSaving(true);
    try {
      if (book) {
        const payload: BookUpdateInput = {
          title: title.trim(),
          subtitle: subtitle.trim() || null,
          authors,
          publisher: publisher.trim() || null,
          published_year: parseOptionalInt(publishedYear),
          language: language.trim().toLowerCase() || null,
          isbn_10: isbn10.trim() || null,
          isbn_13: isbn13.trim() || null,
          page_count: parseOptionalInt(pageCount),
          cover_url: coverUrl.trim() || null,
          synopsis: synopsis.trim() || null,
          genre: genre.trim() || null,
          subgenre: subgenre.trim() || null,
          series_name: seriesName.trim() || null,
          series_index: parseOptionalFloat(seriesIndex),
          reading_status: readingStatus,
          shelf_id: parsedShelfId,
          orientation,
        };
        // Only send width_mm / height_mm if changed so we don't flip dimensions_source to "manual" unnecessarily
        if (parsedWidth !== book.width_mm) {
          payload.width_mm = parsedWidth;
        }
        if (parsedHeight !== book.height_mm) {
          payload.height_mm = parsedHeight;
        }
        await api.updateBook(book.id, payload);
        await api.setBookTags(book.id, selectedTagIds);
      } else {
        const payload: BookCreateInput = {
          title: title.trim(),
          subtitle: subtitle.trim() || null,
          authors,
          publisher: publisher.trim() || null,
          published_year: parseOptionalInt(publishedYear),
          language: language.trim().toLowerCase() || null,
          isbn_10: isbn10.trim() || null,
          isbn_13: isbn13.trim() || null,
          page_count: parseOptionalInt(pageCount),
          width_mm: parsedWidth,
          height_mm: parsedHeight,
          dimensions_source: dimensionsSource,
          cover_url: coverUrl.trim() || null,
          synopsis: synopsis.trim() || null,
          genre: genre.trim() || null,
          subgenre: subgenre.trim() || null,
          series_name: seriesName.trim() || null,
          series_index: parseOptionalFloat(seriesIndex),
          reading_status: readingStatus,
          shelf_id: parsedShelfId,
          orientation,
        };
        const created = await api.createBook(payload);
        if (selectedTagIds.length > 0) {
          await api.setBookTags(created.id, selectedTagIds);
        }
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el libro.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!book) return;
    if (!window.confirm(`¿Eliminar "${book.title}" de tu biblioteca?`)) return;
    setDeleting(true);
    try {
      await api.deleteBook(book.id);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el libro.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-900/55 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl bg-white shadow-xl border border-stone-200 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-5 py-4 shrink-0">
          <h2 className="text-lg font-semibold text-stone-900 truncate">
            {book ? "Ficha del libro" : "Añadir libro"}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsbnOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 cursor-pointer"
            >
              <Barcode className="h-3.5 w-3.5" />
              <span>ISBN</span>
            </button>
            {book && (
              <button
                type="button"
                disabled={enriching}
                onClick={() => void handleEnrich()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 cursor-pointer"
              >
                {enriching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-800" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-amber-800" />
                )}
                <span>Enriquecer</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-5 flex-1">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}
          {enrichMsg && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
              {enrichMsg}
            </div>
          )}

          {/* Top identity + cover */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="shrink-0 flex sm:flex-col items-center gap-3">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={title || "Portada"}
                  className="h-32 w-22 rounded-lg border border-stone-200 object-cover bg-stone-100 shadow-2xs"
                />
              ) : (
                <div className="flex h-32 w-22 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 text-center text-[11px] text-stone-400 px-2">
                  Sin portada
                </div>
              )}
            </div>

            <div className="flex-1 space-y-3">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Título <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm font-medium focus:border-amber-700 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">Subtítulo</label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-3 py-1.5 text-xs focus:border-amber-700 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Autor(es) <span className="text-stone-400 font-normal">(separados por coma)</span>
                </label>
                <input
                  type="text"
                  value={authorsText}
                  onChange={(e) => setAuthorsText(e.target.value)}
                  placeholder="Ej. Ursula K. Le Guin"
                  className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Publishing & Identifiers */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-stone-700 mb-1">Editorial</label>
              <input
                type="text"
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">Año</label>
              <input
                type="number"
                value={publishedYear}
                onChange={(e) => setPublishedYear(e.target.value)}
                placeholder="2021"
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">Idioma</label>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="es, en..."
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-700 focus:outline-none"
              />
            </div>
            <div className="col-span-2 sm:col-span-2">
              <label className="block text-xs font-medium text-stone-700 mb-1">ISBN-13</label>
              <input
                type="text"
                value={isbn13}
                onChange={(e) => setIsbn13(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs font-mono focus:border-amber-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">ISBN-10</label>
              <input
                type="text"
                value={isbn10}
                onChange={(e) => setIsbn10(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs font-mono focus:border-amber-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">Páginas</label>
              <input
                type="number"
                min={1}
                value={pageCount}
                onChange={(e) => setPageCount(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-700 focus:outline-none"
              />
            </div>
          </div>

          {/* Classification & Reading status */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">Estado</label>
              <select
                value={readingStatus}
                onChange={(e) => setReadingStatus(e.target.value as ReadingStatus)}
                className="w-full rounded-xl border border-stone-200 bg-white px-2.5 py-2 text-xs focus:border-amber-700 focus:outline-none"
              >
                <option value="unknown">Sin definir</option>
                <option value="unread">Pendiente de leer</option>
                <option value="reading">Leyendo</option>
                <option value="read">Leído</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">Género</label>
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="Ciencia ficción..."
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">Subgénero</label>
              <input
                type="text"
                value={subgenre}
                onChange={(e) => setSubgenre(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-700 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-stone-700 mb-1">Saga</label>
                <input
                  type="text"
                  value={seriesName}
                  onChange={(e) => setSeriesName(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-2.5 py-2 text-xs focus:border-amber-700 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">#</label>
                <input
                  type="number"
                  step="0.5"
                  value={seriesIndex}
                  onChange={(e) => setSeriesIndex(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-2 py-2 text-xs focus:border-amber-700 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Custom tags */}
          {availableTags.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-stone-700">
                Categorías personalizadas
              </label>
              <div className="flex flex-wrap gap-1.5">
                {availableTags.map((tag) => {
                  const active = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() =>
                        setSelectedTagIds((prev) =>
                          prev.includes(tag.id)
                            ? prev.filter((id) => id !== tag.id)
                            : [...prev, tag.id]
                        )
                      }
                      style={
                        active
                          ? {
                              backgroundColor: tag.color_hex,
                              borderColor: tag.color_hex,
                              color: "#ffffff",
                            }
                          : undefined
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                        active
                          ? ""
                          : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      {!active && (
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: tag.color_hex }}
                        />
                      )}
                      <span>{tag.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Physical dimensions & shelf placement */}
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-stone-800">
                Medidas físicas y ubicación actual
              </span>
              {dimensionsSource && (
                <span className="rounded-full bg-white border border-stone-200 px-2 py-0.5 text-[10px] font-medium text-stone-600">
                  Origen: {DIM_SOURCE_LABELS[dimensionsSource] ?? dimensionsSource}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-stone-600 mb-1">
                  Grosor lomo (mm)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={1}
                  value={widthMm}
                  onChange={(e) => setWidthMm(e.target.value)}
                  placeholder="Ej. 28"
                  className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs focus:border-amber-700 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-stone-600 mb-1">
                  Alto libro (mm)
                </label>
                <input
                  type="number"
                  step="1"
                  min={50}
                  value={heightMm}
                  onChange={(e) => setHeightMm(e.target.value)}
                  placeholder="Ej. 215"
                  className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs focus:border-amber-700 focus:outline-none"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-stone-600 mb-1">
                  Estantería / Balda
                </label>
                <select
                  value={shelfId}
                  onChange={(e) => setShelfId(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs focus:border-amber-700 focus:outline-none"
                >
                  <option value="">Sin ubicar</option>
                  {bookcases.map((bc) => (
                    <optgroup key={bc.id} label={bc.name}>
                      {bc.shelves.map((s) => (
                        <option key={s.id} value={s.id}>
                          {bc.name} · {s.label} ({s.width_cm} × {s.height_cm} cm)
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs text-stone-700">
              <span className="text-[11px] font-medium text-stone-600">Orientación:</span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="bookOrientation"
                  checked={orientation === "vertical"}
                  onChange={() => setOrientation("vertical")}
                  className="accent-amber-800"
                />
                <span>Vertical</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="bookOrientation"
                  checked={orientation === "horizontal"}
                  onChange={() => setOrientation("horizontal")}
                  className="accent-amber-800"
                />
                <span>Apilado horizontal</span>
              </label>
            </div>
          </div>

          {/* Synopsis */}
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">Sinopsis</label>
            <textarea
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-stone-100">
            {book ? (
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                <span>{deleting ? "Eliminando..." : "Eliminar"}</span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-amber-900 px-5 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-800 disabled:opacity-50 cursor-pointer"
              >
                {saving ? "Guardando..." : book ? "Guardar cambios" : "Añadir libro"}
              </button>
            </div>
          </div>
        </form>
      </div>

      <IsbnScannerModal
        isOpen={isbnOpen}
        initialQuery={isbn13 || isbn10}
        onClose={() => setIsbnOpen(false)}
        onSelectBook={handleIsbnResult}
      />
    </div>
  );
}
