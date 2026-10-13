"""
نماذج الصلاحيات - Permissions Models
"""
from typing import List

class UserRole:
    ADMIN = "admin"
    TEACHER = "teacher"
    STUDENT = "student"
    EMPLOYEE = "employee"
    DEAN = "dean"
    DEPARTMENT_HEAD = "department_head"
    REGISTRAR = "registrar"
    REGISTRATION_MANAGER = "registration_manager"
    UNIVERSITY_PRESIDENT = "university_president"  # 🏛️ اطلاع فقط على مستوى الجامعة كلها

class Permission:
    # 📊 لوحة القيادة (الأرقام العامة تظهر لكل إداري؛ الأجزاء التالية حسب الصلاحية)
    DASHBOARD_ALERTS = "dashboard_alerts"
    DASHBOARD_ATTENDANCE = "dashboard_attendance"
    DASHBOARD_TEACHERS = "dashboard_teachers"
    DASHBOARD_STUDENTS = "dashboard_students"
    DASHBOARD_ROOMS = "dashboard_rooms"
    DASHBOARD_FINANCE = "dashboard_finance"
    DASHBOARD_HR = "dashboard_hr"
    DASHBOARD_EXPORT = "dashboard_export"

    # صلاحيات الأقسام
    MANAGE_DEPARTMENTS = "manage_departments"
    VIEW_DEPARTMENTS = "view_departments"
    ADD_DEPARTMENT = "add_department"
    EDIT_DEPARTMENT = "edit_department"
    DELETE_DEPARTMENT = "delete_department"
    
    # صلاحيات المقررات
    MANAGE_COURSES = "manage_courses"
    VIEW_COURSES = "view_courses"
    ADD_COURSE = "add_course"
    EDIT_COURSE = "edit_course"
    DELETE_COURSE = "delete_course"
    
    # صلاحيات الطلاب
    MANAGE_STUDENTS = "manage_students"
    VIEW_STUDENTS = "view_students"
    ADD_STUDENT = "add_student"
    EDIT_STUDENT = "edit_student"
    DELETE_STUDENT = "delete_student"
    IMPORT_STUDENTS = "import_students"
    
    # صلاحيات المعلمين
    MANAGE_TEACHERS = "manage_teachers"
    VIEW_TEACHERS = "view_teachers"
    ADD_TEACHER = "add_teacher"
    EDIT_TEACHER = "edit_teacher"
    DELETE_TEACHER = "delete_teacher"
    
    # صلاحيات المستخدمين
    MANAGE_USERS = "manage_users"
    VIEW_USERS = "view_users"
    ADD_USER = "add_user"
    EDIT_USER = "edit_user"
    DELETE_USER = "delete_user"
    RESET_PASSWORD = "reset_password"
    
    # صلاحيات الكليات
    MANAGE_FACULTIES = "manage_faculties"
    VIEW_FACULTIES = "view_faculties"
    ADD_FACULTY = "add_faculty"
    EDIT_FACULTY = "edit_faculty"
    DELETE_FACULTY = "delete_faculty"
    
    # صلاحيات المحاضرات
    MANAGE_LECTURES = "manage_lectures"
    VIEW_LECTURES = "view_lectures"
    ADD_LECTURE = "add_lecture"
    EDIT_LECTURE = "edit_lecture"
    DELETE_LECTURE = "delete_lecture"
    OVERRIDE_LECTURE_STATUS = "override_lecture_status"
    RESCHEDULE_LECTURE = "reschedule_lecture"
    GENERATE_LECTURES = "generate_lectures"

    # صلاحيات الجداول الدراسية (اليومي/الأسبوعي)
    VIEW_SCHEDULE = "view_schedule"
    MANAGE_SCHEDULE = "manage_schedule"
    SHIFT_DAY = "shift_day"  # ⏰ إزاحة اليوم الدراسي (تأخير/تقديم بداية اليوم)

    # 🏢 شؤون الموظفين
    HR_VIEW_EMPLOYEES = "hr_view_employees"
    HR_MANAGE_EMPLOYEES = "hr_manage_employees"
    HR_MANAGE_ORG = "hr_manage_org"
    HR_MANAGE_LEAVES = "hr_manage_leaves"
    HR_MANAGE_ATTENDANCE = "hr_manage_attendance"
    HR_MANAGE_WORK_SETTINGS = "hr_manage_work_settings"
    HR_MANAGE_LEAVE_SETTINGS = "hr_manage_leave_settings"
    HR_MANAGE_CORRESPONDENCE = "hr_manage_correspondence"
    HR_MANAGE_TASKS = "hr_manage_tasks"
    HR_MANAGE_APPRAISALS = "hr_manage_appraisals"
    
    # صلاحيات التسجيل
    MANAGE_ENROLLMENTS = "manage_enrollments"
    VIEW_ENROLLMENTS = "view_enrollments"
    ADD_ENROLLMENT = "add_enrollment"
    DELETE_ENROLLMENT = "delete_enrollment"
    
    # صلاحيات الحضور
    MANAGE_ATTENDANCE = "manage_attendance"
    RECORD_ATTENDANCE = "record_attendance"
    TAKE_ATTENDANCE = "take_attendance"
    VIEW_ATTENDANCE = "view_attendance"
    EDIT_ATTENDANCE = "edit_attendance"
    APPROVE_ATTENDANCE_CHANGES = "approve_attendance_changes"  # اعتماد تعديلات الحضور خارج المهلة
    
    # صلاحيات الإشعارات
    SEND_NOTIFICATIONS = "send_notifications"
    MANAGE_NOTIFICATIONS = "manage_notifications"
    
    # صلاحيات التقارير العامة
    VIEW_REPORTS = "view_reports"
    VIEW_STATISTICS = "view_statistics"
    EXPORT_REPORTS = "export_reports"
    IMPORT_DATA = "import_data"
    
    # صلاحيات التقارير الفردية
    REPORT_ATTENDANCE_OVERVIEW = "report_attendance_overview"
    REPORT_ABSENT_STUDENTS = "report_absent_students"
    REPORT_WARNINGS = "report_warnings"
    REPORT_DAILY = "report_daily"
    # 💰 الصلاحيات المالية
    MANAGE_FEE_RECEIPTS = "manage_fee_receipts"
    REPORT_STUDENT = "report_student"
    REPORT_COURSE = "report_course"
    REPORT_TEACHER_WORKLOAD = "report_teacher_workload"
    REPORT_LESSON_COMPLETION = "report_lesson_completion"
    
    # صلاحيات الأدوار والإعدادات
    MANAGE_ROLES = "manage_roles"
    MANAGE_SETTINGS = "manage_settings"
    MANAGE_SEMESTERS = "manage_semesters"
    # ترحيل مقررات فصل سابق إلى فصل جديد
    MIGRATE_COURSES = "migrate_courses"
    
    # صلاحيات العبء التدريسي
    MANAGE_TEACHING_LOAD = "manage_teaching_load"
    VIEW_TEACHING_LOAD = "view_teaching_load"
    # 🌐 صلاحية خاصة: تسمح للمستخدم برؤية أساتذة ومقررات من خارج كليته
    # فقط لغرض الإسناد (لا تكشف بيانات أخرى)
    CROSS_UNIVERSITY_ASSIGNMENT = "cross_university_assignment"
    
    # صلاحيات الأرشيف
    VIEW_ARCHIVE = "view_archive"
    SEARCH_ARCHIVE = "search_archive"
    EXPORT_ARCHIVE = "export_archive"

    # صلاحيات الخطة الدراسية
    MANAGE_CURRICULUM = "manage_curriculum"    # الوصول الكامل لصفحة الخطة الدراسية (إنشاء/تعديل/حذف)
    VIEW_CURRICULUM = "view_curriculum"        # عرض الخطة الدراسية فقط (قراءة، تصدير)

    # ✉️ الخطابات الرسمية
    ISSUE_LETTERS = "issue_letters"                    # إصدار الخطابات الرسمية (السجل حسب النطاق)
    MANAGE_LETTER_SETTINGS = "manage_letter_settings"  # كليشة وقوالب الخطابات
    MANAGE_STUDENT_EXCUSES = "manage_student_excuses"
    USE_ASSISTANT = "use_assistant"  # 🤖 استخدام مرشد الأحقاف (المساعد الإرشادي)  # 📄 مراجعة أعذار غياب الطلاب والبت فيها (حسب مسار التوجيه)

    # ====== 🧩 صلاحيات إدارية مفصّلة (كل مهمة إدارية لها صلاحية مستقلة قابلة للإسناد الفردي) ======
    # 🏛️ الهيكل الأكاديمي
    MANAGE_INSTITUTION = "manage_institution"          # بيانات الجامعة/المؤسسة
    MANAGE_ACADEMIC_YEARS = "manage_academic_years"    # السنوات الأكاديمية
    MANAGE_ROOMS = "manage_rooms"                      # القاعات
    MANAGE_CALENDAR = "manage_calendar"                # التقويم الجامعي والعطل
    # 👥 الطلاب — عمليات متقدمة
    STUDENTS_SAFE_DELETE = "students_safe_delete"      # الحذف الآمن/الاستعادة/النسخة الاحتياطية
    STUDENTS_TOGGLE_ACTIVE = "students_toggle_active"  # تفعيل/تعطيل طالب
    STUDENTS_BULK_OPS = "students_bulk_ops"            # العمليات الجماعية (مستوى/جنس/تفعيل)
    STUDENTS_RESET_PASSWORD = "students_reset_password"
    STUDENTS_EXCLUDE_COURSE = "students_exclude_course"
    STUDENTS_MANAGE_STATUS = "students_manage_status"  # حالة الطالب (انقطاع/فصل/تحويل)
    VIEW_STUDENT_NOTIFICATIONS = "view_student_notifications"
    DELETE_STUDENT_NOTIFICATIONS = "delete_student_notifications"
    # 👨‍🏫 المعلمون — عمليات متقدمة
    TEACHERS_SAFE_DELETE = "teachers_safe_delete"
    TEACHERS_TOGGLE_ACTIVE = "teachers_toggle_active"
    TEACHERS_RESET_PASSWORD = "teachers_reset_password"
    TEACHERS_BULK_OPS = "teachers_bulk_ops"
    TEACHERS_EXPORT = "teachers_export"
    REPORT_TEACHER_ATTENDANCE = "report_teacher_attendance"
    # 📚 المقررات والتسجيل
    COURSES_CLONE_SECTION = "courses_clone_section"
    ENROLLMENTS_AUTO = "enrollments_auto"              # التسجيل الآلي ومزامنة التسجيلات
    ENROLLMENTS_BULK = "enrollments_bulk"              # نسخ/نقل تسجيلات جماعي
    LECTURES_REASSIGN_HISTORY = "lectures_reassign_history"
    LECTURES_PURGE = "lectures_purge"
    # 📥 الاستيراد والتصدير
    EXPORT_STUDENTS = "export_students"
    # 👤 المستخدمون
    MANAGE_USER_PERMISSIONS = "manage_user_permissions"
    USERS_TOGGLE_ACTIVE = "users_toggle_active"
    # 🗂️ السجلات والمحذوفات
    VIEW_ACTIVITY_LOGS = "view_activity_logs"
    DELETE_ACTIVITY_LOGS = "delete_activity_logs"
    MANAGE_TRASH = "manage_trash"                      # عرض/استعادة
    PURGE_TRASH = "purge_trash"                        # حذف نهائي
    # 🛠️ أدوات الصيانة
    SYSTEM_DIAGNOSTICS = "system_diagnostics"          # معاينة التشخيصات فقط
    SYSTEM_TOOLS = "system_tools"                      # تنفيذ أدوات الإصلاح (مهندس نظام)
    # 💰 المالية والشهادات
    VIEW_FEE_RECEIPTS = "view_fee_receipts"
    ISSUE_STATEMENTS = "issue_statements"
    # 🏢 شؤون الموظفين — تفصيل أدق
    HR_APPROVE_PHOTOS = "hr_approve_photos"
    HR_PRINT_CARDS = "hr_print_cards"
    HR_MANAGE_LOCATIONS = "hr_manage_locations"

