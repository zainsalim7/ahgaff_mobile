"""
Admin Tools Routes - أدوات إدارية لإصلاح بيانات قاعدة البيانات
- Backfill semester_id للمحاضرات القديمة
- توليد الأرقام المرجعية للطلاب
- (مستقبلاً) أدوات تنظيف وإصلاح أخرى
"""
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from .deps import get_current_user, get_db, has_permission
from models.permissions import UserRole

router = APIRouter(tags=["أدوات الأدمن"])


# ==================== إصلاح أرقام القيد المنتهية بـ.0 ====================
@router.post("/admin/students/fix-dotted-ids")
async def fix_dotted_ids(current_user: dict = Depends(get_current_user)):
    """يزيل اللاحقة .0 من أرقام القيد/الهواتف/سنوات الالتحاق الناتجة عن استيراد Excel قديم."""
    if current_user.get("role") != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك — هذه الأداة للأدمن فقط")
    db = get_db()
    fixed = {"student_id": 0, "phone": 0, "enrollment_year": 0, "username": 0}
    async for s in db.students.find({"$or": [
        {"student_id": {"$regex": r"\.0$"}},
        {"phone": {"$regex": r"\.0$"}},
        {"enrollment_year": {"$regex": r"\.0$"}},
    ]}):
        updates = {}
        old_sid = s.get("student_id") or ""
        for f in ("student_id", "phone", "enrollment_year"):
            v = s.get(f)
            if isinstance(v, str) and v.endswith(".0"):
                updates[f] = v[:-2]
                fixed[f] += 1
        if "student_id" in updates:
            qr = s.get("qr_code") or ""
            if old_sid and old_sid in qr:
                updates["qr_code"] = qr.replace(old_sid, updates["student_id"])
        if updates:
            await db.students.update_one({"_id": s["_id"]}, {"$set": updates})
        if "student_id" in updates and s.get("user_id"):
            try:
                u = await db.users.find_one({"_id": ObjectId(s["user_id"])})
                if u and u.get("username") == old_sid:
                    await db.users.update_one({"_id": u["_id"]}, {"$set": {"username": updates["student_id"]}})
                    fixed["username"] += 1
            except Exception:
                pass
    return {"message": "تم إصلاح الأرقام", "fixed": fixed}


# ==================== Bulk Nationality Fill ====================
@router.post("/admin/students/bulk-nationality")
async def bulk_set_nationality(payload: dict, current_user: dict = Depends(get_current_user)):
    """تعبئة جماعية لجنسية الطلاب الحاليين (غير الخريجين) حسب قواعد لكل كلية.

    body: {"default": "إندونيسي", "rules": [{"faculty_id": "..", "nationality": ".."}], "only_missing": false}
    """
    if current_user.get("role") != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح لك — هذه الأداة للأدمن فقط")
    db = get_db()
    default_nat = (payload.get("default") or "").strip()
    rules = {r["faculty_id"]: r["nationality"].strip() for r in (payload.get("rules") or []) if r.get("faculty_id") and r.get("nationality")}
    only_missing = bool(payload.get("only_missing"))
    if not default_nat and not rules:
        raise HTTPException(status_code=400, detail="يجب تحديد جنسية افتراضية أو قواعد كليات")

    dept_fac = {}
    async for d in db.departments.find({}, {"faculty_id": 1}):
        dept_fac[str(d["_id"])] = d.get("faculty_id", "")

    counts: dict = {}
    async for s in db.students.find({"is_alumni": {"$ne": True}}, {"faculty_id": 1, "department_id": 1, "nationality": 1}):
        if only_missing and (s.get("nationality") or "").strip():
            continue
        fid = s.get("faculty_id") or dept_fac.get(s.get("department_id", ""), "")
        nat = rules.get(fid) or default_nat
        if not nat:
            continue
        await db.students.update_one({"_id": s["_id"]}, {"$set": {"nationality": nat}})
        counts[nat] = counts.get(nat, 0) + 1

    return {"message": "تمت التعبئة الجماعية للجنسيات", "updated": sum(counts.values()), "by_nationality": counts}


# ==================== Lecture Semester Backfill ====================
def _normalize_semester_date(d):
    """نسخة محلية من normalize_semester_date لتجنب الاستيراد الدائري."""
    if not d or not isinstance(d, str):
        return None
    s = d.strip()
    if len(s) == 10 and s[4] == '-' and s[7] == '-':
        return s
    parts = s.split('-')
    if len(parts) == 3:
        try:
            day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
            return f"{year:04d}-{month:02d}-{day:02d}"
        except Exception:
            return None
    return None


