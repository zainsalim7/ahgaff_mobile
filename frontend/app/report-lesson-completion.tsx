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
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import api, { departmentsAPI } from '../src/services/api';

interface CourseCompletion {
  course_id: string;
  course_name: string;
  course_code: string;
  teacher_name: string;
  planned_topics: number;
  has_plan: boolean;
  total_lectures: number;
  completed_lectures: number;
  lessons_with_title: number;
  lessons_without_title: number;
  topics_completed?: number;
  topics_linked_via_lecture?: number;
  topics_manually_confirmed?: number;
  completion_percent: number;
  completed_lessons?: Array<{ lesson_title: string; date: string; plan_topic_id?: string }>;
}

interface ComparisonRow {
  week_number?: number;
  topic_id: string;
  planned_title: string;
  completed: boolean;
  actual_title?: string | null;
  actual_date?: string | null;
  source?: string | null;
  lecture_id?: string | null;
}

interface ComparisonData {
  course_name: string;
  course_code: string;
  teacher_name: string;
  total_planned: number;
  total_completed: number;
  matched_count: number;
  manually_confirmed_count?: number;
  unmatched_count: number;
  comparison: ComparisonRow[];
  unlinked_lessons: Array<{ lecture_id?: string; date: string; lesson_title: string; notes?: string }>;
}

