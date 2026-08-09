"""
Lectures Routes - مسارات المحاضرات
"""
from fastapi import APIRouter, HTTPException, status, Depends
from bson import ObjectId
from datetime import datetime
from typing import List

from models.lectures import LectureCreate, LectureUpdate, LectureResponse
from .deps import security

router = APIRouter(tags=["المحاضرات"])
db = None
def set_db(database):
    global db
    db = database

# ==================== Lecture Routes (المحاضرات/الحصص) ====================

@router.get("/lectures/today")
async def get_today_lectures(current_user: dict = Depends(get_current_user)):
    """الحصول على محاضرات اليوم للمعلم (الفصل النشط فقط)"""
    from datetime import timezone, timedelta
    today = datetime.now(timezone(timedelta(hours=3))).strftime("%Y-%m-%d")
    
    # جلب مقررات المعلم
    course_query = {"is_active": True}
    
    if current_user["role"] == UserRole.TEACHER:
        # البحث عن teacher_record_id في حساب المستخدم
        user = await db.users.find_one({"_id": ObjectId(current_user["id"])})
        if user and user.get("teacher_record_id"):
            course_query["teacher_id"] = user["teacher_record_id"]
        else:
            course_query["teacher_id"] = current_user["id"]
    elif current_user["role"] != UserRole.ADMIN:
        # للمستخدمين غير المعلمين والمدير
        return []
    
    courses = await db.courses.find(course_query).to_list(100)
    course_ids = [str(c["_id"]) for c in courses]
    course_map = {str(c["_id"]): c for c in courses}
    
    if not course_ids:
        return []
    
    # جلب محاضرات اليوم لهذه المقررات (ضمن الفصل النشط فقط)
    from ._active_semester import get_active_semester as _gas, apply_lecture_active_sem as _alas
    active_sem = await _gas(db)
    today_match = {"course_id": {"$in": course_ids}, "date": today}
    _alas(today_match, active_sem)
    lectures = await db.lectures.find(today_match).sort("start_time", 1).to_list(100)
    
    result = []
    for lecture in lectures:
        course = course_map.get(lecture["course_id"], {})
        # حساب عدد الطلاب الحاضرين
        attendance_count = await db.attendance.count_documents({
            "lecture_id": str(lecture["_id"]),
            "status": "present"
        })
        total_enrolled = await db.enrollments.count_documents({"course_id": lecture["course_id"]})
        
        result.append({
            "id": str(lecture["_id"]),
            "course_id": lecture["course_id"],
            "course_name": course.get("name", ""),
            "course_code": course.get("code", ""),
            "date": lecture["date"],
            "start_time": lecture["start_time"],
            "end_time": lecture["end_time"],
            "room": lecture.get("room", ""),
            "status": lecture.get("status", LectureStatus.SCHEDULED),
            "notes": lecture.get("notes", ""),
            "attendance_count": attendance_count,
            "total_enrolled": total_enrolled,
            "created_at": lecture["created_at"]
        })
    
    return result

@router.get("/lectures/month/{year}/{month}")
async def get_month_lectures(year: int, month: int, current_user: dict = Depends(get_current_user)):
    """الحصول على محاضرات شهر معين للمعلم - يرجع التواريخ التي فيها محاضرات"""
    
    # جلب مقررات المعلم
    course_query = {"is_active": True}
    
    if current_user["role"] == UserRole.TEACHER:
        user = await db.users.find_one({"_id": ObjectId(current_user["id"])})
        if user and user.get("teacher_record_id"):
            course_query["teacher_id"] = user["teacher_record_id"]
        else:
            course_query["teacher_id"] = current_user["id"]
    elif current_user["role"] != UserRole.ADMIN:
        return {"dates": [], "lectures": []}
    
    courses = await db.courses.find(course_query).to_list(100)
    course_ids = [str(c["_id"]) for c in courses]
    course_map = {str(c["_id"]): c for c in courses}
    
    if not course_ids:
        return {"dates": [], "lectures": []}
    
    # حساب بداية ونهاية الشهر
    start_date = f"{year:04d}-{month:02d}-01"
    if month == 12:
        end_date = f"{year+1:04d}-01-01"
    else:
        end_date = f"{year:04d}-{month+1:02d}-01"
    
    # جلب محاضرات الشهر (ضمن الفصل النشط فقط)
    from ._active_semester import get_active_semester as _gas, apply_lecture_active_sem as _alas
    active_sem = await _gas(db)
    month_match = {"course_id": {"$in": course_ids}, "date": {"$gte": start_date, "$lt": end_date}}
    _alas(month_match, active_sem)
    lectures = await db.lectures.find(month_match).sort("date", 1).to_list(500)
    
    # تجميع التواريخ والمحاضرات
    dates_with_lectures = {}
    lectures_list = []
    
    for lecture in lectures:
        date = lecture["date"]
        course = course_map.get(lecture["course_id"], {})
        
        if date not in dates_with_lectures:
            dates_with_lectures[date] = []
        
        lecture_info = {
            "id": str(lecture["_id"]),
            "course_id": lecture["course_id"],
            "course_name": course.get("name", ""),
            "course_code": course.get("code", ""),
            "date": date,
            "start_time": lecture["start_time"],
            "end_time": lecture["end_time"],
            "room": lecture.get("room", ""),
            "status": lecture.get("status", LectureStatus.SCHEDULED),
        }
        
        dates_with_lectures[date].append(lecture_info)
        lectures_list.append(lecture_info)
    
    return {
        "dates": list(dates_with_lectures.keys()),
        "lectures_by_date": dates_with_lectures,
        "lectures": lectures_list,
        "total_lectures": len(lectures_list)
    }

