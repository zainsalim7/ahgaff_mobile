"""
Users Routes - مسارات إدارة المستخدمين
"""
from fastapi import APIRouter, HTTPException, status, Depends, Body
from bson import ObjectId
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

from models.users import UserCreate, UserResponse
from models.permissions import UserRole, DEFAULT_PERMISSIONS
from .deps import get_db, get_current_user, get_password_hash, log_activity, pwd_context, logger

router = APIRouter(tags=["المستخدمون"])


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    password: Optional[str] = None
    role_id: Optional[str] = None
    university_id: Optional[str] = None
    faculty_id: Optional[str] = None
    department_id: Optional[str] = None
    department_ids: Optional[List[str]] = None


@router.post("/users", response_model=UserResponse)
async def create_user(user: UserCreate, current_user: dict = Depends(get_current_user)):
    db = get_db()
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك بإنشاء مستخدمين")
    
    existing = await db.users.find_one({"username": user.username})
    if existing:
        raise HTTPException(status_code=400, detail="اسم المستخدم موجود مسبقاً")
    
    user_dict = user.dict()
    user_dict["password"] = get_password_hash(user.password)
    user_dict["created_at"] = datetime.utcnow()
    user_dict["is_active"] = True
    
    if user_dict.get("permissions") is None:
        user_dict["permissions"] = []
    
    if user.role_id:
        role = await db.roles.find_one({"_id": ObjectId(user.role_id)})
        if role:
            user_dict["role_id"] = user.role_id
            user_dict["role"] = role.get("system_key", "custom")
            user_dict["permissions"] = role.get("permissions", [])
    elif not user.role:
        user_dict["role"] = "employee"
        user_dict["permissions"] = []
    
    if user_dict.get("department_ids") and len(user_dict["department_ids"]) > 0:
        user_dict["department_id"] = user_dict["department_ids"][0]
    
    result = await db.users.insert_one(user_dict)
    
    return {
        "id": str(result.inserted_id),
        "username": user_dict["username"],
        "full_name": user_dict["full_name"],
        "role": user_dict["role"],
        "role_id": user_dict.get("role_id"),
        "email": user_dict.get("email"),
        "phone": user_dict.get("phone"),
        "created_at": user_dict["created_at"],
        "is_active": user_dict.get("is_active", True),
        "permissions": user_dict.get("permissions", []),
        "university_id": user_dict.get("university_id"),
        "faculty_id": user_dict.get("faculty_id"),
        "department_id": user_dict.get("department_id"),
        "department_ids": user_dict.get("department_ids", []),
    }


