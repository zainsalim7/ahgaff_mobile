"""إفادات الطلاب: إصدار PDF رسمي بترقيم تسلسلي + QR للتحقق العام + سجل إفادات + إعدادات لكل كلية."""
import io
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from bson import ObjectId

from .deps import get_db, get_current_user, log_activity

router = APIRouter()

LEVEL_AR = {1: "الأول", 2: "الثاني", 3: "الثالث", 4: "الرابع", 5: "الخامس", 6: "السادس", 7: "السابع", 8: "الثامن", 9: "التاسع", 10: "العاشر"}
STATUS_PHRASE = {"active": "ومستمراً في الدراسة", "frozen": "وقد جمّد قيده حالياً", "suspended": "وموقوف عن الدراسة حالياً"}
STATUS_WORD = {"active": "مستمر في الدراسة", "frozen": "مجمّد القيد حالياً", "suspended": "موقوف عن الدراسة حالياً", "graduated": "متخرج"}


def _apply_vars(text: str, ctx: dict) -> str:
    for k, v in ctx.items():
        text = text.replace("{" + k + "}", str(v))
    return text


def _var_ctx(student: dict, dept, faculty, academic_year_display: str, nationality=None) -> dict:
    """قيم المتغيرات المتاحة في قوالب الإفادات."""
    return {
        "اسم_الطالب": student.get("full_name", ""),
        "رقم_القيد": student.get("student_id", ""),
        "الجنسية": (nationality or student.get("nationality") or "يمني").strip(),
        "المستوى": LEVEL_AR.get(student.get("level") or 1, str(student.get("level") or "")),
        "التخصص": (dept or {}).get("name", ""),
        "الكلية": (faculty or {}).get("name", ""),
        "العام_الجامعي": academic_year_display,
        "الحالة": STATUS_WORD.get(student.get("status", "active"), "مستمر في الدراسة"),
        "التاريخ": datetime.now(timezone.utc).strftime("%Y/%m/%d") + "م",
    }


async def _academic_year_display(db) -> str:
    active_sem = await db.semesters.find_one({"status": "active"})
    academic_year = (active_sem or {}).get("academic_year") or ""
    if academic_year and "-" in academic_year:
        parts = academic_year.split("-")
        return f"{parts[1]}/{parts[0]}م"
    y = datetime.now(timezone.utc).year
    return f"{y + 1}/{y}م"


def _can_issue(user: dict, faculty_id: str) -> bool:
    if user.get("role") == "admin":
        return True
    if user.get("role") in ("teacher", "student"):
        return False
    fids = set(user.get("faculty_ids") or [])
    if user.get("faculty_id"):
        fids.add(user["faculty_id"])
    return faculty_id in fids


class StatementSettings(BaseModel):
    registrar_name: str = ""
    signatory_title: str = "مسجل الكلية"
    signature_base64: str = ""
    phones: str = ""
    fax: str = ""
    po_box: str = ""
    website: str = "www.AHGAFF.EDU"
    address: str = "الجمهورية اليمنية – تريم – حضرموت"
    faculty_name_en: str = ""
    logo_base64: str = ""
    reference_format: str = ""


class IssueRequest(BaseModel):
    student_id: str
    nationality: Optional[str] = None
    purpose: Optional[str] = None
    base_url: Optional[str] = None
    valid_days: Optional[int] = None
    signatory_name: Optional[str] = None
    signatory_title: Optional[str] = None
    body: Optional[str] = None  # 📝 متن مخصص (من قالب أو حر)
    template_name: Optional[str] = None


class RevokeRequest(BaseModel):
    reason: Optional[str] = None


@router.get("/statements/settings/{faculty_id}")
async def get_statement_settings(faculty_id: str, current_user: dict = Depends(get_current_user)):
    if not _can_issue(current_user, faculty_id):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    doc = await db.statement_settings.find_one({"_id": f"faculty_{faculty_id}"}) or {}
    doc.pop("_id", None)
    return doc


@router.put("/statements/settings/{faculty_id}")
async def update_statement_settings(faculty_id: str, data: StatementSettings, current_user: dict = Depends(get_current_user)):
    if not _can_issue(current_user, faculty_id):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    await db.statement_settings.update_one(
        {"_id": f"faculty_{faculty_id}"}, {"$set": data.dict()}, upsert=True
    )
    return {"message": "تم حفظ إعدادات الإفادة"}


