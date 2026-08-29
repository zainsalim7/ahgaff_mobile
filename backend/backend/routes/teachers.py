"""
Teachers Routes - مسارات إدارة المعلمين
"""
from fastapi import APIRouter, HTTPException, status, Depends
from bson import ObjectId
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

from .deps import get_db, get_current_user, get_password_hash

router = APIRouter(tags=["المعلمون"])


class TeacherCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    department_ids: Optional[List[str]] = []
    specialization: Optional[str] = None


@router.get("/teachers")
async def get_teachers(
    department_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """الحصول على جميع المعلمين - من جدول teachers"""
    db = get_db()
    
    # البحث في جدول teachers
    query = {}
    if department_id:
        query["department_id"] = department_id
    
    teachers = await db.teachers.find(query).to_list(100)
    
    result = []
    for t in teachers:
        # الحصول على عدد المقررات
        teacher_id_str = str(t["_id"])
        courses_count = await db.courses.count_documents({"teacher_id": teacher_id_str})
        
        # الحصول على اسم القسم
        dept_name = None
        if t.get("department_id"):
            try:
                dept = await db.departments.find_one({"_id": ObjectId(t["department_id"])})
                if dept:
                    dept_name = dept.get("name")
            except Exception:
                pass
        
        # الحصول على معلومات المستخدم إن وجد
        user_info = None
        if t.get("user_id"):
            try:
                user_info = await db.users.find_one({"_id": ObjectId(t["user_id"])})
            except Exception:
                pass
        
        result.append({
            "id": teacher_id_str,
            "teacher_id": t.get("teacher_id"),
            "name": t.get("full_name"),
            "full_name": t.get("full_name"),
            "username": user_info.get("username") if user_info else t.get("teacher_id"),
            "phone": t.get("phone", ""),
            "email": t.get("email", ""),
            "department_id": t.get("department_id"),
            "department_ids": [t.get("department_id")] if t.get("department_id") else [],
            "department_name": dept_name,
            "department_names": [dept_name] if dept_name else [],
            "specialization": t.get("specialization"),
            "academic_title": t.get("academic_title"),
            "teaching_load": t.get("teaching_load"),
            "courses_count": courses_count,
            "is_active": t.get("is_active", True),
            "has_user_account": user_info is not None,
            "user_id": str(t.get("user_id")) if t.get("user_id") else None,
            "created_at": t.get("created_at")
        })
    
    return result


@router.post("/teachers")
async def create_teacher(teacher: TeacherCreate, current_user: dict = Depends(get_current_user)):
    """إنشاء معلم جديد"""
    db = get_db()
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    # إنشاء معلم في جدول teachers
    teacher_id = teacher.name.replace(" ", "_")
    teacher_doc = {
        "teacher_id": teacher_id,
        "full_name": teacher.name,
        "phone": teacher.phone or "",
        "email": teacher.email or "",
        "department_id": teacher.department_ids[0] if teacher.department_ids else None,
        "specialization": teacher.specialization,
        "is_active": True,
        "created_at": datetime.utcnow()
    }
    
    result = await db.teachers.insert_one(teacher_doc)
    
    return {
        "id": str(result.inserted_id),
        "teacher_id": teacher_id,
        "message": "تم إنشاء المعلم بنجاح"
    }


@router.get("/teachers/{teacher_id}")
async def get_teacher(teacher_id: str, current_user: dict = Depends(get_current_user)):
    """الحصول على تفاصيل معلم"""
    db = get_db()
    teacher = await db.users.find_one({"_id": ObjectId(teacher_id), "role": "teacher"})
    if not teacher:
        raise HTTPException(status_code=404, detail="المعلم غير موجود")
    
    courses = await db.courses.find({"teacher_id": teacher_id}).to_list(100)
    
    return {
        "id": str(teacher["_id"]),
        "name": teacher.get("full_name"),
        "username": teacher.get("username"),
        "phone": teacher.get("phone"),
        "email": teacher.get("email"),
        "department_ids": teacher.get("department_ids", []),
        "specialization": teacher.get("specialization"),
        "courses": [{"id": str(c["_id"]), "name": c["name"]} for c in courses],
        "is_active": teacher.get("is_active", True)
    }


@router.delete("/teachers/{teacher_id}")
async def delete_teacher(teacher_id: str, current_user: dict = Depends(get_current_user)):
    """حذف معلم"""
    db = get_db()
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    teacher = await db.users.find_one({"_id": ObjectId(teacher_id), "role": "teacher"})
    if not teacher:
        raise HTTPException(status_code=404, detail="المعلم غير موجود")
    
    courses_count = await db.courses.count_documents({"teacher_id": teacher_id})
    if courses_count > 0:
        raise HTTPException(status_code=400, detail=f"لا يمكن حذف المعلم، لديه {courses_count} مقرر")
    
    await db.users.delete_one({"_id": ObjectId(teacher_id)})
    
    return {"message": "تم حذف المعلم بنجاح"}
