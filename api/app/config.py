from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Read from environment or .env; see .env.example at the repository root."""

    model_config = SettingsConfigDict(env_prefix="VUGA_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./vuga_dev.db"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12
    model_dir: str = "../ml/artifacts"
    default_model: str = "kn_trigram.json"
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
