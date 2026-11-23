import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Bookcase, BookcaseCreateInput, BookcaseUpdateInput } from "../types/library";

interface BookcaseModalProps {
  isOpen: boolean;
  editingBookcase: Bookcase | null;
  onClose: () => void;
  onSubmitCreate: (payload: BookcaseCreateInput) => Promise<void>;
  onSubmitUpdate: (id: number, payload: BookcaseUpdateInput) => Promise<void>;
}

export function BookcaseModal({
  isOpen,
  editingBookcase,
  onClose,
  onSubmitCreate,
  onSubmitUpdate,
}: BookcaseModalProps) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  // Quick shelf generation (only when creating)
  const [generateShelves, setGenerateShelves] = useState(true);
  const [shelfCount, setShelfCount] = useState("5");
  const [widthCm, setWidthCm] = useState("76");
  const [heightCm, setHeightCm] = useState("30");
  const [depthCm, setDepthCm] = useState("28");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (editingBookcase) {
      setName(editingBookcase.name);
      setLocation(editingBookcase.location ?? "");
      setNotes(editingBookcase.notes ?? "");
      setGenerateShelves(false);
    } else {
      setName("");
      setLocation("");
      setNotes("");
      setGenerateShelves(true);
      setShelfCount("5");
      setWidthCm("76");
      setHeightCm("30");
      setDepthCm("28");
    }
  }, [isOpen, editingBookcase]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("El nombre de la estantería es obligatorio.");
      return;
    }

    setSubmitting(true);
    try {
      if (editingBookcase) {
        await onSubmitUpdate(editingBookcase.id, {
          name: name.trim(),
          location: location.trim() || null,
          notes: notes.trim() || null,
        });
      } else {
        const payload: BookcaseCreateInput = {
          name: name.trim(),
          location: location.trim() || null,
          notes: notes.trim() || null,
        };
        if (generateShelves) {
          const count = Number.parseInt(shelfCount, 10);
          const w = Number.parseFloat(widthCm);
          const h = Number.parseFloat(heightCm);
          const d = depthCm.trim() ? Number.parseFloat(depthCm) : null;
          if (!Number.isFinite(count) || count < 1 || count > 30) {
            throw new Error("El número de baldas debe estar entre 1 y 30.");
          }
          if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
            throw new Error("El ancho y el alto de las baldas deben ser mayores que 0.");
          }
          if (d !== null && (!Number.isFinite(d) || d <= 0)) {
            throw new Error("La profundidad debe ser mayor que 0.");
          }
          payload.initial_shelves = {
            count,
            width_cm: w,
            height_cm: h,
            depth_cm: d,
          };
        }
        await onSubmitCreate(payload);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la estantería.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-900/50 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-white shadow-xl border border-stone-200 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-stone-900">
            {editingBookcase ? "Editar estantería" : "Nueva estantería"}
          </h2>
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
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Estantería principal, Billy izquierda..."
              className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/15"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Ubicación</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Ej. Salón, Despacho, Dormitorio..."
              className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/15"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Opcional: detalles de la estantería..."
              className="w-full rounded-xl border border-stone-300 px-3.5 py-2 text-sm focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/15"
            />
          </div>

          {!editingBookcase && (
            <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-4 space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={generateShelves}
                  onChange={(e) => setGenerateShelves(e.target.checked)}
                  className="h-4 w-4 rounded border-stone-300 accent-amber-800"
                />
                <span className="text-sm font-medium text-stone-800">
                  Crear baldas iniciales automáticamente
                </span>
              </label>

              {generateShelves && (
                <>
                  <p className="text-xs text-stone-500">
                    Después podrás ajustar individualmente el ancho o alto de cualquier balda.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">
                        Nº de baldas
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={shelfCount}
                        onChange={(e) => setShelfCount(e.target.value)}
                        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">
                        Ancho útil (cm)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min={5}
                        value={widthCm}
                        onChange={(e) => setWidthCm(e.target.value)}
                        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">
                        Alto libre (cm)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min={5}
                        value={heightCm}
                        onChange={(e) => setHeightCm(e.target.value)}
                        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">
                        Profundidad (cm, opc.)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min={5}
                        value={depthCm}
                        onChange={(e) => setDepthCm(e.target.value)}
                        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

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
              {submitting
                ? "Guardando..."
                : editingBookcase
                  ? "Guardar cambios"
                  : "Crear estantería"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
