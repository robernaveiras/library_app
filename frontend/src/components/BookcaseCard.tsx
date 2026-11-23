import {
  ArrowDown,
  ArrowUp,
  MapPin,
  Pencil,
  Plus,
  Ruler,
  Trash2,
} from "lucide-react";
import type { Bookcase, Shelf } from "../types/library";

interface BookcaseCardProps {
  bookcase: Bookcase;
  onEditBookcase: (bookcase: Bookcase) => void;
  onDeleteBookcase: (bookcase: Bookcase) => void;
  onAddShelf: (bookcase: Bookcase) => void;
  onEditShelf: (bookcase: Bookcase, shelf: Shelf) => void;
  onDeleteShelf: (shelf: Shelf) => void;
  onMoveShelf: (bookcase: Bookcase, shelfIndex: number, direction: -1 | 1) => void;
}

export function BookcaseCard({
  bookcase,
  onEditBookcase,
  onDeleteBookcase,
  onAddShelf,
  onEditShelf,
  onDeleteShelf,
  onMoveShelf,
}: BookcaseCardProps) {
  const maxWidth = Math.max(...bookcase.shelves.map((s) => s.width_cm), 1);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white shadow-xs overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-stone-900 truncate">{bookcase.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            {bookcase.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-amber-800/70" />
                {bookcase.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Ruler className="h-3.5 w-3.5 text-amber-800/70" />
              {bookcase.shelves.length} {bookcase.shelves.length === 1 ? "balda" : "baldas"} ·{" "}
              {(bookcase.total_width_cm / 100).toFixed(2)} m lineales
            </span>
          </div>
          {bookcase.notes && (
            <p className="mt-1.5 text-xs text-stone-500 line-clamp-2">{bookcase.notes}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onEditBookcase(bookcase)}
            title="Editar estantería"
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-800 cursor-pointer"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteBookcase(bookcase)}
            title="Eliminar estantería"
            className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Visual proportional bookcase elevation */}
      <div className="p-4 sm:p-5 flex-1 bg-stone-50/50">
        {bookcase.shelves.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-8 text-center">
            <p className="text-sm text-stone-500">Esta estantería todavía no tiene baldas.</p>
            <button
              type="button"
              onClick={() => onAddShelf(bookcase)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-amber-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-amber-800 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Añadir primera balda
            </button>
          </div>
        ) : (
          <div className="rounded-xl border-4 border-amber-900/20 bg-amber-950/[0.04] p-2.5 space-y-2">
            {bookcase.shelves.map((shelf, index) => {
              // Map physical height_cm (e.g. 20..45 cm) to a comfortable visual height (56..112 px)
              const visualHeight = Math.max(56, Math.min(116, Math.round(shelf.height_cm * 2.2)));
              const widthPercent = Math.max(55, Math.round((shelf.width_cm / maxWidth) * 100));
              const fillPercent = Math.min(
                100,
                Math.round((shelf.used_width_cm / shelf.width_cm) * 100)
              );

              return (
                <div key={shelf.id} className="flex flex-col items-start">
                  <div
                    style={{
                      minHeight: `${visualHeight}px`,
                      width: `${widthPercent}%`,
                    }}
                    className="group relative flex flex-col justify-between rounded-lg border border-stone-200/90 border-b-4 border-b-amber-900/35 bg-white px-3 py-2 shadow-2xs transition-colors hover:border-amber-700/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-stone-800 truncate">
                            {shelf.label}
                          </span>
                          <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-mono text-stone-600">
                            {shelf.width_cm} × {shelf.height_cm} cm
                            {shelf.depth_cm ? ` · ${shelf.depth_cm} fondo` : ""}
                          </span>
                        </div>
                        {shelf.notes && (
                          <p className="mt-0.5 text-[11px] text-stone-500 truncate">
                            {shelf.notes}
                          </p>
                        )}
                      </div>

                      {/* Shelf actions */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => onMoveShelf(bookcase, index, -1)}
                          title="Subir balda"
                          className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-25 cursor-pointer disabled:cursor-default"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={index === bookcase.shelves.length - 1}
                          onClick={() => onMoveShelf(bookcase, index, 1)}
                          title="Bajar balda"
                          className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-25 cursor-pointer disabled:cursor-default"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditShelf(bookcase, shelf)}
                          title="Editar medidas de balda"
                          className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteShelf(shelf)}
                          title="Eliminar balda"
                          className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Occupancy bar */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-stone-100 overflow-hidden">
                        <div
                          style={{ width: `${fillPercent}%` }}
                          className={`h-full rounded-full transition-all ${
                            fillPercent > 95
                              ? "bg-red-500"
                              : fillPercent > 75
                                ? "bg-amber-600"
                                : "bg-emerald-600"
                          }`}
                        />
                      </div>
                      <span className="text-[11px] text-stone-500 shrink-0">
                        {shelf.book_count} {shelf.book_count === 1 ? "libro" : "libros"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-stone-100 px-5 py-3 flex items-center justify-between bg-white">
        <span className="text-xs text-stone-500">
          Total: <strong className="text-stone-800">{bookcase.total_books}</strong> libros
        </span>
        <button
          type="button"
          onClick={() => onAddShelf(bookcase)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50 transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          Añadir balda
        </button>
      </div>
    </section>
  );
}
