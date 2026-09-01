import ast

P = "/app/backend/backend/routes/weekly_schedule.py"
s = open(P, encoding="utf-8").read()

def rep(old, new, count=1):
    global s
    assert s.count(old) == count, f"anchor ({s.count(old)} != {count}): {old[:70]!r}"
    s = s.replace(old, new)

# 1) نموذج التحديث: حقل البداية المخصصة
rep('''class ScheduleSlotUpdate(BaseModel):
    course_id: Optional[str] = None
    teacher_id: Optional[str] = None
    room_id: Optional[str] = None
    duration_minutes: Optional[int] = None
    slot_type: Optional[str] = None  # theory | practical''',
'''class ScheduleSlotUpdate(BaseModel):
    course_id: Optional[str] = None
    teacher_id: Optional[str] = None
    room_id: Optional[str] = None
    duration_minutes: Optional[int] = None
    pinned_start_time: Optional[str] = None  # ⏰ بداية مخصصة "HH:MM" — "" لمسحها والعودة لوقت الفترة
    slot_type: Optional[str] = None  # theory | practical''')

# 2) السماح ببداية متأخرة (وليس أبكر فقط) في المحرك الفعلي والمحاكاة
rep('''        pin = _t2m(s.get("pinned_start_time") or "")
        eff_start = pin if (pin is not None and pin < base_start) else base_start''',
'''        pin = _t2m(s.get("pinned_start_time") or "")
        eff_start = pin if pin is not None else base_start''', count=2)

# 3) PUT: التعامل مع مسح البداية المخصصة + إعادة الحلحلة والمزامنة
rep('''    update = {k: v for k, v in data.dict().items() if v is not None}
    clear_duration = update.get("duration_minutes") == 0
    if clear_duration:
        update.pop("duration_minutes")
    if not update and not clear_duration:
        raise HTTPException(status_code=400, detail="لا توجد بيانات")''',
'''    update = {k: v for k, v in data.dict().items() if v is not None}
    clear_duration = update.get("duration_minutes") == 0
    if clear_duration:
        update.pop("duration_minutes")
    clear_pin = update.get("pinned_start_time") == ""
    if clear_pin:
        update.pop("pinned_start_time")
    if "pinned_start_time" in update:
        import re as _re
        if not _re.match(r"^\\d{1,2}:\\d{2}$", update["pinned_start_time"]):
            raise HTTPException(status_code=400, detail="صيغة البداية المخصصة يجب أن تكون HH:MM")
    if not update and not clear_duration and not clear_pin:
        raise HTTPException(status_code=400, detail="لا توجد بيانات")''')

rep('''        if clear_duration:
            _dq = {"merge_group_id": _mg} if _mg else {"_id": ObjectId(slot_id)}
            await db.weekly_schedule.update_many(_dq, {"$unset": {"duration_minutes": "", "pinned_start_time": ""}})''',
'''        if clear_duration:
            _dq = {"merge_group_id": _mg} if _mg else {"_id": ObjectId(slot_id)}
            await db.weekly_schedule.update_many(_dq, {"$unset": {"duration_minutes": "", "pinned_start_time": ""}})
        # ⏰ مسح البداية المخصصة فقط (العودة لوقت الفترة الرسمي)
        if clear_pin and not clear_duration:
            _pq = {"merge_group_id": _mg} if _mg else {"_id": ObjectId(slot_id)}
            await db.weekly_schedule.update_many(_pq, {"$unset": {"pinned_start_time": ""}})
        # ⏰ البداية المخصصة تسري على كل أعضاء مجموعة الدمج (محاضرة واحدة فعلياً)
        if "pinned_start_time" in update and _mg:
            await db.weekly_schedule.update_many({"merge_group_id": _mg}, {"$set": {"pinned_start_time": update["pinned_start_time"]}})''')

rep('''    if "duration_minutes" in update or clear_duration:
        message += _shift_summary(shifted)
        if clear_duration and not shifted:
            message += " — عادت الأوقات الافتراضية"''',
'''    if "duration_minutes" in update or clear_duration or "pinned_start_time" in update or clear_pin:
        message += _shift_summary(shifted)
        if (clear_duration or clear_pin) and not shifted:
            message += " — عادت الأوقات الافتراضية"''')

# 4) معاينة الأثر: إجراء "start"
rep('''class PreviewImpactRequest(BaseModel):
    slot_id: str
    action: str  # duration | delete | move
    duration_minutes: Optional[int] = None  # 0 أو None = العودة لمدة الفترة الافتراضية''',
'''class PreviewImpactRequest(BaseModel):
    slot_id: str
    action: str  # duration | delete | move | start
    duration_minutes: Optional[int] = None  # 0 أو None = العودة لمدة الفترة الافتراضية
    pinned_start_time: Optional[str] = None  # ⏰ لإجراء start — None/"" = العودة لوقت الفترة''')

rep('''    if data.action not in ("duration", "delete", "move"):''',
'''    if data.action not in ("duration", "delete", "move", "start"):''')

rep('''                if data.action == "duration":
                    if data.duration_minutes:
                        c["duration_minutes"] = data.duration_minutes
                    else:
                        c.pop("duration_minutes", None)''',
'''                if data.action == "duration":
                    if data.duration_minutes:
                        c["duration_minutes"] = data.duration_minutes
                    else:
                        c.pop("duration_minutes", None)
                if data.action == "start":
                    if data.pinned_start_time:
                        c["pinned_start_time"] = data.pinned_start_time
                    else:
                        c.pop("pinned_start_time", None)''')

# 5) حمولة العرض الشامل: كشف البداية المخصصة للبطاقة
rep('''            "duration_minutes": s.get("duration_minutes"),
            "computed_start_time": s.get("computed_start_time"),''',
'''            "duration_minutes": s.get("duration_minutes"),
            "pinned_start_time": s.get("pinned_start_time"),
            "computed_start_time": s.get("computed_start_time"),''', count=2)

ast.parse(s)
open(P, "w", encoding="utf-8").write(s)
print("weekly_schedule.py OK")
