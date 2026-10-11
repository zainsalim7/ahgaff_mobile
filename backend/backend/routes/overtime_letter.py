"""✉️ رفع كشف الساعات الإضافية كخطاب رسمي إلى جهة داخل الجامعة
- قوالب لأربع جهات (رئاسة/نائب أكاديمي، الأمين العام، المالية، شؤون الموظفين) قابلة للتعديل.
- يُنشئ مسودة في نظام الخطابات بجدول ملخص (سطر لكل أستاذ) ويرفق PDF الكشف + Excel المستحقات (GridFS).
- ربط عكسي: الفترة المرفوعة تُسجَّل ولا تُرفع مرة أخرى إلا كـ«إلحاق/تعديل».
- منع التكرار على مستوى الأستاذ: كل خطاب يحفظ قائمة أساتذته (linked_report.teachers_list)؛ قبل الرفع تُفحص فترات متداخلة
  لكل أستاذ في خطابات غير ملغاة (مسودة أو صادرة) → استبعاد أو إدراج بوسم «سبق رفعه».
- سجل خطابات الكشوف (/reports/teacher-workload/letters) لمن له صلاحية تقرير النصاب فقط.
"""
import io
import html
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from .deps import get_db, get_current_user, has_permission
from .teacher_overtime import compute_workload, select_teachers, parse_period, build_sheet_pdf, build_sheet_excel, _issuer
from models.permissions import UserRole, Permission

router = APIRouter(tags=["التقارير - رفع الكشف كخطاب"])
SETTINGS_KEY = "overtime_letter_templates"
BUCKET = "letter_attachments"

DEFAULT_TEMPLATES = [
    {"key": "presidency", "name": "رفع للاعتماد — رئاسة الجامعة / نائب الرئيس للشؤون الأكاديمية", "recipient_title": "نائب رئيس الجامعة للشؤون الأكاديمية",
     "subject": "رفع كشف الساعات الإضافية للأساتذة — {الكلية} — {الفترة}",
     "body": "<p>نرفع لسعادتكم كشف الساعات الإضافية للأساتذة بـ{الكلية} للفترة من {من} إلى {إلى} ({الأسابيع} أسابيع)، وقد بلغ عدد الأساتذة المشمولين {عدد_الأساتذة} أستاذاً، بإجمالي ساعات إضافية قدرها {إجمالي_الإضافية} ساعة{جملة_المستحق}، وذلك وفق سياسة احتساب الساعات الإضافية المعتمدة.</p>{جدول}<p>راجين التكرم بالاطلاع والاعتماد، وإحالته إلى الإدارة المالية لاستكمال إجراءات الصرف.</p>"},
    {"key": "secretary_general", "name": "رفع للاعتماد — الأمين العام", "recipient_title": "الأمين العام للجامعة",
     "subject": "رفع كشف الساعات الإضافية للأساتذة — {الكلية} — {الفترة}",
     "body": "<p>نرفع لسعادتكم كشف الساعات الإضافية للأساتذة بـ{الكلية} للفترة من {من} إلى {إلى} ({الأسابيع} أسابيع)، وعدد الأساتذة {عدد_الأساتذة}، بإجمالي ساعات إضافية {إجمالي_الإضافية} ساعة{جملة_المستحق}.</p>{جدول}<p>راجين التكرم بالاعتماد والتوجيه بما ترونه مناسباً.</p>"},
    {"key": "finance", "name": "إحالة للصرف — الإدارة المالية", "recipient_title": "مدير الإدارة المالية",
     "subject": "إحالة كشف مستحقات الساعات الإضافية للأساتذة — {الكلية} — {الفترة}",
     "body": "<p>نحيل إليكم كشف الساعات الإضافية للأساتذة بـ{الكلية} للفترة من {من} إلى {إلى}، المعتمد من الجهة المختصة، لاستكمال إجراءات صرف المستحقات؛ وعدد الأساتذة {عدد_الأساتذة}، بإجمالي ساعات إضافية {إجمالي_الإضافية} ساعة{جملة_المستحق}.</p>{جدول}<p>مرفق كشف تفصيلي بالمقررات وورقة المستحقات المالية. وتفضلوا بقبول فائق الاحترام.</p>"},
    {"key": "hr", "name": "للعلم والإحاطة — شؤون الموظفين", "recipient_title": "مدير إدارة شؤون الموظفين",
     "subject": "إفادة بالساعات الإضافية للأساتذة — {الكلية} — {الفترة}",
     "body": "<p>نفيدكم للعلم والإحاطة بكشف الساعات الإضافية للأساتذة بـ{الكلية} للفترة من {من} إلى {إلى} ({الأسابيع} أسابيع)، وعدد الأساتذة {عدد_الأساتذة}، بإجمالي ساعات إضافية {إجمالي_الإضافية} ساعة.</p>{جدول}<p>للعلم وحفظ نسخة في ملفات الأساتذة.</p>"},
]


