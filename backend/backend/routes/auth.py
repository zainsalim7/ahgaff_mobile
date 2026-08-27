"""
Auth Routes - مسارات المصادقة
"""
from fastapi import APIRouter, HTTPException, status, Depends, Request
from bson import ObjectId
from datetime import datetime

from models.users import UserLogin, UserResponse
from models.permissions import DEFAULT_PERMISSIONS, FULL_PERMISSION_MAPPING
from .deps import (
    get_db, get_current_user, verify_password, create_access_token,
    log_activity, security, check_rate_limit, record_login_attempt
)

router = APIRouter(tags=["المصادقة"])


@router.post("/auth/login")
async def login(user_data: UserLogin, request: Request):
    """تسجيل الدخول مع حماية Rate Limiting
    
    يسمح بالدخول بأي من:
    1. username (الافتراضي - عادةً رقم القيد للطلاب)
    2. reference_number (الرقم المرجعي للطلاب) - فريد دائماً
    3. student_id (رقم القيد) - إذا كان فريداً
    """
    db = get_db()
    
    # Rate Limiting - فحص عدد المحاولات (يفضّل CF-Connecting-IP خلف Cloudflare)
    client_ip = (
        request.headers.get("cf-connecting-ip")
        or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )
    
    if not check_rate_limit(client_ip):
        raise HTTPException(
            status_code=429,
            detail="تم تجاوز الحد الأقصى لمحاولات تسجيل الدخول. يرجى المحاولة بعد 5 دقائق"
        )
    
    # ========== البحث عن المستخدم بطرق متعددة ==========
    login_input = (user_data.username or "").strip()
    user = None
    
    # 1) البحث المباشر بـ username (السلوك الافتراضي)
    if login_input:
        user = await db.users.find_one({"username": login_input})
    
    # 2) إذا لم نجد، نبحث في الطلاب عبر reference_number أو student_id
    if not user and login_input:
        # ابحث في الطلاب عبر الرقم المرجعي (فريد دائماً)
        student = await db.students.find_one({"reference_number": login_input})
        
        # إذا لم نجد، ابحث عبر student_id
        if not student:
            matching_students = await db.students.find(
                {"student_id": login_input}
            ).to_list(10)
            
            if len(matching_students) > 1:
                # رقم القيد مكرر - رفض الدخول
                record_login_attempt(client_ip, False)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="رقم القيد مكرر لأكثر من طالب — يرجى استخدام الرقم المرجعي للدخول"
                )
            elif len(matching_students) == 1:
                student = matching_students[0]
        
        # إذا وجدنا طالباً، احصل على حساب المستخدم المرتبط به
        if student and student.get("user_id"):
            try:
                user = await db.users.find_one({"_id": ObjectId(student["user_id"])})
            except Exception:
                user = None
    
    password_field = user.get("hashed_password") or user.get("password") if user else None
    
    if not user or not password_field:
        record_login_attempt(client_ip, False)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="اسم المستخدم أو كلمة المرور غير صحيحة"
        )
    
    try:
        is_valid = verify_password(user_data.password, password_field)
    except Exception:
        is_valid = False
    
    if not is_valid:
        record_login_attempt(client_ip, False)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="اسم المستخدم أو كلمة المرور غير صحيحة"
        )
    
    if not user.get("is_active", True):
        record_login_attempt(client_ip, False)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="الحساب غير مفعل"
        )
    
    # منع المعلمين والطلاب من دخول الويب - لهم تطبيق خاص
    user_agent = request.headers.get("user-agent", "").lower()
    platform = request.headers.get("x-platform", "").lower()
    origin = request.headers.get("origin", "")
    referer = request.headers.get("referer", "")
    user_role = user.get("role", "")
    
    # المواقع المسموح بها للطلاب
    ALLOWED_STUDENT_WEB_ORIGINS = [
        "https://students.ahgaff.net",                          # ← الموقع الرسمي للطلاب
        "https://ahgaffstudent-web-production.up.railway.app",  # ← المؤقت على Railway
        "https://ahgaff-student-web.vercel.app",                # ← Vercel القديم
        "http://localhost:3000",                                # ← التطوير
        "http://localhost:8081",                                # ← التطوير (Expo web)
    ]
    
    is_allowed_web = (
        origin in ALLOWED_STUDENT_WEB_ORIGINS
        or any(referer.startswith(o) for o in ALLOWED_STUDENT_WEB_ORIGINS)
    )
    
    # نمنع فقط إذا كان الطلب من متصفح ويب وليس من المواقع المسموحة
    is_web_browser = any(b in user_agent for b in ["mozilla", "chrome", "safari", "firefox", "edge", "opera"]) and platform not in ["ios", "android", "mobile"]
    if user_role in ["teacher", "student"] and is_web_browser and not is_allowed_web:
        record_login_attempt(client_ip, False)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="هذا الحساب مخصص للتطبيق فقط. يرجى استخدام تطبيق الجوال أو زيارة students.ahgaff.net"
        )
    
    # تسجيل محاولة ناجحة
    record_login_attempt(client_ip, True)
    
    access_token = create_access_token(data={"sub": str(user["_id"])})
    
    # جلب صلاحيات الدور
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
    
    # توسيع الصلاحيات: manage_attendance → edit_attendance, record_attendance, إلخ
    expanded = set(user_permissions)
    for perm in user_permissions:
        if perm in FULL_PERMISSION_MAPPING:
            expanded.update(FULL_PERMISSION_MAPPING[perm])
    user_permissions = list(expanded)
    
    # تسجيل نشاط الدخول
    await log_activity(
        user=user,
        action="login",
        entity_type="user",
        entity_id=str(user["_id"]),
        entity_name=user["username"]
    )
    
    faculty_name = None
    department_name = None
    if user.get("faculty_id"):
        try:
            faculty = await db.faculties.find_one({"_id": ObjectId(user["faculty_id"])})
            if faculty:
                faculty_name = faculty.get("name")
        except Exception:
            pass
    if user.get("department_id"):
        try:
            department = await db.departments.find_one({"_id": ObjectId(user["department_id"])})
            if department:
                department_name = department.get("name")
        except Exception:
            pass

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": str(user["_id"]),
            "username": user["username"],
            "full_name": user["full_name"],
            "role": user["role"],
            "email": user.get("email"),
            "phone": user.get("phone"),
            "created_at": user["created_at"],
            "is_active": user.get("is_active", True),
            "permissions": user_permissions,
            "must_change_password": user.get("must_change_password", False),
            "student_id": user.get("student_id"),
            "faculty_id": user.get("faculty_id"),
            "department_id": user.get("department_id"),
            "faculty_ids": user.get("faculty_ids") or ([user.get("faculty_id")] if user.get("faculty_id") else []),
            "department_ids": user.get("department_ids") or ([user.get("department_id")] if user.get("department_id") else []),
            "faculty_name": faculty_name,
            "department_name": department_name
        }
    }