@router.get("/lectures/{course_id}")
async def get_course_lectures(
    course_id: str,
    status: Optional[str] = None,
    all_semesters: bool = False,
    current_user: dict = Depends(get_current_user)
):
    """الحصول على محاضرات مقرر — يفلتر بالفصل النشط افتراضياً.

    استخدم all_semesters=true لجلب جميع المحاضرات عبر كل الفصول (للأرشيف).
    """
    course = await db.courses.find_one({"_id": ObjectId(course_id)})
    if not course:
        raise HTTPException(status_code=404, detail="المقرر غير موجود")

    query: dict = {"course_id": course_id}
    if status:
        query["status"] = status

    # 🔧 توحيد منطق الفلترة: نطبّق فلتر الفصل النشط افتراضياً
    if not all_semesters:
        from ._active_semester import (
            get_active_semester as _get_act_sem,
            apply_lecture_active_sem as _apply_sem,
        )
        active_sem = await _get_act_sem(db)
        _apply_sem(query, active_sem)

    lectures = await db.lectures.find(query).sort("date", 1).to_list(1000)
    
    result = []
    for lecture in lectures:
        result.append({
            "id": str(lecture["_id"]),
            "course_id": lecture["course_id"],
            "date": lecture["date"],
            "start_time": lecture["start_time"],
            "end_time": lecture["end_time"],
            "room": lecture.get("room", ""),
            "status": lecture.get("status", LectureStatus.SCHEDULED),
            "notes": lecture.get("notes", ""),
            "created_at": lecture["created_at"]
        })
    
    return result

@router.post("/lectures")
async def create_lecture(
    data: LectureCreate,
    current_user: dict = Depends(get_current_user)
):
    """إنشاء محاضرة جديدة"""
    if current_user["role"] not in [UserRole.ADMIN, UserRole.TEACHER]:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    course = await db.courses.find_one({"_id": ObjectId(data.course_id)})
    if not course:
        raise HTTPException(status_code=404, detail="المقرر غير موجود")
    
    lecture = {
        "course_id": data.course_id,
        "date": data.date,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "room": data.room or "",
        "status": LectureStatus.SCHEDULED,
        "notes": data.notes or "",
        "created_at": datetime.utcnow(),
        "created_by": current_user["id"]
    }
    
    result = await db.lectures.insert_one(lecture)
    
    return {
        "id": str(result.inserted_id),
        "message": "تم إنشاء المحاضرة بنجاح"
    }

@router.post("/lectures/generate")
async def generate_semester_lectures(
    data: GenerateLecturesRequest,
    current_user: dict = Depends(get_current_user)
):
    """توليد محاضرات الفصل الدراسي تلقائياً"""
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    course = await db.courses.find_one({"_id": ObjectId(data.course_id)})
    if not course:
        raise HTTPException(status_code=404, detail="المقرر غير موجود")
    
    from datetime import timedelta
    
    start = datetime.strptime(data.start_date, "%Y-%m-%d")
    end = datetime.strptime(data.end_date, "%Y-%m-%d")
    
    # أيام الأسبوع: 0=السبت، 1=الأحد، 2=الاثنين، ...
    day_map = {0: 5, 1: 6, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4}  # تحويل من نظامنا إلى Python weekday
    target_weekday = day_map.get(data.day_of_week, data.day_of_week)
    
    # البحث عن أول يوم مطابق
    current = start
    while current.weekday() != target_weekday:
        current += timedelta(days=1)
    
    lectures_created = 0
    
    while current <= end:
        lecture = {
            "course_id": data.course_id,
            "date": current.strftime("%Y-%m-%d"),
            "start_time": data.start_time,
            "end_time": data.end_time,
            "room": data.room or "",
            "status": LectureStatus.SCHEDULED,
            "notes": "",
            "created_at": datetime.utcnow(),
            "created_by": current_user["id"]
        }
        await db.lectures.insert_one(lecture)
        lectures_created += 1
        current += timedelta(days=7)
    
    return {
        "message": f"تم إنشاء {lectures_created} محاضرة للفصل الدراسي",
        "count": lectures_created
    }

