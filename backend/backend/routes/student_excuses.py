"""📄 أعذار غياب الطلاب — طلب بوثيقة يُوجَّه حسب النوع والمدة: التسجيل (مرضي) / العميد (غير مرضي ≤ يومين) / مجلس الكلية (أطول أو عن اختبار)"""
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from urllib.parse import quote

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from .deps import get_current_user, get_db, has_permission, log_activity
from .hr_common import notify_users, hr_manager_user_ids
from models.permissions import Permission, UserRole
from services import storage_service

router = APIRouter(prefix="/student-excuses", tags=["student-excuses"])
YEMEN_TZ = timezone(timedelta(hours=3))
MAX_FILES, MAX_SIZE = 3, 5 * 1024 * 1024
ALLOWED_MIME = {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/jpg"}
DEAN_MAX_DAYS = 2

EXCUSE_TYPES = {"sick": "مرضي", "family": "ظرف عائلي", "official": "مهمة/تكليف رسمي", "exam": "عذر عن اختبار", "other": "أخرى"}
ROUTES = {"registration": "التسجيل", "dean": "عميد الكلية", "board": "مجلس الكلية"}
STATUS = {"pending": "قيد المراجعة", "approved": "معتمد", "rejected": "مرفوض", "needs_info": "مطلوب استكمال", "cancelled": "ملغى"}
ROUTE_ROLES = {"registration": {UserRole.REGISTRAR, UserRole.REGISTRATION_MANAGER}, "dean": {UserRole.DEAN}, "board": {UserRole.DEAN}}
VIEW_ROLES = {UserRole.ADMIN, UserRole.DEAN, UserRole.REGISTRAR, UserRole.REGISTRATION_MANAGER, UserRole.DEPARTMENT_HEAD}


def _now():
    return datetime.now(YEMEN_TZ)


def _oid(v: str) -> ObjectId:
    try:
        return ObjectId(v)
    except Exception:
        raise HTTPException(status_code=400, detail="معرّف غير صحيح")


def route_for(excuse_type: str, days: int) -> str:
    if excuse_type == "sick":
        return "registration"
    if excuse_type == "exam" or days > DEAN_MAX_DAYS:
        return "board"
    return "dean"


def _days(a: str, b: str) -> int:
    try:
        d1, d2 = datetime.strptime(a, "%Y-%m-%d"), datetime.strptime(b, "%Y-%m-%d")
    except Exception:
        raise HTTPException(status_code=400, detail="صيغة التاريخ غير صحيحة (YYYY-MM-DD)")
    if d2 < d1:
        raise HTTPException(status_code=400, detail="تاريخ النهاية قبل تاريخ البداية")
    return (d2 - d1).days + 1


def _can_manage(user: dict) -> bool:
    return user["role"] in VIEW_ROLES or has_permission(user, Permission.MANAGE_STUDENT_EXCUSES)


def _can_decide(user: dict, doc: dict) -> bool:
    if user["role"] == UserRole.ADMIN:
        return True
    if not _in_scope(user, doc):
        return False
    if user["role"] in (UserRole.DEAN, UserRole.REGISTRAR, UserRole.REGISTRATION_MANAGER, UserRole.DEPARTMENT_HEAD):
        return user["role"] in ROUTE_ROLES.get(doc["route"], set())
    # موظف بصلاحية مخصصة = يعمل بصفة التسجيل
    return has_permission(user, Permission.MANAGE_STUDENT_EXCUSES) and doc["route"] == "registration"


def _in_scope(user: dict, doc: dict) -> bool:
    if user["role"] == UserRole.ADMIN:
        return True
    if user["role"] == UserRole.DEPARTMENT_HEAD:
        return doc.get("department_id") in (user.get("department_ids") or [])
    fids = user.get("faculty_ids") or []
    return not fids or doc.get("faculty_id") in fids


def serialize(d: dict) -> dict:
    return {
        "id": str(d["_id"]), "ref_no": d.get("ref_no"),
        "status": d["status"], "status_label": STATUS.get(d["status"], d["status"]),
        "route": d["route"], "route_label": ROUTES.get(d["route"], d["route"]),
        "excuse_type": d["excuse_type"], "excuse_type_label": EXCUSE_TYPES.get(d["excuse_type"], d["excuse_type"]),
        "from_date": d["from_date"], "to_date": d["to_date"], "days": d["days"],
        "course_id": d.get("course_id"), "course_name": d.get("course_name"),
        "description": d.get("description", ""),
        "student": {"id": d["student_db_id"], "student_id": d.get("student_no"), "full_name": d.get("student_name"), "level": d.get("level"), "section": d.get("section")},
        "department_id": d.get("department_id"), "department_name": d.get("department_name"), "faculty_id": d.get("faculty_id"), "faculty_name": d.get("faculty_name"),
        "attachments": [{"idx": i, "name": a["name"], "size": a.get("size"), "mime": a.get("mime")} for i, a in enumerate(d.get("attachments", []))],
        "submitted_by_name": d.get("submitted_by_name"), "submitted_by_role": d.get("submitted_by_role"),
        "decision_note": d.get("decision_note", ""), "decided_by_name": d.get("decided_by_name"), "decided_at": d.get("decided_at"),
        "board_session_no": d.get("board_session_no"), "board_session_date": d.get("board_session_date"),
        "applied": d.get("applied"), "history": d.get("history", []),
        "created_at": d.get("created_at"), "updated_at": d.get("updated_at"),
    }


async def _student_for(db, user: dict, student_db_id: Optional[str]) -> dict:
    if user["role"] == UserRole.STUDENT:
        st = await db.students.find_one({"user_id": user["id"]}) or await db.students.find_one({"student_id": user.get("username")})
    else:
        if not student_db_id:
            raise HTTPException(status_code=400, detail="اختر الطالب")
        st = await db.students.find_one({"_id": _oid(student_db_id)})
    if not st:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    return st


async def _save_files(files: List[UploadFile]) -> list:
    files = [f for f in (files or []) if f and f.filename]
    if not files:
        raise HTTPException(status_code=400, detail="المستند إلزامي — أرفق ملفاً واحداً على الأقل")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"الحد الأقصى {MAX_FILES} مرفقات")
    out = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_SIZE:
            raise HTTPException(status_code=400, detail=f"حجم الملف {f.filename} يتجاوز 5 ميجابايت")
        mime = (f.content_type or "").lower()
        if mime not in ALLOWED_MIME:
            raise HTTPException(status_code=400, detail="نوع الملف غير مسموح (PDF أو صور فقط)")
        res = storage_service.upload_file(data, f.filename, mime, folder="student_excuses")
        out.append({"path": res["storage_path"], "name": f.filename, "size": res["size"], "mime": mime})
    return out


