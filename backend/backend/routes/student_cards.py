"""البطاقة الرقمية للطالب: صورة + QR تحقق عام + قوالب تصميم لكل كلية + اعتماد صور الطلاب.
صلاحية البطاقة: العام الجامعي النشط — تتجدد تلقائياً مع كل عام.
"""
import io
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from bson import ObjectId

from .deps import get_db, get_current_user, log_activity
from .statements import _can_issue as _can_manage, get_verify_base

router = APIRouter()

TEMPLATES = ("green", "dark", "horizontal", "official")
LEVEL_AR = {1: "الأول", 2: "الثاني", 3: "الثالث", 4: "الرابع", 5: "الخامس", 6: "السادس", 7: "السابع", 8: "الثامن"}


async def _active_academic_year(db) -> str:
    sem = await db.semesters.find_one({"status": "active"})
    ay = (sem or {}).get("academic_year") or ""
    if not ay:
        y = datetime.now(timezone.utc).year
        ay = f"{y}-{y + 1}"
    return ay


async def _ensure_card(db, student: dict) -> dict:
    """يضمن وجود توكن بطاقة صالح للعام الجامعي النشط (تجديد تلقائي)."""
    year = await _active_academic_year(db)
    if student.get("card_token") and student.get("card_academic_year") == year:
        return {"token": student["card_token"], "academic_year": year}
    token = uuid.uuid4().hex
    await db.students.update_one({"_id": student["_id"]}, {"$set": {
        "card_token": token, "card_academic_year": year,
        "card_issued_at": datetime.now(timezone.utc).isoformat(),
    }})
    return {"token": token, "academic_year": year}


async def _student_or_404(db, student_id: str) -> dict:
    try:
        student = await db.students.find_one({"_id": ObjectId(student_id)})
    except Exception:
        student = None
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    return student


async def _resolve_faculty(db, student: dict):
    dept = None
    if student.get("department_id"):
        try:
            dept = await db.departments.find_one({"_id": ObjectId(student["department_id"])})
        except Exception:
            dept = None
    fid = student.get("faculty_id") or (dept or {}).get("faculty_id", "")
    faculty = None
    if fid:
        try:
            faculty = await db.faculties.find_one({"_id": ObjectId(fid)})
        except Exception:
            faculty = None
    return fid, (faculty or {}).get("name", ""), (dept or {}).get("name", "")


# ==================== إعدادات التصميم لكل كلية ====================
class CardSettings(BaseModel):
    template: str = "green"


@router.get("/cards/settings/{faculty_id}")
async def get_card_settings(faculty_id: str, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user, faculty_id):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    doc = await db.card_settings.find_one({"_id": f"faculty_{faculty_id}"}) or {}
    return {"template": doc.get("template", "green")}


@router.put("/cards/settings/{faculty_id}")
async def update_card_settings(faculty_id: str, data: CardSettings, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user, faculty_id):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    if data.template not in TEMPLATES:
        raise HTTPException(status_code=400, detail="قالب غير معروف")
    db = get_db()
    await db.card_settings.update_one({"_id": f"faculty_{faculty_id}"}, {"$set": {"template": data.template}}, upsert=True)
    return {"message": "تم حفظ تصميم البطاقة"}


# ==================== بيانات البطاقة ====================
async def _card_payload(db, student: dict, base_url: str) -> dict:
    fid, faculty_name, dept_name = await _resolve_faculty(db, student)
    card = await _ensure_card(db, student)
    settings = await db.card_settings.find_one({"_id": f"faculty_{fid}"}) or {}
    verify_base = (await get_verify_base(db)) or (base_url or "").rstrip("/")
    verify_url = f"{verify_base}/verify-card?token={card['token']}" if verify_base else card["token"]
    return {
        "student_db_id": str(student["_id"]),
        "student_name": student.get("full_name", ""),
        "enrollment_no": student.get("student_id", ""),
        "reference_number": student.get("reference_number", ""),
        "nationality": student.get("nationality") or "يمني",
        "level": student.get("level") or 1,
        "section": student.get("section", ""),
        "faculty_id": fid,
        "faculty_name": faculty_name,
        "department_name": dept_name,
        "academic_year": card["academic_year"],
        "template": settings.get("template", "green"),
        "photo_path": student.get("photo_path", ""),
        "pending_photo_path": student.get("pending_photo_path", ""),
        "card_token": card["token"],
        "verify_url": verify_url,
        "status": student.get("status", "active"),
    }