@router.get("/users", response_model=List[UserResponse])
async def get_users(role: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    db = get_db()
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    query = {}
    if role:
        query["role"] = role
    else:
        # 🔧 شاشة "إدارة المستخدمين" تستبعد الطلاب/المعلمين (لديها شاشات مستقلة)
        query["role"] = {"$nin": ["student", "teacher"]}
    
    users = await db.users.find(query).to_list(10000)
    
    result = []
    for u in users:
        user_data = {
            "id": str(u["_id"]),
            "username": u["username"],
            "full_name": u["full_name"],
            "role": u["role"],
            "role_id": u.get("role_id"),
            "email": u.get("email"),
            "phone": u.get("phone"),
            "created_at": u["created_at"],
            "is_active": u.get("is_active", True),
            "permissions": u.get("permissions") or DEFAULT_PERMISSIONS.get(u["role"], []),
            "university_id": u.get("university_id"),
            "faculty_id": u.get("faculty_id"),
            "department_id": u.get("department_id"),
            "department_ids": u.get("department_ids", []),
        }
        
        if u.get("faculty_id"):
            try:
                faculty = await db.faculties.find_one({"_id": ObjectId(u["faculty_id"])})
                user_data["faculty_name"] = faculty["name"] if faculty else None
            except Exception:
                user_data["faculty_name"] = None
        
        dept_ids_to_fetch = u.get("department_ids") or []
        if not dept_ids_to_fetch and u.get("department_id"):
            dept_ids_to_fetch = [u.get("department_id")]
        
        if dept_ids_to_fetch and len(dept_ids_to_fetch) > 0:
            try:
                dept_names = []
                for did in dept_ids_to_fetch:
                    if did:
                        dept = await db.departments.find_one({"_id": ObjectId(did)})
                        if dept:
                            dept_names.append(dept["name"])
                user_data["department_name"] = " | ".join(dept_names) if dept_names else None
                user_data["department_names"] = dept_names
            except Exception as e:
                logger.error(f"Error fetching department names: {e}")
                user_data["department_name"] = None
                user_data["department_names"] = []
        else:
            user_data["department_name"] = None
            user_data["department_names"] = []
        
        result.append(user_data)
    
    return result


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    result = await db.users.delete_one({"_id": ObjectId(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    
    return {"message": "تم حذف المستخدم بنجاح"}


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: str, data: UserUpdate, current_user: dict = Depends(get_current_user)):
    db = get_db()
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    
    if user.get("role") == UserRole.ADMIN or user.get("username") == "admin":
        if data.role_id:
            raise HTTPException(status_code=403, detail="لا يمكن تغيير دور مدير النظام")
    
    update_data = {}
    if data.full_name:
        update_data["full_name"] = data.full_name
    if data.email:
        update_data["email"] = data.email
    if data.phone:
        update_data["phone"] = data.phone
    if data.password:
        update_data["password"] = get_password_hash(data.password)
    
    if data.university_id is not None:
        update_data["university_id"] = data.university_id if data.university_id else None
    if data.faculty_id is not None:
        update_data["faculty_id"] = data.faculty_id if data.faculty_id else None
    if data.department_id is not None:
        update_data["department_id"] = data.department_id if data.department_id else None
    
    if data.department_ids is not None:
        update_data["department_ids"] = data.department_ids if data.department_ids else []
        if data.department_ids and len(data.department_ids) > 0:
            update_data["department_id"] = data.department_ids[0]
        else:
            update_data["department_id"] = None
    
    if data.role_id and user.get("role") != UserRole.ADMIN:
        role = await db.roles.find_one({"_id": ObjectId(data.role_id)})
        if role:
            update_data["role_id"] = data.role_id
            update_data["role"] = role.get("system_key", "custom")
            update_data["permissions"] = role.get("permissions", [])
    
    if update_data:
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": update_data}
        )
    
    updated = await db.users.find_one({"_id": ObjectId(user_id)})
    
    user_permissions = updated.get("permissions", DEFAULT_PERMISSIONS.get(updated["role"], []))
    if updated["role"] == UserRole.ADMIN:
        user_permissions = list(DEFAULT_PERMISSIONS.get(UserRole.ADMIN, []))
    
    return {
        "id": str(updated["_id"]),
        "username": updated["username"],
        "full_name": updated["full_name"],
        "role": updated["role"],
        "role_id": updated.get("role_id"),
        "email": updated.get("email"),
        "phone": updated.get("phone"),
        "created_at": updated["created_at"],
        "is_active": updated.get("is_active", True),
        "permissions": user_permissions,
        "university_id": updated.get("university_id"),
        "faculty_id": updated.get("faculty_id"),
        "department_id": updated.get("department_id"),
        "department_ids": updated.get("department_ids", [])
    }


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    new_password: str = Body(..., embed=True),
    current_user: dict = Depends(get_current_user)
):
    """إعادة تعيين كلمة مرور المستخدم"""
    db = get_db()
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك بإعادة تعيين كلمة المرور")
    
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    
    hashed_password = pwd_context.hash(new_password)
    
    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"password": hashed_password, "updated_at": datetime.utcnow()}}
    )
    
    await log_activity(
        user=current_user,
        action="reset_password",
        entity_type="user",
        entity_id=user_id,
        entity_name=user.get('username')
    )
    
    return {"message": "تم إعادة تعيين كلمة المرور بنجاح"}


@router.post("/users/{user_id}/toggle-active")
async def toggle_user_active(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """تفعيل/إيقاف المستخدم"""
    db = get_db()
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك بتعديل حالة المستخدم")
    
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    
    if user.get("role") == "admin" and user.get("username") == "admin":
        raise HTTPException(status_code=400, detail="لا يمكن إيقاف حساب مدير النظام الرئيسي")
    
    new_status = not user.get("is_active", True)
    
    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"is_active": new_status, "updated_at": datetime.utcnow()}}
    )
    
    action = "activate_user" if new_status else "deactivate_user"
    await log_activity(
        user=current_user,
        action=action,
        entity_type="user",
        entity_id=user_id,
        entity_name=user.get('username')
    )
    
    return {"message": f"تم {'تفعيل' if new_status else 'إيقاف'} المستخدم بنجاح", "is_active": new_status}
