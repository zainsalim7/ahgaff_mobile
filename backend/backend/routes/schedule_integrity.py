"""فحص وإصلاح تكامل الجدول الأسبوعي مع المقررات والإسنادات والقاعات."""
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from .deps import get_db, get_current_user, log_activity
from .weekly_schedule import can_manage_schedule

router = APIRouter()

ISSUE_LABELS = {
    "orphan_course": "خلايا بمقرر محذوف",
    "archived_course_relink": "خلايا بمقرر مؤرشف (تُعاد وصلها بمقرر الفصل النشط)",
    "archived_course_unmatched": "خلايا بمقرر مؤرشف بلا مكافئ في الفصل النشط",
    "inactive_course": "خلايا بمقرر غير نشط",
    "teacher_mismatch": "خلايا بأستاذ مختلف عن الإسناد الحالي",
    "group_mismatch": "خلايا بمستوى/شعبة لا تطابق المقرر",
    "orphan_room": "خلايا بقاعة محذوفة",
    "inactive_room": "خلايا بقاعة معطّلة",
}


async def _scan(db, faculty_id: str, department_id: Optional[str]):
    if department_id:
        dept_filter = {"department_id": department_id}
    else:
        depts = await db.departments.find({"faculty_id": faculty_id}, {"name": 1}).to_list(500)
        dept_filter = {"department_id": {"$in": [str(d["_id"]) for d in depts]}}
    slots = await db.weekly_schedule.find(dept_filter).to_list(20000)

    dept_names = {str(d["_id"]): d.get("name", "") for d in await db.departments.find({}, {"name": 1}).to_list(2000)}
    courses = {str(c["_id"]): c for c in await db.courses.find({}, {"name": 1, "teacher_id": 1, "level": 1, "section": 1, "is_active": 1}).to_list(50000)}
    teachers = {str(t["_id"]): t.get("full_name", "") for t in await db.teachers.find({}, {"full_name": 1}).to_list(5000)}
    rooms = {str(r["_id"]): r for r in await db.rooms.find({}, {"name": 1, "is_active": 1}).to_list(2000)}

    # 🛟 خطة إعادة الربط للمقررات المؤرشفة (بدل حذف الخلايا)
    from ._schedule_repair import relink_weekly_schedule_courses
    relink_plan = await relink_weekly_schedule_courses(db, dry_run=True)
    relink_mapping = relink_plan.get("mapping", {})
    arch_info = relink_plan.get("arch_info", {})
    active_course_names = {}
    if relink_mapping:
        for new_cid in set(relink_mapping.values()):
            c = courses.get(new_cid)
            if c:
                active_course_names[new_cid] = c.get("name", "")

    issues = []
    for s in slots:
        sid = str(s["_id"])
        loc = f"{dept_names.get(s.get('department_id', ''), '؟')} — م{s.get('level')}{' شعبة ' + s.get('section') if s.get('section') else ''} — {s.get('day')} فترة {s.get('slot_number')}"
        course = courses.get(s.get("course_id", ""))
        if not course:
            old_cid = s.get("course_id", "")
            arch = arch_info.get(old_cid)
            new_cid = relink_mapping.get(old_cid)
            if new_cid:
                issues.append({"slot_id": sid, "type": "archived_course_relink", "fixable": True,
                               "fix_action": "relink_course", "new_course_id": new_cid,
                               "desc": f"{loc}: المقرر '{(arch or {}).get('name', '؟')}' مؤرشف — ستُربط الخلية بمقرر الفصل النشط '{active_course_names.get(new_cid, '')}'"})
            elif arch:
                issues.append({"slot_id": sid, "type": "archived_course_unmatched", "fixable": False,
                               "desc": f"{loc}: المقرر '{arch.get('name', '؟')}' مؤرشف ولا يوجد مقرر مكافئ في الفصل النشط — رحّل المقررات للفصل الجديد (أداة ترحيل المقررات) ثم أعد الفحص"})
            else:
                issues.append({"slot_id": sid, "type": "orphan_course", "fixable": True, "fix_action": "delete_slot",
                               "desc": f"{loc}: الخلية تشير إلى مقرر محذوف من النظام (غير موجود حتى في الأرشيف) — ستُحذف الخلية"})
            continue
        cname = course.get("name", "")
        if course.get("is_active") is False:
            issues.append({"slot_id": sid, "type": "inactive_course", "fixable": False,
                           "desc": f"{loc}: المقرر '{cname}' غير نشط — فعّل المقرر أو احذف الخلية يدوياً"})

        c_tid = course.get("teacher_id") or ""
        s_tid = s.get("teacher_id") or ""
        if c_tid != s_tid:
            new_name = teachers.get(c_tid, "بدون أستاذ") if c_tid else "بدون أستاذ"
            old_name = teachers.get(s_tid, "أستاذ محذوف") if s_tid else "بدون أستاذ"
            issues.append({"slot_id": sid, "type": "teacher_mismatch", "fixable": True, "fix_action": "sync_teacher",
                           "new_teacher_id": c_tid,
                           "desc": f"{loc}: '{cname}' — أستاذ الخلية ({old_name}) ≠ الإسناد الحالي ({new_name}) — ستُحدَّث الخلية"})

        c_level = course.get("level") or 1
        c_sec = course.get("section") or ""
        if s.get("level") != c_level or (s.get("section") or "") != c_sec:
            issues.append({"slot_id": sid, "type": "group_mismatch", "fixable": True, "fix_action": "sync_group",
                           "new_level": c_level, "new_section": c_sec,
                           "desc": f"{loc}: '{cname}' — الصحيح حسب المقرر: م{c_level}{' شعبة ' + c_sec if c_sec else ''} — ستُنقل الخلية"})

        rid = s.get("room_id") or ""
        if rid:
            room = rooms.get(rid)
            if not room:
                issues.append({"slot_id": sid, "type": "orphan_room", "fixable": True, "fix_action": "clear_room",
                               "desc": f"{loc}: '{cname}' — القاعة المرتبطة حُذفت من النظام — ستُفرَّغ القاعة (عيّن بديلة لاحقاً)"})
            elif room.get("is_active") is False:
                issues.append({"slot_id": sid, "type": "inactive_room", "fixable": False,
                               "desc": f"{loc}: '{cname}' — القاعة '{room.get('name', '')}' معطّلة — عيّن قاعة بديلة يدوياً"})
    return slots, issues


