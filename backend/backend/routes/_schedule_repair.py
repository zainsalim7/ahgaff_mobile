"""إصلاح الجدول الأسبوعي بعد أرشفة الفصول.

الأرشفة تحذف مقررات الفصل من `courses`، فتبقى خلايا `weekly_schedule` تشير
لمقررات غير موجودة (تختفي أسماء المقررات من العرض الشامل والجدول).

هذا الملف يوفر:
- archived_courses_info: جلب بيانات المقررات المحذوفة من snapshots الأرشيف (للعرض).
- relink_weekly_schedule_courses: إعادة ربط الخلايا بالمقرر المكافئ في الفصل النشط.
"""
from bson import ObjectId


async def archived_courses_info(db, missing_ids: set) -> dict:
    """يرجع {course_id: {name, code, level, section, department_id, teacher_id}}
    من snapshots الأرشيف للمقررات المحذوفة."""
    info: dict = {}
    if not missing_ids:
        return info
    async for arch in db.semester_archives.find({}, {"courses": 1}):
        for c in arch.get("courses", []) or []:
            cid = c.get("id")
            if cid in missing_ids and cid not in info:
                info[cid] = c
    return info


async def relink_weekly_schedule_courses(db, dry_run: bool = False) -> dict:
    """يعيد ربط خلايا الجدول التي تشير لمقررات محذوفة (مؤرشفة)
    بالمقرر المكافئ في الفصل النشط (مطابقة: الكود أو الاسم + الشعبة + القسم).

    Returns: {missing, mapped_courses, relinked, mapping, unmatched, arch_info}
    """
    slots = await db.weekly_schedule.find({}, {"course_id": 1}).to_list(20000)
    slot_cids = {s.get("course_id") for s in slots if s.get("course_id")}
    existing = set()
    valid_oids = [ObjectId(x) for x in slot_cids if x and ObjectId.is_valid(x)]
    if valid_oids:
        async for c in db.courses.find({"_id": {"$in": valid_oids}}, {"_id": 1}):
            existing.add(str(c["_id"]))
    missing = slot_cids - existing
    if not missing:
        return {"missing": 0, "mapped_courses": 0, "relinked": 0,
                "mapping": {}, "unmatched": [], "arch_info": {}}

    arch_info = await archived_courses_info(db, missing)

    # فهرسة مقررات الفصل النشط
    active_sem = await db.semesters.find_one({"$or": [{"status": "active"}, {"is_active": True}]})
    idx: dict = {}
    if active_sem:
        async for c in db.courses.find({"semester_id": str(active_sem["_id"]), "is_active": True}):
            cid = str(c["_id"])
            code = (c.get("code") or "").strip()
            name = (c.get("name") or "").strip()
            sec = (c.get("section") or "").strip()
            dep = str(c.get("department_id") or "")
            if code:
                idx.setdefault(("code", code, sec, dep), cid)
            if name:
                idx.setdefault(("name", name, sec, dep), cid)

    mapping: dict = {}
    unmatched = []
    for old_cid in missing:
        info = arch_info.get(old_cid)
        new_cid = None
        if info:
            code = (info.get("code") or "").strip()
            name = (info.get("name") or "").strip()
            sec = (info.get("section") or "").strip()
            dep = str(info.get("department_id") or "")
            if code:
                new_cid = idx.get(("code", code, sec, dep))
            if not new_cid and name:
                new_cid = idx.get(("name", name, sec, dep))
        if new_cid:
            mapping[old_cid] = new_cid
        else:
            unmatched.append({
                "course_id": old_cid,
                "course_name": (info or {}).get("name", "غير معروف"),
                "code": (info or {}).get("code", ""),
                "section": (info or {}).get("section", ""),
                "in_archive": bool(info),
            })

    relinked = 0
    if dry_run:
        for old_cid in mapping:
            relinked += sum(1 for s in slots if s.get("course_id") == old_cid)
    else:
        for old_cid, new_cid in mapping.items():
            new_course = await db.courses.find_one({"_id": ObjectId(new_cid)}, {"teacher_id": 1})
            upd = {"course_id": new_cid}
            if new_course and new_course.get("teacher_id"):
                upd["teacher_id"] = new_course["teacher_id"]
            res = await db.weekly_schedule.update_many({"course_id": old_cid}, {"$set": upd})
            relinked += res.modified_count

    return {"missing": len(missing), "mapped_courses": len(mapping), "relinked": relinked,
            "mapping": mapping, "unmatched": unmatched, "arch_info": arch_info}