def _sanitize_base_url(value: str) -> str:
    """تنقية رابط التحقق: إصلاح النطاق المشوّه (مثل http://.ahgaff.net) وفرض https."""
    value = (value or "").strip().rstrip("/")
    if not value:
        return ""
    m = re.match(r"^(https?)://(.*)$", value, re.IGNORECASE)
    if not m:
        return ""
    host_and_path = m.group(2).lstrip(".")  # نطاق فرعي مفقود: ".ahgaff.net" → "ahgaff.net"
    if not host_and_path or host_and_path.startswith("/"):
        return ""
    return f"https://{host_and_path}"


async def get_verify_base(db) -> str:
    doc = await db.system_settings.find_one({"_id": "verify_base_url"}) or {}
    return _sanitize_base_url(doc.get("value") or "")


@router.get("/settings/verify-base-url")
async def read_verify_base(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") in ("teacher", "student"):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    return {"value": await get_verify_base(db)}


@router.put("/settings/verify-base-url")
async def set_verify_base(payload: dict, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="هذا الإعداد للأدمن فقط")
    raw = (payload.get("value") or "").strip().rstrip("/")
    value = _sanitize_base_url(raw)
    if raw and not value:
        raise HTTPException(status_code=400, detail="رابط غير صالح — يجب أن يكون بصيغة https://ahgaff.net (بنطاق صحيح)")
    if raw and not re.match(r"^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(/.*)?$", value):
        raise HTTPException(status_code=400, detail="رابط غير صالح — تحقق من اسم النطاق (مثال: https://ahgaff.net)")
    db = get_db()
    await db.system_settings.update_one({"_id": "verify_base_url"}, {"$set": {"value": value}}, upsert=True)
    return {"message": "تم حفظ رابط التحقق — سيُستخدم في رموز QR الجديدة", "value": value}


async def _safe_dept(db, student: dict):
    if not student.get("department_id"):
        return None
    try:
        return await db.departments.find_one({"_id": ObjectId(student["department_id"])})
    except Exception:
        return None


async def _issue_core(db, student: dict, current_user: dict, nationality, purpose, valid_days, base_url,
                      signatory_name=None, signatory_title=None, body=None, template_name=None) -> dict:
    dept = await _safe_dept(db, student)
    faculty_id = student.get("faculty_id") or (dept or {}).get("faculty_id", "")
    if not _can_issue(current_user, faculty_id):
        raise HTTPException(status_code=403, detail=f"غير مصرح لك بإصدار إفادات لكلية الطالب {student.get('full_name', '')}")
    faculty = None
    if faculty_id:
        try:
            faculty = await db.faculties.find_one({"_id": ObjectId(faculty_id)})
        except Exception:
            faculty = None

    academic_year_display = await _academic_year_display(db)

    year = datetime.now(timezone.utc).year
    counter = await db.statement_counters.find_one_and_update(
        {"_id": f"{faculty_id}_{year}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    seq = counter["seq"]
    # 🔢 صيغة رقم المرجع قابلة للضبط من إعدادات الإفادات: {seq} {year} {yy} {enrollment_no}
    DEFAULT_REF_FORMAT = "{seq} /7/2/ت ك ش ق /27/26"
    _st = await db.statement_settings.find_one({"_id": f"faculty_{faculty_id}"}) or {}
    _fmt = (_st.get("reference_format") or "").strip() or DEFAULT_REF_FORMAT
    number_display = (_fmt.replace("{seq}", str(seq)).replace("{year}", str(year))
                      .replace("{yy}", str(year % 100)).replace("{enrollment_no}", str(student.get("student_id", ""))))

    token = uuid.uuid4().hex
    verify_base = (await get_verify_base(db)) or (base_url or "").rstrip("/")
    verify_url = f"{verify_base}/verify-statement?token={token}" if verify_base else token

    from datetime import timedelta
    vd = valid_days if (valid_days and valid_days > 0) else 90
    expires_at = (datetime.now(timezone.utc) + timedelta(days=vd)).isoformat()

    # 📝 متن مخصص (قالب/حر): استبدال المتغيرات ببيانات الطالب قبل التخزين
    rendered_body = ""
    if (body or "").strip():
        ctx = _var_ctx(student, dept, faculty, academic_year_display, nationality)
        rendered_body = _apply_vars(body.strip(), ctx)

    doc = {
        "serial": seq,
        "number_display": number_display,
        "year": year,
        "student_id": str(student["_id"]),
        "student_name": student.get("full_name", ""),
        "enrollment_no": student.get("student_id", ""),
        "nationality": (nationality or student.get("nationality") or "يمني").strip(),
        "level": student.get("level") or 1,
        "department_id": str((dept or {}).get("_id", "")) if dept else "",
        "department_name": (dept or {}).get("name", ""),
        "faculty_id": faculty_id,
        "faculty_name": (faculty or {}).get("name", ""),
        "academic_year": academic_year_display,
        "student_status": student.get("status", "active"),
        "purpose": (purpose or "").strip(),
        "body": rendered_body,
        "template_name": (template_name or "").strip(),
        "signatory_name": (signatory_name or "").strip(),
        "signatory_title": (signatory_title or "").strip(),
        "verify_token": token,
        "verify_url": verify_url,
        "issued_by": current_user.get("id", ""),
        "issued_by_name": current_user.get("full_name", ""),
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": expires_at,
        "is_revoked": False,
    }
    res = await db.student_statements.insert_one(doc)
    doc["inserted_id"] = str(res.inserted_id)
    await log_activity(current_user, "issue_student_statement", "student", str(student["_id"]),
                       student.get("full_name", ""), {"number": number_display})
    return doc


@router.post("/statements/issue")
async def issue_statement(data: IssueRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    student = await db.students.find_one({"_id": ObjectId(data.student_id)})
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    doc = await _issue_core(db, student, current_user, data.nationality, data.purpose, data.valid_days, data.base_url,
                            signatory_name=data.signatory_name, signatory_title=data.signatory_title,
                            body=data.body, template_name=data.template_name)
    return {"id": doc["inserted_id"], "number": doc["number_display"], "verify_url": doc["verify_url"], "token": doc["verify_token"]}


# ============ قوالب الإفادات (مشتركة لكل الكليات) ============

def _can_manage_templates(user: dict) -> bool:
    return user.get("role") not in ("teacher", "student")


class StatementTemplate(BaseModel):
    name: str
    body: str


@router.get("/statement-templates")
async def list_statement_templates(current_user: dict = Depends(get_current_user)):
    if not _can_manage_templates(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    items = []
    async for t in db.statement_templates.find({}).sort("name", 1):
        t["id"] = str(t.pop("_id"))
        items.append(t)
    return items


@router.post("/statement-templates")
async def create_statement_template(data: StatementTemplate, current_user: dict = Depends(get_current_user)):
    if not _can_manage_templates(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    name, body = data.name.strip(), data.body.strip()
    if not name or not body:
        raise HTTPException(status_code=400, detail="اسم القالب ومتنه مطلوبان")
    db = get_db()
    if await db.statement_templates.find_one({"name": name}):
        raise HTTPException(status_code=400, detail="يوجد قالب بهذا الاسم مسبقاً")
    doc = {"name": name, "body": body,
           "created_by_name": current_user.get("full_name", ""),
           "created_at": datetime.now(timezone.utc).isoformat()}
    res = await db.statement_templates.insert_one(doc)
    return {"message": "تم إنشاء القالب", "id": str(res.inserted_id)}


@router.put("/statement-templates/{template_id}")
async def update_statement_template(template_id: str, data: StatementTemplate, current_user: dict = Depends(get_current_user)):
    if not _can_manage_templates(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    name, body = data.name.strip(), data.body.strip()
    if not name or not body:
        raise HTTPException(status_code=400, detail="اسم القالب ومتنه مطلوبان")
    db = get_db()
    dup = await db.statement_templates.find_one({"name": name, "_id": {"$ne": ObjectId(template_id)}})
    if dup:
        raise HTTPException(status_code=400, detail="يوجد قالب آخر بهذا الاسم")
    r = await db.statement_templates.update_one(
        {"_id": ObjectId(template_id)},
        {"$set": {"name": name, "body": body, "updated_at": datetime.now(timezone.utc).isoformat()}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="القالب غير موجود")
    return {"message": "تم تحديث القالب"}


@router.delete("/statement-templates/{template_id}")
async def delete_statement_template(template_id: str, current_user: dict = Depends(get_current_user)):
    if not _can_manage_templates(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    r = await db.statement_templates.delete_one({"_id": ObjectId(template_id)})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="القالب غير موجود")
    return {"message": "تم حذف القالب"}


class PreviewBodyRequest(BaseModel):
    student_id: str
    body: str = ""


@router.post("/statements/preview-body")
async def preview_statement_body(data: PreviewBodyRequest, current_user: dict = Depends(get_current_user)):
    """معاينة متن قالب/نص حر بعد استبدال المتغيرات ببيانات طالب محدد."""
    db = get_db()
    student = await db.students.find_one({"_id": ObjectId(data.student_id)})
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    dept = await _safe_dept(db, student)
    fid = student.get("faculty_id") or (dept or {}).get("faculty_id", "")
    if not _can_issue(current_user, fid):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    faculty = None
    if fid:
        try:
            faculty = await db.faculties.find_one({"_id": ObjectId(fid)})
        except Exception:
            faculty = None
    ctx = _var_ctx(student, dept, faculty, await _academic_year_display(db))
    return {"body": _apply_vars((data.body or ""), ctx), "variables": ctx}


class BulkIssueRequest(BaseModel):
    student_ids: list
    purpose: Optional[str] = None
    valid_days: Optional[int] = None
    base_url: Optional[str] = None
    signatory_name: Optional[str] = None
    signatory_title: Optional[str] = None


@router.post("/statements/bulk-issue")
async def bulk_issue_statements(data: BulkIssueRequest, current_user: dict = Depends(get_current_user)):
    """إصدار إفادات لعدة طلاب دفعة واحدة — ملف PDF واحد (إفادة لكل صفحة) وتُسجَّل كلها في السجل."""
    db = get_db()
    ids = [str(i) for i in (data.student_ids or []) if i][:200]
    if not ids:
        raise HTTPException(status_code=400, detail="لم يتم تحديد طلاب")

    students = []
    for sid in ids:
        try:
            s = await db.students.find_one({"_id": ObjectId(sid)})
        except Exception:
            s = None
        if s:
            students.append(s)
    if not students:
        raise HTTPException(status_code=404, detail="لا يوجد طلاب مطابقون")

    # فحص الصلاحية على كل الكليات قبل إصدار أي إفادة
    for s in students:
        dept = await _safe_dept(db, s)
        fid = s.get("faculty_id") or (dept or {}).get("faculty_id", "")
        if not _can_issue(current_user, fid):
            raise HTTPException(status_code=403, detail=f"غير مصرح لك بإصدار إفادات لكلية الطالب {s.get('full_name', '')}")

    from pypdf import PdfReader, PdfWriter
    writer = PdfWriter()
    settings_cache = {}
    for s in students:
        try:
            doc = await _issue_core(db, s, current_user, None, data.purpose, data.valid_days, data.base_url,
                                    signatory_name=data.signatory_name, signatory_title=data.signatory_title)
            fid = doc.get("faculty_id", "")
            if fid not in settings_cache:
                settings_cache[fid] = await db.statement_settings.find_one({"_id": f"faculty_{fid}"}) or {}
            pdf = _build_pdf(doc, settings_cache[fid])
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"تعذر إصدار إفادة الطالب {s.get('full_name', '')}: {e}")
        for page in PdfReader(io.BytesIO(pdf)).pages:
            writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return StreamingResponse(io.BytesIO(out.getvalue()), media_type="application/pdf",
                             headers={"Content-Disposition": "attachment; filename=statements_bulk.pdf",
                                      "X-Issued-Count": str(len(students))})


@router.get("/statements")
async def list_statements(
    faculty_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q = {}
    if current_user.get("role") != "admin":
        fids = set(current_user.get("faculty_ids") or [])
        if current_user.get("faculty_id"):
            fids.add(current_user["faculty_id"])
        if not fids or current_user.get("role") in ("teacher", "student"):
            raise HTTPException(status_code=403, detail="غير مصرح لك")
        q["faculty_id"] = {"$in": list(fids)}
    if faculty_id:
        q["faculty_id"] = faculty_id
    items = []
    async for s in db.student_statements.find(q).sort("issued_at", -1).limit(500):
        s["id"] = str(s.pop("_id"))
        s.pop("verify_token", None)
        items.append(s)
    return items


@router.post("/statements/{statement_id}/revoke")
async def revoke_statement(statement_id: str, data: RevokeRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.student_statements.find_one({"_id": ObjectId(statement_id)})
    if not s:
        raise HTTPException(status_code=404, detail="الإفادة غير موجودة")
    if not _can_issue(current_user, s.get("faculty_id", "")):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    await db.student_statements.update_one({"_id": s["_id"]}, {"$set": {
        "is_revoked": True,
        "revoked_at": datetime.now(timezone.utc).isoformat(),
        "revoked_by_name": current_user.get("full_name", ""),
        "revoke_reason": (data.reason or "").strip(),
    }})
    await log_activity(current_user, "revoke_student_statement", "student", s.get("student_id", ""),
                       s.get("student_name", ""), {"number": s.get("number_display", "")})
    return {"message": "تم إلغاء الإفادة — ستظهر عند التحقق أنها ملغاة"}


@router.post("/statements/{statement_id}/restore")
async def restore_statement(statement_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.student_statements.find_one({"_id": ObjectId(statement_id)})
    if not s:
        raise HTTPException(status_code=404, detail="الإفادة غير موجودة")
    if not _can_issue(current_user, s.get("faculty_id", "")):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    await db.student_statements.update_one({"_id": s["_id"]}, {"$set": {"is_revoked": False}})
    await log_activity(current_user, "restore_student_statement", "student", s.get("student_id", ""),
                       s.get("student_name", ""), {"number": s.get("number_display", "")})
    return {"message": "تمت استعادة صلاحية الإفادة"}


@router.get("/verify/statement/{token}")
async def verify_statement(token: str):
    """صفحة تحقق عامة — بدون تسجيل دخول، لا تعرض بيانات حساسة."""
    db = get_db()
    s = await db.student_statements.find_one({"verify_token": token})
    if not s:
        return {"valid": False, "message": "لا توجد إفادة بهذا الرمز — قد تكون الوثيقة غير صحيحة"}
    if s.get("is_revoked"):
        return {"valid": False, "message": "هذه الإفادة ملغاة من الجهة المصدرة ولا يُعتد بها",
                "number": s.get("number_display"), "issued_at": (s.get("issued_at") or "")[:10]}
    expires_at = s.get("expires_at") or ""
    if expires_at and expires_at < datetime.now(timezone.utc).isoformat():
        return {"valid": False, "message": f"انتهت صلاحية هذه الإفادة بتاريخ {expires_at[:10]}",
                "number": s.get("number_display"), "issued_at": (s.get("issued_at") or "")[:10]}
    return {
        "valid": True,
        "message": "إفادة صحيحة صادرة رسمياً من جامعة الأحقاف",
        "number": s.get("number_display"),
        "statement_type": s.get("template_name") or "",
        "student_name": s.get("student_name"),
        "faculty_name": s.get("faculty_name"),
        "department_name": s.get("department_name"),
        "level": s.get("level"),
        "academic_year": s.get("academic_year"),
        "issued_at": (s.get("issued_at") or "")[:10],
        "expires_at": (s.get("expires_at") or "")[:10],
    }


@router.get("/statements/{statement_id}/pdf")
async def statement_pdf(statement_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.student_statements.find_one({"_id": ObjectId(statement_id)})
    if not s:
        raise HTTPException(status_code=404, detail="الإفادة غير موجودة")
    if not _can_issue(current_user, s.get("faculty_id", "")):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    settings = await db.statement_settings.find_one({"_id": f"faculty_{s.get('faculty_id')}"}) or {}
    pdf = _build_pdf(s, settings)
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=statement_{s.get('serial')}.pdf"})


def _build_pdf(s: dict, settings: dict) -> bytes:
    import base64
    import arabic_reshaper
    import qrcode
    from bidi.algorithm import get_display
    from pathlib import Path
    from hijridate import Gregorian
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas as pdfcanvas

    def ar(t):
        return get_display(arabic_reshaper.reshape(str(t or "")))

    font_path = Path(__file__).parent.parent / "fonts" / "Amiri-Regular.ttf"
    if "Amiri" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("Amiri", str(font_path)))
    bold_path = Path(__file__).parent.parent / "fonts" / "Amiri-Bold.ttf"
    if bold_path.exists() and "Amiri-Bold" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("Amiri-Bold", str(bold_path)))
    BOLD = "Amiri-Bold" if "Amiri-Bold" in pdfmetrics.getRegisteredFontNames() else "Amiri"

    buf = io.BytesIO()
    W, H = A4
    c = pdfcanvas.Canvas(buf, pagesize=A4)

    # ===== الترويسة (الكليشة) =====
    logo_b64 = settings.get("logo_base64") or ""
    img = None
    if logo_b64:
        try:
            raw = base64.b64decode(logo_b64.split(",")[-1])
            img = ImageReader(io.BytesIO(raw))
        except Exception:
            img = None
    if img is None:
        default_logo = Path(__file__).parent.parent / "assets" / "university_logo.jpeg"
        if default_logo.exists():
            img = ImageReader(str(default_logo))
    if img:
        c.drawImage(img, W / 2 - 14 * mm, H - 38 * mm, 28 * mm, 28 * mm, mask="auto", preserveAspectRatio=True)
    c.setFont("Amiri", 16)
    c.drawRightString(W - 18 * mm, H - 18 * mm, ar("جامعة الأحقاف"))
    c.setFont("Amiri", 13)
    c.drawRightString(W - 18 * mm, H - 26 * mm, ar(s.get("faculty_name", "")))
    c.setFont("Helvetica-Bold", 12)
    c.drawString(18 * mm, H - 18 * mm, "AL-AHGAFF UNIVERSITY")
    c.setFont("Helvetica", 10)
    c.drawString(18 * mm, H - 26 * mm, settings.get("faculty_name_en", ""))
    # خط مزدوج أسفل الترويسة (شكل رسمي)
    c.setLineWidth(1.3)
    c.line(18 * mm, H - 41 * mm, W - 18 * mm, H - 41 * mm)
    c.setLineWidth(0.4)
    c.line(18 * mm, H - 42.4 * mm, W - 18 * mm, H - 42.4 * mm)

    # المرجع والتاريخان
    issued = (s.get("issued_at") or "")[:10]
    try:
        y, m, d = [int(x) for x in issued.split("-")]
        hj = Gregorian(y, m, d).to_hijri()
        hijri_str = f"{hj.year}/{hj.month:02d}/{hj.day:02d}هـ"
    except Exception:
        hijri_str = ""
    # المرجع (يسار، أخضر عريض) مقابل التاريخين (يمين، أخضر)
    GREEN = (0.0, 0.5, 0.13)
    c.setFillColorRGB(*GREEN)
    c.setFont(BOLD, 13)
    c.drawString(18 * mm, H - 52 * mm, ar(f"المرجع : {s.get('number_display', '')}"))
    c.setFont(BOLD, 11.5)
    c.drawRightString(W - 18 * mm, H - 50 * mm, ar(f"التاريخ: {hijri_str}"))
    greg_str = f"{issued.replace('-', '/')}م" if issued else ""
    c.drawRightString(W - 18 * mm, H - 57 * mm, ar(f"الموافق: {greg_str}"))
    c.setFillColorRGB(0, 0, 0)

    # ===== العنوان =====
    c.setFont(BOLD, 20)
    c.drawCentredString(W / 2, H - 78 * mm, ar("إلى من يهمه الأمر"))
    c.setLineWidth(0.8)
    c.line(W / 2 - 33 * mm, H - 80.5 * mm, W / 2 + 33 * mm, H - 80.5 * mm)
    c.setLineWidth(1.0)

    # ===== نص الإفادة =====
    level_ar = LEVEL_AR.get(s.get("level") or 1, str(s.get("level")))
    status_phrase = STATUS_PHRASE.get(s.get("student_status", "active"), "ومستمراً في الدراسة")
    c.setFont("Amiri", 14)
    yy = H - 96 * mm
    if (s.get("body") or "").strip():
        # 📝 متن مخصص من قالب أو إفادة حرة — يُلف على أسطر
        import textwrap as _tw
        c.drawCentredString(W / 2, yy, ar(f"تفيد {s.get('faculty_name', '')} بجامعة الأحقاف"))
        yy -= 9 * mm
        c.drawCentredString(W / 2, yy, ar("بأن الطالب:"))
        yy -= 10 * mm
        c.setFont("Amiri", 17)
        c.drawCentredString(W / 2, yy, ar(s.get("student_name", "")))
        yy -= 11 * mm
        c.setFont("Amiri", 14)
        for para in s["body"].split("\n"):
            for line in (_tw.wrap(para, width=72) or [""]):
                c.drawCentredString(W / 2, yy, ar(line))
                yy -= 8 * mm
        yy -= 4 * mm
    else:
        c.drawCentredString(W / 2, yy, ar(f"تفيد {s.get('faculty_name', '')} بجامعة الأحقاف"))
        yy -= 9 * mm
        c.drawCentredString(W / 2, yy, ar("بأن الطالب:"))
        yy -= 10 * mm
        c.setFont("Amiri", 17)
        c.drawCentredString(W / 2, yy, ar(s.get("student_name", "")))
        yy -= 11 * mm
        c.setFont("Amiri", 14)
        c.drawCentredString(W / 2, yy, ar(f"{s.get('nationality', '')} الجنسية، يدرس بالمستوى {level_ar} تخصص ({s.get('department_name', '')})"))
        yy -= 9 * mm
        c.drawCentredString(W / 2, yy, ar(f"للعام الجامعي {s.get('academic_year', '')}، يحمل رقم قيد ({s.get('enrollment_no', '')}) {status_phrase}."))
        yy -= 12 * mm
        c.drawCentredString(W / 2, yy, ar("أعطيت له هذه الإفادة بناءً على طلبه."))
    if s.get("purpose"):
        yy -= 9 * mm
        c.drawCentredString(W / 2, yy, ar(f"وذلك لغرض: {s['purpose']}"))

    # ===== التوقيع =====
    sig_title = (s.get("signatory_title") or settings.get("signatory_title") or "مسجل الكلية").strip()
    sig_name = (s.get("signatory_name") or settings.get("registrar_name") or "").strip()
    sig_img = None
    sig_b64 = settings.get("signature_base64") or ""
    if sig_b64:
        try:
            sig_img = ImageReader(io.BytesIO(base64.b64decode(sig_b64.split(",")[-1])))
        except Exception:
            sig_img = None
    c.setFont("Amiri", 14)
    c.drawString(30 * mm, yy - 24 * mm, ar(sig_title))
    name_y = yy - 33 * mm
    if sig_img:
        c.drawImage(sig_img, 20 * mm, yy - 42 * mm, 38 * mm, 15 * mm, mask="auto", preserveAspectRatio=True)
        name_y = yy - 47 * mm
    c.setFont("Amiri", 13)
    c.drawString(24 * mm, name_y, ar(sig_name))

    # ===== QR للتحقق =====
    verify_url = s.get("verify_url") or s.get("verify_token", "")
    qr_img = qrcode.make(verify_url, box_size=4, border=1)
    qb = io.BytesIO()
    qr_img.save(qb, format="PNG")
    qb.seek(0)
    c.drawImage(ImageReader(qb), W - 48 * mm, 30 * mm, 26 * mm, 26 * mm)
    c.setFont("Amiri", 8)
    c.drawCentredString(W - 35 * mm, 26 * mm, ar("للتحقق من صحة الإفادة امسح الرمز"))
    if s.get("expires_at"):
        c.setFont("Amiri", 7)
        c.drawCentredString(W - 35 * mm, 23 * mm, ar(f"صالحة حتى {str(s['expires_at'])[:10].replace('-', '/')}م"))

    # ===== التذييل =====
    c.line(18 * mm, 22 * mm, W - 18 * mm, 22 * mm)
    c.setFont("Amiri", 9)
    footer_parts = []
    if settings.get("address"):
        footer_parts.append(settings["address"])
    if settings.get("phones"):
        footer_parts.append(f"تلفون: {settings['phones']}")
    if settings.get("fax"):
        footer_parts.append(f"فاكس: {settings['fax']}")
    if settings.get("po_box"):
        footer_parts.append(f"ص.ب ({settings['po_box']})")
    if settings.get("website"):
        footer_parts.append(settings["website"])
    c.drawCentredString(W / 2, 16 * mm, ar(" — ".join(footer_parts)))

    c.showPage()
    c.save()
    return buf.getvalue()