# الصلاحيات الافتراضية لكل دور
DEFAULT_PERMISSIONS = {
    UserRole.ADMIN: [
        Permission.ISSUE_LETTERS,
        Permission.MANAGE_LETTER_SETTINGS,
        Permission.MANAGE_USERS,
        Permission.MANAGE_DEPARTMENTS,
        Permission.MANAGE_COURSES,
        Permission.MANAGE_STUDENTS,
        Permission.VIEW_ATTENDANCE,
        Permission.VIEW_REPORTS,
        Permission.EXPORT_REPORTS,
        Permission.IMPORT_DATA,
        Permission.VIEW_LECTURES,
        Permission.VIEW_COURSES,
        Permission.REPORT_ATTENDANCE_OVERVIEW,
        Permission.REPORT_ABSENT_STUDENTS,
        Permission.REPORT_WARNINGS,
        Permission.REPORT_DAILY,
        Permission.REPORT_STUDENT,
        Permission.REPORT_COURSE,
        Permission.REPORT_TEACHER_WORKLOAD,
        Permission.REPORT_LESSON_COMPLETION,
        Permission.SEND_NOTIFICATIONS,
        Permission.MANAGE_NOTIFICATIONS,
        Permission.MANAGE_TEACHING_LOAD,
        Permission.VIEW_TEACHING_LOAD,
        Permission.VIEW_ARCHIVE,
        Permission.SEARCH_ARCHIVE,
        Permission.EXPORT_ARCHIVE,
    ],
    UserRole.TEACHER: [
        Permission.RECORD_ATTENDANCE,
        Permission.VIEW_ATTENDANCE,
        Permission.EXPORT_REPORTS,
        Permission.MANAGE_LECTURES,
        Permission.VIEW_LECTURES,
        Permission.REPORT_ABSENT_STUDENTS,
        Permission.REPORT_COURSE,
        Permission.REPORT_TEACHER_WORKLOAD,
    ],
    UserRole.EMPLOYEE: [
        Permission.MANAGE_STUDENTS,
        Permission.VIEW_ATTENDANCE,
        Permission.VIEW_REPORTS,
        Permission.EXPORT_REPORTS,
        Permission.IMPORT_DATA,
        Permission.VIEW_LECTURES,
        Permission.REPORT_STUDENT,
        Permission.REPORT_ABSENT_STUDENTS,
        Permission.REPORT_WARNINGS,
    ],
    UserRole.STUDENT: [
        Permission.VIEW_ATTENDANCE,
        Permission.VIEW_LECTURES,
        Permission.REPORT_STUDENT,
    ],
    UserRole.DEAN: [
        Permission.ISSUE_LETTERS,
        Permission.MANAGE_DEPARTMENTS,
        Permission.MANAGE_COURSES,
        Permission.MANAGE_STUDENTS,
        Permission.MANAGE_TEACHERS,
        Permission.MANAGE_ENROLLMENTS,
        Permission.MANAGE_LECTURES,
        Permission.VIEW_ATTENDANCE,
        Permission.APPROVE_ATTENDANCE_CHANGES,  # اعتماد تعديلات الحضور خارج المهلة
        Permission.VIEW_REPORTS,
        Permission.EXPORT_REPORTS,
        Permission.IMPORT_DATA,
        Permission.VIEW_LECTURES,
        Permission.VIEW_COURSES,
        Permission.REPORT_ATTENDANCE_OVERVIEW,
        Permission.REPORT_ABSENT_STUDENTS,
        Permission.REPORT_WARNINGS,
        Permission.REPORT_DAILY,
        Permission.REPORT_STUDENT,
        Permission.REPORT_COURSE,
        Permission.REPORT_TEACHER_WORKLOAD,
        Permission.REPORT_LESSON_COMPLETION,
        Permission.MANAGE_TEACHING_LOAD,
        Permission.VIEW_TEACHING_LOAD,
        Permission.VIEW_ARCHIVE,
        Permission.SEARCH_ARCHIVE,
        Permission.EXPORT_ARCHIVE,
    ],
    UserRole.DEPARTMENT_HEAD: [
        Permission.ISSUE_LETTERS,
        Permission.MANAGE_COURSES,
        Permission.MANAGE_STUDENTS,
        Permission.MANAGE_TEACHERS,
        Permission.MANAGE_ENROLLMENTS,
        Permission.MANAGE_LECTURES,
        Permission.MANAGE_ATTENDANCE,
        Permission.VIEW_REPORTS,
        Permission.EXPORT_REPORTS,
        Permission.IMPORT_DATA,
        Permission.VIEW_LECTURES,
        Permission.VIEW_COURSES,
        Permission.REPORT_ATTENDANCE_OVERVIEW,
        Permission.REPORT_ABSENT_STUDENTS,
        Permission.REPORT_WARNINGS,
        Permission.REPORT_DAILY,
        Permission.REPORT_STUDENT,
        Permission.REPORT_COURSE,
        Permission.REPORT_TEACHER_WORKLOAD,
        Permission.REPORT_LESSON_COMPLETION,
        Permission.MANAGE_TEACHING_LOAD,
        Permission.VIEW_TEACHING_LOAD,
    ],
    UserRole.REGISTRAR: [
        Permission.ISSUE_LETTERS,
        Permission.MANAGE_STUDENTS,
        Permission.MANAGE_ENROLLMENTS,
        Permission.VIEW_ATTENDANCE,
        Permission.VIEW_REPORTS,
        Permission.EXPORT_REPORTS,
        Permission.IMPORT_DATA,
        Permission.VIEW_LECTURES,
        Permission.VIEW_COURSES,
        Permission.REPORT_STUDENT,
        Permission.REPORT_ABSENT_STUDENTS,
        Permission.REPORT_WARNINGS,
        Permission.REPORT_ATTENDANCE_OVERVIEW,
    ],
    UserRole.REGISTRATION_MANAGER: [
        Permission.ISSUE_LETTERS,
        Permission.MANAGE_STUDENTS,
        Permission.MANAGE_ENROLLMENTS,
        Permission.MANAGE_COURSES,
        Permission.VIEW_ATTENDANCE,
        Permission.VIEW_REPORTS,
        Permission.EXPORT_REPORTS,
        Permission.IMPORT_DATA,
        Permission.VIEW_LECTURES,
        Permission.VIEW_COURSES,
        Permission.REPORT_STUDENT,
        Permission.REPORT_ABSENT_STUDENTS,
        Permission.REPORT_WARNINGS,
        Permission.REPORT_ATTENDANCE_OVERVIEW,
        Permission.REPORT_DAILY,
    ],
}

