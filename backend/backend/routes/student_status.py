"""
إدارة حالات الطلاب - تخرج / إعادة / فصل / تجميد / مستمر
- POST /api/students/bulk-change-status - تغيير جماعي للحالة
- GET /api/students/{id}/status-history - تاريخ الحالات
- POST /api/students/{id}/change-status - تغيير فردي
"""
from datetime import datetime, timezone
from typing import Optional, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .deps import get_current_user, get_db


router = APIRouter(tags=["حالات الطلاب"])


# ==================== Constants ====================

VALID_STATUSES = {"active", "repeat", "graduated", "expelled", "frozen"}
# الحالات المسموح تعيينها يدوياً عبر تغيير الحالة (graduated مستثنى - يجب استخدام /graduate)
USER_SETTABLE_STATUSES = {"active", "repeat", "expelled", "frozen"}

STATUS_LABELS = {
    "active": "مستمر",
    "repeat": "إعادة",
    "graduated": "متخرج",
    "expelled": "مفصول",
    "frozen": "مجمَّد",
}

# الحالات التي تجعل is_active=False (المعيد أيضاً يخرج من قوائم التحضير والتسجيل)
INACTIVE_STATUSES = {"graduated", "expelled", "frozen", "repeat"}


# ==================== Models ====================

class BulkChangeStatusRequest(BaseModel):
    student_ids: List[str] = Field(..., min_length=1)
    new_status: str
    new_level: Optional[int] = None  # اختياري - للنقل مع تغيير الحالة
    reason: Optional[str] = ""
    effective_date: Optional[str] = None  # ISO date - افتراضي: الآن


class SingleChangeStatusRequest(BaseModel):
    new_status: str
    new_level: Optional[int] = None
    reason: Optional[str] = ""
    effective_date: Optional[str] = None


# ==================== Helpers ====================

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_status(status: str) -> str:
    if status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"حالة غير صحيحة: '{status}'. القيم المقبولة: {', '.join(VALID_STATUSES)}"
        )
    # 🆕 منع تعيين "متخرج" يدوياً - يجب استخدام endpoint التخريج مع بيانات السنة
    if status == "graduated":
        raise HTTPException(
            status_code=400,
            detail="لا يمكن تعيين حالة 'متخرج' يدوياً. استخدم زر 'تخريج الطالب' لإدخال بيانات التخرج الكاملة (السنة، المعدل، رقم الشهادة)."
        )
    return status


