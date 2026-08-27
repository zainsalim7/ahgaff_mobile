"""
Departments Routes - مسارات إدارة الأقسام
"""
from fastapi import APIRouter, HTTPException, status, Depends
from bson import ObjectId
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

from .deps import get_db, get_current_user, has_permission

router = APIRouter(tags=["الأقسام"])


class DepartmentCreate(BaseModel):
    name: str
    code: Optional[str] = None
    faculty_id: Optional[str] = None


class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    faculty_id: Optional[str] = None


@router.get("/departments")
async def get_departments(faculty_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """الحصول على جميع الأقسام"""
    db = get_db()
    query = {}
    if faculty_id:
        query["faculty_id"] = faculty_id
    
    departments = await db.departments.find(query).to_list(100)
    
    result = []
    for dept in departments:
        students_count = await db.students.count_documents({"department_id": str(dept["_id"])})
        teachers_count = await db.users.count_documents({
            "role": "teacher",
            "department_ids": str(dept["_id"])
        })
        
        faculty_name = None
        if dept.get("faculty_id"):
            try:
                faculty = await db.faculties.find_one({"_id": ObjectId(dept["faculty_id"])})
                if faculty:
                    faculty_name = faculty.get("name")
            except Exception:
                pass
        
        result.append({
            "id": str(dept["_id"]),
            "name": dept["name"],
            "code": dept.get("code", ""),
            "faculty_id": dept.get("faculty_id"),
            "faculty_name": faculty_name,
            "students_count": students_count,
            "teachers_count": teachers_count,
            "created_at": dept.get("created_at", datetime.utcnow())
        })
    
    return result


@router.post("/departments")
async def create_department(dept: DepartmentCreate, current_user: dict = Depends(get_current_user)):
    """إنشاء قسم جديد"""
    db = get_db()
    if current_user["role"] != "admin" and not has_permission(current_user, "manage_departments"):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    existing = await db.departments.find_one({"name": dept.name})
    if existing:
        raise HTTPException(status_code=400, detail="يوجد قسم بهذا الاسم")
    
    dept_doc = {
        "name": dept.name,
        "code": dept.code or "",
        "faculty_id": dept.faculty_id,
        "created_at": datetime.utcnow()
    }
    
    result = await db.departments.insert_one(dept_doc)
    
    return {
        "id": str(result.inserted_id),
        "name": dept.name,
        "code": dept.code or "",
        "faculty_id": dept.faculty_id,
        "message": "تم إنشاء القسم بنجاح"
    }


@router.get("/departments/{dept_id}")
async def get_department(dept_id: str, current_user: dict = Depends(get_current_user)):
    """الحصول على تفاصيل قسم"""
    db = get_db()
    dept = await db.departments.find_one({"_id": ObjectId(dept_id)})
    if not dept:
        raise HTTPException(status_code=404, detail="القسم غير موجود")
    
    students_count = await db.students.count_documents({"department_id": dept_id})
    
    return {
        "id": str(dept["_id"]),
        "name": dept["name"],
        "code": dept.get("code", ""),
        "faculty_id": dept.get("faculty_id"),
        "students_count": students_count,
        "created_at": dept.get("created_at", datetime.utcnow())
    }


@router.put("/departments/{dept_id}")
async def update_department(dept_id: str, data: DepartmentUpdate, current_user: dict = Depends(get_current_user)):
    """تحديث قسم"""
    db = get_db()
    if current_user["role"] != "admin" and not has_permission(current_user, "manage_departments"):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    dept = await db.departments.find_one({"_id": ObjectId(dept_id)})
    if not dept:
        raise HTTPException(status_code=404, detail="القسم غير موجود")
    
    update_data = {}
    if data.name:
        update_data["name"] = data.name
    if data.code is not None:
        update_data["code"] = data.code
    if data.faculty_id is not None:
        update_data["faculty_id"] = data.faculty_id
    
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        await db.departments.update_one({"_id": ObjectId(dept_id)}, {"$set": update_data})
    
    return {"message": "تم تحديث القسم بنجاح"}


@router.delete("/departments/{dept_id}")
async def delete_department(dept_id: str, current_user: dict = Depends(get_current_user)):
    """حذف قسم"""
    db = get_db()
    if current_user["role"] != "admin" and not has_permission(current_user, "manage_departments"):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    dept = await db.departments.find_one({"_id": ObjectId(dept_id)})
    if not dept:
        raise HTTPException(status_code=404, detail="القسم غير موجود")
    
    students_count = await db.students.count_documents({"department_id": dept_id})
    if students_count > 0:
        raise HTTPException(status_code=400, detail=f"لا يمكن حذف القسم، يوجد {students_count} طالب مسجل فيه")
    
    await db.departments.delete_one({"_id": ObjectId(dept_id)})
    
    return {"message": "تم حذف القسم بنجاح"}
