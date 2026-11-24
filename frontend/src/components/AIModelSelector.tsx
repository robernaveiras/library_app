import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../api/client";
import type { AISelection, ConfigStatus, ProviderModelOption } from "../types/library";

interface AIModelSelectorProps {
  configStatus: ConfigStatus | null;
  value: AISelection;
  onChange: (next: AISelection) => void;
  compact?: boolean;
}

const CUSTOM_OPTION = "__custom__";

export function AIModelSelector({
  configStatus,
  value,
  onChange,
  compact = false,
}: AIModelSelectorProps) {
  const [liveModelsByProvider, setLiveModelsByProvider] = useState<
    Record<string, ProviderModelOption[]>
  >({});
  const [loadingModels, setLoadingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);

  const providers = configStatus?.providers ?? [];
  const activeProvider = providers.find((p) => p.id === value.provider);

  const modelOptions = useMemo(() => {
    const live = liveModelsByProvider[value.provider] ?? [];
    const suggested = activeProvider?.suggested_models ?? [];
    const map = new Map<string, ProviderModelOption>();

    if (activeProvider?.model) {
      map.set(activeProvider.model, { id: activeProvider.model });
    }
    for (const m of live) {
      map.set(m.id, m);
    }
    for (const id of suggested) {
      if (!map.has(id)) {
        map.set(id, { id });
      }
    }
    if (value.model && !map.has(value.model)) {
      map.set(value.model, { id: value.model });
    }
    return Array.from(map.values());
  }, [liveModelsByProvider, value.provider, value.model, activeProvider]);

  useEffect(() => {
    setFetchError(null);
    setCustomMode(false);
  }, [value.provider]);

  const handleSelectProvider = (providerId: string) => {
    const p = providers.find((item) => item.id === providerId);
    const savedKey = `library_ai_model_${providerId}`;
    const storedModel =
      typeof window !== "undefined" ? window.localStorage.getItem(savedKey) : null;
    onChange({
      provider: providerId,
      model: storedModel || p?.model || "",
    });
  };

  const handleSelectModel = (modelId: string) => {
    if (modelId === CUSTOM_OPTION) {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    onChange({ provider: value.provider, model: modelId });
  };

  const handleFetchLiveModels = async () => {
    setLoadingModels(true);
    setFetchError(null);
    try {
      const res = await api.listProviderModels(value.provider);
      if (res.models.length > 0) {
        setLiveModelsByProvider((prev) => ({
          ...prev,
          [value.provider]: res.models,
        }));
      }
      if (!res.ok && res.error) {
        setFetchError(res.error);
      }
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "No se pudieron consultar los modelos."
      );
    } finally {
      setLoadingModels(false);
    }
  };

  if (providers.length === 0) return null;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white px-2.5 py-1.5">
        <div className="flex items-center gap-1 rounded-lg bg-stone-100 p-0.5">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelectProvider(p.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                value.provider === p.id
                  ? "bg-amber-900 text-white"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {p.id === "gemini" ? "Gemini" : "Strata"}
            </button>
          ))}
        </div>

        {customMode ? (
          <input
            type="text"
            value={value.model}
            onChange={(e) => onChange({ provider: value.provider, model: e.target.value })}
            placeholder="Nombre del modelo..."
            className="w-48 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-mono focus:border-amber-700 focus:outline-none"
          />
        ) : (
          <select
            value={value.model}
            onChange={(e) => handleSelectModel(e.target.value)}
            aria-label="Modelo IA"
            className="max-w-52 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-mono text-stone-800 focus:border-amber-700 focus:outline-none"
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
            <option value={CUSTOM_OPTION}>+ Otro modelo...</option>
          </select>
        )}

        <button
          type="button"
          disabled={loadingModels}
          onClick={() => void handleFetchLiveModels()}
          title="Consultar modelos disponibles en la API"
          className="rounded-lg p-1 text-stone-500 hover:bg-stone-100 hover:text-amber-900 disabled:opacity-50 cursor-pointer"
        >
          {loadingModels ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>

        {fetchError && (
          <span className="w-full text-[11px] text-red-600">{fetchError}</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Provider cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {providers.map((p) => {
          const isSelected = value.provider === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelectProvider(p.id)}
              className={`flex flex-col items-start rounded-xl border p-3 text-left transition-all cursor-pointer ${
                isSelected
                  ? "border-amber-800 bg-amber-50/60 ring-2 ring-amber-800/15"
                  : "border-stone-200 bg-white hover:border-stone-300"
              }`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-semibold text-stone-900">{p.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    p.configured
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {p.configured ? "Listo" : "Sin clave"}
                </span>
              </div>
              <span className="mt-1 text-xs font-mono text-stone-500 truncate max-w-full">
                {isSelected && value.model ? value.model : p.model}
              </span>
            </button>
          );
        })}
      </div>

      {/* Model picker + live refresh */}
      <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-stone-700">
            Modelo activo ({value.provider === "gemini" ? "Gemini" : "Strata"})
          </label>
          <button
            type="button"
            disabled={loadingModels}
            onClick={() => void handleFetchLiveModels()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100/70 disabled:opacity-50 cursor-pointer"
          >
            {loadingModels ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            <span>{loadingModels ? "Consultando..." : "Cargar modelos disponibles"}</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={customMode ? CUSTOM_OPTION : value.model}
            onChange={(e) => handleSelectModel(e.target.value)}
            className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-mono text-stone-900 focus:border-amber-700 focus:outline-none"
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.display_name && m.display_name !== m.id ? ` — ${m.display_name}` : ""}
              </option>
            ))}
            <option value={CUSTOM_OPTION}>Otro modelo (escribir manualmente)...</option>
          </select>

          {customMode && (
            <input
              type="text"
              value={value.model}
              onChange={(e) => onChange({ provider: value.provider, model: e.target.value })}
              placeholder="Ej. gemini-2.5-flash-preview-..."
              className="flex-1 rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-mono text-stone-900 focus:border-amber-700 focus:outline-none"
              autoFocus
            />
          )}
        </div>

        {fetchError && <p className="text-[11px] text-red-600">{fetchError}</p>}
      </div>
    </div>
  );
}
