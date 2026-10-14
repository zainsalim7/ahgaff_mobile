"""🔁 تبادل/إنابة محاضرة لمرة واحدة بين أستاذين — مسار: الطالب للطلب (أ) → موافقة الزميل (ب) → اعتماد رئيس القسم/العميد → تنفيذ"""
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .deps import get_db, get_current_user, log_activity
from .hr_common import notify_users
from models.permissions import UserRole

router = APIRouter(prefix="/lecture-swaps", tags=["تبادل المحاضرات"])
DEFAULTS = {"enabled": True, "min_hours": 24, "monthly_limit": 3, "allow_cover": True, "require_head": True}
HEAD_ROLES = {UserRole.ADMIN, "dean", "department_head"}


def _now():
    return datetime.now(timezone.utc)


def _oid(x):
    return ObjectId(x) if x and ObjectId.is_valid(x) else None


def _lec_dt(lec: dict) -> datetime:
    return datetime.strptime(f"{lec['date']} {lec.get('start_time') or '00:00'}", "%Y-%m-%d %H:%M").replace(tzinfo=timezone(timedelta(hours=3)))


def _week_range(date_str: str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    start = d - timedelta(days=(d.weekday() + 2) % 7)  # السبت بداية الأسبوع
    return start.strftime("%Y-%m-%d"), (start + timedelta(days=6)).strftime("%Y-%m-%d")


async def get_settings(db) -> dict:
    doc = await db.settings.find_one({"type": "lecture_swaps"}) or {}
    return {**DEFAULTS, **{k: doc[k] for k in DEFAULTS if k in doc}}


def my_teacher_ids(user: dict) -> List[str]:
    return [x for x in {user.get("teacher_record_id"), user["id"]} if x]


async def _teacher_user_ids(db, teacher_id: str) -> List[str]:
    ids = [str(u["_id"]) for u in await db.users.find({"$or": [{"teacher_record_id": teacher_id}, {"_id": _oid(teacher_id)}]}, {"_id": 1}).to_list(5)]
    t = await db.teachers.find_one({"_id": _oid(teacher_id)}, {"user_id": 1}) if _oid(teacher_id) else None
    if t and t.get("user_id"):
        ids.append(t["user_id"])
    return list(set(ids))


async def _teacher_name(db, teacher_id: str) -> str:
    t = await db.teachers.find_one({"_id": _oid(teacher_id)}, {"full_name": 1}) if _oid(teacher_id) else None
    if t:
        return t.get("full_name", "")
    u = await db.users.find_one({"_id": _oid(teacher_id)}, {"full_name": 1}) if _oid(teacher_id) else None
    return (u or {}).get("full_name", "")


async def _busy(db, teacher_id: str, date: str, start: str, end: str, exclude_ids: List[str]) -> Optional[str]:
    """هل الأستاذ مشغول بمحاضرة أخرى تتقاطع زمنياً في هذا التاريخ؟ (الإجازات المعتمدة أيضاً)"""
    q = {"teacher_id": teacher_id, "date": date, "status": {"$nin": ["cancelled", "deleted"]}, "_id": {"$nin": [_oid(x) for x in exclude_ids if _oid(x)]}}
    async for l in db.lectures.find(q, {"start_time": 1, "end_time": 1, "course_name": 1}):
        if (l.get("start_time") or "00:00") < (end or "23:59") and (l.get("end_time") or "23:59") > (start or "00:00"):
            return f"لديه محاضرة «{l.get('course_name', '')}» {l.get('start_time')}–{l.get('end_time')}"
    uids = await _teacher_user_ids(db, teacher_id)
    emp = await db.employees.find_one({"user_id": {"$in": uids}}, {"_id": 1}) if uids else None
    if emp:
        lv = await db.leave_requests.find_one({"employee_id": str(emp["_id"]), "status": "approved", "start_date": {"$lte": date}, "end_date": {"$gte": date}}, {"_id": 1})
        if lv:
            return "لديه إجازة معتمدة في هذا اليوم"
    return None


async def _month_count(db, teacher_id: str, date: str) -> int:
    ym = date[:7]
    return await db.lecture_swaps.count_documents({"$or": [{"requester_teacher_id": teacher_id}, {"counterpart_teacher_id": teacher_id}],
                                                   "status": {"$in": ["pending_counterpart", "pending_head", "approved", "executed"]}, "month": ym})


def _can_decide(user: dict, swap: dict) -> bool:
    if user["role"] == UserRole.ADMIN:
        return True
    if user["role"] == "dean":
        return not user.get("faculty_id") or user["faculty_id"] in {swap.get("faculty_id"), swap.get("faculty_id_b")}
    if user["role"] == "department_head":
        return user.get("department_id") in {swap.get("department_id"), swap.get("department_id_b")}
    return False


def _lec_view(l: dict) -> dict:
    return {"id": str(l["_id"]), "course_id": l.get("course_id"), "course_name": l.get("course_name"), "date": l.get("date"), "start_time": l.get("start_time"), "end_time": l.get("end_time"),
            "room": l.get("room"), "group": l.get("group"), "group_name": l.get("group_name"), "teacher_id": l.get("teacher_id"), "teacher_name": l.get("teacher_name"),
            "original_teacher_name": l.get("original_teacher_name"), "swap_type": l.get("swap_type"), "status": l.get("status")}


def _swap_view(s: dict) -> dict:
    out = {k: v for k, v in s.items() if k != "_id"}
    out["id"] = str(s["_id"])
    return out


async def _enrich_lectures(db, lecs: List[dict]) -> List[dict]:
    cids = {l.get("course_id") for l in lecs if l.get("course_id") and not l.get("course_name")}
    names = {str(c["_id"]): c.get("name") for c in await db.courses.find({"_id": {"$in": [o for o in (_oid(c) for c in cids) if o]}}, {"name": 1}).to_list(500)} if cids else {}
    for l in lecs:
        l.setdefault("course_name", names.get(l.get("course_id"), ""))
    return lecs


# ---------------- الإعدادات ----------------
class SettingsIn(BaseModel):
    enabled: Optional[bool] = None
    min_hours: Optional[int] = None
    monthly_limit: Optional[int] = None
    allow_cover: Optional[bool] = None
    require_head: Optional[bool] = None


@router.get("/settings")
async def read_settings(current_user: dict = Depends(get_current_user)):
    return await get_settings(get_db())


@router.put("/settings")
async def update_settings(data: SettingsIn, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="للأدمن فقط")
    upd = {k: v for k, v in data.model_dump().items() if v is not None}
    await get_db().settings.update_one({"type": "lecture_swaps"}, {"$set": {**upd, "type": "lecture_swaps"}}, upsert=True)
    await log_activity(current_user, "lecture_swaps_settings", "settings", "lecture_swaps", "إعدادات تبادل المحاضرات", upd)
    return await get_settings(get_db())


# ---------------- محاضراتي القابلة للتبادل + المرشحون ----------------
@router.get("/my-lectures")
async def my_lectures(current_user: dict = Depends(get_current_user)):
    """محاضرات الأستاذ المجدولة القادمة (أسبوعان) القابلة لطلب تبادل"""
    db = get_db()
    st = await get_settings(db)
    today = (_now() + timedelta(hours=3)).strftime("%Y-%m-%d")
    until = (_now() + timedelta(days=14)).strftime("%Y-%m-%d")
    lecs = await db.lectures.find({"teacher_id": {"$in": my_teacher_ids(current_user)}, "status": "scheduled", "date": {"$gte": today, "$lte": until}}).sort([("date", 1), ("start_time", 1)]).to_list(200)
    await _enrich_lectures(db, lecs)
    out = []
    for l in lecs:
        hrs = (_lec_dt(l) - _now()).total_seconds() / 3600
        out.append({**_lec_view(l), "eligible": hrs >= st["min_hours"] and not l.get("swap_id"), "reason": ("سبق تبادلها" if l.get("swap_id") else (f"أقل من {st['min_hours']} ساعة على موعدها" if hrs < st["min_hours"] else ""))})
    return {"lectures": out, "month_used": await _month_count(db, my_teacher_ids(current_user)[0], today), "settings": st}


@router.get("/candidates")
async def candidates(lecture_id: str, type: str = "swap", current_user: dict = Depends(get_current_user)):
    """الزملاء المتاحون في وقت المحاضرة (نفس الكلية)، ولكل زميل محاضراته في الأسبوع نفسه التي يستطيع الطالب تنفيذها"""
    db = get_db()
    lec = await db.lectures.find_one({"_id": _oid(lecture_id)}) if _oid(lecture_id) else None
    if not lec or lec.get("teacher_id") not in my_teacher_ids(current_user):
        raise HTTPException(status_code=404, detail="المحاضرة غير موجودة أو ليست لك")
    course = await db.courses.find_one({"_id": _oid(lec["course_id"])}) or {}
    fac = course.get("faculty_id")
    tq = {"is_active": {"$ne": False}}
    if fac:
        tq["faculty_id"] = fac
    teachers = await db.teachers.find(tq, {"full_name": 1, "department_id": 1}).to_list(1000)
    ws, we = _week_range(lec["date"])
    my_ids = my_teacher_ids(current_user)
    out = []
    for t in teachers:
        tid = str(t["_id"])
        if tid in my_ids:
            continue
        busy = await _busy(db, tid, lec["date"], lec.get("start_time"), lec.get("end_time"), [lecture_id])
        item = {"teacher_id": tid, "full_name": t.get("full_name"), "department_id": t.get("department_id"), "available": not busy, "busy_reason": busy, "swappable": []}
        if type == "swap" and not busy:
            theirs = await db.lectures.find({"teacher_id": tid, "status": "scheduled", "date": {"$gte": ws, "$lte": we}, "swap_id": {"$exists": False}}).sort([("date", 1), ("start_time", 1)]).to_list(60)
            await _enrich_lectures(db, theirs)
            for l in theirs:
                if (_lec_dt(l) - _now()).total_seconds() < 3600:
                    continue
                conflict = None
                for mid in my_ids:
                    conflict = conflict or await _busy(db, mid, l["date"], l.get("start_time"), l.get("end_time"), [str(l["_id"])])
                item["swappable"].append({**_lec_view(l), "ok": not conflict, "conflict": conflict})
        out.append(item)
    out.sort(key=lambda x: (not x["available"], x["full_name"] or ""))
    return {"lecture": _lec_view(lec), "week": [ws, we], "teachers": out}


# ---------------- الطلب ----------------
class SwapIn(BaseModel):
    type: str = "swap"  # swap | cover
    lecture_a_id: str
    counterpart_teacher_id: str
    lecture_b_id: Optional[str] = None
    reason: str = ""


@router.post("")
async def create_swap(data: SwapIn, current_user: dict = Depends(get_current_user)):
    db = get_db()
    st = await get_settings(db)
    if not st["enabled"]:
        raise HTTPException(status_code=400, detail="ميزة تبادل المحاضرات معطّلة")
    if data.type not in ("swap", "cover") or (data.type == "cover" and not st["allow_cover"]):
        raise HTTPException(status_code=400, detail="نوع الطلب غير مسموح")
    my_ids = my_teacher_ids(current_user)
    lec_a = await db.lectures.find_one({"_id": _oid(data.lecture_a_id)}) if _oid(data.lecture_a_id) else None
    if not lec_a or lec_a.get("teacher_id") not in my_ids:
        raise HTTPException(status_code=404, detail="محاضرتك غير موجودة أو ليست مسندة إليك")
    if lec_a.get("status") != "scheduled":
        raise HTTPException(status_code=400, detail="المحاضرة ليست بحالة «مجدولة»")
    if lec_a.get("swap_id"):
        raise HTTPException(status_code=400, detail="هذه المحاضرة سبق تبادلها — التبادل مرة واحدة فقط")
    ACTIVE = ["pending_counterpart", "pending_head", "approved"]
    if await db.lecture_swaps.find_one({"status": {"$in": ACTIVE}, "$or": [{"lecture_a.id": data.lecture_a_id}, {"lecture_b.id": data.lecture_a_id}]}):
        raise HTTPException(status_code=400, detail="يوجد طلب قائم على هذه المحاضرة بالفعل")
    hrs = (_lec_dt(lec_a) - _now()).total_seconds() / 3600
    if hrs < st["min_hours"]:
        raise HTTPException(status_code=400, detail=f"يجب تقديم الطلب قبل المحاضرة بـ {st['min_hours']} ساعة على الأقل")
    me_tid = lec_a["teacher_id"]
    cp = data.counterpart_teacher_id
    if cp in my_ids:
        raise HTTPException(status_code=400, detail="لا يمكن التبادل مع نفسك")
    if await _month_count(db, me_tid, lec_a["date"]) >= st["monthly_limit"]:
        raise HTTPException(status_code=400, detail=f"بلغت الحد الشهري ({st['monthly_limit']} تبادلات/إنابات في الشهر)")
    if await _month_count(db, cp, lec_a["date"]) >= st["monthly_limit"]:
        raise HTTPException(status_code=400, detail=f"الزميل بلغ حده الشهري ({st['monthly_limit']})")
    busy = await _busy(db, cp, lec_a["date"], lec_a.get("start_time"), lec_a.get("end_time"), [data.lecture_a_id])
    if busy:
        raise HTTPException(status_code=400, detail=f"الزميل غير متاح وقت محاضرتك: {busy}")
    lec_b = None
    if data.type == "swap":
        lec_b = await db.lectures.find_one({"_id": _oid(data.lecture_b_id)}) if _oid(data.lecture_b_id) else None
        if not lec_b or lec_b.get("teacher_id") != cp or lec_b.get("status") != "scheduled":
            raise HTTPException(status_code=400, detail="محاضرة الزميل غير صالحة للتبادل")
        if lec_b.get("swap_id"):
            raise HTTPException(status_code=400, detail="محاضرة الزميل سبق تبادلها")
        if await db.lecture_swaps.find_one({"status": {"$in": ACTIVE}, "$or": [{"lecture_a.id": data.lecture_b_id}, {"lecture_b.id": data.lecture_b_id}]}):
            raise HTTPException(status_code=400, detail="يوجد طلب قائم على محاضرة الزميل بالفعل")
        ws, we = _week_range(lec_a["date"])
        if not (ws <= lec_b["date"] <= we):
            raise HTTPException(status_code=400, detail="التبادل يكون داخل الأسبوع نفسه فقط")
        if (_lec_dt(lec_b) - _now()).total_seconds() / 3600 < 1:
            raise HTTPException(status_code=400, detail="محاضرة الزميل قريبة جداً أو انقضت")
        mine_busy = await _busy(db, me_tid, lec_b["date"], lec_b.get("start_time"), lec_b.get("end_time"), [data.lecture_b_id])
        if mine_busy:
            raise HTTPException(status_code=400, detail=f"أنت غير متاح وقت محاضرة الزميل: {mine_busy}")
    course_a = await db.courses.find_one({"_id": _oid(lec_a["course_id"])}) or {}
    course_b = (await db.courses.find_one({"_id": _oid(lec_b["course_id"])}) or {}) if lec_b else {}
    await _enrich_lectures(db, [lec_a] + ([lec_b] if lec_b else []))
    doc = {
        "type": data.type, "status": "pending_counterpart", "reason": (data.reason or "").strip()[:500],
        "requester_teacher_id": me_tid, "requester_name": await _teacher_name(db, me_tid), "requester_user_id": current_user["id"],
        "counterpart_teacher_id": cp, "counterpart_name": await _teacher_name(db, cp),
        "lecture_a": _lec_view(lec_a), "lecture_b": _lec_view(lec_b) if lec_b else None,
        "department_id": course_a.get("department_id"), "faculty_id": course_a.get("faculty_id"),
        "department_id_b": course_b.get("department_id"), "faculty_id_b": course_b.get("faculty_id"),
        "cross_department": bool(course_b) and course_b.get("department_id") != course_a.get("department_id"),
        "month": lec_a["date"][:7], "approvals": [{"step": "request", "by": current_user["id"], "name": current_user.get("full_name"), "at": _now().isoformat()}],
        "created_at": _now().isoformat(), "updated_at": _now().isoformat(),
    }
    res = await db.lecture_swaps.insert_one(doc)
    sid = str(res.inserted_id)
    kind = "تبادل" if data.type == "swap" else "إنابة"
    await notify_users(db, await _teacher_user_ids(db, cp), f"طلب {kind} محاضرة 🔁", f"{doc['requester_name']} يطلب {kind}: «{lec_a.get('course_name')}» {lec_a['date']} {lec_a.get('start_time')} — افتح «تبادل المحاضرات» للرد", "lecture_swap", {"swap_id": sid})
    await log_activity(current_user, "lecture_swap_request", "lecture_swap", sid, f"طلب {kind} محاضرة", {"lecture_a": data.lecture_a_id, "counterpart": cp})
    created = await db.lecture_swaps.find_one({"_id": res.inserted_id})
    return _swap_view(created)


# ---------------- القوائم ----------------
@router.get("")
async def list_swaps(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    db = get_db()
    q: dict = {}
    my_ids = my_teacher_ids(current_user)
    if current_user["role"] == UserRole.ADMIN:
        pass
    elif current_user["role"] == "dean" and current_user.get("faculty_id"):
        q["$or"] = [{"faculty_id": current_user["faculty_id"]}, {"faculty_id_b": current_user["faculty_id"]}, {"requester_teacher_id": {"$in": my_ids}}, {"counterpart_teacher_id": {"$in": my_ids}}]
    elif current_user["role"] == "department_head" and current_user.get("department_id"):
        q["$or"] = [{"department_id": current_user["department_id"]}, {"department_id_b": current_user["department_id"]}, {"requester_teacher_id": {"$in": my_ids}}, {"counterpart_teacher_id": {"$in": my_ids}}]
    else:
        q["$or"] = [{"requester_teacher_id": {"$in": my_ids}}, {"counterpart_teacher_id": {"$in": my_ids}}]
    if status:
        q["status"] = {"$in": status.split(",")}
    rows = await db.lecture_swaps.find(q).sort("created_at", -1).limit(300).to_list(300)
    # ⏳ انتهاء صلاحية الطلبات المعلّقة التي فات موعد محاضرتها
    now = _now()
    out = []
    for s in rows:
        if s["status"] in ("pending_counterpart", "pending_head") and _lec_dt(s["lecture_a"]) <= now:
            await db.lecture_swaps.update_one({"_id": s["_id"]}, {"$set": {"status": "expired", "updated_at": now.isoformat()}})
            s["status"] = "expired"
        v = _swap_view(s)
        v["can_respond"] = s["status"] == "pending_counterpart" and s["counterpart_teacher_id"] in my_ids
        v["can_decide"] = s["status"] == "pending_head" and _can_decide(current_user, s)
        v["can_cancel"] = s["status"] in ("pending_counterpart", "pending_head", "approved") and (s["requester_teacher_id"] in my_ids or s["counterpart_teacher_id"] in my_ids or _can_decide(current_user, s)) and _lec_dt(s["lecture_a"]) > now
        out.append(v)
    return {"items": out, "pending_decision": sum(1 for v in out if v["can_decide"]), "pending_response": sum(1 for v in out if v["can_respond"])}


# ---------------- الرد والاعتماد والإلغاء ----------------
class RespondIn(BaseModel):
    accept: bool
    note: str = ""


async def _apply(db, swap: dict):
    """تطبيق التبادل على المحاضرتين: المنفّذ الفعلي يصبح teacher_id مع حفظ الأصل"""
    a, b = swap["lecture_a"], swap.get("lecture_b")
    sid = str(swap["_id"])
    pairs = [(a, swap["counterpart_teacher_id"], swap["counterpart_name"])] + ([(b, swap["requester_teacher_id"], swap["requester_name"])] if b else [])
    for lec, new_tid, new_name in pairs:
        await db.lectures.update_one({"_id": _oid(lec["id"]), "status": "scheduled"}, {"$set": {
            "original_teacher_id": lec["teacher_id"], "original_teacher_name": lec.get("teacher_name"), "teacher_id": new_tid, "teacher_name": new_name,
            "swap_id": sid, "swap_type": swap["type"], "swapped_at": _now().isoformat()}})


async def _revert(db, swap: dict):
    for lec in [swap["lecture_a"]] + ([swap["lecture_b"]] if swap.get("lecture_b") else []):
        await db.lectures.update_one({"_id": _oid(lec["id"]), "swap_id": str(swap["_id"]), "status": "scheduled"},
                                     {"$set": {"teacher_id": lec["teacher_id"], "teacher_name": lec.get("teacher_name")}, "$unset": {"original_teacher_id": "", "original_teacher_name": "", "swap_id": "", "swap_type": "", "swapped_at": ""}})


async def _heads_user_ids(db, swap: dict) -> List[str]:
    deps = [d for d in {swap.get("department_id"), swap.get("department_id_b")} if d]
    heads = [str(u["_id"]) for u in await db.users.find({"role": "department_head", "department_id": {"$in": deps}, "is_active": {"$ne": False}}, {"_id": 1}).to_list(20)]
    if swap.get("cross_department") or not heads:
        facs = [f for f in {swap.get("faculty_id"), swap.get("faculty_id_b")} if f]
        heads += [str(u["_id"]) for u in await db.users.find({"role": "dean", "faculty_id": {"$in": facs}, "is_active": {"$ne": False}}, {"_id": 1}).to_list(20)]
    return heads


async def _notify_students(db, swap: dict):
    for lec, new_name in [(swap["lecture_a"], swap["counterpart_name"])] + ([(swap["lecture_b"], swap["requester_name"])] if swap.get("lecture_b") else []):
        q = {"course_id": lec["course_id"]}
        if lec.get("group"):
            q["group"] = lec["group"]
        sids = [e["student_id"] for e in await db.enrollments.find(q, {"student_id": 1}).to_list(500)]
        uids = [s["user_id"] for s in await db.students.find({"_id": {"$in": [o for o in (_oid(s) for s in sids) if o]}, "user_id": {"$exists": True}}, {"user_id": 1}).to_list(500)]
        await notify_users(db, uids, "تغيير أستاذ المحاضرة 🔁", f"محاضرة «{lec.get('course_name')}» يوم {lec['date']} {lec.get('start_time')} سينفّذها أ. {new_name} بدلاً من أ. {lec.get('teacher_name')}", "lecture_swap", {"lecture_id": lec["id"]})


@router.post("/{swap_id}/respond")
async def respond(swap_id: str, data: RespondIn, current_user: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.lecture_swaps.find_one({"_id": _oid(swap_id)}) if _oid(swap_id) else None
    if not s or s["status"] != "pending_counterpart":
        raise HTTPException(status_code=404, detail="الطلب غير موجود أو ليس بانتظار ردك")
    if s["counterpart_teacher_id"] not in my_teacher_ids(current_user):
        raise HTTPException(status_code=403, detail="هذا الطلب ليس موجهاً إليك")
    st = await get_settings(db)
    step = {"step": "counterpart", "by": current_user["id"], "name": current_user.get("full_name"), "accept": data.accept, "note": data.note[:300], "at": _now().isoformat()}
    kind = "تبادل" if s["type"] == "swap" else "إنابة"
    if not data.accept:
        await db.lecture_swaps.update_one({"_id": s["_id"]}, {"$set": {"status": "rejected_counterpart", "updated_at": _now().isoformat()}, "$push": {"approvals": step}})
        await notify_users(db, [s["requester_user_id"]], f"رفض طلب {kind} ❌", f"{s['counterpart_name']} اعتذر عن {kind} محاضرة «{s['lecture_a'].get('course_name')}»" + (f": {data.note}" if data.note else ""), "lecture_swap", {"swap_id": swap_id})
        return {"ok": True, "status": "rejected_counterpart"}
    needs_head = st["require_head"] or s.get("cross_department")
    new_status = "pending_head" if needs_head else "approved"
    await db.lecture_swaps.update_one({"_id": s["_id"]}, {"$set": {"status": new_status, "updated_at": _now().isoformat()}, "$push": {"approvals": step}})
    s = await db.lecture_swaps.find_one({"_id": s["_id"]})
    if needs_head:
        await notify_users(db, await _heads_user_ids(db, s), f"طلب {kind} محاضرة بانتظار اعتمادك 🔁", f"{s['requester_name']} ↔ {s['counterpart_name']}: «{s['lecture_a'].get('course_name')}» {s['lecture_a']['date']}", "lecture_swap", {"swap_id": swap_id})
    else:
        await _apply(db, s)
        await _notify_students(db, s)
    await notify_users(db, [s["requester_user_id"]], f"وافق الزميل على {kind} ✅", f"{s['counterpart_name']} وافق — {'بانتظار اعتماد رئيس القسم' if needs_head else 'تم التطبيق'}", "lecture_swap", {"swap_id": swap_id})
    await log_activity(current_user, "lecture_swap_respond", "lecture_swap", swap_id, f"موافقة الزميل على {kind}", {})
    return {"ok": True, "status": new_status}


@router.post("/{swap_id}/decide")
async def decide(swap_id: str, data: RespondIn, current_user: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.lecture_swaps.find_one({"_id": _oid(swap_id)}) if _oid(swap_id) else None
    if not s or s["status"] != "pending_head":
        raise HTTPException(status_code=404, detail="الطلب غير موجود أو ليس بانتظار الاعتماد")
    if not _can_decide(current_user, s):
        raise HTTPException(status_code=403, detail="الاعتماد لرئيس القسم/العميد المعني")
    if _lec_dt(s["lecture_a"]) <= _now():
        raise HTTPException(status_code=400, detail="فات موعد المحاضرة — انتهت صلاحية الطلب")
    step = {"step": "head", "by": current_user["id"], "name": current_user.get("full_name"), "role": current_user["role"], "accept": data.accept, "note": data.note[:300], "at": _now().isoformat()}
    kind = "تبادل" if s["type"] == "swap" else "إنابة"
    both = [s["requester_user_id"]] + await _teacher_user_ids(db, s["counterpart_teacher_id"])
    if not data.accept:
        await db.lecture_swaps.update_one({"_id": s["_id"]}, {"$set": {"status": "rejected_head", "updated_at": _now().isoformat()}, "$push": {"approvals": step}})
        await notify_users(db, both, f"رفض اعتماد {kind} ❌", f"{current_user.get('full_name')} رفض طلب {kind} «{s['lecture_a'].get('course_name')}»" + (f": {data.note}" if data.note else ""), "lecture_swap", {"swap_id": swap_id})
        return {"ok": True, "status": "rejected_head"}
    await db.lecture_swaps.update_one({"_id": s["_id"]}, {"$set": {"status": "approved", "updated_at": _now().isoformat()}, "$push": {"approvals": step}})
    s = await db.lecture_swaps.find_one({"_id": s["_id"]})
    await _apply(db, s)
    await _notify_students(db, s)
    await notify_users(db, both, f"اعتماد {kind} المحاضرة ✅", f"تم اعتماد {kind} «{s['lecture_a'].get('course_name')}» {s['lecture_a']['date']} — ينفّذها أ. {s['counterpart_name']}" + (f"، و«{s['lecture_b'].get('course_name')}» {s['lecture_b']['date']} ينفّذها أ. {s['requester_name']}" if s.get("lecture_b") else ""), "lecture_swap", {"swap_id": swap_id})
    await log_activity(current_user, "lecture_swap_approve", "lecture_swap", swap_id, f"اعتماد {kind} محاضرة", {})
    return {"ok": True, "status": "approved"}


@router.post("/{swap_id}/cancel")
async def cancel(swap_id: str, data: RespondIn, current_user: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.lecture_swaps.find_one({"_id": _oid(swap_id)}) if _oid(swap_id) else None
    if not s or s["status"] not in ("pending_counterpart", "pending_head", "approved"):
        raise HTTPException(status_code=404, detail="الطلب غير موجود أو لا يمكن إلغاؤه")
    my_ids = my_teacher_ids(current_user)
    if not (s["requester_teacher_id"] in my_ids or s["counterpart_teacher_id"] in my_ids or _can_decide(current_user, s)):
        raise HTTPException(status_code=403, detail="غير مصرح")
    if _lec_dt(s["lecture_a"]) <= _now() or (s.get("lecture_b") and _lec_dt(s["lecture_b"]) <= _now()):
        raise HTTPException(status_code=400, detail="لا يمكن الإلغاء بعد تنفيذ إحدى المحاضرتين")
    if s["status"] == "approved":
        await _revert(db, s)
    await db.lecture_swaps.update_one({"_id": s["_id"]}, {"$set": {"status": "cancelled", "updated_at": _now().isoformat()}, "$push": {"approvals": {"step": "cancel", "by": current_user["id"], "name": current_user.get("full_name"), "note": data.note[:300], "at": _now().isoformat()}}})
    both = [s["requester_user_id"]] + await _teacher_user_ids(db, s["counterpart_teacher_id"])
    await notify_users(db, both, "إلغاء تبادل محاضرة ↩️", f"{current_user.get('full_name')} ألغى طلب «{s['lecture_a'].get('course_name')}» {s['lecture_a']['date']}" + (f": {data.note}" if data.note else ""), "lecture_swap", {"swap_id": swap_id})
    await log_activity(current_user, "lecture_swap_cancel", "lecture_swap", swap_id, "إلغاء تبادل محاضرة", {})
    return {"ok": True, "status": "cancelled"}


@router.get("/report")
async def report(month: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """ملخص شهري: عدد التبادلات/الإنابات لكل أستاذ وقسم"""
    if current_user["role"] not in HEAD_ROLES:
        raise HTTPException(status_code=403, detail="غير مصرح")
    db = get_db()
    q: dict = {"status": {"$in": ["approved", "executed"]}}
    if month:
        q["month"] = month
    if current_user["role"] == "department_head" and current_user.get("department_id"):
        q["$or"] = [{"department_id": current_user["department_id"]}, {"department_id_b": current_user["department_id"]}]
    elif current_user["role"] == "dean" and current_user.get("faculty_id"):
        q["$or"] = [{"faculty_id": current_user["faculty_id"]}, {"faculty_id_b": current_user["faculty_id"]}]
    rows = await db.lecture_swaps.find(q).to_list(2000)
    per: dict = {}
    for s in rows:
        for tid, name in ((s["requester_teacher_id"], s["requester_name"]), (s["counterpart_teacher_id"], s["counterpart_name"])):
            p = per.setdefault(tid, {"teacher_id": tid, "name": name, "swaps": 0, "covers": 0})
            p["swaps" if s["type"] == "swap" else "covers"] += 1
    return {"month": month, "total": len(rows), "swaps": sum(1 for s in rows if s["type"] == "swap"), "covers": sum(1 for s in rows if s["type"] == "cover"), "per_teacher": sorted(per.values(), key=lambda x: -(x["swaps"] + x["covers"]))}
