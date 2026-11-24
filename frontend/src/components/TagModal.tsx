import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Tag, TagCreateInput, TagUpdateInput } from "../types/library";

interface TagModalProps {
  isOpen: boolean;
  editingTag: Tag | null;
  onClose: () => void;
  onCreate: (payload: TagCreateInput) => Promise<void>;
  onUpdate: (tagId: number, payload: TagUpdateInput) => Promise<void>;
}

const COLOR_SWATCHES = [
  "#9d174d", // rose/plum
  "#92400e", // warm amber
  "#0f766e", // teal
  "#1d4ed8", // cobalt
  "#4338ca", // indigo
  "#15803d", // forest green
  "#b91c1c", // crimson
  "#6d28d9", // violet
  "#0369a1", // sky
  "#44403c", // stone charcoal
];

export function TagModal({ isOpen, editingTag, onClose, onCreate, onUpdate }: TagModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [colorHex, setColorHex] = useState(COLOR_SWATCHES[0]);
  const [aiRulePrompt, setAiRulePrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (editingTag) {
      setName(editingTag.name);
      setDescription(editingTag.description ?? "");
      setColorHex(editingTag.color_hex);
      setAiRulePrompt(editingTag.ai_rule_prompt ?? "");
    } else {
      setName("");
      setDescription("");
      setColorHex(COLOR_SWATCHES[0]);
      setAiRulePrompt("");
    }
  }, [isOpen, editingTag]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("El nombre de la categoría es obligatorio.");
      return;
    }
    setSaving(true);
    try {
      if (editingTag) {
        await onUpdate(editingTag.id, {
          name: name.trim(),
          description: description.trim() || null,
          color_hex: colorHex,
          ai_rule_prompt: aiRulePrompt.trim() || null,
        });
      } else {
        await onCreate({
          name: name.trim(),
          description: description.trim() || null,
          color_hex: colorHex,
          ai_rule_prompt: aiRulePrompt.trim() || null,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la categoría.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-900/55 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-white shadow-xl border border-stone-200 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-stone-900">
            {editingTag ? "Editar categoría personalizada" : "Nueva categoría personalizada"}
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
              placeholder="Ej. Escritos por mujeres, Clásicos, Japón..."
              className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/15"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Descripción</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opcional: nota personal sobre esta colección..."
              className="w-full rounded-xl border border-stone-200 px-3.5 py-2 text-sm focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1.5">
              Color identificativo{" "}
              <span className="text-xs font-normal text-stone-500">
                (para etiquetas y mapa de estanterías)
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {COLOR_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setColorHex(hex)}
                  style={{ backgroundColor: hex }}
                  className={`h-7 w-7 rounded-full transition-transform cursor-pointer ${
                    colorHex.toLowerCase() === hex.toLowerCase()
                      ? "ring-2 ring-offset-2 ring-stone-900 scale-110"
                      : "hover:scale-105"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-3.5 space-y-2">
            <label className="block text-xs font-semibold text-amber-950">
              Regla para clasificación automática con IA (opcional)
            </label>
            <textarea
              value={aiRulePrompt}
              onChange={(e) => setAiRulePrompt(e.target.value)}
              rows={2}
              placeholder="Ej. Libros cuya autora o coautora principal sea una mujer"
              className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-stone-800 focus:border-amber-700 focus:outline-none"
            />
            <p className="text-[11px] text-amber-900/80">
              Podrás pedir a Gemini o Strata que evalúe toda tu biblioteca con esta regla y revisar
              las propuestas antes de aplicarlas.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
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
              {saving ? "Guardando..." : editingTag ? "Guardar cambios" : "Crear categoría"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
