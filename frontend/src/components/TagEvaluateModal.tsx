import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { api } from "../api/client";
import type { TagEvaluationResponse } from "../types/library";

interface TagEvaluateModalProps {
  evaluation: TagEvaluationResponse | null;
  onClose: () => void;
  onApplied: (count: number) => Promise<void>;
}

export function TagEvaluateModal({ evaluation, onClose, onApplied }: TagEvaluateModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!evaluation) return;
    setError(null);
    // Pre-select confident new matches
    const initial = new Set<number>(
      evaluation.proposals
        .filter((p) => !p.already_assigned && p.confidence >= 0.7)
        .map((p) => p.book_id)
    );
    setSelectedIds(initial);
  }, [evaluation]);

  if (!evaluation) return null;

  const newProposals = evaluation.proposals.filter((p) => !p.already_assigned);
  const alreadyAssignedProposals = evaluation.proposals.filter((p) => p.already_assigned);

  const toggle = (bookId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) {
        next.delete(bookId);
      } else {
        next.add(bookId);
      }
      return next;
    });
  };

  const selectAllNew = () => {
    setSelectedIds(new Set(newProposals.map((p) => p.book_id)));
  };

  const clearAll = () => {
    setSelectedIds(new Set());
  };

  const handleApply = async () => {
    setError(null);
    setApplying(true);
    try {
      const ids = Array.from(selectedIds);
      if (ids.length > 0) {
        await api.assignTagBooks(evaluation.tag_id, {
          add_book_ids: ids,
          source: "ai_confirmed",
        });
      }
      await onApplied(ids.length);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron aplicar las etiquetas.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-900/55 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl bg-white shadow-xl border border-stone-200 max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-800" />
              <h2 className="text-base font-semibold text-stone-900">
                Propuestas IA · {evaluation.tag_name}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-stone-500">
              Regla: «{evaluation.rule_used}» · Evaluados {evaluation.evaluated_books} libros con{" "}
              {evaluation.ai_provider}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4 flex-1">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          {evaluation.proposals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
              <p className="text-sm text-stone-600">
                La IA no encontró libros que cumplan esta regla en tu inventario actual.
              </p>
            </div>
          ) : (
            <>
              {newProposals.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-stone-700">
                      Nuevas coincidencias sugeridas ({newProposals.length})
                    </span>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={selectAllNew}
                        className="text-amber-900 hover:underline cursor-pointer"
                      >
                        Marcar todas
                      </button>
                      <span className="text-stone-300">|</span>
                      <button
                        type="button"
                        onClick={clearAll}
                        className="text-stone-500 hover:underline cursor-pointer"
                      >
                        Ninguna
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {newProposals.map((p) => {
                      const checked = selectedIds.has(p.book_id);
                      return (
                        <label
                          key={p.book_id}
                          className={`flex items-start gap-3 rounded-xl border p-3 transition-colors cursor-pointer ${
                            checked
                              ? "border-amber-700/50 bg-amber-50/40"
                              : "border-stone-200 bg-white hover:bg-stone-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(p.book_id)}
                            className="mt-0.5 h-4 w-4 accent-amber-800"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-stone-900 truncate">
                                {p.title}
                              </span>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  p.confidence >= 0.85
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-amber-100 text-amber-900"
                                }`}
                              >
                                {Math.round(p.confidence * 100)}%
                              </span>
                            </div>
                            {p.authors.length > 0 && (
                              <p className="text-xs text-stone-500">{p.authors.join(", ")}</p>
                            )}
                            {p.reason && (
                              <p className="mt-1 text-xs text-stone-600">{p.reason}</p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {alreadyAssignedProposals.length > 0 && (
                <div className="space-y-2 pt-2">
                  <span className="text-xs font-semibold text-stone-500">
                    Ya tenían esta categoría ({alreadyAssignedProposals.length})
                  </span>
                  <div className="space-y-1.5">
                    {alreadyAssignedProposals.map((p) => (
                      <div
                        key={p.book_id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600"
                      >
                        <span className="truncate">
                          <strong>{p.title}</strong>
                          {p.authors.length > 0 ? ` — ${p.authors.join(", ")}` : ""}
                        </span>
                        <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                          Asignado
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-stone-100 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
          >
            Cerrar
          </button>
          {newProposals.length > 0 && (
            <button
              type="button"
              disabled={applying || selectedIds.size === 0}
              onClick={() => void handleApply()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-900 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50 cursor-pointer"
            >
              {applying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              <span>Aplicar a {selectedIds.size} libros</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
