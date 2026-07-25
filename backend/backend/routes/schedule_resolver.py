"""
🧩 الحلحلة الذكية: إدراج المقررات المتعثرة بنقل محاضرات قائمة (ضمن نفس القسم فقط)
معاينة إلزامية ثم تنفيذ الخطة المعتمدة. حد أقصى نقلتين متسلسلتين لكل إدراج.
"""
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from .deps import get_db, get_current_user, log_activity
from .weekly_schedule import can_manage_schedule, _is_period_unavailable, _build_master_data, _sync_future_lectures, _sync_summary

router = APIRouter(tags=["الحلحلة الذكية"])


class _State:
    """حالة الجدول في الذاكرة: من يشغل كل خلية (شعبة/معلم/قاعة) + عدادات يومية"""

    def __init__(self):
        self.section_owner = {}   # (dept, level, section, day, sn) -> slot_key
        self.teacher_owner = {}   # (tid, day, sn) -> slot_key
        self.room_owner = {}      # (rid, day, sn) -> slot_key
        self.teacher_day = {}     # (tid, day) -> count
        self.course_days = {}     # (course, dept, level, section) -> set(days)

    def occupy(self, s):
        k = s["_key"]
        self.section_owner[(s["department_id"], s["level"], s["section"], s["day"], s["slot_number"])] = k
        if s.get("teacher_id"):
            self.teacher_owner[(s["teacher_id"], s["day"], s["slot_number"])] = k
            dk = (s["teacher_id"], s["day"])
            self.teacher_day[dk] = self.teacher_day.get(dk, 0) + 1
        if s.get("room_id"):
            self.room_owner[(s["room_id"], s["day"], s["slot_number"])] = k
        self.course_days.setdefault((s["course_id"], s["department_id"], s["level"], s["section"]), set()).add(s["day"])

    def vacate(self, s):
        self.section_owner.pop((s["department_id"], s["level"], s["section"], s["day"], s["slot_number"]), None)
        if s.get("teacher_id"):
            self.teacher_owner.pop((s["teacher_id"], s["day"], s["slot_number"]), None)
            dk = (s["teacher_id"], s["day"])
            self.teacher_day[dk] = max(0, self.teacher_day.get(dk, 0) - 1)
        if s.get("room_id"):
            self.room_owner.pop((s["room_id"], s["day"], s["slot_number"]), None)


def _triple_consecutive(state: _State, tid, day, sn):
    """منع تكوين 3 محاضرات متتالية للمعلم"""
    if not tid:
        return False
    b = lambda x: (tid, day, x) in state.teacher_owner
    return (b(sn - 1) and b(sn - 2)) or (b(sn + 1) and b(sn + 2)) or (b(sn - 1) and b(sn + 1))


def _cell_ok(state: _State, prefs, s, day, sn, need_room=True):
    """هل يمكن وضع المحاضرة s في (day, sn)؟ يعيد (ok, room_id, reason)"""
    if (s["department_id"], s["level"], s["section"], day, sn) in state.section_owner:
        return False, "", "الشعبة مشغولة"
    tid = s.get("teacher_id", "")
    if tid:
        if (tid, day, sn) in state.teacher_owner:
            return False, "", "المعلم مشغول"
        pref = prefs.get(tid)
        if pref and _is_period_unavailable(pref, day, sn):
            return False, "", "تفضيلات المعلم"
        max_daily = int((pref or {}).get("max_daily_lectures") or 3)
        if state.teacher_day.get((tid, day), 0) >= max_daily:
            return False, "", "الحد اليومي للمعلم"
        if _triple_consecutive(state, tid, day, sn):
            return False, "", "ثلاث متتاليات"
    room_id = ""
    if need_room:
        cur = s.get("room_id", "")
        if cur and (cur, day, sn) not in state.room_owner:
            room_id = cur
        else:
            for rid in s["_rooms_order"]:
                if (rid, day, sn) not in state.room_owner:
                    room_id = rid
                    break
            if not room_id:
                return False, "", "لا قاعة حرة"
    return True, room_id, ""


def _target_cells(working_days, slot_numbers, prefer_day=None):
    """ترتيب الخلايا المرشحة: نفس اليوم أولاً ثم البقية، الفترات المبكرة أولاً"""
    cells = []
    for day in working_days:
        for sn in slot_numbers:
            score = (0 if day == prefer_day else 10) + (sn if sn <= 3 else 50 + sn)
            cells.append((score, day, sn))
    return [(d, s) for _, d, s in sorted(cells)]


