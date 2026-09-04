import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { teachersAPI, teachingLoadAPI, coursesAPI } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useAuth, PERMISSIONS } from '../src/contexts/AuthContext';

interface Course {
  id: string;
  name: string;
  code: string;
  level: number;
  section: string;
  department_id: string;
  department_name: string;
  faculty_name: string;
  students_count: number;
  lectures_count: number;
  weekly_hours?: number;
  teaching_load_id?: string;
  is_active: boolean;
}

interface TeacherCoursesData {
  teacher_id: string;
  teacher_name: string;
  total_courses: number;
  total_weekly_hours: number;
  semester_id?: string;
  semester_name?: string;
  courses: Course[];
}

interface AvailableCourse {
  course_id: string;
  course_name: string;
  course_code: string;
  section: string;
  level: number;
  credit_hours: number;
  weekly_hours?: number | null;
  department_id?: string;
  department_name?: string;
  faculty_id?: string;
  faculty_name?: string;
  semester_id?: string;
  current_teacher_name?: string;
}

export default function TeacherCoursesScreen() {
  const { teacherId, teacherName } = useLocalSearchParams<{ teacherId: string; teacherName?: string }>();
  const router = useRouter();

  // 🔒 صلاحيات إسناد المقررات للمعلمين
  const { hasPermission, user } = useAuth();
  const canAssign = hasPermission(PERMISSIONS.MANAGE_TEACHING_LOAD);
  const userRole = (user as any)?.role;
  const isAdmin = userRole === 'admin' || userRole === 'university_president';
  // 🔒 ملكية القسم/الكلية: ندعم multi-department (department_ids) و multi-faculty (faculty_ids)
  const userDeptIds: string[] = Array.isArray((user as any)?.department_ids) && (user as any).department_ids.length > 0
    ? (user as any).department_ids.map((d: any) => String(d))
    : ((user as any)?.department_id ? [String((user as any).department_id)] : []);
  const userFacultyIds: string[] = Array.isArray((user as any)?.faculty_ids) && (user as any).faculty_ids.length > 0
    ? (user as any).faculty_ids.map((f: any) => String(f))
    : ((user as any)?.faculty_id ? [String((user as any).faculty_id)] : []);
  const canManageCourse = (course: any): boolean => {
    if (isAdmin) return true;
    if (!canAssign) return false;
    // إن لم يكن للمستخدم نطاق (لا قسم ولا كلية) فهو global
    if (userDeptIds.length === 0 && userFacultyIds.length === 0) return true;
    const courseDeptId = course?.department_id ? String(course.department_id) : '';
    const courseFacultyId = course?.faculty_id ? String(course.faculty_id) : '';
    // إذا كان لدى المستخدم أقسام: يكفي أن يكون المقرر تابعاً لأحد أقسامه
    if (userDeptIds.length > 0 && courseDeptId && userDeptIds.includes(courseDeptId)) return true;
    // وإذا كان لدى المستخدم كليات: يكفي أن يكون المقرر تابعاً لأحد كلياته
    if (userFacultyIds.length > 0 && courseFacultyId && userFacultyIds.includes(courseFacultyId)) return true;
    return false;
  };

  const [data, setData] = useState<TeacherCoursesData | null>(null);
  const [teacherPhone, setTeacherPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [teacherDept, setTeacherDept] = useState<string>('');

  // Assign Modal State
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AvailableCourse[]>([]);
  const [pickedCourses, setPickedCourses] = useState<Record<string, { course: AvailableCourse; hours: string }>>({});
  const [saving, setSaving] = useState(false);
  const [hideAssignedToOthers, setHideAssignedToOthers] = useState(true);

  // Unassign confirmation
  const [unassignTarget, setUnassignTarget] = useState<Course | null>(null);
  const [unassigning, setUnassigning] = useState(false);

  // Exporting PDF
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  // 🔧 عرض كل الفصول (للأرشيف) — افتراضياً يعرض الفصل النشط فقط
  const [showAllSemesters, setShowAllSemesters] = useState(false);

  const showMessage = (title: string, message: string) => {
    if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  const fetchCourses = useCallback(async () => {
    if (!teacherId) return;
    try {
      // 🛡️ Promise.allSettled: لو فشل أي API (مثلاً 403/404)، الصفحة لا تنهار
      const [coursesRes, teacherRes] = await Promise.allSettled([
        teachersAPI.getCourses(teacherId, showAllSemesters ? { include_all: true } : undefined),
        teachersAPI.getById(teacherId),
      ]);
      if (coursesRes.status === 'fulfilled') {
        setData(coursesRes.value.data);
      } else {
        console.warn('Failed to fetch teacher courses:', coursesRes.reason);
        setData(null);
      }
      if (teacherRes.status === 'fulfilled') {
        setTeacherPhone(teacherRes.value.data?.phone || '');
      }
      if (teacherRes.status === 'rejected') {
        console.warn('Failed to fetch teacher details:', teacherRes.reason);
      }
    } catch (error) {
      console.error('Error fetching teacher courses:', error);
    } finally {
      setLoading(false);
    }
  }, [teacherId, showAllSemesters]);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  // Debounced search
  useEffect(() => {
    if (!showAssignModal) return;
    const handle = setTimeout(async () => {
      if (!searchQuery && !showAssignModal) return;
      setSearching(true);
      try {
        const res = await teachingLoadAPI.searchCourses(searchQuery || '');
        const currentTeacherName = data?.teacher_name || '';
        const currentCourseIds = new Set((data?.courses || []).map(c => c.id));
        const filtered: AvailableCourse[] = (res.data || []).filter((c: AvailableCourse) => {
          if (currentCourseIds.has(c.course_id)) return false;
          if (hideAssignedToOthers && c.current_teacher_name && c.current_teacher_name !== currentTeacherName) return false;
          return true;
        });
        setSearchResults(filtered);
      } catch (e) {
        console.error('Search error:', e);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [searchQuery, showAssignModal, data, hideAssignedToOthers]);

  const openAssignModal = () => {
    setSearchQuery('');
    setPickedCourses({});
    setSearchResults([]);
    setShowAssignModal(true);
  };

  const togglePick = (course: AvailableCourse) => {
    setPickedCourses(prev => {
      const copy = { ...prev };
      if (copy[course.course_id]) {
        delete copy[course.course_id];
      } else {
        const defaultHours = course.weekly_hours ?? course.credit_hours ?? 3;
        copy[course.course_id] = { course, hours: String(defaultHours) };
      }
      return copy;
    });
  };

  const updateHours = (courseId: string, val: string) => {
    setPickedCourses(prev => {
      if (!prev[courseId]) return prev;
      return { ...prev, [courseId]: { ...prev[courseId], hours: val.replace(/[^0-9.]/g, '') } };
    });
  };

  const handleSaveAssignments = async () => {
    const items = Object.values(pickedCourses).map(p => ({
      teacher_id: teacherId!,
      course_id: p.course.course_id,
      weekly_hours: parseFloat(p.hours) || (p.course.credit_hours || 3),
      semester_id: data?.semester_id || p.course.semester_id,
    }));
    if (items.length === 0) {
      showMessage('تنبيه', 'الرجاء اختيار مقرر واحد على الأقل');
      return;
    }
    setSaving(true);
    try {
      const res = await teachingLoadAPI.bulkSave(items);
      showMessage('نجاح', res.data?.message || `تم إسناد ${items.length} مقرر بنجاح`);
      setShowAssignModal(false);
      await fetchCourses();
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'فشل في إسناد المقررات';
      showMessage('خطأ', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleExportPdf = async () => {
    if (!teacherId) return;
    if ((data?.courses?.length || 0) === 0) {
      showMessage('تنبيه', 'لا توجد مقررات مسندة لتصديرها');
      return;
    }
    setExportingPdf(true);
    try {
      const params: any = { teacher_id: teacherId };
      if (data?.semester_id) params.semester_id = data.semester_id;
      const res = await teachingLoadAPI.exportPDF(params);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      if (Platform.OS === 'web') {
        const a = document.createElement('a');
        a.href = url;
        a.download = `teacher_workload_${(data?.teacher_name || teacherDisplay || 'teacher').replace(/\s+/g, '_')}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'فشل تصدير PDF';
      showMessage('خطأ', msg);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportExcel = async () => {
    if (!teacherId) return;
    if ((data?.courses?.length || 0) === 0) {
      showMessage('تنبيه', 'لا توجد مقررات مسندة لتصديرها');
      return;
    }
    setExportingExcel(true);
    try {
      const params: any = { teacher_id: teacherId };
      if (data?.semester_id) params.semester_id = data.semester_id;
      const res = await teachingLoadAPI.exportExcel(params);
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      if (Platform.OS === 'web') {
        const a = document.createElement('a');
        a.href = url;
        a.download = `teacher_workload_${(data?.teacher_name || teacherDisplay || 'teacher').replace(/\s+/g, '_')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'فشل تصدير Excel';
      showMessage('خطأ', msg);
    } finally {
      setExportingExcel(false);
    }
  };


  const handleUnassign = async () => {
    if (!unassignTarget) return;
    setUnassigning(true);
    try {
      if (unassignTarget.teaching_load_id) {
        // إلغاء الإسناد في الفصل الحالي فقط (لا يؤثر على الفصول السابقة)
        await teachingLoadAPI.delete(unassignTarget.teaching_load_id);
      } else {
        // fallback: إزالة المعلم من المقرر (سلوك قديم)
        await coursesAPI.update(unassignTarget.id, { teacher_id: null });
      }
      showMessage('نجاح', `تم إلغاء إسناد المقرر "${unassignTarget.name}"`);
      setUnassignTarget(null);
      await fetchCourses();
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'فشل في إلغاء الإسناد';
      showMessage('خطأ', msg);
    } finally {
      setUnassigning(false);
    }
  };

  const totalStudents = useMemo(
    () => (data?.courses || []).reduce((sum, c) => sum + (c.students_count || 0), 0),
    [data]
  );
  const totalLectures = useMemo(
    () => (data?.courses || []).reduce((sum, c) => sum + (c.lectures_count || 0), 0),
    [data]
  );

  if (loading) return <LoadingScreen />;

  const teacherDisplay = teacherName || data?.teacher_name || 'المعلم';
  const pickedCount = Object.keys(pickedCourses).length;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: `مقررات ${teacherDisplay}`,
          headerBackTitle: 'رجوع',
        }}
      />
      <ScrollView
        dataSet={{ responsiveScrollRoot: 'true' }}
        style={{ flex: 1 }}
        contentContainerStyle={styles.pageScroll}
        showsVerticalScrollIndicator={false}
      >
        {/* رأس الصفحة */}
        <View dataSet={{ responsive: 'page-header' }} style={styles.pageHeader}>
          <View style={styles.pageHeaderRight}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
              <Text dataSet={{ responsive: 'page-title' }} style={styles.pageTitle}>مقررات {teacherDisplay}</Text>
              {!!data?.semester_name && (
                <View style={styles.semesterBadge}>
                  <Ionicons name="calendar" size={11} color="#2962ff" />
                  <Text style={styles.semesterBadgeText}>{data.semester_name}</Text>
                </View>
              )}
              {/* 🔧 زر تبديل عرض كل الفصول */}
              <TouchableOpacity
                onPress={() => setShowAllSemesters(v => !v)}
                style={[styles.semesterBadge, showAllSemesters && { backgroundColor: '#fef3c7', borderColor: '#f59e0b' }]}
                testID="toggle-all-semesters-btn"
              >
                <Ionicons name={showAllSemesters ? 'archive' : 'archive-outline'} size={11} color={showAllSemesters ? '#92400e' : '#1565c0'} />
                <Text style={[styles.semesterBadgeText, showAllSemesters && { color: '#92400e' }]}>
                  {showAllSemesters ? 'كل الفصول (أرشيف)' : 'الفصل النشط فقط'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.breadcrumb}>
              <TouchableOpacity onPress={() => router.replace('/')}>
                <Text style={styles.breadcrumbLink}>الرئيسية</Text>
              </TouchableOpacity>
              <Ionicons name="chevron-back" size={12} color="#8a95a8" />
              <TouchableOpacity onPress={() => router.replace('/manage-teachers')}>
                <Text style={styles.breadcrumbLink}>المعلمون</Text>
              </TouchableOpacity>
              <Ionicons name="chevron-back" size={12} color="#8a95a8" />
              <Text style={styles.breadcrumbCurrent}>المقررات</Text>
            </View>
          </View>
          <View dataSet={{ responsive: 'page-header-actions' }} style={styles.pageHeaderActions}>
            <TouchableOpacity
              style={[styles.headerBtn, styles.btnGhost]}
              onPress={() => router.back()}
              testID="back-btn"
            >
              <Ionicons name="arrow-forward" size={16} color="#1a2540" />
              <Text style={styles.btnGhostText}>رجوع</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerBtn, styles.btnExportExcel, ((data?.courses?.length || 0) === 0 || exportingExcel) && { opacity: 0.5 }]}
              onPress={handleExportExcel}
              disabled={(data?.courses?.length || 0) === 0 || exportingExcel}
              testID="export-excel-btn"
            >
              {exportingExcel ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="grid" size={16} color="#fff" />
              )}
              <Text style={styles.btnPrimaryText}>{exportingExcel ? 'جاري التصدير...' : 'تصدير Excel'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerBtn, styles.btnExport, ((data?.courses?.length || 0) === 0 || exportingPdf) && { opacity: 0.5 }]}
              onPress={handleExportPdf}
              disabled={(data?.courses?.length || 0) === 0 || exportingPdf}
              testID="export-pdf-btn"
            >
              {exportingPdf ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="document-text" size={16} color="#fff" />
              )}
              <Text style={styles.btnPrimaryText}>{exportingPdf ? 'جاري التصدير...' : 'تصدير PDF'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerBtn, styles.btnPrimary, !canAssign && { opacity: 0.4 }]}
              onPress={() => { if (!canAssign) { showMessage('غير مصرح', 'ليس لديك صلاحية إسناد المقررات'); return; } openAssignModal(); }}
              disabled={!canAssign}
              testID="assign-course-btn"
            >
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.btnPrimaryText}>إسناد مقرر</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* بطاقة المعلم */}
        <View style={styles.teacherCard}>
          <View style={styles.teacherAvatar}>
            <Text style={styles.teacherAvatarText}>{(data?.teacher_name || teacherDisplay).charAt(0)}</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={styles.teacherCardName}>{data?.teacher_name || teacherDisplay}</Text>
              {!!teacherPhone && (
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: '#e8f5e9', borderRadius: 12, paddingVertical: 3, paddingHorizontal: 10 }} testID="teacher-phone-badge">
                  <Text style={{ fontSize: 12, color: '#2e7d32', fontWeight: '800' }}>📞 {teacherPhone}</Text>
                </View>
              )}
            </View>
            <View style={styles.teacherCardSubRow}>
              <Text style={styles.teacherCardSub}>يدرّس {data?.total_courses || 0} مقرر</Text>
              <View style={styles.teacherCardDot} />
              <Text style={styles.teacherCardSub}>إجمالي الساعات: </Text>
              <Text style={styles.teacherHoursValue} testID="total-weekly-hours">{data?.total_weekly_hours || 0}</Text>
              <Text style={styles.teacherCardSub}> س/أسبوع</Text>
            </View>
          </View>
          <View style={styles.teacherIconBg}>
            <Ionicons name="person" size={32} color="#2962ff" />
          </View>
        </View>

        {/* بطاقات الإحصائيات */}
        <View dataSet={{ responsive: 'stats-grid' }} style={styles.statsGrid}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#4caf50' }]}>
              <Ionicons name="book" size={22} color="#fff" />
            </View>
            <View style={styles.statTextCol}>
              <Text style={styles.statLabel}>إجمالي المقررات</Text>
              <Text style={styles.statValue}>{data?.total_courses || 0}</Text>
              <Text style={styles.statSubLabel}>مقرر مسند</Text>
            </View>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#29b6f6' }]}>
              <Ionicons name="people" size={22} color="#fff" />
            </View>
            <View style={styles.statTextCol}>
              <Text style={styles.statLabel}>إجمالي الطلاب</Text>
              <Text style={styles.statValue}>{totalStudents}</Text>
              <Text style={styles.statSubLabel}>طالب مسجل</Text>
            </View>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#ff9800' }]}>
              <Ionicons name="calendar" size={22} color="#fff" />
            </View>
            <View style={styles.statTextCol}>
              <Text style={styles.statLabel}>إجمالي المحاضرات</Text>
              <Text style={styles.statValue}>{totalLectures}</Text>
              <Text style={styles.statSubLabel}>محاضرة</Text>
            </View>
          </View>
        </View>

        {/* قائمة المقررات */}
        <View style={styles.coursesCard}>
          <View style={styles.coursesCardHeader}>
            <Text style={styles.coursesCardTitle}>المقررات المُسندة</Text>
            <Text style={styles.coursesCardCount}>
              <Text style={styles.coursesCountAccent}>{data?.courses?.length || 0}</Text> مقرر
            </Text>
          </View>

          {!data?.courses || data.courses.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="book-outline" size={56} color="#cfd6e1" />
              <Text style={styles.emptyText}>لا توجد مقررات مسندة لهذا المعلم</Text>
              <TouchableOpacity style={[styles.headerBtn, styles.btnPrimary, { marginTop: 14 }, !canAssign && { opacity: 0.4 }]} onPress={() => { if (!canAssign) { showMessage('غير مصرح', 'ليس لديك صلاحية إسناد المقررات'); return; } openAssignModal(); }} disabled={!canAssign}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.btnPrimaryText}>إسناد أول مقرر</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.coursesList}>
              {data.courses.map((course) => {
                const isOwned = canManageCourse(course);
                return (
                <View key={course.id} style={styles.courseRow}>
                  <TouchableOpacity
                    style={styles.courseMain}
                    onPress={() => {
                      // 🔒 منع فتح مقرر من قسم آخر للتحكم به (تحرير/حذف/توليد محاضرات)
                      if (!isOwned && !isAdmin) {
                        showMessage('للعرض فقط', 'هذا المقرر تابع لقسم آخر. لا يمكنك التحكم فيه (تحرير/حذف/توليد محاضرات).');
                        return;
                      }
                      router.push({
                        pathname: '/course-lectures',
                        params: { courseId: course.id, courseName: course.name },
                      });
                    }}
                    testID={`course-card-${course.id}`}
                  >
                    <View style={styles.courseIconBox}>
                      <Ionicons name="book" size={22} color="#2962ff" />
                    </View>
                    <View style={styles.courseInfo}>
                      <View style={styles.courseTitleRow}>
                        <Text style={styles.courseName} numberOfLines={1}>{course.name}</Text>
                        <Text style={styles.courseCode}>{course.code || '—'}</Text>
                      </View>

                      <View style={styles.metaRow}>
                        {!!course.faculty_name && (
                          <View style={styles.metaItem}>
                            <Ionicons name="business-outline" size={13} color="#5b6678" />
                            <Text style={styles.metaText}>{course.faculty_name}</Text>
                          </View>
                        )}
                        {!!course.department_name && (
                          <View style={styles.metaItem}>
                            <Ionicons name="library-outline" size={13} color="#5b6678" />
                            <Text style={styles.metaText}>{course.department_name}</Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.metaRow}>
                        <View style={[styles.badge, styles.badgeLevel]}>
                          <Text style={styles.badgeText}>المستوى {course.level}</Text>
                        </View>
                        {!!course.section && (
                          <View style={[styles.badge, styles.badgeSection]}>
                            <Text style={styles.badgeText}>شعبة {course.section}</Text>
                          </View>
                        )}
                        <View style={[styles.badge, styles.badgeLectures]}>
                          <Ionicons name="calendar-outline" size={11} color="#e65100" />
                          <Text style={[styles.badgeText, { color: '#e65100' }]}>{course.lectures_count} محاضرة</Text>
                        </View>
                        <View style={[styles.badge, styles.badgeStudents]}>
                          <Ionicons name="people-outline" size={11} color="#2e7d32" />
                          <Text style={[styles.badgeText, { color: '#2e7d32' }]}>{course.students_count} طالب</Text>
                        </View>
                      </View>
                    </View>
                    <Ionicons name="chevron-back" size={20} color="#c0c8d4" />
                  </TouchableOpacity>

                  {canAssign && canManageCourse(course) ? (
                    <View style={styles.courseActions}>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionUnassign]}
                        onPress={() => setUnassignTarget(course)}
                        testID={`unassign-btn-${course.id}`}
                      >
                        <Ionicons name="close-circle-outline" size={14} color="#f44336" />
                        <Text style={styles.actionUnassignText}>إلغاء الإسناد</Text>
                      </TouchableOpacity>
                    </View>
                  ) : canAssign && !canManageCourse(course) ? (
                    <View style={styles.courseActions}>
                      <View style={[styles.actionBtn, { backgroundColor: '#fff8e1', borderColor: '#ffe082' }]}>
                        <Ionicons name="lock-closed" size={12} color="#ff8f00" />
                        <Text style={{ fontSize: 11, color: '#e65100', fontWeight: '700', marginRight: 4 }}>
                          من قسم آخر
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* مودال إسناد مقرر */}
      <Modal visible={showAssignModal} transparent animationType="fade" onRequestClose={() => setShowAssignModal(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowAssignModal(false)} />
          <View style={styles.assignModalCard}>
            <View style={styles.assignModalHeader}>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={styles.assignModalTitle}>إسناد مقررات للمعلم</Text>
                <Text style={styles.assignModalSubtitle}>{data?.teacher_name || teacherDisplay}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAssignModal(false)} testID="close-assign-modal">
                <Ionicons name="close" size={22} color="#5b6678" />
              </TouchableOpacity>
            </View>

            {/* البحث */}
            <View style={styles.modalSearchBox}>
              <Ionicons name="search" size={16} color="#8a95a8" />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="ابحث عن مقرر بالاسم أو الكود..."
                placeholderTextColor="#a8b1c2"
                value={searchQuery}
                onChangeText={setSearchQuery}
                testID="course-search-input"
              />
              {searching && <ActivityIndicator size="small" color="#2962ff" />}
            </View>

            {/* فلتر */}
            <TouchableOpacity
              style={styles.filterToggle}
              onPress={() => setHideAssignedToOthers(v => !v)}
            >
              <Ionicons
                name={hideAssignedToOthers ? 'checkbox' : 'square-outline'}
                size={16}
                color={hideAssignedToOthers ? '#2962ff' : '#8a95a8'}
              />
              <Text style={styles.filterToggleText}>إخفاء المقررات المسندة لمعلمين آخرين</Text>
            </TouchableOpacity>

            {/* القائمة */}
            <ScrollView style={styles.modalListContainer} contentContainerStyle={{ paddingBottom: 8 }}>
              {searchResults.length === 0 ? (
                <View style={styles.modalEmpty}>
                  <Ionicons name="search-outline" size={36} color="#cfd6e1" />
                  <Text style={styles.modalEmptyText}>
                    {searching ? 'جاري البحث...' : 'ابدأ بكتابة اسم المقرر للبحث'}
                  </Text>
                </View>
              ) : (
                searchResults.map((course) => {
                  const isPicked = !!pickedCourses[course.course_id];
                  const isAssignedToOther = course.current_teacher_name && course.current_teacher_name !== (data?.teacher_name || teacherDisplay);
                  return (
                    <View key={course.course_id} style={[styles.searchResultRow, isPicked && styles.searchResultRowActive]}>
                      <TouchableOpacity
                        style={{ flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}
                        onPress={() => togglePick(course)}
                        testID={`pick-course-${course.course_id}`}
                      >
                        <Ionicons
                          name={isPicked ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={isPicked ? '#2962ff' : '#a8b1c2'}
                        />
                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                            <Text style={styles.resultName} numberOfLines={1}>{course.course_name}</Text>
                            <Text style={styles.resultCode}>{course.course_code}</Text>
                          </View>
                          <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                            <Text style={styles.resultMeta}>المستوى {course.level}</Text>
                            {!!course.section && <Text style={styles.resultMeta}>شعبة {course.section}</Text>}
                            {!!course.faculty_name && (
                              <View style={styles.deptBadge} data-testid={`course-faculty-${course.course_id}`}>
                                <Ionicons name="business" size={10} color="#1565c0" />
                                <Text style={styles.deptBadgeText}>{course.faculty_name}</Text>
                              </View>
                            )}
                            {!!course.department_name && (
                              <View style={[styles.deptBadge, { backgroundColor: '#f3e8ff', borderColor: '#c084fc' }]} data-testid={`course-dept-${course.course_id}`}>
                                <Ionicons name="school" size={10} color="#7c3aed" />
                                <Text style={[styles.deptBadgeText, { color: '#7c3aed' }]}>{course.department_name}</Text>
                              </View>
                            )}
                            {isAssignedToOther && (
                              <Text style={[styles.resultMeta, { color: '#f44336' }]}>
                                مسند حالياً لـ {course.current_teacher_name}
                              </Text>
                            )}
                          </View>
                        </View>
                      </TouchableOpacity>
                      {isPicked && (
                        <View style={styles.hoursWrap}>
                          <TextInput
                            style={styles.hoursInput}
                            value={pickedCourses[course.course_id].hours}
                            onChangeText={(v) => updateHours(course.course_id, v)}
                            keyboardType="numeric"
                            placeholder="ساعات"
                          />
                          <Text style={styles.hoursLabel}>س/أسبوع</Text>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </ScrollView>

            {/* footer */}
            <View style={styles.assignFooter}>
              <Text style={styles.pickedCountText}>
                المختار: <Text style={styles.pickedCountAccent}>{pickedCount}</Text> مقرر
              </Text>
              <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                <TouchableOpacity
                  style={[styles.headerBtn, styles.btnGhost]}
                  onPress={() => setShowAssignModal(false)}
                  disabled={saving}
                >
                  <Text style={styles.btnGhostText}>إلغاء</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.headerBtn, styles.btnPrimary, (saving || pickedCount === 0) && { opacity: 0.6 }]}
                  onPress={handleSaveAssignments}
                  disabled={saving || pickedCount === 0}
                  testID="save-assignments-btn"
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={16} color="#fff" />
                      <Text style={styles.btnPrimaryText}>حفظ الإسناد</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* مودال تأكيد إلغاء الإسناد */}
      <Modal visible={!!unassignTarget} transparent animationType="fade" onRequestClose={() => setUnassignTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmCard}>
            <Ionicons name="warning" size={36} color="#f44336" style={{ alignSelf: 'center', marginBottom: 10 }} />
            <Text style={styles.confirmTitle}>إلغاء إسناد المقرر</Text>
            <Text style={styles.confirmText}>
              {`هل أنت متأكد من إلغاء إسناد المقرر "${unassignTarget?.name || ''}" من المعلم؟`}
            </Text>
            <Text style={styles.confirmNote}>
              لن يتم حذف المقرر، لكنه سيصبح بدون معلم مسند.
            </Text>
            <View style={{ flexDirection: 'row-reverse', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnGhost, { flex: 1, justifyContent: 'center' }]}
                onPress={() => setUnassignTarget(null)}
                disabled={unassigning}
              >
                <Text style={styles.btnGhostText}>تراجع</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.headerBtn, { backgroundColor: '#f44336', flex: 1, justifyContent: 'center' }, unassigning && { opacity: 0.6 }]}
                onPress={handleUnassign}
                disabled={unassigning}
                testID="confirm-unassign-btn"
              >
                {unassigning ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.btnPrimaryText}>تأكيد الإلغاء</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fb' },

  pageScroll: { padding: 20, paddingBottom: 60, maxWidth: 1440, width: '100%', alignSelf: 'center' },
  pageHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 },
  pageHeaderRight: { alignItems: 'flex-end' },
  pageTitle: { fontSize: 24, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 6 },
  semesterBadge: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: '#e7f0fe', borderWidth: 1, borderColor: '#bdd4fd',
    marginBottom: 6,
  },
  semesterBadgeText: { fontSize: 11, color: '#1565c0', fontWeight: '700' },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  breadcrumbLink: { fontSize: 13, color: '#2962ff', fontWeight: '500' },
  breadcrumbCurrent: { fontSize: 13, color: '#8a95a8', fontWeight: '500' },
  pageHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8 },
  btnPrimary: { backgroundColor: '#2962ff' },
  btnExport: { backgroundColor: '#e53935' },
  btnExportExcel: { backgroundColor: '#1b7d3f' },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee' },
  btnGhostText: { color: '#1a2540', fontSize: 13, fontWeight: '600' },

  // بطاقة المعلم
  teacherCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    marginBottom: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: '#eef1f6',
  },
  teacherIconBg: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#e7f0fe',
    alignItems: 'center', justifyContent: 'center',
  },
  teacherAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#2962ff',
    alignItems: 'center', justifyContent: 'center',
  },
  teacherAvatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  teacherCardName: { fontSize: 18, fontWeight: '700', color: '#1a2540', textAlign: 'right' },
  teacherCardSub: { fontSize: 13, color: '#8a95a8', marginTop: 4, textAlign: 'right' },
  teacherCardSubRow: { flexDirection: 'row-reverse', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' },
  teacherCardDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#cfd6e1', marginHorizontal: 8 },
  teacherHoursValue: { fontSize: 14, fontWeight: '700', color: '#2962ff' },

  // إحصائيات
  statsGrid: { flexDirection: 'row', gap: 14, marginBottom: 18, flexWrap: 'wrap' },
  statCard: { flex: 1, minWidth: 200, backgroundColor: '#fff', borderRadius: 14, padding: 18, flexDirection: 'row-reverse', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#eef1f6' },
  statIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  statTextCol: { flex: 1, alignItems: 'flex-end' },
  statLabel: { fontSize: 13, color: '#8a95a8', fontWeight: '500', marginBottom: 4 },
  statValue: { fontSize: 22, color: '#1a2540', fontWeight: '700', marginBottom: 2 },
  statSubLabel: { fontSize: 11, color: '#a8b1c2' },

  // بطاقة المقررات
  coursesCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#eef1f6' },
  coursesCardHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  coursesCardTitle: { fontSize: 15, fontWeight: '700', color: '#1a2540' },
  coursesCardCount: { fontSize: 12, color: '#5b6678' },
  coursesCountAccent: { color: '#2962ff', fontWeight: '700' },

  coursesList: { padding: 14, gap: 10 },
  courseRow: {
    backgroundColor: '#fafbfd',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#eef1f6',
  },
  courseMain: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  courseIconBox: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: '#e7f0fe',
    alignItems: 'center', justifyContent: 'center',
  },
  courseInfo: { flex: 1, alignItems: 'flex-end', gap: 6 },
  courseTitleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  courseName: { fontSize: 15, fontWeight: '700', color: '#1a2540', textAlign: 'right' },
  courseCode: { fontSize: 12, color: '#8a95a8', fontWeight: '500' },

  metaRow: { flexDirection: 'row-reverse', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  metaItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: '#5b6678' },

  badge: { flexDirection: 'row-reverse', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#1565c0' },
  badgeLevel: { backgroundColor: '#e7f0fe' },
  badgeSection: { backgroundColor: '#f3e5f5' },
  badgeLectures: { backgroundColor: '#fff3e0' },
  badgeStudents: { backgroundColor: '#e8f5e9' },

  courseActions: { flexDirection: 'row-reverse', justifyContent: 'flex-end', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#eef1f6' },
  actionBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  actionUnassign: { backgroundColor: '#ffebee' },
  actionUnassignText: { fontSize: 12, color: '#f44336', fontWeight: '600' },

  emptyState: { alignItems: 'center', paddingVertical: 50, gap: 12 },
  emptyText: { fontSize: 14, color: '#8a95a8' },

  // مودال الإسناد
  modalOverlay: { flex: 1, backgroundColor: 'rgba(20,30,55,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  assignModalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 640,
    maxHeight: '85%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#eef1f6',
  },
  assignModalHeader: { flexDirection: 'row-reverse', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  assignModalTitle: { fontSize: 16, fontWeight: '700', color: '#1a2540' },
  assignModalSubtitle: { fontSize: 12, color: '#8a95a8', marginTop: 3 },

  modalSearchBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: '#fafbfd', borderRadius: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e3e7ee', height: 42, marginHorizontal: 16, marginTop: 12 },
  modalSearchInput: { flex: 1, fontSize: 13, color: '#1a2540', textAlign: 'right', outlineStyle: 'none' as any },

  filterToggle: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  filterToggleText: { fontSize: 12, color: '#5b6678' },

  modalListContainer: { maxHeight: 360, paddingHorizontal: 16 },
  modalEmpty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  modalEmptyText: { fontSize: 13, color: '#8a95a8' },

  searchResultRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fafbfd',
    borderWidth: 1,
    borderColor: '#eef1f6',
    marginBottom: 8,
  },
  searchResultRowActive: { backgroundColor: '#e7f0fe', borderColor: '#2962ff' },
  resultName: { fontSize: 13, fontWeight: '700', color: '#1a2540' },
  resultCode: { fontSize: 11, color: '#8a95a8' },
  resultMeta: { fontSize: 11, color: '#5b6678' },
  deptBadge: { flexDirection: 'row-reverse', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: '#e3f2fd', borderWidth: 1, borderColor: '#90caf9' },
  deptBadgeText: { fontSize: 10, color: '#1565c0', fontWeight: '700' },

  hoursWrap: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  hoursInput: {
    width: 56, height: 32, borderRadius: 6, borderWidth: 1, borderColor: '#2962ff',
    backgroundColor: '#fff', textAlign: 'center', fontSize: 13, color: '#1a2540',
    outlineStyle: 'none' as any,
  },
  hoursLabel: { fontSize: 10, color: '#8a95a8' },

  assignFooter: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderTopWidth: 1, borderTopColor: '#eef1f6', backgroundColor: '#fafbfd',
    flexWrap: 'wrap', gap: 10,
  },
  pickedCountText: { fontSize: 13, color: '#5b6678' },
  pickedCountAccent: { color: '#2962ff', fontWeight: '700' },

  // مودال التأكيد
  confirmCard: { backgroundColor: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 420 },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: '#1a2540', textAlign: 'center', marginBottom: 10 },
  confirmText: { fontSize: 13, color: '#5b6678', textAlign: 'center', lineHeight: 22 },
  confirmNote: { fontSize: 12, color: '#8a95a8', textAlign: 'center', marginTop: 8, fontStyle: 'italic' },
});