async def _apply_status_change(
    db,
    student_id: str,
    new_status: str,
    new_level: Optional[int],
    reason: str,
    effective_date: str,
    user_id: str,
    username: str,
) -> dict:
    """تطبيق تغيير الحالة على طالب واحد + تسجيل التاريخ."""
    try:
        oid = ObjectId(student_id)
    except Exception:
        return {"id": student_id, "ok": False, "error": "معرف غير صحيح"}

    student = await db.students.find_one({"_id": oid})
    if not student:
        return {"id": student_id, "ok": False, "error": "الطالب غير موجود"}

    old_status = student.get("status") or ("active" if student.get("is_active", True) else "inactive")
    old_level = student.get("level")

    update_data = {
        "status": new_status,
        "status_changed_at": effective_date,
        "status_changed_by": user_id,
    }
    if reason:
        update_data["status_reason"] = reason

    # ضبط is_active حسب الحالة
    update_data["is_active"] = new_status not in INACTIVE_STATUSES

    # تحديث المستوى لو طُلب
    if new_level is not None:
        update_data["level"] = int(new_level)

    # حقول خاصة بالحالة
    if new_status == "graduated":
        update_data["graduation_date"] = effective_date
        update_data["graduated_from_level"] = new_level if new_level is not None else old_level
    elif new_status == "expelled":
        update_data["expulsion_date"] = effective_date
    elif new_status == "frozen":
        update_data["frozen_at"] = effective_date

    # 📸 حفظ snapshot لحظة تغيير الحالة (لكل الحالات غير النشطة)
    # يحفظ المستوى + الشعبة + الفصل + العام الجامعي + القسم/الكلية
    # يمنع فقدان هذه البيانات عند تغييرات لاحقة على المستوى/الشعبة
    if new_status in {"frozen", "repeat", "expelled"} and not student.get("status_snapshot"):
        # نأخذ snapshot فقط عند أول انتقال لحالة غير نشطة (لا نُحدّثه لاحقاً)
        active_sem = await db.semesters.find_one({"status": "active"})
        snapshot = {
            "level": student.get("level"),
            "section": student.get("section"),
            "semester_id": str(active_sem["_id"]) if active_sem else None,
            "semester_name": (active_sem or {}).get("name") if active_sem else None,
            "academic_year_id": (active_sem or {}).get("academic_year_id") if active_sem else student.get("academic_year_id"),
            # 🔧 حقل الـ semesters هو 'academic_year' وليس 'year'
            "academic_year": student.get("academic_year") or (active_sem or {}).get("academic_year"),
            "department_id": str(student.get("department_id") or "") or None,
            "faculty_id": str(student.get("faculty_id") or "") or None,
            "captured_at": effective_date,
        }
        update_data["status_snapshot"] = snapshot

    # 🔄 عند الاسترجاع للحالة النشطة، امسح ال snapshot
    if new_status == "active":
        # يستخدم unset ضمن نفس عملية update
        pass  # سنمرّرها في الاستدعاء

    await db.students.update_one({"_id": oid}, {"$set": update_data})

    # 🧹 عند الانتقال لحالة غير نشطة: إزالة تسجيلات الفصل النشط (يختفي من قوائم التحضير)
    # التاريخية (الفصول المغلقة) محفوظة — وعند الاسترجاع يُعاد التسجيل تلقائياً
    if new_status in INACTIVE_STATUSES:
        try:
            from .student_transfer import cleanup_active_enrollments
            await cleanup_active_enrollments(db, student_id)
        except Exception:
            pass

    if new_status == "active":
        await db.students.update_one({"_id": oid}, {"$unset": {"status_snapshot": ""}})
        # 🎓 عودة للنشاط عبر تغيير الحالة: إعادة التسجيل في مقررات موقعه الحالي
        try:
            from .deps import enroll_student_in_matching_courses
            fresh = await db.students.find_one({"_id": oid})
            if fresh:
                await enroll_student_in_matching_courses(db, fresh)
        except Exception:
            pass

    # تسجيل التاريخ
    history_doc = {
        "student_id": student_id,
        "student_db_id": student_id,
        "student_full_name": student.get("full_name", ""),
        "student_ref_number": student.get("student_id", ""),
        "old_status": old_status,
        "new_status": new_status,
        "old_level": old_level,
        "new_level": new_level if new_level is not None else old_level,
        "reason": reason,
        "effective_date": effective_date,
        "changed_by_user_id": user_id,
        "changed_by_username": username,
        "created_at": _now_iso(),
    }
    await db.student_status_history.insert_one(history_doc)

    return {
        "id": student_id,
        "ok": True,
        "student_name": student.get("full_name", ""),
        "old_status": old_status,
        "new_status": new_status,
    }


# ==================== Bulk Change Status ====================

@router.post("/student-status/bulk-change")
async def bulk_change_status(
    payload: BulkChangeStatusRequest,
    current_user: dict = Depends(get_current_user),
):
    """تغيير حالة مجموعة طلاب دفعة واحدة.
    - new_status: active / repeat / graduated / expelled / frozen
    - new_level: اختياري (للإعادة لمستوى أقل، أو النقل مع تغيير الحالة)
    - reason: ملاحظة اختيارية
    - effective_date: تاريخ التطبيق (افتراضي: الآن)
    """
    from models.permissions import Permission
    perms = set(current_user.get("permissions") or [])
    if current_user.get("role") != "admin" and Permission.MANAGE_STUDENTS not in perms:
        raise HTTPException(status_code=403, detail="غير مصرح لك بإدارة حالات الطلاب")

    _validate_status(payload.new_status)
    db = get_db()
    eff_date = payload.effective_date or _now_iso()

    results = []
    for sid in payload.student_ids:
        r = await _apply_status_change(
            db, sid, payload.new_status, payload.new_level,
            payload.reason or "", eff_date,
            current_user.get("id"), current_user.get("username", ""),
        )
        results.append(r)

    success_count = sum(1 for r in results if r["ok"])
    failed_count = len(results) - success_count

    # سجل النشاط العام
    try:
        await db.activity_logs.insert_one({
            "user_id": current_user.get("id"),
            "username": current_user.get("username"),
            "action": "bulk_change_student_status",
            "target_type": "students",
            "details": f"تغيير {success_count} طالب إلى حالة '{STATUS_LABELS.get(payload.new_status)}'",
            "timestamp": _now_iso(),
        })
    except Exception:
        pass

    return {
        "message": f"تم تغيير حالة {success_count} طالب إلى '{STATUS_LABELS.get(payload.new_status)}'",
        "success_count": success_count,
        "failed_count": failed_count,
        "new_status": payload.new_status,
        "new_status_label": STATUS_LABELS.get(payload.new_status),
        "results": results,
    }


