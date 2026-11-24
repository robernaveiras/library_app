import { useCallback, useEffect, useState } from "react";
import { api } from "./api/client";
import { Layout, type NavTab } from "./components/Layout";
import { TaskProvider, useTasks } from "./context/TaskContext";
import { BookcasesPage } from "./pages/BookcasesPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { InventoryPage } from "./pages/InventoryPage";
import { OrganizePage } from "./pages/OrganizePage";
import { ScanPage } from "./pages/ScanPage";
import type { AISelection, Bookcase, ConfigStatus, Shelf } from "./types/library";
import {
  buildUrlForRoute,
  parseRouteFromLocation,
  type RouteState,
} from "./utils/navigation";

function AppShell() {
  const { dataVersion } = useTasks();

  const [route, setRoute] = useState<RouteState>(() => parseRouteFromLocation());
  const [bookcases, setBookcases] = useState<Bookcase[]>([]);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [aiSelection, setAiSelection] = useState<AISelection>({
    provider: "gemini",
    model: "gemini-2.5-flash",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Normalize initial root path without creating a duplicate history entry
  useEffect(() => {
    const targetUrl = buildUrlForRoute(route);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl === "/" || currentUrl === "") {
      window.history.replaceState(route, "", targetUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen to browser / mobile Back & Forward navigation
  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRouteFromLocation());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: Partial<RouteState> & { tab: NavTab }) => {
    const resolved: RouteState = {
      tab: next.tab,
      shelfId: next.shelfId ?? null,
      genre: next.genre,
      tagId: next.tagId,
    };
    const nextUrl = buildUrlForRoute(resolved);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.pushState(resolved, "", nextUrl);
    }
    setRoute(resolved);
  }, []);

  const handleSelectTab = useCallback(
    (tab: NavTab) => {
      navigate({ tab });
    },
    [navigate]
  );

  const handleAiSelectionChange = useCallback((next: AISelection) => {
    setAiSelection(next);
    try {
      window.localStorage.setItem("library_ai_provider", next.provider);
      if (next.model.trim()) {
        window.localStorage.setItem(`library_ai_model_${next.provider}`, next.model.trim());
      }
    } catch {
      // ignore storage quota errors
    }
  }, []);

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
  }, [loadBookcases, dataVersion]);

  useEffect(() => {
    api
      .getConfigStatus()
      .then((status) => {
        setConfigStatus(status);
        const savedProvider = window.localStorage.getItem("library_ai_provider");
        const configured = status.providers.filter((p) => p.configured);
        const chosenProvider =
          status.providers.find((p) => p.id === savedProvider)?.id ||
          configured.find((p) => p.id === status.default_provider)?.id ||
          configured[0]?.id ||
          status.default_provider ||
          "gemini";
        const providerInfo = status.providers.find((p) => p.id === chosenProvider);
        const savedModel = window.localStorage.getItem(`library_ai_model_${chosenProvider}`);
        setAiSelection({
          provider: chosenProvider,
          model: savedModel || providerInfo?.model || "",
        });
      })
      .catch(() => {
        // Non-blocking status badge
      });
  }, []);

  const handleScanShelf = (shelf: Shelf) => {
    navigate({ tab: "scan", shelfId: shelf.id });
  };

  const handleJumpToInventory = (filter: { genre?: string; tagId?: number }) => {
    navigate({ tab: "inventory", genre: filter.genre, tagId: filter.tagId });
  };

  const handleClearInventoryFilter = useCallback(() => {
    // Keep URL clean when filters are cleared
    setRoute((prev) =>
      prev.genre || prev.tagId != null
        ? { ...prev, genre: undefined, tagId: undefined }
        : prev
    );
  }, []);

  const inventoryFilter =
    route.genre || route.tagId != null
      ? { genre: route.genre, tagId: route.tagId }
      : null;

  return (
    <Layout
      activeTab={route.tab}
      onSelectTab={handleSelectTab}
      configStatus={configStatus}
    >
      {route.tab === "bookcases" ? (
        <BookcasesPage
          bookcases={bookcases}
          loading={loading}
          error={error}
          onRefresh={loadBookcases}
          onScanShelf={handleScanShelf}
        />
      ) : route.tab === "scan" ? (
        <ScanPage
          bookcases={bookcases}
          configStatus={configStatus}
          aiSelection={aiSelection}
          onAiSelectionChange={handleAiSelectionChange}
          initialShelfId={route.shelfId}
          onBookcasesChanged={loadBookcases}
          onGoToBookcases={() => handleSelectTab("bookcases")}
        />
      ) : route.tab === "inventory" ? (
        <InventoryPage
          bookcases={bookcases}
          initialFilter={inventoryFilter}
          onClearInitialFilter={handleClearInventoryFilter}
          onBookcasesChanged={loadBookcases}
        />
      ) : route.tab === "categories" ? (
        <CategoriesPage
          configStatus={configStatus}
          aiSelection={aiSelection}
          onAiSelectionChange={handleAiSelectionChange}
          onJumpToInventory={handleJumpToInventory}
        />
      ) : (
        <OrganizePage
          bookcases={bookcases}
          configStatus={configStatus}
          aiSelection={aiSelection}
          onAiSelectionChange={handleAiSelectionChange}
          onBookcasesChanged={loadBookcases}
        />
      )}
    </Layout>
  );
}

export default function App() {
  return (
    <TaskProvider>
      <AppShell />
    </TaskProvider>
  );
}
