from fastapi import APIRouter

from ..config import settings
from ..dependencies import ServedModel, Sms
from ..services.email_accounts import active_email_provider

router = APIRouter(tags=["health"])


@router.get("/health")
def health(model: ServedModel, sms: Sms) -> dict:
    # `sms` says where codes go (sms, simulator, log or off), so a host's set-up can be checked
    # without texting anyone; it never names the provider account or key.
    return {"status": "ok", "model_loaded": model is not None,
            "sms": "off" if settings.email_auth_provider == "neon" else getattr(sms, "delivery", "off"),
            "email": settings.email_auth_provider if active_email_provider().configured else "off"}
