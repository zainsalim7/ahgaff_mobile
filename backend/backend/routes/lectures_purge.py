"""
🗑️ مسح جماعي للمحاضرات المولدة (بتواريخ) حسب الكلية/القسم/المقرر
يحذف المحاضرات + سجلات حضورها فقط — لا يمس المقررات ولا الإسنادات ولا الجدول الأسبوعي.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from bson import ObjectId

from .deps import get_db, get_current_user, log_activity

router = APIRouter(tags=["مسح المحاضرات"])

YEMEN_TZ = timezone(timedelta(hours=3))


def _can_purge(u: dict) -> bool:
    return u.get("role") == "admin" or "manage_lectures" in (u.get("permissions") or [])


class PurgeRequest(BaseModel):
    scope: str  # faculty | department | course
    faculty_id: Optional[str] = None
    department_id: Optional[str] = None
    course_id: Optional[str] = None
    future_only: bool = False


async def _resolve_scope(db, data: PurgeRequest):
    """يعيد (قائمة معرفات المقررات، وصف النطاق)"""
    if data.scope == "course":
        if not data.course_id:
            raise HTTPException(status_code=400, detail="حدد المقرر")
        c = await db.courses.find_one({"_id": ObjectId(data.course_id)})
        if not c:
            raise HTTPException(status_code=404, detail="المقرر غير موجود")
        return [data.course_id], f"مقرر '{c.get('name', '')}'"
    if data.scope == "department":
        if not data.department_id:
            raise HTTPException(status_code=400, detail="حدد القسم")
        d = await db.departments.find_one({"_id": ObjectId(data.department_id)})
        if not d:
            raise HTTPException(status_code=404, detail="القسم غير موجود")
        courses = await db.courses.find({"department_id": data.department_id}, {"_id": 1}).to_list(10000)
        return [str(c["_id"]) for c in courses], f"قسم '{d.get('name', '')}'"
    if data.scope == "faculty":
        if not data.faculty_id:
            raise HTTPException(status_code=400, detail="حدد الكلية")
        f = await db.faculties.find_one({"_id": ObjectId(data.faculty_id)})
        if not f:
            raise HTTPException(status_code=404, detail="الكلية غير موجودة")
        depts = [str(d["_id"]) for d in await db.departments.find({"faculty_id": data.faculty_id}, {"_id": 1}).to_list(500)]
        courses = await db.courses.find({"department_id": {"$in": depts}}, {"_id": 1}).to_list(20000)
        return [str(c["_id"]) for c in courses], f"كلية '{f.get('name', '')}'"
    raise HTTPException(status_code=400, detail="نطاق غير صحيح")


def _lectures_query(course_ids, future_only: bool):
    q = {"course_id": {"$in": course_ids}}
    if future_only:
        q["date"] = {"$gte": datetime.now(YEMEN_TZ).strftime("%Y-%m-%d")}
    return q


@router.post("/lectures/purge/preview")
async def purge_preview(data: PurgeRequest, current_user: dict = Depends(get_current_user)):
    """معاينة: كم محاضرة ستُحذف وكم منها عليها حضور"""
    if not _can_purge(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    course_ids, scope_desc = await _resolve_scope(db, data)
    if not course_ids:
        return {"scope_desc": scope_desc, "total": 0, "future": 0, "with_attendance": 0, "attendance_records": 0,
                "message": f"لا توجد مقررات في {scope_desc}"}
    q = _lectures_query(course_ids, data.future_only)
    lids = [str(l["_id"]) for l in await db.lectures.find(q, {"_id": 1}).to_list(100000)]
    today = datetime.now(YEMEN_TZ).strftime("%Y-%m-%d")
    future = await db.lectures.count_documents({**q, "date": {"$gte": today}})
    att_records = await db.attendance.count_documents({"lecture_id": {"$in": lids}}) if lids else 0
    with_att = len(await db.attendance.distinct("lecture_id", {"lecture_id": {"$in": lids}})) if lids else 0
    return {
        "scope_desc": scope_desc,
        "total": len(lids),
        "future": future,
        "with_attendance": with_att,
        "attendance_records": att_records,
        "message": (
            f"سيُحذف {len(lids)} محاضرة من {scope_desc}"
            + (" (المستقبلية فقط)" if data.future_only else "")
            + (f" — منها {with_att} محاضرة عليها {att_records} سجل حضور سيُحذف معها" if with_att else " — لا توجد سجلات حضور مرتبطة")
        ),
    }


@router.post("/lectures/purge")
async def purge_lectures(data: PurgeRequest, current_user: dict = Depends(get_current_user)):
    """تنفيذ المسح: يحذف المحاضرات وسجلات حضورها — لا يمس المقررات/الإسنادات/الجدول الأسبوعي"""
    if not _can_purge(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    course_ids, scope_desc = await _resolve_scope(db, data)
    if not course_ids:
        return {"deleted_lectures": 0, "deleted_attendance": 0, "message": f"لا توجد مقررات في {scope_desc}"}
    q = _lectures_query(course_ids, data.future_only)
    lids = [str(l["_id"]) for l in await db.lectures.find(q, {"_id": 1}).to_list(100000)]
    att = await db.attendance.delete_many({"lecture_id": {"$in": lids}}) if lids else None
    lec = await db.lectures.delete_many({"_id": {"$in": [ObjectId(x) for x in lids]}}) if lids else None
    await log_activity(current_user, "purge_lectures", "lectures", data.course_id or data.department_id or data.faculty_id or "", None,
                       {"scope": data.scope, "scope_desc": scope_desc, "future_only": data.future_only,
                        "deleted_lectures": lec.deleted_count if lec else 0,
                        "deleted_attendance": att.deleted_count if att else 0})
    return {
        "deleted_lectures": lec.deleted_count if lec else 0,
        "deleted_attendance": att.deleted_count if att else 0,
        "message": f"✅ حُذفت {lec.deleted_count if lec else 0} محاضرة"
                   + (f" و{att.deleted_count} سجل حضور" if att and att.deleted_count else "")
                   + f" من {scope_desc}" + (" (المستقبلية فقط)" if data.future_only else ""),
    }
