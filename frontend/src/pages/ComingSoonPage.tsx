import { BookOpen, Sparkles } from "lucide-react";
import type { NavTab } from "../components/Layout";

interface ComingSoonPageProps {
  tab: Exclude<NavTab, "bookcases" | "scan">;
}

const INFO: Record<
  Exclude<NavTab, "bookcases" | "scan">,
  { title: string; milestone: string; description: string; icon: typeof BookOpen }
> = {
  inventory: {
    title: "Inventario y categorías dinámicas",
    milestone: "Hitos 3 y 4",
    description:
      "Consulta todos tus libros enriquecidos con Google Books y Open Library, sus medidas físicas, estado de pendientes de leer y categorías personalizadas asistidas por IA.",
    icon: BookOpen,
  },
  organize: {
    title: "Organización y guía paso a paso",
    milestone: "Hito 5",
    description:
      "Combina criterios dinámicos, pide sugerencias a la IA orientadas a encontrar libros rápido, valida el encaje físico por medidas y sigue el checklist de movimientos.",
    icon: Sparkles,
  },
};

export function ComingSoonPage({ tab }: ComingSoonPageProps) {
  const item = INFO[tab];
  const Icon = item.icon;

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-900">
        <Icon className="h-7 w-7" />
      </div>
      <span className="mt-4 inline-block rounded-full bg-stone-200/80 px-3 py-1 text-xs font-medium text-stone-700">
        Próximo paso · {item.milestone}
      </span>
      <h2 className="mt-3 text-xl font-bold text-stone-900">{item.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">{item.description}</p>
    </div>
  );
}
