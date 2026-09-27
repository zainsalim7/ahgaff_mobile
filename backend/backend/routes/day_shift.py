"""⏰ إزاحة اليوم الدراسي: تأخير بداية اليوم (يوم أو مدى) بإزاحة أفقية موحّدة لكل المحاضرات مع تراجع وإشعارات"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from bson import ObjectId

from .deps import get_db, get_current_user, has_permission, log_activity, build_course_student_query
from .schedule_notify import _dispatch, _user_ids_for_teachers

router = APIRouter(tags=["إزاحة اليوم الدراسي"])
PERM = "shift_day"
YEMEN_TZ = timezone(timedelta(hours=3))
SKIP_STATUSES = ("completed", "cancelled", "absent")


class DayShiftRequest(BaseModel):
    date_from: str
    date_to: Optional[str] = None
    faculty_id: Optional[str] = None
    new_start_time: Optional[str] = None  # "10:00" — تُحسب الإزاحة من أول محاضرة في كل يوم
    offset_minutes: Optional[int] = None  # بديل: إزاحة ثابتة بالدقائق
    reason: str = ""
    notify: bool = True


def _t2m(t: str) -> Optional[int]:
    try:
        h, m = t.split(":")[:2]
        return int(h) * 60 + int(m)
    except Exception:
        return None


def _m2t(m: int) -> str:
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def _dates(a: str, b: Optional[str]) -> list:
    try:
        d1 = datetime.strptime(a, "%Y-%m-%d").date()
        d2 = datetime.strptime(b or a, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="صيغة التاريخ غير صحيحة (YYYY-MM-DD)")
    if d2 < d1:
        raise HTTPException(status_code=400, detail="تاريخ النهاية قبل تاريخ البداية")
    if (d2 - d1).days > 60:
        raise HTTPException(status_code=400, detail="الحد الأقصى للمدى 60 يوماً")
    return [(d1 + timedelta(days=i)).isoformat() for i in range((d2 - d1).days + 1)]


async def _course_map(db, faculty_id: Optional[str]) -> dict:
    q: dict = {}
    if faculty_id:
        depts = [str(d["_id"]) for d in await db.departments.find({"faculty_id": faculty_id}, {"_id": 1}).to_list(500)]
        q["department_id"] = {"$in": depts}
    return {str(c["_id"]): c for c in await db.courses.find(q, {"name": 1, "teacher_id": 1, "department_id": 1, "level": 1, "section": 1, "shared_links": 1}).to_list(20000)}


def _is_movable(lec: dict) -> bool:
    return lec.get("status", "scheduled") not in SKIP_STATUSES and not lec.get("attendance_started_at")


FIXED_SLOT = 4          # الفترة الرابعة تبقى في مكانها
COMPRESSED_MIN = 60     # مدة المحاضرة المزاحة
BREAK_MIN = 10          # الاستراحة بين المحاضرات المزاحة
MIN_COMPRESSED = 45     # أقل مدة مقبولة للأخيرة إن ضاق الوقت قبل الرابعة


async def _faculty_of_courses(db, courses: dict) -> dict:
    """course_id → faculty_id عبر القسم"""
    dept_ids = list({c.get("department_id") for c in courses.values() if c.get("department_id")})
    d2f = {str(d["_id"]): d.get("faculty_id", "") for d in await db.departments.find({"_id": {"$in": [ObjectId(x) for x in dept_ids if ObjectId.is_valid(x)]}}, {"faculty_id": 1}).to_list(2000)}
    return {cid: d2f.get(c.get("department_id", ""), "") for cid, c in courses.items()}


def _slot_of(start: str, slots: dict) -> Optional[int]:
    """رقم الفترة لمحاضرة: مطابقة بداية الفترة، وإلا آخر فترة تبدأ قبلها"""
    st = _t2m(start)
    if st is None or not slots:
        return None
    best = None
    for sn, (s, _e) in sorted(slots.items()):
        sm = _t2m(s)
        if sm is None:
            continue
        if sm == st:
            return sn
        if sm <= st:
            best = sn
    return best if best is not None else min(slots)


async def _compute(db, data: DayShiftRequest):
    """القواعد: تُزاح الفترات الصباحية (قبل الرابعة) فقط وتتقلص إلى 60 د باستراحة 10 د،
    الرابعة تبقى، وما بعدها يُلغى. يعيد (الأيام، الإزاحات، الإلغاءات، المستثناة، التحذيرات)"""
    if not data.new_start_time and data.offset_minutes is None:
        raise HTTPException(status_code=400, detail="حدد وقت البداية الجديد أو مقدار الإزاحة")
    if data.new_start_time and _t2m(data.new_start_time) is None:
        raise HTTPException(status_code=400, detail="صيغة وقت البداية غير صحيحة (HH:MM)")
    from .weekly_schedule import _faculty_slot_times
    dates = _dates(data.date_from, data.date_to)
    courses = await _course_map(db, data.faculty_id)
    c2f = await _faculty_of_courses(db, courses)
    slot_cache: dict = {}

    async def slots_for(fid: str) -> dict:
        if fid not in slot_cache:
            slot_cache[fid] = await _faculty_slot_times(db, fid)
        return slot_cache[fid]

    lecs = await db.lectures.find({"date": {"$in": dates}, "course_id": {"$in": list(courses.keys())}}).to_list(50000)
    days, moves, cancels, skipped, warnings = [], [], [], [], []
    for d in dates:
        day_lecs = [l for l in lecs if l.get("date") == d]
        if not day_lecs:
            continue
        movable = [l for l in day_lecs if _is_movable(l) and _t2m(l.get("start_time", "")) is not None]
        skipped += [l for l in day_lecs if l not in movable]
        if not movable:
            days.append({"date": d, "lectures": 0, "cancelled": 0, "kept": 0, "skipped": len(day_lecs), "offset_minutes": 0})
            continue
        by_fac: dict = {}
        for l in movable:
            by_fac.setdefault(c2f.get(l["course_id"], ""), []).append(l)
        day_moves, day_cancels, day_kept, day_offset, first_old, first_new, last_end_old, last_end_new = 0, 0, 0, 0, None, None, 0, 0
        for fid, fl in by_fac.items():
            slots = await slots_for(fid)
            fixed_start = _t2m(slots.get(FIXED_SLOT, ("", ""))[0]) if slots.get(FIXED_SLOT) else None
            morning, late = {}, []
            for l in fl:
                sn = _slot_of(l["start_time"], slots)
                if sn is None or sn < FIXED_SLOT:
                    morning.setdefault(sn if sn is not None else 0, []).append(l)
                elif sn == FIXED_SLOT:
                    day_kept += 1
                else:
                    late.append(l)
            for l in late:
                cancels.append({"lec": l, "course": courses.get(l["course_id"], {}), "date": d})
            day_cancels += len(late)
            if not morning:
                continue
            first = min(_t2m(l["start_time"]) for grp in morning.values() for l in grp)
            new_start = _t2m(data.new_start_time) if data.new_start_time else first + (data.offset_minutes or 0)
            if new_start <= first and data.new_start_time:
                warnings.append(f"يوم {d}: وقت البداية الجديد لا يتأخر عن بداية اليوم الفعلية ({_m2t(first)}) — لن تُزاح محاضرات الصباح")
                continue
            order = sorted(morning)  # الفترات الصباحية الموجودة فعلاً، متتابعة بعد الإزاحة
            for i, sn in enumerate(order):
                n_st = new_start + i * (COMPRESSED_MIN + BREAK_MIN)
                dur = COMPRESSED_MIN
                if fixed_start is not None and n_st + dur > fixed_start:
                    dur = fixed_start - n_st
                    if dur < MIN_COMPRESSED:
                        raise HTTPException(status_code=400, detail=f"يوم {d}: لا تتسع الفترات الصباحية قبل الرابعة ({_m2t(fixed_start)}) بهذا الوقت — اختر بداية أبكر")
                    warnings.append(f"يوم {d}: قُلِّصت الفترة الصباحية الأخيرة إلى {dur} دقيقة لتنتهي قبل الرابعة ({_m2t(fixed_start)})")
                n_en = n_st + dur
                if n_en >= 24 * 60:
                    raise HTTPException(status_code=400, detail=f"الإزاحة تُخرج محاضرات يوم {d} خارج حدود اليوم")
                for l in morning[sn]:
                    st, en = _t2m(l["start_time"]), _t2m(l.get("end_time", "")) or (_t2m(l["start_time"]) + 90)
                    moves.append({"lec": l, "course": courses.get(l["course_id"], {}), "date": d, "old_st": l["start_time"], "old_en": l.get("end_time", ""),
                                  "new_st": _m2t(n_st), "new_en": _m2t(n_en), "credited_minutes": max(en - st, 0), "slot": sn})
                    day_moves += 1
                    last_end_old = max(last_end_old, en)
                last_end_new = max(last_end_new, n_en)
            if first_old is None or first < first_old:
                first_old, first_new, day_offset = first, new_start, new_start - first
        days.append({"date": d, "lectures": day_moves, "cancelled": day_cancels, "kept": day_kept, "skipped": len(day_lecs) - len(movable), "offset_minutes": day_offset,
                     "old_first": _m2t(first_old) if first_old is not None else "", "new_first": _m2t(first_new) if first_new is not None else "",
                     "old_last_end": _m2t(last_end_old) if last_end_old else "", "new_last_end": _m2t(last_end_new) if last_end_new else ""})
    return days, moves, cancels, skipped, warnings


def _fmt_offset(m: int) -> str:
    sign = "تأخير" if m > 0 else "تقديم"
    m = abs(m)
    h, r = divmod(m, 60)
    parts = ([f"{h} ساعة" if h == 1 else f"{h} ساعات" if h <= 10 else f"{h} ساعة"] if h else []) + ([f"{r} دقيقة"] if r else [])
    return f"{sign} " + " و".join(parts)


def _guard(user: dict):
    if not has_permission(user, PERM):
        raise HTTPException(status_code=403, detail="ليست لديك صلاحية «إزاحة اليوم الدراسي»")


@router.post("/day-shift/preview")
async def preview_day_shift(data: DayShiftRequest, current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    db = get_db()
    days, moves, cancels, skipped, warnings = await _compute(db, data)
    fac = None
    if data.faculty_id and ObjectId.is_valid(data.faculty_id):
        fac = await db.faculties.find_one({"_id": ObjectId(data.faculty_id)}, {"name": 1})
    sample = sorted(moves, key=lambda m: (m["date"], m["old_st"]))[:8]
    return {
        "days": days,
        "total_lectures": len(moves),
        "total_cancelled": len(cancels),
        "total_kept": sum(d.get("kept", 0) for d in days),
        "total_skipped": len(skipped),
        "rules": {"fixed_slot": FIXED_SLOT, "compressed_minutes": COMPRESSED_MIN, "break_minutes": BREAK_MIN},
        "warnings": warnings,
        "skipped_reasons": {
            "completed": sum(1 for l in skipped if l.get("status") == "completed"),
            "cancelled": sum(1 for l in skipped if l.get("status") in ("cancelled", "absent")),
            "attendance_started": sum(1 for l in skipped if l.get("attendance_started_at") and l.get("status") not in SKIP_STATUSES),
        },
        "teachers_affected": len({m["course"].get("teacher_id") for m in moves + cancels if m["course"].get("teacher_id")}),
        "faculty_name": (fac or {}).get("name") if fac else "جميع الكليات",
        "sample": [{"date": m["date"], "course": m["course"].get("name", ""), "from": f"{m['old_st']} - {m['old_en']}", "to": f"{m['new_st']} - {m['new_en']}"} for m in sample],
        "cancelled_sample": [{"date": c["date"], "course": c["course"].get("name", ""), "time": f"{c['lec'].get('start_time', '')} - {c['lec'].get('end_time', '')}"} for c in sorted(cancels, key=lambda c: (c["date"], c["lec"].get("start_time", "")))[:8]],
    }


@router.post("/day-shift/apply")
async def apply_day_shift(data: DayShiftRequest, current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    db = get_db()
    days, moves, cancels, skipped, warnings = await _compute(db, data)
    if not moves and not cancels:
        raise HTTPException(status_code=400, detail="لا توجد محاضرات قابلة للإزاحة في هذا النطاق")
    now = datetime.now(YEMEN_TZ)
    shift_id = ObjectId()
    changes = []
    for m in moves:
        lec = m["lec"]
        try:
            await db.lectures.update_one({"_id": lec["_id"]}, {"$set": {
                "start_time": m["new_st"], "end_time": m["new_en"], "credited_minutes": m["credited_minutes"],
                "time_locked": True, "time_locked_at": now, "time_locked_by_name": current_user.get("full_name", ""),
                "day_shift_id": str(shift_id), "day_shift_offset": _t2m(m["new_st"]) - _t2m(m["old_st"]),
            }})
            changes.append({"kind": "move", "lecture_id": str(lec["_id"]), "course_id": lec["course_id"], "date": m["date"], "old_start": m["old_st"], "old_end": m["old_en"], "new_start": m["new_st"], "new_end": m["new_en"], "was_locked": bool(lec.get("time_locked"))})
        except Exception:
            continue
    reason_txt = f"إلغاء ما بعد الفترة الرابعة بسبب إزاحة اليوم الدراسي{(' — ' + data.reason.strip()) if data.reason.strip() else ''}"
    for c in cancels:
        lec = c["lec"]
        try:
            await db.lectures.update_one({"_id": lec["_id"]}, {"$set": {
                "status": "cancelled", "cancel_reason": reason_txt, "cancelled_at": now.isoformat(), "cancelled_by_name": current_user.get("full_name", ""),
                "day_shift_id": str(shift_id), "day_shift_cancelled": True,
            }})
            changes.append({"kind": "cancel", "lecture_id": str(lec["_id"]), "course_id": lec["course_id"], "date": c["date"], "old_status": lec.get("status", "scheduled"), "old_start": lec.get("start_time", ""), "old_end": lec.get("end_time", "")})
        except Exception:
            continue
    n_moved = sum(1 for ch in changes if ch["kind"] == "move")
    n_cancel = sum(1 for ch in changes if ch["kind"] == "cancel")
    doc = {
        "_id": shift_id, "date_from": data.date_from, "date_to": data.date_to or data.date_from,
        "faculty_id": data.faculty_id, "new_start_time": data.new_start_time, "offset_minutes": data.offset_minutes,
        "reason": data.reason.strip(), "days": days, "changes": changes, "skipped": len(skipped), "cancelled": n_cancel, "warnings": warnings,
        "rules": {"fixed_slot": FIXED_SLOT, "compressed_minutes": COMPRESSED_MIN, "break_minutes": BREAK_MIN},
        "created_at": now.isoformat(), "created_by": current_user.get("id") or str(current_user.get("_id", "")), "created_by_name": current_user.get("full_name", ""),
        "status": "active", "notified": 0,
    }
    await db.day_shifts.insert_one(doc)
    await log_activity(current_user, "day_shift_apply", "day_shift", str(shift_id), f"{data.date_from} → {data.date_to or data.date_from}", {"lectures": n_moved, "cancelled": n_cancel, "reason": data.reason})

    notified = 0
    if data.notify:
        notified = await _notify(db, moves, cancels, days, data.reason)
        await db.day_shifts.update_one({"_id": shift_id}, {"$set": {"notified": notified}})
    day_desc = data.date_from if not data.date_to or data.date_to == data.date_from else f"من {data.date_from} إلى {data.date_to}"
    return {"id": str(shift_id), "updated": n_moved, "cancelled": n_cancel, "skipped": len(skipped), "notified": notified, "days": days, "warnings": warnings,
            "message": f"تمت إزاحة {n_moved} محاضرة صباحية ({day_desc})" + (f" وإلغاء {n_cancel} محاضرة بعد الرابعة" if n_cancel else "") + (f" — استُثنيت {len(skipped)} محاضرة منعقدة/ملغاة/مفتوحة التحضير" if skipped else "")}


async def _notify(db, moves: list, cancels: list, days: list, reason: str) -> int:
    """إشعار داخل التطبيق + Push لكل أستاذ وطالب متأثر (رسالة واحدة لكل شخص لكل يوم) — بالمواعيد الجديدة والملغاة"""
    offsets = {d["date"]: d for d in days}
    allm = moves + [{**c, "cancelled": True} for c in cancels]
    teacher_ids = {m["course"].get("teacher_id") for m in allm if m["course"].get("teacher_id")}
    t_users = await _user_ids_for_teachers(db, teacher_ids)
    events, per_user_day = [], {}

    def add(uid: str, m: dict):
        key = (uid, m["date"])
        per_user_day.setdefault(key, []).append(m)

    student_cache: dict = {}
    for m in allm:
        tid = m["course"].get("teacher_id")
        if tid and t_users.get(tid):
            add(t_users[tid], m)
        cid = m["lec"]["course_id"]
        if cid not in student_cache:
            uids = []
            if m["course"]:
                async for s in db.students.find(build_course_student_query(m["course"]), {"user_id": 1}):
                    if s.get("user_id"):
                        uids.append(s["user_id"])
            student_cache[cid] = uids
        for uid in student_cache[cid]:
            add(uid, m)

    for (uid, date), ms in per_user_day.items():
        d = offsets.get(date, {})
        moved = sorted([x for x in ms if not x.get("cancelled")], key=lambda x: x["new_st"])
        canc = [x for x in ms if x.get("cancelled")]
        parts = []
        if moved:
            parts.append("محاضراتك: " + "، ".join(f"{x['course'].get('name', '')} {x['new_st']}–{x['new_en']}" for x in moved[:4]) + (" …" if len(moved) > 4 else ""))
        if canc:
            parts.append("ملغاة (بعد الرابعة): " + "، ".join(x["course"].get("name", "") for x in canc[:3]) + (" …" if len(canc) > 3 else ""))
        head = (f"{_fmt_offset(d.get('offset_minutes', 0))} لبداية اليوم الدراسي يوم {date} إلى {d.get('new_first', '')} (المحاضرات الصباحية 60 دقيقة)" if d.get("offset_minutes") else f"تغيير في محاضرات يوم {date}") + (f" ({reason})" if reason else "")
        msg = head + ". " + " · ".join(parts)
        events.append({"user_id": uid, "title": "⏰ تغيير مواعيد اليوم الدراسي", "message": msg, "course_id": ms[0]["lec"]["course_id"], "course_name": ms[0]["course"].get("name", "")})
    await _dispatch(db, events)
    return len(events)


@router.get("/day-shift")
async def list_day_shifts(date: Optional[str] = None, status: Optional[str] = "active", limit: int = 50, current_user: dict = Depends(get_current_user)):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    if date:
        q["date_from"] = {"$lte": date}
        q["date_to"] = {"$gte": date}
    out = []
    async for s in db.day_shifts.find(q, {"changes": 0}).sort("created_at", -1).limit(limit):
        s["id"] = str(s.pop("_id"))
        out.append(s)
    return out


@router.get("/day-shift/my-today")
async def my_day_shift(date: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """📱 للطالب/المعلم: هل يومه مُزاح؟ (شعار في التطبيقات) — يُعيد الإزاحة ومحاضراته الجديدة فقط إن كانت محاضراته هو متأثرة"""
    db = get_db()
    day = date or datetime.now(YEMEN_TZ).strftime("%Y-%m-%d")
    shifts = await db.day_shifts.find({"status": "active", "date_from": {"$lte": day}, "date_to": {"$gte": day}}, {"changes": 0}).to_list(50)
    if not shifts:
        return {"shifted": False, "date": day}
    shift_ids = [str(s["_id"]) for s in shifts]
    lecs = await db.lectures.find({"date": day, "day_shift_id": {"$in": shift_ids}, "$or": [{"status": {"$nin": ["cancelled"]}}, {"day_shift_cancelled": True}]}).sort("start_time", 1).to_list(2000)
    if not lecs:
        return {"shifted": False, "date": day}
    courses = {str(c["_id"]): c for c in await db.courses.find({"_id": {"$in": [ObjectId(l["course_id"]) for l in lecs if ObjectId.is_valid(l["course_id"])]}}).to_list(2000)}

    role = current_user.get("role")
    mine: list = []
    if role == "teacher":
        u = await db.users.find_one({"_id": ObjectId(current_user["id"])}, {"teacher_record_id": 1})
        tids = {current_user["id"], (u or {}).get("teacher_record_id")}
        mine = [l for l in lecs if courses.get(l["course_id"], {}).get("teacher_id") in tids]
    elif role == "student":
        st = await db.students.find_one({"user_id": current_user["id"]}, {"_id": 1})
        if st:
            ok_courses: dict = {}
            for l in lecs:
                cid = l["course_id"]
                if cid not in ok_courses:
                    c = courses.get(cid)
                    ok_courses[cid] = bool(c) and await db.students.find_one({**build_course_student_query(c), "_id": st["_id"]}, {"_id": 1}) is not None
                if ok_courses[cid]:
                    mine.append(l)
    else:
        mine = lecs
    if not mine:
        return {"shifted": False, "date": day}

    sh = next((s for s in shifts if str(s["_id"]) == mine[0].get("day_shift_id")), shifts[0])
    d = next((x for x in sh.get("days", []) if x.get("date") == day), {})
    offset = mine[0].get("day_shift_offset") or d.get("offset_minutes") or 0
    return {
        "shifted": True, "date": day, "offset_minutes": offset, "offset_label": _fmt_offset(offset),
        "old_first": d.get("old_first"), "new_first": d.get("new_first"), "new_last_end": d.get("new_last_end"),
        "reason": sh.get("reason", ""), "shift_id": str(sh["_id"]),
        "rules": sh.get("rules"),
        "my_lectures": [{
            "id": str(l["_id"]), "course_id": l["course_id"], "course_name": courses.get(l["course_id"], {}).get("name", ""),
            "start_time": l.get("start_time"), "end_time": l.get("end_time"),
            "original_start_time": _m2t(_t2m(l["start_time"]) - (l.get("day_shift_offset") or 0)) if _t2m(l.get("start_time", "")) is not None and not l.get("day_shift_cancelled") else l.get("start_time"),
            "room": l.get("room", ""), "cancelled": bool(l.get("day_shift_cancelled")), "compressed": bool(l.get("credited_minutes")),
        } for l in mine if not l.get("day_shift_cancelled")] + [{
            "id": str(l["_id"]), "course_id": l["course_id"], "course_name": courses.get(l["course_id"], {}).get("name", ""),
            "start_time": l.get("start_time"), "end_time": l.get("end_time"), "original_start_time": l.get("start_time"), "room": l.get("room", ""), "cancelled": True, "compressed": False,
        } for l in mine if l.get("day_shift_cancelled")],
        "my_cancelled": sum(1 for l in mine if l.get("day_shift_cancelled")),
    }


@router.post("/day-shift/{shift_id}/revert")
async def revert_day_shift(shift_id: str, current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    db = get_db()
    if not ObjectId.is_valid(shift_id):
        raise HTTPException(status_code=400, detail="معرّف غير صحيح")
    s = await db.day_shifts.find_one({"_id": ObjectId(shift_id)})
    if not s:
        raise HTTPException(status_code=404, detail="سجل الإزاحة غير موجود")
    if s.get("status") != "active":
        raise HTTPException(status_code=400, detail="تم التراجع عن هذه الإزاحة مسبقاً")
    reverted, kept = 0, 0
    for ch in s.get("changes", []):
        lec = await db.lectures.find_one({"_id": ObjectId(ch["lecture_id"])})
        if not lec or lec.get("day_shift_id") != shift_id:
            kept += 1
            continue
        if ch.get("kind") == "cancel":
            if lec.get("status") != "cancelled" or not lec.get("day_shift_cancelled"):
                kept += 1
                continue
            upd = {"$set": {"status": ch.get("old_status", "scheduled")}, "$unset": {"cancel_reason": "", "cancelled_at": "", "cancelled_by_name": "", "day_shift_id": "", "day_shift_cancelled": ""}}
        else:
            if lec.get("start_time") != ch["new_start"] or lec.get("attendance_started_at") or lec.get("status") in SKIP_STATUSES:
                kept += 1
                continue
            upd = {"$set": {"start_time": ch["old_start"], "end_time": ch["old_end"]}, "$unset": {"day_shift_id": "", "day_shift_offset": "", "credited_minutes": ""}}
            if not ch.get("was_locked"):
                upd["$unset"].update({"time_locked": "", "time_locked_at": "", "time_locked_by_name": ""})
        try:
            await db.lectures.update_one({"_id": lec["_id"]}, upd)
            reverted += 1
        except Exception:
            kept += 1
    await db.day_shifts.update_one({"_id": ObjectId(shift_id)}, {"$set": {"status": "reverted", "reverted_at": datetime.now(YEMEN_TZ).isoformat(), "reverted_by_name": current_user.get("full_name", ""), "reverted_count": reverted}})
    await log_activity(current_user, "day_shift_revert", "day_shift", shift_id, s.get("date_from", ""), {"reverted": reverted, "kept": kept})
    return {"reverted": reverted, "kept": kept, "message": f"تم التراجع: أُعيدت {reverted} محاضرة إلى أوقاتها/حالتها الأصلية" + (f" (بقيت {kept} لأنها انعقدت أو عُدّلت لاحقاً)" if kept else "")}
