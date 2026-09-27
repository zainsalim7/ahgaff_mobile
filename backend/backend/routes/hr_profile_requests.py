"""✏️ طلبات تعديل البيانات الشخصية: الموظف يطلب تغيير هاتف/بريد/عنوان/… من التطبيق → HR يعتمد فيُحفظ في ملفه أو يرفض بسبب"""
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .deps import get_db, get_current_user, log_activity
from .hr_common import P_MANAGE, _now, _oid, _ser, _can_view, _guard, find_my_employee, employee_user_ids, notify_users, hr_manager_user_ids, enrich_employee_refs

router = APIRouter(prefix="/hr/profile-requests", tags=["شؤون الموظفين - تعديل البيانات"])

EDITABLE_FIELDS = {"phone": "رقم الهاتف", "email": "البريد الإلكتروني", "address": "العنوان", "emergency_contact": "جهة اتصال للطوارئ",
                   "qualification": "المؤهل العلمي", "specialization": "التخصص", "national_id": "رقم الهوية", "id_expiry_date": "تاريخ انتهاء الهوية", "birth_date": "تاريخ الميلاد"}
STATUSES = {"pending": "بانتظار الاعتماد", "approved": "معتمد", "rejected": "مرفوض", "cancelled": "ملغى"}


class RequestIn(BaseModel):
    changes: dict  # {field: new_value}
    note: str = ""


class DecisionIn(BaseModel):
    note: str = ""
    changes: Optional[dict] = None  # HR قد يصحّح القيم قبل الاعتماد


def _view(r: dict) -> dict:
    d = _ser(r)
    d["status_label"] = STATUSES.get(r.get("status"), r.get("status"))
    d["changes_view"] = [{"field": k, "label": EDITABLE_FIELDS.get(k, k), "old": (r.get("old_values") or {}).get(k, ""), "new": v} for k, v in (r.get("changes") or {}).items()]
    return d


async def _load(db, rid: str) -> dict:
    r = await db.hr_profile_requests.find_one({"_id": _oid(rid)})
    if not r:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    return r


@router.get("/meta")
async def meta(current_user: dict = Depends(get_current_user)):
    return {"fields": EDITABLE_FIELDS, "statuses": STATUSES}


@router.get("/my")
async def my_requests(current_user: dict = Depends(get_current_user)):
    db = get_db()
    emp = await find_my_employee(db, current_user)
    if not emp:
        return {"profile": None, "items": [], "current": {}}
    items = [_view(r) for r in await db.hr_profile_requests.find({"employee_id": str(emp["_id"])}).sort("created_at", -1).to_list(100)]
    return {"profile": {"id": str(emp["_id"]), "full_name": emp.get("full_name", "")}, "current": {k: emp.get(k) or "" for k in EDITABLE_FIELDS}, "items": items,
            "has_pending": any(r["status"] == "pending" for r in items)}


@router.post("/my")
async def request_change(data: RequestIn, current_user: dict = Depends(get_current_user)):
    db = get_db()
    emp = await find_my_employee(db, current_user)
    if not emp:
        raise HTTPException(status_code=404, detail="لا يوجد ملف إداري مرتبط بحسابك")
    changes = {k: str(v).strip() for k, v in (data.changes or {}).items() if k in EDITABLE_FIELDS and str(v or "").strip() != str(emp.get(k) or "").strip()}
    if not changes:
        raise HTTPException(status_code=400, detail="لا توجد تغييرات فعلية على البيانات")
    if await db.hr_profile_requests.count_documents({"employee_id": str(emp["_id"]), "status": "pending"}):
        raise HTTPException(status_code=400, detail="لديك طلب تعديل معلّق — انتظر قراره أو ألغِه أولاً")
    doc = {"employee_id": str(emp["_id"]), "changes": changes, "old_values": {k: emp.get(k) or "" for k in changes}, "note": data.note.strip(), "status": "pending",
           "requested_by": current_user["id"], "created_at": _now()}
    r = await db.hr_profile_requests.insert_one(doc)
    labels = "، ".join(EDITABLE_FIELDS[k] for k in changes)
    await notify_users(db, await hr_manager_user_ids(db, P_MANAGE), "طلب تعديل بيانات موظف", f"{emp.get('full_name', '')} يطلب تعديل: {labels}", "hr_profile", {"request_id": str(r.inserted_id)})
    return {"message": "تم إرسال طلب التعديل — سيُحفظ بعد اعتماد شؤون الموظفين", "id": str(r.inserted_id)}