# قائمة جميع الصلاحيات المتاحة للعرض في الواجهة
ALL_PERMISSIONS = [
    {"key": Permission.MANAGE_DEPARTMENTS, "label": "إدارة كاملة للأقسام", "category": "الأقسام"},
    {"key": Permission.VIEW_DEPARTMENTS, "label": "عرض الأقسام", "category": "الأقسام"},
    {"key": Permission.ADD_DEPARTMENT, "label": "إضافة قسم", "category": "الأقسام"},
    {"key": Permission.EDIT_DEPARTMENT, "label": "تعديل قسم", "category": "الأقسام"},
    {"key": Permission.DELETE_DEPARTMENT, "label": "حذف قسم", "category": "الأقسام"},
    {"key": Permission.MANAGE_COURSES, "label": "إدارة كاملة للمقررات", "category": "المقررات"},
    {"key": Permission.VIEW_COURSES, "label": "عرض المقررات", "category": "المقررات"},
    {"key": Permission.ADD_COURSE, "label": "إضافة مقرر", "category": "المقررات"},
    {"key": Permission.EDIT_COURSE, "label": "تعديل مقرر", "category": "المقررات"},
    {"key": Permission.DELETE_COURSE, "label": "حذف مقرر", "category": "المقررات"},
    {"key": Permission.MANAGE_STUDENTS, "label": "إدارة كاملة للطلاب", "category": "الطلاب"},
    {"key": Permission.VIEW_STUDENTS, "label": "عرض الطلاب", "category": "الطلاب"},
    {"key": Permission.ADD_STUDENT, "label": "إضافة طالب", "category": "الطلاب"},
    {"key": Permission.EDIT_STUDENT, "label": "تعديل طالب", "category": "الطلاب"},
    {"key": Permission.DELETE_STUDENT, "label": "حذف طالب", "category": "الطلاب"},
    {"key": Permission.IMPORT_STUDENTS, "label": "استيراد طلاب من Excel", "category": "الطلاب"},
    {"key": Permission.MANAGE_TEACHERS, "label": "إدارة كاملة للمعلمين", "category": "المعلمين"},
    {"key": Permission.VIEW_TEACHERS, "label": "عرض المعلمين", "category": "المعلمين"},
    {"key": Permission.ADD_TEACHER, "label": "إضافة معلم", "category": "المعلمين"},
    {"key": Permission.EDIT_TEACHER, "label": "تعديل معلم", "category": "المعلمين"},
    {"key": Permission.DELETE_TEACHER, "label": "حذف معلم", "category": "المعلمين"},
    {"key": Permission.MANAGE_USERS, "label": "إدارة كاملة للمستخدمين", "category": "المستخدمين"},
    {"key": Permission.VIEW_USERS, "label": "عرض المستخدمين", "category": "المستخدمين"},
    {"key": Permission.ADD_USER, "label": "إضافة مستخدم", "category": "المستخدمين"},
    {"key": Permission.EDIT_USER, "label": "تعديل مستخدم", "category": "المستخدمين"},
    {"key": Permission.DELETE_USER, "label": "حذف مستخدم", "category": "المستخدمين"},
    {"key": Permission.RESET_PASSWORD, "label": "إعادة تعيين كلمة المرور", "category": "المستخدمين"},
    {"key": Permission.MANAGE_FACULTIES, "label": "إدارة كاملة للكليات", "category": "الكليات"},
    {"key": Permission.VIEW_FACULTIES, "label": "عرض الكليات", "category": "الكليات"},
    {"key": Permission.ADD_FACULTY, "label": "إضافة كلية", "category": "الكليات"},
    {"key": Permission.EDIT_FACULTY, "label": "تعديل كلية", "category": "الكليات"},
    {"key": Permission.DELETE_FACULTY, "label": "حذف كلية", "category": "الكليات"},
    {"key": Permission.VIEW_SCHEDULE, "label": "عرض الجدول الدراسي (اليومي والأسبوعي)", "category": "الجداول الدراسية"},
    # صلاحيات المحاضرات: مخفية من الواجهة (تُمنح تلقائياً مع manage_courses) لكن صالحة في الـ Backend
    {"key": Permission.MANAGE_LECTURES, "label": "إدارة كاملة للمحاضرات", "category": "المحاضرات", "hidden": True},
    {"key": Permission.VIEW_LECTURES, "label": "عرض المحاضرات", "category": "المحاضرات", "hidden": True},
    {"key": Permission.ADD_LECTURE, "label": "إضافة محاضرة", "category": "المحاضرات", "hidden": True},
    {"key": Permission.EDIT_LECTURE, "label": "تعديل محاضرة", "category": "المحاضرات", "hidden": True},
    {"key": Permission.DELETE_LECTURE, "label": "حذف محاضرة", "category": "المحاضرات", "hidden": True},
    {"key": Permission.OVERRIDE_LECTURE_STATUS, "label": "تغيير حالة المحاضرة", "category": "المحاضرات", "hidden": True},
    {"key": Permission.RESCHEDULE_LECTURE, "label": "إعادة جدولة المحاضرات", "category": "المحاضرات", "hidden": True},
    {"key": Permission.SHIFT_DAY, "label": "إزاحة اليوم الدراسي (تأخير/تقديم بداية اليوم لكل المحاضرات)", "category": "الجداول الدراسية"},
    {"key": Permission.HR_VIEW_EMPLOYEES, "label": "عرض سجل الموظفين والهيكل التنظيمي", "category": "شؤون الموظفين"},
    {"key": Permission.HR_MANAGE_EMPLOYEES, "label": "إدارة الموظفين (إضافة/تعديل/حذف/استيراد/إنشاء حسابات)", "category": "شؤون الموظفين"},
    {"key": Permission.HR_MANAGE_ORG, "label": "إدارة الهيكل التنظيمي (الوحدات والإدارات)", "category": "شؤون الموظفين"},
    {"key": Permission.HR_MANAGE_LEAVES, "label": "إدارة الإجازات (اعتماد/رفض/تسجيل/أرصدة)", "category": "شؤون الموظفين"},
    {"key": Permission.HR_MANAGE_ATTENDANCE, "label": "إدارة الحضور الإداري (الكشف اليومي والتقارير ومواقع العمل وتأكيد التواجد)", "category": "شؤون الموظفين"},
    {"key": Permission.HR_MANAGE_WORK_SETTINGS, "label": "إعدادات الدوام (فترات الدوام وأوقاتها، أيام العمل والعطل، تكليف الموظفين بالفترات)", "category": "شؤون الموظفين"},
    {"key": Permission.HR_MANAGE_LEAVE_SETTINGS, "label": "إعدادات الإجازات (أنواع الإجازات، الأرصدة حسب الفئة، الخصم من الرصيد)", "category": "شؤون الموظفين"},
    {"key": Permission.HR_MANAGE_CORRESPONDENCE, "label": "إدارة المراسلات والتعاميم", "category": "شؤون الموظفين"},
    {"key": Permission.HR_MANAGE_TASKS, "label": "إسناد المهام لأي موظف ومتابعتها (المدير المباشر يسند لفريقه دون هذه الصلاحية)", "category": "شؤون الموظفين"},
    {"key": Permission.HR_MANAGE_APPRAISALS, "label": "اعتماد التقييم السنوي وإدارته لكل الموظفين", "category": "شؤون الموظفين"},
    {"key": Permission.ISSUE_LETTERS, "label": "إصدار الخطابات الرسمية (يرى في السجل ما أصدره وما يخص كلياته/نطاقه الإداري)", "category": "الخطابات الرسمية"},
    {"key": Permission.MANAGE_LETTER_SETTINGS, "label": "إدارة كليشة الخطابات وقوالبها", "category": "الخطابات الرسمية"},
    {"key": Permission.USE_ASSISTANT, "label": "استخدام مرشد الأحقاف (المساعد الإرشادي الذكي)", "category": "عام"},
    {"key": Permission.MANAGE_STUDENT_EXCUSES, "label": "مراجعة أعذار غياب الطلاب والبت فيها (التسجيل/العميد/مجلس الكلية حسب التوجيه)", "category": "الحضور"},
    {"key": Permission.MANAGE_ENROLLMENTS, "label": "إدارة كاملة للتسجيل", "category": "التسجيل"},
    {"key": Permission.VIEW_ENROLLMENTS, "label": "عرض التسجيلات", "category": "التسجيل"},
    {"key": Permission.ADD_ENROLLMENT, "label": "تسجيل طالب في مقرر", "category": "التسجيل"},
    {"key": Permission.DELETE_ENROLLMENT, "label": "إلغاء تسجيل طالب", "category": "التسجيل"},
    {"key": Permission.MANAGE_ATTENDANCE, "label": "إدارة كاملة للحضور (تسجيل + تعديل + عرض)", "category": "الحضور"},
    {"key": Permission.RECORD_ATTENDANCE, "label": "تسجيل الحضور", "category": "الحضور"},
    {"key": Permission.TAKE_ATTENDANCE, "label": "أخذ الحضور", "category": "الحضور"},
    {"key": Permission.VIEW_ATTENDANCE, "label": "عرض الحضور", "category": "الحضور"},
    {"key": Permission.EDIT_ATTENDANCE, "label": "تعديل الحضور", "category": "الحضور"},
    {"key": Permission.APPROVE_ATTENDANCE_CHANGES, "label": "اعتماد تعديلات الحضور (العميد)", "category": "الحضور"},
    {"key": Permission.SEND_NOTIFICATIONS, "label": "إرسال إشعارات وإنذارات للطلاب", "category": "الإشعارات"},
    {"key": Permission.VIEW_REPORTS, "label": "عرض جميع التقارير", "category": "التقارير"},
    {"key": Permission.VIEW_STATISTICS, "label": "عرض الإحصائيات", "category": "التقارير"},
    {"key": Permission.EXPORT_REPORTS, "label": "تصدير التقارير", "category": "التقارير"},
    {"key": Permission.REPORT_ATTENDANCE_OVERVIEW, "label": "تقرير الحضور الشامل", "category": "التقارير الفردية"},
    {"key": Permission.REPORT_ABSENT_STUDENTS, "label": "تقرير الطلاب المتغيبين", "category": "التقارير الفردية"},
    {"key": Permission.REPORT_WARNINGS, "label": "تقرير الإنذارات والحرمان", "category": "التقارير الفردية"},
    {"key": Permission.REPORT_DAILY, "label": "التقرير اليومي", "category": "التقارير الفردية"},
    {"key": Permission.MANAGE_FEE_RECEIPTS, "label": "إدارة السندات المالية (تعميد سندات الرسوم)", "category": "المالية"},
    {"key": Permission.REPORT_STUDENT, "label": "تقرير طالب", "category": "التقارير الفردية"},
    {"key": Permission.REPORT_COURSE, "label": "تقرير مقرر", "category": "التقارير الفردية"},
    {"key": Permission.REPORT_TEACHER_WORKLOAD, "label": "تقرير نصاب المدرس", "category": "التقارير الفردية"},
    {"key": Permission.REPORT_LESSON_COMPLETION, "label": "تقرير إنجاز الدروس", "category": "التقارير الفردية"},
    {"key": Permission.MANAGE_ROLES, "label": "إدارة الأدوار", "category": "النظام"},
    {"key": Permission.MANAGE_SETTINGS, "label": "إدارة الإعدادات", "category": "النظام"},
    {"key": Permission.MIGRATE_COURSES, "label": "ترحيل المقررات لفصل جديد", "category": "المقررات"},
    {"key": Permission.MANAGE_TEACHING_LOAD, "label": "إدارة العبء التدريسي", "category": "العبء التدريسي"},
    {"key": Permission.VIEW_TEACHING_LOAD, "label": "عرض العبء التدريسي", "category": "العبء التدريسي"},
    {"key": Permission.CROSS_UNIVERSITY_ASSIGNMENT, "label": "إسناد عابر للجامعة (إسناد أساتذة من كل الكليات)", "category": "العبء التدريسي"},
    {"key": Permission.MANAGE_CURRICULUM, "label": "إدارة الخطة الدراسية", "category": "الخطة الدراسية"},
    {"key": Permission.VIEW_CURRICULUM, "label": "عرض الخطة الدراسية", "category": "الخطة الدراسية"},
    {"key": Permission.VIEW_ARCHIVE, "label": "عرض الأرشيف", "category": "الأرشيف"},
    {"key": Permission.SEARCH_ARCHIVE, "label": "البحث في الأرشيف", "category": "الأرشيف"},
    {"key": Permission.EXPORT_ARCHIVE, "label": "تصدير من الأرشيف", "category": "الأرشيف"},
    {"key": Permission.DASHBOARD_ALERTS, "label": "التنبيهات (حضور منخفض، محاضرات فائتة، تأخر، سندات)", "category": "لوحة القيادة"},
    {"key": Permission.DASHBOARD_ATTENDANCE, "label": "مخطط الحضور", "category": "لوحة القيادة"},
    {"key": Permission.DASHBOARD_TEACHERS, "label": "إحصائيات الأساتذة", "category": "لوحة القيادة"},
    {"key": Permission.DASHBOARD_STUDENTS, "label": "إحصائيات الطلاب", "category": "لوحة القيادة"},
    {"key": Permission.DASHBOARD_ROOMS, "label": "القاعات والجدول", "category": "لوحة القيادة"},
    {"key": Permission.DASHBOARD_FINANCE, "label": "الإحصائيات المالية (تحتاج أيضاً صلاحية السندات)", "category": "لوحة القيادة"},
    {"key": Permission.DASHBOARD_HR, "label": "شؤون الموظفين (الأعداد، الدوام الإداري، الإجازات، المهام)", "category": "لوحة القيادة"},
    {"key": Permission.DASHBOARD_EXPORT, "label": "تصدير اللوحة PDF/Excel والملخصات الأسبوعية", "category": "لوحة القيادة"},
    {"key": Permission.MANAGE_INSTITUTION, "label": "بيانات الجامعة والمؤسسة", "category": "الهيكل الأكاديمي"},
    {"key": Permission.MANAGE_SEMESTERS, "label": "إدارة الفصول الدراسية (إنشاء/تفعيل/إغلاق/أرشفة)", "category": "الهيكل الأكاديمي"},
    {"key": Permission.MANAGE_ACADEMIC_YEARS, "label": "السنوات الأكاديمية", "category": "الهيكل الأكاديمي"},
    {"key": Permission.MANAGE_ROOMS, "label": "إدارة القاعات", "category": "الهيكل الأكاديمي"},
    {"key": Permission.MANAGE_CALENDAR, "label": "التقويم الجامعي والعطل", "category": "الهيكل الأكاديمي"},
    {"key": Permission.STUDENTS_SAFE_DELETE, "label": "الحذف الآمن للطلاب والاستعادة", "category": "الطلاب — عمليات متقدمة"},
    {"key": Permission.STUDENTS_TOGGLE_ACTIVE, "label": "تفعيل/تعطيل طالب", "category": "الطلاب — عمليات متقدمة"},
    {"key": Permission.STUDENTS_BULK_OPS, "label": "العمليات الجماعية على الطلاب (مستوى/جنس/تفعيل)", "category": "الطلاب — عمليات متقدمة"},
    {"key": Permission.STUDENTS_RESET_PASSWORD, "label": "إعادة تعيين كلمة مرور طالب", "category": "الطلاب — عمليات متقدمة"},
    {"key": Permission.STUDENTS_EXCLUDE_COURSE, "label": "استثناء طالب من مقرر", "category": "الطلاب — عمليات متقدمة"},
    {"key": Permission.STUDENTS_MANAGE_STATUS, "label": "حالة الطالب (انقطاع/فصل) والتحويل بين الأقسام", "category": "الطلاب — عمليات متقدمة"},
    {"key": Permission.VIEW_STUDENT_NOTIFICATIONS, "label": "عرض إشعارات الطلاب", "category": "الإشعارات"},
    {"key": Permission.DELETE_STUDENT_NOTIFICATIONS, "label": "حذف إشعارات الطلاب", "category": "الإشعارات"},
    {"key": Permission.TEACHERS_SAFE_DELETE, "label": "الحذف الآمن للمعلمين والاستعادة", "category": "المعلمون — عمليات متقدمة"},
    {"key": Permission.TEACHERS_TOGGLE_ACTIVE, "label": "تفعيل/تعطيل معلم", "category": "المعلمون — عمليات متقدمة"},
    {"key": Permission.TEACHERS_RESET_PASSWORD, "label": "إعادة تعيين كلمة مرور معلم", "category": "المعلمون — عمليات متقدمة"},
    {"key": Permission.TEACHERS_BULK_OPS, "label": "العمليات الجماعية على المعلمين", "category": "المعلمون — عمليات متقدمة"},
    {"key": Permission.TEACHERS_EXPORT, "label": "تصدير المعلمين المختارين (Excel/PDF)", "category": "المعلمون — عمليات متقدمة"},
    {"key": Permission.REPORT_TEACHER_ATTENDANCE, "label": "تقرير حضور المعلمين", "category": "التقارير الفردية"},
    {"key": Permission.COURSES_CLONE_SECTION, "label": "نسخ شعبة مقرر", "category": "المقررات"},
    {"key": Permission.ENROLLMENTS_AUTO, "label": "التسجيل الآلي ومزامنة التسجيلات", "category": "التسجيل"},
    {"key": Permission.ENROLLMENTS_BULK, "label": "نسخ/نقل التسجيلات جماعياً", "category": "التسجيل"},
    {"key": Permission.GENERATE_LECTURES, "label": "توليد محاضرات الفصل الدراسي", "category": "المحاضرات والجدول"},
    {"key": Permission.LECTURES_REASSIGN_HISTORY, "label": "إعادة إسناد تاريخ المحاضرات لمدرس آخر", "category": "المحاضرات والجدول"},
    {"key": Permission.LECTURES_PURGE, "label": "حذف/تنظيف محاضرات (purge)", "category": "المحاضرات والجدول"},
    {"key": Permission.MANAGE_SCHEDULE, "label": "إدارة الجدول اليومي (إنشاء/تعديل/حذف)", "category": "المحاضرات والجدول"},
    {"key": Permission.IMPORT_DATA, "label": "استيراد البيانات (طلاب/معلمين/مقررات/محاضرات) وتنزيل القوالب", "category": "الاستيراد والتصدير"},
    {"key": Permission.EXPORT_STUDENTS, "label": "تصدير سجلات الطلاب PDF/Excel", "category": "الاستيراد والتصدير"},
    {"key": Permission.MANAGE_USER_PERMISSIONS, "label": "تعديل صلاحيات مستخدم (منح/سحب/إعادة ضبط)", "category": "المستخدمين"},
    {"key": Permission.USERS_TOGGLE_ACTIVE, "label": "تفعيل/تعطيل حساب مستخدم", "category": "المستخدمين"},
    {"key": Permission.VIEW_ACTIVITY_LOGS, "label": "عرض سجل النشاط وإحصائياته", "category": "السجلات والمحذوفات"},
    {"key": Permission.DELETE_ACTIVITY_LOGS, "label": "حذف سجل النشاط", "category": "السجلات والمحذوفات"},
    {"key": Permission.MANAGE_TRASH, "label": "سلة المحذوفات (عرض/استعادة)", "category": "السجلات والمحذوفات"},
    {"key": Permission.PURGE_TRASH, "label": "تفريغ سلة المحذوفات (حذف نهائي)", "category": "السجلات والمحذوفات"},
    {"key": Permission.SYSTEM_DIAGNOSTICS, "label": "عرض تشخيصات النظام (معاينة فقط)", "category": "أدوات الصيانة"},
    {"key": Permission.SYSTEM_TOOLS, "label": "تنفيذ أدوات الإصلاح والصيانة (مهندس نظام)", "category": "أدوات الصيانة"},
    {"key": Permission.VIEW_FEE_RECEIPTS, "label": "عرض السندات المالية (قراءة فقط)", "category": "المالية"},
    {"key": Permission.ISSUE_STATEMENTS, "label": "إصدار الإفادات والشهادات", "category": "المالية"},
    {"key": Permission.HR_APPROVE_PHOTOS, "label": "اعتماد صور بطاقات الموظفين", "category": "شؤون الموظفين"},
    {"key": Permission.HR_PRINT_CARDS, "label": "طباعة بطاقات الموظفين وتصميمها", "category": "شؤون الموظفين"},
    {"key": Permission.HR_MANAGE_LOCATIONS, "label": "مواقع العمل والنطاق الجغرافي", "category": "شؤون الموظفين"},
]

