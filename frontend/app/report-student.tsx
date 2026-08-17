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
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { reportsAPI, studentsAPI, departmentsAPI, coursesAPI } from '../src/services/api';
import { exportToPDF, prepareStudentReportData } from '../src/utils/pdfExport';
import { useAuth } from '../src/contexts/AuthContext';

export default function StudentReport() {
  const router = useRouter();
  const { user, token, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  
  // هل المستخدم طالب؟
  const isStudent = user?.role === 'student';
  
  // بيانات الفلاتر
  const [departments, setDepartments] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<any[]>([]);
  
  // الفلاتر المحددة
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  
  // بيانات التقرير
  const [studentData, setStudentData] = useState<any>(null);

  // جلب بيانات الفلاتر عند الدخول للصفحة
  useEffect(() => {
    if (authLoading || !token) {
      return;
    }
    if (isStudent) {
      // الطالب: جلب تقريره الشخصي تلقائياً
      fetchMyReport();
    } else {
      fetchFiltersData();
    }
  }, [authLoading, token]);

  // جلب تقرير الطالب الشخصي تلقائياً
  const fetchMyReport = async () => {
    try {
      setLoading(true);
      setLoadingFilters(false);
      // جلب بيانات الطالب من /api/students/me
      const meRes = await studentsAPI.getMe();
      const myStudentId = meRes.data?.id;
      if (myStudentId) {
        const reportRes = await reportsAPI.getStudentReport(myStudentId);
        setStudentData(reportRes.data);
      }
    } catch (error) {
      console.error('Error fetching my report:', error);
      Alert.alert('خطأ', 'فشل في جلب تقريرك');
    } finally {
      setLoading(false);
    }
  };

  // زر تحديث يدوي
  const handleRefresh = () => {
    if (isStudent) {
      fetchMyReport();
    } else {
      fetchFiltersData();
    }
  };

  const fetchFiltersData = async () => {
    try {
      setLoadingFilters(true);
      const [deptsRes, coursesRes, studentsRes] = await Promise.all([
        departmentsAPI.getAll(),
        coursesAPI.getAll(),
        studentsAPI.getAll()
      ]);
      
      let allCourses = coursesRes.data || [];
      let allStudents = studentsRes.data || [];
      let allDepts = deptsRes.data || [];
      
      // الباك إند يفلتر المقررات والطلاب حسب دور المستخدم تلقائياً
      // لكن الأقسام لا تُفلتر - نفلترها حسب المقررات المتاحة
      if (user?.role !== 'admin') {
        const courseDeptIds = new Set(allCourses.map((c: any) => c.department_id).filter(Boolean));
        if (courseDeptIds.size > 0) {
          allDepts = allDepts.filter((d: any) => courseDeptIds.has(d.id));
        }
      }
      
      setDepartments(allDepts);
      setCourses(allCourses);
      setStudents(allStudents);
      setFilteredStudents(allStudents);
    } catch (error) {
      console.error('Error fetching filters:', error);
    } finally {
      setLoadingFilters(false);
    }
  };

  // فلترة الطلاب عند تغيير القسم أو المقرر
  useEffect(() => {
    // لا تفلتر إذا لم يتم تحميل الطلاب بعد
    if (students.length > 0) {
      filterStudents();
    }
  }, [selectedDept, selectedCourse]);

  // تحديث القائمة المفلترة عند تحميل الطلاب لأول مرة
  useEffect(() => {
    if (students.length > 0 && !selectedDept && !selectedCourse) {
      setFilteredStudents(students);
    }
  }, [students]);

  const filterStudents = async () => {
    let filtered = [...students];
    
    // فلتر حسب القسم
    if (selectedDept) {
      filtered = filtered.filter(s => s.department_id === selectedDept);
    }
    
    // فلتر حسب المقرر (الطلاب المسجلين في المقرر)
    if (selectedCourse) {
      try {
        const enrollmentsRes = await coursesAPI.getEnrolledStudents(selectedCourse);
        const enrolledIds = (enrollmentsRes.data || []).map((e: any) => e.id);
        filtered = filtered.filter(s => enrolledIds.includes(s.id));
      } catch (error) {
        console.error('Error fetching enrollments:', error);
      }
    }
    
    setFilteredStudents(filtered);
    
    // إعادة تعيين الطالب المحدد إذا لم يعد موجوداً في القائمة المفلترة
    if (selectedStudent && !filtered.find(s => s.id === selectedStudent)) {
      setSelectedStudent('');
      setStudentData(null);
    }
  };

  // فلتر المقررات حسب القسم
  const filteredCourses = selectedDept 
    ? courses.filter(c => c.department_id === selectedDept)
    : courses;

  // 🔍 بحث بالاسم أو رقم القيد فوق قائمة الطلاب
  const searchedStudents = studentSearch.trim()
    ? filteredStudents.filter(s => {
        const q = studentSearch.trim();
        return (s.full_name || '').includes(q) || String(s.student_id || '').includes(q);
      })
    : filteredStudents;

  // جلب تقرير الطالب
  const fetchStudentReport = async (studentId: string) => {
    if (!studentId) {
      setStudentData(null);
      return;
    }
    
    setLoading(true);
    try {
      const reportRes = await reportsAPI.getStudentReport(studentId);
      setStudentData(reportRes.data);
    } catch (error) {
      console.error('Error fetching report:', error);
      Alert.alert('خطأ', 'فشل في جلب تقرير الطالب');
      setStudentData(null);
    } finally {
      setLoading(false);
    }
  };

  // عند تغيير الطالب المحدد - لا نُنفذ التقرير تلقائياً، فقط نُحدّث الاختيار
  const handleStudentChange = (studentId: string) => {
    setSelectedStudent(studentId);
    setStudentData(null); // مسح البيانات الحالية حتى يضغط المستخدم "تنفيذ التقرير"
  };

  // تنفيذ التقرير (بضغط الزر)
  const runReport = () => {
    if (!selectedStudent) {
      Alert.alert('تنبيه', 'اختر الطالب أولاً');
      return;
    }
    fetchStudentReport(selectedStudent);
  };

  // دالة تصدير PDF
  const handleExportPDF = async () => {
    if (!studentData?.student) return;
    try {
      setExportingPDF(true);
      const reportData = prepareStudentReportData(studentData.student, studentData.courses || []);
      await exportToPDF(reportData);
    } catch (error) {
      console.error('PDF Export error:', error);
    } finally {
      setExportingPDF(false);
    }
  };

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
        const xf = (response.headers as any)?.['x-filename'];
        a.download = xf ? decodeURIComponent(xf) : `student_report_${studentData.student.student_id}.xlsx`;
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

  // إعادة تعيين الفلاتر
  const resetFilters = () => {
    setSelectedDept('');
    setSelectedCourse('');
    setSelectedStudent('');
    setStudentSearch('');
    setStudentData(null);
  };

  // إذا كان الـ auth قيد التحميل
  if (authLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loadingFullScreen}>
          <ActivityIndicator size="large" color="#9c27b0" />
          <Text style={styles.loadingText}>جاري التحميل...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBack()} accessibilityLabel="رجوع">
          <Ionicons name="arrow-forward" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isStudent ? 'تقرير حضوري' : 'تقرير حضور طالب'}</Text>
        <View style={styles.headerButtons}>
          {Platform.OS === 'web' && (
            <TouchableOpacity 
              style={styles.exportBtn}
              onPress={handleExportPDF}
              disabled={exportingPDF || !studentData}
              accessibilityLabel="تصدير PDF"
            >
              {exportingPDF ? (
                <ActivityIndicator size="small" color="#e53935" />
              ) : (
                <Ionicons name="document-text-outline" size={22} color={studentData ? "#e53935" : "#ccc"} />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity 
            style={styles.exportBtn}
            onPress={exportToExcel}
            disabled={exporting || !studentData}
            accessibilityLabel="تصدير Excel"
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#4caf50" />
            ) : (
              <Ionicons name="download-outline" size={24} color={studentData ? "#4caf50" : "#ccc"} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.scrollView}>
        {/* الفلاتر - تظهر فقط لغير الطلاب */}
        {!isStudent && (
        <View style={styles.filtersCard}>
          <View style={styles.filterHeader}>
            <Text style={styles.filterTitle}>اختر الطالب</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={handleRefresh} style={styles.refreshBtn} accessibilityLabel="تحديث">
                <Ionicons name="refresh" size={20} color="#9c27b0" />
              </TouchableOpacity>
              {(selectedDept || selectedCourse || selectedStudent) && (
                <TouchableOpacity onPress={resetFilters}>
                  <Text style={styles.resetText}>إعادة تعيين</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {loadingFilters ? (
            <ActivityIndicator size="small" color="#9c27b0" style={{ marginVertical: 20 }} />
          ) : (
            <>
              {/* فلتر القسم */}
              <View style={styles.filterRow}>
                <Text style={styles.filterLabel}>القسم</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={selectedDept}
                    onValueChange={(value) => {
                      setSelectedDept(value);
                      setSelectedCourse('');
                      setSelectedStudent('');
                      setStudentData(null);
                    }}
                    style={styles.picker}
                  >
                    <Picker.Item label="جميع الأقسام" value="" />
                    {departments.map((dept) => (
                      <Picker.Item key={dept.id} label={dept.name} value={dept.id} />
                    ))}
                  </Picker>
                </View>
              </View>

              {/* فلتر المقرر */}
              <View style={styles.filterRow}>
                <Text style={styles.filterLabel}>المقرر</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={selectedCourse}
                    onValueChange={(value) => {
                      setSelectedCourse(value);
                      setSelectedStudent('');
                      setStudentData(null);
                    }}
                    style={styles.picker}
                  >
                    <Picker.Item label="جميع المقررات" value="" />
                    {filteredCourses.map((course) => (
                      <Picker.Item 
                        key={course.id} 
                        label={`${course.name} (${course.code})`} 
                        value={course.id} 
                      />
                    ))}
                  </Picker>
                </View>
              </View>

              {/* قائمة الطلاب */}
              <View style={styles.filterRow}>
                <Text style={styles.filterLabel}>الطالب</Text>
                {/* 🔍 بحث بالاسم أو رقم القيد */}
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0', paddingHorizontal: 10, marginBottom: 8 }}>
                  <Ionicons name="search" size={16} color="#9c27b0" />
                  <TextInput
                    style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 8, fontSize: 14, color: '#333', textAlign: 'right' }}
                    value={studentSearch}
                    onChangeText={(text) => {
                      setStudentSearch(text);
                      // إن لم يعد الطالب المحدد ضمن نتائج البحث نعيد التعيين
                      if (selectedStudent) {
                        const q = text.trim();
                        const stillVisible = !q || filteredStudents.some(s =>
                          s.id === selectedStudent && ((s.full_name || '').includes(q) || String(s.student_id || '').includes(q))
                        );
                        if (!stillVisible) {
                          setSelectedStudent('');
                          setStudentData(null);
                        }
                      }
                    }}
                    placeholder="ابحث باسم الطالب أو رقم القيد..."
                    placeholderTextColor="#999"
                    testID="student-search-input"
                  />
                  {studentSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setStudentSearch('')} testID="clear-student-search">
                      <Ionicons name="close-circle" size={18} color="#999" />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={selectedStudent}
                    onValueChange={handleStudentChange}
                    style={styles.picker}
                    testID="student-picker"
                  >
                    <Picker.Item label={`اختر طالب (${searchedStudents.length} طالب)`} value="" />
                    {searchedStudents.map((student) => (
                      <Picker.Item 
                        key={student.id} 
                        label={`${student.full_name} - ${student.student_id}`} 
                        value={student.id} 
                      />
                    ))}
                  </Picker>
                </View>
                {studentSearch.trim().length > 0 && searchedStudents.length === 0 && (
                  <Text style={{ fontSize: 12, color: '#e65100', textAlign: 'center', marginTop: 6 }}>
                    لا توجد نتائج مطابقة للبحث "{studentSearch.trim()}"
                  </Text>
                )}
              </View>
            </>
          )}

          {/* زر التنفيذ - للأدمن فقط */}
          {!isStudent && (
            <TouchableOpacity
              style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#9c27b0', paddingVertical: 10, borderRadius: 8, marginTop: 8 }, (loading || !selectedStudent) && { opacity: 0.6 }]}
              onPress={runReport}
              disabled={loading || !selectedStudent}
              testID="run-report-btn"
            >
              {loading ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>جاري التنفيذ...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="play" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{studentData ? 'إعادة التنفيذ' : 'تنفيذ التقرير'}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
        )}

        {/* تحميل */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#9c27b0" />
            <Text style={styles.loadingText}>جاري تحميل التقرير...</Text>
          </View>
        )}

        {/* بيانات الطالب */}
        {studentData && !loading && (
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
                  <Text style={styles.summaryValue}>{studentData.summary?.total_courses || 0}</Text>
                  <Text style={styles.summaryLabel}>مقرر</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{studentData.summary?.total_lectures || 0}</Text>
                  <Text style={styles.summaryLabel}>محاضرة</Text>
                </View>
                <View style={[styles.summaryItem, styles.summarySuccess]}>
                  <Text style={styles.summaryValue}>{studentData.summary?.total_present || 0}</Text>
                  <Text style={styles.summaryLabel}>حاضر</Text>
                </View>
                <View style={[styles.summaryItem, styles.summaryDanger]}>
                  <Text style={styles.summaryValue}>{studentData.summary?.total_absent || 0}</Text>
                  <Text style={styles.summaryLabel}>غائب</Text>
                </View>
              </View>
              
              {/* نسبة الحضور الإجمالية */}
              <View style={styles.overallRate}>
                <Text style={styles.overallLabel}>نسبة الحضور الإجمالية</Text>
                <View style={styles.rateCircle}>
                  <Text style={[
                    styles.rateValue,
                    (studentData.summary?.overall_attendance_rate || 0) >= 75 ? styles.rateGood :
                    (studentData.summary?.overall_attendance_rate || 0) >= 50 ? styles.rateMedium : styles.rateLow
                  ]}>
                    {studentData.summary?.overall_attendance_rate || 0}%
                  </Text>
                </View>
              </View>
            </View>

            {/* تفاصيل المقررات */}
            <Text style={styles.sectionTitle}>تفاصيل المقررات ({studentData.courses?.length || 0})</Text>
            
            {(!studentData.courses || studentData.courses.length === 0) ? (
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

        {/* رسالة البداية - فقط لغير الطلاب */}
        {!studentData && !loading && !selectedStudent && !isStudent && (
          <View style={styles.welcomeCard}>
            <Ionicons name="person-outline" size={64} color="#e0e0e0" />
            <Text style={styles.welcomeText}>اختر طالب لعرض تقرير حضوره</Text>
            <Text style={styles.welcomeHint}>استخدم الفلاتر أعلاه لتحديد القسم والمقرر ثم اختر الطالب</Text>
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
  loadingFullScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  refreshBtn: {
    padding: 4,
  },
  filterTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  resetText: {
    color: '#9c27b0',
    fontSize: 14,
  },
  filterRow: {
    marginBottom: 12,
  },
  filterLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 6,
  },
  pickerWrapper: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
    fontSize: 14,
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
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  courseCode: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  rateBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
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
    fontWeight: '700',
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
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
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
    padding: 40,
    alignItems: 'center',
  },
  welcomeText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
  },
  welcomeHint: {
    marginTop: 8,
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
});
