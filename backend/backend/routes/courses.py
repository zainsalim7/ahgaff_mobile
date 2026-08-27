"""
Courses Routes - مسارات إدارة المقررات
"""
from fastapi import APIRouter, HTTPException, status, Depends
from bson import ObjectId
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

from .deps import get_db, get_current_user, has_permission

router = APIRouter(tags=["المقررات"])


class CourseCreate(BaseModel):
    name: str
    code: str
    department_id: str
    teacher_id: Optional[str] = None
    credit_hours: Optional[int] = 3
    description: Optional[str] = None


@router.get("/courses")
async def get_courses(
    department_id: Optional[str] = None,
    teacher_id: Optional[str] = None,
    semester_id: Optional[str] = None,
    all_semesters: bool = False,
    current_user: dict = Depends(get_current_user)
):
    """الحصول على جميع المقررات.
    
    منطق الفلترة الافتراضي بالفصل النشط:
    - يفعَّل تلقائياً للمعلمين (role=teacher) والطلاب (role=student) — يرون فقط الفصل الحالي.
    - يفعَّل تلقائياً عند تمرير ?teacher_id (استعلام تطبيقات).
    - الإداريون يرون كل الفصول افتراضياً.
    - أرسل ?all_semesters=true لتعطيل الفلترة، أو ?semester_id=X لفصل محدد.
    """
    db = get_db()
    query = {}
    
    if department_id:
        query["department_id"] = department_id
    if teacher_id:
        query["teacher_id"] = teacher_id
    
    # الفلترة بالفصل النشط — تلقائياً للمعلمين/الطلاب وأي استعلام معلم
    role = current_user.get("role")
    should_filter_active = (
        not all_semesters and
        (semester_id is not None or teacher_id is not None or role in ("teacher", "student"))
    )
    if semester_id:
        query["semester_id"] = semester_id
    elif should_filter_active:
        active_sem = await db.semesters.find_one({"status": "active"})
        if active_sem:
            query["semester_id"] = str(active_sem["_id"])
    
    courses = await db.courses.find(query).to_list(100)
    
    result = []
    for c in courses:
        teacher_name = None
        if c.get("teacher_id"):
            try:
                teacher = await db.users.find_one({"_id": ObjectId(c["teacher_id"])})
                if teacher:
                    teacher_name = teacher.get("full_name")
            except Exception:
                pass
        
        dept_name = None
        if c.get("department_id"):
            try:
                dept = await db.departments.find_one({"_id": ObjectId(c["department_id"])})
                if dept:
                    dept_name = dept.get("name")
            except Exception:
                pass
        
        students_count = await db.enrollments.count_documents({"course_id": str(c["_id"])})
        
        result.append({
            "id": str(c["_id"]),
            "name": c["name"],
            "code": c.get("code", ""),
            "department_id": c.get("department_id"),
            "department_name": dept_name,
            "teacher_id": c.get("teacher_id"),
            "teacher_name": teacher_name,
            "credit_hours": c.get("credit_hours", 3),
            "description": c.get("description"),
            "students_count": students_count,
            "is_active": c.get("is_active", True),
            "created_at": c.get("created_at", datetime.utcnow())
        })
    
    return result


@router.post("/courses")
async def create_course(course: CourseCreate, current_user: dict = Depends(get_current_user)):
    """إنشاء مقرر جديد"""
    db = get_db()
    if current_user["role"] != "admin" and not has_permission(current_user, "manage_courses") and not has_permission(current_user, "add_course"):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    existing = await db.courses.find_one({"code": course.code})
    if existing:
        raise HTTPException(status_code=400, detail="كود المقرر موجود مسبقاً")
    
    course_doc = {
        "name": course.name,
        "code": course.code,
        "department_id": course.department_id,
        "teacher_id": course.teacher_id,
        "credit_hours": course.credit_hours or 3,
        "description": course.description,
        "is_active": True,
        "created_at": datetime.utcnow()
    }
    
    result = await db.courses.insert_one(course_doc)
    
    return {
        "id": str(result.inserted_id),
        "message": "تم إنشاء المقرر بنجاح"
    }


@router.get("/courses/{course_id}")
async def get_course(course_id: str, current_user: dict = Depends(get_current_user)):
    """الحصول على تفاصيل مقرر"""
    db = get_db()
    course = await db.courses.find_one({"_id": ObjectId(course_id)})
    if not course:
        raise HTTPException(status_code=404, detail="المقرر غير موجود")
    
    teacher_name = None
    if course.get("teacher_id"):
        try:
            teacher = await db.users.find_one({"_id": ObjectId(course["teacher_id"])})
            if teacher:
                teacher_name = teacher.get("full_name")
        except Exception:
            pass
    
    students_count = await db.enrollments.count_documents({"course_id": course_id})
    
    return {
        "id": str(course["_id"]),
        "name": course["name"],
        "code": course.get("code"),
        "department_id": course.get("department_id"),
        "teacher_id": course.get("teacher_id"),
        "teacher_name": teacher_name,
        "credit_hours": course.get("credit_hours", 3),
        "description": course.get("description"),
        "students_count": students_count,
        "is_active": course.get("is_active", True)
    }


@router.delete("/courses/{course_id}")
async def delete_course(course_id: str, current_user: dict = Depends(get_current_user)):
    """حذف مقرر"""
    db = get_db()
    if current_user["role"] != "admin" and not has_permission(current_user, "manage_courses") and not has_permission(current_user, "delete_course"):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    course = await db.courses.find_one({"_id": ObjectId(course_id)})
    if not course:
        raise HTTPException(status_code=404, detail="المقرر غير موجود")
    
    await db.courses.delete_one({"_id": ObjectId(course_id)})
    await db.enrollments.delete_many({"course_id": course_id})
    await db.lectures.delete_many({"course_id": course_id})
    
    return {"message": "تم حذف المقرر بنجاح"}
