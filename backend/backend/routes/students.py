"""
Students Routes - مسارات إدارة الطلاب
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from bson import ObjectId
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

from .deps import get_db, get_current_user, get_password_hash

router = APIRouter(tags=["الطلاب"])


class StudentCreate(BaseModel):
    name: str
    student_id: str
    department_id: str
    level: Optional[int] = 1
    section: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class StudentUpdate(BaseModel):
    name: Optional[str] = None
    department_id: Optional[str] = None
    level: Optional[int] = None
    section: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/students-attendance-summary")
async def students_attendance_summary(
    department_id: Optional[str] = None,
    semester_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """ملخص خفيف لنسبة الحضور لكل طالب — للاستخدام في الفرز/العرض.

    Returns: list of {id, attendance_pct, total_sessions, present_count}
    - يحسب: present + (late × 0.5) كنسبة من إجمالي السجلات (excluding excused بترك القرار للفرونت إذا أرادها).
    - إذا لم يكن للطالب سجلات: pct = null (تُعالَج في الواجهة كأنها صفر أو "لا يوجد").
    """
    db = get_db()
    # فلتر الطلاب
    student_query: dict = {}
    if department_id:
        student_query["department_id"] = department_id
    students_list = await db.students.find(student_query, {"_id": 1}).to_list(5000)
    student_ids = [str(s["_id"]) for s in students_list]
    if not student_ids:
        return []

    # ✨ aggregation لسجلات الحضور
    match: dict = {"student_id": {"$in": student_ids}}
    if semester_id:
        match["semester_id"] = semester_id
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": "$student_id",
            "total": {"$sum": 1},
            "present": {"$sum": {"$cond": [{"$eq": ["$status", "present"]}, 1, 0]}},
            "late": {"$sum": {"$cond": [{"$eq": ["$status", "late"]}, 1, 0]}},
            "absent": {"$sum": {"$cond": [{"$eq": ["$status", "absent"]}, 1, 0]}},
            "excused": {"$sum": {"$cond": [{"$eq": ["$status", "excused"]}, 1, 0]}},
        }},
    ]
    cursor = db.attendance.aggregate(pipeline)
    by_student: dict = {}
    async for row in cursor:
        total = row["total"]
        if total == 0:
            continue
        # نستخدم scoring متوسط: present=1, late=0.5
        rate = (row["present"] + row["late"] * 0.5) / total * 100
        by_student[row["_id"]] = {
            "id": row["_id"],
            "attendance_pct": round(rate, 1),
            "total_sessions": total,
            "present_count": row["present"],
            "absent_count": row["absent"],
            "late_count": row["late"],
            "excused_count": row["excused"],
        }

    # ضمّن كل الطلاب (بما فيهم بدون سجلات)
    result = []
    for sid in student_ids:
        if sid in by_student:
            result.append(by_student[sid])
        else:
            result.append({
                "id": sid,
                "attendance_pct": None,
                "total_sessions": 0,
                "present_count": 0,
                "absent_count": 0,
                "late_count": 0,
                "excused_count": 0,
            })
    return result


@router.get("/students")
async def get_students(
    department_id: Optional[str] = None,
    level: Optional[int] = None,
    section: Optional[str] = None,
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """الحصول على جميع الطلاب"""
    db = get_db()
    query = {}
    
    if department_id:
        query["department_id"] = department_id
    if level:
        query["level"] = level
    if section:
        query["section"] = section
    if is_active is not None:
        query["is_active"] = is_active
    if status:
        query["status"] = status
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"student_id": {"$regex": search, "$options": "i"}}
        ]
    
    students = await db.students.find(query).to_list(1000)
    
    result = []
    for s in students:
        dept_name = None
        if s.get("department_id"):
            try:
                dept = await db.departments.find_one({"_id": ObjectId(s["department_id"])})
                if dept:
                    dept_name = dept.get("name")
            except Exception:
                pass
        
        # تحديد الحالة الفعلية: من حقل status لو موجود، وإلا نشتقّها من is_active
        is_act = s.get("is_active", True)
        student_status = s.get("status") or ("active" if is_act else "inactive")
        
        result.append({
            "id": str(s["_id"]),
            "name": s.get("name", "غير محدد"),
            "full_name": s.get("full_name") or s.get("name", "غير محدد"),
            "student_id": s.get("student_id", ""),
            "department_id": s.get("department_id"),
            "department_name": dept_name,
            "level": s.get("level", 1),
            "section": s.get("section"),
            "phone": s.get("phone"),
            "email": s.get("email"),
            "is_active": is_act,
            "status": student_status,
            "status_changed_at": s.get("status_changed_at"),
            "status_reason": s.get("status_reason"),
            "graduation_date": s.get("graduation_date"),
            "graduated_from_level": s.get("graduated_from_level"),
            "expulsion_date": s.get("expulsion_date"),
            "frozen_at": s.get("frozen_at"),
            "created_at": s.get("created_at", datetime.utcnow())
        })
    
    return result


@router.post("/students")
async def create_student(student: StudentCreate, current_user: dict = Depends(get_current_user)):
    """إنشاء طالب جديد"""
    db = get_db()
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    existing = await db.students.find_one({"student_id": student.student_id})
    if existing:
        raise HTTPException(status_code=400, detail="رقم القيد موجود مسبقاً")
    
    student_doc = {
        "name": student.name,
        "student_id": student.student_id,
        "department_id": student.department_id,
        "level": student.level or 1,
        "section": student.section,
        "phone": student.phone,
        "email": student.email,
        "is_active": True,
        "created_at": datetime.utcnow(),
        "created_by": current_user["id"]
    }
    
    result = await db.students.insert_one(student_doc)
    
    # إنشاء حساب مستخدم للطالب
    user_doc = {
        "username": student.student_id,
        "password": get_password_hash(student.student_id),
        "full_name": student.name,
        "role": "student",
        "student_id": str(result.inserted_id),
        "department_id": student.department_id,
        "is_active": True,
        "created_at": datetime.utcnow()
    }
    await db.users.insert_one(user_doc)
    
    return {
        "id": str(result.inserted_id),
        "message": "تم إنشاء الطالب بنجاح"
    }


@router.get("/students/{student_id}")
async def get_student(student_id: str, current_user: dict = Depends(get_current_user)):
    """الحصول على تفاصيل طالب"""
    db = get_db()
    student = await db.students.find_one({"_id": ObjectId(student_id)})
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    
    dept_name = None
    if student.get("department_id"):
        try:
            dept = await db.departments.find_one({"_id": ObjectId(student["department_id"])})
            if dept:
                dept_name = dept.get("name")
        except Exception:
            pass
    
    return {
        "id": str(student["_id"]),
        "name": student["name"],
        "student_id": student["student_id"],
        "department_id": student.get("department_id"),
        "department_name": dept_name,
        "level": student.get("level", 1),
        "section": student.get("section"),
        "phone": student.get("phone"),
        "email": student.get("email"),
        "is_active": student.get("is_active", True),
        "created_at": student.get("created_at", datetime.utcnow())
    }


@router.put("/students/{student_id}")
async def update_student(student_id: str, data: StudentUpdate, current_user: dict = Depends(get_current_user)):
    """تحديث بيانات طالب"""
    db = get_db()
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    student = await db.students.find_one({"_id": ObjectId(student_id)})
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    
    update_data = {}
    if data.name:
        update_data["name"] = data.name
    if data.department_id:
        update_data["department_id"] = data.department_id
    if data.level is not None:
        update_data["level"] = data.level
    if data.section is not None:
        update_data["section"] = data.section
    if data.phone is not None:
        update_data["phone"] = data.phone
    if data.email is not None:
        update_data["email"] = data.email
    if data.is_active is not None:
        update_data["is_active"] = data.is_active
    
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        await db.students.update_one({"_id": ObjectId(student_id)}, {"$set": update_data})
        
        # 🔄 تغيّر القسم أو المستوى → نظّف تسجيلات مقررات الفصل النشط القديمة
        if (data.department_id and data.department_id != student.get("department_id")) or \
           (data.level is not None and data.level != student.get("level")):
            from .student_transfer import cleanup_active_enrollments
            await cleanup_active_enrollments(db, student_id)
        
        # تحديث حساب المستخدم المرتبط
        user_update = {}
        if data.name:
            user_update["full_name"] = data.name
        if data.department_id:
            user_update["department_id"] = data.department_id
        if data.is_active is not None:
            user_update["is_active"] = data.is_active
        
        if user_update:
            await db.users.update_one(
                {"student_id": student_id},
                {"$set": user_update}
            )
    
    return {"message": "تم تحديث بيانات الطالب بنجاح"}


@router.delete("/students/{student_id}")
async def delete_student(student_id: str, current_user: dict = Depends(get_current_user)):
    """حذف طالب"""
    db = get_db()
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    student = await db.students.find_one({"_id": ObjectId(student_id)})
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    
    # حذف الطالب
    await db.students.delete_one({"_id": ObjectId(student_id)})
    
    # حذف حساب المستخدم المرتبط
    await db.users.delete_one({"student_id": student_id})
    
    # حذف سجلات الحضور
    await db.attendance.delete_many({"student_id": student_id})
    
    # حذف التسجيلات
    await db.enrollments.delete_many({"student_id": student_id})
    
    return {"message": "تم حذف الطالب بنجاح"}
