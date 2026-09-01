"""إشعارات المعلمين عند تغييرات الجدول الأسبوعي (تعديل/نقل/حذف/إزاحة أوقات)"""
import logging
from datetime import datetime, timezone, timedelta
from bson import ObjectId


def _now_iso() -> str:
    return datetime.now(timezone(timedelta(hours=3))).isoformat()


async def _user_ids_for_teachers(db, teacher_ids) -> dict:
    """teacher_id -> user_id (فقط من لديهم حساب مستخدم)"""
    out = {}
    oids = []
    for t in {t for t in teacher_ids if t}:
        try:
            oids.append(ObjectId(t))
        except Exception:
            pass
    if not oids:
        return out
    async for t in db.teachers.find({"_id": {"$in": oids}}, {"user_id": 1}):
        if t.get("user_id"):
            out[str(t["_id"])] = t["user_id"]
    return out


async def _dispatch(db, events: list):
    """events: [{user_id, title, message, course_id?, course_name?}] — حفظ داخل التطبيق + FCM push"""
    try:
        seen = set()
        unique = []
        for e in events:
            key = (e.get("user_id"), e.get("message"))
            if not e.get("user_id") or key in seen:
                continue
            seen.add(key)
            unique.append(e)
        if not unique:
            return
        docs = [{
            "user_id": e["user_id"],
            "title": e["title"],
            "message": e["message"],
            "type": "reschedule",
            "course_id": e.get("course_id", ""),
            "course_name": e.get("course_name", ""),
            "is_read": False,
            "created_at": _now_iso(),
        } for e in unique]
        await db.notifications.insert_many(docs)

        # FCM: تجميع حسب نص الإشعار ثم إرسال لرموز مستخدميه
        from services.firebase_service import send_notification_to_many
        by_msg = {}
        for e in unique:
            by_msg.setdefault((e["title"], e["message"]), set()).add(e["user_id"])
        for (title, message), uids in by_msg.items():
            tokens_docs = await db.fcm_tokens.find({"user_id": {"$in": list(uids)}}).to_list(1000)
            tokens = [d["token"] for d in tokens_docs if d.get("token")]
            if tokens:
                await send_notification_to_many(tokens, title, message)
        logging.info(f"إشعارات تغيير الجدول: أُرسل {len(unique)} إشعاراً")
    except Exception as e:
        logging.error(f"خطأ في إرسال إشعارات تغيير الجدول: {e}")


async def notify_slot_teachers(db, slots: list, title: str, message: str):
    """إشعار مباشر لمعلمي خانات محددة (تعديل/نقل/حذف)"""
    try:
        tmap = await _user_ids_for_teachers(db, [s.get("teacher_id") for s in slots])
        course_id = (slots[0].get("course_id") or "") if slots else ""
        course_name = ""
        if course_id:
            try:
                c = await db.courses.find_one({"_id": ObjectId(course_id)}, {"name": 1})
                course_name = (c or {}).get("name", "")
            except Exception:
                pass
        events = [{"user_id": uid, "title": title, "message": message,
                   "course_id": course_id, "course_name": course_name}
                  for uid in set(tmap.values())]
        await _dispatch(db, events)
    except Exception as e:
        logging.error(f"خطأ في إشعار معلمي الخانة: {e}")


async def notify_time_shifts(db, changes: list, exclude_slot_ids: set = None, exclude_merge_group_ids: set = None):
    """إشعار المعلمين الذين تغيّر وقت بدء محاضراتهم فعلياً (إزاحة الدومينو أو عودة للوقت الرسمي)
    changes: [{slot, day, old_start, new_start, new_end}] من _resolve_day_times"""
    try:
        excl_ids = exclude_slot_ids or set()
        excl_mg = exclude_merge_group_ids or set()
        relevant = [c for c in changes
                    if str(c["slot"]["_id"]) not in excl_ids
                    and (c["slot"].get("merge_group_id") or "") not in excl_mg]
        if not relevant:
            return
        cids = {c["slot"].get("course_id", "") for c in relevant if c["slot"].get("course_id")}
        names = {}
        if cids:
            try:
                async for c in db.courses.find({"_id": {"$in": [ObjectId(x) for x in cids]}}, {"name": 1}):
                    names[str(c["_id"])] = c.get("name", "")
            except Exception:
                pass
        tmap = await _user_ids_for_teachers(db, [c["slot"].get("teacher_id") for c in relevant])
        events = []
        for c in relevant:
            s = c["slot"]
            uid = tmap.get(str(s.get("teacher_id") or ""))
            if not uid:
                continue
            cn = names.get(s.get("course_id", ""), "") or "محاضرتك"
            msg = (f"تغيّر وقت محاضرة «{cn}» يوم {c['day']}: "
                   f"تبدأ الساعة {c['new_start']} وتنتهي {c['new_end']} (بدلاً من {c['old_start']}).")
            events.append({"user_id": uid, "title": f"⏰ تغيّر وقت محاضرتك — {cn}",
                           "message": msg, "course_id": s.get("course_id", ""), "course_name": cn})
        await _dispatch(db, events)
    except Exception as e:
        logging.error(f"خطأ في إشعارات إزاحة الأوقات: {e}")
