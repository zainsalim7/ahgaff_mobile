"""📜 سجل تغييرات مقرر: كل ما جرى على محاضراته وخانات جدوله — للتحقيق والمراجعة.
يجمع: إنشاء المحاضرات (متى/من/بأي توليد)، تغييرات الوقت/التاريخ/القاعة/الحالة (lecture_change_log)،
إعادة الجدولة والإلغاء من حقول المحاضرة، وأحداث الجدول الأسبوعي (سجل النشاط) الخاصة بالمقرر.
"""
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from bson import ObjectId

from .deps import get_db, get_current_user, has_permission
from models.permissions import Permission, UserRole

router = APIRouter()

_WD_AR = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]
_ACTION_AR = {
    "manual_update": "تعديل يدوي", "manual_delete": "حذف يدوي", "schedule_day_resync": "مزامنة أوقات (تعديل في الجدول)",
    "resync_lecture_times": "مزامنة أوقات (يدوية)", "schedule_slot_moved": "نقل خانة الجدول", "schedule_slot_deleted": "حذف خانة الجدول",
    "create_schedule_slot": "إضافة خانة للجدول", "update_schedule_slot": "تعديل خانة الجدول", "delete_schedule_slot": "حذف خانة من الجدول",
    "move_schedule_slot": "نقل خانة", "swap_schedule_slots": "تبديل خانتين", "generate_lectures_from_schedule": "توليد محاضرات من الجدول",
    "put_lecture": "تعديل/إعادة جدولة محاضرة", "delete_lecture": "حذف محاضرة", "post_lecture": "إنشاء محاضرة يدوياً",
}
_FIELD_AR = {"start_time": "وقت البداية", "end_time": "وقت النهاية", "date": "التاريخ", "room": "القاعة", "status": "الحالة"}


def _ts(v) -> str:
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v or "")


def _can(user: dict) -> bool:
    return user.get("role") in (UserRole.ADMIN, "registration_manager", "dean", "department_head") or has_permission(user, Permission.MANAGE_SCHEDULE) \
        or has_permission(user, Permission.REPORT_TEACHER_WORKLOAD)