DASHBOARD_PERMISSIONS = [Permission.DASHBOARD_ALERTS, Permission.DASHBOARD_ATTENDANCE, Permission.DASHBOARD_TEACHERS,
                         Permission.DASHBOARD_STUDENTS, Permission.DASHBOARD_ROOMS, Permission.DASHBOARD_FINANCE, Permission.DASHBOARD_HR, Permission.DASHBOARD_EXPORT]
# الأدوار القيادية تحصل على كل أجزاء اللوحة افتراضياً (قسم شؤون الموظفين للأدمن ورئيس الجامعة ومدير HR فقط)
for _r in (UserRole.ADMIN, UserRole.DEAN, UserRole.DEPARTMENT_HEAD):
    DEFAULT_PERMISSIONS[_r] = DEFAULT_PERMISSIONS.get(_r, []) + [p for p in DASHBOARD_PERMISSIONS if p not in DEFAULT_PERMISSIONS.get(_r, []) and (p != Permission.DASHBOARD_HR or _r == UserRole.ADMIN)]

# الصلاحيات الكاملة تشمل الصلاحيات الفرعية
# 🏛️ الأدوار القرائية: نطاق الجامعة كلها + صلاحيات العرض/التقارير/التصدير فقط — أي تعديل يُرفض بحارس القراءة
READ_ONLY_ROLES = {UserRole.UNIVERSITY_PRESIDENT}
READ_ONLY_PERMISSIONS = [
    p["key"] for p in ALL_PERMISSIONS
    if p["key"].startswith(("view_", "report_", "export_", "dashboard_")) or p["key"] in ("search_archive", "manage_fee_receipts", Permission.HR_VIEW_EMPLOYEES)
]  # manage_fee_receipts = المفتاح الوحيد لقراءة السندات المالية؛ الكتابة محجوبة بحارس القراءة
DEFAULT_PERMISSIONS[UserRole.UNIVERSITY_PRESIDENT] = list(READ_ONLY_PERMISSIONS)