async def _build_plan(db, faculty_id: str, department_id: str):
    data = await _build_master_data(db, faculty_id, department_id)
    unscheduled = [u for u in data["unscheduled"] if u["department_id"] == department_id]

    settings = await db.schedule_settings.find_one({"_id": f"faculty_{faculty_id}"}) or await db.schedule_settings.find_one({"_id": "global"})
    time_slots = sorted((settings or {}).get("time_slots", []), key=lambda x: x.get("slot_number", 0))
    working_days = (settings or {}).get("working_days", [])
    slot_numbers = [ts.get("slot_number") for ts in time_slots]

    rooms = await db.rooms.find({"faculty_id": faculty_id, "is_active": True}).to_list(300)
    rooms_order = [str(r["_id"]) for r in rooms]
    rooms_names = {str(r["_id"]): r.get("name", "") for r in rooms}

    all_slots = await db.weekly_schedule.find({}).to_list(20000)
    state = _State()
    slots_by_key = {}
    for s in all_slots:
        rec = {
            "_key": str(s["_id"]),
            "department_id": s.get("department_id", ""),
            "level": s.get("level") or 1,
            "section": s.get("section", "") or "",
            "day": s["day"],
            "slot_number": s["slot_number"],
            "course_id": s.get("course_id", ""),
            "teacher_id": s.get("teacher_id", ""),
            "room_id": s.get("room_id", ""),
            "_rooms_order": rooms_order,
            "_movable": s.get("department_id") == department_id,
        }
        slots_by_key[rec["_key"]] = rec
        state.occupy(rec)

    # أسماء للتقرير
    course_ids = list({s["course_id"] for s in slots_by_key.values() if s["course_id"]} | {u["course_id"] for u in unscheduled})
    teacher_ids = list({s["teacher_id"] for s in slots_by_key.values() if s["teacher_id"]} | {u.get("teacher_id", "") for u in unscheduled if u.get("teacher_id")})
    cnames = {str(c["_id"]): c.get("name", "") for c in await db.courses.find({"_id": {"$in": [ObjectId(x) for x in course_ids if x]}}).to_list(3000)} if course_ids else {}
    tnames = {str(t["_id"]): t.get("full_name", "") for t in await db.teachers.find({"_id": {"$in": [ObjectId(x) for x in teacher_ids if x]}}).to_list(1000)} if teacher_ids else {}
    prefs = {p["teacher_id"]: p for p in await db.teacher_preferences.find({"teacher_id": {"$in": teacher_ids}}).to_list(500)} if teacher_ids else {}

    def glabel(level, section):
        return f"م{level}" + (f"/{section}" if section else "")

    def cell_blockers(u_rec, day, sn):
        """قائمة مفاتيح المحاضرات المانعة لوضع u في (day,sn). None = مانع غير قابل للحل"""
        blockers = []
        sec_k = state.section_owner.get((u_rec["department_id"], u_rec["level"], u_rec["section"], day, sn))
        if sec_k:
            blockers.append(sec_k)
        tid = u_rec.get("teacher_id", "")
        if tid:
            pref = prefs.get(tid)
            if pref and _is_period_unavailable(pref, day, sn):
                return None  # تفضيلات معلم المقرر — خط أحمر
            t_k = state.teacher_owner.get((tid, day, sn))
            if t_k and t_k not in blockers:
                blockers.append(t_k)
        # قاعة: إن لم توجد قاعة حرة، نحتاج تحريك محاضرة تشغل قاعة في هذا الوقت
        room_free = any((rid, day, sn) not in state.room_owner for rid in rooms_order)
        if not room_free:
            # مرشحو تحرير القاعة: محاضرات القسم فقط، غير المحسوبة أصلاً كمانع
            opts = [k for rid in rooms_order
                    for k in [state.room_owner.get((rid, day, sn))]
                    if k and k not in blockers and slots_by_key[k]["_movable"]]
            if not opts:
                return None
            blockers.append(opts[0])
        # كل المانعين يجب أن يكونوا من نفس القسم
        if any(not slots_by_key[k]["_movable"] for k in blockers):
            return None
        return blockers

    moves_out, placements_out, failed_out = [], [], []
    order_counter = [0]

    def relocate(slot_rec, budget, banned_cells):
        """يحاول نقل محاضرة قائمة لخلية صالحة. يعيد قائمة نقلات أو None (يعدّل الحالة عند النجاح)"""
        origin_cell = (slot_rec["day"], slot_rec["slot_number"])
        state.vacate(slot_rec)
        moved_here = False
        try:
            for day, sn in _target_cells(working_days, slot_numbers, prefer_day=slot_rec["day"]):
                if (day, sn) == origin_cell or (day, sn) in banned_cells:
                    continue
                ok, room_id, _ = _cell_ok(state, prefs, slot_rec, day, sn)
                if ok:
                    mv = _apply_move(slot_rec, day, sn, room_id)
                    moved_here = True
                    return [mv]
            if budget >= 2:
                # نقلة مزدوجة: حرّك مانعاً واحداً بسيطاً ثم انقل هذه المحاضرة مكانه
                for day, sn in _target_cells(working_days, slot_numbers, prefer_day=slot_rec["day"]):
                    if (day, sn) == origin_cell or (day, sn) in banned_cells:
                        continue
                    inner = cell_blockers(slot_rec, day, sn)
                    if not inner or len(inner) != 1:
                        continue
                    inner_rec = slots_by_key[inner[0]]
                    inner_moves = relocate(inner_rec, 1, banned_cells | {(day, sn), origin_cell})
                    if inner_moves is None:
                        continue
                    ok, room_id, _ = _cell_ok(state, prefs, slot_rec, day, sn)
                    if ok:
                        mv = _apply_move(slot_rec, day, sn, room_id)
                        moved_here = True
                        return inner_moves + [mv]
                    _undo_moves(inner_moves)
            return None
        finally:
            if not moved_here:
                state.occupy(slot_rec)

    def _apply_move(slot_rec, day, sn, room_id):
        old = {"day": slot_rec["day"], "slot_number": slot_rec["slot_number"], "room_id": slot_rec["room_id"]}
        slot_rec["day"], slot_rec["slot_number"] = day, sn
        room_changed = bool(room_id) and room_id != old["room_id"]
        if room_id:
            slot_rec["room_id"] = room_id
        slot_rec["_moved"] = True
        state.occupy(slot_rec)
        order_counter[0] += 1
        return {
            "order": order_counter[0],
            "slot_id": slot_rec["_key"],
            "course_id": slot_rec["course_id"],
            "course_name": cnames.get(slot_rec["course_id"], ""),
            "teacher_name": tnames.get(slot_rec["teacher_id"], ""),
            "group": glabel(slot_rec["level"], slot_rec["section"]),
            "from_day": old["day"], "from_slot": old["slot_number"],
            "to_day": day, "to_slot": sn,
            "room_id": slot_rec["room_id"],
            "room_name": rooms_names.get(slot_rec["room_id"], ""),
            "room_changed": room_changed,
            "_old": old, "_rec": slot_rec,
        }

    def _undo_moves(mvs):
        for mv in reversed(mvs):
            rec = mv["_rec"]
            state.vacate(rec)
            rec["day"], rec["slot_number"], rec["room_id"] = mv["_old"]["day"], mv["_old"]["slot_number"], mv["_old"]["room_id"]
            rec["_moved"] = False
            state.occupy(rec)
            order_counter[0] -= 1

    def _finalize_placement(u, u_rec, day, sn, room_id):
        rec = {
            "_key": f"new_{u['course_id']}_{day}_{sn}",
            "department_id": u["department_id"], "level": u["level"], "section": u["section"],
            "day": day, "slot_number": sn, "course_id": u["course_id"],
            "teacher_id": u.get("teacher_id", ""), "room_id": room_id, "_rooms_order": rooms_order,
        }
        state.occupy(rec)
        slots_by_key[rec["_key"]] = rec
        placements_out.append({
            "course_id": u["course_id"], "course_name": u["course_name"],
            "teacher_name": u.get("teacher_name", ""),
            "level": u["level"], "section": u["section"], "group": glabel(u["level"], u["section"]),
            "day": day, "slot_number": sn,
            "room_id": room_id, "room_name": rooms_names.get(room_id, ""),
        })
        return True

    # المقررات الأكثر تقييداً أولاً (خيارات أقل = أولوية أعلى)
    for u in unscheduled:
        tid = u.get("teacher_id", "")
        u_rec = {
            "department_id": u["department_id"], "level": u["level"], "section": u["section"],
            "course_id": u["course_id"], "teacher_id": tid, "room_id": "", "_rooms_order": rooms_order,
        }
        for _ in range(u["missing"]):
            placed = False
            # مرشحون بترتيب ذكي (تجنب يوم فيه نفس المقرر + توزيع الحمل + فترات مبكرة)
            ck = (u["course_id"], u["department_id"], u["level"], u["section"])
            scored = []
            for day in working_days:
                for sn in slot_numbers:
                    sc = 0
                    if day in state.course_days.get(ck, set()):
                        sc += 100
                    sc += state.teacher_day.get((tid, day), 0) * 5
                    sc += sn if sn <= 3 else 50 + sn
                    scored.append((sc, day, sn))
            scored.sort()

            # المرحلة 1: إدراج مباشر بلا أي نقل
            for _, day, sn in scored:
                if tid and _triple_consecutive(state, tid, day, sn):
                    continue
                ok, room_id, _ = _cell_ok(state, prefs, u_rec, day, sn)
                if ok:
                    placed = _finalize_placement(u, u_rec, day, sn, room_id)
                    break
            if placed:
                continue

            # المرحلة 2: حلحلة — نقل مانعين (حتى نقلتين إجمالاً)
            for _, day, sn in scored:
                blockers = cell_blockers(u_rec, day, sn)
                if blockers is None or len(blockers) > 2:
                    continue
                budget = 2
                done_moves = []
                success = True
                for bk in blockers:
                    per_budget = budget - len(done_moves)
                    if per_budget <= 0:
                        success = False
                        break
                    mvs = relocate(slots_by_key[bk], per_budget, {(day, sn)})
                    if mvs is None:
                        success = False
                        break
                    done_moves += mvs
                if success:
                    if tid and _triple_consecutive(state, tid, day, sn):
                        success = False
                    else:
                        ok, room_id, _ = _cell_ok(state, prefs, u_rec, day, sn)
                        success = ok
                if success:
                    moves_out.extend(done_moves)
                    placed = _finalize_placement(u, u_rec, day, sn, room_id)
                    break
                _undo_moves(done_moves)
            if not placed:
                reason = "لا حل حتى بالحلحلة — "
                pref = prefs.get(tid)
                if pref and (pref.get("unavailable_periods") or pref.get("unavailable_days") or pref.get("unavailable_slots")):
                    reason += f"تفضيلات المعلم '{tnames.get(tid, '')}' تقيّد الخيارات بشدة، "
                reason += "جرّب توسيع التفضيلات أو إضافة قاعة/فترة"
                failed_out.append({"course_name": u["course_name"], "level": u["level"], "section": u["section"],
                                   "teacher_name": u.get("teacher_name", ""), "reason": reason})
                break

    # تنظيف الحقول الداخلية من النقلات
    for mv in moves_out:
        mv.pop("_old", None)
        mv.pop("_rec", None)

    return {
        "moves": moves_out,
        "placements": placements_out,
        "failed": failed_out,
        "message": (
            f"الخطة: إدراج {len(placements_out)} محاضرة"
            + (f" عبر {len(moves_out)} نقلة" if moves_out else " بدون أي نقل")
            + (f" • تعذر {len(failed_out)}" if failed_out else "")
        ),
    }


