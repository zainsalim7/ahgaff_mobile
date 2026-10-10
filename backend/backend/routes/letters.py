"""✉️ الخطابات الرسمية البسيطة — بنفس تجربة الإفادات: قالب → متن بمتغيرات → مرسَل إليه → PDF بترقيم تسلسلي + QR + سجل.
مستقلة تماماً عن وحدة المراسلات المتقدمة."""
import io
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from bson import ObjectId

from .deps import get_db, get_current_user, log_activity, export_stamp, has_permission, has_any_permission
from .hr_common import scope_employee_ids, user_id_of
from .letterheads import resolve_letterhead, resolve_series, next_serial, format_number
from .statements import _apply_vars, _var_ctx, _safe_dept, _academic_year_display, get_verify_base, student_gender, GENDER_VARS
from services.letter_pdf import build_letter_pdf
from services.letter_docx import build_letter_docx

router = APIRouter(tags=["الخطابات"])
SETTINGS_ID = "letters"
DEFAULT_REF = "{seq}/خ/{yy}"
SECTION_KEYS = ["recipient", "greeting", "subject", "closing", "signature"]
SECTION_LABELS = {"recipient": "المستلم", "greeting": "التحية", "subject": "الموضوع", "closing": "الخاتمة", "signature": "التوقيع"}
DEFAULT_SECTIONS = {
    "recipient": '<p style="text-align: right"><strong><span style="font-size: 14pt">إلى: {اسم_المرسل_إليه} {تكريم}</span></strong></p><p style="text-align: right"><span style="font-size: 13pt">{صفة_المرسل_إليه}</span></p><p style="text-align: right"><span style="font-size: 13pt">{جهة_المرسل_إليه}</span></p>',
    "greeting": '<p style="text-align: right"><span style="font-size: 13pt">السلام عليكم ورحمة الله وبركاته،</span></p>',
    "subject": '<p style="text-align: center"><strong><u><span style="font-size: 14pt">الموضوع: {الموضوع}</span></u></strong></p>',
    "closing": '<p style="text-align: right"><span style="font-size: 13.5pt">وتفضلوا بقبول فائق الاحترام والتقدير،</span></p>',
    "signature": '<p style="text-align: center"><strong><span style="font-size: 13pt">{صفة_الموقع}</span></strong></p><p style="text-align: center"><span style="font-size: 13pt">{اسم_الموقع}</span></p>',
}
LETTER_VARS = ["اسم_المرسل_إليه", "صفة_المرسل_إليه", "جهة_المرسل_إليه", "تكريم", "الموضوع", "اسم_الموقع", "صفة_الموقع", "التاريخ", "التاريخ_الهجري", "العام_الجامعي",
               "اسم_الطالب", "رقم_القيد", "الكلية", "القسم", "المستوى", "الجنسية", "اسم_الموظف", "الوظيفة", "وحدة_الموظف", "اسم_المدرس", "جدول_الأسماء", "قائمة_الأسماء", "عدد_الأسماء"]


P_ISSUE, P_SETTINGS = "issue_letters", "manage_letter_settings"
HR_PERMS = ["hr_manage_correspondence", "hr_manage_employees"]


def _can(user: dict) -> bool:
    """إصدار الخطابات: صلاحية issue_letters أو صلاحيات HR (لخطابات الموظفين) — الأدمن دائماً"""
    if user.get("role") in ("teacher", "student"):
        return False
    return has_permission(user, P_ISSUE) or has_any_permission(user, HR_PERMS)


def _guard(user: dict):
    if not _can(user):
        raise HTTPException(status_code=403, detail="ليست لديك صلاحية إصدار الخطابات الرسمية")


def _guard_settings(user: dict):
    _guard(user)
    if not has_permission(user, P_SETTINGS):
        raise HTTPException(status_code=403, detail="تعديل الكليشة والقوالب يتطلب صلاحية «إدارة كليشة الخطابات وقوالبها»")


def _user_faculties(user: dict) -> list:
    fids = set(user.get("faculty_ids") or [])
    if user.get("faculty_id"):
        fids.add(user["faculty_id"])
    return [str(f) for f in fids if f]


async def _visible_filter(db, user: dict) -> dict:
    """نطاق السجل: الأدمن الكل؛ غيره: ما أصدره + العامة (بلا أشخاص) + ما يخص كلياته + موظفو نطاقه الإداري"""
    if user.get("role") == "admin":
        return {}
    uid = user_id_of(user)
    ors: list = [{"issued_by": uid}, {"created_by": uid}, {"people": {"$size": 0}}, {"people": {"$exists": False}}]
    fids = _user_faculties(user)
    if fids:
        ors.append({"people": {"$elemMatch": {"kind": {"$in": ["student", "teacher"]}, "faculty_id": {"$in": fids}}}})
    if has_any_permission(user, HR_PERMS):
        emp_ids = await scope_employee_ids(db, user)
        ors.append({"people.kind": "employee"} if emp_ids is None else {"people": {"$elemMatch": {"kind": "employee", "id": {"$in": emp_ids}}}})
    return {"$or": ors}


async def _load_visible(db, user: dict, lid: str) -> dict:
    if not ObjectId.is_valid(lid):
        raise HTTPException(status_code=404, detail="الخطاب غير موجود")
    s = await db.letters.find_one({"_id": ObjectId(lid)})
    if not s:
        raise HTTPException(status_code=404, detail="الخطاب غير موجود")
    if user.get("role") != "admin" and not await db.letters.find_one({"_id": s["_id"], **(await _visible_filter(db, user))}, {"_id": 1}):
        raise HTTPException(status_code=403, detail="هذا الخطاب خارج نطاق صلاحيتك")
    return s


def _people_faculty(row: dict) -> str:
    if row["kind"] == "student":
        return str((row.get("_fac") or {}).get("_id") or row["_doc"].get("faculty_id") or (row.get("_dept") or {}).get("faculty_id") or "")
    if row["kind"] == "teacher":
        return str(row["_doc"].get("faculty_id") or "")
    return ""