# 🏢 أدوار شؤون الموظفين الجاهزة (تُنشأ بزر واحد من إدارة الأدوار)
_HR_ALL = [Permission.HR_VIEW_EMPLOYEES, Permission.HR_MANAGE_EMPLOYEES, Permission.HR_MANAGE_ORG, Permission.HR_MANAGE_LEAVES, Permission.HR_MANAGE_ATTENDANCE, Permission.HR_MANAGE_WORK_SETTINGS,
           Permission.HR_MANAGE_CORRESPONDENCE, Permission.HR_MANAGE_TASKS, Permission.HR_MANAGE_APPRAISALS, Permission.HR_MANAGE_LEAVE_SETTINGS]
HR_ROLE_PRESETS = [
    {"key": "hr_manager", "name": "مدير شؤون الموظفين", "description": "كامل صلاحيات شؤون الموظفين: السجل والمستندات، الهيكل التنظيمي، اعتماد الإجازات والأرصدة، الحضور الإداري، المراسلات، إسناد المهام، اعتماد التقييم السنوي، التقرير السنوي وبطاقة HR في لوحة القيادة",
     "permissions": _HR_ALL + [Permission.DASHBOARD_ALERTS, Permission.DASHBOARD_HR]},
    {"key": "hr_officer", "name": "أخصائي شؤون الموظفين", "description": "التشغيل اليومي دون سلطة اعتماد: إدارة سجلات الموظفين والمستندات، الحضور الإداري، المراسلات، وعرض الإجازات والتقييمات",
     "permissions": [Permission.HR_VIEW_EMPLOYEES, Permission.HR_MANAGE_EMPLOYEES, Permission.HR_MANAGE_ATTENDANCE, Permission.HR_MANAGE_CORRESPONDENCE]},
    {"key": "hr_attendance_clerk", "name": "مسؤول الحضور والانصراف", "description": "الكشف اليومي للحضور الإداري والتقرير الشهري فقط، مع عرض سجل الموظفين",
     "permissions": [Permission.HR_VIEW_EMPLOYEES, Permission.HR_MANAGE_ATTENDANCE]},
    {"key": "hr_correspondence_clerk", "name": "مسؤول المراسلات (السكرتارية)", "description": "تسجيل الوارد والصادر والمذكرات والتعاميم ومتابعتها فقط، مع عرض سجل الموظفين",
     "permissions": [Permission.HR_VIEW_EMPLOYEES, Permission.HR_MANAGE_CORRESPONDENCE]},
    {"key": "hr_auditor", "name": "مراقب شؤون الموظفين (اطّلاع فقط)", "description": "اطّلاع كامل على السجل والإجازات والحضور والمراسلات والتقييمات والتقرير السنوي وبطاقة HR دون أي تعديل — مناسب للإدارة العليا",
     "permissions": [Permission.HR_VIEW_EMPLOYEES, Permission.DASHBOARD_ALERTS, Permission.DASHBOARD_HR]},
]

