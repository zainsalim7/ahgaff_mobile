import ast

# ===== deps.py: احترام الاستثناءات في التسجيل التلقائي =====
P = "/app/backend/backend/routes/deps.py"
s = open(P, encoding="utf-8").read()

def rep(old, new, path=None):
    global s
    assert s.count(old) == 1, f"anchor ({s.count(old)}): {old[:70]!r}"
    s = s.replace(old, new)

rep('''    sid = str(student["_id"])
    have = {e["course_id"] for e in await db.enrollments.find({"student_id": sid}, {"course_id": 1}).to_list(20000)}''',
'''    sid = str(student["_id"])
    excluded = set(student.get("excluded_course_ids") or [])
    have = {e["course_id"] for e in await db.enrollments.find({"student_id": sid}, {"course_id": 1}).to_list(20000)}''')

rep('''        cid = str(c["_id"])
        if cid in have:
            continue''',
'''        cid = str(c["_id"])
        if cid in have or cid in excluded:
            continue''')

ast.parse(s)
open(P, "w", encoding="utf-8").write(s)
print("deps.py OK")

# ===== server.py =====
P = "/app/backend/backend/server.py"
s = open(P, encoding="utf-8").read()

# 1) قائمة المستثناة في استجابة مقررات الطالب
rep('''    return {
        "student_id": student_id,
        "total_courses": len(result),
        "is_inferred": inferred,
        "courses": result,
    }''',
'''    # 🚫 المقررات المستثناة (غير المطالب بها)
    excluded_courses = []
    exc_ids = [x for x in (student.get("excluded_course_ids") or []) if x]
    if exc_ids:
        async for c in db.courses.find({"_id": {"$in": [ObjectId(x) for x in exc_ids]}}):
            excluded_courses.append({"id": str(c["_id"]), "name": c.get("name", ""), "code": c.get("code", ""),
                                     "level": c.get("level"), "section": c.get("section", "")})

    return {
        "student_id": student_id,
        "total_courses": len(result),
        "is_inferred": inferred,
        "courses": result,
        "excluded_courses": excluded_courses,
    }''')

# 2) نقطتا الاستثناء/إلغاء الاستثناء
rep('''@api_router.get("/students/{student_id}", response_model=StudentResponse)
async def get_student(student_id: str, current_user: dict = Depends(get_current_user)):''',
'''@api_router.post("/students/{student_id}/exclude-course/{course_id}")
async def exclude_student_from_course(student_id: str, course_id: str, current_user: dict = Depends(get_current_user)):
    """🚫 استثناء الطالب من مقرر غير مطالب به: فصل تسجيله ومنع إعادة تسجيله تلقائياً (مزامنة/تسجيل تلقائي)"""
    if current_user["role"] != UserRole.ADMIN and not has_permission(current_user, "manage_students") and not has_permission(current_user, "manage_enrollments"):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    student = await db.students.find_one({"_id": ObjectId(student_id)})
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    course = await db.courses.find_one({"_id": ObjectId(course_id)})
    if not course:
        raise HTTPException(status_code=404, detail="المقرر غير موجود")
    res = await db.enrollments.delete_many({"student_id": student_id, "course_id": course_id})
    await db.students.update_one({"_id": ObjectId(student_id)}, {"$addToSet": {"excluded_course_ids": course_id}})
    await log_activity(current_user, "exclude_course", "student", student_id, student.get("full_name", ""), {
        "course_id": course_id, "course_name": course.get("name", ""), "enrollments_removed": res.deleted_count,
    })
    return {
        "message": f"🚫 تم استثناء الطالب من مقرر '{course.get('name', '')}' — لن يُعاد تسجيله تلقائياً",
        "enrollments_removed": res.deleted_count,
    }


@api_router.delete("/students/{student_id}/exclude-course/{course_id}")
async def unexclude_student_from_course(student_id: str, course_id: str, current_user: dict = Depends(get_current_user)):
    """↩️ إلغاء استثناء الطالب من مقرر وإعادة تسجيله فيه"""
    if current_user["role"] != UserRole.ADMIN and not has_permission(current_user, "manage_students") and not has_permission(current_user, "manage_enrollments"):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    student = await db.students.find_one({"_id": ObjectId(student_id)})
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    course = await db.courses.find_one({"_id": ObjectId(course_id)})
    if not course:
        raise HTTPException(status_code=404, detail="المقرر غير موجود")
    await db.students.update_one({"_id": ObjectId(student_id)}, {"$pull": {"excluded_course_ids": course_id}})
    re_enrolled = False
    existing = await db.enrollments.find_one({"student_id": student_id, "course_id": course_id})
    if not existing:
        doc = {"course_id": course_id, "student_id": student_id,
               "enrolled_at": get_yemen_time(), "enrolled_by": current_user["id"]}
        if course.get("semester_id"):
            doc["semester_id"] = str(course["semester_id"])
        await db.enrollments.insert_one(doc)
        re_enrolled = True
    await log_activity(current_user, "unexclude_course", "student", student_id, student.get("full_name", ""), {
        "course_id": course_id, "course_name": course.get("name", ""), "re_enrolled": re_enrolled,
    })
    return {"message": f"↩️ أُلغي الاستثناء وأُعيد تسجيل الطالب في '{course.get('name', '')}'", "re_enrolled": re_enrolled}


@api_router.get("/students/{student_id}", response_model=StudentResponse)
async def get_student(student_id: str, current_user: dict = Depends(get_current_user)):''')

# 3) المزامنة تحترم الاستثناءات (وتزيل تسجيلات مستثناة إن وُجدت)
rep('''        should = {cid for cid, c in course_map.items() if matches(c, dep, lvl, sec)}
        enrs = await db.enrollments.find({"student_id": sid}).to_list(2000)''',
'''        should = {cid for cid, c in course_map.items() if matches(c, dep, lvl, sec)}
        # 🚫 استثناءات الطالب (مقررات غير مطالب بها)
        should -= set(st.get("excluded_course_ids") or [])
        enrs = await db.enrollments.find({"student_id": sid}).to_list(2000)''')

# 4) التسجيل التلقائي الجماعي يتخطى المستثنين
rep('''        cid = str(course["_id"])
        student_query = build_course_student_query(course)
        
        students = await db.students.find(student_query, {"_id": 1}).to_list(10000)''',
'''        cid = str(course["_id"])
        student_query = build_course_student_query(course)
        student_query["excluded_course_ids"] = {"$ne": cid}
        
        students = await db.students.find(student_query, {"_id": 1}).to_list(10000)''')

# 5) التسجيل اليدوي من صفحة المقرر يلغي الاستثناء
rep('''        await db.enrollments.insert_one(enrollment)
        enrolled_count += 1
    
    message = f"تم تسجيل {enrolled_count} طالب"''',
'''        await db.enrollments.insert_one(enrollment)
        # التسجيل اليدوي الصريح يلغي أي استثناء سابق من هذا المقرر
        if course_id in (student.get("excluded_course_ids") or []):
            await db.students.update_one({"_id": student["_id"]}, {"$pull": {"excluded_course_ids": course_id}})
        enrolled_count += 1
    
    message = f"تم تسجيل {enrolled_count} طالب"''')

ast.parse(s)
open(P, "w", encoding="utf-8").write(s)
print("server.py OK")