@router.post("/{rid}/cancel")
async def cancel_request(rid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    r = await _load(db, rid)
    emp = await find_my_employee(db, current_user)
    if not (emp and str(emp["_id"]) == r["employee_id"]) and not _can_view(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح")
    if r["status"] != "pending":
        raise HTTPException(status_code=400, detail="لا يمكن إلغاء طلب تم البت فيه")
    await db.hr_profile_requests.update_one({"_id": r["_id"]}, {"$set": {"status": "cancelled", "decided_at": _now()}})
    return {"message": "تم إلغاء الطلب"}


@router.get("")
async def list_requests(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if not _can_view(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح")
    db = get_db()
    q = {"status": {"$in": status.split(",")}} if status else {}
    items = [_view(r) for r in await db.hr_profile_requests.find(q).sort("created_at", -1).to_list(500)]
    await enrich_employee_refs(db, items)
    return {"items": items, "counts": {s: await db.hr_profile_requests.count_documents({"status": s}) for s in STATUSES}}


@router.post("/{rid}/approve")
async def approve_request(rid: str, data: DecisionIn, current_user: dict = Depends(get_current_user)):
    _guard(current_user, P_MANAGE)
    db = get_db()
    r = await _load(db, rid)
    if r["status"] != "pending":
        raise HTTPException(status_code=400, detail="الطلب ليس معلّقاً")
    changes = {k: str(v).strip() for k, v in (data.changes or r["changes"]).items() if k in EDITABLE_FIELDS}
    if not changes:
        raise HTTPException(status_code=400, detail="لا توجد تغييرات لاعتمادها")
    emp = await db.employees.find_one({"_id": ObjectId(r["employee_id"])})
    if not emp:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    await db.employees.update_one({"_id": emp["_id"]}, {"$set": {**changes, "updated_at": _now()},
                                  "$push": {"history": {"at": _now(), "by": current_user.get("full_name", ""), "action": "profile_request", "changes": changes, "request_id": rid}}})
    await db.hr_profile_requests.update_one({"_id": r["_id"]}, {"$set": {"status": "approved", "changes": changes, "decided_by": current_user["id"], "decided_by_name": current_user.get("full_name", ""), "decided_at": _now(), "decision_note": data.note.strip()}})
    await log_activity(current_user, "hr_profile_request_approve", "employee", r["employee_id"], emp.get("full_name", ""), {"changes": changes})
    uid = (await employee_user_ids(db, [r["employee_id"]])).get(r["employee_id"])
    if uid:
        await notify_users(db, [uid], "تم اعتماد تعديل بياناتك", "حُدِّثت بياناتك في ملفك الإداري: " + "، ".join(EDITABLE_FIELDS[k] for k in changes), "hr_profile", {"request_id": rid})
    return {"message": "تم اعتماد التعديل وحفظه في ملف الموظف"}


@router.post("/{rid}/reject")
async def reject_request(rid: str, data: DecisionIn, current_user: dict = Depends(get_current_user)):
    _guard(current_user, P_MANAGE)
    db = get_db()
    r = await _load(db, rid)
    if r["status"] != "pending":
        raise HTTPException(status_code=400, detail="الطلب ليس معلّقاً")
    if not data.note.strip():
        raise HTTPException(status_code=400, detail="اذكر سبب الرفض")
    await db.hr_profile_requests.update_one({"_id": r["_id"]}, {"$set": {"status": "rejected", "decision_note": data.note.strip(), "decided_by": current_user["id"], "decided_by_name": current_user.get("full_name", ""), "decided_at": _now()}})
    uid = (await employee_user_ids(db, [r["employee_id"]])).get(r["employee_id"])
    if uid:
        await notify_users(db, [uid], "لم يُعتمد طلب تعديل بياناتك", data.note.strip(), "hr_profile", {"request_id": rid})
    return {"message": "تم رفض الطلب"}
