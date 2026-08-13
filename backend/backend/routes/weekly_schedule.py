"""
Weekly Schedule Routes - مسارات الجدول الأسبوعي
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
import uuid
from bson import ObjectId
from datetime import datetime, timezone
from typing import Optional, List
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from .deps import get_db, get_current_user, has_permission, log_activity
from models.permissions import Permission

router = APIRouter(tags=["الجدول الأسبوعي"])

SCHEDULE_ROLES = {"admin", "dean", "department_head", "registrar"}

def can_manage_schedule(user: dict) -> bool:
    if user.get("role") in SCHEDULE_ROLES:
        return True
    if has_permission(user, Permission.MANAGE_SETTINGS):
        return True
    if has_permission(user, Permission.MANAGE_COURSES):
        return True
    return False


# ===== Models =====

class RoomCreate(BaseModel):
    name: str
    faculty_id: str
    capacity: int = 30
    building: str = ""
    floor: str = ""
    room_type: str = "lecture"  # lecture, lab, seminar
    is_active: bool = True


class RoomUpdate(BaseModel):
    name: Optional[str] = None
    faculty_id: Optional[str] = None
    capacity: Optional[int] = None
    building: Optional[str] = None
    floor: Optional[str] = None
    room_type: Optional[str] = None
    is_active: Optional[bool] = None


class TimeSlotCreate(BaseModel):
    slot_number: int
    name: str  # المحاضرة الأولى
    start_time: str  # "08:00"
    end_time: str  # "09:30"


class UnavailablePeriod(BaseModel):
    day: str
    slot_number: int


class TeacherPreferenceUpdate(BaseModel):
    unavailable_days: List[str] = []  # ["الثلاثاء", "الأربعاء"] — يوم كامل
    unavailable_slots: List[int] = []  # [1, 5] = فترات تُطبَّق على كل الأيام (قديم/توافق رجعي)
    unavailable_periods: List[UnavailablePeriod] = []  # 🆕 شبكة يوم×فترة بدقة عالية
    max_daily_lectures: int = 3
    allow_consecutive_lectures: bool = True


def _derive_unavailable_periods(pref: dict, working_days: List[str], slot_numbers: List[int]) -> List[dict]:
    """🔄 يستخرج قائمة الخلايا (يوم/فترة) غير المتاحة من كل من:
    - unavailable_periods الجديدة (dosahalt)
    - unavailable_days القديمة (يوم كامل → كل الفترات)
    - unavailable_slots القديمة (فترة عبر كل الأيام)
    ويعيد مجموعة موحدة بدون تكرار.
    """
    result = set()
    # 1) الشبكة الجديدة (إن وُجدت)
    for p in pref.get("unavailable_periods", []) or []:
        if isinstance(p, dict) and p.get("day") and p.get("slot_number") is not None:
            result.add((str(p["day"]), int(p["slot_number"])))
    # 2) توافق رجعي: أيام كاملة قديمة
    for d in pref.get("unavailable_days", []) or []:
        for sn in slot_numbers:
            result.add((str(d), int(sn)))
    # 3) توافق رجعي: فترات قديمة على كل الأيام
    for sn in pref.get("unavailable_slots", []) or []:
        for d in working_days:
            result.add((str(d), int(sn)))
    return [{"day": d, "slot_number": sn} for (d, sn) in result]


def _is_period_unavailable(pref: dict, day: str, slot_number: int) -> bool:
    """يتحقق ما إذا كانت الخلية (يوم/فترة) محظورة، بدمج الشبكة الجديدة + الحقول القديمة."""
    # الشبكة الجديدة
    for p in pref.get("unavailable_periods", []) or []:
        if isinstance(p, dict) and p.get("day") == day and int(p.get("slot_number", -1)) == int(slot_number):
            return True
    # يوم كامل قديم
    if day in (pref.get("unavailable_days", []) or []):
        return True
    # فترة عبر كل الأيام قديمة
    if int(slot_number) in (pref.get("unavailable_slots", []) or []):
        return True
    return False


class MergeTarget(BaseModel):
    level: int
    section: str = ""
    department_id: str = ""  # 🆕 فارغ = نفس قسم المحاضرة الأساسية (يدعم قسماً آخر من نفس الكلية)


class ScheduleSlotCreate(BaseModel):
    faculty_id: str
    department_id: str
    level: int
    section: str = ""
    day: str  # السبت, الأحد, ...
    slot_number: int  # 1, 2, 3, 4, 5
    course_id: str
    teacher_id: str
    room_id: str
    duration_minutes: Optional[int] = None  # ⏱ مدة مخصصة (افتراضي: مدة الفترة)
    merge_with: Optional[List[MergeTarget]] = None  # 🆕 محاضرة مشتركة: مستويات/شعب إضافية


class ScheduleSlotUpdate(BaseModel):
    course_id: Optional[str] = None
    teacher_id: Optional[str] = None
    room_id: Optional[str] = None
    duration_minutes: Optional[int] = None


def _add_minutes(hhmm: str, minutes: int) -> str:
    """'08:00' + 90 → '09:30'"""
    try:
        h, m = map(int, str(hhmm).strip().split(":")[:2])
        total = (h * 60 + m + int(minutes)) % (24 * 60)
        return f"{total // 60:02d}:{total % 60:02d}"
    except Exception:
        return hhmm


def _t2m(hhmm) -> Optional[int]:
    """'08:00' → 480 دقيقة"""
    try:
        h, m = map(int, str(hhmm).strip().split(":")[:2])
        return h * 60 + m
    except Exception:
        return None


def _m2t(minutes: int) -> str:
    """480 → '08:00'"""
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _slots_conflict(a: dict, b: dict) -> bool:
    """هل تتشارك المحاضرتان مورداً (شعبة/معلم/قاعة)؟ أعضاء نفس المجموعة المشتركة لا يتعارضون"""
    if a.get("merge_group_id") and a.get("merge_group_id") == b.get("merge_group_id"):
        return False
    if (a.get("department_id"), a.get("level"), a.get("section") or "") == \
       (b.get("department_id"), b.get("level"), b.get("section") or ""):
        return True
    if a.get("teacher_id") and a.get("teacher_id") == b.get("teacher_id"):
        return True
    if a.get("room_id") and a.get("room_id") == b.get("room_id"):
        return True
    return False


def _effective_times(s: dict, st_def: str, en_def: str):
    """الأوقات الفعلية للخانة: (البداية، النهاية، هل تختلف عن الفترة الافتراضية)"""
    st = s.get("computed_start_time") or st_def
    if s.get("computed_end_time"):
        en = s["computed_end_time"]
    elif s.get("duration_minutes"):
        en = _add_minutes(st, s["duration_minutes"])
    else:
        en = en_def
    return st, en, (st != st_def or en != en_def)


def _shift_summary(shifted: list) -> str:
    if not shifted:
        return ""
    parts = [f"{sh.get('course_name') or 'محاضرة'} ({sh['from']} ← {sh['to']})" for sh in shifted[:5]]
    more = f" و{len(shifted) - 5} أخرى" if len(shifted) > 5 else ""
    return f" ⚠️ إزاحة تلقائية لـ {len(shifted)} محاضرة: " + "، ".join(parts) + more


# ===== القاعات =====

@router.get("/rooms")
async def get_rooms(
    faculty_id: Optional[str] = None,
    building: Optional[str] = None,
    is_active: Optional[bool] = True,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    query = {}
    if is_active is not None:
        query["is_active"] = is_active
    if faculty_id:
        query["faculty_id"] = faculty_id
    if building:
        query["building"] = building
    rooms = await db.rooms.find(query).sort("name", 1).to_list(500)
    return [{
        "id": str(r["_id"]),
        "name": r.get("name", ""),
        "faculty_id": r.get("faculty_id", ""),
        "capacity": r.get("capacity", 30),
        "building": r.get("building", ""),
        "floor": r.get("floor", ""),
        "room_type": r.get("room_type", "lecture"),
        "is_active": r.get("is_active", True),
    } for r in rooms]


class RoomOccurrence(BaseModel):
    date: str  # YYYY-MM-DD
    start_time: str  # HH:MM
    end_time: str  # HH:MM


class RoomAvailabilityRequest(BaseModel):
    occurrences: List[RoomOccurrence]
    exclude_lecture_id: Optional[str] = None


@router.post("/rooms/availability")
async def check_rooms_availability(data: RoomAvailabilityRequest, current_user: dict = Depends(get_current_user)):
    """🟢🔴 فحص إشغال جميع القاعات المسجلة مقابل مواعيد محددة (محاضرة واحدة أو سلسلة توليد)"""
    db = get_db()
    occurrences = data.occurrences[:200]
    if not occurrences:
        raise HTTPException(status_code=400, detail="لا توجد مواعيد للفحص")

    rooms = await db.rooms.find({"is_active": True}).sort("name", 1).to_list(500)
    dates = list({o.date for o in occurrences})

    lec_query = {
        "date": {"$in": dates},
        "status": {"$ne": "cancelled"},
        "room": {"$nin": ["", None]},
    }
    if data.exclude_lecture_id:
        try:
            lec_query["_id"] = {"$ne": ObjectId(data.exclude_lecture_id)}
        except Exception:
            pass
    lectures = await db.lectures.find(
        lec_query, {"room": 1, "date": 1, "start_time": 1, "end_time": 1, "course_id": 1}
    ).to_list(10000)

    # أسماء المقررات الحاجزة (جلب جماعي)
    course_ids = list({l.get("course_id") for l in lectures if l.get("course_id")})
    course_names = {}
    if course_ids:
        try:
            oids = [ObjectId(cid) for cid in course_ids]
            async for c in db.courses.find({"_id": {"$in": oids}}, {"name": 1}):
                course_names[str(c["_id"])] = c.get("name", "")
        except Exception:
            pass

    # تجميع المحاضرات حسب اسم القاعة (بعد إزالة الفراغات)
    by_room = {}
    for l in lectures:
        rn = (l.get("room") or "").strip()
        if rn:
            by_room.setdefault(rn, []).append(l)

    results = []
    total = len(occurrences)
    for r in rooms:
        rname = (r.get("name") or "").strip()
        conflicts = []
        busy_count = 0
        room_lectures = by_room.get(rname, [])
        for occ in occurrences:
            hit = None
            for l in room_lectures:
                if l.get("date") != occ.date:
                    continue
                ls, le = l.get("start_time", ""), l.get("end_time", "")
                if ls and le and occ.start_time < le and occ.end_time > ls:
                    hit = l
                    break
            if hit:
                busy_count += 1
                if len(conflicts) < 3:
                    conflicts.append({
                        "date": hit.get("date", ""),
                        "start_time": hit.get("start_time", ""),
                        "end_time": hit.get("end_time", ""),
                        "course_name": course_names.get(hit.get("course_id", ""), "مقرر آخر"),
                    })
        results.append({
            "id": str(r["_id"]),
            "name": rname,
            "building": r.get("building", ""),
            "total": total,
            "busy_count": busy_count,
            "conflicts": conflicts,
        })
    return {"results": results, "total_occurrences": total}


@router.post("/rooms")
async def create_room(data: RoomCreate, current_user: dict = Depends(get_current_user)):
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    existing = await db.rooms.find_one({"name": data.name, "faculty_id": data.faculty_id})
    if existing:
        raise HTTPException(status_code=409, detail=f"القاعة '{data.name}' موجودة مسبقاً")
    doc = data.dict()
    doc["created_at"] = datetime.now(timezone.utc)
    result = await db.rooms.insert_one(doc)
    return {"id": str(result.inserted_id), "message": "تم إضافة القاعة بنجاح"}


@router.get("/rooms/template/excel")
async def download_rooms_template(current_user: dict = Depends(get_current_user)):
    """تحميل قالب Excel لاستيراد القاعات"""
    import openpyxl
    from openpyxl.styles import Font, Alignment, PatternFill
    from io import BytesIO

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "القاعات"
    ws.sheet_view.rightToLeft = True

    headers = ['اسم القاعة', 'السعة', 'المبنى', 'الطابق']
    hfill = PatternFill(start_color='1565C0', end_color='1565C0', fill_type='solid')
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.fill = hfill
        cell.font = Font(bold=True, color='FFFFFF')
        cell.alignment = Alignment(horizontal='center')

    # أمثلة
    examples = [
        ['ق101', 50, 'المبنى الرئيسي', 'الأول'],
        ['ق202', 40, 'المبنى الرئيسي', 'الثاني'],
        ['معمل حاسوب 1', 30, 'مبنى المعامل', 'الأول'],
    ]
    for i, row in enumerate(examples, 2):
        for col, val in enumerate(row, 1):
            ws.cell(row=i, column=col, value=val)

    for col, w in enumerate([18, 10, 22, 12], 1):
        ws.column_dimensions[chr(64 + col)].width = w

    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=rooms_template.xlsx"})


@router.post("/rooms/import")
async def import_rooms(
    faculty_id: str,
    file: bytes = Depends(lambda: None),
    current_user: dict = Depends(get_current_user),
):
    """استيراد قاعات من ملف Excel"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")

    from fastapi import UploadFile, File as FastAPIFile
    raise HTTPException(status_code=400, detail="استخدم /api/rooms/import/upload")


from fastapi import UploadFile, File as FastAPIFile

@router.post("/rooms/import/upload")
async def import_rooms_upload(
    faculty_id: str,
    file: UploadFile = FastAPIFile(...),
    current_user: dict = Depends(get_current_user),
):
    """استيراد قاعات من ملف Excel"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")

    import openpyxl
    from io import BytesIO

    db = get_db()
    content = await file.read()
    filename = file.filename or ""

    rows_data = []
    if filename.endswith('.csv'):
        import csv
        import io
        text = content.decode('utf-8-sig')
        reader = csv.reader(io.StringIO(text))
        for row in reader:
            rows_data.append(row)
        rows_data = rows_data[1:]  # skip header
    elif filename.endswith('.xls'):
        import xlrd
        book = xlrd.open_workbook(file_contents=content)
        sheet = book.sheet_by_index(0)
        for i in range(1, sheet.nrows):
            rows_data.append([sheet.cell_value(i, j) for j in range(sheet.ncols)])
    else:
        wb = openpyxl.load_workbook(BytesIO(content))
        ws = wb.active
        for row in ws.iter_rows(min_row=2, values_only=True):
            rows_data.append(list(row))

    created = 0
    skipped = 0
    errors = []

    for row_num, row in enumerate(rows_data, 2):
        if not row or not row[0]:
            continue
        name = str(row[0]).strip()
        capacity = int(row[1]) if row[1] else 30
        building = str(row[2]).strip() if row[2] else ""
        floor = str(row[3]).strip() if row[3] else ""

        if not name:
            errors.append(f"سطر {row_num}: اسم القاعة فارغ")
            continue

        existing = await db.rooms.find_one({"name": name, "faculty_id": faculty_id})
        if existing:
            skipped += 1
            continue

        await db.rooms.insert_one({
            "name": name,
            "faculty_id": faculty_id,
            "capacity": capacity,
            "building": building,
            "floor": floor,
            "room_type": "lecture",
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
        })
        created += 1

    return {
        "message": f"تم إضافة {created} قاعة جديدة، {skipped} موجودة مسبقاً",
        "created": created,
        "skipped": skipped,
        "errors": errors,
    }



@router.put("/rooms/{room_id}")
async def update_room(room_id: str, data: RoomUpdate, current_user: dict = Depends(get_current_user)):
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    update = {k: v for k, v in data.dict().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="لا توجد بيانات للتحديث")
    await db.rooms.update_one({"_id": ObjectId(room_id)}, {"$set": update})
    return {"message": "تم تحديث القاعة"}


@router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, current_user: dict = Depends(get_current_user)):
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    # 🔒 تكامل: منع حذف قاعة مستخدمة في الجدول الأسبوعي
    used = await db.weekly_schedule.count_documents({"room_id": room_id})
    if used:
        raise HTTPException(status_code=400, detail=f"لا يمكن حذف القاعة — مستخدمة في {used} محاضرة بالجدول الأسبوعي. انقل تلك المحاضرات لقاعة أخرى أولاً")
    await db.rooms.delete_one({"_id": ObjectId(room_id)})
    return {"message": "تم حذف القاعة"}


# ===== الفترات الزمنية =====

@router.get("/schedule-settings")
async def get_schedule_settings(
    faculty_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    settings_id = f"faculty_{faculty_id}" if faculty_id else "global"
    settings = await db.schedule_settings.find_one({"_id": settings_id})
    if not settings:
        # جلب الإعدادات العامة كقيمة افتراضية
        global_settings = await db.schedule_settings.find_one({"_id": "global"})
        default_slots = [
            {"slot_number": 1, "name": "المحاضرة الأولى", "start_time": "08:00", "end_time": "09:30"},
            {"slot_number": 2, "name": "المحاضرة الثانية", "start_time": "09:45", "end_time": "11:15"},
            {"slot_number": 3, "name": "المحاضرة الثالثة", "start_time": "11:30", "end_time": "13:00"},
            {"slot_number": 4, "name": "المحاضرة الرابعة", "start_time": "13:15", "end_time": "14:45"},
            {"slot_number": 5, "name": "المحاضرة الخامسة", "start_time": "15:00", "end_time": "16:30"},
        ]
        default_days = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"]
        if global_settings:
            default_slots = global_settings.get("time_slots", default_slots)
            default_days = global_settings.get("working_days", default_days)
        settings = {
            "time_slots": default_slots,
            "working_days": default_days,
        }
    return {
        "time_slots": settings.get("time_slots", []),
        "working_days": settings.get("working_days", []),
    }


@router.put("/schedule-settings")
async def update_schedule_settings(
    time_slots: Optional[List[dict]] = None,
    working_days: Optional[List[str]] = None,
    current_user: dict = Depends(get_current_user),
):
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    update = {}
    if time_slots is not None:
        update["time_slots"] = time_slots
    if working_days is not None:
        update["working_days"] = working_days
    if update:
        await db.schedule_settings.update_one({"_id": "global"}, {"$set": update}, upsert=True)
    return {"message": "تم تحديث الإعدادات"}


DEFAULT_WORKING_DAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"]


@router.post("/schedule-settings/time-slots")
async def save_time_slots(
    slots: List[TimeSlotCreate],
    faculty_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    settings_id = f"faculty_{faculty_id}" if faculty_id else "global"
    slots_data = [s.dict() for s in slots]
    await db.schedule_settings.update_one(
        {"_id": settings_id},
        {"$set": {"time_slots": slots_data}},
        upsert=True
    )
    # 🛡️ ضمان وجود أيام العمل — يعالج السجلات الناقصة التي كانت تمنع التوليد
    doc = await db.schedule_settings.find_one({"_id": settings_id})
    if not doc.get("working_days"):
        await db.schedule_settings.update_one(
            {"_id": settings_id},
            {"$set": {"working_days": DEFAULT_WORKING_DAYS}}
        )
    return {"message": "تم حفظ الفترات الزمنية"}


class WorkingDaysUpdate(BaseModel):
    days: List[str]


@router.post("/schedule-settings/working-days")
async def save_working_days(
    data: WorkingDaysUpdate,
    faculty_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """💼 حفظ أيام العمل (لكل كلية أو عام)"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    if not data.days:
        raise HTTPException(status_code=400, detail="اختر يوم عمل واحداً على الأقل")
    db = get_db()
    settings_id = f"faculty_{faculty_id}" if faculty_id else "global"
    await db.schedule_settings.update_one(
        {"_id": settings_id},
        {"$set": {"working_days": data.days}},
        upsert=True
    )
    return {"message": "تم حفظ أيام العمل"}


# ===== تفضيلات المعلمين =====

@router.get("/teacher-preferences")
async def list_teacher_preferences_summary(department_id: str, current_user: dict = Depends(get_current_user)):
    """📋 ملخص التفضيلات المحفوظة لجميع معلمي قسم معين — لقائمة تبويب تفضيلات المعلمين"""
    db = get_db()
    teachers = await db.teachers.find({"department_id": department_id}).sort("full_name", 1).to_list(1000)
    tids = [str(t["_id"]) for t in teachers]
    prefs_docs = await db.teacher_preferences.find({"teacher_id": {"$in": tids}}).to_list(1000)
    by_tid = {p.get("teacher_id"): p for p in prefs_docs}

    # لعدّ الحقول القديمة (قبل شبكة الفترات) نستخدم إعدادات كلية القسم (وليس العامة)
    dept = await db.departments.find_one({"_id": ObjectId(department_id)})
    fac_id = (dept or {}).get("faculty_id", "")
    settings = await db.schedule_settings.find_one({"_id": f"faculty_{fac_id}"}) if fac_id else None
    if not settings:
        settings = await db.schedule_settings.find_one({"_id": "global"}) or await db.schedule_settings.find_one({})
    ts_count = len((settings or {}).get("time_slots", []) or []) or 6
    working_days_count = len((settings or {}).get("working_days", []) or []) or 6

    results = []
    for t in teachers:
        tid = str(t["_id"])
        p = by_tid.get(tid)
        unavailable_count = 0
        if p:
            periods = p.get("unavailable_periods") or []
            if periods:
                unavailable_count = len(periods)
            else:
                days_n = len(p.get("unavailable_days") or [])
                slots_n = len(p.get("unavailable_slots") or [])
                unavailable_count = days_n * ts_count + slots_n * max(0, working_days_count - days_n)
        results.append({
            "teacher_id": tid,
            "full_name": t.get("full_name", ""),
            "has_prefs": bool(p),
            "unavailable_count": unavailable_count,
            "max_daily_lectures": (p or {}).get("max_daily_lectures", 3),
            "allow_consecutive_lectures": (p or {}).get("allow_consecutive_lectures", True),
        })
    return results


