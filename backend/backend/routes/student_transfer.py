"""
🔄 Student Transfer Routes — نقل الطلاب بين الكليات/الأقسام/المستويات/الشُّعب

Endpoints:
- POST /api/students/{id}/transfer          → نقل طالب واحد
- POST /api/students/bulk-transfer          → نقل دفعة طلاب
- GET  /api/students/{id}/transfer-history  → سجل النقل للطالب

ملاحظات معمارية:
- يستخدم نفس صلاحية `manage_students` (لا صلاحية جديدة)
- يحترم النطاق (scope): المستخدم يستطيع النقل فقط ضمن نطاقه
- يحفظ snapshot كامل من البيانات القديمة في collection `student_transfer_history`
- يحدّث `faculty_id`/`department_id`/`level`/`section` على وثيقة الطالب
- يُلغي تسجيل الطالب في مقررات الفصل النشط (لأن خطته تغيّرت)
- يُرسل إشعار للطالب
- يُسجّل في activity_logs
"""
from typing import Optional
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .deps import get_current_user, get_db, has_any_permission, log_activity
from models.permissions import Permission

router = APIRouter(tags=["نقل الطلاب"])


# ============================
# Models
# ============================
class TransferRequest(BaseModel):
    target_faculty_id: Optional[str] = Field(None, description="معرف الكلية الجديدة (اختياري إن نُقل ضمن نفس الكلية)")
    target_department_id: str = Field(..., description="معرف القسم الجديد")
    target_level: int = Field(..., ge=1, le=10, description="المستوى الجديد")
    target_section: str = Field("", description="الشعبة الجديدة (اختيارية — اتركها فارغة إن لم توجد شعب في المستوى الهدف)")
    reason: Optional[str] = Field(None, max_length=500, description="سبب النقل (اختياري)")


class BulkTransferRequest(BaseModel):
    student_ids: list[str] = Field(..., min_length=1, description="قائمة معرفات الطلاب")
    target_faculty_id: Optional[str] = None
    target_department_id: str
    target_level: int = Field(..., ge=1, le=10)
    target_section: str = ""
    reason: Optional[str] = Field(None, max_length=500)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _ensure_can_manage_students(current_user: dict):
    if current_user.get("role") == "admin":
        return
    if has_any_permission(current_user, [Permission.MANAGE_STUDENTS]):
        return
    raise HTTPException(status_code=403, detail="ليس لديك صلاحية لإدارة الطلاب")


async def _ensure_student_in_user_scope(db, current_user: dict, student: dict):
    """يتأكد أن الطالب الحالي ضمن نطاق كلية/قسم المستخدم."""
    if current_user.get("role") == "admin":
        return
    user_dept_id = current_user.get("department_id")
    user_faculty_id = current_user.get("faculty_id")
    s_dept = str(student.get("department_id") or "")
    s_fac = str(student.get("faculty_id") or "")
    if not s_fac and s_dept:
        try:
            d = await db.departments.find_one({"_id": ObjectId(s_dept)})
            if d and d.get("faculty_id"):
                s_fac = str(d.get("faculty_id"))
        except Exception:
            pass
    if user_dept_id and s_dept != str(user_dept_id):
        raise HTTPException(status_code=403, detail="هذا الطالب ليس ضمن نطاقك")
    if user_faculty_id and not user_dept_id and s_fac != str(user_faculty_id):
        raise HTTPException(status_code=403, detail="هذا الطالب ليس من كليتك")


