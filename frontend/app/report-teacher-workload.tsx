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
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { reportsAPI, teachersAPI, departmentsAPI } from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';
import { exportToPDF, prepareTeacherWorkloadData } from '../src/utils/pdfExport';

interface TeacherWorkload {
  teacher_id: string;
  teacher_name: string;
  department_id: string;
  courses: {
    course_name: string;
    course_code: string;
    scheduled_lectures: number;
    executed_lectures: number;
    scheduled_hours: number;
    actual_hours: number;
  }[];
  summary: {
    total_courses: number;
    weekly_hours: number;
    total_weeks: number;
    required_hours: number;
    total_scheduled_hours: number;
    total_actual_hours: number;
    difference_hours: number;
    completion_rate: number;
  };
}

const PAGE_SIZE_WL = 10;

function TeacherList({ data, currentPage, setCurrentPage, styles }: { data: TeacherWorkload[]; currentPage: number; setCurrentPage: (fn: any) => void; styles: any }) {
  const totalPages = Math.ceil(data.length / PAGE_SIZE_WL);
  const pagedData = data.slice((currentPage - 1) * PAGE_SIZE_WL, currentPage * PAGE_SIZE_WL);
  return (
    <View>
      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 12, color: '#888' }}>{data.length} معلم</Text>
      </View>
      {pagedData.map((teacher: TeacherWorkload, index: number) => (
        <View key={index} style={styles.teacherCard}>
          <View style={styles.teacherHeader}>
            <View style={styles.teacherInfo}>
              <Text style={styles.teacherName}>{teacher.teacher_name}</Text>
              <Text style={styles.teacherId}>الرقم الوظيفي: {teacher.teacher_id || '-'}</Text>
            </View>
            <View style={[
              styles.completionBadge,
              teacher.summary.completion_rate >= 100 ? styles.completionGood : styles.completionWarn
            ]}>
              <Text style={styles.completionText}>{teacher.summary.completion_rate}%</Text>
            </View>
          </View>
          <View style={styles.teacherStats}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{teacher.summary.weekly_hours || 12}</Text>
              <Text style={styles.statLabel}>نصاب أسبوعي</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{teacher.summary.required_hours}</Text>
              <Text style={styles.statLabel}>مطلوب</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{teacher.summary.total_actual_hours}</Text>
              <Text style={styles.statLabel}>منفذ</Text>
            </View>
            <View style={[
              styles.statBox,
              teacher.summary.difference_hours >= 0 ? styles.extraBoxPositive : styles.extraBoxNegative
            ]}>
              <Text style={[
                styles.statValue,
                teacher.summary.difference_hours >= 0 ? styles.extraValuePositive : styles.extraValueNegative
              ]}>
                {teacher.summary.difference_hours >= 0 ? '+' : ''}{teacher.summary.difference_hours}
              </Text>
              <Text style={styles.statLabel}>الفرق</Text>
            </View>
          </View>
          {teacher.courses.length > 0 && (
            <View style={styles.coursesSection}>
              <Text style={styles.coursesTitle}>المقررات ({teacher.courses.length})</Text>
              {teacher.courses.map((course, cIndex) => (
                <View key={cIndex} style={styles.courseRow}>
                  <View style={styles.courseInfo}>
                    <Text style={styles.courseName}>{course.course_name}</Text>
                    <Text style={styles.courseCode}>{course.course_code}</Text>
                  </View>
                  <View style={styles.courseStats}>
                    <Text style={styles.courseStatText}>{course.executed_lectures}/{course.scheduled_lectures} محاضرة</Text>
                    <Text style={styles.courseStatText}>{course.actual_hours}/{course.scheduled_hours} ساعة</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
      {totalPages > 1 && (
        <View style={styles.paginationRow}>
          <TouchableOpacity
            style={[styles.pageBtn, currentPage <= 1 && styles.pageBtnDisabled]}
            onPress={() => setCurrentPage((p: number) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
          >
            <Ionicons name="chevron-forward" size={20} color={currentPage <= 1 ? '#ccc' : '#1565c0'} />
          </TouchableOpacity>
          <Text style={styles.pageText}>{currentPage} / {totalPages}</Text>
          <TouchableOpacity
            style={[styles.pageBtn, currentPage >= totalPages && styles.pageBtnDisabled]}
            onPress={() => setCurrentPage((p: number) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
          >
            <Ionicons name="chevron-back" size={20} color={currentPage >= totalPages ? '#ccc' : '#1565c0'} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function TeacherWorkloadReport() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [data, setData] = useState<TeacherWorkload[]>([]);
  // تجميع حسب الشهر: عند الفترة متعددة الأشهر
  const [monthlyData, setMonthlyData] = useState<{ label: string; teachers: TeacherWorkload[]; summary: any; }[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [teacherQuery, setTeacherQuery] = useState('');
  const [showTeacherList, setShowTeacherList] = useState(false);
  const [selectedDept, setSelectedDept] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [summary, setSummary] = useState<any>(null);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [reportRun, setReportRun] = useState(false);
  const [splitByMonth, setSplitByMonth] = useState(false);

  // Pagination
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);

  const isTeacher = user?.role === 'teacher';

  // هل الفترة تشمل أكثر من شهر؟
  const isMultiMonth = (() => {
    if (!startDate || !endDate) return false;
    const s = new Date(startDate);
    const e = new Date(endDate);
    return s.getFullYear() !== e.getFullYear() || s.getMonth() !== e.getMonth();
  })();

  // قسّم الفترة إلى أشهر
  const splitToMonths = (sStr: string, eStr: string) => {
    const months: { start: string; end: string; label: string }[] = [];
    const s = new Date(sStr);
    const e = new Date(eStr);
    let cur = new Date(s.getFullYear(), s.getMonth(), 1);
    while (cur <= e) {
      const monthStart = new Date(cur);
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const monthEnd = new Date(next.getTime() - 86400000);
      const actualStart = monthStart < s ? s : monthStart;
      const actualEnd = monthEnd > e ? e : monthEnd;
      months.push({
        start: actualStart.toISOString().split('T')[0],
        end: actualEnd.toISOString().split('T')[0],
        label: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`,
      });
      cur = next;
    }
    return months;
  };

  // دالة تصدير PDF
  const handleExportPDF = async () => {
    try {
      setExportingPDF(true);
      const teachersData = data.map(t => ({
        name: t.teacher_name,
        courses_count: t.summary.total_courses,
        lectures_count: t.courses.reduce((sum, c) => sum + c.executed_lectures, 0),
        hours: t.summary.total_actual_hours
      }));
      const reportData = prepareTeacherWorkloadData(teachersData);
      await exportToPDF(reportData);
    } catch (error) {
      console.error('PDF Export error:', error);
    } finally {
      setExportingPDF(false);
    }
  };

  // دالة تصدير Excel - تصدّر التقرير المعروض حالياً (الفلاتر المُطبَّقة)
  const exportToExcel = async () => {
    if (!reportRun) {
      Alert.alert('تنبيه', 'يرجى تنفيذ التقرير أولاً');
      return;
    }
    try {
      setExporting(true);
      const params: any = {};
      if (selectedTeacher) params.teacher_id = selectedTeacher;
      if (selectedDept) params.department_id = selectedDept;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      // إذا كانت الفترة متعددة الأشهر والمستخدم اختار التجميع، صدِّر sheet لكل شهر
      if (isMultiMonth && splitByMonth) params.monthly = true;

      const response = await reportsAPI.exportTeacherWorkloadExcel(params);

      const filename = (isMultiMonth && splitByMonth)
        ? 'teacher_workload_monthly.xlsx'
        : 'teacher_workload.xlsx';

      if (Platform.OS === 'web') {
        const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const xf = (response.headers as any)?.['x-filename'];
        a.download = xf ? decodeURIComponent(xf) : filename;
        a.click();
      } else {
        const filepath = `${FileSystem.documentDirectory}${filename}`;
        const base64 = btoa(
          new Uint8Array(response.data).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        await FileSystem.writeAsStringAsync(filepath, base64, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(filepath);
      }
      Alert.alert('نجاح', 'تم تصدير التقرير بنجاح');
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('خطأ', 'فشل في تصدير التقرير');
    } finally {
      setExporting(false);
    }
  };

  // تنفيذ التقرير (يدوياً)
  const runReport = async () => {
    try {
      setLoading(true);
      setReportRun(false);
      setMonthlyData([]);

      const filterDept = (arr: TeacherWorkload[]) =>
        selectedDept && !isTeacher ? arr.filter((t) => t.department_id === selectedDept) : arr;

      // وضع التجميع الشهري
      if (isMultiMonth && splitByMonth && startDate && endDate) {
        const months = splitToMonths(startDate, endDate);
        const monthly: { label: string; teachers: TeacherWorkload[]; summary: any; }[] = [];
        let combinedTeachers: TeacherWorkload[] = [];
        for (const m of months) {
          const params: any = { start_date: m.start, end_date: m.end };
          if (selectedTeacher) params.teacher_id = selectedTeacher;
          const r = await reportsAPI.getTeacherWorkload(params);
          monthly.push({
            label: m.label,
            teachers: filterDept(r.data.teachers || []),
            summary: r.data.summary,
          });
          combinedTeachers = combinedTeachers.concat(r.data.teachers || []);
        }
        setMonthlyData(monthly);
        setData(filterDept(combinedTeachers));
        // ملخص مُجمّع
        setSummary({
          total_teachers: monthly[0]?.summary?.total_teachers || 0,
          total_required_hours: monthly.reduce((s, m) => s + (m.summary?.total_required_hours || 0), 0).toFixed(2),
          total_actual_hours: monthly.reduce((s, m) => s + (m.summary?.total_actual_hours || 0), 0).toFixed(2),
          total_difference_hours: monthly.reduce((s, m) => s + (m.summary?.total_difference_hours || 0), 0).toFixed(2),
        });
      } else {
        const params: any = {};
        if (selectedTeacher) params.teacher_id = selectedTeacher;
        if (startDate) params.start_date = startDate;
        if (endDate) params.end_date = endDate;
        const r = await reportsAPI.getTeacherWorkload(params);
        setData(filterDept(r.data.teachers || []));
        setSummary(r.data.summary);
      }
      setCurrentPage(1);
      setReportRun(true);
    } catch (error) {
      console.error('Error fetching data:', error);
      Alert.alert('خطأ', 'فشل في تنفيذ التقرير');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // تحميل القوائم فقط (المعلمون والأقسام) - بدون تنفيذ التقرير
  useEffect(() => {
    (async () => {
      if (isTeacher) {
        // المعلم: نفّذ تقريره مباشرة (لأنه لا يحتاج فلاتر)
        await runReport();
      } else {
        try {
          const [teachersRes, deptsRes] = await Promise.all([
            teachersAPI.getAll(),
            departmentsAPI.getAll(),
          ]);
          setTeachers(teachersRes.data);
          setDepartments(deptsRes.data);
        } catch (e) {
          console.error('init error', e);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = () => {
    if (!reportRun) return;
    setRefreshing(true);
    runReport();
  };

  // تحديد تواريخ الشهر الحالي
  const setCurrentMonth = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setStartDate(firstDay.toISOString().split('T')[0]);
    setEndDate(lastDay.toISOString().split('T')[0]);
  };

  // تحديد تواريخ الشهر السابق
  const setPreviousMonth = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    setStartDate(firstDay.toISOString().split('T')[0]);
    setEndDate(lastDay.toISOString().split('T')[0]);
  };

  // تحديد تواريخ الشهر الأسبق (قبل شهرين)
  const setTwoMonthsAgo = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() - 1, 0);
    setStartDate(firstDay.toISOString().split('T')[0]);
    setEndDate(lastDay.toISOString().split('T')[0]);
  };

  // تحديد تواريخ الأسبوع الحالي
  const setCurrentWeek = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    setStartDate(startOfWeek.toISOString().split('T')[0]);
    setEndDate(endOfWeek.toISOString().split('T')[0]);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1565c0" />
        <Text style={styles.loadingText}>جاري تحميل التقرير...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBack()} accessibilityLabel="رجوع">
          <Ionicons name="arrow-forward" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isTeacher ? 'نصاب تدريسي' : 'تقرير نصاب المدرسين'}</Text>
        <View style={styles.headerButtons}>
          {Platform.OS === 'web' && (
            <TouchableOpacity 
              style={styles.exportBtn}
              onPress={handleExportPDF}
              disabled={exportingPDF || data.length === 0}
              accessibilityLabel="تصدير PDF"
            >
              {exportingPDF ? (
                <ActivityIndicator size="small" color="#e53935" />
              ) : (
                <Ionicons name="document-text-outline" size={22} color={data.length > 0 ? "#e53935" : "#ccc"} />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity 
            style={styles.exportBtn}
            onPress={exportToExcel}
            disabled={exporting || data.length === 0}
            accessibilityLabel="تصدير Excel"
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#4caf50" />
            ) : (
              <Ionicons name="download-outline" size={24} color={data.length > 0 ? "#4caf50" : "#ccc"} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* الفلاتر - للمدير فقط */}
        {!isTeacher && (
        <View style={styles.filtersCard}>
          <Text style={styles.filterTitle}>فلاتر البحث</Text>
          
          {/* قسم */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>القسم</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={selectedDept}
                onValueChange={(v) => setSelectedDept(v)}
                style={styles.picker}
              >
                <Picker.Item label="جميع الأقسام" value="" />
                {departments.map(d => (
                  <Picker.Item key={d.id} label={d.name} value={d.id} />
                ))}
              </Picker>
            </View>
          </View>

          {/* معلم - مع البحث */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>المدرس</Text>
            <TouchableOpacity
              onPress={() => setShowTeacherList(!showTeacherList)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10 }}
              testID="teacher-input"
            >
              <Ionicons name="person-outline" size={16} color="#666" />
              <Text style={{ flex: 1, fontSize: 13, color: selectedTeacher ? '#333' : '#999', textAlign: 'right' }}>
                {selectedTeacher
                  ? (teachers.find((t: any) => t.id === selectedTeacher)?.full_name || 'المدرس المختار')
                  : 'جميع المدرسين (اضغط للبحث)'}
              </Text>
              {selectedTeacher && (
                <TouchableOpacity onPress={(e: any) => { e.stopPropagation?.(); setSelectedTeacher(''); setTeacherQuery(''); }} testID="clear-teacher-btn">
                  <Ionicons name="close-circle" size={16} color="#f44336" />
                </TouchableOpacity>
              )}
              <Ionicons name={showTeacherList ? 'chevron-up' : 'chevron-down'} size={16} color="#666" />
            </TouchableOpacity>

            {showTeacherList && (
              <View style={{ marginTop: 6, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0', maxHeight: 280 }}>
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
                <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
                  {/* خيار "جميع المدرسين" */}
                  <TouchableOpacity
                    onPress={() => { setSelectedTeacher(''); setShowTeacherList(false); setTeacherQuery(''); }}
                    style={{ paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f5f5f5', backgroundColor: !selectedTeacher ? '#e3f2fd' : '#fff' }}
                  >
                    <Text style={{ fontSize: 13, color: '#1565c0', textAlign: 'right', fontWeight: '700' }}>جميع المدرسين</Text>
                  </TouchableOpacity>
                  {(() => {
                    const q = teacherQuery.trim().toLowerCase();
                    const filtered = q
                      ? teachers.filter((t: any) =>
                          (t.full_name || '').toLowerCase().includes(q) ||
                          (t.username || '').toLowerCase().includes(q) ||
                          (t.teacher_id || '').toLowerCase().includes(q)
                        )
                      : teachers;
                    if (filtered.length === 0) {
                      return <Text style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 12 }}>لا توجد نتائج</Text>;
                    }
                    return filtered.slice(0, 100).map((t: any) => (
                      <TouchableOpacity
                        key={t.id}
                        onPress={() => { setSelectedTeacher(t.id); setShowTeacherList(false); setTeacherQuery(''); }}
                        style={{ paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f5f5f5', backgroundColor: selectedTeacher === t.id ? '#e3f2fd' : '#fff' }}
                        testID={`teacher-option-${t.id}`}
                      >
                        <Text style={{ fontSize: 13, color: '#333', textAlign: 'right', fontWeight: selectedTeacher === t.id ? '700' : '400' }}>{t.full_name}</Text>
                        {(t.teacher_id || t.username) ? (
                          <Text style={{ fontSize: 10, color: '#888', textAlign: 'right' }}>{t.teacher_id || t.username}</Text>
                        ) : null}
                      </TouchableOpacity>
                    ));
                  })()}
                </ScrollView>
              </View>
            )}
          </View>

          {/* أزرار الفترة */}
          <View style={styles.periodBtns}>
            <TouchableOpacity style={styles.periodBtn} onPress={setCurrentWeek} data-testid="period-this-week">
              <Ionicons name="calendar-outline" size={16} color="#1565c0" />
              <Text style={styles.periodBtnText}>هذا الأسبوع</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.periodBtn} onPress={setCurrentMonth} data-testid="period-this-month">
              <Ionicons name="calendar" size={16} color="#1565c0" />
              <Text style={styles.periodBtnText}>هذا الشهر</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.periodBtns, { marginTop: 8 }]}>
            <TouchableOpacity style={styles.periodBtn} onPress={setPreviousMonth} data-testid="period-prev-month">
              <Ionicons name="arrow-back" size={16} color="#1565c0" />
              <Text style={styles.periodBtnText}>الشهر السابق</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.periodBtn} onPress={setTwoMonthsAgo} data-testid="period-two-months-ago">
              <Ionicons name="arrow-back" size={16} color="#1565c0" />
              <Text style={styles.periodBtnText}>الشهر الأسبق</Text>
            </TouchableOpacity>
          </View>

          {/* تاريخ مخصص */}
          {Platform.OS === 'web' && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.filterLabel}>من تاريخ</Text>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e: any) => setStartDate(e.target.value)}
                  style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}
                  data-testid="custom-start-date"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.filterLabel}>إلى تاريخ</Text>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e: any) => setEndDate(e.target.value)}
                  style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}
                  data-testid="custom-end-date"
                />
              </View>
            </View>
          )}

          {/* خيار التجميع الشهري - يظهر فقط إذا كانت الفترة متعددة الأشهر */}
          {isMultiMonth && (
            <TouchableOpacity
              style={[styles.monthlyToggle, splitByMonth && styles.monthlyToggleActive]}
              onPress={() => setSplitByMonth((v) => !v)}
              testID="split-by-month-toggle"
            >
              <Ionicons
                name={splitByMonth ? 'checkbox' : 'square-outline'}
                size={20}
                color={splitByMonth ? '#1565c0' : '#666'}
              />
              <Text style={[styles.monthlyToggleText, splitByMonth && { color: '#1565c0', fontWeight: '700' }]}>
                تقسيم النتيجة حسب الأشهر (تقرير منفصل لكل شهر)
              </Text>
            </TouchableOpacity>
          )}

          <View style={[styles.periodBtns, { marginTop: 12 }]}>
            <TouchableOpacity 
              style={[styles.periodBtn, { backgroundColor: '#ffebee' }]} 
              onPress={() => { setStartDate(''); setEndDate(''); setSelectedTeacher(''); setSelectedDept(''); setReportRun(false); setData([]); setMonthlyData([]); setSummary(null); setSplitByMonth(false); }}
            >
              <Ionicons name="refresh" size={16} color="#c62828" />
              <Text style={[styles.periodBtnText, { color: '#c62828' }]}>مسح الفلاتر</Text>
            </TouchableOpacity>
          </View>

          {/* عرض الفترة المحددة */}
          {(startDate || endDate) && (
            <View style={styles.periodInfo}>
              <Text style={styles.periodText}>
                الفترة: {startDate || '...'} إلى {endDate || '...'}
              </Text>
            </View>
          )}

          {/* زر تنفيذ التقرير */}
          <TouchableOpacity
            style={[styles.runBtn, loading && { opacity: 0.6 }]}
            onPress={runReport}
            disabled={loading}
            testID="run-report-btn"
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="play" size={18} color="#fff" />
                <Text style={styles.runBtnText}>تنفيذ التقرير</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
        )}

        {/* ملخص عام */}
        {summary && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>الملخص العام</Text>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{summary.total_teachers}</Text>
                <Text style={styles.summaryLabel}>مدرس</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{summary.total_required_hours}</Text>
                <Text style={styles.summaryLabel}>ساعة مطلوبة</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{summary.total_actual_hours}</Text>
                <Text style={styles.summaryLabel}>ساعة منفذة</Text>
              </View>
              <View style={[styles.summaryItem, summary.total_difference_hours >= 0 ? styles.extraPositive : styles.extraNegative]}>
                <Text style={styles.summaryValue}>{summary.total_difference_hours >= 0 ? '+' : ''}{summary.total_difference_hours}</Text>
                <Text style={styles.summaryLabel}>فرق الساعات</Text>
              </View>
            </View>
          </View>
        )}

        {/* قائمة المدرسين */}
        {!reportRun && !isTeacher ? (
          <View style={styles.emptyCard}>
            <Ionicons name="filter-outline" size={56} color="#bbb" />
            <Text style={styles.emptyText}>اختر الفلاتر ثم اضغط "تنفيذ التقرير" لعرض النتائج</Text>
          </View>
        ) : monthlyData.length > 0 ? (
          // عرض مجمّع حسب الشهر
          monthlyData.map((m, idx) => (
            <View key={m.label} style={{ marginBottom: 16 }}>
              <View style={styles.monthHeader}>
                <Ionicons name="calendar" size={18} color="#fff" />
                <Text style={styles.monthHeaderText}>تقرير شهر {m.label}</Text>
                <Text style={styles.monthHeaderSub}>
                  {m.summary?.total_actual_hours || 0} ساعة منفذة / {m.summary?.total_required_hours || 0} مطلوبة
                </Text>
              </View>
              {m.teachers.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>لا توجد بيانات لهذا الشهر</Text>
                </View>
              ) : (
                <TeacherList data={m.teachers} currentPage={1} setCurrentPage={() => {}} styles={styles} />
              )}
            </View>
          ))
        ) : data.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>لا توجد بيانات</Text>
          </View>
        ) : (
          <TeacherList data={data} currentPage={currentPage} setCurrentPage={setCurrentPage} styles={styles} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  runBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1565c0',
    paddingVertical: 14,
    borderRadius: 10,
  },
  runBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  monthlyToggle: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f5f7fb',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  monthlyToggleActive: { borderColor: '#1565c0', backgroundColor: '#e3f2fd' },
  monthlyToggleText: { flex: 1, fontSize: 13, color: '#444', textAlign: 'right' },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1565c0',
    padding: 10,
    borderRadius: 8,
    marginHorizontal: 16,
    marginTop: 12,
  },
  monthHeaderText: { color: '#fff', fontWeight: '700', fontSize: 14, flex: 1, textAlign: 'right' },
  monthHeaderSub: { color: '#e3f2fd', fontSize: 11 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    textAlign: 'center',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exportBtn: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  filterTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  filterRow: {
    marginBottom: 12,
  },
  filterLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  pickerWrapper: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
  },
  picker: {
    height: 45,
  },
  periodBtns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  periodBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e3f2fd',
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 4,
    gap: 4,
  },
  periodBtnText: {
    fontSize: 12,
    color: '#1565c0',
    fontWeight: '500',
  },
  periodInfo: {
    marginTop: 12,
    backgroundColor: '#fff3e0',
    padding: 8,
    borderRadius: 8,
  },
  periodText: {
    fontSize: 12,
    color: '#e65100',
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1565c0',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  extraPositive: {
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    padding: 8,
  },
  extraNegative: {
    backgroundColor: '#ffebee',
    borderRadius: 8,
    padding: 8,
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 10,
    fontSize: 16,
    color: '#999',
  },
  teacherCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  teacherHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  teacherInfo: {
    flex: 1,
  },
  teacherName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  teacherId: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  completionBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  completionGood: {
    backgroundColor: '#e8f5e9',
  },
  completionWarn: {
    backgroundColor: '#fff3e0',
  },
  completionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  teacherStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
  },
  extraBoxPositive: {
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    padding: 8,
  },
  extraBoxNegative: {
    backgroundColor: '#ffebee',
    borderRadius: 8,
    padding: 8,
  },
  extraValuePositive: {
    color: '#4caf50',
  },
  extraValueNegative: {
    color: '#f44336',
  },
  coursesSection: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
  },
  coursesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  courseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  courseInfo: {
    flex: 1,
  },
  courseName: {
    fontSize: 13,
    color: '#333',
  },
  courseCode: {
    fontSize: 11,
    color: '#999',
  },
  courseStats: {
    alignItems: 'flex-end',
  },
  courseStatText: {
    fontSize: 11,
    color: '#666',
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 16,
  },
  pageBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageBtnDisabled: {
    backgroundColor: '#f5f5f5',
  },
  pageText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
});
