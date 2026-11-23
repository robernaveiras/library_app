import { useCallback, useEffect, useState } from "react";
import { api } from "./api/client";
import { Layout, type NavTab } from "./components/Layout";
import { BookcasesPage } from "./pages/BookcasesPage";
import { ComingSoonPage } from "./pages/ComingSoonPage";
import { ScanPage } from "./pages/ScanPage";
import type { Bookcase, ConfigStatus, Shelf } from "./types/library";

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>("bookcases");
  const [scanTargetShelfId, setScanTargetShelfId] = useState<number | null>(null);
  const [bookcases, setBookcases] = useState<Bookcase[]>([]);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBookcases = useCallback(async () => {
    setError(null);
    try {
      const data = await api.listBookcases();
      setBookcases(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo conectar con el servidor de la biblioteca."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBookcases();
    api
      .getConfigStatus()
      .then(setConfigStatus)
      .catch(() => {
        // Non-blocking status badge
      });
  }, [loadBookcases]);

  const handleScanShelf = (shelf: Shelf) => {
    setScanTargetShelfId(shelf.id);
    setActiveTab("scan");
  };

  return (
    <Layout
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      configStatus={configStatus}
    >
      {activeTab === "bookcases" ? (
        <BookcasesPage
          bookcases={bookcases}
          loading={loading}
          error={error}
          onRefresh={loadBookcases}
          onScanShelf={handleScanShelf}
        />
      ) : activeTab === "scan" ? (
        <ScanPage
          bookcases={bookcases}
          configStatus={configStatus}
          initialShelfId={scanTargetShelfId}
          onBookcasesChanged={loadBookcases}
          onGoToBookcases={() => setActiveTab("bookcases")}
        />
      ) : (
        <ComingSoonPage tab={activeTab} />
      )}
    </Layout>
  );
}