async def _ensure_target_in_user_scope(db, current_user: dict, target_dept_id: str, target_faculty_id: Optional[str]):
    """يتأكد أن الوجهة (القسم/الكلية الجديدة) ضمن نطاق المستخدم."""
    if current_user.get("role") == "admin":
        return
    user_dept_id = current_user.get("department_id")
    user_faculty_id = current_user.get("faculty_id")
    # رئيس قسم: لا يستطيع النقل لقسم آخر
    if user_dept_id and str(target_dept_id) != str(user_dept_id):
        raise HTTPException(status_code=403, detail="لا يمكنك النقل خارج قسمك")
    # عميد كلية: لا يستطيع النقل لكلية أخرى
    if user_faculty_id and not user_dept_id:
        # اجلب كلية القسم الهدف
        try:
            d = await db.departments.find_one({"_id": ObjectId(target_dept_id)})
            target_fac = str(d.get("faculty_id")) if d else ""
        except Exception:
            target_fac = ""
        if target_fac and target_fac != str(user_faculty_id):
            raise HTTPException(status_code=403, detail="لا يمكنك النقل خارج كليتك")


async def _resolve_target(db, body_dept: str, body_faculty: Optional[str]):
    """يتحقّق من وجود القسم والكلية، ويُكمل faculty_id من القسم إن لم يُرسل."""
    try:
        dept = await db.departments.find_one({"_id": ObjectId(body_dept)})
    except Exception:
        raise HTTPException(status_code=400, detail="معرّف القسم غير صالح")
    if not dept:
        raise HTTPException(status_code=404, detail="القسم الهدف غير موجود")
    target_faculty_id = body_faculty or str(dept.get("faculty_id") or "")
    if not target_faculty_id:
        raise HTTPException(status_code=400, detail="لم يتم تحديد الكلية الهدف")
    # تحقق من تطابق القسم مع الكلية المرسلة
    if body_faculty and str(dept.get("faculty_id")) != str(body_faculty):
        raise HTTPException(status_code=400, detail="القسم لا ينتمي للكلية المحددة")
    # اسماء لتجميل سجل التاريخ
    fac = await db.faculties.find_one({"_id": ObjectId(target_faculty_id)})
    return {
        "department_id": str(dept["_id"]),
        "department_name": dept.get("name", ""),
        "faculty_id": target_faculty_id,
        "faculty_name": (fac.get("name") if fac else ""),
    }


async def _build_snapshot(db, student: dict) -> dict:
    """يبني لقطة (snapshot) من بيانات الطالب القديمة لحفظها في التاريخ."""
    dept_name = ""
    fac_name = ""
    try:
        if student.get("department_id"):
            d = await db.departments.find_one({"_id": ObjectId(student["department_id"])})
            if d:
                dept_name = d.get("name", "")
                if not student.get("faculty_id") and d.get("faculty_id"):
                    f = await db.faculties.find_one({"_id": ObjectId(d["faculty_id"])})
                    fac_name = f.get("name", "") if f else ""
        if student.get("faculty_id") and not fac_name:
            f = await db.faculties.find_one({"_id": ObjectId(student["faculty_id"])})
            fac_name = f.get("name", "") if f else ""
    except Exception:
        pass
    return {
        "faculty_id": str(student.get("faculty_id") or ""),
        "faculty_name": fac_name,
        "department_id": str(student.get("department_id") or ""),
        "department_name": dept_name,
        "level": student.get("level"),
        "section": student.get("section"),
    }


async def cleanup_active_enrollments(db, student_id: str) -> int:
    """حذف تسجيلات الفصل النشط للطالب عند تغيير قسمه/نقله.

    يشمل التسجيلات القديمة بلا semester_id إذا كان مقررها في الفصل النشط
    أو كان المقرر محذوفاً، مع الحفاظ على سجلات الفصول المغلقة (تاريخ أكاديمي).
    """
    active_sem = await db.semesters.find_one({"$or": [{"status": "active"}, {"is_active": True}]})
    active_id = str(active_sem["_id"]) if active_sem else None
    deleted = 0
    if active_id:
        res = await db.enrollments.delete_many({"student_id": student_id, "semester_id": active_id})
        deleted += res.deleted_count
    legacy = await db.enrollments.find({
        "student_id": student_id,
        "$or": [
            {"semester_id": None},
            {"semester_id": ""},
            {"semester_id": {"$exists": False}},
        ],
    }).to_list(1000)
    for e in legacy:
        cid = str(e.get("course_id") or "")
        course = None
        if cid and ObjectId.is_valid(cid):
            course = await db.courses.find_one({"_id": ObjectId(cid)}, {"semester_id": 1})
        if course is None or (active_id and str(course.get("semester_id") or "") == active_id):
            await db.enrollments.delete_one({"_id": e["_id"]})
            deleted += 1
    return deleted