class RaiseIn(BaseModel):
    template_key: str
    start_date: str
    end_date: str
    faculty_id: Optional[str] = None
    department_id: Optional[str] = None
    teacher_id: Optional[str] = None
    hide_empty: bool = True
    only_overtime: bool = False
    recipient: dict
    extra_note: Optional[str] = ""
    mode: str = "new"  # new | amend
    base_url: Optional[str] = ""
    exclude_teacher_ids: List[str] = []   # أساتذة يُستبعدون من الخطاب (سبق رفعهم)
    tag_previous: bool = False            # إدراج من سبق رفعهم مع وسم بدل استبعادهم


def _fs(db):
    return AsyncIOMotorGridFSBucket(db, bucket_name=BUCKET)


def _period_key(d: RaiseIn) -> str:
    return f"{d.start_date}|{d.end_date}|{d.faculty_id or ''}|{d.department_id or ''}|{d.teacher_id or ''}"


async def _templates(db) -> List[dict]:
    doc = await db.app_settings.find_one({"key": SETTINGS_KEY}) or {}
    saved = {t["key"]: t for t in (doc.get("templates") or [])}
    return [{**t, **{k: v for k, v in saved.get(t["key"], {}).items() if k in ("name", "recipient_title", "subject", "body")}} for t in DEFAULT_TEMPLATES]


@router.get("/reports/teacher-workload/letter-templates")
async def get_templates(current_user: dict = Depends(get_current_user)):
    return {"templates": await _templates(get_db()), "variables": ["{الكلية}", "{من}", "{إلى}", "{الفترة}", "{الأسابيع}", "{عدد_الأساتذة}", "{إجمالي_الإضافية}", "{إجمالي_المستحق}", "{جملة_المستحق}", "{جدول}"],
            "can_edit": has_permission(current_user, "manage_letter_settings")}