def _summarize(slots, issues):
    summary = {}
    for it in issues:
        summary[it["type"]] = summary.get(it["type"], 0) + 1
    return {
        "total_slots": len(slots),
        "issues": issues,
        "summary": [{"type": t, "label": ISSUE_LABELS.get(t, t), "count": c} for t, c in summary.items()],
        "fixable_count": sum(1 for i in issues if i["fixable"]),
        "manual_count": sum(1 for i in issues if not i["fixable"]),
    }


@router.get("/weekly-schedule/integrity-check")
async def integrity_check(
    faculty_id: str = Query(...),
    department_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    slots, issues = await _scan(db, faculty_id, department_id)
    return _summarize(slots, issues)


@router.post("/weekly-schedule/integrity-fix")
async def integrity_fix(
    faculty_id: str = Query(...),
    department_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    _, issues = await _scan(db, faculty_id, department_id)

    fixed, failed = 0, []
    for it in issues:
        if not it["fixable"]:
            continue
        oid = ObjectId(it["slot_id"])
        try:
            if it["fix_action"] == "delete_slot":
                await db.weekly_schedule.delete_one({"_id": oid})
            elif it["fix_action"] == "relink_course":
                new_course = await db.courses.find_one({"_id": ObjectId(it["new_course_id"])}, {"teacher_id": 1})
                upd = {"course_id": it["new_course_id"]}
                if new_course and new_course.get("teacher_id"):
                    upd["teacher_id"] = new_course["teacher_id"]
                await db.weekly_schedule.update_one({"_id": oid}, {"$set": upd})
            elif it["fix_action"] == "sync_teacher":
                if it["new_teacher_id"]:
                    await db.weekly_schedule.update_one({"_id": oid}, {"$set": {"teacher_id": it["new_teacher_id"]}})
                else:
                    await db.weekly_schedule.update_one({"_id": oid}, {"$unset": {"teacher_id": ""}})
            elif it["fix_action"] == "sync_group":
                await db.weekly_schedule.update_one({"_id": oid}, {"$set": {"level": it["new_level"], "section": it["new_section"]}})
            elif it["fix_action"] == "clear_room":
                await db.weekly_schedule.update_one({"_id": oid}, {"$unset": {"room_id": ""}})
            fixed += 1
        except DuplicateKeyError:
            failed.append(f"{it['desc']} ⛔ تعذر الإصلاح تلقائياً: يسبب تعارضاً مع محاضرة قائمة — عالجه يدوياً")

    await log_activity(current_user, "schedule_integrity_fix", "weekly_schedule", faculty_id,
                       f"إصلاح تكامل الجدول ({fixed} إصلاح)", {"fixed": fixed, "failed": len(failed)})
    return {
        "fixed": fixed,
        "failed": failed,
        "message": f"✅ تم إصلاح {fixed} خلية تلقائياً" + (f" — {len(failed)} حالة تحتاج تدخلاً يدوياً" if failed else ""),
    }
