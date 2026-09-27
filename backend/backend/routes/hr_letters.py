"""📜 الخطابات الرسمية: طلب الموظف (تعريف/خبرة/استمرارية/موجّه لجهة) → اعتماد HR → PDF على الكليشة الرسمية + QR تحقق عام"""
import uuid
from datetime import datetime
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from .deps import get_db, get_current_user, log_activity, export_headers, export_filename
from .hr_common import P_MANAGE, YEMEN_TZ, _now, _oid, _ser, _can_view, _guard, find_my_employee, employee_user_ids, notify_users, hr_manager_user_ids, enrich_employee_refs
from .statements import get_verify_base

router = APIRouter(prefix="/hr/letters", tags=["شؤون الموظفين - الخطابات الرسمية"])
public_router = APIRouter(prefix="/hr", tags=["شؤون الموظفين - تحقق عام"])

LETTER_TYPES = {"introduction": "خطاب تعريف", "experience": "شهادة خبرة", "continuity": "إفادة استمرارية على العمل", "addressed": "خطاب موجّه لجهة"}
LETTER_TYPES_EN = {"introduction": "Employment Verification Letter", "experience": "Experience Certificate", "continuity": "Certificate of Continuous Employment", "addressed": "To Whom It May Concern"}
LANGS = {"ar": "عربي", "en": "English"}
STATUSES = {"pending": "بانتظار الاعتماد", "approved": "معتمد وصادر", "rejected": "مرفوض", "cancelled": "ملغى"}
SETTINGS_ID = "letters"
DEFAULT_SETTINGS = {"signer_name": "", "signer_title": "مدير شؤون الموظفين", "signer_name_en": "", "signer_title_en": "Director of Human Resources",
                    "footer_ar": "", "footer_en": "", "top_margin_mm": 45, "bottom_margin_mm": 35, "letterhead_path": "", "signature_path": ""}


class RequestIn(BaseModel):
    type: str
    language: str = "ar"
    addressed_to: str = ""
    purpose: str = ""


class DirectIn(RequestIn):
    employee_id: str
    body: Optional[str] = None


class DecisionIn(BaseModel):
    body: Optional[str] = None
    note: str = ""


class SettingsIn(BaseModel):
    signer_name: str = ""
    signer_title: str = "مدير شؤون الموظفين"
    signer_name_en: str = ""
    signer_title_en: str = "Director of Human Resources"
    footer_ar: str = ""
    footer_en: str = ""
    top_margin_mm: int = 45
    bottom_margin_mm: int = 35


def _today():
    return datetime.now(YEMEN_TZ).date()


def _fmt_ar(d: Optional[str]) -> str:
    return d or "—"


def _fmt_en(d: Optional[str]) -> str:
    try:
        return datetime.strptime(d, "%Y-%m-%d").strftime("%d %B %Y")
    except Exception:
        return d or "—"


async def _emp_ctx(db, emp: dict) -> dict:
    from .hr import CONTRACT_TYPES
    from .hr_cards import _unit_chain, _teacher_bits
    chain = await _unit_chain(db, emp.get("org_unit_id"))
    tb = await _teacher_bits(db, emp)
    title = tb.get("academic_title") or emp.get("job_title") or ""
    unit = chain["org_unit_name"] or tb.get("department_name") or ""
    faculty = tb.get("faculty_name") or chain["faculty_name"]
    return {"name": emp.get("full_name", ""), "no": emp.get("employee_no", ""), "title": title, "unit": unit, "faculty": faculty,
            "hire_date": emp.get("hire_date") or "", "end_date": emp.get("contract_end_date") if emp.get("status") == "ended" else "",
            "contract": CONTRACT_TYPES.get(emp.get("contract_type"), ""), "nationality": emp.get("nationality") or "", "national_id": emp.get("national_id") or "",
            "still": emp.get("status") not in ("ended",)}


