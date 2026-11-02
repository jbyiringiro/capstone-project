"""Next-symbol suggestions from the frozen server-side model."""
from fastapi import APIRouter, HTTPException, status

from .. import schemas
from ..dependencies import ServedModel

router = APIRouter(tags=["prediction"])


@router.post("/predict", response_model=schemas.PredictResponse)
def predict(body: schemas.PredictRequest, model: ServedModel):
    if model is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "no model artefact available")
    allowed = set(body.allowed) if body.allowed is not None else None
    return schemas.PredictResponse(suggestions=model.top_k(tuple(body.prefix), body.k, allowed),
                                   model=model.name)
