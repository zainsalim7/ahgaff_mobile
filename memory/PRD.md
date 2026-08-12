# Ahgaff University Management System – PRD

## Original Problem Statement
Comprehensive student/teacher management system for Ahgaff University with:
- Shared FastAPI backend (MongoDB Atlas)
- Admin web/Expo app
- Standalone mobile apps
- Granular RBAC, schedule management, attendance tracking
- Modern, professional Arabic UI
- Advanced academic hierarchy (Curriculum → Teaching Assignments → Semester Offerings)
- Student status management (Active, Repeat, Graduated, Expelled, Frozen)
- Verifiable digital reporting (PDF + QR)
- Parallel deployments: Railway + Google Cloud Run


## Implemented (selected, recent)
- 2026-07-05 **🗓️ شبكة تفضيلات المعلمين (يوم × فترة) — دقة أعلى**:
  - **الحاجة**: النموذج السابق كان يفصل بين "أيام لا يعمل فيها" (يوم كامل) و"فترات لا يعمل فيها" (تُطبَّق على كل الأيام). لم يكن يمكن قول: "الأحد فترتان محددتان + الاثنين يوم كامل + الثلاثاء فترة واحدة".
  - **الإصلاح**:
    - **Backend** (`routes/weekly_schedule.py`):
      - حقل جديد `unavailable_periods: List[{day, slot_number}]` — مصدر الحقيقة.
      - دالتان مساعدتان `_derive_unavailable_periods` و `_is_period_unavailable` لدمج الشبكة الجديدة + الحقول القديمة.
      - `GET /teacher-preferences/{id}` يُرجع الشبكة (مشتقّة تلقائياً من القديم إن لزم).
      - `PUT /teacher-preferences/{id}` يحفظ الشبكة، ويشتقّ منها `unavailable_days` و `unavailable_slots` القديمة تلقائياً (للتوافق الرجعي مع أي كود قديم أو نشر سابق على Cloud Run).
      - **المولّد التلقائي** وفحص التعارض في `create_slot` يعتمدان الآن على `_is_period_unavailable` (دقة أعلى + رسالة تعارض أوضح).
    - **Frontend** (`app/weekly-schedule.tsx`):
      - استُبدلت كتلتا "أيام" و"فترات" المنفصلتان بجدول شبكي تفاعلي (أيام × فترات) مع:
        - نقر خلية → تلوينها.
        - عمود "يوم كامل" → قلب كل خلايا الصف دفعة واحدة.
        - عدّاد سفلي للخلايا المحظورة.
  - **التحقق**: curl PUT + GET أثبت الحفظ + استخراج توافقي تلقائي (7 خلايا مختلطة → `unavailable_days=['الأحد']`, `unavailable_slots=[]`).


  - **ما أبلغ عنه المستخدم**: مستخدم يملك صلاحيات على عدة أقسام (`department_ids`) لا يستطيع تعديل/إلغاء إسناد مقرر إن كان مسنداً لمدرس من قسم آخر، وتظهر الشارة "للعرض فقط".
  - **السبب الجذري** (ثلاث طبقات):
    1. `/app/frontend/app/teacher-courses.tsx` كانت تقارن `user.department_id` (مفرد) بقسم المقرر.
    2. `/app/backend/backend/routes/teaching_load.py` `_ensure_course_in_user_scope` تقارن مفرداً كذلك، و `delete_teaching_load` يكرّر نفس المنطق.
    3. `/app/backend/backend/routes/deps.py` `get_current_user` و `/api/auth/me` و `/api/auth/login` **لم تكن تُرجع `department_ids/faculty_ids` كمصفوفات أصلاً** — لذا حتى بعد إصلاح المقارنة كانت المصفوفة تبقى فارغة.
  - **الإصلاح**:
    - Frontend (`teacher-courses.tsx` ~L67-91): `canManageCourse` يستخدم الآن `user.department_ids` (مع fallback لـ `department_id` المفرد) ويشمل دور `university_president`.
    - Backend (`teaching_load.py` L30-82): `_ensure_course_in_user_scope` يعمل بـ `$in` على `department_ids` و `faculty_ids`؛ و `delete_teaching_load` أصبح يستدعي نفس الدالة (توحيد المنطق).
    - Backend (`deps.py` L194-215): `get_current_user` يُرجع الآن `department_ids` و `faculty_ids` مع fallback backward-compat للمفرد.
    - Backend (`auth.py`): استجابتا `POST /auth/login` و `GET /auth/me` تُرجعان `department_ids`, `faculty_ids`, و `department_names`.
  - **التحقق**: `testing_agent_v3_fork` (iteration_57) — 9/9 backend tests + regression clean. ملف اختبار: `/app/backend/tests/test_teaching_load_multi_dept_scope.py`.


- 2026-07-05 **🔐 إصلاح صلاحيات الأقسام المتعددة لـ registration_manager/registrar**:
  - **ما أبلغ عنه المستخدم**: عند منح مستخدم (خاصة registration_manager) صلاحيات على **عدة أقسام** في كلية واحدة عبر `department_ids`، يرى قسماً واحداً فقط. أو عند منح كلية كاملة قد لا يرى كل أقسامها.
  - **السبب الجذري** في `server.py` دالة `get_user_scope_filter`: فرع `registration_manager` و `registrar` كان يعتمد على `faculty_id` فقط ويتجاهل `department_ids` تماماً (بعكس `custom` و `department_head` و `employee` الذين يدعمانه).
  - **الإصلاح** (السطور ~895-928): توسيع الفرع بأولوية:
    1. `department_ids` (list) → فلترة بأقسام محددة (`$in`).
    2. `department_id` (single legacy) → قسم واحد.
    3. `faculty_id` → كل أقسام الكلية.
    4. لا شيء → منع كل الوصول (fail-safe).
  - **الواجهة**: `manage-users.tsx` تدعم اختيار أقسام متعددة أصلاً — لا تعديل مطلوب.
  - **التحقق**: `testing_agent_v3_fork` — **9/9 اختبار ناجح** (Multi-dept, Single, Faculty-only, Fail-safe, registrar).
  - **ملف اختبار جديد**: `/app/backend/tests/test_registration_manager_multi_dept_scope.py`.

- 2026-07-04 **➕ إجراءات المقررات في `/students` (نسخ / نقل / إلغاء تسجيل)**:
  - **الحاجة**: نقل الإجراءات الثلاثة الموجودة في `/course-students` (زر "نسخ إلى مقرر" الأزرق، "نقل إلى مقرر" البرتقالي، "إلغاء تسجيل" الأحمر) إلى الصفحة الرئيسية `/students` ليعمل عليها الأدمن على مستوى الطلاب مباشرة.
  - **Frontend** (`/app/frontend/app/students.tsx`):
    - إضافة 3 أزرار في شريط الإجراءات الجماعية (تظهر عند تحديد طلاب) بنفس الألوان.
    - مودال موحّد ديناميكي:
      - **نسخ**: قائمة مقررات hedef (اختيار متعدد) → `POST /enrollments/bulk-copy`.
      - **نقل**: قسمان — المقرر المصدر (اختيار واحد) + المقرر الهدف (اختيار واحد) → `POST /enrollments/bulk-move`.
      - **إلغاء تسجيل**: قائمة مقررات (اختيار متعدد) → حلقة `DELETE /enrollments/{course}/{student}` لكل طالب × كل مقرر مختار.
    - شريط بحث داخل المودال لتصفية المقررات بالاسم أو الكود.
  - **Backend**: يستخدم endpoints موجودة بالفعل (`/enrollments/bulk-copy`, `/enrollments/bulk-move`, `/enrollments/{course_id}/{student_id}`) — لا تعديل مطلوب.
  - **التحقق**: لقطة UI أثبتت تحميل الصفحة بدون أخطاء + الأزرار تظهر في شريط الإجراءات عند تحديد طلاب.

- 2026-07-04 **🆕 صفحة "حالات الطالب (غير المستمرين)"**:
  - **الحاجة**: جدول موحّد للطلاب في حالات: مجمَّد / إعادة / مفصول — مع الاحتفاظ ببيانات الطالب لحظة تغيير الحالة.
  - **Backend** في `/app/backend/backend/routes/student_status.py`:
    - **حفظ snapshot** في `_apply_status_change` عند أول انتقال لحالة غير نشطة: `{level, section, semester_id, semester_name, academic_year, academic_year_id, department_id, faculty_id, captured_at}`. يُلتقط مرة واحدة فقط ولا يُعدَّل لاحقاً.
    - **`GET /api/student-statuses`**: قائمة موحّدة بفلاتر (status ∈ frozen/repeat/expelled/all + faculty_id + department_id + q).
    - **`POST /api/student-status/{id}/restore`**: يستقبل `{new_level: 1-4, new_section, reason}` ويعيد الطالب لـ status=active + is_active=true + المستوى/الشعبة الجديدة + يحذف snapshot.
    - **`GET /api/student-status/available-sections?department_id=X`**: يعيد `{levels: [1..4], sections: [...]}` للمودال.
  - **Frontend** `/app/frontend/app/student-statuses.tsx`:
    - 4 تبويبات + بحث + Pull-to-refresh.
    - بطاقة كل طالب: الحالة الملوّنة، الاسم، الرقم، القسم، صندوق snapshot يعرض المستوى/الشعبة/الفصل/العام لحظة التغيير، السبب.
    - زر "إعادة إلى النشط" يفتح مودال باختيار المستوى (1-4) والشعبة (من قائمة ديناميكية للقسم) + ملاحظة.
    - رابط ثابت في `admin.tsx` باسم "حالات الطالب".
  - **الميزة الجماعية**: في `/students`، زر "تغيير الحالة" موجود مسبقاً — يفتح مودال باختيار الحالة (مجمد/إعادة/مفصول) + السبب.
  - **التحقق**: `testing_agent_v3_fork` iteration 54 كشف عن bug (`.get('year')` بدلاً من `.get('academic_year')`) — تم الإصلاح فوراً. اختبار Verification E2E عبر curl: snapshot يُحفَظ صحيحاً مع `academic_year: "2024-2025"` من الفصل النشط ✓.

- 2026-07-04 **🎓 إصلاح جذري لمشكلات جدول الخريجين (Alumni)**:
  - **ما أبلغ عنه المستخدم**:
    1. تخريج طلاب من قسم "شريعة وقانون" → يظهرون في جدول الخريجين تحت قسم مختلف. عند استرجاعهم يعودون لقسم خاطئ.
    2. النقل الجماعي (bulk-graduate) يفشل لبعض الطلاب بدون تفصيل السبب.
  - **السبب الجذري**:
    - `list_alumni` كان يعتمد lookup مباشر على `department_id` الحالي — أي تغيير لاحق في هذا الحقل (سواء بخطأ إدخال أو دمج/إعادة تسمية القسم) يُبدّل اسم القسم المعروض للخريج.
    - الاسترجاع لم يكن يعيد `department_id` الأصلي فيبقى الطالب في القسم الخاطئ.
    - الواجهة كانت تعرض فقط عدد "فشل" بدون تفاصيل عن الطلاب المتأثرين والأسباب.
  - **الإصلاحات في `/app/backend/backend/routes/alumni.py`**:
    - دالة جديدة `_resolve_dept_faculty_snapshot()` تحفظ اسم القسم/الكلية + IDs في `graduation_data.department_snapshot`.
    - `graduate_student` و `bulk_graduate_students` يستدعيان الـ helper ويحفظان snapshot لحظة التخرج.
    - `list_alumni` يعطي **أولوية الـ snapshot** على الـ lookup الحالي — لا يتأثّر بأي تعديل لاحق على `department_id`.
    - `list_alumni` الفلاتر (faculty_id/department_id/q) تُطابق الآن كلاً من الحقل الحالي والـ snapshot (عبر `$or/$and` مركّبة).
    - `restore_alumni_to_student` يعيد `department_id/faculty_id` إلى قيم الـ snapshot عند الاسترجاع.
  - **Migration جديدة**: `backfill_alumni_department_snapshot_internal` في `server.py` تعمل عند startup — تعبّئ snapshot للخريجين القدامى الذين خرّجوا قبل هذا الإصلاح (idempotent، تعمل مرة واحدة عملياً + تعلّم كل سجل بـ `backfilled=true`).
  - **Frontend**: `students.tsx` يعرض الآن قائمة تفصيلية بأسماء أول 5 طلاب فشل تخريجهم مع سبب فشل كل واحد + طلاب تُجاوزوا (متخرج بالفعل).
  - **التحقق**: `testing_agent_v3_fork` iteration 53 — **8/8 اختبار ناجح**:
    - Bulk graduate يحفظ snapshot صحيح ✓
    - Tampering على `department_id` لا يؤثر على العرض ✓
    - Restore يُعيد الطالب لقسمه الأصلي حتى لو تعرّض للتلاعب ✓
    - Backfill migration idempotent ✓
    - Failed[] يحوي `{id, error}` واضحة + Skipped[] للمتخرج مسبقاً ✓
  - **ملف اختبار جديد**: `/app/backend/tests/test_alumni_department_snapshot.py` (8 اختبارات).

