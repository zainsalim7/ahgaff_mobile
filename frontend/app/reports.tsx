import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
  TextInput,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { departmentsAPI, coursesAPI, reportsAPI, exportAPI, facultiesAPI, API_URL } from '../src/services/api';
import { CourseFilter } from '../src/components/CourseFilter';
import { useAuthStore } from '../src/store/authStore';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { Department, Course } from '../src/types';

// دالة التحقق من الصلاحيات
const checkPermission = (userRole: string, userPermissions: string[], permission: string): boolean => {
  if (userRole === 'admin') return true;
  return userPermissions?.includes(permission) || false;
};

// دالة التحقق من صلاحية تقرير معين (تدعم view_reports للتوافق مع الإصدارات القديمة)
const canViewReport = (userRole: string, userPermissions: string[], reportPermission: string): boolean => {
  if (userRole === 'admin') return true;
  // إذا كان لديه صلاحية view_reports العامة أو صلاحية التقرير المحدد
  return userPermissions?.includes('view_reports') || userPermissions?.includes(reportPermission) || false;
};

// Custom Dropdown Component
interface DropdownProps {
  label: string;
  value: string;
  placeholder: string;
  options: { id: string; name: string }[];
  onSelect: (id: string) => void;
  required?: boolean;
  disabled?: boolean;
}

const Dropdown: React.FC<DropdownProps> = ({ label, value, placeholder, options, onSelect, required, disabled }) => {
  const [visible, setVisible] = useState(false);
  const selectedOption = options.find(o => o.id === value);

  return (
    <View style={dropdownStyles.container}>
      <Text style={dropdownStyles.label}>{label}{required && ' *'}</Text>
      <TouchableOpacity 
        style={[dropdownStyles.selector, disabled && dropdownStyles.disabled]}
        onPress={() => !disabled && setVisible(true)}
        disabled={disabled}
      >
        <Text style={[dropdownStyles.selectorText, !selectedOption && dropdownStyles.placeholder]}>
          {selectedOption ? selectedOption.name : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={20} color="#666" />
      </TouchableOpacity>
      
      <Modal visible={visible} transparent animationType="fade">
        <TouchableOpacity 
          style={dropdownStyles.overlay} 
          activeOpacity={1} 
          onPress={() => setVisible(false)}
        >
          <View style={dropdownStyles.modal}>
            <View style={dropdownStyles.modalHeader}>
              <Text style={dropdownStyles.modalTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setVisible(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={options}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[dropdownStyles.option, value === item.id && dropdownStyles.optionSelected]}
                  onPress={() => {
                    onSelect(item.id);
                    setVisible(false);
                  }}
                >
                  <Text style={[dropdownStyles.optionText, value === item.id && dropdownStyles.optionTextSelected]}>
                    {item.name}
                  </Text>
                  {value === item.id && <Ionicons name="checkmark" size={20} color="#1565c0" />}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={dropdownStyles.emptyText}>لا توجد خيارات</Text>
              }
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const dropdownStyles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 14,
  },
  disabled: {
    opacity: 0.5,
  },
  selectorText: {
    fontSize: 15,
    color: '#333',
  },
  placeholder: {
    color: '#999',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '85%',
    maxHeight: '60%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  optionSelected: {
    backgroundColor: '#e3f2fd',
  },
  optionText: {
    fontSize: 15,
    color: '#333',
  },
  optionTextSelected: {
    color: '#1565c0',
    fontWeight: '600',
  },
  emptyText: {
    padding: 20,
    textAlign: 'center',
    color: '#999',
  },
});

