"""
Dashboard Routes - Endpoints موحّدة لتجميع كل بيانات الصفحة الرئيسية
في نداء واحد بدلاً من 5-7 نداءات متتابعة.

يستخدم asyncio.gather لتشغيل الاستعلامات بالتوازي على مستوى قاعدة البيانات.
"""
import asyncio
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from bson import ObjectId

from .deps import get_current_user, get_db
from models.permissions import UserRole
from models.courses import AttendanceStatus

router = APIRouter()


async def _count_unread_notifications(db, user_id: str) -> int:
    try:
        return await db.notifications.count_documents({
            "recipient_id": user_id,
            "is_read": False,
        })
    except Exception:
        return 0


async def _get_settings(db) -> dict:
    s = await db.settings.find_one({}, {"_id": 0}) or {}
    return s


async def _get_student_course_stats(db, student_id: str, course_id: str) -> dict:
    """حساب إحصائيات حضور الطالب في مقرر محدد (نسخة مبسطة بدون فلتر المحاضرات الملغاة لتسريع الداشبورد)."""
    records = await db.attendance.find(
        {"student_id": student_id, "course_id": course_id},
        {"_id": 0, "status": 1}
    ).to_list(2000)

    total = len(records)
    present = sum(1 for r in records if r.get("status") == AttendanceStatus.PRESENT)
    absent = sum(1 for r in records if r.get("status") == AttendanceStatus.ABSENT)
    late = sum(1 for r in records if r.get("status") == AttendanceStatus.LATE)
    excused = sum(1 for r in records if r.get("status") == AttendanceStatus.EXCUSED)
    rate = (present + late * 0.5) / total * 100 if total > 0 else 0
    return {
        "total_sessions": total,
        "present_count": present,
        "absent_count": absent,
        "late_count": late,
        "excused_count": excused,
        "attendance_rate": round(rate, 2),
    }


@router.get("/dashboard/student")
async def get_student_dashboard(current_user: dict = Depends(get_current_user)):
    """جلب كل بيانات الصفحة الرئيسية للطالب في نداء واحد."""
    if current_user["role"] != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="للطلاب فقط")

    db = get_db()
    user_id = current_user["id"]

    # الخطوة 1: جلب الطالب + الإعدادات + عدد الإشعارات بالتوازي
    student_task = db.students.find_one({"user_id": user_id})
    settings_task = _get_settings(db)
    notif_task = _count_unread_notifications(db, user_id)

    student, settings, notif_count = await asyncio.gather(
        student_task, settings_task, notif_task
    )

    if not student:
        raise HTTPException(status_code=404, detail="لم يتم العثور على سجل الطالب")

    student_id = str(student["_id"])
    department_id = student.get("department_id")
    level = student.get("level")
    section = student.get("section")

    # الخطوة 2: جلب القسم + المقررات بالتوازي
    dept_task = (
        db.departments.find_one({"_id": ObjectId(department_id)})
        if department_id else asyncio.sleep(0, result=None)
    )

    # استعلام مقررات الطالب مباشرة من الباك-إند (بدلاً من جلب الكل وفلترتها في الواجهة)
    course_query: dict = {}
    if department_id:
        course_query["department_id"] = department_id
    if level is not None:
        course_query["level"] = level
    courses_task = db.courses.find(course_query).to_list(200)

    dept, courses_raw = await asyncio.gather(dept_task, courses_task)

    # تطبيق فلتر الشعبة في الـ Python (للحفاظ على التوافق مع شعب null/empty)
    student_courses = [
        c for c in courses_raw
        if (not c.get("section") or c.get("section") == section)
    ]

    # جلب اسم الكلية
    faculty_name = None
    if dept and dept.get("faculty_id"):
        try:
            fac = await db.faculties.find_one(
                {"_id": ObjectId(dept["faculty_id"])},
                {"_id": 0, "name": 1}
            )
            faculty_name = fac["name"] if fac else None
        except Exception:
            pass

    # الخطوة 3: جلب إحصائيات كل المقررات بالتوازي
    stats_tasks = [
        _get_student_course_stats(db, student_id, str(c["_id"]))
        for c in student_courses
    ]
    stats_results = await asyncio.gather(*stats_tasks) if stats_tasks else []

    max_absence_percent = settings.get("max_absence_percent", 25)

    courses_stats = []
    for course, stats in zip(student_courses, stats_results):
        total_sessions = stats["total_sessions"]
        rate = stats["attendance_rate"] if total_sessions > 0 else 100

        status = "excellent"
        if total_sessions > 0:
            if rate < (100 - max_absence_percent):
                status = "danger"
            elif rate < (100 - max_absence_percent / 2):
                status = "warning"

        courses_stats.append({
            "course_id": str(course["_id"]),
            "course_name": course.get("name", ""),
            "course_code": course.get("code", ""),
            "total_sessions": total_sessions,
            "present_count": stats["present_count"],
            "absent_count": stats["absent_count"],
            "late_count": stats["late_count"],
            "excused_count": stats["excused_count"],
            "attendance_rate": rate,
            "status": status,
        })

    return {
        "notif_count": notif_count,
        "student": {
            "id": student_id,
            "student_id": student.get("student_id", ""),
            "full_name": student.get("full_name", ""),
            "department_id": department_id,
            "level": level,
            "section": section,
            "reference_number": student.get("reference_number"),
            "qr_code": student.get("qr_code"),
        },
        "department_name": dept.get("name") if dept else "",
        "college_name": faculty_name or "",
        "max_absence_percent": max_absence_percent,
        "courses_stats": courses_stats,
        "semester": {
            "name": settings.get("current_semester"),
            "start": settings.get("semester_start_date"),
            "end": settings.get("semester_end_date"),
        },
    }