@router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    """الحصول على بيانات المستخدم الحالي"""
    db = get_db()
    user = await db.users.find_one({"_id": ObjectId(current_user["id"])})
    
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
    
    # توسيع الصلاحيات: manage_attendance → edit_attendance, record_attendance, إلخ
    expanded = set(user_permissions)
    for perm in user_permissions:
        if perm in FULL_PERMISSION_MAPPING:
            expanded.update(FULL_PERMISSION_MAPPING[perm])
    user_permissions = list(expanded)
    
    # جلب اسم الكلية والقسم
    faculty_name = None
    department_name = None
    if user.get("faculty_id"):
        try:
            faculty = await db.faculties.find_one({"_id": ObjectId(user["faculty_id"])})
            if faculty:
                faculty_name = faculty.get("name")
        except Exception:
            pass
    if user.get("department_id"):
        try:
            department = await db.departments.find_one({"_id": ObjectId(user["department_id"])})
            if department:
                department_name = department.get("name")
        except Exception:
            pass

    # دعم multi-department / multi-faculty (backward-compat مع المفرد)
    department_ids = user.get("department_ids") or (
        [user.get("department_id")] if user.get("department_id") else []
    )
    faculty_ids = user.get("faculty_ids") or (
        [user.get("faculty_id")] if user.get("faculty_id") else []
    )
    # أسماء الأقسام (لعرضها في الـ UI عند وجود multi-dept)
    department_names = []
    if department_ids:
        try:
            dept_object_ids = [ObjectId(d) for d in department_ids if d]
            dept_docs = await db.departments.find({"_id": {"$in": dept_object_ids}}).to_list(50)
            name_map = {str(d["_id"]): d.get("name") for d in dept_docs}
            department_names = [name_map.get(str(d)) for d in department_ids if name_map.get(str(d))]
        except Exception:
            pass

    return {
        "id": str(user["_id"]),
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
        "email": user.get("email"),
        "phone": user.get("phone"),
        "created_at": user["created_at"],
        "is_active": user.get("is_active", True),
        "permissions": user_permissions,
        "must_change_password": user.get("must_change_password", False),
        "student_id": user.get("student_id"),
        "faculty_id": user.get("faculty_id"),
        "department_id": user.get("department_id"),
        "faculty_ids": faculty_ids,
        "department_ids": department_ids,
        "faculty_name": faculty_name,
        "department_name": department_name,
        "department_names": department_names
    }
