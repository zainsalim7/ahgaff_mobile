import ast

STATUS_LABELS_INLINE = '{"active": "مستمر", "repeat": "إعادة", "graduated": "متخرج", "expelled": "مفصول", "frozen": "مجمَّد"}'

# ===== 1) student_status.py: الإعادة حالة غير نشطة + تنظيف التسجيلات + إعادة التسجيل عند الاسترجاع =====
P = "/app/backend/backend/routes/student_status.py"
s = open(P, encoding="utf-8").read()

def rep(old, new):
    global s
    assert s.count(old) == 1, f"anchor ({s.count(old)}): {old[:60]!r}"
    s = s.replace(old, new)

rep('''# الحالات التي تجعل is_active=False
INACTIVE_STATUSES = {"graduated", "expelled", "frozen"}''',
'''# الحالات التي تجعل is_active=False (المعيد أيضاً يخرج من قوائم التحضير والتسجيل)
INACTIVE_STATUSES = {"graduated", "expelled", "frozen", "repeat"}''')

# تنظيف تسجيلات الفصل النشط عند الانتقال لحالة غير نشطة (يخرج من قوائم التحضير فوراً)
rep('''    await db.students.update_one({"_id": oid}, {"$set": update_data})

    if new_status == "active":
        await db.students.update_one({"_id": oid}, {"$unset": {"status_snapshot": ""}})''',
'''    await db.students.update_one({"_id": oid}, {"$set": update_data})

    # 🧹 عند الانتقال لحالة غير نشطة: إزالة تسجيلات الفصل النشط (يختفي من قوائم التحضير)
    # التاريخية (الفصول المغلقة) محفوظة — وعند الاسترجاع يُعاد التسجيل تلقائياً
    if new_status in INACTIVE_STATUSES:
        try:
            from .student_transfer import cleanup_active_enrollments
            await cleanup_active_enrollments(db, student_id)
        except Exception:
            pass

    if new_status == "active":
        await db.students.update_one({"_id": oid}, {"$unset": {"status_snapshot": ""}})
        # 🎓 عودة للنشاط عبر تغيير الحالة: إعادة التسجيل في مقررات موقعه الحالي
        try:
            from .deps import enroll_student_in_matching_courses
            fresh = await db.students.find_one({"_id": oid})
            if fresh:
                await enroll_student_in_matching_courses(db, fresh)
        except Exception:
            pass''')

# الاسترجاع: إعادة تسجيل تلقائي في مقررات المستوى/الشعبة الجديدة
rep('''    return {
        "success": True,
        "message": f"تم استرجاع الطالب '{student.get('full_name', '')}' إلى المستوى {payload.new_level} {payload.new_section or ''}",
        "student_id": student_id,
        "new_level": payload.new_level,
        "new_section": payload.new_section,
    }''',
'''    # 🎓 إعادة التسجيل التلقائي في مقررات الفصل النشط المطابقة لموقعه الجديد
    enrolled_count = 0
    try:
        from .deps import enroll_student_in_matching_courses
        fresh = await db.students.find_one({"_id": oid})
        if fresh:
            enrolled_count = await enroll_student_in_matching_courses(db, fresh)
    except Exception:
        pass

    return {
        "success": True,
        "message": f"تم استرجاع الطالب '{student.get('full_name', '')}' إلى المستوى {payload.new_level} {payload.new_section or ''}"
                   + (f" — وسُجّل تلقائياً في {enrolled_count} مقرر" if enrolled_count else ""),
        "student_id": student_id,
        "new_level": payload.new_level,
        "new_section": payload.new_section,
        "enrolled_courses": enrolled_count,
    }''')

ast.parse(s)
open(P, "w", encoding="utf-8").write(s)
print("student_status.py OK")

# ===== 2) auth.py: بوابة حالة الطالب عند الدخول =====
P = "/app/backend/backend/routes/auth.py"
s = open(P, encoding="utf-8").read()
old = '''    if not user.get("is_active", True):
        record_login_attempt(client_ip, False)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="الحساب غير مفعل"
        )'''