async def backfill_people_faculty(db):
    """ترحيل مرة واحدة: إضافة faculty_id لأشخاص الخطابات القديمة ليعمل نطاق السجل"""
    async for l in db.letters.find({"people.0": {"$exists": True}, "people.faculty_id": {"$exists": False}}, {"people": 1}):
        people = []
        for p in l.get("people") or []:
            row = await _person_row(db, p.get("kind", "student"), p.get("id", ""))
            people.append({**p, "faculty_id": _people_faculty(row) if row else ""})
        await db.letters.update_one({"_id": l["_id"]}, {"$set": {"people": people}})


def _oid(v):
    return ObjectId(v) if v and ObjectId.is_valid(str(v)) else None


# ───────── الإعدادات (كليشة واحدة للخطابات) ─────────
class LetterSettings(BaseModel):
    org_name: Optional[str] = "جامعة الأحقاف"
    org_name_en: Optional[str] = "AL-AHGAFF UNIVERSITY"
    office_name: Optional[str] = ""
    office_name_en: Optional[str] = ""
    logo_base64: Optional[str] = ""
    signature_base64: Optional[str] = ""
    default_signatory_name: Optional[str] = ""
    default_signatory_title: Optional[str] = ""
    phones: Optional[str] = ""
    fax: Optional[str] = ""
    address: Optional[str] = ""
    po_box: Optional[str] = ""
    website: Optional[str] = ""
    reference_format: Optional[str] = DEFAULT_REF
    closing: Optional[str] = "وتفضلوا بقبول فائق الاحترام والتقدير،"
    layout: Optional[dict] = None   # 📐 تخطيط الصفحة الافتراضي (مم)
    header_image_base64: Optional[str] = ""   # 🖼️ ترويسة جاهزة كصورة (تحل محل الشعار والنصوص)
    footer_image_base64: Optional[str] = ""   # 🖼️ تذييل جاهز كصورة


@router.get("/letters/settings")
async def get_settings(current_user: dict = Depends(get_current_user)):
    """يرجع أيضاً can_edit_settings (كليشة/قوالب)"""
    _guard(current_user)
    lh = await resolve_letterhead(get_db(), current_user, None)
    lh = {k: v for k, v in lh.items() if k != "_id"}
    return {**LetterSettings().dict(), **lh, "variables": LETTER_VARS, "can_edit_settings": has_permission(current_user, P_SETTINGS)}


