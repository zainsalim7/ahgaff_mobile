"""📬 الملخص الأسبوعي للوحة القيادة — توليد PDF لكل نطاق وإرساله دفعاً كل سبت صباحاً (+ إرسال يدوي / Cloud Scheduler)"""
import os
import re
import hmac
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import FileResponse
from bson import ObjectId

from .deps import get_db, get_current_user, build_user_context, export_headers
from .management_dashboard import build_dashboard, _build_pdf, _is_management, PERIOD_LABELS
from models.permissions import UserRole

router = APIRouter()
logger = logging.getLogger("weekly_digest")

YEMEN_TZ = timezone(timedelta(hours=3))
DIGEST_WEEKDAY = 5          # السبت
DIGEST_HOUR = 7             # 07:00 بتوقيت اليمن
RECIPIENT_ROLES = [UserRole.UNIVERSITY_PRESIDENT, UserRole.ADMIN, "dean", "department_head"]
DIGEST_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads", "digests")
ROUTE = "/dashboard-digests"


def _scope_key(u: dict) -> str:
    if u["role"] in (UserRole.ADMIN, UserRole.UNIVERSITY_PRESIDENT):
        return "all"
    if u["role"] == "dean":
        return "fac:" + ",".join(sorted(u.get("faculty_ids") or []))
    return "dept:" + ",".join(sorted(u.get("department_ids") or []))


def _safe(name: str) -> str:
    return re.sub(r"[^\w\u0600-\u06FF\- ]+", "", name).strip() or "scope"


async def _push(db, user_id: str, title: str, body: str, data: dict):
    tokens = await db.fcm_tokens.find({"user_id": user_id}).to_list(20)
    if not tokens:
        return 0
    try:
        from services.firebase_service import send_notification
    except Exception:
        return 0
    sent = 0
    for t in tokens:
        try:
            ok = await send_notification(t["token"], title, body, {k: str(v) for k, v in data.items()})
            sent += 1 if ok else 0
        except Exception as e:
            logger.warning(f"push failed for {user_id}: {e}")
    return sent


async def generate_and_send_digest(db, trigger: str = "scheduled", only_user_id: Optional[str] = None) -> dict:
    """يولّد ملخص «آخر 7 أيام» لكل نطاق مختلف بين المستلمين ويُرسل الإشعارات"""
    q = {"role": {"$in": RECIPIENT_ROLES}, "is_active": {"$ne": False}}
    if only_user_id:
        q = {"_id": ObjectId(only_user_id)}
    users = await db.users.find(q).to_list(500)
    contexts = [await build_user_context(db, u) for u in users]
    now = datetime.now(YEMEN_TZ).replace(tzinfo=None)
    week_end = now.date().isoformat()
    week_start = (now.date() - timedelta(days=6)).isoformat()
    os.makedirs(os.path.join(DIGEST_DIR, week_end), exist_ok=True)

    groups: dict = {}
    for c in contexts:
        groups.setdefault(_scope_key(c), []).append(c)

    results, pushed = [], 0
    for key, members in groups.items():
        rep = members[0]
        try:
            d = await build_dashboard(db, rep, "week", None, None)
            pdf = _build_pdf(d)
        except Exception as e:
            logger.error(f"digest build failed for scope {key}: {e}")
            continue
        label = d["scope"]["label"]
        fname = f"لوحة القيادة - {_safe(label)} - أسبوع {week_end}.pdf"
        path = os.path.join(DIGEST_DIR, week_end, f"{_safe(key).replace(':', '_').replace(',', '_')}.pdf")
        with open(path, "wb") as f:
            f.write(pdf.getvalue())
        n = d["numbers"]
        alerts_n = sum(1 for a in d["alerts"] if a["level"] in ("danger", "warning"))
        summary = {"students": n["students"], "lectures": n["lectures_period"], "completed": n["lectures_status"].get("completed", 0),
                   "cancelled": n["lectures_status"].get("cancelled", 0) + n["lectures_status"].get("absent", 0),
                   "attendance_rate": n["attendance_rate"], "alerts": alerts_n,
                   "pending_fees": next((a["count"] for a in d["alerts"] if a["key"] == "pending_fees"), None)}
        recipients = [m["id"] for m in members]
        doc = {"week_start": week_start, "week_end": week_end, "scope_key": key, "scope_label": label,
               "file_path": path, "filename": fname, "summary": summary, "recipients": recipients,
               "trigger": trigger, "created_at": datetime.now(timezone.utc)}
        # نفس الأسبوع ونفس النطاق → نحدّث بدل التكرار
        existing = await db.dashboard_digests.find_one({"week_end": week_end, "scope_key": key})
        if existing:
            await db.dashboard_digests.update_one({"_id": existing["_id"]}, {"$set": doc})
            digest_id = str(existing["_id"])
        else:
            digest_id = str((await db.dashboard_digests.insert_one(doc)).inserted_id)

        rate = f"{summary['attendance_rate']}%" if summary["attendance_rate"] is not None else "—"
        title = f"📊 ملخص الأسبوع — {label}"
        body = f"الحضور {rate} · محاضرات منفَّذة {summary['completed']}/{summary['lectures']} · تنبيهات {alerts_n}"
        for m in members:
            pushed += await _push(db, m["id"], title, body, {"type": "weekly_digest", "route": ROUTE, "digest_id": digest_id})
        results.append({"digest_id": digest_id, "scope": label, "recipients": len(members), "summary": summary})

    await db.digest_state.update_one({"_id": "weekly"}, {"$set": {"last_week_end": week_end, "last_run_at": datetime.now(timezone.utc), "trigger": trigger}}, upsert=True)
    logger.info(f"weekly digest done: {len(results)} scopes, {pushed} pushes ({trigger})")
    return {"week_start": week_start, "week_end": week_end, "scopes": results, "pushes": pushed}


