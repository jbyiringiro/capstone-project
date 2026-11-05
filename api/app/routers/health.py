from fastapi import APIRouter

from ..dependencies import ServedModel, Sms
from ..services.firebase_auth import firebase_auth

router = APIRouter(tags=["health"])


@router.get("/health")
def health(model: ServedModel, sms: Sms) -> dict:
    # `sms` says where codes go (sms, simulator, log or off), so a host's set-up can be checked
    # without texting anyone; it never names the provider account or key.
    return {"status": "ok", "model_loaded": model is not None, "sms": getattr(sms, "delivery", "off"),
            "email": "firebase" if firebase_auth.configured else "off"}
