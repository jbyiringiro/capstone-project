from fastapi import APIRouter

from ..dependencies import ServedModel

router = APIRouter(tags=["health"])


@router.get("/health")
def health(model: ServedModel) -> dict:
    return {"status": "ok", "model_loaded": model is not None}
