"""
نظام تبرير غياب الأستاذ عن المحاضرات
Teacher Absence Justification — self-contained router
"""
import os
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Request
from fastapi.responses import StreamingResponse
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
YEMEN_TIMEZONE = timezone(timedelta(hours=3))
JUSTIFY_WINDOW_HOURS = int(os.environ.get("ABSENCE_JUSTIFY_WINDOW_HOURS", "72"))
MAX_ATTACHMENTS = 3
MAX_FILE_SIZE = 5 * 1024 * 1024
ALLOWED_MIME = {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/jpg"}
STATUS_ABSENT = "absent"
STATUS_ABSENT_EXCUSED = "absent_excused"
EXCUSE_TYPES = {
    "sick": "مرضي",
    "official_duty": "تكليف رسمي / مهمة عمل",
    "scientific": "مشاركة علمية",
    "emergency": "ظرف طارئ",
    "other": "أخرى",
}
REQUEST_STATUS_LABELS = {
    "pending": "قيد المراجعة",
    "approved": "مقبول",
    "rejected": "مرفوض",
    "needs_info": "مطلوب استكمال",
}
REVIEWER_ROLES = {"admin", "dean", "department_head"}
def build_router(db, get_current_user, send_push_many=None, user_from_token=None) -> APIRouter:
    router = APIRouter(prefix="/absence-justifications", tags=["absence-justifications"])
    fs = AsyncIOMotorGridFSBucket(db, bucket_name="absence_justification_files")
    def now():
        return datetime.now(YEMEN_TIMEZONE)
    def lecture_end_dt(lec: dict) -> Optional[datetime]:
        try:
            return datetime.strptime(f"{lec['date']} {lec['end_time']}", "%Y-%m-%d %H:%M").replace(tzinfo=YEMEN_TIMEZONE)
        except Exception:
            return None
    def deadline_of(lec: dict) -> Optional[datetime]:
        end = lecture_end_dt(lec)
        return end + timedelta(hours=JUSTIFY_WINDOW_HOURS) if end else None
    async def teacher_context(user: dict) -> dict:
        """إرجاع teacher_record_id + department/faculty للأستاذ الحالي"""
        user_doc = await db.users.find_one({"_id": ObjectId(user["id"])}) or {}
        teacher_record_id = user_doc.get("teacher_record_id")
        teacher = None
        if teacher_record_id:
            teacher = await db.teachers.find_one({"_id": ObjectId(teacher_record_id)})
        if not teacher:
            teacher = await db.teachers.find_one({"user_id": user["id"]})
            if teacher:
                teacher_record_id = str(teacher["_id"])
        department_id = (teacher or {}).get("department_id") or user_doc.get("department_id")
        faculty_id = user_doc.get("faculty_id")
        if department_id and not faculty_id:
            dept = await db.departments.find_one({"_id": ObjectId(department_id)})
            faculty_id = (dept or {}).get("faculty_id")
        return {
            "teacher_record_id": teacher_record_id,
            "teacher_name": (teacher or {}).get("full_name") or user_doc.get("full_name", ""),
            "department_id": department_id,
            "faculty_id": faculty_id,
        }
    async def teacher_courses(user: dict, ctx: dict, course_id: Optional[str] = None) -> dict:
        """مقررات الأستاذ: كمدرس أساسي أو كقائد مجموعة (groups[].teacher_id). `_group_keys` = مجموعاته إن كان قائد مجموعة فقط"""
        ids = [i for i in [ctx.get("teacher_record_id"), user["id"]] if i]
        q = {"$or": [{"teacher_id": {"$in": ids}}, {"groups.teacher_id": {"$in": ids}}]}
        if course_id:
            q["_id"] = ObjectId(course_id)
        courses = await db.courses.find(q).to_list(500)
        result = {}
        for c in courses:
            keys = [g.get("key") for g in (c.get("groups") or []) if g.get("teacher_id") in ids]
            c["_group_keys"] = keys if c.get("teacher_id") not in ids else []
            result[str(c["_id"])] = c
        return result

    def lecture_in_scope(lec: dict, course: dict, group: Optional[str] = None) -> bool:
        if group and (lec.get("group") or "") != group:
            return False
        keys = course.get("_group_keys") or []
        return not keys or (lec.get("group") or "") in keys
    def serialize(doc: dict) -> dict:
        return {
            "id": str(doc["_id"]),
            "ref_no": doc.get("ref_no"),
            "status": doc.get("status"),
            "status_label": REQUEST_STATUS_LABELS.get(doc.get("status"), doc.get("status")),
            "excuse_type": doc.get("excuse_type"),
            "excuse_type_label": EXCUSE_TYPES.get(doc.get("excuse_type"), doc.get("excuse_type")),
            "description": doc.get("description", ""),
            "lectures": doc.get("lectures", []),
            "lecture_ids": doc.get("lecture_ids", []),
            "attachments": [
                {"id": a["id"], "name": a["name"], "size": a.get("size"), "mime": a.get("mime")}
                for a in doc.get("attachments", [])
            ],
            "teacher_name": doc.get("teacher_name"),
            "department_id": doc.get("department_id"),
            "department_name": doc.get("department_name"),
            "faculty_id": doc.get("faculty_id"),
            "decision_note": doc.get("decision_note", ""),
            "decided_by_name": doc.get("decided_by_name"),
            "decided_at": doc.get("decided_at"),
            "resubmit_count": doc.get("resubmit_count", 0),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
        }
    async def notify_users(user_ids: List[str], title: str, message: str, data: dict):
        user_ids = [u for u in set(user_ids) if u]
        if not user_ids:
            return
        ts = now().isoformat()
        await db.notifications.insert_many([{
            "user_id": uid, "title": title, "message": message, "type": "absence_justification",
            "data": data, "is_read": False, "created_at": ts,
        } for uid in user_ids])
        if send_push_many:
            try:
                docs = await db.fcm_tokens.find({"user_id": {"$in": user_ids}}).to_list(2000)
                tokens = [d["token"] for d in docs if d.get("token")]
                if tokens:
                    await send_push_many(tokens, title, message, data)
            except Exception as e:
                logging.warning(f"push failed: {e}")
    async def reviewer_user_ids(department_id: Optional[str], faculty_id: Optional[str]) -> List[str]:
        q = {"$or": []}
        if department_id:
            q["$or"].append({"role": "department_head", "$or": [{"department_id": department_id}, {"department_ids": department_id}]})
        if faculty_id:
            q["$or"].append({"role": "dean", "faculty_id": faculty_id})
        if not q["$or"]:
            return []
        users = await db.users.find(q, {"_id": 1}).to_list(50)
        return [str(u["_id"]) for u in users]
    # ---------------- Teacher endpoints ----------------
    @router.get("/meta")
    async def meta(current_user: dict = Depends(get_current_user)):
        return {
            "excuse_types": [{"key": k, "label": v} for k, v in EXCUSE_TYPES.items()],
            "window_hours": JUSTIFY_WINDOW_HOURS,
            "max_attachments": MAX_ATTACHMENTS,
            "max_file_size": MAX_FILE_SIZE,
        }
    @router.get("/absent-lectures")
    async def absent_lectures(course_id: Optional[str] = None, group: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        """محاضرات الأستاذ ذات حالة غائب / غائب بعذر مع حالة التبرير والمهلة"""
        ctx = await teacher_context(current_user)
        courses = await teacher_courses(current_user, ctx, course_id)
        if not courses:
            return {"items": [], "window_hours": JUSTIFY_WINDOW_HOURS, "justifiable_count": 0}
        lectures = await db.lectures.find({
            "course_id": {"$in": list(courses.keys())},
            "status": {"$in": [STATUS_ABSENT, STATUS_ABSENT_EXCUSED]},
        }).sort([("date", -1), ("start_time", -1)]).to_list(1000)
        lectures = [l for l in lectures if lecture_in_scope(l, courses.get(l["course_id"], {}), group)]
        lecture_ids = [str(l["_id"]) for l in lectures]
        requests = await db.absence_justifications.find({
            "lecture_ids": {"$in": lecture_ids},
            "status": {"$in": ["pending", "approved", "needs_info", "rejected"]},
        }).sort("created_at", -1).to_list(1000)
        req_by_lecture = {}
        for r in requests:
            for lid in r.get("lecture_ids", []):
                if lid not in req_by_lecture:
                    req_by_lecture[lid] = r
        current = now()
        items, justifiable = [], 0
        for lec in lectures:
            lid = str(lec["_id"])
            course = courses.get(lec["course_id"], {})
            dl = deadline_of(lec)
            req = req_by_lecture.get(lid)
            locked_reason = None
            if lec.get("status") == STATUS_ABSENT_EXCUSED or (req and req["status"] == "approved"):
                locked_reason = "approved"
            elif req and req["status"] in ("pending", "needs_info"):
                locked_reason = req["status"]
            elif req and req["status"] == "rejected" and req.get("resubmit_count", 0) >= 1:
                locked_reason = "rejected_final"
            elif dl and current > dl:
                locked_reason = "expired"
            can_justify = locked_reason is None
            if can_justify:
                justifiable += 1
            items.append({
                "id": lid,
                "course_id": lec["course_id"],
                "course_name": course.get("name", ""),
                "level": course.get("level"),
                "section": course.get("section"),
                "date": lec["date"],
                "start_time": lec["start_time"],
                "end_time": lec["end_time"],
                "room": lec.get("room", ""),
                "group": lec.get("group"),
                "status": lec.get("status"),
                "deadline_at": dl.isoformat() if dl else None,
                "remaining_seconds": max(0, int((dl - current).total_seconds())) if dl else None,
                "can_justify": can_justify,
                "locked_reason": locked_reason,
                "justification": {
                    "id": str(req["_id"]), "ref_no": req.get("ref_no"), "status": req["status"],
                    "status_label": REQUEST_STATUS_LABELS.get(req["status"]),
                    "excuse_type_label": EXCUSE_TYPES.get(req.get("excuse_type")),
                } if req else None,
            })
        return {"items": items, "window_hours": JUSTIFY_WINDOW_HOURS, "justifiable_count": justifiable}
    async def save_uploads(files: List[UploadFile]) -> list:
        if not files or len(files) == 0:
            raise HTTPException(status_code=400, detail="المرفق إلزامي — أرفق ملفاً واحداً على الأقل")
        if len(files) > MAX_ATTACHMENTS:
            raise HTTPException(status_code=400, detail=f"الحد الأقصى {MAX_ATTACHMENTS} مرفقات")
        saved = []
        for f in files:
            content = await f.read()
            if len(content) > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail=f"حجم الملف {f.filename} يتجاوز 5 ميجابايت")
            mime = (f.content_type or "").lower()
            if mime not in ALLOWED_MIME:
                raise HTTPException(status_code=400, detail="نوع الملف غير مسموح (PDF أو صور فقط)")
            name = f.filename or ("attachment.pdf" if mime == "application/pdf" else "attachment.jpg")
            file_id = await fs.upload_from_stream(name, content, metadata={"mime": mime})
            saved.append({"id": str(file_id), "name": name, "size": len(content), "mime": mime})
        return saved
    @router.post("")
    async def create_request(
        lecture_ids: str = Form(...),
        excuse_type: str = Form(...),
        description: str = Form(""),
        files: List[UploadFile] = File(...),
        current_user: dict = Depends(get_current_user),
    ):
        """تقديم طلب تبرير (يغطي محاضرة واحدة أو أكثر) مع مرفقات إلزامية"""
        try:
            ids = json.loads(lecture_ids) if lecture_ids.strip().startswith("[") else [i for i in lecture_ids.split(",") if i.strip()]
        except Exception:
            raise HTTPException(status_code=400, detail="صيغة المحاضرات غير صالحة")
        ids = list(dict.fromkeys([str(i).strip() for i in ids]))
        if not ids:
            raise HTTPException(status_code=400, detail="اختر محاضرة واحدة على الأقل")
        if excuse_type not in EXCUSE_TYPES:
            raise HTTPException(status_code=400, detail="نوع العذر غير صالح")
        description = (description or "").strip()
        if excuse_type == "other" and len(description) < 20:
            raise HTTPException(status_code=400, detail="عند اختيار (أخرى) يجب كتابة وصف لا يقل عن 20 حرفاً")
        if not description:
            raise HTTPException(status_code=400, detail="الوصف إلزامي")
        ctx = await teacher_context(current_user)
        courses = await teacher_courses(current_user, ctx)
        lectures = await db.lectures.find({"_id": {"$in": [ObjectId(i) for i in ids]}}).to_list(100)
        if len(lectures) != len(ids):
            raise HTTPException(status_code=404, detail="إحدى المحاضرات غير موجودة")
        current = now()
        for lec in lectures:
            if lec["course_id"] not in courses or not lecture_in_scope(lec, courses[lec["course_id"]]):
                raise HTTPException(status_code=403, detail="إحدى المحاضرات لا تخصك")
            if lec.get("status") != STATUS_ABSENT:
                raise HTTPException(status_code=400, detail=f"محاضرة {lec['date']} ليست بحالة غائب")
            dl = deadline_of(lec)
            if dl and current > dl:
                raise HTTPException(status_code=400, detail=f"انتهت مهلة التبرير لمحاضرة {lec['date']}")
        existing = await db.absence_justifications.find({
            "lecture_ids": {"$in": ids}, "status": {"$in": ["pending", "approved", "needs_info"]},
        }).to_list(50)
        if existing:
            raise HTTPException(status_code=400, detail="يوجد طلب قائم لإحدى هذه المحاضرات")
        rejected = await db.absence_justifications.find({"lecture_ids": {"$in": ids}, "status": "rejected"}).to_list(50)
        resubmit_count = 0
        if rejected:
            if any(r.get("resubmit_count", 0) >= 1 for r in rejected):
                raise HTTPException(status_code=400, detail="لا يمكن إعادة التقديم أكثر من مرة بعد الرفض")
            resubmit_count = 1
        attachments = await save_uploads(files)
        department_id = ctx["department_id"]
        if not department_id:
            department_id = (courses.get(lectures[0]["course_id"]) or {}).get("department_id")
        dept = await db.departments.find_one({"_id": ObjectId(department_id)}) if department_id else None
        faculty_id = ctx["faculty_id"] or (dept or {}).get("faculty_id")
        seq = await db.absence_justifications.count_documents({}) + 1
        doc = {
            "ref_no": f"AJ-{current.year}-{seq:04d}",
            "user_id": current_user["id"],
            "teacher_record_id": ctx["teacher_record_id"],
            "teacher_name": ctx["teacher_name"],
            "department_id": department_id,
            "department_name": (dept or {}).get("name"),
            "faculty_id": faculty_id,
            "course_ids": list({l["course_id"] for l in lectures}),
            "lecture_ids": ids,
            "lectures": [{
                "id": str(l["_id"]), "course_id": l["course_id"],
                "course_name": (courses.get(l["course_id"]) or {}).get("name", ""),
                "date": l["date"], "start_time": l["start_time"], "end_time": l["end_time"], "room": l.get("room", ""), "group": l.get("group"),
            } for l in lectures],
            "excuse_type": excuse_type,
            "description": description,
            "attachments": attachments,
            "status": "pending",
            "resubmit_count": resubmit_count,
            "decision_note": "",
            "decided_by": None, "decided_by_name": None, "decided_at": None,
            "created_at": current.isoformat(),
            "updated_at": current.isoformat(),
        }
        res = await db.absence_justifications.insert_one(doc)
        doc["_id"] = res.inserted_id
        reviewers = await reviewer_user_ids(department_id, faculty_id)
        await notify_users(
            reviewers,
            "طلب تبرير غياب جديد",
            f"{ctx['teacher_name']} قدّم طلب تبرير غياب ({EXCUSE_TYPES[excuse_type]}) لعدد {len(ids)} محاضرة",
            {"type": "absence_justification", "id": str(res.inserted_id)},
        )
        return {"message": "تم إرسال الطلب إلى إدارة القسم", "request": serialize(doc)}
    @router.get("/my")
    async def my_requests(current_user: dict = Depends(get_current_user)):
        docs = await db.absence_justifications.find({"user_id": current_user["id"]}).sort("created_at", -1).to_list(500)
        items = [serialize(d) for d in docs]
        stats = {"total": len(items)}
        for s in REQUEST_STATUS_LABELS:
            stats[s] = sum(1 for i in items if i["status"] == s)
        return {"items": items, "stats": stats}
    async def can_view(doc: dict, user: dict) -> bool:
        if doc.get("user_id") == user["id"] or user["role"] == "admin":
            return True
        if user["role"] not in REVIEWER_ROLES:
            return False
        u = await db.users.find_one({"_id": ObjectId(user["id"])}) or {}
        if user["role"] == "dean":
            return bool(u.get("faculty_id")) and u.get("faculty_id") == doc.get("faculty_id")
        dept_ids = u.get("department_ids") or ([u["department_id"]] if u.get("department_id") else [])
        return doc.get("department_id") in dept_ids
    @router.post("/{request_id}/attachments")
    async def add_attachments(request_id: str, files: List[UploadFile] = File(...), current_user: dict = Depends(get_current_user)):
        """استكمال المرفقات عند حالة (مطلوب استكمال) — يعيد الطلب إلى قيد المراجعة"""
        doc = await db.absence_justifications.find_one({"_id": ObjectId(request_id)})
        if not doc or doc.get("user_id") != current_user["id"]:
            raise HTTPException(status_code=404, detail="الطلب غير موجود")
        if doc["status"] != "needs_info":
            raise HTTPException(status_code=400, detail="لا يمكن إضافة مرفقات لهذا الطلب في حالته الحالية")
        if len(doc.get("attachments", [])) + len(files) > MAX_ATTACHMENTS + 2:
            raise HTTPException(status_code=400, detail="تجاوزت الحد الأقصى للمرفقات")
        new_atts = await save_uploads(files)
        await db.absence_justifications.update_one({"_id": doc["_id"]}, {
            "$push": {"attachments": {"$each": new_atts}},
            "$set": {"status": "pending", "updated_at": now().isoformat()},
        })
        reviewers = await reviewer_user_ids(doc.get("department_id"), doc.get("faculty_id"))
        await notify_users(reviewers, "استكمال طلب تبرير غياب", f"{doc.get('teacher_name')} أضاف مرفقات للطلب {doc.get('ref_no')}", {"type": "absence_justification", "id": request_id})
        return {"message": "تمت إضافة المرفقات وإعادة الطلب للمراجعة"}
    @router.get("/{request_id}/attachments/{att_id}")
    async def download_attachment(request_id: str, att_id: str, request: Request, token: Optional[str] = None):
        """تحميل مرفق — يقبل Authorization header أو ?token= لفتحه في المتصفح"""
        current_user = None
        auth = request.headers.get("authorization", "")
        raw = auth[7:] if auth.lower().startswith("bearer ") else token
        if raw and user_from_token:
            current_user = await user_from_token(raw)
        if not current_user:
            raise HTTPException(status_code=401, detail="غير مصرح")
        doc = await db.absence_justifications.find_one({"_id": ObjectId(request_id)})
        if not doc or not await can_view(doc, current_user):
            raise HTTPException(status_code=404, detail="المرفق غير موجود")
        att = next((a for a in doc.get("attachments", []) if a["id"] == att_id), None)
        if not att:
            raise HTTPException(status_code=404, detail="المرفق غير موجود")
        try:
            stream = await fs.open_download_stream(ObjectId(att_id))
        except Exception:
            raise HTTPException(status_code=404, detail="المرفق غير موجود")
        content = await stream.read()
        from urllib.parse import quote
        headers = {"Content-Disposition": f"inline; filename*=UTF-8''{quote(att['name'])}"}
        return StreamingResponse(iter([content]), media_type=att.get("mime", "application/octet-stream"), headers=headers)
    # ---------------- Reviewer endpoints ----------------
    @router.get("")
    async def list_requests(status: Optional[str] = None, department_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        if current_user["role"] not in REVIEWER_ROLES:
            raise HTTPException(status_code=403, detail="غير مصرح لك")
        q = {}
        if status:
            q["status"] = {"$in": status.split(",")}
        u = await db.users.find_one({"_id": ObjectId(current_user["id"])}) or {}
        if current_user["role"] == "dean":
            q["faculty_id"] = u.get("faculty_id")
        elif current_user["role"] == "department_head":
            dept_ids = u.get("department_ids") or ([u["department_id"]] if u.get("department_id") else [])
            q["department_id"] = {"$in": dept_ids}
        if department_id:
            q["department_id"] = department_id
        docs = await db.absence_justifications.find(q).sort("created_at", -1).to_list(1000)
        return {"items": [serialize(d) for d in docs]}
    @router.get("/{request_id}")
    async def get_request(request_id: str, current_user: dict = Depends(get_current_user)):
        doc = await db.absence_justifications.find_one({"_id": ObjectId(request_id)})
        if not doc or not await can_view(doc, current_user):
            raise HTTPException(status_code=404, detail="الطلب غير موجود")
        return serialize(doc)
    @router.post("/{request_id}/decide")
    async def decide(request_id: str, request: Request, current_user: dict = Depends(get_current_user)):
        """قرار الإدارة: approved | rejected | needs_info"""
        if current_user["role"] not in REVIEWER_ROLES:
            raise HTTPException(status_code=403, detail="غير مصرح لك")
        body = await request.json()
        decision = body.get("decision")
        note = (body.get("note") or "").strip()
        if decision not in ("approved", "rejected", "needs_info"):
            raise HTTPException(status_code=400, detail="قرار غير صالح")
        if decision in ("rejected", "needs_info") and not note:
            raise HTTPException(status_code=400, detail="يجب كتابة سبب/ملاحظة")
        doc = await db.absence_justifications.find_one({"_id": ObjectId(request_id)})
        if not doc or not await can_view(doc, current_user):
            raise HTTPException(status_code=404, detail="الطلب غير موجود")
        if doc["status"] not in ("pending", "needs_info"):
            raise HTTPException(status_code=400, detail="تم البت في هذا الطلب مسبقاً")
        ts = now().isoformat()
        await db.absence_justifications.update_one({"_id": doc["_id"]}, {"$set": {
            "status": decision, "decision_note": note,
            "decided_by": current_user["id"], "decided_by_name": current_user.get("full_name"),
            "decided_at": ts, "updated_at": ts,
        }})
        if decision == "approved":
            await db.lectures.update_many(
                {"_id": {"$in": [ObjectId(i) for i in doc["lecture_ids"]]}},
                {"$set": {"status": STATUS_ABSENT_EXCUSED, "status_override": True, "excuse_request_id": request_id}},
            )
        titles = {"approved": "تم قبول طلب تبرير الغياب", "rejected": "تم رفض طلب تبرير الغياب", "needs_info": "طلب تبرير الغياب يحتاج استكمالاً"}
        msg = f"الطلب {doc.get('ref_no')}: {REQUEST_STATUS_LABELS[decision]}" + (f" — {note}" if note else "")
        await notify_users([doc["user_id"]], titles[decision], msg, {"type": "absence_justification", "id": request_id})
        return {"message": f"تم تسجيل القرار: {REQUEST_STATUS_LABELS[decision]}"}
    return router
