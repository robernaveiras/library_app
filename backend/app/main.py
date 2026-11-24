import logging
import sys
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.routers import bookcases, books, health, organization, scans, tags


def _configure_logging() -> None:
    level_name = (settings.log_level or "DEBUG").upper()
    level = getattr(logging, level_name, logging.DEBUG)
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
        force=True,
    )
    logging.getLogger("app").setLevel(level)
    logging.getLogger("httpx").setLevel(logging.INFO)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


_configure_logging()
logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.resolved_data_dir.mkdir(parents=True, exist_ok=True)
    settings.scans_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    logger.info(
        "Biblioteca API iniciada (log_level=%s, default_provider=%s, gemini_model=%s, strata_url=%s, strata_model=%s)",
        settings.log_level,
        settings.default_ai_provider,
        settings.gemini_model,
        settings.strata_base_url or "<sin configurar>",
        settings.strata_model,
    )
    yield


app = FastAPI(
    title="Biblioteca Personal API",
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    query = f"?{request.url.query}" if request.url.query else ""
    logger.debug("--> %s %s%s", request.method, request.url.path, query)
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.exception(
            "<-- %s %s%s UNHANDLED ERROR (%.1f ms)",
            request.method,
            request.url.path,
            query,
            elapsed_ms,
        )
        raise
    elapsed_ms = (time.perf_counter() - start) * 1000
    logger.debug(
        "<-- %s %s%s %s (%.1f ms)",
        request.method,
        request.url.path,
        query,
        response.status_code,
        elapsed_ms,
    )
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(bookcases.router)
app.include_router(scans.router)
app.include_router(books.router)
app.include_router(tags.router)
app.include_router(organization.router)

# Serve built frontend in production / single-port local mode
if settings.frontend_dist_dir.exists():
    assets_dir = settings.frontend_dist_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Ruta API no encontrada")
        candidate = (settings.frontend_dist_dir / full_path).resolve()
        dist_root = settings.frontend_dist_dir.resolve()
        if full_path and candidate.is_relative_to(dist_root) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist_root / "index.html")