new = '''    if not user.get("is_active", True):
        # 🎓 حسابات الطلاب: الحالة هي مصدر الحقيقة — المعيد والمجمّد مسموح لهما بالدخول
        _student_status = None
        if user.get("role") == "student":
            _srec = await db.students.find_one({"user_id": str(user["_id"])}, {"status": 1})
            _student_status = (_srec or {}).get("status")
        if _student_status not in ("frozen", "repeat"):
            record_login_attempt(client_ip, False)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="الحساب غير مفعل"
            )

    # 🛑 بوابة حالة الطالب: المفصول والمتخرج يُمنعان من دخول التطبيق
    if user.get("role") == "student":
        _srec2 = await db.students.find_one({"user_id": str(user["_id"])}, {"status": 1})
        _st = (_srec2 or {}).get("status") or "active"
        if _st == "expelled":
            record_login_attempt(client_ip, False)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="لا يمكنك الدخول — تم فصلك من الجامعة. يرجى مراجعة شؤون الطلاب")
        if _st == "graduated":
            record_login_attempt(client_ip, False)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="لا يمكنك الدخول — لقد تخرجت من الجامعة، نبارك لك التخرج 🎓 لأي مستندات راجع شؤون الخريجين")'''
assert s.count(old) == 1
s = s.replace(old, new)
ast.parse(s)
open(P, "w", encoding="utf-8").write(s)
print("auth.py OK")

# ===== 3) models/students.py: status_label =====
P = "/app/backend/backend/models/students.py"
s = open(P, encoding="utf-8").read()
old = '''    # حقول حالة الطالب (active/repeat/graduated/expelled/frozen)
    status: Optional[str] = None'''
new = '''    # حقول حالة الطالب (active/repeat/graduated/expelled/frozen)
    status: Optional[str] = None
    status_label: Optional[str] = None'''
assert s.count(old) == 1
s = s.replace(old, new)
ast.parse(s)
open(P, "w", encoding="utf-8").write(s)
print("models/students.py OK")

# ===== 4) server.py: /students/me يرجع الحالة + ترحيل المعيدين عند الإقلاع =====
P = "/app/backend/backend/server.py"
s = open(P, encoding="utf-8").read()
old = '''        "qr_code": student["qr_code"],
        "created_at": student["created_at"],
        "is_active": student.get("is_active", True)
    }

@api_router.get("/students/me/courses")'''
new = '''        "qr_code": student["qr_code"],
        "created_at": student["created_at"],
        "is_active": student.get("is_active", True),
        "status": student.get("status") or "active",
        "status_label": ''' + STATUS_LABELS_INLINE + '''.get(student.get("status") or "active", "مستمر"),
        "status_reason": student.get("status_reason"),
        "status_changed_at": student.get("status_changed_at"),
    }

@api_router.get("/students/me/courses")'''
assert s.count(old) == 1
s = s.replace(old, new)

old = '''        from routes.weekly_schedule import _sync_course_shared_links'''
new = '''        # 🔄 ترحيل: المعيدون القدامى يصبحون غير نشطين (خارج قوائم التحضير) — idempotent
        await db.students.update_many({"status": "repeat", "is_active": True}, {"$set": {"is_active": False}})
        from routes.weekly_schedule import _sync_course_shared_links'''
assert s.count(old) == 1
s = s.replace(old, new)
ast.parse(s)
open(P, "w", encoding="utf-8").write(s)
print("server.py OK")

# ===== 5) student_cards.py: الحالة في حمولة البطاقة (لتطبيق الطالب) =====
P = "/app/backend/backend/routes/student_cards.py"
s = open(P, encoding="utf-8").read()
import re
m = re.search(r'def _card_payload\(', s)
assert m
# أضف الحالة داخل الحمولة — نبحث عن أول "payload = {" أو return داخل الدالة
old = '''    if s.get("is_alumni") or s.get("status") in ("expelled",):'''
assert s.count(old) == 1
# لا تغيير هنا — فقط تأكيد المنع القائم. نضيف الحالة للحمولة:
print("student_cards.py: سياسة البطاقة كما هي (المفصول/الخريج ممنوعان)")
