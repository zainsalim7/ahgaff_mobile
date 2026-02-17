import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { reportsAPI, studentsAPI } from '../src/services/api';

export default function StudentReport() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [studentData, setStudentData] = useState<any>(null);

  // دالة تصدير Excel
  const exportToExcel = async () => {
    if (!studentData?.student?.id) return;
    
    try {
      setExporting(true);
      const response = await reportsAPI.exportStudentReportExcel(studentData.student.id);
      
      if (Platform.OS === 'web') {
        const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `student_report_${studentData.student.student_id}.xlsx`;
        a.click();
      } else {
        const filename = `${FileSystem.documentDirectory}student_report_${studentData.student.student_id}.xlsx`;
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

  const searchStudent = async () => {
    if (!searchQuery.trim()) {
      Alert.alert('تنبيه', 'أدخل رقم القيد أو اسم الطالب');
      return;
    }

    setLoading(true);
    try {
      // البحث عن الطالب أولاً
      const studentsRes = await studentsAPI.getAll();
      const students = studentsRes.data;
      
      // البحث برقم القيد أو الاسم
      const found = students.find((s: any) => 
        s.student_id === searchQuery || 
        s.full_name.includes(searchQuery) ||
        s.id === searchQuery
      );
      
      if (!found) {
        Alert.alert('خطأ', 'الطالب غير موجود');
        setStudentData(null);
        return;
      }
      
      // جلب تقرير الطالب
      const reportRes = await reportsAPI.getStudentReport(found.id);
      setStudentData(reportRes.data);
    } catch (error) {
      console.error('Error searching student:', error);
      Alert.alert('خطأ', 'فشل في جلب بيانات الطالب');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>تقرير حضور طالب</Text>
        <TouchableOpacity 
          style={styles.exportBtn}
          onPress={exportToExcel}
          disabled={exporting || !studentData}
        >
          {exporting ? (
            <ActivityIndicator size="small" color="#4caf50" />
          ) : (
            <Ionicons name="download-outline" size={24} color={studentData ? "#4caf50" : "#ccc"} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView}>
        {/* البحث */}
        <View style={styles.searchCard}>
          <Text style={styles.searchLabel}>البحث عن طالب</Text>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="رقم القيد أو اسم الطالب"
              placeholderTextColor="#999"
              onSubmitEditing={searchStudent}
            />
            <TouchableOpacity 
              style={styles.searchBtn}
              onPress={searchStudent}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="search" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* بيانات الطالب */}
        {studentData && (
          <>
            {/* معلومات الطالب */}
            <View style={styles.studentCard}>
              <View style={styles.studentAvatar}>
                <Ionicons name="person" size={32} color="#fff" />
              </View>
              <View style={styles.studentInfo}>
                <Text style={styles.studentName}>{studentData.student.full_name}</Text>
                <Text style={styles.studentId}>رقم القيد: {studentData.student.student_id}</Text>
                <Text style={styles.studentDetails}>
                  المستوى {studentData.student.level} - الشعبة {studentData.student.section || '-'}
                </Text>
              </View>
            </View>

            {/* ملخص الحضور */}
            <View style={styles.summaryCard}>
              <Text style={styles.sectionTitle}>ملخص الحضور العام</Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{studentData.summary.total_courses}</Text>
                  <Text style={styles.summaryLabel}>مقرر</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{studentData.summary.total_lectures}</Text>
                  <Text style={styles.summaryLabel}>محاضرة</Text>
                </View>
                <View style={[styles.summaryItem, styles.summarySuccess]}>
                  <Text style={styles.summaryValue}>{studentData.summary.total_present}</Text>
                  <Text style={styles.summaryLabel}>حاضر</Text>
                </View>
                <View style={[styles.summaryItem, styles.summaryDanger]}>
                  <Text style={styles.summaryValue}>{studentData.summary.total_absent}</Text>
                  <Text style={styles.summaryLabel}>غائب</Text>
                </View>
              </View>
              
              {/* نسبة الحضور الإجمالية */}
              <View style={styles.overallRate}>
                <Text style={styles.overallLabel}>نسبة الحضور الإجمالية</Text>
                <View style={styles.rateCircle}>
                  <Text style={[
                    styles.rateValue,
                    studentData.summary.overall_attendance_rate >= 75 ? styles.rateGood :
                    studentData.summary.overall_attendance_rate >= 50 ? styles.rateMedium : styles.rateLow
                  ]}>
                    {studentData.summary.overall_attendance_rate}%
                  </Text>
                </View>
              </View>
            </View>

            {/* تفاصيل المقررات */}
            <Text style={styles.sectionTitle}>تفاصيل المقررات ({studentData.courses.length})</Text>
            
            {studentData.courses.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="book-outline" size={48} color="#ccc" />
                <Text style={styles.emptyText}>لا توجد مقررات مسجلة</Text>
              </View>
            ) : (
              studentData.courses.map((course: any, index: number) => (
                <View key={index} style={styles.courseCard}>
                  <View style={styles.courseHeader}>
                    <View style={styles.courseInfo}>
                      <Text style={styles.courseName}>{course.course_name}</Text>
                      <Text style={styles.courseCode}>{course.course_code}</Text>
                    </View>
                    <View style={[
                      styles.rateBadge,
                      course.attendance_rate >= 75 ? styles.rateBadgeGood :
                      course.attendance_rate >= 50 ? styles.rateBadgeMedium : styles.rateBadgeLow
                    ]}>
                      <Text style={styles.rateBadgeText}>{course.attendance_rate}%</Text>
                    </View>
                  </View>

                  <View style={styles.courseStats}>
                    <View style={styles.courseStat}>
                      <Text style={styles.courseStatValue}>{course.total_lectures}</Text>
                      <Text style={styles.courseStatLabel}>محاضرة</Text>
                    </View>
                    <View style={styles.courseStat}>
                      <View style={[styles.statDot, { backgroundColor: '#4caf50' }]} />
                      <Text style={styles.courseStatValue}>{course.present}</Text>
                      <Text style={styles.courseStatLabel}>حاضر</Text>
                    </View>
                    <View style={styles.courseStat}>
                      <View style={[styles.statDot, { backgroundColor: '#f44336' }]} />
                      <Text style={styles.courseStatValue}>{course.absent}</Text>
                      <Text style={styles.courseStatLabel}>غائب</Text>
                    </View>
                    <View style={styles.courseStat}>
                      <View style={[styles.statDot, { backgroundColor: '#ff9800' }]} />
                      <Text style={styles.courseStatValue}>{course.late}</Text>
                      <Text style={styles.courseStatLabel}>متأخر</Text>
                    </View>
                  </View>

                  {/* شريط التقدم */}
                  <View style={styles.progressBar}>
                    <View 
                      style={[
                        styles.progressFill,
                        { width: `${course.attendance_rate}%` },
                        course.attendance_rate >= 75 ? styles.progressGood :
                        course.attendance_rate >= 50 ? styles.progressMedium : styles.progressLow
                      ]} 
                    />
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {/* رسالة البداية */}
        {!studentData && !loading && (
          <View style={styles.welcomeCard}>
            <Ionicons name="search-outline" size={64} color="#e0e0e0" />
            <Text style={styles.welcomeText}>ابحث عن طالب لعرض تقرير حضوره</Text>
            <Text style={styles.welcomeHint}>أدخل رقم القيد أو اسم الطالب</Text>
          </View>
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
  searchCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  searchLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    textAlign: 'right',
  },
  searchBtn: {
    backgroundColor: '#9c27b0',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  studentCard: {
    backgroundColor: '#9c27b0',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  studentAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 16,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  studentId: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  studentDetails: {
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
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
    padding: 8,
    borderRadius: 8,
  },
  summarySuccess: {
    backgroundColor: '#e8f5e9',
  },
  summaryDanger: {
    backgroundColor: '#ffebee',
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#666',
  },
  overallRate: {
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  overallLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  rateCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#e0e0e0',
  },
  rateValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  rateGood: {
    color: '#4caf50',
  },
  rateMedium: {
    color: '#ff9800',
  },
  rateLow: {
    color: '#f44336',
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
    alignItems: 'center',
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
  rateBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  rateBadgeGood: {
    backgroundColor: '#e8f5e9',
  },
  rateBadgeMedium: {
    backgroundColor: '#fff3e0',
  },
  rateBadgeLow: {
    backgroundColor: '#ffebee',
  },
  rateBadgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  courseStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  courseStat: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  courseStatValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  courseStatLabel: {
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
  progressGood: {
    backgroundColor: '#4caf50',
  },
  progressMedium: {
    backgroundColor: '#ff9800',
  },
  progressLow: {
    backgroundColor: '#f44336',
  },
  welcomeCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 60,
    alignItems: 'center',
  },
  welcomeText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  welcomeHint: {
    marginTop: 8,
    fontSize: 13,
    color: '#999',
  },
  exportBtn: {
    padding: 4,
  },
});
