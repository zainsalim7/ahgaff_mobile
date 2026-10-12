"""🩹 إصلاحات محاضرات: استعادة محاضرات المجموعات المُلغاة خطأً كـ«مكررة»"""
from datetime import datetime, timedelta, timezone


def _now():
    return datetime.now(timezone(timedelta(hours=3)))


AUTO_DUPE_REASON = "أُلغيت تلقائياً: محاضرة مكررة (نفس المقرر والتاريخ والوقت)"


async def repair_group_dupe_cancellations(db, include_past: bool = False, dry_run: bool = False) -> dict:
    """🩹 إعادة محاضرات المجموعات التي أُلغيت خطأً كـ«مكررة» (قبل أن يراعي التنظيف حقل group).
    تُستعاد المحاضرة فقط إن لم توجد محاضرة نشطة أخرى بنفس (المقرر/التاريخ/الوقت/المجموعة)."""
    today = _now().strftime("%Y-%m-%d")
    q = {"status": "cancelled", "cancellation_reason": AUTO_DUPE_REASON, "group": {"$nin": [None, ""]}}
    if not include_past:
        q["date"] = {"$gte": today}
    active = ["scheduled", "completed", "absent", "absent_excused"]
    restored, kept, items = 0, 0, []
    async for lec in db.lectures.find(q):
        clash = await db.lectures.find_one({
            "_id": {"$ne": lec["_id"]}, "course_id": lec["course_id"], "date": lec["date"],
            "start_time": lec["start_time"], "group": lec["group"], "status": {"$in": active},
        }, {"_id": 1})
        if clash:
            kept += 1
            continue
        items.append({"id": str(lec["_id"]), "course_id": lec["course_id"], "date": lec["date"], "start_time": lec["start_time"], "group": lec["group"]})
        if not dry_run:
            await db.lectures.update_one({"_id": lec["_id"]}, {
                "$set": {"status": "scheduled", "restored_from_dupe_bug_at": _now()},
                "$unset": {"cancellation_reason": "", "cancelled_at": "", "cancelled_by": "", "cancelled_by_name": ""},
            })
        restored += 1
    return {"restored": restored, "kept_real_duplicates": kept, "dry_run": dry_run, "include_past": include_past, "items": items[:500]}
