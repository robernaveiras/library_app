from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT_DIR / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_host: str = "0.0.0.0"
    app_port: int = 8000
    data_dir: str = "./data"
    log_level: str = "DEBUG"

    default_ai_provider: str = "gemini"

    # Google Gemini
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # Strata (OpenAI-compatible)
    strata_base_url: str = ""
    strata_api_key: str = ""
    strata_model: str = "Qwen3.8-Flash-Next-Gyro-M"
    strata_timeout_seconds: int = 300
    strata_max_image_edge: int = 1024
    strata_max_tokens: int = 3072
    strata_use_json_mode: bool = False
    strata_enable_thinking: bool = False

    # External book metadata
    google_books_api_key: str = ""

    @property
    def resolved_data_dir(self) -> Path:
        p = Path(self.data_dir)
        if not p.is_absolute():
            p = ROOT_DIR / p
        return p

    @property
    def db_path(self) -> Path:
        return self.resolved_data_dir / "library.db"

    @property
    def scans_dir(self) -> Path:
        return self.resolved_data_dir / "scans"

    @property
    def frontend_dist_dir(self) -> Path:
        return ROOT_DIR / "frontend" / "dist"


settings = Settings()
