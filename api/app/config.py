from secrets import token_urlsafe
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Read from environment or .env; see .env.example at the repository root."""

    model_config = SettingsConfigDict(env_prefix="VUGA_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./vuga_dev.db"
    # Local development works without a known public signing key. Set a persistent
    # secret in deployment so tokens survive restarts and work across workers.
    jwt_secret: str = Field(default_factory=lambda: token_urlsafe(48), min_length=32)
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12
    model_dir: str = "../ml/artifacts"
    default_model: str = "kn_trigram.json"
    cors_origins: list[str] = ["http://localhost:5173"]
    # A caregiver's backup holds children's codes, word lists and settings, a few kilobytes; photos
    # and recordings stay on the device (schemas.BackupData).
    max_backup_bytes: int = 1024 * 1024
    # The codes that confirm a caregiver's mobile number go out through Africa's Talking once an
    # API key is set; the username "sandbox" uses their free sandbox and its phone simulator.
    # Without a key, local development may write codes to the log. Public deployments disable
    # that fallback and refuse SMS requests until a provider is configured.
    sms_log_enabled: bool = True
    africastalking_username: str = "sandbox"
    africastalking_api_key: str | None = None
    africastalking_sender_id: str | None = None  # a registered sender name, if the account has one
    # Firebase Email/Password (Spark). The web API key is public project configuration, not an
    # admin credential. It is also used server-side to check current account state and erase it.
    firebase_project_id: str | None = None
    firebase_api_key: str | None = None
    # Switching providers is explicit: Firebase tokens are rejected while Neon is active.
    email_auth_provider: Literal["firebase", "neon"] = "firebase"
    neon_auth_url: str | None = None
    neon_auth_origin: str | None = None
    # Enable only after self-service deletion has been confirmed on this Neon branch.
    neon_delete_enabled: bool = False


settings = Settings()