async def _build_semesters_index(db_inst):
    """يجلب كل الفصول مع تواريخ مُحوَّلة لمقارنة سريعة."""
    sems = await db_inst.semesters.find({}).to_list(100)
    indexed = []
    for s in sems:
        sd = _normalize_semester_date(s.get("start_date"))
        ed = _normalize_semester_date(s.get("end_date"))
        if sd and ed:
            indexed.append({
                "id": str(s["_id"]),
                "name": s.get("name", ""),
                "start_date": sd,
                "end_date": ed,
            })
    return indexed


def _ensure_admin(current_user: dict):
    if (
        current_user["role"] != UserRole.ADMIN
        and not has_permission(current_user, "manage_semesters")
        and not has_permission(current_user, "manage_courses")
    ):
        raise HTTPException(status_code=403, detail="غير مصرح لك")


@router.get("/admin/backfill-lecture-semesters/preview")
async def preview_backfill(current_user: dict = Depends(get_current_user)):
    """معاينة عدد المحاضرات التي ستُحدَّث وتوزيعها على الفصول.
    لا يُعدّل أي بيانات.
    """
    _ensure_admin(current_user)
    db = get_db()

    semesters = await _build_semesters_index(db)
    if not semesters:
        return {
            "total_lectures": await db.lectures.count_documents({}),
            "without_semester": 0,
            "matched_by_semester": [],
            "unmatched": 0,
            "warning": "لا توجد فصول دراسية بتواريخ صالحة في النظام",
        }

    total = await db.lectures.count_documents({})
    without_query = {"$or": [
        {"semester_id": {"$exists": False}},
        {"semester_id": None},
        {"semester_id": ""},
    ]}
    without_count = await db.lectures.count_documents(without_query)

    # لكل فصل: عدد المحاضرات التي تواريخها داخل نطاقه ولا تحوي semester_id
    matched = []
    matched_total = 0
    for sem in semesters:
        cnt = await db.lectures.count_documents({
            **without_query,
            "date": {"$gte": sem["start_date"], "$lte": sem["end_date"]},
        })
        matched.append({
            "id": sem["id"],
            "name": sem["name"],
            "start_date": sem["start_date"],
            "end_date": sem["end_date"],
            "lectures_to_update": cnt,
        })
        matched_total += cnt

    unmatched = without_count - matched_total
    if unmatched < 0:
        unmatched = 0

    return {
        "total_lectures": total,
        "without_semester": without_count,
        "matched_by_semester": matched,
        "matched_total": matched_total,
        "unmatched": unmatched,
    }


@router.post("/admin/backfill-lecture-semesters/execute")
async def execute_backfill(
    dry_run: bool = False,
    current_user: dict = Depends(get_current_user),
):
    """تنفيذ تحديث المحاضرات القديمة بإسناد semester_id لها بناءً على نطاق التاريخ."""
    _ensure_admin(current_user)
    db = get_db()

    semesters = await _build_semesters_index(db)
    if not semesters:
        raise HTTPException(status_code=400, detail="لا توجد فصول بتواريخ صالحة")

    without_query = {"$or": [
        {"semester_id": {"$exists": False}},
        {"semester_id": None},
        {"semester_id": ""},
    ]}

    updates_per_semester = []
    grand_total = 0
    for sem in semesters:
        match_query = {
            **without_query,
            "date": {"$gte": sem["start_date"], "$lte": sem["end_date"]},
        }
        if dry_run:
            cnt = await db.lectures.count_documents(match_query)
        else:
            res = await db.lectures.update_many(
                match_query,
                {"$set": {"semester_id": sem["id"], "semester_name": sem["name"]}},
            )
            cnt = res.modified_count
        updates_per_semester.append({
            "semester_id": sem["id"],
            "semester_name": sem["name"],
            "updated": cnt,
        })
        grand_total += cnt

    return {
        "dry_run": dry_run,
        "total_updated": grand_total,
        "details": updates_per_semester,
        "message": (
            "محاكاة فقط - لم يتم التعديل"
            if dry_run
            else f"تم تحديث {grand_total} محاضرة"
        ),
    }