class DaySlot(BaseModel):
    start_time: str
    end_time: str

class DayScheduleConfig(BaseModel):
    day: str
    slots: List[DaySlot]

class GenerateSemesterRequest(BaseModel):
    course_id: str
    room: str
    schedule: List[DayScheduleConfig]
    start_date: str
    end_date: str

@router.post("/lectures/generate-semester")
async def generate_semester_lectures_advanced(
    data: GenerateSemesterRequest,
    current_user: dict = Depends(get_current_user)
):
    """توليد محاضرات الفصل الدراسي المتقدم - دعم أيام متعددة وأوقات متعددة"""
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    course = await db.courses.find_one({"_id": ObjectId(data.course_id)})
    if not course:
        raise HTTPException(status_code=404, detail="المقرر غير موجود")
    
    from datetime import timedelta
    
    try:
        start = datetime.strptime(data.start_date, "%Y-%m-%d")
        end = datetime.strptime(data.end_date, "%Y-%m-%d")
    except:
        raise HTTPException(status_code=400, detail="صيغة التاريخ غير صحيحة")
    
    # تحويل أسماء الأيام إلى أرقام Python weekday
    day_name_to_weekday = {
        'saturday': 5,
        'sunday': 6,
        'monday': 0,
        'tuesday': 1,
        'wednesday': 2,
        'thursday': 3,
        'friday': 4,
    }
    
    lectures_created = 0
    
    for day_config in data.schedule:
        target_weekday = day_name_to_weekday.get(day_config.day.lower())
        if target_weekday is None:
            continue
        
        # البحث عن أول يوم مطابق
        current = start
        while current.weekday() != target_weekday:
            current += timedelta(days=1)
        
        # توليد المحاضرات لكل أسبوع
        while current <= end:
            # إضافة محاضرة لكل فترة زمنية في هذا اليوم
            for slot in day_config.slots:
                lecture = {
                    "course_id": data.course_id,
                    "date": current.strftime("%Y-%m-%d"),
                    "start_time": slot.start_time,
                    "end_time": slot.end_time,
                    "room": data.room,
                    "status": LectureStatus.SCHEDULED,
                    "notes": "",
                    "created_at": datetime.utcnow(),
                    "created_by": current_user["id"]
                }
                await db.lectures.insert_one(lecture)
                lectures_created += 1
            
            current += timedelta(days=7)
    
    return {
        "message": f"تم إنشاء {lectures_created} محاضرة للفصل الدراسي",
        "lectures_created": lectures_created
    }

@router.put("/lectures/{lecture_id}")
async def update_lecture(
    lecture_id: str,
    data: LectureUpdate,
    current_user: dict = Depends(get_current_user)
):
    """تعديل محاضرة"""
    if current_user["role"] not in [UserRole.ADMIN, UserRole.TEACHER]:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    lecture = await db.lectures.find_one({"_id": ObjectId(lecture_id)})
    if not lecture:
        raise HTTPException(status_code=404, detail="المحاضرة غير موجودة")
    
    update_data = {k: v for k, v in data.dict().items() if v is not None}
    
    if update_data:
        await db.lectures.update_one(
            {"_id": ObjectId(lecture_id)},
            {"$set": update_data}
        )
    
    return {"message": "تم تحديث المحاضرة بنجاح"}

@router.delete("/lectures/{lecture_id}")
async def delete_lecture(
    lecture_id: str,
    current_user: dict = Depends(get_current_user)
):
    """حذف محاضرة"""
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    result = await db.lectures.delete_one({"_id": ObjectId(lecture_id)})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="المحاضرة غير موجودة")
    
    # حذف سجلات الحضور المرتبطة
    await db.attendance.delete_many({"lecture_id": lecture_id})
    
    return {"message": "تم حذف المحاضرة بنجاح"}

