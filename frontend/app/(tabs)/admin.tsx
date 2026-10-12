/**
 * 🛠️ صفحة "الإعدادات الأساسية" — لوحة أدوات إدارية موحّدة
 *
 * تجمع كل الأدوات والصفحات التي ليست موجودة بشكل مباشر في:
 *   - الصفحة الرئيسية (Dashboard)
 *   - أو القائمة الجانبية
 *
 * كل عنصر يظهر فقط للمستخدم الذي يملك صلاحيته (RBAC).
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import { useAuth, PERMISSIONS } from '../../src/contexts/AuthContext';

interface ToolItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
  color: string;
  bg: string;
  route: string;
  permissions?: string[]; // أي صلاحية تكفي
  adminOnly?: boolean;
  teacherOnly?: boolean;
  forAll?: boolean;
}

interface Section {
  id: string;
  title: string;
  icon: string;
  tint: string;
  items: ToolItem[];
}

const SECTIONS: Section[] = [
  // 🎓 الإدارة الأكاديمية
  {
    id: 'academic',
    title: 'الإدارة الأكاديمية',
    icon: 'school',
    tint: '#1565c0',
    items: [
      {
        id: 'manage-study-plan',
        label: 'إدارة الخطة الدراسية',
        description: 'إنشاء وتعديل الخطط الدراسية للأقسام',
        icon: 'library',
        color: '#1565c0',
        bg: '#dbeafe',
        route: '/manage-study-plan',
        permissions: [PERMISSIONS.MANAGE_CURRICULUM],
      },
      {
        id: 'teacher-courses',
        label: 'مقررات المعلم',
        description: 'استعراض المقررات حسب المعلم',
        icon: 'book',
        color: '#0ea5e9',
        bg: '#e0f2fe',
        route: '/teacher-courses',
        permissions: [PERMISSIONS.MANAGE_COURSES, PERMISSIONS.MANAGE_TEACHERS, 'view_courses', 'view_teachers'],
      },
      {
        id: 'student-references',
        label: 'مراجع الطلاب',
        description: 'إدارة المراجع والمستندات المرتبطة بالطلاب',
        icon: 'document-text',
        color: '#7c3aed',
        bg: '#ede9fe',
        route: '/student-references',
        permissions: [PERMISSIONS.MANAGE_STUDENTS, 'view_students'],
      },
      {
        id: 'student-statuses',
        label: 'حالات الطالب',
        description: 'الطلاب المجمَّدون والمُعادون والمفصولون',
        icon: 'people-circle',
        color: '#0369a1',
        bg: '#e0f2fe',
        route: '/student-statuses',
        permissions: [PERMISSIONS.MANAGE_STUDENTS, 'view_students'],
      },
    ],
  },

  // 📅 التقويم والجداول
  {
    id: 'calendar',
    title: 'التقويم والجداول',
    icon: 'calendar',
    tint: '#f97316',
    items: [
      {
        id: 'university-calendar',
        label: 'إدارة التقويم الجامعي',
        description: 'إضافة وتعديل المواعيد الجامعية',
        icon: 'calendar',
        color: '#f97316',
        bg: '#ffedd5',
        route: '/university-calendar',
        permissions: ['manage_calendar'],
      },
      {
        id: 'view-calendar',
        label: 'عرض التقويم الجامعي',
        description: 'استعراض جميع الفعاليات والمواعيد',
        icon: 'calendar-outline',
        color: '#22c55e',
        bg: '#dcfce7',
        route: '/calendar',
        forAll: true,
      },
      {
        id: 'availability-report',
        label: 'تقرير توفّر القاعات',
        description: 'متابعة شواغر القاعات والأوقات',
        icon: 'business',
        color: '#0891b2',
        bg: '#cffafe',
        route: '/availability-report',
        permissions: [PERMISSIONS.VIEW_REPORTS, PERMISSIONS.MANAGE_SCHEDULE, 'view_schedule'],
      },
    ],
  },

  // 📊 التقارير الإضافية
  {
    id: 'reports',
    title: 'التقارير المتقدّمة',
    icon: 'stats-chart',
    tint: '#06b6d4',
    items: [
      {
        id: 'report-course',
        label: 'تقرير المقرر',
        description: 'تقارير تفصيلية لكل مقرر',
        icon: 'book',
        color: '#06b6d4',
        bg: '#cffafe',
        route: '/report-course',
        permissions: [PERMISSIONS.REPORT_COURSE, PERMISSIONS.VIEW_REPORTS],
      },
      {
        id: 'report-absent-students',
        label: 'تقرير غياب الطلاب',
        description: 'الطلاب المتغيّبون عن المحاضرات',
        icon: 'people',
        color: '#ef4444',
        bg: '#fee2e2',
        route: '/report-absent-students',
        permissions: [PERMISSIONS.REPORT_ABSENT_STUDENTS, PERMISSIONS.VIEW_REPORTS],
      },
      {
        id: 'report-teacher-summary',
        label: 'ملخّص أداء المعلم',
        description: 'مؤشّرات شاملة عن أداء المعلمين',
        icon: 'person',
        color: '#7c3aed',
        bg: '#ede9fe',
        route: '/report-teacher-summary',
        permissions: [PERMISSIONS.REPORT_TEACHER_WORKLOAD, PERMISSIONS.VIEW_REPORTS],
      },
      {
        id: 'report-lesson-completion',
        label: 'اكتمال الدروس',
        description: 'نسبة إنجاز خطط الدروس',
        icon: 'checkmark-done',
        color: '#16a34a',
        bg: '#dcfce7',
        route: '/report-lesson-completion',
        permissions: [PERMISSIONS.REPORT_LESSON_COMPLETION, PERMISSIONS.VIEW_REPORTS],
      },
      {
        id: 'report-daily',
        label: 'التقرير اليومي',
        description: 'ملخّص نشاط اليوم',
        icon: 'today',
        color: '#f59e0b',
        bg: '#fef3c7',
        route: '/report-daily',
        permissions: [PERMISSIONS.REPORT_DAILY, PERMISSIONS.VIEW_REPORTS],
      },
      {
        id: 'verify-report',
        label: 'التحقّق من التقارير',
        description: 'التحقّق من توقيع تقرير عبر معرّفه/QR',
        icon: 'shield-checkmark',
        color: '#0f766e',
        bg: '#ccfbf1',
        route: '/verify-report',
        forAll: true,
      },
    ],
  },

  // 📤 النتائج والإشعارات
  {
    id: 'results',
    title: 'النتائج والإشعارات',
    icon: 'paper-plane',
    tint: '#16a34a',
    items: [
      {
        id: 'send-final-results',
        label: 'إرسال النتائج النهائية',
        description: 'إرسال نتائج الطلاب نهاية الفصل',
        icon: 'paper-plane',
        color: '#16a34a',
        bg: '#dcfce7',
        route: '/send-final-results',
        permissions: [PERMISSIONS.SEND_NOTIFICATIONS, PERMISSIONS.MANAGE_COURSES, 'manage_grades'],
      },
      {
        id: 'send-department-results',
        label: 'إرسال نتائج القسم',
        description: 'نتائج طلاب القسم ككل',
        icon: 'send',
        color: '#1565c0',
        bg: '#dbeafe',
        route: '/send-department-results',
        permissions: [PERMISSIONS.SEND_NOTIFICATIONS, PERMISSIONS.MANAGE_DEPARTMENTS, 'manage_grades'],
      },
      {
        id: 'send-notification',
        label: 'إرسال إشعار',
        description: 'إنشاء وإرسال إشعار جديد',
        icon: 'notifications',
        color: '#f97316',
        bg: '#ffedd5',
        route: '/send-notification',
        permissions: [PERMISSIONS.SEND_NOTIFICATIONS, PERMISSIONS.MANAGE_NOTIFICATIONS],
      },
    ],
  },

  // 🎟 الحضور وبطاقات الطلاب
  {
    id: 'attendance-cards',
    title: 'الحضور وبطاقات الطلاب',
    icon: 'qr-code',
    tint: '#9333ea',
    items: [
      {
        id: 'take-attendance',
        label: 'تسجيل الحضور',
        description: 'تسجيل الحضور لمحاضرة',
        icon: 'checkbox',
        color: '#16a34a',
        bg: '#dcfce7',
        route: '/take-attendance',
        permissions: [PERMISSIONS.MANAGE_ATTENDANCE, 'record_attendance', 'take_attendance'],
      },
      {
        id: 'qr-scanner',
        label: 'ماسح QR',
        description: 'مسح بطاقات الطلاب الرقمية',
        icon: 'qr-code',
        color: '#9333ea',
        bg: '#f3e8ff',
        route: '/qr-scanner',
        permissions: [PERMISSIONS.MANAGE_ATTENDANCE, 'record_attendance', 'take_attendance'],
      },
      {
        id: 'attendance-approvals',
        label: 'اعتماد تعديلات الحضور',
        description: 'مراجعة واعتماد التعديلات خارج المهلة',
        icon: 'shield-checkmark',
        color: '#ff9800',
        bg: '#fff3d6',
        route: '/attendance-approvals',
        permissions: [PERMISSIONS.APPROVE_ATTENDANCE_CHANGES],
      },
      {
        id: 'my-attendance-requests',
        label: 'طلباتي لتعديل الحضور',
        description: 'تاريخ طلبات الاعتماد التي قدّمتها',
        icon: 'time',
        color: '#0891b2',
        bg: '#cffafe',
        route: '/my-attendance-requests',
        permissions: [PERMISSIONS.EDIT_ATTENDANCE, PERMISSIONS.MANAGE_ATTENDANCE],
      },
    ],
  },

  // ⚙️ إعدادات النظام
  {
    id: 'system',
    title: 'إعدادات النظام',
    icon: 'settings',
    tint: '#475569',
    items: [
      {
        id: 'offline-sync',
        label: 'مزامنة الأوفلاين',
        description: 'مزامنة البيانات المخزّنة محلياً',
        icon: 'cloud-offline',
        color: '#0891b2',
        bg: '#cffafe',
        route: '/offline-sync',
        teacherOnly: true,
      },
      {
        id: 'permissions-tree',
        label: 'شجرة الصلاحيات',
        description: 'عرض جميع الصلاحيات والعلاقات بينها',
        icon: 'git-branch',
        color: '#7c3aed',
        bg: '#ede9fe',
        route: '/permissions',
        permissions: [PERMISSIONS.MANAGE_ROLES],
      },
    ],
  },

  // 🛠 أدوات الصيانة (Admin)
  {
    id: 'maintenance',
    title: 'أدوات الصيانة (مدير النظام)',
    icon: 'construct',
    tint: '#dc2626',
    items: [
      {
        id: 'student-references',
        label: 'الأرقام المرجعية للطلاب',
        description: 'توليد الأرقام المرجعية + اعتماد الرقم المُدخل بدل المُولَّد وتقرير المقارنة',
        icon: 'finger-print',
        color: '#0f766e',
        bg: '#ccfbf1',
        route: '/student-references',
        adminOnly: true,
      },
      {
        id: 'student-autofill',
        label: 'الإدخال التلقائي للطلاب',
        description: 'استيراد وملء بيانات الطلاب آلياً',
        icon: 'cloud-upload',
        color: '#1565c0',
        bg: '#dbeafe',
        route: '/student-autofill',
        adminOnly: true,
      },
      {
        id: 'backfill-lecture-semesters',
        label: 'معالجة بيانات الفصول',
        description: 'تعبئة الفصل الدراسي للمحاضرات القديمة',
        icon: 'sync',
        color: '#f59e0b',
        bg: '#fef3c7',
        route: '/backfill-lecture-semesters',
        adminOnly: true,
      },
      {
        id: 'repair-group-lectures',
        label: 'استعادة محاضرات المجموعات',
        description: 'إرجاع محاضرات المجموعات التي أُلغيت خطأً كـ«مكررة»',
        icon: 'bandage',
        color: '#7c3aed',
        bg: '#ede9fe',
        route: '/repair-group-lectures',
        adminOnly: true,
      },
      {
        id: 'backfill-sections',
        label: 'معالجة الشُعب',
        description: 'تعبئة وتصحيح شُعب الطلاب',
        icon: 'people-circle',
        color: '#0ea5e9',
        bg: '#e0f2fe',
        route: '/backfill-sections',
        adminOnly: true,
      },
      {
        id: 'cleanup-ghost-completions',
        label: 'تنظيف حصص يتيمة',
        description: 'حذف بيانات اكتمال الحصص دون مرجع',
        icon: 'trash-bin',
        color: '#dc2626',
        bg: '#fee2e2',
        route: '/cleanup-ghost-completions',
        adminOnly: true,
      },
      {
        id: 'cleanup-orphan-attendance',
        label: 'تنظيف حضور يتيم',
        description: 'حذف سجلات الحضور دون مرجع',
        icon: 'trash',
        color: '#ef4444',
        bg: '#fee2e2',
        route: '/cleanup-orphan-attendance',
        adminOnly: true,
      },
    ],
  },
];

export default function BasicSettingsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasAnyPermission } = useAuth();
  const { width: winWidth } = useWindowDimensions();
  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';

  // عدد الأعمدة حسب عرض النافذة
  // < 480px (موبايل) = 3 أعمدة، 480-768 = 4، 768-1024 = 5، 1024-1400 = 6، 1400+ = 8
  const cols = winWidth < 480 ? 3 : winWidth < 768 ? 4 : winWidth < 1024 ? 5 : winWidth < 1400 ? 6 : 8;
  const containerMaxWidth = winWidth < 768 ? winWidth : Math.min(1280, winWidth);
  // عرض البلاطة = (container - paddings - gaps) / cols
  const PADDING = 14;
  const GAP = 10;
  const usableW = containerMaxWidth - PADDING * 2;
  const tileWidth = (usableW - GAP * (cols - 1)) / cols;

  const canSeeItem = (item: ToolItem): boolean => {
    if (item.forAll) return true;
    if (item.adminOnly) return !!isAdmin;
    if (item.teacherOnly) return !!isAdmin || !!isTeacher;
    if (isAdmin) return true;
    if (!item.permissions || item.permissions.length === 0) return false;
    return hasAnyPermission(item.permissions);
  };

  // فلترة الأقسام بحيث لا نُظهر إلا التي تحتوي عناصر مرئية للمستخدم
  const visibleSections = useMemo(() => {
    return SECTIONS
      .map(sec => ({ ...sec, items: sec.items.filter(canSeeItem) }))
      .filter(sec => sec.items.length > 0);
  }, [user]);

  const totalItems = visibleSections.reduce((acc, s) => acc + s.items.length, 0);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']} testID="basic-settings-screen">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        <View style={[styles.contentWrap, { maxWidth: containerMaxWidth }]}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconBox}>
            <Ionicons name="settings" size={28} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>الإعدادات الأساسية</Text>
            <Text style={styles.heroSubtitle}>
              {totalItems > 0
                ? `الأدوات الإدارية المتاحة لك • ${totalItems} أداة`
                : 'لا توجد أدوات متاحة بصلاحياتك الحالية'}
            </Text>
          </View>
        </View>

        {visibleSections.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="lock-closed-outline" size={56} color="#cbd5e1" />
            <Text style={styles.emptyTitle}>لا توجد أدوات متاحة</Text>
            <Text style={styles.emptyText}>
              ليست لديك صلاحيات للوصول إلى الأدوات المتقدمة.{'\n'}
              يرجى التواصل مع مدير النظام إن كنت بحاجة لصلاحيات إضافية.
            </Text>
          </View>
        ) : (
          visibleSections.map(section => (
            <View key={section.id} style={styles.section} testID={`section-${section.id}`}>
              {/* Section Header */}
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: `${section.tint}15` }]}>
                  <Ionicons name={section.icon as any} size={18} color={section.tint} />
                </View>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={[styles.sectionCount, { backgroundColor: `${section.tint}15` }]}>
                  <Text style={[styles.sectionCountText, { color: section.tint }]}>
                    {section.items.length}
                  </Text>
                </View>
              </View>

              {/* Items as compact icon grid */}
              <View style={styles.grid}>
                {section.items.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.tile, { width: tileWidth }]}
                    onPress={() => router.push(item.route as any)}
                    activeOpacity={0.75}
                    testID={`tool-${item.id}`}
                  >
                    <View style={[styles.tileIcon, { backgroundColor: item.bg }]}>
                      <Ionicons name={item.icon as any} size={24} color={item.color} />
                    </View>
                    <Text style={styles.tileLabel} numberOfLines={2}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))
        )}

        <View style={{ height: 30 }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  scroll: { flex: 1 },
  scrollContent: { padding: 14, alignItems: 'center' },
  contentWrap: { width: '100%', alignSelf: 'center' },

  /* Hero */
  hero: {
    backgroundColor: '#0f172a',
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 4,
  },
  heroIconBox: {
    width: 54, height: 54, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  heroTitle: { fontSize: 20, fontWeight: '800', color: '#fff', textAlign: 'right' },
  heroSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4, textAlign: 'right' },

  /* Empty */
  emptyCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 40,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginTop: 12 },
  emptyText: { fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 6, lineHeight: 20 },

  /* Section */
  section: { marginBottom: 18 },
  sectionHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  sectionIcon: {
    width: 32, height: 32, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#0f172a', textAlign: 'right' },
  sectionCount: {
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10,
    minWidth: 28, alignItems: 'center',
  },
  sectionCountText: { fontSize: 12, fontWeight: '800' },

  /* Grid — compact icon tiles */
  grid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  tileIcon: {
    width: 52, height: 52, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 8,
  },
  tileLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    lineHeight: 14,
    minHeight: 28,
  },
});