# ==================== Student Reference Number Generator ====================
VALID_PROGRAM_CODES = {"B", "M", "D", "E", "P"}
PROGRAM_LABELS = {
    "B": "بكالوريوس",
    "M": "ماجستير",
    "D": "دكتوراه",
    "E": "عن بُعد",
    "P": "دبلوم",
}


async def compute_enrollment_year_from_level(db_inst, level: int) -> Optional[str]:
    """يحسب سنة الالتحاق المتوقعة من المستوى الحالي.
    يأخذ بداية الفصل المُفعَّل كمرجع للسنة الأكاديمية الحالية.
    مثال: لو الفصل بدأ 2025-12-20 → السنة الأكاديمية = 2025
    طالب م1 → 2025 → "25"
    طالب م2 → 2024 → "24"
    """
    if not level or level < 1:
        return None
    sem = await db_inst.semesters.find_one({
        "$or": [{"status": "active"}, {"is_active": True}]
    })
    base_year = None
    if sem:
        sd = sem.get("start_date") or ""
        # يحاول استخراج السنة من D-M-YYYY أو YYYY-MM-DD
        try:
            parts = str(sd).split("-")
            if len(parts) == 3:
                # YYYY-MM-DD
                if len(parts[0]) == 4:
                    base_year = int(parts[0])
                # D-M-YYYY
                elif len(parts[2]) == 4:
                    base_year = int(parts[2])
        except Exception:
            base_year = None
    if not base_year:
        from datetime import datetime
        base_year = datetime.now().year
    enrollment = base_year - (int(level) - 1)
    return f"{enrollment % 100:02d}"


def _format_year(year_val) -> Optional[str]:
    """تحويل سنة (مثل 2025 أو '25' أو '2025') إلى رمز خانتين '25'."""
    if year_val is None:
        return None
    s = str(year_val).strip()
    if not s:
        return None
    # 2025 → 25
    if len(s) == 4 and s.isdigit():
        return s[-2:]
    if len(s) == 2 and s.isdigit():
        return s
    return None


def _format_faculty_code(code) -> Optional[str]:
    """تحويل رمز الكلية لخانتين (مثل '1' → '01')."""
    if code is None:
        return None
    s = str(code).strip()
    if not s:
        return None
    if s.isdigit():
        return s.zfill(2)[:2]
    return s[:2].upper()


async def _build_student_reference(
    db_inst,
    student: dict,
    university_short_code: str,
    faculties_by_id: dict,
    next_seq_per_key: dict,
) -> Optional[str]:
    """يولّد الرقم المرجعي لطالب واحد. يستخدم next_seq_per_key لتسلسل بالـ key.
    Key = (faculty_code, year_code, program_code)
    """
    program = (student.get("program_code") or "").strip().upper()
    year = _format_year(student.get("enrollment_year"))
    faculty_id = student.get("faculty_id")
    faculty = faculties_by_id.get(faculty_id) if faculty_id else None
    fac_code = _format_faculty_code((faculty or {}).get("numeric_code"))

    if program not in VALID_PROGRAM_CODES or not year or not fac_code or not university_short_code:
        return None

    key = f"{fac_code}|{year}|{program}"
    seq = next_seq_per_key.get(key, 1)
    next_seq_per_key[key] = seq + 1
    return f"{university_short_code}{program}{year}{fac_code}{seq:03d}"


async def generate_reference_for_new_student(db_inst, student_doc: dict) -> Optional[str]:
    """يولّد الرقم المرجعي عند إنشاء طالب جديد (يأخذ بالاعتبار آخر تسلسل في DB)."""
    program = (student_doc.get("program_code") or "").strip().upper()
    year = _format_year(student_doc.get("enrollment_year"))
    faculty_id = student_doc.get("faculty_id")
    if program not in VALID_PROGRAM_CODES or not year or not faculty_id:
        return None

    uni = await db_inst.university.find_one({})
    uni_short = (uni or {}).get("short_code") or "AU"
    fac = await db_inst.faculties.find_one({"_id": ObjectId(faculty_id)})
    fac_code = _format_faculty_code((fac or {}).get("numeric_code"))
    if not fac_code:
        return None

    prefix = f"{uni_short}{program}{year}{fac_code}"
    # ابحث عن أعلى تسلسل سابق
    cursor = db_inst.students.find(
        {"reference_number": {"$regex": f"^{prefix}\\d{{3}}$"}},
        {"reference_number": 1},
    )
    max_seq = 0
    async for s in cursor:
        ref = s.get("reference_number") or ""
        try:
            seq = int(ref[-3:])
            if seq > max_seq:
                max_seq = seq
        except Exception:
            pass
    return f"{prefix}{max_seq + 1:03d}"