async def _perform_transfer(db, student: dict, target: dict, target_level: int, target_section: str,
                             current_user: dict, reason: Optional[str]) -> dict:
    """
    ينفّذ النقل الفعلي على وثيقة الطالب:
    - يحفظ snapshot في student_transfer_history
    - يحدّث الطالب
    - يُلغي enrollments في المقررات النشطة
    - يُرسل إشعار
    """
    snapshot_from = await _build_snapshot(db, student)
    snapshot_to = {
        "faculty_id": target["faculty_id"],
        "faculty_name": target["faculty_name"],
        "department_id": target["department_id"],
        "department_name": target["department_name"],
        "level": target_level,
        "section": target_section,
    }

    # 1) سجّل في التاريخ
    history_doc = {
        "student_id": str(student["_id"]),
        "student_name": student.get("full_name", ""),
        "student_code": student.get("student_id", ""),
        "from": snapshot_from,
        "to": snapshot_to,
        "reason": (reason or "").strip(),
        "transferred_by": str(current_user.get("_id") or current_user.get("id") or ""),
        "transferred_by_name": current_user.get("full_name") or current_user.get("username", ""),
        "transferred_at": _now_iso(),
    }
    await db.student_transfer_history.insert_one(history_doc)

    # 2) حدّث الطالب
    await db.students.update_one(
        {"_id": student["_id"]},
        {"$set": {
            "faculty_id": target["faculty_id"],
            "department_id": target["department_id"],
            "level": int(target_level),
            "section": target_section,
            "last_transferred_at": _now_iso(),
        }}
    )

    # 3) ألغِ enrollments للفصل النشط (بما فيها القديمة بلا semester_id — خطته الجديدة تختلف)
    try:
        await cleanup_active_enrollments(db, str(student["_id"]))
    except Exception:
        pass

    # 3.5) 🎓 سجّله تلقائياً في مقررات وجهته الجديدة (بما فيها المشتركة)
    enrolled_new = 0
    try:
        from .deps import enroll_student_in_matching_courses
        _fresh = await db.students.find_one({"_id": student["_id"]})
        enrolled_new = await enroll_student_in_matching_courses(db, _fresh)
    except Exception:
        pass

    # 4) إشعار للطالب
    try:
        # ابحث عن user مرتبط بهذا الطالب
        student_user = None
        if student.get("user_id"):
            try:
                student_user = await db.users.find_one({"_id": ObjectId(student["user_id"])})
            except Exception:
                pass
        if not student_user:
            student_user = await db.users.find_one({"student_id_ref": str(student["_id"])})
        recipient_id = str(student_user["_id"]) if student_user else str(student["_id"])
        note_body = (
            f"تم نقلك إلى كلية: {snapshot_to['faculty_name']} • قسم: {snapshot_to['department_name']} • "
            f"المستوى: {target_level} • الشعبة: {target_section}"
        )
        await db.notifications.insert_one({
            "user_id": recipient_id,
            "title": "🔄 إشعار نقل أكاديمي",
            "body": note_body,
            "type": "student_transfer",
            "is_read": False,
            "created_at": _now_iso(),
            "meta": {
                "from": snapshot_from,
                "to": snapshot_to,
                "reason": reason or "",
            },
        })
    except Exception:
        pass

    # 5) Log
    try:
        await log_activity(
            user=current_user,
            action="student_transfer",
            entity_type="student",
            entity_id=str(student["_id"]),
            entity_name=student.get("full_name", ""),
            details={
                "from": snapshot_from,
                "to": snapshot_to,
                "reason": reason or "",
            }
        )
    except Exception:
        pass

    return {"history_id": str(history_doc.get("_id", "")), "from": snapshot_from, "to": snapshot_to, "enrolled_in_new_courses": enrolled_new}