@router.get("/dashboard/teacher")
async def get_teacher_dashboard(
    month: Optional[int] = None,
    year: Optional[int] = None,
    current_user: dict = Depends(get_current_user)
):
    """جلب كل بيانات الصفحة الرئيسية للمعلم في نداء واحد."""
    if current_user["role"] != UserRole.TEACHER:
        raise HTTPException(status_code=403, detail="للمعلمين فقط")

    db = get_db()
    user_id = current_user["id"]
    now = datetime.utcnow()
    y = year or now.year
    m = month or now.month

    # تحديد بداية ونهاية الشهر
    month_start = datetime(y, m, 1)
    if m == 12:
        month_end = datetime(y + 1, 1, 1)
    else:
        month_end = datetime(y, m + 1, 1)

    today_start = datetime(now.year, now.month, now.day)
    today_end = today_start + timedelta(days=1)

    # جلب teacher_id
    teacher = await db.teachers.find_one({"user_id": user_id}, {"_id": 1})
    teacher_id = str(teacher["_id"]) if teacher else None

    lecture_filter_base = {"teacher_id": teacher_id} if teacher_id else {"teacher_user_id": user_id}

    settings_task = _get_settings(db)
    notif_task = _count_unread_notifications(db, user_id)

    # فلترة الفصل النشط فقط
    from ._active_semester import get_active_semester as _gas, apply_lecture_active_sem as _alas
    active_sem = await _gas(db)

    today_q = _alas({
        **lecture_filter_base,
        "date": {"$gte": today_start, "$lt": today_end},
        "$or": [{"is_cancelled": {"$ne": True}}, {"is_cancelled": {"$exists": False}}],
    }, active_sem)
    today_lectures_task = db.lectures.find(today_q).sort("start_time", 1).to_list(50)

    month_q = _alas({
        **lecture_filter_base,
        "date": {"$gte": month_start, "$lt": month_end},
        "$or": [{"is_cancelled": {"$ne": True}}, {"is_cancelled": {"$exists": False}}],
    }, active_sem)
    month_lectures_task = db.lectures.find(month_q, {
        "_id": 1, "course_id": 1, "course_name": 1, "course_code": 1,
        "date": 1, "start_time": 1, "end_time": 1, "room": 1, "status": 1
    }).to_list(500)

    settings, notif_count, today_lectures, month_lectures = await asyncio.gather(
        settings_task, notif_task, today_lectures_task, month_lectures_task
    )

    # تجميع محاضرات الشهر حسب التاريخ
    lectures_by_date: dict = {}
    dates: list = []
    for lec in month_lectures:
        d = lec.get("date")
        if not d:
            continue
        key = d.strftime("%Y-%m-%d")
        if key not in lectures_by_date:
            lectures_by_date[key] = []
            dates.append(key)
        lectures_by_date[key].append({
            "id": str(lec["_id"]),
            "course_id": lec.get("course_id"),
            "course_name": lec.get("course_name", ""),
            "course_code": lec.get("course_code", ""),
            "start_time": lec.get("start_time"),
            "end_time": lec.get("end_time"),
            "room": lec.get("room", ""),
            "status": lec.get("status", "scheduled"),
        })

    today_payload = [{
        "id": str(lec["_id"]),
        "course_id": lec.get("course_id"),
        "course_name": lec.get("course_name", ""),
        "course_code": lec.get("course_code", ""),
        "start_time": lec.get("start_time"),
        "end_time": lec.get("end_time"),
        "room": lec.get("room", ""),
        "status": lec.get("status", "scheduled"),
        "attendance_count": lec.get("attendance_count", 0),
        "total_enrolled": lec.get("total_enrolled", 0),
    } for lec in today_lectures]

    return {
        "notif_count": notif_count,
        "today_lectures": today_payload,
        "month_lectures": {
            "dates": sorted(dates),
            "lectures_by_date": lectures_by_date,
            "total_lectures": len(month_lectures),
        },
        "semester": {
            "name": settings.get("current_semester"),
            "start": settings.get("semester_start_date"),
            "end": settings.get("semester_end_date"),
        },
    }


@router.get("/dashboard/admin")
async def get_admin_dashboard(current_user: dict = Depends(get_current_user)):
    """جلب كل بيانات الصفحة الرئيسية للمشرف في نداء واحد."""
    if current_user["role"] not in (UserRole.ADMIN, UserRole.DEAN, UserRole.DEPARTMENT_HEAD):
        raise HTTPException(status_code=403, detail="غير مصرح")

    db = get_db()
    user_id = current_user["id"]

    # جلب الإحصائيات الأساسية بالتوازي
    users_count_task = db.users.count_documents({"is_active": {"$ne": False}})
    students_count_task = db.students.count_documents({})
    teachers_count_task = db.teachers.count_documents({})
    courses_count_task = db.courses.count_documents({})
    departments_count_task = db.departments.count_documents({})
    faculties_count_task = db.faculties.count_documents({})
    notif_task = _count_unread_notifications(db, user_id)

    (
        users_count, students_count, teachers_count, courses_count,
        departments_count, faculties_count, notif_count
    ) = await asyncio.gather(
        users_count_task, students_count_task, teachers_count_task,
        courses_count_task, departments_count_task, faculties_count_task,
        notif_task
    )

    return {
        "notif_count": notif_count,
        "summary": {
            "total_users": users_count,
            "total_students": students_count,
            "total_teachers": teachers_count,
            "total_courses": courses_count,
            "total_departments": departments_count,
            "total_faculties": faculties_count,
        },
    }
