import { useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Camera,
  CheckCircle2,
  LayoutGrid,
  Library,
  Loader2,
  Sparkles,
  Tags,
  X,
} from "lucide-react";
import { useTasks } from "../context/TaskContext";
import type { ConfigStatus } from "../types/library";

export type NavTab = "bookcases" | "scan" | "inventory" | "categories" | "organize";

interface LayoutProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  configStatus: ConfigStatus | null;
  children: ReactNode;
}

const NAV_ITEMS: {
  id: NavTab;
  label: string;
  mobileLabel: string;
  icon: typeof Library;
}[] = [
  { id: "bookcases", label: "Estanterías", mobileLabel: "Estantes", icon: LayoutGrid },
  { id: "scan", label: "Escanear", mobileLabel: "Escanear", icon: Camera },
  { id: "inventory", label: "Inventario", mobileLabel: "Libros", icon: BookOpen },
  { id: "categories", label: "Categorías", mobileLabel: "Categorías", icon: Tags },
  { id: "organize", label: "Organizar", mobileLabel: "Organizar", icon: Sparkles },
];

export function Layout({ activeTab, onSelectTab, configStatus, children }: LayoutProps) {
  const { tasks, dismissTask } = useTasks();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const hasRunning = tasks.some((t) => t.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunning]);

  const runningTabs = new Set(tasks.filter((t) => t.status === "running").map((t) => t.tab));
  const configuredProviders = configStatus?.providers.filter((p) => p.configured) ?? [];

  return (
    <div className="min-h-screen flex flex-col bg-[#faf8f5] text-stone-900 pb-20 md:pb-0">
      {/* Top header */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#faf8f5]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-900 text-amber-50 shadow-sm">
              <Library className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-stone-900 leading-tight">
                Mi Biblioteca
              </h1>
              <p className="text-xs text-stone-500">Organizador de estanterías</p>
            </div>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 rounded-xl bg-stone-100 p-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const isBusy = runningTabs.has(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={`relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer ${
                    isActive
                      ? "bg-white text-amber-950 shadow-xs"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {isBusy && (
                    <span
                      title="Tarea en ejecución"
                      className="h-2 w-2 rounded-full bg-amber-600 animate-pulse"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* AI Provider status indicator */}
          <div className="flex items-center gap-2">
            {hasRunning && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-950">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-800" />
                <span className="hidden sm:inline">
                  {tasks.filter((t) => t.status === "running").length} en curso
                </span>
              </span>
            )}

            {configStatus && (
              <div
                title={
                  configuredProviders.length > 0
                    ? `IA activa: ${configuredProviders.map((p) => `${p.name} (${p.model})`).join(", ")}`
                    : "Configura GEMINI_API_KEY o STRATA_API_KEY en .env para habilitar el escaneo IA"
                }
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                  configuredProviders.length > 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    configuredProviders.length > 0 ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                <span className="hidden sm:inline">
                  {configuredProviders.length > 0
                    ? `IA: ${configuredProviders.map((p) => (p.id === "gemini" ? "Gemini" : "Strata")).join(" + ")}`
                    : "IA sin configurar"}
                </span>
                <span className="sm:hidden">IA</span>
              </div>
            )}
          </div>
        </div>

        {/* Global persistent background task status bar (visible across all tabs) */}
        {tasks.length > 0 && (
          <div className="border-t border-stone-200/80 bg-white/95">
            <div className="mx-auto max-w-6xl px-4 py-2 sm:px-6 space-y-1.5">
              {tasks.slice(0, 3).map((task) => {
                const elapsedSec = Math.max(
                  0,
                  Math.floor(((task.finishedAt ?? nowMs) - task.startedAt) / 1000)
                );
                return (
                  <div
                    key={task.id}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-xs ${
                      task.status === "running"
                        ? "border-amber-200 bg-amber-50/80 text-amber-950"
                        : task.status === "success"
                          ? "border-emerald-200 bg-emerald-50/80 text-emerald-950"
                          : "border-red-200 bg-red-50/80 text-red-900"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {task.status === "running" ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-800" />
                      ) : task.status === "success" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
                      )}
                      <span className="font-medium truncate">
                        {task.status === "running"
                          ? `${task.label} (${elapsedSec}s)`
                          : task.detail || task.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {task.tab !== activeTab && (
                        <button
                          type="button"
                          onClick={() => onSelectTab(task.tab)}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/80 border border-current/15 px-2 py-0.5 text-[11px] font-semibold hover:bg-white cursor-pointer"
                        >
                          <span>Ir</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                      {task.status !== "running" && (
                        <button
                          type="button"
                          onClick={() => dismissTask(task.id)}
                          aria-label="Cerrar aviso"
                          className="rounded p-0.5 opacity-60 hover:opacity-100 cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur-md md:hidden pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isBusy = runningTabs.has(item.id);
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`relative flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                  isActive ? "text-amber-900" : "text-stone-500"
                }`}
              >
                <div className="relative">
                  <Icon className={`h-5 w-5 ${isActive ? "stroke-[2.25]" : "stroke-[1.75]"}`} />
                  {isBusy && (
                    <span className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-amber-600 ring-2 ring-white animate-pulse" />
                  )}
                </div>
                <span>{item.mobileLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