# ============================
# 1) نقل طالب واحد
# ============================
@router.post("/students/{student_id}/transfer")
async def transfer_student(
    student_id: str,
    body: TransferRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    _ensure_can_manage_students(current_user)
    try:
        student = await db.students.find_one({"_id": ObjectId(student_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="معرّف الطالب غير صالح")
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    if student.get("is_alumni"):
        raise HTTPException(status_code=400, detail="لا يمكن نقل خرّيج")

    await _ensure_student_in_user_scope(db, current_user, student)

    target = await _resolve_target(db, body.target_department_id, body.target_faculty_id)
    await _ensure_target_in_user_scope(db, current_user, target["department_id"], target["faculty_id"])

    # تحقق من تغير حقيقي (لا نقل لنفس المكان)
    same = (
        str(student.get("department_id") or "") == target["department_id"]
        and int(student.get("level") or 0) == int(body.target_level)
        and (student.get("section") or "") == body.target_section
    )
    if same:
        raise HTTPException(status_code=400, detail="البيانات الجديدة مطابقة للحالية - لا حاجة للنقل")

    result = await _perform_transfer(
        db, student, target,
        target_level=body.target_level,
        target_section=body.target_section,
        current_user=current_user,
        reason=body.reason,
    )
    return {
        "ok": True,
        "message": f"تم نقل الطالب '{student.get('full_name','')}' بنجاح",
        **result,
    }


# ============================
# 2) نقل دفعة طلاب
# ============================
@router.post("/students/bulk-transfer")
async def bulk_transfer_students(
    body: BulkTransferRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    _ensure_can_manage_students(current_user)
    target = await _resolve_target(db, body.target_department_id, body.target_faculty_id)
    await _ensure_target_in_user_scope(db, current_user, target["department_id"], target["faculty_id"])

    succeeded = 0
    failed = []
    for sid in body.student_ids:
        try:
            student = await db.students.find_one({"_id": ObjectId(sid)})
            if not student:
                failed.append({"id": sid, "error": "غير موجود"})
                continue
            if student.get("is_alumni"):
                failed.append({"id": sid, "error": "خريج - لا يمكن نقله"})
                continue
            try:
                await _ensure_student_in_user_scope(db, current_user, student)
            except HTTPException as e:
                failed.append({"id": sid, "error": e.detail})
                continue
            # تخطّ من بياناته مطابقة
            same = (
                str(student.get("department_id") or "") == target["department_id"]
                and int(student.get("level") or 0) == int(body.target_level)
                and (student.get("section") or "") == body.target_section
            )
            if same:
                failed.append({"id": sid, "error": "بياناته مطابقة"})
                continue
            await _perform_transfer(
                db, student, target,
                target_level=body.target_level,
                target_section=body.target_section,
                current_user=current_user,
                reason=body.reason,
            )
            succeeded += 1
        except Exception as e:
            failed.append({"id": sid, "error": str(e)[:120]})

    return {
        "ok": True,
        "succeeded": succeeded,
        "failed_count": len(failed),
        "failed": failed,
        "message": f"تم نقل {succeeded} من {len(body.student_ids)} طالباً",
    }


# ============================
# 3) سجل النقل لطالب
# ============================
@router.get("/students/{student_id}/transfer-history")
async def get_transfer_history(
    student_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    _ensure_can_manage_students(current_user)
    try:
        student = await db.students.find_one({"_id": ObjectId(student_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="معرّف الطالب غير صالح")
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    await _ensure_student_in_user_scope(db, current_user, student)

    cursor = db.student_transfer_history.find({"student_id": str(student_id)}).sort("transferred_at", -1)
    items = []
    async for doc in cursor:
        doc["id"] = str(doc.pop("_id"))
        items.append(doc)
    return {"items": items, "total": len(items)}
