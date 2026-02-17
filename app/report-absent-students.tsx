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
import { reportsAPI, departmentsAPI, coursesAPI } from '../src/services/api';

export default function AbsentStudentsReport() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [students, setStudents] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [minAbsenceRate, setMinAbsenceRate] = useState(25);
  const [summary, setSummary] = useState<any>(null);
  const [exporting, setExporting] = useState(false);

  // دالة تصدير Excel
  const exportToExcel = async () => {
    try {
      setExporting(true);
      const params: any = { min_absence_rate: minAbsenceRate };
      if (selectedDept) params.department_id = selectedDept;
      if (selectedCourse) params.course_id = selectedCourse;

      const response = await reportsAPI.exportAbsentStudentsExcel(params);
      
      if (Platform.OS === 'web') {
        const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'absent_students.xlsx';
        a.click();
      } else {
        const filename = `${FileSystem.documentDirectory}absent_students.xlsx`;
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
      const [deptsRes, coursesRes] = await Promise.all([
        departmentsAPI.getAll(),
        coursesAPI.getAll(),
      ]);
      setDepartments(deptsRes.data);
      setCourses(coursesRes.data);
      
      const params: any = { min_absence_rate: minAbsenceRate };
      if (selectedDept) params.department_id = selectedDept;
      if (selectedCourse) params.course_id = selectedCourse;
      
      const reportRes = await reportsAPI.getAbsentStudents(params);
      setStudents(reportRes.data.students || []);
      setSummary(reportRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDept, selectedCourse, minAbsenceRate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const filteredCourses = selectedDept 
    ? courses.filter(c => c.department_id === selectedDept)
    : courses;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#f44336" />
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
        <Text style={styles.headerTitle}>الطلاب المتغيبين</Text>
        <TouchableOpacity 
          style={styles.exportBtn}
          onPress={exportToExcel}
          disabled={exporting || students.length === 0}
        >
          {exporting ? (
            <ActivityIndicator size="small" color="#4caf50" />
          ) : (
            <Ionicons name="download-outline" size={24} color={students.length > 0 ? "#4caf50" : "#ccc"} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* الفلاتر */}
        <View style={styles.filtersCard}>
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>القسم</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={selectedDept}
                onValueChange={(value) => {
                  setSelectedDept(value);
                  setSelectedCourse('');
                }}
                style={styles.picker}
              >
                <Picker.Item label="جميع الأقسام" value="" />
                {departments.map(d => (
                  <Picker.Item key={d.id} label={d.name} value={d.id} />
                ))}
              </Picker>
            </View>
          </View>

          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>المقرر</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={selectedCourse}
                onValueChange={setSelectedCourse}
                style={styles.picker}
              >
                <Picker.Item label="جميع المقررات" value="" />
                {filteredCourses.map(c => (
                  <Picker.Item key={c.id} label={`${c.name} (${c.code})`} value={c.id} />
                ))}
              </Picker>
            </View>
          </View>

          {/* نسبة الغياب */}
          <View style={styles.thresholdSection}>
            <Text style={styles.filterLabel}>الحد الأدنى لنسبة الغياب</Text>
            <View style={styles.thresholdBtns}>
              {[15, 25, 35, 50].map(rate => (
                <TouchableOpacity
                  key={rate}
                  style={[styles.thresholdBtn, minAbsenceRate === rate && styles.thresholdBtnActive]}
                  onPress={() => setMinAbsenceRate(rate)}
                >
                  <Text style={[styles.thresholdBtnText, minAbsenceRate === rate && styles.thresholdBtnTextActive]}>
                    {rate}%
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* ملخص */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryIcon}>
            <Ionicons name="alert-circle" size={32} color="#f44336" />
          </View>
          <View style={styles.summaryInfo}>
            <Text style={styles.summaryValue}>{summary?.total_count || 0}</Text>
            <Text style={styles.summaryLabel}>طالب متغيب ({minAbsenceRate}%+)</Text>
          </View>
        </View>

        {/* قائمة الطلاب */}
        {students.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle" size={48} color="#4caf50" />
            <Text style={styles.emptyText}>لا يوجد طلاب متغيبين بهذه النسبة</Text>
          </View>
        ) : (
          students.map((student, index) => (
            <View key={index} style={styles.studentCard}>
              <View style={styles.studentHeader}>
                <View style={styles.studentInfo}>
                  <Text style={styles.studentName}>{student.student_name}</Text>
                  <Text style={styles.studentId}>{student.student_id}</Text>
                </View>
                <View style={[
                  styles.rateBadge,
                  student.absence_rate >= 40 ? styles.rateDanger :
                  student.absence_rate >= 25 ? styles.rateWarning : styles.rateNormal
                ]}>
                  <Text style={styles.rateText}>{student.absence_rate}%</Text>
                </View>
              </View>

              <View style={styles.courseRow}>
                <Ionicons name="book-outline" size={16} color="#666" />
                <Text style={styles.courseName}>{student.course_name}</Text>
                <Text style={styles.courseCode}>({student.course_code})</Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, styles.absentValue]}>{student.absent_count}</Text>
                  <Text style={styles.statLabel}>غياب</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{student.total_lectures}</Text>
                  <Text style={styles.statLabel}>محاضرة</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>
                    {student.total_lectures - student.absent_count}
                  </Text>
                  <Text style={styles.statLabel}>حضور</Text>
                </View>
              </View>

              {/* شريط الغياب */}
              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill,
                    { width: `${student.absence_rate}%` },
                    student.absence_rate >= 40 ? styles.progressDanger :
                    student.absence_rate >= 25 ? styles.progressWarning : styles.progressNormal
                  ]} 
                />
              </View>
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
  thresholdSection: {
    marginTop: 8,
  },
  thresholdBtns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  thresholdBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  thresholdBtnActive: {
    backgroundColor: '#ffebee',
  },
  thresholdBtnText: {
    fontSize: 14,
    color: '#666',
  },
  thresholdBtnTextActive: {
    color: '#f44336',
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ffebee',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 16,
  },
  summaryInfo: {
    flex: 1,
  },
  summaryValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#f44336',
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
    color: '#4caf50',
  },
  studentCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderRightWidth: 4,
    borderRightColor: '#f44336',
  },
  studentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  studentId: {
    fontSize: 12,
    color: '#666',
  },
  rateBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  rateDanger: {
    backgroundColor: '#ffebee',
  },
  rateWarning: {
    backgroundColor: '#fff3e0',
  },
  rateNormal: {
    backgroundColor: '#f5f5f5',
  },
  rateText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f44336',
  },
  courseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    backgroundColor: '#f5f5f5',
    padding: 8,
    borderRadius: 8,
  },
  courseName: {
    flex: 1,
    fontSize: 13,
    color: '#333',
  },
  courseCode: {
    fontSize: 11,
    color: '#999',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  absentValue: {
    color: '#f44336',
  },
  statLabel: {
    fontSize: 11,
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
  progressDanger: {
    backgroundColor: '#f44336',
  },
  progressWarning: {
    backgroundColor: '#ff9800',
  },
  progressNormal: {
    backgroundColor: '#ffc107',
  },
  exportBtn: {
    padding: 4,
  },
});
