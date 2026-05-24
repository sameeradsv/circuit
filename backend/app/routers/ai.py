from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import User
from app.schemas import AiClassifyRequest, AiClassifyResponse
from app.services.ai import classify_task

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.post("/classify", response_model=AiClassifyResponse)
def classify(
    payload: AiClassifyRequest,
    _user: User = Depends(require_user),
    _db: Session = Depends(get_db),
):
    result = classify_task(payload.text, payload.context)
    return AiClassifyResponse(**result)