def default_body(t: str, lang: str, c: dict, addressed_to: str, purpose: str) -> str:
    """نص الخطاب الافتراضي — قابل للتعديل من HR قبل الإصدار"""
    where = f" في {c['unit']}" if c["unit"] else ""
    where_f = f" — {c['faculty']}" if c["faculty"] and c["faculty"] != c["unit"] else ""
    if lang == "en":
        where_en = f" in the {c['unit']}" if c["unit"] else ""
        where_f_en = f", {c['faculty']}" if c["faculty"] and c["faculty"] != c["unit"] else ""
        since = f" since {_fmt_en(c['hire_date'])}" if c["hire_date"] else ""
        to = f"To: {addressed_to}\n\n" if addressed_to else "To Whom It May Concern,\n\n"
        if t == "experience":
            period = f"from {_fmt_en(c['hire_date'])} to {_fmt_en(c['end_date'])}" if c["end_date"] else f"from {_fmt_en(c['hire_date'])} to date"
            return (f"{to}Al-Ahgaff University hereby certifies that Mr./Ms. {c['name']} (Employee No. {c['no']}) has worked with the University as {c['title']}{where_en}{where_f_en} {period}"
                    f"{', under a ' + c['contract'] + ' contract' if c['contract'] else ''}.\n\nDuring this period, the above-named demonstrated commitment, integrity and professionalism in performing the assigned duties.\n\n"
                    f"This certificate has been issued upon the request of the employee{(' for ' + purpose) if purpose else ''}, without any liability on the University.")
        if t == "continuity":
            return (f"{to}Al-Ahgaff University certifies that Mr./Ms. {c['name']} (Employee No. {c['no']}) is currently employed with the University as {c['title']}{where_en}{where_f_en}{since}, "
                    f"and is still in active service as of the date of this letter.\n\nThis letter has been issued upon the request of the employee{(' for ' + purpose) if purpose else ''}.")
        return (f"{to}Al-Ahgaff University certifies that Mr./Ms. {c['name']} (Employee No. {c['no']}) is an employee of the University, holding the position of {c['title']}{where_en}{where_f_en}{since}"
                f"{', under a ' + c['contract'] + ' contract' if c['contract'] else ''}.\n\nThis letter has been issued upon the request of the employee{(' for ' + purpose) if purpose else ''}, without any liability on the University.")
    to = f"إلى / {addressed_to}\n\n" if addressed_to else "إلى من يهمه الأمر\n\n"
    greet = "تحية طيبة وبعد،\n\n"
    since = f" منذ تاريخ {_fmt_ar(c['hire_date'])}" if c["hire_date"] else ""
    contract = f" بعقد {c['contract']}" if c["contract"] else ""
    nat = f"، {c['nationality']} الجنسية" if c["nationality"] else ""
    nid = f" (رقم الهوية: {c['national_id']})" if c["national_id"] else ""
    for_p = f" وذلك لغرض {purpose}" if purpose else ""
    if t == "experience":
        period = f"خلال الفترة من {_fmt_ar(c['hire_date'])} إلى {_fmt_ar(c['end_date'])}" if c["end_date"] else f"منذ تاريخ {_fmt_ar(c['hire_date'])} وحتى تاريخه"
        return (f"{to}{greet}تشهد جامعة الأحقاف بأن الأستاذ/ة {c['name']}{nat}{nid}، الرقم الوظيفي ({c['no']})، قد عمل/ت لديها بوظيفة {c['title']}{where}{where_f} {period}{contract}.\n\n"
                f"وقد تميّز/ت خلال فترة عمله/ها بالالتزام وحسن السيرة والسلوك وأداء المهام الموكلة إليه/ها بكفاءة.\n\n"
                f"وقد أُعطيت هذه الشهادة بناءً على طلبه/ها{for_p}، دون أدنى مسؤولية على الجامعة.")
    if t == "continuity":
        return (f"{to}{greet}تفيد جامعة الأحقاف بأن الأستاذ/ة {c['name']}{nat}{nid}، الرقم الوظيفي ({c['no']})، يعمل/تعمل لديها بوظيفة {c['title']}{where}{where_f}{since}، "
                f"ولا يزال/لا تزال على رأس العمل حتى تاريخ إصدار هذه الإفادة.\n\nوقد أُعطيت هذه الإفادة بناءً على طلبه/ها{for_p}.")
    return (f"{to}{greet}تشهد جامعة الأحقاف بأن الأستاذ/ة {c['name']}{nat}{nid}، الرقم الوظيفي ({c['no']})، يعمل/تعمل لديها بوظيفة {c['title']}{where}{where_f}{since}{contract}.\n\n"
            f"وقد أُعطي هذا الخطاب بناءً على طلبه/ها{for_p}، دون أدنى مسؤولية على الجامعة.")


async def get_settings(db) -> dict:
    doc = await db.hr_settings.find_one({"_id": SETTINGS_ID}) or {}
    return {**DEFAULT_SETTINGS, **{k: v for k, v in doc.items() if k != "_id"}}


def _view(l: dict) -> dict:
    d = _ser(l)
    d["type_label"] = LETTER_TYPES.get(l.get("type"), l.get("type"))
    d["status_label"] = STATUSES.get(l.get("status"), l.get("status"))
    d["language_label"] = LANGS.get(l.get("language"), l.get("language"))
    return d


