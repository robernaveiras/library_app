import type { NavTab } from "../components/Layout";

export interface RouteState {
  tab: NavTab;
  shelfId: number | null;
  genre?: string;
  tagId?: number;
}

const TAB_TO_PATH: Record<NavTab, string> = {
  bookcases: "/estanterias",
  scan: "/escanear",
  inventory: "/inventario",
  categories: "/categorias",
  organize: "/organizar",
};

const PATH_TO_TAB: Record<string, NavTab> = {
  "/": "bookcases",
  "/estanterias": "bookcases",
  "/escanear": "scan",
  "/inventario": "inventory",
  "/categorias": "categories",
  "/organizar": "organize",
};

export function parseRouteFromLocation(loc: Location = window.location): RouteState {
  const cleanPath = loc.pathname.replace(/\/+$/, "") || "/";
  const tab: NavTab = PATH_TO_TAB[cleanPath] ?? "bookcases";
  const params = new URLSearchParams(loc.search);

  const rawShelf = params.get("shelf");
  const parsedShelf = rawShelf ? Number.parseInt(rawShelf, 10) : NaN;
  const shelfId = Number.isFinite(parsedShelf) ? parsedShelf : null;

  const genre = params.get("genre") || undefined;

  const rawTag = params.get("tag");
  const parsedTag = rawTag ? Number.parseInt(rawTag, 10) : NaN;
  const tagId = Number.isFinite(parsedTag) ? parsedTag : undefined;

  return { tab, shelfId, genre, tagId };
}

export function buildUrlForRoute(route: Partial<RouteState> & { tab: NavTab }): string {
  const basePath = TAB_TO_PATH[route.tab] ?? "/estanterias";
  const params = new URLSearchParams();
  if (route.tab === "scan" && route.shelfId != null) {
    params.set("shelf", String(route.shelfId));
  }
  if (route.tab === "inventory") {
    if (route.genre) params.set("genre", route.genre);
    if (route.tagId != null) params.set("tag", String(route.tagId));
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
