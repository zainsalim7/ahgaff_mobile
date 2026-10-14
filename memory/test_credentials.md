# Test Credentials

## Admin
- Username: admin
- Password: admin123

## Dean
- Username: Salim
- Password: test1234  (تم إعادة التعيين 2026-06-20 لاختبار RBAC)
- custom_permissions: manage_fee_receipts (أُضيفت 2026-09 لاختبار نطاق السندات المالية)
- 2026-10-06: أُضيفت صلاحيات HR (hr_view/manage_employees, hr_manage_org/leaves/attendance) + **hr_scope=UNITS على «كلية البنات»** لاختبار نطاق الوحدة — يرى موظف واحد (Saeed) فقط. لإلغاء: PUT /api/hr/users/698f71ba5c5620a4449eeb7e/scope {hr_scope:'ALL'}
- 2026-10-06 (المرحلة ب): custom_permissions += hr_manage_tasks, hr_manage_appraisals (لاختبار نطاق المهام/التقييمات). سكربت الاختبار: `python3 backend/tests/test_hr_scope_stage_b.py`

## Department Head
- Username: Saeed
- Password: test1234  (تم إعادة التعيين 2026-06-20 لاختبار RBAC)
- Department: الدراسات الإسلامية / كلية البنات
- custom_permissions: manage_fee_receipts (أُضيفت 2026-09 لاختبار نطاق السندات المالية)
- 2026-10-06: أُضيفت صلاحيات HR (hr_view/manage_employees, hr_manage_org/leaves/attendance) + **hr_scope=UNITS على «كلية البنات»** لاختبار نطاق الوحدة — يرى موظف واحد (Saeed) فقط. لإلغاء: PUT /api/hr/users/698f71ba5c5620a4449eeb7e/scope {hr_scope:'ALL'}

## View-Curriculum Test User (Added 2026-06-26)
- Username: view_curr_user
- Password: test1234
- Role: employee
- Faculty: كلية الشريعة والقانون · Department: الشريعة والقانون
- Actual permissions (15): view_students, report_warnings, view_attendance, manage_students,
  report_absent_students, export_reports, view_curriculum, edit_student, report_student,
  view_lectures, add_student, import_students, delete_student, import_data, view_reports
- Purpose: اختبار ظهور رابط "الخطة الدراسية" و"الإعدادات الأساسية" + النطاق الكلوي

## Teacher
- Username: teacher180156
- Password: teacher123  (أُعيد تعيينها 2026-08-09)

## Teacher 2 (حسن صالح — لديه مقررات في فصول متعددة، مثالي لاختبار فلترة الفصول)
- Username: 9999
- Password: teacher123  (أُعيد تعيينها 2026-08-09)

## Student (يدخل بأي من الخيارين)
- Username: 234   (رقم القيد)
- أو: AUB2501234   (الرقم المرجعي)
- Password: 234
- ⚠️ ملاحظة: هذا الحساب حالته "خريج" ولا يستطيع تسجيل الدخول

## Student 2 (نشط — لاختبار رسوم الطالب، أُنشئ 2026-06)
- Username: 1001   (رقم القيد)
- Password: test1234

## ملاحظة جديدة (2026-06-02):
الدخول الآن يدعم 3 طرق:
1. `username` (اسم المستخدم العادي)
2. `student_id` (رقم القيد) — إن كان فريداً
3. `reference_number` (الرقم المرجعي) — فريد دائماً

عند **تكرار رقم القيد**: يجب على الطالب استخدام **الرقم المرجعي**.

## Reference numbers لطلاب الاختبار (لاختبار الدخول بالرقم المرجعي):
- 1001 → AUB2501001
- 1002 → AUB2501002
- 1003 → AUB2501003

## Student Account (Added 2026-07-29)
- Username: 234
- Password: test1234
- Student: خالد (خريج/alumni — بطاقته تظهر "لم تعد سارية" وهذا سلوك صحيح)

## تحديث (2026-06): حساب الطالب
- Username: 234 / Password: 234 — أُعيد تعيين كلمة المرور (تُخزن في الحقلين password وhashed_password) وتم التحقق من الدخول.

## University President — رئيس الجامعة (اطلاع فقط، أُنشئ 2026-09)
- Username: president
- Password: test1234
- Role: university_president (role_id 698c93119a944c07ac7f80c1 «رئيس الجامعة») — نطاق الجامعة كلها، أي POST/PUT/DELETE → 403 «حسابك للاطلاع فقط»

## Fee staff (موظفو السندات حسب نوع الرسوم — أُنشئوا 2026-09)
- fee_dorm / test1234 — employee، كلية الشريعة والقانون، custom_permissions: manage_fee_receipts, view_students — مسؤول عن «رسوم السكن الداخلي»
- fee_general / test1234 — employee، نفس الكلية — مسؤول عن «تجديد القيد الدراسي»

## HR (شؤون الموظفين) — 2026-09
- صلاحيات جديدة: hr_view_employees / hr_manage_employees / hr_manage_org (admin يملكها ضمنياً)
- إنشاء حساب موظف من شاشة سجل الموظفين: اسم المستخدم = كلمة المرور الأولية = الرقم الوظيفي (must_change_password=true, role=employee)

## HR Self-Service Test Accounts (Added 2026-09-23, role: employee)
- Username: EMP-100 / Password: EMP-100  (موظف تجريبي — مديره المباشر EMP-200)
- Username: EMP-200 / Password: EMP-200  (مدير تجريبي — يرى "طلبات فريقي" في /hr-my-leaves)
- Note: must_change_password=true but not enforced on web.
- EMP-300 / EMP-300 (موظف تجريبي ثالث — بلا دور إداري حالياً؛ يمكن إسناد دور من درج الموظف)

> ⚠️ تنبيه للاختبار: إنشاء/تعديل موظف مرتبط بحساب admin عبر `PUT /hr/employees/{id}` يُزامن `full_name` إلى حساب المستخدم — لا تنشئ موظفاً باسم اختباري مرتبطاً بـ admin عبر API (أنشئه مباشرة في Mongo واحذفه). اسم admin الصحيح: «مدير النظام».

## 📜 نظام المراسلات الرسمية (Phase 1)
- admin / admin123 → SUPER_ADMIN + UNIVERSITY_WIDE تلقائياً (role=admin). لا توجد عضويات تنظيمية أخرى مبذورة؛ تُنشأ من /corr-roles (العضويات) أو عبر pytest (مؤقتة وتُحذف).

## ✉️ الخطابات الرسمية (2026-10-07)
- الوصول: صلاحية `issue_letters` (مزروعة في أدوار dean/department_head/registrar/registration_manager) أو `hr_manage_correspondence`/`hr_manage_employees`. تعديل الكليشة/القوالب: `manage_letter_settings` (admin فقط افتراضياً).
- Salim: يرى خطابات طلاب كلية الشريعة + موظفي نطاق HR (كلية البنات) + ما أصدره + العامة. Saeed: بلا كلية → العامة + ما أصدره + موظفو كلية البنات.
- الكليشات/السلاسل: `/api/letterheads`, `/api/letter-series` — المالك أو الأدمن يعدّل؛ الافتراضية العامة «الكليشة العامة»/«الترقيم العام» (system_key=general).

## تبادل المحاضرات (2026-10-14)
- اختبار E2E: `python backend/tests/test_lecture_swaps_flow.py` — يستخدم teacher180156/teacher123 (طالب التبادل)، 9999/teacher123 (الزميل)، Saeed/test1234 (رئيس القسم المعتمد). يزرع محاضرتين مؤقتتين ويحذفهما.
