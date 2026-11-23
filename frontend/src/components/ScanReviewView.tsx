import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Barcode,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  BookOrientation,
  ConfirmScanBookItem,
  IsbnLookupResult,
  ReadingStatus,
  Shelf,
  ShelfScan,
} from "../types/library";
import { IsbnScannerModal } from "./IsbnScannerModal";

interface EditableBook extends ConfirmScanBookItem {
  localId: string;
  authorsText: string;
  notes?: string | null;
}

interface ScanReviewViewProps {
  scan: ShelfScan;
  shelf: Shelf;
  bookcaseName: string;
  onBack: () => void;
  onConfirm: (replaceExisting: boolean, books: ConfirmScanBookItem[]) => Promise<void>;
}

function confidenceStyle(confidence: number | null | undefined) {
  if (confidence == null) {
    return {
      badge: "bg-stone-100 text-stone-600 border-stone-200",
      box: "border-stone-400 bg-stone-500/15 text-stone-900",
      label: "Manual",
    };
  }
  if (confidence >= 0.8) {
    return {
      badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
      box: "border-emerald-400 bg-emerald-500/15 text-emerald-950",
      label: `${Math.round(confidence * 100)}%`,
    };
  }
  if (confidence >= 0.5) {
    return {
      badge: "bg-amber-50 text-amber-800 border-amber-200",
      box: "border-amber-400 bg-amber-500/20 text-amber-950",
      label: `${Math.round(confidence * 100)}% · Revisar`,
    };
  }
  return {
    badge: "bg-red-50 text-red-700 border-red-200",
    box: "border-red-500 bg-red-500/25 text-red-950",
    label: `${Math.round(confidence * 100)}% · Dudoso`,
  };
}

