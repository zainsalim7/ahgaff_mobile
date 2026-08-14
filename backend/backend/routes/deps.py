"""
الدوال المشتركة والتبعيات المستخدمة في جميع الـ routes
Dependencies - يتم استخدامها عبر جميع ملفات الـ routes
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorDatabase
from jose import JWTError, jwt
from passlib.context import CryptContext
from bson import ObjectId
from datetime import datetime, timedelta
from typing import List, Optional
import os
import logging

from models.permissions import UserRole, DEFAULT_PERMISSIONS, FULL_PERMISSION_MAPPING

# Rate Limiting
import time as time_module

# contextvar مشترك مع middleware التسجيل التلقائي في server.py (منع ازدواج السجلات)
import contextvars
activity_log_ctx: "contextvars.ContextVar" = contextvars.ContextVar("activity_log_ctx", default=None)


def mark_manual_activity_logged():
    ctx = activity_log_ctx.get()
    if ctx is not None:
        ctx["manual"] = True


def build_course_student_query(course: dict) -> dict:
    """🔗 مطابقة الطلاب للمقرر: القسم/المستوى/الشعبة الأصلية + كل روابط المشاركة shared_links"""
    targets = [(course.get("department_id"), course.get("level"), (course.get("section") or "").strip())]
    for l in course.get("shared_links", []) or []:
        targets.append((l.get("department_id"), l.get("level"), (l.get("section") or "").strip()))
    ors = []
    for dep, lvl, sec in targets:
        q = {"department_id": dep, "level": lvl}
        if sec:
            q["section"] = {"$in": [sec, sec + " ", " " + sec]}
        ors.append(q)
    return {
        "$or": ors,
        "is_active": True,
        "is_alumni": {"$ne": True},
        "status": {"$ne": "graduated"},
    }

_login_attempts = {}
RATE_LIMIT_WINDOW = 300  # 5 دقائق
RATE_LIMIT_MAX_ATTEMPTS = 10

def check_rate_limit(ip: str) -> bool:
    now = time_module.time()
    if ip in _login_attempts:
        _login_attempts[ip] = [a for a in _login_attempts[ip] if now - a[0] < RATE_LIMIT_WINDOW]
        failed = [a for a in _login_attempts[ip] if not a[1]]
        if len(failed) >= RATE_LIMIT_MAX_ATTEMPTS:
            return False
    return True

def record_login_attempt(ip: str, success: bool):
    if ip not in _login_attempts:
        _login_attempts[ip] = []
    _login_attempts[ip].append((time_module.time(), success))

# Logging
logger = logging.getLogger(__name__)

# JWT Configuration
SECRET_KEY = os.environ.get('SECRET_KEY', 'ahgaff-university-secure-key-2026-x9f8k2m5n7p3q1w4')
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 ساعة بدلاً من 7 أيام

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Security
security = HTTPBearer()

# Database reference - will be set from main app
_db: Optional[AsyncIOMotorDatabase] = None

# Scope filter function reference - يُسجَّل من server.py عند الإقلاع
_scope_filter_fn = None


def set_database(database: AsyncIOMotorDatabase):
    """تعيين قاعدة البيانات من التطبيق الرئيسي"""
    global _db
    _db = database


def get_db() -> AsyncIOMotorDatabase:
    """الحصول على قاعدة البيانات"""
    if _db is None:
        raise RuntimeError("Database not initialized. Call set_database() first.")
    return _db


def set_scope_filter(fn):
    """تسجيل دالة فلتر النطاق (Faculty/Department scoping) من server.py"""
    global _scope_filter_fn
    _scope_filter_fn = fn


async def get_scope_filter(current_user: dict, scope_type: str) -> dict:
    """جلب فلتر النطاق للـ MongoDB حسب دور المستخدم وكليته/قسمه.
    يُرجع {} إذا لم تُسجَّل الدالة (لن يُطبَّق نطاق - يجب التسجيل عند startup).
    """
    if _scope_filter_fn is None:
        return {}
    try:
        return await _scope_filter_fn(current_user, scope_type)
    except Exception:
        return {}


# ترجمة أنواع الأنشطة إلى العربية
ACTION_TRANSLATIONS = {
    "move_schedule_slot": "نقل محاضرة في الجدول الأسبوعي",
    "swap_schedule_slots": "تبديل محاضرتين في الجدول الأسبوعي",
    "auto_place_unscheduled": "إدراج تلقائي للمقررات غير المدرجة",
    "generate_lectures_from_schedule": "توليد محاضرات من الجدول الأسبوعي",
    "auto_generate_schedule": "توليد الجدول الأسبوعي تلقائياً",
    "migrate_courses": "ترحيل مقررات لفصل جديد",
    "login": "تسجيل دخول",
    "logout": "تسجيل خروج",
    "password_change": "تغيير كلمة المرور",
    "view_page": "عرض صفحة",
    "view_report": "عرض تقرير",
    "create_user": "إنشاء مستخدم",
    "create_student": "إنشاء طالب",
    "create_course": "إنشاء مقرر",
    "create_department": "إنشاء قسم",
    "create_faculty": "إنشاء كلية",
    "create_lecture": "إنشاء محاضرة",
    "update_user": "تعديل مستخدم",
    "update_student": "تعديل طالب",
    "update_course": "تعديل مقرر",
    "update_department": "تعديل قسم",
    "update_faculty": "تعديل كلية",
    "update_lecture": "تعديل محاضرة",
    "delete_user": "حذف مستخدم",
    "delete_student": "حذف طالب",
    "delete_course": "حذف مقرر",
    "delete_department": "حذف قسم",
    "delete_faculty": "حذف كلية",
    "delete_lecture": "حذف محاضرة",
    "record_attendance": "تسجيل حضور",
    "update_attendance": "تعديل حضور",
    "export_data": "تصدير بيانات",
    "import_data": "استيراد بيانات",
    "create_role": "إنشاء دور",
    "update_role": "تعديل دور",
    "delete_role": "حذف دور",
    "enroll_students": "تسجيل طلاب في مقرر",
    "unenroll_students": "إلغاء تسجيل طلاب",
}


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """التحقق من صحة كلمة المرور"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """تشفير كلمة المرور"""
    password_bytes = password.encode('utf-8')[:72]
    return pwd_context.hash(password_bytes.decode('utf-8'))


def create_access_token(data: dict) -> str:
    """إنشاء JWT token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """الحصول على المستخدم الحالي من التوكن"""
    db = get_db()
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="بيانات الاعتماد غير صالحة",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if user is None:
        raise credentials_exception
    
    # Get user permissions from role or defaults
    user_permissions = []
    
    if user.get("role_id"):
        try:
            role_doc = await db.roles.find_one({"_id": ObjectId(user["role_id"])})
            if role_doc:
                user_permissions = list(role_doc.get("permissions", []))
        except Exception:
            pass
    
    if not user_permissions:
        user_role = user.get("role", "employee")
        role_doc = await db.roles.find_one({"system_key": user_role})
        if role_doc:
            user_permissions = list(role_doc.get("permissions", []))
        else:
            user_permissions = list(DEFAULT_PERMISSIONS.get(user_role, []))
    
    custom_permissions = user.get("custom_permissions", [])
    if custom_permissions:
        for perm in custom_permissions:
            if perm not in user_permissions:
                user_permissions.append(perm)
    
    return {
        "_id": user["_id"],
        "id": str(user["_id"]),
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
        "email": user.get("email"),
        "phone": user.get("phone"),
        "is_active": user.get("is_active", True),
        "permissions": user_permissions,
        "faculty_id": user.get("faculty_id"),
        "faculty_ids": user.get("faculty_ids") or (
            [user.get("faculty_id")] if user.get("faculty_id") else []
        ),
        "department_id": user.get("department_id"),
        "department_ids": user.get("department_ids") or (
            [user.get("department_id")] if user.get("department_id") else []
        ),
        "student_id": user.get("student_id"),
        "role_id": user.get("role_id"),
        "custom_permissions": user.get("custom_permissions", [])
    }


