import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { reportsAPI, departmentsAPI } from '../src/services/api';

export default function AttendanceOverviewReport() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [courses, setCourses] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState('');
  const [summary, setSummary] = useState<any>(null);
  const [sortBy, setSortBy] = useState<'name' | 'rate'>('rate');
  const [exporting, setExporting] = useState(false);

  // دالة تصدير Excel
  const exportToExcel = async () => {
    try {
      setExporting(true);
      const params: any = {};
      if (selectedDept) params.department_id = selectedDept;

      const response = await reportsAPI.exportAttendanceOverviewExcel(params);
      
      if (Platform.OS === 'web') {
        const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'attendance_overview.xlsx';
        a.click();
      } else {
        const filename = `${FileSystem.documentDirectory}attendance_overview.xlsx`;
        const reader = new FileReader();
        const blob = new Blob([response.data]);
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          await FileSystem.writeAsStringAsync(filename, base64, { encoding: FileSystem.EncodingType.Base64 });
          await Sharing.shareAsync(filename);
        };
        reader.readAsDataURL(blob);
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
      const deptsRes = await departmentsAPI.getAll();
      setDepartments(deptsRes.data);
      
      const params: any = {};
      if (selectedDept) params.department_id = selectedDept;
      
      const reportRes = await reportsAPI.getAttendanceOverview(params);
      setCourses(reportRes.data.courses || []);
      setSummary(reportRes.data.summary);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDept]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const sortedCourses = [...courses].sort((a, b) => {
    if (sortBy === 'rate') {
      return b.attendance_rate - a.attendance_rate;
    }
    return a.course_name.localeCompare(b.course_name, 'ar');
  });

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
        <Text style={styles.headerTitle}>تقرير الحضور الشامل</Text>
        <TouchableOpacity 
          style={styles.exportBtn}
          onPress={exportToExcel}
          disabled={exporting || courses.length === 0}
        >
          {exporting ? (
            <ActivityIndicator size="small" color="#4caf50" />
          ) : (
            <Ionicons name="download-outline" size={24} color={courses.length > 0 ? "#4caf50" : "#ccc"} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* فلاتر */}
        <View style={styles.filtersCard}>
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

          {/* ترتيب */}
          <View style={styles.sortRow}>
            <Text style={styles.sortLabel}>ترتيب حسب:</Text>
            <TouchableOpacity
              style={[styles.sortBtn, sortBy === 'rate' && styles.sortBtnActive]}
              onPress={() => setSortBy('rate')}
            >
              <Text style={[styles.sortBtnText, sortBy === 'rate' && styles.sortBtnTextActive]}>
                نسبة الحضور
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortBtn, sortBy === 'name' && styles.sortBtnActive]}
              onPress={() => setSortBy('name')}
            >
              <Text style={[styles.sortBtnText, sortBy === 'name' && styles.sortBtnTextActive]}>
                الاسم
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ملخص */}
        {summary && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Ionicons name="book" size={28} color="#1565c0" />
                <Text style={styles.summaryValue}>{summary.total_courses}</Text>
                <Text style={styles.summaryLabel}>مقرر</Text>
              </View>
              <View style={styles.summaryItem}>
                <Ionicons name="stats-chart" size={28} color="#4caf50" />
                <Text style={styles.summaryValue}>{summary.avg_attendance_rate}%</Text>
                <Text style={styles.summaryLabel}>متوسط الحضور</Text>
              </View>
            </View>
          </View>
        )}

        {/* قائمة المقررات */}
        {sortedCourses.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>لا توجد بيانات</Text>
          </View>
        ) : (
          sortedCourses.map((course, index) => (
            <TouchableOpacity
              key={index}
              style={styles.courseCard}
              onPress={() => router.push(`/report-course?id=${course.course_id}`)}
            >
              <View style={styles.courseHeader}>
                <View style={styles.courseInfo}>
                  <Text style={styles.courseName}>{course.course_name}</Text>
                  <Text style={styles.courseCode}>{course.course_code}</Text>
                  {course.teacher_name && (
                    <Text style={styles.teacherName}>
                      <Ionicons name="person-outline" size={12} color="#666" /> {course.teacher_name}
                    </Text>
                  )}
                </View>
                <View style={[
                  styles.rateBadge,
                  course.attendance_rate >= 80 ? styles.rateGood :
                  course.attendance_rate >= 60 ? styles.rateMedium : styles.rateLow
                ]}>
                  <Text style={styles.rateText}>{course.attendance_rate}%</Text>
                </View>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <View style={[styles.statDot, { backgroundColor: '#4caf50' }]} />
                  <Text style={styles.statText}>{course.present_count} حاضر</Text>
                </View>
                <View style={styles.statItem}>
                  <View style={[styles.statDot, { backgroundColor: '#f44336' }]} />
                  <Text style={styles.statText}>{course.absent_count} غائب</Text>
                </View>
                <View style={styles.statItem}>
                  <View style={[styles.statDot, { backgroundColor: '#ff9800' }]} />
                  <Text style={styles.statText}>{course.late_count} متأخر</Text>
                </View>
              </View>

              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill,
                    { width: `${course.attendance_rate}%` },
                    course.attendance_rate >= 80 ? styles.progressGood :
                    course.attendance_rate >= 60 ? styles.progressMedium : styles.progressLow
                  ]} 
                />
              </View>
            </TouchableOpacity>
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
  scrollView: {
    flex: 1,
    padding: 16,
  },
  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
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
    overflow: 'hidden',
  },
  picker: {
    height: 45,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sortLabel: {
    fontSize: 13,
    color: '#666',
  },
  sortBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
  },
  sortBtnActive: {
    backgroundColor: '#e3f2fd',
  },
  sortBtnText: {
    fontSize: 12,
    color: '#666',
  },
  sortBtnTextActive: {
    color: '#1565c0',
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    marginTop: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
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
  courseCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  courseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  courseInfo: {
    flex: 1,
  },
  courseName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  courseCode: {
    fontSize: 12,
    color: '#666',
  },
  teacherName: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  rateBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  rateGood: {
    backgroundColor: '#e8f5e9',
  },
  rateMedium: {
    backgroundColor: '#fff3e0',
  },
  rateLow: {
    backgroundColor: '#ffebee',
  },
  rateText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statText: {
    fontSize: 12,
    color: '#666',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#eee',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressGood: {
    backgroundColor: '#4caf50',
  },
  progressMedium: {
    backgroundColor: '#ff9800',
  },
  progressLow: {
    backgroundColor: '#f44336',
  },
  exportBtn: {
    padding: 4,
  },
});