- 2026-07-01 **➕ P2 مُنجَز: `/my-attendance-requests` + بادج طلبات الاعتماد للعميد**:
  - **الصفحة الجديدة**: `/app/frontend/app/my-attendance-requests.tsx`
    - 5 تبويبات: الكل / قيد الانتظار / معتمد / مرفوض / ملغى.
    - بطاقة لكل طلب: اسم الطالب + المقرر + المحاضرة + التغيير المقترح (قديم → جديد) + الحالة الملوّنة + السبب + ملاحظات المراجع.
    - زر "إلغاء الطلب" يظهر فقط للطلبات المعلّقة.
    - Pull-to-refresh + عرض فارغ ذكي حسب الفلتر.
    - تعمل عبر `GET /api/attendance-changes/mine` و `DELETE /api/attendance-changes/{id}` (endpoints موجودة سابقاً).
  - **البادج الجديد**: أيقونة الإعدادات في الشريط السفلي:
    - بادج أصفر (#ff9800) في الجهة اليسرى يعرض `approvalCount` للعميد + المدير فقط.
    - Polling كل 60 ثانية عبر `GET /api/attendance-changes/pending-count`.
    - يتعايش مع بادج الـ offline sync الأحمر في الجهة اليمنى (لا تعارض بصري).
    - Cap: 99+ للأعداد الكبيرة.
  - **رابط الوصول**: أيقونة جديدة في `admin.tsx` باسم "طلباتي لتعديل الحضور" (icon: time، لون سماوي) لكل من له `edit_attendance` أو `manage_attendance`.
  - **التحقق**: لقطة UI تُظهر الصفحة تعمل بجميع التبويبات + الرسالة الفارغة الأنيقة.

- 2026-07-01 **🆕 نظام اعتماد العميد على تعديلات الحضور خارج المهلة**:
  - **الحاجة**: بعد انتهاء نافذة `attendance_edit_minutes` من إعدادات الكلية، فقط من يملك صلاحية `edit_attendance` (bypass) يستطيع التعديل. المستخدم طلب أن تُحفَظ تعديلات هؤلاء (الجميع ما عدا ADMIN/DEAN) كطلبات معلّقة تنتظر اعتماد العميد.
  - **الصلاحية الجديدة**: `APPROVE_ATTENDANCE_CHANGES` تُمنَح تلقائياً للعميد + المدير عبر migration في `sync_default_roles`.
  - **Backend**:
    - Collection جديد: `attendance_change_requests` (attendance_id, lecture_id, course_id, student_id, faculty_id, old_status, new_status, reason, requested_by, status ∈ {pending,approved,rejected,cancelled}).
    - Route جديد `/app/backend/backend/routes/attendance_approval.py`:
      - GET `/attendance-changes` (فلترة تلقائية حسب كلية العميد)
      - GET `/attendance-changes/pending-count` (للبادج)
      - GET `/attendance-changes/mine` (لمقدّم الطلب)
      - GET `/attendance-changes/lecture/{id}/pending` (شارات ⏳ على الصفحة)
      - POST `/attendance-changes/batch/approve` و `/batch/reject`
      - POST `/attendance-changes/{req_id}/approve` و `/reject`
      - DELETE `/attendance-changes/{req_id}` (إلغاء ذاتي)
    - تعديل `POST /attendance/session` في server.py: إذا اكتشف `is_bypass_edit=True` وكان user ليس ADMIN/DEAN → يستدعي `create_change_requests_for_diff` بدلاً من التطبيق المباشر ويُرجع `{status: "pending_approval", request_ids}`.
    - تعديل `PUT /attendance/{record_id}/status`: نفس المنطق للتغيير الفردي.
  - **Frontend**:
    - صفحة جديدة `/attendance-approvals` (تبويبات: قيد الانتظار / معتمد / مرفوض / الكل + اعتماد/رفض جماعي + مودال ملاحظات الرفض).
    - في `/take-attendance`: تنبيه أصفر "أنت تعدّل خارج المهلة" + شارات ⏳ بجانب الطلاب الذين لديهم طلبات معلّقة + رسالة "تم إرسال N تعديل لاعتماد العميد" بعد الحفظ.
    - أيقونة جديدة في `admin.tsx` تحت "الحضور وبطاقات الطلاب".
  - **التحقق**: `testing_agent_v3_fork` iteration 52 كشف عن bugs (route ordering + admin bypass) — تم الإصلاح بعده:
    - **Fix 1**: إعادة ترتيب مسارات `/batch/{approve,reject}` قبل `/{req_id}/{approve,reject}` لتفادي captured كـ path param.
    - **Fix 2**: `PUT /attendance/{record_id}/status` — إضافة استثناء صريح للـ ADMIN لأن `edit_attendance` في `TEACHER_ONLY_PERMISSIONS` لا يُمنَح تلقائياً للمدير عبر `has_permission`.
    - **النتيجة النهائية**: pytest — **18/18 اختبار ناجح** (E2E pending→approve/reject، Faculty scope، Self-cancel، داخل النافذة → مباشر، Idempotency، Batch، Badge، Dept-head → pending، Sibling dept-head لا يعتمد، ADMIN بلا اعتماد، DEAN بلا اعتماد).
  - **ملف اختبار جديد**: `/app/backend/tests/test_attendance_approval.py` (18 اختبار).

- 2026-06-29 **🔄 توحيد عدّاد المقررات/النصاب بين `/manage-teachers` و `/teacher-courses`**:
  - **ما أبلغ عنه المستخدم**: قائمة المعلمين تُظهر "النصاب = 0 س" و "المقررات = 0" لمعلمين فعلياً يدرّسون (مثلاً زين سالم له 3 مقررات / 9 س في صفحته الفردية).
  - **التشخيص**: `GET /api/teachers` كان يحسب من `teaching_loads` فقط في الفصل النشط. إن كان للمقرر `teacher_id` بدون سجل `teaching_load` مطابق، يخسر العداد. أما `GET /api/teachers/{id}/courses` فيستخدم UNION (`courses.teacher_id ∪ teaching_loads.course_id`) → نتائج متناقضة.
  - **الإصلاح** في `server.py` (lines 4278-4316):
    - استبدلنا الحلقة أحادية المصدر بـ UNION بين `loads_map` و `active_courses_map` على مفتاح `(teacher_id, course_id)`.
    - أولوية للساعات: `weekly_hours` من teaching_load → fallback لـ `credit_hours` من المقرر (يشمل حالة `weekly_hours==0`).
    - تم تنسيق نفس fallback في detail endpoint (line 4565) لضمان التطابق 100%.
  - **التحقق**: `testing_agent_v3_fork` iteration 51 — **9/9 ناجح**:
    - cross-page consistency على 60+ معلم ✓
    - حالات الحدود: مقرر بـ `teacher_id` فقط (بلا load) → يُحتسب ✓
    - حالة عكسية: load بلا `teacher_id` على المقرر → يُحتسب أيضاً ✓
    - فصول قديمة لا تلوّث الفصل النشط ✓
    - Idempotency + Multi-teacher integrity ✓
  - **ملف اختبار جديد**: `/app/backend/tests/test_teachers_list_union_counts.py`.

- 2026-06-29 **🧹 إصلاح ثلاثي لمشكلات صفحة "العبء التدريسي" (شبحية، فارغة، مكررات)**:
  - **المشاهدات التي أبلغ عنها المستخدم**:
    1. تقرير PDF يُظهر مقررات من فصول مؤرشفة في جدول الفصل النشط.
    2. صفوف فارغة بلا اسم مقرر في الجدول و PDF.
    3. مكررات: نفس (المعلم، المقرر) يظهر مرتين في نفس الفصل.
    4. صفحة `/teacher-courses` لنفس المعلم لا تُظهر هذه السجلات الشبحية (صحيح، تستخدم استعلاماً مختلفاً).
  - **الإصلاحات الثلاث**:
    1. **GET `/api/teaching-load`** (lines ~146-160 في `routes/teaching_load.py`): يتجاوز السجلات التي `course` فيها محذوف أو `is_active=False` → لا صفوف شبحية.
    2. **`_get_export_data`** (lines ~813-826): نفس الفلتر يُطبَّق على تصديرات PDF/Excel → لا أسماء فارغة.
    3. **Startup migrations جديدة في `server.py`**:
       - `cleanup_orphan_teaching_loads_internal()`: يحذف نهائياً سجلات teaching_loads التي تشير لمقرر محذوف أو غير نشط.
       - `dedup_teaching_loads_internal()`: aggregate على (teacher, course, semester) ويحذف المكررات مع الاحتفاظ بالأحدث (أكبر `_id`).
  - **Endpoint يدوي جديد**: `POST /api/teaching-load/cleanup-orphans` (يحتاج `MANAGE_TEACHING_LOAD`) — يُرجع `{success, deleted_missing_course, deleted_inactive_course, total_deleted, total_checked, message}`.
  - **التحقق**: `testing_agent_v3_fork` iteration 50 — **23/23 ناجح** (9 جديدة + 14 regression):
    - السجلات اليتيمة (مقرر محذوف/غير نشط) تختفي من GET واللائحة والتصدير ✓
    - Endpoint يحذفها فعلياً + Idempotency ✓
    - Dedup يحتفظ بالأحدث ويحذف القديم ✓
    - عدم تأثُّر السجلات السليمة + اختبار `all_semesters=true` يكشف فصول قديمة ✓
  - **الأثر الفوري على بيئة preview**: حذف Dedup سجلين مكررين، اللائحة الآن تُظهر 2 بدلاً من 4 (نظيفة).
  - **ملف اختبار جديد**: `/app/backend/tests/test_teaching_load_orphan_dedup.py`.

- 2026-06-29 **🚨 إصلاح حرج (P0): العبء التدريسي لا يظهر إلا بعد ساعة** (تابع لـ iteration 48):
  - **السبب الجذري**: واجهة `teaching-load.tsx` (handleSave) ترسل `{teacher_id, course_id, weekly_hours}` فقط بدون `semester_id`. كان endpoint `POST /api/teaching-load/bulk` يُدخل السجل بـ `semester_id=null` → `GET /api/teaching-load` (افتراضياً يفلتر بالفصل النشط) لا يُظهره. عند إعادة تشغيل Cloud Run بعد ~1 ساعة من الخمول، يعمل startup backfill ويُحاذي `load.semester_id = course.semester_id` (الفصل النشط لمعظم المقررات) → فجأة يظهر. هذا فسّر تأخير الساعة بدقّة.
  - **الإصلاح** في `/app/backend/backend/routes/teaching_load.py` (دالة `bulk_save_teaching_load`):
    1. يحلّ `effective_sem_id = item.semester_id || course.semester_id || active_semester_id` (3-tier fallback).
    2. إن لم يكن للمقرر `semester_id` (orphan): يُرقّيه تلقائياً للفصل النشط قبل الإدراج، حتى لا يعكس startup backfill القرار لاحقاً.
    3. المقررات المنتمية لفصل قديم/مغلق فعلاً تبقى كما هي (لا يتم ترحيلها بصمت).
  - **التحقق**: `testing_agent_v3_fork` iteration 49 — 14/14 اختبار ناجح (7 جديدة + 7 regression):
    - Step 2-3: السجل الجديد يظهر فوراً + `load.semester_id == active` ✓
    - Step 4: مقرر يتيم → load و course كلاهما يُنقلان للفصل النشط ✓
    - Step 5: مقرر بفصل قديم → load يبقى في الفصل القديم (لا ترحيل صامت) ✓
    - Step 6: Idempotency ✓ — Step 7: Backfill-safety ✓ — Step 8: Conflict detection ✓
  - **ملف الاختبار الجديد**: `/app/backend/tests/test_teaching_load_bulk_semester_fix.py`.

- 2026-06-29 **✅ تأكيد إصلاح regression عرض Teaching Load في الفصل النشط (P0)**:
  - **المشكلة الأصلية**: سكربت backfill القديم كان يعيّن `active_semester_id` كقيمة افتراضية لجميع سجلات `teaching_loads` التي لا تملك `semester_id` → أدى لظهور إسنادات تدريسية تاريخية قديمة داخل عرض الفصل النشط.
  - **الإصلاح**: في `server.py` (دالة `backfill_teaching_loads_semester_internal` سطور 15190-15238) و `routes/teaching_load.py` (مسار `POST /teaching-load/backfill-semester` سطور 929-974) — يُحاذي semester_id لكل سجل مع `course.semester_id` فقط. إن كان `course.semester_id = None` يُعاد سجل العبء إلى null (orphan) بدلاً من إلصاقه بالفصل النشط.
  - **التحقق**: `testing_agent_v3_fork` iteration 48 — جميع الاختبارات السبعة نجحت (100%):
    1. Startup migration يعمل بدون استثناءات ✓
    2. Endpoint يعيد 200 مع JSON الكامل ✓
    3. Idempotency (الاستدعاء الثاني = 0 تغييرات) ✓
    4. كل 9 سجلات في DB: `load.semester_id == course.semester_id` (0 تباين) ✓
    5. الفصل النشط: 4 سجلات، 0 منها ينتمي مقرره لفصل قديم ✓
    6. السجلات اليتيمة (course بلا semester) → semester_id=null ✓
    7. `GET /teaching-load?semester_id=<active>` يرجع فقط مقررات تنتمي فعلاً للفصل النشط ✓
  - **ملف اختبار regression دائم**: `/app/backend/tests/test_teaching_load_semester_backfill.py` (7 tests, all passing).

- 2026-06-26 **🛠️ صفحة "الإعدادات الأساسية" (إعادة بناء `(tabs)/admin.tsx`)**:
  - **السبب**: توحيد رابط البار السفلي مع الصفحة الرئيسية كان غير منطقي وفقد المستخدمون الوصول لكثير من الأدوات
  - أُعيد بناء `(tabs)/admin.tsx` كصفحة أدوات إدارية موحّدة باسم "الإعدادات الأساسية"
  - 7 أقسام منظّمة: الإدارة الأكاديمية / التقويم والجداول / التقارير المتقدّمة / النتائج والإشعارات / الحضور وبطاقات الطلاب / إعدادات النظام / أدوات الصيانة
  - ضمّت كل الأدوات المفقودة من القائمة الجانبية والرئيسية: `manage-study-plan`, `teacher-courses`, `student-references`, `university-calendar`, `calendar`, `availability-report`, `report-course`, `report-absent-students`, `report-teacher-summary`, `report-lesson-completion`, `report-daily`, `verify-report`, `send-final-results`, `send-department-results`, `send-notification`, `take-attendance`, `qr-scanner`, `offline-sync`, `permissions`, `student-autofill`, `backfill-*`, `cleanup-*` (≈24 أداة)
  - كل عنصر مفلتر فردياً عبر `hasAnyPermission`/`adminOnly`/`teacherOnly`/`forAll` (RBAC ثابت)
  - تم تحديث `(tabs)/_layout.tsx` (عنوان التبويب والـ header) وعنصر القائمة الجانبية في `SideMenu.tsx` بالاسم الجديد
  - أُضيفت ثوابت `MANAGE_NOTIFICATIONS` و `REPORT_LESSON_COMPLETION` في `PERMISSIONS` بـ `AuthContext.tsx`
  - **2026-06-26 تحسين تصميم**: تحويل التخطيط من قائمة عمودية (rows مع وصف) إلى **شبكة أيقونات مدمجة** (3 أعمدة على الجوال، 5+ على الديسكتوب) — أيقونة + اسم فقط لكل أداة، تمرير سلس مع `showsVerticalScrollIndicator={true}`

- 2026-06-26 **📤 إصلاح صفحة `/send-final-results` بدون courseId**:
  - **المشكلة**: الصفحة كانت تتطلب `?courseId=...` (تُفتح أصلاً من `course-students.tsx`). عند فتحها من "الإعدادات الأساسية" بدون معرف، كانت تجمد في "جارٍ التحميل" للأبد.
  - **الإصلاح**: عند غياب `courseId`، تعرض الآن **شاشة اختيار المقرر** مع بحث وقائمة مقررات (محدودة بنطاق صلاحيات المستخدم). النقر يُحدّث الـ URL ويُحمّل قائمة الطلاب.

- 2026-06-28 **🔄 ميزة نقل الطالب (Student Transfer)**:
  - **Backend** (`routes/student_transfer.py` جديد، مُسجّل في `server.py`):
    - `POST /api/students/{id}/transfer` — نقل فردي
    - `POST /api/students/bulk-transfer` — نقل دفعة
    - `GET /api/students/{id}/transfer-history` — سجل النقل
    - Collection جديد `student_transfer_history` يحفظ snapshot كامل (from/to، السبب، المنفّذ، التاريخ)
    - يحترم `manage_students` + النطاق (department_head ضمن قسمه، dean ضمن كليته)
    - يُلغي enrollments الفصل النشط تلقائياً (لأن الخطة تتغير)
    - يُرسل إشعار للطالب + يُسجّل في `activity_logs`
  - **Frontend** (`student-details.tsx`):
    - زر "نقل الطالب" برتقالي في الإجراءات السريعة (يظهر فقط لغير الخريجين)
    - مودال متكامل: Picker للكلية → Picker للقسم (مفلتر) → المستوى → الشعبة → سبب اختياري
    - عرض الوضع الحالي في الأعلى + عرض سجل النقل السابق (آخر 5)
    - معاينة تلقائية + تحقق من البيانات
  - **التحقق**: backend اختُبر بـcurl (3 سيناريوهات: نفس البيانات يرفض، نقل ناجح، عرض سجل) ✓ — مودال الفرونت يظهر صحيحاً ✓


  - **Excel** (`_export_xlsx` in `routes/curriculum.py`):
    - شريط معلومات في الترويسة (Row 3) يعرض إجمالي الساعات المعتمدة والأسبوعية
    - صف إجمالي بلون أزرق فاتح بعد كل (مستوى, فصل) مع مجموع ساعاته
    - صف إجمالي كلي بلون أخضر في نهاية الجدول
  - **PDF** (`_export_pdf`):
    - شريط totals_style أخضر قرب القمة يعرض الإجمالي الكلي
    - صف "إجمالي ..." في نهاية كل جدول فصل بخلفية زرقاء فاتحة
  - **التحقق**: تصدير Excel و PDF عبر admin token → كلاهما يحتوي الإجماليات بشكل صحيح (17 ساعة معتمدة، التحقق الحسابي 6+5+3+3=17 ✓)


  - **المشكلة**: المستخدم بصلاحية `view_curriculum` كان يرى نفس واجهة `manage_curriculum` مع كل أزرار التعديل/الحذف/الإضافة.
  - **الإصلاح في `app/curriculum.tsx`**:
    - استيراد `useAuth` و `PERMISSIONS` وحساب `canManage = isAdmin || hasPermission(MANAGE_CURRICULUM)`
    - إخفاء شرطي عبر `canManage` لـ: "إضافة مقرر"، "إضافة أول مقرر"، "تحميل نموذج Excel"، "رفع من Excel"، "استيراد من أرشيف"، "توليد للفصل النشط"، "مسح خطة القسم"، شريط الحذف المتعدد، أزرار الحذف الفردية، وخانات إدخال عدد الشُعب (تصبح للقراءة فقط)
    - إضافة شارة **"وضع العرض فقط"** (خضراء، أيقونة عين) في رأس الصفحة
    - **يبقى متاحاً**: "تصدير / طباعة الخطة"، اختيار القسم، التحديث، الإحصائيات، عرض الشبكة
  - **التحقق**: `view_curr_user` يرى 0 أزرار حذف، 0 checkboxes، زر تصدير فقط ✓

- 2026-06-23 **🏷️ إصلاح عرض القسم/الكلية لكل المقررات في صفحة العبء التدريسي**:
  - السبب الجذري: `GET /api/teaching-load/search-courses` كان يُرجع فقط `department_id`، والواجهة تبحث عن الاسم في قائمة `departments` المحلية (المقصورة على نطاق المستخدم). أي مقرر بقسم خارج النطاق أو بـ `department_id` فارغ → لا يظهر اسم القسم/الكلية
  - أُثري الـ Backend بجلب `department_name`/`faculty_id`/`faculty_name` لكل مقرر مباشرة
  - حُدِّثت الواجهة لاستخدام الأسماء من الـ API كأولوية مع fallback للقائمة المحلية
  - الآن كل المقررات تعرض القسم والكلية بشكل صحيح

- 2026-06-23 **🏷️ توحيد أسماء الأدوار العربية في الواجهة**:
  - أنشئ `/app/frontend/src/utils/roleLabels.ts` كمصدر حقيقة وحيد لـ `ROLE_LABELS`/`ROLE_COLORS`/`getRoleLabel()`
  - يدعم: admin, university_president, dean, department_head, registration_manager, registrar, teacher, employee, student, custom
  - حدِّثت الملفات: `(tabs)/profile.tsx`، `src/components/SideMenu.tsx`، `manage-users.tsx`، `verify-report.tsx`
  - الآن `registrar` يظهر "مسجِّل" بدلاً من "مستخدم"، و `employee` يظهر "موظف"، إلخ.
  - الأسماء العربية المخصَّصة من Backend (`role` كاسم بالعربية) تُعرض كما هي

- 2026-06-23 **🔍 إصلاح البحث الشامل للأدوار غير الإدارية**:
  - السبب الجذري: `routes/global_search.py` كان مقيَّداً بـ `is_admin or is_teacher` فقط → يمنع كل المسجلين/العمداء/رؤساء الأقسام/الموظفين من رؤية أي نتيجة
  - استُبدلت الفحوص الصلبة بفحوص صلاحيات دقيقة (`view_students`, `view_teachers`, `manage_enrollments`, إلخ.)
  - أُضيف نطاق الكلية/القسم لكل أنواع البحث (طلاب، معلمين، مقررات، أقسام، كليات، محاضرات)
  - أُضيفت آلية تسجيل `set_scope_filter` في `routes/deps.py` لاستيراد `get_user_scope_filter` من `server.py` بشكل آمن (الخادم يُحمَّل عبر `importlib` كـ `_actual_server`)
  - استنتاج `faculty_id` من `department_id` لرؤساء الأقسام بدون كلية مباشرة
  - مسجِّل التسجيل مع `manage_enrollments`/`view_enrollments` يحصل تلقائياً على البحث في معلمي كليته (لازم لإدارة التسجيل)

- 2026-06-21 **🏗️ توحيد المعمار (الخيار ب) + فحص شامل للصلاحيات**:
  - **صفحة الإدارة `(tabs)/admin.tsx`** أُعيد كتابتها كاملاً → Dashboard إحصائيات فقط (بدلاً من قائمة 20+ رابط مكرر)
  - **الصفحة الرئيسية** كانت تشترط دور معين (`['dean', 'department_head', ...].includes(user.role)`) لإظهار البطاقات → استُبدِل بشرط الصلاحيات: أي مستخدم لديه صلاحية إدارية يرى البطاقات
  - **السايدبار** أُصلحت أخطاء ربط:
    - "إدارة الإشعارات" مرتبطة بـ `MANAGE_USERS/MANAGE_DEPARTMENTS` ❌ → أصبحت `SEND_NOTIFICATIONS/manage_notifications` ✅
    - "الإعدادات العامة" كانت `adminOnly` فقط ❌ → أصبحت `MANAGE_SETTINGS` ✅
    - "محاضراتي" كانت `teacherOnly` ❌ → أصبحت تقبل أي مستخدم لديه `record_attendance` ✅
    - "سجلات النشاط" حذف `VIEW_REPORTS` الخادع (كان adminOnly فعلياً)
  - **`(tabs)/admin.tsx` السابقة:** زر "جدول المحاضرات" أُعيد ربطه بـ `view_schedule` بدلاً من `manage_lectures` (المحاضرات الآن فرعية)
  - **تقرير شامل** للصلاحيات الـ72 في `/app/memory/PERMISSIONS_AUDIT_REPORT.md` يوثق: المشاكل المكتشفة، الإصلاحات التي تمت، والمسائل التي تحتاج قراراً من المستخدم

- 2026-06-21 **🎯 دمج صلاحيات المحاضرات تحت `manage_courses` (الخيار ب)**:
  - 8 صلاحيات للمحاضرات (manage_lectures, view_lectures, add/edit/delete_lecture, override_lecture_status, reschedule_lecture, generate_lectures) أصبحت **مخفية** من واجهة منح الصلاحيات
  - تُمنح تلقائياً مع `manage_courses` (مدرجة في `FULL_PERMISSION_MAPPING`)
  - Backend `/permissions/available` يفلتر الصلاحيات المخفية (`hidden: True`)
  - **Migration v1 تلقائي لمرة واحدة** استعاد صلاحيات المحاضرات لـ 5 أدوار افتراضية (TEACHER, DEAN, DEPARTMENT_HEAD, ADMIN, EMPLOYEE) التي كانت قد فقدتها

- 2026-06-21 **🔑 إصلاح Backend `/roles` + صفحة إدارة المستخدمين**:
  - GET `/roles` كان يفحص `admin` فقط ❌ → أصبح يقبل `manage_users` أو `manage_roles` ✅
  - POST/PUT/DELETE `/roles` تقبل `manage_roles` للمنح المرن
  - صفحة `manage-users.tsx` استبدلت `Promise.all` بـ `Promise.allSettled` (لو فشل API واحد، البقية تكمل عملها)
  - السايدبار: "الأدوار" أُعيد ربطها بـ `manage_roles` بدلاً من `manage_users`
  - إصلاح خطأ سابق في server.py سطر 15337 (`fo(...)` بدلاً من `logging.info`)

- 2026-06-21 **🆕 صلاحيتين جديدتين للجداول الدراسية**:
  - `VIEW_SCHEDULE` و `MANAGE_SCHEDULE` كصلاحيات منفصلة عن المقررات
  - فُصِل ربط الجدول اليومي والأسبوعي عن `manage_courses` (كان خلط)

- 2026-06-21 **🔒 إصلاح RBAC شامل لصلاحيات إدارة الأقسام (Sub-Permission Awareness)**:
  - **المشكلة:** المستخدم منح صلاحيات `add_department/edit_department/delete_department` (فرعية) لكن backend/frontend كانا يتحققان فقط من `manage_departments` (الأم) → لم يستطع تحرير/إضافة الأقسام رغم وجود الصلاحيات.
  - **مشكلة إضافية:** صفحة تفاصيل القسم كانت تعرض المعلمين والمقررات وتسمح بالنقر للوصول لإسناد المقررات لأي مستخدم بدون فحص أي صلاحية.
  - **الإصلاحات:**
    1. **Backend `server.py`:** POST/PUT/DELETE `/departments` تقبل الآن `manage_departments` OR الصلاحية الفرعية المناسبة (`add_department`/`edit_department`/`delete_department`)
    2. **Backend `routes/deps.py`:** `has_permission` يوسّع `FULL_PERMISSION_MAPPING` (manage_departments → view/add/edit/delete) — كان يفتقد التوسعة
    3. **Frontend `add-department.tsx`:** أزرار الإضافة/التعديل/الحذف تستخدم `canAddDept`/`canEditDept`/`canDeleteDept` بدلاً من check واحد
    4. **Frontend `SideMenu.tsx`:** عنصر "إدارة الأقسام" يقبل أي من 5 صلاحيات (الأم + الفرعية الأربع)
    5. **Frontend `department-details.tsx`:** تبويبات المعلمين/المقررات مفلترة بـ `view_teachers`/`view_courses` — رسالة قفل واضحة إذا لا توجد صلاحية
    6. **Frontend `teacher-courses.tsx`:** زر "إسناد مقرر" و"إلغاء الإسناد" مفلتران بـ `manage_teaching_load` — النقر على المعلم في تفاصيل القسم لا يفتح صفحة الإسناد بدون صلاحية


- 2026-06-20 **🌐 تحسين "الإسناد العابر" ليشمل كل الكليات (Cross-University)**:
  - **المشكلة:** في صفحة العبء التدريسي، عند تفعيل "عابر للأقسام":
    - كل معلم يُظهر قسم واحد فقط (`department_id`) رغم أن لديه عدة أقسام (`department_ids`)
    - الكلية غير ظاهرة → المستخدم لا يعرف هل عبر لكلية أخرى أم لا
    - قائمة الأقسام المنسدلة لم تُجمَّع حسب الكلية → خلط
  - **الإصلاح في `teaching-load.tsx`:**
    - تحميل الكليات (`/api/faculties`) عند فتح الصفحة
    - `TeacherSearch` يُظهر الآن: 🏛️ الكلية + 🏢 كل الأقسام (chips ملوّنة)
    - قائمة الأقسام مُجمَّعة بصيغة `[الكلية] القسم` لإيضاح الانتماء
    - نص الـtoggle محدَّث: "عرض كل أساتذة ومقررات الجامعة (لجميع الكليات والأقسام)"
    - نتائج بحث المقررات تُظهر: 🏛️ الكلية + 🏢 القسم + المستوى + الشعبة + الكود


  - **الثغرة:** في `get_user_scope_filter` (server.py:838-855)، إذا كان رئيس قسم/عميد/مسجل بلا قسم/كلية مسنَدة، الـ query يبقى فارغاً → يرى **كل البيانات في الجامعة** (fail-open). zain و zain22 في الإنتاج كانا بلا أقسام فرأيا مقررات/طلاب كل الكليات.
  - **الإصلاح:** أُضيف Fail-safe في نهاية الدالة — إذا كان الدور محدود النطاق ولم يُطبَّق أي فلتر، الـ query يُعيّن إلى `{"_id": ObjectId("000...")}` (مستحيل التحقق) فيُحجَب كل شيء. + WARNING في اللوج.
  - **الاختبار:** `/app/backend/tests/test_rbac_failsafe.py` يُغطي 4 أدوار × 4 scope types ✅

- 2026-06-20 **🎨 تحسين مودال إسناد المعلم — معلومات سياقية كاملة**:
  - **التغيير:** في `AssignTeacherModal.tsx` تم إضافة بطاقة معلومات للمقرر تُظهر: الكلية، القسم، المستوى، الشعبة، الكود (chips ملوّنة).
  - **بطاقة المعلم:** صف كل معلم يُظهر الآن: الاسم، رقمه، **الكلية**، القسم/الأقسام، التخصص.
  - **Props جديدة:** `faculties`, `courseCode`, `courseLevel`, `courseSection`.
  - **التطبيق:** `courses.tsx` تُحمّل الكليات وتُمرّرها للـ 3 مودالات (سريع، نموذج، جماعي).

 (السبب الحقيقي اكتُشف عبر فحص الإنتاج مباشرة)**:
  - **التشخيص الفعلي عبر `api.ahgaff.net`:** zain و zain22 كانا موجودَين بشكل صحيح في DB (`role=department_head`, role_id صحيح، active=True). لكن `/api/users` بدون فلتر كان يُرجع 1000 سجل فقط.
  - **السبب الجذري الفعلي:** السطر `users = await db.users.find(query).to_list(1000)` في `server.py:1049` و `routes/users.py:90`. مع ~893 طالب + 98 معلم + 9 إداريين = 1000+، الحسابات الإدارية تقع خارج الـ limit وتختفي.
  - **الإصلاح:**
    1. عند عدم وجود فلتر، استبعاد students/teachers على مستوى DB query: `{"role": {"$nin": ["student", "teacher"]}}`
    2. رفع الحد إلى 10000 (الإداريون قليلون عادةً)
  - **التحقق:** اختبار `/app/backend/tests/test_users_limit.py` — يدخل 1100 طالب وهمي ويتأكد أن الحسابات الإدارية مرئية ✅
  - **ملاحظة:** الإصلاحات السابقة (auto-migration للأدوار، cleanup للأدوار المكررة، diagnose endpoint) محتفظ بها للحماية الإضافية لكنها لم تكن السبب الحقيقي.

- 2026-06-20 **Auto-migration للأدوار وأدوات التشخيص (طبقة حماية إضافية)**:
  - **المشكلة المُبلَّغة:** "تمت ترقية الحساب إلى رئيس قسم، لكن صفحة المستخدمين تُظهر 0 حساب في فلتر رئيس قسم".
  - **السبب الجذري:** في `PUT /api/users/{id}` و `PUT /api/users/{id}/role`، إذا كان الدور المخصص يفتقر لـ `system_key` (مثل دور أُنشئ باسم عربي فقط)، كان يُحفظ `role="custom"` بينما `role_id` يشير لدور بصلاحيات department_head. الفلتر `?role=department_head` لا يجده.
  - **الإصلاح ثلاثي الطبقات:**
    1. **Auto-migration عند كل startup** (`server.py:14918 migrate_broken_user_roles`):
       - يفحص كل مستخدم له `role_id` صالح
       - يستنتج `system_key` من الدور (أو من اسمه العربي عبر `ROLE_NAME_MAP`)
       - يُزامِن حقل `role` ليطابق — Idempotent
       - يُسجّل في اللوج: `Migration: 'zain' role: 'custom' → 'department_head'`
    2. **إصلاح المصدر في `PUT /api/users/{id}` (server.py:1230)**: يستنتج `system_key` من الاسم العربي عند الإنشاء/التحديث (نفس `ROLE_NAME_MAP`).
    3. **إصلاح المصدر في `PUT /api/users/{id}/role` (server.py:1655)**: نفس المنطق.
  - **التحقق (3 اختبارات شاملة):**
    - `/app/backend/tests/test_role_migration.py` — unit test على الـ migration ✅
    - `/tmp/test_zain_e2e.py` — E2E: إدخال مستخدم معطوب → restart → /api/users?role=department_head يجده ✅
    - تأكيد عبر curl حقيقي على API الإنتاج ✅
  - **المستخدم لا يحتاج لأي إجراء يدوي** — عند نشر الإصلاح عبر "Save to Github"، يُصلَح zain تلقائياً عند أول startup للـ backend.

- 2026-06-20 **إصلاح ثغرة RBAC حرجة: تسريب بيانات بين الكليات**:
  - **المشكلة المُبلَّغة:** "أي مستخدم لكلية معينة تظهر عنده كل أقسام الكليات الأخرى في صفحات المقررات والطلاب والمعلمين".
  - **التشخيص (عبر اختبار حسابات حقيقية):**
    - `Saeed` (department_head, كلية البنات) كان يرى **كلتا** الكليتين في `/api/faculties` (تسريب)
    - `registrar` لم يكن لديه فرع `teachers` في `get_user_scope_filter` → يرى **كل** المعلمين من كل الكليات
    - لا توجد آلية لإظهار "المعلمين العابرين" الذين يدرّسون في كليتك لكن قسمهم الأصلي مختلف
  - **الإصلاحات في `/app/backend/backend/server.py`:**
    1. **`/api/faculties`** (line 14070): إعادة كتابة كاملة. الآن:
       - `admin`: كل الكليات
       - `dean` / `registrar` / `registration_manager`: كليته فقط (faculty_id)
       - `department_head`: كلية قسمه (يُشتقّ من `department.faculty_id`)
       - `custom`: كلياته (من faculty_id + departments)
       - دور مقيَّد بلا بيانات → قائمة فارغة (بدلاً من رؤية الكل)
    2. **`get_user_scope_filter`** (line 786): أضيف فرع `teachers` للـ `registrar`/`registration_manager` (كان مفقوداً تماماً).
    3. **`/api/teachers`** (line 3926): استثناء "المعلمون العابرون للأقسام":
       - يحسب أقسام المستخدم المسموح بها (من scope_filter)
       - يجلب `course_ids` في تلك الأقسام
       - يضيف معلميها (من `teaching_loads` + `courses.teacher_id`) عبر `$or` للنتائج
       - النتيجة: تشاهد معلميك + المعلمين الذين يدرّسون عبر كليتك حتى لو قسمهم الأصلي مختلف
  - **التحقق (curl حقيقي):**
    | المستخدم | /api/faculties | /api/departments | /api/teachers |
    |---|---|---|---|
    | Saeed (dept_head) | ✅ كلية البنات فقط | ✅ الدراسات الإسلامية فقط | ✅ Saeed فقط |
    | Salim (dean) | ✅ كلية الشريعة فقط | ✅ 3 أقسام كليته | ✅ حسن + زين فقط |
    | admin | ✅ كل الكليات | ✅ كل الأقسام | ✅ كل المعلمين |
  - **الاختبارات الجديدة:**
    - `/app/backend/tests/test_rbac_scoping.py` (3 اختبارات تحققية على البنية والبيانات)
  - **حسابات تجريبية موثَّقة في `test_credentials.md`:**
    - `Salim` / `test1234` (dean)
    - `Saeed` / `test1234` (department_head)

- 2026-06-19 **دليل المستخدم المصور داخل المنصة (`/help`)**:
  - **الطلب:** "نويت اعمل دليل مصور لاستخدام المنصة على شكل خطوات منطقية وكل خطوة مبنية على الأخرى... من بداية فتح الموقع إلى أسس بناء المعلومات والاستخدام".
  - **التنفيذ:**
    - صفحة كاملة `/app/frontend/app/help.tsx` بتصميم شريط جانبي (Sidebar) + محتوى مفصّل.
    - بحث مباشر في عناوين/خطوات الأقسام (`testID=help-search-input`).
    - تنقّل سابق/تالي بين الأقسام أسفل كل صفحة (`testID=help-prev-btn` / `help-next-btn`).
    - مكوّن `StepCard` يعرض: رقم الخطوة، عنوان، مسار في المنصة (path chip)، شرح، نقاط، نصائح (أصفر)، تحذيرات (أحمر).
    - صناديق Intro/Warning على مستوى القسم نفسه.
    - روابط سريعة (Quick Links) لصفحات المنصة الفعلية في نهاية كل قسم.
  - **المحتوى (`/app/frontend/src/data/helpContent.ts`):** منظَّم على 7 مراحل متسلسلة + 3 ملاحق:
    1. **البداية: التعريف والدخول** — تسجيل دخول، جولة، البحث، الأدوار والصلاحيات.
    2. **البنية الأكاديمية** — الفصل ← الكلية ← القسم ← المستوى ← المنهج ← المقرر (إلزامي).
    3. **الأشخاص** — معلمون، طلاب، حالات الطالب، استيراد Excel.
    4. **الربط والتشغيل** — إسناد فردي/جماعي/عابر للقسم، تسجيل طلاب، خطة دراسية، جدول أسبوعي.
    5. **التشغيل اليومي** — حضور، تعديل، تأخّر المعلم، تطبيق الجوال.
    6. **التقارير والإحصاءات** — العبء، حضور الطالب/المقرر، التحقق بـ QR.
    7. **الصيانة والإدارة** — ترحيل لفصل جديد، أرشفة، صلاحيات، سجل نشاط، نسخ احتياطي.
    + ملاحق: تطبيق المعلم، تطبيق الطالب، حل المشاكل الشائعة (FAQ).
  - **الوصول:** زر "دليل استخدام المنصة" في صفحة الحساب الشخصي (`(tabs)/profile.tsx`) — أيقونة كتاب خضراء بـ `testID=help-guide-btn`.
  - **التحقق:** Screenshots أكدّت ظهور الصفحة بـ 10 أقسام في الـ sidebar، تصفّح سلس بين الأقسام، تصميم RTL نظيف بدون عناصر مكسورة.

- 2026-06-18 **الإسناد الجماعي (Bulk Teacher Assignment) — P1 + P2**:
  - **المتطلب:** تسهيل إسناد معلم واحد لعدة مقررات دفعة واحدة في بداية الفصل، مع تحذيرات ذكية لتجنّب تجاوز عبء المعلم أو الإسناد العابر غير المقصود.
  - **آلية العمل:**
    - استخدام البنية الموجودة `selectionMode + selectedIds` في `/(tabs)/courses.tsx` (إعادة استخدام بدون تكرار).
    - زر جديد في شريط أدوات وضع التحديد: **"إسناد جماعي (N)"** (testID=`open-bulk-assign-btn`) بجانب زر "حذف".
    - يفتح نفس `<AssignTeacherModal>` لكن في **نمط `bulkCourses`**.
  - **مميزات النمط الجماعي:**
    - **حساب العبء التلقائي:** يجمع credit_hours من المقررات المعروضة لكل معلم → `teacherCurrentLoadMap` (useMemo) → يُمرَّر للمودال.
    - **بطاقة ملخّص مباشرة عند اختيار المعلم:**
      - "سيتم إسنادها: X" (بعد تطبيق فلتر التجاوز)
      - Badges: "X نفس القسم" (أخضر) / "X عابر للقسم" (برتقالي)
      - تحذير "⚠️ X مقرر مُسند سلفاً" + كم منها لنفس المعلم
      - "عبء المعلم بعد الإسناد: X / MAX ساعة" (مع تحذير أحمر عند التجاوز)
    - **خيار "تجاوز المُسندة سلفاً":** toggle (testID=`skip-assigned-toggle`) — يستثني المقررات المُسندة لمعلم آخر.
    - **حقل "ساعات أسبوعية مخصصة":** اختياري (testID=`custom-weekly-hours-input`) — يُمرَّر للخادم كـ `weekly_hours` بدلاً من `credit_hours` الافتراضية.
    - **وضع "إلغاء الإسناد الجماعي":** عند ترك "إزالة الإسناد" مختاراً، زر الحفظ يصبح "إلغاء إسناد N مقرر" → يرسل `{teacher_id: null}` للجميع.
  - **التنفيذ:**
    - `Promise.allSettled` للطلبات بالتوازي → كل طلب `PUT /api/courses/{id}` → الخادم يقوم تلقائياً بمزامنة `teaching_loads`.
    - **عرض النتائج:** بعد الحفظ، المودال يتحول لعرض ملخّص "نجح: N/N" مع قائمة لكل مقرر (✓ أو ✗ مع رسالة الخطأ).
    - تحديث محلي فوري للجدول للمقررات التي نجحت.
    - عند ضغط "إغلاق": يخرج المستخدم من وضع التحديد ويُمسح selectedIds.
  - **التكامل مع جدول العبء التدريسي:** لا تعارض — الخادم يحدّث `teaching_loads` تلقائياً عبر `PUT /api/courses/{id}` (نفس المسار المختبر). تقرير `/teaching-load/report/advanced` يعكس النتائج فوراً.
  - **الاختبار:** 10/10 تدفقات نجحت (testing agent iteration_35):
    - زر `إسناد جماعي` يظهر/يُعطّل حسب `selectedIds.size`
    - حساب العبء (6/12 ساعة) صحيح للحالة المختبرة
    - حقل الساعات المخصصة يعيد الحساب فوراً (10/12 بـ 5 ساعات)
    - PUT متوازي بقيم teacher_id صحيحة (200 OK في backend logs)
    - تنظيف وضع التحديد بعد الإغلاق
  - **الملفات:**
    - `/app/frontend/src/components/AssignTeacherModal.tsx` (موسّع: bulkCourses, onBulkSaved, teacherCurrentLoadMap, handleBulkSave, bulk results view)
    - `/app/frontend/app/(tabs)/courses.tsx` (useMemo import, teacherLoadMap، زر `open-bulk-assign-btn`، مودال bulk)

- 2026-06-18 **إسناد معلم سريع من صف المقرر + بحث متقدم في التعديل**: 
  - **المشكلة المُبلَّغة:** "في تعديل المقرر يتم تحديد الاستاذ لكن لا يوجد بحث، اعمل لنا امكانية بحث، واعمللنا تسهيل ربط المقرر لمعلم في الصفحة مباشر ظاهرة".
  - **الحل:** إنشاء مكوّن قابل لإعادة الاستخدام `<AssignTeacherModal>` في `/app/frontend/src/components/AssignTeacherModal.tsx` يدعم نمطين:
    - **نمط الإسناد المباشر (افتراضي):** يحفظ على الخادم عبر `PUT /api/courses/{id}` ثم يستدعي `onSaved`.
    - **نمط النموذج (formMode):** لا يستدعي الخادم — يُرجع الاختيار فقط للنموذج (مستخدم في مودال تعديل المقرر).
  - **مميزات المودال:**
    - بحث فوري بالاسم/رقم المعلم (`testID=teacher-search-input`).
    - Badge أخضر "نفس القسم" / برتقالي "عابر للقسم" بناءً على `course.department_id` مقابل `teacher.department_ids`.
    - فلتر toggle "إظهار معلمي القسم فقط" (`testID=same-dept-toggle`).
    - خيار "إزالة الإسناد (بدون معلم)" أحمر بارز.
    - تأكيد الإسناد عند العبور لقسم آخر (`window.confirm` على الويب).
    - فرز ذكي: معلمو نفس القسم أولاً ثم بقية المعلمين.
  - **التطبيق في `/(tabs)/courses.tsx`:**
    - خلية المعلم في كل صف أصبحت تفاعلية: زر "إسناد معلم" أزرق (`testID=assign-teacher-{id}`) عندما لا يوجد معلم، أو chip بأيقونة قلم (`testID=change-teacher-{id}`) للتغيير.
    - استبدال `<TeacherSearchPicker>` القديم في مودال إضافة/تعديل المقرر بزر يفتح نفس `<AssignTeacherModal>` في `formMode` — يوفّر البحث على الويب وتطبيق الجوال معاً.
    - تحديث محلي فوري للجدول بعد الحفظ (`setCourses(prev => prev.map(...))`).
  - **تكامل مع الخادم:** `PUT /api/courses/{id}` يقوم تلقائياً بـ:
    - مزامنة `teaching_loads`: حذف عبء المعلم القديم وإنشاء عبء جديد بساعات `credit_hours`.
    - إصدار تنبيه عند الإسناد العابر للقسم.
  - **الاختبار:** 9/9 تدفقات فرونت إند نجحت (testing agent iteration_34) — الإسناد المباشر، البحث، الفلتر، الـ badges، الحفظ نفس القسم/عابر، الإزالة، وضع النموذج.

- 2026-06-18 **إصلاح جذري لتضارب بيانات الفصل النشط عبر كل النظام (Active Semester Consistency)**: المشكلة المُبلَّغة: "مقررات المعلم تعرض 0، بينما صفحة المقررات تعرضه مسؤولاً عن مقررات أخرى وبعدد محاضرات مختلف عن صفحة تفاصيل المقرر — نظام ملخبط".
  - **التشخيص:** 5 endpoints كانت تطبّق فلتر الفصل النشط بطرق مختلفة:
    - `/api/courses` lecture_count: بلا فلتر → كل المحاضرات تاريخياً
    - `/api/lectures/{course_id}`: فلتر الفصل النشط
    - `/api/courses/{id}/full-details`: فلتر الفصل النشط
    - `/api/courses/{id}/lecture-stats`: لا فلتر افتراضي
    - `/api/teachers/{id}/courses`: يعتمد على `teaching_loads` فقط (يخفي مقرراً مرتبطاً بـ `courses.teacher_id` بلا teaching_load)
    - `/api/teachers/{id}/full-profile`: يستخدم `courses.teacher_id` فقط (بلا فلتر فصل) → يختلف عن أخوه `/courses`
  - **الإصلاح:** إنشاء `/app/backend/backend/routes/_active_semester.py` كمصدر وحيد للحقيقة:
    - `get_active_semester(db)` → جلب الفصل النشط مع التواريخ
    - `lecture_active_semester_clauses(sem)` → بناء $or clauses (matches `semester_id` OR fallback date-range for legacy lectures with no semester_id)
    - `apply_lecture_active_sem(match, sem)` → دمج آمن مع `$or` موجود (يحوّل إلى `$and` تلقائياً)
    - `get_teacher_active_course_ids(db, teacher_id, sem)` → UNION (`courses.teacher_id` ∪ `teaching_loads.course_id`) في الفصل المستهدف
    - `get_courses_lecture_counts(db, course_ids, sem)` → عدّ المحاضرات لجميع المقررات بنفس الفلتر
  - **تغيير الـ Endpoints:**
    - `/api/courses` (server.py:4852): lecture_count يستخدم نفس نطاق المقررات (لو فلتر فصل → نفس الفصل، لو all_semesters → بلا فلتر)
    - `/api/lectures/{course_id}` (server.py:6813): يفلتر بـ **فصل المقرر نفسه** (وليس الفصل النشط العام) — UX أفضل: فتح مقرر مؤرشف يعرض محاضراته
    - `/api/courses/{id}/lecture-stats` (server.py:5054): نفس منطق "فصل المقرر"
    - `/api/courses/{id}/full-details` (entity_details.py): نفس منطق "فصل المقرر"
    - `/api/teachers/{id}/courses` (server.py:4143): يستخدم UNION + lecture_count موحّد
    - `/api/teachers/{id}/full-profile` (entity_details.py): UNION + lectures_total/completed موحّد + يدعم `?all_semesters=true`
  - **الفرونت إند:**
    - `/app/frontend/app/teacher-courses.tsx`: زر تبديل جديد (testID=toggle-all-semesters-btn) لعرض "الفصل النشط فقط" ↔ "كل الفصول (أرشيف)".
    - `/app/frontend/src/services/api.ts`: `teachersAPI.getCourses(teacherId, params?)` يدعم `include_all` و `semester_id`.
  - **التحقق:** Course `698f0000d803b27aab0120af` (دراسات حضرموت، 9 محاضرات في الفصل المغلق):
    - `/api/courses?semester_id=ClosedSem` → 9 ✓
    - `/api/courses/{id}/full-details` → 9 ✓
    - `/api/courses/{id}/lecture-stats` → 9 ✓
    - `/api/lectures/{id}` → 9 ✓
    - **كل الأرقام متطابقة الآن!**
    - Teacher `698e533beb4c6eb021c50302` (حسن صالح): default = 0 / include_all = 3 (`/courses` و `/full-profile` يتفقان).
  - **الاختبارات:**
    - `/app/backend/tests/test_active_semester_consistency.py` (8 اختبارات helper) — جميعها ✓
    - `/app/backend/tests/test_active_sem_endpoint_consistency.py` (15 HTTP tests كتبها testing agent) — جميعها ✓
    - Regression: `test_teaching_load_cross_dept.py`, `test_teaching_load_auto_sync.py` — جميعها ✓
    - **25/25 backend tests pass.**

- 2026-06-18 **مزامنة تلقائية لـ teaching_loads مع المقررات (إصلاح أرقام العبء غير المتطابقة)**: لكل مقرر له `teacher_id` وليس له entry في `teaching_loads` يُنشَأ entry تلقائياً بساعات = `credit_hours` (أو 3 افتراضياً). المزامنة تُنفّذ داخل `/api/teaching-load/report/advanced` قبل الحساب (تخطّى الفصول المؤرشفة لحماية الأرشيف). تمت إضافة endpoint يدوي: `POST /api/teaching-load/sync` يدعم فلاتر `teacher_id` و `department_id` و `semester_id`. النتيجة المُختبرة: `حسن صالح` كان يعرض 3 مقررات بـ 3 ساعات → الآن 9 ساعات (3 × credit_hours). idempotent: استدعاء ثانٍ ينشئ 0 سجل. اختبار: `/app/backend/tests/test_teaching_load_auto_sync.py`.
- 2026-06-18 **إصلاح باغ تقرير العبء التدريسي (مقررات المعلم في أقسام أخرى لا تظهر)**: في `/api/teaching-load/report/advanced`، عند فلترة التقرير بقسم، كانت مقررات المعلم في أقسام أخرى تُحذف من القائمة لأن `course_query["department_id"] = department_id` كان يقصر المقررات على القسم المختار، ثم `assigned_courses = [c for c in all_courses if c.get("teacher_id") == tid]` يستخدم نفس القائمة. الإصلاح: تم فصل قائمتين — `dept_courses` (لإحصائيات القسم) و `teacher_courses_list` (لعرض مقررات كل معلم من جميع الأقسام). الآن إذا كان "زين سالم" له 6 مقررات في 3 أقسام، التقرير يعرضها كلها بـ `department_id` للمقرر مع كل courses entry. تم تعزيز ذلك باختبار regression: `/app/backend/tests/test_teaching_load_cross_dept.py`.
- 2026-06-17 **توحيد صفحات المقرر في 4 تبويبات + تعديل/حذف**: إنشاء `<CourseTabBar>` كمكوّن مشترك (/src/components/CourseTabBar.tsx) يعرض في رأس course-details, course-lectures, course-students, manage-study-plan. يحوي: Breadcrumb + بطاقة معلومات المقرر + شريط تبويبات (نظرة عامة/المحاضرات/الطلاب/الخطة) + زرّا تعديل/حذف مع modals. النقر على تبويب يستدعي router.replace للمسار المقابل. النتيجة المختبرة: التبويبات الأربعة تعمل بسلاسة مع الحفاظ على كامل وظائف كل صفحة.
- 2026-06-17 **إعادة تصميم `/schedule` و `/take-attendance` بالنمط الحديث**:
  - **`/schedule.tsx` (380 سطر):** Header + Breadcrumb + 4 stat cards (إجمالي/منعقدة/مجدولة/ملغاة) + Date picker card (مع semester chip + native date overlay) + active semester badge + List card مع timeline cards محسّنة (بطاقات محاضرات بألوان مميزة + status badge + meta chips + action buttons).
  - **`/take-attendance.tsx`:** أُجريت جراحة دقيقة: تم استبدال JSX الرندر والـ styles فقط مع الحفاظ على 100% من المنطق (offline cache, network monitoring, error handling, attendance status, lesson modal, PDF export, study plan integration, تبديل الحالة بنقرة، حفظ أوفلاين/أونلاين). التصميم الجديد: Header + Breadcrumb (الرئيسية ← الجدول ← اسم المقرر) + Course info card مع meta chips (تاريخ ميلادي/هجري/وقت/قاعة) + status bar ديناميكي + 4 stat cards + Action toolbar (QR + PDF) + List card للطلاب + Bottom action bar للحفظ + Error card حديث.
  - **التحقق:** schedule يعرض stat cards وdate picker بشكل صحيح؛ take-attendance error state يظهر بتصميم حديث (المحاضرة غير موجودة → بطاقة بيضاء مع أيقونة حمراء + زرّان).
- 2026-06-17 **إعادة تصميم `/curriculum` بالنمط الحديث - حفظ كامل للوظائف**:
  - **الهدف:** تطبيق النمط الحديث الموحد على صفحة الخطة الدراسية مع الحفاظ على جميع الوظائف.
  - **التحسينات البصرية:**
    - Header حديث + Breadcrumb ديناميكي (الرئيسية ← الخطة الدراسية ← اسم القسم).
    - 4 بطاقات إحصائية: إجمالي مقررات الخطة، المستويات، الأقسام المتاحة، الفصل النشط.
    - بطاقة اختيار القسم مع شريط بحث وchips حديثة.
    - شريط أدوات منظم في بطاقة منفصلة بـ 5 إجراءات ملونة: تحميل نموذج / رفع من Excel / استيراد من أرشيف / توليد للفصل النشط / مسح خطة القسم.
    - بطاقة الشبكة بترويسة المستوى مع badge + chip لعدد المقررات.
    - أعمدة الفصول بألوان مميزة (أزرق/بنفسجي/برتقالي) ودوائر مؤشر + عداد.
    - بطاقات المقررات محسّنة: code chip + credit hours + teacher row + sections input + delete button.
  - **الوظائف المحفوظة بالكامل:**
    - اختيار القسم (chips قابلة للبحث).
    - إضافة مقرر (Modal).
    - تحميل نموذج Excel (تم إصلاح a.click بإضافة DOM attach).
    - رفع من Excel (Modal معاينة مع stats + sample + mode merge/replace).
    - استيراد من فصل مؤرشف (Modal).
    - توليد جلسات للفصل النشط مع sections_map.
    - مسح خطة القسم (Double confirm).
    - حذف مقرر فردي مع تأكيد.
    - مدخلات `sectionsMap` لكل مقرر.
  - **اختبار:** الصفحة تعرض 6 مقررات في 5 مستويات للقسم النشط؛ جميع البطاقات والأزرار تظهر بشكل صحيح؛ التمرير الداخلي يعمل (clientH<scrollH).
- 2026-06-17 **إعادة تصميم `/add-department` بالنمط الحديث + توحيد روابط الأقسام**:
  - **المشكلة:** صفحة إدارة الأقسام (`/add-department`) كانت تستخدم النمط القديم (تبويبات modal للتفاصيل + قائمة بسيطة)، بينما البحث السريع يربط إلى النمط الجديد (`/department-details`). كان هناك تناقض في تجربة المستخدم.
  - **الإصلاح:**
    - إعادة كتابة `/app/frontend/app/add-department.tsx` كاملاً بالنمط الحديث: SafeAreaView + ScrollView (flex:1 + flexGrow:1) + Header مع breadcrumb + 4 stat cards + filter card + table card مع pagination.
    - النقر على أي قسم في الجدول (الاسم أو زر العين) يفتح `/department-details?departmentId={id}` بدلاً من modal قديم.
    - إزالة modal التفاصيل القديم نهائياً.
    - تحديث الفلاتر: dropdown للكلية + بحث نصي + reset.
    - تصحيح breadcrumb في `/department-details.tsx`: كان يربط إلى `/departments` (مسار غير موجود) → الآن يربط إلى `/add-department` (المسار الصحيح).
  - **النتيجة المُختبَرة:**
    - `/add-department` تعرض 4 أقسام في جدول حديث مع 4 بطاقات إحصائية (4 أقسام، 4 معروض، 92 طالب، 12 مقرر).
    - النقر على breadcrumb "الأقسام" من `/department-details` يعود بنجاح إلى `/add-department` الجديدة.
    - زر "إضافة قسم" يفتح نموذج بتصميم متّسق مع باقي الصفحات.
- 2026-06-17 **إرجاع صفحة المقررات إلى `(tabs)/courses.tsx` مع إصلاح التمرير**:
  - **الطلب:** المستخدم طلب إعادة محتوى صفحة المقررات الكامل إلى ملف `(tabs)/courses.tsx` بدلاً من إعادة التوجيه إلى `/manage-courses`، وإصلاح مشكلة التمرير بنفس النمط المستخدم في الشاشات العاملة (SafeAreaView flex:1 → ScrollView flex:1 → contentContainerStyle flexGrow:1).
  - **الإصلاح:**
    - دمج محتوى `/manage-courses.tsx` (2046 سطر) داخل `(tabs)/courses.tsx`.
    - تحديث مسارات الاستيراد من `../src/...` إلى `../../src/...`.
    - حذف `dataSet={{ responsiveScrollRoot: "true" }}` من الـ ScrollView (هذا الـ attribute كان يطبق قاعدة CSS عالمية تجبر `overflow: visible` على الـ ScrollView وتمنعه من scrolling).
    - إضافة `flexGrow: 1` إلى `contentContainerStyle` ليضمن أن المحتوى يتمدد لملء الـ ScrollView.
    - تحديث 3 مراجع من `/manage-courses` إلى `/(tabs)/courses` في: `(tabs)/index.tsx` (×2) و `course-details.tsx`.
    - حذف ملف `manage-courses.tsx` نهائياً.
  - **النتيجة المُختبَرة:**
    - قبل: `dataAttr="true", overflowY=visible, scrollableElements=0` (المحتوى مقصوص داخل tabs container)
    - بعد: `dataAttr=null, overflowY=auto, clientH=1020, scrollH=1366` (التمرير الداخلي للـ ScrollView يعمل، شريط التبويب السفلي يبقى ثابت).
- 2026-06-17 **حل نهائي لـ scroll في صفحة المقررات: نقلها خارج Tabs navigator** (تم استبداله بالحل أعلاه):
  - **السبب الجذري:** React Navigation Tabs يحبس المحتوى داخل container بارتفاع ثابت وflex constraint، مما يمنع الـ body من التمدد طبيعياً. كل محاولات CSS/JS كانت تكسر التخطيط أو لا تعمل بسبب hashed class names المتغيرة بين builds.
  - **الإصلاح:** إنشاء صفحة جديدة `/app/frontend/app/manage-courses.tsx` (re-export من `(tabs)/courses.tsx`) خارج tab navigator — مثل `/students` و `/manage-teachers` العاملتين. الـ DOM tree لها أبسط بكثير ولا يحوي tabs container constraints.
  - **تحديث الروابط:** بطاقات "المقررات" في الصفحة الرئيسية `(tabs)/index.tsx` تشير الآن إلى `/manage-courses` بدلاً من `/courses`.
  - **النتيجة:** body يتمدد إلى 1430px (قبل: 720px) — يضمن ظهور scrollbar الطبيعي للمتصفح.
- 2026-06-17 **تراجع عن CSS العدواني الذي كسر التخطيط (P0)**:
  - **المشكلة:** الـ CSS السابق طبَّق `overflow: visible` على كل عناصر RN-Web بما فيها الـ Tab navigator والـ floating header buttons — مما سبب: (1) اختفاء شريط التبويب السفلي، (2) انزلاق زر القائمة والبحث إلى وسط الصفحة، (3) كسر سلوك التمرير.
  - **الإصلاح:** التراجع إلى CSS آمن يستهدف فقط:
    - `body` + `html` (تنسيق scrollbar الجميل بلون داكن)
    - `[data-responsive-scroll-root="true"]` فقط (الصفحات التي اختارت explicit opt-in)
    - تنسيق scrollbar للـ inner ScrollViews دون تعطيل overflow.
  - **النتيجة:** التخطيط استعاد طبيعته في كل الصفحات (الرئيسية، المقررات، الطلاب، المعلمين).
  - **خطوة لاحقة آمنة:** إضافة `responsiveScrollRoot="true"` يدوياً لكل صفحة فرعية (مثل course-students, course-details) عند الحاجة — بدون CSS عدواني.
- 2026-06-17 **حل جذري لـ scrollbar في كل صفحات RN-Web (P0)**:
  - **السبب الجذري المُكتشَف:** RN-Web يضع `overflow: hidden auto` على كل ScrollView/FlatList مع ارتفاع داخلي ثابت (مثلاً `296px`). الـ body له `scrollHeight === clientHeight === 720` → لا يحتاج scrollbar. المحتوى الفعلي محبوس داخل container داخلي صغير بـ scroll مخفي يعمل لكنه غير مرئي.
  - **الإصلاح:** CSS قوي في `responsiveStyles.ts` يجبر كل `[class*="r-WebkitOverflowScrolling"]` و `[class*="r-overflowY"]` على `overflow: visible !important + max-height: none !important + height: auto !important`. مع استثناء `[role="dialog"]` (الـ modals تحافظ على scroll الداخلي).
  - **النتيجة المُختبَرة في `/course-students` بـ21 طالب:**
    - قبل: `bodyScrollH=720`, `bodyClientH=720` (لا scroll)
    - بعد: `bodyScrollH=2338`, `bodyClientH=720` (scroll طبيعي للمتصفح يعمل)
    - `computedOverflowY` تحوّل من `auto` إلى `visible` (تأكيد تطبيق CSS).
  - **شريط التمرير المُنسَّق:** `*::-webkit-scrollbar { width: 14px }` بلون داكن `#6b7d99` وحدّ خارجي. يظهر في كل صفحات admin/student/teacher عند المحتوى الطويل.
  - **قيد بصري:** Playwright headless screenshots لا تُظهر scrollbars (قيد معروف للأداة) — في متصفح المستخدم العادي ستظهر بوضوح.
- 2026-06-16 **شريط تمرير مرئي شامل في كل صفحات RN-Web**:
  - **المشكلة:** صفحات المقررات (والصفحات الفرعية الأخرى) لم تكن تُظهر scrollbar حتى عندما يكون المحتوى أطول من النافذة.
  - **الإصلاح:** توسيع CSS العالمي في `responsiveStyles.ts` ليستهدف كل ScrollView/FlatList في RN-Web عبر:
    - `[class*="r-overflow"]`, `[class*="OverflowScrolling"]`, `[class*="WebkitOverflow"]`, `[class*="r-overflowY"]`, `[class*="r-overflowX"]` — يطابق كل classes RN-Web الفعلية.
    - `*::-webkit-scrollbar` كتجاوز قوي + `*::-webkit-scrollbar-thumb` بلون داكن (`#6b7d99`) وحدّ خارجي للوضوح.
    - `scrollbar-width: auto` و `appearance: auto` لإجبار المتصفحات على إظهار الشريط دائماً (بدلاً من overlay-only).
  - **إضافة `dataSet={{ responsiveScrollRoot: "true" }}`** لصفحتين كانتا تفتقدانها: `course-details.tsx` و `archive-course-history.tsx`.
  - **التحقق:** عبر JS evaluation داخل المتصفح: `pseudo_width=14px`, `display=block`, `scrollbar-width=auto` (CSS مُطبَّق فعلاً). screenshot tool لا يُظهر الـ scrollbar بصرياً لأن Playwright Chromium headless يخفي الـ scrollbars تلقائياً في screenshots — لكن متصفح المستخدم العادي سيعرضها.
- 2026-06-16 **إصلاح ثانٍ لفلترة `/courses` — endpoint مزدوج (P0)**:
  - **المشكلة:** التعديل السابق طُبِّق على `routes/courses.py` لكن FastAPI كان يستخدم `server.py:4818` (مسجَّل أولاً) — لذا بقي تطبيق المعلم يعرض الفصل الماضي.
  - **الإصلاح:** نقل نفس منطق الفلترة الذكية إلى `server.py::get_courses`: تُفعَّل تلقائياً للمعلم/الطالب أو عند تمرير `?teacher_id`، الإداريون يرون كل المقررات، ودعم `?all_semesters=true` للتجاوز.
  - **التحقق (بتوكن معلم حقيقي):** قبل=1 مقرر بـsemester_id قديم؛ بعد=0 (صحيح، المعلم لا يدرّس في الصيفي). Admin بدون params = 13 (كل المقررات). Admin مع `teacher_id` = مفلتر. `all_semesters=true` = escape hatch يعمل.
- 2026-06-16 **إصلاح فلترة المقررات في تطبيقات المعلم والطالب بالفصل النشط (P0)**:
  - **المشكلة:** تطبيقات الطالب والمعلم كانت تعرض مقررات الفصل السابق (الفصل الأول) لأن endpoints `/students/me/courses` و `/students/{id}/courses` و `/courses?teacher_id=X` لم تفلتر بالفصل النشط.
  - **الإصلاح (3 endpoints):**
    - **`GET /students/me/courses`**: فلترة `enrollments` و الاستعلام الاحتياطي للقسم/المستوى بـ `semester_id == active_semester._id`.
    - **`GET /students/{id}/courses`** (للإدارة): نفس الفلترة.
    - **`GET /courses`**: فلترة تلقائية ذكية — تُطبّق للمعلم/الطالب (role=teacher|student) أو عند تمرير `?teacher_id`. الإداريون يرون كل المقررات افتراضياً. أضيف parameter `?all_semesters=true` و`?semester_id=X` للتحكم اليدوي.
  - **التحقق:** البيانات تؤكد فاعلية الإصلاح — من أصل 13 مقرر في النظام، فقط 1 مقرر ("تدريب ميداني صيفي") في الفصل النشط الصيفي. بقية المقررات (الفصل الأول) لن تظهر للطلاب/المعلمين، وستظهر للإداريين فقط.
- 2026-06-16 **إضافة "تغيير المستوى" + سجل الحضور Inline للمقرر**:
  - **زر "تغيير المستوى"** أُضيف للإجراءات السريعة (أيقونة طبقات نيلية) + مودال بسيط لاختيار م1–م5 + يستدعي `studentsAPI.update({level})`.
  - **سجل الحضور Inline:** النقر على صف مقرر يفتح/يطوي سجل حضور الطالب في **هذا المقرر تحديداً** داخل نفس البطاقة (cache في الذاكرة، أيقونة chevron تدور)، يعرض كل محاضرة بحالتها (حاضر/غائب/متأخر/بعذر) والتاريخ والوقت وطريقة الرصد. كان النقر سابقاً ينقل لصفحة `/course-lectures` (سجل حضور الفصل كاملاً) بينما المستخدم أراد سجل الطالب المحدد في هذا المقرر.
- 2026-06-16 **تحسين صفحة `/student-details` بناءً على ملاحظات المستخدم**:
  - **تصميم مدمج:** استبدال المربعات الكبيرة (3 stat cards) بشرائح أفقية صغيرة (compact chips) — توفير ~40% من المساحة الرأسية. تصغير بطاقة الطالب والـavatar.
  - **شارة نسبة الحضور الإجمالية:** badge ملوّن (أخضر≥75% / برتقالي≥50% / أحمر<50%) بجانب عنوان الصفحة مباشرة.
  - **نسبة الحضور لكل مقرر:** chip ملوّن داخل صف المقرر يعرض النسبة + `حاضر/إجمالي` — يُحمَّل تلقائياً بالتوازي لكل المقررات.
  - **تصدير PDF جديد:** Backend endpoint جديد `GET /api/export/report/student/{id}/pdf` يولد PDF عربي احترافي (ReportLab + Amiri) يعرض بطاقة معلومات الطالب + جدول المقررات مع نسب الحضور والإجمالي. اختُبر عبر curl (22KB، content-type=pdf).
  - **إصلاح Excel:** كان `exportAPI.exportStudentReportExcel` غير موجود (السبب الحقيقي للفشل) — صُحّح إلى `reportsAPI.exportStudentReportExcel`.
  - **رابط المقرر:** التوجيه من `/course-details` (القديمة) إلى `/course-lectures` (الحديثة المتسقة مع `/teacher-courses`).
  - **حذف CTA "عرض ملخص الحضور":** الملخص يُحمَّل تلقائياً الآن، يبقى فقط زر "تحميل السجلات" للسجل التفصيلي (للحفاظ على سرعة التحميل).
- 2026-06-16 **توحيد عرض حمل المعلم بين `/manage-teachers` و `/teacher-courses`**:
  - **المشكلة:** كان عمود "النصاب" يعرض السقف الأسبوعي المخزن للمعلم (12 افتراضياً) وعمود "المقررات" يحسب كل المقررات النشطة عبر **كل الفصول**. بينما `/teacher-courses` يعرض ساعات ومقررات **الفصل النشط فقط** — مما أدى إلى تباين في الأرقام (مثلاً 9 س / 3 مقررات في القائمة مقابل 3 س / 1 مقرر في الصفحة المخصصة).
  - **الحل (Backend):** أضيف لـ `GET /api/teachers` الحقول `current_semester_id`, `current_semester_hours`, `current_semester_courses_count` — تُحسب دفعة واحدة من `db.teaching_loads` المُفلتَر بالفصل النشط (`semesters.status='active'`).
  - **الحل (Frontend):** صفحة `/manage-teachers` تستخدم الحقول الجديدة (مع fallback للحقول القديمة) في عمودي "النصاب" و"المقررات" — صار العرض متطابقاً 100% مع `/teacher-courses`.
- 2026-06-16 **Student Details page (`/student-details`) — full redesign replacing modal**:
  - **Replaced 39-line redirect-shim** with a 1360-line full-featured page mimicking `/teacher-courses` design system.
  - **Sections:** page header (title + status badge + breadcrumb + actions), student profile card (avatar/name/student_id/reference_number/department/level/section/phone/email), 3 stat cards (مقررات / ساعات معتمدة / حالة الحساب), quick-actions row (تغيير الحالة / تفعيل أو إلغاء تفعيل الحساب / إعادة تعيين كلمة المرور / التقرير المفصّل), courses list with rich metadata badges, and an attendance section.
  - **CRITICAL UX (per user request): Attendance does NOT load on mount.** A "عرض ملخص الحضور" button triggers GET `/api/attendance/stats/student/{id}` and shows 5 summary cards (حاضر/غائب/متأخر/معذور/إجمالي) + معدل الحضور chip. After that, an "عرض التفاصيل" button fetches `/api/attendance/student/{id}` and renders the detailed records (capped at 100).
  - **Modals:** Edit info (PUT `/api/students/{id}`) and Change Status (POST `/api/student-status/{id}/change`) — both inline, fully styled, RTL.
  - **Excel export:** `/api/export/report/student/{id}/excel`.
  - **`/students.tsx` updated:** `handleViewDetails` now routes to `/student-details?studentId=ID` (was opening modal); the `?openStudent=ID` query param now redirects to the new page (legacy compatibility for global search results).
  - **Verified:** iteration_31 backend pytest 6/6 PASS · iteration_32 frontend 100% PASS (all 22 testIDs reachable, attendance-empty-on-mount network invariant verified, edit/status modals exercised).
- 2026-06-15 **Teacher Courses page (`/teacher-courses`) redesigned + course assignment**:
  - Applied new design system: page header with breadcrumb (الرئيسية > المعلمون > المقررات), teacher info card with avatar, 3 colorful stat cards (إجمالي المقررات / الطلاب / المحاضرات), course list cards with rich metadata badges.
  - **NEW: Assign Courses flow** — primary "إسناد مقرر" button opens modal with debounced course search (`/api/teaching-load/search-courses`), multi-select with checkboxes, per-course weekly-hours input, "إخفاء المقررات المسندة لمعلمين آخرين" filter, batch save via `POST /api/teaching-load/bulk`.
  - **NEW: Unassign flow** — per-course "إلغاء الإسناد" button + confirmation modal calls `PUT /api/courses/{id}` with `teacher_id: null`.
  - **Backend fix**: `update_course` in `server.py` (line 5617) switched from `{k:v for k,v in data.dict().items() if v is not None}` (which silently dropped null values) to `data.dict(exclude_unset=True)` so explicit `teacher_id: null` now clears the field AND removes the matching `teaching_loads` row.
  - **Frontend fix**: replaced all `data-testid` JSX attributes with `testID` for proper RN-Web bridging (data-testid props weren't reaching the DOM on TouchableOpacity/View/TextInput).
  - Verified end-to-end (iteration_29): 4/4 backend pytest cases pass, all testIDs discoverable, assign + unassign flows persist correctly in DB.
- 2026-06-15 **Responsive design system for all redesigned admin pages**:
  - Added `/app/frontend/src/utils/responsiveStyles.ts` — injects CSS Media Queries once at app boot (web only) via `_layout.tsx`.
  - Breakpoints: Desktop (>1024px) · Tablet (≤1024px → 2x2 stats grid) · Mobile (≤768px → 1-col stacks, table rows become vertical) · Small mobile (≤480px → action buttons stack).
  - Hook applied to 5 pages via `dataSet={{ responsive: '...' }}` attributes which map to `[data-responsive="..."]` CSS selectors. Keys: `page-scroll`, `page-header`, `page-header-actions`, `page-title`, `stats-grid`, `course-header`, `filter-row`, `table-row`, `table-header-row`, `lecture-card`, `lecture-status-abs`, `table-footer`.
  - On mobile: page header stacks vertically, stat cards become 1-per-row, filters become full-width, table rows transform to vertical card style, lecture cards stack, page title shrinks 26px→18px.
  - Course Lectures (`/course-lectures`): added 4th stat card "إجمالي المحاضرات" (الكل) showing total lecture count, before the scheduled/completed/absent cards.
- 2026-06-15 **Course Lectures page redesigned (`/course-lectures`)** — Applied new design system:
  - Top course header card: book icon + course name + code + meta chips (hours / department / level / students count).
  - Action buttons (top-left): "إضافة محاضرة" (green) · "توليد تلقائي" (purple) · "تحديد متعدد" (outline).
  - 4 stats cards: Total students · Scheduled · Completed · Absent.
  - Filter bar: search + status dropdown + day dropdown + date-range (from–to) + "تصفية" reset.
  - Lecture rows as cards (one per row) with: numbered badge · day name · date · time · room · 4 mini counters (total/scheduled/completed/absent) · action buttons (التفاصيل / إعادة الجدولة / تسجيل الحضور / 3-dot) · status badge.
  - Pagination footer: page numbers + per-page selector + Prev/Next.
  - 3-dot action Modal: View details · Reschedule · Cancel lecture · Delete (with proper permission checks).
  - All existing logic preserved (selection mode, bulk delete, reschedule modal, generate semester, attendance, etc.).
- 2026-06-15 **Unified Design System across admin pages (students, teachers, courses, faculty-details)**:
  - Applied consistent new SaaS-style design to `/students`, `/manage-teachers`, `/(tabs)/courses`, and `/faculty-details`.
  - **Pattern:** Light bg (`#f4f6fb`), white rounded cards with thin borders, colorful circular stat icons, clean table layout with avatar/badge cells, centered Modal action menus.
  - **Common building blocks:** Page header (title + breadcrumb + action buttons), 4 colored stat cards (green/cyan/orange/purple), filter card (search + dropdowns + reset/apply), tabular list with pill badges, 3-dot row menu opening as centered Modal, footer with per-page selector + numbered pagination.
  - **Per-page specifics:**
    - `/students`: 8-column table (student/uni ID/inner ID/program/level/status/date/actions) + bulk selection bar + status-history menu item.
    - `/manage-teachers`: 8-column table (teacher/phone/dept/specialization/load/courses/account/actions) with avatar initials and account pill.
    - `/courses`: 7-column table (course/dept/level/teacher/students/lectures/actions) + active semester badge + "المزيد" menu (templates, lectures import, auto-enroll, restore).
    - `/faculty-details`: 4 stat cards + "البيانات الأساسية" info card + departments table with student/course chips.
  - All existing logic preserved (CRUD, Excel import/export, bulk operations, status/level changes, safe delete with backup, warnings, history, auto-enroll, etc.).
- 2026-02 Term field added to Semester create/edit (UI + backend)
- 2026-02 Multi-section curriculum offering generator (sections_map)
- 2026-02 Teaching Load Report redesigned (filters: semester/department/teacher) + reads from `semester_archives` for archived semesters
- 2026-02 GCP Cloud Run parallel deployment with Kaniko cache + GitHub Actions CI
- 2026-02 MongoDB Atlas downgraded M30 → M10 (cost optimization)
- 2026-02-26 **Student Level Change with Section Reassignment**:
  - Edit modal: inline notice when level changes AND student has a section; quick actions (keep / clear) + suggested chips from existing sections at the new level + manual input.
  - Bulk modal: 2-step flow – pick level → choose section action (keep current per-student / set unified section / clear). Suggestion chips at new level.
  - Backend `POST /api/students/bulk-change-level` now accepts `section_mode` ("keep" | "set" | "clear") + optional `new_section`. Backward-compatible default = "keep".
- 2026-06-02 **Multi-Identifier Login + Duplicate student_id Support**:
  - Login accepts: `username` (default), `reference_number`, or `student_id` (if unique).
  - When `student_id` is duplicated across students, login by student_id returns 409 — user must use reference_number.
  - `POST /api/students` and Excel import: allow duplicate `student_id` only if `department_id` differs (rejects same-dept duplicates).
  - `PUT /api/students/{id}` and restore endpoints: same scoped duplicate rule.
  - `POST /api/students/{id}/activate`: if `student_id` is already taken in `users.username`, fallback to `reference_number` as username automatically.
  - `POST /api/students` (with password): same fallback.
  - Login screen placeholder updated: "اسم المستخدم / رقم القيد / الرقم المرجعي".
- 2026-06-02 **Active Semester Scoping for Teaching Load**:
  - `GET /api/teaching-load/search-courses` defaults to active semester (excludes archived). Accepts `semester_id` override.
  - `GET /api/teaching-load/teacher/{id}/courses` same default + override + existing-loads also scoped.
  - `GET /api/teaching-load` defaults to active semester. Accepts `semester_id` or `all_semesters=true`.
  - `POST /api/teaching-load/bulk` "course assigned to other teacher" check now scoped to same `semester_id` (a course can be reassigned in a new semester without conflict with archived assignment).
  - Frontend: active-semester badge displayed at top of `teaching-load` page with green accent ("الفصل النشط: ...").
- 2026-06-02 **Teaching Load Templates** (نسخ الإسنادات بين الفصول):
  - New collection `teaching_load_templates` storing snapshots.
  - Endpoints: `GET/POST /api/teaching-load/templates`, `POST /api/teaching-load/templates/{id}/apply`, `DELETE /api/teaching-load/templates/{id}`.
  - Snapshot stores: course_code/level/section/dept + curriculum_course_id + teacher_employee_id + full_name + weekly_hours + notes.
  - Apply matches courses by curriculum_course_id (primary) → code+level+section+dept (fallback) → code+level+section. Teachers matched by employee_id → full_name.
  - Returns detailed stats: created/updated/skipped + unmatched courses + unmatched teachers.
  - Frontend: 2 buttons in teaching-load header (Save Template / Apply Previous Template) + 2 modals. Save modal: name + term selection. Apply modal: template picker + target semester + overwrite checkbox + results dashboard.
- 2026-06-04 **Weekly Schedule Drafts + Visual Export**:
  - New collection `weekly_schedule_drafts` (capped to last 10 per scope) — lightweight snapshots, not archived.
  - Endpoints: `GET/POST /api/weekly-schedule/drafts`, `POST /drafts/{id}/restore`, `GET /drafts/{id}/compare`, `DELETE /drafts/{id}`.
  - Visual export endpoints: `GET /weekly-schedule/export-visual/pdf` + `/excel` with filters (faculty/dept/level/section/teacher/room/semester).
  - PDF: A4 landscape, Arabic-shaped text via arabic-reshaper + bidi, colored cells (header blue, time slots light blue, empty grey).
  - Excel: openpyxl with RTL layout, merged title row, colored fills, bordered cells.
  - Frontend: 3 new buttons in weekly-schedule (Save Draft / Drafts List / Export) + 3 modals using HTML-native dialogs on web.
  - Drafts modal shows side-by-side comparison stats (teachers/rooms/courses/by_day) between draft and current schedule.
  - Export modal: format toggle (PDF/Excel) + scope picker (all/department/section/teacher/room).
- 2026-06-04 **Availability Report (تقارير الفراغ/الإشغال)**:
  - Backend endpoints: `GET /api/weekly-schedule/availability/rooms` and `/teachers` — given day_of_week + slot_number (+ optional faculty/department/semester), returns lists of free/busy rooms or teachers.
  - Rooms response: `{filter, total, free_count, busy_count, rooms: [{id, name, code, capacity, type, status, details}]}` where `details` shows the occupying course/teacher/section.
  - Teachers response adds preference status (preferred / neutral / non_preferred_day / unavailable) based on teacher schedule preferences, plus `free_preferred / free_neutral / free_unavailable` counts.
  - Frontend page `/availability-report` (linked from weekly-schedule via `availability-report-btn`): toggle rooms/teachers, day chips, slot chips, optional faculty/department filters, summary cards, and color-coded list with preference badges.
  - Validated end-to-end via screenshot tool: rooms tab returns 3 free rooms, teachers tab shows 3 available teachers with neutral preference badges.
- 2026-06-04 **Restore Auto-Backup + Real Slot-by-Slot Compare**:
  - `POST /weekly-schedule/drafts/{id}/restore?backup_current=true` (default) — قبل استبدال الجدول الحالي بالنسخة المختارة يتم تلقائياً حفظ الجدول الحالي كنسخة احتياطية باسم وصفي (`نسخة تلقائية قبل استعادة "..."`), فلا تُفقد البيانات الحالية أبداً.
  - الاستجابة تتضمن `backup_id`, `backup_slots_count`, `backup_created` للتأكيد.
  - `GET /weekly-schedule/drafts/{id}/compare` تم توسيعها إلى **مقارنة حقيقية slot-by-slot**: مفتاح الهوية (course_id + day + slot_number + section + level) لتحديد "نفس الخانة"، ومقارنة قيم (teacher_id, teacher_name, room_id, room_name, notes) للكشف عن التعديلات.
  - تُرجع `diff: { added[], removed[], changed[ {..., diffs: {field: {draft, current}}}], added_count, removed_count, changed_count, unchanged_count }` مع إثراء الأسماء (course/teacher/room/department) من lookup batched.
  - واجهة `weekly-schedule.tsx`: تنبيه استعادة محدّث ("سيتم حفظ الجدول الحالي تلقائياً..."), modal مقارنة موسّعة لعرض 4 بطاقات إحصائية ملونة + 3 أقسام قابلة للطي (مضاف/محذوف/معدّل) مع تفاصيل كل slot وتمييز قبل/بعد للحقول المتغيرة بألوان (أحمر شطب → أخضر سميك).
- 2026-06-04 **Summer Term Support (term=3) في الخطة الدراسية**:
  - Backend: `CurriculumCourseCreate/Update` يقبل الآن `term ∈ {1,2,3}` (كان 1-2 فقط) — `term=3` للفصل الصيفي.
  - `GET /curriculum/by-department/{id}` يُرجع الآن `grid[level].term3` بجانب `term1` و `term2`.
  - `POST /curriculum/generate-offerings?term=3` يجلب فقط مقررات الخطة المرتبطة بـ `term=3` (سابقاً: كان يأخذ كل المقررات بدون فلترة عند term=3).
  - Frontend `curriculum.tsx`: عمود ثالث "الفصل الصيفي" بلون برتقالي مميز (#ef6c00) داخل كل مستوى، زر `form-term-3` "الفصل الصيفي" في فورم إضافة مقرر، رسالة "تم توليد X جلسة" تعرض "الفصل الصيفي" بدلاً من "كل الفصول".
  - E2E مختبر: إنشاء فصل صيفي → تفعيله → إضافة "تدريب ميداني صيفي SUMM101 (term=3)" → ظهر في عمود الفصل الصيفي للمستوى 2 → توليد جلسات للفصل الصيفي ولّد محاضرة واحدة فقط (المقرر الصيفي الوحيد، وليس كل الخطة).
- 2026-06-11 **`/students` Page Frontend Performance Fix (P0)**:
  - Wrapped all 9 heavy modals (`Import`, `Details`, `Edit`, `Warning`, `Level`, `BulkSection`, `Status`, `History`, `SafeDelete`) with conditional rendering (`{showXModal && (<Modal>…</Modal>)}`) so their full JSX subtrees (forms, pickers, scrollviews, hundreds of nodes) are no longer constructed on initial mount. Saves the majority of first-render React work.
  - Converted `getDepartmentName` from O(n) `Array.find` per row to O(1) `Map.get` lookup via memoized `departmentMap`.
  - Wrapped `renderStudent` in `useCallback` with proper deps (`selectedIds`, `selectionMode`, `canManageStudents`, `getDepartmentName`) — stable identity helps `FlatList` skip needless row re-renders.
  - Backend `GET /api/students` already optimized in earlier session (376ms, no enrollments). API + UI are now both fast.
- 2026-06-11 **FCM Push Notifications Critical Bug Fix (P0)**:
  - **السبب الجذري (تأكّد لاحقاً)**: في الـ Backend في Cloud Run، متغيرات Firebase (`FIREBASE_SERVICE_ACCOUNT_JSON` أو `FIREBASE_SERVICE_ACCOUNT_PATH`) **لم تكن مُعرَّفة** بعد ترحيل Railway → Google Cloud Run. النتيجة: `firebase_admin` لم يُهيَّأ على الإنتاج → كل `messaging.send_each_for_multicast()` يفشل صامتاً.
  - **النتيجة قبل الإصلاح**: 100% من إشعارات Push تفشل على Cloud Run. الإشعارات داخل التطبيق تعمل لأنها قراءة من MongoDB مباشرة (مسار منفصل).
  - **الإصلاح**:
    1. رُفع `firebase-service-account.json` من مشروع `ahgaff-attendance` إلى GCP Secret Manager باسم `firebase-service-account` (في مشروع `ahgaff-university` GCP)
    2. مُنحت Cloud Run compute service account صلاحية `roles/secretmanager.secretAccessor`
    3. تحديث `/app/cloudbuild-backend.yaml`: إضافة `FIREBASE_SERVICE_ACCOUNT_JSON=firebase-service-account:latest` إلى `--update-secrets`
    4. الكود يقرأ `os.environ['FIREBASE_SERVICE_ACCOUNT_JSON']` تلقائياً (موجود في `services/firebase_service.py:17`)
  - **تحسينات إضافية**:
    - Logging مفصّل لكل توكن فشل: `FCM send failed [token=...] [code=...] [msg=...]`
    - Endpoint تشخيصي جديد: `POST /api/notifications/debug-send` يُرجع `success_count`, `failure_count`, `failed_details[]` مع `error_code` (مثل `INVALID_ARGUMENT`, `UNREGISTERED`, `SENDER_ID_MISMATCH`)
    - إصلاح ثانوي: استبدال `WebpushFCMOptions.link="/"` بـ `"https://app.ahgaff.net/"` في `send_notification()` (دالة أقل استخداماً)
  - **معلومات معمارية مؤكَّدة**:
    - Firebase project: `ahgaff-attendance` (Spark plan)
    - يحوي ٣ تطبيقات: `com.ahgaff.teacher`, `com.ahgaff.student`, web app
    - ملف واحد فقط `firebase-service-account.json` يخدم كل التطبيقات (Best practice)
  - **النتيجة المؤكَّدة**: ✅ المستخدم اختبر فعلياً → الإشعارات وصلت لكلا تطبيقَي المعلم والطالب

- 2026-06-12 **Wafideen Domain Migration (Railway → Cloud Run) — مكتمل ✅**:
  - **النطاقات المُرحَّلة**: `wafideen.ahgaff.net` (Frontend) و `api.wafideen.ahgaff.net` (Backend)
  - **Cloud Run targets**: `wafideen-frontend-3pzknh7knq-ww.a.run.app` و `wafideen-backend-872667841290.me-central1.run.app`
  - **Cloudflare Workers**: `wafideen-api-proxy` و `wafideen-frontend-proxy` (Code محفوظ في `/app/cloudflare-workers/`)
  - **النمط**: Custom Domain على كل Worker (يُنشئ DNS records تلقائياً)
  - **اختبار E2E**: ✅ Backend `HTTP/2 404` + `x-proxied-by: Cloudflare-Worker-Wafideen` / Frontend `HTTP/2 200`

- 2026-06-15 **🔧 إعادة ميزة "إضافة طالب موجود" + توحيد نمط النافذة في صفحة المقرر**:
  - **بلاغ المستخدم**: 
    1. كنت قد ألغيت ميزة "إضافة طالب موجود إلى المقرر" بالخطأ عند الـ refactor السابق — كانت موجودة قبل ذلك
    2. نافذة "إنشاء طالب جديد" في صفحة المقرر كانت بنمط slide-up (`pageSheet`) — المستخدم يريدها بنفس نمط Popup منبثق المركَّز كما في صفحة `/students`
  - **الإصلاح في `/app/frontend/app/course-students.tsx`**:
    - **state جديد**: `addTab: 'existing' | 'new'` (يحدد التبويب النشط)
    - **نافذة موحَّدة بـ Modal منبثق** (transparent + fade animation + overlay شبه شفاف) — نفس نمط `/students` ✅
    - **تبويبان أعلى النافذة**:
      - **"من القائمة"**: عرض FlatList بالطلاب غير المسجَّلين في المقرر + بحث + اختيار متعدد + زر تسجيل
      - **"إنشاء طالب جديد"**: مكوّن `AddStudentForm` المشترك (mode="course")
    - **التبويب الأول يعرض العداد**: "من القائمة (45)" — عدد الطلاب المتاحين
    - يستخدم الـ handlers الموجودة مسبقاً: `handleEnrollStudents` للطلاب الموجودين، `handleCreateAndEnroll` للطلاب الجدد
    - حالات فارغة واضحة: "لا يوجد طالب يطابق البحث" / "لا يوجد طلاب متاحون لإضافتهم"
  - **الفائدة**:
    - استعادة الوظيفة المحذوفة بالخطأ ✅
    - تجربة موحَّدة ١٠٠٪ بين `/students` و `/course-students` (نمط Popup، fade، overlay)
    - حرية المستخدم بالتبديل بين تسجيل طالب موجود أو إنشاء طالب جديد بنفس النافذة


  - **الهدف**: منع أي اختلاف مستقبلي بين نموذجَي إضافة الطالب في `/students` و `/course-students` — أي حقل جديد يُضاف مرة واحدة في المكوّن وينعكس فوراً في كلا الصفحتين.
  - **الملف الجديد**: `/app/frontend/src/components/AddStudentForm.tsx` (~210 سطر) يصدّر:
    - `AddStudentForm` (المكوّن نفسه)
    - `StudentFormValues` (TypeScript type للحالة)
    - `emptyStudentForm` (قيم ابتدائية موحَّدة)
  - **Props**:
    - `mode`: `'standalone'` (يُظهر القسم/المستوى/الشعبة كحقول) أو `'course'` (يخفيها لأنها مأخوذة من المقرر)
    - `values`, `onChange`, `onSubmit`, `onCancel`, `submitting`
    - `departments` (مطلوب فقط في standalone)
    - `contextLabel` (نص ملخّص في الرأس مثل اسم المقرر)
    - `submitLabel` (مخصّص: "إضافة" أو "إنشاء وتسجيل")
  - **الحقول الموحَّدة**: رقم القيد، الاسم، القسم (standalone فقط)، المستوى (standalone فقط)، الشعبة (standalone فقط)، رمز البرنامج، عام الالتحاق، الجوال، البريد، كلمة المرور
  - **الاستخدام في `students.tsx`**: `mode="standalone"` + قائمة الأقسام
  - **الاستخدام في `course-students.tsx`**: `mode="course"` + `contextLabel="سيُسجَّل في: {اسم المقرر}"`
  - **حذف الكود المكرَّر**: ~145 سطراً من `students.tsx` + ~120 سطراً من `course-students.tsx` (إجمالي ~265 سطر مكرَّر استُبدلت بـ ~210 سطر مشترك قابل للصيانة).
  - **الفائدة**: تجربة موحَّدة + صيانة سهلة + اتساق بين الواجهات + اختبار من نقطة واحدة.


  - **بلاغ المستخدم**: نموذج إضافة طالب في `course-students` يفتقد لحقول رمز البرنامج وعام الالتحاق الموجودة في صفحة الطلاب الرئيسية.
  - **الإصلاح في `/app/frontend/app/course-students.tsx`** (`handleCreateAndEnroll` + النموذج):
    - **حقل "رمز البرنامج"** (TextInput, auto-uppercase, max=3 أحرف) — اختياري، افتراضي من القسم
    - **حقل "عام الالتحاق"** (TextInput رقمي يقبل 25 أو 2025، يُطبَّع لرقمين) — اختياري، افتراضي محسوب من المستوى
    - **رسالة تنبيه** تشرح آلية توليد الرقم المرجعي بنفس صياغة صفحة الطلاب
    - رسالة النجاح تعرض الرقم المرجعي للطالب فور إنشائه
    - تنظيف الـ state بعد الإرسال (يشمل الحقلين الجديدين)
  - **الفائدة**: تجربة موحّدة بين صفحة `/students` وصفحة `/course-students` — نفس الحقول، نفس السلوك، نفس آلية توليد الرقم المرجعي.

- 2026-06-15 **➕ تحسينات نافذة إضافة طالب — حقول رمز البرنامج وعام الالتحاق + إزالة الـ default للشعبة**:
  - **بلاغ المستخدم**: الشعبة لا يجب أن تكون افتراضياً "أ" (يجب السماح بفراغها) + الرقم المرجعي يحتاج رمز برنامج وعام التحاق
  - **الإصلاح**:
    - **الشعبة**: إزالة الـ default value "أ" — يُرسل فارغاً للـ backend (placeholder تغيّر إلى "اتركها فارغة لو لا توجد")
    - **حقل رمز البرنامج**: TextInput جديد (auto-uppercase) — اختياري، الافتراضي من `default_program_code` الخاص بالقسم
    - **حقل عام الالتحاق**: TextInput رقمي (يقبل 25 أو 2025 ويُطبَّع لرقمين) — اختياري، الافتراضي يُحسب من المستوى
    - **رسالة تنبيه ذكية** في النموذج تشرح كيف يُولَّد الرقم المرجعي (= رمز البرنامج + عام الالتحاق + كلية)
    - رسالة النجاح أصبحت تعرض الرقم المرجعي للطالب فور إنشائه
  - **الاختبار**: ✅ مع `{program_code:"M", enrollment_year:"23", section:""}` → reference_number = `AUM2301001` (يحوي M و 23 بنجاح، والشعبة فارغة).

- 2026-06-15 **➕ زر "إضافة طالب مفرد" في صفحة إدارة الطلاب**:
  - **الطلب**: المستخدم لاحظ أن صفحة إدارة الطلاب فيها زر **استيراد** (Excel) فقط، بلا طريقة لإضافة طالب واحد بسرعة
  - **الإصلاح** (`/app/frontend/app/students.tsx`):
    - زر جديد (أيقونة 👤+) بجانب زر الاستيراد — يفتح نافذة مدمجة
    - نافذة فيها حقول: رقم القيد *، الاسم *، القسم * (Picker)، المستوى * (Picker)، الشعبة (افتراضياً "أ")، الجوال، البريد، كلمة المرور
    - الحقول الإلزامية (*): رقم القيد + الاسم + القسم (المستوى افتراضي 1)
    - **ذكاء UX**: الفلاتر الحالية (قسم/مستوى/شعبة) تُعبّأ تلقائياً في النموذج عند فتحه — لو كنت تتصفّح قسم معيّن، يأتيك القسم محدّداً مسبقاً
    - الفرونت يستخدم `POST /api/students` الموجود مسبقاً (لا حاجة لـ endpoint جديد)
  - **الباك إند**: يعبّئ تلقائياً faculty_id، program_code، enrollment_year، reference_number، qr_code من القسم/المستوى — المستخدم لا يحتاج إدخالها
  - **الاختبار**: ✅ `POST /api/students` اختُبر بـ curl وأنشأ طالباً بنجاح مع كل الحقول المعبَّأة تلقائياً.


  - **بلاغ المستخدم**: 
    1. تغيير حالة طالب إلى "إعادة" — لم يتغيّر شيء في الواجهة
    2. تغيير حالة إلى "متخرج" — الطالب اختفى من **كل** القوائم (الكل، المتخرجين، النشطين)
  - **السبب الجذري** (3 مشاكل متراكبة في `GET /api/students` في `server.py:3057`):
    1. الـ Query: `query = {"is_active": True}` كان يفلتر بشكل صارم — الطلاب المتخرّجون/المفصولون/المجمَّدون لديهم `is_active=False` فيختفون **تماماً** من الـ API
    2. الـ Response: لا يحوي حقل `status` نهائياً — الـ Frontend يستنتجها من `is_active` فقط، فحالة "repeat" تبدو "active" وحالة "graduated" تبدو "inactive"
    3. حقول إضافية مفقودة: `status_changed_at`, `status_reason`, `graduation_date`, `graduated_from_level`, `expulsion_date`, `frozen_at`
  - **الإصلاح** (`/app/backend/backend/server.py`):
    - إزالة `"is_active": True` من الـ query (يُرجع كل الطلاب)
    - إضافة query params اختيارية: `status` و `is_active` للفلترة من الـ Frontend
    - إضافة كل حقول الحالة في dict الـ response
    - الـ Pydantic model `StudentResponse` يدعم هذه الحقول مسبقاً
  - **الاختبار**: ✅ `GET /api/students` يُرجع الآن:
    - **92 طالب** (بدلاً من 91 — الطالب المتخرّج عاد!)
    - حقل `status` يحوي القيمة الفعلية: "graduated", "active", "repeat", إلخ
  - **الفائدة**: تغيير الحالة سيظهر فوراً في UI + الطلاب المتخرّجون/المفصولون/المجمَّدون يظهرون في فلتر "كل الحالات".


  - **المشكلة**: عند البحث عن طالب من البحث الشامل (GlobalSearch) والنقر على نتيجة الطالب، الصفحة "لا تفتح شيئاً" — كانت `/app/frontend/app/student-details.tsx` مجرد placeholder يعرض أيقونة + رقم الطالب فقط (٤٤ سطر فقط، بدون أي جلب لبيانات حقيقية).
  - **الإصلاح**:
    1. **`student-details.tsx`** أُعيد بناؤها: تُعرض حالة تحميل ("جاري فتح بيانات الطالب...") ثم تُحوّل إلى `/students?openStudent={id}` بعد 500ms (لضمان تركيب Root Layout)
    2. **`students.tsx`** أُضيف:
       - `useLocalSearchParams<{ openStudent?: string }>` لقراءة الـ query param
       - `useEffect` جديد يفتح نافذة تفاصيل الطالب تلقائياً عند توفّر `openStudent` + تحميل قائمة الطلاب
       - رسالة خطأ واضحة لو الطالب غير موجود ("غير موجود")
  - **الفائدة**: إعادة استخدام كاملة لنافذة تفاصيل الطالب الموجودة في `students.tsx` (مع كل الوظائف: التعديل، الحذف، تغيير الحالة، إلخ) بدلاً من بناء صفحة منفصلة.
  - **الاختبار**: ✅ JSX يجمَّع بدون أخطاء؛ الصفحة الوسيطة تُحمَّل بسلام.


  - **Endpoint جديد في Backend** (`/app/backend/backend/routes/weekly_schedule.py`):
    - `GET /api/weekly-schedule/conflicts` — يفحص كل الجدول الحالي ويُرجع 3 أنواع من التعارضات:
      1. **تعارض شعبة**: نفس (department + level + section + day + slot_number) لأكثر من مقرر
      2. **تعارض معلم**: نفس teacher_id في نفس اليوم والفترة في مكانَين مختلفَين
      3. **تعارض قاعة**: نفس room_id محجوزة لمقررَين في نفس الوقت
    - يقبل نفس فلاتر `/weekly-schedule` (faculty/dept/level/section/teacher/semester)
    - يُرجع: `total_conflicts`, `total_conflicting_slots`, `conflicting_slot_ids[]`, `section_conflicts[]`, `teacher_conflicts[]`, `room_conflicts[]`, `all_conflicts[]`
    - كل تعارض غني بالتفاصيل: `day, slot_number, slot_ids[], count, department_name/teacher_name/room_name`
  - **Frontend** (`/app/frontend/app/weekly-schedule.tsx`):
    - يجلب التعارضات تلقائياً مع كل `loadSchedule` (بنفس الفلاتر)
    - **مؤشر بصري لكل خلية متعارضة**: حدود حمراء سميكة + خلفية وردية باهتة + شارة `!` حمراء دائرية في الزاوية + ظل أحمر خفيف
    - **لافتة تحذير علوية**: تظهر فوق الجدول مع عدد التعارضات + عدد الخلايا المتأثرة + قابلة للضغط لفتح نافذة التفاصيل
    - **نافذة تفاصيل**: تُصنّف التعارضات إلى ٣ مجموعات ملوّنة (شعبة/معلم/قاعة) مع عدّاد لكل نوع، ثم قائمة كاملة فيها اليوم + الفترة + الاسم/القسم/المستوى/الشعبة المتعارضة
  - **التحقق**: ✅ Endpoint اختُبر بـ curl → يُرجع 0 تعارضات (لأن DB المحلية لا تحوي تعارضات)
  - **القيمة**: المستخدم يستطيع الآن رؤية كل التعارضات بنظرة واحدة بدلاً من اكتشافها يدوياً بالمقارنة بين الخلايا.


  - **Endpoints جديدة في Backend** (`/app/backend/backend/server.py`):
    - `GET /api/departments/{id}/distinct-levels` → يُرجع المستويات الموجودة فعلياً في القسم (من `db.students.distinct`)
    - `GET /api/departments/{id}/distinct-sections?level=N` → يُرجع الشعب الموجودة فعلياً (اختيارياً مع فلتر المستوى)
  - **Backend** `send_department_final_results_upload`: يقبل query params اختيارية `level: int` و `section: str` ويفلتر طلاب القسم وفقاً لها
  - عنوان الإشعار يعكس الفلاتر: "النتيجة النهائية - {القسم} - المستوى {N} - الشعبة {X}"
  - **Frontend** (`/app/frontend/app/send-department-results.tsx`):
    - **حُذِفت** القوائم الثابتة (`LEVELS = [1..8]` و `SECTIONS = ['A'..'E']`) — كانت غير دقيقة (الشعب الفعلية بحروف عربية!)
    - State جديد: `availableLevels`, `availableSections`, `loadingLevels`, `loadingSections`
    - `useEffect` يجلب المستويات تلقائياً عند تغيير القسم + إعادة تعيين فلتر المستوى/الشعبة
    - `useEffect` آخر يجلب الشعب عند تغيير القسم أو المستوى
    - Pickers تعرض عدد الخيارات المتاحة وحالة التحميل
    - رسائل واضحة عند عدم وجود بيانات: "-- لا يوجد طلاب في هذا القسم --" و "-- لا توجد شعب في هذا المستوى --"
    - الـ Pickers معطّلة (`enabled={false}`) عند التحميل أو عدم وجود خيارات
  - **التحقق**: ✅ Endpoints اختُبرت بـ curl وأرجعت بيانات حقيقية (Levels: [1, 2], Sections: ["أ"]).
  - **الهدف**: ترحيل `wafideen.ahgaff.net` و `api.wafideen.ahgaff.net` من Railway إلى Google Cloud Run me-central1 عبر Cloudflare Workers (نفس النمط المستخدم لـ api/app.ahgaff.net).
  - **Cloud Run targets**:
    - Frontend: `https://wafideen-frontend-3pzknh7knq-ww.a.run.app/`
    - Backend: `https://wafideen-backend-872667841290.me-central1.run.app/`
  - **Cloudflare Workers تم إنشاؤهما**:
    - `wafideen-api-proxy` (الكود محفوظ في `/app/cloudflare-workers/wafideen-api-proxy.js`)
    - `wafideen-frontend-proxy` (الكود محفوظ في `/app/cloudflare-workers/wafideen-frontend-proxy.js`)
  - **حالة DNS الحالية في Cloudflare** (آخر screenshot):
    - ✅ سجلَا AAAA منشآن: `api.wafideen.ahgaff.net → 100::` و `wafideen.ahgaff.net → 100::` (Proxied)
    - ⚠️ **مشكلة**: المستخدم أنشأ Custom Domains خاطئة في الـ Workers:
      - الموجود: `wafideen-api-proxy.ahgaff.net` (خطأ - اسم الـ Worker كاملاً + ahgaff.net)
      - الموجود: `wafideen-frontend-proxy.ahgaff.net` (خطأ)
    - 🎯 **الخطوة التالية المطلوبة عند العودة**:
      1. حذف Custom Domains الخاطئة من إعدادات كل Worker (Settings → Triggers → Custom Domains)
      2. حذف سجلَي AAAA `100::` من DNS Records (لأن Custom Domain سيُنشئها تلقائياً)
      3. إضافة Custom Domain صحيح في كل Worker:
         - `wafideen-api-proxy` → Custom Domain: **`api.wafideen.ahgaff.net`**
         - `wafideen-frontend-proxy` → Custom Domain: **`wafideen.ahgaff.net`**
      4. اختبار: `curl -i https://api.wafideen.ahgaff.net/` و `curl -I https://wafideen.ahgaff.net/`
  - **بدائل لو لم ينجح Custom Domains**: استخدام Workers Routes بدلاً (في ahgaff.net → Workers Routes):
    - `api.wafideen.ahgaff.net/*` → `wafideen-api-proxy`
    - `wafideen.ahgaff.net/*` → `wafideen-frontend-proxy`
  - **بعد نجاح ترحيل wafideen**: نُحدّث CORS على wafideen-backend ليقبل `https://wafideen.ahgaff.net`.

## P0 / Next
- (P1) Digital Student Card with QR + Photo
- (P2) QR scanner in Teacher App (read Student Cards)
- (P2) "Copy assignments from previous semester" in teaching-load page
- (P2) Automatic Teaching Load templates during curriculum generation
- (P2) Fix orphaned `teaching_loads` cleanup on semester archive

## Recently completed (2026-02)
- ✅ **General settings admin-only (2026-07)**: شكوى: /general-settings كانت تظهر لغير الأدمن عبر بطاقة "الكليات" في الرئيسية. **الإصلاح (فرونت فقط — دون مساس بالصلاحيات/الأدوار الأخرى)**: (1) حارس صفحة في general-settings.tsx: غير الأدمن → شاشة "متاحة لمدير النظام فقط" مع زر رجوع (testID='general-settings-access-denied'). (2) بطاقة الكليات في (tabs)/index.tsx: route='/general-settings' للأدمن فقط، غير الأدمن بطاقة معلوماتية بلا تنقل (onPress يتجاهل route الفارغ). (3) SideMenu: بند الإعدادات العامة أصبح adminOnly. QuickNav كان adminOnly أصلاً. **ملاحظة معلقة**: باك اند PUT /settings يسمح لأصحاب manage_courses (لم يُغيَّر عمداً حفاظاً على تدفقات أخرى). مختبَر E2E: Salim (عميد) محظور بشاشة نظيفة، admin يدخل طبيعياً.
- ✅ **Multi-faculty users — تعدد الكليات (2026-07)**: بموافقة صريحة (نائب رئيس يشرف على كليتين / مدير تسجيل مشترك — كليات كاملة فقط). **Backend (server.py)**: (1) فرع في مطلع `get_user_scope_filter` (بعد التنظيف): `faculty_ids` بعدد ≥2 ولغير teacher → departments filter بـfaculty_id $in، وstudents/courses/teachers بـdepartment_id $in لكل أقسام الكليات، وأنواع أخرى تسقط للفروع القديمة. (2) create_user: faculty_ids تضبط faculty_id=الأولى (توافق) وتمسح الأقسام عند التعدد، department_head ممنوع من التعدد (400). (3) UserUpdate + update_user بنفس المنطق. (4) get_faculties يشمل faculty_ids. (5) get_users يرجع faculty_ids + faculty_names (والاسم المعروض " | ".join عند التعدد). UserResponse: حقل faculty_names. **جدول النطاقات في PERMISSIONS_ARCHITECTURE.md محدَّث** بصف التعدد. **Frontend (manage-users.tsx)**: faculty_ids في formData، مبدّل كليات متعدد (toggle) في نافذتي الإضافة والتعديل مع ملاحظة "🏛️ تعدد كليات (N)" (testID='multi-faculty-note'/'edit-multi-faculty-note') وإخفاء الأقسام عند التعدد، الحفظ يرسل faculty_ids. **اختبار**: باك اند /tmp/test_multi_faculty.py (8/8 PASS: إنشاء، رؤية الكليتين، نطاق الأقسام/الطلاب/المقررات بلا تسريب، regression عميد ورئيس قسم، منع رئيس القسم، تحديث للتعدد والعودة) + فرونت testing_agent iteration_59 (12/12 PASS). **درس مهم من وكيل الاختبار**: RN Web يسقط `data-testid` من مكونات RN (View/TouchableOpacity) — يجب استخدام `testID` بدلاً منه (المكونات HTML div/button لا تتأثر). ~262 استخدام قديم في ~30 شاشة ميت للأتمتة (دين فني مؤجل). أصلحت أيضاً: نافذة تعديل المستخدم كانت تعرض دوري طالب/مدرس بخلاف الإضافة.
- ✅ **Template download for ALL departments + full guides sheet (2026-07)**: شكوى: تحميل قالب الاستيراد كان يُرفض للأقسام غير المسندة ("لا توجد مجموعات — أضف مقررات بمعلمين") لأن groups من `_build_master_data` تُبنى من مقررات لها teacher_id فقط. **الإصلاح** في `download_import_template`: المجموعات تُبنى الآن من **كل** مقررات القسم النشطة (حتى غير المسندة) بدمجها مع مجموعات العرض؛ الرفض فقط إذا لا مقررات إطلاقاً. **ورقة الأدلة**: كل المقررات (غير المسند يظهر "⚠️ بلا أستاذ — اكتب اسم الأستاذ في الجدول وسيُسند تلقائياً") + عمود جديد H "أساتذة القسم (استخدم أي اسم للإسناد)" بكل أساتذة القسم النشطين. **إصلاح إضافي**: commit الاستيراد عند تغيير/إنشاء الإسناد أصبح يحدّث **العبء التدريسي** أيضاً (حذف عبء القديم + إنشاء للجديد بالفصل النشط) — كان ناقصاً. مختبَر: قالب قسم فيه مقرر غير مسند (مستوى 11) يتنزل ويشمل المجموعة والأدلة كاملة، ورفع ملف بالإسناد → أُسند + خلية + عبء تدريسي، كلها PASS. ملاحظة: القاعة إلزامية في خلايا الاستيراد (تصميم مقصود).
- ✅ **Block generation on occupied weekly slot (2026-07)**: بموافقة المستخدم: التوليد المتكرر في وقت مشغول بالعرض الشامل أصبح **محظوراً كلياً** — helper `_weekly_occupancy_conflicts` في server.py (قبل decorator generate-semester — درس: لا تُدخل دالة بين decorator والدالة!) يفحص كل (يوم، وقت مطابق لفترة) ضد خلية الشعبة في weekly_schedule؛ لو مشغولة بمقرر آخر → 409 "🛑 لا يمكن التوليد… اختر وقتاً آخر (لم تُنشأ أي محاضرة)". نفس المقرر بموعده لا يُحظر. مختبَر: 409 بدون أي محاضرة، وقت حر ينجح مع الانعكاس، إعادة التوليد idempotent.
- ✅ **Show weekly-schedule warnings in lecture generation UI (2026-07)**: شكوى المستخدم: ولّد محاضرات في وقت مشغول بالعرض الشامل — لم تظهر الخلية (صحيح، الخادم رفض الاستبدال وأرجع ملاحظة "الخلية مشغولة بمقرر…") لكن **التحذير لم يظهر له** لأن `course-lectures.tsx` (سطر ~643) كان يبني رسالته بنفسه من lectures_created/conflicts_skipped ويتجاهل weekly_notes. **الإصلاح**: عرض weekly_cells_created/existing + weekly_notes في الإشعار، نوع إشعار 'warning' جديد (برتقالي #ef6c00، يبقى 15 ثانية). اختبار باك اند: التوليد في خلية مشغولة يرجع الملاحظة بوضوح PASS.
- ✅ **Excel import: "File is literal source" — إعادة تموضع المقررات (2026-07)**: من تجربة المستخدم: نقل خلية في العرض الشامل ثم إعادة رفع الملف الأصلي كان يدرج المقرر في الموضع القديم **ويُبقي** الخلية المنقولة → تكرار. المستخدم اختار "الملف هو الأساس حرفياً": المقرر المذكور في الملف تصبح مواضعه في الجدول = مواضع الملف بالضبط. **التنفيذ** في `schedule_import.py`: (1) `file_positions` = {course_id: {(day, slot)}} تُسجَّل فور مطابقة المقرر. (2) بعد المرور: أي خلية قائمة لمقرر مذكور بموضع غير موجود في file_positions (وليست ضمن replaced_ids) → `removal_ids` + رسالة "↪️ إعادة تموضع '…': ستُزال خليته في … — غير مذكورة في الملف". (3) فحص التعارضات يستثني removal_ids (مواضعها تتحرر). (4) can_commit/رسائل المعاينة والتنفيذ تشمل العدّاد `to_reposition`/`repositioned`. (5) عند التنفيذ: حذف replaced+removal معاً + 🔄 `_sync_future_lectures(delete)` على كل خلية مزالة (استبدال أو تموضع) لحذف محاضراتها اليومية المستقبلية (المحمية تُستثنى). المقررات **غير المذكورة** في الملف لا تُمس إطلاقاً. **فرونت** MasterScheduleView: نص السياسة محدّث، زر التأكيد يعرض "+N إعادة تموضع"، قسم برتقالي `import-repositioned-list`. **اختبار** /tmp/test_reposition.py (4 اختبارات PASS): سيناريو المستخدم الحرفي (رفع→نقل→إعادة رفع→عودة للموضع بلا تكرار)، موضعان بالملف + إزالة الثالث القديم، مقرر غير مذكور لا يُمس + ملف مطابق = "لا تغييرات"، حذف المحاضرات اليومية المستقبلية للخلايا المزالة + لقطة E2E للمودال بالنص الجديد. **ملاحظة**: لم أستطع إعادة إنتاج "قال لا اختلاف" الذي وصفه المستخدم (المعاينة كانت تكشف الإدراج) — على الأغلب جرّب على production قبل النشر أو التبس العدّاد؛ الإصلاح الجديد يجعل النتيجة صريحة في كل الأحوال.
- ✅ **Reflect recurring lectures → weekly schedule — الانعكاس التلقائي (نظام ← جدول) (2026-07)**: بطلب المستخدم (اختار الانعكاس التلقائي): توليد محاضرات متكررة من صفحة المقرر (`POST /lectures/generate-semester`) أصبح يعكس المواعيد على الجدول الأسبوعي. **التنفيذ** في server.py: helper `_reflect_recurring_to_weekly(course, data, current_user)` — لكل (يوم، وقت بداية) في data.schedule: تحويل اليوم EN→AR، مطابقة الوقت مع فترة معرفة في schedule_settings الكلية (بـstart_time المطابق تماماً)، فحص أيام العمل، ثم: خلية موجودة لنفس المقرر → "مدرج مسبقاً" (idempotent)؛ مشغولة بمقرر آخر → ملاحظة ولا تُستبدل؛ الأستاذ مشغول بالجدول → ملاحظة ولا تُنشأ؛ القاعة مشغولة → تُنشأ بدون قاعة مع ملاحظة؛ وإلا تُنشأ الخلية (level/section/teacher من المقرر، room_id بمطابقة اسم القاعة في rooms الكلية، علامة created_from_lectures). يعمل دائماً حتى لو كل المحاضرات موجودة مسبقاً (درس: كان مشروطاً بـlectures_created>0 ففشل التكرار). الرسالة تتضمن "🗓️ أُدرج N موعد جديد في الجدول الأسبوعي" + weekly_notes. الحقول الجديدة بالرد: weekly_cells_created/existing/notes. **اختبار** /tmp/test_reflect.py (4 اختبارات PASS): إنشاء خلية + تخطي وقت غير مطابق بملاحظة، الظهور في master-view، idempotency، عدم استبدال خلية مشغولة.
- ✅ **Exclude alumni from auto-enrollment — استثناء الخريجين من التسجيل التلقائي (2026-07)**: شكوى المستخدم: التسجيل التلقائي كان يعيد الخريجين لمستوياتهم لأن التخرج يضبط is_alumni/status=graduated دون تغيير is_active، والاستعلامات كانت تفلتر is_active فقط. **الإصلاح** في server.py بإضافة `"is_alumni": {"$ne": True}, "status": {"$ne": "graduated"}` إلى استعلامات الطلاب في 4 مواضع: (1) إنشاء مقرر (auto-enroll التلقائي ~5368)، (2) POST /courses/{id}/auto-enroll، (3) POST /courses/auto-enroll-all، (4) GET /courses/diagnose-enrollment (العدّادات). المسارات اليدوية (bulk-copy/move، enroll بمعرفات صريحة، رفع Excel) تُركت عمداً — اختيار يدوي واعٍ. اختبار /tmp/test_alumni_enroll.py: طالب نشط + خريج بنفس القسم/المستوى → المسارات الثلاثة تسجل النشط فقط، كلها PASS. **قرار المستخدم**: خيار حذف الخريج من جدول المتخرجين مؤجل (لا يُنفَّذ الآن).
- ✅ **Bidirectional Sync: Schedule → System — الجدول مصدر الحقيقة (2026-07)**: استكمال التكامل بالاتجاه المعاكس بناءً على اختيارات المستخدم (تغيير أستاذ خلية = تغيير الإسناد كاملاً؛ التعديل اليومي استثناء لا يمس الإسناد؛ نقل خلية = تحديث المحاضرات المولّدة). **في `weekly_schedule.py`**: (1) helper `_sync_future_lectures(db, slot, action, new_day, new_slot_number, new_room_id)`: يجد المحاضرات اليومية المستقبلية (تاريخ >= اليوم بتوقيت اليمن، status=scheduled، start_time = وقت الفترة القديمة، weekday = اليوم القديم) ويستثني: الماضية، عليها حضور (attendance بـlecture_id)، المعاد جدولتها يدوياً (original_date/last_rescheduled_from)، والمتعارضة مع محاضرة قائمة — ثم ينقلها (تاريخ جديد = سبت نفس الأسبوع + إزاحة اليوم الجديد `_SAT_OFFSET`، أوقات الفترة الجديدة، اسم القاعة الجديدة) أو يحذفها (action=delete). (2) `_cascade_slot_teacher_to_course`: تغيير أستاذ خلية عبر PUT → فحص مسبق أن الأستاذ الجديد متاح في مواعيد كل خلايا المقرر الأخرى (وإلا 409 قبل أي كتابة) → تحديث course.teacher_id + بقية الخلايا + teaching_loads (حذف القديم، إنشاء جديد بالفصل النشط) + log_activity. المحاضرات اليومية لا تخزن teacher_id (يُشتق من المقرر) فتتبع تلقائياً. (3) **wired في**: PUT /weekly-schedule/{id} (teacher cascade + move/room sync)، DELETE /weekly-schedule/{id} (حذف المحاضرات المستقبلية المولّدة)، move-slot، swap-slots (الطرفين)، وresolver commit في `schedule_resolver.py` (استيراد الدالتين). الرسائل تتضمن ملخص `_sync_summary` (تم تحديث X — استُثنيت: Y حضور مسجل، Z معاد جدولتها...). **اختبار** `/tmp/test_schedule_sync.py` (5 اختبارات كلها PASS): نقل مع 4 محاضرات (عادية تنتقل بتاريخ/وقت صحيح، حضور+معادة+ماضية تُستثنى)، cascade الأستاذ (course+loads+cells)، تغيير القاعة يتبع، حذف الخلية يحذف العادية ويحفظ المحمية، حارس 409 عند انشغال الأستاذ الجديد بدون أي كتابة جزئية + سواب sync PASS + regression فحص التكامل PASS. **ملاحظة معلقة**: استيراد Excel لا يزامن المحاضرات اليومية للخلايا المستبدلة (المستخدم يولّد المحاضرات بعد الاستيراد عادة) — مقترح مستقبلي.
- ✅ **Schedule Integrity System — تكامل الجدول الأسبوعي مع المقررات/الإسنادات/القاعات (2026-07)**: بطلب المستخدم "خطة تكاملية بحيث لا يكون هناك تعارض ويكون العمل من أي اتجاه موجوداً في الآخر". 3 محاور: **(1) Cascades تلقائية في server.py**: حذف مقرر (delete + safe-delete) → حذف خلاياه من weekly_schedule + teaching_loads مع ذكر العدد؛ تغيير level/section في update_course → تحديث خلايا الجدول؛ حذف معلم (hard) → محظور إن كان مسنداً لمقررات أو له خلايا (رسالة بالأعداد، safe-delete ينظف الخلايا بـ$unset teacher_id + teaching_loads)؛ حذف قاعة (weekly_schedule.py delete_room) → محظور إن كانت مستخدمة بعدد المحاضرات. **(2) فحص التكامل**: راوتر جديد `/app/backend/backend/routes/schedule_integrity.py`: `GET /api/weekly-schedule/integrity-check?faculty_id=&department_id=` يكشف 6 أنواع انحراف (orphan_course, inactive_course, teacher_mismatch, group_mismatch, orphan_room, inactive_room) مع fixable/manual، و`POST /api/weekly-schedule/integrity-fix` يصلح تلقائياً (حذف خلايا المقرر المحذوف، مزامنة الأستاذ مع الإسناد، مزامنة المستوى/الشعبة، تفريغ القاعة المحذوفة؛ DuplicateKeyError → يُبلَّغ كيدوي). **(3) UI**: زر "فحص التكامل" (تركوازي #00796b) في MasterScheduleView (can_manage فقط) + مودال بملخص أنواع الانحراف وقائمة الحالات (🔧 قابل للإصلاح أصفر / ✋ يدوي أحمر) وأزرار إصلاح تلقائي/إعادة فحص. testIDs: master-integrity-check-btn, master-integrity-modal, integrity-fix-btn, integrity-recheck-btn, integrity-clean, integrity-fix-result. **اختبار**: /tmp/test_integrity.py (حقن انحرافات: أستاذ شبح + مقرر يتيم + قاعة يتيمة → كشف → إصلاح → نظيف؛ level cascade؛ حراس حذف القاعة والمعلم 400؛ cascade حذف المقرر) كله PASS + E2E لقطة للمودال "الجدول متكامل تماماً — تم فحص 12 محاضرة". ⚠️ يتطلب النشر.
- ✅ **Persistent sections count in curriculum page (2026-07)**: طلب المستخدم على `/curriculum`: حقل "شعب" كان ephemeral (يُمسح بعد التوليد وعند التحديث) وplaceholder=1. **الآن**: (1) حقل `sections_count` (0-10) في `CurriculumCourseUpdate` يُحفظ على curriculum_courses (0 = بدون شعب) — الحفظ تلقائي عند onBlur من حقل الإدخال عبر PUT /curriculum/courses/{id}. (2) fetchGrid يهيئ sectionsMap من القيم المحفوظة (>0). (3) توليد الجلسات: أولوية sections_map المرسلة ← ثم sections_count المحفوظ (إن >1) ← ثم الافتراضي 1؛ وشعبة واحدة = بدون حرف شعبة (سلوك موجود مسبقاً "أ" لا تُسمى). (4) placeholder أصبح "0" ولا يُمسح sectionsMap بعد التوليد. تحقق: curl (حفظ 3 → يظهر في الشبكة → حفظ 0) + E2E (إدخال 4 → Tab → reload → القيمة 4 باقية). ⚠️ يتطلب النشر (المستخدم يعمل على Railway production).
- ✅ **Room change with availability in reschedule modal (2026-07)**: بطلب المستخدم — مودال إعادة الجدولة أصبح يتيح تغيير القاعة مع كشف التوفر. **باك اند** `PUT /lectures/{id}/reschedule`: يقبل `room` اختيارياً، فحص تعارض القاعة يتم بالقاعة الجديدة (effective_room)، وتُحدَّث إن اختلفت. **فرونت** course-lectures.tsx: `rescheduleData.room` (يُهيأ بقاعة المحاضرة الحالية من موضعي الفتح)، RoomPicker في المودال (testID reschedule-room-picker) بـfacultyId + excludeLectureId + occurrences بالموعد الجديد → 🟢/🔴 حسب التوفر. تحقق curl: room من Test→ق202 مع النقل، وE2E لقطة للمودال الكامل (تاريخ+أوقات+ملخص أخضر+قائمة قاعات الكلية). ⚠️ يتطلب النشر.
- ✅ **Workload cancelled-lectures bug + regeneration duplication after reschedule (2026-07)**: (1) **خلل الملغاة في النصاب**: تقرير `/reports/teacher-workload` (والتقرير اليومي ~10270) كانا يستبعدان الملغاة بحقل `is_cancelled` القديم بينما الإلغاء الفعلي يضبط `status=cancelled` فقط → الملغاة كانت تُحسب ضمن "الساعات المجدولة". أُضيف `"status": {"$ne": LectureStatus.CANCELLED}` للاستعلامين (أُبقي is_cancelled للتوافق). تحقق: scheduled_lectures=7 بعد استبعاد 2 ملغاة من 9. (2) **جذر "العدد يزيد عند إعادة الجدولة"** الذي لاحظه المستخدم: إعادة الجدولة نفسها لا تنشئ محاضرة (update في المكان، تحقق 9=9)، لكن **إعادة تشغيل توليد محاضرات الفصل** (`POST /lectures/generate-semester`) كانت تعيد إنشاء محاضرة في الموعد الأصلي الذي نُقلت منه المحاضرة (الفهرس الفريد course+date+start لم يعد يحميه لأن الموعد أصبح فارغاً). الإصلاح: قبل الإدراج، فحص `original_date` أو `last_rescheduled_from == date_str` لنفس المقرر → تخطٍ. تحقق: توليد على موعد منقول منه = 0 إنشاء، 1 تخطٍ، العدد ثابت. أُنشئ أيضاً شرح شامل للمستخدم عن حالات المحاضرة الأربع وقواعد إعادة الجدولة والنصاب وغياب الطلاب. ⚠️ يتطلب النشر.
- ✅ **Course Migration dept filter (2026-07)**: فلتر "قسم محدد (اختياري)" في صفحة الترحيل — قائمة من GET /departments (مقيدة بالنطاق تلقائياً)، تمرير department_id للمعاينة. تحقق E2E: كل الأقسام=8، قسم الشريعة=5. testID: department-filter-select.
- ✅ **Course Migration to new semester — ترحيل المقررات (2026-07)**: ميزة P1 مكتملة. **باك اند** `/app/backend/backend/routes/course_migration.py` (راوتر جديد مسجل في server.py): `GET /api/course-migration/preview` (مقررات الفصل المصدر ضمن نطاق المستخدم + كشف التكرار بمفتاح code+section+department_id في الهدف + أسماء قسم/مدرّس + عدد الطلاب) و`POST /api/course-migration/execute` (نسخ المقررات المحددة: بيانات كاملة + semester_id/name/academic_year من الفصل الهدف + `migrated_from_course_id/semester_id` للتتبع؛ خيارات copy_teacher افتراضي نعم — ينسخ الإسناد + teaching_loads، copy_students افتراضي لا؛ آمن للإعادة — المكرر يُتخطى؛ log_activity بترجمة "ترحيل مقررات لفصل جديد"). **صلاحية جديدة** `MIGRATE_COURSES=migrate_courses` في models/permissions.py (كتالوج ALL_PERMISSIONS فئة المقررات → تظهر في محرر الأدوار تلقائياً) — الأدمن دائماً، والبقية عبر الدور. **فرونت** `/app/frontend/app/migrate-courses.tsx` صفحة مستقلة + عنصر SideMenu "ترحيل المقررات" (permissions: [migrate_courses]) + PERMISSIONS.MIGRATE_COURSES في AuthContext: اختيار مصدر/هدف من الفصول المُنشأة مسبقاً فقط، معاينة بمربعات اختيار وتحديد الكل، المكرر معطل بشارة ⚠️، مفتاحا نسخ المدرّسين/الطلاب، تأكيد قبل التنفيذ، بطاقة نتيجة خضراء. **اختبار**: curl (preview/execute/إعادة تنفيذ idempotent 0 migrated 2 skipped/403 بلا صلاحية/نطاق رئيس قسم يرى قسمه فقط) + E2E لقطات (معاينة + شارات التكرار + تنفيذ + نتيجة). ⚠️ دروس: sonner غير مثبت في Expo (سبّب 500 SSR) — استخدم Alert/window.alert؛ RN components تحتاج `testID` وليس `data-testid` (الخام مثل select يقبل data-testid)؛ صفحة expo-router جديدة قد تحتاج restart expo لتُسجل (404 قبله). ⚠️ يتطلب النشر.
- ✅ **Room picker scoped by faculty (2026-07)**: شكوى المستخدم — عند إنشاء محاضرة بمقرر كلية الشريعة تظهر قاعات كلية البنات والعكس. القاعات لها `faculty_id` والباك اند `GET /api/rooms` يدعم `?faculty_id=` أصلاً لكن `RoomPicker.tsx` كان يجلب الكل. **الإصلاح**: (1) `GET /courses/{id}` أصبح يرجع `faculty_id`/`faculty_name` (عبر dept→faculty، تطبيقاً لقاعدة PERMISSIONS_ARCHITECTURE §4: المعرفات لا الأسماء فقط). (2) `RoomPicker` prop جديد `facultyId` يفلتر الجلب ويعيد الجلب عند تغيره + رسالة فارغة خاصة بالكلية. (3) تمرير `course?.faculty_id` في المواضع الثلاثة: AddLectureModal (prop جديد facultyId)، شريحة التوليد (generate-room-picker)، تغيير القاعة (change-room-picker) في course-lectures.tsx. تحقق E2E: مقرر شريعة يعرض ق101/ق202/ق305 فقط، مقرر بنات يعرض قاعة البنات فقط. ملاحظة: صفحات الجدول الأسبوعي تفلتر بالكلية مسبقاً. ⚠️ يتطلب النشر.
- ✅ **Auto-suggest end time (2026-07)**: بطلب المستخدم — عند تغيير وقت البداية في أي نموذج (AddLectureModal ويب+موبايل، شرائح التوليد updateSlotTime، إعادة الجدولة) يُقترح وقت النهاية تلقائياً: يحافظ على المدة السابقة إن كانت صالحة (>0) وإلا 90 دقيقة افتراضياً، مع سقف 23:59. دوال جديدة في timeFormat.ts: `addMinutes`, `suggestEndTime`. تحقق E2E: بداية 12:30 → نهاية 14:00 تلقائياً؛ تعديل النهاية يدوياً لساعة ثم تغيير البداية 16:00 → 17:00 (المدة محفوظة). ⚠️ يتطلب النشر (فرونت فقط).
- ✅ **AM/PM time trap UX fix in lecture forms (2026-07)**: من لقطة المستخدم: خطأ "وقت النهاية يجب أن يكون بعد البداية" عند إنشاء محاضرة ظهرية لأن المستخدم اختار «ص» بدل «م» (12:30 ص = منتصف الليل). **الحل**: (1) أداة مشتركة `/app/frontend/src/utils/timeFormat.ts` (formatTimeArabic: فجراً/صباحاً/ظهراً/عصراً/مساءً + timeDiffMinutes + durationArabic + earlyMorningWarning). (2) مكوّن `TimeRangeSummary.tsx`: شريط لحظي تحت حقلي الوقت — أخضر "🕐 من 12:30 ظهراً إلى 1:30 ظهراً — المدة: ساعة" أو أحمر "⚠️ النهاية (فجراً) تقع قبل البداية — تأكد من ص/م" + تحذير برتقالي لأوقات الفجر (<6ص). مطبق في 3 مواضع: AddLectureModal (إضافة محاضرة)، شرائح التوليد التلقائي ومودال إعادة الجدولة في course-lectures.tsx. (3) رسالة التحقق عند الحفظ أصبحت تشرح الفخ بمثال (12:30 ظهراً = «م» وليس «ص»). testIDs: `time-range-summary`, `time-range-valid`, `time-range-invalid`. تحقق E2E بلقطتين (الحالة الصحيحة الخضراء + الخاطئة الحمراء). ⚠️ يتطلب النشر (فرونت فقط).
- ✅ **"من قسم آخر" lock on own-faculty courses (2026-07) — الوجه الثاني لمشكلة مدير التسجيل المتكررة**: من لقطة شاشة المستخدم على الإنتاج: Zain Salim (مدير تسجيل، كلية الشريعة والقانون) يرى مقررات قسم الشريعة (داخل كليته!) بشارة قفل "من قسم آخر" في `/teacher-courses` وصلاحياته تطبق على قسم واحد فقط. **الجذر**: `GET /api/teachers/{id}/courses` (server.py ~4790) كان يرجع `faculty_name` **بدون `faculty_id`** → فحص ملكية الكلية في `canManageCourse` (teacher-courses.tsx سطر 89: `userFacultyIds.includes(courseFacultyId)`) لا ينجح أبداً لأن `courseFacultyId=''` → المستخدم الكلّي النطاق لا يُفتح له إلا ما طابق `department_ids` العالقة في سجله (قسم واحد). **الإصلاح**: إرجاع `faculty_id` (من `dept.faculty_id`) في استجابة المقررات — لا تغيير في الواجهة. اختبار E2E بلقطات: مستخدم مدير تسجيل بكلية الشريعة يرى مقرر قسم الشريعة بزر "إلغاء الإسناد" الكامل بلا قفل. ملاحظة تشخيصية مهمة: `/auth/me` يبني permissions من **وثيقة الدور** (role_id → roles.permissions) + `custom_permissions` على المستخدم — التعديل المباشر على `users.permissions` لا يظهر في الواجهة. القاعدة وُثقت في `/app/PERMISSIONS_ARCHITECTURE.md` §4. ⚠️ يتطلب النشر (باك اند فقط). يكمّل إصلاح 2026-07 السابق (خلل elif + الأقسام العالقة + الترحيل).
- ✅ **RBAC recurrence root-cause fix: registration_manager blocked from faculty departments (2026-07)**: شكوى متكررة — مدير التسجيل بصلاحية كلية كاملة لا يصل لقسم من أقسام كليتها. **جذران مكتشفان**: (1) **خلل سلسلة elif في `POST /api/users` (server.py ~1254)**: `elif user.role in [teacher,student]` كانت مربوطة خطأً بفحص `if _final_role in [dean...] and not _has_faculty` بدل فحص role_id → أي مستخدم جديد يُنشأ بـrole_id كان دوره يُداس إلى "employee" وصلاحياته تُصفَّر `[]` بصمت (migrate_broken_user_roles كان يصحح الدور عند الإقلاع لكن ليس الصلاحيات ولا الأقسام العالقة). أُصلحت بجعل الفحص `if not user.role_id:`. (2) **أولوية department_ids العالقة على الكلية**: فرع registrar/registration_manager في `get_user_scope_filter` كان يقدّم department_ids (بقايا تعديلات قديمة) على faculty_id → يحجب باقي الأقسام. **الإصلاحات**: (أ) registration_manager أصبح كلية كاملة دائماً عند وجود faculty_id (تعريف الدور scope=faculty)، registrar يبقى قابلاً للتقييد بأقسام. (ب) تنظيف عام في get_user_scope_filter: الأقسام غير التابعة لكلية المستخدم تُستبعد (لكل الأدوار). (ج) توسعة `migrate_broken_user_roles` (تعمل كل إقلاع): تمسح الأقسام العالقة لكل registration_manager + تستعيد الصلاحيات الفارغة من وثيقة الدور — **أصلحت فعلياً 4 مستخدمين محليا بمن فيهم Salim (22 perms) وSaeed (20 perms) كانت صلاحياتهم مصفّرة!**. اختبار E2E curl: إنشاء بـrole_id → دور وصلاحيات صحيحة، حقن أقسام عالقة → يرى الكلية كاملة فوراً (حماية وقت التشغيل)، انحدار dean/dept_head/students/courses سليم. ⚠️ **يتطلب النشر — سيُصلح بيانات الإنتاج تلقائياً عند أول إقلاع**. ⚠️ درس: routes/users.py وroutes/reports.py نسخ ميتة (server.py يفوز بالتسجيل الأول) — أي تعديل مستقبلي يجب أن يكون في server.py. ⚠️ درس: التعديلات المتوازية المتعددة على server.py الضخم سببت بتر الملف (utf-8 مقطوع) — استُعيد من git وأُعيد التطبيق تسلسلياً؛ عدّل هذا الملف تسلسلياً دائماً.
- ✅ **Daily Schedule 3 fixes + detailed report absent lectures (2026-06/07)**: من فيديو المستخدم على `/schedule`: (1) **تحديث فعلي للحالة**: `GET /api/lectures/all-schedule` يفحص كل محاضرة `scheduled` (بدون `status_override`) — إذا `now (توقيت اليمن +3) > end_time` تُحدَّث في القاعدة إلى `absent` فوراً (بلا فترة سماح، على عكس نقاط أخرى تعطي سماح duration). (2) **بحث**: حقل بحث في `schedule.tsx` (testID `schedule-search-input`) يصفي بالمقرر/الكود/المدرس/الكلية/القسم/القاعة مع عداد "عرض X من Y" ورسالة "لا توجد نتائج مطابقة" وزر مسح. (3) **الكلية والقسم على البطاقة**: الـAPI يعيد `faculty_name`/`department_name` (batch lookup: course.department_id → departments → faculties) وتظهر شارة بنفسجية على كل بطاقة. (4) **التقرير التفصيلي** (`/reports/course/{id}/detailed` في server.py): أصبح يجلب المحاضرات بـ status in [scheduled, completed, absent] (كان يستثني الغائبة فيقطع التسلسل) + حقل `status` لكل محاضرة + summary: `total_lectures` = غير الغائبة فقط (لسلامة نسب الطلاب) و`absent_lectures` جديد. الواجهة `report-course.tsx` تعرض الغائبة بخلفية برتقالية "لم تنعقد (غياب المدرس)" وشارة "غياب" بدل النسبة. اختبار: curl (absent تلقائي + بقاء المستقبلية scheduled + أسماء الكلية/القسم + Counter للتقرير) + E2E بلقطات (شارة غائب، البحث بالفلترة والمسح، الشارة البنفسجية). ⚠️ يتطلب النشر. ملاحظة: routes/reports.py نسخة ميتة غير مسجلة — النسخة الحية في server.py.
- ✅ **Schedule export layout transposed (2026-02)**: بطلب المستخدم — الجدول المُصدَّر (PDF+Excel) أصبح: الأيام صفوف رأسية وعمود "اليوم" في **أقصى اليمين**، الفترات أعمدة أفقية في الأعلى (مع أوقاتها)، اتجاه يمين→يسار (PDF: عكس ترتيب الأعمدة يدوياً لأن reportlab يرسم من اليسار؛ Excel: `rightToLeft=True` مع الأيام في العمود A). تحقق بصري بتحويل PDF لصورة (pymupdf) + فحص بنية Excel + regression 27/27.
- ✅ **Export "Network Error" for full faculty/dept (2026-02)**: السبب: التصدير الواسع كان يحشر كل الشعب/الأقسام في خلية واحدة → صف أطول من صفحة A4 → reportlab LayoutError → 500 (يظهر Network Error)، وExcel يظهر ناقصاً/مكدساً. الحل: إعادة هيكلة — **صفحة PDF مستقلة لكل (قسم، مستوى، شعبة)** بعنوانها + PageBreak، و**ورقة Excel لكل شعبة** (`safe_sheet_name` ≤31 حرفاً فريد)، `hide_section` داخل صفحة الشعبة، ارتفاع صف Excel ديناميكي، وdoc.build ملفوف بـtry → 400 برسالة عربية. التصدير الضيق (معلم/قاعة/شعبة محددة) بقي شبكة واحدة كما هو. تحقق: PDF 3 صفحات وExcel 3 أوراق بأسماء عربية، محتوى عربي سليم بكل صفحة، regression 6/6.
- ✅ **Weekly schedule export fix — empty cells + Arabic squares (2026-02)** — تكملة: رسالة "فشل التصدير" سببها أن `handleExport` كان يبني الرابط من `process.env.EXPO_PUBLIC_BACKEND_URL` مباشرة (قد يكون فارغاً/خاطئاً على الإنتاج) بدل منطق `API_URL` الذي يحوّل app.ahgaff.net → api.ahgaff.net. أُعيدت كتابته ليستخدم axios `api` الموحد (`responseType: 'blob'`) مع رسالة خطأ تفصيلية (detail + رمز الحالة). تحقق E2E: التنزيل يعمل من الواجهة. ملاحظة: صفحات أخرى ما زالت تستخدم `EXPO_PUBLIC_BACKEND_URL` مباشرة (manage-teachers, students, take-attendance, trash, report-teacher-summary) — مرشحة للتوحيد لاحقاً إن ظهرت شكاوى مشابهة.: خطأ حقل: التصدير (PDF+Excel) كان يجمّع الخلايا بـ`day_of_week` بينما مستندات `weekly_schedule` تخزن `day` → جدول فارغ رغم وجود 199 محاضرة. الإصلاح: `s.get("day") or s.get("day_of_week")` في تجميع خلايا PDF (سطر ~1709) وExcel (~1931). نفس الخطأ كان يجعل **تقرير التفرغ يعرض كل القاعات والمعلمين "متاح" دائماً** — أُصلح (استعلام `$or` على day/day_of_week + مفاتيح busy_map). أيضاً مسار خط Amiri أصبح نسبياً لـ`__file__` بدل `/app/backend/backend/fonts/...` الثابت (سبب المربعات ■ على الإنتاج إذا اختلف مسار النشر). تحقق: PDF يحوي عربية + محتوى، Excel خلايا معبأة، التفرغ يكشف قاعتين مشغولتين. Regression 27/27 ✓.
- ✅ **Working days fix — "يرجى إعداد الفترات الزمنية وأيام العمل" (2026-02)**: السبب الجذري: تبويب «الفترات» كان يحفظ الفترات فقط بلا أي واجهة لأيام العمل → سجل `schedule_settings` بلا `working_days` → التوليد يرفض. الحل: (1) واجهة «أيام العمل» chips (السبت→الجمعة) في تبويب الفترات، الحفظ يحفظ الاثنين معاً مع منع الحفظ بلا أيام. (2) `POST /schedule-settings/working-days` جديدة (per-faculty). (3) شفاء ذاتي: حفظ الفترات يضيف أيام العمل الافتراضية للسجلات الناقصة تلقائياً. (4) رسالتا خطأ إرشاديتان منفصلتان بدل الرسالة العامة. اختبار curl (سجل مكسور → رسالة إرشادية → الحفظ يشفيه → أيام مخصصة تُحفظ) + E2E. ملاحظة: واجهت أثناءها خطأ "editWorkingDays is not defined" (تعريف state لم يُطبق) وأُصلح.
- ✅ **Generate lectures from weekly schedule (2026-02)**: الميزة التي نوقشت مع المستخدم ونُفذت بشروطه: (1) زر مستقل "توليد المحاضرات" في صفحة الجدول (يظهر فقط عند وجود جدول) — ليس تلقائياً مع توليد الجدول. (2) توليد الناقص فقط — المحاضرات الموجودة من صفحة المقررات تُتخطى (فحص (course_id,date,start_time) + فهرس فريد كشبكة أمان). (3) نطاق قسم أو كلية كاملة (حسب الفلتر الحالي). نقطة API: `POST /weekly-schedule/generate-lectures` (body: faculty_id, department_id?, start_date, end_date, holidays[], dry_run) — dry_run يعيد معاينة (to_create/already_exist/courses_count/schedule_slots). النافذة: فترة (افتراضياً فترة الفصل من /settings)، قائمة عطلات تُتخطى (chips قابلة للحذف)، معاينة إلزامية قبل التأكيد، القاعة تُحوّل من room_id لاسمها نصاً، والمحاضرات تحمل `generated_from_schedule: true`. اختبارات: `tests/test_generate_lectures_from_schedule.py` (27/27 مع بقية الاختبارات) + E2E بلقطات (معاينة 6 مع عطلة → تأكيد أنشأ 6، إعادة تنفيذ = 0 جديد).
- ✅ **Department-scoped auto-generation clarity (2026-02)**: المستخدم سأل لماذا لا يوجد توليد على مستوى القسم — **الميزة كانت موجودة أصلاً** (الباك اند يدعم `department_id` والواجهة ترسل `selectedDept`) لكن دون أي توضيح. أُضيف: (1) شارة نطاق مرئية `generation-scope-badge` بجانب الأزرار — خضراء "قسم X فقط" أو برتقالية "كامل الكلية (N قسم)". (2) رسالة تأكيد التوليد توضح النطاق صراحة + النتيجة تُسبق بـ[قسم X]. (3) رسالة تأكيد "مسح" أصبحت تحدد النطاق بدقة (قسم/كلية/الكل) لتفادي مسح كارثي. تحقق E2E للحالتين.
- ✅ **Availability report white-page hardening (2026-02)**: المستخدم أبلغ عن صفحة بيضاء على الإنتاج عند اختيار "الأساتذة" في `/availability-report`. المعاينة تعمل 100% (تم التحقق E2E — التقريران يعملان بلا أخطاء JS). السبب المرجح على الإنتاج: نسخة أقدم أو استجابة `/api/departments` بغير شكل مصفوفة → انهيار `departments.map` عند رسم قائمة الأقسام (تظهر فقط في وضع الأساتذة). الحل الدفاعي: تطبيع كل الاستجابات إلى مصفوفات (faculties/departments/timeSlots)، فحص شكل استجابة التقرير قبل العرض مع رسالة "استجابة غير متوقعة — حدّث نسخة الخادم"، وحراسة `Array.isArray` على `data.rooms/data.teachers`. **يجب على المستخدم نشر الفرونت (والباك) للإنتاج**.
- ✅ **Teacher prefs tab overhaul in weekly-schedule (2026-02)** — تحديث لاحق بطلب المستخدم: القائمة لم تعد مفتوحة دائماً بل **قائمة منسدلة** (`prefs-teachers-dropdown-toggle`): مغلقة افتراضياً تعرض المعلم المحدد + شارته في الرأس، تنفتح بالنقر (بحث autoFocus + قائمة بشارات)، وتنغلق تلقائياً فور اختيار معلم. حالة `prefsListOpen`. تحقق E2E (مغلقة → فتح → اختيار → انغلاق + عرض الشبكة).: حل شكويي المستخدم: (1) عند اختيار قسم لم تكن تظهر التفضيلات المحفوظة، (2) بعد اختيار معلم لا يمكن البحث عن معلم آخر (dropdown يُحجب). الحل: نقطة API جديدة `GET /api/teacher-preferences?department_id=` (bulk summary: has_prefs, unavailable_count محسوب من الشبكة أو مشتق من الحقول القديمة، max_daily, allow_consecutive) + استبدال `TeacherSearchBox` في تبويب التفضيلات بقائمة معلمين **دائمة الظهور** (in-flow, maxHeight 280) مع: منتقي كلية+قسم، بحث مدمج بالاسم، شارات ملونة ("X فترة محظورة" أحمر / "متاح دائماً" أخضر / "بدون تفضيلات" رمادي)، تمييز المعلم المحدد، والتبديل المباشر بين المعلمين والشبكة تحتها. عنوان الشبكة يعرض اسم المعلم. الشارات تتحدث بعد الحفظ (loadPrefsSummary في handleSavePrefs). testIDs: `prefs-faculty-picker`, `prefs-dept-picker`, `prefs-teachers-panel`, `prefs-teacher-search`, `prefs-teacher-row-{id}`. تحقق E2E كامل بلقطات.
- ✅ **Student search in report-student page (2026-02)**: أُضيف حقل بحث فوري فوق قائمة الطلاب في `/report-student` — يبحث بالاسم أو رقم القيد ويصفّي القائمة المنسدلة لحظياً (client-side على القائمة المفلترة بالقسم/المقرر)، مع عداد النتائج، رسالة "لا توجد نتائج"، زر مسح (✕)، وإعادة تعيين البحث ضمن resetFilters. إذا خرج الطالب المحدد من نتائج البحث يُلغى اختياره تلقائياً. testIDs: `student-search-input`, `clear-student-search`, `student-picker`. تحقق E2E: 91→5 طلاب عند البحث. ملف: `/app/frontend/app/report-student.tsx`.
- ✅ **Live room occupancy indicator 🟢🔴 (2026-02)**: نقطة API جديدة `POST /api/rooms/availability` (في `routes/weekly_schedule.py`) — تستقبل `occurrences[]` (تاريخ+وقت) و`exclude_lecture_id` اختياري، وتعيد لكل قاعة مسجلة `busy_count/total/conflicts` (اسم المقرر الحاجز ووقته). `RoomPicker` أصبح "حياً": عند تمرير prop `occurrences` يفحص الإشغال (debounce 350ms) ويعرض 🟢 متاحة / 🔴 مشغولة في القائمة، وحدود حمراء + صندوق تحذير عند اختيار قاعة مشغولة (قابلة للاختيار — خيار المستخدم "ب" — لدعم دمج شعبتين، والخادم يبقى الحكم)، وشارة خضراء "✓ القاعة متاحة". مطبق في: إضافة محاضرة (موعد واحد)، تغيير القاعة (مع exclude)، التوليد التلقائي ("مشغولة في X من Y موعداً" عبر `generateOccurrences` useMemo يحسب كل التكرارات). اختبارات: `TestRoomsAvailability` (21/21 pass) + تحقق E2E بلقطات للمسارين الأحمر والأخضر ومؤشر التوليد.
- ✅ **Activity log filters + delete (2026-06)**: (1) فلتر **مصدر السجل** (الكل/يدوي/تلقائي) عبر بارامتر `source` في GET (auto=True/$ne). (2) فلتر **الفترة بتوقيت عدن** (from_date/to_date بصيغة YYYY-MM-DD تُفسَّر بمنطقة +3 وتُحوّل UTC للمطابقة، to_date شامل نهاية اليوم). (3) **حذف السجلات**: `DELETE /api/activity-logs?confirm=true&before_date&source&action&user_id` — **admin فقط** + إلزام confirm (400 بدونه) + يسجل نفسه نشاطاً يدوياً "حذف سجلات النشاطات" بعدد المحذوف. الواجهة: قسما "مصدر السجل" و"الفترة" في مودال التصفية + زر أحمر "حذف السجلات المطابقة للفلاتر" مع تأكيد يعرض نطاق الحذف. أُضيف `/api/init-admin` لقائمة تجاهل التسجيل التلقائي. testIDs: `filter-source-{all|auto|manual}`, `filter-from-date`, `filter-to-date`, `delete-logs-btn`. اختبار: curl (source/date/403-400/حذف فعلي 2 سجل) + E2E (المودال، فلتر تلقائي يخفي اليدوية). ⚠️ يتطلب النشر.
- ✅ **Activity log overhaul: full coverage + Aden timezone (2026-06)**: (1) **توقيت عدن**: `GET /api/activity-logs` يحول timestamps من UTC (تخزين Mongo) إلى `+03:00` ISO — يُصلح كل السجلات القديمة والجديدة في العرض. (2) **تغطية شاملة**: `AutoActivityLogMiddleware` (ASGI خام في server.py) يسجل تلقائياً كل POST/PUT/DELETE ناجحة (2xx) على `/api/` بوصف عربي من `_AUTO_LOG_RULES` (~60 قاعدة regex) — كانت 88 من 115 عملية كتابة غير مسجلة. منع الازدواج عبر contextvar مشترك `activity_log_ctx` في routes/deps.py — دالتا log_activity (server.py + deps.py) تضبطان `manual=True` فيتخطى الـmiddleware التسجيل. السجلات التلقائية تحمل `auto: True` و`details.path`. قائمة تجاهل: fcm/notifications/auth-refresh/import-preview/init-admin. أُضيفت ترجمات عربية للأفعال اليدوية الجديدة (move/swap/auto_place...). (3) **الواجهة** (activity-logs.tsx): تعرض `action_ar` للسجلات التلقائية (بدل الكود الإنجليزي) بأيقونة/لون حسب نوع العملية، وتعرض المسار فقط بدل JSON خام. ⚠️ درس: وُجدت نسختان من log_activity (server.py + routes/deps.py) — أي تعديل مستقبلي يجب أن يشمل الاثنتين. اختبار: testing_agent iteration_58 — backend 8/8 نجاح (توقيت، تلقائي، منع ازدواج، الفاشلة لا تسجل، regression) + إصلاح ملاحظة الواجهة والتحقق بلقطة. ⚠️ يتطلب النشر.
- ✅ **Clear-all teacher prefs button (2026-06)**: زر "مسح كل التفضيلات" (أحمر بجانب الحفظ، testID `clear-prefs-btn`) مع تأكيد — يصفّر الشبكة ويعيد الافتراضيات (3 يومياً + السماح بالمتتالية) ويحفظ فوراً ويحدّث شارة القائمة إلى "متاح دائماً". لا API جديد (يستخدم PUT بشبكة فارغة). تحقق E2E: 2 خلايا محظورة → 0 والافتراضيات عادت.
- ✅ **Fix "stuck" teacher preferences (تفضيلات لا تتغير) (2026-06)**: السبب الجذري مزدوج — (1) الواجهة: fallback في `isCellUnavailable` يعيد رسم الخلية × من الحقول القديمة (`unavailable_days/slots`) حتى بعد إزالتها من الشبكة، (2) الخادم: PUT يدمج الحقول القديمة المرسلة كما هي مع الشبكة → الخلايا الملغاة "تعود". **الإصلاح**: الواجهة تطبّع فوراً عند التحميل (تدمج القديمة في الشبكة مرة واحدة ثم تصفّرها — الشبكة مصدر الحقيقة الوحيد)، وأُزيل الـfallback، والخادم يتجاهل الحقول القديمة عند إرسال `unavailable_periods` (تُدمج فقط لعميل قديم يرسل القديمة وحدها). أيضاً أُصلح عدّاد "X فترة محظورة" في القائمة ليحسب بفترات **كلية القسم** بدل `time_slots` العامة (كان يظهر 24 مقابل 7 معروضة). اختبار: curl (شبكة تحل محل قديمة + مسح كامل يعمل) + E2E (يوم كامل قديم → النقر يلغي الخلية فوراً 5→4 والحفظ يثبت). ⚠️ يتطلب النشر — هذه هي شكوى المستخدم من الإنتاج.
- ✅ **Teacher prefs new defaults + generation priority (2026-06)**: (1) **الافتراضيات الجديدة**: أقصى محاضرات يومياً 2→**3** والسماح بالمتتالية False→**True** — عُدّلت في كل المواضع (Pydantic model، get/list endpoints، فحوصات create/update/move/swap/valid-slots/auto-place، وواجهة التفضيلات) + **migration تلقائي عند الإقلاع** (`migrate_teacher_prefs_defaults_v2` في server.py بعلامة في مجموعة `migrations` — سيُطبّق على الإنتاج تلقائياً بعد النشر ويحدّث كل السجلات الموجودة). (2) **أولوية التوليد للفترات 1-3**: auto-generate يمر بجولتين (الفترات ≤3 عبر كل الأيام أولاً، ثم >3 عند التعذر)، وauto-place يعاقب الفترات المتأخرة (+50). (3) **التتالي بحد محاضرتين**: عند السماح بالمتتالية، التوليد وauto-place يمنعان تكوين 3 محاضرات متتالية للمعلم (فحص الثلاثيات بالاتجاهين + الوسط). اختبار فعلي: حذف جدول قسم وإعادة توليده → 10 محاضرات كلها في الفترات 1-2، أقصى تتالي [1,2]، لا تجاوز للحد اليومي — ثم استعادة الجدول الأصلي. ⚠️ يتطلب النشر.
- ✅ **Auto-place all unscheduled (إدراج تلقائي للكل) (2026-06)**: زر "⚡ إدراج تلقائي للكل" في رأس قسم "غير المدرجة" (لمن يملك الصلاحية) مع نافذة تأكيد. Backend: `POST /weekly-schedule/auto-place-unscheduled?faculty_id&department_id` — يوزع كل المقررات الناقصة على أفضل الأماكن الصالحة: فحص كامل (شعبة/معلم/تفضيلات/حد يومي) + **scoring**: تجنب تكرار المقرر بنفس اليوم (+100)، موازنة حمل المعلم اليومي (×5)، تفضيل الفترات المبكرة، مع اختيار قاعة حرة تلقائياً وتحديث خرائط الانشغال داخل الدفعة (لا تعارض بين الإدراجات نفسها). يرجع {placed, failed مع الأسباب}. الوثائق تحمل علامة `auto_placed: True`. testID: `auto-place-all-btn`. اختبار: curl (إدراج ذكي بالأربعاء ف1 ق101 متجنباً أيام المقرر الحالية) + E2E من الواجهة (رسالة نجاح + تحول القسم لـ"جميع المقررات مدرجة").
- ✅ **Visual conflict-free cell highlighting + placement mode (2026-06)**: نقطة API جديدة `GET /weekly-schedule/valid-slots` تحسب لكل (يوم×فترة) صلاحيتها مع الأسباب (شعبة مشغولة/معلم مشغول/خارج التفضيلات/الحد اليومي/قاعة مشغولة). في العرض الشامل: (1) **عند تحديد محاضرة للنقل** تُضاء الخلايا الصالحة أخضر متقطع والممنوعة أحمر باهت مع سبب المنع في tooltip والنقر عليها يعرض السبب، (2) **وضع الإدراج**: النقر على صف مقرر في قائمة "غير المدرجة" (بوضع التحرير) يميّزه بـ📌 ويضيء أماكنه الصالحة في صف شعبته — النقر على خلية خضراء يفتح الإضافة بالمقرر جاهزاً. زر "✕ إلغاء الإدراج". أُضيف `room_id` لعناصر master-view entries. testIDs: `unscheduled-row-{course_id}`, `cancel-placing-btn`. ⚠️ درس متكرر (مرتين): search_replace أبلغ نجاحاً دون تطبيق فعلي لاستبدالات متعددة في نفس الدفعة على هذا الملف — يجب دائماً grep للتحقق بعد كل دفعة استبدالات. اختبار: curl valid-slots (22 صالحة/8 ممنوعة بأسباب دقيقة) + E2E (إضاءة، منع بالسبب، إدراج ناجح).
- ✅ **TeacherSearchBox clipping fix in weekly-schedule (2026-06)**: قائمة البحث عن الأستاذ في نمط "بالأستاذ" كانت عائمة (absolute) تُقص عند حد البطاقة وتتداخل مع البطاقة التالية. أصبحت لوحة ضمن تدفق الصفحة (in-flow) بارتفاع أقصى 220px وتمرير داخلي + شريط علوي مثبت (عدد النتائج + زر "✕ إغلاق"). نفس نمط إصلاح teaching-load السابق. تحقق E2E: القائمة كاملة الظهور والاختيار يغلقها ويعرض جدول المعلم.
- ✅ **Delete lecture in Master View edit mode (2026-06)**: عند تحديد محاضرة في وضع التحرير يظهر زر "حذف المحددة" (أحمر داكن) مع نافذة تأكيد توضح التبعات — الحذف يحرر الفترة/القاعة/المعلم ويعيد المقرر تلقائياً لقائمة "غير المدرجة" (تُحسب ديناميكياً). يستخدم `DELETE /weekly-schedule/{id}` الموجود. **لا يمس المحاضرات الفعلية المولّدة أو الحضور**. testID: `master-delete-selected-btn`. تحقق E2E: حذف ناجح + رسالة تأكيد + عودة المقرر للقائمة.
- ✅ **Free-rooms filter in manual add modal (section mode) (2026-06)**: نافذة "إضافة يدوية" في نمط "بالشعبة" أصبحت تعرض القاعات الفارغة فقط: قبل اختيار اليوم/الفترة تظهر "اختر اليوم والفترة أولاً"، وبعده تُجلب من `GET /weekly-schedule/free-rooms` وتُعرض الحرة فقط مع ملاحظة برتقالية بأسماء المشغولة المستثناة. تغيير اليوم/الفترة يعيد تعيين القاعة ويعيد الفحص. ملف: `weekly-schedule.tsx` (state `addSlotFreeRooms` + useEffect). تحقق E2E: السبت ف1 → ق305 فقط + "🔒 مشغولة: ق101، ق202".
- ✅ **Free-rooms-only in add modal (2026-06)**: نافذة "إضافة محاضرة غير مدرجة" أصبحت تعرض **القاعات الفارغة في ذلك اليوم/الفترة فقط** — نقطة API جديدة `GET /api/weekly-schedule/free-rooms?faculty_id&day&slot_number` (فحص الانشغال عالمي عبر كل الجداول). ملاحظة برتقالية تسرد القاعات المستثناة المشغولة، وتحذير أحمر إن كانت كلها مشغولة (يمكن الإضافة بدون قاعة). testID: `busy-rooms-note`. اختبار: curl (السبت ف1 → ق101/ق202 busy، ق305 حرة) + E2E مودال.
- ✅ **Colored Master View PDF/Excel export (2026-06)**: زرا "PDF ملوّن" و"Excel ملوّن" في شريط أدوات العرض الشامل. Backend: `GET /api/weekly-schedule/master-view/export/pdf` (ReportLab, A3 landscape, خط Amiri + RTL shaping، خلايا ملونة بنفس hash ألوان الواجهة `_master_course_color`، دمج SPAN لرؤوس الأيام، عمود الشعبة أقصى اليمين، جدول "غير المدرجة" أسفله) و`/excel` (openpyxl, RTL sheet، دمج رؤوس الأيام، PatternFill ملوّن لكل مقرر، ورقة ثانية "غير المدرجة"). أُعيدت هيكلة `get_master_view` لتستخدم `_build_master_data` المشترك. التصدير القديم (export-visual — صفحة لكل شعبة) بقي كما هو دون تغيير. اختبار: curl 200 لكلا الصيغتين + تحليل PDF (عربية سليمة، ألوان، أيام) + فحص openpyxl للألوان والدمج + E2E تنزيل من الواجهة مع رسالة نجاح. ⚠️ يتطلب النشر للإنتاج.
- ✅ **Add-from-unscheduled in Master View edit mode (2026-06)**: في وضع التحرير، النقر على خلية فارغة **دون تحديد مسبق** يفتح نافذة "إضافة محاضرة غير مدرجة" تعرض فقط مقررات الشعبة الناقصة من قائمة غير المدرجة (مع المعلم وعدد الناقص) + اختيار قاعة، ثم `POST /api/weekly-schedule` بكامل الاحترازات (409 عند أي تعارض). شعبة مكتملة → تنبيه "لا توجد مقررات غير مدرجة". أُضيف `teacher_id` لعناصر unscheduled في master-view. testIDs: `master-add-modal`, `add-course-option-{id}`, `add-room-select`, `confirm-add-slot-btn`. تحقق E2E: فتح المودال، الإضافة الناجحة، تحديث قائمة الناقص، وتنبيه الشعبة المكتملة. ⚠️ درس مستفاد: أحد استبدالات search_replace أبلغ نجاحاً دون تطبيق فعلي — يجب التحقق بgrep بعد الاستبدالات الحرجة.
- ✅ **Master Schedule View (العرض الشامل بأسلوب aSc Timetables) + التحريك الشطرنجي (2026-06)**: وضع عرض خامس في `/weekly-schedule` — كل المستويات/الشعب صفوفاً × (الأيام × الفترات) أعمدة، بلوكات ملوّنة (لون ثابت لكل مقرر عبر hash) مع اسم المقرر + المعلم + القاعة، رؤوس مثبتة sticky. Backend: `GET /api/weekly-schedule/master-view` (groups/entries/unscheduled/can_manage)، `POST /api/weekly-schedule/move-slot`، `POST /api/weekly-schedule/swap-slots`. **وضع التحرير**: نقرة لتحديد محاضرة ثم نقرة على خلية فارغة (نقل ضمن نفس الشعبة) أو محاضرة أخرى (تبديل) — بكامل الاحترازات (تعارض شعبة/معلم/قاعة/تفضيلات المعلم/الحد اليومي، وفحص الطرفين معاً في التبديل، مع rollback عند DuplicateKeyError). **قسم "مقررات لم تُدرج"** أسفل الجدول: يقارن المطلوب أسبوعياً (حسب الساعات المعتمدة) بالمدرج فعلياً ويعرض الناقص. ملفات: `/app/frontend/src/components/MasterScheduleView.tsx` (جديد)، `weekly-schedule.tsx`، `routes/weekly_schedule.py`. اختبار: curl (نقل/تبديل/رفض تعارض 409/كشف النقص) + E2E بلقطات شاشة (تبديل ناجح مع رسالة خضراء). ⚠️ يتطلب النشر للإنتاج.
- ✅ **Fix individual multi-select checkboxes in course-lectures (2026-06)**: كانت خانات التحديد الفردية غير موجودة أصلاً في بطاقة المحاضرة (الدالة `toggleLectureSelection` معرفة لكن غير مستدعاة) — أُضيفت خانة تحديد مكان رقم المحاضرة عند تفعيل "تحديد متعدد" (`data-testid="lecture-checkbox-{id}"`)، والبطاقة كاملة قابلة للنقر للتحديد، وأُصلح `toggleSelectAll` ليستخدم `getFilteredLectures()` بدل `lectures`. تحقق E2E بلقطة شاشة: تحديد 2/9 يعمل. ملف: `/app/frontend/app/course-lectures.tsx`.
- ✅ **Change lecture room only + notifications (2026-02)**: نقطة API جديدة `PUT /api/lectures/{id}/room` — تغيير قاعة محاضرة **مجدولة فقط** دون المساس بالتاريخ/الوقت: فحص تعارض القاعة (رفض صارم إن كانت محجوزة، 409+force لدمج شعبتين لنفس المعلم)، حقول تدقيق (`previous_room`, `room_changed_at`, `room_changed_by_name`)، إشعار داخلي + FCM للمعلم وجميع طلاب المقرر (type: `room_change`)، وتسجيل في activity log (`change_lecture_room`). واجهة: خيار "تغيير القاعة" في قائمة (⋮) ببطاقة المحاضرة في `course-lectures.tsx` (**التطبيق الإداري فقط** حسب طلب المستخدم) → نافذة تعرض القاعة الحالية + `RoomPicker` منسدلة. testIDs: `change-room-menu-item`, `change-room-modal`, `change-room-picker`, `confirm-change-room-btn`. اختبارات: `TestChangeLectureRoom` (23/23 pass) + تحقق E2E بلقطات شاشة (نجاح التغيير A102→ق305 مع إشعار 68 مستخدم).
- ✅ **Room dropdown + Room conflict prevention for lectures (2026-02)**: (1) مكوّن جديد `RoomPicker` (`/app/frontend/src/components/RoomPicker.tsx`) — قائمة منسدلة من القاعات المسجلة (`GET /api/rooms`، نفس قاعات الجدول الأسبوعي) بدل النص الحر، مستخدم في `AddLectureModal` ونموذج التوليد التلقائي في `course-lectures.tsx`. يخزن اسم القاعة نصاً (توافق خلفي) ويعرض القاعة القديمة غير المسجلة كخيار "قاعة قديمة". (2) دالة `check_room_lecture_conflict` في `server.py`: قاعة واحدة لا تستقبل محاضرتين متداخلتين — خطأ صارم لمعلم/مقرر مختلف، تحذير قابل للتجاوز (force) عند دمج شعبتين لنفس المعلم ونفس المقرر الأساسي. مطبقة على: create / update / reschedule / generate / generate-semester / Excel import. اختبارات: `TestRoomConflictPrevention` في `tests/test_lecture_duplicate_prevention.py` (18/18 pass). ⚠️ يتطلب نشر الباك والفرونت للإنتاج.
- ✅ **Lectures strict conflict prevention (2026-02)**: كان يمكن إنشاء محاضرتين متداخلتين لنفس المقرر ونفس المعلم (التحذير كان قابلاً للتجاوز بـforce). الآن: (1) `check_teacher_lecture_conflict` يرفض بشكل صارم أي تداخل زمني لنفس المقرر حتى مع force — التحذير القابل للتجاوز بقي فقط لشعبة أخرى مختلفة فعلياً. (2) `PUT /lectures/{id}` أصبح يفحص التعارض عند تغيير التاريخ/الوقت (لم يكن يفحص إطلاقاً). (3) فهرس MongoDB فريد `uniq_course_date_start` على `(course_id, date, start_time)` للحالات النشطة + تنظيف تلقائي عند الإقلاع يُلغي المكررات القائمة (يُبقي المنعقدة ثم الأقدم، لا يحذف حفاظاً على الحضور). (4) جميع نقاط الإنشاء (create/generate/generate-semester/reschedule/Excel import) تلتقط `DuplicateKeyError` → 409. اختبار انحدار جديد: `tests/test_lecture_duplicate_prevention.py` (6/6). ⚠️ يجب النشر للإنتاج ليعمل التنظيف على قاعدة Atlas.
- ✅ **Teaching Load page — Search results UX fix (2026-02)**: نتائج البحث عن مقرر في `/teaching-load` كانت قائمة عائمة (position:absolute) تغطي "المقررات المختارة" وتمنع تمرير الصفحة. أصبحت الآن لوحة ضمن تدفق الصفحة (in-flow) بارتفاع أقصى 340px وتمرير داخلي، مع شريط علوي (عدد النتائج + زر "✕ إغلاق النتائج" `close-search-results-btn`). أُصلح أيضاً الشريط المعترض "اختر القسم ثم المعلم" الذي كان يظهر بالخطأ في وضع "جميع الأقسام" (الشرط أصبح `!selectedDept && !crossDept`)، وأُضيف `paddingBottom: 100` لمحتوى الـScrollView. ملف: `/app/frontend/app/teaching-load.tsx`. تم التحقق بلقطات شاشة على المعاينة.
- ✅ **Teaching Load Export — Notes column (cross-dept/cross-faculty flag)**: Added a "ملاحظات" column to Excel + PDF that flags courses assigned from outside the teacher's home department/faculty. Indicators: `↻ من قسم آخر` (cross-dept) and `⚑ من كلية أخرى` (cross-faculty). Cells highlighted in orange/red. Resolves faculty via `department.faculty_id` when missing on the course itself.
- ✅ **Teaching Load Export — Block-per-teacher + Level column + Teacher heading text**: Restructured department-wide teaching load exports to render one mini-table per teacher with: teacher info as bold heading text (`المعلم : ...   الرقم الوظيفي : ...`), course header row (blue) + course rows (with new `المستوى` column) + total row (light blue). Top header now shows الكلية + القسم side-by-side. PDF switched from landscape to portrait. Single-teacher mode inherits dept/faculty from teacher record. File: `/app/backend/backend/routes/teaching_load.py` (`_get_export_data`, `export_teaching_load_excel`, `export_teaching_load_pdf`). Tests pass: `tests/test_teaching_load_report.py` (6/6).
- ✅ Global Search subtitles polished: dept/faculty names stripped of trailing whitespace; Departments now include parent `كلية` in subtitle; Lectures now display `قسم/كلية` context. RBAC scoping verified intact for Saeed (dept head). File: `/app/backend/backend/routes/global_search.py`.

- ✅ **Teacher Preferences enforcement on ALL lecture creation/edit paths (2026-07-18)**: كانت تفضيلات المدرّس تُتجاهل عند الإنشاء/التعديل اليدوي (انحدار بعد إضافة فحص القاعات). أُصلح بربط `check_teacher_preferences_conflict` (server.py ~7883) في 6 مسارات بجانب فحص القاعة دون أن يلغي أحدهما الآخر: `POST /lectures`، التوليد الأسبوعي، `POST /lectures/generate-semester`، `PUT /lectures/{id}` (عند تغيير التاريخ/الوقت)، `PUT /lectures/{id}/reschedule`، واستيراد Excel. الفحوصات: يوم محظور، فترة محظورة (عبر schedule_settings للكلية)، الحد اليومي الأقصى، منع التتالي. مسارات التوليد الجماعي تتخطى (conflicts_skipped) بينما المسارات اليدوية ترجع 400 برسالة عربية تبدأ بـ"تفضيلات المدرّس:". ملاحظة: `routes/lectures.py` نسخة ميتة غير مسجلة — لم تُعدَّل. توليد المحاضرات من الجدول الأسبوعي (weekly_schedule.py) يرث جدولاً مبنياً أصلاً باحترام التفضيلات. اختبار E2E: 9/9 (يوم محظور، فترة محددة، فترة أخرى مسموحة، حد يومي، تتالي، إعادة جدولة، تعديل، وتعارض القاعة ما زال يعمل).

- ✅ **Excel Import for Master Weekly Schedule (2026-07-21)**: ميزة استيراد الجدول الأسبوعي الشامل من Excel (بطلب المستخدم مع نموذج مرفق). ملف جديد `routes/schedule_import.py` (مسجل في server.py):
  - `GET /api/weekly-schedule/import-template?faculty_id=&department_id=`: يولّد قالباً بنفس بنية نموذج المستخدم (أيام × فترات، لكل مجموعة 3 صفوف: المقرر/القاعة/الأستاذ)، معبأ بالجدول الحالي + ورقة "الأدلة" بأسماء المقررات/الأساتذة/القاعات الدقيقة.
  - `POST /api/weekly-schedule/import-master` (faculty_id, department_id, dry_run, file): تحليل مرن (كشف صف الأيام تلقائياً، دعم الدمج merged cells، تسميات المستويات بالأرقام أو الترتيب العربي "الثاني.."، تطبيع عربي للهمزات/التاء المربوطة).
  - **السياسات المقررة من المستخدم**: (1أ) دمج — الخلايا المشغولة تُتخطى مع تقرير، (2ب) أي تعارض جدولة (معلم/قاعة/تفضيلات/حد يومي — داخل الملف أو مع الجدول القائم عبر كل الأقسام) يوقف الاستيراد كاملاً بلا حفظ، (3ج) اختلاف اسم الأستاذ عن المسند للمقرر = خطأ تُتخطى الخلية.
  - تمييز المقررات متطابقة الاسم بالأستاذ + مقارنة الشعبة مطبّعة (أ/ا) — ثغرتان اكتُشفتا وأُصلحتا أثناء الاختبار.
  - الواجهة (`MasterScheduleView.tsx`): زر "استيراد Excel" (بنفسجي، `master-import-excel-btn`) → نافذة (`master-import-modal`): اختيار قسم، تحميل قالب (`download-import-template-btn`)، اختيار ملف، معاينة إلزامية (`import-dry-run-btn`) بتقرير مفصل (تعارضات حمراء/أخطاء أسماء برتقالية/مشغولة رمادية)، ثم تأكيد (`import-confirm-btn`) يظهر فقط عند can_commit.
  - اختبار E2E باك اند 4/4 (قالب، معاينة بخطأ أسماء، تأكيد إدراج، إعادة استيراد = دمج/تخطي) + إثبات إيقاف الاستيراد الكامل عند تعارض معلم/قاعة/حد يومي + لقطة شاشة للواجهة.

- ✅ **Smart Resolver — الحلحلة الذكية (2026-07-22)**: خوارزمية Chain-Repair لإدراج المقررات المتعثرة بنقل محاضرات قائمة. ملف جديد `routes/schedule_resolver.py` (مسجل في server.py):
  - `POST /api/weekly-schedule/resolve-unscheduled/preview` (faculty_id, department_id): يبني خطة (نقلات + إدراجات + متعذرة بأسبابها) دون حفظ. `POST .../commit`: ينفذ الخطة المعتمدة بعد إعادة التحقق الكامل ضد الحالة الحالية (أي تغيير منذ المعاينة → 409 "أعد المعاينة").
  - **السياسات المقررة من المستخدم**: لا تُمس إلا محاضرات نفس القسم • معاينة إلزامية قبل التنفيذ • حتى نقلتين متسلسلتين لكل إدراج.
  - المنطق: مرحلة 1 إدراج مباشر (كمنطق auto-place) → مرحلة 2 تحليل مانعي كل خلية (شعبة/معلم/قاعة) ونقلهم لخلايا صالحة بكامل الفحوصات (تفضيلات كل المعلمين خط أحمر لا يُنتهك، منع 3 متتاليات، الحد اليومي). نقلة مزدوجة مدعومة (نقل C لإفساح مكان لـB ثم B ثم إدراج U) مع undo كامل عند الفشل. المحاضرات المنقولة توسم `moved_by_resolver` والمدرجة `placed_by_resolver`.
  - الواجهة (`MasterScheduleView.tsx`): زر "🧩 حلحلة ذكية" (testID `smart-resolver-btn`) بجانب الإدراج التلقائي في قسم غير المدرجة → نافذة (`resolver-modal`): اختيار قسم، بناء الخطة (`resolver-preview-btn`)، عرض النقلات (برتقالي) والإدراجات (أخضر) والمتعذرة بأسبابها (أحمر)، تنفيذ (`resolver-commit-btn`).
  - اختبار E2E: 6/6 (سيناريو نقل إجباري: معاينة، عدم انتهاك التفضيلات، تنفيذ، تحقق DB، رفض خطة قديمة stale 409، حالة مستحيلة بسبب واضح) + 2/2 سلسلة مزدوجة (C3 يتحرك أولاً ثم C2 ثم إدراج C1 بالترتيب الصحيح) + لقطة شاشة للواجهة.

- ✅ **Import policy changed to Cell-level Override (2026-07-23)**: بطلب المستخدم، سياسة استيراد الجدول الشامل تغيّرت من "دمج" إلى "**الإكسل هو الأساس**": الخلية المعبأة في الملف **تستبدل** ما يقابلها في النظام (حذف القديم + إدراج الجديد)، الخلايا الفارغة في الملف لا تمس الموجود، والمطابقة تماماً (نفس المقرر+القاعة) تُتخطى بلا تغيير. خرائط التعارض تستثني الخلايا المستبدلة (القديم الملغى لا يُحسب تعارضاً). قاعدة "أي تعارض يوقف الاستيراد كاملاً" باقية (خصوصاً تعارضات المعلم/القاعة مع أقسام أخرى — مؤكدة بالاختبار). التقرير أضاف قسم "🔁 خلايا ستُستبدل" (بنفسجي) بتفاصيل القديم→الجديد، وحقول `to_replace`/`replaced`/`replaced_count`. التنفيذ: delete_many للمستبدلة ثم إدراج الكل بوسم `replaced_existing`. اختبار E2E: 5/5 (معاينة استبدال بلا تعارض قاعة محررة، تنفيذ، تحقق DB، إعادة رفع = مطابقة، تعارض معلم عبر قسم آخر يوقف الكل).

- ✅ **Excel-driven Teacher Assignment on Import (2026-07-23)**: بطلب المستخدم، الإكسل أصبح الأساس في الإسناد أيضاً داخل استيراد الجدول الشامل:
  - مقرر بلا إسناد + اسم أستاذ في الملف → يُسند إليه تلقائياً (`db.courses.teacher_id`).
  - اسم أستاذ مختلف عن المسند → يُستبدل الإسناد، ويسري بالتسلسل (cascade) على كل محاضرات المقرر القائمة في `weekly_schedule`.
  - فحوصات جديدة: الأستاذ غير موجود بالنظام أو اسم مكرر لمعلمين → خطأ خلية. نفس المقرر بأكثر من أستاذ داخل الملف → تعارض يوقف الكل (فحص شامل عبر `file_teachers` غير معتمد على الترتيب). التصادم الناتج عن الكاسكيد (محاضرتان قائمتان تتصادمان بالإسناد الجديد) يُكتشف أياً كان ترتيب المرور (`busy_teacher_owner` dict) + تفضيلات/حد يومي للمعلم الجديد على المحاضرات القائمة + DuplicateKeyError→409 كشبكة أمان في التنفيذ.
  - التقرير: قسم "🧑‍🏫 إسنادات ستتغير" (أزرق) + حقول `to_reassign`/`reassigned`. الواجهة حدثت (نص السياسة + القسم الجديد).
  - اختبار E2E: 5/5 (إسناد غير المسند، تغيير إسناد + cascade، Idempotency، ملف متناقض يُحظر، أستاذ مجهول = خطأ خلية) + 2/2 كشف تصادم الكاسكيد الصافي وعدم مساس DB.
  - ثغرتان اكتُشفتا وأُصلحتا أثناء الاختبار: كشف تصادم الكاسكيد كان يعتمد على ترتيب المرور، وupdate_many كان قد يرفع 500 بدل 409.

- ✅ **Unscheduled courses metric simplified (2026-07-23)**: بطلب المستخدم (ظهرت 96 "غير مدرجة" رغم إدراج الكل عبر Excel): كان `_build_master_data` يحسب المطلوب من الساعات المعتمدة (3 ساعات = خليتان أسبوعياً، والافتراضي 3) فتظهر المدرجة مرة واحدة كـ"ناقصة". عُدّل المعيار: **خلية واحدة على الأقل = مدرج**؛ القائمة تعرض فقط المقررات بلا أي خلية (`have == 0`, `missing=1`). يسري تلقائياً على العرض الشامل وPDF والحلحلة والإدراج التلقائي (كلها تقرأ نفس الدالة). `_needed_weekly_slots` لم تعد مستخدمة في هذا المسار. اختبار: مقرر له خلايا لا يظهر + مقرر بلا خلايا يظهر بـmissing=1.

- ✅ **Re-upload confirm bug fixed (2026-07-23)**: شكوى المستخدم "لا يظهر تأكيد وإدراج إلا في الرفع الأولي". 3 إصلاحات:
  1. **استبدال محايد زمنياً** (schedule_import.py): استبدال خلية بنفس المعلم في نفس (اليوم/الفترة) — كتغيير قاعة — كان يُعامل كمحاضرة إضافية فيرفضه فحص الحد اليومي/الفترة المحظورة إذا كان جدول المعلم ممتلئاً. أضيف `neutral_time` (عبر `_replaced_teacher`) يتجاوز هذين الفحصين فقط عند حياد الوقت والمعلم؛ الخلايا الجديدة الفعلية تبقى مفحوصة بصرامة (مختبر).
  2. **إغلاق النافذة بعد التنفيذ** (MasterScheduleView.tsx): كان الشرط `created > 0` فلا تُغلق النافذة ولا تظهر رسالة نجاح عند تنفيذ استبدالات فقط (created=0). أصبح الإغلاق عند أي تنفيذ بلا تعارضات.
  3. **رسالة الملف المطابق**: إعادة رفع ملف بلا أي تغييرات تعرض الآن "الملف مطابق تماماً للجدول الحالي — لا توجد تغييرات للاستيراد" بدل "سيتم إدراج 0 محاضرة".
  اختبار: 3/3 (تعديل قاعة → تأكيد يظهر وينفذ، رسالة المطابقة، الخلية الجديدة لمعلم مشبع ما زالت تُرفض).

- ✅ **Bulk Lectures Purge (2026-07-25)**: بطلب المستخدم — مسح جماعي للمحاضرات المولدة (بتواريخ) دون مساس بالمقررات/الإسنادات/الجدول الأسبوعي. ملف جديد `routes/lectures_purge.py` (مسجل في server.py):
  - `POST /api/lectures/purge/preview` و `POST /api/lectures/purge` — النطاق: كلية / قسم / مقرر واحد + خيار زمني (الكل / المستقبلية فقط حسب توقيت اليمن).
  - يحذف المحاضرات **وسجلات حضورها معاً** (قرار المستخدم). الصلاحية: admin أو `manage_lectures` (المعلم يحصل 403 — مختبر).
  - الواجهة (`schedule.tsx`): زر أحمر "مسح المحاضرات" في هيدر الجدول اليومي (`purge-lectures-btn`, ويب فقط) → نافذة (`purge-modal`): نطاق (`purge-scope-*`)، اختيارات متسلسلة كلية/قسم/مقرر، نطاق زمني (`purge-time-*`)، معاينة إلزامية (`purge-preview-btn`) تعرض "سيُحذف X — منها Y عليها Z سجل حضور"، ثم تأكيد مزدوج (زر أحمر + window.confirm) (`purge-confirm-btn`). زر مسح الجدول الأسبوعي القديم بقي منفصلاً.
  - تسجيل في سجل النشاط `purge_lectures`. اختبار E2E: 5/5 (معاينة بالمقرر، مستقبلية فقط، تنفيذ جزئي، تنفيذ كامل مع بقاء المقرر، نطاقا القسم والكلية) + 403 للمعلم + لقطة شاشة كاملة للتدفق.

- ✅ **Statement Letterhead Settings UI (2026-07-29)**: بطلب المستخدم — "كليشة تتناسب مع كل كلية + طريقة لإضافة اسم المسجل":
  - صفحة جديدة `/app/frontend/app/statement-settings.tsx` (مسجلة في `_layout.tsx` بعنوان "إعدادات كليشة الإفادة"): اختيار الكلية (يخضع لنطاق RBAC عبر `/faculties`)، رفع شعار مخصص (base64، حد 2MB مع معاينة وإزالة)، اسم المسجل، اسم الكلية بالإنجليزية، وبيانات التذييل (عنوان/هواتف/فاكس/ص.ب/موقع). حفظ عبر `PUT /statements/settings/{faculty_id}` (موجود مسبقاً).
  - رابط "إعدادات الكليشة" (`statement-settings-link`) داخل نافذة إصدار الإفادة في `student-details.tsx` يمرر `facultyId` للطالب.
  - تحسين PDF (`statements.py::_build_pdf`): شعار الجامعة الافتراضي `/app/backend/backend/assets/university_logo.jpeg` كـfallback عند عدم رفع شعار للكلية + خط مزدوج أسفل الترويسة (شكل رسمي) مع إزاحة قسم المرجع/التواريخ للأسفل.
  - اختبار: إصدار إفادة E2E عبر API (PDF 90KB سليم، معاينة بصرية للكليشة)، حفظ/جلب الإعدادات عبر API، لقطة شاشة للصفحة الجديدة تعرض الإعدادات المحفوظة.

- ✅ **Statements Log + Revoke + Expiry (2026-07-29)**: بطلب المستخدم:
  - **مدة صلاحية اختيارية**: حقل "مدة الصلاحية بالأيام" في نافذة الإصدار (`statement-valid-days-input`) → يُحسب `expires_at` ويُطبع على الـPDF ("هذه الإفادة صالحة حتى تاريخ ...") ويظهر في صفحة التحقق؛ بعد انقضائه يعرض التحقق "انتهت صلاحية هذه الإفادة بتاريخ X" (valid:false).
  - **إلغاء/استعادة**: `POST /statements/{id}/revoke` (مع سبب اختياري) و`/restore` — التحقق يعرض "ملغاة من الجهة المصدرة ولا يُعتد بها". صلاحية `_can_issue` + تسجيل في سجل النشاط.
  - **صفحة سجل الإفادات** `/app/frontend/app/statements-log.tsx` (مسجلة في `_layout.tsx`): بحث (اسم/رقم إفادة/قيد)، فلتر كلية، شارات حالة (سارية/ملغاة/منتهية)، إجراءات: تنزيل PDF، نسخ رابط التحقق، إلغاء (نافذة سبب `revoke-modal`)، استعادة. رابط "سجل الإفادات" (`statements-log-link`) بجانب "إعدادات الكليشة" في نافذة الإصدار.
  - اختبار E2E عبر API: إصدار بـ90 يوم → تحقق (صالحة حتى) → إلغاء → تحقق (ملغاة) → استعادة → تحقق (سارية) → انتهاء صلاحية (تاريخ ماضٍ) → تحقق (منتهية) ✔️ + معاينة PDF بسطر الصلاحية ✔️ + لقطة شاشة لصفحة السجل ✔️
  - **(2026-07-29) وصول مباشر**: بطاقة "سجل الإفادات" (`statements-log-btn`) في صفحة التقارير (`reports.tsx`) — تظهر لغير المعلم/الطالب (مطابق لصلاحية `_can_issue` بالخادم). مختبر بلقطة شاشة + نقرة تنقل للسجل.

- ✅ **Student Nationality field (2026-07-29)**: بطلب المستخدم — الجنسية ضمن بيانات الطالب الأساسية:
  - Backend: `nationality` في `StudentBase`/`StudentUpdate` + كل نقاط التسلسل اليدوية (قائمة/تفاصيل/QR/me/تحديث في server.py). استيراد Excel يدعم عمود "الجنسية" (mapping + student_data)، وقالب `/template/students` يتضمنه.
  - Frontend: حقل الجنسية في نموذج الإضافة (`AddStudentForm` — يُستخدم في students وcourse-students)، نافذة التعديل (`edit-student-nationality-input`)، عرضها في تفاصيل الطالب (أيقونة علم)، ونوع `Student` في types.
  - الإفادة: تُجلب الجنسية تلقائياً من بيانات الطالب (fallback موجود مسبقاً بالخادم + prefill بالواجهة) — لا حاجة لكتابتها عند كل إصدار.
  - ملاحظة: أُعيد رابط `statements-log-link` في نافذة الإفادة بعد فقدانه (rollback محتمل).
  - اختبار E2E: إنشاء بجنسية → عرض → تعديل → استيراد Excel بعمود الجنسية (2 طلاب) → القالب → إصدار إفادة تلقائية بجنسية الطالب ✔️ + لقطة شاشة (العرض + prefill بالمودال) ✔️ ثم حُذف طلاب الاختبار.
  - **(2026-07-29) تعبئة جماعية بطلب المستخدم**: كل الطلاب الحاليين (غير الخريجين) → "إندونيسي"، طالبات كلية البنات → "إندونيسية" (72 طالبة + 19 طالب). قاعدة إضافية من المستخدم: طلاب كلية الإدارة وكلية علوم الحاسوب يمنيون — **الكليتان غير موجودتين بعد في النظام**، تُطبق عند إنشائهما/استيراد طلابهما (عمود الجنسية في Excel أو التعديل الجماعي).

- ✅ **Digital Student Card — كامل (2026-07-29)**: بخيارات المستخدم (كل القوالب + اعتماد المسجل + QR مزدوج + PDF/PNG + صلاحية العام الجامعي):
  - Backend `/app/backend/backend/routes/student_cards.py`: `GET/PUT /cards/settings/{faculty_id}` (قوالب green/dark/horizontal لكل كلية)، `GET /students/{id}/card` و`/students/me/card` (توكن بطاقة يتجدد تلقائياً مع العام الجامعي النشط)، صور: `POST /students/{id}/photo` (أدمن، فوري) و`POST /students/me/photo` (طالب، معلقة) + `GET /pending-photos` + approve/reject، تحقق عام `GET /verify/card/{token}` (خريج/مفصول="لم تعد سارية"، عام قديم="انتهت") + `GET /public/card-photo/{token}`، تنزيل `GET /students/{id}/card/download?fmt=png|pdf` (PIL+libraqm للعربية — ملاحظة: Pillow هنا مبني بـraqm فلا يستخدم arabic_reshaper/bidi وإلا انعكس النص، مقاس CR80 للـPDF). التخزين عبر services/storage_service (objstore).
  - Scanner: `GET /students/qr/{code}` يحل card_token أيضاً + qr-scanner.tsx يستخرج token= من الرابط.
  - Frontend admin: `student-card.tsx` (بطاقة رقمية بالقوالب الثلاثة + تنزيل PNG/PDF + رفع صورة + اعتماد/رفض المعلقة)، `card-settings.tsx`، `photo-approvals.tsx`، `verify-card.tsx` (عامة)، زر "البطاقة" في student-details (student-card-btn)، بطاقة "اعتماد صور الطلاب" في reports.
  - Student app (`student-app-standalone`): إعادة كتابة student-card.tsx — بطاقة بالقالب المعتمد + رفع صورة عبر expo-image-picker (أُضيفت للحزم) → معلقة حتى الاعتماد.
  - اختبار: testing_agent iteration_60 — Backend 21/21 ✔️ Frontend كل التدفقات ✔️ (pytest دائم في /app/backend/tests/test_student_cards.py). ملاحظات الوكيل عولجت: مسافة QR بالقالب الأفقي + نص "امسح للتحقق". ملاحظة dist القديم (404 لمسارات جديدة عند الفتح المباشر) لا تؤثر: الإنتاج يبني `expo export` داخل Dockerfile تلقائياً.
  - حساب طالب للاختبار: 234/test1234 (خالد — خريج فبطاقته "لم تعد سارية" وهذا صحيح).

- ✅ **Batch Card Printing + Production Nationality Fill (2026-07-30)**:
  - **تعبئة الإنتاج**: نُفذت عبر `POST /api/admin/students/bulk-nationality` على Railway بعد نشر المستخدم — 1254 طالباً: 1055 إندونيسي (شريعة 891 + علوم إسلامية 164) و199 يمني (إدارة واقتصاد). كلية البنات/هندسة الحاسوب/دراسات عليا بلا طلاب حالياً بالإنتاج. ملاحظة: الاستدعاء الأول انقطع بمهلة 120ث — التنفيذ الناجح تم بخلفية nohup بمهلة 600ث.
  - **الطباعة الدفعية**: `GET /cards/print-settings` (إعدادات عامة محفوظة في card_print_settings/_id=global) + `POST /cards/batch-pdf` (قسم/مستوى/شعبة، حد 400، بطاقتان لكل A4 بمواضع مم قابلة للضبط card1_x/y وcard2_x/y ومقاس card_w/h، **القوالب العمودية تُطبع بالطول بأبعاد معكوسة تلقائياً**) + `GET /cards/batch-count`.
  - Frontend `batch-print.tsx`: فلاتر كلية/قسم/مستوى، عدّاد الطلاب/الورقات، حقول المواضع، **معاينة A4 حية** تتبع اتجاه قالب الكلية، تنزيل PDF (timeout 5 دقائق). بطاقة "طباعة البطاقات" في reports (batch-print-btn).
  - اختبار: curl (إعدادات/عدّاد/PDF 10 صفحات بمواضع مخصصة + حفظ الإعدادات + معاينة بصرية للاتجاهين) + لقطة شاشة للصفحة ✔️

  - **(2026-07-30) خيار اتجاه الإخراج بالطباعة**: `orientation` (auto/portrait/landscape) في batch-pdf + محفوظ بالإعدادات — عند مخالفته لاتجاه القالب تُدار صورة البطاقة 90° بـPIL دون تغيير التصميم. أزرار بالواجهة (orientation-*-btn) + معاينة تتبع الخيار + تنبيه بالتدوير. مختبر: PDF أفقي لقالب عمودي (تدوير سليم) + حفظ الخيار + لقطة شاشة.

- ✅ **Fix: Browser Auto-Translate mangling Arabic (2026-07-30)**: مستخدمو الإنتاج رأوا نصوصاً مشوهة ("جامعة الأحقاف"→"القوات المسلحة") — السبب: expo export يولّد `<html lang="en">` فتترجم متصفحاتهم الصفحة العربية تلقائياً. الحل: `app/+html.tsx` (expo-router v6 HTML template) في **كل التطبيقات** (frontend, student-app-standalone, student-app, teacher-app-standalone, teacher-app) مع `lang="ar" dir="rtl" translate="no"` + `<meta name="google" content="notranslate">` + body.notranslate. تحقق بالمعاينة: lang=ar وtranslate=no ✔️. يلزم النشر ليصل للإنتاج.

- ⚠️ **درس مهم (2026-07-30)**: إضافة `dir="rtl"` على `<html>` في +html.tsx **قلبت تخطيط التطبيق كاملاً** (القائمة انتقلت لليسار) لأن التطبيق RN Web يدير RTL يدوياً بـrow-reverse على افتراض LTR أساسي. الحل النهائي: `<html lang="ar" translate="no">` **بدون dir** + meta notranslate — يمنع الترجمة التلقائية دون كسر التخطيط. لا تضف dir="rtl" لوسم html في هذا المشروع أبداً.

- ✅ **Verification Domain Separation (2026-07-30)**: بطلب المستخدم — التحقق على `ahgaff.net` والنظام على `app.ahgaff.net`:
  - Cloudflare (نفذه المستخدم بإرشادي): تعطيل قاعدة التحويل + إضافة Worker Route `ahgaff.net/*` على `ahgaff-frontend-proxy` (البنية: Workers proxy → Cloud Run `ahgaff-frontend` بـme-central1).
  - Backend: إعداد `system_settings/_id=verify_base_url` + `GET/PUT /api/settings/verify-base-url` (PUT أدمن فقط، يرفض غير https) — يتجاوز base_url القادم من العميل في إصدار الإفادات (`statements.py`) وبطاقات الطلاب و batch (`student_cards.py::get_verify_base`).
  - Frontend: صفحة `verify-portal.tsx` (بوابة هبوط عامة: شعار + إرشاد QR + حقل رمز يدوي يقبل الرمز أو الرابط كاملاً) + **حارس نطاق في `_layout.tsx`**: أي مسار على ahgaff.net/www غير (verify-portal/verify-statement/verify-card) → replace للبوابة. + حقل "رابط التحقق الأساسي" للأدمن في statement-settings (`verify-base-url-input`).
  - اختبار: ضبط الرابط → إفادة وبطاقة جديدتان تولّدان `https://ahgaff.net/verify-...` ✔️ رفض رابط بلا https ✔️ لقطة للبوابة ✔️. أعيد الإعداد فارغاً محلياً (المعاينة).
  - **ما بعد النشر (تم 2026-07-30)**: ضُبط `verify_base_url=https://ahgaff.net` في الإنتاج عبر PUT ✔️ + تحقق بمتصفح: ahgaff.net → يحوّل تلقائياً لبوابة التحقق (لا نظام) ✔️ وapp.ahgaff.net يعمل طبيعياً ✔️

  - **(2026-07-30) بوابة التحقق المطورة**: زر "امسح رمز QR بالكاميرا" (jsqr + getUserMedia، يستخرج token= ويميز إفادة/بطاقة، رسالة عربية عند رفض إذن الكاميرا) + الشعار/اسم الجامعة والرابط السفلي يفتحان https://ahgaff.edu بنافذة جديدة. مختبر: كاميرا تعمل + الإدخال اليدوي يوجه للتحقق + الروابط ظاهرة. أُضيفت jsqr@1.4.0 لحزم frontend.

- ✅ **Fix: "‎.0" suffix on enrollment numbers (2026-07-30)**: استيراد Excel كان يحول أرقام القيد/الهاتف/سنة الالتحاق float→str فينتج "128001.0" (**217 طالباً بالإنتاج متأثرون**). الإصلاح: helper `_xl_str()` في server.py (يقص .0) طُبق على كل مواضع الاستيراد (استيراد الطلاب + التسجيل بالجدول + enrollment_year/phone) + أداة `POST /api/admin/students/fix-dotted-ids` (أدمن) تنظف البيانات الموجودة وتصلح qr_code وusername المرتبط. مختبر محلياً E2E (استيراد float نظيف + تنظيف بيانات قديمة مزروعة). **نُفذ على الإنتاج (2026-07-30): 217 student_id + 15 username أُصلحوا، المتبقي بـ.0 = صفر من 1254** ✔️

- ✅ **(2026-07-30) الجنسية في تصدير Excel**: أضيف عمود "الجنسية" لتصدير الطلاب من الخادم (`GET /export/students` بعد سنة الالتحاق) وتصدير المحددين بالواجهة (students.tsx rows). مختبر: التصدير يعرض العمود بالقيم.

## P3 / Backlog
- server.py modularization (Phase 2: Reports; Phase 3+: Templates, Courses, Lectures…)
- Migrate Atlas cluster AWS Oregon → GCP Doha (latency)

## Architecture (key)
- Backend: `/app/backend/backend/server.py` (~14k lines) + routes/
- **📕 `/app/PERMISSIONS_ARCHITECTURE.md` — مرجع إلزامي قبل أي تعديل يخص المستخدمين/الأدوار/الصلاحيات/فلاتر النطاق (بطلب المستخدم 2026-07)**
- Frontend: `/app/frontend/app/*.tsx` (Expo)
- Dual deploy: Railway (native) + GCP Cloud Run (GitHub Actions)
- DB: MongoDB Atlas M10 (AWS Oregon)

## Credentials
See `/app/memory/test_credentials.md`

- **(2026-08-01) الصلاحية الافتراضية 90 يوماً + الشعبة على البطاقة**:
  - `routes/statements.py`: عند إصدار إفادة بدون تحديد مدة صلاحية تُعتمد 90 يوماً تلقائياً (لم يعد هناك إفادات بلا انتهاء). تحديث نص الحقل في `student-details.tsx`.
  - `routes/student_cards.py` + `student-card.tsx`: إضافة صف "الشعبة" للبطاقة الرقمية (PDF + المعاينة + الطباعة الجماعية) — يُخفى تماماً إذا لم تكن للطالب شعبة (قرار المستخدم).
  - اختبار: إصدار إفادة عبر API بدون مدة → expires_at بعد 90 يوماً ✔️ + توليد PNG لبطاقتين (بشعبة/بدون) ومعاينة بصرية ✔️. ⚠️ يتطلب النشر للإنتاج.

- **(2026-08-01) قالب رابع للبطاقة "الرسمي الأنيق" (official)**:
  - تصميم عمودي بألوان الجامعة (أخضر #1b5e20 وأبيض): شريط جانبي أخضر يمين + خط فاتح يسار، شعار داخل حلقة خضراء مزدوجة، كبسولة فاتحة لاسم الكلية، شريط "بطاقة طالب" داكن، إطار أخضر مزدوج للصورة، زخارف دوائر خفيفة بالزوايا، تباعد صفوف ديناميكي (حتى 6 صفوف دون قصّ).
  - Backend: `TEMPLATES` + `THEMES` + فرع رسم جديد في `_render_card_png`. Frontend: خيار جديد في `card-settings.tsx` + معاينة مطابقة في `student-card.tsx`.
  - اختبار: توليد PNG (بكل الحقول/بالحد الأدنى) بمعاينة بصرية ✔️ + E2E: حفظ القالب عبر API + لقطة شاشة للمعاينة بالمتصفح ✔️. ⚠️ يتطلب النشر للإنتاج.

- **(2026-08-01) علامة مائية بشعار الجامعة على البطاقات**:
  - شعار الجامعة كعلامة مائية شفافة (alpha≈26 مع إزالة الخلفية البيضاء) خلف بيانات البطاقة في كل القوالب الأربعة (official/green/dark/horizontal) — دالة `paste_watermark` في `_render_card_png`.
  - معاينة الواجهة (`student-card.tsx`): صورة الشعار absolute بشفافية 0.07 خلف البيانات في الفروع الثلاثة.
  - اختبار: توليد PNG للقوالب الأربعة بمعاينة بصرية ✔️ + لقطة شاشة للمعاينة بالمتصفح ✔️. ⚠️ يتطلب النشر للإنتاج.

- **(2026-08-01) تصدير جماعي للإفادات والبطاقات من شريط التحديد بقائمة الطلاب**:
  - زر "إصدار إفادات": نافذة (الغرض + مدة الصلاحية افتراضي 90) → `POST /api/statements/bulk-issue` يصدر إفادة رسمية برقم متسلسل لكل طالب محدد (حتى 200)، تُسجَّل كلها في سجل الإفادات، ويتنزل PDF واحد مدموج بـpypdf (إفادة/صفحة). فحص الصلاحيات على كل الكليات قبل الإصدار. Refactor: استخراج `_issue_core` من endpoint الإصدار الفردي.
  - زر "طباعة بطاقات": ينتقل لـ`/batch-print?ids=...` — نفس واجهة الطباعة الجماعية بكل خصائص الطابعة (المقاسات/المواضع/الاتجاه) لكن للطلاب المحددين فقط. Backend: `student_ids` في `BatchPrintRequest` مع حل الكلية/القسم/القالب لكل طالب (يدعم طلاباً من كليات مختلفة، تدوير لكل بطاقة حسب قالبها).
  - أُضيف pypdf==6.14.2 لrequirements.txt.
  - اختبار E2E: bulk-issue لـ3 طلاب (أرقام متسلسلة + غرض + صلاحية 60 يوم + PDF من 3 صفحات + ظهورها بالسجل) ✔️، batch-pdf بـstudent_ids (3 طلاب → صفحتان) ✔️، لقطات شاشة: batch-print بوضع المحددين + شريط التحديد بالزرين + نافذة الإصدار الجماعي ✔️. ⚠️ يتطلب النشر للإنتاج.

- **(2026-08-01) شهادة التخرج PDF بقالب الجامعة الأصلي + تحقق QR**:
  - القالب: مسح ضوئي للشهادة الرسمية رفعه المستخدم — نُظّفت الحقول المتغيرة (الصورة/الاسم/التخصص/الكلية/التقدير/التواريخ) بـPIL وحُفظ في `assets/certificate_template.png` (1136×1628) مع بقاء الخط الديواني الأصلي للنصوص الثابتة. الحقول المتغيرة تُرسم بخط Aref Ruqaa (fonts/ArefRuqaa-*.ttf) الأقرب للخط اليدوي، والأرقام بالهندية العربية.
  - Backend `routes/certificates.py`: `POST /certificates/issue` (للخريجين فقط، ترقيم تسلسلي لكل كلية/سنة في `certificate_counters`، تحويل هجري تلقائي بـhijridate)، سجل `graduation_certificates`، `GET /certificates`، `GET /certificates/{id}/pdf`، إلغاء/استعادة، `GET /verify/certificate/{token}` عام. QR أعلى يسار الشهادة + رقمها. صورة الخريج تُطبع في إطارها إن وُجدت. إزالة تكرار "كلية كلية".
  - Frontend: زر شريط أخضر (ribbon) لكل خريج في `alumni.tsx` → نافذة (تقدير معبأ من honors + تاريخ الميلادي) → إصدار وتنزيل PDF. صفحة `verify-certificate.tsx` عامة مسجلة في `_layout.tsx` (VERIFY_PATHS + Stack.Screen).
  - اختبار E2E: إصدار عبر API (1/2026، هجري 1446/12/19) + PDF 1MB + تحقق عام valid + معاينة بصرية كاملة للشهادة + لقطات شاشة (صفحة التحقق + نافذة الإصدار بالمتصفح) ✔️. ⚠️ يتطلب النشر للإنتاج.

- **(2026-08-01) إصلاح: فشل الإصدار الجماعي للإفادات في الإنتاج**:
  - السبب الجذري: طلاب ببيانات قديمة/مستوردة لديهم `department_id` غير صالح (ليس ObjectId) → `ObjectId()` يرمي استثناء → 500 → "فشل إصدار الإفادات". (البطاقات لم تتأثر لأن `_resolve_faculty` محمية أصلاً).
  - الإصلاح: `_safe_dept` في statements.py + حماية lookups الكلية + رسالة عربية واضحة باسم الطالب عند أي فشل فردي، ونفس الحماية في certificates.py.
  - أُعيد إنتاج الخطأ في المعاينة بطالب بقسم تالف (500) ثم التحقق بعد الإصلاح (200، صفحتان). ⚠️ يتطلب إعادة النشر للإنتاج.

- **(2026-08-01) إصلاح: شهادة التخرج تظهر مربعات (tofu) في الإنتاج**:
  - السبب الجذري: المعاينة فيها Pillow مع raqm (تشكيل OpenType) بينما الإنتاج بدونها → المسار البديل arabic_reshaper يحتاج Presentation Forms وخط Aref Ruqaa لا يحتويها → مربعات.
  - الحل الجذري: رسم نصوص الشهادة عبر HarfBuzz + FreeType (`_hb_draw`/`_hb_width` في certificates.py) — تشكيل مستقل تماماً عن البيئة (uharfbuzz==0.55.0, freetype-py==2.5.1 في requirements.txt، wheels ذاتية بلا system deps). الأرقام/التواريخ تُعكس مسبقاً لأن hb يعكس RTL بصرياً.
  - البطاقات والإفادات غير متأثرة (Amiri فيها Presentation Forms).
  - اختبار: توليد الشهادة كاملة بمعاينة بصرية (كل النصوص مشكّلة والتواريخ بترتيب صحيح) + API pdf 200 ✔️. ⚠️ يتطلب إعادة النشر للإنتاج.

- **(2026-08-01) السبب الجذري النهائي لفشل شهادة التخرج في الإنتاج**:
  - رسالة الإنتاج التفصيلية: `ModuleNotFoundError: No module named 'uharfbuzz'`.
  - الاكتشاف: إنتاج الخادم على Railway يُبنى من `/app/backend/Dockerfile` الذي يستخدم **`/app/backend/backend/requirements.txt` (الداخلي)** — كانت المكتبات الجديدة تُضاف للملف الخارجي فقط.
  - الإصلاح: مزامنة الملف الداخلي (pypdf, uharfbuzz, freetype-py, xlrd) + تسجيل القاعدة في `/app/memory/deployment_learnings.md`: أي مكتبة جديدة تضاف للملفين معاً.
  - تحسين إظهار الأخطاء: نافذة إصدار الشهادة تعرض الآن الخطأ التفصيلي (شمل رقم الشهادة الصادرة إن فشل التنزيل فقط). ⚠️ يتطلب حفظ إلى GitHub وإعادة نشر Railway.

- **(2026-08-06) المحاضرات المشتركة بين المستويات/الشعب (merge groups)**:
  - المفهوم: محاضرة واحدة (مقرر/مدرس/قاعة/وقت موحد) تُنشأ كوثيقة لكل هدف (مستوى، شعبة) مع `merge_group_id` موحد و`merge_key` مميز لكل عضو.
  - Backend `weekly_schedule.py`: `merge_with` في POST (إنشاء جماعي + فحص تعارض شعبة لكل هدف)، PUT (مقرر/مدرس/قاعة تسري على المجموعة + استثناء المجموعة من فحوصات الانشغال)، DELETE (حذف المجموعة كلها + مزامنة المحاضرات المستقبلية)، move-slot وswap-slots (المجموعة تتحرك/تتبدل معاً)، `_check_slot_placement` يستثني نفس المجموعة، endpoint التعارضات يحسب المجموعة كواحدة، GET والعرض الشامل يرجعان `merged_with` (شارات "مشتركة مع...").
  - **الفهارس الفريدة (server.py)**: uniq_teacher_day_slot وuniq_room_day_slot أعيد بناؤهما بإضافة `merge_key` (فارغ للعادية = حماية كاملة، مميز لأعضاء المجموعة = تعايش). التنظيف التلقائي عند الإقلاع يستثني الوثائق المشتركة.
  - **Excel**: عمود اختياري "مشترك مع المستويات" (يقبل 3 أو 3+4 أو 3،4) في استيراد المقررات → `shared_levels` على المقرر، والنموذج القابل للتنزيل مُحدَّث. عند اختيار المقرر في نافذة الإضافة تُحدد المستويات المشتركة تلقائياً.
  - **Frontend**: صندوق أخضر في نافذة "إضافة يدوية" (chips م1..م8 + حقل شعب من نفس المستوى) + شارة 🔗 "مشتركة مع: ..." في الجدول العادي والعرض الشامل.
  - **التحضير**: يبقى منفصلاً لكل مستوى (قرار المستخدم — لا تغيير).
  - اختبار E2E: إنشاء مشترك (3 مستويات) ✔️ تعارض خارجي مرفوض ✔️ endpoint التعارضات = 0 ✔️ نقل جماعي ✔️ حذف جماعي ✔️ استيراد Excel بالعمود الجديد + النموذج ✔️ لقطة شاشة للنافذة والصندوق ✔️. ⚠️ يتطلب النشر للإنتاج (تنبيه: الإنتاج على Railway — المتطلبات في الملفين متزامنة).

## 2026-06 (تكملة): الدمج بالنقر في العرض الشامل + الدمج التلقائي في الاستيراد الشامل
- **الدمج بالنقر (Merge on click)**: في وضع التحرير بالعرض الشامل، النقر على محاضرة ثم على محاضرة مطابقة (نفس اسم المقرر ونفس المدرس) يفتح نافذة `merge-confirm-modal` بثلاثة خيارات: 🔗 دمج كمحاضرة مشتركة (A تنضم لموقع/قاعة B) / 🔁 تبديل المكانين فقط / إلغاء.
  - Backend: `POST /api/weekly-schedule/merge-slots` (slot_a_id ينضم إلى slot_b_id، يدعم دمج مجموعات قائمة، فحص تعارضات كامل، مزامنة المحاضرات المستقبلية).
  - Frontend `MasterScheduleView.tsx`: حالة `mergePrompt` + نافذة التأكيد (data-testid: merge-confirm-modal / confirm-merge-btn / swap-instead-btn / cancel-merge-btn).
- **الدمج التلقائي في استيراد الجدول الشامل (`schedule_import.py`)**:
  - نفس المحاضرة (نفس الاسم الأساسي للمقرر + المدرس + القاعة) في نفس اليوم/الفترة لأكثر من مستوى/شعبة في ملف Excel → تُدمج تلقائياً بـ merge_group_id موحد بدل رفضها كتعارض.
  - انضمام خلية الملف لمحاضرة قائمة مطابقة في النظام → تتحول القائمة لمشتركة تلقائياً.
  - مطابقة المقرر تدعم `shared_levels` (مستوى الخلية ضمن المستويات المشتركة للمقرر).
  - أعضاء المجموعة يُحسبون محاضرة واحدة في العبء اليومي للمدرس (الملف + القائم).
  - التقرير: حقلا `merged`/`to_merge` + قسم "🔗 محاضرات مشتركة سيتم دمجها" في نافذة الاستيراد + تلميح في وصف السياسة.
- الاختبار: E2E عبر API (معاينة + تنفيذ + تحقق merge_group_id في DB + تنظيف) ✔️ merge-slots (دمج، انتقال للهدف، merged_with، حذف جماعي) ✔️ لقطة شاشة لنافذة الدمج بالعرض الشامل ✔️

## 2026-06: حذف الرقم المرجعي من بطاقة الطالب
- حُذف "الرقم المرجعي" من تصميم البطاقة والاكتفاء برقم القيد: من مولّد صورة/PDF البطاقة في `student_cards.py` (يسري على القوالب الأربعة والطباعة الجماعية) ومن شاشة البطاقة في موقع الإدارة `student-card.tsx`. حقل `reference_number` ما زال موجوداً في payload لكن لا يُعرض.
- اختبار: تنزيل PDF بطاقة + معاينة الصورة + لقطة شاشة لموقع الإدارة — لا وجود للرقم المرجعي ✔️
- ملاحظة: تطبيق الطالب (student-app) سيُطوَّر بواسطة وكيل آخر — أُعطي المستخدم تعليمات كاملة (رفع صورة معلقة للاعتماد + شاشة بطاقة رقمية بـ QR عبر /students/me/card و /students/me/photo).

## 2026-06: إشعار اعتماد/رفض صورة الطالب
- عند اعتماد المسجل صورة الطالب أو رفضها (`student_cards.py` → approve/reject) يُنشأ إشعار داخل التطبيق للطالب (`db.notifications` بـ user_id — يظهر في `/api/notifications/my` الذي يستخدمه تطبيق الطالب) + محاولة إرسال Push عبر FCM (best-effort).
- الأنواع: `photo_approved` ("✅ تم اعتماد صورتك الشخصية") و`photo_rejected` ("❌ لم يتم اعتماد صورتك الشخصية" مع توجيه لإعادة الرفع). الرفض بدون صورة معلقة لا يرسل إشعاراً.
- اختبار E2E: رفع كطالب → اعتماد → إشعار ✔️ رفع → رفض → إشعار ✔️ رفض بلا معلقة → لا إشعار ✔️ (ونظفت بيانات الاختبار).

## 2026-06: إصلاح عطلي الإنتاج (بلاغ وكيل تطبيق الطالب)
1. **رفع الصورة 500 على api.ahgaff.net**: السبب أن `storage_service` يتطلب `EMERGENT_LLM_KEY` غير موجود على سيرفر الإنتاج. الحل: تخزين احتياطي تلقائي في MongoDB (`db.storage_files`، مسارات ببادئة `dbfs/`) — إذا غاب المفتاح أو فشل التخزين السحابي، تُخزن الملفات في قاعدة البيانات وتُقرأ من `get_object` بنفس الشفافية. لا إعدادات إضافية مطلوبة على الإنتاج.
2. **verify_url مشوّه (http://.ahgaff.net)**: قيمة "رابط التحقق" في إعدادات الإنتاج ناقصة النطاق. الحل: `_sanitize_base_url` في `statements.py` تصلح القيمة عند القراءة (تحذف النقطة البادئة وتفرض https) + تحقق صارم عند الحفظ يرفض الروابط غير الصالحة.
- اختبار: قيمة مشوهة → verify_url أصبح https://ahgaff.net/verify-card ✔️ حفظ قيمة فاسدة مرفوض ✔️ fallback مونغو (رفع + قراءة + خدمة عبر /api/files) ✔️ الرفع العادي بمفتاح Emergent ما زال يعمل ✔️
- ⚠️ يتطلب **نشر الباك اند للإنتاج** ليسري الإصلاحان.

## 2026-06: إصلاح — استيراد المحاضرات المشتركة عبر المستويات المختلفة
- مشكلة المستخدم: كتابة نفس المحاضرة لمستويين (مثل م2 وم3) في الاستيراد كانت تُرفض بـ"المقرر موجود لكن لمستوى مختلفة — تُخُطيت" لأن المطابقة كانت تشترط المستوى الحرفي أو shared_levels.
- الحل في `schedule_import.py`: قبول مقرر من مستوى آخر (`_cross_level`) بشرط أن تكون الخلية جزءاً من محاضرة مشتركة فعلية — إما نظير مطابق في الملف (نفس المدرس/القاعة/اليوم/الفترة) أو محاضرة قائمة مطابقة في النظام. خلية cross-level بدون دمج تُتخطى برسالة توجيهية واضحة، مع إعادة حساب الاستبدالات بعد الإسقاط.
- اختبار E2E: مقرر للمستوى 2 فقط + خليتان م2/م3 بنفس الوقت → دمج بـ merge_group_id موحد ✔️ خلية م3 وحيدة بوقت آخر → تُتخطى برسالة "يخص مستوى آخر — يُقبل فقط كمحاضرة مشتركة" ✔️
- ⚠️ درس مهم مسجل: التعديلات المتوازية (search_replace) على نفس الملف قد تتسابق ويضيع بعضها — عدّل نفس الملف تسلسلياً وتحقق بعد كل دفعة.

## 2026-06: المحاضرات المشتركة بين الأقسام (نفس الكلية)
- **(أ) شارة "مشتركة مع" باسم القسم**: عند اختلاف قسم العضو تظهر "عقيدة — المستوى 5" بدلاً من "المستوى 5" الملتبسة — في GET /weekly-schedule وفي العرض الشامل (master-view). تحميل أسماء أقسام الأعضاء الخارجية عند الحاجة.
- **(ب) الإضافة اليدوية عبر الأقسام**: `MergeTarget` أصبح يدعم `department_id` اختيارياً (فارغ = نفس القسم) مع تحقق أن القسم يتبع نفس الكلية. الواجهة (weekly-schedule.tsx): قائمة "🏛️ مشتركة مع قسم آخر" + رقائق مستويات القسم الآخر (data-testid: merge-dept-select / merge-dept-level-N).
- **إصلاح جذري لصيغة merge_key**: أصبحت `gid:department_id:level:section` في كل المواضع (الإنشاء اليدوي، merge-slots، الاستيراد) — يمنع تصادم الفهرس الفريد عند دمج نفس المستوى/الشعبة من قسمين مختلفين (كان bug كامن).
- اختبار E2E: إنشاء يدوي عبر قسمين ("عبر 2 أقسام") ✔️ شارات باسم القسم في GET والعرض الشامل ✔️ دمج بالنقر لنفس المستوى عبر قسمين (بدون تصادم فهرس) ✔️ حذف جماعي ✔️ لقطة شاشة للواجهة الجديدة ✔️
- ملاحظة مكتشفة: GET /departments?faculty_id لا يفلتر بالكلية فعلياً (أعاد قسماً من كلية أخرى) — الحماية موجودة في الباك اند عند الإنشاء، لكن يُستحسن إصلاح الفلتر لاحقاً (P2).

## 2026-06: دليل قالب الاستيراد يشمل المدرسين متعددي الأقسام
- ورقة "الأدلة" في قالب استيراد الجدول الشامل كانت تعرض أساتذة القسم بالحقل الأساسي department_id فقط. الآن تشمل أيضاً من ينتمي للقسم ضمن department_ids (الانتماء المتعدد) — فيظهر المدرس في دليل قالبي القسمين معاً.
- مطابقة أسماء المدرسين أثناء الاستيراد نفسه لم تكن متأثرة (تبحث في كل المدرسين أصلاً).
- اختبار: مدرس تجريبي بقسمين → ظهر في دليل قالبي القسمين ✔️ (ونُظف بعد الاختبار).

## 2026-06: الإجراءات الجماعية في جدول المعلمين
- Backend: `POST /api/teachers/bulk-action` (actions: activate / deactivate / reset_password / safe_delete / add_department + department_id) — يعيد done/failed برسائل لكل متعذر + قائمة الحسابات المفعلة. و`POST /api/teachers/export-selected` (Excel للمحددين: الرقم الوظيفي، الاسم، البريد، الهاتف، الكلية، الأقسام، حالة الحساب). الحذف الآمن الفردي أُعيدت هيكلته لدالة مشتركة `_do_safe_delete_teacher` يستخدمها الفردي والجماعي (نسخة احتياطية + سلة محذوفات + فك ارتباطات المقررات/الجدول/العبء).
- Frontend (`manage-teachers.tsx`): مربع اختيار لكل صف + "تحديد الكل" في رأس الجدول + شريط سفلي داكن يظهر عند التحديد (عدد المحددين + 6 أزرار) + نافذة تأكيد (مع Picker قسم لإجراء الإضافة) + نافذة نتيجة (حسابات مفعلة/متعذرون). testID لكل العناصر (ملاحظة مسجلة: مكونات RN تحتاج `testID` وليس `data-testid`).
- اختبار: باك اند 7/7 (تفعيل + دخول فعلي، تفعيل مكرر يفشل برسائل، إعادة كلمات مرور، إضافة قسم + تكرار يفشل، إيقاف + دخول يفشل 401، تصدير Excel بصفوف صحيحة، حذف آمن جماعي) ✔️ واجهة: تحديد الكل + الشريط + نافذة التأكيد بلقطة شاشة ✔️

## 2026-06: دعم تعدد الأساتذة للمقرر الواحد في الاستيراد
- مشكلة المستخدم (ملف قسم الشريعة الحقيقي): مقرر "القواعد الفقهية" يُدرّس بأستاذين (د. السقاف محاضرة، أ/ بافضل بقية المحاضرات) — الاستيراد كان يعتبره "تناقض داخل الملف" ويوقف الاستيراد. الملف كان صحيحاً والقصور في النظام.
- الحل في `schedule_import.py`: كل خلية تُسند لأستاذها المكتوب فيها (`cell_tid` + `_explicit_teacher`). مقرر بأكثر من أستاذ في الملف → لا تعارض؛ يُلغى تغيير الإسناد الرسمي للمقرر (يبقى كما هو) وتظهر رسالة معلوماتية "🧑‍🏫 المقرر يُدرّس بأكثر من أستاذ — كل محاضرة تُسند لأستاذها". تغيير الإسناد الرسمي يحدث فقط عندما يوحّد الملف أستاذاً واحداً مختلفاً. الخلايا بلا اسم أستاذ تتبع الإسناد (الرسمي أو الجديد).
- التقرير: حقل `multi_teacher` + قسم بنفسجي في نافذة الاستيراد (MasterScheduleView).
- اختبار E2E: مقرر مسند لأستاذ 1 + ملف بخليتين بأستاذين مختلفين → معاينة بلا تعارضات + رسالة multi_teacher، وبعد التنفيذ كل محاضرة بأستاذها وإسناد المقرر لم يتغير ✔️
- ⚠️ المستخدم يختبر على نسخته المنشورة — يجب إعادة نشر الباك اند ليصل هذا الإصلاح.

## 2026-06: تلميح ذكي لتعارض المعلم في الاستيراد
- تحليل ملف المستخدم الثاني: تعارض القاعة (الاثنين ف2) حقيقي (مقرران مختلفان بنفس القاعة). تعارض المعلم (الأربعاء ف2) سببه محاضرة مشتركة بقاعتين مختلفتين بين الخليتين (خطأ كتابة) فلم تُدمج.
- تحسين: رسالة تعارض المعلم داخل الملف أصبحت تكتشف الحالة (نفس المقرر الأساسي) وتضيف: "💡 يبدو أنها محاضرة مشتركة لكن القاعة مختلفة (X مقابل Y): وحّد اسم القاعة ليتم دمجهما تلقائياً". (seen_teacher أصبح يخزن (gid, item)).
- اختبار: ملف بخليتين لنفس المقرر/الأستاذ/الوقت بقاعتين مختلفتين → التلميح ظهر ✔️

## 2026-06: إصلاح — محاضرات الفصل غير النشط تظهر للمعلمين
- الشكوى: بعد تفعيل الفصل الأول (الفارغ)، ظل المعلمون يرون محاضرات الفصل السابق في التطبيق والجدول اليومي.
- السبب: نقاط `server.py` الفعلية `/lectures/today` و`/lectures/all-schedule` و`/lectures/month` لم تكن تطبق فلتر الفصل النشط (بعكس `/lectures/{course_id}`). ملاحظة معمارية: توجد نسخ مكررة من هذه النقاط في routes/lectures.py لكن نسخ server.py هي المسجلة أولاً وهي الفعالة — عدلت الاثنتين معاً + dashboard/teacher.
- الإصلاحات: تطبيق `apply_lecture_active_sem` من `routes/_active_semester.py` على النقاط الثلاث + dashboard المعلم. تحويل today إلى توقيت اليمن (+3) بدل utcnow. إصلاح خلل قائم: all-schedule كان يستدعي get_user_scope_filter بالنوع الافتراضي "students" بدل "courses" فيُفرغ نتائج المعلم. تحصين created_at بـ .get.
- اختبار E2E: محاضرتان بتاريخ اليوم (واحدة بفصل قديم وواحدة بالفصل النشط) → المعلم والأدمن يريان محاضرة الفصل النشط فقط في today/all-schedule/month ✔️ (نُظفت البيانات)
- ⚠️ يتطلب إعادة نشر الباك اند.

## 2026-08-09 — إصلاح جذري: تسرب محاضرات الفصول المغلقة/المؤرشفة
**جذر المشكلة:** دالة `get_active_semester` في `routes/_active_semester.py` كانت ترجع تواريخ الفصل بصيغتها الخام (D-M-YYYY مثل "20-12-2025") بينما تواريخ المحاضرات نصوص YYYY-MM-DD، فكانت المقارنة النصية في شرط الـ fallback (للمحاضرات القديمة بدون semester_id) تطابق **كل** المحاضرات بغض النظر عن تاريخها.
**الإصلاحات:**
1. `_active_semester.py`: إضافة `normalize_sem_date` وتطبيع تواريخ الفصل النشط دائماً → يصلح كل النقاط المستخدمة لـ `apply_lecture_active_sem` (lectures/today, month, all-schedule, dashboard, entity_details).
2. `server.py /lectures/{course_id}`: تطبيع تواريخ فصل المقرر بـ `normalize_semester_date`.
3. `close_semester` + `activate_semester`: ختم محاضرات الفصل المُغلق بـ `semester_id` تلقائياً (دالة `stamp_lectures_with_semester`) لمنع أي تسرب مستقبلي.
4. `routes/dashboard.py /dashboard/teacher`: كان معطلاً كلياً (يستعلم بـ teacher_id غير موجود في المحاضرات + تواريخ datetime مقابل نصوص) — أُصلح ليجلب عبر مقررات المعلم وبتواريخ نصية + توقيت اليمن، مع إثراء أسماء المقررات.
5. أداة `backfill-lecture-semesters` (preview + execute): أُضيفت مرحلة إسناد عبر مقرر المحاضرة (الأدق) قبل الإسناد بنطاق التاريخ.
**الاختبار:** سيناريو محاكٍ للإنتاج (معلم 9999 لديه مقررات بفصول متعددة + محاضرات قديمة بدون semester_id) — قبل/بعد عبر curl على /lectures/today و/lectures/month و/dashboard/teacher — كله ناجح، وقاعدة البيانات المحلية نُظفت (0 محاضرات بدون semester_id).
**ملاحظة للإنتاج:** يجب تنفيذ أداة الترحيل مرة واحدة من شاشة الأدمن (backfill-lecture-semesters) بعد نشر التحديث لختم المحاضرات القديمة.

## 2026-08-09 (تكملة) — ميزة معالجة المحاضرات اليتيمة
بعد تنفيذ المستخدم للترحيل في الإنتاج بقيت 6 محاضرات "خارج نطاق أي فصل" (بلا فصل + مقررها بلا فصل + تاريخها خارج كل النطاقات).
**أُضيف:**
- `GET /api/admin/backfill-lecture-semesters/unmatched`: تفاصيل المحاضرات اليتيمة (المقرر، التاريخ، الوقت، القاعة) + قائمة الفصول.
- `POST /api/admin/backfill-lecture-semesters/resolve`: إسناد يدوي لفصل محدد (action=assign) أو حذف نهائي (action=delete).
- الواجهة (backfill-lecture-semesters.tsx): زر "عرض المحاضرات اليتيمة" + قائمة تفصيلية + أزرار "إسناد الكل إلى: {فصل}" و"حذف الكل نهائياً" مع تأكيد.
**الاختبار:** testing_agent (iteration_61) — Backend 100% (10 pytest)، Frontend كامل التدفق ناجح. أُصلح خلل مسح رسالة النجاح (setResultMsg بعد fetchPreview).

## 2026-08-09 (3) — إصلاح: تقرير العبء الأكاديمي لا يحسب ساعات المقررات
**جذر المشكلة:** صفوف التقرير تُقرأ من `teaching_loads.weekly_hours`. مسارات إنشاء العبء (weekly_schedule cascade + schedule_import) كانت تستخدم `course.get("credit_hours", 3)` فتُنشئ سجلات بساعات 0/None عندما تكون ساعات المقرر صفرية أو مفقودة، والمزامنة التلقائية كانت تنشئ السجلات الناقصة فقط دون إصلاح الصفرية الموجودة.
**الإصلاحات:**
1. `_sync_teaching_loads_for_teachers` (تعمل تلقائياً قبل كل تقرير): أُضيفت معالجة ذاتية — أي سجل بساعات 0/None يُعاد حسابه من المقرر (weekly_hours → credit_hours → 3) ويُوسم `auto_healed`.
2. مسارات الإنشاء في weekly_schedule.py وschedule_import.py: `weekly_hours or credit_hours or 3`.
3. server.py (توليد مقررات عند تفعيل الفصل): `credit_hours or 3` + نسخ `weekly_hours` من الخطة.
**الاختبار:** curl — سجلات 0 ساعة عولجت تلقائياً عند فتح التقرير (5 ساعات، 41.7%).
**ملاحظة:** الإصلاح ذاتي في الإنتاج بمجرد فتح التقرير بعد النشر (لا يعمل على الفصول المؤرشفة). إن كانت ساعات المقرر نفسه غير معرفة تُستخدم 3 افتراضياً.

## 2026-08-09 (4) — إصلاح: اختفاء أسماء المقررات من العرض الشامل والجدول الأسبوعي
**جذر المشكلة:** أرشفة الفصل تحذف مقررات الفصل من `courses`، بينما خلايا `weekly_schedule` تشير للمقررات بالـ ID (الجدول غير مرتبط بفصل) → بقيت الخلايا (معلم+قاعة) واختفت أسماء المقررات. **خطر إضافي اكتُشف:** زر "فحص التكامل → إصلاح" القديم كان سيحذف كل هذه الخلايا (orphan_course → delete_slot).
**الإصلاحات:**
1. ملف جديد `routes/_schedule_repair.py`: `archived_courses_info` (جلب أسماء المقررات من snapshots الأرشيف) + `relink_weekly_schedule_courses` (إعادة ربط الخلايا بالمقرر المكافئ في الفصل النشط عبر الكود/الاسم+الشعبة+القسم).
2. GET /weekly-schedule و master-view: fallback تلقائي لأسماء المقررات المؤرشفة — الأسماء تظهر فوراً حتى قبل إعادة الربط.
3. `schedule_integrity.py`: نوعان جديدان — `archived_course_relink` (قابل للإصلاح: إعادة ربط بدل حذف) و`archived_course_unmatched` (يدوي: رحّل المقررات أولاً). الحذف فقط للمقررات غير الموجودة حتى في الأرشيف.
4. `archive_semester`: يستدعي إعادة الربط تلقائياً بعد الأرشفة (وقاية مستقبلية).
**الاختبار:** curl e2e — أرشيف مزيف + خليتان يتيمتان: الأسماء ظهرت من الأرشيف في الاثنين، الفحص صنّف صح، الإصلاح أعاد الربط للمقرر الحقيقي. نُظفت بيانات الاختبار.
**⚠️ تحذير للإنتاج:** يجب نشر التحديث قبل الضغط على "فحص التكامل → إصلاح" — النسخة القديمة ستحذف الخلايا اليتيمة!

## 2026-08-09 (5) — تحسينات شاشة إدارة المعلمين (الإجراءات الجماعية)
1. شريط الإجراءات الجماعية: كان absolute فيظهر منتصف الصفحة على الويب → أصبح position:fixed أسفل الـ viewport (متحقق منه بـ Playwright، gap=0px).
2. زر جديد "تصدير PDF" للمحدد بجانب Excel: endpoint جديد POST /api/teachers/export-selected/pdf (reportlab + Amiri، عربي سليم landscape) — pytest 5/5 (200 %PDF، 400 لقائمة فارغة، 403 بدون صلاحية) + regression للـ Excel ناجح.
3. خلل اكتشفه وكيل الاختبار (iteration_62): تعديل exportSelected(format) لم يثبت في الملف (انعكس) بينما ثبت الزران — أُعيد تطبيقه وتم التحقق بـ grep (السطر 128 و132).
**ملاحظة أتمتة:** شاشة manage-teachers لا تعلق — تعرض "اختر فلتراً لعرض المعلمين" حتى اختيار قسم/بحث + "تطبيق الفلتر". أداة اللقطات لدى الوكيل الرئيسي تفشل مع هذه الشاشة؛ استخدم testing_agent لأي تحقق مستقبلي عليها.

## 2026-08-09 (6) — إصلاح: محاضرات مولدة بتوقيت 23:30 مساءً بدل 11:30 صباحاً
**السبب:** توليد المحاضرات من الجدول ينسخ أوقات الفترات من `schedule_settings` حرفياً — وفي الإنتاج فترة 11:30-13:00 مخزنة 23:30-01:00 (اختيار «م» بدل «ص» في إعدادات الفترات).
**الإصلاحات:**
1. endpoint جديد `POST /weekly-schedule/resync-lecture-times` (dry_run + execute): يعيد مزامنة أوقات كل المحاضرات المولدة (generated_from_schedule) مع أوقات الفترات الحالية، مع أنماط التغيير في المعاينة.
2. واجهة: زر "🕑 مزامنة أوقات المحاضرات المولدة" داخل مودال توليد المحاضرات (data-testid=resync-lecture-times-btn) مع تأكيد يعرض الأنماط.
3. وقاية: معاينة التوليد تعرض الآن `slot_times_used` وتحذّر بالأحمر من التوقيتات الليلية (h>=19 أو h<6) قبل التوليد.
4. bonus: المحاضرات المولدة أصبحت تحمل `semester_id` من مقررها (كانت تُنشأ بدونه — نفس عائلة مشكلة التسريب).
**الاختبار:** curl e2e كامل — توليد بأوقات خاطئة → تصحيح الإعدادات → resync (معاينة: نمط 23:30-01:00 ← 11:30-13:00 لـ9 محاضرات) → تنفيذ → 0 خاطئة. نُظفت بيانات الاختبار.
**خطوات المستخدم في الإنتاج:** 1) تصحيح الفترة في إعدادات الفترات الزمنية (11:30 ص - 1:00 م). 2) فتح مودال "توليد المحاضرات" والضغط على زر المزامنة.

## 2026-08-09 (7) — التوقيع اليدوي في كليشة الإفادة
**الطلب:** بعض الكليات يوقّع المسجل وبعضها العميد — إدخال يدوي للاسم والصفة.
**التنفيذ:**
- Backend (statements.py): `signatory_name` + `signatory_title` اختياريان في IssueRequest وBulkIssueRequest، يُخزنان على وثيقة الإفادة (إعادة التنزيل تحافظ عليهما). fallback: إعدادات الكلية (signatory_title جديد في StatementSettings افتراضي "مسجل الكلية" + registrar_name) ثم "مسجل الكلية".
- الواجهة: حقلا "صفة الموقّع" و"اسم الموقّع" في مودال إصدار الإفادة (student-details.tsx) والإصدار الجماعي (students.tsx)، وحقل الصفة الافتراضية في statement-settings.tsx.
**الاختبار:** curl + extract_file — إصدار بتوقيع "عميد الكلية / د. عبدالله عوض بافقيه" ظهر حرفياً في PDF، والافتراضي "مسجل الكلية" يعمل عند ترك الحقول فارغة. نُظفت إفادات الاختبار.

## 2026-08-09 (8) — صورة التوقيع/الختم في الإفادة
- StatementSettings: حقل `signature_base64` (data URL) لكل كلية.
- `_build_pdf`: تُرسم الصورة (38×15mm، mask=auto لدعم الشفافية) بين صفة الموقّع والاسم، وينزل الاسم تلقائياً عند وجودها.
- statement-settings.tsx: قسم رفع "صورة التوقيع/ختم الكلية" (حد 2MB، معاينة، إزالة) — دالة pickImage عامة تخدم الشعار والتوقيع.
**الاختبار:** إنشاء PNG توقيع تجريبي → حفظ بالإعدادات → إصدار إفادة → التحقق بصرياً عبر analyze_file: الصورة ظهرت بين "عميد الكلية" والاسم. نُظفت بيانات الاختبار.

## 2026-08-10 — إصلاح: حقول شاشة إعدادات الإفادة تقبل حرفاً واحداً
**السبب:** مكوّن Field معرف داخل StatementSettingsScreen → يُعاد إنشاؤه كل render → TextInput يُفكك ويفقد التركيز بعد أول حرف.
**الإصلاح:** نُقل Field إلى مستوى الملف (module level).
**الاختبار:** testing_agent (iteration_63) — 4/4: كتابة متواصلة في 3 حقول + الحفظ والاستمرارية بعد إعادة التحميل. ✅
**ملاحظة أتمتة:** تسجيل الدخول عبر الواجهة الفعلية (Enter لا يُرسل النموذج — يجب النقر على "تسجيل الدخول").

## 2026-08-10 (2) — إصلاح: مقررات القسم القديم تبقى مع الطالب بعد نقله
**السببان:**
1. تعديل الطالب العادي (PUT /students/{id} في server.py وroutes/students.py): تغيير القسم لا يحذف أي enrollments.
2. أداة النقل (_perform_transfer): تحذف فقط enrollments الموسومة بمعرف الفصل النشط — القديمة بـ semester_id=None لا تُحذف، و/students/{id}/courses يجلب كل التسجيلات ويفلتر بفصل المقرر فتظهر مقررات القسم القديم.
**الإصلاح:** دالة موحدة `cleanup_active_enrollments` في routes/student_transfer.py:
- تحذف enrollments الفصل النشط الموسومة + القديمة بلا semester_id إذا كان مقررها في الفصل النشط أو محذوفاً.
- تحافظ على تسجيلات الفصول المغلقة (تاريخ أكاديمي).
- تُستدعى في: _perform_transfer + PUT /students في server.py (مع مزامنة قسم حساب المستخدم) + routes/students.py — عند تغيّر القسم أو المستوى.
**الاختبار:** curl e2e — 3 تسجيلات (نشط موسوم + قديم بمقرر نشط + قديم بمقرر فصل مغلق): بعد تغيير القسم بقي تسجيل الفصل المغلق فقط، /students/{id}/courses أصبح 0. نفس النتيجة عبر أداة النقل. نُظفت بيانات الاختبار.
**ملاحظة:** الطلاب المنقولون سابقاً في الإنتاج ما زالوا يحملون تسجيلات قديمة — يُنظَّفون بإعادة نقلهم أو تعديل قسمهم/مستواهم، أو نبني أداة تنظيف جماعية لاحقاً.

## 2026-08-10 (3) — ميزة: تغيير قاعة خانة موجودة في العرض الشامل
**الملاحظة:** لم تكن توجد أي واجهة لتغيير قاعة خانة قائمة في الجدول (فقط حذف وإعادة إضافة). تغيير قاعة محاضرة واحدة موجود مسبقاً في شاشة محاضرات المقرر (⋮ → تغيير القاعة).
**التنفيذ (MasterScheduleView.tsx):** في وضع التحرير، تحديد محاضرة يُظهر زر "تغيير القاعة" (master-change-room-btn) → نافذة (master-room-modal) تعرض القاعات الفارغة فقط في ذلك الوقت (GET /weekly-schedule/free-rooms) + خيار بدون قاعة + تنبيه للمحاضرات المشتركة (القاعة تسري على المجموعة عبر PUT /weekly-schedule/{slot_id} الموجود مسبقاً بكشف التعارض).
**الاختبار:** testing_agent (iteration_64) — 6/6 بما فيها الاستمرارية بعد إعادة التحميل وregression للنقل. أُصلحت ملاحظة UX: القائمة تبدأ الآن بالقاعة الحالية بدل "بدون قاعة".
**ملاحظة مسجلة من الوكيل:** تحذير console "Unexpected text node" في شاشة weekly-schedule (غير مؤثر — backlog).

## 2026-08-12 — ميزة: جدول القاعة الأسبوعي (Room Schedule View)
- في /weekly-schedule ← تبويب القاعات ← زر "📅 جدول القاعة" لكل قاعة (room-schedule-btn-{id}).
- نافذة (room-schedule-modal): شبكة أيام × فترات، الخلايا المشغولة برتقالية (مقرر + معلم + قسم/مستوى/شعبة، مع dedupe للمحاضرات المشتركة 🔗)، الفارغة خضراء "✓ فارغة"، وملخص مشغولة/فارغة أسبوعياً.
- Backend: أعيد استخدام GET /weekly-schedule?room_id=X الموجود (لا endpoints جديدة).
**الاختبار:** testing_agent (iteration_65) — 5/5. أُصلحت ملاحظة overlay z-index (99999).
**Backlog من الوكيل:** تقسيم weekly-schedule.tsx (2221 سطراً) لمكونات + data-testid للتبويبات + حالة خطأ في openRoomSchedule بدل catch الصامت.

## 2026-08-12 (2) — ميزة: تصدير جداول كل الأساتذة (PDF/Excel) + بحث المعلم في التصدير
1. Backend: باراميتر `per_teacher=true` في export-visual/pdf وexport-visual/excel — يجمع الخانات حسب الأستاذ: PDF صفحة لكل أستاذ (عنوان باسمه + جدول بنمط التصدير الفردي، اسم الأستاذ محذوف من الخلايا suppress_teacher)، Excel ورقة لكل أستاذ. يحترم فلتر faculty_id/department_id. الخانات بلا أستاذ تظهر تحت "بدون أستاذ".
2. Frontend (weekly-schedule.tsx): نطاق جديد "👥 كل الأساتذة (جدول لكل أستاذ)" (export-scope-all_teachers) + حقل بحث فوري للمعلم في نطاق "معلم محدد" (export-teacher-search يفلتر export-teacher-select).
**الاختبار:** curl — PDF (3 صفحات، صفحة لكل أستاذ، تحقق محتوى عبر extract_file) + Excel (ورقة لكل أستاذ) + regression للتصدير العادي 200. ملاحظة: أثناء التعديل انعكس تعديل توقيع make_table (نفس ظاهرة manage-teachers) — أعيد تطبيقه؛ انتبه لهذه الظاهرة عند التعديلات المتوازية على نفس الملف.

## 2026-08-12 (3) — ميزة: مدة مخصصة لكل خانة في الجدول (الخيار a)
**المشكلة:** التوليد من العرض الشامل يلتزم بأوقات الفترات الثابتة بينما مدد المحاضرات تختلف (ساعة/ساعة ونصف/ساعتين).
**التنفيذ:**
- Backend: حقل `duration_minutes` اختياري في weekly_schedule (ScheduleSlotCreate/Update) + دالة `_add_minutes`. التوليد: end_time = بداية الفترة + المدة (إن وُجدت) وإلا نهاية الفترة. resync-lecture-times يحترم المدة أيضاً. PUT: duration_minutes=0 يزيلها ($unset)، وتسري على مجموعة المحاضرة المشتركة. master-view entries ترجع duration_minutes.
- Frontend (MasterScheduleView): قائمة "⏱ مدة المحاضرة عند التوليد" (حسب الفترة/45/60/90/120/180) في نافذة الإضافة (add-duration-select) ونافذة "تغيير القاعة والمدة" (master-duration-select) + شارة ⏱Xد في الخلية.
**الاختبار:** curl e2e — خانة بمدة 120: المحاضرة المولدة 08:00-10:00 بدل 09:30 ✓، PUT تعديل 60 وإزالة (0) ✓. tsc نظيف. الواجهة selects بسيطة على نفس أنماط النوافذ المختبرة سابقاً (iteration_64).

## 2026-08-12 (4) — المدة المخصصة في استيراد Excel
- صيغة في خلية المقرر: "اسم المقرر (90د)" أو "(120)" أو "[60]" — نطاق 30-300 دقيقة (خارجه تُتجاهل).
- schedule_import.py: `_extract_duration` تفصل المدة عن الاسم قبل المطابقة، وتُخزن duration_minutes على الخانة، ومقارنة "المطابقة بلا تغيير" تشمل المدة (تغيير المدة وحده = استبدال).
- القالب المصدَّر (import-template) يكتب المدة في الخلية إن وُجدت — دورة تصدير→تعديل→استيراد كاملة.
**الاختبار:** curl e2e — قالب حقيقي + "(90د)": الاستيراد استبدل الخلية بـduration_minutes=90 والقالب المعاد تنزيله أظهر "(90د)". أعيدت البيانات.