async def weekly_digest_loop():
    """حلقة خلفية: كل دقيقة تفحص هل حان موعد السبت 07:00 (اليمن) ولم يُرسل لهذا الأسبوع بعد"""
    await asyncio.sleep(20)
    while True:
        try:
            now = datetime.now(YEMEN_TZ)
            if now.weekday() == DIGEST_WEEKDAY and now.hour == DIGEST_HOUR:
                db = get_db()
                st = await db.digest_state.find_one({"_id": "weekly"}) or {}
                if st.get("last_week_end") != now.date().isoformat():
                    await generate_and_send_digest(db, trigger="scheduled")
        except Exception as e:
            logger.error(f"weekly digest loop error: {e}")
        await asyncio.sleep(60)


def _ensure_management(user: dict):
    if not _is_management(user):
        raise HTTPException(status_code=403, detail="متاح للإدارة فقط")


@router.get("/dashboard/digests")
async def list_digests(limit: int = 30, current_user: dict = Depends(get_current_user)):
    _ensure_management(current_user)
    db = get_db()
    q = {} if current_user["role"] == UserRole.ADMIN else {"recipients": current_user["id"]}
    out = []
    async for d in db.dashboard_digests.find(q).sort([("week_end", -1), ("scope_label", 1)]).limit(limit):
        out.append({"id": str(d["_id"]), "week_start": d["week_start"], "week_end": d["week_end"], "scope_label": d["scope_label"],
                    "filename": d["filename"], "summary": d.get("summary", {}), "trigger": d.get("trigger"),
                    "recipients": len(d.get("recipients", [])), "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else ""})
    st = await db.digest_state.find_one({"_id": "weekly"}) or {}
    return {"digests": out, "schedule": {"weekday": "السبت", "hour": f"{DIGEST_HOUR:02d}:00", "period": PERIOD_LABELS["week"],
                                         "last_run": st.get("last_run_at").isoformat() if isinstance(st.get("last_run_at"), datetime) else None},
            "can_send_now": current_user["role"] == UserRole.ADMIN}


@router.get("/dashboard/digests/{digest_id}/file")
async def digest_file(digest_id: str, current_user: dict = Depends(get_current_user)):
    _ensure_management(current_user)
    db = get_db()
    if not ObjectId.is_valid(digest_id):
        raise HTTPException(status_code=404, detail="غير موجود")
    d = await db.dashboard_digests.find_one({"_id": ObjectId(digest_id)})
    if not d or (current_user["role"] != UserRole.ADMIN and current_user["id"] not in d.get("recipients", [])):
        raise HTTPException(status_code=404, detail="غير موجود")
    if not os.path.exists(d["file_path"]):
        raise HTTPException(status_code=410, detail="ملف الملخص لم يعد متاحاً")
    return FileResponse(d["file_path"], media_type="application/pdf", headers=export_headers(quote(d["filename"])))


@router.post("/dashboard/digests/send-now")
async def send_now(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="الإرسال اليدوي للمدير فقط")
    return await generate_and_send_digest(get_db(), trigger="manual")


@router.post("/internal/weekly-digest")
async def internal_weekly_digest(x_internal_key: Optional[str] = Header(None)):
    """لـ Cloud Scheduler: يستدعى كل سبت بمفتاح INTERNAL_PUSH_KEY"""
    expected = os.environ.get("INTERNAL_PUSH_KEY")
    if not expected:
        raise HTTPException(status_code=503, detail="INTERNAL_PUSH_KEY غير مُهيّأ")
    if not x_internal_key or not hmac.compare_digest(x_internal_key, expected):
        raise HTTPException(status_code=401, detail="unauthorized")
    return await generate_and_send_digest(get_db(), trigger="scheduler")