export default function LessonCompletionReport() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<CourseCompletion[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState('');
  const [coursesInDept, setCoursesInDept] = useState<any[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [reportRun, setReportRun] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [planData, setPlanData] = useState<any>(null);
  const [planCourseName, setPlanCourseName] = useState('');
  const [comparisonModal, setComparisonModal] = useState<ComparisonData | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  // ربط درس غير مربوط بموضوع من الخطة
  const [linkingLessonId, setLinkingLessonId] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);

  // تعديل عنوان درس منجز خارج الخطة
  const editLessonTitle = async (lectureId: string, oldTitle: string) => {
    if (typeof window === 'undefined') return;
    const newTitle = window.prompt('تعديل عنوان الدرس:', oldTitle);
    if (newTitle === null) return; // ألغى
    try {
      await api.put(`/lectures/${lectureId}`, { lesson_title: newTitle.trim() });
      if (comparisonModal) {
        const courseId = data.find(d => d.course_name === comparisonModal.course_name)?.course_id;
        if (courseId) {
          const res = await api.get(`/reports/lesson-completion/${courseId}/comparison`);
          setComparisonModal(res.data);
        }
      }
      await fetchData();
      window.alert('تم تحديث العنوان ✓');
    } catch (err: any) {
      window.alert('فشل التحديث: ' + (err?.response?.data?.detail || 'خطأ'));
    }
  };

  // مسح عنوان الدرس (يُفرغ الحقل - تجعل المحاضرة بدون عنوان)
  const clearLessonTitle = async (lectureId: string) => {
    if (typeof window === 'undefined') return;
    if (!window.confirm('هل تريد مسح عنوان هذا الدرس؟ سيصبح الدرس "بدون عنوان".')) return;
    try {
      await api.put(`/lectures/${lectureId}`, { lesson_title: '' });
      if (comparisonModal) {
        const courseId = data.find(d => d.course_name === comparisonModal.course_name)?.course_id;
        if (courseId) {
          const res = await api.get(`/reports/lesson-completion/${courseId}/comparison`);
          setComparisonModal(res.data);
        }
      }
      await fetchData();
      window.alert('تم مسح العنوان ✓');
    } catch (err: any) {
      window.alert('فشل: ' + (err?.response?.data?.detail || 'خطأ'));
    }
  };

  // ذهاب مباشر لصفحة المحاضرات (للحذف/التعديل الشامل)
  const goToLectures = (courseId: string) => {
    router.push(`/course-lectures?courseId=${courseId}`);
  };

  // ربط درس غير مربوط بموضوع معين
  const linkLessonToTopic = async (lectureId: string, topicId: string) => {
    if (!comparisonModal) return;
    try {
      await api.put(`/lectures/${lectureId}`, { plan_topic_id: topicId });
      setShowLinkModal(false);
      setLinkingLessonId(null);
      // إعادة تحميل المقارنة
      const courseId = data.find(d => d.course_name === comparisonModal.course_name)?.course_id;
      if (courseId) {
        const res = await api.get(`/reports/lesson-completion/${courseId}/comparison`);
        setComparisonModal(res.data);
      }
      // إعادة تحميل التقرير الرئيسي
      await fetchData();
      if (typeof window !== 'undefined') {
        window.alert('تم الربط بنجاح ✓');
      }
    } catch (err: any) {
      if (typeof window !== 'undefined') {
        window.alert('فشل الربط: ' + (err?.response?.data?.detail || 'خطأ'));
      }
    }
  };

  // فك ربط موضوع مربوط (لتغييره)
  const unlinkTopic = async (lectureId: string) => {
    if (!comparisonModal) return;
    if (typeof window !== 'undefined' && !window.confirm('هل تريد فك ربط هذا الدرس عن الموضوع؟')) return;
    try {
      await api.put(`/lectures/${lectureId}`, { plan_topic_id: null });
      const courseId = data.find(d => d.course_name === comparisonModal.course_name)?.course_id;
      if (courseId) {
        const res = await api.get(`/reports/lesson-completion/${courseId}/comparison`);
        setComparisonModal(res.data);
      }
      await fetchData();
    } catch (err: any) {
      if (typeof window !== 'undefined') {
        window.alert('فشل فك الربط: ' + (err?.response?.data?.detail || 'خطأ'));
      }
    }
  };

  const fetchData = useCallback(async () => {
    try {
      const params: any = {};
      if (selectedCourse) {
        params.course_id = selectedCourse;
      } else if (selectedDept) {
        params.department_id = selectedDept;
      } else {
        // لا شيء محدد - لا نُنفّذ التقرير
        setData([]);
        return;
      }
      const res = await api.get('/reports/lesson-completion', { params });
      setData(res.data);
      setReportRun(true);
    } catch (error) {
      console.error('Error fetching lesson completion:', error);
      alert('فشل في تحميل التقرير');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDept, selectedCourse]);

  const fetchDepartments = async () => {
    try {
      const res = await departmentsAPI.getAll();
      setDepartments(res.data);
    } catch {}
  };

  useEffect(() => { fetchDepartments(); }, []);

  // عند تغيير القسم: جلب مقرراته + مسح التقرير
  useEffect(() => {
    setSelectedCourse('');
    setData([]);
    setReportRun(false);
    if (!selectedDept) {
      setCoursesInDept([]);
      return;
    }
    (async () => {
      try {
        setLoadingCourses(true);
        const res = await api.get('/courses', { params: { department_id: selectedDept } });
        setCoursesInDept(res.data || []);
      } catch {
        setCoursesInDept([]);
      } finally {
        setLoadingCourses(false);
      }
    })();
  }, [selectedDept]);

  const onRefresh = () => {
    if (!selectedDept && !selectedCourse) return;
    setRefreshing(true);
    fetchData();
  };

  const runReport = () => {
    if (!selectedDept && !selectedCourse) {
      alert('يرجى اختيار القسم ثم المقرر');
      return;
    }
    setLoading(true);
    fetchData();
  };

  const exportExcel = async () => {
    if (!reportRun) {
      alert('يرجى تنفيذ التقرير أولاً');
      return;
    }
    try {
      const params: any = {};
      if (selectedCourse) params.course_id = selectedCourse;
      else if (selectedDept) params.department_id = selectedDept;
      const res = await api.get('/export/report/lesson-completion/excel', { params, responseType: 'blob' });
      if (Platform.OS === 'web') {
        const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const xf = (res.headers as any)?.['x-filename'];
        a.download = xf ? decodeURIComponent(xf) : 'lesson_completion_report.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      alert('فشل في تصدير التقرير');
    }
  };

  const viewPlan = async (courseId: string, courseName: string) => {
    try {
      const res = await api.get(`/courses/${courseId}/study-plan`);
      setPlanData(res.data);
      setPlanCourseName(courseName);
      setShowPlanModal(true);
    } catch {
      setPlanData({ weeks: [] });
      setPlanCourseName(courseName);
      setShowPlanModal(true);
    }
  };

  const openComparison = async (courseId: string) => {
    try {
      setLoadingCompare(true);
      const res = await api.get(`/reports/lesson-completion/${courseId}/comparison`);
      setComparisonModal(res.data);
    } catch (e) {
      alert('تعذر تحميل المقارنة');
    } finally {
      setLoadingCompare(false);
    }
  };

  // Stats
  const totalCourses = data.length;
  const withPlan = data.filter(d => d.has_plan).length;
  const withoutPlan = totalCourses - withPlan;
  const avgCompletion = totalCourses > 0
    ? Math.round(data.reduce((sum, d) => sum + d.completion_percent, 0) / totalCourses)
    : 0;

  const getProgressColor = (percent: number) => {
    if (percent >= 70) return '#4caf50';
    if (percent >= 40) return '#ff9800';
    return '#f44336';
  };

  if (loading && !refreshing && !reportRun) {
    // لا نعرض spinner في البداية، فقط أثناء تنفيذ التقرير
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBack(router)} style={styles.backBtn} accessibilityLabel="رجوع">
          <Ionicons name="arrow-forward" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>تقرير إنجاز الدروس</Text>
        {Platform.OS === 'web' ? (
          <TouchableOpacity onPress={exportExcel} style={styles.backBtn} accessibilityLabel="تصدير Excel">
            <Ionicons name="download-outline" size={24} color="#4caf50" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: 16 }}
      >
        {/* فلتر القسم + المقرر */}
        <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6 }}>1. اختر القسم</Text>
          <View style={{ backgroundColor: '#f5f5f5', borderRadius: 8, overflow: 'hidden' }}>
            <Picker selectedValue={selectedDept} onValueChange={setSelectedDept} style={{ height: 45 }}>
              <Picker.Item label="-- اختر القسم --" value="" />
              {departments.map(d => (
                <Picker.Item key={d.id} label={d.name} value={d.id} />
              ))}
            </Picker>
          </View>

          {/* المقرر (يظهر بعد اختيار القسم) */}
          {selectedDept && (
            <>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6, marginTop: 12 }}>
                2. اختر المقرر
              </Text>
              {loadingCourses ? (
                <ActivityIndicator size="small" color="#4caf50" />
              ) : (
                <View style={{ backgroundColor: '#f5f5f5', borderRadius: 8, overflow: 'hidden' }}>
                  <Picker selectedValue={selectedCourse} onValueChange={setSelectedCourse} style={{ height: 45 }}>
                    <Picker.Item label={`-- اختر المقرر (${coursesInDept.length} مقرر) --`} value="" />
                    {coursesInDept.map((c: any) => (
                      <Picker.Item key={c.id} label={`${c.name}${c.code ? ` (${c.code})` : ''}`} value={c.id} />
                    ))}
                  </Picker>
                </View>
              )}
            </>
          )}

          {/* زر تنفيذ التقرير */}
          <TouchableOpacity
            onPress={runReport}
            disabled={!selectedCourse || loading}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginTop: 12, padding: 12, borderRadius: 8,
              backgroundColor: !selectedCourse || loading ? '#b0bec5' : '#1565c0',
            }}
            testID="run-lesson-completion-btn"
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="play" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>تنفيذ التقرير</Text>
              </>
            )}
          </TouchableOpacity>

          {Platform.OS === 'web' && reportRun && (
            <TouchableOpacity
              onPress={exportExcel}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, backgroundColor: '#4caf50', padding: 10, borderRadius: 8 }}
            >
              <Ionicons name="download-outline" size={20} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>تصدير Excel</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* إحصائيات سريعة */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          <View style={[styles.statCard, { backgroundColor: '#e3f2fd' }]}>
            <Text style={[styles.statNum, { color: '#1565c0' }]}>{totalCourses}</Text>
            <Text style={styles.statLabel}>مقرر</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#e8f5e9' }]}>
            <Text style={[styles.statNum, { color: '#4caf50' }]}>{withPlan}</Text>
            <Text style={styles.statLabel}>لديه خطة</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#fff3e0' }]}>
            <Text style={[styles.statNum, { color: '#ff9800' }]}>{withoutPlan}</Text>
            <Text style={styles.statLabel}>بدون خطة</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#f3e5f5' }]}>
            <Text style={[styles.statNum, { color: '#9c27b0' }]}>{avgCompletion}%</Text>
            <Text style={styles.statLabel}>متوسط الإنجاز</Text>
          </View>
        </View>

        {/* قائمة المقررات */}
        {data.map((course) => (
          <View key={course.course_id} style={styles.courseCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.courseName}>{course.course_name}</Text>
                <Text style={styles.courseCode}>{course.course_code} - {course.teacher_name}</Text>
              </View>
              {course.has_plan && (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity
                    style={{ backgroundColor: '#ede7f6', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}
                    onPress={() => openComparison(course.course_id)}
                  >
                    <Text style={{ color: '#673ab7', fontSize: 12, fontWeight: '600' }}>📊 مقارنة</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ backgroundColor: '#e8f5e9', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}
                    onPress={() => viewPlan(course.course_id, course.course_name)}
                  >
                    <Text style={{ color: '#4caf50', fontSize: 12, fontWeight: '600' }}>عرض الخطة</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* الدروس المنجزة فعلاً */}
            {course.completed_lessons && course.completed_lessons.length > 0 && (
              <View style={{ marginTop: 10, backgroundColor: '#f9fafb', padding: 10, borderRadius: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#1565c0', marginBottom: 6, textAlign: 'right' }}>
                  ✍️ الدروس المنجزة (حسب عناوين الأستاذ):
                </Text>
                {course.completed_lessons.slice(0, 5).map((ls, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 6, marginBottom: 3, alignItems: 'flex-start' }}>
                    <Ionicons name={ls.plan_topic_id ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={ls.plan_topic_id ? '#4caf50' : '#ff9800'} />
                    <Text style={{ flex: 1, fontSize: 12, color: '#333', textAlign: 'right' }}>
                      <Text style={{ color: '#666', fontSize: 11 }}>{ls.date} • </Text>
                      {ls.lesson_title}
                    </Text>
                  </View>
                ))}
                {course.completed_lessons.length > 5 && (
                  <Text style={{ fontSize: 11, color: '#888', marginTop: 4, textAlign: 'center' }}>
                    ...و {course.completed_lessons.length - 5} درس آخر (اضغط "مقارنة")
                  </Text>
                )}
              </View>
            )}
            
            {/* شريط التقدم */}
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 12, color: '#888' }}>نسبة الإنجاز</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: getProgressColor(course.completion_percent) }}>
                  {course.completion_percent}%
                </Text>
              </View>
              <View style={{ height: 8, backgroundColor: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                <View style={{
                  height: '100%',
                  width: `${Math.min(course.completion_percent, 100)}%`,
                  backgroundColor: getProgressColor(course.completion_percent),
                  borderRadius: 4,
                }} />
              </View>
            </View>

            {/* تفاصيل */}
            <View style={{ flexDirection: 'row', marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
              <View style={styles.detailBadge}>
                <Ionicons name="list" size={14} color="#1565c0" />
                <Text style={styles.detailText}>مخطط: {course.planned_topics}</Text>
              </View>
              <View style={styles.detailBadge}>
                <Ionicons name="checkmark-circle" size={14} color="#4caf50" />
                <Text style={styles.detailText}>
                  منجز: {course.topics_completed ?? course.lessons_with_title}
                </Text>
              </View>
              {(course.topics_manually_confirmed ?? 0) > 0 && (
                <View style={[styles.detailBadge, { backgroundColor: '#e3f2fd' }]}>
                  <Ionicons name="hand-right" size={14} color="#1565c0" />
                  <Text style={[styles.detailText, { color: '#1565c0' }]}>
                    مؤكَّد يدوياً: {course.topics_manually_confirmed}
                  </Text>
                </View>
              )}
              <View style={styles.detailBadge}>
                <Ionicons name="school" size={14} color="#ff9800" />
                <Text style={styles.detailText}>محاضرات: {course.completed_lectures}/{course.total_lectures}</Text>
              </View>
              {course.lessons_without_title > 0 && (
                <View style={[styles.detailBadge, { backgroundColor: '#ffebee' }]}>
                  <Ionicons name="alert-circle" size={14} color="#f44336" />
                  <Text style={[styles.detailText, { color: '#f44336' }]}>بدون عنوان: {course.lessons_without_title}</Text>
                </View>
              )}
              {!course.has_plan && (
                <View style={[styles.detailBadge, { backgroundColor: '#fff3e0' }]}>
                  <Ionicons name="warning" size={14} color="#ff9800" />
                  <Text style={[styles.detailText, { color: '#ff9800' }]}>لا يوجد خطة</Text>
                </View>
              )}
            </View>
          </View>
        ))}

        {data.length === 0 && (
          <View style={{ alignItems: 'center', padding: 40 }}>
            {reportRun ? (
              <>
                <Ionicons name="document-text-outline" size={48} color="#ccc" />
                <Text style={{ color: '#999', marginTop: 12, fontSize: 15 }}>لا توجد بيانات لهذا المقرر</Text>
              </>
            ) : (
              <>
                <Ionicons name="filter-outline" size={56} color="#bbb" />
                <Text style={{ color: '#999', marginTop: 12, fontSize: 14, textAlign: 'center' }}>
                  اختر القسم ثم المقرر ثم اضغط "تنفيذ التقرير"
                </Text>
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* نافذة عرض الخطة الدراسية */}
      <Modal visible={showPlanModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '90%', maxWidth: 500, maxHeight: '80%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <TouchableOpacity onPress={() => setShowPlanModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#333' }}>الخطة الدراسية</Text>
              <View style={{ width: 24 }} />
            </View>
            <Text style={{ fontSize: 14, color: '#1565c0', fontWeight: '600', textAlign: 'center', marginBottom: 12 }}>{planCourseName}</Text>
            
            <ScrollView style={{ maxHeight: 400 }}>
              {planData?.weeks?.length > 0 ? (
                planData.weeks.map((week: any, i: number) => (
                  <View key={i} style={{ marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <View style={{ backgroundColor: '#1565c0', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>الأسبوع {week.week_number}</Text>
                      </View>
                    </View>
                    {week.topics?.map((topic: any, j: number) => (
                      <View key={j} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, gap: 8 }}>
                        <Ionicons name="book-outline" size={16} color="#4caf50" />
                        <Text style={{ fontSize: 14, color: '#333', flex: 1 }}>{topic.title}</Text>
                      </View>
                    ))}
                  </View>
                ))
              ) : (
                <Text style={{ textAlign: 'center', color: '#999', padding: 20 }}>لا توجد خطة دراسية لهذا المقرر</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* نافذة المقارنة: الخطة vs المنجز */}
      <Modal visible={!!comparisonModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '95%', maxWidth: 900, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <TouchableOpacity onPress={() => setComparisonModal(null)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#333' }}>مقارنة: الخطة vs المنجز</Text>
              <View style={{ width: 24 }} />
            </View>
            {comparisonModal && (
              <>
                <Text style={{ fontSize: 14, color: '#1565c0', fontWeight: '700', textAlign: 'center' }}>
                  {comparisonModal.course_name}
                </Text>
                <Text style={{ fontSize: 12, color: '#888', textAlign: 'center', marginBottom: 12 }}>
                  {comparisonModal.teacher_name}
                </Text>

                {/* عدادات */}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <View style={{ flex: 1, backgroundColor: '#e3f2fd', padding: 8, borderRadius: 8, alignItems: 'center' }}>
                    <Text style={{ fontSize: 18, fontWeight: '800', color: '#1565c0' }}>{comparisonModal.total_planned}</Text>
                    <Text style={{ fontSize: 11, color: '#555' }}>مخطط</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: '#e8f5e9', padding: 8, borderRadius: 8, alignItems: 'center' }}>
                    <Text style={{ fontSize: 18, fontWeight: '800', color: '#2e7d32' }}>{comparisonModal.matched_count}</Text>
                    <Text style={{ fontSize: 11, color: '#555' }}>منجز مُرتبط</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: '#fff3e0', padding: 8, borderRadius: 8, alignItems: 'center' }}>
                    <Text style={{ fontSize: 18, fontWeight: '800', color: '#ef6c00' }}>{comparisonModal.unmatched_count}</Text>
                    <Text style={{ fontSize: 11, color: '#555' }}>منجز غير مُرتبط</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: '#ffebee', padding: 8, borderRadius: 8, alignItems: 'center' }}>
                    <Text style={{ fontSize: 18, fontWeight: '800', color: '#c62828' }}>{comparisonModal.total_planned - comparisonModal.matched_count}</Text>
                    <Text style={{ fontSize: 11, color: '#555' }}>غير منجز</Text>
                  </View>
                </View>

                <ScrollView style={{ maxHeight: 400 }}>
                  {/* عناوين الأعمدة */}
                  <View style={{ flexDirection: 'row', backgroundColor: '#f5f5f5', padding: 8, borderRadius: 6, gap: 8 }}>
                    <Text style={{ width: 40, fontWeight: '700', fontSize: 12, color: '#666' }}>الأسبوع</Text>
                    <Text style={{ flex: 1, fontWeight: '700', fontSize: 12, color: '#1565c0', textAlign: 'right' }}>الخطة (مطلوب)</Text>
                    <Text style={{ flex: 1, fontWeight: '700', fontSize: 12, color: '#2e7d32', textAlign: 'right' }}>المنجز (الأستاذ)</Text>
                    <Text style={{ width: 50, fontWeight: '700', fontSize: 12, color: '#666', textAlign: 'center' }}>الحالة</Text>
                  </View>
                  {comparisonModal.comparison.map((row, i) => (
                    <View key={i} style={{ flexDirection: 'row', padding: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', alignItems: 'flex-start' }}>
                      <Text style={{ width: 40, fontSize: 11, color: '#888' }}>{row.week_number}</Text>
                      <Text style={{ flex: 1, fontSize: 12, color: '#333', textAlign: 'right' }}>{row.planned_title}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, color: row.completed ? '#2e7d32' : '#c62828', textAlign: 'right' }}>
                          {row.completed ? `${row.actual_title}${row.actual_date ? ` (${row.actual_date})` : ''}` : '—'}
                        </Text>
                        {row.source === 'manual_confirm' && (
                          <Text style={{ fontSize: 9, color: '#1565c0', textAlign: 'right', marginTop: 1 }}>
                            (تأكيد يدوي)
                          </Text>
                        )}
                        {row.source === 'lecture' && row.lecture_id && (
                          <TouchableOpacity
                            onPress={() => unlinkTopic(row.lecture_id!)}
                            style={{ alignSelf: 'flex-end', marginTop: 2 }}
                          >
                            <Text style={{ fontSize: 10, color: '#ff9800', textDecorationLine: 'underline' }}>
                              فك الربط / تغيير
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={{ width: 50, alignItems: 'center' }}>
                        {row.completed ? (
                          <Ionicons name="checkmark-circle" size={20} color={row.source === 'manual_confirm' ? '#1565c0' : '#4caf50'} />
                        ) : (
                          <Ionicons name="close-circle" size={20} color="#f44336" />
                        )}
                      </View>
                    </View>
                  ))}

                  {/* دروس غير مرتبطة بأي موضوع مخطط */}
                  {comparisonModal.unlinked_lessons.length > 0 && (
                    <View style={{ marginTop: 16, padding: 10, backgroundColor: '#fff3e0', borderRadius: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#ef6c00', marginBottom: 6 }}>
                        ⚠️ دروس منجزة لم تُربط بأي موضوع من الخطة ({comparisonModal.unlinked_lessons.length})
                      </Text>
                      <Text style={{ fontSize: 10, color: '#888', marginBottom: 8 }}>
                        هذه محاضرات مكتملة بعناوين لكن غير مرتبطة بالخطة. يمكنك ربطها أو تعديل عنوانها أو فتح شاشة المحاضرات لحذفها.
                      </Text>
                      {comparisonModal.unlinked_lessons.map((l, i) => {
                        const courseId = data.find(d => d.course_name === comparisonModal.course_name)?.course_id;
                        return (
                          <View key={i} style={{
                            paddingVertical: 6, paddingHorizontal: 4,
                            borderBottomWidth: i < comparisonModal.unlinked_lessons.length-1 ? 1 : 0,
                            borderBottomColor: '#ffd8a8'
                          }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 12, color: l.lesson_title ? '#444' : '#aaa', textAlign: 'right', fontWeight: '600', fontStyle: l.lesson_title ? 'normal' : 'italic' }}>
                                  {l.lesson_title || '(بدون عنوان)'}
                                </Text>
                                <Text style={{ fontSize: 10, color: '#888', textAlign: 'right' }}>
                                  تاريخ المحاضرة: {l.date}
                                </Text>
                              </View>
                            </View>
                            {/* شريط الإجراءات */}
                            {l.lecture_id && (
                              <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <TouchableOpacity
                                  onPress={() => { setLinkingLessonId(l.lecture_id!); setShowLinkModal(true); }}
                                  style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#1565c0', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5 }}
                                  testID={`link-lesson-${l.lecture_id}`}
                                >
                                  <Ionicons name="link" size={11} color="#fff" />
                                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>ربط</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => editLessonTitle(l.lecture_id!, l.lesson_title)}
                                  style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#ff9800', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5 }}
                                  testID={`edit-lesson-${l.lecture_id}`}
                                >
                                  <Ionicons name="create" size={11} color="#fff" />
                                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>تعديل العنوان</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => clearLessonTitle(l.lecture_id!)}
                                  style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#757575', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5 }}
                                  testID={`clear-lesson-${l.lecture_id}`}
                                >
                                  <Ionicons name="remove-circle" size={11} color="#fff" />
                                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>مسح العنوان</Text>
                                </TouchableOpacity>
                                {courseId && (
                                  <TouchableOpacity
                                    onPress={() => { setComparisonModal(null); goToLectures(courseId); }}
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#c62828', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5 }}
                                    testID={`goto-lectures-${l.lecture_id}`}
                                  >
                                    <Ionicons name="open" size={11} color="#fff" />
                                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>فتح المحاضرات (للحذف)</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal اختيار موضوع للربط */}
      <Modal visible={showLinkModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16, width: '100%', maxWidth: 520, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#1565c0' }}>اختر الموضوع للربط</Text>
              <TouchableOpacity onPress={() => { setShowLinkModal(false); setLinkingLessonId(null); }}>
                <Ionicons name="close" size={22} color="#666" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 11, color: '#666', marginBottom: 12 }}>
              اختر الموضوع الذي يمثل هذا الدرس من الخطة الدراسية:
            </Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {comparisonModal?.comparison
                .filter(t => !t.completed)
                .map((t) => (
                  <TouchableOpacity
                    key={t.topic_id}
                    onPress={() => linkingLessonId && linkLessonToTopic(linkingLessonId, t.topic_id)}
                    style={{
                      padding: 10, marginBottom: 6, borderRadius: 8,
                      borderWidth: 1, borderColor: '#ddd', flexDirection: 'row',
                      alignItems: 'center', gap: 8,
                    }}
                    testID={`link-target-${t.topic_id}`}
                  >
                    <View style={{ backgroundColor: '#e3f2fd', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ fontSize: 10, color: '#1565c0', fontWeight: '700' }}>أ{t.week_number}</Text>
                    </View>
                    <Text style={{ flex: 1, fontSize: 12, color: '#333', textAlign: 'right' }}>
                      {t.planned_title}
                    </Text>
                    <Ionicons name="arrow-back" size={16} color="#1565c0" />
                  </TouchableOpacity>
                ))}
              {comparisonModal?.comparison.filter(t => !t.completed).length === 0 && (
                <Text style={{ textAlign: 'center', padding: 20, color: '#999', fontSize: 12 }}>
                  لا توجد مواضيع غير منجزة في الخطة للربط
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* مؤشر تحميل المقارنة */}
      {loadingCompare && (
        <View style={{ position: 'absolute', inset: 0 as any, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#333' },
  statCard: {
    flex: 1, padding: 12, borderRadius: 12, alignItems: 'center',
  },
  statNum: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, color: '#666', marginTop: 2 },
  courseCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10,
  },
  courseName: { fontSize: 15, fontWeight: '700', color: '#333' },
  courseCode: { fontSize: 12, color: '#888', marginTop: 2 },
  detailBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f5f5f5', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
  detailText: { fontSize: 12, color: '#555' },
});