@router.get("/students/me/card")
async def get_my_card(base_url: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
    db = get_db()
    student = await db.students.find_one({"user_id": current_user.get("id")})
    if not student:
        raise HTTPException(status_code=404, detail="لا يوجد ملف طالب مرتبط بحسابك")
    return await _card_payload(db, student, base_url or "")


@router.get("/students/{student_id}/card")
async def get_student_card(student_id: str, base_url: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
    db = get_db()
    student = await _student_or_404(db, student_id)
    fid, _, _ = await _resolve_faculty(db, student)
    if not _can_manage(current_user, fid):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    return await _card_payload(db, student, base_url or "")


# ==================== صور الطلاب ====================
ALLOWED_PHOTO_TYPES = ("image/jpeg", "image/png", "image/webp")


async def _store_photo(file: UploadFile) -> str:
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(status_code=400, detail="نوع الصورة غير مدعوم (JPEG/PNG/WebP)")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="حجم الصورة يتجاوز 5MB")
    from services.storage_service import upload_file
    result = upload_file(data, file.filename or "photo.jpg", file.content_type, "student_photos")
    return result["storage_path"]


@router.post("/students/me/photo")
async def upload_my_photo(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """الطالب يرفع صورته من تطبيقه — تبقى معلقة حتى يعتمدها المسجل."""
    db = get_db()
    student = await db.students.find_one({"user_id": current_user.get("id")})
    if not student:
        raise HTTPException(status_code=404, detail="لا يوجد ملف طالب مرتبط بحسابك")
    path = await _store_photo(file)
    await db.students.update_one({"_id": student["_id"]}, {"$set": {
        "pending_photo_path": path,
        "pending_photo_at": datetime.now(timezone.utc).isoformat(),
    }})
    return {"message": "تم رفع صورتك — بانتظار اعتماد المسجل", "pending_photo_path": path}


@router.post("/students/{student_id}/photo")
async def upload_student_photo(student_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """الإدارة ترفع صورة الطالب — تُعتمد مباشرة."""
    db = get_db()
    student = await _student_or_404(db, student_id)
    fid, _, _ = await _resolve_faculty(db, student)
    if not _can_manage(current_user, fid):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    path = await _store_photo(file)
    await db.students.update_one({"_id": student["_id"]}, {"$set": {"photo_path": path}, "$unset": {"pending_photo_path": "", "pending_photo_at": ""}})
    await log_activity(current_user, "set_student_photo", "student", str(student["_id"]), student.get("full_name", ""), {})
    return {"message": "تم حفظ صورة الطالب", "photo_path": path}


@router.get("/pending-photos")
async def list_pending_photos(current_user: dict = Depends(get_current_user)):
    db = get_db()
    if current_user.get("role") in ("teacher", "student"):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    q = {"pending_photo_path": {"$exists": True, "$ne": ""}}
    if current_user.get("role") != "admin":
        fids = set(current_user.get("faculty_ids") or [])
        if current_user.get("faculty_id"):
            fids.add(current_user["faculty_id"])
        if fids:
            q["faculty_id"] = {"$in": list(fids)}
    items = []
    async for s in db.students.find(q).limit(300):
        items.append({
            "id": str(s["_id"]),
            "full_name": s.get("full_name", ""),
            "student_id": s.get("student_id", ""),
            "level": s.get("level"),
            "pending_photo_path": s.get("pending_photo_path", ""),
            "pending_photo_at": s.get("pending_photo_at", ""),
            "current_photo_path": s.get("photo_path", ""),
        })
    return items


@router.post("/students/{student_id}/photo/approve")
async def approve_student_photo(student_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    student = await _student_or_404(db, student_id)
    fid, _, _ = await _resolve_faculty(db, student)
    if not _can_manage(current_user, fid):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    pending = student.get("pending_photo_path")
    if not pending:
        raise HTTPException(status_code=400, detail="لا توجد صورة معلقة لهذا الطالب")
    await db.students.update_one({"_id": student["_id"]}, {"$set": {"photo_path": pending}, "$unset": {"pending_photo_path": "", "pending_photo_at": ""}})
    await log_activity(current_user, "approve_student_photo", "student", str(student["_id"]), student.get("full_name", ""), {})
    return {"message": "تم اعتماد صورة الطالب"}


@router.post("/students/{student_id}/photo/reject")
async def reject_student_photo(student_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    student = await _student_or_404(db, student_id)
    fid, _, _ = await _resolve_faculty(db, student)
    if not _can_manage(current_user, fid):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    await db.students.update_one({"_id": student["_id"]}, {"$unset": {"pending_photo_path": "", "pending_photo_at": ""}})
    await log_activity(current_user, "reject_student_photo", "student", str(student["_id"]), student.get("full_name", ""), {})
    return {"message": "تم رفض الصورة المعلقة"}


# ==================== التحقق العام ====================
@router.get("/verify/card/{token}")
async def verify_card(token: str):
    """تحقق عام من البطاقة — بدون تسجيل دخول."""
    db = get_db()
    s = await db.students.find_one({"card_token": token})
    if not s:
        return {"valid": False, "message": "لا توجد بطاقة بهذا الرمز — قد تكون البطاقة غير صحيحة"}
    year = await _active_academic_year(db)
    _, faculty_name, dept_name = await _resolve_faculty(db, s)
    base = {
        "student_name": s.get("full_name", ""),
        "enrollment_no": s.get("student_id", ""),
        "faculty_name": faculty_name,
        "department_name": dept_name,
        "level": s.get("level"),
        "nationality": s.get("nationality") or "يمني",
        "academic_year": s.get("card_academic_year", ""),
        "has_photo": bool(s.get("photo_path")),
    }
    if s.get("is_alumni") or s.get("status") in ("expelled",):
        return {"valid": False, "message": "هذه البطاقة لم تعد سارية — الطالب غير مقيد حالياً", **base}
    if s.get("card_academic_year") != year:
        return {"valid": False, "message": f"انتهت صلاحية هذه البطاقة (كانت للعام الجامعي {s.get('card_academic_year', '')})", **base}
    return {"valid": True, "message": "بطاقة طالب سارية صادرة رسمياً من جامعة الأحقاف", **base}


@router.get("/public/card-photo/{token}")
async def public_card_photo(token: str):
    """صورة الطالب المعتمدة لصفحة التحقق العامة (التوكن غير قابل للتخمين)."""
    db = get_db()
    s = await db.students.find_one({"card_token": token})
    if not s or not s.get("photo_path"):
        raise HTTPException(status_code=404, detail="لا توجد صورة")
    from services.storage_service import get_object
    try:
        data, content_type = get_object(s["photo_path"])
    except Exception:
        raise HTTPException(status_code=404, detail="لا توجد صورة")
    return Response(content=data, media_type=content_type or "image/jpeg")


# ==================== الطباعة الدفعية ====================
DEFAULT_PRINT_SETTINGS = {
    "card_w": 85.6, "card_h": 54.0,
    "card1_x": 62.0, "card1_y": 40.0,
    "card2_x": 62.0, "card2_y": 180.0,
}
ORIENTATIONS = ("auto", "portrait", "landscape")


@router.get("/cards/print-settings")
async def get_print_settings(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") in ("teacher", "student"):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    db = get_db()
    doc = await db.card_print_settings.find_one({"_id": "global"}) or {}
    return {**DEFAULT_PRINT_SETTINGS, "orientation": doc.get("orientation", "auto"),
            **{k: v for k, v in doc.items() if k not in ("_id", "orientation")}}


class BatchPrintRequest(BaseModel):
    department_id: str
    level: Optional[int] = None
    section: Optional[str] = None
    base_url: Optional[str] = None
    orientation: Optional[str] = "auto"
    settings: Optional[dict] = None


@router.post("/cards/batch-pdf")
async def batch_print_cards(data: BatchPrintRequest, current_user: dict = Depends(get_current_user)):
    """PDF واحد: بطاقتان في كل ورقة A4 بمواضع قابلة للضبط (ملم)."""
    db = get_db()
    try:
        dept = await db.departments.find_one({"_id": ObjectId(data.department_id)})
    except Exception:
        dept = None
    if not dept:
        raise HTTPException(status_code=404, detail="القسم غير موجود")
    fid = dept.get("faculty_id", "")
    if not _can_manage(current_user, fid):
        raise HTTPException(status_code=403, detail="غير مصرح لك")

    # حفظ إعدادات المواضع للاستخدام القادم
    orientation = data.orientation if data.orientation in ORIENTATIONS else "auto"
    st = {**DEFAULT_PRINT_SETTINGS}
    if data.settings:
        for k in DEFAULT_PRINT_SETTINGS:
            try:
                st[k] = float(data.settings.get(k, st[k]))
            except (TypeError, ValueError):
                pass
        await db.card_print_settings.update_one({"_id": "global"}, {"$set": {**st, "orientation": orientation}}, upsert=True)

    q = {"department_id": data.department_id, "is_alumni": {"$ne": True}}
    if data.level:
        q["level"] = data.level
    if data.section:
        q["section"] = data.section
    students = [s async for s in db.students.find(q).sort("full_name", 1)]
    if not students:
        raise HTTPException(status_code=404, detail="لا يوجد طلاب مطابقون")
    if len(students) > 400:
        raise HTTPException(status_code=400, detail="العدد يتجاوز 400 طالب — قسّم الطلبات حسب المستوى")

    faculty = await db.faculties.find_one({"_id": ObjectId(fid)}) if fid else None
    faculty_name = (faculty or {}).get("name", "")
    tpl = (await db.card_settings.find_one({"_id": f"faculty_{fid}"}) or {}).get("template", "green")
    year = await _active_academic_year(db)
    base = (await get_verify_base(db)) or (data.base_url or "").rstrip("/")

    from services.storage_service import get_object

    def make_payload(s, card):
        return {
            "student_name": s.get("full_name", ""),
            "enrollment_no": s.get("student_id", ""),
            "reference_number": s.get("reference_number", ""),
            "nationality": s.get("nationality") or "يمني",
            "level": s.get("level") or 1,
            "section": s.get("section", ""),
            "department_name": dept.get("name", ""),
            "faculty_name": faculty_name,
            "academic_year": card["academic_year"],
            "template": tpl,
        }

    pngs = []
    for s in students:
        card = await _ensure_card(db, s)
        verify_url = f"{base}/verify-card?token={card['token']}" if base else card["token"]
        photo_bytes = None
        if s.get("photo_path"):
            try:
                photo_bytes, _ct = get_object(s["photo_path"])
            except Exception:
                photo_bytes = None
        pngs.append(_render_card_png(make_payload(s, card), photo_bytes, verify_url))

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdfcanvas
    from reportlab.lib.utils import ImageReader

    W, H = A4
    # اتجاه الإخراج: auto = حسب القالب، أو فرض عمودي/أفقي مع تدوير البطاقة عند الحاجة
    template_portrait = tpl != "horizontal"
    if orientation == "auto":
        out_portrait = template_portrait
    else:
        out_portrait = orientation == "portrait"
    rotate_needed = out_portrait != template_portrait
    if rotate_needed:
        from PIL import Image as PILImage
        rotated = []
        for png in pngs:
            im = PILImage.open(io.BytesIO(png)).rotate(90, expand=True)
            b = io.BytesIO()
            im.save(b, format="PNG")
            rotated.append(b.getvalue())
        pngs = rotated
    if out_portrait:
        cw, ch = st["card_h"] * mm, st["card_w"] * mm
    else:
        cw, ch = st["card_w"] * mm, st["card_h"] * mm
    positions = [(st["card1_x"] * mm, st["card1_y"] * mm), (st["card2_x"] * mm, st["card2_y"] * mm)]
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=A4)
    for i in range(0, len(pngs), 2):
        for j, png in enumerate(pngs[i:i + 2]):
            x, y_top = positions[j]
            c.drawImage(ImageReader(io.BytesIO(png)), x, H - y_top - ch, cw, ch)
        c.showPage()
    c.save()
    fname = f"cards_{dept.get('name', 'dept')}"
    return StreamingResponse(io.BytesIO(buf.getvalue()), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=batch_cards.pdf"})


@router.get("/cards/batch-count")
async def batch_count(department_id: str, level: Optional[int] = None, section: Optional[str] = None,
                      current_user: dict = Depends(get_current_user)):
    db = get_db()
    q = {"department_id": department_id, "is_alumni": {"$ne": True}}
    if level:
        q["level"] = level
    if section:
        q["section"] = section
    n = await db.students.count_documents(q)
    return {"count": n, "pages": (n + 1) // 2}


# ==================== توليد PNG / PDF ====================
THEMES = {
    "green": {"band": (27, 94, 32), "bg": (255, 255, 255), "text": (26, 37, 64), "band_text": (255, 255, 255), "accent": (27, 94, 32), "muted": (91, 102, 120), "strip": (232, 245, 233), "strip_text": (27, 94, 32)},
    "dark": {"band": (7, 20, 23), "bg": (15, 32, 39), "text": (255, 255, 255), "band_text": (255, 255, 255), "accent": (77, 182, 172), "muted": (176, 190, 197), "strip": (7, 20, 23), "strip_text": (77, 182, 172)},
    "official": {"band": (27, 94, 32), "bg": (255, 255, 255), "text": (26, 37, 64), "band_text": (255, 255, 255), "accent": (27, 94, 32), "muted": (91, 102, 120), "strip": (232, 245, 233), "strip_text": (27, 94, 32)},
}


def _render_card_png(p: dict, photo_bytes: Optional[bytes], verify_url: str) -> bytes:
    import qrcode
    from pathlib import Path
    from PIL import Image, ImageDraw, ImageFont, features

    HAS_RAQM = features.check("raqm")
    if not HAS_RAQM:
        import arabic_reshaper
        from bidi.algorithm import get_display

    def ar(t):
        t = str(t or "")
        if HAS_RAQM:
            return t
        return get_display(arabic_reshaper.reshape(t))

    _dir = {"direction": "rtl"} if HAS_RAQM else {}

    font_path = str(Path(__file__).parent.parent / "fonts" / "Amiri-Regular.ttf")

    def F(size):
        return ImageFont.truetype(font_path, size)

    def rtl(draw, right_x, y, text, font, fill):
        t = ar(text)
        w = draw.textlength(t, font=font, **_dir)
        draw.text((right_x - w, y), t, font=font, fill=fill, **_dir)

    def center(draw, cx, y, text, font, fill):
        t = ar(text)
        w = draw.textlength(t, font=font, **_dir)
        draw.text((cx - w / 2, y), t, font=font, fill=fill, **_dir)

    template = p.get("template", "green")
    horizontal = template == "horizontal"
    theme = THEMES.get(template if template in THEMES else "green", THEMES["green"])

    logo = None
    logo_path = Path(__file__).parent.parent / "assets" / "university_logo.jpeg"
    if logo_path.exists():
        logo = Image.open(logo_path).convert("RGBA")

    def paste_watermark(im, cx, cy, size, alpha=26):
        if not logo:
            return
        wm = logo.resize((size, size)).convert("RGBA")
        mask = wm.convert("L").point(lambda v: 0 if v > 235 else alpha)
        wm.putalpha(mask)
        im.paste(wm, (cx - size // 2, cy - size // 2), wm)

    # صورة الطالب
    photo = None
    if photo_bytes:
        try:
            photo = Image.open(io.BytesIO(photo_bytes)).convert("RGB")
        except Exception:
            photo = None

    def fit_photo(img, w, h):
        ratio = max(w / img.width, h / img.height)
        img = img.resize((int(img.width * ratio) + 1, int(img.height * ratio) + 1))
        left = (img.width - w) // 2
        top = (img.height - h) // 2
        return img.crop((left, top, left + w, top + h))

    qr_img = qrcode.make(verify_url, box_size=6, border=1).convert("RGB")

    level_ar = LEVEL_AR.get(p.get("level") or 1, str(p.get("level")))
    rows = [
        ("رقم القيد", p.get("enrollment_no", "")),
        ("التخصص", p.get("department_name", "")),
        ("المستوى", f"المستوى {level_ar}"),
    ]
    if (p.get("section") or "").strip():
        rows.append(("الشعبة", str(p["section"]).strip()))
    rows.append(("الجنسية", p.get("nationality", "")))
    if p.get("reference_number"):
        rows.insert(1, ("الرقم المرجعي", p["reference_number"]))

    if template == "official":
        DG = (27, 94, 32)
        MG = (46, 125, 50)
        LG = (232, 245, 233)
        MUT = (96, 125, 102)
        NAVY = (26, 37, 64)
        W, H = 640, 1010
        img = Image.new("RGB", (W, H), (255, 255, 255))
        d = ImageDraw.Draw(img)
        # زخارف دوائر خفيفة
        d.ellipse([-150, -150, 170, 170], outline=LG, width=3)
        d.ellipse([-95, -95, 115, 115], outline=LG, width=3)
        d.ellipse([W - 170, H - 240, W + 150, H + 80], outline=LG, width=3)
        # الأشرطة الجانبية
        d.rectangle([W - 18, 0, W, H], fill=DG)
        d.rectangle([W - 26, 0, W - 22, H], fill=MG)
        d.rectangle([0, 0, 6, H], fill=LG)
        paste_watermark(img, W // 2, 660, 480)
        # الشعار داخل حلقة خضراء
        cy = 96
        d.ellipse([W // 2 - 76, cy - 76, W // 2 + 76, cy + 76], outline=LG, width=10)
        d.ellipse([W // 2 - 66, cy - 66, W // 2 + 66, cy + 66], outline=DG, width=3)
        if logo:
            lg = logo.resize((108, 108))
            img.paste(lg, (W // 2 - 54, cy - 54), lg)
        center(d, W // 2, 176, "جامعة الأحقاف", F(40), DG)
        center(d, W // 2, 234, "AL-AHGAFF UNIVERSITY", F(18), MUT)
        # اسم الكلية في كبسولة فاتحة
        fac_w = d.textlength(ar(p.get("faculty_name", "")), font=F(22), **_dir)
        d.rounded_rectangle([W // 2 - fac_w / 2 - 26, 274, W // 2 + fac_w / 2 + 26, 318], radius=22, fill=LG)
        center(d, W // 2, 281, p.get("faculty_name", ""), F(22), DG)
        # شريط بطاقة طالب
        d.rounded_rectangle([W // 2 - 108, 334, W // 2 + 108, 378], radius=10, fill=DG)
        center(d, W // 2, 340, "بطاقة طالب", F(24), (255, 255, 255))
        # الصورة بإطار أخضر مزدوج
        py = 404
        d.rounded_rectangle([W // 2 - 114, py - 14, W // 2 + 114, py + 264], radius=14, fill=LG)
        d.rectangle([W // 2 - 104, py - 4, W // 2 + 104, py + 254], fill=DG)
        if photo:
            ph = fit_photo(photo, 200, 250)
            img.paste(ph, (W // 2 - 100, py))
        else:
            d.rectangle([W // 2 - 100, py, W // 2 + 100, py + 250], fill=(244, 248, 245))
            center(d, W // 2, py + 110, "لا توجد صورة", F(20), MUT)
        # الاسم
        center(d, W // 2, py + 272, p.get("student_name", ""), F(32), DG)
        d.rectangle([130, py + 326, W - 130, py + 328], fill=LG)
        # البيانات يميناً + QR يساراً
        y = py + 344
        spacing = min(34, 190 // max(len(rows), 1))
        for label, value in rows:
            rtl(d, W - 62, y, f"{label}:", F(19), MG)
            rtl(d, W - 216, y, value, F(21), NAVY)
            y += spacing
        d.rounded_rectangle([36, 748, 198, 948], radius=10, outline=LG, width=4)
        q = qr_img.resize((140, 140))
        img.paste(q, (47, 760))
        center(d, 117, 908, "امسح للتحقق", F(16), MUT)
        # الشريط السفلي
        d.rectangle([0, H - 64, W, H - 60], fill=DG)
        d.rectangle([0, H - 60, W, H], fill=LG)
        center(d, W // 2, H - 50, f"صالحة للعام الجامعي {p.get('academic_year', '')}", F(23), DG)
    elif not horizontal:
        W, H = 640, 1010
        img = Image.new("RGB", (W, H), theme["bg"])
        d = ImageDraw.Draw(img)
        # الشريط العلوي
        d.rectangle([0, 0, W, 180], fill=theme["band"])
        paste_watermark(img, W // 2, 620, 460)
        if logo:
            lg = logo.resize((110, 110))
            white = Image.new("RGB", (122, 122), (255, 255, 255))
            img.paste(white, (W // 2 - 61, 24))
            img.paste(lg, (W // 2 - 55, 30), lg)
        center(d, W // 2 - 170, 40, "AL-AHGAFF", F(26), theme["band_text"])
        center(d, W // 2 - 170, 76, "UNIVERSITY", F(26), theme["band_text"])
        center(d, W // 2 + 170, 44, "جامعة الأحقاف", F(34), theme["band_text"])
        center(d, W // 2 + 170, 96, p.get("faculty_name", ""), F(22), theme["band_text"])
        center(d, W // 2, 140, "بطاقة طالب", F(26), theme["band_text"])
        # صورة الطالب
        py = 210
        if photo:
            ph = fit_photo(photo, 240, 300)
            d.rectangle([W // 2 - 124, py - 4, W // 2 + 124, py + 304], fill=theme["accent"])
            img.paste(ph, (W // 2 - 120, py))
        else:
            d.rectangle([W // 2 - 120, py, W // 2 + 120, py + 300], fill=(230, 234, 242))
            center(d, W // 2, py + 135, "لا توجد صورة", F(22), (120, 130, 145))
        # الاسم
        center(d, W // 2, py + 320, p.get("student_name", ""), F(32), theme["text"])
        # البيانات
        y = py + 380
        for label, value in rows:
            rtl(d, W - 50, y, f"{label}:", F(22), theme["muted"])
            rtl(d, W - 210, y, value, F(24), theme["text"])
            y += 44
        # QR
        q = qr_img.resize((150, 150))
        img.paste(q, (40, H - 226))
        rtl(d, W - 50, H - 190, "امسح الرمز للتحقق", F(20), theme["muted"])
        rtl(d, W - 50, H - 158, "من صحة البطاقة", F(20), theme["muted"])
        # شريط الصلاحية
        d.rectangle([0, H - 56, W, H], fill=theme["strip"])
        center(d, W // 2, H - 46, f"صالحة للعام الجامعي {p.get('academic_year', '')}", F(24), theme["strip_text"])
    else:
        W, H = 1010, 640
        theme = THEMES["green"]
        img = Image.new("RGB", (W, H), theme["bg"])
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, W, 120], fill=theme["band"])
        paste_watermark(img, 420, 380, 380)
        if logo:
            lg = logo.resize((92, 92))
            white = Image.new("RGB", (100, 100), (255, 255, 255))
            img.paste(white, (W // 2 - 50, 14))
            img.paste(lg, (W // 2 - 46, 18), lg)
        rtl(d, W - 30, 22, "جامعة الأحقاف", F(32), theme["band_text"])
        rtl(d, W - 30, 70, p.get("faculty_name", ""), F(22), theme["band_text"])
        d.text((30, 28), "AL-AHGAFF UNIVERSITY", font=F(24), fill=theme["band_text"])
        d.text((30, 66), "STUDENT ID CARD", font=F(20), fill=theme["band_text"])
        # الصورة يميناً
        px, py = W - 290, 160
        if photo:
            ph = fit_photo(photo, 230, 290)
            d.rectangle([px - 4, py - 4, px + 234, py + 294], fill=theme["accent"])
            img.paste(ph, (px, py))
        else:
            d.rectangle([px, py, px + 230, py + 290], fill=(230, 234, 242))
            center(d, px + 115, py + 130, "لا توجد صورة", F(20), (120, 130, 145))
        # البيانات يساراً (من اليمين للصورة)
        rtl(d, px - 40, 160, p.get("student_name", ""), F(34), theme["text"])
        y = 230
        for label, value in rows:
            rtl(d, px - 40, y, f"{label}:", F(22), theme["muted"])
            rtl(d, px - 200, y, value, F(24), theme["text"])
            y += 48
        # QR أسفل يسار مع مساحة فاصلة
        q = qr_img.resize((130, 130))
        img.paste(q, (36, H - 196))
        center(d, 101, H - 226, "امسح للتحقق", F(18), theme["muted"])
        d.rectangle([0, H - 52, W, H], fill=theme["strip"])
        center(d, W // 2, H - 44, f"صالحة للعام الجامعي {p.get('academic_year', '')}", F(22), theme["strip_text"])

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@router.get("/students/{student_id}/card/download")
async def download_student_card(
    student_id: str,
    fmt: str = Query("png", pattern="^(png|pdf)$"),
    base_url: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    student = await _student_or_404(db, student_id)
    fid, _, _ = await _resolve_faculty(db, student)
    if not _can_manage(current_user, fid):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    p = await _card_payload(db, student, base_url or "")
    photo_bytes = None
    if p.get("photo_path"):
        from services.storage_service import get_object
        try:
            photo_bytes, _ct = get_object(p["photo_path"])
        except Exception:
            photo_bytes = None
    png = _render_card_png(p, photo_bytes, p["verify_url"])
    fname = f"card_{p.get('enrollment_no', 'student')}"
    if fmt == "png":
        return StreamingResponse(io.BytesIO(png), media_type="image/png",
                                 headers={"Content-Disposition": f"attachment; filename={fname}.png"})
    # PDF بمقاس البطاقة القياسي CR80
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdfcanvas
    from reportlab.lib.utils import ImageReader
    horizontal = p.get("template") == "horizontal"
    page = (85.6 * mm, 54 * mm) if horizontal else (54 * mm, 85.6 * mm)
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=page)
    c.drawImage(ImageReader(io.BytesIO(png)), 0, 0, page[0], page[1])
    c.showPage()
    c.save()
    return StreamingResponse(io.BytesIO(buf.getvalue()), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={fname}.pdf"})
