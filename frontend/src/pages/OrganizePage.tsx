import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardCheck,
  FolderClock,
  LayoutGrid,
  Loader2,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { api } from "../api/client";
import { AIModelSelector } from "../components/AIModelSelector";
import { MoveChecklistView } from "../components/MoveChecklistView";
import { ShelfMapView } from "../components/ShelfMapView";
import { useTasks } from "../context/TaskContext";
import type {
  AISelection,
  Bookcase,
  ConfigStatus,
  DedicatedSectionRule,
  InventoryStats,
  OrganizationCriteria,
  OrganizationPreviewResponse,
  PackMode,
  PlanDetail,
  PlanSummary,
  SortField,
  SortRule,
  Tag,
} from "../types/library";

interface OrganizePageProps {
  bookcases: Bookcase[];
  configStatus: ConfigStatus | null;
  aiSelection: AISelection;
  onAiSelectionChange: (next: AISelection) => void;
  onBookcasesChanged: () => Promise<void>;
}

const SORT_FIELD_LABELS: Record<SortField, string> = {
  genre: "Género",
  subgenre: "Subgénero",
  author: "Autor (apellido A-Z)",
  series: "Saga y volumen",
  title: "Título",
  reading_status: "Estado (Pendientes primero)",
  tag: "Categoría personalizada",
  fiction_vs_nonfiction: "Ficción vs. No ficción",
  language: "Idioma",
  published_year: "Año de publicación",
  publisher: "Editorial",
  height: "Altura física",
  pages: "Número de páginas",
};

const DEFAULT_CRITERIA: OrganizationCriteria = {
  name: "Pendientes primero + Género y Autor",
  description: "Separa los pendientes de leer y ordena el resto por género, autor y saga.",
  dedicated_sections: [
    {
      label: "Pendientes de leer",
      match_type: "reading_status",
      match_value: "unread",
      placement_order: "first",
    },
  ],
  sort_rules: [
    { field: "genre", direction: "asc" },
    { field: "author", direction: "asc" },
    { field: "series", direction: "asc" },
    { field: "title", direction: "asc" },
  ],
  pack_mode: "balanced",
  bookcase_ids: null,
  only_occupied_shelves: false,
  free_space_percent: 10,
  height_clearance_mm: 10,
  keep_series_together: true,
  keep_author_together: true,
  include_unplaced_books: true,
};

const INSTANT_PRESETS: { label: string; criteria: OrganizationCriteria }[] = [
  {
    label: "Pendientes + Género → Autor",
    criteria: DEFAULT_CRITERIA,
  },
  {
    label: "Ficción / No ficción → Autor",
    criteria: {
      name: "Ficción / No ficción + Género y Autor",
      description: "Divide narrativa de no ficción, ordenando alfabéticamente por autor.",
      dedicated_sections: [],
      sort_rules: [
        { field: "fiction_vs_nonfiction", direction: "asc" },
        { field: "genre", direction: "asc" },
        { field: "author", direction: "asc" },
        { field: "series", direction: "asc" },
      ],
      pack_mode: "balanced",
      bookcase_ids: null,
      only_occupied_shelves: false,
      free_space_percent: 10,
      height_clearance_mm: 10,
      keep_series_together: true,
      keep_author_together: true,
      include_unplaced_books: true,
    },
  },
  {
    label: "Idioma → Género → Autor",
    criteria: {
      name: "Por Idioma + Género y Autor",
      description: "Agrupa primero por idioma y después por género y apellido del autor.",
      dedicated_sections: [],
      sort_rules: [
        { field: "language", direction: "asc" },
        { field: "genre", direction: "asc" },
        { field: "author", direction: "asc" },
        { field: "series", direction: "asc" },
      ],
      pack_mode: "balanced",
      bookcase_ids: null,
      only_occupied_shelves: false,
      free_space_percent: 10,
      height_clearance_mm: 10,
      keep_series_together: true,
      keep_author_together: true,
      include_unplaced_books: true,
    },
  },
];