async def _enrich(db, items: list) -> list:
    await enrich_employee_refs(db, items)
    return items


async def _next_ref(db) -> str:
    y = _today().year
    n = await db.hr_letters.count_documents({"ref_no": {"$regex": f"^HR-L-{y}-"}}) + 1
    return f"HR-L-{y}-{n:04d}"


async def _load(db, lid: str) -> dict:
    l = await db.hr_letters.find_one({"_id": _oid(lid)})
    if not l:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    return l


async def _is_owner(db, user: dict, l: dict) -> bool:
    emp = await find_my_employee(db, user)
    return bool(emp and str(emp["_id"]) == l.get("employee_id"))


@router.get("/meta")
async def meta(current_user: dict = Depends(get_current_user)):
    return {"types": LETTER_TYPES, "types_en": LETTER_TYPES_EN, "languages": LANGS, "statuses": STATUSES}


# ---------- الموظف ----------
@router.get("/my")
async def my_letters(current_user: dict = Depends(get_current_user)):
    db = get_db()
    emp = await find_my_employee(db, current_user)
    if not emp:
        return {"profile": None, "items": []}
    items = [_view(l) for l in await db.hr_letters.find({"employee_id": str(emp["_id"])}).sort("created_at", -1).to_list(200)]
    return {"profile": {"id": str(emp["_id"]), "full_name": emp.get("full_name", "")}, "items": items}


@router.post("/my")
async def request_letter(data: RequestIn, current_user: dict = Depends(get_current_user)):
    db = get_db()
    emp = await find_my_employee(db, current_user)
    if not emp:
        raise HTTPException(status_code=404, detail="لا يوجد ملف إداري مرتبط بحسابك")
    if data.type not in LETTER_TYPES:
        raise HTTPException(status_code=400, detail="نوع الخطاب غير صحيح")
    if data.language not in LANGS:
        raise HTTPException(status_code=400, detail="اللغة غير مدعومة")
    if data.type == "addressed" and not data.addressed_to.strip():
        raise HTTPException(status_code=400, detail="حدد الجهة الموجّه إليها الخطاب")
    if await db.hr_letters.count_documents({"employee_id": str(emp["_id"]), "type": data.type, "status": "pending"}):
        raise HTTPException(status_code=400, detail="لديك طلب معلّق من نفس النوع — انتظر قراره أو ألغِه")
    doc = {"employee_id": str(emp["_id"]), "type": data.type, "language": data.language, "addressed_to": data.addressed_to.strip(), "purpose": data.purpose.strip(),
           "status": "pending", "requested_by": current_user["id"], "created_at": _now()}
    r = await db.hr_letters.insert_one(doc)
    await notify_users(db, await hr_manager_user_ids(db, P_MANAGE), "طلب خطاب رسمي جديد", f"{emp.get('full_name', '')} يطلب {LETTER_TYPES[data.type]}", "hr_letter", {"letter_id": str(r.inserted_id)})
    return {"message": "تم إرسال طلبك — سيصلك إشعار عند الاعتماد", "id": str(r.inserted_id)}


