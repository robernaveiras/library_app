import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Camera,
  CheckCircle2,
  Clock,
  ImageUp,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "../api/client";
import { ScanReviewView } from "../components/ScanReviewView";
import type {
  Bookcase,
  ConfigStatus,
  ConfirmScanBookItem,
  Shelf,
  ShelfBook,
  ShelfScan,
  ShelfScanSummary,
} from "../types/library";

interface ScanPageProps {
  bookcases: Bookcase[];
  configStatus: ConfigStatus | null;
  initialShelfId: number | null;
  onBookcasesChanged: () => Promise<void>;
  onGoToBookcases: () => void;
}

export function ScanPage({
  bookcases,
  configStatus,
  initialShelfId,
  onBookcasesChanged,
  onGoToBookcases,
}: ScanPageProps) {
  // Find initial bookcase + shelf
  const allShelves = useMemo(
    () =>
      bookcases.flatMap((bc) =>
        bc.shelves.map((shelf) => ({ bookcase: bc, shelf }))
      ),
    [bookcases]
  );

  const [selectedShelfId, setSelectedShelfId] = useState<number | null>(() => {
    if (initialShelfId && allShelves.some((x) => x.shelf.id === initialShelfId)) {
      return initialShelfId;
    }
    return allShelves[0]?.shelf.id ?? null;
  });

  useEffect(() => {
    if (initialShelfId && allShelves.some((x) => x.shelf.id === initialShelfId)) {
      setSelectedShelfId(initialShelfId);
    } else if (
      selectedShelfId === null ||
      !allShelves.some((x) => x.shelf.id === selectedShelfId)
    ) {
      setSelectedShelfId(allShelves[0]?.shelf.id ?? null);
    }
  }, [initialShelfId, allShelves, selectedShelfId]);

  const selectedPair = useMemo(
    () => allShelves.find((x) => x.shelf.id === selectedShelfId) ?? null,
    [allShelves, selectedShelfId]
  );

  // Provider selection
  const [selectedProvider, setSelectedProvider] = useState<string>("gemini");
  useEffect(() => {
    if (!configStatus) return;
    const configured = configStatus.providers.filter((p) => p.configured);
    const defaultMatch = configured.find((p) => p.id === configStatus.default_provider);
    if (defaultMatch) {
      setSelectedProvider(defaultMatch.id);
    } else if (configured.length > 0) {
      setSelectedProvider(configured[0].id);
    } else {
      setSelectedProvider(configStatus.default_provider || "gemini");
    }
  }, [configStatus]);

  // Selected image file & preview
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Active scan under review
  const [activeScan, setActiveScan] = useState<ShelfScan | null>(null);

  // History & current books on selected shelf
  const [recentScans, setRecentScans] = useState<ShelfScanSummary[]>([]);
  const [shelfBooks, setShelfBooks] = useState<ShelfBook[]>([]);
  const [loadingShelfDetails, setLoadingShelfDetails] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const loadShelfDetails = useCallback(async (shelfId: number) => {
    setLoadingShelfDetails(true);
    try {
      const [scansData, booksData] = await Promise.all([
        api.listShelfScans(shelfId),
        api.listShelfBooks(shelfId),
      ]);
      setRecentScans(scansData);
      setShelfBooks(booksData);
    } catch {
      // keep previous state on transient error
    } finally {
      setLoadingShelfDetails(false);
    }
  }, []);

  useEffect(() => {
    if (selectedShelfId != null) {
      void loadShelfDetails(selectedShelfId);
    } else {
      setRecentScans([]);
      setShelfBooks([]);
    }
  }, [selectedShelfId, loadShelfDetails]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
    setSuccessBanner(null);
  };

  const handleAnalyze = async () => {
    if (!selectedShelfId || !selectedFile) return;
    setError(null);
    setSuccessBanner(null);
    setAnalyzing(true);
    try {
      const scan = await api.uploadShelfScan(selectedShelfId, selectedFile, selectedProvider);
      setActiveScan(scan);
      setSelectedFile(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      await loadShelfDetails(selectedShelfId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo analizar la foto de la balda.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleOpenScan = async (scanId: number) => {
    setError(null);
    try {
      const scan = await api.getScan(scanId);
      setActiveScan(scan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el escaneo.");
    }
  };

  const handleDeleteScan = async (scanId: number) => {
    if (!window.confirm("¿Eliminar este escaneo y su foto?")) return;
    try {
      await api.deleteScan(scanId);
      if (selectedShelfId != null) {
        await loadShelfDetails(selectedShelfId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el escaneo.");
    }
  };

  const handleConfirmScan = async (replaceExisting: boolean, books: ConfirmScanBookItem[]) => {
    if (!activeScan) return;
    const res = await api.confirmScan(activeScan.id, replaceExisting, books);
    setActiveScan(null);
    setSuccessBanner(
      `Guardados ${res.confirmed_count} ${res.confirmed_count === 1 ? "libro" : "libros"} en ${selectedPair?.shelf.label ?? "la balda"}. Total en la balda: ${res.books.length}.`
    );
    await Promise.all([
      onBookcasesChanged(),
      loadShelfDetails(res.shelf_id),
    ]);
  };

  // Empty state if user has no shelves yet
  if (allShelves.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-900">
          <Camera className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-stone-900">Primero crea una estantería</h2>
        <p className="mt-2 text-sm text-stone-600">
          Para escanear tus libros necesitas tener al menos una estantería con sus baldas y medidas
          registradas.
        </p>
        <button
          type="button"
          onClick={onGoToBookcases}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-800 cursor-pointer"
        >
          Ir a Estanterías
        </button>
      </div>
    );
  }

  // Review mode
  if (activeScan && selectedPair) {
    return (
      <ScanReviewView
        scan={activeScan}
        shelf={selectedPair.shelf}
        bookcaseName={selectedPair.bookcase.name}
        onBack={() => setActiveScan(null)}
        onConfirm={handleConfirmScan}
      />
    );
  }

  const providers = configStatus?.providers ?? [];
  const hasAnyConfiguredProvider = providers.some((p) => p.configured);
  const currentShelf: Shelf | null = selectedPair?.shelf ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-stone-900">Escanear balda</h2>
        <p className="mt-1 text-sm text-stone-600">
          Haz una foto frontal de una balda a la vez para máxima precisión. Después podrás revisar
          los lomos dudosos o confirmarlos con su código ISBN.
        </p>
      </div>

      {!hasAnyConfiguredProvider && configStatus && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-950">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-700 mt-0.5" />
          <div>
            <p className="font-semibold">Configura al menos un proveedor de IA en tu archivo .env</p>
            <p className="mt-0.5 text-xs text-amber-900/90">
              Copia <code className="rounded bg-amber-100 px-1 py-0.5">.env.example</code> a{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5">.env</code>, añade{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5">GEMINI_API_KEY</code> o{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5">STRATA_BASE_URL</code> +{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5">STRATA_API_KEY</code>, y reinicia
              el servidor backend.
            </p>
          </div>
        </div>
      )}

      {successBanner && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <span>{successBanner}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Main capture panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 rounded-2xl border border-stone-200 bg-white p-5 shadow-xs space-y-5">
          {/* 1. Shelf selector */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-stone-800">
              1. Elige la balda a fotografiar
            </label>
            <select
              value={selectedShelfId ?? ""}
              onChange={(e) => {
                setSelectedShelfId(Number(e.target.value));
                setSuccessBanner(null);
                setError(null);
              }}
              className="w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/15"
            >
              {bookcases.map((bc) => (
                <optgroup
                  key={bc.id}
                  label={`${bc.name}${bc.location ? ` (${bc.location})` : ""}`}
                >
                  {bc.shelves.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} — {s.width_cm} × {s.height_cm} cm ({s.book_count}{" "}
                      {s.book_count === 1 ? "libro" : "libros"})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* 2. AI Provider selector */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-stone-800">
              2. Modelo de visión IA
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {providers.map((p) => {
                const isSelected = selectedProvider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProvider(p.id)}
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
                      {p.model}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Capture / Upload photo */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-stone-800">
              3. Captura o sube la foto de la balda
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-amber-800/35 bg-amber-50/50 px-4 py-4 text-sm font-semibold text-amber-950 hover:bg-amber-50 transition-colors cursor-pointer">
                <Camera className="h-5 w-5 text-amber-800" />
                <span>Hacer foto con cámara</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              <label className="flex items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-stone-300 bg-stone-50/70 px-4 py-4 text-sm font-semibold text-stone-800 hover:bg-stone-100/70 transition-colors cursor-pointer">
                <ImageUp className="h-5 w-5 text-stone-600" />
                <span>Subir desde galería / PC</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            {previewUrl && (
              <div className="space-y-3 pt-1">
                <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-900">
                  <img
                    src={previewUrl}
                    alt="Vista previa de la balda"
                    className="max-h-72 w-full object-contain mx-auto"
                  />
                </div>

                <button
                  type="button"
                  disabled={analyzing}
                  onClick={() => void handleAnalyze()}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-900 px-5 py-3 text-sm font-semibold text-white shadow-xs hover:bg-amber-800 disabled:opacity-60 cursor-pointer"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Analizando lomos con {selectedProvider}...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      <span>Analizar balda con IA</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right column: Recent scans & current books in selected shelf */}
        <div className="lg:col-span-5 space-y-5">
          {/* Recent scans */}
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-stone-900 flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-800" />
                <span>Escaneos recientes de {currentShelf?.label}</span>
              </h3>
              {loadingShelfDetails && (
                <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
              )}
            </div>

            {recentScans.length === 0 ? (
              <p className="text-xs text-stone-500">
                Todavía no hay escaneos guardados para esta balda.
              </p>
            ) : (
              <div className="space-y-2.5">
                {recentScans.map((sc) => (
                  <div
                    key={sc.id}
                    className="flex items-center gap-3 rounded-xl border border-stone-200 p-2.5 hover:border-amber-700/40 transition-colors"
                  >
                    <img
                      src={sc.image_url}
                      alt={`Escaneo ${sc.id}`}
                      className="h-12 w-16 shrink-0 rounded-lg object-cover border border-stone-200 bg-stone-100"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-stone-800">
                          {sc.candidate_count}{" "}
                          {sc.candidate_count === 1 ? "libro" : "libros"}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            sc.status === "confirmed"
                              ? "bg-emerald-100 text-emerald-800"
                              : sc.status === "error"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {sc.status === "confirmed"
                            ? "Confirmado"
                            : sc.status === "error"
                              ? "Error"
                              : "Pendiente"}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500 truncate">
                        {sc.ai_provider} · {new Date(sc.created_at).toLocaleString("es-ES")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleOpenScan(sc.id)}
                        className="rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-amber-100 hover:text-amber-900 cursor-pointer"
                      >
                        Revisar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteScan(sc.id)}
                        title="Eliminar escaneo"
                        className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Current books placed in this shelf */}
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs space-y-3">
            <h3 className="text-sm font-semibold text-stone-900 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-amber-800" />
              <span>
                Libros en {currentShelf?.label} ({shelfBooks.length})
              </span>
            </h3>

            {shelfBooks.length === 0 ? (
              <p className="text-xs text-stone-500">
                Esta balda aún no tiene libros confirmados.
              </p>
            ) : (
              <ol className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {shelfBooks.map((b, idx) => (
                  <li
                    key={b.placement_id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-stone-400 mr-2">{idx + 1}.</span>
                      <span className="font-medium text-stone-800">{b.title}</span>
                      {b.authors.length > 0 && (
                        <span className="text-stone-500"> — {b.authors.join(", ")}</span>
                      )}
                    </div>
                    {b.reading_status === "unread" && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                        Pendiente
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
