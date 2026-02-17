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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { reportsAPI, coursesAPI } from '../src/services/api';

export default function CourseDetailedReport() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourse, setSelectedCourse] = useState(params.id as string || '');
  const [reportData, setReportData] = useState<any>(null);
  const [exporting, setExporting] = useState(false);

  // دالة تصدير Excel
  const exportToExcel = async () => {
    if (!selectedCourse) return;
    
    try {
      setExporting(true);
      const response = await reportsAPI.exportCourseReportExcel(selectedCourse);
      const course = courses.find(c => c.id === selectedCourse);
      const filename = `course_report_${course?.code || 'course'}.xlsx`;
      
      if (Platform.OS === 'web') {
        const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
      } else {
        const filePath = `${FileSystem.documentDirectory}${filename}`;
        const reader = new FileReader();
        const blob = new Blob([response.data]);
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          await FileSystem.writeAsStringAsync(filePath, base64, { encoding: FileSystem.EncodingType.Base64 });
          await Sharing.shareAsync(filePath);
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

  const fetchCourses = useCallback(async () => {
    try {
      const res = await coursesAPI.getAll();
      setCourses(res.data);
    } catch (error) {
      console.error('Error fetching courses:', error);
    }
  }, []);

  const fetchReport = useCallback(async () => {
    if (!selectedCourse) {
      setLoading(false);
      return;
    }
    
    try {
      const res = await reportsAPI.getCourseDetailedReport(selectedCourse);
      setReportData(res.data);
    } catch (error) {
      console.error('Error fetching report:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCourse]);

  useEffect(() => {
    fetchCourses();
  }, []);

  useEffect(() => {
    if (selectedCourse) {
      setLoading(true);
      fetchReport();
    }
  }, [selectedCourse, fetchReport]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchReport();
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>تقرير المقرر التفصيلي</Text>
        <TouchableOpacity 
          style={styles.exportBtn}
          onPress={exportToExcel}
          disabled={exporting || !reportData}
        >
          {exporting ? (
            <ActivityIndicator size="small" color="#4caf50" />
          ) : (
            <Ionicons name="download-outline" size={24} color={reportData ? "#4caf50" : "#ccc"} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* اختيار المقرر */}
        <View style={styles.selectorCard}>
          <Text style={styles.selectorLabel}>اختر المقرر</Text>
          <View style={styles.pickerWrapper}>
            <Picker
              selectedValue={selectedCourse}
              onValueChange={setSelectedCourse}
              style={styles.picker}
            >
              <Picker.Item label="-- اختر المقرر --" value="" />
              {courses.map(c => (
                <Picker.Item key={c.id} label={`${c.name} (${c.code})`} value={c.id} />
              ))}
            </Picker>
          </View>
        </View>

        {loading && selectedCourse ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#00bcd4" />
            <Text style={styles.loadingText}>جاري تحميل التقرير...</Text>
          </View>
        ) : !selectedCourse ? (
          <View style={styles.emptyCard}>
            <Ionicons name="book-outline" size={64} color="#e0e0e0" />
            <Text style={styles.emptyText}>اختر مقرراً لعرض تقريره</Text>
          </View>
        ) : reportData ? (
          <>
            {/* معلومات المقرر */}
            <View style={styles.courseCard}>
              <View style={styles.courseIcon}>
                <Ionicons name="book" size={32} color="#fff" />
              </View>
              <View style={styles.courseInfo}>
                <Text style={styles.courseName}>{reportData.course.name}</Text>
                <Text style={styles.courseCode}>{reportData.course.code}</Text>
                {reportData.course.teacher_name && (
                  <Text style={styles.teacherName}>
                    <Ionicons name="person" size={12} color="#fff" /> {reportData.course.teacher_name}
                  </Text>
                )}
              </View>
            </View>

            {/* ملخص */}
            <View style={styles.summaryCard}>
              <Text style={styles.sectionTitle}>الملخص</Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{reportData.summary.total_students}</Text>
                  <Text style={styles.summaryLabel}>طالب</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{reportData.summary.total_lectures}</Text>
                  <Text style={styles.summaryLabel}>محاضرة</Text>
                </View>
                <View style={[styles.summaryItem, styles.summaryHighlight]}>
                  <Text style={styles.summaryValue}>{reportData.summary.avg_attendance_rate}%</Text>
                  <Text style={styles.summaryLabel}>متوسط الحضور</Text>
                </View>
              </View>
            </View>

            {/* سجل المحاضرات */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>سجل المحاضرات ({reportData.lectures?.length || 0})</Text>
              {reportData.lectures?.map((lecture: any, index: number) => (
                <View key={index} style={styles.lectureRow}>
                  <View style={styles.lectureDate}>
                    <Text style={styles.lectureDateText}>
                      {new Date(lecture.date).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                  <View style={styles.lectureInfo}>
                    <Text style={styles.lectureTime}>{lecture.start_time}</Text>
                    <Text style={styles.lectureStats}>
                      {lecture.present_count}/{lecture.total_students} حاضر
                    </Text>
                  </View>
                  <View style={[
                    styles.lectureRate,
                    lecture.attendance_rate >= 80 ? styles.rateGood :
                    lecture.attendance_rate >= 60 ? styles.rateMedium : styles.rateLow
                  ]}>
                    <Text style={styles.lectureRateText}>{lecture.attendance_rate}%</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* قائمة الطلاب */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>الطلاب ({reportData.students?.length || 0})</Text>
              {reportData.students?.map((student: any, index: number) => (
                <View key={index} style={styles.studentRow}>
                  <View style={styles.studentRank}>
                    <Text style={styles.rankText}>{index + 1}</Text>
                  </View>
                  <View style={styles.studentInfo}>
                    <Text style={styles.studentName}>{student.student_name}</Text>
                    <Text style={styles.studentId}>{student.student_id}</Text>
                  </View>
                  <View style={styles.studentStats}>
                    <Text style={styles.presentCount}>
                      <Text style={{ color: '#4caf50' }}>{student.present}</Text>/{reportData.summary.total_lectures}
                    </Text>
                  </View>
                  <View style={[
                    styles.studentRate,
                    student.attendance_rate >= 75 ? styles.rateGood :
                    student.attendance_rate >= 50 ? styles.rateMedium : styles.rateLow
                  ]}>
                    <Text style={styles.studentRateText}>{student.attendance_rate}%</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
  selectorCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  selectorLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  pickerWrapper: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  loadingCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 60,
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: '#999',
  },
  courseCard: {
    backgroundColor: '#00bcd4',
    borderRadius: 12,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  courseIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 16,
  },
  courseInfo: {
    flex: 1,
  },
  courseName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  courseCode: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  teacherName: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryHighlight: {
    backgroundColor: '#e0f7fa',
    borderRadius: 12,
    padding: 12,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#666',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  lectureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  lectureDate: {
    width: 50,
  },
  lectureDateText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  lectureInfo: {
    flex: 1,
    paddingHorizontal: 8,
  },
  lectureTime: {
    fontSize: 13,
    color: '#333',
  },
  lectureStats: {
    fontSize: 11,
    color: '#666',
  },
  lectureRate: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  lectureRateText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  studentRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  rankText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 14,
    color: '#333',
  },
  studentId: {
    fontSize: 11,
    color: '#999',
  },
  studentStats: {
    paddingHorizontal: 8,
  },
  presentCount: {
    fontSize: 13,
    color: '#666',
  },
  studentRate: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  studentRateText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
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
  exportBtn: {
    padding: 4,
  },
});