@router.post("/{lid}/cancel")
async def cancel_letter(lid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    l = await _load(db, lid)
    if not await _is_owner(db, current_user, l) and not _can_view(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح")
    if l["status"] != "pending":
        raise HTTPException(status_code=400, detail="لا يمكن إلغاء طلب تم البت فيه")
    await db.hr_letters.update_one({"_id": l["_id"]}, {"$set": {"status": "cancelled", "decided_at": _now()}})
    return {"message": "تم إلغاء الطلب"}


# ---------- الإدارة ----------
@router.get("")
async def list_letters(status: Optional[str] = None, employee_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if not _can_view(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح")
    db = get_db()
    q = {}
    if status:
        q["status"] = {"$in": status.split(",")}
    if employee_id:
        q["employee_id"] = employee_id
    items = await _enrich(db, [_view(l) for l in await db.hr_letters.find(q).sort("created_at", -1).to_list(1000)])
    counts = {s: await db.hr_letters.count_documents({"status": s}) for s in STATUSES}
    return {"items": items, "counts": counts}


@router.get("/settings")
async def letter_settings(current_user: dict = Depends(get_current_user)):
    if not _can_view(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح")
    s = await get_settings(get_db())
    return {**s, "has_letterhead": bool(s.get("letterhead_path")), "has_signature": bool(s.get("signature_path"))}


@router.put("/settings")
async def save_letter_settings(data: SettingsIn, current_user: dict = Depends(get_current_user)):
    _guard(current_user, P_MANAGE)
    await get_db().hr_settings.update_one({"_id": SETTINGS_ID}, {"$set": data.model_dump()}, upsert=True)
    return {"message": "تم حفظ إعدادات الخطابات"}


async def _store_img(file: UploadFile, folder: str) -> str:
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status_code=400, detail="الملف يجب أن يكون صورة (PNG/JPEG/WebP)")
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="حجم الصورة يتجاوز 8MB")
    from services.storage_service import upload_file
    return upload_file(data, file.filename or "img.png", file.content_type, folder)["storage_path"]


@router.post("/settings/{kind}")
async def upload_setting_image(kind: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """رفع الكليشة (صفحة A4 كاملة بالشعار والترويسة) أو صورة التوقيع/الختم"""
    _guard(current_user, P_MANAGE)
    if kind not in ("letterhead", "signature"):
        raise HTTPException(status_code=404)
    path = await _store_img(file, "hr_letters")
    await get_db().hr_settings.update_one({"_id": SETTINGS_ID}, {"$set": {f"{kind}_path": path}}, upsert=True)
    return {"message": "تم رفع الكليشة" if kind == "letterhead" else "تم رفع التوقيع"}


@router.delete("/settings/{kind}")
async def delete_setting_image(kind: str, current_user: dict = Depends(get_current_user)):
    _guard(current_user, P_MANAGE)
    if kind not in ("letterhead", "signature"):
        raise HTTPException(status_code=404)
    await get_db().hr_settings.update_one({"_id": SETTINGS_ID}, {"$set": {f"{kind}_path": ""}})
    return {"message": "تم الحذف"}


@router.get("/settings/image/{kind}")
async def setting_image(kind: str, current_user: dict = Depends(get_current_user)):
    if not _can_view(current_user) or kind not in ("letterhead", "signature"):
        raise HTTPException(status_code=403, detail="غير مصرح")
    s = await get_settings(get_db())
    if not s.get(f"{kind}_path"):
        raise HTTPException(status_code=404, detail="لا توجد صورة")
    from services.storage_service import get_object
    data, ct = get_object(s[f"{kind}_path"])
    return Response(content=data, media_type=ct or "image/png")


@router.post("")
async def issue_direct(data: DirectIn, current_user: dict = Depends(get_current_user)):
    """إصدار خطاب مباشرة من HR بدون طلب من الموظف — يُعتمد فوراً"""
    _guard(current_user, P_MANAGE)
    db = get_db()
    emp = await db.employees.find_one({"_id": _oid(data.employee_id)})
    if not emp:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    if data.type not in LETTER_TYPES or data.language not in LANGS:
        raise HTTPException(status_code=400, detail="نوع الخطاب أو اللغة غير صحيح")
    doc = {"employee_id": str(emp["_id"]), "type": data.type, "language": data.language, "addressed_to": data.addressed_to.strip(), "purpose": data.purpose.strip(),
           "status": "pending", "requested_by": current_user["id"], "direct": True, "created_at": _now()}
    r = await db.hr_letters.insert_one(doc)
    doc["_id"] = r.inserted_id
    await _approve(db, doc, emp, current_user, data.body)
    return {"message": "تم إصدار الخطاب", "id": str(r.inserted_id)}


@router.get("/{lid}")
async def get_letter(lid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    l = await _load(db, lid)
    if not _can_view(current_user) and not await _is_owner(db, current_user, l):
        raise HTTPException(status_code=403, detail="غير مصرح")
    emp = await db.employees.find_one({"_id": ObjectId(l["employee_id"])}) or {}
    v = (await _enrich(db, [_view(l)]))[0]
    if not v.get("body"):
        v["draft_body"] = default_body(l["type"], l.get("language", "ar"), await _emp_ctx(db, emp), l.get("addressed_to", ""), l.get("purpose", ""))
    return v


async def _approve(db, l: dict, emp: dict, user: dict, body: Optional[str]):
    ctx = await _emp_ctx(db, emp)
    text = (body or "").strip() or default_body(l["type"], l.get("language", "ar"), ctx, l.get("addressed_to", ""), l.get("purpose", ""))
    ref = await _next_ref(db)
    upd = {"status": "approved", "body": text, "ref_no": ref, "verify_token": uuid.uuid4().hex, "approved_by": user["id"], "approved_by_name": user.get("full_name", ""),
           "approved_at": _now(), "issue_date": _today().isoformat(), "snapshot": ctx}
    await db.hr_letters.update_one({"_id": l["_id"]}, {"$set": upd})
    await log_activity(user, "hr_letter_issue", "hr_letter", str(l["_id"]), f"{ref} — {emp.get('full_name', '')}", {"type": l["type"]})
    uid = (await employee_user_ids(db, [str(emp["_id"])])).get(str(emp["_id"]))
    if uid:
        await notify_users(db, [uid], f"صدر {LETTER_TYPES[l['type']]} الخاص بك", f"الرقم المرجعي {ref} — يمكنك تحميل الملف من التطبيق", "hr_letter", {"letter_id": str(l["_id"])})


@router.post("/{lid}/approve")
async def approve_letter(lid: str, data: DecisionIn, current_user: dict = Depends(get_current_user)):
    _guard(current_user, P_MANAGE)
    db = get_db()
    l = await _load(db, lid)
    if l["status"] != "pending":
        raise HTTPException(status_code=400, detail="الطلب ليس معلّقاً")
    emp = await db.employees.find_one({"_id": ObjectId(l["employee_id"])})
    if not emp:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    await _approve(db, l, emp, current_user, data.body)
    return {"message": "تم اعتماد الخطاب وإصداره"}


@router.post("/{lid}/reject")
async def reject_letter(lid: str, data: DecisionIn, current_user: dict = Depends(get_current_user)):
    _guard(current_user, P_MANAGE)
    db = get_db()
    l = await _load(db, lid)
    if l["status"] != "pending":
        raise HTTPException(status_code=400, detail="الطلب ليس معلّقاً")
    if not data.note.strip():
        raise HTTPException(status_code=400, detail="اذكر سبب الرفض")
    await db.hr_letters.update_one({"_id": l["_id"]}, {"$set": {"status": "rejected", "decision_note": data.note.strip(), "decided_by": current_user["id"], "decided_by_name": current_user.get("full_name", ""), "decided_at": _now()}})
    uid = (await employee_user_ids(db, [l["employee_id"]])).get(l["employee_id"])
    if uid:
        await notify_users(db, [uid], f"لم يُعتمد طلب {LETTER_TYPES.get(l['type'], '')}", data.note.strip(), "hr_letter", {"letter_id": lid})
    return {"message": "تم رفض الطلب"}


@router.delete("/{lid}")
async def delete_letter(lid: str, current_user: dict = Depends(get_current_user)):
    _guard(current_user, P_MANAGE)
    db = get_db()
    l = await _load(db, lid)
    if l["status"] == "approved":
        raise HTTPException(status_code=400, detail="لا يمكن حذف خطاب صادر — سجله محفوظ للتحقق")
    await db.hr_letters.delete_one({"_id": l["_id"]})
    return {"message": "تم الحذف"}


@router.get("/{lid}/pdf")
async def letter_pdf(lid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    l = await _load(db, lid)
    if not _can_view(current_user) and not await _is_owner(db, current_user, l):
        raise HTTPException(status_code=403, detail="غير مصرح")
    if l["status"] != "approved":
        raise HTTPException(status_code=400, detail="يُصدر الملف للخطابات المعتمدة فقط")
    s = await get_settings(db)
    base = await get_verify_base(db)
    verify_url = f"{base}/verify-letter?token={l['verify_token']}" if base else l["verify_token"]
    from .hr_letter_pdf import build_letter_pdf
    pdf = build_letter_pdf(l, s, verify_url)
    import io
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers=export_headers(export_filename(LETTER_TYPES.get(l["type"], "خطاب"), l.get("snapshot", {}).get("name", ""), l.get("ref_no", ""), ext="pdf")))


@public_router.get("/verify/letter/{token}")
async def verify_letter(token: str):
    """🔎 تحقق عام من خطاب رسمي — بدون تسجيل دخول"""
    db = get_db()
    l = await db.hr_letters.find_one({"verify_token": token, "status": "approved"})
    if not l:
        return {"valid": False, "message": "لا يوجد خطاب رسمي صادر بهذا الرمز"}
    s = l.get("snapshot", {})
    return {"valid": True, "message": "خطاب رسمي صحيح صادر من شؤون الموظفين — جامعة الأحقاف", "ref_no": l.get("ref_no"), "type_label": LETTER_TYPES.get(l["type"], ""), "type_label_en": LETTER_TYPES_EN.get(l["type"], ""),
            "language": l.get("language", "ar"), "employee_name": s.get("name", ""), "employee_no": s.get("no", ""), "job_title": s.get("title", ""), "org_unit_name": s.get("unit", ""),
            "addressed_to": l.get("addressed_to", ""), "issue_date": l.get("issue_date", ""), "approved_by": l.get("approved_by_name", "")}
