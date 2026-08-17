import { goBack } from '../src/utils/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import { reportsAPI, teachersAPI } from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface CourseSummary {
  course_id: string;
  course_name: string;
  course_code: string;
  department_name: string;
  level: string;
  section: string;
  students_count: number;
  total_lectures: number;
  held_lectures: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  attendance_rate: number;
}

interface TeacherSummaryReport {
  teacher: {
    id: string;
    full_name: string;
    teacher_id: string;
    phone: string;
    email: string;
  };
  courses: CourseSummary[];
  summary: {
    total_courses: number;
    total_students: number;
    total_lectures: number;
    total_present: number;
    total_absent: number;
    total_late: number;
    overall_attendance_rate: number;
  };
}

export default function ReportTeacherSummary() {
  const { user, token } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [report, setReport] = useState<TeacherSummaryReport | null>(null);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState<string>('');
  const [teacherQuery, setTeacherQuery] = useState('');
  const [showTeacherList, setShowTeacherList] = useState(false);
  const [exporting, setExporting] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.permissions?.includes('view_reports');
  const isTeacher = user?.role === 'teacher';

  const fetchTeachers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await teachersAPI.getAll();
      setTeachers(res.data || []);
    } catch (error) {
      console.error('Error fetching teachers:', error);
    }
  }, [isAdmin]);

  const fetchReport = useCallback(async (teacherId?: string) => {
    try {
      setExecuting(true);
      const params: any = {};
      if (teacherId) params.teacher_id = teacherId;
      const res = await reportsAPI.getTeacherSummary(params);
      setReport(res.data);
      setHasRun(true);
    } catch (error: any) {
      console.error('Error fetching report:', error);
      if (error?.response?.status === 400 && isAdmin && !selectedTeacher) {
        setReport(null);
      } else {
        Alert.alert('خطأ', error?.response?.data?.detail || 'حدث خطأ في تحميل التقرير');
      }
    } finally {
      setExecuting(false);
      setRefreshing(false);
    }
  }, [isAdmin, selectedTeacher]);

  // التحميل الأولي: للمعلم تنفيذ تلقائي، للمدير فقط جلب قائمة المعلمين
  useEffect(() => {
    (async () => {
      if (isAdmin) {
        await fetchTeachers();
        setLoading(false);
      } else {
        await fetchReport();
        setLoading(false);
      }
    })();
  }, []);

  const runReport = () => {
    if (isAdmin) {
      if (!selectedTeacher) {
        Alert.alert('تنبيه', 'اختر المعلم أولاً');
        return;
      }
      fetchReport(selectedTeacher);
    } else {
      fetchReport();
    }
  };

  const onRefresh = useCallback(() => {
    if (!hasRun) return;
    setRefreshing(true);
    if (isAdmin && selectedTeacher) {
      fetchReport(selectedTeacher);
    } else if (!isAdmin) {
      fetchReport();
    } else {
      setRefreshing(false);
    }
  }, [isAdmin, selectedTeacher, hasRun, fetchReport]);

  // قائمة المعلمين المُفلتَرة بالبحث
  const filteredTeachers = teacherQuery.trim()
    ? teachers.filter((t: any) => {
        const q = teacherQuery.trim().toLowerCase();
        return (t.full_name || '').toLowerCase().includes(q) || (t.username || '').toLowerCase().includes(q);
      })
    : teachers;

  const selectedTeacherObj = teachers.find((t: any) => t.id === selectedTeacher);

  const handleExportExcel = async () => {
    try {
      setExporting(true);
      const params: any = {};
      if (selectedTeacher) params.teacher_id = selectedTeacher;
      
      if (Platform.OS === 'web') {
        const url = `${API_URL}/api/export/report/teacher-summary/excel?${new URLSearchParams(params).toString()}`;
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        const xf = response.headers.get('x-filename');
        a.download = xf ? decodeURIComponent(xf) : `teacher_summary.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
      } else {
        Alert.alert('نجاح', 'تم تصدير التقرير بنجاح');
      }
    } catch (error) {
      Alert.alert('خطأ', 'حدث خطأ في تصدير التقرير');
    } finally {
      setExporting(false);
    }
  };

  const getAttendanceColor = (rate: number) => {
    if (rate >= 80) return '#4caf50';
    if (rate >= 60) return '#ff9800';
    return '#f44336';
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']} data-testid="teacher-summary-page">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBack(router)} style={styles.backBtn} data-testid="back-btn" accessibilityLabel="رجوع">
          <Ionicons name="arrow-forward" size={24} color="#1565c0" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ملخص المعلم</Text>
        <TouchableOpacity
          onPress={handleExportExcel}
          disabled={exporting || !report}
          style={[styles.exportBtn, (!report || exporting) && { opacity: 0.5 }]}
          data-testid="export-excel-btn"
          accessibilityLabel="تصدير Excel"
        >
          {exporting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="download-outline" size={20} color="#fff" />
          )}
          <Text style={styles.exportBtnText}>Excel</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Teacher Selector for Admin */}
        {isAdmin && (
          <View style={styles.selectorCard} data-testid="teacher-selector">
            <Text style={[styles.selectorLabel, { fontSize: 13 }]}>المعلم</Text>

            {/* Compact searchable input */}
            <TouchableOpacity
              onPress={() => setShowTeacherList(!showTeacherList)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 }}
              testID="teacher-input"
            >
              <Ionicons name="person-outline" size={16} color="#666" />
              <Text style={{ flex: 1, fontSize: 13, color: selectedTeacherObj ? '#333' : '#999', textAlign: 'right' }}>
                {selectedTeacherObj ? `${selectedTeacherObj.full_name}${selectedTeacherObj.teacher_id ? ` (${selectedTeacherObj.teacher_id})` : ''}` : 'ابحث عن معلم...'}
              </Text>
              <Ionicons name={showTeacherList ? 'chevron-up' : 'chevron-down'} size={16} color="#666" />
            </TouchableOpacity>

            {showTeacherList && (
              <View style={{ marginTop: 8, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0', maxHeight: 280 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#fafafa' }}>
                  <Ionicons name="search" size={14} color="#999" />
                  <TextInput
                    value={teacherQuery}
                    onChangeText={setTeacherQuery}
                    placeholder="ابحث بالاسم أو الرقم..."
                    placeholderTextColor="#aaa"
                    style={{ flex: 1, fontSize: 13, textAlign: 'right', padding: 4 }}
                    autoFocus
                    testID="teacher-search-input"
                  />
                </View>
                <ScrollView style={{ maxHeight: 220 }}>
                  {filteredTeachers.length === 0 ? (
                    <Text style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 12 }}>لا توجد نتائج</Text>
                  ) : (
                    filteredTeachers.slice(0, 50).map((t: any) => (
                      <TouchableOpacity
                        key={t.id}
                        onPress={() => { setSelectedTeacher(t.id); setShowTeacherList(false); setTeacherQuery(''); setReport(null); setHasRun(false); }}
                        style={{ paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f5f5f5', backgroundColor: selectedTeacher === t.id ? '#e3f2fd' : '#fff' }}
                        testID={`teacher-option-${t.id}`}
                      >
                        <Text style={{ fontSize: 13, color: '#333', textAlign: 'right', fontWeight: selectedTeacher === t.id ? '700' : '400' }}>{t.full_name}</Text>
                        {t.teacher_id ? <Text style={{ fontSize: 10, color: '#888', textAlign: 'right' }}>{t.teacher_id}</Text> : null}
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
              </View>
            )}

            {/* زر التنفيذ */}
            <TouchableOpacity
              style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1565c0', paddingVertical: 10, borderRadius: 8, marginTop: 8 }, (executing || !selectedTeacher) && { opacity: 0.6 }]}
              onPress={runReport}
              disabled={executing || !selectedTeacher}
              testID="run-report-btn"
            >
              {executing ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>جاري التنفيذ...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="play" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{hasRun ? 'إعادة التنفيذ' : 'تنفيذ التقرير'}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {executing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1565c0" />
            <Text style={styles.loadingText}>جاري تحميل التقرير...</Text>
          </View>
        ) : !report ? (
          <View style={styles.emptyContainer} data-testid="empty-state">
            <Ionicons name="clipboard-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>
              {isAdmin ? (selectedTeacher ? 'اضغط "تنفيذ التقرير" لعرض البيانات' : 'اختر المعلم أولاً') : 'لا توجد بيانات'}
            </Text>
          </View>
        ) : (
          <>
            {/* Teacher Info */}
            <View style={styles.teacherCard} data-testid="teacher-info-card">
              <View style={styles.teacherAvatar}>
                <Ionicons name="person-circle" size={48} color="#1565c0" />
              </View>
              <View style={styles.teacherInfo}>
                <Text style={styles.teacherName}>{report.teacher.full_name}</Text>
                {report.teacher.teacher_id && (
                  <Text style={styles.teacherDetail}>الرقم الوظيفي: {report.teacher.teacher_id}</Text>
                )}
              </View>
            </View>

            {/* Summary Stats */}
            <View style={styles.summaryGrid} data-testid="summary-stats">
              <View style={[styles.summaryItem, { backgroundColor: '#e3f2fd' }]}>
                <Ionicons name="book" size={24} color="#1565c0" />
                <Text style={styles.summaryNumber}>{report.summary.total_courses}</Text>
                <Text style={styles.summaryLabel}>مقرر</Text>
              </View>
              <View style={[styles.summaryItem, { backgroundColor: '#e8f5e9' }]}>
                <Ionicons name="people" size={24} color="#4caf50" />
                <Text style={styles.summaryNumber}>{report.summary.total_students}</Text>
                <Text style={styles.summaryLabel}>طالب</Text>
              </View>
              <View style={[styles.summaryItem, { backgroundColor: '#fff3e0' }]}>
                <Ionicons name="calendar" size={24} color="#ff9800" />
                <Text style={styles.summaryNumber}>{report.summary.total_lectures}</Text>
                <Text style={styles.summaryLabel}>محاضرة</Text>
              </View>
              <View style={[styles.summaryItem, { backgroundColor: getAttendanceColor(report.summary.overall_attendance_rate) + '20' }]}>
                <Ionicons name="stats-chart" size={24} color={getAttendanceColor(report.summary.overall_attendance_rate)} />
                <Text style={[styles.summaryNumber, { color: getAttendanceColor(report.summary.overall_attendance_rate) }]}>
                  {report.summary.overall_attendance_rate}%
                </Text>
                <Text style={styles.summaryLabel}>نسبة الحضور</Text>
              </View>
            </View>

            {/* Attendance Breakdown */}
            <View style={styles.breakdownCard} data-testid="attendance-breakdown">
              <Text style={styles.sectionTitle}>توزيع الحضور الإجمالي</Text>
              <View style={styles.breakdownRow}>
                <View style={styles.breakdownItem}>
                  <View style={[styles.breakdownDot, { backgroundColor: '#4caf50' }]} />
                  <Text style={styles.breakdownLabel}>حاضر</Text>
                  <Text style={styles.breakdownValue}>{report.summary.total_present}</Text>
                </View>
                <View style={styles.breakdownItem}>
                  <View style={[styles.breakdownDot, { backgroundColor: '#f44336' }]} />
                  <Text style={styles.breakdownLabel}>غائب</Text>
                  <Text style={styles.breakdownValue}>{report.summary.total_absent}</Text>
                </View>
                <View style={styles.breakdownItem}>
                  <View style={[styles.breakdownDot, { backgroundColor: '#ff9800' }]} />
                  <Text style={styles.breakdownLabel}>متأخر</Text>
                  <Text style={styles.breakdownValue}>{report.summary.total_late}</Text>
                </View>
              </View>
            </View>

            {/* Courses List */}
            <View style={styles.section} data-testid="courses-list">
              <Text style={styles.sectionTitle}>المقررات ({report.courses.length})</Text>
              {report.courses.map((course, idx) => (
                <TouchableOpacity
                  key={course.course_id}
                  style={styles.courseCard}
                  onPress={() => router.push(`/report-course?courseId=${course.course_id}`)}
                  data-testid={`course-card-${idx}`}
                >
                  <View style={styles.courseHeader}>
                    <View style={styles.courseNameRow}>
                      <Text style={styles.courseIndex}>{idx + 1}</Text>
                      <View>
                        <Text style={styles.courseName}>{course.course_name}</Text>
                        <Text style={styles.courseCode}>{course.course_code}</Text>
                      </View>
                    </View>
                    <View style={[styles.rateBadge, { backgroundColor: getAttendanceColor(course.attendance_rate) + '20' }]}>
                      <Text style={[styles.rateText, { color: getAttendanceColor(course.attendance_rate) }]}>
                        {course.attendance_rate}%
                      </Text>
                    </View>
                  </View>
                  
                  {course.department_name ? (
                    <Text style={styles.courseDept}>{course.department_name} {course.level ? `- م${course.level}` : ''} {course.section ? `(${course.section})` : ''}</Text>
                  ) : null}
                  
                  <View style={styles.courseStats}>
                    <View style={styles.courseStat}>
                      <Ionicons name="people-outline" size={14} color="#666" />
                      <Text style={styles.courseStatText}>{course.students_count} طالب</Text>
                    </View>
                    <View style={styles.courseStat}>
                      <Ionicons name="calendar-outline" size={14} color="#666" />
                      <Text style={styles.courseStatText}>{course.held_lectures}/{course.total_lectures} محاضرة</Text>
                    </View>
                    <View style={styles.courseStat}>
                      <Ionicons name="checkmark-circle-outline" size={14} color="#4caf50" />
                      <Text style={styles.courseStatText}>{course.present_count}</Text>
                    </View>
                    <View style={styles.courseStat}>
                      <Ionicons name="close-circle-outline" size={14} color="#f44336" />
                      <Text style={styles.courseStatText}>{course.absent_count}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e' },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4caf50',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  exportBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  scrollView: { flex: 1, padding: 16 },
  selectorCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  selectorLabel: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 8 },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  picker: { height: 50 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  loadingText: { marginTop: 12, color: '#666', fontSize: 14 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyText: { marginTop: 12, color: '#999', fontSize: 16 },
  teacherCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  teacherAvatar: { marginLeft: 12 },
  teacherInfo: { flex: 1 },
  teacherName: { fontSize: 18, fontWeight: '700', color: '#1a1a2e' },
  teacherDetail: { fontSize: 13, color: '#666', marginTop: 4 },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  summaryItem: {
    flex: 1,
    minWidth: '22%',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  summaryNumber: { fontSize: 20, fontWeight: '800', color: '#1a1a2e' },
  summaryLabel: { fontSize: 11, color: '#666', fontWeight: '500' },
  breakdownCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 12 },
  breakdownItem: { alignItems: 'center', gap: 4 },
  breakdownDot: { width: 12, height: 12, borderRadius: 6 },
  breakdownLabel: { fontSize: 12, color: '#666' },
  breakdownValue: { fontSize: 16, fontWeight: '700', color: '#333' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 12 },
  courseCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  courseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  courseNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  courseIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    textAlign: 'center',
    lineHeight: 28,
    fontSize: 13,
    fontWeight: '700',
  },
  courseName: { fontSize: 15, fontWeight: '600', color: '#333' },
  courseCode: { fontSize: 12, color: '#999' },
  courseDept: { fontSize: 12, color: '#888', marginBottom: 8, marginRight: 38 },
  rateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  rateText: { fontSize: 14, fontWeight: '700' },
  courseStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 8,
  },
  courseStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  courseStatText: { fontSize: 12, color: '#666' },
});