@router.get("/lectures/{lecture_id}/details")
async def get_lecture_details(
    lecture_id: str,
    current_user: dict = Depends(get_current_user)
):
    """الحصول على تفاصيل محاضرة مع الطلاب المسجلين"""
    lecture = await db.lectures.find_one({"_id": ObjectId(lecture_id)})
    if not lecture:
        raise HTTPException(status_code=404, detail="المحاضرة غير موجودة")
    
    course = await db.courses.find_one({"_id": ObjectId(lecture["course_id"])})
    
    # الطلاب المسجلين في المقرر
    enrollments = await db.enrollments.find({"course_id": lecture["course_id"]}).to_list(10000)
    student_ids = [ObjectId(e["student_id"]) for e in enrollments]
    students = await db.students.find({"_id": {"$in": student_ids}}).to_list(10000)
    
    # سجلات الحضور لهذه المحاضرة
    attendance_records = await db.attendance.find({"lecture_id": lecture_id}).to_list(10000)
    attendance_map = {r["student_id"]: r["status"] for r in attendance_records}
    
    students_with_attendance = []
    for student in students:
        students_with_attendance.append({
            "id": str(student["_id"]),
            "student_id": student["student_id"],
            "full_name": student["full_name"],
            "attendance_status": attendance_map.get(str(student["_id"]), None)
        })
    
    return {
        "lecture": {
            "id": str(lecture["_id"]),
            "date": lecture["date"],
            "start_time": lecture["start_time"],
            "end_time": lecture["end_time"],
            "room": lecture.get("room", ""),
            "status": lecture.get("status", LectureStatus.SCHEDULED),
            "notes": lecture.get("notes", "")
        },
        "course": {
            "id": str(course["_id"]),
            "name": course["name"],
            "code": course["code"]
        },
        "students": students_with_attendance,
        "attendance_recorded": len(attendance_records) > 0,
        "attendance_status": get_lecture_attendance_status(lecture)
    }

def get_lecture_attendance_status(lecture: dict) -> dict:
    """حساب حالة التحضير للمحاضرة"""
    now = datetime.utcnow()
    
    try:
        lecture_start = datetime.strptime(f"{lecture['date']} {lecture['start_time']}", "%Y-%m-%d %H:%M")
        lecture_end = datetime.strptime(f"{lecture['date']} {lecture['end_time']}", "%Y-%m-%d %H:%M")
    except:
        return {
            "can_take_attendance": False,
            "reason": "خطأ في تنسيق التاريخ أو الوقت",
            "status": "error"
        }
    
    # حساب مدة المحاضرة بالدقائق
    lecture_duration = (lecture_end - lecture_start).total_seconds() / 60
    
    # الوقت المسموح به للتحضير = وقت نهاية المحاضرة + مدة المحاضرة
    allowed_end_time = lecture_end + timedelta(minutes=lecture_duration)
    
    # إذا تم التحضير مسبقاً (المحاضرة مكتملة)
    if lecture.get("status") == LectureStatus.COMPLETED:
        return {
            "can_take_attendance": False,
            "reason": "تم التحضير مسبقاً ولا يمكن التعديل",
            "status": "completed"
        }
    
    # إذا لم يحن وقت المحاضرة بعد
    if now < lecture_start:
        time_until_start = int((lecture_start - now).total_seconds() / 60)
        return {
            "can_take_attendance": False,
            "reason": f"لم يحن وقت المحاضرة بعد. تبدأ الساعة {lecture['start_time']}",
            "status": "not_started",
            "minutes_until_start": time_until_start
        }
    
    # إذا انتهى الوقت المسموح
    if now > allowed_end_time:
        return {
            "can_take_attendance": False,
            "reason": f"انتهى وقت التحضير المسموح. كان يمكن التحضير حتى {allowed_end_time.strftime('%H:%M')}",
            "status": "expired"
        }
    
    # يمكن التحضير
    time_remaining = int((allowed_end_time - now).total_seconds() / 60)
    return {
        "can_take_attendance": True,
        "reason": "يمكن التحضير الآن",
        "status": "available",
        "minutes_remaining": time_remaining,
        "deadline": allowed_end_time.strftime("%H:%M")
    }

@router.get("/lectures/{lecture_id}/attendance-status")
async def get_lecture_attendance_status_api(
    lecture_id: str,
    current_user: dict = Depends(get_current_user)
):
    """التحقق من حالة التحضير للمحاضرة"""
    lecture = await db.lectures.find_one({"_id": ObjectId(lecture_id)})
    if not lecture:
        raise HTTPException(status_code=404, detail="المحاضرة غير موجودة")
    
    return get_lecture_attendance_status(lecture)


@router.get("/attendance/lecture/{lecture_id}")
async def get_lecture_attendance(
    lecture_id: str,
    current_user: dict = Depends(get_current_user)
):
    """جلب سجلات الحضور لمحاضرة معينة"""
    lecture = await db.lectures.find_one({"_id": ObjectId(lecture_id)})
    if not lecture:
        raise HTTPException(status_code=404, detail="المحاضرة غير موجودة")
    
    records = await db.attendance.find({"lecture_id": lecture_id}).to_list(1000)
    
    result = []
    for r in records:
        student = await db.students.find_one({"_id": ObjectId(r["student_id"])})
        result.append({
            "id": str(r["_id"]),
            "lecture_id": r["lecture_id"],
            "student_id": r["student_id"],
            "student_name": student["full_name"] if student else "غير معروف",
            "student_number": student.get("student_id", "") if student else "",
            "status": r["status"],
            "date": r["date"].isoformat() if isinstance(r["date"], datetime) else r["date"],
            "method": r["method"],
            "notes": r.get("notes")
        })
    
    return result


