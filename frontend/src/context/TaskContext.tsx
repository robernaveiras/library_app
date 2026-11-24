import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import type { NavTab } from "../components/Layout";
import type {
  AISuggestionScheme,
  ShelfScan,
  TagEvaluationResponse,
} from "../types/library";

export interface BackgroundTask {
  id: string;
  key: string;
  label: string;
  tab: NavTab;
  status: "running" | "success" | "error";
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

interface RunTaskOptions<T> {
  key: string;
  label: string;
  tab: NavTab;
  run: () => Promise<T>;
  formatSuccess?: (result: T) => string;
  onSuccess?: (result: T) => void | Promise<void>;
}

interface TaskContextValue {
  tasks: BackgroundTask[];
  dataVersion: number;
  pendingScan: ShelfScan | null;
  setPendingScan: (scan: ShelfScan | null) => void;
  pendingTagEvaluation: TagEvaluationResponse | null;
  setPendingTagEvaluation: (ev: TagEvaluationResponse | null) => void;
  pendingOrgSuggestions: AISuggestionScheme[];
  setPendingOrgSuggestions: (items: AISuggestionScheme[]) => void;
  isTaskRunning: (keyPrefix: string) => boolean;
  runTask: <T>(options: RunTaskOptions<T>) => Promise<T | null>;
  dismissTask: (taskId: string) => void;
  bumpDataVersion: () => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [dataVersion, setDataVersion] = useState(0);

  // Persisted async results across tab unmounts so nothing is ever lost when navigating away
  const [pendingScan, setPendingScan] = useState<ShelfScan | null>(null);
  const [pendingTagEvaluation, setPendingTagEvaluation] =
    useState<TagEvaluationResponse | null>(null);
  const [pendingOrgSuggestions, setPendingOrgSuggestions] = useState<AISuggestionScheme[]>([]);

  const bumpDataVersion = useCallback(() => {
    setDataVersion((v) => v + 1);
  }, []);

  const dismissTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const isTaskRunning = useCallback(
    (keyPrefix: string) =>
      tasks.some((t) => t.status === "running" && t.key.startsWith(keyPrefix)),
    [tasks]
  );

  const runTask = useCallback(
    async <T,>({
      key,
      label,
      tab,
      run,
      formatSuccess,
      onSuccess,
    }: RunTaskOptions<T>): Promise<T | null> => {
      const id = `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const entry: BackgroundTask = {
        id,
        key,
        label,
        tab,
        status: "running",
        startedAt: Date.now(),
      };
      // Replace older completed notifications with same key so the bar stays clean
      setTasks((prev) => [
        entry,
        ...prev.filter((t) => !(t.key === key && t.status !== "running")),
      ]);

      try {
        const result = await run();
        const detail = formatSuccess ? formatSuccess(result) : "Completado";
        setTasks((prev) =>
          prev.map((t) =>
            t.id === id
              ? { ...t, status: "success", detail, finishedAt: Date.now() }
              : t
          )
        );
        if (onSuccess) {
          await onSuccess(result);
        }
        setDataVersion((v) => v + 1);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error inesperado en la tarea.";
        setTasks((prev) =>
          prev.map((t) =>
            t.id === id
              ? { ...t, status: "error", detail: msg, finishedAt: Date.now() }
              : t
          )
        );
        return null;
      }
    },
    []
  );

  return (
    <TaskContext.Provider
      value={{
        tasks,
        dataVersion,
        pendingScan,
        setPendingScan,
        pendingTagEvaluation,
        setPendingTagEvaluation,
        pendingOrgSuggestions,
        setPendingOrgSuggestions,
        isTaskRunning,
        runTask,
        dismissTask,
        bumpDataVersion,
      }}
    >
      {children}
    </TaskContext.Provider>
  );
}

export function useTasks(): TaskContextValue {
  const ctx = useContext(TaskContext);
  if (!ctx) {
    throw new Error("useTasks must be used inside TaskProvider");
  }
  return ctx;
}