def _covers(doc: dict, enr: dict, lec: dict) -> bool:
    if doc.get("course_id") and doc["course_id"] != lec["course_id"]:
        return False
    if lec.get("group") and (enr.get("group") or "") != lec["group"]:
        return False
    return doc["from_date"] <= lec.get("date", "") <= doc["to_date"]


async def apply_excuse(db, doc: dict) -> dict:
    """تحويل غياب الطالب في المحاضرات المنفَّذة ضمن الفترة إلى «بعذر» (ويُنشأ سجل إن كان مفقوداً)"""
    sid = doc["student_db_id"]
    enrs = {e["course_id"]: e async for e in db.enrollments.find({"student_id": sid}, {"course_id": 1, "group": 1})}
    if not enrs:
        return {"lectures": 0, "updated": 0, "created": 0, "courses": []}
    q = {"course_id": {"$in": list(enrs)}, "status": "completed", "date": {"$gte": doc["from_date"], "$lte": doc["to_date"]}}
    lecs = [l async for l in db.lectures.find(q, {"course_id": 1, "date": 1, "group": 1}) if _covers(doc, enrs[l["course_id"]], l)]
    updated = created = 0
    courses = set()
    now = _now()
    for l in lecs:
        lid = str(l["_id"])
        rec = await db.attendance.find_one({"lecture_id": lid, "student_id": sid})
        if rec and rec.get("status") == "present":
            continue
        courses.add(l["course_id"])
        if rec:
            await db.attendance.update_one({"_id": rec["_id"]}, {"$set": {"status": "excused", "excuse_id": str(doc["_id"]), "prev_status": rec.get("status")}})
            updated += 1
        else:
            await db.attendance.insert_one({"lecture_id": lid, "course_id": l["course_id"], "student_id": sid, "status": "excused", "date": now,
                                            "recorded_by": "system", "method": "excuse", "excuse_id": str(doc["_id"]), "created_at": now})
            created += 1
    names = {str(c["_id"]): c.get("name", "") for c in await db.courses.find({"_id": {"$in": [ObjectId(c) for c in courses]}}, {"name": 1}).to_list(200)} if courses else {}
    return {"lectures": len(lecs), "updated": updated, "created": created, "courses": [names.get(c, c) for c in courses], "applied_at": now.isoformat()}