@router.get("/teacher-preferences/{teacher_id}")
async def get_teacher_preferences(teacher_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    pref = await db.teacher_preferences.find_one({"teacher_id": teacher_id})
    if not pref:
        return {
            "teacher_id": teacher_id,
            "unavailable_days": [],
            "unavailable_slots": [],
            "unavailable_periods": [],
            "max_daily_lectures": 3,
            "allow_consecutive_lectures": True,
        }
    # 🔄 لعرض نظيف: نُرجع الشبكة كما هي إن وُجدت،
    # وإلا نشتقّها من الحقول القديمة (backward compat) لسهولة عمل UI الجديدة
    unavailable_periods = pref.get("unavailable_periods") or []
    if not unavailable_periods and (pref.get("unavailable_days") or pref.get("unavailable_slots")):
        # اشتق الشبكة من الحقول القديمة باستخدام أيام العمل والفترات الحالية
        settings = await db.schedule_settings.find_one({})
        working_days = (settings or {}).get("working_days", ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"])
        ts_docs = await db.time_slots.find({}).to_list(20)
        slot_numbers = sorted([ts.get("slot_number") for ts in ts_docs if ts.get("slot_number")])
        if not slot_numbers:
            slot_numbers = [1, 2, 3, 4, 5]
        unavailable_periods = _derive_unavailable_periods(pref, working_days, slot_numbers)
    return {
        "teacher_id": teacher_id,
        "unavailable_days": pref.get("unavailable_days", []),
        "unavailable_slots": pref.get("unavailable_slots", []),
        "unavailable_periods": unavailable_periods,
        "max_daily_lectures": pref.get("max_daily_lectures", 3),
        "allow_consecutive_lectures": pref.get("allow_consecutive_lectures", True),
    }


@router.put("/teacher-preferences/{teacher_id}")
async def update_teacher_preferences(
    teacher_id: str,
    data: TeacherPreferenceUpdate,
    current_user: dict = Depends(get_current_user),
):
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()

    # 🔄 نطبّع الشبكة (unavailable_periods) ونشتقّ الحقول القديمة للتوافق الرجعي
    # (بحيث كود الجدولة القديم أو النشر السابق على Cloud Run لا ينكسر)
    periods_set = set()
    for p in data.unavailable_periods or []:
        periods_set.add((p.day, int(p.slot_number)))
    # 🔧 الحقول القديمة تُدمج فقط إن كانت الشبكة الجديدة غير مرسلة (عميل قديم)
    # وإلا فالشبكة هي مصدر الحقيقة الوحيد — يمنع "عودة" الخلايا الملغاة من الحقول القديمة
    settings = await db.schedule_settings.find_one({})
    working_days = (settings or {}).get("working_days", ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"])
    ts_docs = await db.time_slots.find({}).to_list(20)
    slot_numbers = sorted([ts.get("slot_number") for ts in ts_docs if ts.get("slot_number")])
    if not slot_numbers:
        slot_numbers = [1, 2, 3, 4, 5]
    if not (data.unavailable_periods or []):
        for d in data.unavailable_days or []:
            for sn in slot_numbers:
                periods_set.add((d, sn))
        for sn in data.unavailable_slots or []:
            for d in working_days:
                periods_set.add((d, sn))

    normalized_periods = [{"day": d, "slot_number": sn} for (d, sn) in sorted(periods_set)]

    # اشتقّ الحقول القديمة المكافئة من الشبكة النهائية:
    # - يوم كامل = يوم كل خلاياه محددة
    # - فترة على كل الأيام = فترة موجودة في كل يوم عمل
    derived_days = []
    for d in working_days:
        if all((d, sn) in periods_set for sn in slot_numbers):
            derived_days.append(d)
    derived_slots = []
    for sn in slot_numbers:
        if all((d, sn) in periods_set for d in working_days):
            derived_slots.append(sn)

    await db.teacher_preferences.update_one(
        {"teacher_id": teacher_id},
        {"$set": {
            "teacher_id": teacher_id,
            "unavailable_days": derived_days,
            "unavailable_slots": derived_slots,
            "unavailable_periods": normalized_periods,
            "max_daily_lectures": data.max_daily_lectures,
            "allow_consecutive_lectures": data.allow_consecutive_lectures,
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True
    )
    return {"message": "تم حفظ تفضيلات المعلم"}


# ===== خانات الجدول =====

@router.get("/weekly-schedule")
async def get_weekly_schedule(
    faculty_id: Optional[str] = None,
    department_id: Optional[str] = None,
    level: Optional[int] = None,
    section: Optional[str] = None,
    teacher_id: Optional[str] = None,
    course_id: Optional[str] = None,
    room_id: Optional[str] = None,
    semester_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    query = {}
    if semester_id:
        query["semester_id"] = semester_id
    if faculty_id:
        query["faculty_id"] = faculty_id
    if department_id:
        query["department_id"] = department_id
    if level:
        query["level"] = level
    if section:
        query["section"] = section
    if teacher_id:
        query["teacher_id"] = teacher_id
    if course_id:
        query["course_id"] = course_id
    if room_id:
        query["room_id"] = room_id

    slots = await db.weekly_schedule.find(query).to_list(2000)

    # Batch lookup
    course_ids = list({s["course_id"] for s in slots if s.get("course_id")})
    teacher_ids = list({s["teacher_id"] for s in slots if s.get("teacher_id")})
    room_ids = list({s["room_id"] for s in slots if s.get("room_id")})
    dept_ids = list({s["department_id"] for s in slots if s.get("department_id")})

    courses_map = {}
    if course_ids:
        docs = await db.courses.find({"_id": {"$in": [ObjectId(x) for x in course_ids]}}).to_list(500)
        for d in docs:
            courses_map[str(d["_id"])] = d

    # 🛟 fallback: أسماء المقررات المؤرشفة (المحذوفة بعد أرشفة الفصل)
    _missing_cids = {x for x in course_ids if x not in courses_map}
    if _missing_cids:
        from ._schedule_repair import archived_courses_info
        for cid, info in (await archived_courses_info(db, _missing_cids)).items():
            courses_map[cid] = {"name": info.get("name", ""), "code": info.get("code", ""),
                                "teacher_id": info.get("teacher_id"), "_archived": True}

    teachers_map = {}
    if teacher_ids:
        docs = await db.teachers.find({"_id": {"$in": [ObjectId(x) for x in teacher_ids]}}).to_list(500)
        for d in docs:
            teachers_map[str(d["_id"])] = d

    rooms_map = {}
    if room_ids:
        docs = await db.rooms.find({"_id": {"$in": [ObjectId(x) for x in room_ids]}}).to_list(500)
        for d in docs:
            rooms_map[str(d["_id"])] = d

    depts_map = {}
    if dept_ids:
        docs = await db.departments.find({"_id": {"$in": [ObjectId(x) for x in dept_ids]}}).to_list(100)
        for d in docs:
            depts_map[str(d["_id"])] = d

    result = []
    # 🆕 معلومات المحاضرات المشتركة (شارة "مشتركة مع ...")
    gids = list({s["merge_group_id"] for s in slots if s.get("merge_group_id")})
    merge_map = {}
    if gids:
        async for m in db.weekly_schedule.find({"merge_group_id": {"$in": gids}}):
            merge_map.setdefault(m["merge_group_id"], []).append(m)
        # أقسام أعضاء المجموعات غير المحمّلة (محاضرة مشتركة مع قسم آخر)
        extra_dids = {m.get("department_id", "") for ms in merge_map.values() for m in ms} - set(depts_map.keys()) - {""}
        if extra_dids:
            docs = await db.departments.find({"_id": {"$in": [ObjectId(x) for x in extra_dids]}}).to_list(100)
            for d in docs:
                depts_map[str(d["_id"])] = d

    def _merge_labels(s):
        gid = s.get("merge_group_id")
        if not gid:
            return []
        labels = []
        for m in merge_map.get(gid, []):
            if m["_id"] == s["_id"]:
                continue
            same_dept = m.get("department_id") == s.get("department_id")
            if not same_dept or m.get("level") != s.get("level"):
                lbl = f"المستوى {m.get('level')}"
                if m.get("section"):
                    lbl += f" ({m['section']})"
            else:
                lbl = f"شعبة {m.get('section') or '؟'}"
            if not same_dept:
                dep_name = depts_map.get(m.get("department_id", ""), {}).get("name", "قسم آخر")
                lbl = f"{dep_name} — {lbl}"
            labels.append(lbl)
        return labels

    for s in slots:
        course = courses_map.get(s.get("course_id", ""), {})
        teacher = teachers_map.get(s.get("teacher_id", ""), {})
        room = rooms_map.get(s.get("room_id", ""), {})
        dept = depts_map.get(s.get("department_id", ""), {})
        result.append({
            "id": str(s["_id"]),
            "faculty_id": s.get("faculty_id", ""),
            "department_id": s.get("department_id", ""),
            "department_name": dept.get("name", ""),
            "level": s.get("level"),
            "section": s.get("section", ""),
            "day": s.get("day", ""),
            "slot_number": s.get("slot_number"),
            "course_id": s.get("course_id", ""),
            "course_name": course.get("name", ""),
            "course_code": course.get("code", ""),
            "teacher_id": s.get("teacher_id", ""),
            "teacher_name": teacher.get("full_name", ""),
            "room_id": s.get("room_id", ""),
            "room_name": room.get("name", ""),
            "duration_minutes": s.get("duration_minutes"),
            "computed_start_time": s.get("computed_start_time"),
            "computed_end_time": s.get("computed_end_time"),
            "merge_group_id": s.get("merge_group_id", ""),
            "merged_with": _merge_labels(s),
        })
    return result


@router.get("/weekly-schedule/conflicts")
async def get_schedule_conflicts(
    faculty_id: Optional[str] = None,
    department_id: Optional[str] = None,
    level: Optional[int] = None,
    section: Optional[str] = None,
    teacher_id: Optional[str] = None,
    semester_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """
    كشف التعارضات في الجدول الأسبوعي الحالي.
    يُرجع قائمة بكل التعارضات: شعبة، معلم، قاعة.
    كل تعارض يحتوي على IDs الـ slots المتعارضة + التفاصيل.
    """
    db = get_db()
    query = {}
    if semester_id:
        query["semester_id"] = semester_id
    if faculty_id:
        query["faculty_id"] = faculty_id
    if department_id:
        query["department_id"] = department_id
    if level:
        query["level"] = level
    if section:
        query["section"] = section
    if teacher_id:
        query["teacher_id"] = teacher_id

    slots = await db.weekly_schedule.find(query).to_list(5000)

    # تجميع الـ slots حسب (اليوم، رقم الفترة)
    by_time: dict = {}  # (day, slot_number) -> [slot_dicts]
    for s in slots:
        key = (s.get("day", ""), s.get("slot_number"))
        by_time.setdefault(key, []).append(s)

    # كشف التعارضات داخل كل فترة زمنية
    section_conflicts: List[dict] = []
    teacher_conflicts: List[dict] = []
    room_conflicts: List[dict] = []
    conflicting_slot_ids: set = set()

    for (day, slot_number), group in by_time.items():
        if len(group) < 2:
            continue  # لا تعارض ممكن

        # 1. تعارض الشعبة: نفس (department + level + section)
        section_groups: dict = {}
        for s in group:
            key = (s.get("department_id", ""), s.get("level"), s.get("section", ""))
            section_groups.setdefault(key, []).append(s)
        for (dept_id, lv, sec), conflicts in section_groups.items():
            if len(conflicts) > 1:
                ids = [str(c["_id"]) for c in conflicts]
                conflicting_slot_ids.update(ids)
                section_conflicts.append({
                    "type": "section",
                    "day": day,
                    "slot_number": slot_number,
                    "department_id": dept_id,
                    "level": lv,
                    "section": sec,
                    "slot_ids": ids,
                    "count": len(conflicts),
                })

        # 2. تعارض المعلم: نفس teacher_id (🆕 أعضاء المحاضرة المشتركة يُحسبون كواحد)
        teacher_groups: dict = {}
        _seen_tg: set = set()
        for s in group:
            tid = s.get("teacher_id", "")
            if tid:
                mg = s.get("merge_group_id")
                if mg and (tid, mg) in _seen_tg:
                    continue
                if mg:
                    _seen_tg.add((tid, mg))
                teacher_groups.setdefault(tid, []).append(s)
        for tid, conflicts in teacher_groups.items():
            if len(conflicts) > 1:
                ids = [str(c["_id"]) for c in conflicts]
                conflicting_slot_ids.update(ids)
                teacher_conflicts.append({
                    "type": "teacher",
                    "day": day,
                    "slot_number": slot_number,
                    "teacher_id": tid,
                    "slot_ids": ids,
                    "count": len(conflicts),
                })

        # 3. تعارض القاعة: نفس room_id (🆕 أعضاء المحاضرة المشتركة يُحسبون كواحد)
        room_groups: dict = {}
        _seen_rg: set = set()
        for s in group:
            rid = s.get("room_id", "")
            if rid:
                mg = s.get("merge_group_id")
                if mg and (rid, mg) in _seen_rg:
                    continue
                if mg:
                    _seen_rg.add((rid, mg))
                room_groups.setdefault(rid, []).append(s)
        for rid, conflicts in room_groups.items():
            if len(conflicts) > 1:
                ids = [str(c["_id"]) for c in conflicts]
                conflicting_slot_ids.update(ids)
                room_conflicts.append({
                    "type": "room",
                    "day": day,
                    "slot_number": slot_number,
                    "room_id": rid,
                    "slot_ids": ids,
                    "count": len(conflicts),
                })

    # جلب أسماء المعلمين والقاعات والأقسام لإثراء التقرير
    teacher_ids = list({c["teacher_id"] for c in teacher_conflicts})
    room_ids = list({c["room_id"] for c in room_conflicts})
    dept_ids = list({c["department_id"] for c in section_conflicts})

    teachers_map: dict = {}
    if teacher_ids:
        docs = await db.teachers.find({"_id": {"$in": [ObjectId(x) for x in teacher_ids]}}).to_list(500)
        teachers_map = {str(d["_id"]): d.get("full_name", "") for d in docs}

    rooms_map: dict = {}
    if room_ids:
        docs = await db.rooms.find({"_id": {"$in": [ObjectId(x) for x in room_ids]}}).to_list(500)
        rooms_map = {str(d["_id"]): d.get("name", "") for d in docs}

    depts_map: dict = {}
    if dept_ids:
        docs = await db.departments.find({"_id": {"$in": [ObjectId(x) for x in dept_ids]}}).to_list(100)
        depts_map = {str(d["_id"]): d.get("name", "") for d in docs}

    for c in section_conflicts:
        c["department_name"] = depts_map.get(c["department_id"], "")
    for c in teacher_conflicts:
        c["teacher_name"] = teachers_map.get(c["teacher_id"], "")
    for c in room_conflicts:
        c["room_name"] = rooms_map.get(c["room_id"], "")

    all_conflicts = section_conflicts + teacher_conflicts + room_conflicts

    return {
        "total_conflicts": len(all_conflicts),
        "total_conflicting_slots": len(conflicting_slot_ids),
        "conflicting_slot_ids": list(conflicting_slot_ids),
        "section_conflicts": section_conflicts,
        "teacher_conflicts": teacher_conflicts,
        "room_conflicts": room_conflicts,
        "all_conflicts": all_conflicts,
    }




@router.post("/weekly-schedule")
async def create_schedule_slot(
    data: ScheduleSlotCreate,
    current_user: dict = Depends(get_current_user),
):
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()

    # === كشف التعارضات ===
    conflicts = []

    # 🆕 أهداف المحاضرة (الأساسي + المشتركة معها) — تدعم أقساماً أخرى من نفس الكلية
    targets = [(data.department_id, data.level, data.section or "")]
    for m in (data.merge_with or []):
        m_dep = (m.department_id or "").strip() or data.department_id
        if m_dep != data.department_id:
            dep_doc = await db.departments.find_one({"_id": ObjectId(m_dep)})
            if not dep_doc or dep_doc.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=400, detail="القسم المشترك غير موجود أو لا يتبع نفس الكلية")
        t = (m_dep, m.level, (m.section or "").strip())
        if t not in targets:
            targets.append(t)

    # 1. تعارض الشعبة (لكل هدف)
    for dep, lvl, sec in targets:
        existing_section = await db.weekly_schedule.find_one({
            "department_id": dep,
            "level": lvl,
            "section": sec,
            "day": data.day,
            "slot_number": data.slot_number,
        })
        if existing_section:
            c = await db.courses.find_one({"_id": ObjectId(existing_section["course_id"])})
            conflicts.append(f"تعارض شعبة: يوجد مقرر '{c.get('name', '')}' للمستوى {lvl}{f' شعبة {sec}' if sec else ''} في هذه الفترة")

    # 2. تعارض المعلم
    teacher_busy = await db.weekly_schedule.find_one({
        "teacher_id": data.teacher_id,
        "day": data.day,
        "slot_number": data.slot_number,
    })
    if teacher_busy:
        t = await db.teachers.find_one({"_id": ObjectId(data.teacher_id)})
        c = await db.courses.find_one({"_id": ObjectId(teacher_busy["course_id"])})
        conflicts.append(f"تعارض معلم: '{t.get('full_name', '')}' لديه مقرر '{c.get('name', '')}' في نفس الفترة")

    # 3. تعارض القاعة
    room_busy = await db.weekly_schedule.find_one({
        "room_id": data.room_id,
        "day": data.day,
        "slot_number": data.slot_number,
    })
    if room_busy:
        r = await db.rooms.find_one({"_id": ObjectId(data.room_id)})
        c = await db.courses.find_one({"_id": ObjectId(room_busy["course_id"])})
        conflicts.append(f"تعارض قاعة: '{r.get('name', '')}' مشغولة بمقرر '{c.get('name', '')}' في نفس الفترة")

    # 4. تعارض تفضيلات المعلم
    pref = await db.teacher_preferences.find_one({"teacher_id": data.teacher_id})
    if pref:
        # 🆕 نستخدم _is_period_unavailable الذي يدمج الشبكة الجديدة + الحقول القديمة
        if _is_period_unavailable(pref, data.day, data.slot_number):
            t = await db.teachers.find_one({"_id": ObjectId(data.teacher_id)})
            conflicts.append(f"تعارض تفضيلات: '{t.get('full_name', '')}' غير متاح يوم {data.day} في الفترة {data.slot_number}")
        # Check max daily
        daily_count = await db.weekly_schedule.count_documents({
            "teacher_id": data.teacher_id, "day": data.day
        })
        max_daily = pref.get("max_daily_lectures", 3)
        if daily_count >= max_daily:
            conflicts.append(f"تعارض تفضيلات: المعلم وصل الحد الأقصى ({max_daily} محاضرات) ليوم {data.day}")

    if conflicts:
        raise HTTPException(status_code=409, detail={"message": "يوجد تعارضات", "conflicts": conflicts})

    base = data.dict()
    base.pop("merge_with", None)
    base["created_at"] = datetime.now(timezone.utc)
    base["created_by"] = current_user["id"]

    # 🆕 محاضرة مشتركة: وثيقة لكل هدف بمعرّف مجموعة موحد
    merge_gid = uuid.uuid4().hex if len(targets) > 1 else None
    docs = []
    for dep, lvl, sec in targets:
        d = {**base, "department_id": dep, "level": lvl, "section": sec}
        if merge_gid:
            d["merge_group_id"] = merge_gid
            d["merge_key"] = f"{merge_gid}:{dep}:{lvl}:{sec}"
        docs.append(d)

    try:
        result = await db.weekly_schedule.insert_many(docs) if len(docs) > 1 else None
        if result is None:
            single = await db.weekly_schedule.insert_one(docs[0])
            inserted_id = str(single.inserted_id)
        else:
            inserted_id = str(result.inserted_ids[0])
    except DuplicateKeyError as e:
        # 🔒 خط الدفاع الأخير: MongoDB رفض الحفظ لتعارض فريد.
        # هذا يحدث فقط إن أفلت التعارض من الفحوصات السابقة (race condition نادر أو بيانات قديمة).
        idx_name = str(getattr(e, "details", {}).get("keyPattern", ""))
        if "teacher" in idx_name:
            msg = "تعارض معلم: هذا المعلم لديه محاضرة أخرى في نفس اليوم والفترة"
        elif "room" in idx_name:
            msg = "تعارض قاعة: هذه القاعة محجوزة في نفس اليوم والفترة"
        elif "section" in idx_name or "department" in idx_name:
            msg = "تعارض شعبة: هذه الشعبة لديها محاضرة أخرى في نفس اليوم والفترة"
        else:
            msg = "تعارض في الجدول (تكرار مرفوض من قاعدة البيانات)"
        raise HTTPException(status_code=409, detail={"message": msg, "conflicts": [msg]})
    msg = "تم إضافة المحاضرة في الجدول"
    if merge_gid:
        n_depts = len({dep for dep, _, _ in targets})
        msg = f"تم إضافة المحاضرة المشتركة في جداول {len(targets)} من المستويات/الشعب"
        if n_depts > 1:
            msg += f" عبر {n_depts} أقسام"
    # ⏱ حلحلة أوقات اليوم (قد تُزاح المحاضرة الجديدة إذا سبقتها محاضرة ممتدة)
    shifted = await _resolve_day_times(db, data.faculty_id, data.day)
    msg += _shift_summary(shifted)
    return {"id": inserted_id, "merge_group_id": merge_gid, "message": msg, "shifted": shifted}


@router.put("/weekly-schedule/{slot_id}")
async def update_schedule_slot(
    slot_id: str,
    data: ScheduleSlotUpdate,
    current_user: dict = Depends(get_current_user),
):
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    existing = await db.weekly_schedule.find_one({"_id": ObjectId(slot_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="غير موجود")

    update = {k: v for k, v in data.dict().items() if v is not None}
    clear_duration = update.get("duration_minutes") == 0
    if clear_duration:
        update.pop("duration_minutes")
    if not update and not clear_duration:
        raise HTTPException(status_code=400, detail="لا توجد بيانات")

    # Check conflicts for new values
    # 🔒 نستخدم القيم الجديدة إن أُرسلت، وإلا القيم القديمة
    check_day = update.get("day", existing["day"])
    check_slot = update.get("slot_number", existing["slot_number"])
    check_teacher = update.get("teacher_id", existing.get("teacher_id"))
    check_room = update.get("room_id", existing.get("room_id"))
    check_dept = update.get("department_id", existing.get("department_id"))
    check_level = update.get("level", existing.get("level"))
    check_section = update.get("section", existing.get("section", ""))

    # تعارض الشعبة إن تغيّر أي حقل مؤثر
    _mg = existing.get("merge_group_id")
    _mg_excl = {"merge_group_id": {"$ne": _mg}} if _mg else {}
    if any(k in update for k in ("day", "slot_number", "department_id", "level", "section")):
        section_busy = await db.weekly_schedule.find_one({
            "_id": {"$ne": ObjectId(slot_id)},
            **_mg_excl,
            "department_id": check_dept,
            "level": check_level,
            "section": check_section,
            "day": check_day,
            "slot_number": check_slot,
        })
        if section_busy:
            raise HTTPException(status_code=409, detail="تعارض: يوجد محاضرة أخرى لنفس الشعبة في هذه الفترة")

    if check_teacher and any(k in update for k in ("teacher_id", "day", "slot_number")):
        teacher_busy = await db.weekly_schedule.find_one({
            "_id": {"$ne": ObjectId(slot_id)},
            **_mg_excl,
            "teacher_id": check_teacher,
            "day": check_day,
            "slot_number": check_slot,
        })
        if teacher_busy:
            raise HTTPException(status_code=409, detail="تعارض: المعلم لديه محاضرة أخرى في نفس الفترة")

    if check_room and any(k in update for k in ("room_id", "day", "slot_number")):
        room_busy = await db.weekly_schedule.find_one({
            "_id": {"$ne": ObjectId(slot_id)},
            **_mg_excl,
            "room_id": check_room,
            "day": check_day,
            "slot_number": check_slot,
        })
        if room_busy:
            raise HTTPException(status_code=409, detail="تعارض: القاعة مشغولة في نفس الفترة")

    teacher_changed = "teacher_id" in update and update["teacher_id"] != existing.get("teacher_id")

    # 🔄 (جدول ← نظام) تغيير الأستاذ يحدّث إسناد المقرر كاملاً + العبء التدريسي
    # (يُنفَّذ قبل تحديث الخلية: لو وُجد تعارض في بقية الخلايا يُرفض الطلب كاملاً دون أي كتابة)
    cascade_msg = ""
    if teacher_changed:
        cascade_msg = await _cascade_slot_teacher_to_course(db, existing, slot_id, update["teacher_id"], current_user)

    try:
        if update:
            await db.weekly_schedule.update_one({"_id": ObjectId(slot_id)}, {"$set": update})
        # ⏱ إزالة المدة المخصصة (العودة لمدة الفترة)
        if clear_duration:
            _dq = {"merge_group_id": _mg} if _mg else {"_id": ObjectId(slot_id)}
            await db.weekly_schedule.update_many(_dq, {"$unset": {"duration_minutes": ""}})
        # 🆕 محاضرة مشتركة: المقرر/المعلم/القاعة/المدة تسري على كل المجموعة
        if _mg:
            shared = {k: v for k, v in update.items() if k in ("course_id", "teacher_id", "room_id", "duration_minutes")}
            if shared:
                await db.weekly_schedule.update_many(
                    {"merge_group_id": _mg, "_id": {"$ne": ObjectId(slot_id)}}, {"$set": shared})
    except DuplicateKeyError as e:
        idx_name = str(getattr(e, "details", {}).get("keyPattern", ""))
        if "teacher" in idx_name:
            msg = "تعارض معلم: هذا المعلم لديه محاضرة أخرى في نفس اليوم والفترة"
        elif "room" in idx_name:
            msg = "تعارض قاعة: هذه القاعة محجوزة في نفس اليوم والفترة"
        elif "section" in idx_name or "department" in idx_name:
            msg = "تعارض شعبة: هذه الشعبة لديها محاضرة أخرى في نفس اليوم والفترة"
        else:
            msg = "تعارض في الجدول (تكرار مرفوض من قاعدة البيانات)"
        raise HTTPException(status_code=409, detail=msg)

    message = "تم التحديث" + cascade_msg

    # 🔄 (جدول ← نظام) تغيير الموقع/القاعة يتبعه تحديث المحاضرات اليومية المستقبلية
    moved = {}
    if "day" in update and update["day"] != existing.get("day"):
        moved["new_day"] = update["day"]
    if "slot_number" in update and update["slot_number"] != existing.get("slot_number"):
        moved["new_slot_number"] = update["slot_number"]
    if "room_id" in update and update["room_id"] != existing.get("room_id"):
        moved["new_room_id"] = update["room_id"]
    if moved:
        sync = await _sync_future_lectures(db, existing, "move", **moved)
        message += _sync_summary(sync)

    # ⏱ حلحلة أوقات الأيام المتأثرة (إزاحة متسلسلة بدون نقل أو حذف)
    days_to_resolve = {existing.get("day")}
    if "day" in update:
        days_to_resolve.add(update["day"])
    shifted = []
    for d in days_to_resolve:
        shifted += await _resolve_day_times(db, existing.get("faculty_id", ""), d)
    if "duration_minutes" in update or clear_duration:
        message += _shift_summary(shifted)
        if clear_duration and not shifted:
            message += " — عادت الأوقات الافتراضية"

    # ⚖️ فحص تجاوز الساعات الأسبوعية المعتمدة للمقرر (بعد تعديل المدة)
    load_check = None
    if "duration_minutes" in update:
        fresh = await db.weekly_schedule.find_one({"_id": ObjectId(slot_id)})
        if fresh:
            load_check = await _course_week_balance(db, fresh)
        if load_check and load_check["excess_minutes"] > 0:
            message += f" ⚠️ تجاوز الخطة الأسبوعية: {load_check['scheduled_minutes']}د مدرجة / {load_check['plan_minutes']}د معتمدة"

    return {"message": message, "shifted": shifted, "load_check": load_check}


class RebalanceChange(BaseModel):
    slot_id: str
    duration_minutes: int


class ApplyRebalanceRequest(BaseModel):
    changes: List[RebalanceChange]


@router.post("/weekly-schedule/apply-rebalance")
async def apply_rebalance(
    data: ApplyRebalanceRequest,
    current_user: dict = Depends(get_current_user),
):
    """⚖️ تطبيق موازنة الساعات الأسبوعية: إنقاص مدد محاضرات المقرر الأخرى دون المساس بغير ذلك"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    applied = []
    days = set()
    faculty_id = ""
    for ch in data.changes:
        try:
            s = await db.weekly_schedule.find_one({"_id": ObjectId(ch.slot_id)})
        except Exception:
            s = None
        if not s:
            continue
        dur = max(30, min(300, int(ch.duration_minutes)))
        q = {"merge_group_id": s["merge_group_id"]} if s.get("merge_group_id") else {"_id": s["_id"]}
        await db.weekly_schedule.update_many(q, {"$set": {"duration_minutes": dur}})
        days.add(s.get("day"))
        faculty_id = s.get("faculty_id", "") or faculty_id
        applied.append({"slot_id": ch.slot_id, "day": s.get("day", ""), "slot_number": s.get("slot_number"), "duration_minutes": dur})
    shifted = []
    for d in days:
        shifted += await _resolve_day_times(db, faculty_id, d)
    msg = f"⚖️ تمت الموازنة: تعديل مدة {len(applied)} محاضرة لتوافق الساعات المعتمدة" + _shift_summary(shifted)
    return {"message": msg, "applied": applied, "shifted": shifted}


@router.delete("/weekly-schedule/{slot_id}")
async def delete_schedule_slot(
    slot_id: str,
    current_user: dict = Depends(get_current_user),
):
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    slot = await db.weekly_schedule.find_one({"_id": ObjectId(slot_id)})
    await db.weekly_schedule.delete_one({"_id": ObjectId(slot_id)})
    message = "تم الحذف"
    if slot:
        # 🆕 محاضرة مشتركة: الحذف يسري على كل المجموعة
        if slot.get("merge_group_id"):
            siblings = await db.weekly_schedule.find({"merge_group_id": slot["merge_group_id"]}).to_list(50)
            if siblings:
                await db.weekly_schedule.delete_many({"merge_group_id": slot["merge_group_id"]})
                for sib in siblings:
                    await _sync_future_lectures(db, sib, "delete")
                message = f"تم حذف المحاضرة المشتركة من {len(siblings) + 1} جدول"
        # 🔄 (جدول ← نظام) حذف المحاضرات اليومية المستقبلية المولّدة من هذه الخلية
        sync = await _sync_future_lectures(db, slot, "delete")
        message += _sync_summary(sync)
        # ⏱ إعادة حساب أوقات اليوم (فك الإزاحات المرتبطة بالمحاضرة المحذوفة)
        await _resolve_day_times(db, slot.get("faculty_id", ""), slot.get("day", ""))
    return {"message": message}


@router.delete("/weekly-schedule/clear/all")
async def clear_schedule(
    faculty_id: Optional[str] = None,
    department_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """مسح كامل الجدول أو جدول كلية/قسم"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    query = {}
    if faculty_id:
        query["faculty_id"] = faculty_id
    if department_id:
        query["department_id"] = department_id
    result = await db.weekly_schedule.delete_many(query)
    return {"message": f"تم حذف {result.deleted_count} خانة"}


# ===== التوليد شبه التلقائي =====

@router.post("/weekly-schedule/auto-generate")
async def auto_generate_schedule(
    faculty_id: str,
    department_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """توليد جدول تلقائي مع مراعاة التعارضات والتفضيلات"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")

    db = get_db()

    # Get settings (faculty-specific or global)
    settings = await db.schedule_settings.find_one({"_id": f"faculty_{faculty_id}"})
    if not settings:
        settings = await db.schedule_settings.find_one({"_id": "global"})
    if not settings:
        raise HTTPException(status_code=400, detail="يرجى إعداد الفترات الزمنية أولاً")

    time_slots = settings.get("time_slots", [])
    working_days = settings.get("working_days", [])
    if not time_slots:
        raise HTTPException(status_code=400, detail="يرجى إعداد الفترات الزمنية أولاً — تبويب «الفترات» ثم حفظ")
    if not working_days:
        raise HTTPException(status_code=400, detail="أيام العمل غير محددة — افتح تبويب «الفترات»، حدد أيام العمل ثم احفظ")

    slot_numbers = sorted([s["slot_number"] for s in time_slots])

    # Get departments
    dept_query = {"faculty_id": faculty_id, "is_active": {"$ne": False}}
    if department_id:
        dept_query["_id"] = ObjectId(department_id)
    departments = await db.departments.find(dept_query).to_list(100)

    # Get rooms for this faculty only
    rooms = await db.rooms.find({"is_active": True, "faculty_id": faculty_id}).to_list(200)
    if not rooms:
        raise HTTPException(status_code=400, detail="لا توجد قاعات مسجلة لهذه الكلية. أضف قاعات أولاً من تبويب 'القاعات'")

    # Get teacher preferences
    all_prefs = await db.teacher_preferences.find().to_list(500)
    prefs_map = {p["teacher_id"]: p for p in all_prefs}

    # Track occupancy: (day, slot) -> set of teacher_ids, room_ids
    teacher_occupied = {}  # (day, slot) -> set of teacher_ids
    room_occupied = {}     # (day, slot) -> set of room_ids
    section_occupied = {}  # (dept_id, level, section, day, slot) -> True
    teacher_daily_count = {}  # (teacher_id, day) -> count
    teacher_day_slots = {}  # (teacher_id, day) -> set of slot_numbers (to detect consecutive)

    # Load existing schedule to avoid conflicts.
    # 🔒 المعلم قد يُدرِّس في كليات متعددة → نحمّل الجدول عالمياً لتعارض المعلم.
    # القاعات والشعب محلية بالكلية فقط.
    existing_global = await db.weekly_schedule.find({}).to_list(20000)
    for e in existing_global:
        key = (e["day"], e["slot_number"])
        # tracking عالمي للمعلم (يشمل كل الكليات)
        if e.get("teacher_id"):
            teacher_occupied.setdefault(key, set()).add(e["teacher_id"])
            dk = (e["teacher_id"], e["day"])
            teacher_daily_count[dk] = teacher_daily_count.get(dk, 0) + 1
            teacher_day_slots.setdefault(dk, set()).add(e["slot_number"])
        # tracking محلي للقاعة والشعبة (مقيّد بالكلية الحالية)
        if e.get("faculty_id") == faculty_id:
            if e.get("room_id"):
                room_occupied.setdefault(key, set()).add(e["room_id"])
            sk = (e["department_id"], e["level"], e.get("section", ""), e["day"], e["slot_number"])
            section_occupied[sk] = True

    created = 0
    skipped = 0
    errors = []

    for dept in departments:
        dept_id = str(dept["_id"])

        # Get courses for this department
        courses = await db.courses.find({
            "department_id": dept_id, "is_active": True, "teacher_id": {"$ne": None}
        }).to_list(500)

        # Group by (level, section)
        groups = {}
        for c in courses:
            key = (c.get("level", 1), c.get("section", ""))
            groups.setdefault(key, []).append(c)

        for (level, section), group_courses in groups.items():
            for course in group_courses:
                cid = str(course["_id"])
                tid = course.get("teacher_id", "")
                credit = course.get("credit_hours", 3)

                # عدد المحاضرات المطلوبة
                if credit <= 2:
                    needed = 1
                elif credit <= 3:
                    needed = 2
                else:
                    needed = 3

                # Check if already scheduled
                existing_count = await db.weekly_schedule.count_documents({
                    "course_id": cid, "department_id": dept_id,
                    "level": level, "section": section,
                })
                needed -= existing_count
                if needed <= 0:
                    continue

                pref = prefs_map.get(tid, {})
                max_daily = pref.get("max_daily_lectures", 3)
                allow_consecutive = pref.get("allow_consecutive_lectures", True)

                placed = 0
                # 🆕 أولوية التوليد: الفترات المبكرة (1-3) عبر كل الأيام أولاً، ثم المتأخرة (4+) إن تعذر
                early_slots = [s for s in slot_numbers if s <= 3]
                late_slots = [s for s in slot_numbers if s > 3]
                for slot_pool in [early_slots, late_slots]:
                    if placed >= needed or not slot_pool:
                        continue
                    for day in working_days:
                        if placed >= needed:
                            break
                        # 🆕 تجاوز اليوم إن كانت كل خلاياه محظورة (يوم كامل بلغة الشبكة)
                        if all(_is_period_unavailable(pref, day, sn) for sn in slot_numbers):
                            continue

                        for sn in slot_pool:
                            if placed >= needed:
                                break
                            # 🆕 فحص الخلية (يوم × فترة) عبر الشبكة الجديدة + توافق رجعي
                            if _is_period_unavailable(pref, day, sn):
                                continue

                            key_ts = (day, sn)
                            sk = (dept_id, level, section, day, sn)

                            # Check section free
                            if sk in section_occupied:
                                continue
                            # Check teacher free
                            if tid in teacher_occupied.get(key_ts, set()):
                                continue
                            # Check teacher daily limit
                            dk = (tid, day)
                            if teacher_daily_count.get(dk, 0) >= max_daily:
                                continue
                            # Check consecutive slots
                            taken_slots = teacher_day_slots.get(dk, set())
                            if not allow_consecutive:
                                if (sn - 1) in taken_slots or (sn + 1) in taken_slots:
                                    continue
                            else:
                                # 🆕 التتالي مسموح لمحاضرتين فقط — منع تكوين 3 محاضرات متتالية
                                if (((sn - 1) in taken_slots and (sn - 2) in taken_slots)
                                        or ((sn + 1) in taken_slots and (sn + 2) in taken_slots)
                                        or ((sn - 1) in taken_slots and (sn + 1) in taken_slots)):
                                    continue

                            # Find free room
                            busy_rooms = room_occupied.get(key_ts, set())
                            free_room = None
                            for room in rooms:
                                if str(room["_id"]) not in busy_rooms:
                                    free_room = room
                                    break
                            if not free_room:
                                continue

                            rid = str(free_room["_id"])

                            # Place it!
                            doc = {
                                "faculty_id": faculty_id,
                                "department_id": dept_id,
                                "level": level,
                                "section": section,
                                "day": day,
                                "slot_number": sn,
                                "course_id": cid,
                                "teacher_id": tid,
                                "room_id": rid,
                                "created_at": datetime.now(timezone.utc),
                                "created_by": current_user["id"],
                                "auto_generated": True,
                            }
                            try:
                                await db.weekly_schedule.insert_one(doc)
                            except DuplicateKeyError:
                                # فهرس DB منع التكرار (حماية إضافية) — تجاوز هذه الخلية
                                skipped += 1
                                continue

                            # Update tracking
                            teacher_occupied.setdefault(key_ts, set()).add(tid)
                            room_occupied.setdefault(key_ts, set()).add(rid)
                            section_occupied[sk] = True
                            teacher_daily_count[dk] = teacher_daily_count.get(dk, 0) + 1
                            teacher_day_slots.setdefault(dk, set()).add(sn)

                            created += 1
                            placed += 1

                if placed < needed:
                    remaining = needed - placed
                    errors.append(f"{course.get('name', '')} ({course.get('code', '')}): لم يتم جدولة {remaining} محاضرة")

    return {
        "message": f"تم إنشاء {created} محاضرة في الجدول",
        "created": created,
        "errors": errors,
    }


# ============================================================
# Schedule Drafts - نسخ احتياطية مؤقتة للجدول للمقارنة
# ============================================================


class SaveDraftRequest(BaseModel):
    name: str
    faculty_id: Optional[str] = None
    department_id: Optional[str] = None
    semester_id: Optional[str] = None
    notes: Optional[str] = ""


@router.get("/weekly-schedule/drafts")
async def list_drafts(current_user: dict = Depends(get_current_user)):
    """قائمة نسخ الجدول المحفوظة"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    drafts = await db.weekly_schedule_drafts.find({}).sort("created_at", -1).to_list(50)
    result = []
    for d in drafts:
        result.append({
            "id": str(d["_id"]),
            "name": d.get("name", ""),
            "notes": d.get("notes", ""),
            "slots_count": len(d.get("slots", [])),
            "faculty_id": d.get("faculty_id"),
            "department_id": d.get("department_id"),
            "semester_id": d.get("semester_id"),
            "created_at": d.get("created_at").isoformat() if d.get("created_at") else None,
            "created_by_name": d.get("created_by_name", ""),
        })
    return result


@router.post("/weekly-schedule/drafts")
async def save_draft(req: SaveDraftRequest, current_user: dict = Depends(get_current_user)):
    """حفظ snapshot للجدول الحالي كنسخة احتياطية"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    query = {}
    if req.faculty_id:
        query["faculty_id"] = req.faculty_id
    if req.department_id:
        query["department_id"] = req.department_id
    if req.semester_id:
        query["semester_id"] = req.semester_id

    slots = await db.weekly_schedule.find(query).to_list(5000)
    clean_slots = []
    for s in slots:
        c = {k: v for k, v in s.items() if k != "_id"}
        c["_orig_id"] = str(s["_id"])
        clean_slots.append(c)

    draft_doc = {
        "name": req.name.strip() or f"نسخة {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
        "notes": req.notes or "",
        "slots": clean_slots,
        "faculty_id": req.faculty_id,
        "department_id": req.department_id,
        "semester_id": req.semester_id,
        "created_at": datetime.now(timezone.utc),
        "created_by": current_user.get("id"),
        "created_by_name": current_user.get("full_name", current_user.get("username", "")),
    }
    result = await db.weekly_schedule_drafts.insert_one(draft_doc)

    # حذف النسخ القديمة (الإبقاء على آخر 10 لكل نطاق)
    scope_query = {
        "faculty_id": req.faculty_id,
        "department_id": req.department_id,
        "semester_id": req.semester_id,
    }
    all_in_scope = await db.weekly_schedule_drafts.find(scope_query).sort("created_at", -1).to_list(100)
    if len(all_in_scope) > 10:
        for old in all_in_scope[10:]:
            await db.weekly_schedule_drafts.delete_one({"_id": old["_id"]})

    return {
        "id": str(result.inserted_id),
        "message": f"تم حفظ النسخة ({len(clean_slots)} محاضرة)",
        "slots_count": len(clean_slots),
    }


@router.delete("/weekly-schedule/drafts/{draft_id}")
async def delete_draft(draft_id: str, current_user: dict = Depends(get_current_user)):
    """حذف نسخة احتياطية"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    result = await db.weekly_schedule_drafts.delete_one({"_id": ObjectId(draft_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="النسخة غير موجودة")
    return {"message": "تم حذف النسخة"}


@router.post("/weekly-schedule/drafts/{draft_id}/restore")
async def restore_draft(
    draft_id: str,
    backup_current: bool = True,
    backup_name: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """استرجاع نسخة (تحل محل الجدول الحالي في نفس النطاق)
    قبل الاستبدال، يتم حفظ الجدول الحالي تلقائياً كنسخة احتياطية (backup_current=True افتراضياً)،
    حتى لا تُفقد النسخة الحالية أبداً.
    """
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    draft = await db.weekly_schedule_drafts.find_one({"_id": ObjectId(draft_id)})
    if not draft:
        raise HTTPException(status_code=404, detail="النسخة غير موجودة")

    query = {}
    if draft.get("faculty_id"):
        query["faculty_id"] = draft["faculty_id"]
    if draft.get("department_id"):
        query["department_id"] = draft["department_id"]
    if draft.get("semester_id"):
        query["semester_id"] = draft["semester_id"]

    # 1) حفظ الجدول الحالي تلقائياً كنسخة احتياطية قبل الاستبدال
    backup_id = None
    backup_slots_count = 0
    if backup_current:
        current_slots = await db.weekly_schedule.find(query).to_list(5000)
        if current_slots:
            backup_clean = []
            for s in current_slots:
                c = {k: v for k, v in s.items() if k != "_id"}
                c["_orig_id"] = str(s["_id"])
                backup_clean.append(c)
            auto_name = backup_name or f"نسخة تلقائية قبل استعادة \"{draft.get('name','')}\" - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
            backup_doc = {
                "name": auto_name,
                "notes": f"تم إنشاؤها تلقائياً قبل استعادة النسخة {draft.get('name','')}",
                "slots": backup_clean,
                "faculty_id": draft.get("faculty_id"),
                "department_id": draft.get("department_id"),
                "semester_id": draft.get("semester_id"),
                "created_at": datetime.now(timezone.utc),
                "created_by": current_user.get("id"),
                "created_by_name": current_user.get("full_name", current_user.get("username", "")),
                "auto_backup": True,
                "restored_from": str(draft["_id"]),
            }
            res = await db.weekly_schedule_drafts.insert_one(backup_doc)
            backup_id = str(res.inserted_id)
            backup_slots_count = len(backup_clean)

    # 2) استبدال الجدول الحالي بمحتوى النسخة المختارة
    deleted = await db.weekly_schedule.delete_many(query)
    inserted = 0
    for slot in draft.get("slots", []):
        slot_copy = {k: v for k, v in slot.items() if k != "_orig_id"}
        await db.weekly_schedule.insert_one(slot_copy)
        inserted += 1

    return {
        "message": f"تم استرجاع النسخة: حذف {deleted.deleted_count} وإضافة {inserted}",
        "deleted": deleted.deleted_count,
        "inserted": inserted,
        "backup_id": backup_id,
        "backup_slots_count": backup_slots_count,
        "backup_created": backup_id is not None,
    }


@router.get("/weekly-schedule/drafts/{draft_id}/compare")
async def compare_draft(draft_id: str, current_user: dict = Depends(get_current_user)):
    """مقارنة النسخة المحفوظة بالجدول الحالي - مقارنة حقيقية slot-by-slot
    تُرجع:
      - added: محاضرات موجودة في الحالي وغير موجودة في النسخة (مضافة بعد حفظ النسخة)
      - removed: محاضرات موجودة في النسخة وغير موجودة في الحالي (حُذفت)
      - changed: محاضرات بنفس المعرف (course/day/slot/section) لكن تغير فيها شيء (المعلم/القاعة)
      - unchanged_count: عدد المحاضرات المتطابقة
    """
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    draft = await db.weekly_schedule_drafts.find_one({"_id": ObjectId(draft_id)})
    if not draft:
        raise HTTPException(status_code=404, detail="النسخة غير موجودة")

    query = {}
    if draft.get("faculty_id"):
        query["faculty_id"] = draft["faculty_id"]
    if draft.get("department_id"):
        query["department_id"] = draft["department_id"]
    if draft.get("semester_id"):
        query["semester_id"] = draft["semester_id"]
    current_slots_raw = await db.weekly_schedule.find(query).to_list(5000)

    # تطبيع: نزع _id وتحويل التواريخ
    def normalize(slots):
        out = []
        for s in slots:
            c = {k: v for k, v in s.items() if k not in ("_id", "_orig_id", "created_at", "updated_at")}
            out.append(c)
        return out

    draft_slots = normalize(draft.get("slots", []))
    current_slots = normalize(current_slots_raw)

    # ====== إثراء الـ slots بالأسماء (الـ DB يخزن IDs فقط) ======
    all_course_ids = set()
    all_teacher_ids = set()
    all_room_ids = set()
    all_dept_ids = set()
    for s in draft_slots + current_slots:
        if s.get("course_id"): all_course_ids.add(s["course_id"])
        if s.get("teacher_id"): all_teacher_ids.add(s["teacher_id"])
        if s.get("room_id"): all_room_ids.add(s["room_id"])
        if s.get("department_id"): all_dept_ids.add(s["department_id"])

    courses_map, teachers_map, rooms_map, depts_map = {}, {}, {}, {}
    if all_course_ids:
        async for d in db.courses.find({"_id": {"$in": [ObjectId(x) for x in all_course_ids]}}):
            courses_map[str(d["_id"])] = d
    if all_teacher_ids:
        async for d in db.teachers.find({"_id": {"$in": [ObjectId(x) for x in all_teacher_ids]}}):
            teachers_map[str(d["_id"])] = d
    if all_room_ids:
        async for d in db.rooms.find({"_id": {"$in": [ObjectId(x) for x in all_room_ids]}}):
            rooms_map[str(d["_id"])] = d
    if all_dept_ids:
        async for d in db.departments.find({"_id": {"$in": [ObjectId(x) for x in all_dept_ids]}}):
            depts_map[str(d["_id"])] = d

    def attach_names(s):
        course = courses_map.get(s.get("course_id", ""), {})
        teacher = teachers_map.get(s.get("teacher_id", ""), {})
        room = rooms_map.get(s.get("room_id", ""), {})
        dept = depts_map.get(s.get("department_id", ""), {})
        s["course_name"] = s.get("course_name") or course.get("name", "")
        s["course_code"] = s.get("course_code") or course.get("code", "")
        s["teacher_name"] = s.get("teacher_name") or teacher.get("full_name", "")
        s["room_name"] = s.get("room_name") or room.get("name", "")
        s["department_name"] = s.get("department_name") or dept.get("name", "")
        return s

    draft_slots = [attach_names(s) for s in draft_slots]
    current_slots = [attach_names(s) for s in current_slots]

    # مفتاح هوية المحاضرة (يحدد "نفس الخانة") - يدعم day أو day_of_week
    def slot_key(s):
        return (
            str(s.get("course_id", "")),
            str(s.get("day") or s.get("day_of_week") or ""),
            int(s.get("slot_number", 0) or 0),
            str(s.get("section", "") or ""),
            int(s.get("level", 0) or 0),
        )

    # حقول مقارنة المحتوى (ما الذي يمكن أن يتغير)
    COMPARE_FIELDS = ["teacher_id", "teacher_name", "room_id", "room_name", "notes"]

    draft_map = {slot_key(s): s for s in draft_slots}
    current_map = {slot_key(s): s for s in current_slots}

    draft_keys = set(draft_map.keys())
    current_keys = set(current_map.keys())

    added_keys = current_keys - draft_keys      # في الحالي فقط = أُضيفت
    removed_keys = draft_keys - current_keys    # في النسخة فقط = حُذفت
    common_keys = draft_keys & current_keys

    def enrich(s):
        return {
            "course_id": s.get("course_id"),
            "course_code": s.get("course_code"),
            "course_name": s.get("course_name"),
            "day_of_week": s.get("day") or s.get("day_of_week"),
            "slot_number": s.get("slot_number"),
            "section": s.get("section"),
            "level": s.get("level"),
            "teacher_id": s.get("teacher_id"),
            "teacher_name": s.get("teacher_name"),
            "room_id": s.get("room_id"),
            "room_name": s.get("room_name"),
            "department_name": s.get("department_name"),
            "faculty_name": s.get("faculty_name"),
        }

    added = [enrich(current_map[k]) for k in added_keys]
    removed = [enrich(draft_map[k]) for k in removed_keys]

    changed = []
    unchanged_count = 0
    for k in common_keys:
        d = draft_map[k]
        c = current_map[k]
        diffs = {}
        for f in COMPARE_FIELDS:
            if (d.get(f) or "") != (c.get(f) or ""):
                diffs[f] = {"draft": d.get(f), "current": c.get(f)}
        if diffs:
            changed.append({**enrich(c), "diffs": diffs})
        else:
            unchanged_count += 1

    # ترتيب موحّد لسهولة العرض
    def sort_key(x):
        return (x.get("day_of_week") or "", x.get("slot_number") or 0, x.get("course_code") or "")
    added.sort(key=sort_key)
    removed.sort(key=sort_key)
    changed.sort(key=sort_key)

    def stats(slots):
        teachers, rooms, courses = set(), set(), set()
        by_day = {}
        for s in slots:
            if s.get("teacher_id"): teachers.add(s["teacher_id"])
            if s.get("room_id"): rooms.add(s["room_id"])
            if s.get("course_id"): courses.add(s["course_id"])
            day = s.get("day") or s.get("day_of_week")
            if day:
                by_day[day] = by_day.get(day, 0) + 1
        return {
            "total_slots": len(slots),
            "teachers_count": len(teachers),
            "rooms_count": len(rooms),
            "courses_count": len(courses),
            "by_day": by_day,
        }

    return {
        "draft_name": draft.get("name", ""),
        "draft_created_at": draft.get("created_at").isoformat() if draft.get("created_at") else None,
        "draft_stats": stats(draft_slots),
        "current_stats": stats(current_slots),
        "diff": {
            "added": added,
            "added_count": len(added),
            "removed": removed,
            "removed_count": len(removed),
            "changed": changed,
            "changed_count": len(changed),
            "unchanged_count": unchanged_count,
        },
    }


# ============================================================
# Visual Export - تصدير مرئي للجدول (PDF + Excel)
# ============================================================

@router.get("/weekly-schedule/export-visual/pdf")
async def export_visual_pdf(
    faculty_id: Optional[str] = None,
    department_id: Optional[str] = None,
    level: Optional[int] = None,
    section: Optional[str] = None,
    teacher_id: Optional[str] = None,
    room_id: Optional[str] = None,
    semester_id: Optional[str] = None,
    per_teacher: bool = False,
    current_user: dict = Depends(get_current_user),
):
    """تصدير PDF بتصميم بصري احترافي حسب الفلاتر"""
    try:
        from reportlab.lib.pagesizes import landscape, A4
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        import arabic_reshaper
        from bidi.algorithm import get_display
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"مكتبة PDF غير مثبتة: {e}")

    db = get_db()

    try:
        import os as _os
        _font_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "fonts", "Amiri-Regular.ttf")
        pdfmetrics.registerFont(TTFont("Amiri", _font_path))
        font_name = "Amiri"
    except Exception:
        font_name = "Helvetica"

    def ar(text):
        if not text:
            return ""
        try:
            return get_display(arabic_reshaper.reshape(str(text)))
        except Exception:
            return str(text)

    query = {}
    if faculty_id: query["faculty_id"] = faculty_id
    if department_id: query["department_id"] = department_id
    if level is not None: query["level"] = level
    if section: query["section"] = section
    if teacher_id: query["teacher_id"] = teacher_id
    if room_id: query["room_id"] = room_id
    if semester_id: query["semester_id"] = semester_id

    slots = await db.weekly_schedule.find(query).to_list(5000)

    settings = None
    if faculty_id:
        settings = await db.schedule_settings.find_one({"_id": f"faculty_{faculty_id}"})
    if not settings:
        settings = await db.schedule_settings.find_one({"_id": "global"})
    time_slots_cfg = sorted((settings or {}).get("time_slots", []), key=lambda x: x.get("slot_number", 0))
    working_days = (settings or {}).get("working_days", ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء"])

    course_ids = {s.get("course_id") for s in slots if s.get("course_id")}
    teacher_ids = {s.get("teacher_id") for s in slots if s.get("teacher_id")}
    room_ids_set = {s.get("room_id") for s in slots if s.get("room_id")}

    courses_map = {}
    if course_ids:
        async for c in db.courses.find({"_id": {"$in": [ObjectId(x) for x in course_ids if x]}}):
            courses_map[str(c["_id"])] = c
    teachers_map = {}
    if teacher_ids:
        async for t in db.teachers.find({"_id": {"$in": [ObjectId(x) for x in teacher_ids if x]}}):
            teachers_map[str(t["_id"])] = t
    rooms_map = {}
    if room_ids_set:
        async for r in db.rooms.find({"_id": {"$in": [ObjectId(x) for x in room_ids_set if x]}}):
            rooms_map[str(r["_id"])] = r

    title_parts = ["الجدول الأسبوعي"]
    if teacher_id and teacher_id in teachers_map:
        title_parts.append(f"للأستاذ: {teachers_map[teacher_id].get('full_name', '')}")
    if room_id and room_id in rooms_map:
        title_parts.append(f"للقاعة: {rooms_map[room_id].get('name', '')}")
    if department_id:
        dept = await db.departments.find_one({"_id": ObjectId(department_id)})
        if dept:
            title_parts.append(f"قسم: {dept.get('name', '')}")
    if level is not None:
        title_parts.append(f"المستوى {level}")
    if section:
        title_parts.append(f"شعبة {section}")
    title = " - ".join(title_parts)
    if semester_id:
        sem = await db.semesters.find_one({"_id": ObjectId(semester_id)})
        if sem:
            title += f" | {sem.get('name', '')} {sem.get('academic_year', '')}"

    import io
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), rightMargin=0.7*cm, leftMargin=0.7*cm, topMargin=0.7*cm, bottomMargin=0.7*cm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("Title", parent=styles["Title"], fontName=font_name, fontSize=16, alignment=1, textColor=colors.HexColor("#1565c0"))
    sub_style = ParagraphStyle("Sub", parent=styles["Normal"], fontName=font_name, fontSize=9, alignment=1, textColor=colors.grey)
    group_style = ParagraphStyle("Group", parent=styles["Normal"], fontName=font_name, fontSize=13, alignment=1, textColor=colors.HexColor("#00695c"))
    legend_style = ParagraphStyle("Legend", fontName=font_name, fontSize=8, alignment=1, textColor=colors.grey)

    from reportlab.platypus import PageBreak

    story = []
    story.append(Paragraph(ar(title), title_style))
    story.append(Paragraph(ar(f"تاريخ التصدير: {datetime.now().strftime('%Y-%m-%d %H:%M')}  |  جامعة الأحقاف"), sub_style))
    story.append(Spacer(1, 0.3*cm))

    def build_cell_map(slot_list):
        m = {}
        for s in slot_list:
            m.setdefault((s.get("day") or s.get("day_of_week"), s.get("slot_number")), []).append(s)
        return m

    def make_table(cell_map, hide_section=False, suppress_teacher=False):
        # 🔄 الأيام صفوف (عمود "اليوم" في أقصى اليمين) والفترات أعمدة في الأعلى — اتجاه يمين→يسار
        period_headers = [
            ar(f"الفترة {ts.get('slot_number')}\n{ts.get('start_time','')}\n{ts.get('end_time','')}")
            for ts in time_slots_cfg
        ]
        # PDF يرسم الأعمدة من اليسار → نعكس ترتيب الفترات ونضع عمود اليوم آخراً (أقصى اليمين)
        header_row = period_headers[::-1] + [ar("اليوم")]
        table_data = [header_row]
        for day in working_days:
            cells = []
            for ts in time_slots_cfg:
                slot_num = ts.get("slot_number")
                cell_slots = cell_map.get((day, slot_num), [])
                if not cell_slots:
                    cells.append("")
                else:
                    parts = []
                    for s in cell_slots:
                        course = courses_map.get(s.get("course_id", ""), {})
                        teacher = teachers_map.get(s.get("teacher_id", ""), {})
                        room = rooms_map.get(s.get("room_id", ""), {})
                        line = course.get("name", "") or course.get("code", "")
                        if teacher.get("full_name") and not teacher_id and not suppress_teacher:
                            line += f"\n{teacher.get('full_name','')}"
                        if room.get("name") and not room_id:
                            line += f"\n[{room.get('name','')}]"
                        _est, _een, _ch = _effective_times(s, ts.get("start_time", ""), ts.get("end_time", ""))
                        if _ch:
                            line += f"\n({_est} - {_een})"
                        sec = s.get("section")
                        if sec and not section and not hide_section:
                            line += f" - شعبة {sec}"
                        parts.append(ar(line))
                    cells.append("\n\n".join(parts))
            table_data.append(cells[::-1] + [ar(day)])

        num_cols = len(header_row)
        col_widths = [(27 - 3) / (num_cols - 1) * cm] * (num_cols - 1) + [3*cm]
        tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
        base_style = [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1565c0")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, -1), font_name),
            ("FONTSIZE", (0, 0), (-1, 0), 10),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            # عمود اليوم (أقصى اليمين = آخر عمود)
            ("BACKGROUND", (-1, 1), (-1, -1), colors.HexColor("#e3f2fd")),
            ("TEXTCOLOR", (-1, 1), (-1, -1), colors.HexColor("#0d47a1")),
            ("FONTSIZE", (-1, 1), (-1, -1), 11),
            ("BACKGROUND", (0, 1), (-2, -1), colors.HexColor("#fafafa")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#bdbdbd")),
            ("LINEBELOW", (0, 0), (-1, 0), 1.5, colors.HexColor("#1565c0")),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]
        for row_idx in range(1, len(table_data)):
            for col_idx in range(0, num_cols - 1):
                if not table_data[row_idx][col_idx]:
                    base_style.append(("BACKGROUND", (col_idx, row_idx), (col_idx, row_idx), colors.HexColor("#f5f5f5")))
        tbl.setStyle(TableStyle(base_style))
        return tbl

    # 📄 تصدير واسع (كلية/قسم كامل) → صفحة مستقلة لكل شعبة حتى لا تتكدس الخلايا وينهار البناء
    wide = not teacher_id and not room_id and not (level is not None and section)

    if per_teacher and not teacher_id and slots:
        # 👨‍🏫 جدول مستقل لكل أستاذ (صفحة لكل أستاذ)
        tgroups = {}
        for s in slots:
            tid = s.get("teacher_id") or ""
            tgroups.setdefault(tid, []).append(s)
        def _tname(tid):
            return teachers_map.get(tid, {}).get("full_name", "") or "بدون أستاذ"
        tkeys = sorted(tgroups.keys(), key=lambda k: _tname(k))
        for i, tid in enumerate(tkeys):
            story.append(Paragraph(ar(f"الأستاذ: {_tname(tid)}"), group_style))
            story.append(Spacer(1, 0.2*cm))
            story.append(make_table(build_cell_map(tgroups[tid]), suppress_teacher=True))
            story.append(Spacer(1, 0.25*cm))
            story.append(Paragraph(ar(f"عدد المحاضرات الأسبوعية: {len(tgroups[tid])}"), legend_style))
            if i < len(tkeys) - 1:
                story.append(PageBreak())
    elif wide and slots:
        dept_names = {}
        dept_ids = {s.get("department_id") for s in slots if s.get("department_id")}
        if dept_ids:
            try:
                async for dpt in db.departments.find({"_id": {"$in": [ObjectId(x) for x in dept_ids if x]}}):
                    dept_names[str(dpt["_id"])] = dpt.get("name", "")
            except Exception:
                pass
        groups = {}
        for s in slots:
            gkey = (s.get("department_id") or "", s.get("level"), s.get("section") or "")
            groups.setdefault(gkey, []).append(s)
        sorted_keys = sorted(groups.keys(), key=lambda k: (dept_names.get(k[0], ""), k[1] if k[1] is not None else 0, k[2]))
        for i, gk in enumerate(sorted_keys):
            dname = dept_names.get(gk[0], "")
            gparts = []
            if dname:
                gparts.append(f"قسم: {dname}")
            if gk[1] is not None:
                gparts.append(f"المستوى {gk[1]}")
            if gk[2]:
                gparts.append(f"شعبة {gk[2]}")
            if gparts:
                story.append(Paragraph(ar(" — ".join(gparts)), group_style))
                story.append(Spacer(1, 0.2*cm))
            story.append(make_table(build_cell_map(groups[gk]), hide_section=True))
            story.append(Spacer(1, 0.25*cm))
            story.append(Paragraph(ar(f"عدد المحاضرات: {len(groups[gk])}"), legend_style))
            if i < len(sorted_keys) - 1:
                story.append(PageBreak())
    else:
        story.append(make_table(build_cell_map(slots)))
        story.append(Spacer(1, 0.4*cm))
        story.append(Paragraph(ar(f"إجمالي المحاضرات: {len(slots)}"), legend_style))

    try:
        doc.build(story)
    except Exception as build_err:
        raise HTTPException(status_code=400, detail=f"تعذر بناء ملف PDF: {str(build_err)[:150]}")
    buf.seek(0)
    filename = f"weekly_schedule_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/weekly-schedule/export-visual/excel")
async def export_visual_excel(
    faculty_id: Optional[str] = None,
    department_id: Optional[str] = None,
    level: Optional[int] = None,
    section: Optional[str] = None,
    teacher_id: Optional[str] = None,
    room_id: Optional[str] = None,
    semester_id: Optional[str] = None,
    per_teacher: bool = False,
    current_user: dict = Depends(get_current_user),
):
    """تصدير Excel بنفس فلاتر PDF"""
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"مكتبة Excel غير مثبتة: {e}")

    db = get_db()
    query = {}
    if faculty_id: query["faculty_id"] = faculty_id
    if department_id: query["department_id"] = department_id
    if level is not None: query["level"] = level
    if section: query["section"] = section
    if teacher_id: query["teacher_id"] = teacher_id
    if room_id: query["room_id"] = room_id
    if semester_id: query["semester_id"] = semester_id

    slots = await db.weekly_schedule.find(query).to_list(5000)

    course_ids = {s.get("course_id") for s in slots if s.get("course_id")}
    teacher_ids = {s.get("teacher_id") for s in slots if s.get("teacher_id")}
    room_ids_set = {s.get("room_id") for s in slots if s.get("room_id")}

    courses_map = {}
    if course_ids:
        async for c in db.courses.find({"_id": {"$in": [ObjectId(x) for x in course_ids if x]}}):
            courses_map[str(c["_id"])] = c
    teachers_map = {}
    if teacher_ids:
        async for t in db.teachers.find({"_id": {"$in": [ObjectId(x) for x in teacher_ids if x]}}):
            teachers_map[str(t["_id"])] = t
    rooms_map = {}
    if room_ids_set:
        async for r in db.rooms.find({"_id": {"$in": [ObjectId(x) for x in room_ids_set if x]}}):
            rooms_map[str(r["_id"])] = r

    settings = None
    if faculty_id:
        settings = await db.schedule_settings.find_one({"_id": f"faculty_{faculty_id}"})
    if not settings:
        settings = await db.schedule_settings.find_one({"_id": "global"})
    time_slots_cfg = sorted((settings or {}).get("time_slots", []), key=lambda x: x.get("slot_number", 0))
    working_days = (settings or {}).get("working_days", ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء"])

    wb = Workbook()

    header_fill = PatternFill(start_color="1565c0", end_color="1565c0", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=12)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    border = Border(
        left=Side(style="thin", color="bdbdbd"),
        right=Side(style="thin", color="bdbdbd"),
        top=Side(style="thin", color="bdbdbd"),
        bottom=Side(style="thin", color="bdbdbd"),
    )
    cell_fill = PatternFill(start_color="fafafa", end_color="fafafa", fill_type="solid")
    empty_fill = PatternFill(start_color="f5f5f5", end_color="f5f5f5", fill_type="solid")
    time_fill = PatternFill(start_color="e3f2fd", end_color="e3f2fd", fill_type="solid")
    time_font = Font(bold=True, color="0d47a1", size=10)
    # 🔄 الأيام صفوف والفترات أعمدة (rightToLeft يجعل عمود اليوم في أقصى اليمين)
    num_cols = len(time_slots_cfg) + 1

    def build_cell_map(slot_list):
        m = {}
        for s in slot_list:
            m.setdefault((s.get("day") or s.get("day_of_week"), s.get("slot_number")), []).append(s)
        return m

    def write_grid(ws, cell_map, sheet_title, hide_section=False, suppress_teacher=False):
        ws.sheet_view.rightToLeft = True
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=num_cols)
        cell = ws.cell(row=1, column=1, value=sheet_title)
        cell.font = Font(bold=True, size=16, color="1565c0")
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[1].height = 30

        headers = ["اليوم"] + [f"الفترة {ts.get('slot_number')}\n{ts.get('start_time','')} - {ts.get('end_time','')}" for ts in time_slots_cfg]
        for col_idx, h in enumerate(headers, start=1):
            c = ws.cell(row=3, column=col_idx, value=h)
            c.fill = header_fill
            c.font = header_font
            c.alignment = center
            c.border = border
        ws.row_dimensions[3].height = 34

        for r_idx, day in enumerate(working_days, start=4):
            c = ws.cell(row=r_idx, column=1, value=day)
            c.fill = time_fill
            c.font = time_font
            c.alignment = center
            c.border = border
            max_lines = 1
            for d_idx, ts in enumerate(time_slots_cfg, start=2):
                slot_num = ts.get("slot_number")
                cell_slots = cell_map.get((day, slot_num), [])
                cell_val = ""
                if cell_slots:
                    parts = []
                    for s in cell_slots:
                        course = courses_map.get(s.get("course_id", ""), {})
                        teacher = teachers_map.get(s.get("teacher_id", ""), {})
                        room = rooms_map.get(s.get("room_id", ""), {})
                        line = course.get("name", "") or course.get("code", "")
                        if teacher.get("full_name") and not teacher_id and not suppress_teacher:
                            line += f"\n{teacher.get('full_name','')}"
                        if room.get("name") and not room_id:
                            line += f"\n[{room.get('name','')}]"
                        _est, _een, _ch = _effective_times(s, ts.get("start_time", ""), ts.get("end_time", ""))
                        if _ch:
                            line += f"\n⏱ {_est} - {_een}"
                        sec = s.get("section")
                        if sec and not section and not hide_section:
                            line += f" - ش/{sec}"
                        parts.append(line)
                    cell_val = "\n\n".join(parts)
                    max_lines = max(max_lines, cell_val.count("\n") + 1)
                c = ws.cell(row=r_idx, column=d_idx, value=cell_val)
                c.fill = empty_fill if not cell_val else cell_fill
                c.alignment = center
                c.border = border
                c.font = Font(size=10)
            ws.row_dimensions[r_idx].height = max(60, min(400, max_lines * 15))

        ws.column_dimensions["A"].width = 12
        for i in range(2, num_cols + 1):
            ws.column_dimensions[chr(64 + i)].width = 28

    def safe_sheet_name(name, used):
        # أسماء أوراق Excel: ≤31 حرفاً وبدون رموز محظورة وفريدة
        for ch in '[]:*?/\\':
            name = name.replace(ch, "-")
        name = (name or "جدول").strip()[:28] or "جدول"
        base, i = name, 2
        while name in used:
            name = f"{base[:25]}-{i}"
            i += 1
        used.add(name)
        return name

    # 📄 تصدير واسع (كلية/قسم) → ورقة مستقلة لكل شعبة
    wide = not teacher_id and not room_id and not (level is not None and section)

    if per_teacher and not teacher_id and slots:
        # 👨‍🏫 ورقة مستقلة لكل أستاذ
        tgroups = {}
        for s in slots:
            tid = s.get("teacher_id") or ""
            tgroups.setdefault(tid, []).append(s)
        def _tname(tid):
            return teachers_map.get(tid, {}).get("full_name", "") or "بدون أستاذ"
        tkeys = sorted(tgroups.keys(), key=lambda k: _tname(k))
        used_names = set()
        wb.remove(wb.active)
        for tid in tkeys:
            ws = wb.create_sheet(title=safe_sheet_name(_tname(tid), used_names))
            write_grid(ws, build_cell_map(tgroups[tid]),
                       f"الجدول الأسبوعي - الأستاذ: {_tname(tid)}", suppress_teacher=True)
    elif wide and slots:
        dept_names = {}
        dept_ids = {s.get("department_id") for s in slots if s.get("department_id")}
        if dept_ids:
            try:
                async for dpt in db.departments.find({"_id": {"$in": [ObjectId(x) for x in dept_ids if x]}}):
                    dept_names[str(dpt["_id"])] = dpt.get("name", "")
            except Exception:
                pass
        groups = {}
        for s in slots:
            gkey = (s.get("department_id") or "", s.get("level"), s.get("section") or "")
            groups.setdefault(gkey, []).append(s)
        sorted_keys = sorted(groups.keys(), key=lambda k: (dept_names.get(k[0], ""), k[1] if k[1] is not None else 0, k[2]))
        used_names = set()
        wb.remove(wb.active)
        for gk in sorted_keys:
            dname = dept_names.get(gk[0], "")
            gparts = []
            if dname:
                gparts.append(dname)
            if gk[1] is not None:
                gparts.append(f"م{gk[1]}")
            if gk[2]:
                gparts.append(f"ش{gk[2]}")
            sheet_name = safe_sheet_name("-".join(gparts) or "جدول", used_names)
            ws = wb.create_sheet(title=sheet_name)
            full_title = " - ".join(["الجدول الأسبوعي"] + ([f"قسم {dname}"] if dname else []) + ([f"المستوى {gk[1]}"] if gk[1] is not None else []) + ([f"شعبة {gk[2]}"] if gk[2] else []))
            write_grid(ws, build_cell_map(groups[gk]), full_title, hide_section=True)
    else:
        ws = wb.active
        ws.title = "الجدول الأسبوعي"
        title_parts2 = ["الجدول الأسبوعي"]
        if teacher_id and teacher_id in teachers_map:
            title_parts2.append(f"للأستاذ: {teachers_map[teacher_id].get('full_name','')}")
        if room_id and room_id in rooms_map:
            title_parts2.append(f"للقاعة: {rooms_map[room_id].get('name','')}")
        if level is not None:
            title_parts2.append(f"م{level}")
        if section:
            title_parts2.append(f"شعبة {section}")
        write_grid(ws, build_cell_map(slots), " - ".join(title_parts2))

    import io
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"weekly_schedule_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ============================================================
# Availability Reports - تقارير الفراغ/الإشغال للقاعات والأساتذة
# ============================================================

@router.get("/weekly-schedule/availability/rooms")
async def rooms_availability(
    day_of_week: Optional[str] = None,
    slot_number: Optional[int] = None,
    faculty_id: Optional[str] = None,
    semester_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """تقرير حالة القاعات (فارغة/مشغولة) لكل يوم/فترة.
    - بدون فلاتر: يرجع heatmap كاملة (كل القاعات × كل الأيام × كل الفترات)
    - مع day + slot: يرجع قائمة القاعات الفارغة والمشغولة لتلك اللحظة
    """
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()

    # جلب القاعات
    rooms_query = {"is_active": {"$ne": False}}
    if faculty_id:
        rooms_query["faculty_id"] = faculty_id
    rooms = await db.rooms.find(rooms_query).to_list(500)

    # جلب الجدول
    sched_query = {}
    if faculty_id:
        sched_query["faculty_id"] = faculty_id
    if semester_id:
        sched_query["semester_id"] = semester_id
    if day_of_week:
        sched_query["$or"] = [{"day": day_of_week}, {"day_of_week": day_of_week}]
    if slot_number is not None:
        sched_query["slot_number"] = slot_number
    slots = await db.weekly_schedule.find(sched_query).to_list(5000)

    # جلب أسماء المقررات/المعلمين للسياق
    course_ids = {s.get("course_id") for s in slots if s.get("course_id")}
    teacher_ids = {s.get("teacher_id") for s in slots if s.get("teacher_id")}
    courses_map = {}
    if course_ids:
        async for c in db.courses.find({"_id": {"$in": [ObjectId(x) for x in course_ids if x]}}):
            courses_map[str(c["_id"])] = c
    teachers_map = {}
    if teacher_ids:
        async for t in db.teachers.find({"_id": {"$in": [ObjectId(x) for x in teacher_ids if x]}}):
            teachers_map[str(t["_id"])] = t

    # فهرسة slots حسب (room, day, slot)
    busy_map = {}  # (room_id, day, slot) -> slot info
    for s in slots:
        rid = s.get("room_id")
        if not rid:
            continue
        key = (rid, s.get("day") or s.get("day_of_week"), s.get("slot_number"))
        course = courses_map.get(s.get("course_id", ""), {})
        teacher = teachers_map.get(s.get("teacher_id", ""), {})
        busy_map[key] = {
            "course_name": course.get("name", ""),
            "course_code": course.get("code", ""),
            "teacher_name": teacher.get("full_name", ""),
            "section": s.get("section"),
            "level": s.get("level"),
        }

    result = []
    for room in rooms:
        rid = str(room["_id"])
        room_info = {
            "id": rid,
            "name": room.get("name", ""),
            "code": room.get("code", ""),
            "capacity": room.get("capacity"),
            "type": room.get("type", "regular"),
        }
        if day_of_week and slot_number is not None:
            # حالة محددة لقاعة في وقت محدد
            busy = busy_map.get((rid, day_of_week, slot_number))
            room_info["status"] = "busy" if busy else "free"
            room_info["details"] = busy
        else:
            # heatmap: كل اليوم/الفترة
            room_info["slots"] = []
            for (br, bd, bs), info in busy_map.items():
                if br == rid:
                    room_info["slots"].append({
                        "day": bd, "slot": bs, **info,
                    })
        result.append(room_info)

    # ترتيب: الفارغة أولاً عند الفلتر المحدد
    if day_of_week and slot_number is not None:
        result.sort(key=lambda r: (0 if r.get("status") == "free" else 1, r.get("name", "")))

    return {
        "filter": {
            "day_of_week": day_of_week,
            "slot_number": slot_number,
            "faculty_id": faculty_id,
            "semester_id": semester_id,
        },
        "total": len(result),
        "free_count": sum(1 for r in result if r.get("status") == "free"),
        "busy_count": sum(1 for r in result if r.get("status") == "busy"),
        "rooms": result,
    }


@router.get("/weekly-schedule/availability/teachers")
async def teachers_availability(
    day_of_week: Optional[str] = None,
    slot_number: Optional[int] = None,
    faculty_id: Optional[str] = None,
    department_id: Optional[str] = None,
    semester_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """تقرير حالة الأساتذة (فارغ/مشغول) مع الإشارة لتفضيلاتهم.
    - مع day + slot: يرجع قائمة الأساتذة الفارغين والمشغولين + ما إذا كان الوقت ضمن تفضيلاتهم
    - بدون فلتر: heatmap كامل
    """
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()

    # جلب الأساتذة
    teachers_query = {"is_active": {"$ne": False}}
    if department_id:
        teachers_query["department_id"] = department_id
    elif faculty_id:
        teachers_query["faculty_id"] = faculty_id
    teachers = await db.teachers.find(teachers_query).to_list(500)

    # جلب الجدول
    sched_query = {}
    if faculty_id:
        sched_query["faculty_id"] = faculty_id
    if department_id:
        sched_query["department_id"] = department_id
    if semester_id:
        sched_query["semester_id"] = semester_id
    if day_of_week:
        sched_query["$or"] = [{"day": day_of_week}, {"day_of_week": day_of_week}]
    if slot_number is not None:
        sched_query["slot_number"] = slot_number
    slots = await db.weekly_schedule.find(sched_query).to_list(5000)

    # جلب التفضيلات
    teacher_ids_list = [str(t["_id"]) for t in teachers]
    prefs_list = await db.teacher_preferences.find({"teacher_id": {"$in": teacher_ids_list}}).to_list(500)
    prefs_map = {p["teacher_id"]: p for p in prefs_list}

    # سياق المقرر والقاعة
    course_ids = {s.get("course_id") for s in slots if s.get("course_id")}
    room_ids_set = {s.get("room_id") for s in slots if s.get("room_id")}
    courses_map = {}
    if course_ids:
        async for c in db.courses.find({"_id": {"$in": [ObjectId(x) for x in course_ids if x]}}):
            courses_map[str(c["_id"])] = c
    rooms_map = {}
    if room_ids_set:
        async for r in db.rooms.find({"_id": {"$in": [ObjectId(x) for x in room_ids_set if x]}}):
            rooms_map[str(r["_id"])] = r

    # فهرسة slots
    busy_map = {}  # (teacher_id, day, slot) -> info
    for s in slots:
        tid = s.get("teacher_id")
        if not tid:
            continue
        key = (tid, s.get("day") or s.get("day_of_week"), s.get("slot_number"))
        course = courses_map.get(s.get("course_id", ""), {})
        room = rooms_map.get(s.get("room_id", ""), {})
        busy_map[key] = {
            "course_name": course.get("name", ""),
            "course_code": course.get("code", ""),
            "room_name": room.get("name", ""),
            "section": s.get("section"),
            "level": s.get("level"),
        }

    def check_preference(pref: dict, day: str, slot: int):
        """يرجع: 'preferred' | 'unavailable' | 'neutral'"""
        if not pref:
            return "neutral"
        # غير متاح
        unavail = pref.get("unavailable_slots", [])
        for u in unavail:
            if u.get("day") == day and u.get("slot") == slot:
                return "unavailable"
        # مفضّل
        preferred = pref.get("preferred_slots", [])
        for p in preferred:
            if p.get("day") == day and p.get("slot") == slot:
                return "preferred"
        # أيام/أوقات مفضّلة عامة
        preferred_days = pref.get("preferred_days", [])
        if preferred_days and day not in preferred_days:
            return "non_preferred_day"
        return "neutral"

    result = []
    for teacher in teachers:
        tid = str(teacher["_id"])
        pref = prefs_map.get(tid, {})
        teacher_info = {
            "id": tid,
            "full_name": teacher.get("full_name", ""),
            "employee_id": teacher.get("employee_id", ""),
            "department_id": teacher.get("department_id"),
            "has_preferences": bool(pref),
        }
        if day_of_week and slot_number is not None:
            busy = busy_map.get((tid, day_of_week, slot_number))
            teacher_info["status"] = "busy" if busy else "free"
            teacher_info["details"] = busy
            teacher_info["preference_status"] = check_preference(pref, day_of_week, slot_number)
        else:
            teacher_info["slots"] = []
            for (bt, bd, bs), info in busy_map.items():
                if bt == tid:
                    teacher_info["slots"].append({
                        "day": bd, "slot": bs, **info,
                    })
        result.append(teacher_info)

    # ترتيب: الفارغين المفضّلين أولاً
    if day_of_week and slot_number is not None:
        def sort_key(t):
            status_order = 0 if t.get("status") == "free" else 2
            pref_order = {"preferred": 0, "neutral": 1, "non_preferred_day": 2, "unavailable": 3}.get(t.get("preference_status", "neutral"), 1)
            return (status_order + pref_order, t.get("full_name", ""))
        result.sort(key=sort_key)

    free_preferred = sum(1 for t in result if t.get("status") == "free" and t.get("preference_status") == "preferred")
    free_neutral = sum(1 for t in result if t.get("status") == "free" and t.get("preference_status") == "neutral")
    free_unavailable = sum(1 for t in result if t.get("status") == "free" and t.get("preference_status") == "unavailable")
    free_total = sum(1 for t in result if t.get("status") == "free")

    return {
        "filter": {
            "day_of_week": day_of_week,
            "slot_number": slot_number,
            "faculty_id": faculty_id,
            "department_id": department_id,
            "semester_id": semester_id,
        },
        "total": len(result),
        "free_total": free_total,
        "free_preferred": free_preferred,
        "free_neutral": free_neutral,
        "free_unavailable": free_unavailable,
        "busy_count": sum(1 for t in result if t.get("status") == "busy"),
        "teachers": result,
    }


# ===== 🗓️ توليد المحاضرات الفعلية من الجدول الأسبوعي =====

_ARABIC_DAY_TO_WEEKDAY = {
    "السبت": 5, "الأحد": 6, "الاثنين": 0, "الإثنين": 0,
    "الثلاثاء": 1, "الأربعاء": 2, "الخميس": 3, "الجمعة": 4,
}

# ===== 🔄 مزامنة (الجدول ← النظام): المحاضرات اليومية المستقبلية تتبع تعديلات الخلية =====

_SAT_OFFSET = {"السبت": 0, "الأحد": 1, "الاثنين": 2, "الإثنين": 2, "الثلاثاء": 3, "الأربعاء": 4, "الخميس": 5, "الجمعة": 6}


async def _faculty_slot_times(db, faculty_id: str) -> dict:
    settings = await db.schedule_settings.find_one({"_id": f"faculty_{faculty_id}"}) or await db.schedule_settings.find_one({"_id": "global"})
    return {s["slot_number"]: (s.get("start_time", ""), s.get("end_time", "")) for s in (settings or {}).get("time_slots", [])}


async def _resolve_day_times(db, faculty_id: str, day: str) -> list:
    """⏱ حلحلة أوقات اليوم: إزاحة متسلسلة لبدايات المحاضرات المتأثرة بالمدد المخصصة
    (بدون نقل أو حذف — فقط تعديل الأوقات). يخزن computed_start_time/computed_end_time
    عند اختلافها عن أوقات الفترة الافتراضية، ويرجع قائمة المحاضرات المزاحة حالياً."""
    if not faculty_id or not day:
        return []
    slot_times = await _faculty_slot_times(db, faculty_id)
    if not slot_times:
        return []
    slots = await db.weekly_schedule.find({"faculty_id": faculty_id, "day": day}).to_list(2000)
    processed: list = []
    shifted: list = []
    for s in sorted(slots, key=lambda x: (x.get("slot_number") or 0, str(x.get("_id")))):
        st_def, en_def = slot_times.get(s.get("slot_number"), ("", ""))
        base_start, base_end = _t2m(st_def), _t2m(en_def)
        if base_start is None or base_end is None:
            continue
        try:
            dur = int(s["duration_minutes"]) if s.get("duration_minutes") else max(base_end - base_start, 0)
        except (TypeError, ValueError):
            dur = max(base_end - base_start, 0)
        eff_start = base_start
        for p in processed:
            if p["_end_m"] > eff_start and _slots_conflict(s, p):
                eff_start = p["_end_m"]
        eff_end = eff_start + dur
        s["_end_m"] = eff_end
        processed.append(s)
        new_cs = _m2t(eff_start) if eff_start != base_start else None
        new_ce = _m2t(eff_end) if (eff_start != base_start or eff_end != base_end) else None
        sets, unsets = {}, {}
        if new_cs != s.get("computed_start_time"):
            (sets if new_cs else unsets)["computed_start_time"] = new_cs or ""
        if new_ce != s.get("computed_end_time"):
            (sets if new_ce else unsets)["computed_end_time"] = new_ce or ""
        if sets or unsets:
            upd = {}
            if sets:
                upd["$set"] = sets
            if unsets:
                upd["$unset"] = unsets
            await db.weekly_schedule.update_one({"_id": s["_id"]}, upd)
        if new_cs:
            shifted.append({
                "slot_id": str(s["_id"]),
                "course_id": s.get("course_id", ""),
                "slot_number": s.get("slot_number"),
                "level": s.get("level"),
                "section": s.get("section", "") or "",
                "day": day,
                "from": st_def,
                "to": new_cs,
                "end": new_ce,
            })
    cids = list({sh["course_id"] for sh in shifted if sh["course_id"]})
    if cids:
        names = {}
        try:
            async for c in db.courses.find({"_id": {"$in": [ObjectId(c) for c in cids]}}):
                names[str(c["_id"])] = c.get("name", "")
        except Exception:
            pass
        for sh in shifted:
            sh["course_name"] = names.get(sh["course_id"], "")
    return shifted


async def _sync_future_lectures(db, slot: dict, action: str, new_day=None, new_slot_number=None, new_room_id=None) -> dict:
    """المستقبل يتبع الجدول والماضي محفوظ: نقل/حذف المحاضرات اليومية المستقبلية المولّدة من موقع الخلية القديم.
    تُستثنى: الماضية، غير المجدولة، التي عليها حضور، والمعاد جدولتها يدوياً."""
    from datetime import timedelta
    res = {"updated": 0, "deleted": 0, "skipped_attendance": 0, "skipped_rescheduled": 0, "skipped_conflict": 0}
    old_wd = _ARABIC_DAY_TO_WEEKDAY.get(slot.get("day", ""))
    if old_wd is None:
        return res
    times = await _faculty_slot_times(db, slot.get("faculty_id", ""))
    old_start, _ = times.get(slot.get("slot_number"), ("", ""))
    if not old_start:
        return res

    today = (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%Y-%m-%d")
    cands = []
    async for lec in db.lectures.find({
        "course_id": slot.get("course_id", ""),
        "date": {"$gte": today},
        "status": "scheduled",
        "start_time": old_start,
    }):
        try:
            d = datetime.strptime(lec.get("date", ""), "%Y-%m-%d")
        except (ValueError, TypeError):
            continue
        if d.weekday() != old_wd:
            continue
        if lec.get("original_date") or lec.get("last_rescheduled_from"):
            res["skipped_rescheduled"] += 1
            continue
        cands.append(lec)
    if not cands:
        return res

    att_ids = set()
    async for a in db.attendance.find({"lecture_id": {"$in": [str(l["_id"]) for l in cands]}}, {"lecture_id": 1}):
        att_ids.add(a.get("lecture_id"))

    if action == "delete":
        del_ids = [l["_id"] for l in cands if str(l["_id"]) not in att_ids]
        res["skipped_attendance"] = len(cands) - len(del_ids)
        if del_ids:
            r = await db.lectures.delete_many({"_id": {"$in": del_ids}})
            res["deleted"] = r.deleted_count
        return res

    # action == "move" (يوم/فترة/قاعة)
    tgt_day = new_day or slot.get("day", "")
    tgt_slot = new_slot_number if new_slot_number is not None else slot.get("slot_number")
    new_start, new_end = times.get(tgt_slot, ("", ""))
    day_offset = _SAT_OFFSET.get(tgt_day)
    if not new_start or day_offset is None:
        return res
    new_room_name = None
    if new_room_id is not None:
        if new_room_id:
            room = await db.rooms.find_one({"_id": ObjectId(new_room_id)})
            new_room_name = room.get("name", "") if room else ""
        else:
            new_room_name = ""

    for lec in cands:
        if str(lec["_id"]) in att_ids:
            res["skipped_attendance"] += 1
            continue
        d = datetime.strptime(lec["date"], "%Y-%m-%d")
        week_start = d - timedelta(days=(d.weekday() + 2) % 7)  # سبت نفس الأسبوع
        new_date = (week_start + timedelta(days=day_offset)).strftime("%Y-%m-%d")
        upd = {"date": new_date, "start_time": new_start, "end_time": new_end}
        if new_room_name is not None:
            upd["room"] = new_room_name
        try:
            clash = await db.lectures.find_one({
                "_id": {"$ne": lec["_id"]},
                "course_id": lec["course_id"], "date": new_date, "start_time": new_start,
                "status": {"$ne": "cancelled"},
            })
            if clash:
                res["skipped_conflict"] += 1
                continue
            await db.lectures.update_one({"_id": lec["_id"]}, {"$set": upd})
            res["updated"] += 1
        except DuplicateKeyError:
            res["skipped_conflict"] += 1
    return res


def _sync_summary(res: dict) -> str:
    parts = []
    if res.get("updated"):
        parts.append(f"تم تحديث {res['updated']} محاضرة يومية مستقبلية تبعاً للتعديل")
    if res.get("deleted"):
        parts.append(f"حُذفت {res['deleted']} محاضرة يومية مستقبلية كانت مولّدة من هذه الخلية")
    excl = []
    if res.get("skipped_attendance"):
        excl.append(f"{res['skipped_attendance']} عليها حضور مسجل")
    if res.get("skipped_rescheduled"):
        excl.append(f"{res['skipped_rescheduled']} معاد جدولتها يدوياً")
    if res.get("skipped_conflict"):
        excl.append(f"{res['skipped_conflict']} تعارضت مع محاضرة قائمة")
    if excl:
        parts.append("استُثنيت: " + "، ".join(excl))
    return (" • " + " — ".join(parts)) if parts else ""


async def _cascade_slot_teacher_to_course(db, slot: dict, slot_id: str, new_tid: str, current_user: dict) -> str:
    """🧑‍🏫 الجدول مصدر الحقيقة: تغيير أستاذ خلية = تغيير إسناد المقرر كاملاً (كل الخلايا + العبء التدريسي)."""
    cid = slot.get("course_id", "")
    if not cid:
        return ""
    course = await db.courses.find_one({"_id": ObjectId(cid)})
    if not course or (course.get("teacher_id") or "") == (new_tid or ""):
        return ""

    # فحص مسبق: الأستاذ الجديد يجب أن يكون متاحاً في مواعيد كل خلايا المقرر الأخرى
    other_cells = await db.weekly_schedule.find({"course_id": cid, "_id": {"$ne": ObjectId(slot_id)}}).to_list(200)
    own_ids = [c["_id"] for c in other_cells] + [ObjectId(slot_id)]
    conflicts = []
    for c in other_cells:
        busy = await db.weekly_schedule.find_one({
            "_id": {"$nin": own_ids},
            "teacher_id": new_tid, "day": c["day"], "slot_number": c["slot_number"],
        })
        if busy:
            conflicts.append(f"{c['day']} فترة {c['slot_number']}")
    if conflicts:
        raise HTTPException(status_code=409, detail=(
            f"لا يمكن تغيير الإسناد: الأستاذ الجديد مشغول في مواعيد خلايا أخرى لنفس المقرر ({'، '.join(conflicts)}) — "
            f"عالج تلك التعارضات أولاً"
        ))

    old_tid = course.get("teacher_id")
    await db.courses.update_one({"_id": course["_id"]}, {"$set": {"teacher_id": new_tid or None}})
    try:
        if new_tid:
            await db.weekly_schedule.update_many({"course_id": cid, "_id": {"$ne": ObjectId(slot_id)}}, {"$set": {"teacher_id": new_tid}})
        else:
            await db.weekly_schedule.update_many({"course_id": cid, "_id": {"$ne": ObjectId(slot_id)}}, {"$unset": {"teacher_id": ""}})
    except DuplicateKeyError:
        pass
    if old_tid:
        await db.teaching_loads.delete_many({"course_id": cid, "teacher_id": old_tid})
    if new_tid and not await db.teaching_loads.find_one({"course_id": cid, "teacher_id": new_tid}):
        load = {
            "teacher_id": new_tid, "course_id": cid,
            "weekly_hours": float(course.get("weekly_hours") or course.get("credit_hours") or 3),
            "created_by": current_user.get("id", ""),
            "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc),
        }
        active_sem = await db.semesters.find_one({"status": "active"})
        sem_id = str(active_sem["_id"]) if active_sem else course.get("semester_id")
        if sem_id:
            load["semester_id"] = sem_id
        await db.teaching_loads.insert_one(load)
    await log_activity(current_user, "cascade_slot_teacher", "course", cid, course.get("name", ""),
                       {"old_teacher_id": old_tid, "new_teacher_id": new_tid, "cells_updated": len(other_cells) + 1})
    return f" • 🧑‍🏫 حُدّث إسناد المقرر '{course.get('name', '')}' بالكامل ({len(other_cells) + 1} خلية) والعبء التدريسي"


class GenerateLecturesFromScheduleRequest(BaseModel):
    faculty_id: str
    department_id: Optional[str] = None
    start_date: str  # YYYY-MM-DD
    end_date: str    # YYYY-MM-DD
    holidays: List[str] = []  # تواريخ معطلة تُتخطى
    dry_run: bool = True  # معاينة فقط دون إنشاء


@router.post("/weekly-schedule/generate-lectures")
async def generate_lectures_from_schedule(
    data: GenerateLecturesFromScheduleRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    🗓️ تحويل الجدول الأسبوعي المعتمد إلى محاضرات فعلية بتواريخ محددة.
    - توليد الناقص فقط: المحاضرات الموجودة مسبقاً (من صفحة المقررات أو توليد سابق) تُتخطى ولا تُمس.
    - يتخطى العطلات المحددة.
    - dry_run=True: معاينة (عدد ما سيُنشأ/يُتخطى) دون أي إنشاء.
    """
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()

    # التحقق من التواريخ
    try:
        start_d = datetime.strptime(data.start_date, "%Y-%m-%d").date()
        end_d = datetime.strptime(data.end_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="صيغة التاريخ غير صحيحة (YYYY-MM-DD)")
    if end_d < start_d:
        raise HTTPException(status_code=400, detail="تاريخ النهاية قبل تاريخ البداية")
    if (end_d - start_d).days > 370:
        raise HTTPException(status_code=400, detail="الفترة أطول من سنة — قلّص النطاق")
    holidays_set = set(data.holidays or [])

    # خانات الجدول ضمن النطاق
    sched_query = {"faculty_id": data.faculty_id}
    if data.department_id:
        sched_query["department_id"] = data.department_id
    slots = await db.weekly_schedule.find(sched_query).to_list(5000)
    if not slots:
        raise HTTPException(status_code=400, detail="لا يوجد جدول أسبوعي في هذا النطاق — ولّد الجدول أولاً")

    # أوقات الفترات (خاصة بالكلية أو العامة)
    settings = await db.schedule_settings.find_one({"_id": f"faculty_{data.faculty_id}"})
    if not settings:
        settings = await db.schedule_settings.find_one({"_id": "global"})
    time_slots = (settings or {}).get("time_slots", [])
    slot_times = {s["slot_number"]: (s.get("start_time", ""), s.get("end_time", "")) for s in time_slots}

    # أسماء القاعات (الجدول يخزن room_id والمحاضرات تخزن الاسم نصاً)
    room_ids = list({s.get("room_id") for s in slots if s.get("room_id")})
    room_names = {}
    if room_ids:
        try:
            async for r in db.rooms.find({"_id": {"$in": [ObjectId(rid) for rid in room_ids]}}):
                room_names[str(r["_id"])] = r.get("name", "")
        except Exception:
            pass

    # بناء المرشحين: لكل خانة × كل تاريخ مطابق لليوم ضمن الفترة
    from datetime import timedelta as _td
    candidates = []
    skipped_no_time = 0
    d = start_d
    while d <= end_d:
        date_str = d.strftime("%Y-%m-%d")
        if date_str not in holidays_set:
            wd = d.weekday()
            for s in slots:
                if _ARABIC_DAY_TO_WEEKDAY.get(s.get("day", "")) != wd:
                    continue
                st_time, en_time = slot_times.get(s.get("slot_number"), ("", ""))
                if not st_time or not en_time:
                    skipped_no_time += 1
                    continue
                # ⏱ الأوقات الفعلية (مدة مخصصة أو إزاحة تلقائية)
                st_time, en_time, _ = _effective_times(s, st_time, en_time)
                candidates.append({
                    "course_id": s.get("course_id", ""),
                    "date": date_str,
                    "start_time": st_time,
                    "end_time": en_time,
                    "room": room_names.get(s.get("room_id", ""), ""),
                })
        d += _td(days=1)

    if not candidates:
        return {"dry_run": data.dry_run, "to_create": 0, "already_exist": 0, "holidays_skipped": len(holidays_set), "courses_count": 0, "message": "لا توجد مواعيد ضمن الفترة المحددة"}

    # المحاضرات الموجودة مسبقاً (نحترمها ونتخطاها) — بأي حالة غير ملغاة
    course_ids = list({c["course_id"] for c in candidates if c["course_id"]})
    existing = set()
    async for lec in db.lectures.find({
        "course_id": {"$in": course_ids},
        "date": {"$gte": data.start_date, "$lte": data.end_date},
        "status": {"$ne": "cancelled"},
    }, {"course_id": 1, "date": 1, "start_time": 1}):
        existing.add((lec.get("course_id"), lec.get("date"), lec.get("start_time")))

    to_create = [c for c in candidates if (c["course_id"], c["date"], c["start_time"]) not in existing]
    already = len(candidates) - len(to_create)

    if data.dry_run:
        return {
            "dry_run": True,
            "to_create": len(to_create),
            "already_exist": already,
            "skipped_no_time": skipped_no_time,
            "slot_times_used": [
                {"slot_number": k, "start_time": v[0], "end_time": v[1]}
                for k, v in sorted(slot_times.items())
            ],
            "courses_count": len(course_ids),
            "schedule_slots": len(slots),
            "date_range": f"{data.start_date} → {data.end_date}",
            "holidays_count": len(holidays_set),
            "message": f"سيتم إنشاء {len(to_create)} محاضرة لـ{len(course_ids)} مقرراً (تخطي {already} موجودة مسبقاً)",
        }

    # التنفيذ الفعلي — الفهرس الفريد uniq_course_date_start شبكة أمان إضافية
    course_sem = {}
    _valid_cids = [ObjectId(x) for x in course_ids if x and ObjectId.is_valid(x)]
    if _valid_cids:
        async for _c in db.courses.find({"_id": {"$in": _valid_cids}}, {"semester_id": 1}):
            course_sem[str(_c["_id"])] = _c.get("semester_id")
    created = 0
    dup_skipped = 0
    now = datetime.now(timezone.utc)
    for c in to_create:
        try:
            await db.lectures.insert_one({
                "course_id": c["course_id"],
                "date": c["date"],
                "start_time": c["start_time"],
                "end_time": c["end_time"],
                "room": c["room"],
                "status": "scheduled",
                "notes": "",
                "semester_id": course_sem.get(c["course_id"]),
                "created_at": now,
                "created_by": current_user.get("id", ""),
                "generated_from_schedule": True,
            })
            created += 1
        except DuplicateKeyError:
            dup_skipped += 1

    await log_activity(
        current_user, "generate_lectures_from_schedule", "weekly_schedule", data.faculty_id, None,
        {"department_id": data.department_id, "range": f"{data.start_date}→{data.end_date}", "created": created, "skipped": already + dup_skipped},
    )
    return {
        "dry_run": False,
        "created": created,
        "already_exist": already + dup_skipped,
        "courses_count": len(course_ids),
        "message": f"تم إنشاء {created} محاضرة لـ{len(course_ids)} مقرراً (تخطي {already + dup_skipped} موجودة مسبقاً)",
    }


class ResyncLectureTimesRequest(BaseModel):
    faculty_id: str
    department_id: Optional[str] = None
    dry_run: bool = True


@router.post("/weekly-schedule/resync-lecture-times")
async def resync_lecture_times(
    data: ResyncLectureTimesRequest,
    current_user: dict = Depends(get_current_user),
):
    """🕑 إعادة مزامنة أوقات المحاضرات المولدة من الجدول مع أوقات الفترات الحالية.

    الاستخدام: عند توليد محاضرات بأوقات خاطئة (مثلاً 23:30 بدل 11:30 بسبب ص/م)،
    يصحح الأدمن أوقات الفترات في الإعدادات ثم ينفذ هذه المزامنة — تُحدَّث أوقات
    كل المحاضرات المولدة (generated_from_schedule) وفق فترة كل خانة في الجدول.
    """
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()

    settings = await db.schedule_settings.find_one({"_id": f"faculty_{data.faculty_id}"})
    if not settings:
        settings = await db.schedule_settings.find_one({"_id": "global"})
    time_slots = (settings or {}).get("time_slots", [])
    slot_times = {s["slot_number"]: (s.get("start_time", ""), s.get("end_time", "")) for s in time_slots}
    if not slot_times:
        raise HTTPException(status_code=400, detail="لا توجد فترات زمنية معرفة — اضبط إعدادات الفترات أولاً")

    sched_query: dict = {"faculty_id": data.faculty_id}
    if data.department_id:
        sched_query["department_id"] = data.department_id
    slots = await db.weekly_schedule.find(sched_query).to_list(5000)
    if not slots:
        raise HTTPException(status_code=400, detail="لا يوجد جدول أسبوعي في هذا النطاق")

    # (course_id, weekday) → قائمة أوقات مرتبة برقم الفترة
    from collections import defaultdict
    per_key: dict = defaultdict(list)
    for s in slots:
        wd = _ARABIC_DAY_TO_WEEKDAY.get(s.get("day", ""))
        st, en = slot_times.get(s.get("slot_number"), ("", ""))
        if wd is None or not st or not en:
            continue
        st, en, _ = _effective_times(s, st, en)
        per_key[(s.get("course_id", ""), wd)].append((s.get("slot_number"), st, en))
    for k in per_key:
        per_key[k].sort()

    course_ids = list({s.get("course_id") for s in slots if s.get("course_id")})
    lecs = await db.lectures.find({
        "course_id": {"$in": course_ids},
        "generated_from_schedule": True,
        "status": {"$ne": "cancelled"},
    }).to_list(50000)

    by_course_date: dict = defaultdict(list)
    for l in lecs:
        by_course_date[(l.get("course_id"), l.get("date", ""))].append(l)

    changes = []
    for (cid, date_str), group in by_course_date.items():
        try:
            wd = datetime.strptime(date_str, "%Y-%m-%d").date().weekday()
        except Exception:
            continue
        expected = per_key.get((cid, wd))
        if not expected:
            continue
        group.sort(key=lambda x: x.get("start_time", ""))
        for i, lec in enumerate(group):
            if i >= len(expected):
                break
            _, st, en = expected[i]
            if lec.get("start_time") != st or lec.get("end_time") != en:
                changes.append({
                    "_id": lec["_id"], "date": date_str,
                    "old": f"{lec.get('start_time', '')} - {lec.get('end_time', '')}",
                    "new": f"{st} - {en}", "st": st, "en": en,
                })

    if not data.dry_run and changes:
        for ch in changes:
            try:
                await db.lectures.update_one(
                    {"_id": ch["_id"]},
                    {"$set": {"start_time": ch["st"], "end_time": ch["en"]}},
                )
            except DuplicateKeyError:
                pass
        await log_activity(
            current_user, "resync_lecture_times", "weekly_schedule", data.faculty_id, None,
            {"department_id": data.department_id, "updated": len(changes)},
        )

    # عينة تغييرات فريدة (نمط الوقت القديم → الجديد)
    patterns: dict = {}
    for ch in changes:
        patterns[f"{ch['old']} ← {ch['new']}"] = patterns.get(f"{ch['old']} ← {ch['new']}", 0) + 1

    return {
        "dry_run": data.dry_run,
        "lectures_checked": len(lecs),
        ("to_update" if data.dry_run else "updated"): len(changes),
        "patterns": [{"change": k, "count": v} for k, v in sorted(patterns.items(), key=lambda x: -x[1])[:10]],
        "message": (
            f"سيتم تحديث {len(changes)} محاضرة من أصل {len(lecs)}" if data.dry_run
            else f"تم تحديث أوقات {len(changes)} محاضرة بنجاح"
        ),
    }


# ===== العرض الشامل (Master View) =====

class MoveSlotRequest(BaseModel):
    slot_id: str
    target_day: str
    target_slot_number: int


class SwapSlotsRequest(BaseModel):
    slot_a_id: str
    slot_b_id: str


class MergeSlotsRequest(BaseModel):
    slot_a_id: str  # المحاضرة المنضمّة (تنتقل لموقع الهدف)
    slot_b_id: str  # المحاضرة الهدف (تبقى في مكانها)


@router.post("/weekly-schedule/merge-slots")
async def merge_schedule_slots(data: MergeSlotsRequest, current_user: dict = Depends(get_current_user)):
    """🆕 دمج محاضرتين متطابقتين (نفس المقرر والمدرس) في محاضرة مشتركة — A تنضم لموقع B"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    a = await db.weekly_schedule.find_one({"_id": ObjectId(data.slot_a_id)})
    b = await db.weekly_schedule.find_one({"_id": ObjectId(data.slot_b_id)})
    if not a or not b:
        raise HTTPException(status_code=404, detail="المحاضرة غير موجودة")
    if str(a["_id"]) == str(b["_id"]):
        raise HTTPException(status_code=400, detail="لا يمكن دمج المحاضرة مع نفسها")
    if a.get("merge_group_id") and a["merge_group_id"] == b.get("merge_group_id"):
        raise HTTPException(status_code=400, detail="المحاضرتان ضمن نفس المجموعة المشتركة أصلاً")

    ca = await db.courses.find_one({"_id": ObjectId(a["course_id"])}) if a.get("course_id") else None
    cb = await db.courses.find_one({"_id": ObjectId(b["course_id"])}) if b.get("course_id") else None
    same_course = (ca or {}).get("name", "").strip() == (cb or {}).get("name", "").strip() and (ca or {}).get("name")
    same_teacher = a.get("teacher_id") and a.get("teacher_id") == b.get("teacher_id")
    if not (same_course and same_teacher):
        raise HTTPException(status_code=400, detail="الدمج متاح فقط لمحاضرتين بنفس المقرر ونفس المدرس")

    group_a = [a]
    if a.get("merge_group_id"):
        group_a = await db.weekly_schedule.find({"merge_group_id": a["merge_group_id"]}).to_list(50)
    group_b = [b]
    if b.get("merge_group_id"):
        group_b = await db.weekly_schedule.find({"merge_group_id": b["merge_group_id"]}).to_list(50)

    # منع تكرار نفس (القسم، المستوى، الشعبة) داخل المجموعة الموحدة
    keys_b = {(g["department_id"], g["level"], g.get("section", "") or "") for g in group_b}
    for g in group_a:
        if (g["department_id"], g["level"], g.get("section", "") or "") in keys_b:
            raise HTTPException(status_code=400, detail="لا يمكن الدمج: نفس المستوى/الشعبة موجودة في الطرفين")

    gid = b.get("merge_group_id") or uuid.uuid4().hex
    exclude_ids = {str(g["_id"]) for g in group_a} | {str(g["_id"]) for g in group_b}

    conflicts = []
    for g in group_a:
        conflicts += await _check_slot_placement(db, {**g, "merge_group_id": gid}, b["day"], b["slot_number"], exclude_ids)
    conflicts = list(dict.fromkeys(conflicts))
    if conflicts:
        raise HTTPException(status_code=409, detail={"message": "يوجد تعارضات تمنع الدمج", "conflicts": conflicts})

    try:
        for g in group_b:
            if g.get("merge_group_id") != gid or not g.get("merge_key"):
                await db.weekly_schedule.update_one({"_id": g["_id"]}, {"$set": {
                    "merge_group_id": gid, "merge_key": f"{gid}:{g['department_id']}:{g['level']}:{g.get('section', '') or ''}"}})
        for g in group_a:
            await db.weekly_schedule.update_one({"_id": g["_id"]}, {"$set": {
                "day": b["day"], "slot_number": b["slot_number"],
                "room_id": b.get("room_id", ""), "teacher_id": b.get("teacher_id", ""),
                "merge_group_id": gid, "merge_key": f"{gid}:{g['department_id']}:{g['level']}:{g.get('section', '') or ''}"}})
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail={"message": "تعارض في الجدول (مرفوض من قاعدة البيانات)", "conflicts": ["تعارض فريد في قاعدة البيانات"]})

    await log_activity(current_user, "merge_schedule_slots", "weekly_schedule", data.slot_a_id, None,
                       {"joined_to": data.slot_b_id, "group": gid})

    sync = {}
    for g in group_a:
        s = await _sync_future_lectures(db, g, "move", new_day=b["day"], new_slot_number=b["slot_number"])
        sync = {k: sync.get(k, 0) + v for k, v in s.items()} if sync else s
    total = len(group_a) + len(group_b)
    await _resolve_day_times(db, a.get("faculty_id", ""), b.get("day", ""))
    if a.get("day") != b.get("day"):
        await _resolve_day_times(db, a.get("faculty_id", ""), a.get("day", ""))
    return {"message": f"تم الدمج في محاضرة مشتركة تضم {total} جداول" + _sync_summary(sync), "merge_group_id": gid}


def _needed_weekly_slots(credit_hours) -> int:
    try:
        credit = int(credit_hours or 3)
    except (TypeError, ValueError):
        credit = 3
    if credit <= 2:
        return 1
    if credit <= 3:
        return 2
    return 3


async def _course_week_balance(db, slot: dict) -> Optional[dict]:
    """⚖️ مقارنة دقائق المقرر المجدولة أسبوعياً (لنفس الشعبة) بالخطة المعتمدة (الساعة = 60 دقيقة)
    مع اقتراح موازنة بإنقاص المحاضرات الأخرى عند التجاوز."""
    course_id = slot.get("course_id")
    if not course_id:
        return None
    try:
        course = await db.courses.find_one({"_id": ObjectId(course_id)})
    except Exception:
        course = None
    if not course:
        return None
    try:
        plan_hours = float(course.get("weekly_hours") or course.get("credit_hours") or 0)
    except (TypeError, ValueError):
        plan_hours = 0
    if plan_hours <= 0:
        return None
    plan_minutes = int(plan_hours * 60)
    slot_times = await _faculty_slot_times(db, slot.get("faculty_id", ""))
    sec = slot.get("section") or ""
    sec_q = {"section": sec} if sec else {"section": {"$in": ["", None]}}
    sibs = await db.weekly_schedule.find({
        "course_id": course_id,
        "department_id": slot.get("department_id"),
        "level": slot.get("level"),
        **sec_q,
    }).to_list(100)

    def _minutes(s):
        if s.get("duration_minutes"):
            try:
                return int(s["duration_minutes"])
            except (TypeError, ValueError):
                pass
        st, en = slot_times.get(s.get("slot_number"), ("", ""))
        a, b = _t2m(st), _t2m(en)
        return (b - a) if (a is not None and b is not None) else 0

    scheduled = sum(_minutes(s) for s in sibs)
    excess = scheduled - plan_minutes
    result = {
        "plan_minutes": plan_minutes,
        "scheduled_minutes": scheduled,
        "excess_minutes": excess,
        "course_name": course.get("name", ""),
        "rebalance": [],
    }
    if excess <= 0:
        return result
    changed_id = str(slot.get("_id"))
    others = [s for s in sibs if str(s["_id"]) != changed_id]
    target = plan_minutes - _minutes(slot)
    if others and target >= 30 * len(others):
        base = target // len(others)
        rem = target - base * len(others)
        for i, o in enumerate(others):
            proposed = base + (rem if i == 0 else 0)
            result["rebalance"].append({
                "slot_id": str(o["_id"]),
                "day": o.get("day", ""),
                "slot_number": o.get("slot_number"),
                "current_minutes": _minutes(o),
                "proposed_minutes": proposed,
            })
    return result



@router.get("/weekly-schedule/master-view")
async def get_master_view(
    faculty_id: str,
    department_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """العرض الشامل: كل المستويات والشعب × الأيام والفترات + المقررات غير المدرجة"""
    db = get_db()
    result = await _build_master_data(db, faculty_id, department_id)
    result["can_manage"] = can_manage_schedule(current_user)
    return result


async def _build_master_data(db, faculty_id: str, department_id: Optional[str] = None) -> dict:

    settings = await db.schedule_settings.find_one({"_id": f"faculty_{faculty_id}"})
    if not settings:
        settings = await db.schedule_settings.find_one({"_id": "global"})
    time_slots = (settings or {}).get("time_slots", [])
    working_days = (settings or {}).get("working_days", [])

    dept_query = {"faculty_id": faculty_id, "is_active": {"$ne": False}}
    if department_id:
        dept_query["_id"] = ObjectId(department_id)
    departments = await db.departments.find(dept_query).to_list(100)
    dept_ids = [str(d["_id"]) for d in departments]
    depts_map = {str(d["_id"]): d.get("name", "") for d in departments}

    slots = await db.weekly_schedule.find({"department_id": {"$in": dept_ids}}).to_list(5000)

    courses = await db.courses.find({
        "department_id": {"$in": dept_ids}, "is_active": True, "teacher_id": {"$ne": None}
    }).to_list(2000)

    course_ids = list({s["course_id"] for s in slots if s.get("course_id")} | {str(c["_id"]) for c in courses})
    room_ids = list({s["room_id"] for s in slots if s.get("room_id")})

    courses_map = {}
    if course_ids:
        docs = await db.courses.find({"_id": {"$in": [ObjectId(x) for x in course_ids if x]}}).to_list(2000)
        courses_map = {str(d["_id"]): d for d in docs}

    # 🛟 fallback: أسماء المقررات المؤرشفة (المحذوفة بعد أرشفة الفصل)
    _missing_cids = {x for x in course_ids if x and x not in courses_map}
    if _missing_cids:
        from ._schedule_repair import archived_courses_info
        for cid, info in (await archived_courses_info(db, _missing_cids)).items():
            courses_map[cid] = {"name": info.get("name", ""), "code": info.get("code", ""),
                                "teacher_id": info.get("teacher_id"), "_archived": True}
    teacher_ids = list(
        {s["teacher_id"] for s in slots if s.get("teacher_id")}
        | {c.get("teacher_id", "") for c in courses if c.get("teacher_id")}
        | {d.get("teacher_id", "") for d in courses_map.values() if d.get("teacher_id")}
    )
    teachers_map = {}
    if teacher_ids:
        docs = await db.teachers.find({"_id": {"$in": [ObjectId(x) for x in teacher_ids if x]}}).to_list(1000)
        teachers_map = {str(d["_id"]): d for d in docs}
    rooms_map = {}
    if room_ids:
        docs = await db.rooms.find({"_id": {"$in": [ObjectId(x) for x in room_ids if x]}}).to_list(500)
        rooms_map = {str(d["_id"]): d for d in docs}

    # الصفوف: (قسم، مستوى، شعبة) من الجدول + من المقررات (حتى تظهر المجموعات الفارغة)
    group_keys = set()
    for s in slots:
        group_keys.add((s.get("department_id", ""), s.get("level") or 1, s.get("section", "") or ""))
    for c in courses:
        group_keys.add((c.get("department_id", ""), c.get("level") or 1, c.get("section", "") or ""))

    groups = sorted(
        [{"department_id": d, "department_name": depts_map.get(d, ""), "level": lv, "section": sec}
         for (d, lv, sec) in group_keys if d in depts_map],
        key=lambda g: (g["department_name"], g["level"], g["section"])
    )

    entries = []
    scheduled_counts: dict = {}
    # 🆕 خريطة المحاضرات المشتركة
    _mv_gids = list({s["merge_group_id"] for s in slots if s.get("merge_group_id")})
    _mv_merge_map: dict = {}
    if _mv_gids:
        async for m in db.weekly_schedule.find({"merge_group_id": {"$in": _mv_gids}}):
            _mv_merge_map.setdefault(m["merge_group_id"], []).append(m)
    for s in slots:
        course = courses_map.get(s.get("course_id", ""), {})
        # مصدر الحقيقة للإسناد هو المقرر — معرف الخلية القديم قد يكون شبحياً (بيانات سابقة)
        eff_tid = course.get("teacher_id") or s.get("teacher_id", "")
        teacher = teachers_map.get(eff_tid, {})
        room = rooms_map.get(s.get("room_id", ""), {})
        _gid = s.get("merge_group_id")
        _labels = []
        if _gid:
            for m in _mv_merge_map.get(_gid, []):
                if m["_id"] == s["_id"]:
                    continue
                _same_dept = m.get("department_id") == s.get("department_id")
                if not _same_dept or m.get("level") != s.get("level"):
                    lbl = f"المستوى {m.get('level')}"
                    if m.get("section"):
                        lbl += f" ({m['section']})"
                else:
                    lbl = f"شعبة {m.get('section') or '؟'}"
                if not _same_dept:
                    lbl = f"{depts_map.get(m.get('department_id', ''), 'قسم آخر')} — {lbl}"
                _labels.append(lbl)
        entries.append({
            "id": str(s["_id"]),
            "duration_minutes": s.get("duration_minutes"),
            "computed_start_time": s.get("computed_start_time"),
            "computed_end_time": s.get("computed_end_time"),
            "department_id": s.get("department_id", ""),
            "level": s.get("level") or 1,
            "section": s.get("section", "") or "",
            "day": s.get("day", ""),
            "slot_number": s.get("slot_number"),
            "course_id": s.get("course_id", ""),
            "course_name": course.get("name", ""),
            "teacher_id": eff_tid,
            "teacher_name": teacher.get("full_name", ""),
            "room_id": s.get("room_id", ""),
            "room_name": room.get("name", ""),
            "merge_group_id": _gid or "",
            "merged_with": _labels,
        })
        ck = (s.get("course_id", ""), s.get("department_id", ""), s.get("level") or 1, s.get("section", "") or "")
        scheduled_counts[ck] = scheduled_counts.get(ck, 0) + 1

    # المقررات غير المدرجة إطلاقاً (المقياس: خلية واحدة على الأقل في الجدول = مدرج)
    unscheduled = []
    for c in courses:
        cid = str(c["_id"])
        ck = (cid, c.get("department_id", ""), c.get("level") or 1, c.get("section", "") or "")
        have = scheduled_counts.get(ck, 0)
        if have == 0:
            teacher = teachers_map.get(c.get("teacher_id", ""), {})
            unscheduled.append({
                "course_id": cid,
                "course_name": c.get("name", ""),
                "teacher_id": c.get("teacher_id", ""),
                "teacher_name": teacher.get("full_name", ""),
                "department_id": c.get("department_id", ""),
                "department_name": depts_map.get(c.get("department_id", ""), ""),
                "level": c.get("level") or 1,
                "section": c.get("section", "") or "",
                "needed": 1,
                "scheduled": 0,
                "missing": 1,
            })
    unscheduled.sort(key=lambda u: (u["department_name"], u["level"], u["section"], u["course_name"]))

    return {
        "working_days": working_days,
        "time_slots": time_slots,
        "groups": groups,
        "entries": entries,
        "unscheduled": unscheduled,
    }


async def _check_slot_placement(db, slot: dict, target_day: str, target_slot: int, exclude_ids: set) -> List[str]:
    """فحص إمكانية وضع محاضرة في (يوم، فترة) — يُرجع قائمة التعارضات"""
    conflicts = []
    exclude = {"$nin": [ObjectId(x) for x in exclude_ids]}
    # 🆕 محاضرة مشتركة: تجاهل أعضاء نفس المجموعة في فحوصات المعلم/القاعة
    _mg = slot.get("merge_group_id")
    _mg_excl = {"merge_group_id": {"$ne": _mg}} if _mg else {}

    section_busy = await db.weekly_schedule.find_one({
        "_id": exclude,
        **_mg_excl,
        "department_id": slot.get("department_id"),
        "level": slot.get("level"),
        "section": slot.get("section", ""),
        "day": target_day,
        "slot_number": target_slot,
    })
    if section_busy:
        c = await db.courses.find_one({"_id": ObjectId(section_busy["course_id"])}) if section_busy.get("course_id") else None
        conflicts.append(f"تعارض شعبة: يوجد مقرر '{(c or {}).get('name', '')}' لنفس الشعبة في هذه الفترة")

    if slot.get("teacher_id"):
        teacher_busy = await db.weekly_schedule.find_one({
            "_id": exclude,
            **_mg_excl,
            "teacher_id": slot["teacher_id"],
            "day": target_day,
            "slot_number": target_slot,
        })
        if teacher_busy:
            t = await db.teachers.find_one({"_id": ObjectId(slot["teacher_id"])})
            c = await db.courses.find_one({"_id": ObjectId(teacher_busy["course_id"])}) if teacher_busy.get("course_id") else None
            conflicts.append(f"تعارض معلم: '{(t or {}).get('full_name', '')}' لديه مقرر '{(c or {}).get('name', '')}' في نفس الفترة")

        pref = await db.teacher_preferences.find_one({"teacher_id": slot["teacher_id"]})
        if pref and _is_period_unavailable(pref, target_day, target_slot):
            t = await db.teachers.find_one({"_id": ObjectId(slot["teacher_id"])})
            conflicts.append(f"تعارض تفضيلات: '{(t or {}).get('full_name', '')}' غير متاح يوم {target_day} في الفترة {target_slot}")

        if pref and target_day != slot.get("day"):
            daily_count = await db.weekly_schedule.count_documents({
                "_id": exclude, "teacher_id": slot["teacher_id"], "day": target_day
            })
            max_daily = pref.get("max_daily_lectures", 3)
            if daily_count >= max_daily:
                conflicts.append(f"تعارض تفضيلات: المعلم وصل الحد الأقصى ({max_daily} محاضرات) ليوم {target_day}")

    if slot.get("room_id"):
        room_busy = await db.weekly_schedule.find_one({
            "_id": exclude,
            **_mg_excl,
            "room_id": slot["room_id"],
            "day": target_day,
            "slot_number": target_slot,
        })
        if room_busy:
            r = await db.rooms.find_one({"_id": ObjectId(slot["room_id"])})
            c = await db.courses.find_one({"_id": ObjectId(room_busy["course_id"])}) if room_busy.get("course_id") else None
            conflicts.append(f"تعارض قاعة: '{(r or {}).get('name', '')}' مشغولة بمقرر '{(c or {}).get('name', '')}' في نفس الفترة")

    return conflicts


@router.post("/weekly-schedule/move-slot")
async def move_schedule_slot(
    data: MoveSlotRequest,
    current_user: dict = Depends(get_current_user),
):
    """نقل محاضرة إلى خلية فارغة (يوم/فترة) مع كامل فحوصات التعارض"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    slot = await db.weekly_schedule.find_one({"_id": ObjectId(data.slot_id)})
    if not slot:
        raise HTTPException(status_code=404, detail="المحاضرة غير موجودة")

    if slot.get("day") == data.target_day and slot.get("slot_number") == data.target_slot_number:
        return {"message": "لا تغيير"}

    # 🆕 محاضرة مشتركة: النقل يشمل كل أعضاء المجموعة
    group = [slot]
    if slot.get("merge_group_id"):
        group = await db.weekly_schedule.find({"merge_group_id": slot["merge_group_id"]}).to_list(50)
    exclude_ids = {str(g["_id"]) for g in group}

    conflicts = []
    for g in group:
        conflicts += await _check_slot_placement(db, g, data.target_day, data.target_slot_number, exclude_ids)
    if conflicts:
        raise HTTPException(status_code=409, detail={"message": "يوجد تعارضات", "conflicts": list(dict.fromkeys(conflicts))})

    try:
        await db.weekly_schedule.update_many(
            {"_id": {"$in": [g["_id"] for g in group]}},
            {"$set": {"day": data.target_day, "slot_number": data.target_slot_number}}
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail={"message": "تعارض في الجدول (مرفوض من قاعدة البيانات)", "conflicts": ["تعارض فريد في قاعدة البيانات"]})

    await log_activity(current_user, "move_schedule_slot", "weekly_schedule", data.slot_id, None,
                       {"from": f"{slot.get('day')}-{slot.get('slot_number')}", "to": f"{data.target_day}-{data.target_slot_number}"})

    # 🔄 (جدول ← نظام) المحاضرات اليومية المستقبلية تتبع الموقع الجديد
    sync = {}
    for g in group:
        s = await _sync_future_lectures(db, g, "move", new_day=data.target_day, new_slot_number=data.target_slot_number)
        sync = {k: sync.get(k, 0) + v for k, v in s.items()} if sync else s
    msg = "تم نقل المحاضرة بنجاح" if len(group) == 1 else f"تم نقل المحاضرة المشتركة ({len(group)} جداول) بنجاح"
    # ⏱ حلحلة أوقات اليومين (القديم والجديد)
    shifted = []
    for d in {slot.get("day"), data.target_day}:
        shifted += await _resolve_day_times(db, slot.get("faculty_id", ""), d)
    return {"message": msg + _sync_summary(sync) + _shift_summary(shifted), "shifted": shifted}


@router.post("/weekly-schedule/swap-slots")
async def swap_schedule_slots(
    data: SwapSlotsRequest,
    current_user: dict = Depends(get_current_user),
):
    """تبديل مكاني محاضرتين (كقطع الشطرنج) مع فحص التعارضات للطرفين معاً"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    slot_a = await db.weekly_schedule.find_one({"_id": ObjectId(data.slot_a_id)})
    slot_b = await db.weekly_schedule.find_one({"_id": ObjectId(data.slot_b_id)})
    if not slot_a or not slot_b:
        raise HTTPException(status_code=404, detail="إحدى المحاضرتين غير موجودة")

    exclude = {data.slot_a_id, data.slot_b_id}
    # 🆕 محاضرة مشتركة: التبديل يشمل كل أعضاء مجموعتي الطرفين
    group_a = [slot_a]
    if slot_a.get("merge_group_id"):
        group_a = await db.weekly_schedule.find({"merge_group_id": slot_a["merge_group_id"]}).to_list(50)
    group_b = [slot_b]
    if slot_b.get("merge_group_id"):
        group_b = await db.weekly_schedule.find({"merge_group_id": slot_b["merge_group_id"]}).to_list(50)
    exclude = {str(g["_id"]) for g in group_a} | {str(g["_id"]) for g in group_b}

    conflicts = []
    for g in group_a:
        conflicts += await _check_slot_placement(db, g, slot_b["day"], slot_b["slot_number"], exclude)
    for g in group_b:
        conflicts += await _check_slot_placement(db, g, slot_a["day"], slot_a["slot_number"], exclude)
    conflicts = list(dict.fromkeys(conflicts))
    if conflicts:
        raise HTTPException(status_code=409, detail={"message": "يوجد تعارضات تمنع التبديل", "conflicts": conflicts})

    pos_a = {"day": slot_a["day"], "slot_number": slot_a["slot_number"]}
    pos_b = {"day": slot_b["day"], "slot_number": slot_b["slot_number"]}

    # حذف الوثائق ثم إعادة إدراجها بالمواقع المتبادلة (نفس الـ _id) لتفادي تعارض الفهارس الفريدة المؤقت
    all_ids = [g["_id"] for g in group_a + group_b]
    await db.weekly_schedule.delete_many({"_id": {"$in": all_ids}})
    new_docs = [{**g, **pos_b} for g in group_a] + [{**g, **pos_a} for g in group_b]
    try:
        await db.weekly_schedule.insert_many(new_docs)
    except DuplicateKeyError:
        # استرجاع الوضع الأصلي
        await db.weekly_schedule.delete_many({"_id": {"$in": all_ids}})
        await db.weekly_schedule.insert_many(group_a + group_b)
        raise HTTPException(status_code=409, detail={"message": "تعارض في الجدول (مرفوض من قاعدة البيانات)", "conflicts": ["تعارض فريد في قاعدة البيانات"]})

    await log_activity(current_user, "swap_schedule_slots", "weekly_schedule", data.slot_a_id, None,
                       {"a": f"{pos_a['day']}-{pos_a['slot_number']}", "b": f"{pos_b['day']}-{pos_b['slot_number']}"})

    # 🔄 (جدول ← نظام) محاضرات الطرفين المستقبلية تتبع الموقعين الجديدين
    combined = {}
    for g in group_a:
        s = await _sync_future_lectures(db, g, "move", new_day=pos_b["day"], new_slot_number=pos_b["slot_number"])
        combined = {k: combined.get(k, 0) + v for k, v in s.items()} if combined else s
    for g in group_b:
        s = await _sync_future_lectures(db, g, "move", new_day=pos_a["day"], new_slot_number=pos_a["slot_number"])
        combined = {k: combined.get(k, 0) + v for k, v in s.items()}
    # ⏱ حلحلة أوقات اليومين بعد التبديل
    shifted = []
    for d in {pos_a["day"], pos_b["day"]}:
        shifted += await _resolve_day_times(db, slot_a.get("faculty_id", ""), d)
    return {"message": "تم تبديل المحاضرتين بنجاح" + _sync_summary(combined) + _shift_summary(shifted), "shifted": shifted}


# ===== تصدير العرض الشامل الملوّن (بأسلوب aSc Timetables) =====

_MASTER_PALETTE = [
    '#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1',
    '#fdd835', '#d81b60', '#5e35b1', '#00897b', '#f4511e', '#3949ab',
    '#7cb342', '#ffb300', '#c0ca33', '#6d4c41', '#039be5', '#e91e63',
    '#4caf50', '#ff7043', '#9c27b0', '#26a69a', '#ec407a', '#66bb6a',
]


def _master_course_color(course_id: str) -> str:
    h = 0
    for ch in course_id:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return _MASTER_PALETTE[h % len(_MASTER_PALETTE)]


def _master_text_color(bg: str) -> str:
    r, g, b = int(bg[1:3], 16), int(bg[3:5], 16), int(bg[5:7], 16)
    return '#1a1a1a' if (r * 299 + g * 587 + b * 114) / 1000 > 150 else '#ffffff'


def _short_teacher(full: str) -> str:
    if not full:
        return ""
    parts = full.strip().split()
    if len(parts) <= 2:
        return full
    return f"{parts[0]} {parts[-1]}"


@router.get("/weekly-schedule/master-view/export/pdf")
async def export_master_pdf(
    faculty_id: str,
    department_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """تصدير PDF ملوّن للعرض الشامل: الشعب صفوفاً × (الأيام × الفترات) أعمدة"""
    try:
        from reportlab.lib.pagesizes import landscape, A3
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        import arabic_reshaper
        from bidi.algorithm import get_display
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"مكتبة PDF غير مثبتة: {e}")

    db = get_db()
    data = await _build_master_data(db, faculty_id, department_id)
    working_days = data["working_days"]
    time_slots = sorted(data["time_slots"], key=lambda x: x.get("slot_number", 0))
    groups = data["groups"]
    entries = data["entries"]
    unscheduled = data["unscheduled"]

    if not groups:
        raise HTTPException(status_code=400, detail="لا توجد بيانات جدول لهذه الكلية")

    try:
        import os as _os
        _font_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "fonts", "Amiri-Regular.ttf")
        pdfmetrics.registerFont(TTFont("Amiri", _font_path))
        font_name = "Amiri"
    except Exception:
        font_name = "Helvetica"

    def ar(text):
        if not text:
            return ""
        try:
            return get_display(arabic_reshaper.reshape(str(text)))
        except Exception:
            return str(text)

    faculty = await db.faculties.find_one({"_id": ObjectId(faculty_id)})
    title = f"الجدول الأسبوعي الشامل — {(faculty or {}).get('name', '')}"
    if department_id:
        dept = await db.departments.find_one({"_id": ObjectId(department_id)})
        if dept:
            title += f" — قسم {dept.get('name', '')}"

    # فهرسة الخلايا
    cell_map = {}
    for e in entries:
        k = (e["department_id"], e["level"], e["section"], e["day"], e["slot_number"])
        cell_map.setdefault(k, []).append(e)

    nd, ns = len(working_days), len(time_slots)
    ncols = nd * ns  # أعمدة البيانات

    # الصف 0: أسماء الأيام (مدموجة) — RTL: نعكس ترتيب الأعمدة، عمود الشعبة آخراً (أقصى اليمين)
    def rev(idx):
        return ncols - 1 - idx

    header0 = [""] * ncols + [ar("المستوى / الشعبة")]
    header1 = [""] * ncols + [""]
    for di, day in enumerate(working_days):
        for si, ts in enumerate(time_slots):
            orig = di * ns + si
            header1[rev(orig)] = ar(f"{ts.get('slot_number')}\n{ts.get('start_time','')}")
        # اسم اليوم يوضع في أول عمود من نطاقه بعد العكس (الأصغر index)
        span_start = rev(di * ns + ns - 1)
        header0[span_start] = ar(day)

    table_data = [header0, header1]
    cell_styles = []

    for gi, g in enumerate(groups):
        row_idx = gi + 2
        row = [""] * ncols + [ar(f"{g['department_name']} · م{g['level']}" + (f" · {g['section']}" if g['section'] else ""))]
        for di, day in enumerate(working_days):
            for si, ts in enumerate(time_slots):
                orig = di * ns + si
                col = rev(orig)
                items = cell_map.get((g["department_id"], g["level"], g["section"], day, ts.get("slot_number")), [])
                if items:
                    it = items[0]
                    txt = it["course_name"]
                    extra = _short_teacher(it["teacher_name"])
                    if it.get("room_name"):
                        extra += f" · {it['room_name']}"
                    _est, _een, _ch = _effective_times(it, ts.get("start_time", ""), ts.get("end_time", ""))
                    if _ch:
                        extra += f"\n({_est}-{_een})"
                    row[col] = ar(f"{txt}\n{extra}")
                    bg = _master_course_color(it["course_id"])
                    fg = _master_text_color(bg)
                    cell_styles.append(("BACKGROUND", (col, row_idx), (col, row_idx), colors.HexColor(bg)))
                    cell_styles.append(("TEXTCOLOR", (col, row_idx), (col, row_idx), colors.HexColor(fg)))
        table_data.append(row)

    import io
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A3), rightMargin=0.5*cm, leftMargin=0.5*cm, topMargin=0.5*cm, bottomMargin=0.5*cm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("T", parent=styles["Title"], fontName=font_name, fontSize=15, alignment=1, textColor=colors.HexColor("#0d2a52"))
    sub_style = ParagraphStyle("S", parent=styles["Normal"], fontName=font_name, fontSize=8, alignment=1, textColor=colors.grey)
    sec_style = ParagraphStyle("Sec", parent=styles["Normal"], fontName=font_name, fontSize=12, alignment=2, textColor=colors.HexColor("#e65100"))

    story = [
        Paragraph(ar(title), title_style),
        Paragraph(ar(f"تاريخ التصدير: {datetime.now().strftime('%Y-%m-%d %H:%M')}  |  جامعة الأحقاف"), sub_style),
        Spacer(1, 0.25*cm),
    ]

    # عرض A3 landscape ≈ 42cm — عمود الشعبة 4.2cm والباقي موزع
    avail = 42 - 1.0 - 4.2
    col_w = [avail / ncols * cm] * ncols + [4.2 * cm]
    tbl = Table(table_data, colWidths=col_w, repeatRows=2)

    style = [
        ("FONTNAME", (0, 0), (-1, -1), font_name),
        ("FONTSIZE", (0, 0), (-1, 1), 7),
        ("FONTSIZE", (0, 2), (-1, -1), 5.5),
        ("FONTSIZE", (-1, 2), (-1, -1), 7),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1565c0")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#3d7ede")),
        ("TEXTCOLOR", (0, 1), (-1, 1), colors.white),
        ("BACKGROUND", (-1, 0), (-1, 1), colors.HexColor("#0d2a52")),
        ("BACKGROUND", (-1, 2), (-1, -1), colors.HexColor("#eef3fa")),
        ("TEXTCOLOR", (-1, 2), (-1, -1), colors.HexColor("#1a2540")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#b8c4d6")),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 1),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1),
    ]
    # دمج خلايا أسماء الأيام في الصف 0
    for di in range(nd):
        c1 = rev(di * ns + ns - 1)
        c2 = rev(di * ns)
        style.append(("SPAN", (c1, 0), (c2, 0)))
        # خط فاصل أثقل بين الأيام
        style.append(("LINEBEFORE", (c1, 0), (c1, -1), 1.2, colors.HexColor("#5a6b85")))
    style += cell_styles
    tbl.setStyle(TableStyle(style))
    story.append(tbl)

    # قسم المقررات غير المدرجة
    if unscheduled:
        story.append(Spacer(1, 0.5*cm))
        story.append(Paragraph(ar(f"⚠ مقررات لم تُدرج في الجدول أو مدرجة جزئياً ({len(unscheduled)})"), sec_style))
        story.append(Spacer(1, 0.15*cm))
        uhead = [ar(h) for h in ["الناقص", "المدرج", "المطلوب أسبوعياً", "المستوى/الشعبة", "القسم", "المعلم", "المقرر"]]
        udata = [uhead]
        for u in unscheduled:
            udata.append([
                str(u["missing"]), str(u["scheduled"]), str(u["needed"]),
                ar(f"م{u['level']}" + (f" · {u['section']}" if u['section'] else "")),
                ar(u["department_name"]), ar(u["teacher_name"]), ar(u["course_name"]),
            ])
        utbl = Table(udata, colWidths=[2*cm, 2*cm, 3*cm, 3*cm, 6*cm, 7*cm, 8*cm])
        utbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_name),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#ffe0b2")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#6d4c00")),
            ("TEXTCOLOR", (0, 1), (0, -1), colors.HexColor("#c62828")),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e0c9a0")),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(utbl)

    try:
        doc.build(story)
    except Exception as build_err:
        raise HTTPException(status_code=400, detail=f"تعذر بناء ملف PDF: {str(build_err)[:150]}")
    buf.seek(0)
    filename = f"master_schedule_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/weekly-schedule/master-view/export/excel")
async def export_master_excel(
    faculty_id: str,
    department_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """تصدير Excel ملوّن للعرض الشامل"""
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"مكتبة Excel غير مثبتة: {e}")

    db = get_db()
    data = await _build_master_data(db, faculty_id, department_id)
    working_days = data["working_days"]
    time_slots = sorted(data["time_slots"], key=lambda x: x.get("slot_number", 0))
    groups = data["groups"]
    entries = data["entries"]
    unscheduled = data["unscheduled"]

    if not groups:
        raise HTTPException(status_code=400, detail="لا توجد بيانات جدول لهذه الكلية")

    faculty = await db.faculties.find_one({"_id": ObjectId(faculty_id)})
    title = f"الجدول الأسبوعي الشامل — {(faculty or {}).get('name', '')}"
    if department_id:
        dept = await db.departments.find_one({"_id": ObjectId(department_id)})
        if dept:
            title += f" — قسم {dept.get('name', '')}"

    cell_map = {}
    for e in entries:
        k = (e["department_id"], e["level"], e["section"], e["day"], e["slot_number"])
        cell_map.setdefault(k, []).append(e)

    wb = Workbook()
    ws = wb.active
    ws.title = "الجدول الشامل"
    ws.sheet_view.rightToLeft = True

    ns = len(time_slots)
    ncols_total = 1 + len(working_days) * ns  # عمود الشعبة + الأيام×الفترات

    thin = Side(style="thin", color="B8C4D6")
    thick = Side(style="medium", color="5A6B85")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # العنوان
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols_total)
    tc = ws.cell(row=1, column=1, value=title)
    tc.font = Font(bold=True, size=14, color="0D2A52")
    tc.alignment = center

    # الصف 2: الأيام (مدموجة) — العمود 1 للشعبة
    hc = ws.cell(row=2, column=1, value="المستوى / الشعبة")
    ws.merge_cells(start_row=2, start_column=1, end_row=3, end_column=1)
    hc.fill = PatternFill("solid", fgColor="0D2A52")
    hc.font = Font(bold=True, color="FFFFFF", size=10)
    hc.alignment = center

    for di, day in enumerate(working_days):
        c1 = 2 + di * ns
        ws.merge_cells(start_row=2, start_column=c1, end_row=2, end_column=c1 + ns - 1)
        dc = ws.cell(row=2, column=c1, value=day)
        dc.fill = PatternFill("solid", fgColor="1565C0")
        dc.font = Font(bold=True, color="FFFFFF", size=11)
        dc.alignment = center
        for si, ts in enumerate(time_slots):
            sc = ws.cell(row=3, column=c1 + si, value=f"{ts.get('slot_number')} ({ts.get('start_time','')})")
            sc.fill = PatternFill("solid", fgColor="3D7EDE")
            sc.font = Font(bold=True, color="FFFFFF", size=8)
            sc.alignment = center
            sc.border = border

    # صفوف الشعب
    for gi, g in enumerate(groups):
        r = 4 + gi
        label = f"{g['department_name']} · م{g['level']}" + (f" · {g['section']}" if g['section'] else "")
        gc = ws.cell(row=r, column=1, value=label)
        gc.fill = PatternFill("solid", fgColor="EEF3FA")
        gc.font = Font(bold=True, size=9, color="1A2540")
        gc.alignment = center
        gc.border = border
        for di, day in enumerate(working_days):
            for si, ts in enumerate(time_slots):
                col = 2 + di * ns + si
                cell = ws.cell(row=r, column=col)
                cell.border = Border(
                    left=thick if si == ns - 1 else thin,
                    right=thick if si == 0 else thin,
                    top=thin, bottom=thin,
                )
                items = cell_map.get((g["department_id"], g["level"], g["section"], day, ts.get("slot_number")), [])
                if items:
                    it = items[0]
                    extra = _short_teacher(it["teacher_name"])
                    if it.get("room_name"):
                        extra += f" · {it['room_name']}"
                    _est, _een, _ch = _effective_times(it, ts.get("start_time", ""), ts.get("end_time", ""))
                    if _ch:
                        extra += f"\n⏱ {_est} - {_een}"
                    cell.value = f"{it['course_name']}\n{extra}"
                    bg = _master_course_color(it["course_id"])[1:].upper()
                    fg = _master_text_color("#" + bg)[1:].upper()
                    cell.fill = PatternFill("solid", fgColor=bg)
                    cell.font = Font(bold=True, size=7.5, color=fg)
                    cell.alignment = center

    # عرض الأعمدة والصفوف
    ws.column_dimensions["A"].width = 26
    for c in range(2, ncols_total + 1):
        ws.column_dimensions[get_column_letter(c)].width = 14
    for r in range(4, 4 + len(groups)):
        ws.row_dimensions[r].height = 34

    # ورقة المقررات غير المدرجة
    if unscheduled:
        ws2 = wb.create_sheet("غير المدرجة")
        ws2.sheet_view.rightToLeft = True
        heads = ["المقرر", "المعلم", "القسم", "المستوى/الشعبة", "المطلوب أسبوعياً", "المدرج", "الناقص"]
        for ci, h in enumerate(heads, 1):
            c = ws2.cell(row=1, column=ci, value=h)
            c.fill = PatternFill("solid", fgColor="FFE0B2")
            c.font = Font(bold=True, color="6D4C00", size=10)
            c.alignment = center
            c.border = border
        for ri, u in enumerate(unscheduled, 2):
            vals = [
                u["course_name"], u["teacher_name"], u["department_name"],
                f"م{u['level']}" + (f" · {u['section']}" if u['section'] else ""),
                u["needed"], u["scheduled"], u["missing"],
            ]
            for ci, v in enumerate(vals, 1):
                c = ws2.cell(row=ri, column=ci, value=v)
                c.alignment = center
                c.border = border
                if ci == 7:
                    c.font = Font(bold=True, color="C62828")
        for ci, w in enumerate([30, 25, 22, 15, 15, 10, 10], 1):
            ws2.column_dimensions[get_column_letter(ci)].width = w

    import io
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"master_schedule_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/weekly-schedule/free-rooms")
async def get_free_rooms_for_slot(
    faculty_id: str,
    day: str,
    slot_number: int,
    current_user: dict = Depends(get_current_user),
):
    """قاعات الكلية مع حالة انشغالها في (يوم، فترة) محددة — الانشغال يُفحص عالمياً عبر كل الجداول"""
    db = get_db()
    rooms = await db.rooms.find({"faculty_id": faculty_id, "is_active": True}).to_list(300)
    busy_ids = await db.weekly_schedule.distinct("room_id", {
        "day": day, "slot_number": slot_number, "room_id": {"$nin": ["", None]}
    })
    busy_set = set(busy_ids)
    return [
        {
            "id": str(r["_id"]),
            "name": r.get("name", ""),
            "building": r.get("building", ""),
            "capacity": r.get("capacity", 0),
            "busy": str(r["_id"]) in busy_set,
        }
        for r in rooms
    ]


@router.get("/weekly-schedule/valid-slots")
async def get_valid_slots(
    faculty_id: str,
    department_id: str,
    level: int,
    section: str = "",
    teacher_id: str = "",
    room_id: str = "",
    exclude_slot_id: str = "",
    current_user: dict = Depends(get_current_user),
):
    """حساب الخلايا (يوم×فترة) الصالحة لنقل/إدراج محاضرة دون تعارضات — لإضاءتها بصرياً"""
    db = get_db()

    settings = await db.schedule_settings.find_one({"_id": f"faculty_{faculty_id}"})
    if not settings:
        settings = await db.schedule_settings.find_one({"_id": "global"})
    time_slots = sorted((settings or {}).get("time_slots", []), key=lambda x: x.get("slot_number", 0))
    working_days = (settings or {}).get("working_days", [])

    exclude_oid = ObjectId(exclude_slot_id) if exclude_slot_id else None

    # انشغال الشعبة (نفس القسم/المستوى/الشعبة)
    section_slots = await db.weekly_schedule.find({
        "department_id": department_id, "level": level, "section": section,
    }).to_list(500)
    section_busy = {(s["day"], s["slot_number"]) for s in section_slots if s["_id"] != exclude_oid}

    # انشغال المعلم (عالمي عبر كل الكليات)
    teacher_busy = set()
    teacher_day_counts: dict = {}
    pref = None
    if teacher_id:
        t_slots = await db.weekly_schedule.find({"teacher_id": teacher_id}).to_list(1000)
        for s in t_slots:
            if s["_id"] == exclude_oid:
                continue
            teacher_busy.add((s["day"], s["slot_number"]))
            teacher_day_counts[s["day"]] = teacher_day_counts.get(s["day"], 0) + 1
        pref = await db.teacher_preferences.find_one({"teacher_id": teacher_id})

    # انشغال القاعة (عالمي)
    room_busy = set()
    if room_id:
        r_slots = await db.weekly_schedule.find({"room_id": room_id}).to_list(1000)
        room_busy = {(s["day"], s["slot_number"]) for s in r_slots if s["_id"] != exclude_oid}

    max_daily = (pref or {}).get("max_daily_lectures", 3)

    cells = []
    for day in working_days:
        for ts in time_slots:
            sn = ts.get("slot_number")
            reasons = []
            if (day, sn) in section_busy:
                reasons.append("الشعبة مشغولة")
            if teacher_id:
                if (day, sn) in teacher_busy:
                    reasons.append("المعلم مشغول")
                if pref and _is_period_unavailable(pref, day, sn):
                    reasons.append("خارج تفضيلات المعلم")
                if pref and teacher_day_counts.get(day, 0) >= max_daily:
                    reasons.append(f"المعلم بلغ حده اليومي ({max_daily})")
            if room_id and (day, sn) in room_busy:
                reasons.append("القاعة مشغولة")
            cells.append({"day": day, "slot_number": sn, "valid": len(reasons) == 0, "reasons": reasons})

    return {"cells": cells}


@router.post("/weekly-schedule/auto-place-unscheduled")
async def auto_place_unscheduled(
    faculty_id: str,
    department_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """إدراج تلقائي لكل المقررات غير المدرجة في أفضل الأماكن الصالحة (بكامل الاحترازات)"""
    if not can_manage_schedule(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()

    data = await _build_master_data(db, faculty_id, department_id)
    unscheduled = data["unscheduled"]
    if not unscheduled:
        return {"placed": [], "failed": [], "message": "لا توجد مقررات غير مدرجة"}

    settings = await db.schedule_settings.find_one({"_id": f"faculty_{faculty_id}"})
    if not settings:
        settings = await db.schedule_settings.find_one({"_id": "global"})
    time_slots = sorted((settings or {}).get("time_slots", []), key=lambda x: x.get("slot_number", 0))
    working_days = (settings or {}).get("working_days", [])
    slot_numbers = [ts.get("slot_number") for ts in time_slots]

    # بناء خرائط الانشغال الحالية (عالمية)
    all_slots = await db.weekly_schedule.find({}).to_list(20000)
    section_busy = set()
    teacher_busy = set()
    teacher_day_counts: dict = {}
    room_busy = set()
    course_days: dict = {}  # (course,dept,level,section) -> set(days)
    for s in all_slots:
        section_busy.add((s.get("department_id"), s.get("level"), s.get("section", ""), s["day"], s["slot_number"]))
        if s.get("teacher_id"):
            teacher_busy.add((s["teacher_id"], s["day"], s["slot_number"]))
            teacher_day_counts[(s["teacher_id"], s["day"])] = teacher_day_counts.get((s["teacher_id"], s["day"]), 0) + 1
        if s.get("room_id"):
            room_busy.add((s["room_id"], s["day"], s["slot_number"]))
        ck = (s.get("course_id"), s.get("department_id"), s.get("level"), s.get("section", ""))
        course_days.setdefault(ck, set()).add(s["day"])

    rooms = await db.rooms.find({"faculty_id": faculty_id, "is_active": True}).to_list(300)
    prefs_cache: dict = {}

    async def get_pref(tid):
        if tid not in prefs_cache:
            prefs_cache[tid] = await db.teacher_preferences.find_one({"teacher_id": tid})
        return prefs_cache[tid]

    placed, failed = [], []
    now = datetime.now(timezone.utc)

    for u in unscheduled:
        tid = u.get("teacher_id", "")
        pref = await get_pref(tid) if tid else None
        max_daily = (pref or {}).get("max_daily_lectures", 3) if pref else 3
        ck = (u["course_id"], u["department_id"], u["level"], u["section"])
        for _ in range(u["missing"]):
            # جمع المرشحين مع درجة تفضيل
            candidates = []
            for day in working_days:
                for sn in slot_numbers:
                    if (u["department_id"], u["level"], u["section"], day, sn) in section_busy:
                        continue
                    if tid:
                        if (tid, day, sn) in teacher_busy:
                            continue
                        if pref and _is_period_unavailable(pref, day, sn):
                            continue
                        if pref and teacher_day_counts.get((tid, day), 0) >= max_daily:
                            continue
                    score = 0
                    if day in course_days.get(ck, set()):
                        score += 100  # تجنب تكرار نفس المقرر في نفس اليوم
                    score += teacher_day_counts.get((tid, day), 0) * 5  # توزيع حمل المعلم
                    # أولوية الفترات المبكرة (1-3)، والمتأخرة عند التعذر فقط
                    score += sn if sn <= 3 else 50 + sn
                    # التتالي مسموح لمحاضرتين فقط — منع تكوين 3 متتاليات للمعلم
                    if tid and (
                        ((tid, day, sn - 1) in teacher_busy and (tid, day, sn - 2) in teacher_busy)
                        or ((tid, day, sn + 1) in teacher_busy and (tid, day, sn + 2) in teacher_busy)
                        or ((tid, day, sn - 1) in teacher_busy and (tid, day, sn + 1) in teacher_busy)
                    ):
                        continue
                    candidates.append((score, day, sn))
            if not candidates:
                failed.append({"course_name": u["course_name"], "section": u["section"], "level": u["level"],
                               "reason": "لا يوجد أي مكان صالح (تعارضات الشعبة/المعلم/التفضيلات)"})
                break
            candidates.sort()
            _, day, sn = candidates[0]

            # اختيار قاعة حرة في هذا الوقت
            room_id = ""
            room_name = ""
            for r in rooms:
                rid = str(r["_id"])
                if (rid, day, sn) not in room_busy:
                    room_id = rid
                    room_name = r.get("name", "")
                    break

            doc = {
                "faculty_id": faculty_id if not department_id else faculty_id,
                "department_id": u["department_id"],
                "level": u["level"],
                "section": u["section"],
                "day": day,
                "slot_number": sn,
                "course_id": u["course_id"],
                "teacher_id": tid,
                "room_id": room_id,
                "created_at": now,
                "created_by": current_user["id"],
                "auto_placed": True,
            }
            try:
                await db.weekly_schedule.insert_one(doc)
            except DuplicateKeyError:
                failed.append({"course_name": u["course_name"], "section": u["section"], "level": u["level"],
                               "reason": f"تعارض فريد عند الحفظ ({day} ف{sn})"})
                continue

            # تحديث خرائط الانشغال داخل هذه الدفعة
            section_busy.add((u["department_id"], u["level"], u["section"], day, sn))
            if tid:
                teacher_busy.add((tid, day, sn))
                teacher_day_counts[(tid, day)] = teacher_day_counts.get((tid, day), 0) + 1
            if room_id:
                room_busy.add((room_id, day, sn))
            course_days.setdefault(ck, set()).add(day)

            placed.append({"course_name": u["course_name"], "teacher_name": u["teacher_name"],
                           "level": u["level"], "section": u["section"],
                           "day": day, "slot_number": sn, "room_name": room_name})

    await log_activity(current_user, "auto_place_unscheduled", "weekly_schedule", faculty_id, None,
                       {"placed": len(placed), "failed": len(failed)})
    return {
        "placed": placed,
        "failed": failed,
        "message": f"تم إدراج {len(placed)} محاضرة" + (f" وتعذر إدراج {len(failed)}" if failed else " بنجاح"),
    }