# ==================== Single Change ====================

@router.post("/student-status/{student_id}/change")
async def change_student_status(
    student_id: str,
    payload: SingleChangeStatusRequest,
    current_user: dict = Depends(get_current_user),
):
    """تغيير حالة طالب فردي."""
    from models.permissions import Permission
    perms = set(current_user.get("permissions") or [])
    if current_user.get("role") != "admin" and Permission.MANAGE_STUDENTS not in perms:
        raise HTTPException(status_code=403, detail="غير مصرح")

    _validate_status(payload.new_status)
    db = get_db()
    eff_date = payload.effective_date or _now_iso()

    r = await _apply_status_change(
        db, student_id, payload.new_status, payload.new_level,
        payload.reason or "", eff_date,
        current_user.get("id"), current_user.get("username", ""),
    )
    if not r["ok"]:
        raise HTTPException(status_code=400, detail=r.get("error", "فشل التحديث"))
    return {
        "message": f"تم تغيير حالة الطالب إلى '{STATUS_LABELS.get(payload.new_status)}'",
        **r,
    }


# ==================== Status History ====================

@router.get("/student-status/{student_id}/history")
async def get_student_status_history(
    student_id: str,
    current_user: dict = Depends(get_current_user),
):
    """تاريخ تغييرات الحالة لطالب معين."""
    from models.permissions import Permission
    perms = set(current_user.get("permissions") or [])
    is_admin = current_user.get("role") == "admin"
    if not is_admin and Permission.MANAGE_STUDENTS not in perms and Permission.VIEW_STUDENTS not in perms:
        raise HTTPException(status_code=403, detail="غير مصرح")

    db = get_db()
    items = []
    async for h in db.student_status_history.find(
        {"student_db_id": student_id}
    ).sort("created_at", -1):
        h["id"] = str(h.pop("_id"))
        items.append(h)
    return {"items": items, "total": len(items), "student_id": student_id}


# ==================== Status Statistics ====================