async def excused_students_for_lecture(db, lecture: dict) -> set:
    """طلاب لديهم عذر معتمد يغطي تاريخ المحاضرة — يُستخدم عند التحضير لتسجيلهم «بعذر» تلقائياً"""
    q = {"status": "approved", "from_date": {"$lte": lecture["date"]}, "to_date": {"$gte": lecture["date"]},
         "$or": [{"course_id": None}, {"course_id": ""}, {"course_id": lecture["course_id"]}]}
    return {d["student_db_id"] async for d in db.student_excuses.find(q, {"student_db_id": 1})}


async def _reviewer_ids(db, doc: dict) -> List[str]:
    roles = list(ROUTE_ROLES[doc["route"]])
    q = {"role": {"$in": roles}, "is_active": {"$ne": False}}
    if doc.get("faculty_id"):
        q["$or"] = [{"faculty_id": doc["faculty_id"]}, {"faculty_ids": doc["faculty_id"]}, {"faculty_id": {"$in": [None, ""]}, "faculty_ids": {"$in": [None, []]}}]
    ids = [str(u["_id"]) for u in await db.users.find(q, {"_id": 1}).to_list(100)]
    return ids + await hr_manager_user_ids(db, Permission.MANAGE_STUDENT_EXCUSES)


async def _notify_student(db, doc: dict, title: str, msg: str):
    st = await db.students.find_one({"_id": ObjectId(doc["student_db_id"])}, {"user_id": 1})
    if st and st.get("user_id"):
        await notify_users(db, [st["user_id"]], title, msg, "student_excuse", {"data": {"type": "student_excuse", "id": str(doc["_id"])}})


# ---------------- meta ----------------

@router.get("/meta")
async def meta(current_user: dict = Depends(get_current_user)):
    return {"excuse_types": [{"key": k, "label": v} for k, v in EXCUSE_TYPES.items()], "routes": ROUTES, "statuses": STATUS,
            "dean_max_days": DEAN_MAX_DAYS, "max_files": MAX_FILES, "max_size": MAX_SIZE,
            "rule": "مرضي → التسجيل · غير مرضي حتى يومين → العميد · أكثر من يومين أو عذر عن اختبار → مجلس الكلية",
            "can_manage": _can_manage(current_user), "is_student": current_user["role"] == UserRole.STUDENT}


# ---------------- create ----------------