@router.put("/reports/teacher-workload/letter-templates")
async def put_templates(data: dict, current_user: dict = Depends(get_current_user)):
    if not has_permission(current_user, "manage_letter_settings"):
        raise HTTPException(status_code=403, detail="تحتاج صلاحية إعدادات الخطابات")
    tpls = [{k: str(t.get(k, "")) for k in ("key", "name", "recipient_title", "subject", "body")} for t in (data.get("templates") or []) if t.get("key")]
    await get_db().app_settings.update_one({"key": SETTINGS_KEY}, {"$set": {"templates": tpls, "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return {"message": "تم حفظ قوالب خطاب الساعات الإضافية", "templates": await _templates(get_db())}


def _summary_table(report: dict) -> dict:
    """جدول ملخص (سطر لكل أستاذ) بصيغة جدول الخطابات {headers, rows} — يُعرض مكان {جدول_الأسماء}"""
    rows = []
    for i, t in enumerate(report["teachers"], 1):
        s = t["summary"]
        name = t["teacher_name"] + (f" (سبق رفعه بالخطاب {t['prev_letter']})" if t.get("prev_letter") else "")
        rows.append([str(i), name, t.get("academic_title") or "—", t.get("department_name") or "—", f"{max(0.0, s['overtime_hours']):g}"])
    rows.append(["", "الإجمالي", "", "", f"{report['summary']['total_overtime_hours']:g}"])
    return {"headers": ["م", "اسم الأستاذ", "الدرجة / الصفة الأكاديمية", "القسم", "الساعات الإضافية"], "rows": rows}


@router.get("/reports/teacher-workload/letter-status")
async def letter_status(start_date: str, end_date: str, faculty_id: Optional[str] = None, department_id: Optional[str] = None, teacher_id: Optional[str] = None,
                        current_user: dict = Depends(get_current_user)):
    """الخطابات المرفوعة لهذه الفترة (للشارة في الكشف)"""
    db = get_db()
    key = f"{start_date}|{end_date}|{faculty_id or ''}|{department_id or ''}|{teacher_id or ''}"
    out = []
    async for ln in db.overtime_letter_links.find({"period_key": key}).sort("created_at", -1):
        lt = await db.letters.find_one({"_id": ObjectId(ln["letter_id"])}, {"number_display": 1, "status": 1, "is_revoked": 1, "issued_at": 1, "recipient": 1, "subject": 1})
        if not lt:
            continue
        out.append({"letter_id": ln["letter_id"], "mode": ln.get("mode", "new"), "template_key": ln.get("template_key"), "created_at": ln.get("created_at"),
                    "number": lt.get("number_display"), "status": "revoked" if lt.get("is_revoked") else lt.get("status"), "issued_at": lt.get("issued_at"),
                    "recipient": (lt.get("recipient") or {}).get("title") or (lt.get("recipient") or {}).get("name"), "subject": lt.get("subject")})
    active = [o for o in out if o["status"] != "revoked"]
    return {"items": out, "has_active": bool(active)}


def _can_register(user: dict) -> bool:
    return user.get("role") == UserRole.ADMIN or has_permission(user, Permission.REPORT_TEACHER_WORKLOAD) or has_permission(user, Permission.MANAGE_SETTINGS)


async def find_raised(db, teacher_ids: List[str], start_date: str, end_date: str, exclude_letter: Optional[str] = None) -> dict:
    """خطابات غير ملغاة (مسودة/صادرة) تشمل هؤلاء الأساتذة في فترة متداخلة → {teacher_id: [letters]}"""
    q = {"linked_report.type": "overtime", "is_revoked": {"$ne": True}, "linked_report.teachers_list.teacher_id": {"$in": teacher_ids},
         "linked_report.start_date": {"$lte": end_date}, "linked_report.end_date": {"$gte": start_date}}
    out: dict = {}
    async for lt in db.letters.find(q, {"number_display": 1, "status": 1, "linked_report": 1, "issued_at": 1, "created_at": 1}).sort("created_at", -1):
        if exclude_letter and str(lt["_id"]) == exclude_letter:
            continue
        lr = lt["linked_report"]
        for te in lr.get("teachers_list", []):
            if te["teacher_id"] in teacher_ids:
                out.setdefault(te["teacher_id"], []).append({"letter_id": str(lt["_id"]), "number": lt.get("number_display"), "status": lt.get("status"),
                                                             "start_date": lr["start_date"], "end_date": lr["end_date"], "overtime_hours": te.get("overtime_hours"),
                                                             "same_period": lr["start_date"] == start_date and lr["end_date"] == end_date})
    return out


@router.get("/reports/teacher-workload/raised")
async def raised_teachers(start_date: str, end_date: str, faculty_id: Optional[str] = None, department_id: Optional[str] = None, teacher_id: Optional[str] = None,
                          current_user: dict = Depends(get_current_user)):
    """لكل أستاذ في النطاق: الخطابات (غير الملغاة) التي سبق رفعه فيها عن فترة متداخلة — للشارات ونافذة الرفع"""
    db = get_db()
    teachers = await select_teachers(db, current_user, teacher_id, faculty_id, department_id)
    ids = [str(t["_id"]) for t in teachers]
    raised = await find_raised(db, ids, start_date, end_date)
    names = {str(t["_id"]): t.get("full_name", "") for t in teachers}
    return {"items": [{"teacher_id": tid, "teacher_name": names.get(tid, ""), "letters": ls} for tid, ls in raised.items()], "count": len(raised)}


@router.get("/reports/teacher-workload/letters")
async def overtime_letters_register(q: Optional[str] = None, teacher_id: Optional[str] = None, status: Optional[str] = None, year: Optional[int] = None,
                                    current_user: dict = Depends(get_current_user)):
    """📒 سجل خطابات كشوف الساعات الإضافية — لمن له صلاحية تقرير النصاب (حسب نطاق كليته)"""
    if not _can_register(current_user):
        raise HTTPException(status_code=403, detail="غير مصرح لك — تحتاج صلاحية تقرير نصاب المدرسين")
    db = get_db()
    f: dict = {"linked_report.type": "overtime"}
    if not (current_user.get("role") == UserRole.ADMIN or has_permission(current_user, Permission.MANAGE_SETTINGS)):
        f["linked_report.faculty_id"] = current_user.get("faculty_id") or "__none__"
    if teacher_id:
        f["linked_report.teachers_list.teacher_id"] = teacher_id
    if status == "revoked":
        f["is_revoked"] = True
    elif status:
        f["status"] = status; f["is_revoked"] = {"$ne": True}
    if year:
        f["linked_report.start_date"] = {"$regex": f"^{year}-"}
    fac = {str(x["_id"]): x["name"] for x in await db.faculties.find({}, {"name": 1}).to_list(200)}
    dep = {str(x["_id"]): x["name"] for x in await db.departments.find({}, {"name": 1}).to_list(1000)}
    rows = []
    async for lt in db.letters.find(f).sort("created_at", -1).limit(500):
        lr = lt["linked_report"]
        tl = lr.get("teachers_list", [])
        if q and not (q in (lt.get("number_display") or "") or q in (lt.get("subject") or "") or any(q in (te.get("name") or "") for te in tl)):
            continue
        rows.append({"letter_id": str(lt["_id"]), "number": lt.get("number_display"), "draft_number": lt.get("draft_number"),
                     "status": "revoked" if lt.get("is_revoked") else lt.get("status"), "mode": "amend" if "تعديلي" in (lt.get("subject") or "") else "new",
                     "subject": lt.get("subject"), "recipient": (lt.get("recipient") or {}).get("title") or (lt.get("recipient") or {}).get("name"),
                     "start_date": lr.get("start_date"), "end_date": lr.get("end_date"),
                     "scope": (dep.get(lr.get("department_id")) if lr.get("department_id") else None) or (fac.get(lr.get("faculty_id")) if lr.get("faculty_id") else None) or "الجامعة",
                     "teachers": lr.get("teachers") or len(tl), "overtime_hours": lr.get("overtime_hours"), "amount": lr.get("amount"),
                     "excluded": len(lr.get("excluded") or []), "teachers_list": tl,
                     "created_at": lt.get("created_at"), "created_by": lt.get("created_by_name") or lt.get("issued_by_name") or "", "issued_at": lt.get("issued_at"),
                     "attachments": len(lt.get("attachments") or [])})
    return {"items": rows, "count": len(rows)}


async def rebuild_overtime_table(db, current_user: dict, lt: dict):
    """إعادة توليد جدول الأسماء لخطاب مرتبط بكشف الساعات الإضافية (بعد فقده عند تعديل المسودة)"""
    lr = lt.get("linked_report") or {}
    if lr.get("type") != "overtime":
        return None
    start, end = parse_period(lr["start_date"], lr["end_date"])
    report = await compute_workload(db, await select_teachers(db, current_user, None, lr.get("faculty_id"), lr.get("department_id")), start, end, True, bool(lr.get("only_overtime")), set(lr.get("excluded") or []))
    prev = {te["teacher_id"]: te.get("prev_letter") for te in lr.get("teachers_list", []) if te.get("prev_letter")}
    for t in report["teachers"]:
        if t["teacher_db_id"] in prev:
            t["prev_letter"] = prev[t["teacher_db_id"]]
    return _summary_table(report) if report["teachers"] else None


@router.post("/reports/teacher-workload/raise-letter")
async def raise_letter(data: RaiseIn, current_user: dict = Depends(get_current_user)):
    """✉️ إنشاء مسودة خطاب رسمي بالكشف + المرفقات (PDF الكشف، Excel المستحقات)"""
    from .letters import _guard as letters_guard, save_draft, IssueIn
    letters_guard(current_user)
    db = get_db()
    tpl = next((t for t in await _templates(db) if t["key"] == data.template_key), None)
    if not tpl:
        raise HTTPException(status_code=404, detail="القالب غير موجود")
    key = _period_key(data)
    existing = await db.overtime_letter_links.find({"period_key": key}).to_list(50)
    if existing and data.mode != "amend":
        live = []
        for ln in existing:
            lt = await db.letters.find_one({"_id": ObjectId(ln["letter_id"])}, {"number_display": 1, "is_revoked": 1})
            if lt and not lt.get("is_revoked"):
                live.append(lt["number_display"])
        if live:
            raise HTTPException(status_code=409, detail=f"هذه الفترة مرفوعة مسبقاً بالخطاب {'، '.join(live)} — اختر «إلحاق/تعديل» لإصدار خطاب تعديلي")

    start, end = parse_period(data.start_date, data.end_date)
    exclude = set(data.exclude_teacher_ids or [])
    report = await compute_workload(db, await select_teachers(db, current_user, data.teacher_id, data.faculty_id, data.department_id), start, end, data.hide_empty, data.only_overtime, exclude)
    if not report["teachers"]:
        raise HTTPException(status_code=400, detail="لا يوجد أساتذة في الكشف لهذه الفلاتر (بعد الاستبعاد)")
    raised = await find_raised(db, [t["teacher_db_id"] for t in report["teachers"]], data.start_date, data.end_date)
    if raised and not data.tag_previous:
        names = "، ".join(f"{t['teacher_name']} ({raised[t['teacher_db_id']][0]['number']})" for t in report["teachers"] if t["teacher_db_id"] in raised)
        raise HTTPException(status_code=409, detail=f"سبق رفع {len(raised)} أستاذاً عن فترة متداخلة: {names} — استبعدهم أو اختر إدراجهم بوسم «سبق رفعه»")
    for t in report["teachers"]:
        if t["teacher_db_id"] in raised:
            t["prev_letter"] = raised[t["teacher_db_id"]][0]["number"]
    fac_name = report["teachers"][0].get("faculty_name") if data.faculty_id else "الجامعة"
    if data.department_id:
        fac_name = f"{report['teachers'][0].get('department_name') or ''} — {fac_name}"
    tot = report["summary"]
    cur = next((t["summary"].get("currency") for t in report["teachers"] if t["summary"].get("overtime_amount")), "")
    amount_txt = f"{tot['total_overtime_amount']:,.0f} {cur}" if tot.get("total_overtime_amount") else ""
    period_txt = f"{data.start_date} إلى {data.end_date}"
    vars_ = {"{الكلية}": fac_name or "الجامعة", "{من}": data.start_date, "{إلى}": data.end_date, "{الفترة}": period_txt, "{الأسابيع}": str(report["period"]["total_weeks"]),
             "{عدد_الأساتذة}": str(tot["total_teachers"]), "{إجمالي_الإضافية}": f"{tot['total_overtime_hours']:g}", "{إجمالي_المستحق}": amount_txt,
             "{جملة_المستحق}": f"، وإجمالي مستحقات قدرها {amount_txt}" if amount_txt else "", "{جدول}": "<p>{جدول_الأسماء}</p>"}
    def fill(s: str) -> str:
        for k, v in vars_.items():
            s = s.replace(k, v)
        return s
    subject = fill(tpl["subject"]) + (" — خطاب تعديلي/إلحاقي" if data.mode == "amend" else "")
    body = fill(tpl["body"])
    if data.mode == "amend":
        body = "<p><strong>إلحاقاً لخطابنا السابق بشأن الفترة ذاتها، نرفع لكم الكشف المعدَّل الآتي:</strong></p>" + body
    if (data.extra_note or "").strip():
        body += f"<p>{html.escape(data.extra_note.strip())}</p>"

    issue = IssueIn(subject=subject, body=body, recipient=data.recipient, base_url=data.base_url, notes="أُنشئ تلقائياً من كشف الساعات الإضافية")
    res = await save_draft(issue, current_user)
    lid = res["id"]

    issuer = await _issuer(db, current_user)
    fs = _fs(db)
    atts = []
    pdf_buf = build_sheet_pdf(report, issuer, current_user.get("full_name", ""))
    for fname, content, ctype in ((f"كشف الساعات الإضافية {data.start_date} - {data.end_date}.pdf", pdf_buf.getvalue(), "application/pdf"),
                                  (f"مستحقات الساعات الإضافية {data.start_date} - {data.end_date}.xlsx", build_sheet_excel(report, issuer).getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")):
        fid = await fs.upload_from_stream(fname, content, metadata={"letter_id": lid, "content_type": ctype})
        atts.append({"id": str(fid), "filename": fname, "content_type": ctype, "size": len(content)})
    teachers_list = [{"teacher_id": t["teacher_db_id"], "name": t["teacher_name"], "department_name": t.get("department_name"), "overtime_hours": round(max(0.0, t["summary"]["overtime_hours"]), 2),
                      "amount": t["summary"].get("overtime_amount"), "prev_letter": t.get("prev_letter")} for t in report["teachers"]]
    await db.letters.update_one({"_id": ObjectId(lid)}, {"$set": {"attachments": atts, "table": _summary_table(report), "custom_table": True, "created_by_name": current_user.get("full_name", ""),
                                                                 "linked_report": {"type": "overtime", "period_key": key, "start_date": data.start_date, "end_date": data.end_date, "only_overtime": data.only_overtime,
                                                                                   "faculty_id": data.faculty_id, "department_id": data.department_id, "teachers": tot["total_teachers"],
                                                                                   "overtime_hours": tot["total_overtime_hours"], "amount": tot.get("total_overtime_amount"),
                                                                                   "teachers_list": teachers_list, "excluded": sorted(exclude)}}})
    await db.overtime_letter_links.insert_one({"period_key": key, "letter_id": lid, "mode": data.mode, "template_key": data.template_key,
                                               "created_at": datetime.now(timezone.utc).isoformat(), "created_by": current_user.get("full_name", "")})
    msg = f"أُنشئت مسودة الخطاب {res['number']} بمرفقين — أكملها واعتمدها من نظام الخطابات"
    if exclude:
        msg += f" · استُبعد {len(exclude)} أستاذاً سبق رفعهم"
    if raised:
        msg += f" · {len(raised)} أستاذاً أُدرجوا بوسم «سبق رفعه»"
    return {"letter_id": lid, "number": res["number"], "status": "draft", "attachments": atts, "excluded": len(exclude), "tagged": len(raised), "message": msg}


@router.get("/letters/{lid}/attachments/{aid}")
async def download_attachment(lid: str, aid: str, current_user: dict = Depends(get_current_user)):
    from .letters import _guard as letters_guard, _load_visible
    letters_guard(current_user)
    db = get_db()
    lt = await _load_visible(db, current_user, lid)
    att = next((a for a in (lt.get("attachments") or []) if a["id"] == aid), None)
    if not att:
        raise HTTPException(status_code=404, detail="المرفق غير موجود")
    stream = await _fs(db).open_download_stream(ObjectId(aid))
    data = await stream.read()
    from urllib.parse import quote
    fname = quote(att["filename"])
    return StreamingResponse(io.BytesIO(data), media_type=att["content_type"], headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}", "X-Filename": fname})


@router.get("/letters/{lid}/pdf-with-attachments")
async def pdf_with_attachments(lid: str, current_user: dict = Depends(get_current_user)):
    """📎 خطاب + مرفقات PDF في ملف واحد"""
    from .letters import _guard as letters_guard, _load_visible, _letter_settings
    from services.letter_pdf import build_letter_pdf
    from pypdf import PdfWriter, PdfReader
    letters_guard(current_user)
    db = get_db()
    lt = await _load_visible(db, current_user, lid)
    settings = await _letter_settings(db, current_user, lt)
    w = PdfWriter()
    w.append(PdfReader(io.BytesIO(build_letter_pdf(lt, settings, draft=lt.get("status") == "draft", letterhead=True))))
    for a in lt.get("attachments") or []:
        if a["content_type"] == "application/pdf":
            s = await _fs(db).open_download_stream(ObjectId(a["id"]))
            w.append(PdfReader(io.BytesIO(await s.read())))
    out = io.BytesIO(); w.write(out); out.seek(0)
    from urllib.parse import quote
    fname = quote(f"{lt.get('number_display', 'خطاب')} مع المرفقات.pdf")
    return StreamingResponse(out, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}", "X-Filename": fname})
