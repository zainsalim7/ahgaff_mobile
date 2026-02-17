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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { reportsAPI, teachersAPI, departmentsAPI } from '../src/services/api';

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
    total_scheduled_hours: number;
    total_actual_hours: number;
    extra_hours: number;
    completion_rate: number;
  };
}

export default function TeacherWorkloadReport() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [data, setData] = useState<TeacherWorkload[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [summary, setSummary] = useState<any>(null);

  // دالة تصدير Excel
  const exportToExcel = async () => {
    try {
      setExporting(true);
      const params: any = {};
      if (selectedTeacher) params.teacher_id = selectedTeacher;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const response = await reportsAPI.exportTeacherWorkloadExcel(params);
      
      if (Platform.OS === 'web') {
        const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'teacher_workload.xlsx';
        a.click();
      } else {
        const filename = `${FileSystem.documentDirectory}teacher_workload.xlsx`;
        const base64 = btoa(
          new Uint8Array(response.data).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        await FileSystem.writeAsStringAsync(filename, base64, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(filename);
      }
      Alert.alert('نجاح', 'تم تصدير التقرير بنجاح');
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('خطأ', 'فشل في تصدير التقرير');
    } finally {
      setExporting(false);
    }
  };

  const fetchData = useCallback(async () => {
    try {
      const [teachersRes, deptsRes] = await Promise.all([
        teachersAPI.getAll(),
        departmentsAPI.getAll(),
      ]);
      setTeachers(teachersRes.data);
      setDepartments(deptsRes.data);
      
      // جلب التقرير
      const params: any = {};
      if (selectedTeacher) params.teacher_id = selectedTeacher;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      
      const reportRes = await reportsAPI.getTeacherWorkload(params);
      
      let reportData = reportRes.data.teachers || [];
      
      // فلترة حسب القسم في الفرونت
      if (selectedDept) {
        reportData = reportData.filter((t: TeacherWorkload) => t.department_id === selectedDept);
      }
      
      setData(reportData);
      setSummary(reportRes.data.summary);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedTeacher, selectedDept, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // تحديد تواريخ الشهر الحالي
  const setCurrentMonth = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
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
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>تقرير نصاب المدرسين</Text>
        <TouchableOpacity 
          style={styles.exportBtn}
          onPress={exportToExcel}
          disabled={exporting || data.length === 0}
        >
          {exporting ? (
            <ActivityIndicator size="small" color="#4caf50" />
          ) : (
            <Ionicons name="download-outline" size={24} color={data.length > 0 ? "#4caf50" : "#ccc"} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* الفلاتر */}
        <View style={styles.filtersCard}>
          <Text style={styles.filterTitle}>فلاتر البحث</Text>
          
          {/* قسم */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>القسم</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={selectedDept}
                onValueChange={setSelectedDept}
                style={styles.picker}
              >
                <Picker.Item label="جميع الأقسام" value="" />
                {departments.map(d => (
                  <Picker.Item key={d.id} label={d.name} value={d.id} />
                ))}
              </Picker>
            </View>
          </View>

          {/* معلم */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>المدرس</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={selectedTeacher}
                onValueChange={setSelectedTeacher}
                style={styles.picker}
              >
                <Picker.Item label="جميع المدرسين" value="" />
                {teachers.map(t => (
                  <Picker.Item key={t.id} label={t.full_name} value={t.id} />
                ))}
              </Picker>
            </View>
          </View>

          {/* أزرار الفترة */}
          <View style={styles.periodBtns}>
            <TouchableOpacity style={styles.periodBtn} onPress={setCurrentWeek}>
              <Ionicons name="calendar-outline" size={16} color="#1565c0" />
              <Text style={styles.periodBtnText}>هذا الأسبوع</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.periodBtn} onPress={setCurrentMonth}>
              <Ionicons name="calendar" size={16} color="#1565c0" />
              <Text style={styles.periodBtnText}>هذا الشهر</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.periodBtn} 
              onPress={() => { setStartDate(''); setEndDate(''); }}
            >
              <Ionicons name="refresh" size={16} color="#1565c0" />
              <Text style={styles.periodBtnText}>إعادة تعيين</Text>
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
        </View>

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
                <Text style={styles.summaryValue}>{summary.total_scheduled_hours}</Text>
                <Text style={styles.summaryLabel}>ساعة مجدولة</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{summary.total_actual_hours}</Text>
                <Text style={styles.summaryLabel}>ساعة منفذة</Text>
              </View>
              <View style={[styles.summaryItem, summary.total_extra_hours > 0 ? styles.extraPositive : styles.extraNegative]}>
                <Text style={styles.summaryValue}>{summary.total_extra_hours}</Text>
                <Text style={styles.summaryLabel}>ساعات زيادة</Text>
              </View>
            </View>
          </View>
        )}

        {/* قائمة المدرسين */}
        {data.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>لا توجد بيانات</Text>
          </View>
        ) : (
          data.map((teacher, index) => (
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

              {/* إحصائيات المدرس */}
              <View style={styles.teacherStats}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{teacher.summary.total_scheduled_hours}</Text>
                  <Text style={styles.statLabel}>مجدول</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{teacher.summary.total_actual_hours}</Text>
                  <Text style={styles.statLabel}>منفذ</Text>
                </View>
                <View style={[
                  styles.statBox,
                  teacher.summary.extra_hours >= 0 ? styles.extraBoxPositive : styles.extraBoxNegative
                ]}>
                  <Text style={[
                    styles.statValue,
                    teacher.summary.extra_hours >= 0 ? styles.extraValuePositive : styles.extraValueNegative
                  ]}>
                    {teacher.summary.extra_hours >= 0 ? '+' : ''}{teacher.summary.extra_hours}
                  </Text>
                  <Text style={styles.statLabel}>زيادة/نقص</Text>
                </View>
              </View>

              {/* تفاصيل المقررات */}
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
                        <Text style={styles.courseStatText}>
                          {course.executed_lectures}/{course.scheduled_lectures} محاضرة
                        </Text>
                        <Text style={styles.courseStatText}>
                          {course.actual_hours}/{course.scheduled_hours} ساعة
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))
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
});
