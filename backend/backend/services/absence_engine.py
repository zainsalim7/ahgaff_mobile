"""📐 محرّك احتساب غياب الطلاب — المصدر الوحيد للحقيقة (لائحة الكلية).

القاعدة:
- المقام = ساعات المحاضرات المنفَّذة فعلاً (status=completed) حتى تاريخه — لا المجدولة ولا الملغاة ولا غياب الأستاذ.
- العدّ بالساعات (كل محاضرة بمدتها الفعلية).
- غياب بلا عذر > حد الكلية (افتراضياً 10%)  أو  (بعذر + بلا عذر) > الحد الإجمالي (افتراضياً 25%)  ⇒ مرشَّح للحرمان (قرار مجلس الكلية).
- «تجاوز» = أكبر من (وليس يساوي). لا حالة «متأخر» (تُعامل حضوراً). السجل المفقود في محاضرة منفَّذة = غياب بلا عذر (إلا إن سبقت المحاضرة تاريخ تسجيل الطالب).
- قبل تنفيذ MIN_EXECUTED محاضرات تُعرض النسب بعلامة «مؤشر مبكر».
"""
from datetime import datetime
from typing import Dict, List, Optional
from bson import ObjectId

DEFAULT_UNEXCUSED_LIMIT = 10.0
DEFAULT_TOTAL_LIMIT = 25.0
MIN_EXECUTED = 4

STATUS_AR = {
    "excellent": "ممتاز", "good": "جيد", "warning": "إنذار", "danger": "خطر الحرمان",
    "candidate": "تجاوز الحد — مرشَّح للحرمان (بانتظار مجلس الكلية)", "deprived": "محروم بقرار المجلس", "exempted": "مستثنى بقرار المجلس",
}


def lecture_hours(lec: dict) -> float:
    if lec.get("credited_minutes"):
        return round(float(lec["credited_minutes"]) / 60, 2)
    try:
        s = datetime.strptime(lec.get("start_time", "00:00"), "%H:%M")
        e = datetime.strptime(lec.get("end_time", "00:00"), "%H:%M")
        return round(((e - s).seconds / 3600) or 1.0, 2)
    except Exception:
        return 1.0


async def faculty_limits(db, faculty_id: Optional[str]) -> dict:
    fac = await db.faculties.find_one({"_id": ObjectId(faculty_id)}, {"max_absence_percent": 1, "max_unexcused_percent": 1}) if faculty_id and ObjectId.is_valid(faculty_id) else None
    fac = fac or {}
    return {"unexcused_limit": float(fac.get("max_unexcused_percent") or DEFAULT_UNEXCUSED_LIMIT),
            "total_limit": float(fac.get("max_absence_percent") or DEFAULT_TOTAL_LIMIT), "min_executed": MIN_EXECUTED}


async def course_limits(db, course: dict) -> dict:
    fid = course.get("faculty_id")
    if not fid and course.get("department_id") and ObjectId.is_valid(course["department_id"]):
        dep = await db.departments.find_one({"_id": ObjectId(course["department_id"])}, {"faculty_id": 1})
        fid = (dep or {}).get("faculty_id")
    return await faculty_limits(db, fid)


def classify(unexcused_h: float, excused_h: float, executed_h: float, executed_count: int, limits: dict) -> dict:
    lu, lt = limits["unexcused_limit"], limits["total_limit"]
    pct_u = round(unexcused_h / executed_h * 100, 2) if executed_h > 0 else 0.0
    pct_t = round((unexcused_h + excused_h) / executed_h * 100, 2) if executed_h > 0 else 0.0
    severity = max(pct_u / lu if lu else 0, pct_t / lt if lt else 0)
    if executed_h <= 0:
        status = "excellent"
    elif pct_u > lu or pct_t > lt:
        status = "candidate"
    elif severity >= 0.8:
        status = "danger"
    elif severity >= 0.6:
        status = "warning"
    elif severity >= 0.3:
        status = "good"
    else:
        status = "excellent"
    return {
        "executed_count": executed_count, "executed_hours": round(executed_h, 2),
        "unexcused_hours": round(unexcused_h, 2), "excused_hours": round(excused_h, 2), "absent_hours": round(unexcused_h + excused_h, 2),
        "present_hours": round(max(0.0, executed_h - unexcused_h - excused_h), 2),
        "pct_unexcused": pct_u, "pct_total": pct_t, "attendance_rate": round(100 - pct_t, 2) if executed_h > 0 else 100.0,
        "limit_unexcused": lu, "limit_total": lt,
        "remaining_unexcused_hours": round(max(0.0, executed_h * lu / 100 - unexcused_h), 2),
        "remaining_total_hours": round(max(0.0, executed_h * lt / 100 - unexcused_h - excused_h), 2),
        "exceeded_unexcused": pct_u > lu, "exceeded_total": pct_t > lt,
        "early": executed_count < limits.get("min_executed", MIN_EXECUTED),
        "status": status, "status_ar": STATUS_AR[status] + (" · مؤشر مبكر" if executed_count < limits.get("min_executed", MIN_EXECUTED) and executed_count > 0 else ""),
    }


async def executed_lectures(db, course_id: str) -> List[dict]:
    return await db.lectures.find({"course_id": course_id, "status": "completed"}, {"date": 1, "start_time": 1, "end_time": 1, "credited_minutes": 1}).to_list(2000)


async def course_profiles(db, course: dict, student_ids: Optional[List[str]] = None, limits: Optional[dict] = None) -> Dict[str, dict]:
    """{student_db_id: profile} لكل طلاب المقرر (أو قائمة محددة) — استعلامان فقط"""
    cid = str(course["_id"])
    limits = limits or await course_limits(db, course)
    lecs = await executed_lectures(db, cid)
    if student_ids is None:
        student_ids = [e["student_id"] async for e in db.enrollments.find({"course_id": cid}, {"student_id": 1}) if e.get("student_id")]
    enrolled_at = {e["student_id"]: e.get("enrolled_at") async for e in db.enrollments.find({"course_id": cid, "student_id": {"$in": student_ids}}, {"student_id": 1, "enrolled_at": 1})}
    hours = {str(l["_id"]): lecture_hours(l) for l in lecs}
    dates = {str(l["_id"]): l.get("date", "") for l in lecs}
    recs: Dict[str, Dict[str, str]] = {sid: {} for sid in student_ids}
    if lecs and student_ids:
        async for r in db.attendance.find({"course_id": cid, "lecture_id": {"$in": list(hours)}, "student_id": {"$in": student_ids}}, {"lecture_id": 1, "student_id": 1, "status": 1}):
            recs.setdefault(r["student_id"], {})[r["lecture_id"]] = r.get("status")
    out = {}
    for sid in student_ids:
        en = enrolled_at.get(sid)
        en_date = en.strftime("%Y-%m-%d") if isinstance(en, datetime) else None
        exec_h = exec_n = unexc = exc = 0.0
        for lid, h in hours.items():
            st = recs.get(sid, {}).get(lid)
            if st is None and en_date and dates.get(lid, "") < en_date:
                continue  # محاضرة سبقت تسجيل الطالب
            exec_h += h; exec_n += 1
            if st == "absent" or st is None:
                unexc += h
            elif st == "excused":
                exc += h
        out[sid] = classify(unexc, exc, exec_h, int(exec_n), limits)
    return out


async def student_profile(db, student_db_id: str, course: dict) -> dict:
    return (await course_profiles(db, course, [student_db_id])).get(student_db_id) or classify(0, 0, 0, 0, await course_limits(db, course))
