import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Loader2,
  PackageOpen,
  Save,
} from "lucide-react";
import type { MoveStep } from "../types/library";

interface MoveChecklistViewProps {
  steps: MoveStep[];
  planId: number | null;
  planStatus: string | null;
  savingPlan: boolean;
  applyingPlan: boolean;
  togglingStepId: string | null;
  onSavePlan: () => Promise<void>;
  onToggleStep: (stepId: string, done: boolean) => Promise<void>;
  onApplyPlan: () => Promise<void>;
}

export function MoveChecklistView({
  steps,
  planId,
  planStatus,
  savingPlan,
  applyingPlan,
  togglingStepId,
  onSavePlan,
  onToggleStep,
  onApplyPlan,
}: MoveChecklistViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    // Expand the first 2 pending steps by default
    const initial = new Set<string>();
    for (const s of steps) {
      if (!s.done && initial.size < 2) {
        initial.add(s.id);
      }
    }
    return initial;
  });

  const completedCount = steps.filter((s) => s.done).length;
  const progressPct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 100;

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (steps.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 text-center space-y-2">
        <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
        <h3 className="text-base font-semibold text-emerald-950">
          ¡Tus libros ya están en ese orden!
        </h3>
        <p className="text-xs text-emerald-800">
          No hace falta mover ningún libro para cumplir estos criterios.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header & progress */}
      <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-amber-800" />
              <span>Guía paso a paso de movimientos</span>
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Primero despeja los libros que cambian de balda en una mesa y luego coloca cada balda
              de izquierda a derecha.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {planId === null ? (
              <button
                type="button"
                disabled={savingPlan}
                onClick={() => void onSavePlan()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-900 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50 cursor-pointer"
              >
                {savingPlan ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>Guardar plan para ir marcando pasos</span>
              </button>
            ) : planStatus !== "applied" ? (
              <button
                type="button"
                disabled={applyingPlan}
                onClick={() => void onApplyPlan()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
              >
                {applyingPlan ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                <span>Confirmar y aplicar al inventario</span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-900">
                <CheckCircle2 className="h-4 w-4" />
                Plan aplicado al inventario
              </span>
            )}
          </div>
        </div>

        {planId !== null && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-stone-600">
              <span>
                Progreso: <strong>{completedCount}</strong> / {steps.length} pasos
              </span>
              <span className="font-semibold">{progressPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
              <div
                style={{ width: `${progressPct}%` }}
                className="h-full rounded-full bg-emerald-600 transition-all"
              />
            </div>
          </div>
        )}
      </div>

      {/* Step cards */}
      <div className="space-y-2.5">
        {steps.map((step) => {
          const expanded = expandedIds.has(step.id);
          const isToggling = togglingStepId === step.id;
          return (
            <div
              key={step.id}
              className={`rounded-2xl border bg-white transition-all overflow-hidden ${
                step.done ? "border-emerald-200 bg-emerald-50/30" : "border-stone-200"
              }`}
            >
              <div className="flex items-start gap-3 p-4">
                {planId !== null && (
                  <button
                    type="button"
                    disabled={isToggling || planStatus === "applied"}
                    onClick={() => void onToggleStep(step.id, !step.done)}
                    aria-label={step.done ? "Marcar como pendiente" : "Marcar paso completado"}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors cursor-pointer disabled:cursor-default ${
                      step.done
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-stone-300 bg-white hover:border-amber-700"
                    }`}
                  >
                    {isToggling ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : step.done ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : null}
                  </button>
                )}

                <div
                  onClick={() => toggleExpand(step.id)}
                  className="min-w-0 flex-1 cursor-pointer"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        step.phase === "clear"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-sky-100 text-sky-900"
                      }`}
                    >
                      {step.phase === "clear" ? (
                        <>
                          <PackageOpen className="h-3 w-3" />
                          <span>Fase 1 · Despejar</span>
                        </>
                      ) : (
                        <span>Fase 2 · Colocar</span>
                      )}
                    </span>
                    <h4
                      className={`text-sm font-semibold ${
                        step.done ? "line-through text-stone-500" : "text-stone-900"
                      }`}
                    >
                      {step.title}
                    </h4>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">{step.description}</p>
                </div>

                <button
                  type="button"
                  onClick={() => toggleExpand(step.id)}
                  className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer shrink-0"
                >
                  {expanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              </div>

              {expanded && step.books.length > 0 && (
                <div className="border-t border-stone-100 bg-stone-50/70 px-4 py-3">
                  <ol className="space-y-1.5">
                    {step.books.map((b, idx) => (
                      <li
                        key={`${step.id}-${b.book_id}-${idx}`}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-lg bg-white border border-stone-200/70 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-mono text-stone-400 mr-2">{idx + 1}.</span>
                          <span className="font-medium text-stone-900">{b.title}</span>
                          {b.authors.length > 0 && (
                            <span className="text-stone-500"> — {b.authors.join(", ")}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-[11px] text-stone-500">
                          {b.section_label && (
                            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600">
                              {b.section_label}
                            </span>
                          )}
                          <span>
                            {step.phase === "clear"
                              ? `→ ${b.to_label ?? "Otra balda"}`
                              : b.from_label}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
