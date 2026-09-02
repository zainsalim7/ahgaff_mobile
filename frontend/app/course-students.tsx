import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  Alert,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { coursesAPI, studentsAPI, enrollmentAPI, lecturesAPI, attendanceAPI, API_URL } from '../src/services/api';
import { CourseTabBar } from '../src/components/CourseTabBar';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { AddStudentForm, type StudentFormValues } from '../src/components/AddStudentForm';
import { useAuth, PERMISSIONS } from '../src/contexts/AuthContext';
import { useAuthStore } from '../src/store/authStore';
import { formatGregorianDate, formatHijriDate, parseDate, WEEKDAYS_AR_SHORT } from '../src/utils/dateUtils';

interface EnrolledStudent {
  enrollment_id: string;
  student_id: string;
  student_number: string;
  full_name: string;
  level: number;
  section: string;
  enrolled_at: string;
  cross_department?: boolean;
  department_name?: string;
}

interface Student {
  id: string;
  student_id: string;
  full_name: string;
  level: number;
  section: string;
  department_id?: string;
}

interface Lecture {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

interface AttendanceRecord {
  student_id: string;
  status: string;
}

interface StudentStats {
  student_id: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  rate: number;
}

export default function CourseStudentsScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const router = useRouter();
  const { hasPermission, user: authUser, isLoading: authLoading } = useAuth();
  const user = useAuthStore((state) => state.user);
  
  // الطالب لا يمكنه الوصول لهذه الصفحة
  const isStudent = user?.role === 'student' || authUser?.role === 'student';
  
  // التحقق من صلاحية إدارة الطلاب
  const canManageStudents = !isStudent && (hasPermission(PERMISSIONS.MANAGE_STUDENTS) || user?.role === 'admin');
  
  // التحقق من صلاحيات التسجيل (منفصلة عن إدارة الطلاب)
  const canManageEnrollments = !isStudent && (
    hasPermission(PERMISSIONS.MANAGE_ENROLLMENTS) || 
    hasPermission(PERMISSIONS.ADD_ENROLLMENT) || 
    user?.role === 'admin'
  );
  const canUnenroll = !isStudent && (
    hasPermission(PERMISSIONS.MANAGE_ENROLLMENTS) || 
    hasPermission(PERMISSIONS.DELETE_ENROLLMENT) || 
    user?.role === 'admin'
  );
  
  // إعادة توجيه الطالب
  useEffect(() => {
    if (!authLoading && isStudent) {
      router.replace('/');
    }
  }, [isStudent, authLoading]);
  
  const [course, setCourse] = useState<any>(null);
  const [enrolledStudents, setEnrolledStudents] = useState<EnrolledStudent[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<'existing' | 'new'>('existing');
  const [addMode, setAddMode] = useState<'existing' | 'new'>('existing');
  const [searchText, setSearchText] = useState('');
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  
  // نموذج إنشاء طالب جديد (نستخدم StudentFormValues الموحَّد)
  const [newStudentForm, setNewStudentForm] = useState<StudentFormValues>({
    student_id: '',
    full_name: '',
    department_id: '',
    level: '1',
    section: '',
    phone: '',
    email: '',
    nationality: '',
    password: '',
    program_code: '',
    enrollment_year: '',
  });
  const [creatingStudent, setCreatingStudent] = useState(false);
  
  // حالة عرض الحضور
  const [viewMode, setViewMode] = useState<'summary' | 'lecture'>('summary');
  const [selectedLecture, setSelectedLecture] = useState<Lecture | null>(null);
  const [lectureAttendance, setLectureAttendance] = useState<AttendanceRecord[]>([]);
  const [studentStats, setStudentStats] = useState<{ [key: string]: StudentStats }>({});
  const [canEditAttendance, setCanEditAttendance] = useState(false);
  
  // Import preview state
  const [importPreview, setImportPreview] = useState<{ total: number; names: string[]; file: File | null } | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  
  // بحث في الطلاب المسجلين
  const [enrolledSearchText, setEnrolledSearchText] = useState('');
  const [enrollSelectionMode, setEnrollSelectionMode] = useState(false);
  const [selectedEnrolled, setSelectedEnrolled] = useState<string[]>([]);
  const [showActionModal, setShowActionModal] = useState<'copy' | 'move' | null>(null);
  const [allCourses, setAllCourses] = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedTargetCourses, setSelectedTargetCourses] = useState<string[]>([]);
  const [courseSearchQuery, setCourseSearchQuery] = useState('');
  
