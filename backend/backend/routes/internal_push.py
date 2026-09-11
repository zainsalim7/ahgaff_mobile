"""🔔 جسر Push داخلي: يستقبل إشعارات من أنظمة داخلية (بوابة الوافدين) ويمررها إلى FCM وشاشة الإشعارات"""
import os
import hmac
import logging
from datetime import datetime, timezone
from typing import Optional, Dict
from fastapi import APIRouter, Header, HTTPException, Depends
from pydantic import BaseModel, Field
from firebase_admin import messaging

from .deps import get_db

router = APIRouter(tags=["داخلي"])
logger = logging.getLogger(__name__)


class InternalPushPayload(BaseModel):
    student_number: Optional[str] = None
    student_id: Optional[str] = None
    title: str
    body: str
    data: Dict[str, str] = Field(default_factory=dict)


def _check_key(x_internal_key: Optional[str] = Header(None)):
    """يُنفَّذ كاعتمادية قبل التحقق من الجسم: مفتاح خاطئ → 401 دائماً"""
    expected = os.environ.get("INTERNAL_PUSH_KEY")
    if not expected:
        raise HTTPException(status_code=503, detail="INTERNAL_PUSH_KEY غير مُهيّأ")
    if not x_internal_key or not hmac.compare_digest(x_internal_key, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


async def _resolve_user_id(db, student_number: str) -> Optional[str]:
    sn = student_number.strip()
    student = await db.students.find_one({"student_id": sn}, {"user_id": 1})
    if student and student.get("user_id"):
        return str(student["user_id"])
    user = await db.users.find_one({"username": sn}, {"_id": 1})
    return str(user["_id"]) if user else None


def _message(token: str, title: str, body: str, data: dict) -> messaging.Message:
    return messaging.Message(
        token=token,
        notification=messaging.Notification(title=title, body=body),
        data=data,
        android=messaging.AndroidConfig(
            priority="high",
            notification=messaging.AndroidNotification(
                title=title, body=body, icon="ic_notification", color="#1b5e20", channel_id="default",
                sound="default", priority="high", default_sound=True, default_vibrate_timings=True, visibility="public",
            ),
        ),
        webpush=messaging.WebpushConfig(
            notification=messaging.WebpushNotification(title=title, body=body, icon="/icon.png", badge="/icon.png"),
            fcm_options=messaging.WebpushFCMOptions(link="https://app.ahgaff.net" + (data.get("route") or "/")),
        ),
    )


@router.post("/internal/push", dependencies=[Depends(_check_key)])
async def internal_push(payload: InternalPushPayload):
    if not (payload.student_number or "").strip():
        raise HTTPException(status_code=422, detail="student_number مطلوب")
    db = get_db()
    user_id = await _resolve_user_id(db, payload.student_number)
    if not user_id:
        return {"sent": 0, "failed": 0, "reason": "student_not_found"}

    data = {str(k): str(v) for k, v in (payload.data or {}).items()}
    data.setdefault("source", "wafideen")
    await db.notifications.insert_one({
        "user_id": user_id, "title": payload.title, "message": payload.body, "type": "general",
        "data": data, "source": data.get("source"), "external_student_id": payload.student_id,
        "is_read": False, "created_at": datetime.now(timezone.utc),
    })

    tokens = await db.fcm_tokens.find({"user_id": user_id}).to_list(50)
    if not tokens:
        return {"sent": 0, "failed": 0, "reason": "no_tokens", "stored": True}

    sent, failed, removed = 0, 0, 0
    for t in tokens:
        if not t.get("token"):
            continue
        try:
            messaging.send(_message(t["token"], payload.title, payload.body, data))
            sent += 1
        except (messaging.UnregisteredError, messaging.SenderIdMismatchError):
            await db.fcm_tokens.delete_one({"_id": t["_id"]})
            removed += 1
            failed += 1
        except Exception as e:
            if "not a valid FCM registration token" in str(e):
                await db.fcm_tokens.delete_one({"_id": t["_id"]})
                removed += 1
            logger.error(f"internal push failed for token {t['token'][:16]}...: {e}")
            failed += 1
    return {"sent": sent, "failed": failed, "removed_tokens": removed, "stored": True}