# 🧩 أدوار إدارية جاهزة (تُنشأ بزر واحد من إدارة الأدوار)
ADMIN_ROLE_PRESETS = [
    {"key": "admissions_officer", "name": "مسؤول القبول والتسجيل", "description": "إدارة الطلاب والتسجيل والعمليات الجماعية والتسجيل الآلي وتصدير سجلات الطلاب وتقارير الطلاب",
     "permissions": [Permission.MANAGE_STUDENTS, Permission.MANAGE_ENROLLMENTS, Permission.VIEW_COURSES, Permission.VIEW_LECTURES, Permission.VIEW_ATTENDANCE, Permission.IMPORT_DATA,
                     Permission.EXPORT_REPORTS, Permission.REPORT_STUDENT, Permission.REPORT_ABSENT_STUDENTS, Permission.REPORT_WARNINGS, Permission.REPORT_ATTENDANCE_OVERVIEW, Permission.ISSUE_LETTERS]},
    {"key": "schedule_officer", "name": "مسؤول الجداول والمحاضرات", "description": "الجدول الأسبوعي واليومي، توليد محاضرات الفصل، القاعات، التقويم، الفصول الدراسية، نسخ الشعب",
     "permissions": [Permission.MANAGE_SCHEDULE, Permission.GENERATE_LECTURES, Permission.MANAGE_LECTURES, Permission.VIEW_COURSES, Permission.COURSES_CLONE_SECTION, Permission.MANAGE_ROOMS,
                     Permission.MANAGE_CALENDAR, Permission.MANAGE_SEMESTERS, Permission.VIEW_TEACHERS, Permission.VIEW_TEACHING_LOAD, Permission.SHIFT_DAY]},
    {"key": "data_officer", "name": "مسؤول الاستيراد والبيانات", "description": "استيراد الطلاب والمعلمين والمقررات والمحاضرات وتنزيل القوالب وتصدير السجلات",
     "permissions": [Permission.IMPORT_DATA, Permission.EXPORT_STUDENTS, Permission.TEACHERS_EXPORT, Permission.VIEW_STUDENTS, Permission.VIEW_TEACHERS, Permission.VIEW_COURSES, Permission.EXPORT_REPORTS]},
    {"key": "records_auditor", "name": "مدقق السجلات (اطّلاع)", "description": "عرض سجل النشاط وإحصائياته وسلة المحذوفات والتقارير دون أي تعديل",
     "permissions": [Permission.VIEW_ACTIVITY_LOGS, Permission.MANAGE_TRASH, Permission.VIEW_REPORTS, Permission.EXPORT_REPORTS, Permission.VIEW_STUDENTS, Permission.VIEW_TEACHERS, Permission.VIEW_COURSES, Permission.SYSTEM_DIAGNOSTICS]},
    {"key": "system_engineer", "name": "مهندس نظام", "description": "أدوات الإصلاح والصيانة والتشخيص، صلاحيات المستخدمين، حذف السجلات وتفريغ المحذوفات — للثقات فقط",
     "permissions": [Permission.SYSTEM_TOOLS, Permission.SYSTEM_DIAGNOSTICS, Permission.MANAGE_USERS, Permission.MANAGE_USER_PERMISSIONS, Permission.DELETE_ACTIVITY_LOGS, Permission.PURGE_TRASH, Permission.MANAGE_TRASH, Permission.VIEW_ACTIVITY_LOGS, Permission.LECTURES_PURGE]},
    {"key": "cards_officer", "name": "مسؤول طباعة البطاقات", "description": "طباعة بطاقات الطلاب والموظفين واعتماد صور البطاقات وتصميمها",
     "permissions": [Permission.VIEW_STUDENTS, Permission.HR_VIEW_EMPLOYEES, Permission.HR_PRINT_CARDS, Permission.HR_APPROVE_PHOTOS, Permission.MANAGE_SETTINGS]},
    {"key": "correspondence_officer", "name": "مسؤول المراسلات", "description": "إصدار الخطابات الرسمية وإدارة كليشتها وقوالبها، والمراسلات والتعاميم الإدارية",
     "permissions": [Permission.ISSUE_LETTERS, Permission.MANAGE_LETTER_SETTINGS, Permission.HR_VIEW_EMPLOYEES, Permission.HR_MANAGE_CORRESPONDENCE]},
]

