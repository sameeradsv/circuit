from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Blackout, CircuitTask
from app.services.blackout import reschedule_tasks_for_blackout

_IST = ZoneInfo("Asia/Kolkata")


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def test_blackout_reschedule_moves_lower_weight_conflict():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        blackout = Blackout(
            user_id=1,
            blackout_type="travelling",
            start_date_ms=_ms(datetime(2035, 1, 5, 0, 0, tzinfo=_IST)),
            end_date_ms=_ms(datetime(2035, 1, 5, 23, 59, tzinfo=_IST)),
            is_active=True,
        )
        parked = CircuitTask(
            user_id=1,
            text="Low value admin",
            scheduled_at=_ms(datetime(2035, 1, 5, 9, 0, tzinfo=_IST)),
            duration=60,
            blackout_skip_flags='["travelling"]',
            importance=0.2,
            urgency=0.2,
            consequence_of_delay=0.1,
            effort="low",
        )
        important = CircuitTask(
            user_id=1,
            text="Important meeting",
            scheduled_at=_ms(datetime(2035, 1, 6, 9, 0, tzinfo=_IST)),
            duration=60,
            importance=1.0,
            urgency=1.0,
            consequence_of_delay=1.0,
            time_sensitivity=1.0,
            effort="high",
        )
        db.add_all([blackout, parked, important])
        db.commit()

        moved = reschedule_tasks_for_blackout(1, blackout, db)
        db.refresh(parked)
        db.refresh(important)

    assert moved == 1
    assert important.scheduled_at == _ms(datetime(2035, 1, 6, 9, 0, tzinfo=_IST))
    assert parked.scheduled_at != important.scheduled_at
    assert parked.scheduled_at > important.scheduled_at
