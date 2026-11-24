import { useState } from "react";
import { ArrowRight, BookOpen } from "lucide-react";
import type {
  SectionLegendItem,
  VisualBookSlot,
  VisualBookcaseLayout,
  VisualShelfLayout,
} from "../types/library";

interface ShelfMapViewProps {
  beforeBookcases: VisualBookcaseLayout[];
  afterBookcases: VisualBookcaseLayout[];
  legend: SectionLegendItem[];
}

type ViewMode = "compare" | "after" | "before";

function ShelfStrip({
  shelf,
  selectedBookId,
  onSelectBook,
  highlightMoved,
}: {
  shelf: VisualShelfLayout;
  selectedBookId: number | null;
  onSelectBook: (book: VisualBookSlot) => void;
  highlightMoved: boolean;
}) {
  const shelfWidthMm = Math.max(100, shelf.width_cm * 10);
  const shelfHeightMm = Math.max(100, shelf.height_cm * 10);
  const visualHeightPx = Math.max(66, Math.min(110, Math.round(shelf.height_cm * 2.4)));

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px] text-stone-600">
        <span className="font-semibold text-stone-800 truncate">{shelf.label}</span>
        <span className="font-mono text-[10px] text-stone-500 shrink-0">
          {shelf.books.length} lib. · {(shelf.used_width_mm / 10).toFixed(1)}/{shelf.width_cm} cm (
          {shelf.fill_percent}%)
        </span>
      </div>

      {/* Physical shelf interior */}
      <div
        style={{ height: `${visualHeightPx}px` }}
        className="relative flex items-end gap-[2px] overflow-x-auto rounded-md border border-stone-200 border-b-4 border-b-amber-900/40 bg-stone-50 px-1.5 pt-1.5"
      >
        {shelf.books.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-stone-400">
            Balda libre
          </div>
        ) : (
          shelf.books.map((book) => {
            const widthPct = Math.max(1.8, (book.width_mm / shelfWidthMm) * 100);
            const heightPct = Math.max(42, Math.min(98, (book.height_mm / shelfHeightMm) * 100));
            const isSelected = selectedBookId === book.book_id;
            return (
              <button
                key={`${shelf.shelf_id}-${book.book_id}`}
                type="button"
                onClick={() => onSelectBook(book)}
                title={`${book.title}${book.authors.length ? ` — ${book.authors.join(", ")}` : ""} (${book.section_label})`}
                style={{
                  width: `${widthPct}%`,
                  minWidth: "10px",
                  height: `${heightPct}%`,
                  backgroundColor: book.section_color,
                }}
                className={`relative shrink-0 rounded-t-[3px] transition-transform cursor-pointer flex items-center justify-center overflow-hidden ${
                  isSelected
                    ? "ring-2 ring-stone-900 ring-offset-1 -translate-y-1 z-10"
                    : "hover:-translate-y-0.5 opacity-90 hover:opacity-100"
                }`}
              >
                {highlightMoved && book.moved && (
                  <span
                    title="Este libro cambia de sitio"
                    className="absolute top-1 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-white shadow-xs"
                  />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function BookcaseColumn({
  title,
  badgeClass,
  bookcases,
  selectedBookId,
  onSelectBook,
  highlightMoved,
}: {
  title: string;
  badgeClass: string;
  bookcases: VisualBookcaseLayout[];
  selectedBookId: number | null;
  onSelectBook: (book: VisualBookSlot) => void;
  highlightMoved: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}>
          {title}
        </span>
      </div>
      {bookcases.map((bc) => (
        <div
          key={`${title}-${bc.bookcase_id}`}
          className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs space-y-3"
        >
          <div>
            <h4 className="text-sm font-bold text-stone-900">{bc.name}</h4>
            {bc.location && <p className="text-[11px] text-stone-500">{bc.location}</p>}
          </div>
          <div className="rounded-xl border-2 border-amber-900/20 bg-amber-950/[0.03] p-2.5 space-y-3">
            {bc.shelves.map((shelf) => (
              <ShelfStrip
                key={`${title}-${shelf.shelf_id}`}
                shelf={shelf}
                selectedBookId={selectedBookId}
                onSelectBook={onSelectBook}
                highlightMoved={highlightMoved}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ShelfMapView({ beforeBookcases, afterBookcases, legend }: ShelfMapViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("compare");
  const [selectedBook, setSelectedBook] = useState<VisualBookSlot | null>(null);

  return (
    <div className="space-y-4">
      {/* Controls & legend */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-stone-100 p-1 self-start">
          {(
            [
              ["compare", "Antes vs. Después"],
              ["after", "Solo Después"],
              ["before", "Solo Antes"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                viewMode === mode
                  ? "bg-white text-amber-950 shadow-2xs"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-xs text-stone-500">
          Coloreado por <strong>categoría/sección</strong> · Toca cualquier lomo para ver su
          detalle.
        </p>
      </div>

      {/* Section color legend */}
      {legend.length > 0 && (
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2.5">
          {legend.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-1.5 rounded-full bg-stone-50 border border-stone-200/80 px-2.5 py-0.5 text-[11px] font-medium text-stone-700"
            >
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color_hex }}
              />
              <span>{item.label}</span>
              <span className="text-stone-400">({item.count})</span>
            </span>
          ))}
        </div>
      )}

      {/* Selected book inspector bar */}
      {selectedBook && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/70 px-4 py-3 text-xs">
          <div className="flex items-start gap-2.5 min-w-0">
            <span
              className="mt-0.5 h-4 w-2.5 rounded-xs shrink-0"
              style={{ backgroundColor: selectedBook.section_color }}
            />
            <div className="min-w-0">
              <p className="font-semibold text-stone-900">
                {selectedBook.title}
                {selectedBook.series_name && (
                  <span className="ml-1.5 font-normal text-stone-600">
                    ({selectedBook.series_name}
                    {selectedBook.series_index != null ? ` #${selectedBook.series_index}` : ""})
                  </span>
                )}
              </p>
              <p className="text-stone-600">
                {selectedBook.authors.length > 0
                  ? selectedBook.authors.join(", ")
                  : "Autor desconocido"}{" "}
                · Sección: <strong>{selectedBook.section_label}</strong> ·{" "}
                {Math.round(selectedBook.width_mm)} × {Math.round(selectedBook.height_mm)} mm
              </p>
            </div>
          </div>

          {selectedBook.moved && selectedBook.from_location && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-200 px-2.5 py-1 text-[11px] font-medium text-amber-950">
              <BookOpen className="h-3 w-3" />
              <span>Antes en: {selectedBook.from_location}</span>
              <ArrowRight className="h-3 w-3" />
              <span>Se mueve</span>
            </span>
          )}
        </div>
      )}

      {/* Bookcase columns */}
      <div
        className={`grid gap-5 ${
          viewMode === "compare" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {(viewMode === "compare" || viewMode === "before") && (
          <BookcaseColumn
            title="Antes (estado actual)"
            badgeClass="bg-stone-200 text-stone-800"
            bookcases={beforeBookcases}
            selectedBookId={selectedBook?.book_id ?? null}
            onSelectBook={setSelectedBook}
            highlightMoved={false}
          />
        )}

        {(viewMode === "compare" || viewMode === "after") && (
          <BookcaseColumn
            title="Después (propuesta)"
            badgeClass="bg-amber-900 text-white"
            bookcases={afterBookcases}
            selectedBookId={selectedBook?.book_id ?? null}
            onSelectBook={setSelectedBook}
            highlightMoved={true}
          />
        )}
      </div>
    </div>
  );
}