@router.get("/student-status/stats")
async def get_status_stats(
    department_id: Optional[str] = None,
    faculty_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """إحصائيات حالات الطلاب (مع فلاتر اختيارية)."""
    from models.permissions import Permission
    perms = set(current_user.get("permissions") or [])
    is_admin = current_user.get("role") == "admin"
    if not is_admin and Permission.MANAGE_STUDENTS not in perms and Permission.VIEW_STUDENTS not in perms:
        raise HTTPException(status_code=403, detail="غير مصرح")

    db = get_db()
    match = {}
    if department_id:
        match["department_id"] = department_id
    if faculty_id:
        match["faculty_id"] = faculty_id

    stats = {s: 0 for s in VALID_STATUSES}
    stats["unset"] = 0  # طلاب بدون حقل status (قديمون)
    total = 0

    async for s in db.students.find(match, {"status": 1, "is_active": 1}):
        total += 1
        st = s.get("status")
        if st in VALID_STATUSES:
            stats[st] += 1
        else:
            # طلاب قدامى بدون status صريح
            if s.get("is_active", True):
                stats["active"] += 1
            else:
                stats["unset"] += 1

    return {
        "total": total,
        "stats": stats,
        "labels": STATUS_LABELS,
        "filters": {"department_id": department_id, "faculty_id": faculty_id},
    }


# ==================== List Students by Status ====================

@router.get("/student-statuses")
async def list_students_by_status(
    status: Optional[str] = None,  # frozen | repeat | expelled | all
    faculty_id: Optional[str] = None,
    department_id: Optional[str] = None,
    q: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """قائمة الطلاب غير المستمرين (مجمَّد / إعادة / مفصول).

    يعرض بيانات الطالب مع الـ snapshot المحفوظ لحظة تغيير الحالة
    (المستوى/الشعبة/الفصل/العام الجامعي/القسم/الكلية).
    """
    from models.permissions import Permission
    perms = set(current_user.get("permissions") or [])
    is_admin = current_user.get("role") == "admin"
    if not is_admin and Permission.MANAGE_STUDENTS not in perms and Permission.VIEW_STUDENTS not in perms:
        raise HTTPException(status_code=403, detail="غير مصرح")

    db = get_db()
    NON_ACTIVE = ["frozen", "repeat", "expelled"]
    query: dict = {"status": {"$in": NON_ACTIVE}} if not status or status == "all" else {"status": status}

    # نطاق المستخدم (نفس منطق باقي الـ endpoints)
    user_dept = current_user.get("department_id")
    user_fac = current_user.get("faculty_id")
    if not is_admin:
        if user_dept:
            query["department_id"] = str(user_dept)
        elif user_fac:
            query["faculty_id"] = str(user_fac)

    # فلاتر إضافية
    if department_id:
        query["department_id"] = department_id
    if faculty_id:
        query["faculty_id"] = faculty_id

    if q:
        import re as _re
        rx = {"$regex": _re.escape(q), "$options": "i"}
        or_clauses = [{"full_name": rx}, {"student_id": rx}, {"reference_number": rx}]
        if "$or" in query:
            existing_or = query.pop("$or")
            query["$and"] = [{"$or": existing_or}, {"$or": or_clauses}]
        else:
            query["$or"] = or_clauses

    students = await db.students.find(query).sort([("status_changed_at", -1), ("full_name", 1)]).to_list(5000)

    # إثراء بأسماء الأقسام والكليات
    dept_ids = list({str(s.get("department_id") or "") for s in students if s.get("department_id")})
    fac_ids: set = set()
    dept_map: dict = {}
    if dept_ids:
        async for d in db.departments.find({"_id": {"$in": [ObjectId(x) for x in dept_ids if x]}}):
            dept_map[str(d["_id"])] = {
                "name": (d.get("name") or "").strip(),
                "faculty_id": str(d.get("faculty_id") or "") or None,
            }
            if d.get("faculty_id"):
                fac_ids.add(str(d["faculty_id"]))
    fac_map: dict = {}
    if fac_ids:
        async for f in db.faculties.find({"_id": {"$in": [ObjectId(x) for x in fac_ids if x]}}):
            fac_map[str(f["_id"])] = (f.get("name") or "").strip()

    items = []
    for s in students:
        snap = s.get("status_snapshot") or {}
        dept_id_str = str(s.get("department_id") or "") or None
        dept_info = dept_map.get(dept_id_str, {}) if dept_id_str else {}
        current_fac_name = fac_map.get(dept_info.get("faculty_id") or "", "") if dept_info else ""
        items.append({
            "id": str(s["_id"]),
            "student_id": s.get("student_id"),
            "reference_number": s.get("reference_number"),
            "full_name": s.get("full_name"),
            "phone": s.get("phone"),
            "email": s.get("email"),
            "status": s.get("status"),
            "status_label": STATUS_LABELS.get(s.get("status", ""), s.get("status", "")),
            "reason": s.get("status_reason"),
            "changed_at": s.get("status_changed_at"),
            # القسم/الكلية الحالية (احتياطياً)
            "department_id": dept_id_str,
            "department_name": dept_info.get("name") or None,
            "faculty_id": dept_info.get("faculty_id") or None,
            "faculty_name": current_fac_name or None,
            # الـ snapshot لحظة تغيير الحالة (المصدر الرئيسي للعرض)
            "snapshot_level": snap.get("level") if snap else s.get("level"),
            "snapshot_section": snap.get("section") if snap else s.get("section"),
            "snapshot_semester_id": snap.get("semester_id") if snap else None,
            "snapshot_semester_name": snap.get("semester_name") if snap else None,
            "snapshot_academic_year": snap.get("academic_year") if snap else s.get("academic_year"),
            "snapshot_captured_at": snap.get("captured_at") if snap else s.get("status_changed_at"),
            "has_snapshot": bool(snap),
        })
    return {"items": items, "total": len(items), "labels": STATUS_LABELS}


# ==================== Restore to Active ====================

class RestoreStatusRequest(BaseModel):
    new_level: int = Field(..., ge=1, le=8)
    new_section: Optional[str] = None
    reason: Optional[str] = "استرجاع للحالة النشطة"


@router.post("/student-status/{student_id}/restore")
async def restore_student_to_active(
    student_id: str,
    payload: RestoreStatusRequest,
    current_user: dict = Depends(get_current_user),
):
    """استرجاع طالب غير مستمر إلى الحالة النشطة مع اختيار المستوى والشعبة."""
    from models.permissions import Permission
    perms = set(current_user.get("permissions") or [])
    if current_user.get("role") != "admin" and Permission.MANAGE_STUDENTS not in perms:
        raise HTTPException(status_code=403, detail="غير مصرح")

    db = get_db()
    try:
        oid = ObjectId(student_id)
    except Exception:
        raise HTTPException(status_code=400, detail="معرف غير صحيح")
    student = await db.students.find_one({"_id": oid})
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")

    old_status = student.get("status") or "inactive"
    if old_status not in {"frozen", "repeat", "expelled"}:
        raise HTTPException(status_code=400, detail=f"لا يمكن استرجاع طالب في حالة '{STATUS_LABELS.get(old_status, old_status)}'")

    eff_date = _now_iso()
    update_data = {
        "status": "active",
        "is_active": True,
        "level": int(payload.new_level),
        "status_changed_at": eff_date,
        "status_changed_by": current_user.get("id"),
        "status_reason": payload.reason or "استرجاع للحالة النشطة",
    }
    if payload.new_section is not None:
        # نكتب حتى لو كانت "" (سلسلة فارغة) لدعم "بدون شعبة" كما كان الطالب أصلاً
        update_data["section"] = payload.new_section

    await db.students.update_one(
        {"_id": oid},
        {
            "$set": update_data,
            "$unset": {
                "status_snapshot": "",
                "frozen_at": "",
                "expulsion_date": "",
            },
        },
    )

    # سجل التاريخ
    await db.student_status_history.insert_one({
        "student_id": student_id,
        "student_db_id": student_id,
        "student_full_name": student.get("full_name", ""),
        "student_ref_number": student.get("student_id", ""),
        "old_status": old_status,
        "new_status": "active",
        "old_level": student.get("level"),
        "new_level": int(payload.new_level),
        "new_section": payload.new_section,
        "reason": payload.reason or "استرجاع للحالة النشطة",
        "effective_date": eff_date,
        "changed_by_user_id": current_user.get("id"),
        "changed_by_username": current_user.get("username"),
        "created_at": eff_date,
    })

    # 🎓 إعادة التسجيل التلقائي في مقررات الفصل النشط المطابقة لموقعه الجديد
    enrolled_count = 0
    try:
        from .deps import enroll_student_in_matching_courses
        fresh = await db.students.find_one({"_id": oid})
        if fresh:
            enrolled_count = await enroll_student_in_matching_courses(db, fresh)
    except Exception:
        pass

    return {
        "success": True,
        "message": f"تم استرجاع الطالب '{student.get('full_name', '')}' إلى المستوى {payload.new_level} {payload.new_section or ''}"
                   + (f" — وسُجّل تلقائياً في {enrolled_count} مقرر" if enrolled_count else ""),
        "student_id": student_id,
        "new_level": payload.new_level,
        "new_section": payload.new_section,
        "enrolled_courses": enrolled_count,
    }


# ==================== Available Sections for Restore Dialog ====================

@router.get("/student-status/available-sections")
async def get_available_sections(
    department_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """يُرجع قائمة المستويات والشعب المتاحة (لعرض القوائم في مودال الاسترجاع).
    يُنشئ 4 مستويات × الشعب الفعلية من قسم الطالب.
    """
    db = get_db()
    sections: List[str] = []
    if department_id:
        # الشعب الفعلية من طلاب نفس القسم (يحفظ التاريخ الحقيقي)
        async for s in db.students.aggregate([
            {"$match": {"department_id": department_id, "is_active": True}},
            {"$group": {"_id": "$section"}},
        ]):
            if s.get("_id"):
                sections.append(s["_id"])
        sections = sorted(list(set(sections))) or ["أ", "ب"]
    else:
        sections = ["أ", "ب"]
    return {
        "levels": [1, 2, 3, 4],
        "sections": sections,
    }