@router.get("/admin/student-references/preview")
async def preview_student_refs(current_user: dict = Depends(get_current_user)):
    """معاينة عدد الطلاب الذين يمكن توليد الرقم المرجعي لهم."""
    _ensure_admin(current_user)
    db = get_db()

    uni = await db.university.find_one({})
    uni_short = (uni or {}).get("short_code")
    if not uni_short:
        return {
            "ready_count": 0,
            "missing_university_code": True,
            "warning": "يجب تعيين short_code للجامعة (مثلاً 'AU') في إعدادات الجامعة",
        }

    faculties = await db.faculties.find({}).to_list(100)
    faculties_by_id = {str(f["_id"]): f for f in faculties}
    faculties_with_code = [f for f in faculties if _format_faculty_code(f.get("numeric_code"))]

    total_students = await db.students.count_documents({})
    have_ref = await db.students.count_documents({"reference_number": {"$nin": [None, ""]}})
    without_ref = total_students - have_ref

    # كم طالب لديه كل الحقول المطلوبة؟
    students = await db.students.find({}, {
        "program_code": 1,
        "enrollment_year": 1,
        "faculty_id": 1,
        "reference_number": 1,
    }).to_list(10000)

    ready = 0
    missing_program = 0
    missing_year = 0
    missing_faculty_code = 0
    for s in students:
        if s.get("reference_number"):
            continue
        prog = (s.get("program_code") or "").strip().upper()
        year = _format_year(s.get("enrollment_year"))
        fac = faculties_by_id.get(s.get("faculty_id"))
        fac_code = _format_faculty_code((fac or {}).get("numeric_code"))
        if prog in VALID_PROGRAM_CODES and year and fac_code:
            ready += 1
        else:
            if prog not in VALID_PROGRAM_CODES:
                missing_program += 1
            elif not year:
                missing_year += 1
            elif not fac_code:
                missing_faculty_code += 1

    return {
        "university_short_code": uni_short,
        "faculties_with_code": len(faculties_with_code),
        "faculties_total": len(faculties),
        "total_students": total_students,
        "students_with_ref": have_ref,
        "students_without_ref": without_ref,
        "ready_to_generate": ready,
        "missing_program_code": missing_program,
        "missing_enrollment_year": missing_year,
        "missing_faculty_code": missing_faculty_code,
    }


@router.post("/admin/student-references/execute")
async def execute_student_refs(current_user: dict = Depends(get_current_user)):
    """توليد الأرقام المرجعية للطلاب الذين يستوفون الشروط ولا يملكون رقماً سابقاً."""
    _ensure_admin(current_user)
    db = get_db()

    uni = await db.university.find_one({})
    uni_short = (uni or {}).get("short_code")
    if not uni_short:
        raise HTTPException(status_code=400, detail="يجب تعيين short_code للجامعة في إعدادات الجامعة")

    faculties = await db.faculties.find({}).to_list(100)
    faculties_by_id = {str(f["_id"]): f for f in faculties}

    # جلب أعلى تسلسل لكل بريفكس موجود حالياً
    next_seq_per_key: dict = {}
    cursor = db.students.find(
        {"reference_number": {"$nin": [None, ""]}},
        {"reference_number": 1},
    )
    async for s in cursor:
        ref = s.get("reference_number", "")
        # نحاول استخراج (fac, year, program, seq) من الرقم
        if len(ref) < 10 or not ref.startswith(uni_short):
            continue
        try:
            program = ref[len(uni_short)]
            year = ref[len(uni_short) + 1:len(uni_short) + 3]
            fac = ref[len(uni_short) + 3:len(uni_short) + 5]
            seq = int(ref[-3:])
            key = f"{fac}|{year}|{program}"
            if next_seq_per_key.get(key, 0) < seq + 1:
                next_seq_per_key[key] = seq + 1
        except Exception:
            continue

    # اقرأ الطلاب بدون رقم
    students = await db.students.find({
        "$or": [
            {"reference_number": {"$exists": False}},
            {"reference_number": None},
            {"reference_number": ""},
        ]
    }).to_list(10000)

    updated = 0
    skipped_missing_data = 0
    details = []
    for s in students:
        ref = await _build_student_reference(
            db, s, uni_short, faculties_by_id, next_seq_per_key
        )
        if ref:
            await db.students.update_one(
                {"_id": s["_id"]},
                {"$set": {"reference_number": ref}},
            )
            updated += 1
            details.append({"student_id": s.get("student_id"), "name": s.get("full_name"), "ref": ref})
        else:
            skipped_missing_data += 1

    return {
        "updated": updated,
        "skipped_missing_data": skipped_missing_data,
        "message": f"تم توليد {updated} رقم مرجعي",
        "sample_details": details[:10],
    }



