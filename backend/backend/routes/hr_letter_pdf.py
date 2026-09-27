"""📄 توليد PDF للخطاب الرسمي على الكليشة (صورة A4 خلفية) مع التوقيع وQR التحقق"""
import io
import os


def _font_setup():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        pdfmetrics.registerFont(TTFont("Amiri", os.path.join(here, "fonts", "Amiri-Regular.ttf")))
        pdfmetrics.registerFont(TTFont("Amiri-Bold", os.path.join(here, "fonts", "Amiri-Bold.ttf")))
        return "Amiri", "Amiri-Bold"
    except Exception:
        return "Helvetica", "Helvetica-Bold"


def _ar(t: str) -> str:
    import arabic_reshaper
    from bidi.algorithm import get_display
    try:
        return get_display(arabic_reshaper.reshape(str(t or "")))
    except Exception:
        return str(t or "")


def _load_bytes(path: str):
    if not path:
        return None
    try:
        from services.storage_service import get_object
        data, _ = get_object(path)
        return data
    except Exception:
        return None


def _load_img(path: str):
    data = _load_bytes(path)
    if not data:
        return None
    from reportlab.lib.utils import ImageReader
    return ImageReader(io.BytesIO(data))


def build_letter_pdf(letter: dict, settings: dict, verify_url: str) -> bytes:
    import qrcode
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT, TA_JUSTIFY
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
    from .hr_letters import LETTER_TYPES, LETTER_TYPES_EN

    font, bold = _font_setup()
    lang = letter.get("language", "ar")
    rtl = lang != "en"
    W, H = A4
    top = float(settings.get("top_margin_mm") or 45) * mm
    bottom = float(settings.get("bottom_margin_mm") or 35) * mm
    side = 22 * mm
    letterhead = _load_img(settings.get("letterhead_path", ""))
    signature = _load_bytes(settings.get("signature_path", ""))
    NAVY, GREY = colors.HexColor("#0f2440"), colors.HexColor("#64748b")

    def T(t):
        return _ar(t) if rtl else str(t or "")

    align_body = TA_RIGHT if rtl else TA_JUSTIFY
    st_title = ParagraphStyle("t", fontName=bold, fontSize=17, leading=26, alignment=TA_CENTER, textColor=NAVY, spaceAfter=4)
    st_meta = ParagraphStyle("m", fontName=font, fontSize=10.5, leading=15, alignment=TA_RIGHT if rtl else TA_LEFT, textColor=GREY)
    st_body = ParagraphStyle("b", fontName=font, fontSize=12.5, leading=22, alignment=align_body, textColor=colors.HexColor("#1e293b"))
    st_sig_name = ParagraphStyle("sn", fontName=bold, fontSize=12, leading=17, alignment=TA_CENTER, textColor=NAVY)
    st_sig_title = ParagraphStyle("stt", fontName=font, fontSize=10.5, leading=15, alignment=TA_CENTER, textColor=GREY)
    st_foot = ParagraphStyle("f", fontName=font, fontSize=8.5, leading=12, alignment=TA_CENTER, textColor=GREY)

    ref = letter.get("ref_no", "")
    date = letter.get("issue_date", "")
    title = LETTER_TYPES.get(letter["type"], "") if rtl else LETTER_TYPES_EN.get(letter["type"], "")
    snap = letter.get("snapshot", {})
    signer_name = settings.get("signer_name" if rtl else "signer_name_en") or ""
    signer_title = settings.get("signer_title" if rtl else "signer_title_en") or ""
    footer = settings.get("footer_ar" if rtl else "footer_en") or ""

    qr = qrcode.make(verify_url)
    qb = io.BytesIO(); qr.save(qb, format="PNG"); qb.seek(0)
    qr_img = ImageReader(qb)

    def on_page(c, doc):
        if letterhead:
            c.drawImage(letterhead, 0, 0, width=W, height=H, preserveAspectRatio=False, mask="auto")
        # QR + عبارة التحقق أسفل اليسار
        c.drawImage(qr_img, side, bottom - 4 * mm, width=22 * mm, height=22 * mm)
        c.setFont(font, 7.5); c.setFillColor(GREY)
        c.drawString(side, bottom - 7 * mm, "Verify: " + (verify_url if len(verify_url) < 70 else verify_url[:67] + "..."))
        c.drawString(side + 24 * mm, bottom + 12 * mm, f"Ref: {ref}   Date: {date}")
        if footer:
            c.setFont(font, 8.5)
            c.drawCentredString(W / 2, bottom - 12 * mm, T(footer))

    def wrapped(text, style, base_dir):
        """تفاف الأسطر قبل تطبيق bidi حتى لا يختل ترتيب الكلمات؛ base_dir يحدد اتجاه الفقرة (R عربي / L إنجليزي مع أسماء عربية)"""
        import arabic_reshaper
        from bidi.algorithm import get_display
        from reportlab.lib.utils import simpleSplit
        reshaped = arabic_reshaper.reshape(text)
        return [Paragraph(get_display(ln, base_dir=base_dir), style) for ln in simpleSplit(reshaped, style.fontName, style.fontSize, W - 2 * side)]

    el = []
    st_meta_l = ParagraphStyle("ml", parent=st_meta, alignment=TA_LEFT)
    meta = Table([[Paragraph(T(f"التاريخ: {date}" if rtl else f"Ref. No.: {ref}"), st_meta_l), Paragraph(T(f"الرقم المرجعي: {ref}" if rtl else f"Date: {date}"), ParagraphStyle("mr", parent=st_meta, alignment=TA_RIGHT))]],
                 colWidths=[(W - 2 * side) / 2] * 2)
    meta.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    el.append(meta)
    el.append(Spacer(1, 6 * mm))
    el.append(Paragraph(T(title), st_title))
    el.append(Spacer(1, 6 * mm))
    for para in (letter.get("body") or "").split("\n"):
        if not para.strip():
            el.append(Spacer(1, 3.5 * mm))
        else:
            el.extend(wrapped(para.strip(), st_body, "R" if rtl else "L"))
    el.append(Spacer(1, 10 * mm))

    # كتلة التوقيع (يمين للعربي / يسار للإنجليزي)
    sig_cells = []
    if signature:
        from reportlab.platypus import Image as RLImage
        sig_cells.append(RLImage(io.BytesIO(signature), width=42 * mm, height=20 * mm, kind="proportional"))
    sig_cells.append(Paragraph(T(signer_name) if signer_name else "", st_sig_name))
    sig_cells.append(Paragraph(T(signer_title), st_sig_title))
    sig_cells.append(Paragraph(T("جامعة الأحقاف — شؤون الموظفين" if rtl else "Al-Ahgaff University — Human Resources"), st_sig_title))
    block = Table([[c] for c in sig_cells], colWidths=[62 * mm])
    block.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOTTOMPADDING", (0, 0), (-1, -1), 1), ("TOPPADDING", (0, 0), (-1, -1), 1)]))
    row = [[block, ""]] if not rtl else [["", block]]
    wrap = Table(row, colWidths=[(W - 2 * side) - 62 * mm, 62 * mm] if not rtl else [(W - 2 * side) - 62 * mm, 62 * mm])
    wrap.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el.append(KeepTogether([wrap]))

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=side, rightMargin=side, topMargin=top, bottomMargin=bottom + 14 * mm,
                      title=f"{title} - {snap.get('name', '')}", author="Al-Ahgaff University").build(el, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()