@router.post("/weekly-schedule/resolve-unscheduled/preview")
async def resolver_preview(
    faculty_id: str,
    department_id: str,
    current_user: dict = Depends(get_current_user),
):
    """معاينة خطة الحلحلة الذكية (لا يُحفظ شيء)"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    plan = await _build_plan(db, faculty_id, department_id)
    return plan


class MoveItem(BaseModel):
    slot_id: str
    to_day: str
    to_slot: int
    room_id: str = ""


class PlacementItem(BaseModel):
    course_id: str
    level: int
    section: str = ""
    day: str
    slot_number: int
    room_id: str = ""


class CommitPlanRequest(BaseModel):
    faculty_id: str
    department_id: str
    moves: List[MoveItem] = []
    placements: List[PlacementItem] = []


@router.post("/weekly-schedule/resolve-unscheduled/commit")
async def resolver_commit(
    data: CommitPlanRequest,
    current_user: dict = Depends(get_current_user),
):
    """تنفيذ خطة الحلحلة المعتمدة — يُتحقق من كل خطوة ضد الحالة الحالية، وأي خلل يوقف التنفيذ قبل البدء"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()

    # ===== تحقق مسبق بالمحاكاة (بنفس ترتيب الخطة) =====
    all_slots = await db.weekly_schedule.find({}).to_list(20000)
    state = _State()
    recs = {}
    for s in all_slots:
        rec = {
            "_key": str(s["_id"]), "department_id": s.get("department_id", ""),
            "level": s.get("level") or 1, "section": s.get("section", "") or "",
            "day": s["day"], "slot_number": s["slot_number"],
            "course_id": s.get("course_id", ""), "teacher_id": s.get("teacher_id", ""),
            "room_id": s.get("room_id", ""), "_rooms_order": [],
        }
        recs[rec["_key"]] = rec
        state.occupy(rec)

    t_ids = list({r["teacher_id"] for r in recs.values() if r["teacher_id"]})
    prefs = {p["teacher_id"]: p for p in await db.teacher_preferences.find({"teacher_id": {"$in": t_ids}}).to_list(1000)} if t_ids else {}

    stale = "الجدول تغيّر منذ المعاينة — أعد المعاينة ثم نفّذ الخطة الجديدة"
    for mv in data.moves:
        rec = recs.get(mv.slot_id)
        if not rec or rec["department_id"] != data.department_id:
            raise HTTPException(status_code=409, detail=stale)
        state.vacate(rec)
        rec["day"], rec["slot_number"] = mv.to_day, mv.to_slot
        if mv.room_id:
            rec["room_id"] = mv.room_id
        ok, _, why = _cell_ok(state, prefs, rec, mv.to_day, mv.to_slot, need_room=False)
        if not ok or (rec["room_id"] and (rec["room_id"], mv.to_day, mv.to_slot) in state.room_owner):
            raise HTTPException(status_code=409, detail=f"{stale} ({why or 'قاعة مشغولة'})")
        state.occupy(rec)

    for pl in data.placements:
        course = await db.courses.find_one({"_id": ObjectId(pl.course_id)})
        if not course:
            raise HTTPException(status_code=409, detail=stale)
        rec = {
            "_key": f"new_{pl.course_id}_{pl.day}_{pl.slot_number}",
            "department_id": data.department_id, "level": pl.level, "section": pl.section,
            "day": pl.day, "slot_number": pl.slot_number, "course_id": pl.course_id,
            "teacher_id": course.get("teacher_id", ""), "room_id": pl.room_id, "_rooms_order": [],
        }
        ok, _, why = _cell_ok(state, prefs, rec, pl.day, pl.slot_number, need_room=False)
        if not ok or (pl.room_id and (pl.room_id, pl.day, pl.slot_number) in state.room_owner):
            raise HTTPException(status_code=409, detail=f"{stale} ({why or 'قاعة مشغولة'})")
        state.occupy(rec)
        recs[rec["_key"]] = rec

    # ===== تنفيذ فعلي بنفس الترتيب =====
    now = datetime.now(timezone.utc)
    moved, placed = 0, 0
    lec_sync = {"updated": 0, "deleted": 0, "skipped_attendance": 0, "skipped_rescheduled": 0, "skipped_conflict": 0}
    for mv in data.moves:
        orig = await db.weekly_schedule.find_one({"_id": ObjectId(mv.slot_id)})
        upd = {"day": mv.to_day, "slot_number": mv.to_slot,
               "moved_by_resolver": True, "resolver_moved_at": now,
               "resolver_moved_from": f"{orig.get('day')}-ف{orig.get('slot_number')}" if orig else ""}
        if mv.room_id:
            upd["room_id"] = mv.room_id
        try:
            await db.weekly_schedule.update_one({"_id": ObjectId(mv.slot_id)}, {"$set": upd})
            moved += 1
        except DuplicateKeyError:
            raise HTTPException(status_code=409, detail=f"{stale} (رفض فريد عند النقلة {moved + 1})")
        # 🔄 (جدول ← نظام) المحاضرات اليومية المستقبلية تتبع الموقع الجديد
        if orig:
            res = await _sync_future_lectures(db, orig, "move", new_day=mv.to_day, new_slot_number=mv.to_slot,
                                              new_room_id=mv.room_id if mv.room_id else None)
            for k in lec_sync:
                lec_sync[k] += res.get(k, 0)

    for pl in data.placements:
        course = await db.courses.find_one({"_id": ObjectId(pl.course_id)})
        doc = {
            "faculty_id": data.faculty_id, "department_id": data.department_id,
            "level": pl.level, "section": pl.section, "day": pl.day, "slot_number": pl.slot_number,
            "course_id": pl.course_id, "teacher_id": (course or {}).get("teacher_id", ""),
            "room_id": pl.room_id, "created_at": now, "created_by": current_user["id"],
            "placed_by_resolver": True,
        }
        try:
            await db.weekly_schedule.insert_one(doc)
            placed += 1
        except DuplicateKeyError:
            raise HTTPException(status_code=409, detail=f"{stale} (رفض فريد عند الإدراج {placed + 1})")

    await log_activity(current_user, "resolve_unscheduled_commit", "weekly_schedule", data.department_id, None,
                       {"faculty_id": data.faculty_id, "moves": moved, "placements": placed, "lectures_synced": lec_sync["updated"]})
    return {"moved": moved, "placed": placed,
            "message": f"✅ تم تنفيذ الخطة: {placed} إدراج" + (f" و{moved} نقلة" if moved else "") + _sync_summary(lec_sync)}
