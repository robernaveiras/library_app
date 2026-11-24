import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Tags,
  Trash2,
  Wand2,
} from "lucide-react";
import { api } from "../api/client";
import { AIModelSelector } from "../components/AIModelSelector";
import { TagBooksModal } from "../components/TagBooksModal";
import { TagEvaluateModal } from "../components/TagEvaluateModal";
import { TagModal } from "../components/TagModal";
import { useTasks } from "../context/TaskContext";
import type {
  AISelection,
  Book,
  ConfigStatus,
  Tag,
  TagCreateInput,
  TagUpdateInput,
} from "../types/library";

interface CategoriesPageProps {
  configStatus: ConfigStatus | null;
  aiSelection: AISelection;
  onAiSelectionChange: (next: AISelection) => void;
  onJumpToInventory: (filter: { genre?: string; tagId?: number }) => void;
}

const STARTER_TEMPLATES: TagCreateInput[] = [
  {
    name: "Escritos por mujeres",
    description: "Obras de autoras mujeres",
    color_hex: "#9d174d",
    ai_rule_prompt: "Libros cuya autora (o al menos una coautora principal) es una mujer",
  },
  {
    name: "Clásicos imprescindibles",
    description: "Obras clásicas de la literatura universal",
    color_hex: "#92400e",
    ai_rule_prompt: "Obras ampliamente consideradas clásicos de la literatura universal o de su género",
  },
  {
    name: "Literatura en español",
    description: "Autoría original de España o Hispanoamérica",
    color_hex: "#0f766e",
    ai_rule_prompt: "Libros escritos originalmente en español por autores de España o Hispanoamérica",
  },
  {
    name: "Lecturas cortas",
    description: "Libros ágiles de menos de 220 páginas",
    color_hex: "#1d4ed8",
    ai_rule_prompt: "Libros breves o de lectura corta (menos de 220 páginas o novela corta / relato)",
  },
];

