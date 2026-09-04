# Test Credentials

## Admin
- Username: admin
- Password: admin123

## Dean
- Username: Salim
- Password: test1234  (تم إعادة التعيين 2026-06-20 لاختبار RBAC)

## Department Head
- Username: Saeed
- Password: test1234  (تم إعادة التعيين 2026-06-20 لاختبار RBAC)
- Department: الدراسات الإسلامية / كلية البنات

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