export default function ReportsScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [faculties, setFaculties] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);

  // Attendance export - نظام تصنيفي: كلية → قسم → مقرر + فترة تاريخية
  const [attFaculty, setAttFaculty] = useState<string>('');
  const [attDept, setAttDept] = useState<string>('');
  const [attCourse, setAttCourse] = useState<string>('');
  const [attDateFrom, setAttDateFrom] = useState<string>('');
  const [attDateTo, setAttDateTo] = useState<string>('');
  
  // Advanced Export Filters
  const [exportLevel, setExportLevel] = useState<string>('');
  const [exportSection, setExportSection] = useState<string>('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  
  // صلاحيات المستخدم - من الـ store مباشرة
  const userRole = user?.role || '';
  const userPermissions = user?.permissions || [];
  const canViewReports = checkPermission(userRole, userPermissions, 'view_reports');
  const canExportReports = checkPermission(userRole, userPermissions, 'export_reports');
  
  const LEVELS = ['1', '2', '3', '4', '5'];
  const SECTIONS = ['أ', 'ب', 'ج', 'د'];

  const fetchData = useCallback(async () => {
    try {
      const [deptsRes, coursesRes, summaryRes, facsRes] = await Promise.all([
        departmentsAPI.getAll(),
        coursesAPI.getAll(),
        reportsAPI.getSummary(),
        facultiesAPI.getAll(),
      ]);
      setDepartments(deptsRes.data);
      setCourses(coursesRes.data);
      setSummary(summaryRes.data);
      setFaculties(facsRes.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Download blob file - works on web and mobile
  const downloadBlob = async (blob: Blob, filename: string) => {
    try {
      if (Platform.OS === 'web') {
        // Web platform
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        // Mobile platform - convert blob to base64 and save
        const reader = new FileReader();
        reader.onload = async () => {
          const base64data = reader.result as string;
          const base64 = base64data.split(',')[1];
          
          const fileUri = FileSystem.documentDirectory + filename;
          await FileSystem.writeAsStringAsync(fileUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          
          // Share the file
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(fileUri);
          } else {
            Alert.alert('نجاح', `تم حفظ الملف: ${filename}`);
          }
        };
        reader.readAsDataURL(blob);
      }
    } catch (error) {
      console.error('Download error:', error);
      Alert.alert('خطأ', 'فشل في تحميل الملف');
    }
  };

  const handleDownloadTemplate = async () => {
    setExporting('template');
    try {
      const response = await exportAPI.getStudentsTemplate();
      await downloadBlob(response.data, 'students_template.xlsx');
      Alert.alert('نجاح', 'تم تحميل القالب');
    } catch (error) {
      console.error('Template error:', error);
      Alert.alert('خطأ', 'فشل في تحميل القالب');
    } finally {
      setExporting(null);
    }
  };

  const handleExportStudents = async () => {
    setExporting('students');
    try {
      const response = await exportAPI.exportStudents(selectedDept || undefined);
      await downloadBlob(response.data, 'students.xlsx');
      Alert.alert('نجاح', 'تم تصدير قائمة الطلاب');
    } catch (error) {
      console.error('Export students error:', error);
      Alert.alert('خطأ', 'فشل في تصدير الطلاب');
    } finally {
      setExporting(null);
    }
  };

  const handleExportAttendance = async () => {
    if (!attCourse) {
      Alert.alert('تنبيه', 'اختر مقرراً أولاً');
      return;
    }
    
    setExporting('attendance');
    try {
      const course = courses.find(c => c.id === attCourse);
      const filename = `attendance_${course?.code || 'course'}.xlsx`;
      const params: any = {};
      if (attDateFrom) params.date_from = attDateFrom;
      if (attDateTo) params.date_to = attDateTo;
      const response = await exportAPI.exportAttendance(attCourse, params);
      await downloadBlob(response.data, filename);
      Alert.alert('نجاح', 'تم تصدير سجل الحضور');
    } catch (error) {
      console.error('Export attendance error:', error);
      Alert.alert('خطأ', 'فشل في تصدير الحضور');
    } finally {
      setExporting(null);
    }
  };

  const handleExportDeptReport = async () => {
    if (!selectedDept) {
      Alert.alert('تنبيه', 'اختر قسماً أولاً');
      return;
    }
    
    setExporting('report');
    try {
      const dept = departments.find(d => d.id === selectedDept);
      const filename = `report_${dept?.code || 'dept'}.xlsx`;
      
      const response = await exportAPI.exportDeptReport(selectedDept);
      await downloadBlob(response.data, filename);
      Alert.alert('نجاح', 'تم تصدير تقرير القسم');
    } catch (error) {
      console.error('Export report error:', error);
      Alert.alert('خطأ', 'فشل في تصدير التقرير');
    } finally {
      setExporting(null);
    }
  };

  // PDF Export Functions
  const handleExportStudentsPDF = async () => {
    setExporting('students_pdf');
    try {
      const response = await exportAPI.exportStudentsPDF(selectedDept || undefined);
      await downloadBlob(response.data, `students_${new Date().toISOString().split('T')[0]}.pdf`);
      Alert.alert('نجاح', 'تم تصدير قائمة الطلاب كـ PDF');
    } catch (error) {
      console.error('Export students PDF error:', error);
      Alert.alert('خطأ', 'فشل في تصدير PDF');
    } finally {
      setExporting(null);
    }
  };

  const handleExportAttendancePDF = async () => {
    if (!attCourse) {
      Alert.alert('تنبيه', 'اختر مقرراً أولاً');
      return;
    }
    
    setExporting('attendance_pdf');
    try {
      const course = courses.find(c => c.id === attCourse);
      const filename = `attendance_${course?.code || 'course'}.pdf`;
      const params: any = {};
      if (attDateFrom) params.date_from = attDateFrom;
      if (attDateTo) params.date_to = attDateTo;
      const response = await exportAPI.exportAttendancePDF(attCourse, params);
      await downloadBlob(response.data, filename);
      Alert.alert('نجاح', 'تم تصدير سجل الحضور كـ PDF');
    } catch (error) {
      console.error('Export attendance PDF error:', error);
      Alert.alert('خطأ', 'فشل في تصدير PDF');
    } finally {
      setExporting(null);
    }
  };

  const handleExportDeptReportPDF = async () => {
    if (!selectedDept) {
      Alert.alert('تنبيه', 'اختر قسماً أولاً');
      return;
    }
    
    setExporting('report_pdf');
    try {
      const dept = departments.find(d => d.id === selectedDept);
      const filename = `report_${dept?.code || 'dept'}.pdf`;
      
      const response = await exportAPI.exportDeptReportPDF(selectedDept);
      await downloadBlob(response.data, filename);
      Alert.alert('نجاح', 'تم تصدير تقرير القسم كـ PDF');
    } catch (error) {
      console.error('Export report PDF error:', error);
      Alert.alert('خطأ', 'فشل في تصدير PDF');
    } finally {
      setExporting(null);
    }
  };

  const handleExportSemesterPDF = async () => {
    setExporting('semester_pdf');
    try {
      const params: any = {};
      if (selectedCourse) params.course_id = selectedCourse;
      if (selectedDept) params.department_id = selectedDept;
      
      const response = await exportAPI.exportSemesterReportPDF(params);
      const filename = `semester_report_${new Date().toISOString().split('T')[0]}.pdf`;
      await downloadBlob(response.data, filename);
      Alert.alert('نجاح', 'تم تصدير تقرير الفصل الدراسي');
    } catch (error: any) {
      console.error('Export semester PDF error:', error);
      const msg = error.response?.data?.detail || 'فشل في تصدير التقرير';
      Alert.alert('خطأ', msg);
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={styles.scrollView}>
        {/* Summary Stats - Only for users with view_reports */}
        {summary && canViewReports && (
          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>ملخص النظام</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Ionicons name="people" size={24} color="#1565c0" />
                <Text style={styles.statNumber}>{summary.total_students}</Text>
                <Text style={styles.statLabel}>طالب</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="school" size={24} color="#4caf50" />
                <Text style={styles.statNumber}>{summary.total_teachers}</Text>
                <Text style={styles.statLabel}>معلم</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="book" size={24} color="#ff9800" />
                <Text style={styles.statNumber}>{summary.total_courses}</Text>
                <Text style={styles.statLabel}>مقرر</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="business" size={24} color="#e91e63" />
                <Text style={styles.statNumber}>{summary.total_departments}</Text>
                <Text style={styles.statLabel}>قسم</Text>
              </View>
            </View>
          </View>
        )}

        {/* أنواع التقارير */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📊 أنواع التقارير</Text>
          <View style={styles.reportTypesGrid}>
            {/* ملخص المعلم - للمعلم والإدارة */}
            {(canViewReport(userRole, userPermissions, 'report_teacher_workload')) && (
            <TouchableOpacity 
              style={[styles.reportTypeCard, { borderWidth: 2, borderColor: '#1565c0' }]}
              onPress={() => router.push('/report-teacher-summary')}
              data-testid="report-teacher-summary-btn"
            >
              <View style={[styles.reportTypeIcon, { backgroundColor: '#e3f2fd' }]}>
                <Ionicons name="person-circle" size={28} color="#1565c0" />
              </View>
              <Text style={styles.reportTypeTitle}>ملخص المعلم</Text>
              <Text style={styles.reportTypeDesc}>جميع المقررات مع نسب الحضور</Text>
            </TouchableOpacity>
            )}

            {/* تقرير الحضور الشامل */}
            {canViewReport(userRole, userPermissions, 'report_attendance_overview') && (
            <TouchableOpacity 
              style={styles.reportTypeCard}
              onPress={() => router.push('/report-attendance-overview')}
              data-testid="report-attendance-overview-btn"
            >
              <View style={[styles.reportTypeIcon, { backgroundColor: '#e3f2fd' }]}>
                <Ionicons name="stats-chart" size={28} color="#1565c0" />
              </View>
              <Text style={styles.reportTypeTitle}>الحضور الشامل</Text>
              <Text style={styles.reportTypeDesc}>نسب الحضور لجميع المقررات</Text>
            </TouchableOpacity>
            )}

            {/* تقرير الطلاب المتغيبين */}
            {canViewReport(userRole, userPermissions, 'report_absent_students') && (
            <TouchableOpacity 
              style={styles.reportTypeCard}
              onPress={() => router.push('/report-absent-students')}
              data-testid="report-absent-students-btn"
            >
              <View style={[styles.reportTypeIcon, { backgroundColor: '#ffebee' }]}>
                <Ionicons name="person-remove" size={28} color="#f44336" />
              </View>
              <Text style={styles.reportTypeTitle}>الطلاب المتغيبين</Text>
              <Text style={styles.reportTypeDesc}>تجاوزوا نسبة غياب معينة</Text>
            </TouchableOpacity>
            )}

            {/* تقرير الإنذارات والحرمان */}
            {canViewReport(userRole, userPermissions, 'report_warnings') && (
            <TouchableOpacity 
              style={styles.reportTypeCard}
              onPress={() => router.push('/report-warnings')}
              data-testid="report-warnings-btn"
            >
              <View style={[styles.reportTypeIcon, { backgroundColor: '#fff3e0' }]}>
                <Ionicons name="warning" size={28} color="#ff9800" />
              </View>
              <Text style={styles.reportTypeTitle}>الإنذارات والحرمان</Text>
              <Text style={styles.reportTypeDesc}>الطلاب المعرضين للحرمان</Text>
            </TouchableOpacity>
            )}

            {/* التقرير اليومي */}
            {canViewReport(userRole, userPermissions, 'report_daily') && (
            <TouchableOpacity 
              style={styles.reportTypeCard}
              onPress={() => router.push('/report-daily')}
              data-testid="report-daily-btn"
            >
              <View style={[styles.reportTypeIcon, { backgroundColor: '#e8f5e9' }]}>
                <Ionicons name="calendar" size={28} color="#4caf50" />
              </View>
              <Text style={styles.reportTypeTitle}>التقرير اليومي</Text>
              <Text style={styles.reportTypeDesc}>ملخص الحضور لكل يوم</Text>
            </TouchableOpacity>
            )}

            {/* تقرير طالب */}
            {canViewReport(userRole, userPermissions, 'report_student') && (
            <TouchableOpacity 
              style={styles.reportTypeCard}
              onPress={() => router.push('/report-student')}
              data-testid="report-student-btn"
            >
              <View style={[styles.reportTypeIcon, { backgroundColor: '#f3e5f5' }]}>
                <Ionicons name="person" size={28} color="#9c27b0" />
              </View>
              <Text style={styles.reportTypeTitle}>تقرير طالب</Text>
              <Text style={styles.reportTypeDesc}>حضور طالب في مقرراته</Text>
            </TouchableOpacity>
            )}

            {/* تقرير مقرر */}
            {canViewReport(userRole, userPermissions, 'report_course') && (
            <TouchableOpacity 
              style={styles.reportTypeCard}
              onPress={() => router.push('/report-course')}
              data-testid="report-course-btn"
            >
              <View style={[styles.reportTypeIcon, { backgroundColor: '#e0f7fa' }]}>
                <Ionicons name="book" size={28} color="#00bcd4" />
              </View>
              <Text style={styles.reportTypeTitle}>تقرير مقرر</Text>
              <Text style={styles.reportTypeDesc}>تحليل كامل للمقرر</Text>
            </TouchableOpacity>
            )}

            {/* تقرير نصاب المدرس */}
            {canViewReport(userRole, userPermissions, 'report_teacher_workload') && (
            <TouchableOpacity 
              style={styles.reportTypeCard}
              onPress={() => router.push('/report-teacher-workload')}
              data-testid="report-teacher-workload-btn"
            >
              <View style={[styles.reportTypeIcon, { backgroundColor: '#fce4ec' }]}>
                <Ionicons name="time" size={28} color="#e91e63" />
              </View>
              <Text style={styles.reportTypeTitle}>نصاب المدرس</Text>
              <Text style={styles.reportTypeDesc}>ساعات التدريس الفعلية</Text>
            </TouchableOpacity>
            )}

            {/* تقرير تأخر المعلمين */}
            {canViewReport(userRole, userPermissions, 'report_teacher_delays') && (
            <TouchableOpacity 
              style={styles.reportTypeCard}
              onPress={() => router.push('/report-teacher-delays')}
              data-testid="report-teacher-delays-btn"
            >
              <View style={[styles.reportTypeIcon, { backgroundColor: '#ffebee' }]}>
                <Ionicons name="alarm" size={28} color="#d32f2f" />
              </View>
              <Text style={styles.reportTypeTitle}>تأخر المعلمين</Text>
              <Text style={styles.reportTypeDesc}>متابعة التزام المعلمين بالمواعيد</Text>
            </TouchableOpacity>
            )}

            {/* تقرير إنجاز الدروس */}
            {canViewReport(userRole, userPermissions, 'report_lesson_completion') && (
            <TouchableOpacity 
              style={styles.reportTypeCard}
              onPress={() => router.push('/report-lesson-completion')}
              data-testid="report-lesson-completion-btn"
            >
              <View style={[styles.reportTypeIcon, { backgroundColor: '#e8f5e9' }]}>
                <Ionicons name="checkmark-done" size={28} color="#4caf50" />
              </View>
              <Text style={styles.reportTypeTitle}>إنجاز الدروس</Text>
              <Text style={styles.reportTypeDesc}>المخطط مقابل المنجز</Text>
            </TouchableOpacity>
            )}

            {/* سجل الإفادات الصادرة */}
            {!['teacher', 'student'].includes(userRole) && (
            <TouchableOpacity
              style={styles.reportTypeCard}
              onPress={() => router.push('/statements-log')}
              data-testid="statements-log-btn"
            >
              <View style={[styles.reportTypeIcon, { backgroundColor: '#e0f2f1' }]}>
                <Ionicons name="document-text" size={28} color="#00796b" />
              </View>
              <Text style={styles.reportTypeTitle}>سجل الإفادات</Text>
              <Text style={styles.reportTypeDesc}>الإفادات الصادرة، تنزيل PDF وإلغاء</Text>
            </TouchableOpacity>
            )}
          </View>
        </View>

        {/* تقرير الفصل الدراسي الشامل - Only for users with view_reports */}
        {canViewReports && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>تقرير الفصل الدراسي الشامل (PDF)</Text>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 8 }}>
            <Text style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
              تقرير شامل يحتوي على جميع المقررات مع إحصائيات الحضور لكل طالب
            </Text>
            
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Dropdown
                  label="القسم (اختياري)"
                  value={selectedDept || ''}
                  placeholder="جميع الأقسام"
                  options={departments.map(d => ({ id: d.id, name: d.name }))}
                  onSelect={(id) => setSelectedDept(id || null)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Dropdown
                  label="المقرر (اختياري)"
                  value={selectedCourse || ''}
                  placeholder="جميع المقررات"
                  options={courses.map(c => ({ id: c.id, name: `${c.name} (${c.code || ''})` }))}
                  onSelect={(id) => setSelectedCourse(id || null)}
                />
              </View>
            </View>
            
            <TouchableOpacity
              style={{
                backgroundColor: '#1565c0',
                padding: 14,
                borderRadius: 10,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: exporting === 'semester_pdf' ? 0.6 : 1,
              }}
              onPress={handleExportSemesterPDF}
              disabled={exporting === 'semester_pdf'}
              data-testid="export-semester-pdf-btn"
            >
              {exporting === 'semester_pdf' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="document-text" size={20} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginRight: 8 }}>
                    تصدير تقرير الفصل PDF
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
        )}

        {/* Advanced Export Filters */}
        {canViewReports && (
        <View style={styles.section}>
          <TouchableOpacity 
            style={styles.advancedFilterHeader}
            onPress={() => setShowAdvancedFilters(!showAdvancedFilters)}
          >
            <View style={styles.advancedFilterTitle}>
              <Ionicons name="filter" size={20} color="#1565c0" />
              <Text style={styles.sectionTitle}>فلاتر التصدير المتقدمة</Text>
            </View>
            <Ionicons 
              name={showAdvancedFilters ? "chevron-up" : "chevron-down"} 
              size={24} 
              color="#666" 
            />
          </TouchableOpacity>
          
          {showAdvancedFilters && (
            <View style={styles.advancedFiltersContent}>
              {/* القوائم المنسدلة للفلاتر */}
              <View style={styles.dropdownFiltersRow}>
                <View style={styles.dropdownFilterItem}>
                  <Text style={styles.dropdownFilterLabel}>القسم</Text>
                  <View style={styles.pickerWrapper}>
                    <Picker
                      selectedValue={selectedDept || ''}
                      onValueChange={(value) => setSelectedDept(value || null)}
                      style={styles.picker}
                    >
                      <Picker.Item label="الكل" value="" />
                      {departments.map(dept => (
                        <Picker.Item key={dept.id} label={dept.name} value={dept.id} />
                      ))}
                    </Picker>
                  </View>
                </View>

                <View style={styles.dropdownFilterItem}>
                  <Text style={styles.dropdownFilterLabel}>المستوى</Text>
                  <View style={styles.pickerWrapper}>
                    <Picker
                      selectedValue={exportLevel}
                      onValueChange={(value) => setExportLevel(value)}
                      style={styles.picker}
                    >
                      <Picker.Item label="الكل" value="" />
                      {LEVELS.map(level => (
                        <Picker.Item key={level} label={`م${level}`} value={level} />
                      ))}
                    </Picker>
                  </View>
                </View>

                <View style={styles.dropdownFilterItem}>
                  <Text style={styles.dropdownFilterLabel}>الشعبة</Text>
                  <View style={styles.pickerWrapper}>
                    <Picker
                      selectedValue={exportSection}
                      onValueChange={(value) => setExportSection(value)}
                      style={styles.picker}
                    >
                      <Picker.Item label="الكل" value="" />
                      {SECTIONS.map(section => (
                        <Picker.Item key={section} label={section} value={section} />
                      ))}
                    </Picker>
                  </View>
                </View>
              </View>

              {/* Active Filters Summary */}
              {(selectedDept || exportLevel || exportSection) && (
                <View style={styles.activeFilters}>
                  <Text style={styles.activeFiltersLabel}>الفلاتر النشطة:</Text>
                  <View style={styles.activeFiltersTags}>
                    {selectedDept && (
                      <View style={styles.filterTag}>
                        <Text style={styles.filterTagText}>
                          {departments.find(d => d.id === selectedDept)?.name}
                        </Text>
                        <TouchableOpacity onPress={() => setSelectedDept(null)}>
                          <Ionicons name="close-circle" size={18} color="#666" />
                        </TouchableOpacity>
                      </View>
                    )}
                    {exportLevel && (
                      <View style={styles.filterTag}>
                        <Text style={styles.filterTagText}>المستوى {exportLevel}</Text>
                        <TouchableOpacity onPress={() => setExportLevel('')}>
                          <Ionicons name="close-circle" size={18} color="#666" />
                        </TouchableOpacity>
                      </View>
                    )}
                    {exportSection && (
                      <View style={styles.filterTag}>
                        <Text style={styles.filterTagText}>شعبة {exportSection}</Text>
                        <TouchableOpacity onPress={() => setExportSection('')}>
                          <Ionicons name="close-circle" size={18} color="#666" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity 
                    style={styles.clearFiltersBtn}
                    onPress={() => {
                      setSelectedDept(null);
                      setExportLevel('');
                      setExportSection('');
                    }}
                  >
                    <Ionicons name="refresh" size={16} color="#f44336" />
                    <Text style={styles.clearFiltersBtnText}>مسح الفلاتر</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
        )}

        {/* Export Students - Only for admins with view_reports */}
        {canViewReports && canExportReports && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📤 تصدير قائمة الطلاب</Text>
          {/* Show active filters info */}
          {(selectedDept || exportLevel || exportSection) && (
            <View style={styles.exportFilterInfo}>
              <Ionicons name="filter" size={16} color="#1565c0" />
              <Text style={styles.exportFilterText}>
                سيتم التصدير حسب الفلاتر المحددة أعلاه
              </Text>
            </View>
          )}
          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[styles.exportBtn, styles.excelBtn, exporting !== null && styles.btnDisabled]}
              onPress={handleExportStudents}
              disabled={exporting !== null}
            >
              {exporting === 'students' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="document" size={22} color="#fff" />
              )}
              <Text style={styles.exportBtnText}>Excel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.exportBtn, styles.pdfBtn, exporting !== null && styles.btnDisabled]}
              onPress={handleExportStudentsPDF}
              disabled={exporting !== null}
            >
              {exporting === 'students_pdf' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="document-text" size={22} color="#fff" />
              )}
              <Text style={styles.exportBtnText}>PDF</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hintText}>
            {selectedDept || exportLevel || exportSection 
              ? 'تصدير حسب الفلاتر المحددة' 
              : 'تصدير جميع الطلاب'}
          </Text>
        </View>
        )}

        {/* Export Attendance - Only for admins with view_reports */}
        {canViewReports && canExportReports && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📊 تصدير سجل الحضور</Text>

          {/* Cascading filters with search: Faculty → Department → Course */}
          <CourseFilter
            faculties={faculties}
            departments={departments as any}
            courses={courses as any}
            facultyId={attFaculty}
            departmentId={attDept}
            courseId={attCourse}
            onFacultyChange={setAttFaculty}
            onDepartmentChange={setAttDept}
            onCourseChange={setAttCourse}
          />

          {/* Date Range Picker */}
          <Text style={[styles.hintText, { marginTop: 8, fontWeight: '600' }]}>فترة التقرير (اختياري):</Text>
          <View style={styles.dateRangeRow}>
            <View style={styles.dateInputWrap}>
              <Text style={styles.dateInputLabel}>من تاريخ</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={attDateFrom}
                  onChange={(e: any) => setAttDateFrom(e.target.value)}
                  style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, fontFamily: 'inherit' }}
                  data-testid="att-date-from"
                />
              ) : (
                <TextInput
                  value={attDateFrom}
                  onChangeText={setAttDateFrom}
                  placeholder="YYYY-MM-DD"
                  style={styles.dateInput}
                />
              )}
            </View>
            <View style={styles.dateInputWrap}>
              <Text style={styles.dateInputLabel}>إلى تاريخ</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={attDateTo}
                  onChange={(e: any) => setAttDateTo(e.target.value)}
                  style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, fontFamily: 'inherit' }}
                  data-testid="att-date-to"
                />
              ) : (
                <TextInput
                  value={attDateTo}
                  onChangeText={setAttDateTo}
                  placeholder="YYYY-MM-DD"
                  style={styles.dateInput}
                />
              )}
            </View>
            {(attDateFrom || attDateTo) && (
              <TouchableOpacity
                onPress={() => { setAttDateFrom(''); setAttDateTo(''); }}
                style={styles.clearDatesBtn}
                testID="clear-dates-btn"
              >
                <Ionicons name="close-circle" size={22} color="#f44336" />
              </TouchableOpacity>
            )}
          </View>
          <Text style={{ fontSize: 11, color: '#999', marginTop: 4, marginBottom: 10 }}>
            إذا لم تحدد فترة، سيتم تصدير آخر 10 محاضرات فقط.
          </Text>

          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[styles.exportBtn, styles.excelBtn, { backgroundColor: '#4caf50' }, (!attCourse || exporting !== null) && styles.btnDisabled]}
              onPress={handleExportAttendance}
              disabled={!attCourse || exporting !== null}
              testID="export-attendance-excel"
            >
              {exporting === 'attendance' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="document" size={22} color="#fff" />
              )}
              <Text style={styles.exportBtnText}>Excel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.exportBtn, styles.pdfBtn, (!attCourse || exporting !== null) && styles.btnDisabled]}
              onPress={handleExportAttendancePDF}
              disabled={!attCourse || exporting !== null}
              testID="export-attendance-pdf"
            >
              {exporting === 'attendance_pdf' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="document-text" size={22} color="#fff" />
              )}
              <Text style={styles.exportBtnText}>PDF</Text>
            </TouchableOpacity>
          </View>
        </View>
        )}

        {/* Export Department Report - Only for admins with view_reports */}
        {canViewReports && canExportReports && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📋 تقرير القسم الشامل</Text>
          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[styles.exportBtn, styles.excelBtn, { backgroundColor: '#9c27b0' }, (!selectedDept || exporting !== null) && styles.btnDisabled]}
              onPress={handleExportDeptReport}
              disabled={!selectedDept || exporting !== null}
            >
              {exporting === 'report' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="document" size={22} color="#fff" />
              )}
              <Text style={styles.exportBtnText}>Excel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.exportBtn, styles.pdfBtn, (!selectedDept || exporting !== null) && styles.btnDisabled]}
              onPress={handleExportDeptReportPDF}
              disabled={!selectedDept || exporting !== null}
            >
              {exporting === 'report_pdf' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="document-text" size={22} color="#fff" />
              )}
              <Text style={styles.exportBtnText}>PDF</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hintText}>
            اختر قسماً لتصدير تقرير شامل يحتوي على:{'\n'}
            الطلاب مع إحصائياتهم + المقررات + ملخص
          </Text>
        </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  summaryCard: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  // Advanced Filters Styles
  advancedFilterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  advancedFilterTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  advancedFiltersContent: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 12,
  },
  filterScrollRow: {
    marginBottom: 8,
  },
  activeFilters: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
  },
  activeFiltersLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1565c0',
    marginBottom: 8,
  },
  activeFiltersTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  filterTagText: {
    fontSize: 13,
    color: '#333',
  },
  clearFiltersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 4,
  },
  clearFiltersBtnText: {
    fontSize: 13,
    color: '#f44336',
  },
  exportFilterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    padding: 8,
    borderRadius: 8,
    marginBottom: 12,
    gap: 6,
  },
  exportFilterText: {
    fontSize: 13,
    color: '#1565c0',
  },
  filterBtn: {
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  filterBtnActive: {
    backgroundColor: '#1565c0',
  },
  filterText: {
    fontSize: 14,
    color: '#666',
  },
  filterTextActive: {
    color: '#fff',
  },
  importCard: {
    alignItems: 'stretch',
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#333',
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginTop: 12,
    marginBottom: 6,
  },
  filterScroll: {
    marginBottom: 4,
  },
  sectionInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  importBtnsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
  templateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderWidth: 2,
    borderColor: '#1565c0',
    borderRadius: 10,
  },
  templateBtnText: {
    color: '#1565c0',
    marginLeft: 8,
    fontWeight: '600',
  },
  importBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1565c0',
    padding: 14,
    borderRadius: 10,
    justifyContent: 'center',
  },
  importBtnText: {
    color: '#fff',
    marginLeft: 8,
    fontWeight: '600',
  },
  hintText: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1565c0',
    padding: 16,
    borderRadius: 8,
    justifyContent: 'center',
  },
  exportBtnText: {
    color: '#fff',
    marginLeft: 8,
    fontWeight: '600',
    fontSize: 16,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  coursesList: {
    marginBottom: 12,
    marginTop: 8,
  },
  courseBtn: {
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 8,
  },
  courseBtnActive: {
    backgroundColor: '#4caf50',
  },
  courseText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  courseTextActive: {
    color: '#fff',
  },
  noCourses: {
    color: '#999',
    fontSize: 14,
  },
  cascadeRow: {
    marginBottom: 10,
  },
  dateRangeRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
    marginTop: 6,
  },
  dateInputWrap: {
    flex: 1,
  },
  dateInputLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    textAlign: 'right',
  },
  dateInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'right',
  },
  clearDatesBtn: {
    marginBottom: 4,
    padding: 4,
  },
  exportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  excelBtn: {
    flex: 1,
    backgroundColor: '#1565c0',
  },
  pdfBtn: {
    flex: 1,
    backgroundColor: '#d32f2f',
  },
  // Dropdown Filters Styles
  dropdownFiltersRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dropdownFilterItem: {
    flex: 1,
  },
  dropdownFilterLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  pickerWrapper: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
  },
  picker: {
    height: 45,
    fontSize: 13,
  },
  // Report Types Styles
  reportTypesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  reportTypeCard: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    marginBottom: 4,
  },
  reportTypeIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  reportTypeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 4,
  },
  reportTypeDesc: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
  },
});