export function ScanReviewView({
  scan,
  shelf,
  bookcaseName,
  onBack,
  onConfirm,
}: ScanReviewViewProps) {
  const [books, setBooks] = useState<EditableBook[]>(() =>
    scan.candidates.map((c, idx) => ({
      localId: `cand-${idx}-${Date.now()}`,
      title: c.title,
      authors: c.authors,
      authorsText: c.authors.join(", "),
      publisher: c.publisher,
      language: c.language,
      orientation: c.orientation,
      reading_status: "unknown",
      confidence: c.confidence,
      bbox: c.bbox,
      notes: c.notes,
    }))
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ISBN modal target: either an existing book localId to enrich, or "new" to append a new book
  const [isbnTarget, setIsbnTarget] = useState<string | "new" | null>(null);

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const lowConfidenceCount = useMemo(
    () => books.filter((b) => b.confidence != null && b.confidence < 0.8).length,
    [books]
  );

  const updateBook = (localId: string, patch: Partial<EditableBook>) => {
    setBooks((prev) => prev.map((b) => (b.localId === localId ? { ...b, ...patch } : b)));
  };

  const removeBook = (localId: string) => {
    setBooks((prev) => prev.filter((b) => b.localId !== localId));
    if (selectedId === localId) setSelectedId(null);
  };

  const moveBook = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= books.length) return;
    setBooks((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const addEmptyBook = () => {
    const localId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setBooks((prev) => [
      ...prev,
      {
        localId,
        title: "",
        authors: [],
        authorsText: "",
        publisher: null,
        language: "es",
        orientation: "vertical",
        reading_status: "unknown",
        confidence: null,
        bbox: null,
      },
    ]);
    setSelectedId(localId);
  };

  const handleIsbnSelected = (res: IsbnLookupResult) => {
    if (isbnTarget === "new") {
      const localId = `isbn-${Date.now()}`;
      setBooks((prev) => [
        ...prev,
        {
          localId,
          title: res.title,
          subtitle: res.subtitle,
          authors: res.authors,
          authorsText: res.authors.join(", "),
          publisher: res.publisher,
          published_year: res.published_year,
          language: res.language,
          isbn_10: res.isbn_10,
          isbn_13: res.isbn_13,
          page_count: res.page_count,
          width_mm: res.width_mm,
          height_mm: res.height_mm,
          dimensions_source: res.dimensions_source,
          cover_url: res.cover_url,
          synopsis: res.synopsis,
          orientation: "vertical",
          reading_status: "unknown",
          confidence: 1.0,
          bbox: null,
          notes: `Enriquecido vía ${res.source === "google_books" ? "Google Books" : "Open Library"}`,
        },
      ]);
      setSelectedId(localId);
      return;
    }

    if (isbnTarget) {
      updateBook(isbnTarget, {
        title: res.title,
        subtitle: res.subtitle,
        authors: res.authors,
        authorsText: res.authors.join(", "),
        publisher: res.publisher,
        published_year: res.published_year,
        language: res.language,
        isbn_10: res.isbn_10,
        isbn_13: res.isbn_13,
        page_count: res.page_count,
        width_mm: res.width_mm,
        height_mm: res.height_mm,
        dimensions_source: res.dimensions_source,
        cover_url: res.cover_url,
        synopsis: res.synopsis,
        confidence: 1.0,
        notes: `Confirmado por ISBN (${res.isbn_13 || res.isbn_10 || res.isbn})`,
      });
    }
  };

  const handleSelectFromPhoto = (localId: string) => {
    setSelectedId(localId);
    const el = cardRefs.current[localId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const handleConfirm = async () => {
    setError(null);
    const cleaned: ConfirmScanBookItem[] = [];
    for (let i = 0; i < books.length; i++) {
      const b = books[i];
      if (!b.title.trim()) {
        setError(`El libro #${i + 1} no tiene título. Complétalo o elimínalo antes de guardar.`);
        setSelectedId(b.localId);
        return;
      }
      const authors = b.authorsText
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      cleaned.push({
        title: b.title.trim(),
        subtitle: b.subtitle,
        authors,
        publisher: b.publisher?.trim() || null,
        published_year: b.published_year,
        language: b.language?.trim().toLowerCase() || null,
        isbn_10: b.isbn_10,
        isbn_13: b.isbn_13,
        page_count: b.page_count,
        width_mm: b.width_mm,
        height_mm: b.height_mm,
        dimensions_source: b.dimensions_source,
        cover_url: b.cover_url,
        synopsis: b.synopsis,
        reading_status: b.reading_status,
        orientation: b.orientation,
        row_depth: 1,
        confidence: b.confidence,
        bbox: b.bbox,
      });
    }

    setSubmitting(true);
    try {
      await onConfirm(replaceExisting, cleaned);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar los libros.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 pb-24">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </button>
          <div>
            <h2 className="text-lg font-bold text-stone-900">
              Revisar escaneo · {bookcaseName} / {shelf.label}
            </h2>
            <p className="text-xs text-stone-500">
              Detectado con <strong>{scan.ai_provider}</strong> ({scan.ai_model}) ·{" "}
              {shelf.width_cm} × {shelf.height_cm} cm
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsbnTarget("new")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 cursor-pointer"
          >
            <Barcode className="h-4 w-4" />
            Añadir por ISBN
          </button>
          <button
            type="button"
            onClick={addEmptyBook}
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Añadir manual
          </button>
        </div>
      </div>

      {lowConfidenceCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
          <p>
            Hay <strong>{lowConfidenceCount}</strong>{" "}
            {lowConfidenceCount === 1 ? "libro con confianza baja o media" : "libros con confianza baja o media"}{" "}
            marcados en ámbar/rojo. Puedes corregir el título directamente o pulsar{" "}
            <strong>ISBN</strong> en su tarjeta para identificarlo al instante.
          </p>
        </div>
      )}

      {/* Split view on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Interactive photo with bounding boxes */}
        <div className="lg:col-span-6 lg:sticky lg:top-20 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-600">
              Toca un número sobre la foto para ir al libro
            </span>
            <button
              type="button"
              onClick={() => setShowOverlay((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50 cursor-pointer"
            >
              {showOverlay ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showOverlay ? "Ocultar marcas" : "Mostrar marcas"}
            </button>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-stone-200 bg-stone-900 shadow-xs">
            <img
              src={scan.image_url}
              alt={`Foto de ${shelf.label}`}
              className="block w-full h-auto select-none"
            />

            {showOverlay &&
              books.map((book, index) => {
                if (!book.bbox || book.bbox.length !== 4) return null;
                const [xMin, yMin, xMax, yMax] = book.bbox;
                const isSelected = selectedId === book.localId;
                const style = confidenceStyle(book.confidence);
                return (
                  <button
                    key={book.localId}
                    type="button"
                    onClick={() => handleSelectFromPhoto(book.localId)}
                    title={`#${index + 1} ${book.title}`}
                    style={{
                      left: `${xMin * 100}%`,
                      top: `${yMin * 100}%`,
                      width: `${Math.max(2, (xMax - xMin) * 100)}%`,
                      height: `${Math.max(4, (yMax - yMin) * 100)}%`,
                    }}
                    className={`absolute border-2 transition-all cursor-pointer ${
                      isSelected
                        ? "border-amber-400 bg-amber-400/35 ring-2 ring-white z-20"
                        : `${style.box} hover:bg-white/25 z-10`
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 rounded px-1 py-0.2 text-[10px] font-bold leading-tight shadow-xs ${
                        isSelected
                          ? "bg-amber-900 text-white"
                          : "bg-stone-900/80 text-white"
                      }`}
                    >
                      {index + 1}
                    </span>
                  </button>
                );
              })}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-stone-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-xs bg-emerald-500" /> Alta confianza (≥80%)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-xs bg-amber-500" /> Revisar (50–79%)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-xs bg-red-500" /> Dudoso (&lt;50%)
            </span>
          </div>
        </div>

        {/* Editable books list */}
        <div className="lg:col-span-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-800">
              Libros detectados ({books.length}) — de izquierda a derecha
            </h3>
          </div>

          {books.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
              <p className="text-sm text-stone-500">
                No hay libros en la lista. Añade libros manualmente o escaneando su ISBN.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {books.map((book, index) => {
                const isSelected = selectedId === book.localId;
                const style = confidenceStyle(book.confidence);
                return (
                  <div
                    key={book.localId}
                    ref={(el) => {
                      cardRefs.current[book.localId] = el;
                    }}
                    onClick={() => setSelectedId(book.localId)}
                    className={`rounded-2xl border bg-white p-4 transition-all ${
                      isSelected
                        ? "border-amber-700 ring-2 ring-amber-700/15 shadow-sm"
                        : "border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    {/* Card top row */}
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-stone-900 text-xs font-bold text-white">
                          {index + 1}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.badge}`}
                        >
                          {style.label}
                        </span>
                        {(book.isbn_13 || book.isbn_10) && (
                          <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-mono text-stone-600">
                            ISBN {book.isbn_13 || book.isbn_10}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsbnTarget(book.localId);
                          }}
                          title="Identificar o enriquecer con ISBN"
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 cursor-pointer"
                        >
                          <Barcode className="h-3.5 w-3.5" />
                          <span>ISBN</span>
                        </button>
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveBook(index, -1);
                          }}
                          title="Mover antes"
                          className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-25 cursor-pointer"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={index === books.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveBook(index, 1);
                          }}
                          title="Mover después"
                          className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-25 cursor-pointer"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeBook(book.localId);
                          }}
                          title="Quitar de la lista"
                          className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {book.notes && (
                      <p className="mb-2.5 text-[11px] text-amber-800 bg-amber-50/70 rounded-lg px-2.5 py-1">
                        {book.notes}
                      </p>
                    )}

                    {/* Editable fields */}
                    <div className="space-y-2.5">
                      <div className="flex gap-3">
                        {book.cover_url && (
                          <img
                            src={book.cover_url}
                            alt={book.title}
                            className="h-16 w-11 shrink-0 rounded border border-stone-200 object-cover"
                          />
                        )}
                        <div className="flex-1 space-y-2">
                          <input
                            type="text"
                            value={book.title}
                            onChange={(e) => updateBook(book.localId, { title: e.target.value })}
                            placeholder="Título del libro *"
                            className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-900 focus:border-amber-700 focus:outline-none"
                          />
                          <input
                            type="text"
                            value={book.authorsText}
                            onChange={(e) =>
                              updateBook(book.localId, { authorsText: e.target.value })
                            }
                            placeholder="Autor(es), separados por coma"
                            className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <input
                          type="text"
                          value={book.publisher ?? ""}
                          onChange={(e) =>
                            updateBook(book.localId, { publisher: e.target.value || null })
                          }
                          placeholder="Editorial"
                          className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
                        />
                        <input
                          type="text"
                          value={book.language ?? ""}
                          onChange={(e) =>
                            updateBook(book.localId, { language: e.target.value || null })
                          }
                          placeholder="Idioma (es, en)"
                          className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
                        />
                        <select
                          value={book.reading_status}
                          onChange={(e) =>
                            updateBook(book.localId, {
                              reading_status: e.target.value as ReadingStatus,
                            })
                          }
                          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
                        >
                          <option value="unknown">Estado: sin definir</option>
                          <option value="unread">Pendiente de leer</option>
                          <option value="reading">Leyendo</option>
                          <option value="read">Leído</option>
                        </select>
                        <select
                          value={book.orientation}
                          onChange={(e) =>
                            updateBook(book.localId, {
                              orientation: e.target.value as BookOrientation,
                            })
                          }
                          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
                        >
                          <option value="vertical">Vertical</option>
                          <option value="horizontal">Apilado horizontal</option>
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation footer bar */}
      <div className="fixed bottom-16 md:bottom-0 inset-x-0 z-20 border-t border-stone-200 bg-white/95 backdrop-blur-md shadow-lg">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            {error && <p className="text-xs font-medium text-red-600">{error}</p>}
            <div className="flex flex-wrap items-center gap-4 text-xs text-stone-700">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="saveMode"
                  checked={replaceExisting}
                  onChange={() => setReplaceExisting(true)}
                  className="accent-amber-800"
                />
                <span>Reemplazar libros de esta balda ({shelf.book_count} actuales)</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="saveMode"
                  checked={!replaceExisting}
                  onChange={() => setReplaceExisting(false)}
                  className="accent-amber-800"
                />
                <span>Añadir al final (balda en varias fotos)</span>
              </label>
            </div>
          </div>

          <button
            type="button"
            disabled={submitting || books.length === 0}
            onClick={() => void handleConfirm()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-900 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-amber-800 disabled:opacity-50 cursor-pointer shrink-0"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <span>
              {submitting
                ? "Guardando..."
                : `Guardar ${books.length} ${books.length === 1 ? "libro" : "libros"}`}
            </span>
          </button>
        </div>
      </div>

      <IsbnScannerModal
        isOpen={isbnTarget !== null}
        onClose={() => setIsbnTarget(null)}
        onSelectBook={handleIsbnSelected}
      />
    </div>
  );
}