export function CategoriesPage({
  configStatus,
  aiSelection,
  onAiSelectionChange,
  onJumpToInventory,
}: CategoriesPageProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const {
    dataVersion,
    isTaskRunning,
    pendingTagEvaluation: evaluationResult,
    setPendingTagEvaluation: setEvaluationResult,
    runTask,
  } = useTasks();

  // Actions state
  const categorizing = isTaskRunning("categorize:");
  const [evaluatingTagId, setEvaluatingTagId] = useState<number | null>(null);

  // Modals
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [managingBooksTag, setManagingBooksTag] = useState<Tag | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [tagsData, booksData] = await Promise.all([api.listTags(), api.listBooks()]);
      setTags(tagsData);
      setBooks(booksData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las categorías.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData, dataVersion]);

  const genreCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of books) {
      if (b.genre) {
        map.set(b.genre, (map.get(b.genre) ?? 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [books]);

  const uncategorizedCount = useMemo(
    () => books.filter((b) => !b.genre || !b.subgenre).length,
    [books]
  );

  const availableTemplates = useMemo(() => {
    const existing = new Set(tags.map((t) => t.name.toLowerCase()));
    return STARTER_TEMPLATES.filter((tpl) => !existing.has(tpl.name.toLowerCase()));
  }, [tags]);

  const handleCategorize = async (overwrite: boolean) => {
    setBanner(null);
    setError(null);
    const modelLabel = aiSelection.model || aiSelection.provider;
    const res = await runTask({
      key: "categorize:books",
      label: overwrite
        ? `Recategorizando toda la biblioteca con ${modelLabel}...`
        : `Categorizando libros pendientes con ${modelLabel}...`,
      tab: "categories",
      run: () =>
        api.categorizeBooksWithAi({
          provider: aiSelection.provider,
          model: aiSelection.model,
          only_missing: !overwrite,
          overwrite,
        }),
      formatSuccess: (out) =>
        `Categorización completada con ${out.ai_model}: ${out.updated} actualizados, ${out.skipped} omitidos${out.errors > 0 ? `, ${out.errors} sin respuesta` : ""}.`,
    });
    if (res) {
      setBanner(
        `Categorización completada con ${res.ai_model}: ${res.updated} libros actualizados, ${res.skipped} omitidos${res.errors > 0 ? `, ${res.errors} sin respuesta` : ""}.`
      );
    }
  };

  const handleCreateTag = async (payload: TagCreateInput) => {
    await api.createTag(payload);
    await loadData();
  };

  const handleUpdateTag = async (tagId: number, payload: TagUpdateInput) => {
    await api.updateTag(tagId, payload);
    await loadData();
  };

  const handleDeleteTag = async (tag: Tag) => {
    if (!window.confirm(`¿Eliminar la categoría "${tag.name}"?`)) return;
    setError(null);
    try {
      await api.deleteTag(tag.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la categoría.");
    }
  };

  const handleEvaluateTag = async (tag: Tag) => {
    setError(null);
    setBanner(null);
    setEvaluatingTagId(tag.id);
    const modelLabel = aiSelection.model || aiSelection.provider;
    try {
      await runTask({
        key: `tag-eval:${tag.id}`,
        label: `Evaluando «${tag.name}» con ${modelLabel}...`,
        tab: "categories",
        run: () =>
          api.evaluateTagWithAi(tag.id, {
            provider: aiSelection.provider,
            model: aiSelection.model,
            auto_apply: false,
          }),
        formatSuccess: (res) =>
          `«${res.tag_name}»: ${res.proposals.length} coincidencias propuestas para revisar.`,
        onSuccess: (res) => {
          setEvaluationResult(res);
        },
      });
    } finally {
      setEvaluatingTagId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header + Provider/Model switch */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900">
            Categorías y clasificación IA
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Normaliza géneros y sagas en español y crea categorías dinámicas personalizadas (como
            «Escritos por mujeres») que luego podrás combinar al reorganizar tus baldas.
          </p>
        </div>

        <AIModelSelector
          configStatus={configStatus}
          value={aiSelection}
          onChange={onAiSelectionChange}
          compact
        />
      </div>

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

      {/* Section 1: AI Genre / Series normalization */}
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-stone-900 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-800" />
              <span>Taxonomía base (géneros, subgéneros y sagas)</span>
            </h3>
            <p className="mt-0.5 text-xs text-stone-500">
              {books.length === 0
                ? "Añade o escanea libros primero para poder categorizarlos."
                : uncategorizedCount > 0
                  ? `${uncategorizedCount} de ${books.length} libros están pendientes de normalizar género/subgénero.`
                  : `Todos tus ${books.length} libros tienen género y subgénero asignados.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={categorizing || books.length === 0 || uncategorizedCount === 0}
              onClick={() => void handleCategorize(false)}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-900 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-800 disabled:opacity-50 cursor-pointer"
            >
              {categorizing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              <span>
                {categorizing
                  ? "Categorizando..."
                  : `Categorizar pendientes (${uncategorizedCount})`}
              </span>
            </button>

            {books.length > 0 && (
              <button
                type="button"
                disabled={categorizing}
                onClick={() => {
                  if (
                    window.confirm(
                      "¿Reevaluar y normalizar los géneros, subgéneros y sagas de toda tu biblioteca con IA?"
                    )
                  ) {
                    void handleCategorize(true);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Recategorizar todo</span>
              </button>
            )}
          </div>
        </div>

        {/* Genre distribution chips */}
        {genreCounts.length > 0 && (
          <div className="pt-2 border-t border-stone-100">
            <p className="text-xs font-medium text-stone-500 mb-2">
              Géneros en tu biblioteca (pulsa uno para filtrarlo en Inventario):
            </p>
            <div className="flex flex-wrap gap-2">
              {genreCounts.map(([genreName, count]) => (
                <button
                  key={genreName}
                  type="button"
                  onClick={() => onJumpToInventory({ genre: genreName })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-800 hover:border-amber-700/40 hover:bg-amber-50 hover:text-amber-950 transition-colors cursor-pointer"
                >
                  <span>{genreName}</span>
                  <span className="rounded-full bg-white px-1.5 py-0.2 text-[10px] font-semibold text-stone-500 border border-stone-200">
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Section 2: Custom dynamic categories (tags) */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
              <Tags className="h-5 w-5 text-amber-800" />
              <span>Categorías personalizables</span>
            </h3>
            <p className="text-xs text-stone-500">
              Crea tus propias colecciones o reglas en lenguaje natural; la IA te propondrá qué
              libros encajan para que tú los valides.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingTag(null);
              setTagModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-900 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-800 cursor-pointer shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Nueva categoría</span>
          </button>
        </div>

        {/* Starter 1-click templates */}
        {availableTemplates.length > 0 && (
          <div className="rounded-2xl border border-dashed border-amber-800/30 bg-amber-50/40 p-4 space-y-2.5">
            <p className="text-xs font-semibold text-amber-950">
              Ideas rápidas (crea una en 1 clic):
            </p>
            <div className="flex flex-wrap gap-2">
              {availableTemplates.map((tpl) => (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => void handleCreateTag(tpl)}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-800 hover:border-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: tpl.color_hex }}
                  />
                  <span>+ {tpl.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tags grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-36 rounded-2xl border border-stone-200 bg-white p-5 animate-pulse"
              />
            ))}
          </div>
        ) : tags.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
            <p className="text-sm text-stone-500">
              Todavía no tienes categorías personalizadas. Usa una idea rápida arriba o crea la tuya
              propia.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tags.map((tag) => {
              const isEvaluating = evaluatingTagId === tag.id;
              return (
                <article
                  key={tag.id}
                  className="rounded-2xl border border-stone-200 bg-white p-5 shadow-2xs flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="h-3.5 w-3.5 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color_hex }}
                        />
                        <h4 className="text-base font-semibold text-stone-900 truncate">
                          {tag.name}
                        </h4>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700 shrink-0">
                          {tag.book_count}
                        </span>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTag(tag);
                            setTagModalOpen(true);
                          }}
                          title="Editar categoría"
                          className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteTag(tag)}
                          title="Eliminar categoría"
                          className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {tag.description && (
                      <p className="text-xs text-stone-600">{tag.description}</p>
                    )}

                    {tag.ai_rule_prompt && (
                      <div className="rounded-xl bg-stone-50 border border-stone-200/70 px-3 py-2 text-xs text-stone-600">
                        <span className="font-semibold text-stone-700">Regla IA: </span>
                        {tag.ai_rule_prompt}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-100">
                    <button
                      type="button"
                      disabled={isEvaluating || books.length === 0}
                      onClick={() => void handleEvaluateTag(tag)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50 cursor-pointer"
                    >
                      {isEvaluating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-800" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-amber-800" />
                      )}
                      <span>{isEvaluating ? "Evaluando..." : "Evaluar con IA"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setManagingBooksTag(tag)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      <span>Elegir libros</span>
                    </button>

                    {tag.book_count > 0 && (
                      <button
                        type="button"
                        onClick={() => onJumpToInventory({ tagId: tag.id })}
                        className="ml-auto text-xs font-medium text-amber-900 hover:underline cursor-pointer"
                      >
                        Ver {tag.book_count} →
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Modals */}
      <TagModal
        isOpen={tagModalOpen}
        editingTag={editingTag}
        onClose={() => setTagModalOpen(false)}
        onCreate={handleCreateTag}
        onUpdate={handleUpdateTag}
      />

      <TagEvaluateModal
        evaluation={evaluationResult}
        onClose={() => setEvaluationResult(null)}
        onApplied={async (count) => {
          if (count > 0) {
            setBanner(`Etiqueta aplicada a ${count} ${count === 1 ? "libro" : "libros"}.`);
          }
          await loadData();
        }}
      />

      <TagBooksModal
        tag={managingBooksTag}
        onClose={() => setManagingBooksTag(null)}
        onSaved={loadData}
      />
    </div>
  );
}
