"""🪪 البطاقة الوظيفية/الأكاديمية الرقمية: بيانات البطاقة، الصورة الشخصية (باعتماد HR)، والتحقق العام بالـ QR"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import Response

from .deps import get_db, get_current_user, log_activity
from .hr_common import P_MANAGE, YEMEN_TZ, _now, _oid, _ser, _can_view, _guard, find_my_employee, employee_user_ids, notify_users, hr_manager_user_ids
from .statements import get_verify_base

router = APIRouter(prefix="/hr", tags=["شؤون الموظفين - البطاقة الرقمية"])
public_router = APIRouter(prefix="/hr", tags=["شؤون الموظفين - تحقق عام"])

ALLOWED_PHOTO_TYPES = ("image/jpeg", "image/png", "image/webp")
CARD_VALID_DAYS = 365
UNIVERSITY = {"name_ar": "جامعة الأحقاف", "name_en": "Al-Ahgaff University"}


def _today():
    return datetime.now(YEMEN_TZ).date()


async def _ensure_token(db, emp: dict) -> dict:
    """توكن بطاقة صالح؛ يُجدَّد تلقائياً عند الانتهاء"""
    today = _today().isoformat()
    if emp.get("card_token") and (emp.get("card_valid_until") or "") >= today:
        return {"token": emp["card_token"], "issued_at": emp.get("card_issued_at", "")[:10], "valid_until": emp["card_valid_until"]}
    valid_until = (_today() + timedelta(days=CARD_VALID_DAYS)).isoformat()
    if emp.get("contract_end_date") and emp["contract_end_date"] > today:
        valid_until = min(valid_until, emp["contract_end_date"])
    token = uuid.uuid4().hex
    await db.employees.update_one({"_id": emp["_id"]}, {"$set": {"card_token": token, "card_issued_at": _now(), "card_valid_until": valid_until}})
    return {"token": token, "issued_at": today, "valid_until": valid_until}


async def _unit_chain(db, unit_id: Optional[str]) -> dict:
    """اسم الوحدة + القسم + الكلية من الهيكل التنظيمي (صعوداً)"""
    out = {"org_unit_name": "", "department_name": "", "faculty_name": ""}
    cur = unit_id
    for i in range(20):
        if not cur or not ObjectId.is_valid(cur):
            break
        u = await db.org_units.find_one({"_id": ObjectId(cur)}, {"name": 1, "type": 1, "parent_id": 1})
        if not u:
            break
        name = (u.get("name") or "").strip()
        if i == 0:
            out["org_unit_name"] = name
        if u.get("type") == "department" and not out["department_name"]:
            out["department_name"] = name
        if u.get("type") == "faculty" and not out["faculty_name"]:
            out["faculty_name"] = name
        cur = u.get("parent_id")
    return out


async def _teacher_bits(db, emp: dict) -> dict:
    if not emp.get("teacher_id") or not ObjectId.is_valid(emp["teacher_id"]):
        return {}
    t = await db.teachers.find_one({"_id": ObjectId(emp["teacher_id"])}, {"teacher_id": 1, "academic_title": 1, "specialization": 1, "department_id": 1, "department_ids": 1})
    if not t:
        return {}
    bits = {"academic_no": t.get("teacher_id", ""), "academic_title": t.get("academic_title") or "", "specialization": t.get("specialization") or emp.get("specialization") or ""}
    dept_id = t.get("department_id") or ((t.get("department_ids") or [None])[0])
    if dept_id and ObjectId.is_valid(dept_id):
        d = await db.departments.find_one({"_id": ObjectId(dept_id)}, {"name": 1, "faculty_id": 1})
        if d:
            bits["department_name"] = (d.get("name") or "").strip()
            if d.get("faculty_id") and ObjectId.is_valid(d["faculty_id"]):
                f = await db.faculties.find_one({"_id": ObjectId(d["faculty_id"])}, {"name": 1})
                bits["faculty_name"] = ((f or {}).get("name") or "").strip()
    return bits


async def card_payload(db, emp: dict, base_url: str = "") -> dict:
    from .hr import CONTRACT_TYPES, STATUSES, CATEGORIES
    tok = await _ensure_token(db, emp)
    chain = await _unit_chain(db, emp.get("org_unit_id"))
    tb = await _teacher_bits(db, emp)
    kind = "academic" if emp.get("category") == "academic" or tb else "administrative"
    base = (await get_verify_base(db)) or (base_url or "").rstrip("/")
    photo_url = f"{base}/api/hr/public/employee-photo/{tok['token']}" if emp.get("photo_path") and base else None
    return {
        "kind": kind, "kind_label": "بطاقة أكاديمية" if kind == "academic" else "بطاقة وظيفية",
        "employee_id": str(emp["_id"]), "full_name": emp.get("full_name", ""), "number": emp.get("employee_no", ""), "academic_no": tb.get("academic_no", ""),
        "title": (tb.get("academic_title") or emp.get("job_title") or "") if kind == "academic" else (emp.get("job_title") or ""),
        "job_title": emp.get("job_title", ""), "academic_title": tb.get("academic_title", ""), "specialization": tb.get("specialization") or emp.get("specialization") or "",
        "grade": emp.get("grade", ""), "category_label": CATEGORIES.get(emp.get("category"), ""),
        "faculty_name": tb.get("faculty_name") or chain["faculty_name"], "department_name": tb.get("department_name") or chain["department_name"], "org_unit_name": chain["org_unit_name"],
        "contract_type": emp.get("contract_type", ""), "contract_type_label": CONTRACT_TYPES.get(emp.get("contract_type"), ""), "hire_date": emp.get("hire_date"),
        "status": emp.get("status", "active"), "status_label": STATUSES.get(emp.get("status"), ""), "nationality": emp.get("nationality") or "",
        "photo_url": photo_url, "has_photo": bool(emp.get("photo_path")), "pending_photo": bool(emp.get("pending_photo_path")),
        "can_upload_photo": (not emp.get("photo_upload_used")) or bool(emp.get("photo_upload_allowed")),
        "card_token": tok["token"], "verify_url": f"{base}/verify-employee?token={tok['token']}" if base else tok["token"],
        "issued_at": tok["issued_at"], "valid_until": tok["valid_until"], "university": UNIVERSITY,
    }


def _req_base(request: Request) -> str:
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    scheme = request.headers.get("x-forwarded-proto") or request.url.scheme or "https"
    return f"{scheme}://{host}" if host else ""


@router.get("/employees/me/card")
async def my_card(request: Request, base_url: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
    """👤 بطاقتي الرقمية (معلم أو موظف)"""
    db = get_db()
    emp = await find_my_employee(db, current_user)
    if not emp:
        raise HTTPException(status_code=404, detail="لا يوجد ملف إداري مرتبط بحسابك — راجع شؤون الموظفين")
    if emp.get("status") in ("suspended", "ended"):
        raise HTTPException(status_code=403, detail="لا تتوفر بطاقة في الحالة الوظيفية الحالية")
    return await card_payload(db, emp, base_url or _req_base(request))


@router.get("/employees/{emp_id}/card")
async def employee_card(emp_id: str, request: Request, base_url: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
    if not _can_view(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح")
    db = get_db()
    emp = await db.employees.find_one({"_id": _oid(emp_id)})
    if not emp:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    return await card_payload(db, emp, base_url or _req_base(request))


async def _store_photo(file: UploadFile) -> str:
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(status_code=400, detail="نوع الصورة غير مدعوم (JPEG/PNG/WebP)")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="حجم الصورة يتجاوز 5MB")
    from services.storage_service import upload_file
    return upload_file(data, file.filename or "photo.jpg", file.content_type, "employee_photos")["storage_path"]


@router.post("/employees/me/photo")
async def upload_my_photo(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """👤 الموظف يرفع صورته — تبقى معلّقة حتى تعتمدها شؤون الموظفين (مرة واحدة، والثانية بإذن HR)"""
    db = get_db()
    emp = await find_my_employee(db, current_user)
    if not emp:
        raise HTTPException(status_code=404, detail="لا يوجد ملف إداري مرتبط بحسابك")
    if emp.get("photo_upload_used") and not emp.get("photo_upload_allowed"):
        raise HTTPException(status_code=403, detail="لقد استخدمت فرصة رفع الصورة — لتغييرها راجع شؤون الموظفين للسماح برفع جديد")
    path = await _store_photo(file)
    await db.employees.update_one({"_id": emp["_id"]}, {"$set": {"pending_photo_path": path, "pending_photo_at": _now(), "photo_upload_used": True}, "$unset": {"photo_upload_allowed": ""}})
    await notify_users(db, await hr_manager_user_ids(db, P_MANAGE), "صورة بطاقة بانتظار الاعتماد", f"{emp.get('full_name', '')} رفع صورته الشخصية للبطاقة", "hr_photo", {"employee_id": str(emp["_id"])})
    return {"message": "تم رفع صورتك — بانتظار اعتماد شؤون الموظفين", "pending_photo": True}


@router.get("/photos/pending")
async def pending_photos(current_user: dict = Depends(get_current_user)):
    if not _can_view(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح")
    db = get_db()
    items = [_ser(e) for e in await db.employees.find({"pending_photo_path": {"$exists": True, "$ne": ""}}, {"full_name": 1, "employee_no": 1, "job_title": 1, "pending_photo_at": 1, "card_token": 1}).sort("pending_photo_at", 1).to_list(500)]
    return {"items": items, "count": len(items)}


@router.get("/employees/{emp_id}/photo")
async def employee_photo(emp_id: str, which: str = "approved", current_user: dict = Depends(get_current_user)):
    """صورة الموظف (المعتمدة أو المعلّقة) لشاشة الإدارة"""
    if not _can_view(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح")
    db = get_db()
    emp = await db.employees.find_one({"_id": _oid(emp_id)}, {"photo_path": 1, "pending_photo_path": 1})
    path = (emp or {}).get("pending_photo_path" if which == "pending" else "photo_path")
    if not path:
        raise HTTPException(status_code=404, detail="لا توجد صورة")
    from services.storage_service import get_object
    data, ct = get_object(path)
    return Response(content=data, media_type=ct or "image/jpeg")


async def _notify_decision(db, emp: dict, approved: bool):
    uid = (await employee_user_ids(db, [str(emp["_id"])])).get(str(emp["_id"]))
    if uid:
        await notify_users(db, [uid], "تم اعتماد صورة بطاقتك" if approved else "لم تُعتمد صورة بطاقتك",
                           "صورتك الشخصية أصبحت ظاهرة على بطاقتك الرقمية" if approved else "يمكنك رفع صورة جديدة مطابقة للمواصفات (خلفية فاتحة، وجه واضح)", "hr_photo", {})


@router.post("/employees/{emp_id}/photo")
async def hr_upload_photo(emp_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """شؤون الموظفين ترفع صورة الموظف — تُعتمد مباشرة"""
    _guard(current_user, P_MANAGE)
    db = get_db()
    emp = await db.employees.find_one({"_id": _oid(emp_id)})
    if not emp:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    path = await _store_photo(file)
    await db.employees.update_one({"_id": emp["_id"]}, {"$set": {"photo_path": path}, "$unset": {"pending_photo_path": "", "pending_photo_at": ""}})
    await log_activity(current_user, "hr_set_photo", "employee", emp_id, emp.get("full_name", ""), {})
    return {"message": "تم حفظ صورة الموظف"}


@router.post("/employees/{emp_id}/photo/approve")
async def approve_photo(emp_id: str, current_user: dict = Depends(get_current_user)):
    _guard(current_user, P_MANAGE)
    db = get_db()
    emp = await db.employees.find_one({"_id": _oid(emp_id)})
    if not emp or not emp.get("pending_photo_path"):
        raise HTTPException(status_code=400, detail="لا توجد صورة معلّقة لهذا الموظف")
    await db.employees.update_one({"_id": emp["_id"]}, {"$set": {"photo_path": emp["pending_photo_path"]}, "$unset": {"pending_photo_path": "", "pending_photo_at": ""}})
    await log_activity(current_user, "hr_approve_photo", "employee", emp_id, emp.get("full_name", ""), {})
    await _notify_decision(db, emp, True)
    return {"message": "تم اعتماد الصورة"}


@router.post("/employees/{emp_id}/photo/reject")
async def reject_photo(emp_id: str, current_user: dict = Depends(get_current_user)):
    """الرفض يفتح فرصة رفع جديدة تلقائياً"""
    _guard(current_user, P_MANAGE)
    db = get_db()
    emp = await db.employees.find_one({"_id": _oid(emp_id)})
    if not emp:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    await db.employees.update_one({"_id": emp["_id"]}, {"$set": {"photo_upload_allowed": True}, "$unset": {"pending_photo_path": "", "pending_photo_at": ""}})
    await log_activity(current_user, "hr_reject_photo", "employee", emp_id, emp.get("full_name", ""), {})
    if emp.get("pending_photo_path"):
        await _notify_decision(db, emp, False)
    return {"message": "تم رفض الصورة — يمكن للموظف رفع صورة جديدة"}


@router.post("/employees/{emp_id}/photo/allow-upload")
async def allow_upload(emp_id: str, current_user: dict = Depends(get_current_user)):
    _guard(current_user, P_MANAGE)
    db = get_db()
    r = await db.employees.update_one({"_id": _oid(emp_id)}, {"$set": {"photo_upload_allowed": True}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    return {"message": "تم السماح للموظف برفع صورة جديدة"}


@router.delete("/employees/{emp_id}/photo")
async def remove_photo(emp_id: str, current_user: dict = Depends(get_current_user)):
    _guard(current_user, P_MANAGE)
    db = get_db()
    r = await db.employees.update_one({"_id": _oid(emp_id)}, {"$unset": {"photo_path": ""}, "$set": {"photo_upload_allowed": True}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    return {"message": "تم حذف الصورة المعتمدة"}


@public_router.get("/verify/employee/{token}")
async def verify_employee_card(token: str):
    """🔎 تحقق عام من البطاقة الوظيفية/الأكاديمية — بدون تسجيل دخول"""
    db = get_db()
    emp = await db.employees.find_one({"card_token": token})
    if not emp:
        return {"valid": False, "message": "لا توجد بطاقة بهذا الرمز — قد تكون البطاقة غير صحيحة"}
    from .hr import STATUSES
    chain = await _unit_chain(db, emp.get("org_unit_id"))
    tb = await _teacher_bits(db, emp)
    kind = "academic" if emp.get("category") == "academic" or tb else "administrative"
    base = {"kind": kind, "kind_label": "بطاقة أكاديمية" if kind == "academic" else "بطاقة وظيفية", "full_name": emp.get("full_name", ""), "number": emp.get("employee_no", ""),
            "title": (tb.get("academic_title") or emp.get("job_title") or ""), "faculty_name": tb.get("faculty_name") or chain["faculty_name"],
            "department_name": tb.get("department_name") or chain["department_name"], "org_unit_name": chain["org_unit_name"],
            "status_label": STATUSES.get(emp.get("status"), ""), "valid_until": emp.get("card_valid_until", ""), "has_photo": bool(emp.get("photo_path"))}
    if emp.get("status") in ("suspended", "ended"):
        return {"valid": False, "message": "هذه البطاقة لم تعد سارية — صاحبها ليس على رأس العمل حالياً", **base}
    if (emp.get("card_valid_until") or "") < _today().isoformat():
        return {"valid": False, "message": f"انتهت صلاحية هذه البطاقة ({emp.get('card_valid_until', '')})", **base}
    return {"valid": True, "message": f"{base['kind_label']} سارية صادرة رسمياً من جامعة الأحقاف", **base}


@public_router.get("/public/employee-photo/{token}")
async def public_employee_photo(token: str):
    db = get_db()
    emp = await db.employees.find_one({"card_token": token}, {"photo_path": 1})
    if not emp or not emp.get("photo_path"):
        raise HTTPException(status_code=404, detail="لا توجد صورة")
    from services.storage_service import get_object
    try:
        data, ct = get_object(emp["photo_path"])
    except Exception:
        raise HTTPException(status_code=404, detail="لا توجد صورة")
    return Response(content=data, media_type=ct or "image/jpeg", headers={"Cache-Control": "public, max-age=3600"})
