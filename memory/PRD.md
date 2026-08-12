# PRD — نظام إدارة الطلاب والمعلمين لجامعة الأحقاف

## المشكلة الأصلية
نظام شامل لإدارة الطلاب والمعلمين لجامعة الأحقاف: باكند مشترك (FastAPI/MongoDB)، تطبيق ويب إداري (React Native Web / Expo Router)، وتطبيقات موبايل مستقلة. يشمل: RBAC، إدارة الجداول، الحضور، المناهج الديناميكية، إدارة متعددة الكليات، الوثائق الرقمية (إفادات PDF مع QR، بطاقة طالب رقمية، شهادات تخرج)، ودورة حياة الفصول الدراسية. الواجهة بالعربية بالكامل.

## البنية
- Backend: `/app/backend/backend/server.py` (قديم/ضخم) + `/app/backend/backend/routes/*` (weekly_schedule, statements, schedule_import, student_transfer, teaching_load...)
- Frontend: `/app/frontend/app/*` (expo router) + `/app/frontend/src/components/MasterScheduleView.tsx`
- نشر خارجي للمستخدم: Railway (railway.toml + Dockerfile) مع دومينات ahgaff.net / api.ahgaff.net

## المنجز (آخر تحديث: 2026-06 — جلسة الفورك الحالية)
- ✅ إصلاح تصدير الجدول (PDF/Excel) لعرض الأوقات المخصصة duration_minutes في **4 مسارات**: export-visual/pdf، export-visual/excel، master-view/export/pdf، master-view/export/excel (اختبار: 14/14 ناجح، iteration_67)
- ✅ إضافة duration_minutes لاستجابة GET /api/weekly-schedule
- ✅ إصلاحات جاهزية النشر: SECRET_KEY إلزامي من env، CORS regex لدومينات emergent + ALLOWED_ORIGINS="*"، متغيرات Expo في frontend/.env، دعم emergent.host في api.ts، رفع healthcheckTimeout في railway.toml إلى 300
- (جلسات سابقة): المدد المخصصة في الجدول الشامل + استيراد Excel، عرض جدول القاعات، تصدير جداول جميع المعلمين، أختام وتواقيع الإفادات، نقل الطلاب، أدوات إصلاح تكامل الجدول، العبء التدريسي، الإجراءات الجماعية للمعلمين

## ⚠️ ملاحظات نشر مهمة
- **Railway**: يجب تعيين SECRET_KEY في Railway → Service → Variables (لم يعد له fallback في الكود). القيمة السابقة: `ahgaff-university-secure-key-2026-x9f8k2m5n7p3q1w4`
- فحص النشر (Emergent) يمر في كل البنود؛ التحذير الوحيد المتبقي هو اقتراح --tunnel لسوبرفايزر Expo وهو غير قابل للتطبيق (التطبيق يُنشر كويب)

## Backlog
### P1
- إرسال جدول كل معلم عبر إشعار push (FCM) — البنية موجودة
- شاشة المكتبة في تطبيق الطالب (بدل "قريباً")
- مشاركة/حفظ البطاقة الرقمية كصورة/PDF
- دخول الطلاب الوافدين برقم الجواز
### P2
- توليد جماعي لشهادات التخرج لدفعة كاملة في PDF واحد
- شارة تحذير لقرب انتهاء صلاحية الإفادات في السجل
- المرحلة 2 من تفكيك server.py (نقل Reports API)
- ملاحظة مراجعة: توحيد منطق إلحاق الوقت المخصص في التصدير بهيلبر واحد؛ الماستر يعرض items[0] فقط لكل خلية