@router.post("")
async def create_excuse(
    from_date: str = Form(...), to_date: str = Form(...), excuse_type: str = Form(...), description: str = Form(""),
    course_id: Optional[str] = Form(None), student_db_id: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]), current_user: dict = Depends(get_current_user),
):
    db = get_db()
    if current_user["role"] != UserRole.STUDENT and not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    if excuse_type not in EXCUSE_TYPES:
        raise HTTPException(status_code=400, detail="نوع العذر غير صالح")
    description = (description or "").strip()
    if excuse_type == "other" and len(description) < 10:
        raise HTTPException(status_code=400, detail="عند اختيار (أخرى) اكتب وصفاً لا يقل عن 10 أحرف")
    days = _days(from_date, to_date)
    if days > 60:
        raise HTTPException(status_code=400, detail="مدة العذر لا تتجاوز 60 يوماً")
    st = await _student_for(db, current_user, student_db_id)
    sid = str(st["_id"])
    course = None
    if course_id:
        course = await db.courses.find_one({"_id": _oid(course_id)}, {"name": 1})
        if not course or not await db.enrollments.find_one({"course_id": course_id, "student_id": sid}):
            raise HTTPException(status_code=400, detail="الطالب غير مسجّل في هذا المقرر")
    dup = await db.student_excuses.find_one({"student_db_id": sid, "status": {"$in": ["pending", "needs_info"]},
                                             "from_date": {"$lte": to_date}, "to_date": {"$gte": from_date},
                                             **({"course_id": {"$in": [None, "", course_id]}} if course_id else {})})
    if dup:
        raise HTTPException(status_code=400, detail=f"يوجد طلب قائم ({dup.get('ref_no')}) يتداخل مع هذه الفترة")
    attachments = await _save_files(files)
    dept = await db.departments.find_one({"_id": ObjectId(st["department_id"])}) if st.get("department_id") and ObjectId.is_valid(st["department_id"]) else None
    fac = await db.faculties.find_one({"_id": ObjectId(dept["faculty_id"])}, {"name": 1}) if dept and dept.get("faculty_id") and ObjectId.is_valid(dept["faculty_id"]) else None
    now = _now()
    seq = await db.student_excuses.count_documents({}) + 1
    route = route_for(excuse_type, days)
    doc = {
        "ref_no": f"SE-{now.year}-{seq:04d}", "student_db_id": sid, "student_no": st.get("student_id"), "student_name": st.get("full_name"),
        "level": st.get("level"), "section": st.get("section"), "department_id": st.get("department_id"), "department_name": (dept or {}).get("name"),
        "faculty_id": (dept or {}).get("faculty_id"), "faculty_name": (fac or {}).get("name"),
        "excuse_type": excuse_type, "from_date": from_date, "to_date": to_date, "days": days,
        "course_id": course_id or None, "course_name": (course or {}).get("name"), "description": description, "attachments": attachments,
        "route": route, "status": "pending", "submitted_by": current_user["id"], "submitted_by_name": current_user.get("full_name"),
        "submitted_by_role": "student" if current_user["role"] == UserRole.STUDENT else "staff",
        "history": [{"at": now.isoformat(), "by_name": current_user.get("full_name"), "action": "submitted", "note": f"وُجّه إلى {ROUTES[route]}"}],
        "created_at": now.isoformat(), "updated_at": now.isoformat(),
    }
    res = await db.student_excuses.insert_one(doc)
    doc["_id"] = res.inserted_id
    await notify_users(db, await _reviewer_ids(db, doc), "طلب عذر غياب جديد",
                       f"{st.get('full_name')} — {EXCUSE_TYPES[excuse_type]} ({from_date} → {to_date}) — موجَّه إلى {ROUTES[route]}",
                       "student_excuse", {"data": {"type": "student_excuse", "id": str(res.inserted_id)}})
    if current_user["role"] != UserRole.STUDENT:
        await _notify_student(db, doc, "تم تقديم طلب عذر غياب باسمك", f"الطلب {doc['ref_no']} قيد المراجعة لدى {ROUTES[route]}")
    await log_activity(current_user, "student_excuse_create", "student_excuse", str(res.inserted_id), doc["ref_no"], {"route": route, "student": st.get("full_name")})
    return {"message": f"تم إرسال الطلب إلى {ROUTES[route]}", "request": serialize(doc)}


# ---------------- student ----------------

@router.get("/my")
async def my_excuses(current_user: dict = Depends(get_current_user)):
    db = get_db()
    st = await _student_for(db, current_user, None) if current_user["role"] == UserRole.STUDENT else None
    if not st:
        raise HTTPException(status_code=403, detail="هذه الشاشة للطلاب")
    docs = await db.student_excuses.find({"student_db_id": str(st["_id"])}).sort("created_at", -1).to_list(200)
    items = [serialize(d) for d in docs]
    courses = [{"id": c["course_id"], "name": c.get("course_name", "")} for c in await db.enrollments.aggregate([
        {"$match": {"student_id": str(st["_id"])}},
        {"$addFields": {"cid": {"$toObjectId": "$course_id"}}},
        {"$lookup": {"from": "courses", "localField": "cid", "foreignField": "_id", "as": "c"}},
        {"$unwind": "$c"}, {"$project": {"course_id": 1, "course_name": "$c.name"}}]).to_list(100)]
    return {"items": items, "courses": courses, "stats": {s: sum(1 for i in items if i["status"] == s) for s in STATUS}}