@router.get("/courses/{course_id}/history")
async def course_history(course_id: str, from_date: Optional[str] = None, to_date: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if not _can(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    if not ObjectId.is_valid(course_id):
        raise HTTPException(status_code=400, detail="معرّف غير صالح")
    db = get_db()
    course = await db.courses.find_one({"_id": ObjectId(course_id)})
    if not course:
        raise HTTPException(status_code=404, detail="المقرر غير موجود")
    events = []

    # 1) إنشاء المحاضرات — مجمّعة حسب دفعة الإنشاء (نفس الدقيقة ونفس المنشئ)
    users = {}
    async def _uname(uid: str) -> str:
        if not uid:
            return "النظام"
        if uid not in users:
            u = await db.users.find_one({"_id": ObjectId(uid)}, {"full_name": 1, "username": 1}) if ObjectId.is_valid(uid) else None
            users[uid] = (u or {}).get("full_name") or (u or {}).get("username") or uid
        return users[uid]
    batches: dict = {}
    lectures = await db.lectures.find({"course_id": course_id}).to_list(5000)
    for l in lectures:
        key = (_ts(l.get("created_at"))[:16], l.get("created_by", ""), l.get("generation_range", ""))
        b = batches.setdefault(key, {"dates": [], "times": set(), "past": 0})
        b["dates"].append(l.get("date", ""))
        b["times"].add(f"{l.get('start_time', '')}-{l.get('end_time', '')}")
        if l.get("date", "") < _ts(l.get("created_at"))[:10]:
            b["past"] += 1
    for (at, by, rng), b in batches.items():
        ds = sorted(b["dates"])
        events.append({"at": at, "type": "created", "action_ar": "إنشاء محاضرات" + (" (توليد من الجدول)" if rng else ""), "by": await _uname(by),
                       "summary": f"{len(ds)} محاضرة ({ds[0]} → {ds[-1]})" + (f" · نطاق التوليد {rng}" if rng else "") + (f" · ⚠️ منها {b['past']} بتاريخ ماضٍ وقت الإنشاء" if b["past"] else ""),
                       "details": {"count": len(ds), "times": sorted(b["times"]), "past_dated": b["past"]}})

    # 2) سجل تغييرات المحاضرات
    q = {"course_id": course_id}
    async for ch in db.lecture_change_log.find(q).sort("at", 1):
        parts = [f"{_FIELD_AR.get(k, k)}: {v.get('from') or '—'} ← {v.get('to') or '—'}" for k, v in (ch.get("changes") or {}).items()]
        d = ch.get("date", "")
        try:
            wd = _WD_AR[datetime.strptime(d, "%Y-%m-%d").weekday()]
        except Exception:
            wd = ""
        events.append({"at": _ts(ch.get("at")), "type": "lecture_change", "action_ar": _ACTION_AR.get(ch.get("action"), ch.get("action")), "by": ch.get("by_name") or "النظام",
                       "summary": f"محاضرة {wd} {d}: " + "؛ ".join(parts) + (f" — {ch.get('reason')}" if ch.get("reason") else ""), "lecture_id": ch.get("lecture_id")})

    # 3) حقول المحاضرة نفسها (إعادة جدولة/إلغاء/قفل) — للمحاضرات التي سبقت السجل
    for l in lectures:
        if l.get("last_rescheduled_at"):
            events.append({"at": _ts(l["last_rescheduled_at"]), "type": "reschedule", "action_ar": "إعادة جدولة", "by": l.get("rescheduled_by_name") or "—",
                           "summary": f"من {l.get('last_rescheduled_from') or l.get('original_date') or '؟'} إلى {l.get('date')} {l.get('start_time')} ({l.get('reschedule_note') or ''})".strip(), "lecture_id": str(l["_id"])})
        if l.get("cancelled_at"):
            events.append({"at": _ts(l["cancelled_at"]), "type": "cancel", "action_ar": "إلغاء محاضرة", "by": l.get("cancelled_by_name") or "—",
                           "summary": f"{l.get('date')} {l.get('start_time')} — {l.get('cancellation_reason') or ''}", "lecture_id": str(l["_id"])})
        if l.get("time_locked_at"):
            events.append({"at": _ts(l["time_locked_at"]), "type": "lock", "action_ar": "قفل الوقت (تعديل يدوي)", "by": l.get("time_locked_by_name") or "—",
                           "summary": f"{l.get('date')} {l.get('start_time')}-{l.get('end_time')}", "lecture_id": str(l["_id"])})

    # 4) أحداث الجدول الأسبوعي وسجل النشاط المرتبطة بالمقرر (بالاسم أو المعرّف)
    name = course.get("name", "")
    al_q = {"$or": [{"entity_name": name}, {"details.course_id": course_id}, {"entity_id": course_id}, {"details.path": {"$regex": course_id}}]}
    async for a in db.activity_logs.find(al_q).sort("timestamp", 1).limit(500):
        det = a.get("details") or {}
        events.append({"at": _ts(a.get("timestamp")), "type": "activity", "action_ar": _ACTION_AR.get(a.get("action"), a.get("action_ar") or a.get("action")),
                       "by": a.get("user_name") or a.get("username") or "—", "summary": det.get("summary") or (f"{det.get('method', '')} {det.get('path', '')}".strip() if det.get("path") else str(det)[:200]),
                       "entity_id": a.get("entity_id")})
    # أحداث سجل المحاضرات التي تحمل معرّف محاضرة من هذا المقرر
    lec_ids = {str(l["_id"]) for l in lectures} | {e.get("lecture_id") for e in events if e.get("lecture_id")}
    async for a in db.activity_logs.find({"entity_type": "lecture", "details.path": {"$regex": "/api/lectures/"}}).sort("timestamp", -1).limit(3000):
        path = (a.get("details") or {}).get("path", "")
        lid = path.split("/api/lectures/")[-1].split("/")[0]
        if lid in lec_ids:
            events.append({"at": _ts(a.get("timestamp")), "type": "activity", "action_ar": _ACTION_AR.get(a.get("action"), a.get("action")), "by": a.get("user_name") or a.get("username") or "—",
                           "summary": f"{path.split('/')[-1] if path.count('/') > 3 else 'تعديل'} محاضرة {lid[-6:]}", "lecture_id": lid})

    if from_date:
        events = [e for e in events if e["at"][:10] >= from_date]
    if to_date:
        events = [e for e in events if e["at"][:10] <= to_date]
    events.sort(key=lambda e: e["at"])

    # 5) الخانات الحالية في الجدول الأسبوعي + فحص الشذوذ
    slots = []
    async for s in db.weekly_schedule.find({"course_id": course_id}):
        issues = []
        if course.get("department_id") and s.get("department_id") != course.get("department_id"):
            issues.append("قسم مختلف عن قسم المقرر")
        if course.get("level") is not None and s.get("level") != course.get("level"):
            issues.append("مستوى مختلف")
        if (course.get("section") or "") and (s.get("section") or "") != course.get("section") and not s.get("merge_group_id"):
            issues.append("شعبة مختلفة")
        slots.append({"id": str(s["_id"]), "day": s.get("day"), "slot_number": s.get("slot_number"), "department_id": s.get("department_id"), "level": s.get("level"),
                      "section": s.get("section"), "duration_minutes": s.get("duration_minutes"), "created_at": _ts(s.get("created_at")), "issues": issues})
    return {"course": {"id": course_id, "name": name, "level": course.get("level"), "section": course.get("section"), "department_id": course.get("department_id")},
            "lectures_count": len(lectures), "slots": slots, "events": events, "count": len(events)}
