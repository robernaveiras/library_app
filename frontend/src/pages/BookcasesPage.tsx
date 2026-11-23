import { useState } from "react";
import { BookMarked, Layers, Plus, Ruler } from "lucide-react";
import { api } from "../api/client";
import { BookcaseCard } from "../components/BookcaseCard";
import { BookcaseModal } from "../components/BookcaseModal";
import { ShelfModal } from "../components/ShelfModal";
import type {
  Bookcase,
  BookcaseCreateInput,
  BookcaseUpdateInput,
  Shelf,
  ShelfCreateInput,
  ShelfUpdateInput,
} from "../types/library";

interface BookcasesPageProps {
  bookcases: Bookcase[];
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onScanShelf: (shelf: Shelf) => void;
}

export function BookcasesPage({
  bookcases,
  loading,
  error,
  onRefresh,
  onScanShelf,
}: BookcasesPageProps) {
  const [bookcaseModalOpen, setBookcaseModalOpen] = useState(false);
  const [editingBookcase, setEditingBookcase] = useState<Bookcase | null>(null);

  const [shelfModalTarget, setShelfModalTarget] = useState<{
    bookcase: Bookcase;
    editingShelf: Shelf | null;
  } | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  const totalShelves = bookcases.reduce((acc, bc) => acc + bc.shelves.length, 0);
  const totalLinearMeters =
    bookcases.reduce((acc, bc) => acc + bc.total_width_cm, 0) / 100;
  const totalBooks = bookcases.reduce((acc, bc) => acc + bc.total_books, 0);

  const handleCreateBookcase = async (payload: BookcaseCreateInput) => {
    await api.createBookcase(payload);
    await onRefresh();
  };

  const handleUpdateBookcase = async (id: number, payload: BookcaseUpdateInput) => {
    await api.updateBookcase(id, payload);
    await onRefresh();
  };

  const handleDeleteBookcase = async (bookcase: Bookcase) => {
    const confirmed = window.confirm(
      `¿Eliminar "${bookcase.name}" y sus ${bookcase.shelves.length} baldas?`
    );
    if (!confirmed) return;
    setActionError(null);
    try {
      await api.deleteBookcase(bookcase.id);
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error al eliminar la estantería");
    }
  };

  const handleCreateShelf = async (payload: ShelfCreateInput) => {
    if (!shelfModalTarget) return;
    await api.createShelf(shelfModalTarget.bookcase.id, payload);
    await onRefresh();
  };

  const handleUpdateShelf = async (shelfId: number, payload: ShelfUpdateInput) => {
    await api.updateShelf(shelfId, payload);
    await onRefresh();
  };

  const handleDeleteShelf = async (shelf: Shelf) => {
    const confirmed = window.confirm(`¿Eliminar "${shelf.label}"?`);
    if (!confirmed) return;
    setActionError(null);
    try {
      await api.deleteShelf(shelf.id);
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error al eliminar la balda");
    }
  };

  const handleMoveShelf = async (
    bookcase: Bookcase,
    shelfIndex: number,
    direction: -1 | 1
  ) => {
    const targetIndex = shelfIndex + direction;
    if (targetIndex < 0 || targetIndex >= bookcase.shelves.length) return;
    const ids = bookcase.shelves.map((s) => s.id);
    [ids[shelfIndex], ids[targetIndex]] = [ids[targetIndex], ids[shelfIndex]];
    setActionError(null);
    try {
      await api.reorderShelves(bookcase.id, ids);
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error al reordenar las baldas");
    }
  };

  const lastShelfOfTarget = shelfModalTarget
    ? shelfModalTarget.bookcase.shelves[shelfModalTarget.bookcase.shelves.length - 1]
    : undefined;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900">Tus estanterías</h2>
          <p className="mt-1 text-sm text-stone-600">
            Define tus estanterías y las medidas físicas de cada balda (ancho × alto en cm) para
            escanear libros y planificar reorganizaciones reales.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingBookcase(null);
            setBookcaseModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-medium text-white shadow-xs hover:bg-amber-800 transition-colors shrink-0 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Nueva estantería
        </button>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-medium text-stone-500">
            <Layers className="h-4 w-4 text-amber-800" />
            <span>Estanterías / Baldas</span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-bold text-stone-900">
            {bookcases.length}{" "}
            <span className="text-sm font-normal text-stone-500">/ {totalShelves} baldas</span>
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-medium text-stone-500">
            <Ruler className="h-4 w-4 text-amber-800" />
            <span>Espacio lineal</span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-bold text-stone-900">
            {totalLinearMeters.toFixed(2)}{" "}
            <span className="text-sm font-normal text-stone-500">m</span>
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-medium text-stone-500">
            <BookMarked className="h-4 w-4 text-amber-800" />
            <span>Libros</span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-bold text-stone-900">{totalBooks}</p>
        </div>
      </div>

      {(error || actionError) && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || actionError}
        </div>
      )}

      {/* Bookcase grid */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-72 rounded-2xl border border-stone-200 bg-white p-5 animate-pulse"
            >
              <div className="h-5 w-40 rounded bg-stone-200" />
              <div className="mt-4 space-y-3">
                <div className="h-14 rounded-lg bg-stone-100" />
                <div className="h-14 rounded-lg bg-stone-100" />
                <div className="h-14 rounded-lg bg-stone-100" />
              </div>
            </div>
          ))}
        </div>
      ) : bookcases.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-900">
            <Layers className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-stone-900">
            Empieza registrando tu primera estantería
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-stone-500">
            Puedes crear varias baldas de golpe con sus medidas estándar y luego ajustar las que
            sean más altas o estrechas.
          </p>
          <button
            type="button"
            onClick={() => {
              setEditingBookcase(null);
              setBookcaseModalOpen(true);
            }}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-medium text-white shadow-xs hover:bg-amber-800 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Crear primera estantería
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {bookcases.map((bookcase) => (
            <BookcaseCard
              key={bookcase.id}
              bookcase={bookcase}
              onEditBookcase={(bc) => {
                setEditingBookcase(bc);
                setBookcaseModalOpen(true);
              }}
              onDeleteBookcase={handleDeleteBookcase}
              onAddShelf={(bc) => setShelfModalTarget({ bookcase: bc, editingShelf: null })}
              onEditShelf={(bc, shelf) =>
                setShelfModalTarget({ bookcase: bc, editingShelf: shelf })
              }
              onDeleteShelf={handleDeleteShelf}
              onMoveShelf={handleMoveShelf}
              onScanShelf={onScanShelf}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <BookcaseModal
        isOpen={bookcaseModalOpen}
        editingBookcase={editingBookcase}
        onClose={() => setBookcaseModalOpen(false)}
        onSubmitCreate={handleCreateBookcase}
        onSubmitUpdate={handleUpdateBookcase}
      />

      <ShelfModal
        isOpen={shelfModalTarget !== null}
        bookcaseName={shelfModalTarget?.bookcase.name ?? ""}
        defaultLabel={`Balda ${(shelfModalTarget?.bookcase.shelves.length ?? 0) + 1}`}
        defaultWidthCm={lastShelfOfTarget?.width_cm ?? 76}
        defaultHeightCm={lastShelfOfTarget?.height_cm ?? 30}
        defaultDepthCm={lastShelfOfTarget?.depth_cm ?? 28}
        editingShelf={shelfModalTarget?.editingShelf ?? null}
        onClose={() => setShelfModalTarget(null)}
        onSubmitCreate={handleCreateShelf}
        onSubmitUpdate={handleUpdateShelf}
      />
    </div>
  );
}