@router.put("/letters/settings")
async def put_settings(data: LetterSettings, current_user: dict = Depends(get_current_user)):
    _guard_settings(current_user)
    db = get_db()
    await db.letter_settings.update_one({"_id": SETTINGS_ID}, {"$set": {**data.dict(), "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    await db.letterheads.update_one({"is_default": True}, {"$set": {**data.dict(exclude={"reference_format"}), "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"ok": True}


# ───────── القوالب ─────────
class LetterTemplate(BaseModel):
    name: str
    subject: Optional[str] = ""
    body: str
    signatory_name: Optional[str] = ""
    signatory_title: Optional[str] = ""
    signatory_position_id: Optional[str] = ""   # 🖋️ من دليل المناصب (يتقدّم على الاسم/الصفة اليدويين)
    letterhead_id: Optional[str] = ""
    series_id: Optional[str] = ""
    sections: Optional[dict] = None
    concerns: Optional[str] = "none"  # none | student | employee | teacher | many
    is_active: bool = True


def _ser(d: dict) -> dict:
    d = dict(d); d["id"] = str(d.pop("_id")); return d


@router.get("/letter-templates")
async def list_templates(current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    return [_ser(t) for t in await get_db().letter_templates.find({"is_active": {"$ne": False}}).sort("name", 1).to_list(300)]


@router.post("/letter-templates")
async def create_template(data: LetterTemplate, current_user: dict = Depends(get_current_user)):
    _guard_settings(current_user)
    if not data.name.strip() or not data.body.strip():
        raise HTTPException(status_code=400, detail="اسم القالب والمتن مطلوبان")
    r = await get_db().letter_templates.insert_one({**data.dict(), "created_at": datetime.now(timezone.utc).isoformat(), "created_by": current_user.get("id")})
    return {"id": str(r.inserted_id)}


@router.put("/letter-templates/{tid}")
async def update_template(tid: str, data: LetterTemplate, current_user: dict = Depends(get_current_user)):
    _guard_settings(current_user)
    await get_db().letter_templates.update_one({"_id": ObjectId(tid)}, {"$set": data.dict()})
    return {"ok": True}


@router.delete("/letter-templates/{tid}")
async def delete_template(tid: str, current_user: dict = Depends(get_current_user)):
    _guard_settings(current_user)
    await get_db().letter_templates.update_one({"_id": ObjectId(tid)}, {"$set": {"is_active": False}})
    return {"ok": True}


# ───────── المرسَل إليهم (دليل المناصب) والأشخاص ─────────
@router.get("/letters/recipients")
async def recipients(current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    db = get_db()
    out = []
    for p in await db.correspondence_positions.find({"is_active": {"$ne": False}}).sort([("kind", 1), ("sort_order", 1)]).to_list(500):
        org = ""
        if p.get("organization_id") and ObjectId.is_valid(p["organization_id"]):
            org = ((await db.org_units.find_one({"_id": ObjectId(p["organization_id"])}, {"name": 1})) or {}).get("name", "")
        hon = (p.get("honorific") or "").strip()
        out.append({"id": str(p["_id"]), "kind": p.get("kind", "INTERNAL"), "title": p["title_ar"], "name": f"{hon}/ {p['holder_name']}" if hon else p["holder_name"],
                    "organization": org or p.get("external_organization") or "", "suffix": p.get("recipient_suffix") or "المحترم"})
    return out


@router.get("/letters/people")
async def people(kind: str = Query(...), q: str = Query("", min_length=0), current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    db = get_db()
    rx = {"$regex": re.escape(q.strip()), "$options": "i"}
    if kind == "student":
        rows = await db.students.find({"$or": [{"full_name": rx}, {"student_id": rx}]}, {"full_name": 1, "student_id": 1, "level": 1}).limit(15).to_list(15)
        return [{"id": str(r["_id"]), "kind": "student", "label": r.get("full_name", ""), "sub": f"قيد {r.get('student_id', '')} · م{r.get('level', '')}"} for r in rows]
    if kind == "employee":
        rows = await db.employees.find({"$or": [{"full_name": rx}, {"employee_no": rx}]}, {"full_name": 1, "employee_no": 1, "job_title": 1}).limit(15).to_list(15)
        return [{"id": str(r["_id"]), "kind": "employee", "label": r.get("full_name", ""), "sub": f"{r.get('employee_no', '')} · {r.get('job_title', '')}"} for r in rows]
    rows = await db.teachers.find({"$or": [{"full_name": rx}, {"name": rx}]}, {"full_name": 1, "name": 1, "academic_title": 1}).limit(15).to_list(15)
    return [{"id": str(r["_id"]), "kind": "teacher", "label": r.get("full_name") or r.get("name", ""), "sub": r.get("academic_title", "")} for r in rows]


# ───────── بناء سياق المتغيرات ─────────
# 📋 حقول إضافية متاحة كأعمدة في جدول الأسماء (حسب نوع الشخص) — التسمية هي عنوان العمود
STUDENT_STATUS_AR = {"active": "مستمر", "repeat": "إعادة", "graduated": "متخرج", "expelled": "مفصول", "frozen": "مجمَّد", "suspended": "موقوف"}
FIELD_CATALOG = {
    "student": ["الاسم", "رقم القيد", "الرقم المرجعي", "الكلية", "القسم", "المستوى", "الشعبة", "الجنسية", "الجنس", "الهاتف", "البريد", "الحالة", "سنة الالتحاق"],
    "employee": ["الاسم", "الرقم الوظيفي", "الوظيفة", "الوحدة", "الفئة", "الجنسية", "الهاتف", "البريد", "تاريخ التعيين", "المؤهل", "التخصص"],
    "teacher": ["الاسم", "اللقب العلمي", "الكلية", "القسم", "التخصص", "الهاتف", "البريد"],
}


async def _person_row(db, kind: str, pid: str) -> Optional[dict]:
    oid = _oid(pid)
    if not oid:
        return None
    if kind == "student":
        s = await db.students.find_one({"_id": oid})
        if not s:
            return None
        dept = await _safe_dept(db, s)
        fac = await db.faculties.find_one({"_id": _oid(s.get("faculty_id") or (dept or {}).get("faculty_id"))}) if (s.get("faculty_id") or (dept or {}).get("faculty_id")) else None
        g = student_gender(s, fac)
        fields = {"الاسم": s.get("full_name", ""), "رقم القيد": s.get("student_id", ""), "الرقم المرجعي": s.get("reference_number", ""), "الكلية": (fac or {}).get("name", ""), "القسم": (dept or {}).get("name", ""),
                  "المستوى": f"المستوى {s.get('level', '')}", "الشعبة": str(s.get("section") or ""), "الجنسية": (s.get("nationality") or "يمني"), "الجنس": "أنثى" if g == "female" else "ذكر",
                  "الهاتف": s.get("phone") or "", "البريد": s.get("email") or "", "الحالة": STUDENT_STATUS_AR.get(s.get("status") or "active", "مستمر"), "سنة الالتحاق": str(s.get("enrollment_year") or "")}
        return {"kind": "student", "name": s.get("full_name", ""), "code": s.get("student_id", ""), "c1": (fac or {}).get("name", ""), "c2": (dept or {}).get("name", ""), "c3": f"المستوى {s.get('level', '')}", "fields": fields, "_doc": s, "_dept": dept, "_fac": fac}
    if kind == "employee":
        e = await db.employees.find_one({"_id": oid})
        if not e:
            return None
        unit = await db.org_units.find_one({"_id": _oid(e.get("org_unit_id"))}, {"name": 1}) if e.get("org_unit_id") else None
        fields = {"الاسم": e.get("full_name", ""), "الرقم الوظيفي": e.get("employee_no", ""), "الوظيفة": e.get("job_title", ""), "الوحدة": (unit or {}).get("name", ""), "الفئة": e.get("category") or "",
                  "الجنسية": e.get("nationality") or "", "الهاتف": e.get("phone") or "", "البريد": e.get("email") or "", "تاريخ التعيين": str(e.get("hire_date") or "")[:10], "المؤهل": e.get("qualification") or "", "التخصص": e.get("specialization") or ""}
        return {"kind": "employee", "name": e.get("full_name", ""), "code": e.get("employee_no", ""), "c1": e.get("job_title", ""), "c2": (unit or {}).get("name", ""), "c3": "", "fields": fields, "_doc": e}
    t = await db.teachers.find_one({"_id": oid})
    if not t:
        return None
    fac = await db.faculties.find_one({"_id": _oid(t.get("faculty_id"))}, {"name": 1}) if t.get("faculty_id") else None
    tdept = await db.departments.find_one({"_id": _oid(t.get("department_id"))}, {"name": 1}) if t.get("department_id") else None
    fields = {"الاسم": t.get("full_name") or t.get("name", ""), "اللقب العلمي": t.get("academic_title", ""), "الكلية": (fac or {}).get("name", ""), "القسم": (tdept or {}).get("name", ""),
              "التخصص": t.get("specialization") or "", "الهاتف": t.get("phone") or "", "البريد": t.get("email") or ""}
    return {"kind": "teacher", "name": t.get("full_name") or t.get("name", ""), "code": t.get("academic_title", ""), "c1": (fac or {}).get("name", ""), "c2": "", "c3": "", "fields": fields, "_doc": t}


TABLE_HEADERS = {"student": ["م", "الاسم", "رقم القيد", "الكلية", "القسم", "المستوى"], "employee": ["م", "الاسم", "الرقم الوظيفي", "الوظيفة", "الوحدة"], "teacher": ["م", "الاسم", "اللقب", "الكلية"],
                 "mixed": ["م", "الاسم", "الصفة", "الرقم", "الجهة / الكلية", "القسم / الوظيفة"]}
KIND_AR = {"student": "طالب", "employee": "موظف", "teacher": "مدرّس"}


def _table_rows(rows: List[dict]) -> dict:
    """جدول الأسماء: أعمدة حسب الصفة إن كانت موحّدة، وجدول مختلط (طلاب + موظفون + مدرّسون) إن تنوّعت"""
    if not rows:
        return {"headers": [], "rows": []}
    kinds = {r["kind"] for r in rows}
    if len(kinds) > 1:
        data = []
        for i, r in enumerate(rows):
            if r["kind"] == "student":
                data.append([str(i + 1), r["name"], KIND_AR["student"], r["code"], r["c1"], f"{r['c2']} — {r['c3']}".strip(" —")])
            elif r["kind"] == "employee":
                data.append([str(i + 1), r["name"], KIND_AR["employee"], r["code"], r["c2"], r["c1"]])
            else:
                data.append([str(i + 1), r["name"], KIND_AR["teacher"], r["code"], r["c1"], ""])
        return _with_extra_fields(TABLE_HEADERS["mixed"], data, rows)
    k = rows[0]["kind"]
    if k == "student":
        data = [[str(i + 1), r["name"], r["code"], r["c1"], r["c2"], r["c3"]] for i, r in enumerate(rows)]
    elif k == "employee":
        data = [[str(i + 1), r["name"], r["code"], r["c1"], r["c2"]] for i, r in enumerate(rows)]
    else:
        data = [[str(i + 1), r["name"], r["code"], r["c1"]] for i, r in enumerate(rows)]
    return _with_extra_fields(TABLE_HEADERS[k], data, rows)


def _with_extra_fields(default_headers: list, data: list, rows: list) -> dict:
    """يلحق كل الحقول الإضافية المتاحة كأعمدة (تُخفى افتراضياً) — default_headers = الأعمدة الظاهرة بلا تخصيص"""
    extra: list = []
    for k in ("student", "employee", "teacher"):
        if any(r["kind"] == k for r in rows):
            extra += [h for h in FIELD_CATALOG[k] if h not in default_headers and h not in extra]
    full = [row + [(rows[i].get("fields") or {}).get(h, "") for h in extra] for i, row in enumerate(data)]
    return {"headers": default_headers + extra, "default_headers": default_headers, "rows": full, "mixed": len({r["kind"] for r in rows}) > 1}


async def _build_ctx(db, rec: dict, subject: str, people_in: List[dict]) -> tuple:
    from hijridate import Gregorian
    now = datetime.now(timezone.utc)
    hj = Gregorian(now.year, now.month, now.day).to_hijri()
    ctx = {"اسم_المرسل_إليه": rec.get("name", ""), "صفة_المرسل_إليه": rec.get("title", ""), "جهة_المرسل_إليه": rec.get("organization", ""), "تكريم": rec.get("suffix", ""),
           "الموضوع": subject or "", "التاريخ": now.strftime("%Y/%m/%d") + "م", "التاريخ_الهجري": f"{hj.year}/{hj.month:02d}/{hj.day:02d}هـ", "العام_الجامعي": await _academic_year_display(db),
           "اسم_الطالب": "", "رقم_القيد": "", "الكلية": "", "القسم": "", "المستوى": "", "الجنسية": "", "اسم_الموظف": "", "الوظيفة": "", "وحدة_الموظف": "", "اسم_المدرس": "", "جدول_الأسماء": "{جدول_الأسماء}", "قائمة_الأسماء": "", "عدد_الأسماء": ""}
    rows = [r for r in [await _person_row(db, p.get("kind", "student"), p.get("id", "")) for p in people_in] if r]
    if rows:
        first = rows[0]
        if first["kind"] == "student":
            s, dept, fac = first["_doc"], first["_dept"], first["_fac"]
            sc = _var_ctx(s, dept, fac, ctx["العام_الجامعي"])
            for k in ("اسم_الطالب", "رقم_القيد", "الجنسية", "المستوى"):
                ctx[k] = sc.get(k, "")
            ctx["الكلية"], ctx["القسم"] = (fac or {}).get("name", ""), (dept or {}).get("name", "")
            g = student_gender(s, fac)
            for k, (m, f) in GENDER_VARS.items():
                ctx[k] = f if g == "female" else m
        elif first["kind"] == "employee":
            ctx["اسم_الموظف"], ctx["الوظيفة"], ctx["وحدة_الموظف"] = first["name"], first["c1"], first["c2"]
        else:
            ctx["اسم_المدرس"], ctx["الكلية"] = first["name"], first["c1"]
        ctx["قائمة_الأسماء"] = "، ".join(r["name"] for r in rows)
        ctx["عدد_الأسماء"] = str(len(rows))
        ctx["جدول_الأسماء"] = "{جدول_الأسماء}"  # يبقى علامة يرسمها مولّد PDF كجدول
    table = _table_rows([{k: v for k, v in r.items() if not k.startswith("_")} for r in rows])
    return ctx, table, [{"kind": r["kind"], "id": str(r["_doc"]["_id"]), "name": r["name"], "faculty_id": _people_faculty(r)} for r in rows]


class PreviewIn(BaseModel):
    body: str
    subject: Optional[str] = ""
    recipient: dict = {}
    people: List[dict] = []


@router.post("/letters/preview-body")
async def preview_body(data: PreviewIn, current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    ctx, table, _ = await _build_ctx(get_db(), data.recipient, data.subject or "", data.people)
    return {"body": _apply_vars(data.body, ctx), "table": table}


# ───────── الإصدار / المسودات ─────────
class IssueIn(BaseModel):
    template_id: Optional[str] = None
    template_name: Optional[str] = ""
    subject: Optional[str] = ""
    body: str
    recipient: dict
    people: List[dict] = []
    signatory_name: Optional[str] = ""
    signatory_title: Optional[str] = ""
    signatory_position_id: Optional[str] = ""
    valid_days: Optional[int] = None
    base_url: Optional[str] = None
    notes: Optional[str] = ""
    layout: Optional[dict] = None     # 📐 تجاوز تخطيط الصفحة لهذا الخطاب
    draft_id: Optional[str] = None    # تحديث مسودة قائمة
    per_person: bool = False          # 👥 خطاب مستقل لكل شخص (إصدار جماعي)
    letterhead_id: Optional[str] = ""  # 📄 الكليشة المختارة (فارغ = الافتراضية العامة)
    series_id: Optional[str] = ""      # 🔢 سلسلة الترقيم المختارة (فارغ = الافتراضية العامة)
    letterhead_override: Optional[dict] = None  # 👁️ معاينة كليشة قيد التحرير (غير محفوظة)
    sections: Optional[dict] = None   # ✍️ أقسام منسّقة (المستلم/التحية/الموضوع/الخاتمة/التوقيع) HTML بمتغيرات
    person_as_recipient: bool = False  # الشخص نفسه هو المرسَل إليه
    extra_vars: Optional[dict] = None  # ✉️ متغيرات مخصصة يطلبها القالب (رسالة سريعة)


async def _lh_series(db, user: dict, data: IssueIn) -> tuple:
    """(الكليشة, السلسلة) المختارتان في بيانات الإصدار — مع التحقق من رؤيتهما"""
    return await resolve_letterhead(db, user, data.letterhead_id), await resolve_series(db, user, data.series_id)


def _lh_fields(lh: dict, sr: dict) -> dict:
    return {"letterhead_id": str(lh["_id"]) if lh.get("_id") else "", "letterhead_name": lh.get("name", ""), "series_id": str(sr["_id"]) if sr.get("_id") else "", "series_name": sr.get("name", "")}


async def _letter_settings(db, user: dict, s: dict) -> dict:
    """كليشة خطاب محفوظ (بمعرّفها) — وإلا الافتراضية؛ لا تحقق رؤية لأن الخطاب نفسه مُتحقق منه"""
    lid = s.get("letterhead_id")
    doc = await db.letterheads.find_one({"_id": ObjectId(lid)}) if lid and ObjectId.is_valid(lid) else None
    return doc or await db.letterheads.find_one({"is_default": True}) or {}


async def _resolve_sig(db, position_id, name, title, settings: dict) -> tuple:
    """الموقّع: منصب من الدليل → الاسم/الصفة اليدويان → الافتراضي من الكليشة"""
    from .statements import resolve_signatory
    n, t = await resolve_signatory(db, position_id or None, name, title)
    return (n or settings.get("default_signatory_name") or "").strip(), (t or settings.get("default_signatory_title") or "").strip()


async def _compose(db, data: IssueIn, settings: dict) -> dict:
    """الجزء المشترك: تعبئة المتغيرات + الجدول + بيانات المرسَل إليه والموقّع (بلا ترقيم)"""
    ctx, table, people = await _build_ctx(db, data.recipient or {}, data.subject or "", data.people)
    sig_name, sig_title = await _resolve_sig(db, data.signatory_position_id, data.signatory_name, data.signatory_title, settings)
    ctx = {**ctx, "اسم_الموقع": sig_name, "صفة_الموقع": sig_title, **{str(k): str(v) for k, v in (data.extra_vars or {}).items() if k}}
    raw_secs = data.sections if data.sections is not None else await _effective_sections(db, settings, data.template_id)
    sections = {k: _apply_vars(v, ctx) for k, v in (raw_secs or {}).items() if k in SECTION_KEYS and v}
    return {"subject": _apply_vars((data.subject or "").strip(), ctx), "body": _apply_vars((data.body or "").strip(), ctx), "table": table, "people": people, "sections": sections,
            "recipient": {k: (data.recipient or {}).get(k, "") for k in ("id", "name", "title", "organization", "suffix")},
            "template_id": data.template_id, "template_name": data.template_name or "", "notes": data.notes or "",
            "signatory_name": sig_name, "signatory_title": sig_title, "signatory_position_id": data.signatory_position_id or "",
            "layout": data.layout or None, "valid_days": data.valid_days,
            "inputs": {"body": data.body, "people": data.people, "recipient": data.recipient or {}, "subject": data.subject or "", "template_id": data.template_id, "sections": raw_secs or {}, "extra_vars": data.extra_vars or {}}}


async def _effective_sections(db, lh: dict, template_id: Optional[str] = None) -> dict:
    """✍️ أقسام الخطاب الفعلية: النظام ← الكليشة ← القالب (القالب يتقدم)"""
    out = dict(DEFAULT_SECTIONS)
    out.update({k: v for k, v in (lh.get("sections") or {}).items() if k in SECTION_KEYS and v})
    if template_id and ObjectId.is_valid(template_id):
        t = await db.letter_templates.find_one({"_id": ObjectId(template_id)}, {"sections": 1})
        out.update({k: v for k, v in ((t or {}).get("sections") or {}).items() if k in SECTION_KEYS and v})
    return out


def _validate(data: IssueIn):
    if not (data.subject or "").strip() or not data.body.strip() or not (data.recipient or {}).get("name") and not (data.recipient or {}).get("title"):
        raise HTTPException(status_code=400, detail="الموضوع والمتن والمرسَل إليه مطلوبة")


def _person_recipient(row: dict, suffix: str) -> dict:
    """عندما يكون الشخص نفسه هو المرسَل إليه: «إلى: الطالب/ فلان المحترم» ثم الجهة من بياناته"""
    female = False
    if row["kind"] == "student":
        female = student_gender(row["_doc"], row.get("_fac")) == "female"
        prefix, title, org = ("الطالبة/" if female else "الطالب/"), "", " — ".join(x for x in (row["c2"], row["c1"]) if x)
    elif row["kind"] == "employee":
        prefix, title, org = "الأخ/", row["c1"], row["c2"]
    else:
        prefix, title, org = f"{row['code']}/" if row["code"] else "الأستاذ/", "", row["c1"]
    sfx = suffix or "المحترم"
    if female and sfx == "المحترم":
        sfx = "المحترمة"
    return {"id": "", "name": f"{prefix} {row['name']}".strip(), "title": title, "organization": org, "suffix": sfx}


async def _per_person_data(db, data: IssueIn, person: dict) -> Optional[IssueIn]:
    """نسخة من بيانات الإصدار لشخص واحد (المتغيرات تُملأ ببياناته، واختيارياً يصبح هو المرسَل إليه)"""
    row = await _person_row(db, person.get("kind", "student"), person.get("id", ""))
    if not row:
        return None
    d = data.model_copy(update={"people": [person], "per_person": False, "draft_id": None})
    if data.person_as_recipient:
        d.recipient = _person_recipient(row, (data.recipient or {}).get("suffix", "المحترم"))
    return d


async def _finalize_fields(db, series: dict, base_url: Optional[str], valid_days: Optional[int], current_user: dict) -> dict:
    """يمنح رقماً رسمياً من سلسلة الترقيم المختارة ورمز تحقق وتاريخ إصدار"""
    seq, year, number = await next_serial(db, series)
    token = uuid.uuid4().hex
    verify_base = (await get_verify_base(db)) or (base_url or "").rstrip("/")
    now = datetime.now(timezone.utc)
    return {"serial": seq, "number_display": number, "year": year, "status": "issued",
            "verify_token": token, "verify_url": f"{verify_base}/verify-letter?token={token}" if verify_base else token,
            "issued_by": current_user.get("id", ""), "issued_by_name": current_user.get("full_name", ""), "issued_at": now.isoformat(),
            "expires_at": (now + timedelta(days=valid_days)).isoformat() if valid_days and valid_days > 0 else None, "is_revoked": False}


@router.get("/letters/section-defaults")
async def section_defaults(letterhead_id: Optional[str] = None, template_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """✍️ المحتوى الافتراضي لأقسام الخطاب: النظام ← الكليشة ← القالب (القالب يتقدم)"""
    _guard(current_user)
    db = get_db()
    lh = await resolve_letterhead(db, current_user, letterhead_id)
    out = await _effective_sections(db, lh, template_id)
    return {"sections": out, "system": DEFAULT_SECTIONS, "labels": SECTION_LABELS, "keys": SECTION_KEYS}


@router.get("/letters/layout-defaults")
async def layout_defaults(current_user: dict = Depends(get_current_user)):
    from services.letter_pdf import DEFAULT_LAYOUT
    return DEFAULT_LAYOUT


@router.post("/letters/issue")
async def issue_letter(data: IssueIn, current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    db = get_db()
    _validate(data)
    settings, series = await _lh_series(db, current_user, data)
    doc = {**(await _compose(db, data, settings)), **(await _finalize_fields(db, series, data.base_url, data.valid_days, current_user)), **_lh_fields(settings, series)}
    r = await db.letters.insert_one(doc)
    await log_activity(current_user, "issue_letter", "letter", str(r.inserted_id), doc["subject"], {"number": doc["number_display"], "to": doc["recipient"].get("name") or doc["recipient"].get("title")})
    return {"id": str(r.inserted_id), "number": doc["number_display"], "verify_url": doc["verify_url"], "token": doc["verify_token"]}


@router.post("/letters/issue-batch")
async def issue_batch(data: IssueIn, current_user: dict = Depends(get_current_user)):
    """👥 خطاب مستقل لكل شخص (رقم تسلسلي وQR لكل خطاب) في عملية واحدة — يرجع batch_id لتنزيل PDF مجمّع"""
    _guard(current_user)
    db = get_db()
    if not (data.subject or "").strip() or not data.body.strip():
        raise HTTPException(status_code=400, detail="الموضوع والمتن مطلوبان")
    if not data.people:
        raise HTTPException(status_code=400, detail="اختر شخصاً واحداً على الأقل")
    if len(data.people) > 200:
        raise HTTPException(status_code=400, detail="الحد الأقصى 200 خطاب في العملية الواحدة")
    if not data.person_as_recipient and not ((data.recipient or {}).get("name") or (data.recipient or {}).get("title")):
        raise HTTPException(status_code=400, detail="حدّد المرسَل إليه أو فعّل «الشخص نفسه هو المرسَل إليه»")
    settings, series = await _lh_series(db, current_user, data)
    batch_id = uuid.uuid4().hex[:12]
    out, skipped = [], []
    for i, person in enumerate(data.people):
        d = await _per_person_data(db, data, person)
        if not d:
            skipped.append(person.get("id", "")); continue
        doc = {**(await _compose(db, d, settings)), **(await _finalize_fields(db, series, data.base_url, data.valid_days, current_user)), **_lh_fields(settings, series),
               "batch_id": batch_id, "batch_index": i + 1, "batch_total": len(data.people), "person_as_recipient": data.person_as_recipient, "auto_table": False}
        r = await db.letters.insert_one(doc)
        out.append({"id": str(r.inserted_id), "number": doc["number_display"], "name": (doc["people"] or [{}])[0].get("name", ""), "verify_url": doc["verify_url"]})
    if not out:
        raise HTTPException(status_code=400, detail="تعذر العثور على الأشخاص المحددين")
    await log_activity(current_user, "issue_letter_batch", "letter", batch_id, data.subject or "", {"count": len(out), "numbers": [o["number"] for o in out][:20]})
    return {"batch_id": batch_id, "count": len(out), "letters": out, "skipped": skipped}


@router.get("/letters/batch/{batch_id}/pdf")
async def batch_pdf(batch_id: str, letterhead: bool = True, current_user: dict = Depends(get_current_user)):
    """PDF واحد يجمع خطابات الدفعة متتابعة (كل خطاب يبدأ بصفحة جديدة)"""
    _guard(current_user)
    db = get_db()
    rows = await db.letters.find({"batch_id": batch_id, **(await _visible_filter(db, current_user))}).sort("batch_index", 1).to_list(500)
    if not rows:
        raise HTTPException(status_code=404, detail="الدفعة غير موجودة")
    settings = await _letter_settings(db, current_user, rows[0])
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter()
    for r in rows:
        w.append(PdfReader(io.BytesIO(build_letter_pdf(r, settings, letterhead=letterhead))))
    buf = io.BytesIO(); w.write(buf)
    from urllib.parse import quote
    fname = quote(f"خطابات {rows[0].get('subject', '')} - {len(rows)} خطاب{'' if letterhead else ' - بلا كليشة'} - {export_stamp()}.pdf")
    return StreamingResponse(io.BytesIO(buf.getvalue()), media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}", "X-Filename": fname})


@router.post("/letters/draft")
async def save_draft(data: IssueIn, current_user: dict = Depends(get_current_user)):
    """💾 حفظ كمسودة برقم مسودة مستقل (م-N) — الرقم الرسمي يُمنح عند الاعتماد"""
    _guard(current_user)
    db = get_db()
    if not data.body.strip():
        raise HTTPException(status_code=400, detail="المتن مطلوب لحفظ المسودة")
    settings, series = await _lh_series(db, current_user, data)
    doc = {**(await _compose(db, data, settings)), **_lh_fields(settings, series), "status": "draft", "is_revoked": False, "updated_at": datetime.now(timezone.utc).isoformat(),
           "updated_by_name": current_user.get("full_name", "")}
    if data.draft_id and ObjectId.is_valid(data.draft_id):
        ex = await _load_visible(db, current_user, data.draft_id)
        if ex.get("status") != "draft":
            raise HTTPException(status_code=400, detail="المسودة غير موجودة أو صدرت رسمياً")
        await db.letters.update_one({"_id": ex["_id"]}, {"$set": doc})
        return {"id": str(ex["_id"]), "number": ex["number_display"], "status": "draft"}
    counter = await db.letter_counters.find_one_and_update({"_id": "draft"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    doc.update({"draft_seq": counter["seq"], "number_display": f"م-{counter['seq']}", "created_by": current_user.get("id", ""), "created_by_name": current_user.get("full_name", ""),
                "issued_at": datetime.now(timezone.utc).isoformat()})
    r = await db.letters.insert_one(doc)
    return {"id": str(r.inserted_id), "number": doc["number_display"], "status": "draft"}


@router.post("/letters/{lid}/finalize")
async def finalize_draft(lid: str, base_url: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """✅ اعتماد المسودة وإصدارها: نفس النسخة تأخذ الرقم الرسمي ورمز QR وتُؤرشف"""
    _guard(current_user)
    db = get_db()
    ex = await _load_visible(db, current_user, lid)
    if ex.get("status") != "draft":
        raise HTTPException(status_code=400, detail="المسودة غير موجودة أو صدرت مسبقاً")
    if not ex.get("subject") or not ((ex.get("recipient") or {}).get("name") or (ex.get("recipient") or {}).get("title")):
        raise HTTPException(status_code=400, detail="أكمل الموضوع والمرسَل إليه قبل الاعتماد")
    settings = await _letter_settings(db, current_user, ex)
    series = await resolve_series(db, current_user, ex.get("series_id"))
    inputs = ex.get("inputs") or {}
    ctx, table, people = await _build_ctx(db, inputs.get("recipient") or ex.get("recipient") or {}, ex.get("subject") or "", inputs.get("people") or [])
    sctx = {**ctx, "اسم_الموقع": ex.get("signatory_name", ""), "صفة_الموقع": ex.get("signatory_title", "")}
    upd = {**(await _finalize_fields(db, series, base_url, ex.get("valid_days"), current_user)), **_lh_fields(settings, series), "draft_number": ex.get("number_display"),
           "sections": {k: _apply_vars(v, sctx) for k, v in (inputs.get("sections") or {}).items() if k in SECTION_KEYS and v} or ex.get("sections") or {},
           "body": _apply_vars((inputs.get("body") or ex.get("body") or "").strip(), ctx), "table": (ex.get("table") if ex.get("custom_table") and not people else table), "people": people}
    if ex.get("signatory_position_id"):
        upd["signatory_name"], upd["signatory_title"] = await _resolve_sig(db, ex["signatory_position_id"], ex.get("signatory_name"), ex.get("signatory_title"), settings)
    await db.letters.update_one({"_id": ex["_id"]}, {"$set": upd})
    await log_activity(current_user, "issue_letter", "letter", lid, ex.get("subject", ""), {"number": upd["number_display"], "from_draft": ex.get("number_display")})
    return {"id": lid, "number": upd["number_display"], "verify_url": upd["verify_url"], "token": upd["verify_token"]}


@router.delete("/letters/{lid}")
async def delete_draft(lid: str, current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    await _load_visible(get_db(), current_user, lid)
    r = await get_db().letters.delete_one({"_id": ObjectId(lid), "status": "draft"})
    if not r.deleted_count:
        raise HTTPException(status_code=400, detail="تُحذف المسودات فقط — الخطابات الصادرة تُلغى ولا تُحذف")
    return {"ok": True}


@router.post("/letters/preview-pdf")
async def preview_letter_pdf(data: IssueIn, fmt: str = "png", letterhead: bool = True, current_user: dict = Depends(get_current_user)):
    """👁️ معاينة حيّة للخطاب قبل الإصدار — بلا رقم تسلسلي ولا حفظ (png = صورة الصفحة الأولى)"""
    _guard(current_user)
    db = get_db()
    settings, series = await _lh_series(db, current_user, data)
    if data.letterhead_override:
        settings = {**settings, **{k: v for k, v in data.letterhead_override.items() if k not in ("_id", "id")}}
    per_person = data.per_person and bool(data.people)
    if per_person:
        data = (await _per_person_data(db, data, data.people[0])) or data
    year = datetime.now(timezone.utc).year
    cur = (series.get("counters") or {}).get(str(year), 0) if series.get("reset_yearly", True) else series.get("seq", 0)
    seq = max(cur + 1, int(series.get("start_at") or 1))
    doc = {**(await _compose(db, data, settings)), "auto_table": not per_person, "serial": seq, "number_display": format_number(series.get("format"), seq, year) + " (معاينة)", "year": year,
           "verify_url": "DRAFT-PREVIEW", "issued_at": datetime.now(timezone.utc).isoformat()}
    doc["layout"] = {**(doc.get("layout") or {}), "watermark": "معاينة — غير صادر"}
    pdf = build_letter_pdf(doc, settings, draft=True, letterhead=letterhead)
    if fmt == "png":
        import pymupdf
        page = pymupdf.open(stream=pdf, filetype="pdf")[0]
        return StreamingResponse(io.BytesIO(page.get_pixmap(dpi=110).tobytes("png")), media_type="image/png", headers={"Cache-Control": "no-store"})
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers={"Cache-Control": "no-store"})


@router.get("/letters")
async def list_letters(q: Optional[str] = None, subject: Optional[str] = None, recipient: Optional[str] = None, template_id: Optional[str] = None,
                       date_from: Optional[str] = None, date_to: Optional[str] = None, status: Optional[str] = None, limit: int = 300, current_user: dict = Depends(get_current_user)):
    """🗂 سجل/أرشيف الخطابات — فلاتر: بحث عام، الموضوع، المرسَل إليه (معرّف أو نص)، القالب، الفترة، الحالة"""
    _guard(current_user)
    query: dict = {}
    if status == "draft":
        query["status"] = "draft"
    elif status == "issued":
        query["status"] = {"$ne": "draft"}; query["is_revoked"] = {"$ne": True}
    elif status == "revoked":
        query["is_revoked"] = True
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"subject": rx}, {"number_display": rx}, {"recipient.name": rx}, {"recipient.title": rx}, {"recipient.organization": rx}, {"people.name": rx}, {"template_name": rx}]
    if subject:
        query["subject"] = {"$regex": re.escape(subject), "$options": "i"}
    if recipient:
        if ObjectId.is_valid(recipient):
            query["recipient.id"] = recipient
        else:
            rrx = {"$regex": re.escape(recipient), "$options": "i"}
            query.setdefault("$and", []).append({"$or": [{"recipient.name": rrx}, {"recipient.title": rrx}, {"recipient.organization": rrx}]})
    if template_id:
        query["template_id"] = template_id
    if date_from:
        query.setdefault("issued_at", {})["$gte"] = date_from
    if date_to:
        query.setdefault("issued_at", {})["$lte"] = date_to + "T23:59:59"
    vis = await _visible_filter(get_db(), current_user)
    if vis:
        query = {"$and": [query, vis]} if query else vis
    rows = await get_db().letters.find(query, {"body": 0, "table": 0, "inputs": 0}).sort("issued_at", -1).limit(limit).to_list(limit)
    return [_ser(r) for r in rows]


@router.get("/letters/{lid}")
async def get_letter(lid: str, current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    return _ser(await _load_visible(get_db(), current_user, lid))


@router.post("/letters/{lid}/revoke")
async def revoke(lid: str, current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    await _load_visible(get_db(), current_user, lid)
    await get_db().letters.update_one({"_id": ObjectId(lid)}, {"$set": {"is_revoked": True, "revoked_at": datetime.now(timezone.utc).isoformat(), "revoked_by": current_user.get("full_name", "")}})
    return {"ok": True}


@router.post("/letters/{lid}/restore")
async def restore(lid: str, current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    await _load_visible(get_db(), current_user, lid)
    await get_db().letters.update_one({"_id": ObjectId(lid)}, {"$set": {"is_revoked": False}})
    return {"ok": True}


@router.get("/verify/letter/{token}")
async def verify_letter(token: str):
    s = await get_db().letters.find_one({"verify_token": token})
    if not s:
        return {"valid": False, "message": "لا يوجد خطاب بهذا الرمز — قد تكون الوثيقة غير صحيحة"}
    base = {"number": s.get("number_display"), "issued_at": (s.get("issued_at") or "")[:10], "subject": s.get("subject"), "recipient": (s.get("recipient") or {}).get("title") or (s.get("recipient") or {}).get("name")}
    if s.get("is_revoked"):
        return {"valid": False, "message": "هذا الخطاب ملغى من الجهة المصدرة ولا يُعتد به", **base}
    if s.get("expires_at") and s["expires_at"] < datetime.now(timezone.utc).isoformat():
        return {"valid": False, "message": f"انتهت صلاحية هذا الخطاب بتاريخ {s['expires_at'][:10]}", **base}
    return {"valid": True, "message": "خطاب صحيح صادر رسمياً من جامعة الأحقاف", **base, "signatory": s.get("signatory_title", ""), "template": s.get("template_name", "")}


def _letter_fname(s: dict, ext: str, letterhead: bool = True) -> str:
    """📁 اسم الملف: الموضوع + الرقم + توقيت الإصدار"""
    subj = re.sub(r'[\\/:*?"<>|]+', " ", (s.get("subject") or "خطاب")).strip()[:60]
    stamp = (s.get("issued_at") or "")[:16].replace("T", " ").replace(":", "-") or export_stamp()
    num = str(s.get("number_display", "")).replace("/", "-")
    return f"{'مسودة ' if s.get('status') == 'draft' else ''}{subj} - {num}{'' if letterhead else ' - بلا كليشة'} - {stamp}.{ext}"


@router.get("/letters/{lid}/pdf")
async def letter_pdf(lid: str, letterhead: bool = True, fmt: str = "pdf", current_user: dict = Depends(get_current_user)):
    _guard(current_user)
    db = get_db()
    s = await _load_visible(db, current_user, lid)
    settings = await _letter_settings(db, current_user, s)
    pdf = build_letter_pdf(s, settings, draft=s.get("status") == "draft", letterhead=letterhead)
    if fmt == "png":
        import pymupdf
        page = pymupdf.open(stream=pdf, filetype="pdf")[0]
        return StreamingResponse(io.BytesIO(page.get_pixmap(dpi=110).tobytes("png")), media_type="image/png", headers={"Cache-Control": "no-store"})
    from urllib.parse import quote
    fname = quote(_letter_fname(s, "pdf", letterhead))
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}", "X-Filename": fname})


@router.get("/letters/{lid}/docx")
async def letter_docx(lid: str, letterhead: bool = True, current_user: dict = Depends(get_current_user)):
    """📝 تصدير الخطاب إلى Word قابل للتحرير (نفس الأقسام والكليشة)"""
    _guard(current_user)
    db = get_db()
    s = await _load_visible(db, current_user, lid)
    settings = await _letter_settings(db, current_user, s)
    data = build_letter_docx(s, settings, letterhead=letterhead)
    from urllib.parse import quote
    fname = quote(_letter_fname(s, "docx", letterhead))
    return StreamingResponse(io.BytesIO(data), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}", "X-Filename": fname})