export function OrganizePage({
  bookcases,
  configStatus,
  aiSelection,
  onAiSelectionChange,
  onBookcasesChanged,
}: OrganizePageProps) {
  const {
    dataVersion,
    isTaskRunning,
    pendingOrgSuggestions: suggestions,
    setPendingOrgSuggestions: setSuggestions,
    runTask,
  } = useTasks();

  const [tags, setTags] = useState<Tag[]>([]);
  const [stats, setStats] = useState<InventoryStats | null>(null);
  const [savedPlans, setSavedPlans] = useState<PlanSummary[]>([]);

  // Criteria builder state
  const [criteria, setCriteria] = useState<OrganizationCriteria>(DEFAULT_CRITERIA);
  const [userGoal, setUserGoal] = useState("");

  // Active preview or loaded saved plan
  const [preview, setPreview] = useState<OrganizationPreviewResponse | null>(null);
  const [activePlan, setActivePlan] = useState<PlanDetail | null>(null);
  const [resultTab, setResultTab] = useState<"map" | "steps">("map");

  // Loading & feedback
  const suggesting = isTaskRunning("org:suggest");
  const [calculating, setCalculating] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [applyingPlan, setApplyingPlan] = useState(false);
  const [togglingStepId, setTogglingStepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadMetadata = useCallback(async () => {
    try {
      const [tagsData, statsData, plansData] = await Promise.all([
        api.listTags(),
        api.getInventoryStats(),
        api.listOrganizationPlans(),
      ]);
      setTags(tagsData);
      setStats(statsData);
      setSavedPlans(plansData);
    } catch {
      // non-fatal initial load
    }
  }, []);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata, dataVersion]);

  const runPreview = useCallback(async (crit: OrganizationCriteria) => {
    setError(null);
    setBanner(null);
    setCalculating(true);
    try {
      const res = await api.previewOrganization(crit);
      setPreview(res);
      setActivePlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo calcular la distribución.");
    } finally {
      setCalculating(false);
    }
  }, []);

  const handleAskSuggestions = async () => {
    setError(null);
    setBanner(null);
    const modelLabel = aiSelection.model || aiSelection.provider;
    const res = await runTask({
      key: "org:suggest",
      label: `Generando sugerencias de organización con ${modelLabel}...`,
      tab: "organize",
      run: () =>
        api.suggestOrganization({
          provider: aiSelection.provider,
          model: aiSelection.model,
          user_goal: userGoal.trim() || undefined,
        }),
      formatSuccess: (out) =>
        `${out.suggestions.length} propuestas de organización listas para probar.`,
      onSuccess: (out) => {
        setSuggestions(out.suggestions);
      },
    });
    if (res && res.suggestions.length === 0) {
      setBanner("La IA no devolvió sugerencias válidas. Prueba con otro modelo o usa los presets.");
    }
  };

  const applyCriteriaAndPreview = (nextCriteria: OrganizationCriteria) => {
    setCriteria(nextCriteria);
    void runPreview(nextCriteria);
  };

  // Dedicated sections handlers
  const addDedicatedSection = () => {
    const defaultRule: DedicatedSectionRule =
      tags.length > 0
        ? {
            label: tags[0].name,
            match_type: "tag",
            match_value: String(tags[0].id),
            placement_order: "first",
          }
        : {
            label: "Pendientes de leer",
            match_type: "reading_status",
            match_value: "unread",
            placement_order: "first",
          };
    setCriteria((prev) => ({
      ...prev,
      dedicated_sections: [...prev.dedicated_sections, defaultRule],
    }));
  };

  const updateDedicatedSection = (index: number, patch: Partial<DedicatedSectionRule>) => {
    setCriteria((prev) => ({
      ...prev,
      dedicated_sections: prev.dedicated_sections.map((sec, idx) =>
        idx === index ? { ...sec, ...patch } : sec
      ),
    }));
  };

  const removeDedicatedSection = (index: number) => {
    setCriteria((prev) => ({
      ...prev,
      dedicated_sections: prev.dedicated_sections.filter((_, idx) => idx !== index),
    }));
  };

  // Sort rules handlers
  const addSortRule = () => {
    const usedFields = new Set(criteria.sort_rules.map((r) => r.field));
    const candidates: SortField[] = [
      "genre",
      "author",
      "series",
      "title",
      "language",
      "published_year",
      "height",
      "pages",
    ];
    const nextField = candidates.find((f) => !usedFields.has(f)) ?? "title";
    setCriteria((prev) => ({
      ...prev,
      sort_rules: [...prev.sort_rules, { field: nextField, direction: "asc" }],
    }));
  };

  const updateSortRule = (index: number, patch: Partial<SortRule>) => {
    setCriteria((prev) => ({
      ...prev,
      sort_rules: prev.sort_rules.map((r, idx) => (idx === index ? { ...r, ...patch } : r)),
    }));
  };

  const removeSortRule = (index: number) => {
    setCriteria((prev) => ({
      ...prev,
      sort_rules: prev.sort_rules.filter((_, idx) => idx !== index),
    }));
  };

  const moveSortRule = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= criteria.sort_rules.length) return;
    setCriteria((prev) => {
      const next = [...prev.sort_rules];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, sort_rules: next };
    });
  };

  // Plan persistence & execution
  const handleSavePlan = async () => {
    setSavingPlan(true);
    setError(null);
    try {
      const created = await api.createOrganizationPlan({
        name: criteria.name,
        description: criteria.description,
        criteria,
      });
      setActivePlan(created);
      setPreview(created.preview);
      setResultTab("steps");
      setBanner(`Plan «${created.name}» guardado. Ya puedes ir marcando pasos desde el móvil.`);
      await loadMetadata();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el plan.");
    } finally {
      setSavingPlan(false);
    }
  };

  const handleOpenSavedPlan = async (planId: number) => {
    setError(null);
    setBanner(null);
    try {
      const detail = await api.getOrganizationPlan(planId);
      setActivePlan(detail);
      setCriteria(detail.criteria);
      setPreview(detail.preview);
      setResultTab("steps");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el plan guardado.");
    }
  };

  const handleToggleStep = async (stepId: string, done: boolean) => {
    if (!activePlan) return;
    setTogglingStepId(stepId);
    setError(null);
    try {
      const updated = await api.updatePlanStepProgress(activePlan.id, stepId, done);
      setActivePlan(updated);
      setPreview(updated.preview);
      await loadMetadata();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el paso.");
    } finally {
      setTogglingStepId(null);
    }
  };

  const handleApplyPlan = async () => {
    if (!activePlan) return;
    const ok = window.confirm(
      `¿Confirmar que ya has movido los libros físicamente y actualizar la ubicación de tu inventario según «${activePlan.name}»?`
    );
    if (!ok) return;
    setApplyingPlan(true);
    setError(null);
    try {
      const applied = await api.applyOrganizationPlan(activePlan.id);
      setActivePlan(applied);
      setPreview(applied.preview);
      setBanner(
        `¡Organización «${applied.name}» aplicada! Tu inventario y tus baldas reflejan ahora el nuevo orden.`
      );
      await Promise.all([onBookcasesChanged(), loadMetadata()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar el plan.");
    } finally {
      setApplyingPlan(false);
    }
  };

  const handleDeletePlan = async (planId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("¿Eliminar este plan guardado?")) return;
    try {
      await api.deleteOrganizationPlan(planId);
      if (activePlan?.id === planId) {
        setActivePlan(null);
      }
      await loadMetadata();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el plan.");
    }
  };

  const totalShelves = bookcases.reduce((acc, bc) => acc + bc.shelves.length, 0);
  const totalBooks = stats?.total_books ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900">
            Organizar y reordenar estanterías
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Combina criterios dinámicos, pide sugerencias a la IA para localizar libros rápido y
            obtén un plan físico que respeta el ancho y alto real de cada balda.
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

      {/* Saved plans strip */}
      {savedPlans.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-stone-700">
            <FolderClock className="h-4 w-4 text-amber-800" />
            <span>Planes guardados ({savedPlans.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {savedPlans.map((p) => {
              const isSelected = activePlan?.id === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => void handleOpenSavedPlan(p.id)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs cursor-pointer transition-colors ${
                    isSelected
                      ? "border-amber-800 bg-amber-50 text-amber-950"
                      : "border-stone-200 bg-stone-50/70 text-stone-800 hover:border-amber-700/40"
                  }`}
                >
                  <span className="font-semibold">{p.name}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      p.status === "applied"
                        ? "bg-emerald-100 text-emerald-800"
                        : p.status === "in_progress"
                          ? "bg-amber-200 text-amber-950"
                          : "bg-stone-200 text-stone-700"
                    }`}
                  >
                    {p.status === "applied"
                      ? "Aplicado"
                      : p.status === "in_progress"
                        ? `${p.completed_steps}/${p.total_steps}`
                        : "Borrador"}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => void handleDeletePlan(p.id, e)}
                    title="Eliminar plan"
                    className="rounded p-0.5 text-stone-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 1: AI Suggestions & Quick Presets */}
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-stone-900 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-800" />
              <span>Propuestas orientadas a encontrar libros rápido</span>
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Pide a la IA que analice tu biblioteca actual ({totalBooks} libros en {totalShelves}{" "}
              baldas) o prueba un esquema instantáneo.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={userGoal}
            onChange={(e) => setUserGoal(e.target.value)}
            placeholder="Opcional: ej. «Quiero los pendientes arriba y separar libros escritos por mujeres»"
            className="flex-1 rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/15"
          />
          <button
            type="button"
            disabled={suggesting || totalBooks === 0 || totalShelves === 0}
            onClick={() => void handleAskSuggestions()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-medium text-white shadow-xs hover:bg-amber-800 disabled:opacity-50 cursor-pointer shrink-0"
          >
            {suggesting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            <span>{suggesting ? "Analizando biblioteca..." : "Pedir sugerencias a la IA"}</span>
          </button>
        </div>

        {/* Instant presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-stone-500">Presets rápidos:</span>
          {INSTANT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={totalBooks === 0 || totalShelves === 0}
              onClick={() => applyCriteriaAndPreview(preset.criteria)}
              className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-700 hover:border-amber-700/40 hover:bg-amber-50 hover:text-amber-950 disabled:opacity-50 cursor-pointer"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* AI suggestions cards */}
        {suggestions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-2">
            {suggestions.map((s, idx) => (
              <article
                key={`${s.name}-${idx}`}
                className="rounded-2xl border border-amber-200/80 bg-amber-50/30 p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-stone-900">{s.name}</h4>
                  <p className="text-xs text-stone-700">{s.summary}</p>
                  <p className="text-xs text-amber-950 bg-white/80 rounded-lg border border-amber-200/60 px-2.5 py-2">
                    <strong>Búsqueda rápida:</strong> {s.why_easy_to_find}
                  </p>
                  {s.pros.length > 0 && (
                    <ul className="space-y-1 text-[11px] text-stone-600 list-disc pl-4">
                      {s.pros.map((pro, i) => (
                        <li key={i}>{pro}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => applyCriteriaAndPreview(s.criteria)}
                  className="w-full rounded-xl bg-amber-900 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800 cursor-pointer"
                >
                  Probar este esquema
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Dynamic Criteria Builder */}
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-stone-900 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-amber-800" />
            <span>Constructor dinámico de criterios</span>
          </h3>
          <input
            type="text"
            value={criteria.name}
            onChange={(e) => setCriteria((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Nombre del plan..."
            className="sm:w-72 rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-800 focus:border-amber-700 focus:outline-none"
          />
        </div>

        {/* Dedicated sections */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                1. Secciones dedicadas (opcional)
              </h4>
              <p className="text-[11px] text-stone-500">
                Separa bloques especiales como «Pendientes de leer» o «Escritos por mujeres» al
                principio, al final o en una estantería/balda concreta.
              </p>
            </div>
            <button
              type="button"
              onClick={addDedicatedSection}
              className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-amber-50 hover:text-amber-900 cursor-pointer shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Añadir sección</span>
            </button>
          </div>

          {criteria.dedicated_sections.length === 0 ? (
            <p className="text-xs text-stone-400 italic">
              Sin secciones dedicadas: todos los libros se ordenan juntos siguiendo la cascada de
              abajo.
            </p>
          ) : (
            <div className="space-y-2">
              {criteria.dedicated_sections.map((sec, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center rounded-xl border border-stone-200 bg-stone-50/70 p-2.5"
                >
                  <select
                    value={sec.match_type}
                    onChange={(e) => {
                      const mt = e.target.value as DedicatedSectionRule["match_type"];
                      let mv = "unread";
                      let lbl = "Pendientes de leer";
                      if (mt === "tag" && tags[0]) {
                        mv = String(tags[0].id);
                        lbl = tags[0].name;
                      } else if (mt === "genre" && stats?.genres[0]) {
                        mv = stats.genres[0];
                        lbl = stats.genres[0];
                      } else if (mt === "language" && stats?.languages[0]) {
                        mv = stats.languages[0];
                        lbl = `Idioma ${stats.languages[0].toUpperCase()}`;
                      }
                      updateDedicatedSection(idx, {
                        match_type: mt,
                        match_value: mv,
                        label: lbl,
                      });
                    }}
                    className="sm:col-span-3 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="reading_status">Estado de lectura</option>
                    {tags.length > 0 && <option value="tag">Categoría personalizada</option>}
                    {(stats?.genres.length ?? 0) > 0 && <option value="genre">Género</option>}
                    {(stats?.languages.length ?? 0) > 0 && <option value="language">Idioma</option>}
                  </select>

                  {sec.match_type === "reading_status" ? (
                    <select
                      value={sec.match_value}
                      onChange={(e) =>
                        updateDedicatedSection(idx, {
                          match_value: e.target.value,
                          label:
                            e.target.value === "unread"
                              ? "Pendientes de leer"
                              : e.target.value === "reading"
                                ? "Leyendo ahora"
                                : "Leídos",
                        })
                      }
                      className="sm:col-span-3 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                    >
                      <option value="unread">Pendientes de leer</option>
                      <option value="reading">Leyendo</option>
                      <option value="read">Leídos</option>
                    </select>
                  ) : sec.match_type === "tag" ? (
                    <select
                      value={sec.match_value}
                      onChange={(e) => {
                        const t = tags.find((x) => String(x.id) === e.target.value);
                        updateDedicatedSection(idx, {
                          match_value: e.target.value,
                          label: t?.name ?? "Categoría",
                        });
                      }}
                      className="sm:col-span-3 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                    >
                      {tags.map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.name} ({t.book_count})
                        </option>
                      ))}
                    </select>
                  ) : sec.match_type === "genre" ? (
                    <select
                      value={sec.match_value}
                      onChange={(e) =>
                        updateDedicatedSection(idx, {
                          match_value: e.target.value,
                          label: e.target.value,
                        })
                      }
                      className="sm:col-span-3 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                    >
                      {(stats?.genres ?? []).map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={sec.match_value}
                      onChange={(e) =>
                        updateDedicatedSection(idx, {
                          match_value: e.target.value,
                          label: `Idioma ${e.target.value.toUpperCase()}`,
                        })
                      }
                      className="sm:col-span-3 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                    >
                      {(stats?.languages ?? []).map((l) => (
                        <option key={l} value={l}>
                          {l.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Placement destination */}
                  <select
                    value={
                      sec.target_shelf_id
                        ? `shelf:${sec.target_shelf_id}`
                        : sec.target_bookcase_id
                          ? `bc:${sec.target_bookcase_id}`
                          : `order:${sec.placement_order}`
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("order:")) {
                        updateDedicatedSection(idx, {
                          placement_order: v.replace("order:", "") as "first" | "last",
                          target_bookcase_id: null,
                          target_shelf_id: null,
                        });
                      } else if (v.startsWith("bc:")) {
                        updateDedicatedSection(idx, {
                          target_bookcase_id: Number(v.replace("bc:", "")),
                          target_shelf_id: null,
                        });
                      } else if (v.startsWith("shelf:")) {
                        updateDedicatedSection(idx, {
                          target_shelf_id: Number(v.replace("shelf:", "")),
                          target_bookcase_id: null,
                        });
                      }
                    }}
                    className="sm:col-span-5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="order:first">Colocar al principio de las baldas</option>
                    <option value="order:last">Colocar al final de las baldas</option>
                    {bookcases.map((bc) => (
                      <optgroup key={bc.id} label={`Destino fijo: ${bc.name}`}>
                        <option value={`bc:${bc.id}`}>Estantería entera: {bc.name}</option>
                        {bc.shelves.map((s) => (
                          <option key={s.id} value={`shelf:${s.id}`}>
                            {bc.name} · {s.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => removeDedicatedSection(idx)}
                    className="sm:col-span-1 justify-self-end rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sort rules cascade */}
        <div className="space-y-2.5 pt-2 border-t border-stone-100">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                2. Criterios de ordenación combinados (por prioridad)
              </h4>
              <p className="text-[11px] text-stone-500">
                Se aplican en cascada: 1º criterio principal, 2º criterio de desempate, etc.
              </p>
            </div>
            <button
              type="button"
              onClick={addSortRule}
              className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-amber-50 hover:text-amber-900 cursor-pointer shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Añadir criterio</span>
            </button>
          </div>

          <div className="space-y-2">
            {criteria.sort_rules.map((rule, idx) => (
              <div
                key={idx}
                className="flex flex-wrap sm:flex-nowrap items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/70 p-2.5"
              >
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-900 text-xs font-bold text-white">
                  {idx + 1}
                </span>

                <select
                  value={rule.field}
                  onChange={(e) => {
                    const nf = e.target.value as SortField;
                    updateSortRule(idx, {
                      field: nf,
                      tag_id: nf === "tag" ? (tags[0]?.id ?? null) : null,
                    });
                  }}
                  className="flex-1 min-w-44 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-800"
                >
                  {(Object.keys(SORT_FIELD_LABELS) as SortField[]).map((field) => {
                    if (field === "tag" && tags.length === 0) return null;
                    return (
                      <option key={field} value={field}>
                        {SORT_FIELD_LABELS[field]}
                      </option>
                    );
                  })}
                </select>

                {rule.field === "tag" && tags.length > 0 && (
                  <select
                    value={rule.tag_id ?? tags[0].id}
                    onChange={(e) => updateSortRule(idx, { tag_id: Number(e.target.value) })}
                    className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                  >
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  value={rule.direction}
                  onChange={(e) =>
                    updateSortRule(idx, { direction: e.target.value as "asc" | "desc" })
                  }
                  className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700"
                >
                  <option value="asc">Ascendente (A → Z)</option>
                  <option value="desc">Descendente (Z → A)</option>
                </select>

                <div className="flex items-center gap-0.5 ml-auto">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveSortRule(idx, -1)}
                    className="rounded p-1 text-stone-400 hover:bg-white hover:text-stone-700 disabled:opacity-25 cursor-pointer"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === criteria.sort_rules.length - 1}
                    onClick={() => moveSortRule(idx, 1)}
                    className="rounded p-1 text-stone-400 hover:bg-white hover:text-stone-700 disabled:opacity-25 cursor-pointer"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={criteria.sort_rules.length <= 1}
                    onClick={() => removeSortRule(idx)}
                    className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-25 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scope & packing mode */}
        <div className="space-y-3 pt-2 border-t border-stone-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wide text-stone-600">
                3. Modo de reparto en baldas
              </label>
              <select
                value={criteria.pack_mode}
                onChange={(e) =>
                  setCriteria((prev) => ({
                    ...prev,
                    pack_mode: e.target.value as PackMode,
                  }))
                }
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-800 focus:border-amber-700 focus:outline-none"
              >
                <option value="balanced">
                  Equilibrado — Repartir por todas las estanterías y baldas
                </option>
                <option value="per_bookcase">
                  Por estantería — Reordenar cada estantería sin mover libros entre ellas
                </option>
                <option value="compact">
                  Compacto — Llenar primeras baldas y dejar las últimas libres
                </option>
              </select>
            </div>

            {bookcases.length > 1 && (
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wide text-stone-600">
                  Estanterías a reorganizar
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCriteria((prev) => ({ ...prev, bookcase_ids: null }))}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium cursor-pointer ${
                      !criteria.bookcase_ids || criteria.bookcase_ids.length === 0
                        ? "border-amber-900 bg-amber-900 text-white"
                        : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    Todas ({bookcases.length})
                  </button>
                  {bookcases.map((bc) => {
                    const selected = criteria.bookcase_ids?.includes(bc.id) ?? false;
                    return (
                      <button
                        key={bc.id}
                        type="button"
                        onClick={() =>
                          setCriteria((prev) => {
                            const cur = prev.bookcase_ids ?? [];
                            const next = cur.includes(bc.id)
                              ? cur.filter((id) => id !== bc.id)
                              : [...cur, bc.id];
                            return {
                              ...prev,
                              bookcase_ids: next.length === 0 ? null : next,
                            };
                          })
                        }
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium cursor-pointer ${
                          selected
                            ? "border-amber-900 bg-amber-900 text-white"
                            : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                        }`}
                      >
                        {bc.name} ({bc.total_books})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(criteria.only_occupied_shelves)}
              onChange={(e) =>
                setCriteria((prev) => ({
                  ...prev,
                  only_occupied_shelves: e.target.checked,
                }))
              }
              className="h-4 w-4 accent-amber-800"
            />
            <span>
              Respetar baldas vacías (no usar baldas que ahora tienen 0 libros, ej. sin escanear)
            </span>
          </label>
        </div>

        {/* Physical constraints */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-stone-100">
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">
              Espacio libre por balda ({criteria.free_space_percent}%)
            </label>
            <input
              type="range"
              min={0}
              max={35}
              step={5}
              value={criteria.free_space_percent}
              onChange={(e) =>
                setCriteria((prev) => ({
                  ...prev,
                  free_space_percent: Number(e.target.value),
                }))
              }
              className="w-full accent-amber-800"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">
              Holgura superior (mm)
            </label>
            <input
              type="number"
              min={0}
              max={40}
              step={2}
              value={criteria.height_clearance_mm}
              onChange={(e) =>
                setCriteria((prev) => ({
                  ...prev,
                  height_clearance_mm: Math.max(0, Number(e.target.value) || 0),
                }))
              }
              className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer self-center">
            <input
              type="checkbox"
              checked={criteria.keep_series_together}
              onChange={(e) =>
                setCriteria((prev) => ({ ...prev, keep_series_together: e.target.checked }))
              }
              className="h-4 w-4 accent-amber-800"
            />
            <span>Mantener sagas juntas</span>
          </label>

          <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer self-center">
            <input
              type="checkbox"
              checked={criteria.keep_author_together}
              onChange={(e) =>
                setCriteria((prev) => ({ ...prev, keep_author_together: e.target.checked }))
              }
              className="h-4 w-4 accent-amber-800"
            />
            <span>Mantener mismo autor junto</span>
          </label>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={calculating || totalBooks === 0 || totalShelves === 0}
            onClick={() => void runPreview(criteria)}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-900 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-amber-800 disabled:opacity-50 cursor-pointer"
          >
            {calculating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LayoutGrid className="h-4 w-4" />
            )}
            <span>{calculating ? "Calculando encaje físico..." : "Calcular distribución física"}</span>
          </button>
        </div>
      </section>

      {/* Section 3: Preview / Active Plan Results */}
      {preview && (
        <section className="space-y-5">
          {/* Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs">
              <p className="text-xs text-stone-500">Libros colocados</p>
              <p className="mt-1 text-2xl font-bold text-stone-900">
                {preview.metrics.placed_books}
                <span className="text-sm font-normal text-stone-500">
                  {" "}
                  / {preview.metrics.total_books}
                </span>
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs">
              <p className="text-xs text-stone-500">Cambian de posición</p>
              <p className="mt-1 text-2xl font-bold text-amber-900">
                {preview.metrics.books_moved}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs">
              <p className="text-xs text-stone-500">Baldas modificadas</p>
              <p className="mt-1 text-2xl font-bold text-stone-900">
                {preview.metrics.shelves_touched}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-2xs">
              <p className="text-xs text-stone-500">Ocupación media</p>
              <p className="mt-1 text-2xl font-bold text-stone-900">
                {preview.metrics.average_fill_percent}%
              </p>
            </div>
          </div>

          {/* Warnings / Unplaced */}
          {(preview.warnings.length > 0 || preview.unplaced_books.length > 0) && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2.5 text-xs text-amber-950">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <span>Avisos de encaje físico</span>
              </div>
              {preview.warnings.length > 0 && (
                <ul className="list-disc pl-5 space-y-1">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              {preview.unplaced_books.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="font-semibold text-red-800">
                    Libros sin espacio físico compatible ({preview.unplaced_books.length}):
                  </p>
                  {preview.unplaced_books.map((u) => (
                    <div
                      key={u.book_id}
                      className="rounded-lg bg-white border border-red-200 px-3 py-2 text-stone-800"
                    >
                      <strong>{u.title}</strong> ({Math.round(u.width_mm)} ×{" "}
                      {Math.round(u.height_mm)} mm) — {u.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Switch between Visual Map & Step-by-Step Guide */}
          <div className="flex items-center gap-2 border-b border-stone-200 pb-1">
            <button
              type="button"
              onClick={() => setResultTab("map")}
              className={`inline-flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                resultTab === "map"
                  ? "border-amber-900 text-amber-950"
                  : "border-transparent text-stone-500 hover:text-stone-800"
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
              <span>Mapa visual (Antes / Después)</span>
            </button>
            <button
              type="button"
              onClick={() => setResultTab("steps")}
              className={`inline-flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                resultTab === "steps"
                  ? "border-amber-900 text-amber-950"
                  : "border-transparent text-stone-500 hover:text-stone-800"
              }`}
            >
              <ClipboardCheck className="h-4 w-4" />
              <span>Guía paso a paso ({preview.move_steps.length})</span>
            </button>
          </div>

          {resultTab === "map" ? (
            <ShelfMapView
              beforeBookcases={preview.before_bookcases}
              afterBookcases={preview.after_bookcases}
              legend={preview.legend}
            />
          ) : (
            <MoveChecklistView
              steps={preview.move_steps}
              planId={activePlan?.id ?? null}
              planStatus={activePlan?.status ?? null}
              savingPlan={savingPlan}
              applyingPlan={applyingPlan}
              togglingStepId={togglingStepId}
              onSavePlan={handleSavePlan}
              onToggleStep={handleToggleStep}
              onApplyPlan={handleApplyPlan}
            />
          )}
        </section>
      )}
    </div>
  );
}
