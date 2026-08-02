# دروس النشر — بيئة الإنتاج (مهم جداً)

## بنية النشر الفعلية
- **الواجهة (app.ahgaff.net / ahgaff.net)**: عبر نشر Emergent + توجيه Cloudflare.
- **الخادم الخلفي في الإنتاج (api.ahgaff.net)**: مستضاف على **Railway** ويُبنى من `/app/backend/Dockerfile`:
  - سياق البناء `/app/backend`، والأمر `COPY backend/requirements.txt .` يعني أنه يستخدم **الملف الداخلي** `/app/backend/backend/requirements.txt` وليس `/app/backend/requirements.txt`!

## القاعدة الذهبية
**أي مكتبة python جديدة يجب إضافتها إلى الملفين معاً:**
1. `/app/backend/requirements.txt` (المعاينة/نشر Emergent)
2. `/app/backend/backend/requirements.txt` (إنتاج Railway)

## حادثة 2026-08-01
- شهادة التخرج فشلت في الإنتاج بـ `ModuleNotFoundError: No module named 'uharfbuzz'` لأن المكتبات الجديدة (pypdf, uharfbuzz, freetype-py) أُضيفت للملف الخارجي فقط.
- تمت مزامنة الملف الداخلي بإضافة: pypdf, uharfbuzz, freetype-py, xlrd.

## ملاحظات أخرى
- الإنتاج بدون libraqm → أي رسم نص عربي بـPIL يجب أن يمر عبر HarfBuzz+FreeType (`_hb_draw` في certificates.py) أو خط فيه Presentation Forms (مثل Amiri).
- بيانات الإنتاج فيها طلاب بـ`department_id` غير صالح → استخدم دائماً lookups آمنة (try/except حول ObjectId).

## نطاق التحقق الجديد verify.ahgaff.edu (2026-08-01)
- ahgaff.edu ملك المستخدم — DNS يُدار عند Opalstack (ns1/2/3.us.opalstack.com).
- verify.ahgaff.edu كان يشير لخادم موقع الجامعة (207.244.121.250) — يجب تغييره ليشير لنشر التطبيق.
- الكود جاهز: _layout.tsx (host verify-only) + api.ts (توجيه API) + CORS في server.py.
- المتبقي على المستخدم: سجل DNS في Opalstack + Custom Domain في منصة النشر + تحديث verify_base_url من إعدادات الإفادات.
