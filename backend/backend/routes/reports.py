"""
Reports Routes - مسارات التقارير
"""
from fastapi import APIRouter, HTTPException, status, Depends
from bson import ObjectId
from datetime import datetime
from typing import List

from models.lectures import ACTIVE_LECTURE_STATUSES

from .deps import security

router = APIRouter(tags=["التقارير"])
db = None
def set_db(database):
    global db
    db = database

# ==================== Reports Routes ====================

@router.get("/reports/department/{dept_id}")
async def get_department_report(
    dept_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    # Get department
    dept = await db.departments.find_one({"_id": ObjectId(dept_id)})
    if not dept:
        raise HTTPException(status_code=404, detail="القسم غير موجود")
    
    # Get all courses in department
    courses = await db.courses.find({"department_id": dept_id}).to_list(100)
    course_ids = [str(c["_id"]) for c in courses]
    
    # جلب IDs المحاضرات الفعّالة فقط لجميع المقررات
    all_active_lecture_ids = set()
    for cid in course_ids:
        active_ids = await get_active_lecture_ids(cid)
        all_active_lecture_ids.update(active_ids)
    
    # Build query
    query = {"course_id": {"$in": course_ids}}
    if start_date:
        query["date"] = {"$gte": datetime.fromisoformat(start_date)}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = datetime.fromisoformat(end_date)
        else:
            query["date"] = {"$lte": datetime.fromisoformat(end_date)}
    
    records = await db.attendance.find(query).to_list(10000)
    
    # فلترة السجلات لاستبعاد المحاضرات الملغاة
    records = [r for r in records if r.get("lecture_id") in all_active_lecture_ids]
    
    total = len(records)
    present = sum(1 for r in records if r["status"] == AttendanceStatus.PRESENT)
    absent = sum(1 for r in records if r["status"] == AttendanceStatus.ABSENT)
    late = sum(1 for r in records if r["status"] == AttendanceStatus.LATE)
    
    return {
        "department": dept["name"],
        "total_courses": len(courses),
        "total_records": total,
        "present_count": present,
        "absent_count": absent,
        "late_count": late,
        "attendance_rate": round((present + late * 0.5) / total * 100, 2) if total > 0 else 0
    }

@router.get("/reports/summary")
async def get_summary_report(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    # Get counts
    total_students = await db.students.count_documents({"is_active": True})
    total_teachers = await db.users.count_documents({"role": UserRole.TEACHER, "is_active": True})
    total_courses = await db.courses.count_documents({"is_active": True})
    total_departments = await db.departments.count_documents({})
    
    # Get today's attendance (only from active lectures)
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_records = await db.attendance.find({"date": {"$gte": today_start}}).to_list(10000)
    
    # جلب جميع المحاضرات الفعّالة
    all_active_lecture_ids = await get_active_lecture_ids()
    
    # فلترة سجلات اليوم لاستبعاد المحاضرات الملغاة
    today_records = [r for r in today_records if r.get("lecture_id") in all_active_lecture_ids]
    
    today_present = sum(1 for r in today_records if r["status"] == AttendanceStatus.PRESENT)
    today_absent = sum(1 for r in today_records if r["status"] == AttendanceStatus.ABSENT)
    
    return {
        "total_students": total_students,
        "total_teachers": total_teachers,
        "total_courses": total_courses,
        "total_departments": total_departments,
        "today_attendance": {
            "total": len(today_records),
            "present": today_present,
            "absent": today_absent,
            "rate": round(today_present / len(today_records) * 100, 2) if today_records else 0
        }
    }

# ==================== Advanced Reports ====================

@router.get("/reports/attendance-overview")
async def get_attendance_overview_report(
    department_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """تقرير الحضور الشامل - نسب الحضور لجميع المقررات"""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    # بناء query للمقررات
    course_query = {"is_active": True}
    if department_id:
        course_query["department_id"] = department_id
    
    courses = await db.courses.find(course_query).to_list(100)
    
    result = []
    for course in courses:
        course_id = str(course["_id"])
        
        # جلب المحاضرات الفعالة
        active_lecture_ids = await get_active_lecture_ids(course_id)
        
        # بناء query للحضور
        attendance_query = {"course_id": course_id, "lecture_id": {"$in": list(active_lecture_ids)}}
        if start_date:
            attendance_query["date"] = {"$gte": datetime.fromisoformat(start_date)}
        if end_date:
            if "date" in attendance_query:
                attendance_query["date"]["$lte"] = datetime.fromisoformat(end_date)
            else:
                attendance_query["date"] = {"$lte": datetime.fromisoformat(end_date)}
        
        records = await db.attendance.find(attendance_query).to_list(10000)
        
        total = len(records)
        present = sum(1 for r in records if r["status"] == AttendanceStatus.PRESENT)
        absent = sum(1 for r in records if r["status"] == AttendanceStatus.ABSENT)
        late = sum(1 for r in records if r["status"] == AttendanceStatus.LATE)
        
        # جلب اسم المعلم
        teacher_name = None
        if course.get("teacher_id"):
            teacher = await db.teachers.find_one({"_id": ObjectId(course["teacher_id"])})
            if teacher:
                teacher_name = teacher.get("full_name")
        
        result.append({
            "course_id": course_id,
            "course_name": course["name"],
            "course_code": course.get("code", ""),
            "teacher_name": teacher_name,
            "total_records": total,
            "present_count": present,
            "absent_count": absent,
            "late_count": late,
            "attendance_rate": round((present + late * 0.5) / total * 100, 2) if total > 0 else 0
        })
    
    return {
        "courses": result,
        "summary": {
            "total_courses": len(result),
            "avg_attendance_rate": round(sum(c["attendance_rate"] for c in result) / len(result), 2) if result else 0
        }
    }

@router.get("/reports/absent-students")
async def get_absent_students_report(
    department_id: Optional[str] = None,
    course_id: Optional[str] = None,
    min_absence_rate: float = 25.0,
    current_user: dict = Depends(get_current_user)
):
    """تقرير الطلاب المتغيبين - الذين تجاوزوا نسبة غياب معينة"""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    # جلب المقررات
    course_query = {"is_active": True}
    if department_id:
        course_query["department_id"] = department_id
    if course_id:
        course_query["_id"] = ObjectId(course_id)
    
    courses = await db.courses.find(course_query).to_list(100)
    
    result = []
    for course in courses:
        cid = str(course["_id"])
        active_lecture_ids = await get_active_lecture_ids(cid)
        total_lectures = len(active_lecture_ids)
        
        if total_lectures == 0:
            continue
        
        # جلب الطلاب المسجلين
        enrollments = await db.enrollments.find({"course_id": cid}).to_list(1000)
        
        for enrollment in enrollments:
            student_id = enrollment["student_id"]
            
            # حساب الغياب
            attendance_records = await db.attendance.find({
                "student_id": student_id,
                "course_id": cid,
                "lecture_id": {"$in": list(active_lecture_ids)}
            }).to_list(1000)
            
            absent_count = sum(1 for r in attendance_records if r["status"] == AttendanceStatus.ABSENT)
            absence_rate = (absent_count / total_lectures) * 100
            
            if absence_rate >= min_absence_rate:
                student = await db.students.find_one({"_id": ObjectId(student_id)})
                if student:
                    result.append({
                        "student_id": student.get("student_id"),
                        "student_name": student.get("full_name"),
                        "course_name": course["name"],
                        "course_code": course.get("code", ""),
                        "total_lectures": total_lectures,
                        "absent_count": absent_count,
                        "absence_rate": round(absence_rate, 2)
                    })
    
    # ترتيب حسب نسبة الغياب (الأعلى أولاً)
    result.sort(key=lambda x: x["absence_rate"], reverse=True)
    
    return {
        "students": result,
        "total_count": len(result),
        "min_absence_rate_filter": min_absence_rate
    }

@router.get("/reports/student/{student_id}")
async def get_student_attendance_report(
    student_id: str,
    current_user: dict = Depends(get_current_user)
):
    """تقرير حضور طالب واحد في جميع مقرراته"""
    if not has_permission(current_user, Permission.VIEW_REPORTS) and not has_permission(current_user, Permission.VIEW_ATTENDANCE):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    # جلب الطالب
    student = await db.students.find_one({"_id": ObjectId(student_id)})
    if not student:
        # محاولة البحث برقم القيد
        student = await db.students.find_one({"student_id": student_id})
    
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    
    # جلب المقررات المسجل فيها
    enrollments = await db.enrollments.find({"student_id": str(student["_id"])}).to_list(100)
    
    courses_data = []
    total_present = 0
    total_absent = 0
    total_late = 0
    total_lectures = 0
    
    for enrollment in enrollments:
        course = await db.courses.find_one({"_id": ObjectId(enrollment["course_id"])})
        if not course:
            continue
        
        course_id = str(course["_id"])
        active_lecture_ids = await get_active_lecture_ids(course_id)
        
        # جلب سجلات الحضور
        records = await db.attendance.find({
            "student_id": str(student["_id"]),
            "course_id": course_id,
            "lecture_id": {"$in": list(active_lecture_ids)}
        }).to_list(1000)
        
        present = sum(1 for r in records if r["status"] == AttendanceStatus.PRESENT)
        absent = sum(1 for r in records if r["status"] == AttendanceStatus.ABSENT)
        late = sum(1 for r in records if r["status"] == AttendanceStatus.LATE)
        
        total_present += present
        total_absent += absent
        total_late += late
        total_lectures += len(active_lecture_ids)
        
        courses_data.append({
            "course_name": course["name"],
            "course_code": course.get("code", ""),
            "total_lectures": len(active_lecture_ids),
            "present": present,
            "absent": absent,
            "late": late,
            "attendance_rate": round((present + late * 0.5) / len(active_lecture_ids) * 100, 2) if active_lecture_ids else 0
        })
    
    return {
        "student": {
            "id": str(student["_id"]),
            "student_id": student.get("student_id"),
            "full_name": student.get("full_name"),
            "department_id": student.get("department_id"),
            "level": student.get("level"),
            "section": student.get("section")
        },
        "courses": courses_data,
        "summary": {
            "total_courses": len(courses_data),
            "total_lectures": total_lectures,
            "total_present": total_present,
            "total_absent": total_absent,
            "total_late": total_late,
            "overall_attendance_rate": round((total_present + total_late * 0.5) / total_lectures * 100, 2) if total_lectures > 0 else 0
        }
    }

@router.get("/reports/daily")
async def get_daily_report(
    date: Optional[str] = None,
    department_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """تقرير يومي - ملخص الحضور ليوم محدد"""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    # تحديد التاريخ
    if date:
        report_date = datetime.fromisoformat(date)
    else:
        report_date = datetime.utcnow()
    
    day_start = report_date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    
    # جلب المقررات
    course_query = {"is_active": True}
    if department_id:
        course_query["department_id"] = department_id
    courses = await db.courses.find(course_query).to_list(100)
    course_ids = [str(c["_id"]) for c in courses]
    
    # جلب المحاضرات في هذا اليوم
    lectures = await db.lectures.find({
        "course_id": {"$in": course_ids},
        "date": {"$gte": day_start, "$lt": day_end},
        "is_cancelled": {"$ne": True}
    }).to_list(100)
    
    lectures_data = []
    total_present = 0
    total_absent = 0
    total_late = 0
    
    for lecture in lectures:
        course = next((c for c in courses if str(c["_id"]) == lecture["course_id"]), None)
        if not course:
            continue
        
        # جلب سجلات الحضور
        records = await db.attendance.find({
            "lecture_id": str(lecture["_id"])
        }).to_list(1000)
        
        present = sum(1 for r in records if r["status"] == AttendanceStatus.PRESENT)
        absent = sum(1 for r in records if r["status"] == AttendanceStatus.ABSENT)
        late = sum(1 for r in records if r["status"] == AttendanceStatus.LATE)
        
        total_present += present
        total_absent += absent
        total_late += late
        
        lectures_data.append({
            "lecture_id": str(lecture["_id"]),
            "course_name": course["name"],
            "course_code": course.get("code", ""),
            "start_time": lecture.get("start_time", ""),
            "end_time": lecture.get("end_time", ""),
            "present": present,
            "absent": absent,
            "late": late,
            "total_students": len(records),
            "attendance_rate": round((present + late * 0.5) / len(records) * 100, 2) if records else 0
        })
    
    total_records = total_present + total_absent + total_late
    
    return {
        "date": day_start.isoformat(),
        "lectures": lectures_data,
        "summary": {
            "total_lectures": len(lectures_data),
            "total_students_recorded": total_records,
            "total_present": total_present,
            "total_absent": total_absent,
            "total_late": total_late,
            "overall_attendance_rate": round((total_present + total_late * 0.5) / total_records * 100, 2) if total_records > 0 else 0
        }
    }

@router.get("/reports/warnings")
async def get_warnings_report(
    department_id: Optional[str] = None,
    warning_threshold: float = 25.0,
    deprivation_threshold: float = 40.0,
    current_user: dict = Depends(get_current_user)
):
    """تقرير الإنذارات - الطلاب المعرضين للحرمان"""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    # جلب المقررات
    course_query = {"is_active": True}
    if department_id:
        course_query["department_id"] = department_id
    courses = await db.courses.find(course_query).to_list(100)
    
    warnings = []
    deprivations = []
    
    for course in courses:
        cid = str(course["_id"])
        active_lecture_ids = await get_active_lecture_ids(cid)
        total_lectures = len(active_lecture_ids)
        
        if total_lectures == 0:
            continue
        
        # جلب التسجيلات
        enrollments = await db.enrollments.find({"course_id": cid}).to_list(1000)
        
        for enrollment in enrollments:
            student_id = enrollment["student_id"]
            
            # حساب الغياب
            records = await db.attendance.find({
                "student_id": student_id,
                "course_id": cid,
                "lecture_id": {"$in": list(active_lecture_ids)}
            }).to_list(1000)
            
            absent_count = sum(1 for r in records if r["status"] == AttendanceStatus.ABSENT)
            absence_rate = (absent_count / total_lectures) * 100
            
            if absence_rate >= warning_threshold:
                student = await db.students.find_one({"_id": ObjectId(student_id)})
                if student:
                    student_data = {
                        "student_id": student.get("student_id"),
                        "student_name": student.get("full_name"),
                        "course_name": course["name"],
                        "course_code": course.get("code", ""),
                        "total_lectures": total_lectures,
                        "absent_count": absent_count,
                        "absence_rate": round(absence_rate, 2),
                        "remaining_allowed": max(0, int((deprivation_threshold / 100) * total_lectures) - absent_count)
                    }
                    
                    if absence_rate >= deprivation_threshold:
                        student_data["status"] = "محروم"
                        deprivations.append(student_data)
                    else:
                        student_data["status"] = "إنذار"
                        warnings.append(student_data)
    
    return {
        "warnings": warnings,
        "deprivations": deprivations,
        "summary": {
            "total_warnings": len(warnings),
            "total_deprivations": len(deprivations),
            "warning_threshold": warning_threshold,
            "deprivation_threshold": deprivation_threshold
        }
    }

@router.get("/reports/course/{course_id}/detailed")
async def get_course_detailed_report(
    course_id: str,
    current_user: dict = Depends(get_current_user)
):
    """تقرير المقرر التفصيلي - تحليل كامل لمقرر معين"""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    course = await db.courses.find_one({"_id": ObjectId(course_id)})
    if not course:
        raise HTTPException(status_code=404, detail="المقرر غير موجود")
    
    # جلب المعلم
    teacher_name = None
    if course.get("teacher_id"):
        teacher = await db.teachers.find_one({"_id": ObjectId(course["teacher_id"])})
        if teacher:
            teacher_name = teacher.get("full_name")
    
    # جلب المحاضرات
    active_lecture_ids = await get_active_lecture_ids(course_id)
    lectures = await db.lectures.find({
        "_id": {"$in": [ObjectId(lid) for lid in active_lecture_ids]}
    }).sort("date", 1).to_list(100)
    
    # جلب التسجيلات
    enrollments = await db.enrollments.find({"course_id": course_id}).to_list(1000)
    
    # بيانات الطلاب
    students_data = []
    for enrollment in enrollments:
        student = await db.students.find_one({"_id": ObjectId(enrollment["student_id"])})
        if not student:
            continue
        
        records = await db.attendance.find({
            "student_id": str(student["_id"]),
            "course_id": course_id,
            "lecture_id": {"$in": list(active_lecture_ids)}
        }).to_list(1000)
        
        present = sum(1 for r in records if r["status"] == AttendanceStatus.PRESENT)
        absent = sum(1 for r in records if r["status"] == AttendanceStatus.ABSENT)
        late = sum(1 for r in records if r["status"] == AttendanceStatus.LATE)
        
        students_data.append({
            "student_id": student.get("student_id"),
            "student_name": student.get("full_name"),
            "present": present,
            "absent": absent,
            "late": late,
            "attendance_rate": round((present + late * 0.5) / len(active_lecture_ids) * 100, 2) if active_lecture_ids else 0
        })
    
    # ترتيب حسب نسبة الحضور
    students_data.sort(key=lambda x: x["attendance_rate"], reverse=True)
    
    # بيانات المحاضرات
    lectures_data = []
    for lecture in lectures:
        records = await db.attendance.find({"lecture_id": str(lecture["_id"])}).to_list(1000)
        present = sum(1 for r in records if r["status"] == AttendanceStatus.PRESENT)
        
        lectures_data.append({
            "date": lecture.get("date").isoformat() if lecture.get("date") else "",
            "start_time": lecture.get("start_time", ""),
            "present_count": present,
            "total_students": len(records),
            "attendance_rate": round(present / len(records) * 100, 2) if records else 0
        })
    
    return {
        "course": {
            "id": course_id,
            "name": course["name"],
            "code": course.get("code", ""),
            "teacher_name": teacher_name,
            "level": course.get("level"),
            "section": course.get("section")
        },
        "students": students_data,
        "lectures": lectures_data,
        "summary": {
            "total_students": len(students_data),
            "total_lectures": len(lectures_data),
            "avg_attendance_rate": round(sum(s["attendance_rate"] for s in students_data) / len(students_data), 2) if students_data else 0
        }
    }

@router.get("/reports/teacher-workload")
async def get_teacher_workload_report(
    teacher_id: Optional[str] = None,
    start_date: str = None,
    end_date: str = None,
    current_user: dict = Depends(get_current_user)
):
    """تقرير نصاب المدرس - كم نصابه، كم درسها فعلياً، كم ساعات زائدة"""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    # تحديد الفترة
    if not start_date or not end_date:
        # افتراضي: الشهر الحالي
        today = datetime.utcnow()
        start = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = (start + timedelta(days=32)).replace(day=1) - timedelta(seconds=1)
    else:
        start = datetime.fromisoformat(start_date)
        end = datetime.fromisoformat(end_date)
    
    # جلب المعلمين
    teacher_query = {"is_active": {"$ne": False}}
    if teacher_id:
        teacher_query["_id"] = ObjectId(teacher_id)
    
    teachers = await db.teachers.find(teacher_query).to_list(100)
    
    result = []
    for teacher in teachers:
        tid = str(teacher["_id"])
        
        # جلب المقررات الحالية + مقررات سابقة نفّذ فيها محاضرات (سجل lecture.teacher_id)
        courses = await db.courses.find({"teacher_id": tid, "is_active": True}).to_list(50)
        _cur_ids = {str(c["_id"]) for c in courses}
        for _hc in await db.lectures.distinct("course_id", {"teacher_id": tid}):
            if _hc not in _cur_ids:
                try:
                    _cdoc = await db.courses.find_one({"_id": ObjectId(_hc)})
                except Exception:
                    _cdoc = None
                if _cdoc:
                    _cdoc["_hist_only"] = True
                    courses.append(_cdoc)
        
        total_scheduled_hours = 0
        total_actual_hours = 0
        courses_data = []
        
        for course in courses:
            cid = str(course["_id"])
            
            # المحاضرات المجدولة في الفترة (فقط المنعقدة والمجدولة - بدون الملغاة وغياب الأستاذ)
            # 🧾 الإسناد الفعلي: المختومة لهذا المعلم + غير المختومة على مقرره الحالي فقط
            _attr = [{"teacher_id": tid}] if course.get("_hist_only") else [{"teacher_id": tid}, {"teacher_id": None}]
            scheduled_lectures = await db.lectures.find({
                "course_id": cid,
                "date": {"$gte": start, "$lte": end},
                "status": {"$in": ACTIVE_LECTURE_STATUSES},
                "$or": _attr
            }).to_list(500)
            
            # المحاضرات التي تم تسجيل حضور فيها (المنفذة فعلياً)
            executed_lectures = []
            for lecture in scheduled_lectures:
                attendance_count = await db.attendance.count_documents({"lecture_id": str(lecture["_id"])})
                if attendance_count > 0:
                    executed_lectures.append(lecture)
            
            # حساب الساعات
            scheduled_hours = 0
            actual_hours = 0
            
            for lecture in scheduled_lectures:
                try:
                    start_time = datetime.strptime(lecture.get("start_time", "00:00"), "%H:%M")
                    end_time = datetime.strptime(lecture.get("end_time", "00:00"), "%H:%M")
                    duration = (end_time - start_time).seconds / 3600
                    scheduled_hours += duration
                except:
                    scheduled_hours += 1  # افتراضي ساعة واحدة
            
            for lecture in executed_lectures:
                try:
                    start_time = datetime.strptime(lecture.get("start_time", "00:00"), "%H:%M")
                    end_time = datetime.strptime(lecture.get("end_time", "00:00"), "%H:%M")
                    duration = (end_time - start_time).seconds / 3600
                    actual_hours += duration
                except:
                    actual_hours += 1
            
            total_scheduled_hours += scheduled_hours
            total_actual_hours += actual_hours
            
            courses_data.append({
                "course_name": course["name"],
                "course_code": course.get("code", ""),
                "scheduled_lectures": len(scheduled_lectures),
                "executed_lectures": len(executed_lectures),
                "scheduled_hours": round(scheduled_hours, 2),
                "actual_hours": round(actual_hours, 2)
            })
        
        extra_hours = total_actual_hours - total_scheduled_hours
        
        result.append({
            "teacher_id": teacher.get("teacher_id", ""),
            "teacher_name": teacher.get("full_name", ""),
            "department_id": teacher.get("department_id"),
            "courses": courses_data,
            "summary": {
                "total_courses": len(courses_data),
                "total_scheduled_hours": round(total_scheduled_hours, 2),
                "total_actual_hours": round(total_actual_hours, 2),
                "extra_hours": round(extra_hours, 2),
                "completion_rate": round((total_actual_hours / total_scheduled_hours) * 100, 2) if total_scheduled_hours > 0 else 0
            }
        })
    
    return {
        "period": {
            "start_date": start.isoformat(),
            "end_date": end.isoformat()
        },
        "teachers": result,
        "summary": {
            "total_teachers": len(result),
            "total_scheduled_hours": round(sum(t["summary"]["total_scheduled_hours"] for t in result), 2),
            "total_actual_hours": round(sum(t["summary"]["total_actual_hours"] for t in result), 2),
            "total_extra_hours": round(sum(t["summary"]["extra_hours"] for t in result), 2)
        }
    }

# ==================== Reports Export (PDF & Excel) ====================

@router.get("/export/report/warnings/excel")
async def export_warnings_excel(
    department_id: Optional[str] = None,
    warning_threshold: float = 25.0,
    deprivation_threshold: float = 40.0,
    current_user: dict = Depends(get_current_user)
):
    """تصدير تقرير الإنذارات إلى Excel"""
    if not has_permission(current_user, Permission.EXPORT_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    # جلب البيانات
    report = await get_warnings_report(department_id, warning_threshold, deprivation_threshold, current_user)
    
    # إعداد البيانات
    all_data = []
    for item in report["warnings"]:
        item["الحالة"] = "إنذار"
        all_data.append(item)
    for item in report["deprivations"]:
        item["الحالة"] = "محروم"
        all_data.append(item)
    
    if not all_data:
        all_data = [{"ملاحظة": "لا توجد بيانات"}]
    
    # تحويل للـ DataFrame
    df = pd.DataFrame(all_data)
    df = df.rename(columns={
        "student_id": "رقم القيد",
        "student_name": "اسم الطالب",
        "course_name": "المقرر",
        "course_code": "رمز المقرر",
        "total_lectures": "المحاضرات",
        "absent_count": "الغياب",
        "absence_rate": "نسبة الغياب %",
        "remaining_allowed": "المتبقي المسموح",
        "status": "الحالة"
    })
    
    output = BytesIO()
    df.to_excel(output, index=False, engine='openpyxl')
    output.seek(0)
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=warnings_report.xlsx"}
    )

@router.get("/export/report/absent-students/excel")
async def export_absent_students_excel(
    department_id: Optional[str] = None,
    course_id: Optional[str] = None,
    min_absence_rate: float = 25.0,
    current_user: dict = Depends(get_current_user)
):
    """تصدير تقرير الطلاب المتغيبين إلى Excel"""
    if not has_permission(current_user, Permission.EXPORT_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    report = await get_absent_students_report(department_id, course_id, min_absence_rate, current_user)
    
    if not report["students"]:
        data = [{"ملاحظة": "لا توجد بيانات"}]
    else:
        data = report["students"]
    
    df = pd.DataFrame(data)
    df = df.rename(columns={
        "student_id": "رقم القيد",
        "student_name": "اسم الطالب",
        "course_name": "المقرر",
        "course_code": "رمز المقرر",
        "total_lectures": "المحاضرات",
        "absent_count": "الغياب",
        "absence_rate": "نسبة الغياب %"
    })
    
    output = BytesIO()
    df.to_excel(output, index=False, engine='openpyxl')
    output.seek(0)
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=absent_students.xlsx"}
    )

@router.get("/export/report/teacher-workload/excel")
async def export_teacher_workload_excel(
    teacher_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """تصدير تقرير نصاب المدرسين إلى Excel"""
    if not has_permission(current_user, Permission.EXPORT_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    report = await get_teacher_workload_report(teacher_id, start_date, end_date, current_user)
    
    # تحويل البيانات
    data = []
    for teacher in report["teachers"]:
        for course in teacher["courses"]:
            data.append({
                "الرقم الوظيفي": teacher["teacher_id"],
                "اسم المدرس": teacher["teacher_name"],
                "المقرر": course["course_name"],
                "رمز المقرر": course["course_code"],
                "المحاضرات المجدولة": course["scheduled_lectures"],
                "المحاضرات المنفذة": course["executed_lectures"],
                "الساعات المجدولة": course["scheduled_hours"],
                "الساعات المنفذة": course["actual_hours"]
            })
        # صف ملخص للمدرس
        data.append({
            "الرقم الوظيفي": teacher["teacher_id"],
            "اسم المدرس": teacher["teacher_name"],
            "المقرر": "*** الإجمالي ***",
            "رمز المقرر": "",
            "المحاضرات المجدولة": "",
            "المحاضرات المنفذة": "",
            "الساعات المجدولة": teacher["summary"]["total_scheduled_hours"],
            "الساعات المنفذة": teacher["summary"]["total_actual_hours"],
            "الساعات الزائدة": teacher["summary"]["extra_hours"],
            "نسبة الإنجاز %": teacher["summary"]["completion_rate"]
        })
    
    if not data:
        data = [{"ملاحظة": "لا توجد بيانات"}]
    
    df = pd.DataFrame(data)
    output = BytesIO()
    df.to_excel(output, index=False, engine='openpyxl')
    output.seek(0)
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=teacher_workload.xlsx"}
    )

@router.get("/export/report/daily/excel")
async def export_daily_excel(
    date: Optional[str] = None,
    department_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """تصدير التقرير اليومي إلى Excel"""
    if not has_permission(current_user, Permission.EXPORT_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    report = await get_daily_report(date, department_id, current_user)
    
    data = []
    for lecture in report["lectures"]:
        data.append({
            "المقرر": lecture["course_name"],
            "رمز المقرر": lecture["course_code"],
            "وقت البداية": lecture["start_time"],
            "وقت النهاية": lecture["end_time"],
            "حاضر": lecture["present"],
            "غائب": lecture["absent"],
            "متأخر": lecture["late"],
            "الإجمالي": lecture["total_students"],
            "نسبة الحضور %": lecture["attendance_rate"]
        })
    
    if not data:
        data = [{"ملاحظة": "لا توجد محاضرات في هذا اليوم"}]
    
    df = pd.DataFrame(data)
    output = BytesIO()
    df.to_excel(output, index=False, engine='openpyxl')
    output.seek(0)
    
    report_date = date or datetime.utcnow().strftime("%Y-%m-%d")
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=daily_report_{report_date}.xlsx"}
    )

@router.get("/export/report/student/{student_id}/excel")
async def export_student_report_excel(
    student_id: str,
    current_user: dict = Depends(get_current_user)
):
    """تصدير تقرير طالب إلى Excel"""
    if not has_permission(current_user, Permission.EXPORT_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    report = await get_student_attendance_report(student_id, current_user)
    
    # بيانات الطالب
    student_info = report["student"]
    
    data = []
    for course in report["courses"]:
        data.append({
            "المقرر": course["course_name"],
            "رمز المقرر": course["course_code"],
            "المحاضرات": course["total_lectures"],
            "حاضر": course["present"],
            "غائب": course["absent"],
            "متأخر": course["late"],
            "نسبة الحضور %": course["attendance_rate"]
        })
    
    # إضافة صف الملخص
    data.append({
        "المقرر": "*** الإجمالي ***",
        "رمز المقرر": "",
        "المحاضرات": report["summary"]["total_lectures"],
        "حاضر": report["summary"]["total_present"],
        "غائب": report["summary"]["total_absent"],
        "متأخر": report["summary"]["total_late"],
        "نسبة الحضور %": report["summary"]["overall_attendance_rate"]
    })
    
    df = pd.DataFrame(data)
    output = BytesIO()
    
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        # ورقة معلومات الطالب
        info_df = pd.DataFrame([{
            "رقم القيد": student_info["student_id"],
            "الاسم": student_info["full_name"],
            "المستوى": student_info["level"],
            "الشعبة": student_info.get("section", "")
        }])
        info_df.to_excel(writer, sheet_name="معلومات الطالب", index=False)
        # ورقة التقرير
        df.to_excel(writer, sheet_name="تفاصيل الحضور", index=False)
    
    output.seek(0)
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=student_{student_info['student_id']}_report.xlsx"}
    )

@router.get("/export/report/course/{course_id}/excel")
async def export_course_report_excel(
    course_id: str,
    current_user: dict = Depends(get_current_user)
):
    """تصدير تقرير مقرر إلى Excel"""
    if not has_permission(current_user, Permission.EXPORT_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    report = await get_course_detailed_report(course_id, current_user)
    
    output = BytesIO()
    
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        # ورقة الطلاب
        students_data = []
        for idx, student in enumerate(report["students"], 1):
            students_data.append({
                "الترتيب": idx,
                "رقم القيد": student["student_id"],
                "اسم الطالب": student["student_name"],
                "حاضر": student["present"],
                "غائب": student["absent"],
                "متأخر": student["late"],
                "نسبة الحضور %": student["attendance_rate"]
            })
        
        if students_data:
            pd.DataFrame(students_data).to_excel(writer, sheet_name="الطلاب", index=False)
        
        # ورقة المحاضرات
        lectures_data = []
        for lecture in report["lectures"]:
            lectures_data.append({
                "التاريخ": lecture["date"],
                "الوقت": lecture["start_time"],
                "عدد الحاضرين": lecture["present_count"],
                "الإجمالي": lecture["total_students"],
                "نسبة الحضور %": lecture["attendance_rate"]
            })
        
        if lectures_data:
            pd.DataFrame(lectures_data).to_excel(writer, sheet_name="المحاضرات", index=False)
    
    output.seek(0)
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=course_{report['course']['code']}_report.xlsx"}
    )

@router.get("/export/report/attendance-overview/excel")
async def export_attendance_overview_excel(
    department_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """تصدير تقرير الحضور الشامل إلى Excel"""
    if not has_permission(current_user, Permission.EXPORT_REPORTS):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    report = await get_attendance_overview_report(department_id, None, None, current_user)
    
    data = []
    for course in report["courses"]:
        data.append({
            "المقرر": course["course_name"],
            "رمز المقرر": course["course_code"],
            "المدرس": course.get("teacher_name", ""),
            "إجمالي السجلات": course["total_records"],
            "حاضر": course["present_count"],
            "غائب": course["absent_count"],
            "متأخر": course["late_count"],
            "نسبة الحضور %": course["attendance_rate"]
        })
    
    if not data:
        data = [{"ملاحظة": "لا توجد بيانات"}]
    
    df = pd.DataFrame(data)
    output = BytesIO()
    df.to_excel(output, index=False, engine='openpyxl')
    output.seek(0)
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=attendance_overview.xlsx"}
    )

# ==================== Initialize Admin ====================

@router.post("/init-admin")
async def init_admin():
    """Create initial admin user if not exists"""
    existing = await db.users.find_one({"role": UserRole.ADMIN})
    if existing:
        return {"message": "المشرف موجود مسبقاً"}
    
    admin_data = {
        "username": "admin",
        "password": get_password_hash("admin123"),
        "full_name": "مدير النظام",
        "role": UserRole.ADMIN,
        "email": "admin@sharia.edu",
        "created_at": datetime.utcnow(),
        "is_active": True
    }
    
    await db.users.insert_one(admin_data)
    return {"message": "تم إنشاء حساب المشرف بنجاح", "username": "admin", "password": "admin123"}

@router.post("/reset-admin")
async def reset_admin():
    """Reset admin user - creates new or updates existing"""
    try:
        # Delete existing admin
        await db.users.delete_many({"username": "admin"})
        
        # Create fresh admin - use dynamic hash
        admin_password = "admin123"
        hashed = get_password_hash(admin_password)
        
        admin_data = {
            "username": "admin",
            "password": hashed,
            "full_name": "مدير النظام",
            "role": "admin",
            "email": "admin@sharia.edu",
            "created_at": datetime.utcnow(),
            "is_active": True,
            "permissions": [
                "manage_users", "manage_departments", "manage_courses",
                "manage_students", "record_attendance", "view_attendance",
                "edit_attendance", "view_reports", "export_reports",
                "import_data", "manage_lectures", "view_lectures"
            ]
        }
        
        await db.users.insert_one(admin_data)
        return {"message": "تم إعادة إنشاء حساب المشرف بنجاح", "username": "admin", "password": "admin123"}
    except Exception as e:
        logger.error(f"Error resetting admin: {e}")
        raise HTTPException(status_code=500, detail=str(e))

