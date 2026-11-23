import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Shelf, ShelfCreateInput, ShelfUpdateInput } from "../types/library";

interface ShelfModalProps {
  isOpen: boolean;
  bookcaseName: string;
  defaultLabel: string;
  defaultWidthCm?: number;
  defaultHeightCm?: number;
  defaultDepthCm?: number | null;
  editingShelf: Shelf | null;
  onClose: () => void;
  onSubmitCreate: (payload: ShelfCreateInput) => Promise<void>;
  onSubmitUpdate: (shelfId: number, payload: ShelfUpdateInput) => Promise<void>;
}

export function ShelfModal({
  isOpen,
  bookcaseName,
  defaultLabel,
  defaultWidthCm = 76,
  defaultHeightCm = 30,
  defaultDepthCm = 28,
  editingShelf,
  onClose,
  onSubmitCreate,
  onSubmitUpdate,
}: ShelfModalProps) {
  const [label, setLabel] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [depthCm, setDepthCm] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (editingShelf) {
      setLabel(editingShelf.label);
      setWidthCm(String(editingShelf.width_cm));
      setHeightCm(String(editingShelf.height_cm));
      setDepthCm(editingShelf.depth_cm != null ? String(editingShelf.depth_cm) : "");
      setNotes(editingShelf.notes ?? "");
    } else {
      setLabel(defaultLabel);
      setWidthCm(String(defaultWidthCm));
      setHeightCm(String(defaultHeightCm));
      setDepthCm(defaultDepthCm != null ? String(defaultDepthCm) : "");
      setNotes("");
    }
  }, [isOpen, editingShelf, defaultLabel, defaultWidthCm, defaultHeightCm, defaultDepthCm]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const w = Number.parseFloat(widthCm);
    const h = Number.parseFloat(heightCm);
    const d = depthCm.trim() ? Number.parseFloat(depthCm) : null;

    if (!label.trim()) {
      setError("La etiqueta de la balda es obligatoria.");
      return;
    }
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
      setError("El ancho y el alto deben ser mayores que 0 cm.");
      return;
    }
    if (d !== null && (!Number.isFinite(d) || d <= 0)) {
      setError("La profundidad debe ser mayor que 0 cm.");
      return;
    }

    setSubmitting(true);
    try {
      if (editingShelf) {
        await onSubmitUpdate(editingShelf.id, {
          label: label.trim(),
          width_cm: w,
          height_cm: h,
          depth_cm: d,
          notes: notes.trim() || null,
        });
      } else {
        await onSubmitCreate({
          label: label.trim(),
          width_cm: w,
          height_cm: h,
          depth_cm: d,
          notes: notes.trim() || null,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la balda.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-900/50 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-xl border border-stone-200">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">
              {editingShelf ? "Editar balda" : "Añadir balda"}
            </h2>
            <p className="text-xs text-stone-500">{bookcaseName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Nombre / Etiqueta <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej. Balda 1, Balda superior, Gran formato..."
              className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/15"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                Ancho (cm) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.5"
                min={5}
                value={widthCm}
                onChange={(e) => setWidthCm(e.target.value)}
                className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm focus:border-amber-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                Alto (cm) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.5"
                min={5}
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm focus:border-amber-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                Fondo (cm)
              </label>
              <input
                type="number"
                step="0.5"
                min={5}
                value={depthCm}
                onChange={(e) => setDepthCm(e.target.value)}
                placeholder="Opc."
                className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm focus:border-amber-700 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Notas</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Solo bolsillo, libros grandes, balda reforzada..."
              className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/15"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-medium text-white shadow-xs hover:bg-amber-800 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? "Guardando..." : editingShelf ? "Guardar" : "Añadir balda"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