  // تعديل حالة الحضور
  const [editingRecord, setEditingRecord] = useState<{recordId: string; studentName: string; currentStatus: string} | null>(null);
  const [editReason, setEditReason] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!courseId) return;
    
    try {
      const [courseRes, enrolledRes, studentsRes, lecturesRes] = await Promise.all([
        coursesAPI.getById(courseId),
        enrollmentAPI.getEnrolled(courseId),
        studentsAPI.getAll(),
        lecturesAPI.getByCourse(courseId, 1, 500),
      ]);
      
      // الباك إند يرجع استجابة مقسمة صفحات { lectures: [...] } — ندعم الشكلين
      const lecturesArr = lecturesRes.data?.lectures || (Array.isArray(lecturesRes.data) ? lecturesRes.data : []);
      setCourse(courseRes.data);
      setEnrolledStudents(enrolledRes.data);
      setAllStudents(studentsRes.data);
      setLectures(lecturesArr);
      
      // حساب إحصائيات الحضور لكل طالب
      await calculateStudentStats(enrolledRes.data, lecturesArr);
    } catch (error) {
      console.error('Error fetching data:', error);
      Alert.alert('خطأ', 'فشل في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  // حساب إحصائيات الحضور لكل طالب
  const calculateStudentStats = async (students: EnrolledStudent[], lecturesList: Lecture[]) => {
    const stats: { [key: string]: StudentStats } = {};
    
    // تهيئة الإحصائيات لكل طالب
    students.forEach(s => {
      stats[s.student_id] = {
        student_id: s.student_id,
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        total: 0,
        rate: 0,
      };
    });
    
    // جلب سجلات الحضور لكل محاضرة
    for (const lecture of lecturesList) {
      if (lecture.status === 'completed') {
        try {
          const attendanceRes = await attendanceAPI.getByLecture(lecture.id);
          const records = attendanceRes.data || [];
          
          records.forEach((record: any) => {
            if (stats[record.student_id]) {
              stats[record.student_id].total++;
              switch (record.status) {
                case 'present':
                  stats[record.student_id].present++;
                  break;
                case 'absent':
                  stats[record.student_id].absent++;
                  break;
                case 'late':
                  stats[record.student_id].late++;
                  break;
                case 'excused':
                  stats[record.student_id].excused++;
                  break;
              }
            }
          });
        } catch (e) {
          console.log('Error fetching attendance for lecture:', lecture.id);
        }
      }
    }
    
    // حساب نسبة الحضور
    Object.keys(stats).forEach(studentId => {
      const s = stats[studentId];
      if (s.total > 0) {
        s.rate = Math.round(((s.present + s.late) / s.total) * 100);
      }
    });
    
    setStudentStats(stats);
  };

  // صلاحية تعديل الحضور بعد التحضير
  const hasEditAttendancePerm = hasPermission(PERMISSIONS.EDIT_ATTENDANCE);

  // جلب حضور محاضرة معينة
  const fetchLectureAttendance = async (lecture: Lecture) => {
    try {
      const attendanceRes = await attendanceAPI.getByLecture(lecture.id);
      setLectureAttendance(attendanceRes.data || []);
      
      // التحقق من إمكانية التعديل
      if (hasEditAttendancePerm) {
        // من لديه صلاحية التعديل يمكنه التعديل في أي وقت
        setCanEditAttendance(true);
      } else {
        const now = new Date();
        const lectureEnd = new Date(`${lecture.date}T${lecture.end_time}`);
        const lectureDuration = (lectureEnd.getTime() - new Date(`${lecture.date}T${lecture.start_time}`).getTime()) / 60000;
        const allowedEndTime = new Date(lectureEnd.getTime() + lectureDuration * 60000);
        const canEdit = now <= allowedEndTime && lecture.status !== 'completed';
        setCanEditAttendance(canEdit);
      }
    } catch (error) {
      console.error('Error fetching lecture attendance:', error);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (selectedLecture) {
      fetchLectureAttendance(selectedLecture);
    }
  }, [selectedLecture]);

  const handleEnrollStudents = async () => {
    if (selectedStudents.length === 0) {
      Alert.alert('تنبيه', 'اختر طالب واحد على الأقل');
      return;
    }

    setSaving(true);
    try {
      const res = await enrollmentAPI.enroll(courseId!, selectedStudents);
      const data = res.data;
      let msg = data.message || `تم تسجيل ${selectedStudents.length} طالب`;
      
      // عرض التنبيهات
      if (data.warnings && data.warnings.length > 0) {
        msg += '\n\n' + data.warnings.join('\n');
      }
      if (data.wrong_department > 0) {
        msg += `\n\nتم رفض ${data.wrong_department} طالب (من قسم آخر)`;
      }
      
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('نتيجة التسجيل', msg);
      }
      setShowAddModal(false);
      setSelectedStudents([]);
      fetchData();
    } catch (error) {
      const errMsg = 'فشل في تسجيل الطلاب';
      if (Platform.OS === 'web') {
        window.alert(errMsg);
      } else {
        Alert.alert('خطأ', errMsg);
      }
    } finally {
      setSaving(false);
    }
  };

  // إنشاء طالب جديد وتسجيله في المقرر مباشرة
  const handleCreateAndEnroll = async () => {
    if (!newStudentForm.student_id.trim() || !newStudentForm.full_name.trim()) {
      Alert.alert('تنبيه', 'الرقم الجامعي والاسم مطلوبان');
      return;
    }
    
    setCreatingStudent(true);
    try {
      // إنشاء الطالب
      const studentData: any = {
        student_id: newStudentForm.student_id.trim(),
        full_name: newStudentForm.full_name.trim(),
        department_id: course?.department_id || '',
        level: course?.level || 1,
        section: course?.section || '',
        phone: newStudentForm.phone.trim() || null,
        email: newStudentForm.email.trim() || null,
        nationality: newStudentForm.nationality.trim() || null,
      };
      if (newStudentForm.program_code.trim()) {
        studentData.program_code = newStudentForm.program_code.trim().toUpperCase();
      }
      if (newStudentForm.enrollment_year.trim()) {
        const ey = newStudentForm.enrollment_year.trim();
        studentData.enrollment_year = ey.length === 4 ? ey.slice(-2) : ey;
      }
      
      const createRes = await studentsAPI.create(studentData);
      const newStudentId = createRes.data?.id;
      const refNum = createRes.data?.reference_number;
      
      if (newStudentId) {
        // تسجيل الطالب في المقرر
        await enrollmentAPI.enroll(courseId!, [newStudentId]);
        const refMsg = refNum ? `\nالرقم المرجعي: ${refNum}` : '';
        Alert.alert('نجاح', `تم إنشاء الطالب "${newStudentForm.full_name}" وتسجيله في المقرر${refMsg}`);
      } else {
        Alert.alert('نجاح', 'تم إنشاء الطالب');
      }
      
      setNewStudentForm({ student_id: '', full_name: '', department_id: '', level: '1', section: '', phone: '', email: '', nationality: '', password: '', program_code: '', enrollment_year: '' });
      setShowAddModal(false);
      fetchData();
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'فشل في إنشاء الطالب';
      Alert.alert('خطأ', msg);
    } finally {
      setCreatingStudent(false);
    }
  };


  const handleUnenroll = async (studentId: string, studentName: string) => {
    const confirmMessage = Platform.OS === 'web' 
      ? `هل تريد إلغاء تسجيل ${studentName}؟`
      : '';
    
    if (Platform.OS === 'web') {
      if (!window.confirm(confirmMessage)) return;
      
      try {
        await enrollmentAPI.unenroll(courseId!, studentId);
        Alert.alert('نجاح', 'تم إلغاء التسجيل');
        fetchData();
      } catch (error) {
        Alert.alert('خطأ', 'فشل في إلغاء التسجيل');
      }
    } else {
      Alert.alert(
        'تأكيد',
        `هل تريد إلغاء تسجيل ${studentName}؟`,
        [
          { text: 'إلغاء', style: 'cancel' },
          {
            text: 'نعم',
            style: 'destructive',
            onPress: async () => {
              try {
                await enrollmentAPI.unenroll(courseId!, studentId);
                Alert.alert('نجاح', 'تم إلغاء التسجيل');
                fetchData();
              } catch (error) {
                Alert.alert('خطأ', 'فشل في إلغاء التسجيل');
              }
            },
          },
        ]
      );
    }
  };

  const handleImportExcel = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xls,.csv';
      
      input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return;
        
        setImporting(true);
        try {
          const token = await AsyncStorage.getItem('token');
          const previewUrl = `${API_URL}/api/students/import-preview/${courseId}`;
          
          const formData = new FormData();
          formData.append('file', file, file.name);
          
          const previewResponse = await fetch(previewUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
          });
          
          const previewData = await previewResponse.json();
          
          if (previewResponse.ok) {
            setImportPreview({ total: previewData.total, names: previewData.sample_names || [], file });
            setShowImportConfirm(true);
          } else {
            showAlert('خطأ', previewData.detail || 'فشل قراءة الملف');
          }
        } catch (error: any) {
          showAlert('خطأ', error.message || 'فشل قراءة الملف');
        } finally {
          setImporting(false);
        }
      };
      
      input.click();
    } else {
      try {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
          copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        const file = result.assets[0];
        setImporting(true);
        
        const token = await AsyncStorage.getItem('token');
        const previewUrl = `${API_URL}/api/students/import-preview/${courseId}`;
        const formData = new FormData();
        formData.append('file', { uri: file.uri, type: file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name: file.name } as any);
        
        const previewResponse = await fetch(previewUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData,
        });
        const previewData = await previewResponse.json();
        
        if (previewResponse.ok) {
          setImportPreview({ total: previewData.total, names: previewData.sample_names || [], file: file as any });
          setShowImportConfirm(true);
        } else {
          Alert.alert('خطأ', previewData.detail || 'فشل قراءة الملف');
        }
      } catch (error: any) {
        Alert.alert('خطأ', 'فشل قراءة الملف');
      } finally {
        setImporting(false);
      }
    }
  };

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const confirmImport = async () => {
    if (!importPreview?.file) return;
    setImporting(true);
    setShowImportConfirm(false);
    
    try {
      const token = await AsyncStorage.getItem('token');
      const url = `${API_URL}/api/students/import/${courseId}`;
      const formData = new FormData();
      
      if (Platform.OS === 'web') {
        formData.append('file', importPreview.file, (importPreview.file as any).name);
      } else {
        formData.append('file', {
          uri: (importPreview.file as any).uri,
          type: (importPreview.file as any).mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          name: (importPreview.file as any).name,
        } as any);
      }
      
      const uploadResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      const data = await uploadResponse.json();
      
      if (uploadResponse.ok) {
        showAlert('نجاح', `تم استيراد ${data.imported} طالب جديد\nتم تسجيل ${data.enrolled} طالب في المقرر`);
        fetchData();
      } else {
        showAlert('خطأ', data.detail || 'فشل في استيراد الملف');
      }
    } catch (error: any) {
      showAlert('خطأ', error.message || 'فشل في الاستيراد');
    } finally {
      setImporting(false);
      setImportPreview(null);
    }
  };

  const toggleStudentSelection = (studentId: string) => {
    setSelectedStudents(prev => 
      prev.includes(studentId) 
        ? prev.filter(id => id !== studentId)
        : [...prev, studentId]
    );
  };

  const getAttendanceStatus = (studentId: string): string => {
    const record = lectureAttendance.find(r => r.student_id === studentId);
    return record?.status || 'absent';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'present': return '#4caf50';
      case 'absent': return '#f44336';
      case 'late': return '#ff9800';
      case 'excused': return '#2196f3';
      default: return '#999';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'present': return 'حاضر';
      case 'absent': return 'غائب';
      case 'late': return 'متأخر';
      case 'excused': return 'معذور';
      default: return '-';
    }
  };

  const getRateColor = (rate: number) => {
    if (rate >= 75) return '#4caf50';
    if (rate >= 50) return '#ff9800';
    return '#f44336';
  };

  const filteredEnrolled = enrolledStudents.filter(s => {
    if (!enrolledSearchText) return true;
    return s.full_name.includes(enrolledSearchText) || s.student_number?.includes(enrolledSearchText);
  });
  
  const toggleEnrolledSelection = (studentId: string) => {
    setSelectedEnrolled(prev => 
      prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId]
    );
  };
  
  const handleBulkUnenroll = async () => {
    if (selectedEnrolled.length === 0) return;
    if (!confirm(`هل تريد إلغاء تسجيل ${selectedEnrolled.length} طالب من المقرر؟`)) return;
    
    setSaving(true);
    try {
      for (const sid of selectedEnrolled) {
        await enrollmentAPI.unenroll(courseId!, sid);
      }
      Alert.alert('نجاح', `تم إلغاء تسجيل ${selectedEnrolled.length} طالب`);
      setSelectedEnrolled([]);
      setEnrollSelectionMode(false);
      fetchData();
    } catch (error) {
      Alert.alert('خطأ', 'فشل في إلغاء التسجيل');
    } finally {
      setSaving(false);
    }
  };

  const openActionModal = async (action: 'copy' | 'move') => {
    if (selectedEnrolled.length === 0) return;
    try {
      const res = await coursesAPI.getAll();
      setAllCourses((res.data || res).filter((c: any) => c.id !== courseId));
    } catch { setAllCourses([]); }
    setSelectedTargetCourses([]);
    setShowActionModal(action);
  };

  const toggleTargetCourse = (id: string) => {
    setSelectedTargetCourses(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const handleCopyOrMove = async () => {
    const targets = selectedTargetCourses;
    if (!showActionModal || selectedEnrolled.length === 0 || targets.length === 0) return;
    setActionLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const endpoint = showActionModal === 'copy' ? 'bulk-copy' : 'bulk-move';
      const body: any = { student_ids: selectedEnrolled, target_course_ids: targets };
      if (showActionModal === 'move') body.source_course_id = courseId;
      
      const res = await fetch(`${API_URL}/api/enrollments/${endpoint}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      
      if (res.ok) {
        Alert.alert('نجاح', data.message);
        setShowActionModal(null);
        setSelectedEnrolled([]);
        setSelectedTargetCourses([]);
        setEnrollSelectionMode(false);
        fetchData();
      } else {
        Alert.alert('خطأ', data.detail || 'فشلت العملية');
      }
    } catch { Alert.alert('خطأ', 'فشلت العملية'); }
    finally { setActionLoading(false); }
  };
  const enrolledIds = enrolledStudents.map(s => s.student_id);
  const filteredStudents = allStudents.filter(s => {
    if (enrolledIds.includes(s.id)) return false;
    if (!searchText) return true;
    return s.full_name.includes(searchText) || s.student_id.includes(searchText);
  });

  if (loading) {
    return <LoadingScreen />;
  }

  const renderStudentWithSummary = ({ item }: { item: EnrolledStudent }) => {
    const stats = studentStats[item.student_id];
    
    return (
      <View style={styles.studentCard}>
        <View style={styles.studentMainInfo}>
          <Text style={styles.studentName}>{item.full_name}</Text>
          <Text style={styles.studentDetail}>{item.student_number} | م{item.level}</Text>
          {item.cross_department && (
            <View style={{ backgroundColor: '#fff3e0', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 3 }} testID={`cross-dept-badge-${item.student_id}`}>
              <Text style={{ fontSize: 10, color: '#e65100', fontWeight: '800' }}>🔓 من قسم آخر{item.department_name ? ` — ${item.department_name}` : ''}</Text>
            </View>
          )}
        </View>
        
        {stats && stats.total > 0 ? (
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#4caf50' }]}>{stats.present}</Text>
              <Text style={styles.statLabel}>حاضر</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#f44336' }]}>{stats.absent}</Text>
              <Text style={styles.statLabel}>غائب</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#ff9800' }]}>{stats.late}</Text>
              <Text style={styles.statLabel}>متأخر</Text>
            </View>
            <View style={[styles.rateBox, { backgroundColor: getRateColor(stats.rate) + '20' }]}>
              <Text style={[styles.rateText, { color: getRateColor(stats.rate) }]}>{stats.rate}%</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.noStatsText}>لا يوجد حضور مسجل</Text>
        )}
        
        {canUnenroll && (
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => handleUnenroll(item.student_id, item.full_name)}
            accessibilityLabel="إلغاء التسجيل"
          >
            <Ionicons name="close-circle" size={24} color="#f44336" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const handleEditAttendance = async (newStatus: string) => {
    if (!editingRecord) return;
    setEditLoading(true);
    try {
      await api.put(`/attendance/${editingRecord.recordId}/status`, {
        status: newStatus,
        reason: editReason,
      });
      // تحديث السجل محلياً
      setLectureAttendance(prev => prev.map(r => 
        r.id === editingRecord.recordId ? { ...r, status: newStatus } : r
      ));
      setEditingRecord(null);
      setEditReason('');
    } catch (error: any) {
      const msg = error?.response?.data?.detail || 'فشل في تعديل الحالة';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('خطأ', msg);
      }
    } finally {
      setEditLoading(false);
    }
  };

  const renderStudentWithLectureAttendance = ({ item }: { item: EnrolledStudent }) => {
    const status = getAttendanceStatus(item.student_id);
    
    const record = lectureAttendance.find(r => r.student_id === item.student_id);
    
    return (
      <View style={styles.studentCard}>
        <View style={styles.studentMainInfo}>
          <Text style={styles.studentName}>{item.full_name}</Text>
          <Text style={styles.studentDetail}>{item.student_number}</Text>
        </View>
        
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[styles.attendanceStatusBadge, { backgroundColor: getStatusColor(status) + '20' }]}>
            <View style={[styles.statusDot, { backgroundColor: getStatusColor(status) }]} />
            <Text style={[styles.attendanceStatusText, { color: getStatusColor(status) }]}>
              {getStatusLabel(status)}
            </Text>
          </View>
          
          {hasEditAttendancePerm && record && (
            <TouchableOpacity
              style={{ backgroundColor: '#fff3e0', padding: 6, borderRadius: 6 }}
              onPress={() => setEditingRecord({ recordId: record.id, studentName: item.full_name, currentStatus: status })}
              data-testid={`edit-attendance-${item.student_id}`}
              accessibilityLabel="تعديل الحضور"
            >
              <Ionicons name="create-outline" size={18} color="#ff9800" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderAvailableStudent = ({ item }: { item: Student }) => {
    const isSelected = selectedStudents.includes(item.id);
    return (
      <TouchableOpacity
        style={[styles.selectableCard, isSelected && styles.selectedCard]}
        onPress={() => toggleStudentSelection(item.id)}
      >
        <View style={styles.checkbox}>
          {isSelected && <Ionicons name="checkmark" size={18} color="#fff" />}
        </View>
        <View style={styles.studentInfo}>
          <Text style={styles.studentName}>{item.full_name}</Text>
          <Text style={styles.studentDetail}>{item.student_id} | م{item.level}</Text>
          {!!item.department_id && !!course?.department_id && item.department_id !== course.department_id && (
            <Text style={{ fontSize: 10, color: '#e65100', fontWeight: '700', marginTop: 2 }} testID={`picker-cross-dept-${item.id}`}>🔓 من قسم آخر — سيُسجَّل تسجيلاً استثنائياً محمياً</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'طلاب المقرر',
          headerBackTitle: 'رجوع',
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 60, maxWidth: 1440, width: '100%', alignSelf: 'center', flexGrow: 1 }} showsVerticalScrollIndicator={true}>
          {courseId && (
            <CourseTabBar
              courseId={courseId}
              course={course}
              activeTab="students"
              onCourseUpdated={fetchData}
            />
          )}

        {/* View Mode Toggle */}
        <View style={styles.viewModeContainer}>
          <TouchableOpacity
            style={[styles.viewModeBtn, viewMode === 'summary' && styles.viewModeBtnActive]}
            onPress={() => {
              setViewMode('summary');
              setSelectedLecture(null);
            }}
          >
            <Ionicons name="stats-chart" size={18} color={viewMode === 'summary' ? '#fff' : '#1565c0'} />
            <Text style={[styles.viewModeBtnText, viewMode === 'summary' && styles.viewModeBtnTextActive]}>
              ملخص الحضور
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.viewModeBtn, viewMode === 'lecture' && styles.viewModeBtnActive]}
            onPress={() => setViewMode('lecture')}
          >
            <Ionicons name="calendar" size={18} color={viewMode === 'lecture' ? '#fff' : '#1565c0'} />
            <Text style={[styles.viewModeBtnText, viewMode === 'lecture' && styles.viewModeBtnTextActive]}>
              حسب المحاضرة
            </Text>
          </TouchableOpacity>
        </View>

        {/* Lecture Selector (when in lecture mode) */}
        {viewMode === 'lecture' && (
          <View style={styles.lectureSelector}>
            <View style={styles.lectureSelectorHeader}>
              <Text style={styles.lectureSelectorLabel}>اختر المحاضرة:</Text>
              {lectures.length > 0 && (
                <TouchableOpacity 
                  style={styles.todayButton}
                  onPress={() => {
                    // البحث عن أقرب محاضرة لليوم
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    
                    // ترتيب المحاضرات حسب القرب من اليوم
                    const sortedByDistance = [...lectures].sort((a, b) => {
                      const dateA = new Date(a.date);
                      const dateB = new Date(b.date);
                      return Math.abs(dateA.getTime() - today.getTime()) - Math.abs(dateB.getTime() - today.getTime());
                    });
                    
                    if (sortedByDistance.length > 0) {
                      setSelectedLecture(sortedByDistance[0]);
                    }
                  }}
                >
                  <Ionicons name="today" size={16} color="#1565c0" />
                  <Text style={styles.todayButtonText}>اليوم</Text>
                </TouchableOpacity>
              )}
            </View>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={true} 
              style={styles.lectureScrollView}
              contentContainerStyle={styles.lectureScrollContent}
            >
              {lectures.length === 0 ? (
                <Text style={styles.noLecturesText}>لا توجد محاضرات</Text>
              ) : (
                // ترتيب المحاضرات من الأحدث للأقدم
                [...lectures].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(lecture => {
                  const lectureDate = parseDate(lecture.date);
                  const dayName = WEEKDAYS_AR_SHORT[lectureDate.getDay()];
                  const formattedDate = formatGregorianDate(lectureDate, { includeYear: false, includeWeekday: false });
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const isToday = lectureDate.toDateString() === today.toDateString();
                  const isPast = lectureDate < today;
                  
                  return (
                    <TouchableOpacity
                      key={lecture.id}
                      style={[
                        styles.lectureChip,
                        selectedLecture?.id === lecture.id && styles.lectureChipActive,
                        isToday && styles.lectureChipToday,
                        isPast && !selectedLecture?.id && styles.lectureChipPast
                      ]}
                      onPress={() => setSelectedLecture(lecture)}
                    >
                      <Text style={[
                        styles.lectureChipDay,
                        selectedLecture?.id === lecture.id && styles.lectureChipTextActive,
                        isToday && styles.lectureChipTodayText
                      ]}>
                        {isToday ? 'اليوم' : dayName}
                      </Text>
                      <Text style={[
                        styles.lectureChipText,
                        selectedLecture?.id === lecture.id && styles.lectureChipTextActive
                      ]}>
                        {formattedDate}
                      </Text>
                      <Text style={[
                        styles.lectureChipTime,
                        selectedLecture?.id === lecture.id && styles.lectureChipTimeActive
                      ]}>
                        {lecture.start_time}
                      </Text>
                      {lecture.status === 'completed' && (
                        <View style={styles.completedBadge}>
                          <Ionicons name="checkmark-circle" size={12} color="#4caf50" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            
            {selectedLecture && !canEditAttendance && (
              <View style={styles.readOnlyBanner}>
                <Ionicons name="lock-closed" size={16} color="#666" />
                <Text style={styles.readOnlyText}>عرض فقط - انتهى وقت التعديل</Text>
              </View>
            )}
          </View>
        )}

        {/* Action Buttons - فقط إذا كان لديه صلاحية */}
        {canManageEnrollments && viewMode === 'summary' && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setShowAddModal(true)}
            >
              <Ionicons name="person-add" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>إضافة طلاب</Text>
            </TouchableOpacity>
            
            <Pressable
              data-testid="import-excel-btn"
              style={({ pressed }) => [
                styles.actionBtn, 
                styles.importBtn, 
                importing && styles.importingBtn,
                pressed && { opacity: 0.7 }
              ]}
              onPress={() => {
                console.log('Import button pressed!');
                if (!importing) {
                  handleImportExcel();
                }
              }}
              disabled={importing}
            >
              {importing ? (
                <View style={styles.importingContainer}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.actionBtnText}>جاري الرفع...</Text>
                </View>
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={20} color="#fff" />
                  <Text style={styles.actionBtnText}>استيراد Excel</Text>
                </>
              )}
            </Pressable>

            <TouchableOpacity
              data-testid="send-final-results-nav-btn"
              testID="send-final-results-nav-btn"
              style={[styles.actionBtn, { backgroundColor: '#7b1fa2' }]}
              onPress={() => router.push({ pathname: '/send-final-results', params: { courseId } })}
            >
              <Ionicons name="ribbon" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>إرسال النتائج النهائية</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Search & Selection for enrolled students */}
        <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Ionicons name="search" size={18} color="#999" />
              <TextInput
                style={{ flex: 1, marginLeft: 8, fontSize: 14, color: '#333' }}
                placeholder="بحث بالاسم أو الرقم..."
                value={enrolledSearchText}
                onChangeText={setEnrolledSearchText}
                placeholderTextColor="#aaa"
              />
              {enrolledSearchText ? (
                <TouchableOpacity onPress={() => setEnrolledSearchText('')}>
                  <Ionicons name="close-circle" size={18} color="#999" />
                </TouchableOpacity>
              ) : null}
            </View>
            {canManageEnrollments && !enrollSelectionMode && (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#e3f2fd', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 }}
                onPress={() => setEnrollSelectionMode(true)}
                data-testid="enroll-selection-btn"
              >
                <Ionicons name="checkbox-outline" size={18} color="#1565c0" />
                <Text style={{ color: '#1565c0', marginLeft: 4, fontWeight: '600', fontSize: 12 }}>تحديد</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {enrollSelectionMode && (
            <View style={{ marginTop: 8, backgroundColor: '#fff3e0', padding: 10, borderRadius: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ fontSize: 13, color: '#e65100', fontWeight: '600' }}>
                  تم تحديد {selectedEnrolled.length} طالب
                </Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity
                    style={{ backgroundColor: '#1565c0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                    onPress={() => {
                      const allIds = filteredEnrolled.map(s => s.student_id);
                      setSelectedEnrolled(selectedEnrolled.length === filteredEnrolled.length ? [] : allIds);
                    }}
                    data-testid="select-all-btn"
                  >
                    <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>
                      {selectedEnrolled.length === filteredEnrolled.length ? 'إلغاء الكل' : 'تحديد الكل'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ backgroundColor: '#e0e0e0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                    onPress={() => { setEnrollSelectionMode(false); setSelectedEnrolled([]); }}
                  >
                    <Text style={{ color: '#333', fontWeight: '600', fontSize: 12 }}>إلغاء</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1565c0', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, gap: 4, opacity: selectedEnrolled.length === 0 ? 0.5 : 1 }}
                  onPress={() => openActionModal('copy')}
                  disabled={selectedEnrolled.length === 0}
                  data-testid="bulk-copy-btn"
                >
                  <Ionicons name="copy-outline" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>نسخ إلى مقرر</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#ff9800', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, gap: 4, opacity: selectedEnrolled.length === 0 ? 0.5 : 1 }}
                  onPress={() => openActionModal('move')}
                  disabled={selectedEnrolled.length === 0}
                  data-testid="bulk-move-btn"
                >
                  <Ionicons name="swap-horizontal" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>نقل إلى مقرر</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f44336', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, gap: 4, opacity: selectedEnrolled.length === 0 ? 0.5 : 1 }}
                  onPress={handleBulkUnenroll}
                  disabled={selectedEnrolled.length === 0}
                  data-testid="bulk-unenroll-btn"
                >
                  <Ionicons name="remove-circle-outline" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>إلغاء تسجيل</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Students List */}
        {enrolledStudents.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>لا يوجد طلاب مسجلين</Text>
            {canManageEnrollments && (
              <Text style={styles.emptySubtext}>
                اضغط على «إضافة طلاب» أو «استيراد Excel»
              </Text>
            )}
          </View>
        ) : viewMode === 'lecture' && !selectedLecture ? (
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>اختر محاضرة لعرض الحضور</Text>
          </View>
        ) : (
          <FlatList
            data={filteredEnrolled}
            keyExtractor={(item) => item.enrollment_id}
            renderItem={(props) => {
              if (enrollSelectionMode) {
                const isSelected = selectedEnrolled.includes(props.item.student_id);
                return (
                  <TouchableOpacity
                    style={[styles.studentCard, isSelected && { backgroundColor: '#fff3e0', borderColor: '#ff9800', borderWidth: 1 }]}
                    onPress={() => toggleEnrolledSelection(props.item.student_id)}
                  >
                    <View style={{ width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: isSelected ? '#ff9800' : '#ccc', backgroundColor: isSelected ? '#ff9800' : '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                      {isSelected && <Ionicons name="checkmark" size={18} color="#fff" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.studentName}>{props.item.full_name}</Text>
                      <Text style={styles.studentDetail}>{props.item.student_number} | م{props.item.level}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }
              return viewMode === 'summary' ? renderStudentWithSummary(props) : renderStudentWithLectureAttendance(props);
            }}
            contentContainerStyle={styles.listContent}
          />
        )}
        </ScrollView>

        {/* Add Students Modal — تبويبان: موجود / جديد */}
        {canManageStudents && showAddModal && (
          <Modal visible={showAddModal} transparent animationType="fade">
            <View style={{ flex: 1, backgroundColor: 'rgba(20,30,55,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
              <View style={{ backgroundColor: '#fff', borderRadius: 14, width: '100%', maxWidth: 600, maxHeight: '92%', overflow: 'hidden', borderWidth: 1, borderColor: '#eef1f6' }}>
                {/* Header — نمط حديث */}
                <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-start', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#f3f5f9' }}>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: '#1a2540', marginBottom: 4 }}>إضافة طلاب للمقرر</Text>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                      <Text style={{ fontSize: 12, color: '#5b6678' }}>المقرر:</Text>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: '#e3f2fd' }}>
                        <Text style={{ fontSize: 12, color: '#1565c0', fontWeight: '700' }}>{course?.name}</Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => setShowAddModal(false)}
                    testID="close-add-modal-btn"
                    style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f6fb' }}
                  >
                    <Ionicons name="close" size={20} color="#5b6678" />
                  </TouchableOpacity>
                </View>

                {/* Tabs — نمط pill حديث */}
                <View style={{ flexDirection: 'row-reverse', padding: 10, gap: 6, backgroundColor: '#fafbfd' }}>
                  <TouchableOpacity
                    style={{
                      flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
                      paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10,
                      backgroundColor: addTab === 'existing' ? '#2962ff' : '#fff',
                      borderWidth: 1, borderColor: addTab === 'existing' ? '#2962ff' : '#e3e7ee',
                    }}
                    onPress={() => setAddTab('existing')}
                    testID="tab-existing-students"
                  >
                    <Ionicons name="people-outline" size={15} color={addTab === 'existing' ? '#fff' : '#5b6678'} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: addTab === 'existing' ? '#fff' : '#5b6678' }}>
                      من القائمة ({filteredStudents.length})
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{
                      flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
                      paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10,
                      backgroundColor: addTab === 'new' ? '#2962ff' : '#fff',
                      borderWidth: 1, borderColor: addTab === 'new' ? '#2962ff' : '#e3e7ee',
                    }}
                    onPress={() => setAddTab('new')}
                    testID="tab-new-student"
                  >
                    <Ionicons name="person-add-outline" size={15} color={addTab === 'new' ? '#fff' : '#5b6678'} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: addTab === 'new' ? '#fff' : '#5b6678' }}>
                      إنشاء طالب جديد
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Body */}
                {addTab === 'existing' ? (
                  <View style={{ flex: 1, padding: 12 }}>
                    {/* البحث */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 10, marginBottom: 10 }}>
                      <Ionicons name="search" size={18} color="#888" />
                      <TextInput
                        value={searchText}
                        onChangeText={setSearchText}
                        placeholder="ابحث بالاسم أو رقم القيد..."
                        style={{ flex: 1, padding: 10, fontSize: 14, textAlign: 'right' }}
                      />
                    </View>
                    {/* القائمة */}
                    <FlatList
                      data={filteredStudents}
                      keyExtractor={(item) => item.id}
                      renderItem={renderAvailableStudent}
                      style={{ maxHeight: 380 }}
                      ListEmptyComponent={
                        <View style={{ padding: 24, alignItems: 'center' }}>
                          <Ionicons name="people-outline" size={36} color="#bbb" />
                          <Text style={{ color: '#888', marginTop: 8, fontSize: 13 }}>
                            {searchText ? 'لا يوجد طالب يطابق البحث' : 'لا يوجد طلاب متاحون لإضافتهم'}
                          </Text>
                        </View>
                      }
                    />
                    {/* أزرار */}
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                      <TouchableOpacity
                        style={{ flex: 1, backgroundColor: '#9e9e9e', paddingVertical: 12, borderRadius: 8, alignItems: 'center' }}
                        onPress={() => setShowAddModal(false)}
                      >
                        <Text style={{ color: '#fff', fontWeight: '700' }}>إلغاء</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 1, backgroundColor: '#1565c0', paddingVertical: 12, borderRadius: 8, alignItems: 'center', opacity: saving || selectedStudents.length === 0 ? 0.6 : 1 }}
                        onPress={handleEnrollStudents}
                        disabled={saving || selectedStudents.length === 0}
                        testID="enroll-selected-btn"
                      >
                        <Text style={{ color: '#fff', fontWeight: '700' }}>
                          {saving ? 'جاري التسجيل...' : `تسجيل (${selectedStudents.length})`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <AddStudentForm
                    mode="course"
                    values={newStudentForm}
                    onChange={setNewStudentForm}
                    onSubmit={handleCreateAndEnroll}
                    onCancel={() => setShowAddModal(false)}
                    submitting={creatingStudent}
                    contextLabel={course?.name ? `سيُسجَّل الطالب تلقائياً في المقرر: ${course.name}` : undefined}
                    submitLabel="إنشاء وتسجيل"
                  />
                )}
              </View>
            </View>
          </Modal>
        )}
        
        {/* Import Preview/Confirm Modal */}
        {showImportConfirm && importPreview && (
          <Modal visible={showImportConfirm} transparent animationType="fade">
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
              <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 420 }}>
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#333', textAlign: 'center', marginBottom: 16 }}>
                  معاينة الاستيراد
                </Text>
                
                <View style={{ backgroundColor: '#e3f2fd', padding: 16, borderRadius: 12, marginBottom: 16 }}>
                  <Text style={{ fontSize: 28, fontWeight: '800', color: '#1565c0', textAlign: 'center' }}>
                    {importPreview.total}
                  </Text>
                  <Text style={{ fontSize: 14, color: '#1565c0', textAlign: 'center', marginTop: 4 }}>
                    طالب في الملف
                  </Text>
                </View>
                
                {importPreview.names.length > 0 && (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>عينة من الأسماء:</Text>
                    {importPreview.names.slice(0, 5).map((name, i) => (
                      <Text key={i} style={{ fontSize: 13, color: '#333', paddingVertical: 2 }}>
                        {i + 1}. {name}
                      </Text>
                    ))}
                    {importPreview.total > 5 && (
                      <Text style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                        و {importPreview.total - 5} آخرين...
                      </Text>
                    )}
                  </View>
                )}
                
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#f5f5f5', padding: 14, borderRadius: 10, alignItems: 'center' }}
                    onPress={() => { setShowImportConfirm(false); setImportPreview(null); }}
                  >
                    <Text style={{ color: '#666', fontWeight: '600' }}>إلغاء</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#4caf50', padding: 14, borderRadius: 10, alignItems: 'center' }}
                    onPress={confirmImport}
                    disabled={importing}
                  >
                    {importing ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={{ color: '#fff', fontWeight: '700' }}>تأكيد الاستيراد</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        )}

        {/* نافذة اختيار المقرر (نسخ/نقل) - اختيار متعدد */}
        <Modal visible={showActionModal === 'copy' || showActionModal === 'move'} transparent animationType="fade">
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '90%', maxWidth: 450, maxHeight: '80%' }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#333', textAlign: 'center', marginBottom: 4 }}>
                {showActionModal === 'copy' ? 'نسخ الطلاب إلى مقررات' : 'نقل الطلاب إلى مقرر'}
              </Text>
              <Text style={{ fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 4 }}>
                {selectedEnrolled.length} طالب محدد
              </Text>
              {showActionModal === 'copy' && selectedTargetCourses.length > 0 && (
                <Text style={{ fontSize: 13, color: '#1565c0', textAlign: 'center', marginBottom: 8, fontWeight: '600' }}>
                  تم اختيار {selectedTargetCourses.length} مقرر
                </Text>
              )}
              
              {/* شريط البحث */}
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 12, marginBottom: 10 }}>
                <Ionicons name="search" size={18} color="#999" />
                <TextInput
                  style={{ flex: 1, padding: 10, fontSize: 14, textAlign: 'right' }}
                  placeholder="بحث بالاسم أو الرمز..."
                  value={courseSearchQuery}
                  onChangeText={setCourseSearchQuery}
                  data-testid="copy-modal-search-input"
                />
                {courseSearchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setCourseSearchQuery('')}>
                    <Ionicons name="close-circle" size={18} color="#999" />
                  </TouchableOpacity>
                )}
              </View>

              {actionLoading ? (
                <ActivityIndicator size="large" color="#1565c0" style={{ marginVertical: 30 }} />
              ) : (
                <FlatList
                  data={allCourses.filter(c => {
                    if (!courseSearchQuery.trim()) return true;
                    const q = courseSearchQuery.trim().toLowerCase();
                    return (c.name || '').toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q) || (c.section || '').toLowerCase().includes(q);
                  })}
                  keyExtractor={item => item.id}
                  style={{ maxHeight: 350 }}
                  renderItem={({ item }) => {
                    const isSelected = selectedTargetCourses.includes(item.id);
                    return (
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', backgroundColor: isSelected ? (showActionModal === 'copy' ? '#e3f2fd' : '#fff3e0') : 'transparent' }}
                        onPress={() => {
                          if (showActionModal === 'copy') {
                            toggleTargetCourse(item.id);
                          } else {
                            setSelectedTargetCourses([item.id]);
                          }
                        }}
                        data-testid={`select-course-${item.id}`}
                      >
                        {showActionModal === 'copy' && (
                          <View style={{ width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: isSelected ? '#1565c0' : '#ccc', backgroundColor: isSelected ? '#1565c0' : 'transparent', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                            {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                          </View>
                        )}
                        <Ionicons name="book" size={20} color={showActionModal === 'copy' ? '#1565c0' : '#ff9800'} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: '#333' }}>
                            {item.name}{item.section ? ` (${item.section})` : ''}
                          </Text>
                          <Text style={{ fontSize: 12, color: '#999' }}>{item.code || ''}</Text>
                        </View>
                        {showActionModal === 'move' && (
                          <Ionicons name="chevron-back" size={18} color="#ccc" />
                        )}
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={
                    <Text style={{ textAlign: 'center', color: '#999', paddingVertical: 30 }}>لا توجد نتائج</Text>
                  }
                />
              )}
              
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: '#f5f5f5', padding: 12, borderRadius: 10, alignItems: 'center' }}
                  onPress={() => { setShowActionModal(null); setSelectedTargetCourses([]); setCourseSearchQuery(''); }}
                >
                  <Text style={{ color: '#666', fontWeight: '600' }}>إلغاء</Text>
                </TouchableOpacity>
                {(showActionModal === 'copy' || (showActionModal === 'move' && selectedTargetCourses.length > 0)) && (
                  <TouchableOpacity
                    style={{ flex: 2, backgroundColor: selectedTargetCourses.length > 0 ? (showActionModal === 'copy' ? '#1565c0' : '#ff9800') : '#ccc', padding: 12, borderRadius: 10, alignItems: 'center' }}
                    onPress={handleCopyOrMove}
                    disabled={selectedTargetCourses.length === 0 || actionLoading}
                    data-testid="confirm-copy-move-btn"
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>
                      {showActionModal === 'copy'
                        ? `نسخ إلى ${selectedTargetCourses.length} مقرر`
                        : 'نقل'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </Modal>

        {/* نافذة تعديل حالة الحضور */}
        <Modal visible={editingRecord !== null} transparent animationType="fade">
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 400 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#333', textAlign: 'center', marginBottom: 4 }}>
                تعديل حالة الحضور
              </Text>
              <Text style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 16 }}>
                {editingRecord?.studentName}
              </Text>
              
              <Text style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>اختر الحالة الجديدة:</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {[
                  { key: 'present', label: 'حاضر', color: '#4caf50', icon: 'checkmark-circle' },
                  { key: 'absent', label: 'غائب', color: '#f44336', icon: 'close-circle' },
                  { key: 'late', label: 'متأخر', color: '#ff9800', icon: 'time' },
                  { key: 'excused', label: 'معذور', color: '#2196f3', icon: 'document-text' },
                ].map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={{
                      flex: 1, minWidth: '40%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      padding: 12, borderRadius: 10, gap: 6,
                      backgroundColor: editingRecord?.currentStatus === opt.key ? opt.color + '30' : '#f5f5f5',
                      borderWidth: 2, borderColor: editingRecord?.currentStatus === opt.key ? opt.color : 'transparent',
                    }}
                    onPress={() => {
                      if (editingRecord && opt.key !== editingRecord.currentStatus) {
                        handleEditAttendance(opt.key);
                      }
                    }}
                    disabled={editLoading || editingRecord?.currentStatus === opt.key}
                  >
                    <Ionicons name={opt.icon as any} size={20} color={opt.color} />
                    <Text style={{ color: opt.color, fontWeight: '700', fontSize: 14 }}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              
              <Text style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>سبب التعديل (اختياري):</Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 14, textAlign: 'right' }}
                placeholder="مثال: عذر طبي..."
                value={editReason}
                onChangeText={setEditReason}
              />
              
              {editLoading && <ActivityIndicator style={{ marginBottom: 12 }} />}
              
              <TouchableOpacity
                style={{ backgroundColor: '#f5f5f5', padding: 14, borderRadius: 10, alignItems: 'center' }}
                onPress={() => { setEditingRecord(null); setEditReason(''); }}
              >
                <Text style={{ color: '#666', fontWeight: '600' }}>إغلاق</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  courseInfo: {
    backgroundColor: '#1565c0',
    padding: 16,
  },
  courseTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  courseCode: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  studentCount: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 8,
  },
  viewModeContainer: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  viewModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#e3f2fd',
    gap: 6,
  },
  viewModeBtnActive: {
    backgroundColor: '#1565c0',
  },
  viewModeBtnText: {
    fontSize: 13,
    color: '#1565c0',
    fontWeight: '500',
  },
  viewModeBtnTextActive: {
    color: '#fff',
  },
  lectureSelector: {
    padding: 12,
    paddingTop: 0,
  },
  lectureSelectorLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  lectureSelectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  todayButtonText: {
    color: '#1565c0',
    fontSize: 12,
    fontWeight: '600',
  },
  lectureScrollView: {
    flexDirection: 'row',
  },
  lectureScrollContent: {
    paddingRight: 16,
  },
  lectureChip: {
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    minWidth: 75,
  },
  lectureChipActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  lectureChipToday: {
    borderColor: '#4caf50',
    borderWidth: 2,
  },
  lectureChipTodayText: {
    color: '#4caf50',
    fontWeight: 'bold',
  },
  lectureChipPast: {
    opacity: 0.6,
  },
  lectureChipDay: {
    fontSize: 11,
    color: '#1565c0',
    fontWeight: '600',
    marginBottom: 2,
  },
  lectureChipText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  lectureChipTextActive: {
    color: '#fff',
  },
  lectureChipTime: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  lectureChipTimeActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  completedBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  noLecturesText: {
    color: '#999',
    fontSize: 14,
  },
  readOnlyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    gap: 8,
  },
  readOnlyText: {
    fontSize: 13,
    color: '#666',
  },
  actions: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1565c0',
    padding: 12,
    borderRadius: 8,
    gap: 6,
  },
  importBtn: {
    backgroundColor: '#4caf50',
  },
  importingBtn: {
    opacity: 0.7,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  importingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listContent: {
    padding: 12,
  },
  studentCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  studentMainInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  studentDetail: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 10,
    color: '#999',
  },
  rateBox: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  rateText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  noStatsText: {
    fontSize: 12,
    color: '#999',
  },
  attendanceStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  attendanceStatusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  removeBtn: {
    padding: 4,
    marginLeft: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#bbb',
    marginTop: 8,
    textAlign: 'center',
  },
  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  cancelText: {
    fontSize: 16,
    color: '#f44336',
  },
  saveText: {
    fontSize: 16,
    color: '#1565c0',
    fontWeight: '600',
  },
  disabledText: {
    color: '#ccc',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 12,
    padding: 10,
    borderRadius: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    textAlign: 'right',
  },
  selectableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
  },
  selectedCard: {
    backgroundColor: '#e3f2fd',
    borderColor: '#1565c0',
    borderWidth: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#1565c0',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1565c0',
    marginLeft: 12,
  },
  studentInfo: {
    flex: 1,
  },
});