# ==================== Auto-fill enrollment_year + program_code ====================
@router.get("/admin/student-autofill/preview")
async def preview_student_autofill(current_user: dict = Depends(get_current_user)):
    """معاينة الطلاب الذين سيُملأ لهم enrollment_year و/أو program_code تلقائياً.
    enrollment_year من المستوى. program_code من القسم.
    """
    _ensure_admin(current_user)
    db = get_db()
    students = await db.students.find({}, {
        "level": 1,
        "department_id": 1,
        "enrollment_year": 1,
        "program_code": 1,
    }).to_list(20000)

    # خرائط الأقسام والافتراضي
    depts = await db.departments.find({}, {"default_program_code": 1}).to_list(500)
    dept_program = {str(d["_id"]): d.get("default_program_code") for d in depts}

    will_fill_year = 0
    will_fill_program = 0
    no_dept_program = 0
    by_level = {}

    for s in students:
        level = s.get("level")
        if not s.get("enrollment_year") and level:
            will_fill_year += 1
            key = str(level)
            by_level[key] = by_level.get(key, 0) + 1
        if not s.get("program_code"):
            dept_id = s.get("department_id")
            if dept_id and dept_program.get(dept_id):
                will_fill_program += 1
            else:
                no_dept_program += 1

    # احسب enrollment لكل مستوى للعرض
    sample_year_per_level = {}
    for lvl_str in by_level.keys():
        try:
            sample_year_per_level[lvl_str] = await compute_enrollment_year_from_level(db, int(lvl_str))
        except Exception:
            pass

    return {
        "total_students": len(students),
        "will_fill_enrollment_year": will_fill_year,
        "will_fill_program_code": will_fill_program,
        "missing_dept_default_program": no_dept_program,
        "by_level": [
            {
                "level": int(k),
                "count": v,
                "computed_year": sample_year_per_level.get(k),
            }
            for k, v in sorted(by_level.items(), key=lambda x: int(x[0]))
        ],
    }


@router.post("/admin/student-autofill/execute")
async def execute_student_autofill(current_user: dict = Depends(get_current_user)):
    """ينفّذ ملء enrollment_year و program_code تلقائياً للطلاب الذين تنقصهم."""
    _ensure_admin(current_user)
    db = get_db()

    depts = await db.departments.find({}, {"default_program_code": 1}).to_list(500)
    dept_program = {str(d["_id"]): d.get("default_program_code") for d in depts}

    # كاش لـ enrollment_year حسب المستوى لتجنب الحساب المتكرر
    year_cache = {}

    students = await db.students.find({
        "$or": [
            {"enrollment_year": {"$in": [None, ""]}},
            {"enrollment_year": {"$exists": False}},
            {"program_code": {"$in": [None, ""]}},
            {"program_code": {"$exists": False}},
        ]
    }).to_list(20000)

    updated_year = 0
    updated_program = 0
    for s in students:
        update_doc = {}
        if not s.get("enrollment_year") and s.get("level"):
            lvl = int(s["level"])
            if lvl not in year_cache:
                year_cache[lvl] = await compute_enrollment_year_from_level(db, lvl)
            ey = year_cache[lvl]
            if ey:
                update_doc["enrollment_year"] = ey
                updated_year += 1
        if not s.get("program_code"):
            dept_id = s.get("department_id")
            if dept_id and dept_program.get(dept_id):
                update_doc["program_code"] = dept_program[dept_id]
                updated_program += 1
        if update_doc:
            await db.students.update_one({"_id": s["_id"]}, {"$set": update_doc})

    return {
        "updated_enrollment_year": updated_year,
        "updated_program_code": updated_program,
        "message": f"تم ملء {updated_year} سنة التحاق و {updated_program} رمز برنامج",
    }

