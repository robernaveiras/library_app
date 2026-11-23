import type { ReactNode } from "react";
import { BookOpen, Camera, LayoutGrid, Library, Sparkles } from "lucide-react";
import type { ConfigStatus } from "../types/library";

export type NavTab = "bookcases" | "scan" | "inventory" | "organize";

interface LayoutProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  configStatus: ConfigStatus | null;
  children: ReactNode;
}

const NAV_ITEMS: { id: NavTab; label: string; icon: typeof Library; ready: boolean }[] = [
  { id: "bookcases", label: "Estanterías", icon: LayoutGrid, ready: true },
  { id: "scan", label: "Escanear", icon: Camera, ready: false },
  { id: "inventory", label: "Inventario", icon: BookOpen, ready: false },
  { id: "organize", label: "Organizar", icon: Sparkles, ready: false },
];

export function Layout({ activeTab, onSelectTab, configStatus, children }: LayoutProps) {
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
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer ${
                    isActive
                      ? "bg-white text-amber-950 shadow-xs"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {!item.ready && (
                    <span className="rounded-full bg-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                      Pronto
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* AI Provider status indicator */}
          <div className="flex items-center gap-2">
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
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur-md md:hidden pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                  isActive ? "text-amber-900" : "text-stone-500"
                }`}
              >
                <Icon className={`h-5 w-5 ${isActive ? "stroke-[2.25]" : "stroke-[1.75]"}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