FULL_PERMISSION_MAPPING = {
    Permission.MANAGE_DEPARTMENTS: [
        Permission.VIEW_DEPARTMENTS, Permission.ADD_DEPARTMENT, 
        Permission.EDIT_DEPARTMENT, Permission.DELETE_DEPARTMENT
    ],
    Permission.MANAGE_COURSES: [
        Permission.VIEW_COURSES, Permission.ADD_COURSE,
        Permission.EDIT_COURSE, Permission.DELETE_COURSE,
        # المحاضرات صلاحيات فرعية تحت إدارة المقررات (لا تُمنح مستقلة)
        Permission.MANAGE_LECTURES, Permission.VIEW_LECTURES,
        Permission.ADD_LECTURE, Permission.EDIT_LECTURE, Permission.DELETE_LECTURE,
        Permission.OVERRIDE_LECTURE_STATUS, Permission.RESCHEDULE_LECTURE,
        Permission.GENERATE_LECTURES, Permission.COURSES_CLONE_SECTION, Permission.ENROLLMENTS_AUTO,
        Permission.MANAGE_SEMESTERS, Permission.MANAGE_ACADEMIC_YEARS, Permission.MANAGE_SCHEDULE, Permission.MANAGE_TRASH,
    ],
    Permission.MANAGE_STUDENTS: [
        Permission.VIEW_STUDENTS, Permission.ADD_STUDENT, 
        Permission.EDIT_STUDENT, Permission.DELETE_STUDENT, Permission.IMPORT_STUDENTS,
        Permission.STUDENTS_SAFE_DELETE, Permission.STUDENTS_TOGGLE_ACTIVE, Permission.STUDENTS_BULK_OPS,
        Permission.STUDENTS_RESET_PASSWORD, Permission.STUDENTS_EXCLUDE_COURSE, Permission.STUDENTS_MANAGE_STATUS,
        Permission.VIEW_STUDENT_NOTIFICATIONS, Permission.EXPORT_STUDENTS,
    ],
    Permission.MANAGE_TEACHERS: [
        Permission.VIEW_TEACHERS, Permission.ADD_TEACHER, 
        Permission.EDIT_TEACHER, Permission.DELETE_TEACHER,
        Permission.TEACHERS_SAFE_DELETE, Permission.TEACHERS_TOGGLE_ACTIVE, Permission.TEACHERS_RESET_PASSWORD,
        Permission.TEACHERS_BULK_OPS, Permission.TEACHERS_EXPORT,
    ],
    Permission.MANAGE_USERS: [
        Permission.VIEW_USERS, Permission.ADD_USER, 
        Permission.EDIT_USER, Permission.DELETE_USER, Permission.RESET_PASSWORD,
        Permission.MANAGE_USER_PERMISSIONS, Permission.USERS_TOGGLE_ACTIVE,
    ],
    Permission.MANAGE_FACULTIES: [Permission.VIEW_FACULTIES, Permission.ADD_FACULTY, Permission.EDIT_FACULTY, Permission.DELETE_FACULTY, Permission.MANAGE_INSTITUTION],
    Permission.MANAGE_ENROLLMENTS: [Permission.VIEW_ENROLLMENTS, Permission.ADD_ENROLLMENT, Permission.DELETE_ENROLLMENT, Permission.ENROLLMENTS_AUTO, Permission.ENROLLMENTS_BULK],
    Permission.MANAGE_FEE_RECEIPTS: [Permission.VIEW_FEE_RECEIPTS],
    Permission.HR_MANAGE_EMPLOYEES: [Permission.HR_VIEW_EMPLOYEES, Permission.HR_APPROVE_PHOTOS, Permission.HR_PRINT_CARDS],
    Permission.HR_MANAGE_ATTENDANCE: [Permission.HR_VIEW_EMPLOYEES, Permission.HR_MANAGE_LOCATIONS],
    Permission.VIEW_REPORTS: [Permission.REPORT_TEACHER_ATTENDANCE, Permission.VIEW_ACTIVITY_LOGS],
    Permission.MANAGE_LECTURES: [
        Permission.VIEW_LECTURES, Permission.ADD_LECTURE, 
        Permission.EDIT_LECTURE, Permission.DELETE_LECTURE,
        Permission.OVERRIDE_LECTURE_STATUS, Permission.RESCHEDULE_LECTURE,
        Permission.GENERATE_LECTURES
    ],
    Permission.MANAGE_LECTURES: [
        Permission.VIEW_LECTURES, Permission.ADD_LECTURE, 
        Permission.EDIT_LECTURE, Permission.DELETE_LECTURE,
        Permission.OVERRIDE_LECTURE_STATUS, Permission.RESCHEDULE_LECTURE,
        Permission.GENERATE_LECTURES
    ],
    Permission.MANAGE_ATTENDANCE: [
        Permission.RECORD_ATTENDANCE, Permission.TAKE_ATTENDANCE,
        Permission.VIEW_ATTENDANCE, Permission.EDIT_ATTENDANCE
    ],
    Permission.MANAGE_SCHEDULE: [
        Permission.VIEW_SCHEDULE
    ],
    Permission.HR_MANAGE_LEAVES: [Permission.HR_VIEW_EMPLOYEES],
    Permission.HR_MANAGE_WORK_SETTINGS: [Permission.HR_VIEW_EMPLOYEES],
    Permission.HR_MANAGE_LEAVE_SETTINGS: [Permission.HR_VIEW_EMPLOYEES],
    Permission.HR_MANAGE_CORRESPONDENCE: [Permission.HR_VIEW_EMPLOYEES],
    Permission.HR_MANAGE_TASKS: [Permission.HR_VIEW_EMPLOYEES],
    Permission.HR_MANAGE_APPRAISALS: [Permission.HR_VIEW_EMPLOYEES],
    Permission.MANAGE_CURRICULUM: [
        Permission.VIEW_CURRICULUM
    ],
}

class ScopeType:
    """نوع نطاق الصلاحية"""
    GLOBAL = "global"
    DEPARTMENT = "department"
    COURSE = "course"

def user_has_permission(user_permissions: List[str], required_permission: str) -> bool:
    """التحقق من أن المستخدم لديه صلاحية معينة (مع دعم الصلاحيات الكاملة)"""
    if required_permission in user_permissions:
        return True
    
    for full_perm, sub_perms in FULL_PERMISSION_MAPPING.items():
        if full_perm in user_permissions and required_permission in sub_perms:
            return True
    
    return False
