import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Barcode, Camera, Check, ImageUp, Loader2, Search, X } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { api } from "../api/client";
import type { IsbnLookupResult } from "../types/library";

interface IsbnScannerModalProps {
  isOpen: boolean;
  initialQuery?: string;
  onClose: () => void;
  onSelectBook: (result: IsbnLookupResult) => void;
}

const BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.CODE_128,
];

export function IsbnScannerModal({
  isOpen,
  initialQuery = "",
  onClose,
  onSelectBook,
}: IsbnScannerModalProps) {
  const scannerElementId = useId().replace(/:/g, "");
  const fileScannerElementId = `${scannerElementId}-file`;

  const [isbnInput, setIsbnInput] = useState(initialQuery);
  const [cameraActive, setCameraActive] = useState(false);
  const [searching, setSearching] = useState(false);
  const [decodingImage, setDecodingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IsbnLookupResult | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isSecure = typeof window !== "undefined" ? window.isSecureContext : false;

  const stopCamera = useCallback(async () => {
    const instance = scannerRef.current;
    scannerRef.current = null;
    setCameraActive(false);
    if (instance) {
      try {
        if (instance.isScanning) {
          await instance.stop();
        }
        instance.clear();
      } catch {
        // ignore stop/clear errors on unmount
      }
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      void stopCamera();
      return;
    }
    setIsbnInput(initialQuery);
    setResult(null);
    setError(null);
    return () => {
      void stopCamera();
    };
  }, [isOpen, initialQuery, stopCamera]);

  const performLookup = useCallback(async (rawCode: string) => {
    const cleaned = rawCode.replace(/[^0-9Xx]/g, "").toUpperCase();
    if (!cleaned) {
      setError("Introduce un ISBN de 10 o 13 dígitos.");
      return;
    }
    setIsbnInput(cleaned);
    setError(null);
    setResult(null);
    setSearching(true);
    try {
      const book = await api.lookupIsbn(cleaned);
      setResult(book);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se encontró el ISBN.");
    } finally {
      setSearching(false);
    }
  }, []);

  const startCamera = async () => {
    if (!isSecure) {
      setError(
        "La cámara en vivo requiere HTTPS en móviles. Usa «Foto del código de barras» o escribe el ISBN."
      );
      return;
    }
    setError(null);
    setCameraActive(true);

    // Wait a tick for the container div to render
    await new Promise((resolve) => setTimeout(resolve, 60));

    try {
      const scanner = new Html5Qrcode(scannerElementId, {
        formatsToSupport: BARCODE_FORMATS,
        verbose: false,
      });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 120 } },
        (decodedText) => {
          void stopCamera();
          void performLookup(decodedText);
        },
        () => {
          // ignore per-frame decode misses
        }
      );
    } catch (err) {
      setCameraActive(false);
      setError(
        err instanceof Error
          ? `No se pudo abrir la cámara: ${err.message}`
          : "No se pudo abrir la cámara."
      );
    }
  };

  const handleBarcodePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setDecodingImage(true);
    const tempScanner = new Html5Qrcode(fileScannerElementId, {
      formatsToSupport: BARCODE_FORMATS,
      verbose: false,
    });
    try {
      const decodedText = await tempScanner.scanFile(file, false);
      tempScanner.clear();
      await performLookup(decodedText);
    } catch {
      try {
        tempScanner.clear();
      } catch {
        // ignore
      }
      setError(
        "No se pudo leer ningún código de barras en esa foto. Acércate un poco más al código o escribe el ISBN."
      );
    } finally {
      setDecodingImage(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-900/55 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-white shadow-xl border border-stone-200 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Barcode className="h-5 w-5 text-amber-800" />
            <h2 className="text-base font-semibold text-stone-900">Buscar o escanear ISBN</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              void stopCamera();
              onClose();
            }}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Manual ISBN input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void performLookup(isbnInput);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              inputMode="numeric"
              value={isbnInput}
              onChange={(e) => setIsbnInput(e.target.value)}
              placeholder="Ej. 9788497596824"
              className="flex-1 rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm font-mono focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/15"
            />
            <button
              type="submit"
              disabled={searching}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50 cursor-pointer"
            >
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span>Buscar</span>
            </button>
          </form>

          {/* Camera & Photo barcode options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {cameraActive ? (
              <button
                type="button"
                onClick={() => void stopCamera()}
                className="flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
                Detener cámara
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startCamera()}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium cursor-pointer ${
                  isSecure
                    ? "border-stone-300 bg-white text-stone-800 hover:bg-stone-50"
                    : "border-stone-200 bg-stone-50 text-stone-500"
                }`}
              >
                <Camera className="h-4 w-4 text-amber-800" />
                <span>Cámara en vivo {!isSecure && "(HTTPS)"}</span>
              </button>
            )}

            <label className="flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50 cursor-pointer">
              {decodingImage ? (
                <Loader2 className="h-4 w-4 animate-spin text-amber-800" />
              ) : (
                <ImageUp className="h-4 w-4 text-amber-800" />
              )}
              <span>{decodingImage ? "Leyendo código..." : "Foto del código"}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleBarcodePhoto}
                className="hidden"
              />
            </label>
          </div>

          {!isSecure && (
            <p className="text-xs text-stone-500">
              Consejo: en red local sin HTTPS, <strong>«Foto del código»</strong> lee el código de
              barras directamente desde la cámara del móvil sin necesidad de certificado.
            </p>
          )}

          {/* Live camera mount */}
          {cameraActive && (
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-950">
              <div id={scannerElementId} className="w-full" />
            </div>
          )}

          {/* Hidden container required by html5-qrcode for file decoding */}
          <div id={fileScannerElementId} className="hidden" />

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Result card */}
          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
              <div className="flex gap-3.5">
                {result.cover_url ? (
                  <img
                    src={result.cover_url}
                    alt={result.title}
                    className="h-24 w-16 shrink-0 rounded-md object-cover border border-stone-200 bg-white"
                  />
                ) : (
                  <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-stone-100 text-[10px] text-stone-400">
                    Sin portada
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-stone-900 leading-snug">
                    {result.title}
                  </h3>
                  {result.subtitle && (
                    <p className="text-xs text-stone-600 line-clamp-1">{result.subtitle}</p>
                  )}
                  <p className="mt-1 text-xs text-stone-700">
                    {result.authors.length > 0 ? result.authors.join(", ") : "Autor desconocido"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-stone-500">
                    {result.publisher && (
                      <span className="rounded bg-white px-1.5 py-0.5 border border-stone-200">
                        {result.publisher}
                      </span>
                    )}
                    {result.published_year && (
                      <span className="rounded bg-white px-1.5 py-0.5 border border-stone-200">
                        {result.published_year}
                      </span>
                    )}
                    {result.page_count && (
                      <span className="rounded bg-white px-1.5 py-0.5 border border-stone-200">
                        {result.page_count} págs.
                      </span>
                    )}
                    <span className="rounded bg-white px-1.5 py-0.5 border border-stone-200 font-mono">
                      {result.isbn_13 || result.isbn_10 || result.isbn}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onSelectBook(result);
                  void stopCamera();
                  onClose();
                }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 cursor-pointer"
              >
                <Check className="h-4 w-4" />
                Usar este libro
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