@router.post("/{excuse_id}/cancel")
async def cancel_excuse(excuse_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.student_excuses.find_one({"_id": _oid(excuse_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    st = await _student_for(db, current_user, None) if current_user["role"] == UserRole.STUDENT else None
    if not (st and str(st["_id"]) == doc["student_db_id"]) and not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    if doc["status"] not in ("pending", "needs_info"):
        raise HTTPException(status_code=400, detail="لا يمكن إلغاء طلب تم البت فيه")
    now = _now().isoformat()
    await db.student_excuses.update_one({"_id": doc["_id"]}, {"$set": {"status": "cancelled", "updated_at": now},
                                                               "$push": {"history": {"at": now, "by_name": current_user.get("full_name"), "action": "cancelled"}}})
    return {"message": "تم إلغاء الطلب"}


@router.post("/{excuse_id}/attachments")
async def add_attachments(excuse_id: str, files: List[UploadFile] = File(...), current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.student_excuses.find_one({"_id": _oid(excuse_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    st = await _student_for(db, current_user, None) if current_user["role"] == UserRole.STUDENT else None
    if not (st and str(st["_id"]) == doc["student_db_id"]) and not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    if doc["status"] != "needs_info":
        raise HTTPException(status_code=400, detail="إضافة المرفقات متاحة فقط عندما يكون الطلب «مطلوب استكمال»")
    if len(doc.get("attachments", [])) + len(files) > MAX_FILES + 2:
        raise HTTPException(status_code=400, detail="تجاوزت الحد الأقصى للمرفقات")
    new = await _save_files(files)
    now = _now().isoformat()
    await db.student_excuses.update_one({"_id": doc["_id"]}, {
        "$push": {"attachments": {"$each": new}, "history": {"at": now, "by_name": current_user.get("full_name"), "action": "attachments_added", "note": f"{len(new)} مرفق"}},
        "$set": {"status": "pending", "updated_at": now}})
    await notify_users(db, await _reviewer_ids(db, doc), "استكمال طلب عذر غياب", f"{doc.get('student_name')} أضاف مرفقات للطلب {doc.get('ref_no')}", "student_excuse",
                       {"data": {"type": "student_excuse", "id": excuse_id}})
    return {"message": "تمت إضافة المرفقات وإعادة الطلب للمراجعة"}


@router.get("/{excuse_id}/attachments/{idx}")
async def download_attachment(excuse_id: str, idx: int, request: Request, token: Optional[str] = None):
    db = get_db()
    from .deps import get_current_user_from_token
    auth = request.headers.get("authorization", "")
    raw = auth[7:] if auth.lower().startswith("bearer ") else token
    user = await get_current_user_from_token(raw) if raw else None
    if not user:
        raise HTTPException(status_code=401, detail="غير مصرح")
    doc = await db.student_excuses.find_one({"_id": _oid(excuse_id)})
    if not doc or idx < 0 or idx >= len(doc.get("attachments", [])):
        raise HTTPException(status_code=404, detail="المرفق غير موجود")
    st = await _student_for(db, user, None) if user["role"] == UserRole.STUDENT else None
    if not (st and str(st["_id"]) == doc["student_db_id"]) and not (_can_manage(user) and _in_scope(user, doc)):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    att = doc["attachments"][idx]
    try:
        content, ctype = storage_service.get_object(att["path"])
    except Exception:
        raise HTTPException(status_code=404, detail="تعذر جلب المرفق")
    return StreamingResponse(iter([content]), media_type=att.get("mime") or ctype,
                             headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(att['name'])}"})


# ---------------- reviewers ----------------

@router.get("")
async def list_excuses(status: Optional[str] = None, route: Optional[str] = None, faculty_id: Optional[str] = None,
                       department_id: Optional[str] = None, q: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    db = get_db()
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    f: dict = {}
    if status:
        f["status"] = {"$in": status.split(",")}
    if route:
        f["route"] = route
    if current_user["role"] == UserRole.DEPARTMENT_HEAD:
        f["department_id"] = {"$in": current_user.get("department_ids") or []}
    elif current_user["role"] != UserRole.ADMIN and current_user.get("faculty_ids"):
        f["faculty_id"] = {"$in": current_user["faculty_ids"]}
    if faculty_id:
        f["faculty_id"] = faculty_id
    if department_id:
        f["department_id"] = department_id
    if q:
        f["$or"] = [{"student_name": {"$regex": q, "$options": "i"}}, {"student_no": {"$regex": q}}, {"ref_no": {"$regex": q, "$options": "i"}}]
    docs = await db.student_excuses.find(f).sort("created_at", -1).to_list(1000)
    items = [serialize(d) for d in docs]
    for it, d in zip(items, docs):
        it["can_decide"] = d["status"] in ("pending", "needs_info") and _can_decide(current_user, d)
    base = {k: v for k, v in f.items() if k not in ("status", "route")}
    pending = {}
    async for r in db.student_excuses.aggregate([{"$match": {**base, "status": "pending"}}, {"$group": {"_id": "$route", "n": {"$sum": 1}}}]):
        pending[r["_id"]] = r["n"]
    return {"items": items, "pending_by_route": pending}


@router.get("/students/search")
async def search_students(q: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    f = {"is_active": {"$ne": False}, "$or": [{"full_name": {"$regex": q, "$options": "i"}}, {"student_id": {"$regex": q}}, {"reference_number": {"$regex": q, "$options": "i"}}]}
    if current_user["role"] == UserRole.DEPARTMENT_HEAD:
        f["department_id"] = {"$in": current_user.get("department_ids") or []}
    elif current_user["role"] != UserRole.ADMIN and current_user.get("faculty_ids"):
        dids = [str(d["_id"]) for d in await db.departments.find({"faculty_id": {"$in": current_user["faculty_ids"]}}, {"_id": 1}).to_list(500)]
        f["department_id"] = {"$in": dids}
    sts = await db.students.find(f, {"student_id": 1, "full_name": 1, "level": 1, "section": 1, "department_id": 1}).limit(20).to_list(20)
    out = []
    for s in sts:
        courses = [{"id": c["course_id"], "name": c.get("course_name", "")} for c in await db.enrollments.aggregate([
            {"$match": {"student_id": str(s["_id"])}}, {"$addFields": {"cid": {"$toObjectId": "$course_id"}}},
            {"$lookup": {"from": "courses", "localField": "cid", "foreignField": "_id", "as": "c"}}, {"$unwind": "$c"},
            {"$project": {"course_id": 1, "course_name": "$c.name"}}]).to_list(50)]
        out.append({"id": str(s["_id"]), "student_id": s.get("student_id"), "full_name": s.get("full_name"), "level": s.get("level"), "section": s.get("section"), "courses": courses})
    return out


@router.get("/{excuse_id}")
async def get_excuse(excuse_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.student_excuses.find_one({"_id": _oid(excuse_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    st = await _student_for(db, current_user, None) if current_user["role"] == UserRole.STUDENT else None
    if not (st and str(st["_id"]) == doc["student_db_id"]) and not (_can_manage(current_user) and _in_scope(current_user, doc)):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    out = serialize(doc)
    out["can_decide"] = doc["status"] in ("pending", "needs_info") and _can_decide(current_user, doc)
    return out


@router.post("/{excuse_id}/decide")
async def decide(excuse_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    db = get_db()
    body = await request.json()
    decision, note = body.get("decision"), (body.get("note") or "").strip()
    if decision not in ("approved", "rejected", "needs_info"):
        raise HTTPException(status_code=400, detail="قرار غير صالح")
    if decision != "approved" and not note:
        raise HTTPException(status_code=400, detail="السبب/الملاحظة إلزامية")
    doc = await db.student_excuses.find_one({"_id": _oid(excuse_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    if not _can_decide(current_user, doc):
        raise HTTPException(status_code=403, detail=f"البت في هذا الطلب من اختصاص {ROUTES[doc['route']]}")
    if doc["status"] not in ("pending", "needs_info"):
        raise HTTPException(status_code=400, detail="تم البت في هذا الطلب مسبقاً")
    upd = {}
    if doc["route"] == "board":
        sno, sdate = (body.get("board_session_no") or "").strip(), (body.get("board_session_date") or "").strip()
        if decision != "needs_info" and (not sno or not sdate):
            raise HTTPException(status_code=400, detail="رقم جلسة مجلس الكلية وتاريخها إلزاميان")
        upd.update({"board_session_no": sno, "board_session_date": sdate})
    now = _now().isoformat()
    upd.update({"status": decision, "decision_note": note, "decided_by": current_user["id"], "decided_by_name": current_user.get("full_name"), "decided_at": now, "updated_at": now})
    if decision == "approved":
        upd["applied"] = await apply_excuse(db, doc)
    await db.student_excuses.update_one({"_id": doc["_id"]}, {"$set": upd, "$push": {"history": {"at": now, "by_name": current_user.get("full_name"), "action": decision, "note": note}}})
    titles = {"approved": "تم اعتماد عذر الغياب", "rejected": "تم رفض طلب عذر الغياب", "needs_info": "طلب عذر الغياب يحتاج استكمالاً"}
    msg = f"الطلب {doc['ref_no']} ({doc['from_date']} → {doc['to_date']}): {STATUS[decision]}" + (f" — {note}" if note else "")
    if decision == "approved" and upd["applied"]["lectures"]:
        msg += f" — حُوّل غيابك في {upd['applied']['updated'] + upd['applied']['created']} محاضرة إلى «بعذر»"
    await _notify_student(db, doc, titles[decision], msg)
    await log_activity(current_user, f"student_excuse_{decision}", "student_excuse", excuse_id, doc["ref_no"], {"student": doc.get("student_name")})
    return {"message": f"تم تسجيل القرار: {STATUS[decision]}", "applied": upd.get("applied")}
