"""شهادات التخرج: PDF بقالب الجامعة الرسمي + ترقيم تسلسلي + QR للتحقق العام + سجل."""
import io
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from bson import ObjectId

from .deps import get_db, get_current_user, log_activity
from .statements import get_verify_base, _can_issue

router = APIRouter()

AR_NUM = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")


class CertIssueRequest(BaseModel):
    student_id: str
    grade: str
    graduation_date: Optional[str] = None
    base_url: Optional[str] = None


class CertRevokeRequest(BaseModel):
    reason: Optional[str] = None


@router.post("/certificates/issue")
async def issue_certificate(data: CertIssueRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    student = await db.students.find_one({"_id": ObjectId(data.student_id)})
    if not student:
        raise HTTPException(status_code=404, detail="الطالب غير موجود")
    if not (student.get("is_alumni") or student.get("status") == "graduated"):
        raise HTTPException(status_code=400, detail="شهادة التخرج تصدر للخريجين فقط")
    dept = None
    if student.get("department_id"):
        try:
            dept = await db.departments.find_one({"_id": ObjectId(student["department_id"])})
        except Exception:
            dept = None
    faculty_id = student.get("faculty_id") or (dept or {}).get("faculty_id", "")
    if not _can_issue(current_user, faculty_id):
        raise HTTPException(status_code=403, detail="غير مصرح لك بإصدار شهادات لهذه الكلية")
    faculty = None
    if faculty_id:
        try:
            faculty = await db.faculties.find_one({"_id": ObjectId(faculty_id)})
        except Exception:
            faculty = None

    grade = (data.grade or "").strip()
    if not grade:
        raise HTTPException(status_code=400, detail="التقدير مطلوب")

    grad_date = (data.graduation_date or "").strip()
    if not grad_date:
        gd = (student.get("graduation_data") or {}).get("date") or student.get("graduation_date") or ""
        grad_date = str(gd)[:10]
    try:
        g = datetime.strptime(grad_date, "%Y-%m-%d")
    except (ValueError, TypeError):
        g = datetime.now(timezone.utc)
        grad_date = g.strftime("%Y-%m-%d")
    from hijridate import Gregorian
    h = Gregorian(g.year, g.month, g.day).to_hijri()
    hijri_display = f"{h.year}/{h.month}/{h.day}"
    greg_display = f"{g.year}/{g.month}/{g.day}"

    year = datetime.now(timezone.utc).year
    counter = await db.certificate_counters.find_one_and_update(
        {"_id": f"{faculty_id}_{year}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    seq = counter["seq"]
    number_display = f"{seq}/{year}"

    token = uuid.uuid4().hex
    verify_base = (await get_verify_base(db)) or (data.base_url or "").rstrip("/")
    verify_url = f"{verify_base}/verify-certificate?token={token}" if verify_base else token

    doc = {
        "serial": seq,
        "number_display": number_display,
        "year": year,
        "student_id": str(student["_id"]),
        "student_name": student.get("full_name", ""),
        "enrollment_no": student.get("student_id", ""),
        "department_id": str((dept or {}).get("_id", "")) if dept else "",
        "department_name": (dept or {}).get("name", ""),
        "faculty_id": faculty_id,
        "faculty_name": (faculty or {}).get("name", ""),
        "grade": grade,
        "graduation_date": grad_date,
        "hijri_date": hijri_display,
        "greg_date": greg_display,
        "photo_path": student.get("photo_path", ""),
        "verify_token": token,
        "verify_url": verify_url,
        "issued_by": current_user.get("id", ""),
        "issued_by_name": current_user.get("full_name", ""),
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "is_revoked": False,
    }
    res = await db.graduation_certificates.insert_one(doc)
    await log_activity(current_user, "issue_graduation_certificate", "student", str(student["_id"]),
                       student.get("full_name", ""), {"number": number_display})
    return {"id": str(res.inserted_id), "number": number_display, "verify_url": verify_url, "token": token}


@router.get("/certificates")
async def list_certificates(current_user: dict = Depends(get_current_user)):
    db = get_db()
    q = {}
    if current_user.get("role") != "admin":
        fids = set(current_user.get("faculty_ids") or [])
        if current_user.get("faculty_id"):
            fids.add(current_user["faculty_id"])
        if not fids or current_user.get("role") in ("teacher", "student"):
            raise HTTPException(status_code=403, detail="غير مصرح لك")
        q["faculty_id"] = {"$in": list(fids)}
    items = []
    async for s in db.graduation_certificates.find(q).sort("issued_at", -1).limit(500):
        s["id"] = str(s.pop("_id"))
        s.pop("verify_token", None)
        items.append(s)
    return items


@router.post("/certificates/{cert_id}/revoke")
async def revoke_certificate(cert_id: str, data: CertRevokeRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.graduation_certificates.find_one({"_id": ObjectId(cert_id)})
    if not s:
        raise HTTPException(status_code=404, detail="الشهادة غير موجودة")
    if not _can_issue(current_user, s.get("faculty_id", "")):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    await db.graduation_certificates.update_one({"_id": s["_id"]}, {"$set": {
        "is_revoked": True,
        "revoked_at": datetime.now(timezone.utc).isoformat(),
        "revoked_by_name": current_user.get("full_name", ""),
        "revoke_reason": (data.reason or "").strip(),
    }})
    await log_activity(current_user, "revoke_graduation_certificate", "student", s.get("student_id", ""),
                       s.get("student_name", ""), {"number": s.get("number_display", "")})
    return {"message": "تم إلغاء الشهادة — ستظهر عند التحقق أنها ملغاة"}


@router.post("/certificates/{cert_id}/restore")
async def restore_certificate(cert_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.graduation_certificates.find_one({"_id": ObjectId(cert_id)})
    if not s:
        raise HTTPException(status_code=404, detail="الشهادة غير موجودة")
    if not _can_issue(current_user, s.get("faculty_id", "")):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    await db.graduation_certificates.update_one({"_id": s["_id"]}, {"$set": {"is_revoked": False}})
    await log_activity(current_user, "restore_graduation_certificate", "student", s.get("student_id", ""),
                       s.get("student_name", ""), {"number": s.get("number_display", "")})
    return {"message": "تمت استعادة صلاحية الشهادة"}


@router.get("/verify/certificate/{token}")
async def verify_certificate(token: str):
    """تحقق عام — بدون تسجيل دخول."""
    db = get_db()
    s = await db.graduation_certificates.find_one({"verify_token": token})
    if not s:
        return {"valid": False, "message": "لا توجد شهادة بهذا الرمز — قد تكون الوثيقة غير صحيحة"}
    if s.get("is_revoked"):
        return {"valid": False, "message": "هذه الشهادة ملغاة من الجهة المصدرة ولا يُعتد بها",
                "number": s.get("number_display"), "issued_at": (s.get("issued_at") or "")[:10]}
    return {
        "valid": True,
        "message": "شهادة تخرج صحيحة صادرة رسمياً من جامعة الأحقاف",
        "number": s.get("number_display"),
        "student_name": s.get("student_name"),
        "faculty_name": s.get("faculty_name"),
        "department_name": s.get("department_name"),
        "grade": s.get("grade"),
        "graduation_date": s.get("graduation_date"),
        "hijri_date": s.get("hijri_date"),
        "issued_at": (s.get("issued_at") or "")[:10],
    }


@router.get("/certificates/{cert_id}/pdf")
async def certificate_pdf(cert_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.graduation_certificates.find_one({"_id": ObjectId(cert_id)})
    if not s:
        raise HTTPException(status_code=404, detail="الشهادة غير موجودة")
    if not _can_issue(current_user, s.get("faculty_id", "")):
        raise HTTPException(status_code=403, detail="غير مصرح لك")
    photo_bytes = None
    if s.get("photo_path"):
        try:
            from services.storage_service import get_object
            photo_bytes, _ct = get_object(s["photo_path"])
        except Exception:
            photo_bytes = None
    pdf = _build_certificate_pdf(s, photo_bytes)
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=certificate_{s.get('serial')}.pdf"})


def _build_certificate_pdf(s: dict, photo_bytes: Optional[bytes]) -> bytes:
    png = _render_certificate_png(s, photo_bytes)
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as pdfcanvas
    W, H = A4
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=A4)
    c.drawImage(ImageReader(io.BytesIO(png)), 0, 0, W, H)
    c.save()
    return buf.getvalue()


def _hb_draw(img, text, font_path, size, x, y_top, fill, align="center"):
    """رسم نص عربي مُشكَّل عبر HarfBuzz + FreeType — مستقل عن بيئة التشغيل (لا يعتمد على raqm)."""
    import re
    import uharfbuzz as hb
    import freetype
    from PIL import Image

    text = str(text or "")
    if not text.strip():
        return
    # الأرقام والتواريخ تُعكس مسبقاً لأن HarfBuzz سيعكس الترتيب البصري في الاتجاه RTL
    text = re.sub(r"[0-9٠-٩/:]+", lambda m: m.group(0)[::-1], text)

    blob = hb.Blob.from_file_path(str(font_path))
    face = hb.Face(blob)
    font = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf)
    scale = size / face.upem
    total = sum(p.x_advance for p in buf.glyph_positions) * scale

    ft = freetype.Face(str(font_path))
    ft.set_pixel_sizes(0, size)
    ascender = ft.size.ascender / 64.0

    if align == "center":
        pen_x = x - total / 2
    elif align == "right":
        pen_x = x - total
    else:
        pen_x = x
    baseline = y_top + ascender

    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        ft.load_glyph(info.codepoint, freetype.FT_LOAD_RENDER)
        bmp = ft.glyph.bitmap
        if bmp.width and bmp.rows:
            mask = Image.frombytes("L", (bmp.width, bmp.rows), bytes(bmp.buffer))
            gx = int(pen_x + pos.x_offset * scale) + ft.glyph.bitmap_left
            gy = int(baseline - pos.y_offset * scale) - ft.glyph.bitmap_top
            img.paste(Image.new("RGB", mask.size, fill), (gx, gy), mask)
        pen_x += pos.x_advance * scale


def _render_certificate_png(s: dict, photo_bytes: Optional[bytes]) -> bytes:
    import qrcode
    from pathlib import Path
    from PIL import Image, ImageDraw

    fonts_dir = Path(__file__).parent.parent / "fonts"
    ruqaa_bold = fonts_dir / "ArefRuqaa-Bold.ttf"
    amiri = fonts_dir / "Amiri-Regular.ttf"

    tpl_path = Path(__file__).parent.parent / "assets" / "certificate_template.png"
    img = Image.open(tpl_path).convert("RGB")  # 1136x1628 (أصلها 568x814 × 2)
    d = ImageDraw.Draw(img)
    INK = (35, 35, 40)

    def _hb_width(text, font_path, size):
        import re
        import uharfbuzz as hb
        t = re.sub(r"[0-9٠-٩/:]+", lambda m: m.group(0)[::-1], str(text or ""))
        blob = hb.Blob.from_file_path(str(font_path))
        face = hb.Face(blob)
        font = hb.Font(face)
        buf = hb.Buffer()
        buf.add_str(t)
        buf.guess_segment_properties()
        hb.shape(font, buf)
        return sum(p.x_advance for p in buf.glyph_positions) * size / face.upem

    CX = 468  # مركز كتلة النص بالنسبة للأصل ×2 (منطقة 24..453 → مركز 238×2)

    # صورة الطالب (الإطار الأصلي 16..143 × 163..341 ×2)
    if photo_bytes:
        try:
            ph = Image.open(io.BytesIO(photo_bytes)).convert("RGB")
            bw, bh = 246, 348  # 123×174 ×2
            ratio = max(bw / ph.width, bh / ph.height)
            ph = ph.resize((int(ph.width * ratio) + 1, int(ph.height * ratio) + 1))
            left = (ph.width - bw) // 2
            top = (ph.height - bh) // 2
            ph = ph.crop((left, top, left + bw, top + bh))
            img.paste(ph, (34, 330))
            d.rectangle([32, 328, 34 + bw + 1, 330 + bh + 1], outline=(70, 90, 75), width=3)
        except Exception:
            pass

    # كتلة النص (المنطقة الممسوحة 341..578 ×2 → 682..1156)
    _hb_draw(img, s.get("student_name", ""), ruqaa_bold, 76, CX, 690, INK)
    _hb_draw(img, "الإجازة العامة ( البكالوريوس )", ruqaa_bold, 60, CX, 800, INK)
    _hb_draw(img, f"في {s.get('department_name', '')}", ruqaa_bold, 56, CX, 890, INK)
    fac = (s.get("faculty_name") or "").strip()
    if fac.startswith("كلية"):
        fac = fac[4:].strip()
    _hb_draw(img, f"من كلية {fac}", ruqaa_bold, 56, CX, 978, INK)
    _hb_draw(img, f"بتقدير عام (( {s.get('grade', '')} ))", ruqaa_bold, 56, CX, 1066, INK)

    # التواريخ (المنطقة 272..478 × 753..796 ×2)
    hijri = (s.get("hijri_date") or "").translate(AR_NUM)
    greg = (s.get("greg_date") or "").translate(AR_NUM)
    date_text = f"منح بتاريخ {hijri}هـ الموافق {greg}م"
    fsize = 40
    while fsize > 24 and _hb_width(date_text, ruqaa_bold, fsize) > 400:
        fsize -= 2
    _hb_draw(img, date_text, ruqaa_bold, fsize, 950, 1524, INK, align="right")

    # QR أعلى اليسار + رقم الشهادة
    qr = qrcode.make(s.get("verify_url", ""), box_size=6, border=1).convert("RGB").resize((190, 190))
    img.paste(qr, (44, 44))
    num = (s.get("number_display") or "").translate(AR_NUM)
    _hb_draw(img, f"رقم: {num}", amiri, 30, 139, 240, (60, 80, 65))
    _hb_draw(img, "امسح للتحقق", amiri, 30, 139, 282, (60, 80, 65))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