async def log_activity(
    user: dict,
    action: str,
    entity_type: str = None,
    entity_id: str = None,
    entity_name: str = None,
    details: dict = None,
    ip_address: str = None,
    user_agent: str = None
):
    """تسجيل نشاط المستخدم في قاعدة البيانات"""
    mark_manual_activity_logged()
    db = get_db()
    try:
        action_ar = ACTION_TRANSLATIONS.get(action, action)
        
        log_entry = {
            "user_id": str(user.get("_id", user.get("id", ""))),
            "username": user.get("username", "غير معروف"),
            "user_role": user.get("role", "غير محدد"),
            "action": action,
            "action_ar": action_ar,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "entity_name": entity_name,
            "details": details,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "faculty_id": user.get("faculty_id"),
            "department_id": user.get("department_id"),
            "timestamp": datetime.utcnow()
        }
        
        await db.activity_logs.insert_one(log_entry)
        logger.info(f"Activity logged: {action} by {user.get('username')}")
    except Exception as e:
        logger.error(f"Failed to log activity: {e}")


def get_user_permissions(user: dict) -> List[str]:
    """الحصول على صلاحيات المستخدم مع توسيع الصلاحيات الكاملة لتشمل الصلاحيات الفرعية"""
    base_permissions = user.get("permissions") or DEFAULT_PERMISSIONS.get(user["role"], [])
    expanded = set(base_permissions)
    for perm in base_permissions:
        if perm in FULL_PERMISSION_MAPPING:
            expanded.update(FULL_PERMISSION_MAPPING[perm])
    return list(expanded)


def has_permission(user: dict, permission: str) -> bool:
    """التحقق من أن المستخدم لديه صلاحية معينة (مع دعم الصلاحيات الكاملة)"""
    if user["role"] == UserRole.ADMIN:
        return True
    permissions = get_user_permissions(user)
    return permission in permissions


def has_any_permission(user: dict, perms: List[str]) -> bool:
    """التحقق من أن المستخدم لديه على الأقل واحدة من الصلاحيات"""
    if user["role"] == UserRole.ADMIN:
        return True
    permissions = get_user_permissions(user)
    return any(p in permissions for p in perms)


def require_permission(permission: str):
    """Decorator للتحقق من الصلاحيات"""
    async def permission_checker(current_user: dict = Depends(get_current_user)):
        if not has_permission(current_user, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"ليس لديك صلاحية: {permission}"
            )
        return current_user
    return permission_checker
